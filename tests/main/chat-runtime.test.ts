import assert from 'node:assert/strict'
import type Database from 'better-sqlite3'
import type { ChatProvider } from '../../src/main/chat/provider'
import { ChatRepository } from '../../src/main/chat/repository'
import { ChatRuntime } from '../../src/main/chat/runtime'
import { ChatEventBus } from '../../src/main/chat/events'
import type { Test } from './chat-events.test'
import { z } from 'zod'
import { ToolRegistry } from '../../src/main/tools/registry'
import { ToolExecutor } from '../../src/main/tools/executor'

async function until(predicate:()=>boolean):Promise<void> {
  const deadline=Date.now()+2000
  while(!predicate()){assert.ok(Date.now()<deadline,'condition timed out');await new Promise(resolve=>setTimeout(resolve,5))}
}
export async function testChatRuntime(test:Test,db:Database.Database,root:string):Promise<void> {
  await test('resuming an interrupted plan reuses committed tools and executes only the remaining writes',async()=>{
    const repo=new ChatRepository(db),bus=new ChatEventBus(repo),workspace=repo.ensureWorkspace(root+'/resume-tests'),conversation=repo.createConversation({workspaceId:workspace.id})
    const registry=new ToolRegistry(),writes:number[]=[]
    registry.register({definition:{name:'test.resume',version:1,title:'write',description:'write',risk:'reversible_write',defaultPermission:'auto',inputSchema:{type:'object'},canCancel:true},schema:z.object({value:z.number()}),execute:async(_ctx,args)=>{writes.push(args.value);return {status:'success',summary:'saved',durationMs:0,sources:[],artifacts:[],changes:[]}}})
    const turn=repo.createTurn({conversationId:conversation.id,clientMessageId:'resume-plan',text:'continue',mode:'act',modelBinding:{bindingId:'p:m',profileId:'p',provider:'mock',model:'m',capabilities:['text'],reasoning:'default'},context:{conversationId:conversation.id,runId:'pending',refs:[],permission:'auto',budget:{totalChars:100,usedChars:0,reservedForOutput:0},diagnostics:[],createdAt:new Date().toISOString()}})
    bus.appendAndPublish(turn.run.id,'plan.created',{steps:[0,1].map(value=>({id:'step-'+value,tool:'test.resume',args:{value},purpose:'write '+value,risk:'reversible_write'}))})
    await new ToolExecutor(registry).execute({runId:turn.run.id,workspaceId:workspace.id,toolCallId:`call_${turn.run.id}_0`,tool:'test.resume',args:{value:0},signal:new AbortController().signal,repository:repo,events:bus})
    repo.updateRunStatus(turn.run.id,'executing_tools')
    const runtime=new ChatRuntime(repo,{async *stream(){yield 'finished from saved tools'}},bus,2,undefined,registry)
    runtime.recover();assert.equal(repo.getRun(turn.run.id)?.status,'interrupted')
    assert.equal(runtime.resumeRun(turn.run.id),true);await runtime.idle()
    assert.deepEqual(writes,[0,1]);assert.equal(repo.getRun(turn.run.id)?.status,'completed')
    assert.ok(repo.listRunEvents(turn.run.id).some(event=>event.type==='run.resumed'))
  })
  await test('unknown outcomes after a crash prevent automatic repeat writes',()=>{
    const repo=new ChatRepository(db),workspace=repo.ensureWorkspace(root+'/unknown-write-tests'),conversation=repo.createConversation({workspaceId:workspace.id})
    const turn=repo.createTurn({conversationId:conversation.id,clientMessageId:'unknown-write',text:'write',modelBinding:{bindingId:'p:m',profileId:'p',provider:'mock',model:'m',capabilities:['text'],reasoning:'default'},context:{conversationId:conversation.id,runId:'pending',refs:[],budget:{totalChars:100,usedChars:0,reservedForOutput:0},diagnostics:[],createdAt:new Date().toISOString()}})
    repo.createToolCall({runId:turn.run.id,toolCallId:'uncertain-write',tool:'note.append',args:{},operationId:'uncertain-operation'})
    repo.updateToolCall('uncertain-write','running')
    const runtime=new ChatRuntime(repo,{async *stream(){throw new Error('must not execute')}},new ChatEventBus(repo))
    runtime.recover()
    assert.equal(repo.getRun(turn.run.id)?.status,'interrupted')
    assert.throws(()=>runtime.resumeRun(turn.run.id),/结果尚不明确/)
    assert.equal(repo.getRun(turn.run.id)?.status,'interrupted')
  })
  await test('same conversation serializes while an independent conversation runs concurrently',async()=>{
    const repository=new ChatRepository(db),workspace=repository.ensureWorkspace(root+'/queue-tests')
    const a=repository.createConversation({workspaceId:workspace.id}),b=repository.createConversation({workspaceId:workspace.id})
    const starts:string[]=[],release=new Map<string,()=>void>(),inputs=new Map<string,string>()
    const provider:ChatProvider={async *stream(messages){
      const text=messages.at(-1)!.content
      const key=text.includes('A2')?'A2':text.includes('B1')?'B1':'A1'
      starts.push(key);inputs.set(key,JSON.stringify(messages))
      await new Promise<void>(resolve=>release.set(key,resolve))
      yield 'answer-'+key
    }}
    const runtime=new ChatRuntime(repository,provider,new ChatEventBus(repository),2)
    const submit=(conversationId:string,text:string,parentMessageId?:string)=>runtime.submitTurn({conversationId,clientMessageId:text,text,parentMessageId,modelBinding:{bindingId:'p:m',profileId:'p',provider:'mock',model:'m',capabilities:['text'],reasoning:'default'},context:{conversationId,runId:'pending',refs:[],budget:{totalChars:100,usedChars:0,reservedForOutput:0},diagnostics:[],createdAt:new Date().toISOString()}})
    const first=submit(a.id,'A1'),second=submit(a.id,'A2',first.assistantMessage.id),peer=submit(b.id,'B1')
    await until(()=>starts.length===2)
    assert.deepEqual(starts,['A1','B1'])
    assert.equal(repository.getRun(second.run.id)?.status,'queued')
    release.get('A1')!();await until(()=>starts.includes('A2'))
    assert.ok(inputs.get('A2')?.includes('answer-A1'),'follow-up must include completed ancestral answer')
    release.get('A2')!();release.get('B1')!();await runtime.idle()
    for(const turn of [first,second,peer])assert.equal(repository.getRun(turn.run.id)?.status,'completed')
    assert.ok(JSON.stringify(repository.loadMessages({conversationId:b.id}).items).includes('answer-B1'))
    assert.ok(!JSON.stringify(repository.loadMessages({conversationId:b.id}).items).includes('answer-A1'))
  })
  await test('act tool sources are bound to final report citations',async()=>{
    const repository=new ChatRepository(db),bus=new ChatEventBus(repository),workspace=repository.ensureWorkspace(root+'/act-source-tests'),conversation=repository.createConversation({workspaceId:workspace.id,mode:'act'})
    const registry=new ToolRegistry(),sourceId='src_act_tool_source'
    registry.register({
      definition:{name:'test.read_source',version:1,title:'read source',description:'read',risk:'read',defaultPermission:'auto',inputSchema:{type:'object'},canCancel:true},
      schema:z.object({}),
      execute:async ctx=>{
        const source={id:sourceId,runId:ctx.runId,kind:'paper_page' as const,workspaceId:ctx.workspaceId,paperId:1,title:'Act Source',documentVersion:'v1',locator:{page:1},snippet:'tool evidence',status:'available' as const,createdAt:new Date().toISOString()}
        ctx.repository.addSource(source)
        return {status:'success',summary:'read source',sources:[source],artifacts:[],changes:[],durationMs:0}
      }
    })
    let call=0
    const provider:ChatProvider={async *stream(){call++;if(call===1)yield JSON.stringify({steps:[{id:'read',tool:'test.read_source',args:{},purpose:'读取证据',risk:'read'}]});else yield '执行报告：证据已核实 [1]。'}}
    const runtime=new ChatRuntime(repository,provider,bus,1,undefined,registry,'auto')
    const context={conversationId:conversation.id,runId:'pending',refs:[],permission:'auto' as const,budget:{totalChars:100,usedChars:0,reservedForOutput:0},diagnostics:[],createdAt:new Date().toISOString()}
    const turn=runtime.submitTurn({conversationId:conversation.id,clientMessageId:'act-tool-source',text:'读取并总结',context,modelBinding:{bindingId:'p:m',profileId:'p',provider:'mock',model:'m',capabilities:['text','json'],reasoning:'default'},mode:'act'})
    await runtime.idle()
    const run=repository.getRun(turn.run.id),message=repository.getMessage(turn.assistantMessage.id)
    assert.equal(run?.status,'completed')
    assert.deepEqual(repository.listSources(turn.run.id).map(source=>source.id),[sourceId])
    assert.ok(message?.parts.some(part=>part.type==='sources'&&part.sourceIds.includes(sourceId)))
    assert.ok(!message?.parts.some(part=>part.type==='error'))
  })
  await test('a failed tool triggers one persisted plan revision',async()=>{
    const repository=new ChatRepository(db),bus=new ChatEventBus(repository),workspace=repository.ensureWorkspace(root+'/plan-revision-tests'),conversation=repository.createConversation({workspaceId:workspace.id})
    const registry=new ToolRegistry();let attempts=0
    registry.register({definition:{name:'test.flaky',version:1,title:'flaky',description:'fail once',risk:'reversible_write',defaultPermission:'auto',inputSchema:{type:'object'},canCancel:true},schema:z.object({value:z.string()}),execute:async()=>{attempts++;if(attempts===1)throw new Error('first failure');return {status:'success',summary:'revised success',sources:[],artifacts:[],changes:[],durationMs:0}}})
    let call=0
    const provider:ChatProvider={async *stream(messages){
      call++
      if(call===1)yield JSON.stringify({steps:[{id:'fail',tool:'test.flaky',args:{value:'one'},purpose:'失败步骤',risk:'reversible_write'}]})
      else if(call===2)yield JSON.stringify({steps:[{id:'revision',tool:'test.flaky',args:{value:'two'},purpose:'修订步骤',risk:'reversible_write'}]})
      else yield '修订后执行完成。'
      if(messages[0]?.content.includes('科研任务规划器')&&call>2)throw new Error('unexpected planner call')
    }}
    const runtime=new ChatRuntime(repository,provider,bus,1,undefined,registry,'auto')
    const context={conversationId:conversation.id,runId:'pending',refs:[],permission:'auto' as const,budget:{totalChars:100,usedChars:0,reservedForOutput:0},diagnostics:[],createdAt:new Date().toISOString()}
    const turn=runtime.submitTurn({conversationId:conversation.id,clientMessageId:'plan-revision',text:'执行并修订',context,modelBinding:{bindingId:'p:m',profileId:'p',provider:'mock',model:'m',capabilities:['text','json'],reasoning:'default'},mode:'act'})
    await runtime.idle()
    const events=repository.listRunEvents(turn.run.id)
    assert.equal(attempts,2)
    assert.equal(repository.getRun(turn.run.id)?.status,'completed')
    assert.ok(events.some(event=>event.type==='plan.created'))
    const updated=events.find(event=>event.type==='plan.updated')
    assert.equal((updated?.payload as {revision?:number})?.revision,1)
    assert.ok(updated?.payload && typeof updated.payload==='object'&&'reason' in updated.payload)
    assert.deepEqual(repository.listToolCalls(turn.run.id).map(item=>item.status),['failed','success'])
  })
  await test('translation runs use the translation prompt and persist as ask runs',async()=>{
    const repository=new ChatRepository(db),workspace=repository.ensureWorkspace(root+'/translation-run-tests'),conversation=repository.createConversation({workspaceId:workspace.id})
    let system='',user=''
    const provider:ChatProvider={async *stream(messages){system=messages[0]?.content??'';user=messages.at(-1)?.content??'';yield '译文完成'}}
    const runtime=new ChatRuntime(repository,provider,new ChatEventBus(repository),1)
    const context={conversationId:conversation.id,runId:'pending',promptKind:'translation' as const,refs:[{kind:'selection' as const,workspaceId:workspace.id,paperId:1,page:2,text:'translation source',documentVersion:'v1',origin:'pdf' as const}],permission:'readonly' as const,budget:{totalChars:100,usedChars:0,reservedForOutput:0},diagnostics:[],createdAt:new Date().toISOString()}
    const turn=runtime.submitTurn({conversationId:conversation.id,clientMessageId:'translation-run',text:'translation source',context,modelBinding:{bindingId:'p:m',profileId:'p',provider:'mock',model:'m',capabilities:['text'],reasoning:'default'},mode:'ask'})
    await runtime.idle()
    assert.equal(repository.getRun(turn.run.id)?.status,'completed')
    assert.ok(system.includes('学术翻译引擎'))
    assert.ok(!system.includes('科研助手'))
    assert.equal(user,'translation source')
    assert.ok(repository.getMessage(turn.assistantMessage.id)?.parts.some(part=>part.type==='text'&&part.text==='译文完成'))
  })
  await test('retry and edit create explicit branches without mutating history',async()=>{
    const repository=new ChatRepository(db),workspace=repository.ensureWorkspace(root+'/retry-edit-tests'),conversation=repository.createConversation({workspaceId:workspace.id})
    let calls=0
    const provider:ChatProvider={async *stream(){calls++;if(calls===1)throw new Error('provider failed');yield calls===2?'retry answer':'edited answer'}}
    const runtime=new ChatRuntime(repository,provider,new ChatEventBus(repository),1)
    const context={conversationId:conversation.id,runId:'pending',refs:[],permission:'readonly' as const,budget:{totalChars:100,usedChars:0,reservedForOutput:0},diagnostics:[],createdAt:new Date().toISOString()}
    const model={bindingId:'p:m',profileId:'p',provider:'mock',model:'m',capabilities:['text' as const],reasoning:'default' as const}
    const first=runtime.submitTurn({conversationId:conversation.id,clientMessageId:'original',text:'original question',context,modelBinding:model})
    await runtime.idle()
    assert.equal(repository.getRun(first.run.id)?.status,'failed')
    const retried=runtime.retryTurn(first.run.id)
    assert.notEqual(retried.run.id,first.run.id)
    assert.equal(retried.userMessage.parentId,first.userMessage.parentId)
    await runtime.idle()
    assert.equal(repository.getRun(retried.run.id)?.status,'completed')
    assert.ok(repository.getMessage(retried.assistantMessage.id)?.parts.some(part=>part.type==='text'&&part.text==='retry answer'))
    const original=repository.getMessage(first.userMessage.id)!
    assert.equal(JSON.stringify(original.parts),JSON.stringify([{type:'text',text:'original question'}]))
    const edited=runtime.editAndResubmit({conversationId:conversation.id,messageId:retried.userMessage.id,text:'edited question',context:{...context,runId:'pending'},modelBinding:model})
    assert.notEqual(edited.run.id,retried.run.id)
    assert.equal(edited.userMessage.parentId,retried.userMessage.parentId)
    await runtime.idle()
    assert.equal(repository.getRun(edited.run.id)?.status,'completed')
    assert.ok(repository.getMessage(retried.userMessage.id)?.parts.some(part=>part.type==='text'&&part.text==='original question'))
    assert.ok(repository.getMessage(edited.userMessage.id)?.parts.some(part=>part.type==='text'&&part.text==='edited question'))
  })
  await test('run timeout aborts the provider and records a distinct retryable error',async()=>{
    const repository=new ChatRepository(db),workspace=repository.ensureWorkspace(root+'/timeout-tests'),conversation=repository.createConversation({workspaceId:workspace.id})
    let aborted=false
    const provider:ChatProvider={async *stream(_messages,{signal}){
      await new Promise<void>((_resolve,reject)=>{signal!.addEventListener('abort',()=>{aborted=true;reject(signal!.reason)},{once:true})})
      yield 'unreachable'
    }}
    const runtime=new ChatRuntime(repository,provider,new ChatEventBus(repository),1,undefined,undefined,'auto',{timeoutMs:25})
    const turn=runtime.submitTurn({conversationId:conversation.id,clientMessageId:'timeout',text:'timeout',modelBinding:{bindingId:'p:m',profileId:'p',provider:'mock',model:'m',capabilities:['text'],reasoning:'default'},context:{conversationId:conversation.id,runId:'pending',refs:[],budget:{totalChars:100,usedChars:0,reservedForOutput:0},diagnostics:[],createdAt:new Date().toISOString()}})
    await runtime.idle()
    assert.equal(aborted,true);assert.equal(repository.getRun(turn.run.id)?.status,'failed')
    assert.equal(repository.getRun(turn.run.id)?.error?.code,'run_timeout')
    assert.equal(repository.getRun(turn.run.id)?.error?.retryable,true)
    assert.ok(!JSON.stringify(repository.getMessage(turn.assistantMessage.id)).includes('unreachable'))
  })
  await test('act runs use the dedicated agent timeout',async()=>{
    const repository=new ChatRepository(db),workspace=repository.ensureWorkspace(root+'/act-timeout-tests'),conversation=repository.createConversation({workspaceId:workspace.id,mode:'act',entry:'work'})
    let aborted=false
    const provider:ChatProvider={async *stream(_messages,{signal}){
      await new Promise<void>((_resolve,reject)=>signal!.addEventListener('abort',()=>{aborted=true;reject(signal!.reason)},{once:true}))
      yield 'unreachable'
    }}
    const runtime=new ChatRuntime(repository,provider,new ChatEventBus(repository),1,undefined,new ToolRegistry(),'auto',{timeoutMs:60_000,actTimeoutMs:25})
    const turn=runtime.submitTurn({
      conversationId:conversation.id,
      clientMessageId:'act-timeout',
      text:'deep research timeout',
      mode:'act',
      modelBinding:{bindingId:'p:m',profileId:'p',provider:'mock',model:'m',capabilities:['text'],reasoning:'default'},
      context:{conversationId:conversation.id,runId:'pending',refs:[],permission:'auto',budget:{totalChars:100,usedChars:0,reservedForOutput:0},diagnostics:[],createdAt:new Date().toISOString()}
    })
    await runtime.idle()
    assert.equal(aborted,true)
    assert.equal(repository.getRun(turn.run.id)?.status,'failed')
    assert.equal(repository.getRun(turn.run.id)?.error?.code,'run_timeout')
  })
}
