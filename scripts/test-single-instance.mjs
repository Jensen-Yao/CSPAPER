import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const root=process.cwd()
const electron=path.join(root,'node_modules/electron/dist/electron.exe')
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cspaper-single-instance-'))
const portServer=http.createServer()
await new Promise(resolve=>portServer.listen(0,'127.0.0.1',resolve))
const port=portServer.address().port
await new Promise(resolve=>portServer.close(resolve))
const debugUrl=`http://127.0.0.1:${port}`
const env={...process.env,CSPAPER_DATA_DIR:temp}
let first
let browser
function kill(process) {
  if(!process||process.exitCode!==null)return
  if(process.platform==='win32') spawn('taskkill',['/F','/PID',String(process.pid),'/T'],{stdio:'ignore'})
  else process.kill('SIGTERM')
}
async function waitForFirst() {
  for(let i=0;i<80;i++) {
    try{const response=await fetch(`${debugUrl}/json/version`);if(response.ok)return}catch{}
    await new Promise(resolve=>setTimeout(resolve,250))
  }
  throw new Error('first instance did not expose DevTools')
}
try {
  first=spawn(electron,['.',`--remote-debugging-port=${port}`],{cwd:root,env,stdio:['ignore','pipe','pipe'],windowsHide:true})
  const firstErrors=[]
  first.stderr.on('data',data=>firstErrors.push(String(data)))
  await waitForFirst()
  browser=await chromium.connectOverCDP(debugUrl)
  let page=browser.contexts()[0]?.pages().find(item=>item.url().includes('index.html'))
  for(let i=0;i<80&&!page;i++) {
    page=browser.contexts()[0]?.pages().find(item=>item.url().includes('index.html'))
    if(!page)await new Promise(resolve=>setTimeout(resolve,250))
  }
  if(!page)throw new Error('first instance renderer did not start')
  await page.waitForLoadState('domcontentloaded',{timeout:30000})
  const beforeTargets=(await browser.contexts()[0].pages()).length

  const second=spawn(electron,['.'],{cwd:root,env,stdio:['ignore','ignore','ignore'],windowsHide:true})
  const secondExit=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('second instance did not exit')),15000)
    second.once('exit',code=>{clearTimeout(timer);resolve(code)})
  })
  if(secondExit!==0)throw new Error(`second instance exit code ${secondExit}`)
  await new Promise(resolve=>setTimeout(resolve,1200))
  if(first.exitCode!==null)throw new Error(`first instance exited unexpectedly: ${first.exitCode}`)
  await fetch(`${debugUrl}/json/version`).then(response=>{if(!response.ok)throw new Error('first DevTools endpoint disappeared')})
  browser=await browser.close().then(()=>undefined).catch(()=>{browser=undefined}) ? browser : browser
  const reconnect=await chromium.connectOverCDP(debugUrl)
  const pages=reconnect.contexts()[0]?.pages().filter(item=>item.url().includes('index.html'))??[]
  if(pages.length!==1||beforeTargets<1)throw new Error(`expected one surviving renderer, found ${pages.length}`)
  await reconnect.close().catch(()=>{})
  console.log(JSON.stringify({passed:1,failed:0,secondExit,firstAlive:first.exitCode===null,rendererPages:pages.length,fixture:temp},null,2))
  kill(first)
  await new Promise(resolve=>setTimeout(resolve,1000))
  process.exit(0)
} catch(error) {
  console.error('SINGLE_INSTANCE_TEST_FAILED '+String(error.stack||error))
  if(browser)await browser.close().catch(()=>{})
  kill(first)
  process.exit(1)
}
