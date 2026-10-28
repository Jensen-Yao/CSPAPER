import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const root=process.cwd(),electron=path.join(root,'node_modules/electron/dist/electron.exe')
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cspaper-tray-restore-'))
const server=http.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve))
const debugUrl=`http://127.0.0.1:${port}`,env={...process.env,CSPAPER_DATA_DIR:temp}
let app,browser,appOutput=''
function killTree(){if(!app||app.exitCode!==null)return;if(process.platform==='win32')spawn('taskkill',['/F','/PID',String(app.pid),'/T'],{stdio:'ignore'});else app.kill('SIGTERM')}
async function connect() {
  for(let i=0;i<80;i++){try{const response=await fetch(debugUrl+'/json/version');if(response.ok)break}catch{}await new Promise(resolve=>setTimeout(resolve,250))}
  return chromium.connectOverCDP(debugUrl)
}
async function mainWindowHandle(processId) {
  return BigInt(await new Promise((resolve,reject)=>{
    const child=spawn('powershell.exe',['-NoProfile','-Command',`$p=Get-Process -Id ${processId}; if(!$p -or $p.MainWindowHandle -eq 0) { exit 2 }; $p.MainWindowHandle; exit 0`],{stdio:['ignore','pipe','ignore'],windowsHide:true})
    let output='';child.stdout.on('data',data=>output+=String(data));child.on('error',reject);child.on('exit',code=>code===0?resolve(output.trim()):reject(new Error('main-window handle failed '+code)))
  }))
}
async function windowVisible(handle) {
  return await new Promise((resolve,reject)=>{
    const child=spawn('powershell.exe',['-NoProfile','-Command',`Add-Type -Name Native -Namespace Win32 -MemberDefinition '[DllImport("user32.dll")]public static extern bool IsWindowVisible(IntPtr hWnd);'; if([Win32.Native]::IsWindowVisible([IntPtr]${handle})) { exit 1 } else { exit 0 }`],{stdio:['ignore','ignore','ignore'],windowsHide:true})
    child.on('error',reject);child.on('exit',code=>{if(code===0||code===1)resolve(code===1);else reject(new Error('IsWindowVisible failed '+code))})
  })
}
async function page() {
  for(let i=0;i<80;i++){const item=browser.contexts()[0]?.pages().find(candidate=>candidate.url().includes('index.html'));if(item)return item;await new Promise(resolve=>setTimeout(resolve,250))}
  throw new Error('renderer target missing')
}
try {
  app=spawn(electron,['.',`--remote-debugging-port=${port}`],{cwd:root,env,stdio:['ignore','pipe','pipe'],windowsHide:false});app.stdout.on('data',data=>appOutput+=String(data));app.stderr.on('data',data=>appOutput+=String(data))
  browser=await connect();let current=await page();await current.waitForLoadState('domcontentloaded',{timeout:30000})
  await current.evaluate(()=>window.api.saveSettings({closeToTray:true}))
  const handle=await mainWindowHandle(app.pid),beforeCloseVisible=await windowVisible(handle)
  const closeScript=`Add-Type -Name Native -Namespace Win32 -MemberDefinition '[DllImport("user32.dll")]public static extern IntPtr SendMessage(IntPtr hWnd,uint message,IntPtr wParam,IntPtr lParam);'; [void][Win32.Native]::SendMessage([IntPtr]${handle},0x0010,[IntPtr]::Zero,[IntPtr]::Zero); exit 0`
  await new Promise((resolve,reject)=>{const child=spawn('powershell.exe',['-NoProfile','-Command',closeScript],{stdio:['ignore','pipe','pipe'],windowsHide:true});let output='';child.stdout.on('data',data=>output+=String(data));child.stderr.on('data',data=>output+=String(data));child.on('error',reject);child.on('exit',code=>code===0?resolve(output):reject(new Error('main-window WM_CLOSE failed '+code+': '+output)))})
  await new Promise(resolve=>setTimeout(resolve,1500))
  if(app.exitCode!==null)throw new Error(`app exited after close-to-tray: ${app.exitCode}`)
  browser=await browser.close().then(()=>undefined).catch(()=>undefined) ?? browser
  browser=await connect();current=await page()
  const hidden=await windowVisible(handle)
  const second=spawn(electron,['.'],{cwd:root,env,stdio:['ignore','ignore','ignore'],windowsHide:false})
  const secondExit=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('second instance did not exit')),15000);second.once('exit',code=>{clearTimeout(timer);resolve(code)})})
  let visible=await windowVisible(handle)
  const deadline=Date.now()+15000
  while(!visible&&Date.now()<deadline) {
    try{visible=await windowVisible(handle)}catch{}
    await new Promise(resolve=>setTimeout(resolve,250))
  }
  if(secondExit!==0)throw new Error(`second instance exit ${secondExit}`)
  if(hidden)throw new Error(`pre-restore visibility ${hidden}; before=${beforeCloseVisible}; handle=${handle}; appOutput=${appOutput.slice(0,2000)}`)
  if(!visible)throw new Error(`post-restore visibility ${visible}`)
  if(app.exitCode!==null)throw new Error(`first instance exited: ${app.exitCode}`)
  console.log(JSON.stringify({passed:1,failed:0,preRestoreVisibility:hidden,postRestoreVisibility:visible,secondExit,firstAlive:app.exitCode===null,fixture:temp},null,2))
  await browser.close().catch(()=>{});killTree();process.exit(0)
} catch(error) {
  console.error('TRAY_RESTORE_TEST_FAILED '+String(error.stack||error))
  if(browser)await browser.close().catch(()=>{})
  killTree();process.exit(1)
}
