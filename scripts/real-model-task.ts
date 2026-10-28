import { app } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import * as store from '../src/main/db'
import { ChatRepository } from '../src/main/chat/repository'
import { ChatRuntime } from '../src/main/chat/runtime'
import { ChatEventBus } from '../src/main/chat/events'
import { SystemChatProvider } from '../src/main/chat/provider'
import { buildContextSnapshot } from '../src/main/chat/context'
import { ToolRegistry } from '../src/main/tools/registry'
import { registerLibraryTools } from '../src/main/tools/library'
import { registerResearchTools } from '../src/main/tools/research'
import { snapshotModelBinding } from '../src/main/model-config'

const sourcePath=process.env.CSPAPER_REAL_SETTINGS_DB
if(!sourcePath||!fs.existsSync(sourcePath))throw new Error('real settings database missing')
const source=new Database(sourcePath,{readonly:true})
const saved=source.prepare("SELECT value FROM meta WHERE key='settings'").get() as {value:string}|undefined
source.close()
if(!saved?.value)throw new Error('real settings missing')
function fixturePdf(index:number):string {
  const stream=`BT /F1 18 Tf 54 740 Td (Real Model Task Fixture ${index + 1}) Tj /F1 11 Tf 0 -20 Td (Valid PDF evidence text for real model acceptance.) Tj ET`
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`]
  let content='%PDF-1.4\n';const offsets=[0]
  objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(content));content+=`${index+1} 0 obj\n${object}\nendobj\n`})
  const xref=Buffer.byteLength(content)
  content+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer\n<< /Root 1 0 R /Size 6 >>\nstartxref\n${xref}\n%%EOF\n`
  return content
}

const root=fs.mkdtempSync(path.join(os.tmpdir(),'cspaper-real-task-')),library=path.join(root,'library')
const paperDirs:string[]=[]
for(let index=0;index<3;index++){
  const paperDir=path.join(library,'papers','test',`real-paper-${index+1}`);paperDirs.push(paperDir);fs.mkdirSync(paperDir,{recursive:true})
  fs.writeFileSync(path.join(paperDir,'paper.pdf'),fixturePdf(index))
  fs.writeFileSync(path.join(paperDir,`real-paper-${index+1}.md`),`---\ntitle: "Real Model Task Fixture ${index+1}"\nauthors: "Agnes"\nyear: 2026\nvenue: "Real Acceptance"\ntags: []\n---\n\n# Real Model Task Fixture ${index+1}\n\n## 我的笔记\n<!-- cspaper:notes:start -->\ninitial ${index+1}\n<!-- cspaper:notes:end -->\n`)
}
const userData=path.join(root,'data');fs.mkdirSync(userData,{recursive:true})
const dbFile=new Database(path.join(userData,'cspaper.db'))
dbFile.exec('CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT)')
dbFile.prepare('INSERT INTO meta(key,value) VALUES(?,?)').run('settings',saved.value)
dbFile.close()
app.setPath('userData',userData)
app.whenReady().then(async()=>{
  try{
    store.initDb()
    store.saveSettings({libraryPath:library,setupDone:true,agentModel:'agnes-2.5-flash',agentModelBindingId:undefined})
    const scan=store.scanLibrary(library)
    if(scan.total!==3)throw new Error('real fixture scan failed: '+JSON.stringify(scan))
    const settings=store.getSettings(),repository=new ChatRepository(store.getDb()),bus=new ChatEventBus(repository)
    const registry=new ToolRegistry();registerLibraryTools(registry);registerResearchTools(registry)
    const runtime=new ChatRuntime(repository,new SystemChatProvider(),bus,1,undefined,registry,'auto')
    const workspace=repository.ensureWorkspace(library),conversation=repository.createConversation({workspaceId:workspace.id,title:'真实模型三文献验收',mode:'act',entry:'work'})
    const papers=store.getDb().prepare('SELECT id FROM active_papers ORDER BY id').all() as Array<{id:number}>
    const context=buildContextSnapshot({conversationId:conversation.id,runId:'pending',workspaceId:workspace.id,refs:papers.map(paper=>({kind:'paper' as const,workspaceId:workspace.id,paperId:paper.id})),permission:'auto'})
    const model=snapshotModelBinding(settings,settings.agentModelBindingId??'',settings.thinkingLevel,'act')
    const turn=runtime.submitTurn({conversationId:conversation.id,clientMessageId:'real-model-task-'+Date.now(),parentMessageId:conversation.activeLeafMessageId,text:'最终验收三篇文献：生成对比表，并给每篇追加文本 FINAL-REAL-MODEL-NOTE。只输出可执行 JSON 计划。',context,modelBinding:model,mode:'act'})
    await runtime.idle()
    const run=repository.getRun(turn.run.id),events=repository.listRunEvents(turn.run.id),artifacts=repository.listArtifacts(turn.run.id)
    const notes=paperDirs.map(dir=>fs.readFileSync(path.join(dir,fs.readdirSync(dir).find(file=>file.endsWith('.md'))!),'utf8'))
    const comparison=artifacts.find(artifact=>artifact.kind==='comparison'),notesWritten=notes.filter(note=>note.includes('FINAL-REAL-MODEL-NOTE')).length,completedTools=events.filter(event=>event.type==='tool.completed').length
    const ok=run?.status==='completed'&&!!comparison&&notesWritten===3&&events.some(event=>event.type==='plan.created')&&completedTools>=4
    console.log(JSON.stringify({ok,status:run?.status,planCreated:events.some(event=>event.type==='plan.created'),completedTools,comparisonArtifact:comparison??null,notesWritten,provider:model.provider,model:model.model,fixture:root},null,2))
    app.exit(ok?0:1)
  }catch(error){console.error(JSON.stringify({ok:false,error:String(error).slice(0,600)},null,2));app.exit(1)}
})
