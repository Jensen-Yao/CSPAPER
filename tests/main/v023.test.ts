import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import type Database from 'better-sqlite3'
import { z } from 'zod'
import { assertPublicHost, isBlockedIp, redirectTarget, safePublicHttpsUrl } from '../../src/main/net-guard'
import { generateStructured, parseStructured } from '../../src/main/chat/structured'
import { FULL_TEXT_PAGE_BUDGET, retrieveSources, selectContextPages as selectRetrievalPages } from '../../src/main/chat/retrieval'
import { ChatEventBus } from '../../src/main/chat/events'
import { ChatRepository } from '../../src/main/chat/repository'
import { ChatRuntime, parseToolRequest } from '../../src/main/chat/runtime'
import { ToolRegistry } from '../../src/main/tools/registry'
import { ToolExecutor } from '../../src/main/tools/executor'
import { registerPlatformTools } from '../../src/main/tools/platform'
import { htmlToMarkdown } from '../../src/main/web-reader'
import { normalizeDoi, normalizeUrl } from '../../src/main/web-search'
import { selectPages } from '../../src/main/insight'
import type { Test } from './chat-events.test'

/** Minimal valid three-page PDF with extractable text (same shape as the UI fixtures). */
function samplePdf(pages=3):Buffer {
  const pageStream=(pageNumber:number)=>{
    const unique=['Page one methodology cohort and research design evidence.','Page two dataset validation and experimental measurement results.','Page three reproducibility limitation and uncertainty analysis conclusion.'][pageNumber-1]??`Page ${pageNumber} supplementary material and appendix tables.`
    const lines=[`BT /F1 18 Tf 54 740 Td (Research Paper: Evidence and Methods) Tj`,`/F1 11 Tf 0 -24 Td (${unique}) Tj`]
    for(let i=0;i<30;i++)lines.push(`0 -18 Td (Line ${i+1}: resilience methods evidence analysis results. A reproducible research example.) Tj`)
    lines.push('ET')
    const stream=lines.join('\n')
    return {stream,length:Buffer.byteLength(stream)}
  }
  const streams=Array.from({length:pages},(_item,index)=>pageStream(index+1))
  const objects=['<< /Type /Catalog /Pages 2 0 R >>',`<< /Type /Pages /Kids [${streams.map((_s,index)=>`${3+index*3} 0 R`).join(' ')}] /Count ${streams.length} >>`]
  streams.forEach((item,index)=>{
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${4+index*3} 0 R >> >> /Contents ${5+index*3} 0 R >>`)
    objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
    objects.push(`<< /Length ${item.length} >>\nstream\n${item.stream}\nendstream`)
  })
  let content='%PDF-1.4\n'
  const offsets=[0]
  for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(content));content+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`}
  const xref=Buffer.byteLength(content)
  content+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer\n<< /Root 1 0 R /Size ${objects.length+1} >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(content)
}

export async function testV023(test:Test,db:Database.Database,root:string,library:string):Promise<void> {
  await test('net guard upgrades http, rejects private hosts and validates redirect targets',async()=>{
    assert.equal(safePublicHttpsUrl('http://example.org/a'),'https://example.org/a')
    assert.equal(safePublicHttpsUrl('https://user:pw@example.org/'),null)
    assert.equal(safePublicHttpsUrl('https://127.0.0.1/x'),null)
    assert.equal(safePublicHttpsUrl('https://localhost:8080/x'),null)
    assert.equal(safePublicHttpsUrl('https://192.168.1.4/x'),null)
    assert.equal(safePublicHttpsUrl('ftp://example.org/x'),null)
    assert.equal(safePublicHttpsUrl('https://[::1]/x'),null)
    assert.equal(isBlockedIp('10.1.2.3'),true);assert.equal(isBlockedIp('8.8.8.8'),false);assert.equal(isBlockedIp('::ffff:192.168.0.1'),true)
    assert.equal(redirectTarget('https://example.org/a/b','../c'),'https://example.org/c')
    assert.equal(redirectTarget('https://example.org/a','http://169.254.169.254/latest'),null)
    await assert.rejects(assertPublicHost('example.org',async()=>['10.0.0.5']),/内网/)
    await assertPublicHost('example.org',async()=>['93.184.216.34'])
    await assert.rejects(assertPublicHost('127.0.0.1'),/内网/)
  })
  await test('structured output strips thinking, repairs JSON, retries once and degrades by field',async()=>{
    const schema=z.object({summary:z.string().default(''),problem:z.string().default(''),method:z.string().default(''),results:z.string().default('')})
    const tagged='<think>先分析一下……</think>\n```json\n{"summary":"卡片小结","problem":"研究问题A", "method":"方法B", "results":"结果C",}\n```'
    const parsed=parseStructured(tagged,schema)
    assert.equal(parsed.ok,true);assert.equal(parsed.value!.results,'结果C');assert.equal(parsed.complete,4)
    const prose=parseStructured('研究问题：作者要解决 X\n方法路线：方法 Y\n核心结果：结果 Z',schema,{labels:{problem:['研究问题'],method:['方法路线'],results:['核心结果']}})
    assert.equal(prose.ok,false);assert.equal(prose.partial.problem,'作者要解决 X');assert.equal(prose.complete,3)
    let calls=0
    const stream=async function*(messages:Array<{role:string;content:string}>){
      calls++
      if(calls===1)yield '<think>思考中</think>这不是 JSON，只是一段话。'
      else yield JSON.stringify({summary:'重试后的摘要',problem:'问题',method:'方法',results:'结果'})
    }
    const result=await generateStructured({prompt:[{role:'system',content:'s'},{role:'user',content:'u'}],schema,stream:stream as never,minComplete:2})
    assert.equal(result.ok,true);assert.equal(result.attempts,2);assert.equal(result.value!.summary,'重试后的摘要')
    assert.equal(calls,2)
  })
  await test('section-aware page selection keeps the opening and the end of long papers',()=>{
    assert.equal(selectPages(['a','b'],100).length,2)
    const pages=Array.from({length:40},(_item,index)=>'x'.repeat(5000)+(index===7?'\n3 Methods\n':'')+(index===39?'\n7 Conclusion\n':''))
    const selected=selectPages(pages,90000).map(item=>item.page)
    assert.ok(selected.includes(1));assert.ok(selected.includes(40));assert.ok(selected.includes(8))
    assert.ok(selected.reduce((sum,page)=>sum+pages[page-1].length,0)<=90000+5000)
    const context=selectRetrievalPages(pages,'这篇论文说了什么',FULL_TEXT_PAGE_BUDGET)
    assert.ok(context.includes(0));assert.ok(context.includes(39))
    const small=selectRetrievalPages(['a','b','c'],'summary',100)
    assert.equal(small.length,3)
  })
  await test('one explicit PDF enters the context page by page with locators',async()=>{
    const slug='fulltext-paper',dir=path.join(library,'papers','inbox',slug)
    fs.mkdirSync(dir,{recursive:true})
    fs.writeFileSync(path.join(dir,'paper.pdf'),samplePdf(3))
    fs.writeFileSync(path.join(dir,slug+'.md'),`---\ntitle: "Full text sample"\nauthors: "Sample Author"\nyear: 2025\nvenue: "Sample Journal"\ntags: []\n---\n\n# Full text sample\n`)
    const { scanLibrary }=await import('../../src/main/db')
    scanLibrary(library)
    const row=db.prepare('SELECT id FROM active_papers WHERE slug=?').get(slug) as {id:number}|undefined
    assert.ok(row)
    const repo=new ChatRepository(db),workspace=repo.ensureWorkspace(library)
    const sources=await retrieveSources({query:'这篇论文说了什么',workspaceId:workspace.id,runId:'run-fulltext',refs:[{kind:'paper',workspaceId:workspace.id,paperId:row.id}]})
    const pageSources=sources.filter(source=>source.paperId===row.id&&source.kind==='paper_page'&&source.locator.page&&source.locator.anchor!=='metadata')
    assert.ok(pageSources.length>=3,'every page should be a source')
    assert.ok(sources.some(source=>source.locator.anchor==='metadata'))
    assert.match(pageSources[0].snippet,/Research Paper: Evidence and Methods/)
    assert.equal(pageSources[1].locator.page,2)
    assert.ok(pageSources.every(source=>source.locator.uri?.includes(slug)))
  })
  await test('act runtime appends steps after the plan completes and never repeats executed steps',async()=>{
    const repo=new ChatRepository(db),bus=new ChatEventBus(repo),workspace=repo.ensureWorkspace(path.join(root,'continuation-library')),conversation=repo.createConversation({workspaceId:workspace.id,mode:'act'})
    const registry=new ToolRegistry();const executed:string[]=[]
    registry.register({definition:{name:'test.read',version:1,title:'read',description:'read',risk:'read',defaultPermission:'auto',inputSchema:{type:'object'},canCancel:true},schema:z.object({query:z.string()}),execute:async(_ctx,args)=>{executed.push('read:'+args.query);return {status:'success',summary:'read '+args.query,sources:[],artifacts:[],changes:[],durationMs:0}}})
    registry.register({definition:{name:'test.deep',version:1,title:'deep',description:'deep',risk:'read',defaultPermission:'auto',inputSchema:{type:'object'},canCancel:true},schema:z.object({id:z.number()}),execute:async(_ctx,args)=>{executed.push('deep:'+args.id);return {status:'success',summary:'deep '+args.id,sources:[],artifacts:[],changes:[],durationMs:0}}})
    let call=0
    const provider={async *stream(messages:any){
      call++
      const system=String(messages[0]?.content??'')
      if(system.includes('科研任务规划器')&&system.includes('追加步骤')) {
        yield call===2?JSON.stringify({steps:[{id:'deep',tool:'test.deep',args:{id:7},purpose:'精读检索到的文献',risk:'read'}]}):JSON.stringify({steps:[{id:'read',tool:'test.read',args:{query:'same'},purpose:'重复步骤',risk:'read'}]})
        return
      }
      if(system.includes('科研任务规划器')) {yield JSON.stringify({steps:[{id:'read',tool:'test.read',args:{query:'same'},purpose:'先检索',risk:'read'}]});return}
      yield '最终报告：已检索并精读。'
    }}
    const runtime=new ChatRuntime(repo,provider as any,bus,1,undefined,registry,'auto')
    const model={bindingId:'p:m',profileId:'p',provider:'mock',model:'m',capabilities:['text' as const],reasoning:'default' as const}
    const turn=runtime.submitTurn({conversationId:conversation.id,clientMessageId:'continue-run',text:'检索后精读',mode:'act',modelBinding:model,context:{permission:'auto',conversationId:conversation.id,runId:'pending',refs:[],budget:{totalChars:100,usedChars:0,reservedForOutput:0},diagnostics:[],createdAt:new Date().toISOString()}})
    await runtime.idle()
    assert.equal(repo.getRun(turn.run.id)?.status,'completed')
    assert.deepEqual(executed,['read:same','deep:7'])
    assert.ok(repo.listRunEvents(turn.run.id).some(event=>event.type==='plan.updated'&&(event.payload as {reason?:string}).reason==='根据执行结果追加步骤'))
    assert.ok(repo.getMessage(turn.assistantMessage.id)?.parts.some(part=>part.type==='text'&&part.text.includes('最终报告')))
  })
  await test('ask mode runs read-only tools before answering and keeps the answer text',async()=>{
    const repo=new ChatRepository(db),bus=new ChatEventBus(repo),workspace=repo.ensureWorkspace(path.join(root,'ask-tools-library')),conversation=repo.createConversation({workspaceId:workspace.id})
    const registry=new ToolRegistry();let reads=0
    registry.register({definition:{name:'library.list',version:1,title:'list',description:'list',risk:'read',defaultPermission:'auto',inputSchema:{type:'object'},canCancel:true},schema:z.object({}),execute:async()=>{reads++;return {status:'success',summary:'3 篇最近打开',data:{papers:[{id:1,title:'A'}]},sources:[],artifacts:[],changes:[],durationMs:0}}})
    let call=0
    const provider={async *stream(){call++;yield call===1?'{"tool":"library.list","args":{}}':'最近读过的 3 篇文献是 A、B、C。[1]'}}
    const runtime=new ChatRuntime(repo,provider as any,bus,1,async request=>[{id:'src_1',runId:request.runId,kind:'chunk',workspaceId:workspace.id,title:'A',locator:{page:1},snippet:'A 的片段',status:'available',createdAt:new Date().toISOString()}],registry,'auto')
    const model={bindingId:'p:m',profileId:'p',provider:'mock',model:'m',capabilities:['text' as const],reasoning:'default' as const}
    const turn=runtime.submitTurn({conversationId:conversation.id,clientMessageId:'ask-tools',text:'我最近读过哪些文献',mode:'ask',modelBinding:model,context:{permission:'readonly',conversationId:conversation.id,runId:'pending',refs:[],budget:{totalChars:100,usedChars:0,reservedForOutput:0},diagnostics:[],createdAt:new Date().toISOString()}})
    await runtime.idle()
    assert.equal(reads,1);assert.equal(call,2)
    assert.equal(repo.getRun(turn.run.id)?.status,'completed')
    assert.ok(repo.getMessage(turn.assistantMessage.id)?.parts.some(part=>part.type==='text'&&part.text.includes('最近读过')))
    assert.equal(repo.listToolCalls(turn.run.id).length,1)
    assert.equal(parseToolRequest('```json\n{"tool_calls":[{"function":{"name":"x"}}]}\n```'),null)
    assert.equal(parseToolRequest('{"steps":[]}'),null)
    assert.deepEqual(parseToolRequest('{"tool":"web_search","args":{"query":"a"}}'),{tool:'web_search',args:{query:'a'}})
  })
  await test('conversation context is inherited across turns and translation conversations stay hidden',async()=>{
    const repo=new ChatRepository(db),workspace=repo.ensureWorkspace(path.join(root,'inherit-library')),conversation=repo.createConversation({workspaceId:workspace.id})
    const registry=new ToolRegistry()
    let call=0
    const provider={async *stream(messages:any){call++;yield '回答 '+String(messages[0]?.content??'').length}}
    const seen:unknown[][]=[]
    const runtime=new ChatRuntime(repo,provider as any,new ChatEventBus(repo),1,async request=>{seen.push(request.refs);return []},registry,'auto')
    const model={bindingId:'p:m',profileId:'p',provider:'mock',model:'m',capabilities:['text' as const],reasoning:'default' as const}
    const first=runtime.submitTurn({conversationId:conversation.id,clientMessageId:'inherit-1',text:'这篇论文说了什么',modelBinding:model,context:{conversationId:conversation.id,runId:'pending',refs:[{kind:'paper',workspaceId:workspace.id,paperId:1}],budget:{totalChars:100,usedChars:0,reservedForOutput:0},diagnostics:[],createdAt:new Date().toISOString()}})
    await runtime.idle()
    const firstAssistant=repo.getMessage(first.assistantMessage.id)!
    const second=runtime.submitTurn({conversationId:conversation.id,clientMessageId:'inherit-2',parentMessageId:firstAssistant.id,text:'它的局限是什么',modelBinding:model,context:{conversationId:conversation.id,runId:'pending',refs:[],budget:{totalChars:100,usedChars:0,reservedForOutput:0},diagnostics:[],createdAt:new Date().toISOString()}})
    await runtime.idle()
    assert.equal((seen[0] as Array<{kind:string}>)[0].kind,'paper')
    assert.equal((seen[1] as Array<{kind:string}>)[0].kind,'paper')
    const stored=repo.getRunDetails(second.run.id)!.context
    assert.equal(stored.refs.length,1)
    assert.ok(stored.diagnostics.some(item=>item.code==='context_inherited'))
    const third=runtime.submitTurn({conversationId:conversation.id,clientMessageId:'inherit-3',parentMessageId:repo.getMessage(second.assistantMessage.id)!.id,text:'换个话题',modelBinding:model,context:{conversationId:conversation.id,runId:'pending',refs:[],inheritContext:false,budget:{totalChars:100,usedChars:0,reservedForOutput:0},diagnostics:[],createdAt:new Date().toISOString()}})
    await runtime.idle()
    assert.equal((seen[2] as unknown[]).length,0)
    repo.createConversation({workspaceId:workspace.id,title:'翻译：片段',mode:'ask',entry:'reader'})
    const visible=repo.listConversations({workspaceId:workspace.id})
    assert.equal(visible.items.some(item=>item.title==='翻译：片段'),false)
    assert.equal(repo.listConversations({workspaceId:workspace.id,mode:'act'}).items.length,0)
    assert.equal(repo.listConversations({workspaceId:workspace.id,mode:'ask'}).items.length,1)
    assert.equal(repo.listConversations({workspaceId:workspace.id,includeHidden:true}).items.length,2)
  })
  await test('deep reading runs as a recorded hidden job and can be cancelled',async()=>{
    const { configureModelJobs }=await import('../../src/main/chat/jobs')
    const { extractPaper, getExtract }=await import('../../src/main/insight')
    const repo=new ChatRepository(db),bus=new ChatEventBus(repo)
    let calls=0
    configureModelJobs(repo,{async *stream(messages:any){calls++;const system=String(messages[0]?.content??'');if(!system.includes('资深科研文献分析师'))throw new Error('unexpected prompt');yield '<think>思考</think>'+JSON.stringify({summary:'卡片小结',problem:'问题A',method:'方法B',dataset:'数据C',metrics:'指标D',results:'结果E',limitations:'局限F',novelty:'创新G',future:'未来H'})}} as any,bus)
    const slug='deep-job-paper',dir=path.join(library,'papers','inbox',slug)
    fs.mkdirSync(dir,{recursive:true})
    fs.writeFileSync(path.join(dir,'paper.pdf'),samplePdf(3))
    fs.writeFileSync(path.join(dir,slug+'.md'),`---\ntitle: "Deep job sample"\nauthors: "Job Author"\nyear: 2025\nvenue: "Job Journal"\ntags: []\n---\n\n# Deep job sample\n`)
    const { scanLibrary }=await import('../../src/main/db')
    scanLibrary(library)
    const row=db.prepare('SELECT id FROM active_papers WHERE slug=?').get(slug) as {id:number}
    const { getSettings,saveSettings }=await import('../../src/main/db')
    const before=getSettings()
    const profile=(before.profiles??[]).find(item=>item.models.length)
    if(!profile)throw new Error('test fixture needs a model profile')
    saveSettings({modelBindingId:profile.id+':'+profile.models[0]})
    const result=await extractPaper(row.id)
    assert.equal(calls,1);assert.equal(result.summary,'卡片小结');assert.equal(getExtract(row.id)?.method,'方法B')
    const jobConversation=db.prepare("SELECT id FROM conversations WHERE entry='work' AND mode='ask' ORDER BY created_at DESC LIMIT 1").get() as {id:string}
    const jobRun=db.prepare('SELECT status FROM chat_runs WHERE conversation_id=?').get(jobConversation.id) as {status:string}
    assert.equal(jobRun.status,'completed')
    assert.equal(repo.listConversations({workspaceId:repo.ensureWorkspace(library).id}).items.some(item=>item.id===jobConversation.id),false)
    // cancellation ends the job in a terminal state instead of leaving it generating
    const controller=new AbortController()
    const slow=configureModelJobs(repo,{async *stream(){await new Promise<void>((_resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('too slow')),5000);controller.signal.addEventListener('abort',()=>{clearTimeout(timer);reject(controller.signal.reason)},{once:true})});yield 'never'}} as any,bus)
    const pending=extractPaper(row.id,controller.signal)
    await new Promise(resolve=>setTimeout(resolve,50))
    controller.abort(new Error('用户停止精读'))
    await assert.rejects(pending,/停止/)
    const stale=db.prepare("SELECT status FROM chat_runs WHERE status IN ('generating','queued')").all()
    assert.equal(stale.length,0)
    void slow
  })
  await test('platform tools create tasks, projects, calendar events and standalone notes',async()=>{
    const repo=new ChatRepository(db),workspace=repo.ensureWorkspace(path.join(root,'platform-library')),conversation=repo.createConversation({workspaceId:workspace.id,mode:'act'})
    const registry=new ToolRegistry();let opened=-1
    registerPlatformTools(registry,{openPaper:paperId=>{opened=paperId}})
    const turn=repo.createTurn({conversationId:conversation.id,clientMessageId:'platform-turn',text:'建任务',mode:'act',modelBinding:{bindingId:'p:m',profileId:'p',provider:'mock',model:'m',capabilities:['text'],reasoning:'default'},context:{conversationId:conversation.id,runId:'pending',refs:[],budget:{totalChars:100,usedChars:0,reservedForOutput:0},diagnostics:[],createdAt:new Date().toISOString()}})
    const executor=new ToolExecutor(registry),bus=new ChatEventBus(repo)
    const run=(tool:string,args:unknown)=>executor.execute({runId:turn.run.id,workspaceId:workspace.id,tool,toolCallId:'call_'+tool+'_'+Math.random(),args,signal:new AbortController().signal,repository:repo,events:bus,permission:'auto'})
    const listed=await run('library.list',{recent:true,limit:5})
    assert.equal(listed.status,'success')
    const task=await run('task.create',{title:'整理综述提纲',dueDate:'2030-01-15'})
    assert.equal(task.status,'success');assert.equal((listed as {result:{summary:string}}).result.summary.length>0,true)
    const taskId=(task as {result:{data:{taskId:number}}}).result.data.taskId
    const updated=await run('task.update',{taskId,status:'doing'})
    assert.equal((updated as {result:{data:{status:string}}}).result.data.status,'doing')
    const project=await run('project.create',{name:'工具创建的项目'})
    assert.equal((project as {result:{data:{name:string}}}).result.data.name,'工具创建的项目')
    const event=await run('calendar.create',{title:'组会',date:'2030-02-01',startTime:'09:00',endTime:'10:00',kind:'meeting'})
    assert.equal((event as {result:{data:{title:string}}}).result.data.title,'组会')
    const note=await run('standalone_note.save',{title:'独立笔记',body:'# 内容'})
    const noteId=(note as {result:{data:{noteId:number}}}).result.data.noteId
    const readBack=await run('standalone_note.read',{noteId})
    assert.match((readBack as {result:{data:{body:string}}}).result.data.body,/# 内容/)
    const open=await run('paper.open',{paperId:1})
    assert.equal(open.status==='failed'?open.error.code:'success','success');assert.equal(opened,1)
    assert.ok(repo.listArtifacts(turn.run.id).length>=1)
  })
  await test('recorded tool writes can be undone and per-run approval allowance skips later prompts',async()=>{
    const { getDb }=await import('../../src/main/db')
    const { undoToolCall }=await import('../../src/main/tools/undo')
    const { summarizeTaskTitle }=await import('../../src/shared/title')
    const repo=new ChatRepository(db),bus=new ChatEventBus(repo),workspace=repo.ensureWorkspace(path.join(root,'undo-library')),conversation=repo.createConversation({workspaceId:workspace.id,mode:'act',title:'待概括'})
    const registry=new ToolRegistry()
    registry.register({definition:{name:'test.write',version:1,title:'write',description:'write',risk:'reversible_write',defaultPermission:'approval_required',inputSchema:{type:'object'},canCancel:true},schema:z.object({value:z.string()}),execute:async(ctx,args)=>({status:'success',summary:'wrote '+args.value,data:{value:args.value},sources:[],artifacts:[],changes:[{entity:'note',entityId:String((getDb().prepare('SELECT id FROM active_papers LIMIT 1').get() as {id:number}).id),action:'update',before:'old text',after:args.value,reversible:true}],durationMs:0})})
    let call=0
    const provider={async *stream(){call++;if(call===1)yield JSON.stringify({steps:[{id:'a',tool:'test.write',args:{value:'one'},purpose:'写一',risk:'reversible_write'},{id:'b',tool:'test.write',args:{value:'two'},purpose:'写二',risk:'reversible_write'}]});else if(call===2)yield JSON.stringify({steps:[]});else yield '完成'}}
    const runtime=new ChatRuntime(repo,provider as any,bus,1,undefined,registry,'confirm')
    const model={bindingId:'p:m',profileId:'p',provider:'mock',model:'m',capabilities:['text' as const],reasoning:'default' as const}
    const turn=runtime.submitTurn({conversationId:conversation.id,clientMessageId:'allow-run',text:'写两次',mode:'act',modelBinding:model,context:{permission:'confirm',conversationId:conversation.id,runId:'pending',refs:[],budget:{totalChars:100,usedChars:0,reservedForOutput:0},diagnostics:[],createdAt:new Date().toISOString()}})
    await runtime.idle()
    const first=repo.listRunEvents(turn.run.id).find(event=>event.type==='approval.required')
    assert.ok((first?.payload as {toolCallId?:string})?.toolCallId,'first write waits for approval')
    assert.equal(await runtime.approveTool({toolCallId:(first!.payload as {toolCallId:string}).toolCallId,approved:true,allowForRun:true}),true)
    await runtime.idle()
    assert.equal(repo.getRun(turn.run.id)?.status,'completed')
    const calls=repo.listToolCalls(turn.run.id)
    assert.equal(calls.length,2)
    assert.equal(calls.filter(item=>item.status==='awaiting_approval').length,0)
    const undone=undoToolCall(repo,calls[0].tool_call_id,workspace.id)
    assert.deepEqual(undone,{undone:['note：已恢复笔记原文'],skipped:[]})
    assert.equal(summarizeTaskTitle('请帮我调研主题：韧性电网的最新进展，并写一篇综述。'),'调研主题')
    assert.equal(summarizeTaskTitle('整理文献库并生成日报'),'整理文献库并生成日报')
    assert.equal(summarizeTaskTitle(''),'新任务')
    // Undo refuses running calls
    const running=repo.createToolCall({runId:turn.run.id,toolCallId:'call_running',tool:'test.write',args:{value:'x'},operationId:'op_running'})
    repo.updateToolCall(running.tool_call_id,'running')
    assert.throws(()=>undoToolCall(repo,running.tool_call_id,workspace.id),/仍在执行/)
  })
  await test('automation records run history, exposes next run time and updates intervals',async()=>{
    const { createSchedule, updateSchedule, nextRunAt, listScheduleRuns, removeSchedule }=await import('../../src/main/automation')
    const schedule=createSchedule('历史测试','每日任务',60)
    const updated=updateSchedule(schedule.id,{intervalMinutes:120})
    assert.ok(updated);assert.equal(updated.interval_minutes,120)
    assert.equal(nextRunAt({...schedule,enabled:1,last_run_at:null}).getTime()<=Date.now(),true)
    assert.equal(Number.isNaN(nextRunAt({...schedule,enabled:0}).getTime()),true)
    assert.deepEqual(listScheduleRuns(schedule.id),[])
    removeSchedule(schedule.id)
    const { saveUserSkill, readUserSkill, deleteUserSkill, listSkills }=await import('../../src/main/skills')
    const saved=saveUserSkill({name:'测试技能/临时',description:'回归用',body:'# 步骤\n1. 做事'})
    assert.equal(saved.name,'测试技能-临时');assert.equal(readUserSkill(saved.name)?.body,'# 步骤\n1. 做事')
    assert.ok(listSkills().some(skill=>skill.name===saved.name&&skill.source==='user'))
    assert.equal(deleteUserSkill(saved.name),true);assert.equal(readUserSkill(saved.name),null)
    const { upsertMcpServer, removeMcpServer, readMcpServers }=await import('../../src/main/mcp')
    upsertMcpServer('regression server',{command:'npx',args:['-y','x'],env:{A:'1'}})
    const servers=readMcpServers()
    assert.ok(servers.some(server=>server.name==='regression_server'&&server.def.env?.A==='1'))
    assert.equal(removeMcpServer('regression_server'),true)
    const { renameWithRetry }=await import('../../src/main/fs-retry')
    const dir=fs.mkdtempSync(path.join(root,'rename-retry-')),from=path.join(dir,'a.txt'),to=path.join(dir,'b.txt')
    fs.writeFileSync(from,'x');renameWithRetry(from,to);assert.equal(fs.existsSync(to),true)
    const { parseToolRequest }=await import('../../src/main/chat/runtime')
    assert.deepEqual(parseToolRequest('{"tool_calls":[{"tool":"web_search","args":{"query":"a"}}]}'),{tool:'web_search',args:{query:'a'}})
  })
  await test('free translation runs use the recorded run shape when no model is configured',async()=>{
    const repo=new ChatRepository(db),bus=new ChatEventBus(repo),workspace=repo.ensureWorkspace(path.join(root,'free-library')),conversation=repo.createConversation({workspaceId:workspace.id})
    const provider={async *stream(){throw new Error('provider must not be called')}}
    const runtime=new ChatRuntime(repo,provider as any,bus,1)
    runtime.freeTranslation=async text=>'译文：'+text
    const turn=runtime.submitTurn({conversationId:conversation.id,clientMessageId:'free-1',text:'hello',mode:'ask',modelBinding:{bindingId:'free:translation',profileId:'free',provider:'free',model:'free',capabilities:['text'],reasoning:'default'},context:{conversationId:conversation.id,runId:'pending',refs:[],promptKind:'translation',budget:{totalChars:100,usedChars:0,reservedForOutput:0},diagnostics:[],createdAt:new Date().toISOString()}})
    await runtime.idle()
    assert.equal(repo.getRun(turn.run.id)?.status,'completed')
    assert.ok(repo.getMessage(turn.assistantMessage.id)?.parts.some(part=>part.type==='text'&&part.text==='译文：hello'))
    assert.ok(repo.listRunEvents(turn.run.id).some(event=>event.type==='message.delta'))
  })
  await test('web reader extracts article markdown, metadata and tables; search normalizers dedupe',()=>{
    const html='<!doctype html><html lang="en"><head><title>Site | Noise</title><meta name="citation_title" content="A Study of Reading"><meta name="citation_author" content="Ada Lovelace"><meta name="citation_author" content="Alan Turing"><meta name="citation_doi" content="10.1000/abc"><meta name="citation_pdf_url" content="/pdf/abc.pdf"></head><body><nav>Menu Home About</nav><article><h1>A Study of Reading</h1><p>Readability should keep <b>this</b> paragraph because it is long enough to be treated as the main content of the page and it mentions <a href="/ref">references</a>.</p><table><tr><th>Method</th><th>Score</th></tr><tr><td>Ours</td><td>0.91</td></tr></table><p>Another paragraph with enough words to pass the readability threshold so the extraction keeps the full article body instead of falling back to the raw document.</p></article><footer>Footer noise</footer></body></html>'
    const page=htmlToMarkdown(html,'https://example.org/papers/study')
    assert.equal(page.title,'A Study of Reading');assert.equal(page.byline,'Ada Lovelace, Alan Turing');assert.equal(page.doi,'10.1000/abc');assert.equal(page.pdfUrl,'https://example.org/pdf/abc.pdf')
    assert.match(page.markdown,/# A Study of Reading/)
    assert.match(page.markdown,/\| Method \| Score \|/)
    assert.match(page.markdown,/https:\/\/example.org\/ref/)
    assert.doesNotMatch(page.markdown,/Footer noise/)
    assert.equal(normalizeUrl('https://www.example.org/a/?utm_source=x&b=1#top'),'https://example.org/a/?b=1')
    assert.equal(normalizeDoi('https://doi.org/10.1000/ABC.'),'10.1000/abc')
  })
}
