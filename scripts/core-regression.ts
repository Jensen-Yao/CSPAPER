import { app, ipcMain, nativeImage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import * as store from '../src/main/db'
import { registerPapersIpc } from '../src/main/ipc/papers'
import { getMyNotesText, saveMyNotesText } from '../src/main/insight'
import { clearActiveLibraryIndex, extractPages, hybridSearch } from '../src/main/ingest'
import { updatePaperMetadata, mergePapers, duplicatePapers } from '../src/main/paper-service'
import { normalizePath, notesFromMarkdown, paperFiles, parseFrontmatter, parseList, patchFrontmatter, writeFilesAtomically } from '../src/main/paper-files'
import { renameLibraryCategory } from '../src/main/library-files'
import { movePaperToCategory } from '../src/main/import'
import { collectLibrary } from '../src/main/library-inventory'
import { applyLibraryInventory } from '../src/main/library-store'
import { formatCite } from '../src/main/csl'
import { syncZotero, apiStatus } from '../src/main/zotero-api'
import { listTasks, getTask, removeTask, recoverInterruptedTasks } from '../src/main/agent'
import { modelSettings } from '../src/main/model-config'
import { collectionPapers, createCollection, listCollections, removeCollection, setPaperInCollection } from '../src/main/collection-service'
import { ChatRepository } from '../src/main/chat/repository'
import { ChatRuntime } from '../src/main/chat/runtime'
import { ChatEventBus } from '../src/main/chat/events'
import { extractPlanSteps, parseModelJsonObject, validatePlan } from '../src/main/chat/planning'
import { buildContextSnapshot } from '../src/main/chat/context'
import { explicitContextSources, retrieveSources } from '../src/main/chat/retrieval'
import { applyZoteroRepairs } from '../src/main/zotero-repair'
import { previewOaRepairs, applyOaRepairs, type OaRepairProgress } from '../src/main/oa-repair'
import type { ZoteroPaper } from '../src/main/zotero'
import { validateCitations, citationWarning } from '../src/main/chat/citations'
import { z } from 'zod'
import { ToolRegistry } from '../src/main/tools/registry'
import { ToolExecutor } from '../src/main/tools/executor'
import { registerLibraryTools } from '../src/main/tools/library'
import { registerMcpToolList } from '../src/main/tools/mcp'
import { appliedMigrations } from '../src/main/migrations'
import { createSchedule, removeSchedule, runHeadlessWithRuntime } from '../src/main/automation'
import { beginOperation, recoverOperations, runFileOperation } from '../src/main/operations/journal'
import { statsOverview } from '../src/main/stats'
import { testChatEvents } from '../tests/main/chat-events.test'
import { testChatRuntime } from '../tests/main/chat-runtime.test'
import { testConversationStore } from '../tests/renderer/conversation-store.test'
import { testToolExecutor } from '../tests/main/tool-executor.test'
import { testLibraryScan } from '../tests/main/library-scan.test'
import { testMigrations } from '../tests/main/migrations.test'
import { testModelBinding } from '../tests/main/model-binding.test'
import { testModelProvider } from '../tests/main/model-provider.test'

const root=fs.mkdtempSync(path.join(os.tmpdir(),'cspaper-regression-'))
const library=path.join(root,'library')
app.setPath('userData',path.join(root,'data'))
const handlers=new Map<string,Function>()
const handle=ipcMain.handle
ipcMain.handle=((name:string,fn:Function)=>{handlers.set(name,fn)}) as typeof ipcMain.handle
registerPapersIpc({getWin:()=>null,send:()=>{}})
ipcMain.handle=handle
const invoke=(name:string,...args:unknown[])=>handlers.get(name)!({},...args)
let failed=0,passed=0
async function test(name:string,fn:()=>unknown):Promise<void> {
  try {await fn();passed++;console.log('PASS '+name)} catch(error) {failed++;console.error('FAIL '+name+'\n'+String((error as Error).stack || error))}
}
function fixture(slug:string,cat='inbox',title=slug):{pdf:string;md:string;id:number} {
  const dir=path.join(library,'papers',cat,slug)
  fs.mkdirSync(dir,{recursive:true})
  const pdf=path.join(dir,'paper.pdf'),md=path.join(dir,slug+'.md')
  fs.writeFileSync(pdf,'%PDF-1.4\n% fixture '+slug)
  fs.writeFileSync(md,`---\ntitle: ${JSON.stringify(title)}\nauthors: "Original Author"\nyear: 2024\nvenue: "Test Journal"\ndoi: "10.0000/${slug}"\ntags: []\n---\n\n# ${title}\n\n## 我的笔记\n<!-- cspaper:notes:start -->\nNote ${slug}\n<!-- cspaper:notes:end -->\n`)
  store.scanLibrary(library)
  const id=(store.getDb().prepare('SELECT id FROM papers WHERE path=?').get(pdf) as {id:number}).id
  return {pdf,md,id}
}

app.whenReady().then(async()=>{
  store.initDb()
  store.saveSettings({libraryPath:library,setupDone:true,embedProvider:'ollama',ollamaUrl:'http://127.0.0.1:9'})
  const db=store.getDb(),one=fixture('one')
  await test('brand assets derive from one canonical source',()=>{
    const project=process.cwd()
    const source=fs.readFileSync(path.join(project,'build/icon-需要替换成ico.png'))
    assert.equal(fs.readFileSync(path.join(project,'build/icon.png')).equals(source),true)
    assert.equal(fs.readFileSync(path.join(project,'src/renderer/src/assets/brand-icon.png')).equals(source),true)
    assert.ok(fs.statSync(path.join(project,'build/icon.ico')).size>70000)
    assert.ok(fs.statSync(path.join(project,'build/icon.icns')).size>70000)
    for(const size of [16,48,128]) {
      assert.deepEqual(nativeImage.createFromBuffer(fs.readFileSync(path.join(project,'extension/icons',`icon${size}.png`))).getSize(),{width:size,height:size})
    }
    assert.equal(JSON.parse(fs.readFileSync(path.join(project,'package.json'),'utf8')).build.win.icon,'build/icon.ico')
  })

  await test('frontmatter preserves quoted values, body and CRLF',()=>{
    const raw='---\r\ntitle: "Old"\r\n---\r\n\r\n## Body\r\nkeep'
    const next=patchFrontmatter(raw,{title:'A "quoted" $1 title',volume:'42',tags:['a,b','x"y']})
    assert.equal(parseFrontmatter(next).title,'A "quoted" $1 title')
    assert.deepEqual(parseList(parseFrontmatter(next).tags),['a,b','x"y'])
    assert.ok(next.includes('## Body\nkeep'))
  })
  await test('multi-file write rolls back on commit failure',()=>{
    const file=path.join(root,'rollback.md');fs.writeFileSync(file,'before')
    assert.throws(()=>writeFilesAtomically([{path:file,content:'after'}],()=>{throw new Error('DB failure')}))
    assert.equal(fs.readFileSync(file,'utf8'),'before')
  })
  await test('metadata roundtrip writes all fields and clears DOI',()=>{
    updatePaperMetadata(one.id,{title:'New "title"',authors:'New Author',year:2026,venue:'New Journal',volume:'42',issue:'7',pages:'1-9',publisher:'Test Press',language:'zh',doi:''})
    store.scanLibrary(library)
    const row=db.prepare('SELECT * FROM papers WHERE id=?').get(one.id) as any
    const fm=parseFrontmatter(fs.readFileSync(one.md,'utf8'))
    assert.equal(row.title,'New "title"');assert.equal(row.doi,'');assert.equal(row.volume,'42')
    for(const key of ['volume','issue','pages','publisher','language']) assert.equal(fm[key],row[key])
  })
  await test('reading statuses persist and invalid values reject',()=>{
    for(const status of ['todo','unread','reading','read','paused']) {store.setStatus(one.id,status);assert.equal(parseFrontmatter(fs.readFileSync(one.md,'utf8')).status,status)}
    assert.throws(()=>store.setStatus(one.id,'invalid'))
  })
  await test('tag rename/delete survive file edits and rescan',()=>{
    const tag=store.addPaperTag(one.id,'Old Tag')
    store.renameTag(tag.id,'New, Tag')
    saveMyNotesText(one.id,'Changed note')
    store.scanLibrary(library)
    assert.deepEqual(store.paperTags(one.id).map(t=>t.name),['New, Tag'])
    store.deleteTag(tag.id);saveMyNotesText(one.id,'Another note');store.scanLibrary(library)
    assert.deepEqual(store.paperTags(one.id),[])
  })
  await test('flat PDFs route notes, metadata and tags to their own file',()=>{
    const flat=path.join(root,'flat');fs.mkdirSync(flat)
    for(const slug of ['alpha','beta']) {fs.writeFileSync(path.join(flat,slug+'.pdf'),'%PDF');fs.writeFileSync(path.join(flat,slug+'.md'),`---\ntitle: "${slug}"\n---\n## 我的笔记\n${slug} note\n`)}
    store.scanLibrary(flat)
    const beta=(db.prepare('SELECT id FROM papers WHERE path=?').get(path.join(flat,'beta.pdf')) as any).id
    assert.equal(getMyNotesText(beta),'beta note')
    saveMyNotesText(beta,'BETA ONLY');updatePaperMetadata(beta,{title:'Beta updated'});store.addPaperTag(beta,'Beta tag')
    assert.ok(!fs.readFileSync(path.join(flat,'alpha.md'),'utf8').includes('BETA ONLY'))
    assert.ok(fs.readFileSync(path.join(flat,'beta.md'),'utf8').includes('BETA ONLY'))
  })
  await test('legacy notes retain later sections during migration',()=>{
    const paper=fixture('legacy')
    fs.writeFileSync(paper.md,'---\ntitle: "Legacy"\n---\n## 我的笔记\nOld\n\n## 参考文献\nIMPORTANT TAIL\n')
    saveMyNotesText(paper.id,'## 方法\nNew')
    assert.equal(getMyNotesText(paper.id),'## 方法\nNew')
    assert.ok(fs.readFileSync(paper.md,'utf8').includes('## 参考文献\nIMPORTANT TAIL'))
  })
  await test('missing note file is created without touching siblings',()=>{
    const paper=fixture('new-note');fs.unlinkSync(paper.md)
    assert.equal(saveMyNotesText(paper.id,'Created note'),true)
    assert.equal(getMyNotesText(paper.id),'Created note')
  })
  await test('missing PDF preserves identity and highlights',()=>{
    const paper=fixture('temporarily-offline')
    db.prepare('INSERT INTO highlights(paper_id,page,rects,text) VALUES(?,1,?,?)').run(paper.id,'[]','Keep highlight')
    fs.renameSync(paper.pdf,paper.pdf+'.offline');store.scanLibrary(library)
    assert.ok(!store.listPapers().some(p=>p.id===paper.id))
    assert.equal((db.prepare('SELECT COUNT(*) n FROM highlights WHERE paper_id=?').get(paper.id) as any).n,1)
    fs.renameSync(paper.pdf+'.offline',paper.pdf);store.scanLibrary(library)
    assert.ok(store.listPapers().some(p=>p.id===paper.id))
  })
  await test('purge with retained files does not resurrect on rescan',async()=>{
    const paper=fixture('purged');await invoke('papers:trash',paper.id);await invoke('papers:purge',paper.id);store.scanLibrary(library)
    assert.equal(db.prepare('SELECT id FROM papers WHERE path=?').get(paper.pdf),undefined)
    assert.ok(fs.existsSync(paper.pdf))
  })
  await test('merge preserves notes, union tags, related links and PDF attachment',()=>{
    const keep=fixture('keep'),drop=fixture('drop'),other=fixture('related')
    store.addPaperTag(keep.id,'KeepTag');store.addPaperTag(drop.id,'DropTag')
    db.prepare("INSERT INTO paper_related(paper_id,related_id,kind) VALUES(?,?,'manual')").run(keep.id,other.id)
    db.prepare("INSERT INTO paper_related(paper_id,related_id,kind) VALUES(?,?,'manual')").run(drop.id,other.id)
    mergePapers(keep.id,[drop.id,keep.id,drop.id]);store.scanLibrary(library)
    assert.deepEqual(store.paperTags(keep.id).map(t=>t.name),['DropTag','KeepTag'])
    assert.ok(getMyNotesText(keep.id).includes('Note drop'))
    assert.equal(db.prepare('SELECT id FROM papers WHERE path=?').get(drop.pdf),undefined)
    assert.ok(db.prepare('SELECT path FROM paper_attachments WHERE paper_id=? AND path=?').get(keep.id,drop.pdf))
  })
  await test('category rename retains exact document identities',()=>{
    const a=fixture('rename-a','old'),b=fixture('rename-b','old')
    renameLibraryCategory('old','new');store.scanLibrary(library)
    for(const paper of [a,b]) {
      const row=db.prepare('SELECT path,category FROM papers WHERE id=?').get(paper.id) as any
      assert.equal(row.category,'new');assert.equal(path.basename(path.dirname(row.path)),path.basename(path.dirname(paper.pdf)));assert.ok(fs.existsSync(row.path))
    }
  })
  await test('moving flat PDF never moves its whole parent library',()=>{
    const flat=path.join(root,'flat'),pdf=path.join(flat,'beta.pdf')
    const row=db.prepare('SELECT id FROM papers WHERE path=?').get(pdf) as any
    store.saveSettings({libraryPath:flat})
    movePaperToCategory(row.id,'Moved',path.join(flat,'papers'))
    assert.ok(fs.existsSync(path.join(flat,'alpha.pdf')))
    assert.ok(fs.existsSync(flat))
    store.scanLibrary(flat)
    assert.equal(store.listPapers().length,2)
    store.saveSettings({libraryPath:library})
  })
  await test('switching library hides other documents without deleting state',()=>{
    const other=path.join(root,'other');fs.mkdirSync(other);fs.writeFileSync(path.join(other,'new.pdf'),'%PDF')
    store.saveSettings({libraryPath:other});store.scanLibrary(other)
    assert.equal(store.listPapers().length,1)
    store.saveSettings({libraryPath:library});assert.ok(store.listPapers().some(p=>p.id===one.id))
  })
  await test('citation uses edited canonical metadata and volume/pages',async()=>{
    const out=await formatCite([one.id],'apa');assert.equal(out.ok,true)
    assert.ok(out.items?.[0].includes('New "title"'));assert.ok(out.items?.[0].includes('2026'));assert.ok(out.items?.[0].includes('42'))
  })
  await test('duplicate detector matches mixed DOI coverage',()=>{
    const a=fixture('dup-a','inbox','Same title'),b=fixture('dup-b','inbox','Same title')
    updatePaperMetadata(b.id,{doi:''})
    assert.ok(duplicatePapers().some(group=>group.some(p=>p.id===a.id)&&group.some(p=>p.id===b.id)))
  })
  await test('last location can move backwards independently of progress',()=>{
    store.setLastPage(one.id,15);store.setLastPage(one.id,3)
    const row=db.prepare('SELECT last_page,furthest_page FROM papers WHERE id=?').get(one.id) as any
    assert.equal(row.last_page,3);assert.equal(row.furthest_page,15)
  })
  await test('trash is excluded from statistics',async()=>{
    const before=statsOverview().totalPapers
    await invoke('papers:trash',one.id)
    assert.equal(statsOverview().totalPapers,before-1)
    await invoke('papers:restore',one.id)
  })
  await test('task listing is read-only; recovery is explicit',()=>{
    listTasks();db.prepare("INSERT INTO agent_tasks(id,goal,status) VALUES('running-test','Goal','running')").run()
    listTasks();assert.equal(getTask('running-test')?.status,'running')
    recoverInterruptedTasks();assert.equal(getTask('running-test')?.status,'error')
  })
  await test('agent model chooses its configured provider credentials',()=>{
    const resolved=modelSettings({...store.getSettings(),profiles:[{provider:'custom',apiBase:'http://example.invalid/v1',apiKey:'test-only',models:['agent-model']}]},'agent-model')
    assert.equal(resolved.apiBase,'http://example.invalid/v1');assert.equal(resolved.apiKey,'test-only')
  })
  await test('stale worker snapshot cannot overwrite a committed edit',()=>{
    store.scanLibrary(library)
    const previous=Object.fromEntries((db.prepare('SELECT path,source_stamp FROM papers WHERE library_root=?').all(normalizePath(library)) as any[]).map(p=>[normalizePath(p.path),p.source_stamp||'']))
    fs.appendFileSync(one.md,'\nworker snapshot\n')
    const inventory=collectLibrary(library,previous)
    updatePaperMetadata(one.id,{title:'Latest user edit'})
    applyLibraryInventory(db,inventory)
    assert.equal((db.prepare('SELECT title FROM papers WHERE id=?').get(one.id) as any).title,'Latest user edit')
  })
  await test('rebuilding the active library leaves other workspace indexes intact',()=>{
    const otherLibrary=path.join(root,'other-index-library'),otherDir=path.join(otherLibrary,'papers','inbox','other-indexed')
    fs.mkdirSync(otherDir,{recursive:true})
    fs.writeFileSync(path.join(otherDir,'paper.pdf'),'%PDF-1.4 other workspace')
    fs.writeFileSync(path.join(otherDir,'other-indexed.md'),'---\ntitle: "Other Indexed"\nauthors: "A"\nyear: 2026\nvenue: "V"\ntags: []\n---\n\n# Other Indexed\n')
    store.saveSettings({libraryPath:otherLibrary});store.scanLibrary(otherLibrary)
    const other=(db.prepare('SELECT id FROM active_papers WHERE slug=?').get('other-indexed') as {id:number})
    const otherChunkId=Number((db.prepare("INSERT INTO chunks(paper_id,page,ord,text,vec) VALUES(?,1,0,'other workspace chunk',x'00000000')").run(other.id) as {lastInsertRowid:number}).lastInsertRowid)
    db.prepare("INSERT INTO chunks_fts(rowid,text,paper_id,page) VALUES(?,?,?,1)").run(otherChunkId,'other workspace chunk',other.id)
    db.prepare('INSERT OR REPLACE INTO papers_fts(rowid,title,authors,venue,slug) VALUES(?,?,?,?,?)').run(other.id,'Other Indexed','A','V','other-indexed')
    db.prepare("UPDATE papers SET indexed=1,pvec=x'00000000' WHERE id=?").run(other.id)
    store.saveSettings({libraryPath:library})
    clearActiveLibraryIndex(db)
    const row=db.prepare('SELECT indexed,pvec IS NOT NULL AS has_pvec FROM papers WHERE id=?').get(other.id) as {indexed:number;has_pvec:number}
    assert.equal(row.indexed,1)
    assert.equal(row.has_pvec,1)
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM chunks WHERE paper_id=?').get(other.id) as {n:number}).n,1)
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM chunks_fts WHERE paper_id=?').get(other.id) as {n:number}).n,1)
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM papers_fts WHERE rowid=?').get(other.id) as {n:number}).n,1)
  })
  await test('Zotero updates exact paths and retains local notes',async()=>{
    const paper=fixture('2026-abcde123','99-inbox')
    fs.writeFileSync(paper.md,patchFrontmatter(fs.readFileSync(paper.md,'utf8'),{'zotero-version':1}))
    store.saveSettings({zoteroUserId:'test-user',zoteroApiKey:'test-key'})
    const original=globalThis.fetch
    globalThis.fetch=(async(input:any)=>{
      const url=new URL(String(input));assert.equal(url.hostname,'api.zotero.org')
      const payload=url.pathname.endsWith('/collections')||url.pathname.endsWith('/children')?[]:[{key:'ABCDE123',version:2,data:{itemType:'journalArticle',title:'Remote v2',date:'2026',creators:[],collections:[]}}]
      return new Response(JSON.stringify(payload),{headers:{'Content-Type':'application/json','Last-Modified-Version':'2'}})
    }) as typeof fetch
    try {
      const result=await syncZotero({mode:'incremental',downloadPdf:false})
      assert.equal(result.ok,true);assert.equal(result.updated,1)
      assert.ok(fs.readFileSync(paper.md,'utf8').includes('Remote v2'))
      assert.equal(getMyNotesText(paper.id),'Note 2026-abcde123')
      assert.equal(apiStatus().lastSyncVersion,2)
    } finally {globalThis.fetch=original}
  })
  await test('library inventory reports progress and honors cancellation',async()=>{
    const progress:Array<{found:number;current:string}>=[]
    const inventory=collectLibrary(library,{}, {onProgress:(found,current)=>progress.push({found,current})})
    assert.equal(inventory.complete,true)
    assert.equal(inventory.cancelled,undefined)
    assert.ok(progress.length>=1&&progress.at(-1)!.found===inventory.entries.length)
    const cancel=new Int32Array(new SharedArrayBuffer(4));Atomics.store(cancel,0,1)
    const cancelledInventory=collectLibrary(library,{},{cancel})
    assert.equal(cancelledInventory.complete,false)
    assert.equal(cancelledInventory.cancelled,true)
    assert.equal(cancelledInventory.entries.length,0)
    const uniqueScanRoot=path.join(root,'unique-cancel-library');fs.mkdirSync(uniqueScanRoot,{recursive:true})
    const controller=new AbortController();controller.abort()
    await assert.rejects(async()=>store.scanLibraryAsync(uniqueScanRoot,{signal:controller.signal}),/abort/i)
  })
  await test('async library worker yields while scanning',async()=>{
    let responsive=false
    const scan=store.scanLibraryAsync(library)
    await new Promise<void>(r=>setTimeout(()=>{responsive=true;r()},0))
    await scan;assert.equal(responsive,true)
  })
  await test('tracked migrations apply exactly once across repeated initialization',()=>{
    assert.deepEqual(appliedMigrations(db).map(m=>m.version),[1,2,3,4,5,6,7,8])
    store.initDb()
    assert.deepEqual(appliedMigrations(db).map(m=>m.version),[1,2,3,4,5,6,7,8])
    for(const table of ['workspaces','conversations','chat_messages','chat_runs','chat_run_events','chat_tool_calls','chat_sources','chat_artifacts','operation_journal'])
      assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table),table)
  })
  await test('persistent conversations isolate workspaces and survive repository reload',()=>{
    const repo=new ChatRepository(db),workspace=repo.ensureWorkspace(library,'Regression Library')
    const other=repo.ensureWorkspace(path.join(root,'other-library'),'Other Library')
    const conversation=repo.createConversation({workspaceId:workspace.id,title:'睡眠研究',mode:'act',entry:'reader'})
    const modelBinding={bindingId:'binding-main',profileId:'profile-main',provider:'agnes',model:'agnes-3.0-flash',capabilities:['text','streaming','tool_calling'],reasoning:'default' as const}
    const context={conversationId:conversation.id,runId:'pending',refs:[{kind:'paper',workspaceId:workspace.id,paperId:one.id}],budget:{totalChars:1000,usedChars:100,reservedForOutput:300},diagnostics:[],createdAt:new Date().toISOString()}
    const turn=repo.createTurn({conversationId:conversation.id,clientMessageId:'client-turn-1',text:'比较这三篇论文',context,modelBinding,mode:'act'})
    assert.equal(turn.reused,false)
    const duplicate=repo.createTurn({conversationId:conversation.id,clientMessageId:'client-turn-1',text:'比较这三篇论文',context,modelBinding,mode:'act'})
    assert.equal(duplicate.reused,true);assert.equal(duplicate.run.id,turn.run.id)
    repo.updateRunStatus(turn.run.id,'generating')
    const first=repo.appendRunEvent(turn.run.id,'message.delta',{text:'第一'})
    const second=repo.appendRunEvent(turn.run.id,'message.delta',{text:'第二'})
    assert.deepEqual([first.seq,second.seq],[1,2])
    repo.appendMessageText(turn.assistantMessage.id,'第一第二')
    assert.deepEqual(repo.getMessage(turn.assistantMessage.id)?.parts,[{type:'text',text:'第一第二'}])
    const branched=repo.createTurn({conversationId:conversation.id,clientMessageId:'client-turn-2',parentMessageId:turn.assistantMessage.id,text:'继续追问',context,modelBinding})
    assert.equal(repo.getConversation(conversation.id)?.activeLeafMessageId,branched.assistantMessage.id)
    const otherConversation=repo.createConversation({workspaceId:other.id,title:'其他工作区'})
    assert.deepEqual(repo.listConversations({workspaceId:workspace.id}).items.map(c=>c.id),[conversation.id])
    assert.deepEqual(repo.listConversations({workspaceId:other.id}).items.map(c=>c.id),[otherConversation.id])
    const reloaded=new ChatRepository(db)
    assert.equal(reloaded.loadMessages({conversationId:conversation.id}).items.length,4)
    assert.equal(reloaded.listRunEvents(turn.run.id).length,2)
    assert.equal(reloaded.listConversationEvents(conversation.id,1).length,1)
  })
  await test('conversation pagination, archiving and tool calls persist',async()=>{
    const repo=new ChatRepository(db),workspace=repo.ensureWorkspace(path.join(root,'pagination-library'))
    const ids:string[]=[]
    for(let i=0;i<3;i++){ids.push(repo.createConversation({workspaceId:workspace.id,title:'会话 '+i}).id);await new Promise(resolve=>setTimeout(resolve,3))}
    const page=repo.listConversations({workspaceId:workspace.id,limit:2})
    assert.equal(page.items.length,2);assert.equal(page.nextCursor,ids[1])
    const nextPage=repo.listConversations({workspaceId:workspace.id,limit:2,cursor:page.nextCursor})
    assert.deepEqual(nextPage.items.map(c=>c.id),[ids[0]])
    const archived=repo.archiveConversation(ids[0],true)
    assert.ok(archived?.archivedAt);assert.ok(!repo.listConversations({workspaceId:workspace.id}).items.some(c=>c.id===ids[0]))
    assert.ok(repo.listConversations({workspaceId:workspace.id,includeArchived:true}).items.some(c=>c.id===ids[0]))
    const conversation=repo.getConversation(ids[2])!
    const modelBinding={bindingId:'b',profileId:'p',provider:'custom',model:'m',capabilities:['text'],reasoning:'default' as const}
    const context={conversationId:conversation.id,runId:'pending',refs:[],budget:{totalChars:1,usedChars:0,reservedForOutput:0},diagnostics:[],createdAt:new Date().toISOString()}
    const turn=repo.createTurn({conversationId:conversation.id,clientMessageId:'tool-turn',text:'保存笔记',context,modelBinding})
    const call=repo.createToolCall({runId:turn.run.id,toolCallId:'call-1',tool:'note.save',args:{paperId:one.id,text:'ok'},operationId:'op-1'})
    assert.equal(call.status,'pending')
    const completed=repo.updateToolCall('call-1','success',{summary:'已保存',changes:[{entity:'note',entityId:String(one.id),action:'update',reversible:true}]})
    assert.equal(completed?.status,'success')
    assert.throws(()=>repo.createToolCall({runId:turn.run.id,toolCallId:'call-2',tool:'note.save',args:{},operationId:'op-1'}))
    db.prepare("INSERT INTO agent_tasks(id,goal,status,plan,events,answer,created_at,conversation_id,run_id) VALUES('legacy-linked','旧任务','done','[]','[]','完成',datetime('now'),?,?)").run(conversation.id,turn.run.id)
    assert.equal(turn.run.status,'queued')
    assert.throws(()=>repo.deleteConversation(conversation.id),/请先停止/)
    repo.updateRunStatus(turn.run.id,'completed')
    assert.equal(repo.deleteConversation(conversation.id),true)
    assert.equal(repo.getConversation(conversation.id),null)
    assert.equal(repo.getMessage(turn.userMessage.id),null)
    assert.equal(repo.getRun(turn.run.id),null)
    assert.equal(repo.getToolCall('call-1'),null)
    assert.equal(db.prepare('SELECT COUNT(*) n FROM chat_run_events WHERE conversation_id=?').get(conversation.id).n,0)
    assert.equal(db.prepare('SELECT COUNT(*) n FROM agent_tasks WHERE conversation_id=?').get(conversation.id).n,0)
    db.prepare("INSERT INTO agent_tasks(id,goal,status,plan,events,answer,created_at) VALUES('legacy-standalone','独立旧任务','running','[]','[]','',datetime('now'))").run()
    assert.throws(()=>removeTask('legacy-standalone'),/请先停止/)
    db.prepare("UPDATE agent_tasks SET status='done' WHERE id='legacy-standalone'").run()
    assert.equal(removeTask('legacy-standalone'),true)
  })
  await test('chat runtime persists streams, isolates concurrent runs and is idempotent',async()=>{
    const repo=new ChatRepository(db),bus=new ChatEventBus(repo)
    const controlled=new Promise<void>(resolve=>setTimeout(resolve,30))
    const provider={async *stream(_messages:any,options:any){await controlled;if(options.signal.aborted)throw new Error('cancelled');yield '来自运行 A'} }
    const runtime=new ChatRuntime(repo,provider as any,bus,2)
    const workspace=repo.ensureWorkspace(path.join(root,'runtime-library'))
    const model={bindingId:'b',profileId:'p',provider:'mock',model:'mock-model',capabilities:['text','streaming'],reasoning:'default' as const}
    const make=(conversationId:string,clientMessageId:string)=>({conversationId,clientMessageId,text:'请回答',context:{conversationId,runId:'pending',refs:[],budget:{totalChars:1,usedChars:0,reservedForOutput:0},diagnostics:[],createdAt:new Date().toISOString()},modelBinding:model})
    const a=repo.createConversation({workspaceId:workspace.id,title:'A'})
    const b=repo.createConversation({workspaceId:workspace.id,title:'B'})
    const seenA:string[]=[],seenB:string[]=[]
    bus.subscribe({conversationId:a.id,listener:event=>seenA.push(event.type)})
    bus.subscribe({conversationId:b.id,listener:event=>seenB.push(event.type)})
    runtime.submitTurn(make(a.id,'runtime-a'))
    runtime.submitTurn(make(b.id,'runtime-b'))
    await runtime.idle()
    assert.ok(repo.loadMessages({conversationId:a.id}).items[1].parts[0].text.includes('运行 A'))
    assert.ok(repo.loadMessages({conversationId:b.id}).items[1].parts[0].text.includes('运行 A'))
    assert.ok(seenA.includes('message.delta'));assert.ok(seenB.includes('message.delta'))
    const again=runtime.submitTurn(make(a.id,'runtime-a'))
    assert.equal(again.reused,true);await runtime.idle()
    assert.equal(repo.listRuns(a.id).length,1)
  })
  await test('act runtime validates a model plan and executes audited tools',async()=>{
    const repo=new ChatRepository(db),bus=new ChatEventBus(repo),workspace=repo.ensureWorkspace(path.join(root,'act-library'))
    const registry=new ToolRegistry().register({
      definition:{name:'test.read',version:1,title:'读取',description:'测试读取',risk:'read',defaultPermission:'auto',inputSchema:{type:'object'},canCancel:true},
      schema:z.object({query:z.string()}),
      execute:async()=>({status:'success',data:{query:'ok'},summary:'已读取测试数据',sources:[],artifacts:[],changes:[],durationMs:1})
    })
    let call=0
    const provider={async *stream(messages:any){call++;yield call===1?JSON.stringify({steps:[{id:'s1',tool:'test.read',args:{query:'睡眠'},purpose:'读取',risk:'read'}]}):'工具已执行，最终报告完成。'}}
    const runtime=new ChatRuntime(repo,provider as any,bus,1,undefined,registry)
    const conversation=repo.createConversation({workspaceId:workspace.id,mode:'act',entry:'work'})
    const model={bindingId:'act-binding',profileId:'profile-main',provider:'mock',model:'mock-model',capabilities:['text','streaming','tool_calling'],reasoning:'default' as const}
    const turn=runtime.submitTurn({conversationId:conversation.id,clientMessageId:'act-run',text:'读取测试数据',context:{conversationId:conversation.id,runId:'pending',refs:[],budget:{totalChars:1,usedChars:0,reservedForOutput:0},diagnostics:[],createdAt:new Date().toISOString()},modelBinding:model,mode:'act'})
    await runtime.idle()
    assert.equal(repo.getRun(turn.run.id)?.status,'completed')
    assert.ok(repo.listRunEvents(turn.run.id).some(event=>event.type==='plan.created'))
    assert.equal(repo.getToolCall(repo.listRunEvents(turn.run.id).find(event=>event.type==='tool.completed')?.payload?undefined:undefined)?.status,undefined)
    const completedEvent=repo.listRunEvents(turn.run.id).find(event=>event.type==='tool.completed')
    const toolCallId=(completedEvent?.payload as {toolCallId?:string})?.toolCallId
    assert.equal(repo.getToolCall(toolCallId??'')?.status,'success')
    const assistant=repo.getMessage(turn.assistantMessage.id)!
    assert.ok(assistant.parts.some(part=>part.type==='text'&&part.text.includes('最终报告')))
  })
  await test('act runtime pauses risky tools until explicit approval',async()=>{
    const repo=new ChatRepository(db),bus=new ChatEventBus(repo),workspace=repo.ensureWorkspace(path.join(root,'approval-library'))
    let executed=false
    const registry=new ToolRegistry().register({definition:{name:'test.write',version:1,title:'写入',description:'测试写入',risk:'reversible_write',defaultPermission:'approval_required',inputSchema:{type:'object'},canCancel:true},schema:z.object({text:z.string()}),execute:async()=>{executed=true;return {status:'success',summary:'已写入',sources:[],artifacts:[],changes:[],durationMs:1}}})
    let call=0
    const provider={async *stream(){call++;yield call===1?JSON.stringify({steps:[{id:'s',tool:'test.write',args:{text:'审批后写入'},purpose:'写入',risk:'reversible_write'}]}):'审批后执行完成。'}}
    const runtime=new ChatRuntime(repo,provider as any,bus,1,undefined,registry,'confirm')
    const conversation=repo.createConversation({workspaceId:workspace.id,mode:'act'})
    const model={bindingId:'approval',profileId:'p',provider:'mock',model:'m',capabilities:['text','streaming','tool_calling'],reasoning:'default' as const}
    const turn=runtime.submitTurn({conversationId:conversation.id,clientMessageId:'approval-run',text:'需要写入',context:{permission:'confirm',conversationId:conversation.id,runId:'pending',refs:[],budget:{totalChars:1,usedChars:0,reservedForOutput:0},diagnostics:[],createdAt:new Date().toISOString()},modelBinding:model,mode:'act'})
    await runtime.idle()
    assert.equal(executed,false);assert.equal(repo.getRun(turn.run.id)?.status,'awaiting_approval')
    const approval=repo.listRunEvents(turn.run.id).find(event=>event.type==='approval.required')
    const toolCallId=(approval?.payload as {toolCallId?:string})?.toolCallId
    assert.ok(toolCallId)
    assert.equal(await runtime.approveTool({toolCallId,approved:true}),true)
    await runtime.idle()
    assert.equal(executed,true);assert.equal(repo.getRun(turn.run.id)?.status,'completed')
  })
  await test('chat runtime cancels queued runs without cancelling active peers',async()=>{
    const repo=new ChatRepository(db),bus=new ChatEventBus(repo)
    const provider={async *stream(_messages:any,options:any){
      await new Promise<void>((resolve,reject)=>{const timer=setTimeout(resolve,40);options.signal.addEventListener('abort',()=>{clearTimeout(timer);reject(new Error('cancelled'))},{once:true})})
      yield '完成'
    }}
    const runtime=new ChatRuntime(repo,provider as any,bus,1)
    const workspace=repo.ensureWorkspace(path.join(root,'cancel-library'))
    const model={bindingId:'b',profileId:'p',provider:'mock',model:'m',capabilities:['text'],reasoning:'default' as const}
    const make=(id:string)=>({conversationId:id,clientMessageId:id+'-client',text:'执行',context:{conversationId:id,runId:'pending',refs:[],budget:{totalChars:1,usedChars:0,reservedForOutput:0},diagnostics:[],createdAt:new Date().toISOString()},modelBinding:model})
    const first=repo.createConversation({workspaceId:workspace.id,title:'active'})
    const queued=repo.createConversation({workspaceId:workspace.id,title:'queued'})
    runtime.submitTurn(make(first.id))
    runtime.submitTurn(make(queued.id))
    const queuedRun=repo.listRuns(queued.id)[0]
    assert.equal(runtime.cancelRun(queuedRun.id),true)
    await runtime.idle()
    assert.equal(repo.getRun(repo.listRuns(first.id)[0].id)?.status,'completed')
    assert.equal(repo.getRun(queuedRun.id)?.status,'cancelled')
  })
  await test('interrupted chat runs recover once into a distinct terminal state',()=>{
    const repo=new ChatRepository(db)
    const workspace=repo.ensureWorkspace(path.join(root,'recover-library'))
    const conversation=repo.createConversation({workspaceId:workspace.id})
    const model={bindingId:'b',profileId:'p',provider:'mock',model:'m',capabilities:['text'],reasoning:'default' as const}
    const turn=repo.createTurn({conversationId:conversation.id,clientMessageId:'recover-run',text:'执行',context:{conversationId:conversation.id,runId:'pending',refs:[],budget:{totalChars:1,usedChars:0,reservedForOutput:0},diagnostics:[],createdAt:new Date().toISOString()},modelBinding:model})
    repo.updateRunStatus(turn.run.id,'generating')
    const runtime=new ChatRuntime(repo,{async *stream(){yield 'unused'}} as any,new ChatEventBus(repo))
    const recovered=runtime.recover();assert.ok(recovered>=1);assert.equal(runtime.recover(),0)
    assert.equal(repo.getRun(turn.run.id)?.status,'interrupted')
    assert.equal(repo.getMessage(turn.assistantMessage.id)?.status,'failed')
  })
  await test('model plan parser accepts strict and provider-wrapped JSON',()=>{
    const strict=parseModelJsonObject('{"steps":[{"id":"one","tool":"paper.read","args":{},"purpose":"读取","risk":"read"}]}')
    const wrapped=parseModelJsonObject('模型计划：```json\n{\"plan\":{\"steps\":[{\"id\":\"one\",\"tool\":\"paper.read\",\"args\":{},\"purpose\":\"读取\",\"risk\":\"read\"}]}}\n```')
    assert.equal(extractPlanSteps(strict)?.length,1)
    assert.equal(extractPlanSteps(wrapped)?.length,1)
    assert.equal((parseModelJsonObject('前缀 {"ok":true} 后缀') as {ok:boolean}).ok,true)
  })
  await test('plan validation rejects unknown tools, wrong risk and call limits',()=>{
    const tools=[{name:'paper.read',version:1,risk:'read' as const,maxCallsPerRun:2},{name:'paper.delete',version:1,risk:'destructive' as const}]
    assert.equal(validatePlan([{id:'1',tool:'paper.read',args:{},purpose:'读取',risk:'read'}],tools).ok,true)
    const invalid=validatePlan([{id:'1',tool:'unknown',args:{},purpose:'未知',risk:'read'},{id:'2',tool:'paper.delete',args:{},purpose:'删除',risk:'read'}],tools)
    assert.equal(invalid.ok,false)
  })
  await test('context snapshots enforce workspace objects and budget diagnostics',()=>{
    const repo=new ChatRepository(db),workspace=repo.ensureWorkspace(library)
    const otherWorkspace=repo.ensureWorkspace(path.join(root,'context-other'))
    const snapshot=buildContextSnapshot({conversationId:'pending',runId:'pending',workspaceId:workspace.id,refs:[
      {kind:'paper',workspaceId:workspace.id,paperId:one.id},
      {kind:'paper',workspaceId:otherWorkspace.id,paperId:one.id},
      {kind:'selection',workspaceId:workspace.id,paperId:one.id,page:1,text:'选中内容',documentVersion:'v1'}
    ],totalChars:100,reservedForOutput:20})
    assert.equal(snapshot.refs.length,2)
    assert.ok(snapshot.diagnostics.some(item=>item.code==='workspace_mismatch'))
    assert.ok(snapshot.diagnostics.some(item=>item.code==='context_truncated'))
  })
  await test('collection service validates and persists shared memberships',()=>{
    const before=listCollections().length
    const collection=createCollection('统一集合服务测试')
    assert.equal(collection.name,'统一集合服务测试');assert.equal(listCollections().length,before+1)
    setPaperInCollection(collection.id,one.id,true)
    assert.deepEqual(collectionPapers(collection.id),[one.id])
    setPaperInCollection(collection.id,one.id,false)
    assert.deepEqual(collectionPapers(collection.id),[])
    removeCollection(collection.id)
    assert.equal(listCollections().length,before)
    assert.throws(()=>setPaperInCollection(collection.id,one.id,true),/集合/)
    assert.throws(()=>createCollection(' '.repeat(101)),/集合名称/)
  })
  await test('record-only papers expose source state and citable metadata fallback',async()=>{
    const slug='record-only',dir=path.join(library,'papers','inbox',slug)
    fs.mkdirSync(dir,{recursive:true})
    const pdfPath=path.join(dir,'paper.pdf')
    fs.writeFileSync(pdfPath,Buffer.from('%PDF-1.4 record fixture'))
    fs.writeFileSync(path.join(dir,slug+'.md'),`---\ntitle: "Record-only paper"\nauthors: "Record Author"\nyear: 2026\nvenue: "Record Journal"\ndoi: "10.0000/record-only"\nabstract: "A bibliographic abstract explains the record without inventing full-text conclusions."\nsource_kind: record\n---\n\n# Record-only paper\n`)
    store.scanLibrary(library)
    const listed=store.listPapers().find(item=>item.slug===slug)
    assert.equal(listed?.source_kind,'record')
    assert.equal(listed?.chunk_count,0)
    const repo=new ChatRepository(db),workspace=repo.ensureWorkspace(library)
    const sources=await retrieveSources({query:'这篇论文说了什么',workspaceId:workspace.id,runId:'run-record',refs:[{kind:'paper',workspaceId:workspace.id,paperId:listed!.id}]})
    const recordSource=sources.find(source=>source.paperId===listed!.id&&source.kind==='paper_page')
    assert.ok(recordSource)
    assert.match(recordSource.title,/题录/)
    assert.match(recordSource.snippet,/bibliographic abstract/)
    assert.equal(recordSource.locator.anchor,'record')
    assert.ok(appliedMigrations(db).some(migration=>migration.version===8))
  })
  await test('Zotero repair uses exact keys, backups and idempotent operations',()=>{
    const repair=fixture('repair-one')
    const source=path.join(root,'zotero-repair-source.pdf')
    fs.writeFileSync(source,Buffer.from('%PDF-1.4 repaired full text\n'))
    fs.writeFileSync(repair.md,fs.readFileSync(repair.md,'utf8').replace('tags: []','zotero: REPAIRKEY\nsource_kind: record\ntags: []'))
    store.scanLibrary(library)
    const listed=store.listPapers().find(item=>item.slug==='repair-one')
    db.prepare("UPDATE papers SET source_kind='record' WHERE id=?").run(listed!.id)
    assert.equal((db.prepare('SELECT source_kind FROM active_papers WHERE id=?').get(listed!.id) as {source_kind:string}).source_kind,'record')
    const zoteroItem:ZoteroPaper={key:'REPAIRKEY',itemType:'journalArticle',title:'Repair One',authors:'A',year:2026,venue:'V',collections:[],abstract:'',tags:[],notes:[],pdf:source}
    const first=applyZoteroRepairs({dataDir:path.join(root,'zotero'),items:[zoteroItem]})
    assert.equal(first.repaired,1)
    assert.equal(fs.readFileSync(repair.pdf).toString('utf8'),'%PDF-1.4 repaired full text\n')
    assert.equal((db.prepare('SELECT source_kind FROM active_papers WHERE id=?').get(listed!.id) as {source_kind:string}).source_kind,'pdf')
    assert.equal(parseFrontmatter(fs.readFileSync(repair.md,'utf8')).source_kind,'pdf')
    const operation=db.prepare('SELECT * FROM operation_journal WHERE kind=?').get('zotero.repair_pdf') as {state:string;backup_dir:string}
    assert.equal(operation.state,'committed')
    assert.ok(fs.existsSync(path.join(operation.backup_dir,'before-0.tmp')))
    assert.equal(parseFrontmatter(fs.readFileSync(repair.md,'utf8')).zotero,'REPAIRKEY')
    db.prepare("UPDATE papers SET source_kind='record' WHERE id=?").run(listed!.id)
    const second=applyZoteroRepairs({dataDir:path.join(root,'zotero'),items:[zoteroItem]})
    assert.equal(second.repaired,0)
    assert.equal(second.outcomes.find(item=>item.paperId===listed!.id)?.reason,'该原文版本已修复过，操作日志幂等拦截重复替换')
    store.scanLibrary(library)
    assert.equal(store.listPapers().find(item=>item.slug==='repair-one')?.source_kind,'pdf')
  })
  await test('OpenAccess repair safely discovers, validates and replaces record PDFs',async()=>{
    const makeRecord=(slug:string,doi:string)=>{
      const dir=path.join(library,'papers','inbox',slug)
      fs.mkdirSync(dir,{recursive:true})
      const pdf=path.join(dir,'paper.pdf'),md=path.join(dir,slug+'.md')
      fs.writeFileSync(pdf,Buffer.from('%PDF-1.4 generated record '+slug))
      fs.writeFileSync(md,`---\ntitle: "OA ${slug}"\nauthors: "OA Author"\nyear: 2026\nvenue: "OA Journal"\ndoi: "${doi}"\nsource_kind: record\n---\n\n# OA ${slug}\n`)
      store.scanLibrary(library)
      return {pdf,md,id:(store.getDb().prepare('SELECT id FROM papers WHERE path=?').get(pdf) as {id:number}).id}
    }
    const good=makeRecord('oa-good','10.0000/oa-good'),bad=makeRecord('oa-bad','10.0000/oa-bad'),privateHost=makeRecord('oa-private','10.0000/oa-private'),cancelRecord=makeRecord('oa-cancel','10.0000/oa-cancel')
    const goodPdf=Buffer.concat([Buffer.from('%PDF-1.4 downloaded full text\n'),Buffer.alloc(1100,65)])
    const badPdf=Buffer.concat([Buffer.from('<html>not a pdf'),Buffer.alloc(1100,120)])
    const fetchImpl=(async(input:string|URL,init?:RequestInit)=>{
      const url=String(input)
      if(url.includes('10.0000/oa-good'))return new Response(JSON.stringify({display_name:'OA good',best_oa_location:{pdf_url:'https://publisher.example/good.pdf',landing_page_url:'https://publisher.example/good',license:'cc-by',source:{display_name:'Public Repository'}}}),{headers:{'content-type':'application/json'}})
      if(url.includes('10.0000/oa-bad'))return new Response(JSON.stringify({display_name:'OA bad',best_oa_location:{pdf_url:'https://publisher.example/bad.pdf'}}),{headers:{'content-type':'application/json'}})
      if(url.includes('10.0000/oa-private'))return new Response(JSON.stringify({display_name:'OA private',best_oa_location:{pdf_url:'https://private.example/private.pdf'}}),{headers:{'content-type':'application/json'}})
      if(url.includes('10.0000/oa-cancel'))return new Response(JSON.stringify({display_name:'OA cancel',best_oa_location:{pdf_url:'https://publisher.example/cancel.pdf'}}),{headers:{'content-type':'application/json'}})
      if(url.endsWith('/good.pdf'))return new Response(goodPdf,{headers:{'content-type':'application/pdf','content-length':String(goodPdf.length)}})
      if(url.endsWith('/bad.pdf'))return new Response(badPdf,{headers:{'content-type':'text/html','content-length':String(badPdf.length)}})
      if(url.endsWith('/private.pdf'))throw new Error('private URL should not be fetched')
      if(url.endsWith('/cancel.pdf'))return new Promise<Response>((_resolve,reject)=>{
        const timer=setInterval(()=>{if(init?.signal?.aborted){clearInterval(timer);reject(init.signal.reason??new Error('cancelled'))}},5)
      })
      throw new Error('unexpected test URL '+url)
    }) as typeof fetch
    const progress:OaRepairProgress[]=[]
    const resolveHostImpl=async(host:string)=>{return host==='private.example'?['192.168.1.20']:['203.0.113.10']}
    const preview=await previewOaRepairs({paperIds:[good.id,bad.id,privateHost.id],fetchImpl,onProgress:p=>progress.push(p)})
    assert.equal(preview.candidates.find(item=>item.paperId===good.id)?.status,'available')
    assert.equal(preview.candidates.find(item=>item.paperId===bad.id)?.status,'available')
    assert.equal(preview.candidates.find(item=>item.paperId===privateHost.id)?.status,'available')
    assert.ok(preview.candidates.every(item=>item.pdfUrl?.startsWith('https://')))
    const beforeBad=fs.readFileSync(bad.pdf),beforePrivate=fs.readFileSync(privateHost.pdf)
    const cancelController=new AbortController(),beforeCancel=fs.readFileSync(cancelRecord.pdf)
    const cancelPending=applyOaRepairs({paperIds:[cancelRecord.id],fetchImpl,resolveHostImpl,signal:cancelController.signal})
    cancelController.abort()
    const cancelledApply=await cancelPending
    assert.equal(cancelledApply.cancelled,true,'cancel flag')
    assert.ok(cancelledApply.outcomes.length===0||cancelledApply.outcomes.at(-1)?.status==='cancelled','cancel outcome')
    assert.equal(fs.readFileSync(cancelRecord.pdf).equals(beforeCancel),true,'cancel original')
    const applied=await applyOaRepairs({paperIds:[good.id,bad.id,privateHost.id],fetchImpl,resolveHostImpl})
    const goodOutcome=applied.outcomes.find(item=>item.paperId===good.id),badOutcome=applied.outcomes.find(item=>item.paperId===bad.id),privateOutcome=applied.outcomes.find(item=>item.paperId===privateHost.id)
    assert.equal(goodOutcome?.repaired,true,'good')
    assert.equal(badOutcome?.repaired,false,'bad')
    assert.equal(badOutcome?.status,'invalid_pdf','bad status')
    assert.equal(privateOutcome?.status,'download_failed','private');assert.match(privateOutcome?.error??'',/内网|本机/,'private error')
    assert.equal(fs.readFileSync(bad.pdf).equals(beforeBad),true,'bad original')
    assert.equal(fs.readFileSync(privateHost.pdf).equals(beforePrivate),true,'private original')
    assert.equal(fs.readFileSync(good.pdf).equals(goodPdf),true,'good pdf')
    assert.equal(parseFrontmatter(fs.readFileSync(good.md,'utf8')).source_kind,'pdf','good md')
    assert.match(parseFrontmatter(fs.readFileSync(good.md,'utf8')).oa_pdf_url,/good\.pdf$/)
    const journal=db.prepare('SELECT id,state,backup_dir FROM operation_journal WHERE kind=?').all('oa.repair_pdf') as Array<{id:string;state:string;backup_dir:string}>
    assert.equal(journal.length,1);assert.equal(journal[0].state,'committed');assert.ok(fs.existsSync(journal[0].backup_dir))
    const row=db.prepare('SELECT source_kind FROM active_papers WHERE id=?').get(good.id) as {source_kind:string}
    assert.equal(row.source_kind,'pdf')
    assert.ok(progress.some(item=>item.phase==='preview'&&item.done===3))
  })
  await test('OpenAccess preview cancellation aborts the active request',async()=>{
    const controller=new AbortController()
    const recordId=(db.prepare("SELECT id FROM active_papers WHERE source_kind='record' ORDER BY id LIMIT 1").get() as {id:number}).id
    const fetchImpl=(async(_url:string|URL,init?:RequestInit)=>new Promise<Response>((_resolve,reject)=>{
      const signal=init?.signal
      const timer=setInterval(()=>{
        if(signal?.aborted){clearInterval(timer);reject(signal.reason??new Error('cancelled'))}
      },5)
    })) as typeof fetch
    const pending=previewOaRepairs({paperIds:[recordId],fetchImpl,signal:controller.signal})
    controller.abort()
    await assert.rejects(pending,/abort/i)
  })
  await test('PDF extraction respects cancellation and timeout',async()=>{
    const objects=[
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      `<< /Length 58 >>\nstream\nBT /F1 18 Tf 72 720 Td (Slow extraction cancellation fixture) Tj ET\nendstream`
    ]
    let content='%PDF-1.4\n';const offsets=[0]
    for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(content));content+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`}
    const xref=Buffer.byteLength(content)
    content+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n ').join('\n')+`\ntrailer\n<< /Root 1 0 R /Size ${objects.length+1} >>\nstartxref\n${xref}\n%%EOF\n`
    const slow=path.join(root,'extract-cancel.pdf');fs.writeFileSync(slow,content)
    const aborted=new AbortController();aborted.abort()
    await assert.rejects(extractPages(slow,Infinity,{signal:aborted.signal}),/PDF 抽取已取消|abort/i)
    await assert.rejects(extractPages(slow,Infinity,{timeoutMs:1}),/PDF 抽取超时|timeout/i)
  })
  await test('record-only collection members remain citable context sources',async()=>{
    const repo=new ChatRepository(db),workspace=repo.ensureWorkspace(library),recordPaper=store.listPapers().find(item=>item.slug==='record-only')
    const collection=createCollection('题录集合上下文')
    setPaperInCollection(collection.id,recordPaper!.id,true)
    const sources=await retrieveSources({query:'这个集合里有什么文献',workspaceId:workspace.id,runId:'run-record-collection',refs:[{kind:'collection',workspaceId:workspace.id,collectionId:collection.id}]})
    assert.ok(sources.some(source=>source.paperId===recordPaper!.id&&source.kind==='paper_page'&&source.title.includes('题录')))
    setPaperInCollection(collection.id,recordPaper!.id,false)
    removeCollection(collection.id)
  })
  await test('hybrid retrieval rejects an aborted scope immediately',async()=>{
    const controller=new AbortController();controller.abort()
    await assert.rejects(hybridSearch('cancel before retrieval',undefined,5,undefined,controller.signal),/abort/i)
  })
  await test('explicit selections and notes become citable sources',()=>{
    const repo=new ChatRepository(db),workspace=repo.ensureWorkspace(library)
    const sources=explicitContextSources({workspaceId:workspace.id,runId:'run-explicit',refs:[
      {kind:'selection',workspaceId:workspace.id,paperId:one.id,page:2,text:'精确选区内容',documentVersion:'v1'},
      {kind:'note',workspaceId:workspace.id,noteId:'paper-'+one.id,paperId:one.id},
      {kind:'web',workspaceId:workspace.id,url:'https://example.org/source',title:'Web source',snippet:'web snippet',documentVersion:'web:1'}
    ]})
    assert.deepEqual(sources.map(source=>source.kind),['paper_selection','note','web'])
    assert.equal(sources[0].snippet,'精确选区内容');assert.equal(sources[0].documentVersion,'v1');assert.equal(sources[0].locator.page,2);assert.equal(sources[0].locator.uri,'cspaper://paper/one?page=2')
    assert.ok(sources[1].snippet.length>0);assert.ok(sources[1].documentVersion);assert.equal(sources[1].locator.uri,'cspaper://paper/one?anchor=notes')
    assert.equal(sources[2].locator.uri,'https://example.org/source');assert.equal(sources[2].snippet,'web snippet')
  })
  await test('citation validation binds display numbers to source IDs',()=>{
    const sources=[{id:'s1',runId:'r',kind:'chunk' as const,workspaceId:'w',title:'A',locator:{},snippet:'',status:'available' as const,createdAt:new Date().toISOString()},{id:'s2',runId:'r',kind:'chunk' as const,workspaceId:'w',title:'B',locator:{},snippet:'',status:'missing' as const,createdAt:new Date().toISOString()}]
    const result=validateCitations('结论 [1]，差异 [2]，错误 [3]\n```json\n{"paperIds":[1,2,3]}\n```',sources)
    assert.equal(result.matches[0].sourceId,'s1');assert.deepEqual(result.missing,[2]);assert.deepEqual(result.unknown,[3])
    const codeOnly=validateCitations('```json\n{"paperIds":[1,2,3]}\n```',sources)
    assert.deepEqual(codeOnly,{matches:[],missing:[],unknown:[]})
    assert.ok(citationWarning(result))
  })
  await test('unified tool executor writes real platform state and artifacts',async()=>{
    const repo=new ChatRepository(db),bus=new ChatEventBus(repo),registry=new ToolRegistry()
    registerLibraryTools(registry),new ToolExecutor(registry)
    const workspace=repo.ensureWorkspace(library),conversation=repo.createConversation({workspaceId:workspace.id})
    const model={bindingId:'b',profileId:'p',provider:'mock',model:'m',capabilities:['text'],reasoning:'default' as const}
    const context={conversationId:conversation.id,runId:'pending',refs:[],budget:{totalChars:1,usedChars:0,reservedForOutput:0},diagnostics:[],createdAt:new Date().toISOString()}
    const turn=repo.createTurn({conversationId:conversation.id,clientMessageId:'tool-executor-run',text:'保存笔记',context,modelBinding:model})
    const executor=new ToolExecutor(registry)
    const out=await executor.execute({runId:turn.run.id,workspaceId:workspace.id,tool:'note.save',args:{paperId:one.id,text:'统一工具写入'},signal:new AbortController().signal,repository:repo,events:bus,permission:'auto'})
    assert.equal(out.status,'success')
    if(out.status!=='success')return
    assert.ok(fs.readFileSync(one.md,'utf-8').includes('统一工具写入'))
    assert.equal(repo.listArtifacts(turn.run.id)[0].kind,'note')
    assert.equal(repo.getToolCall(out.toolCallId)?.status,'success')
  })
  await test('MCP tools enter the unified audited executor',async()=>{
    const repo=new ChatRepository(db),bus=new ChatEventBus(repo),workspace=repo.ensureWorkspace(library)
    const conversation=repo.createConversation({workspaceId:workspace.id})
    const model={bindingId:'mcp',profileId:'p',provider:'mock',model:'m',capabilities:['text'],reasoning:'default' as const}
    const context={conversationId:conversation.id,runId:'pending',refs:[],budget:{totalChars:1,usedChars:0,reservedForOutput:0},diagnostics:[],createdAt:new Date().toISOString()}
    const turn=repo.createTurn({conversationId:conversation.id,clientMessageId:'mcp-tool-run',text:'调用外部工具',context,modelBinding:model})
    let seenSignal=false
    const registry=new ToolRegistry()
    registerMcpToolList(registry,[{server:'test',name:'lookup',fullName:'mcp__test__lookup',description:'外部查询',inputSchema:{type:'object'}}],async(_fullName,args,signal)=>{seenSignal=signal instanceof AbortSignal;return `外部结果：${String((args as {q?:string}).q??'')}`})
    const output=await new ToolExecutor(registry).execute({runId:turn.run.id,workspaceId:workspace.id,tool:'mcp__test__lookup',args:{q:'睡眠'},signal:new AbortController().signal,repository:repo,events:bus,permission:'auto'})
    assert.equal(output.status,'success')
    assert.equal(seenSignal,true)
    assert.equal(repo.getToolCall(output.status==='success'?output.toolCallId:'')?.status,'success')
    assert.ok(repo.listRunEvents(turn.run.id).some(event=>event.type==='tool.completed'))
  })
  await test('tool policy blocks destructive calls before execution and cancellation prevents writes',async()=>{
    const repo=new ChatRepository(db),bus=new ChatEventBus(repo),workspace=repo.ensureWorkspace(library)
    const conversation=repo.createConversation({workspaceId:workspace.id}),model={bindingId:'b',profileId:'p',provider:'mock',model:'m',capabilities:['text'],reasoning:'default' as const}
    const context={conversationId:conversation.id,runId:'pending',refs:[],budget:{totalChars:1,usedChars:0,reservedForOutput:0},diagnostics:[],createdAt:new Date().toISOString()}
    const turn=repo.createTurn({conversationId:conversation.id,clientMessageId:'policy-run',text:'执行',context,modelBinding:model})
    let executed=false
    const registry=new ToolRegistry().register({definition:{name:'test.destroy',version:1,title:'破坏性测试',description:'删除',risk:'destructive',defaultPermission:'approval_required',inputSchema:{type:'object'},canCancel:true},schema:({parse:(value:unknown)=>value} as never),execute:async()=>{executed=true;return {status:'success',summary:'已执行',sources:[],artifacts:[],changes:[],durationMs:0}}})
    const blocked=await new ToolExecutor(registry).execute({runId:turn.run.id,workspaceId:workspace.id,tool:'test.destroy',args:{},signal:new AbortController().signal,repository:repo,events:bus,permission:'auto'})
    assert.equal(blocked.status,'approval_required');assert.equal(executed,false)
    const controller=new AbortController();controller.abort()
    registry.register({definition:{name:'test.cancel_write',version:1,title:'取消测试',description:'写入',risk:'reversible_write',defaultPermission:'auto',inputSchema:{type:'object'},canCancel:true},schema:({parse:(value:unknown)=>value} as never),execute:async()=>{executed=true;return {status:'success',summary:'已执行',sources:[],artifacts:[],changes:[],durationMs:0}}})
    const cancelled=await new ToolExecutor(registry).execute({runId:turn.run.id,workspaceId:workspace.id,tool:'test.cancel_write',args:{},signal:controller.signal,repository:repo,events:bus,permission:'auto'})
    assert.equal(cancelled.status,'failed');assert.equal(executed,false)
  })
  await test('scheduled automation executes through the unified runtime',async()=>{
    const repo=new ChatRepository(db),workspace=repo.ensureWorkspace(library)
    const schedule=createSchedule('统一自动任务','整理今日文献',1440)
    const legacyCount=(db.prepare('SELECT COUNT(*) n FROM agent_tasks').get() as {n:number}).n
    const runtime={submitTurn:(input:any)=>{
      const turn=repo.createTurn({conversationId:input.conversationId,clientMessageId:input.clientMessageId,text:input.text,context:input.context,modelBinding:input.modelBinding,mode:'act'})
      repo.updateRunStatus(turn.run.id,'completed')
      return turn
    }}
    const outcome=await runHeadlessWithRuntime(schedule,runtime as never,repo)
    const row=db.prepare('SELECT * FROM agent_schedules WHERE id=?').get(schedule.id) as any
    assert.equal(outcome.status,'completed')
    assert.ok(row.last_result.includes('会话 '+outcome.conversationId))
    assert.equal(repo.getRun(outcome.runId)?.status,'completed')
    assert.equal((db.prepare('SELECT COUNT(*) n FROM agent_tasks').get() as {n:number}).n,legacyCount)
    removeSchedule(schedule.id)
  })
  await test('journaled file operation records failure and preserves the original',()=>{
    const file=path.join(root,'operation-failure.md');fs.writeFileSync(file,'before')
    const failed=runFileOperation(db,{id:'op-failure-test',kind:'test.write',target:file,edits:[{path:file,content:'after'}],commit:()=>{throw new Error('db commit failed')}})
    assert.equal(failed.state,'failed');assert.equal(fs.readFileSync(file,'utf-8'),'before')
    assert.throws(()=>beginOperation(db,{id:'op-failure-test',kind:'test.write',target:file,edits:[]}))
  })
  await test('interrupted operations recover to explicit review or rollback states',()=>{
    const afterFile=path.join(root,'operation-after.md');fs.writeFileSync(afterFile,'old')
    beginOperation(db,{id:'op-after-test',kind:'test.write',target:afterFile,edits:[{path:afterFile,content:'new'}]})
    fs.writeFileSync(afterFile,'new')
    const beforeFile=path.join(root,'operation-before.md');fs.writeFileSync(beforeFile,'old')
    beginOperation(db,{id:'op-before-test',kind:'test.write',target:beforeFile,edits:[{path:beforeFile,content:'new'}]})
    const recovered=recoverOperations(db)
    const after=recovered.find(operation=>operation.id==='op-after-test'),before=recovered.find(operation=>operation.id==='op-before-test')
    assert.equal(after?.state,'needs_review');assert.equal(before?.state,'rolled_back')
    assert.equal(recoverOperations(db).length,0)
  })
  await testModelBinding(test)
  await testModelProvider(test)
  await testChatEvents(test,db,root)
  await testMigrations(test)
  await testChatRuntime(test,db,root)
  await testConversationStore(test)
  await testToolExecutor(test,db,root,one.id,library)
  await testLibraryScan(test,db,root)
  console.log(JSON.stringify({passed,failed,fixture:root}))
  app.exit(failed?1:0)
}).catch(error=>{console.error(error);app.exit(1)})
