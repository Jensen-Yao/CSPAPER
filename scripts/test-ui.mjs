import assert from 'node:assert/strict'
import http from 'node:http'
// Uses the repository's existing Playwright driver against the real built application.
// Creates its own PDF library and database; never reads the user's settings or library.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright-core'

const ROOT = process.cwd()
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cspaper-ui-audit-'))
const LIB = path.join(TMP, 'library')
const OUT = path.join(TMP, 'captures')
fs.mkdirSync(OUT, { recursive: true })
const electron = path.join(ROOT, 'node_modules/electron/dist/electron.exe')
const appExecutable = process.env.CSPAPER_TEST_EXECUTABLE || electron
const portServer = http.createServer()
await new Promise(resolve => portServer.listen(0, '127.0.0.1', resolve))
const debugPort = portServer.address().port
await new Promise(resolve => portServer.close(resolve))
const debugUrl = `http://127.0.0.1:${debugPort}`
console.log('UI_EXECUTABLE=' + appExecutable)
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
console.log('UI_AUDIT_DIR=' + TMP)
fs.mkdirSync(path.join(ROOT,'ui-audit'),{recursive:true});fs.writeFileSync(path.join(ROOT,'ui-audit/latest-run.txt'),TMP)

function pdf() {
  const pageStream = pageNumber => {
    const unique = [
      'Page one methodology cohort and research design evidence.',
      'Page two dataset validation and experimental measurement results.',
      'Page three reproducibility limitation and uncertainty analysis conclusion.'
    ][pageNumber - 1]
    const lines = [`BT /F1 18 Tf 54 740 Td (Research Paper: Evidence and Methods) Tj`, `/F1 11 Tf 0 -24 Td (${unique}) Tj`]
    for (let i = 0; i < 30; i++) lines.push(`0 -18 Td (Line ${i + 1}: resilience methods evidence analysis results. A reproducible research example.) Tj`)
    lines.push('ET')
    const stream = lines.join('\n')
    return { stream, length: Buffer.byteLength(stream) }
  }
  const pages = [pageStream(1), pageStream(2), pageStream(3)]
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 6 0 R 8 0 R] /Count 3 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${pages[0].length} >>\nstream\n${pages[0].stream}\nendstream`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 7 0 R >>',
    `<< /Length ${pages[1].length} >>\nstream\n${pages[1].stream}\nendstream`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 9 0 R >>',
    `<< /Length ${pages[2].length} >>\nstream\n${pages[2].stream}\nendstream`
  ]
  let content = '%PDF-1.4\n'
  const offsets = [0]
  for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(content)); content += `${i + 1} 0 obj\n${objects[i]}\nendobj\n` }
  const xref = Buffer.byteLength(content)
  content += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n ').join('\n')}\ntrailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xref}\n%%EOF\n`
  return content
}
for (let i = 0; i < 12; i++) {
  const cat = ['01-人工智能', '02-科研方法', '03-文献综述'][i % 3]
  const slug = `2026-audit-${String(i).padStart(2, '0')}`
  const dir = path.join(LIB, 'papers', cat, slug)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'paper.pdf'), pdf())
  const title = ['复杂研究任务中的证据组织与多文献综合分析：方法、边界及可复现性研究', 'Research evidence and resilience: methods for a trustworthy literature workflow', '中文科研工作流与知识管理方法'][i % 3] + `（样本 ${i + 1}）`
  fs.writeFileSync(path.join(dir, `${slug}.md`), `---\ntitle: "${title}"\nauthors: "Audit Author; 测试作者"\nyear: ${2024 + i % 3}\nvenue: "Audit Journal"\ndoi: "10.0000/audit-${i}"\ntags: [科研方法, 阅读样本]\n---\n\n# ${title}\n\n## 我的笔记\n<!-- cspaper:notes:start -->\n## 研究问题\n这是一段用于检查编辑与阅读流程的独立测试笔记。\n<!-- cspaper:notes:end -->\n`)
}
{
  const slug='2026-audit-record'
  const dir=path.join(LIB,'papers','03-文献综述',slug)
  fs.mkdirSync(dir,{recursive:true})
  fs.writeFileSync(path.join(dir,'paper.pdf'),Buffer.from('%PDF-1.4 CSPAPER record-only fixture'))
  fs.writeFileSync(path.join(dir,`${slug}.md`),`---\ntitle: "仅题录样本：Zotero 条目无原文"\nauthors: "Record Author"\nyear: 2026\nvenue: "Record Journal"\ndoi: "10.0000/record-only"\nabstract: "Bibliographic metadata only."\nsource_kind: record\ntags: [科研方法]\n---\n\n# 仅题录样本\n`)
}
let firstId=1,partialMode=false
const plannerRequests=[]
const server=http.createServer((req,res)=>{
  let raw='';req.on('data',part=>raw+=part);req.on('end',()=>{
    const body=JSON.parse(raw||'{}')
    if(req.url==='/api/embed') {res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({embeddings:(body.input||[]).map(()=>[1,0,0,0,0,0,0,0])}));return}
    const sys=(body.messages||[]).filter(m=>m.role==='system').map(m=>m.content).join('')
    if(sys.includes('科研任务规划器'))plannerRequests.push(body.messages)
    if(!body.stream){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:'OK'}}]}));return}
    res.writeHead(200,{'Content-Type':'text/event-stream'})
    const chunk=(delta,finish=null)=>res.write('data: '+JSON.stringify({id:'test',object:'chat.completion.chunk',model:'mock-model',choices:[{index:0,delta,finish_reason:finish}]})+'\n\n')
    if(sys.includes('只输出 JSON')&&sys.includes('维度名')) {
      chunk({content:JSON.stringify({'研究方法':[{t:'方法可核实',p:1}],'数据与实验':[{t:'实验证据可核实',p:1}],'核心结论':[{t:'结论可核实',p:1}]})},'stop')
    }
    else {
    const userText=(body.messages||[]).filter(m=>m.role==='user').map(m=>m.content).join('\n')
    if(sys.includes('学术翻译引擎')) {
      if(userText.includes('SLOW-TRANSLATION')) {
        let count=0
        const timer=setInterval(()=>{count++;chunk({content:'慢'});if(count>=80){clearInterval(timer);chunk({},'stop');res.end()}},100)
        return
      }
      chunk({content:'统一翻译完成。[1]'},'stop');res.end();return
    }
    if(sys.includes('科研任务规划器')&&userText.includes('SLOW-WORK-FOLLOW-UP')) {
      let count=0
      const timer=setInterval(()=>{
        count++;chunk({content:'…'})
        if(count>=10){clearInterval(timer);chunk({content:JSON.stringify({steps:[{id:'slow-search',tool:'library.search',args:{query:'resilience methods',limit:1},purpose:'慢任务检索',risk:'read'}]})},'stop');res.end('data: [DONE]\n\n')}
      },500)
      return
    }
    if(sys.includes('科研任务规划器')&&userText.includes('生成综述')) {
      chunk({content:JSON.stringify({steps:[{id:'retry-synthesis',tool:'synthesis.create',args:{paperIds:[firstId]},purpose:'重试仍然不足的综述',risk:'reversible_write'}]})},'stop')
      res.end();return
    }
    if(sys.includes('科研任务规划器')&&userText.includes('最终验收三篇文献')) {
      const refs=JSON.parse(userText.match(/上下文对象：(\[[\s\S]*?\])\n可用工具/)[1])
      const ids=refs.filter(ref=>ref.kind==='paper').map(ref=>ref.paperId)
      chunk({content:JSON.stringify({steps:[
        {id:'compare',tool:'comparison.create',args:{paperIds:ids,dimensions:['研究方法','数据与实验','核心结论']},purpose:'生成三篇对比表',risk:'reversible_write'},
        ...ids.map((paperId,index)=>({id:'note-'+index,tool:'note.append',args:{paperId,text:'FINAL-ACCEPTANCE-NOTE'},purpose:'追加局限与启发',risk:'reversible_write'}))
      ]})},'stop')
    }
    else if(sys.includes('科研任务规划器')) chunk({content:JSON.stringify({steps:[{id:'step-search',tool:'library.search',args:{query:'resilience methods',limit:3},purpose:'检索文献',risk:'read'},{id:'step-note',tool:'note.save',args:{paperId:1,text:'UNIFIED-ACT-VERIFIED'},purpose:'保存笔记',risk:'reversible_write'}]})},'stop')
    else if(sys.includes('规划器')) chunk({content:JSON.stringify({steps:[{tool:'list_library',args:{},purpose:'检查文献库'},{tool:partialMode?'make_synthesis':'write_note',args:partialMode?{paperIds:[firstId]}:{paperId:firstId,text:'E2E-VERIFIED-NOTE'},purpose:partialMode?'生成综述':'保存阅读笔记'}]})},'stop')
    else if(body.tools?.length){
      const done=(body.messages||[]).filter(m=>m.role==='tool').length
      if(done===0)chunk({tool_calls:[{index:0,id:'library',type:'function',function:{name:'list_library',arguments:'{}'}}]},'tool_calls')
      else if(done===1&&!partialMode)chunk({tool_calls:[{index:0,id:'note',type:'function',function:{name:'write_note',arguments:JSON.stringify({paperId:firstId,text:'E2E-VERIFIED-NOTE'})}}]},'tool_calls')
      else chunk({content:'已检查文献库并结束任务。'},'stop')
    }else chunk({content:'根据所选文献，研究方法和证据可以在原文中核实。[1]'},'stop')
    }
    res.end('data: [DONE]\n\n')
  })
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const mockBase='http://127.0.0.1:'+server.address().port
const seedFile = path.join(TMP, 'seed.cjs')
let seed = fs.readFileSync(path.join(ROOT, 'scripts/e2e-seed.cjs'), 'utf8')
seed = seed.replace("'F:/tmp/cspaper-sample'", JSON.stringify(LIB)).replace("embedProvider: 'local'", "embedProvider: 'ollama', ollamaUrl: 'http://127.0.0.1:9'")
seed=seed.replaceAll('http://127.0.0.1:9390/v1',mockBase+'/v1').replaceAll('http://127.0.0.1:9',mockBase);fs.writeFileSync(seedFile,seed)

async function run(bin, args, options = {}) {
  return await new Promise(resolve => {
    const proc = spawn(bin, args, { cwd: ROOT, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, ...options })
    let output = ''
    proc.stdout.on('data', d => { output += d; process.stdout.write(d) })
    proc.stderr.on('data', d => { output += d; process.stderr.write(d) })
    proc.on('exit', code => resolve({ code, output }))
  })
}
async function seedData(name) {
  const data = path.join(TMP, name)
  fs.mkdirSync(data, { recursive: true })
  const result = await run(electron, [seedFile, data])
  if (result.code !== 0 || !result.output.includes('SEEDED')) throw new Error('Fixture seed failed')
  return data
}


const data=await seedData('interactive')
const appArguments=[...(appExecutable===electron?['.']:[]),`--remote-debugging-port=${debugPort}`]
let proc=spawn(appExecutable,appArguments,{cwd:ROOT,env:{...process.env,CSPAPER_DATA_DIR:data},stdio:'ignore',windowsHide:true})
let browser,page,passed=0
const errors=[]
const check=(name,value)=>{assert.ok(value,name);passed++;console.log('PASS '+name)}
const getTurn=async needle=>page.evaluate(async needle=>{
  const conversations=await window.api.chat.listConversations({limit:100})
  for(const conversation of conversations.items){
    const loaded=await window.api.chat.loadMessages({conversationId:conversation.id,limit:120})
    const user=loaded.items.find(message=>message.role==='user'&&message.parts.some(part=>part.type==='text'&&part.text===needle))
    if(!user)continue
    const assistant=loaded.items.find(message=>message.parentId===user.id&&message.runId)
    if(assistant)return {conversation,messages:loaded.items,run:await window.api.chat.getRun(assistant.runId)}
  }
  return null
},needle)
const waitForTurn=async(needle,statuses=['completed','partial','failed','cancelled'])=>{
  const deadline=Date.now()+60000
  let turn
  while(Date.now()<deadline){turn=await getTurn(needle);if(statuses.includes(turn?.run?.run?.status))return turn;await wait(100)}
  throw new Error('Turn did not reach expected state: '+needle+'; '+JSON.stringify(turn?.run?.run))
}
const waitForAgent=async id=>{
  const deadline=Date.now()+30000
  while(Date.now()<deadline){const task=await page.evaluate(id=>window.api.agentTask(id),id);if(['done','partial','error','cancelled'].includes(task?.status))return task;await wait(50)}
  throw new Error('Legacy agent did not reach a terminal state: '+id)
}

try{
  for(let i=0;i<80;i++){try{const r=await fetch(debugUrl+'/json/version');if(r.ok)break}catch{}await wait(250)}
  browser=await chromium.connectOverCDP(debugUrl)
  for(let i=0;i<80&&!page;i++){page=browser.contexts()[0]?.pages().find(p=>p.url().includes('index.html'));if(!page)await wait(250)}
  if(!page)throw new Error('No application page')
  page.on('pageerror',error=>errors.push(String(error)))
  await page.setViewportSize({width:1500,height:940})
  await page.waitForSelector('.workspace-nav',{timeout:30000})
  await page.locator('.top-switch button').filter({hasText:'Paper'}).click()
  await page.locator('.workspace-nav .tb-q[title="文献库"]').click()
  await page.waitForSelector('.pcard',{timeout:30000})
  const shot=async name=>{await page.screenshot({path:path.join(OUT,name+'.png')});console.log('CAPTURE='+name)}
  const navigate=async title=>{await page.locator(`.workspace-nav .tb-q[title="${title}"]`).click();await wait(300)}
  await wait(800)
  check('workspace has readable navigation',(await page.locator('.workspace-nav button').count())>=6)
  const titleBrand=await page.locator('.tb-title .brand-icon').evaluate(img=>({complete:img.complete,naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight,src:img.currentSrc||img.src}))
  check('title bar uses the canonical brand image',titleBrand.complete&&titleBrand.naturalWidth===902&&titleBrand.naturalHeight===902)
  await shot('01-library')
  check('record-only papers carry a visible source badge',(await page.locator('.source-badge.record').count())>=1)
  await page.getByRole('button',{name:'仅题录 1',exact:true}).click();await wait(100)
  check('source filter isolates record-only entries',(await page.locator('.pcard').count())===1)
  check('library exposes OpenAccess repair entry',await page.getByRole('button',{name:'探测开放获取原文'}).count()>=1)
  await page.getByRole('button',{name:/全部来源/}).click();await wait(100)
  const libraryBefore=await page.locator('.library').first().evaluate(el=>el.getBoundingClientRect().width)
  const libraryHandle=page.locator('[data-resizer="library"]')
  await libraryHandle.focus();await page.keyboard.press('ArrowRight');await wait(100)
  const libraryAfter=await page.locator('.library').first().evaluate(el=>el.getBoundingClientRect().width)
  check('library pane resize handle is keyboard adjustable',libraryAfter>libraryBefore)
  check('library opens with the full paper list by default',(await page.locator('.lib-view-seg button.on').filter({hasText:'全部文献'}).count())===1&&await page.locator('.lib-files-scroll .paper-item').count()>=12)
  check('collections and tags start collapsed as accessory sections',await page.locator('.tag-section-toggle[aria-expanded=false]').count()===2&&await page.locator('.tag-section-body').count()===0)
  await page.getByRole('button',{name:/集合/,exact:false}).first().click();await wait(100)
  check('collection section can expand and collapse',await page.locator('.tag-section-toggle[aria-expanded=true]').count()===1)
  await page.getByRole('button',{name:/标签/,exact:false}).first().click();await wait(100)
  check('tag section can expand independently',await page.locator('.tag-section-toggle[aria-expanded=true]').count()===2)
  await page.getByRole('button',{name:/集合/,exact:false}).first().click();await wait(50)
  await page.getByRole('button',{name:/标签/,exact:false}).first().click();await wait(50)
  await page.locator('.lib-view-seg button').filter({hasText:'分类'}).click();await wait(150)
  check('categories stay collapsed by default',await page.locator('.cat-item[aria-expanded=false]').count()===await page.locator('.cat-item').count()&&await page.locator('.tree-papers .paper-item').count()===0)
  await page.getByRole('button',{name:'全部展开',exact:true}).click();await wait(100)
  check('category tree has a global expand control',await page.locator('.cat-item[aria-expanded=true]').count()===await page.locator('.cat-item').count()&&await page.locator('.tree-papers .paper-item').count()>=3)
  await page.locator('.cat-item[aria-expanded=true]').first().click();await wait(100)
  check('category header collapses with an explicit expanded state',await page.locator('.cat-item[aria-expanded=false]').count()===1&&await page.evaluate(()=>JSON.parse(localStorage.getItem('pl.category-expanded')??'[]').length===document.querySelectorAll('.cat-item').length-1))
  await page.getByRole('button',{name:'全部收起',exact:true}).click();await wait(100)
  check('category tree has a global collapse control',await page.locator('.cat-item[aria-expanded=false]').count()===await page.locator('.cat-item').count())
  await page.getByRole('button',{name:'全部展开',exact:true}).click();await wait(100)
  const dragInfo=await page.evaluate(async()=>{
    const papers=await window.api.listPapers(),paper=papers[0],target=papers.find(item=>item.category!==paper.category)?.category
    if(!target)throw new Error('drag fixture needs distinct categories')
    const row=[...document.querySelectorAll('.tree-papers .paper-item')].find(item=>item.getAttribute('aria-label')?.startsWith(paper.title))
    const header=[...document.querySelectorAll('.cat-item')].find(item=>item.getAttribute('aria-label')?.startsWith(target))
    if(!row||!header)throw new Error('category drag fixture missing')
    const transfer=new DataTransfer();transfer.setData('text/plain',`paper:${paper.id}`)
    row.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:transfer}))
    header.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:transfer}))
    header.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}))
    return {id:paper.id,from:paper.category,target}
  })
  await page.waitForFunction(async info=>(await window.api.listPapers()).find(paper=>paper.id===info.id)?.category===info.target,dragInfo,{timeout:10000})
  await page.evaluate(info=>window.api.movePaper(info.id,info.from),dragInfo)
  await page.waitForFunction(async info=>(await window.api.listPapers()).find(paper=>paper.id===info.id)?.category===info.from,dragInfo,{timeout:10000})
  check('category rows accept dragged papers',true)
  await page.locator('.lib-view-seg button').filter({hasText:'全部文献'}).click();await wait(100)
  await page.locator('.side-rail-btn[title="文献详情"]').click();await wait(100)
  check('detail rail stays on library home before a paper is opened',await page.locator('.library-surface:not(.pane-hidden)').isVisible())
  await libraryHandle.focus();await page.keyboard.press('Home')
  const papers=await page.evaluate(()=>window.api.listPapers());firstId=papers[0].id
  await page.locator('.library-search input').fill(papers[0].title)
  check('library query filters cards',(await page.locator('.pcard').count())===1)
  await page.locator('.library-search input').fill('NO-MATCH-TEST')
  check('library empty result has clear action',await page.locator('.library-no-results').isVisible())
  await page.getByRole('button',{name:'清除筛选',exact:true}).click()
  await page.getByRole('button',{name:'紧凑视图',exact:true}).click()
  check('compact library view works',await page.locator('.library-list').count()===1)
  await page.getByRole('button',{name:'封面视图',exact:true}).click()
  await page.locator('.add-literature summary').click()
  check('add menu offers four import sources',await page.locator('.add-literature-menu button').count()===4)
  await page.locator('.add-literature summary').click()
  await page.keyboard.press('Control+k')
  check('command palette owns Ctrl K',await page.locator('.palette-input').isVisible())
  await page.keyboard.press('Escape')
  await page.locator('.pcard').first().click()
  await page.waitForSelector('.pd-note-ta')
  await shot('02-detail')
  const marker='SAVE-ON-CLOSE-'+Date.now()
  await page.locator('.pd-note-ta').fill(marker)
  await page.locator('.pd-x').click()
  await page.waitForFunction(async([id,text])=>(await window.api.myNotesGet(id)).includes(text),[firstId,marker])
  check('detail close flushes the pending note',true)
  await page.locator('.icon-btn[title="设置"]').click();await wait(300)
  const layout=await page.evaluate(()=>{
    const modal=document.querySelector('.set-modal'),side=document.querySelector('.set-side'),main=document.querySelector('.set-main'),footer=document.querySelector('.set-main>.modal-actions')
    return {direction:getComputedStyle(modal).flexDirection,side:side.getBoundingClientRect().right,main:main.getBoundingClientRect().left,footer:footer.getBoundingClientRect().bottom,height:innerHeight}
  })
  check('settings has usable two-column layout',layout.direction==='row'&&layout.main>=layout.side-1&&layout.footer<=layout.height)
  const originalTranslateTarget=(await page.evaluate(()=>window.api.getSettings())).translateTarget
  const settingsMarker='设置保存回归-'+Date.now()
  await page.locator('.field').filter({hasText:'翻译目标语言'}).locator('input').fill(settingsMarker)
  await page.locator('.set-main > .modal-actions button').filter({hasText:'保存'}).click()
  await page.waitForSelector('.set-modal',{state:'detached',timeout:10000})
  check('settings footer save persists a changed field',(await page.evaluate(()=>window.api.getSettings())).translateTarget===settingsMarker)
  await page.locator('.icon-btn[title="设置"]').click();await wait(300)
  await page.locator('.field').filter({hasText:'翻译目标语言'}).locator('input').fill(originalTranslateTarget)
  await page.locator('.set-modal .modal-x[title="关闭（自动保存）"]').click()
  await page.waitForSelector('.set-modal',{state:'detached',timeout:10000})
  check('settings close action auto-saves restored value',(await page.evaluate(()=>window.api.getSettings())).translateTarget===originalTranslateTarget)
  await page.locator('.icon-btn[title="设置"]').click();await wait(300)
  await shot('03-settings')
  await page.locator('.set-nav-item').filter({hasText:'智能体'}).click();await wait(100)
  const timeoutInput=page.locator('.set-row').filter({hasText:'单任务超时（分钟）'}).locator('input')
  check('agent timeout is configurable in settings',await timeoutInput.inputValue()==='10')
  await timeoutInput.fill('11')
  await page.keyboard.press('Escape')
  await page.waitForSelector('.set-modal',{state:'detached',timeout:10000})
  check('agent timeout setting persists on auto-save',(await page.evaluate(()=>window.api.getSettings())).agentTimeoutMinutes===11)
  await page.locator('.icon-btn[title="设置"]').click();await wait(300)
  await page.locator('.set-nav-item').filter({hasText:'模型服务'}).click();await shot('04-models')
  await page.keyboard.press('Escape')
  await navigate('纵览（文献表格 / 知识体系 / 统计）');await shot('05-table')
  await page.locator('.ov-tab').filter({hasText:'统计'}).click();await wait(200);await shot('06-stats')
  await page.locator('.ov-tab').filter({hasText:'知识'}).click();await wait(200)
  const graphCanvas=page.locator('.kv-canvas-wrap canvas').first()
  await graphCanvas.waitFor({state:'visible',timeout:20000});await wait(400)
  const graphBox=await graphCanvas.boundingBox()
  await graphCanvas.dispatchEvent('wheel',{deltaY:-120,clientX:graphBox.x+graphBox.width/2,clientY:graphBox.y+graphBox.height/2,bubbles:true,cancelable:true});await wait(150)
  check('knowledge graph wheel zoom updates viewport',(await page.locator('.kv-zoom-value').first().textContent()).includes('112'))
  await page.locator('.kv-chip').filter({hasText:'主题星系'}).click();await wait(500)
  const galaxy=page.locator('.kv-galaxy')
  await galaxy.waitFor({state:'visible',timeout:20000})
  const galaxyBox=await galaxy.boundingBox()
  await galaxy.dispatchEvent('wheel',{deltaY:-120,clientX:galaxyBox.x+galaxyBox.width/2,clientY:galaxyBox.y+galaxyBox.height/2,bubbles:true,cancelable:true});await wait(150)
  check('topic galaxy supports wheel zoom',(await page.locator('.kv-galaxy .kv-zoom-value').textContent()).includes('112'))
  await shot('07-knowledge')
  await navigate('AI 对比表格');await shot('08-compare')
  await navigate('笔记中心');await shot('09-notes')
  const firstNote=page.locator('.note-card').first()
  await firstNote.getByRole('button',{name:'编辑',exact:true}).click()
  const originalDir=path.dirname(papers[0].path)
  fs.renameSync(originalDir,originalDir+'.offline')
  try{
    await page.locator('.note-edit-area').fill('RECOVERABLE-FAILED-SAVE')
    await page.waitForFunction(()=>document.querySelector('.note-save')?.textContent.includes('保存失败'))
    check('failed save retains a visible draft',await page.evaluate(()=>localStorage.getItem('cspaper.note-draft.'+String(window.__testFirstId||1))!==null))
  }finally{fs.renameSync(originalDir+'.offline',originalDir)}
  await page.locator('.note-edit-area').fill('Recovered successfully')
  await page.waitForFunction(()=>document.querySelector('.note-save')?.textContent==='已保存')
  check('save can recover after file access returns',true)
  await firstNote.getByRole('button',{name:'问这篇笔记',exact:true}).click();await wait(300)
  check('notes entry opens unified chat with explicit note context',(await page.locator('.chat-wrap .hero-textarea').inputValue()).includes('笔记和标注'))
  const notePrompt=await page.locator('.chat-wrap .hero-textarea').inputValue()
  await page.locator('.chat-wrap .send-btn').click()
  const noteTurn=await waitForTurn(notePrompt, ['completed','partial','failed','cancelled'])
  check('note context becomes a persisted citable source',noteTurn.run.context.refs.some(ref=>ref.kind==='note')&&noteTurn.run.sources.some(source=>source.kind==='note'))
  await navigate('文献浏览器');await shot('10-web')
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('cspaper:workspace-action',{detail:{kind:'chat',paperIds:[],web:[{url:'https://example.org/cspaper-web-source',title:'可核实 Web 来源',snippet:'这是一段可核实的 Web 检索摘要。',documentVersion:'web:test:1'}],prompt:'WEB-CONTEXT：请评估这个来源的证据强度',fresh:true}})))
  await page.waitForFunction(()=>String(document.querySelector('.chat-wrap .hero-textarea')?.value||'').includes('WEB-CONTEXT'))
  await page.locator('.chat-wrap .send-btn').click()
  const webTurn=await waitForTurn('WEB-CONTEXT：请评估这个来源的证据强度')
  check('web search context becomes a persisted citable source',webTurn.run.context.refs.some(ref=>ref.kind==='web'&&ref.url==='https://example.org/cspaper-web-source')&&webTurn.run.sources.some(source=>source.kind==='web'&&source.title==='可核实 Web 来源'))
  const thinkingButton=page.locator('.chat-wrap .ctl-pill').filter({hasText:/思考/}).first()
  await thinkingButton.click();await wait(100)
  const levelText=await page.locator('.chat-wrap .pill-menu').first().innerText()
  check('thinking levels follow the active model',/极低|超高|最高/.test(levelText))
  await page.locator('.chat-wrap .pill-add-form input').fill('ultra')
  await page.locator('.chat-wrap .pill-add-form button').click();await wait(300)
  await page.keyboard.press('Escape');await wait(100)
  check('thinking levels can be extended inline',(await thinkingButton.innerText()).includes('ultra'))
  const collectionId=await page.evaluate(async()=>{
    const id=await window.api.collectionsCreate('统一上下文集合')
    for(let paperId=1;paperId<=3;paperId++)await window.api.collectionsTogglePaper(paperId,id,true)
    return id
  })
  await page.locator('.chat-wrap .chat-context-picker>.wb-pill').click();await wait(100)
  await page.locator('.chat-context-list button').filter({hasText:'统一上下文集合'}).click()
  await page.locator('.chat-context-pop footer button.primary').click();await wait(100)
  await page.locator('.chat-wrap .hero-textarea').fill('COLLECTION-CONTEXT：请基于统一集合回答')
  await page.locator('.chat-wrap .send-btn').click()
  const collectionTurn=await waitForTurn('COLLECTION-CONTEXT：请基于统一集合回答')
  check('collection context is an explicit persisted object',collectionTurn.run.context.refs.some(ref=>ref.kind==='collection'&&ref.collectionId===collectionId))
  await navigate('文献库')
  await page.locator('.pcard').first().dblclick()
  await page.waitForSelector('.reader-surface:not(.pane-hidden) .page-wrap canvas',{timeout:20000})
  await page.locator('.reading-focus-toggle').click();await wait(100)
  check('PDF exposes a reading-specific focus timer',await page.locator('.reading-focus-panel').isVisible())
  await page.getByRole('button',{name:'开始专注',exact:true}).click();await wait(1100)
  const focusRunning=await page.locator('.reading-focus-toggle').innerText()
  await page.locator('.top-switch button').filter({hasText:'Work'}).click();await wait(100)
  await page.locator('.top-switch button').filter({hasText:'Paper'}).click();await wait(200)
  const focusAfterLeave=await page.locator('.reading-focus-toggle').innerText()
  check('reading timer runs only while the PDF view is foreground',focusRunning.includes('文献阅读 24:')&&!focusAfterLeave.includes('24:')&&await page.getByRole('button',{name:'继续',exact:true}).isVisible())
  await page.locator('.reading-focus-reminders button').filter({hasText:'已喝水'}).click()
  await page.locator('.reading-focus-reminders button').filter({hasText:'已活动'}).click()
  await page.locator('.reading-focus-toggle').click()
  await page.evaluate(async id=>{const ended=new Date().toISOString();await window.api.focusLog({paperId:id,phase:'reading',seconds:25*60,startedAt:new Date(Date.now()-25*60*1000).toISOString(),endedAt:ended})},firstId)
  await wait(500);await shot('11-reader')
  await page.locator('.reader-surface button[title="末页"]').click();await wait(600)
  await page.waitForFunction(()=>[...document.querySelectorAll('.reader-surface .textLayer')].some(el=>el.textContent.includes('Page three reproducibility limitation and uncertainty analysis conclusion.')),null,{timeout:10000})
  await page.evaluate(()=>{
    const walker=document.createTreeWalker(document.querySelector('.reader-surface')??document.body,NodeFilter.SHOW_TEXT)
    let node=walker.nextNode()
    while(node&&!(node.nodeValue??'').includes('Page three reproducibility limitation and uncertainty analysis conclusion.'))node=walker.nextNode()
    if(!node?.parentElement)throw new Error('page-three text node missing')
    const range=document.createRange();range.selectNodeContents(node.parentElement)
    const selection=getSelection();selection?.removeAllRanges();selection?.addRange(range)
    document.querySelector('.viewer-scroll')?.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,cancelable:true}))
  })
  await page.waitForSelector('.float-bar',{timeout:10000})
  await page.getByRole('button',{name:'解释',exact:true}).click();await wait(300)
  await page.waitForFunction(()=>[...document.querySelectorAll('.side .msg.assistant .bubble')].some(el=>el.textContent.includes('研究方法和证据')))
  const exactPageTurn=await waitForTurn('解释一下这段话：\n「Page three reproducibility limitation and uncertainty analysis conclusion.」')
  const exactSelection=exactPageTurn.run.context.refs.find(ref=>ref.kind==='selection')
  const exactSource=exactPageTurn.run.sources.find(source=>source.kind==='paper_selection'&&source.snippet.includes('Page three reproducibility limitation'))
  check('explicit PDF selection preserves page-three identity',exactSelection?.page===3&&exactSource?.locator.page===3)
  const exactCitationCount=await page.locator('.side .msg.assistant .cite-chip:not(:disabled)').count()
  if(!exactCitationCount)throw new Error('exact selection citation chip missing: '+JSON.stringify(await page.locator('.side .msg.assistant').last().evaluate(el=>el.innerHTML).then(value=>value.slice(0,2000))))
  await page.locator('.side .msg.assistant .cite-chip:not(:disabled)').last().click()
  await page.waitForFunction(()=>document.querySelector('.reader-surface:not(.pane-hidden) .page-ind')?.textContent?.trim()==='3 / 3',null,{timeout:10000})
  await page.waitForSelector('.reader-surface:not(.pane-hidden) .jump-hit',{timeout:10000})
  check('multi-page selection citation opens page three and highlights exact text',true)
  await page.locator('.reader-surface button[title="首页"]').click()
  await page.locator('.reader-surface button[title="末页"]').click();await wait(100)
  await page.locator('.reader-surface .tab .x').click()
  await page.waitForFunction(async id=>(await window.api.listPapers()).find(p=>p.id===id)?.last_page===3,firstId,{timeout:5000})
  check('closing a PDF tab flushes pending last-page progress',true)
  await page.locator('.paper-item').filter({hasText:papers[0].title}).first().click();await wait(500)
  await page.waitForFunction(()=>document.querySelector('.reader-surface:not(.pane-hidden) .page-ind')?.textContent?.trim()==='3 / 3',null,{timeout:10000})
  check('reopened PDF restores the flushed page',true)
  await page.locator('.side-rail button[title="问答"]').click();await wait(300)
  await page.locator('.side .chat-input').fill('阅读侧栏也必须走统一会话')
  await page.locator('.side .send-btn').click()
  await page.waitForFunction(()=>[...document.querySelectorAll('.side .msg.assistant .bubble')].some(el=>el.textContent.includes('研究方法和证据')))
  const sideConversation=await page.evaluate(async()=>{
    const page=await window.api.chat.listConversations({limit:1})
    const messages=await window.api.chat.loadMessages({conversationId:page.items[0].id,limit:10})
    return {id:page.items[0].id,text:JSON.stringify(messages.items)}
  })
  check('reader sidebar shares the persistent conversation',sideConversation.text.includes('阅读侧栏也必须走统一会话'))
  await page.setViewportSize({width:1100,height:760});await wait(300)
  const width=await page.locator('.reader-surface').evaluate(el=>el.getBoundingClientRect().width)
  check('narrow reader keeps the document primary',width>650)
  await shot('12-reader-narrow')
  await page.locator('.icon-btn[title*="显示 问答"]').click();await wait(100)
  const overlay=await page.locator('.side-wrap').evaluate(el=>getComputedStyle(el).position)
  check('narrow assistant opens as an overlay',overlay==='absolute')
  await page.locator('.icon-btn[title*="隐藏 问答"]').click()
  await page.setViewportSize({width:1500,height:940})
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('cspaper:translate-request',{detail:{text:'SLOW-TRANSLATION 统一运行时翻译取消验收',context:'translation page context'}})))
  await page.waitForSelector('text=停止',{timeout:10000})
  const translationTurn=await page.evaluate(async()=>{
    const workspace=await window.api.chat.workspace()
    const page=await window.api.chat.listConversations({workspaceId:workspace.workspaceId,limit:10})
    const conversation=page.items.find(item=>item.title.includes('SLOW-TRANSLATION'))
    if(!conversation)throw new Error('translation conversation missing')
    const loaded=await window.api.chat.loadMessages({conversationId:conversation.id,limit:10})
    const assistant=loaded.items.find(message=>message.runId)
    if(!assistant?.runId)throw new Error('translation run missing')
    return {conversation,run:await window.api.chat.getRun(assistant.runId)}
  })
  check('reader translation uses a persisted selection run',translationTurn.run.context?.promptKind==='translation'&&translationTurn.run.sources.some(source=>source.kind==='paper_selection'))
  await page.getByRole('button',{name:'停止',exact:true}).click()
  const translationRunId=translationTurn.run.run?.id
  if(!translationRunId)throw new Error('translation run id missing')
  await page.waitForFunction(async runId=>(await window.api.chat.getRun(runId)).run?.status==='cancelled',translationRunId,{timeout:10000})
  check('reader translation cancellation uses unified runtime',true)
  await page.locator('.side-rail button[title="全文翻译"]').click();await wait(300)
  await page.getByRole('button',{name:'翻译本页',exact:true}).click()
  await page.waitForFunction(()=>document.body.textContent?.includes('本页翻译完成'),null,{timeout:30000})
  const fullPageTranslation=await page.evaluate(async()=>{
    const workspace=await window.api.chat.workspace()
    const page=await window.api.chat.listConversations({workspaceId:workspace.workspaceId,limit:20})
    const conversation=page.items.find(item=>item.title.startsWith('翻译：'))
    if(!conversation)return null
    const loaded=await window.api.chat.loadMessages({conversationId:conversation.id,limit:200})
    const runs=await Promise.all(loaded.items.filter(message=>message.runId).map(message=>window.api.chat.getRun(String(message.runId))))
    return {conversation,messages:loaded.items,runs}
  })
  check('full-page translation is persisted as unified translation runs',!!fullPageTranslation&&fullPageTranslation.runs.length>1&&fullPageTranslation.runs.every(item=>item.context?.promptKind==='translation'&&item.run?.status==='completed'))
  await navigate('与文献库对话');await wait(300)
  await page.locator('.chat-context-picker>.wb-pill').click();await wait(100)
  await page.locator('.chat-context-pop footer button').first().click();await wait(100)
  for(let i=0;i<3;i++)await page.locator('.chat-context-list button').nth(i).click()
  await page.locator('.chat-context-pop footer button.primary').click();await wait(100)
  check('context picker selects exact platform papers',(await page.locator('.chat-context-chip').count())===3)
  await page.locator('.chat-wrap .hero-textarea').fill('请比较三篇文献第3页的 reproducibility limitation and uncertainty analysis')
  await page.locator('.chat-wrap .send-btn').click()
  await page.waitForSelector('.chat-wrap .msg.assistant .bubble',{timeout:30000})
  await page.waitForFunction(()=>[...document.querySelectorAll('.msg.assistant .bubble')].some(el=>el.textContent.includes('研究方法和证据')))
  await page.waitForFunction(async()=>{
    const workspace=await window.api.chat.workspace()
    const page=await window.api.chat.listConversations({workspaceId:workspace.workspaceId,limit:1})
    const conversation=page.items[0]
    if(!conversation)return false
    const loaded=await window.api.chat.loadMessages({conversationId:conversation.id,limit:20})
    const assistant=loaded.items.filter(message=>message.runId).at(-1)
    if(!assistant?.runId)return false
    const run=await window.api.chat.getRun(assistant.runId)
    return ['completed','partial','failed'].includes(run.run?.status)
  },null,{timeout:30000})
  await wait(500)
  const persistedChat=await page.evaluate(async()=>{
    const workspace=await window.api.chat.workspace()
    const page=await window.api.chat.listConversations({workspaceId:workspace.workspaceId,limit:1})
    const conversation=page.items[0]
    const loaded=await window.api.chat.loadMessages({conversationId:conversation.id,limit:20})
    const items=loaded.items||[]
    const run=await window.api.chat.getRun(items.filter(m=>m.runId).at(-1)?.runId)
    return {conversation,messages:items,run,context:run.context}
  })
  check('unified chat turn persists messages and run',persistedChat.messages.some(m=>m.role==='user'&&m.parts.some(part=>part.type==='text'&&part.text.includes('请比较三篇文献第3页')))&&['completed','partial'].includes(persistedChat.run.run?.status)&&persistedChat.context?.refs?.length===3)
  await shot('16-chat')
  check('answer citations are interactive',await page.locator('.chat-wrap .msg.assistant .cite-chip:not(:disabled)').count()>0)
  await page.evaluate(slug=>window.dispatchEvent(new CustomEvent('cspaper:workspace-action',{detail:{kind:'citation',slug,page:1,probe:'version check',documentVersion:'0:0'}})),papers[0].slug)
  await page.waitForSelector('.ref-viewer',{timeout:10000})
  await page.waitForSelector('.ref-viewer .ref-head .source-badge.record',{timeout:10000})
  check('citation viewer warns when the source document version changed',true)
  await page.locator('.ref-viewer button[title="关闭引用面板"]').click();await wait(100)
  await page.locator('.chat-wrap .msg.assistant .cite-chip:not(:disabled)').last().click()
  await page.waitForSelector('.ref-viewer',{state:'attached',timeout:10000})
  const citedSource=persistedChat.run.sources.find(source=>source.id===persistedChat.messages.at(-1).parts.find(part=>part.type==='sources').sourceIds[0])
  check('citation opens the document named by this answer',await page.locator('.ref-viewer .ref-title').getAttribute('title')===citedSource.title)
  await page.waitForFunction(expectedPage=>document.querySelector('.ref-viewer .page-ind')?.textContent?.trim()===`p.${expectedPage} / 3`,citedSource.locator.page,{timeout:10000})
  await page.waitForSelector('.ref-viewer .jump-hit',{timeout:10000})
  check('retrieved citation opens its exact persisted source page',!!citedSource.locator.page)
  await page.locator('.ref-viewer button[title="把这段引用原文加入新的统一对话"]').click();await wait(300)
  check('reference viewer starts a fresh exact-selection conversation',(await page.locator('.chat-wrap .hero-textarea').inputValue()).includes('请围绕这段引用原文')&&await page.locator('.ref-viewer').count()===0)
  const editedTurn=await page.evaluate(async()=>{
    const workspace=await window.api.chat.workspace()
    const page=await window.api.chat.listConversations({workspaceId:workspace.workspaceId,limit:20})
    let conversation=null,loaded=null,original=null
    for(const item of page.items){
      const candidate=await window.api.chat.loadMessages({conversationId:item.id,limit:20})
      const hit=candidate.items.find(message=>message.role==='user'&&message.parts.some(part=>part.type==='text'&&part.text.includes('请比较三篇文献第3页')))
      if(hit){conversation=item;loaded=candidate;original=hit;break}
    }
    const assistant=loaded.items.find(message=>message.role==='assistant'&&message.runId&&message.parentId===original?.id)
    if(!original||!assistant?.runId)throw new Error('unified chat turn not found')
    const run=await window.api.chat.getRun(assistant.runId)
    return window.api.chat.editAndResubmit({conversationId:conversation.id,messageId:original.id,text:'EDIT-BRANCH：请基于同一上下文继续回答',context:run.context?.refs??[]})
  })
  const editedResult=await waitForTurn('EDIT-BRANCH：请基于同一上下文继续回答')
  check('edit-and-resubmit exposes a persisted branch IPC',editedTurn.userMessage.parentId===editedResult.messages.find(message=>message.role==='user'&&message.parts.some(part=>part.type==='text'&&part.text.includes('EDIT-BRANCH')))?.parentId)
  await page.reload();await page.waitForSelector('.workspace-nav',{timeout:30000});await wait(600)
  check('unified chat survives renderer reload',(await page.locator('.chat-log .msg').count())>=2&&(await page.locator('.chat-log .msg.assistant').count())>=1)
  check('full chat exposes a persistent delete action per session',await page.locator('.chat-conversation-delete').count()>=1)
  await navigate('文献库');await page.locator('.pcard').first().dblclick()
  await page.waitForSelector('.reader-surface:not(.pane-hidden) .page-wrap canvas',{timeout:20000})
  await page.locator('.top-switch button').filter({hasText:'Work'}).click();await wait(300)
  const workBrand=await page.locator('.wb-brand .brand-icon').evaluate(img=>({complete:img.complete,naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight,src:img.currentSrc||img.src}))
  check('Work reuses the same canonical brand asset',workBrand.complete&&workBrand.naturalWidth===902&&workBrand.src===titleBrand.src)
  check('Work opens with a real today dashboard',await page.locator('.wb-today').isVisible()&&await page.locator('.wb-today-metrics').isVisible())
  await shot('13-work')
  await page.locator('.wb-nav-item').filter({hasText:'科研日历'}).click()
  await page.waitForSelector('.research-focus-summary')
  check('calendar summarizes real reading focus records',(await page.locator('.research-focus-summary').innerText()).includes('25'))
  for(const view of ['周','日','议程']){await page.locator('.research-calendar-views button').filter({hasText:view}).click();await wait(100)}
  check('calendar provides month, week, day and agenda views',await page.locator('.research-calendar-list').isVisible())
  await page.locator('.research-calendar-views button').filter({hasText:'月'}).click();await wait(100)
  await page.getByRole('button',{name:'新建日程'}).click()
  await page.locator('.research-calendar-form label').filter({hasText:'标题'}).locator('input').fill('科研投稿截止')
  await page.locator('.research-calendar-form label').filter({hasText:'类型'}).locator('select').selectOption('deadline')
  await page.locator('.research-calendar-form label').filter({hasText:'备注'}).locator('textarea').fill('准备论文摘要和图表')
  await page.getByRole('button',{name:'保存日程'}).click()
  await page.locator('.research-calendar-event').filter({hasText:'科研投稿截止'}).waitFor({timeout:10000})
  await page.getByRole('button',{name:'标记完成：科研投稿截止'}).click()
  await page.getByRole('button',{name:'标记未完成：科研投稿截止'}).waitFor({timeout:10000})
  check('research calendar saves and completes a deadline',await page.locator('.research-calendar-event').filter({hasText:'科研投稿截止'}).count()===1)
  await page.locator('.research-calendar-event').filter({hasText:'科研投稿截止'}).getByRole('button',{name:'交给 Work'}).click()
  check('calendar event can be brought into a Work draft',(await page.locator('.wb-compose-input').inputValue()).includes('科研投稿截止'))
  await page.locator('.wb-compose-input').fill('')
  await page.locator('.wb-nav-item').filter({hasText:'科研日历'}).click()
  await page.locator('.research-calendar-event').filter({hasText:'科研投稿截止'}).getByRole('button',{name:'删除'}).click()
  await page.locator('dialog[open] .dlg-btn.danger').click()
  await page.locator('.research-calendar-event').filter({hasText:'科研投稿截止'}).waitFor({state:'detached',timeout:10000})
  check('research calendar deletion removes the persisted event',await page.locator('.research-calendar-event').filter({hasText:'科研投稿截止'}).count()===0)
  await page.getByRole('button',{name:'新建任务',exact:false}).first().click()
  const taskId=await page.evaluate(async()=>{const plan=await window.api.agentPlan('检查文献库并保存一条阅读笔记');await window.api.agentRun(plan.id);return plan.id})
  const task=await waitForAgent(taskId)
  check('agent completes its confirmed tools',task?.status==='done')
  check('agent completion produces a real saved note',(await page.evaluate(id=>window.api.myNotesGet(id),firstId)).includes('E2E-VERIFIED-NOTE'))
  const mirroredTask=await page.evaluate(async()=>{
    const page=await window.api.chat.listConversations({limit:20})
    const conversation=page.items.find(item=>item.title.includes('检查文献库并保存'))
    if(!conversation)return null
    const loaded=await window.api.chat.loadMessages({conversationId:conversation.id,limit:20})
    return {conversation,messages:loaded.items}
  })
  check('legacy work task mirrors into unified conversation',!!mirroredTask&&mirroredTask.messages.some(message=>message.role==='user'&&JSON.stringify(message.parts).includes('检查文献库并保存')))
  partialMode=true
  const partialId=await page.evaluate(async()=>{const t=await window.api.agentPlan('生成综述');await window.api.agentRun(t.id);return t.id})
  check('unexecuted plan steps are partial, not done',(await waitForAgent(partialId)).status==='partial')
  await page.locator('.top-switch button').filter({hasText:'Paper'}).click();await wait(100)
  await page.locator('.top-switch button').filter({hasText:'Work'}).click();await wait(300)
  await page.locator('.wb-compose-input').fill('统一运行时执行真实工具并保存笔记')
  await page.locator('.wb-send:not(.stop)').click()
  const unifiedTurn=await waitForTurn('统一运行时执行真实工具并保存笔记')
  check('work composer launches the unified act runtime',unifiedTurn.run.run.status==='completed'&&unifiedTurn.run.events.some(event=>event.type==='tool.completed'))
  check('unified act tool writes a real platform note',(await page.evaluate(id=>window.api.myNotesGet(id),firstId)).includes('UNIFIED-ACT-VERIFIED'))
  await page.locator('.wb-compose-input').fill('SLOW-WORK-FOLLOW-UP：验证运行中继续输入会排队')
  await page.locator('.wb-send[title="创建任务"]').click()
  await page.waitForSelector('.wb-send[title="停止当前任务"]',{timeout:10000})
  await page.locator('.wb-compose-input').fill('SLOW-WORK-FOLLOW-UP：运行期间追加第二条任务')
  check('running Work composer keeps both send and stop actions',await page.locator('.wb-send[title="排队跟进当前任务"]').isEnabled()&&await page.locator('.wb-send[title="停止当前任务"]').isEnabled())
  await page.locator('.wb-send[title="排队跟进当前任务"]').click()
  const queuedWhileRunning=await page.waitForFunction(async()=>{
    const page=await window.api.chat.listConversations({limit:20})
    const conversation=page.items.find(item=>item.title.includes('SLOW-WORK-FOLLOW-UP'))
    if(!conversation)return false
    const loaded=await window.api.chat.loadMessages({conversationId:conversation.id,limit:20})
    const runIds=loaded.items.filter(message=>message.runId).map(message=>message.runId)
    const runs=await Promise.all(runIds.map(runId=>window.api.chat.getRun(runId)))
    return runs.length>=2&&runs.some(item=>item.run?.status==='queued')&&runs.some(item=>['preparing','generating','executing_tools'].includes(item.run?.status??''))
  },null,{timeout:8000,polling:100})
  check('follow-up submitted while running persists as a queued run',!!queuedWhileRunning)
  await page.waitForFunction(async()=>{
    const page=await window.api.chat.listConversations({limit:20})
    const conversation=page.items.find(item=>item.title.includes('SLOW-WORK-FOLLOW-UP'))
    if(!conversation)return false
    const loaded=await window.api.chat.loadMessages({conversationId:conversation.id,limit:20})
    const runIds=loaded.items.filter(message=>message.runId).map(message=>message.runId)
    if(runIds.length<2)return false
    const runs=await Promise.all(runIds.map(runId=>window.api.chat.getRun(runId)))
    return runs.every(item=>item.run?.status==='completed')
  },null,{timeout:30000,polling:250})
  check('queued Work follow-up executes after the active run completes',true)
  await page.getByRole('button',{name:'新建任务',exact:false}).first().click()
  await page.locator('.wb-compose-input').fill('SLOW-WORK-FOLLOW-UP：停止当前任务回归')
  await page.locator('.wb-send[title="创建任务"]').click()
  await page.waitForSelector('.wb-send[title="停止当前任务"]',{timeout:10000})
  await page.locator('.wb-compose-input').fill('SLOW-WORK-FOLLOW-UP：停止后的排队任务')
  await page.locator('.wb-send[title="排队跟进当前任务"]').click()
  await page.waitForFunction(async()=>{
    const conversations=await window.api.chat.listConversations({limit:50})
    const conversation=conversations.items.find(item=>item.title.includes('停止当前任务回归'))
    if(!conversation)return false
    const messages=await window.api.chat.loadMessages({conversationId:conversation.id,limit:20})
    const runs=await Promise.all(messages.items.filter(item=>item.runId).map(item=>window.api.chat.getRun(item.runId)))
    return runs.length===2&&runs.some(item=>item.run?.status==='queued')&&runs.some(item=>['preparing','generating','executing_tools'].includes(item.run?.status??''))
  },null,{timeout:8000,polling:100})
  await page.locator('.wb-compose-input').fill('SLOW-WORK-FOLLOW-UP：取消这条排队任务')
  await page.locator('.wb-send[title="排队跟进当前任务"]').click()
  await page.getByRole('button',{name:'取消排队',exact:true}).last().click()
  const cancelledQueued=await waitForTurn('SLOW-WORK-FOLLOW-UP：取消这条排队任务',['cancelled'])
  check('queued follow-up can be cancelled without stopping the active turn',cancelledQueued.run.run.status==='cancelled'&&(await getTurn('SLOW-WORK-FOLLOW-UP：停止当前任务回归')).run.run.status!=='cancelled')
  await page.locator('.wb-send[title="停止当前任务"]').click()
  const stopped=await waitForTurn('SLOW-WORK-FOLLOW-UP：停止当前任务回归',['cancelled'])
  const next=await waitForTurn('SLOW-WORK-FOLLOW-UP：停止后的排队任务')
  check('stop targets the running turn and leaves its queued follow-up intact',stopped.run.run.status==='cancelled'&&next.run.run.status==='completed')
  await page.getByRole('button',{name:'新建任务',exact:false}).first().click()
  await page.locator('.wb-compose-input').fill('/goal UI回归长期研究目标')
  await page.locator('.wb-send[title="创建任务"]').click()
  await page.locator('.wb-pill[title="选择本次任务使用的技能"]').click()
  await page.locator('.wb-skill-pop .wb-pop-item').filter({hasText:'精读笔记'}).click()
  await page.locator('.wb-pill[title="选择本次任务使用的技能"]').click()
  await page.locator('.wb-compose-input').fill('/plan 只规划测试任务')
  await page.locator('.wb-send[title="创建任务"]').click()
  const planOnly=await waitForTurn('只规划测试任务')
  check('plan command only creates a reviewable plan and snapshots the research goal',planOnly.run.run.status==='completed'&&planOnly.run.context.promptKind==='plan'&&planOnly.run.context.researchGoal==='UI回归长期研究目标'&&planOnly.run.events.some(event=>event.type==='plan.created')&&!planOnly.run.events.some(event=>event.type==='tool.started'))
  check('selected skill is snapshotted and reaches the planner',planOnly.run.context.skills?.some(skill=>skill.name==='精读笔记'&&skill.body.includes('质量门'))&&plannerRequests.some(messages=>JSON.stringify(messages).includes('质量门')&&JSON.stringify(messages).includes('只规划测试任务')))
  const planUser=planOnly.messages.find(message=>message.role==='user'&&message.parts.some(part=>part.type==='text'&&part.text==='只规划测试任务'))
  await page.evaluate(({conversationId,messageId})=>window.api.chat.editAndResubmit({conversationId,messageId,text:'编辑后的只读计划',context:[]}),{conversationId:planOnly.conversation.id,messageId:planUser.id})
  const editedPlan=await waitForTurn('编辑后的只读计划')
  check('editing a plan preserves plan-only mode and the original skill snapshot',editedPlan.run.context.promptKind==='plan'&&editedPlan.run.context.skills?.some(skill=>skill.name==='精读笔记')&&!editedPlan.run.events.some(event=>event.type==='tool.started'))
  await page.locator('.wb-skill-chip[title="移除技能：精读笔记"]').click()
  await page.locator('.wb-compose-input').fill('/goal')
  await page.locator('.wb-send[title="创建任务"]').click()
  await page.locator('.wb-pill[title^="执行权限"]').click();await wait(100)
  await page.locator('.wb-pop button').filter({hasText:'执行前确认'}).click();await wait(100)
  await page.locator('.wb-compose-input').fill('统一审批流暂停写入并等待确认')
  await page.locator('.wb-send:not(.stop)').click()
  await page.waitForSelector('text=需要确认',{timeout:60000})
  const waitingTurn=await waitForTurn('统一审批流暂停写入并等待确认',['awaiting_approval'])
  const approval=waitingTurn.run.events.find(event=>event.type==='approval.required')
  assert.ok(approval?.payload?.toolCallId)
  await page.getByRole('button',{name:'批准执行',exact:true}).click()
  const approvedTurn=await waitForTurn('统一审批流暂停写入并等待确认')
  check('unified runtime enforces per-tool approval',approvedTurn.run.run.status==='completed'&&approvedTurn.run.events.filter(event=>event.type==='tool.completed'&&event.payload.tool==='note.save').length===1)
  await page.locator('.wb-pill[title^="执行权限"]').click();await wait(100)
  await page.locator('.wb-pop button').filter({hasText:'完全访问'}).click();await wait(100)
  await page.locator('.wb-composer .chat-context-picker>.wb-pill').click();await wait(100)
  for(let i=0;i<3;i++)await page.locator('.wb-composer .chat-context-list button').nth(i).click()
  await page.locator('.wb-composer .chat-context-pop footer button.primary').click();await wait(100)
  await page.locator('.wb-compose-input').fill('最终验收三篇文献：生成对比表并保存笔记')
  await page.locator('.wb-send:not(.stop)').click()
  const acceptance=await waitForTurn('最终验收三篇文献：生成对比表并保存笔记')
  const selectedIds=acceptance.run.context.refs.filter(ref=>ref.kind==='paper').map(ref=>ref.paperId)
  check('final research flow binds three selected papers',acceptance.run.run.status==='completed'&&selectedIds.length===3)
  const artifact=acceptance.run.artifacts.find(item=>item.kind==='comparison')
  const comparisons=await page.evaluate(()=>window.api.compareList())
  const comparison=comparisons.find(table=>String(table.id)===artifact?.entityId)
  check('final research flow creates a comparison for exactly the selected papers',comparison&&JSON.stringify([...comparison.data.paperIds].sort())===JSON.stringify([...selectedIds].sort())&&selectedIds.every(id=>Object.keys(comparison.data.cells[String(id)]??{}).length===3))
  const noteTexts=await page.evaluate(ids=>Promise.all(ids.map(id=>window.api.myNotesGet(id))),selectedIds)
  check('final research flow appends limitations to all corresponding notes',noteTexts.every(text=>text.includes('FINAL-ACCEPTANCE-NOTE'))&&noteTexts.some(text=>text.includes('UNIFIED-ACT-VERIFIED')))
  await shot('17-task-chat');await wait(250)
  check('task composer reserves space below the conversation',await page.evaluate(()=>document.querySelector('.chat-workspace-task').getBoundingClientRect().bottom<=document.querySelector('.wb-composer').getBoundingClientRect().top+1))
  check('work actions use explicit outcome labels',await page.getByRole('button',{name:'复制结果'}).count()===1&&await page.getByRole('button',{name:'导出 Markdown'}).count()===1&&await page.getByRole('button',{name:'宽屏阅读'}).count()===1&&await page.getByRole('button',{name:'继续任务'}).count()===1)
  const flatBubble=await page.locator('.chat-workspace-task .msg.user .bubble').first().evaluate(el=>({borderLeftWidth:getComputedStyle(el).borderLeftWidth,background:getComputedStyle(el).backgroundColor}))
  check('task user prompt removes the nested card',flatBubble.borderLeftWidth==='2px'&&flatBubble.background==='rgba(0, 0, 0, 0)')
  const beforeWide=await page.locator('.chat-workspace-task .chat-message-items').evaluate(el=>el.getBoundingClientRect().width)
  await page.getByRole('button',{name:'宽屏阅读'}).click();await wait(100)
  const afterWide=await page.locator('.chat-workspace-task .chat-message-items').evaluate(el=>el.getBoundingClientRect().width)
  check('wide reading actually expands the task conversation',afterWide>beforeWide)
  await page.getByRole('button',{name:'标准宽度'}).click();await wait(100)
  const deleteTarget=await page.evaluate(async()=>{
    const workspace=await window.api.chat.workspace()
    return window.api.chat.createConversation({workspaceId:workspace.workspaceId,title:'UI 删除会话回归',mode:'act',entry:'work'})
  })
  await page.locator('.top-switch button').filter({hasText:'Paper'}).click();await wait(100)
  await page.locator('.top-switch button').filter({hasText:'Work'}).click();await wait(300)
  const deleteRow=page.locator(`.wb-hist-row[data-conversation-id="${deleteTarget.id}"]`)
  check('work sessions expose a persistent delete action',await deleteRow.locator('button[title="永久删除会话"]').count()===1)
  await page.locator('.wb-nav-item').filter({hasText:'搜索'}).click()
  await page.locator('.wb-side-search input').fill('UI 删除会话回归')
  check('work search filters unified sessions without a false empty state',await page.locator('.wb-hist-row[data-conversation-id]').count()===1&&await deleteRow.isVisible()&&await page.getByText('没有匹配的任务',{exact:true}).count()===0)
  await page.locator('.wb-side-search input').fill('')
  await page.locator('.wb-nav-item').filter({hasText:'搜索'}).click()
  await deleteRow.locator('button[title="永久删除会话"]').click();await wait(100)
  await page.locator('dialog[open] .dlg-btn.danger').click()
  await deleteRow.waitFor({state:'detached',timeout:10000})
  const missingConversation=await page.evaluate(async id=>{
    try{await window.api.chat.getConversation(id);return false}catch{return true}
  },deleteTarget.id)
  check('work session deletion removes the persisted conversation',missingConversation)
  await page.evaluate(()=>document.documentElement.setAttribute('data-theme','dark'));await shot('14-work-dark')
  await page.locator('.top-switch button').filter({hasText:'Paper'}).click()
  check('reader survives switching work modes',await page.locator('.reader-surface .page-wrap canvas').count()>0)
  await shot('15-reader-dark')
  await navigate('笔记中心')
  await page.getByRole('button',{name:'独立笔记',exact:false}).click()
  await page.waitForSelector('dialog[open] .dlg-input')
  check('native prompt traps focus',await page.evaluate(()=>document.querySelector('dialog')?.matches(':modal')))
  await page.locator('.dlg-input').fill('可验证的独立笔记');await page.locator('.dlg-btn.primary').click()
  await page.waitForSelector('.snote-card');check('standalone note is persisted',(await page.evaluate(()=>window.api.standaloneNotesList())).some(n=>n.title==='可验证的独立笔记'))
  await page.getByRole('button',{name:'问这条笔记',exact:true}).click();await wait(300)
  await page.locator('.chat-wrap .send-btn').click()
  const standaloneTurn=await waitForTurn('请基于独立笔记《可验证的独立笔记》整理结论、风险和下一步行动。')
  check('standalone note becomes a persisted citable source',standaloneTurn.run.context.refs.some(ref=>ref.kind==='note'&&!ref.paperId)&&standaloneTurn.run.sources.some(source=>source.kind==='note'&&source.title==='可验证的独立笔记'))
  await browser.close().catch(()=>{})
  await run('taskkill',['/F','/PID',String(proc.pid),'/T'])
  await wait(1200)
  const seededHistory=await run(electron,[path.join(ROOT,'tests/fixtures/long-conversation.cjs'),data])
  assert.equal(seededHistory.code,0)
  proc=spawn(appExecutable,appArguments,{cwd:ROOT,env:{...process.env,CSPAPER_DATA_DIR:data},stdio:'ignore',windowsHide:true})
  for(let i=0;i<80;i++){try{const r=await fetch(debugUrl+'/json/version');if(r.ok)break}catch{}await wait(250)}
  browser=await chromium.connectOverCDP(debugUrl)
  page=null
  for(let i=0;i<80&&!page;i++){page=browser.contexts()[0]?.pages().find(p=>p.url().includes('index.html'));if(!page)await wait(250)}
  if(!page)throw new Error('Application did not restart')
  page.on('pageerror',error=>errors.push(String(error)))
  await page.waitForSelector('.workspace-nav',{timeout:30000})
  const restored=await getTurn('最终验收三篇文献：生成对比表并保存笔记')
  const restoredComparisons=await page.evaluate(()=>window.api.compareList())
  const restoredNotes=await page.evaluate(ids=>Promise.all(ids.map(id=>window.api.myNotesGet(id))),selectedIds)
  check('research state survives an application restart',restored?.run.run.status==='completed'&&restored.run.sources.length>0&&restored.run.artifacts.some(item=>item.id===artifact.id)&&restoredComparisons.some(table=>String(table.id)===artifact.entityId)&&restoredNotes.every(text=>text.includes('FINAL-ACCEPTANCE-NOTE')))
  await navigate('与文献库对话')
  await page.locator('.chat-conversations').getByTitle(restored.conversation.title,{exact:true}).click()
  await page.locator('.chat-wrap .hero-textarea').fill('重启后继续追问：请依据前面的比较说明局限')
  await page.locator('.chat-wrap .send-btn').click()
  const followUp=await waitForTurn('重启后继续追问：请依据前面的比较说明局限')
  check('follow-up after restart retains the original conversation branch',followUp.conversation.id===restored.conversation.id&&followUp.messages.find(message=>message.id===followUp.run.run.userMessageId).parentId===restored.run.run.assistantMessageId&&['completed','partial'].includes(followUp.run.run.status))
  await page.locator('.chat-conversations').getByTitle('长会话回归 600 条',{exact:true}).click()
  await page.waitForFunction(()=>document.querySelector('.chat-wrap .chat-log')?.scrollHeight>2000)
  await wait(300)
  check('long history keeps the rendered message count bounded',(await page.locator('.chat-wrap .msg').count())<50)
  const chatScroll=page.locator('.chat-wrap .chat-log')
  await chatScroll.evaluate(element=>{element.scrollTop=element.scrollHeight/2;element.dispatchEvent(new Event('scroll'))})
  await wait(200)
  await page.locator('.chat-wrap .hero-textarea').fill('长会话中阅读历史时收到新回答')
  await page.locator('.chat-wrap .send-btn').click()
  await waitForTurn('长会话中阅读历史时收到新回答')
  check('new messages do not steal the history reading position',await page.locator('.chat-wrap .chat-new-messages').isVisible()&&await chatScroll.evaluate(element=>element.scrollHeight-element.scrollTop-element.clientHeight>200))
  await page.locator('.chat-wrap .chat-new-messages').click()
  await chatScroll.evaluate(element=>{element.scrollTop=0;element.dispatchEvent(new Event('scroll'))})
  await page.locator('.chat-wrap').getByRole('button',{name:'加载更早的消息',exact:true}).click()
  await wait(500)
  check('history pagination stays virtualized',(await page.locator('.chat-wrap .msg').count())<50)
  check('math and code remain structured in long messages',await page.locator('.chat-wrap .katex').count()>0&&await page.locator('.chat-wrap pre code').count()>0)
  await shot('18-long-chat')
  check('no renderer exceptions',errors.length===0)
  fs.writeFileSync(path.join(TMP,'results.json'),JSON.stringify({passed,errors,captures:OUT},null,2))
  console.log(JSON.stringify({passed,errors,captures:OUT}))
}catch(error){console.error('UI_TEST_FAILED '+String(error.stack||error));if(page)await page.screenshot({path:path.join(OUT,'failure.png')}).catch(()=>{});process.exitCode=1}
finally{if(browser)await browser.close().catch(()=>{});await run('taskkill',['/F','/PID',String(proc.pid),'/T']);server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
