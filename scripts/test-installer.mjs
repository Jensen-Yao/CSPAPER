import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const root=process.cwd()
const {version}=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'))
const installer=path.join(root,'dist',`CSPAPER Setup ${version}.exe`)
if(!fs.existsSync(installer))throw new Error('installer missing: '+installer)
const rootTemp=fs.mkdtempSync(path.join(os.tmpdir(),'cspaper-installer-test-'))
const installDir=path.join(rootTemp,'app')
const dataDir=path.join(rootTemp,'data');fs.mkdirSync(dataDir,{recursive:true})
function run(file,args,options={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(file,args,{stdio:['ignore','pipe','pipe'],windowsHide:true,...options})
    let output=''
    child.stdout.on('data',data=>output+=String(data));child.stderr.on('data',data=>output+=String(data))
    child.on('error',reject);child.on('exit',code=>resolve({code,output}))
  })
}
function killTree(child) {
  if(!child||child.exitCode!==null)return
  if(process.platform==='win32')spawn('taskkill',['/F','/PID',String(child.pid),'/T'],{stdio:'ignore'})
  else child.kill('SIGTERM')
}
async function launchInstalled() {
  const server=http.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const debugPort=server.address().port;await new Promise(resolve=>server.close(resolve))
  const exe=path.join(installDir,'CSPAPER.exe')
  const app=spawn(exe,[`--remote-debugging-port=${debugPort}`],{cwd:installDir,env:{...process.env,CSPAPER_DATA_DIR:dataDir},stdio:['ignore','ignore','ignore'],windowsHide:true})
  let browser
  try {
    const url=`http://127.0.0.1:${debugPort}`
    let ready=false
    for(let i=0;i<80&&!ready;i++){try{const response=await fetch(url+'/json/version');ready=response.ok}catch{}if(!ready)await new Promise(resolve=>setTimeout(resolve,250))}
    if(!ready)throw new Error('installed app DevTools did not start')
    browser=await chromium.connectOverCDP(url)
    let page
    for(let i=0;i<80&&!page;i++){page=browser.contexts()[0]?.pages().find(item=>item.url().includes('index.html'));if(!page)await new Promise(resolve=>setTimeout(resolve,250))}
    if(!page)throw new Error('installed renderer page missing')
    await page.waitForLoadState('domcontentloaded',{timeout:30000})
    const title=await page.title()
    await browser.close()
    // A packaged BrowserWindow may remain alive after closing only the CDP page.
    // Validation only needs launch evidence here; terminate this isolated test process explicitly.
    killTree(app)
    const deadline=Date.now()+15000
    while(app.exitCode===null&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,100))
    if(app.exitCode===null)throw new Error('installed app cleanup failed')
    return {title,cleanupExit:app.exitCode}
  } finally {
    if(browser)await browser.close().catch(()=>{})
    killTree(app)
  }
}

try {
  if(!installDir.startsWith(rootTemp+path.sep))throw new Error('unsafe install target')
  const first=await run(installer,['/S',`/D=${installDir}`])
  if(first.code!==0)throw new Error('first install failed: '+first.output)
  const exe=path.join(installDir,'CSPAPER.exe'),uninstaller=path.join(installDir,'Uninstall CSPAPER.exe')
  if(!fs.existsSync(exe)||!fs.existsSync(uninstaller))throw new Error('installed executable or uninstaller missing')
  const firstRun=await launchInstalled()
  const before=fs.statSync(exe).size
  const second=await run(installer,['/S',`/D=${installDir}`])
  if(second.code!==0)throw new Error('upgrade install failed: '+second.output)
  if(!fs.existsSync(exe)||!fs.existsSync(uninstaller))throw new Error('upgrade removed executable or uninstaller')
  const secondRun=await launchInstalled()
  const uninstall=await run(uninstaller,['/S'])
  if(uninstall.code!==0)throw new Error('uninstall failed: '+uninstall.output)
  const deadline=Date.now()+30000
  let exeGone=!fs.existsSync(exe),uninstallerGone=!fs.existsSync(uninstaller)
  while(!(exeGone&&uninstallerGone)&&Date.now()<deadline) {
    await new Promise(resolve=>setTimeout(resolve,500));exeGone=!fs.existsSync(exe);uninstallerGone=!fs.existsSync(uninstaller)
  }
  if(!exeGone||!uninstallerGone)throw new Error(`uninstall left files: exe=${!exeGone}, uninstaller=${!uninstallerGone}`)
  const result={passed:1,failed:0,firstInstallExit:first.code,firstRun,upgradeInstallExit:second.code,installedBytesBeforeUpgrade:before,secondRun,uninstallExit:uninstall.code,exeGone,uninstallerGone,fixture:rootTemp}
  console.log(JSON.stringify(result,null,2))
  process.exit(0)
} catch(error) {
  console.error('INSTALLER_TEST_FAILED '+String(error.stack||error))
  process.exit(1)
}
