import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const root=process.cwd()
const electron=path.join(root,'node_modules/electron/dist/electron.exe')
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cspaper-window-cleanup-'))
const library=path.join(temp,'library');fs.mkdirSync(library,{recursive:true})
const server=http.createServer()
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const modelPort=server.address().port
const debugServer=http.createServer()
await new Promise(resolve=>debugServer.listen(0,'127.0.0.1',resolve))
const debugPort=debugServer.address().port
await new Promise(resolve=>debugServer.close(resolve))
const debugUrl=`http://127.0.0.1:${debugPort}`

let modelRequestSeen=false
let modelResponseClosed=false
server.on('request',(request,response)=>{
  let raw=''
  request.on('data',chunk=>raw+=chunk)
  request.on('end',()=>{
    if(!request.url?.includes('/chat/completions')) {
      response.writeHead(404);response.end();return
    }
    modelRequestSeen=true
    response.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache',Connection:'keep-alive'})
    response.on('close',()=>{modelResponseClosed=true})
    response.write(': slow\\n\\n')
  })
})

function run(command,args,options={}) {
  return new Promise(resolve=>{
    const child=spawn(command,args,{cwd:root,stdio:['ignore','pipe','pipe'],windowsHide:true,...options})
    let output=''
    child.stdout.on('data',data=>output+=String(data))
    child.stderr.on('data',data=>output+=String(data))
    child.on('exit',code=>resolve({code,output}))
  })
}
function killTree(child) {
  if(!child||child.exitCode!==null)return
  if(process.platform==='win32')spawn('taskkill',['/F','/PID',String(child.pid),'/T'],{stdio:'ignore'})
  else child.kill('SIGTERM')
}

let app
let browser
try {
  let seed=fs.readFileSync(path.join(root,'scripts/e2e-seed.cjs'),'utf8')
  seed=seed.replace("'F:/tmp/cspaper-sample'",JSON.stringify(library)).replaceAll('http://127.0.0.1:9390/v1',`http://127.0.0.1:${modelPort}/v1`)
  const seedFile=path.join(temp,'seed.cjs');fs.writeFileSync(seedFile,seed)
  const seeded=await run(electron,[seedFile,temp])
  if(seeded.code!==0||!seeded.output.includes('SEEDED'))throw new Error('fixture seed failed: '+seeded.output)

  app=spawn(electron,['.',`--remote-debugging-port=${debugPort}`],{cwd:root,env:{...process.env,CSPAPER_DATA_DIR:temp},stdio:['ignore','ignore','ignore'],windowsHide:true})
  for(let i=0;i<80;i++) {
    try{const response=await fetch(`${debugUrl}/json/version`);if(response.ok)break}catch{}
    await new Promise(resolve=>setTimeout(resolve,250))
  }
  browser=await chromium.connectOverCDP(debugUrl)
  let page
  for(let i=0;i<80&&!page;i++) {
    page=browser.contexts()[0]?.pages().find(item=>item.url().includes('index.html'))
    if(!page)await new Promise(resolve=>setTimeout(resolve,250))
  }
  if(!page)throw new Error('renderer page missing')
  await page.waitForLoadState('domcontentloaded',{timeout:30000})
  await page.evaluate(()=>new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('stream did not start')),5000)
    window.__streamEnded=false
    window.api.stream({mode:'chat',messages:[{role:'user',content:'window cleanup slow request'}]},{
      onDelta:()=>{},
      onEnd:()=>{window.__streamEnded=true;clearTimeout(timer);resolve(true)}
    })
    setTimeout(()=>resolve(true),100)
  }))
  const deadline=Date.now()+10000
  while(!modelRequestSeen&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,100))
  if(!modelRequestSeen)throw new Error('model request never arrived')
  await page.close({runBeforeUnload:false})
  const exitDeadline=Date.now()+15000
  while(app.exitCode===null&&Date.now()<exitDeadline)await new Promise(resolve=>setTimeout(resolve,100))
  if(app.exitCode===null)throw new Error('application did not exit after renderer destruction')
  const closeDeadline=Date.now()+5000
  while(!modelResponseClosed&&Date.now()<closeDeadline)await new Promise(resolve=>setTimeout(resolve,100))
  if(!modelResponseClosed)throw new Error('model stream remained open after renderer destruction')
  console.log(JSON.stringify({passed:1,failed:0,modelRequestSeen,modelResponseClosed,appExit:app.exitCode,fixture:temp},null,2))
  await browser.close().catch(()=>{})
  process.exit(0)
} catch(error) {
  console.error('WINDOW_CLEANUP_TEST_FAILED '+String(error.stack||error))
  if(browser)await browser.close().catch(()=>{})
  killTree(app)
  process.exit(1)
} finally {
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve))
}
