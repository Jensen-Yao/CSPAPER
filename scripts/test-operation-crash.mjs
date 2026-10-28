import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { buildSync } from 'esbuild'

const root=process.cwd()
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cspaper-operation-crash-'))
const electron=path.join(root,'node_modules/electron/dist/electron.exe')
const build=fs.mkdtempSync(path.join(os.tmpdir(),'cspaper-operation-build-'))
fs.symlinkSync(path.join(root,'node_modules'),path.join(build,'node_modules'),'junction')
buildSync({entryPoints:[path.join(root,'scripts/operation-crash.ts')],bundle:true,platform:'node',packages:'external',outfile:path.join(build,'operation-crash.cjs')})

function runCase(phase,expectedExit) {
  const data=path.join(temp,phase),target=path.join(data,'target.md')
  fs.mkdirSync(data,{recursive:true});fs.writeFileSync(target,'before-content','utf8')
  return new Promise((resolve,reject)=>{
    const child=spawn(electron,[path.join(build,'operation-crash.cjs'),data,target,phase],{cwd:root,env:{...process.env,CSPAPER_DATA_DIR:data},stdio:['ignore','pipe','pipe'],windowsHide:true})
    let output=''
    child.stdout.on('data',value=>output+=String(value))
    child.stderr.on('data',value=>output+=String(value))
    child.on('exit',code=>{
      if(code!==expectedExit)reject(new Error(`${phase} crash exit ${code}, expected ${expectedExit}: ${output}`))
      else resolve({data,target,output})
    })
  })
}
function recover(caseInfo) {
  return new Promise((resolve,reject)=>{
    const child=spawn(electron,[path.join(build,'operation-crash.cjs'),caseInfo.data,caseInfo.target,'recover'],{cwd:root,env:{...process.env,CSPAPER_DATA_DIR:caseInfo.data},stdio:['ignore','pipe','pipe'],windowsHide:true})
    let output=''
    child.stdout.on('data',value=>output+=String(value))
    child.stderr.on('data',value=>output+=String(value))
    child.on('exit',code=>{
      if(code!==0){reject(new Error(`recovery exit ${code}: ${output}`));return}
      const line=output.split(/\r?\n/).find(item=>item.startsWith('OPERATION_RECOVERY '))
      if(!line){reject(new Error('recovery output missing'));return}
      resolve(JSON.parse(line.slice('OPERATION_RECOVERY '.length)))
    })
  })
}
try {
  const beforeCase=await runCase('before',70)
  const before=await recover(beforeCase)
  if(before.recovered.length!==1||before.recovered[0].state!=='rolled_back')throw new Error('before-crash state mismatch: '+JSON.stringify(before))
  if(fs.readFileSync(beforeCase.target,'utf8')!=='before-content')throw new Error('before-crash file did not remain original')
  if(before.marker.length!==0)throw new Error('before-crash unexpectedly committed marker')

  const afterCase=await runCase('after',71)
  const after=await recover(afterCase)
  if(after.recovered.length!==1||after.recovered[0].state!=='needs_review')throw new Error('after-crash state mismatch: '+JSON.stringify(after))
  if(fs.readFileSync(afterCase.target,'utf8')!=='after-content')throw new Error('after-crash file did not preserve written state')
  if(after.marker.length!==0)throw new Error('DB transaction committed despite forced crash')
  console.log(JSON.stringify({passed:2,failed:0,beforeState:before.recovered[0].state,afterState:after.recovered[0].state,markerRows:after.marker.length,fixture:temp},null,2))
  process.exit(0)
} catch(error) {
  console.error('OPERATION_CRASH_TEST_FAILED '+String(error.stack||error));process.exit(1)
}
