import assert from 'node:assert/strict'
import type Database from 'better-sqlite3'
import { z } from 'zod'
import { ChatRepository } from '../../src/main/chat/repository'
import { ChatRuntime } from '../../src/main/chat/runtime'
import { ChatEventBus } from '../../src/main/chat/events'
import { ToolRegistry } from '../../src/main/tools/registry'
import { ToolExecutor } from '../../src/main/tools/executor'
import { readPaperNote, writePaperNote } from '../../src/main/note-service'
import type { Test } from './chat-events.test'

export async function testToolExecutor(test:Test,db:Database.Database,root:string,paperId:number,library:string):Promise<void> {
  await test('a committed tool call replays its result without repeating the write',async()=>{
    const repository=new ChatRepository(db),workspace=repository.ensureWorkspace(root+'/replay-tool-test'),conversation=repository.createConversation({workspaceId:workspace.id})
    const turn=repository.createTurn({conversationId:conversation.id,clientMessageId:'replay-tool',text:'write',modelBinding:{bindingId:'p:m',profileId:'p',provider:'mock',model:'m',capabilities:['text'],reasoning:'default'},context:{conversationId:conversation.id,runId:'pending',refs:[],budget:{totalChars:100,usedChars:0,reservedForOutput:0},diagnostics:[],createdAt:new Date().toISOString()}})
    const registry=new ToolRegistry();let writes=0
    registry.register({definition:{name:'test.write',version:1,title:'write',description:'write',risk:'reversible_write',defaultPermission:'auto',inputSchema:{type:'object'},canCancel:true},schema:z.object({text:z.string()}),execute:async()=>{writes++;return {status:'success',summary:'saved',durationMs:0,data:{writes},sources:[],artifacts:[],changes:[]}}})
    const executor=new ToolExecutor(registry),input={runId:turn.run.id,workspaceId:workspace.id,toolCallId:'stable_replay_call',tool:'test.write',args:{text:'once'},signal:new AbortController().signal,repository}
    assert.deepEqual(await executor.execute(input),await executor.execute(input));assert.equal(writes,1)
    await assert.rejects(executor.execute({...input,args:{text:'different'}}),/参数/)
    assert.equal(writes,1)
  })
  await test('approval covers exactly one persisted step even when tool names repeat',async()=>{
    const repository=new ChatRepository(db),workspace=repository.ensureWorkspace(root+'/repeated-approval-test'),conversation=repository.createConversation({workspaceId:workspace.id})
    const registry=new ToolRegistry(),writes:number[]=[]
    registry.register({definition:{name:'test.approved',version:1,title:'write',description:'write',risk:'reversible_write',defaultPermission:'approval_required',inputSchema:{type:'object'},canCancel:true},schema:z.object({value:z.number()}),execute:async(_ctx,args)=>{writes.push(args.value);return {status:'success',summary:'saved',durationMs:0,sources:[],artifacts:[],changes:[]}}})
    const provider={async *stream(messages:Array<{content:string}>){yield messages[0].content.includes('规划器')?JSON.stringify({steps:[0,1].map(value=>({id:'step-'+value,tool:'test.approved',purpose:'write '+value,risk:'reversible_write',args:{value}}))}):'completed'}}
    const runtime=new ChatRuntime(repository,provider,new ChatEventBus(repository),2,undefined,registry,'confirm')
    const turn=runtime.submitTurn({conversationId:conversation.id,clientMessageId:'approval-repeat',text:'write twice',mode:'act',modelBinding:{bindingId:'p:m',profileId:'p',provider:'mock',model:'m',capabilities:['text'],reasoning:'default'},context:{conversationId:conversation.id,runId:'pending',refs:[],permission:'confirm',budget:{totalChars:100,usedChars:0,reservedForOutput:0},diagnostics:[],createdAt:new Date().toISOString()}})
    await runtime.idle()
    const first=repository.listRunEvents(turn.run.id).find(event=>event.type==='approval.required')!.payload as {toolCallId:string}
    assert.equal(await runtime.approveTool({...first,approved:true}),true);await runtime.idle()
    assert.deepEqual(writes,[0]);assert.equal(repository.getRun(turn.run.id)?.status,'awaiting_approval')
    assert.equal(await runtime.approveTool({...first,approved:true}),false)
    const second=repository.listRunEvents(turn.run.id).filter(event=>event.type==='approval.required').at(-1)!.payload as {toolCallId:string}
    assert.notEqual(second.toolCallId,first.toolCallId)
    assert.equal(await runtime.approveTool({...second,approved:true}),true);await runtime.idle()
    assert.deepEqual(writes,[0,1]);assert.equal(repository.getRun(turn.run.id)?.status,'completed')
  })
  await test('tool timeout persists a retryable failure instead of hanging a run',async()=>{
    const repository=new ChatRepository(db),workspace=repository.ensureWorkspace(root+'/tool-timeout-test'),conversation=repository.createConversation({workspaceId:workspace.id})
    const registry=new ToolRegistry()
    registry.register({definition:{name:'test.hang',version:1,title:'hang',description:'hang',risk:'read',defaultPermission:'auto',inputSchema:{type:'object'},canCancel:true,timeoutMs:20},schema:z.object({}),execute:context=>new Promise<never>((_resolve,reject)=>context.signal.addEventListener('abort',()=>reject(context.signal.reason)))})
    const turn=repository.createTurn({conversationId:conversation.id,clientMessageId:'tool-timeout',text:'hang',modelBinding:{bindingId:'p:m',profileId:'p',provider:'mock',model:'m',capabilities:['text'],reasoning:'default'},context:{conversationId:conversation.id,runId:'pending',refs:[],budget:{totalChars:100,usedChars:0,reservedForOutput:0},diagnostics:[],createdAt:new Date().toISOString()}})
    const executor=new ToolExecutor(registry),bus=new ChatEventBus(repository),started=Date.now()
    const outcome=await executor.execute({runId:turn.run.id,workspaceId:workspace.id,toolCallId:'timeout-call',tool:'test.hang',args:{},signal:new AbortController().signal,repository,events:bus})
    assert.equal(outcome.status,'failed')
    if(outcome.status==='failed')assert.equal(outcome.error.code,'tool_timeout')
    assert.ok(Date.now()-started<1000)
    assert.equal(repository.getToolCall('timeout-call')?.status,'failed')
    assert.ok(repository.listRunEvents(turn.run.id).some(event=>event.type==='tool.failed'))
  })
  await test('note append preserves existing text, deduplicates retries and detects external edits',()=>{
    const repository=new ChatRepository(db),workspace=repository.ensureWorkspace(library),before=readPaperNote(workspace.id,paperId)
    const input={workspaceId:workspace.id,paperId,text:'APPEND-EXACTLY-ONCE',mode:'append' as const,operationId:'append_note_test',expectedVersion:before.version}
    const after=writePaperNote(input)
    assert.ok(after.text.startsWith(before.text));assert.ok(after.text.endsWith(input.text))
    writePaperNote(input)
    assert.equal(readPaperNote(workspace.id,paperId).text.split(input.text).length,2)
    assert.throws(()=>writePaperNote({...input,operationId:'conflicting_note_test',text:'must not overwrite'}),/其他操作修改/)
    assert.equal(readPaperNote(workspace.id,paperId).text,after.text)
    const other=repository.ensureWorkspace(root+'/other-note-library')
    assert.throws(()=>readPaperNote(other.id,paperId),/不在当前工作区/)
  })
}
