import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { buildSync } from 'esbuild'
const root=process.cwd(),temp=fs.mkdtempSync(path.join(os.tmpdir(),'cspaper-real-task-build-'))
fs.symlinkSync(path.join(root,'node_modules'),path.join(temp,'node_modules'),'junction')
buildSync({entryPoints:[path.join(root,'scripts/real-model-task.ts')],bundle:true,platform:'node',packages:'external',outfile:path.join(temp,'real-model-task.cjs')})
const child=spawn(path.join(root,'node_modules/electron/dist/electron.exe'),[path.join(temp,'real-model-task.cjs')],{cwd:root,env:{...process.env,CSPAPER_REAL_SETTINGS_DB:path.join(process.env.APPDATA??'','CSPAPER','cspaper.db')},stdio:'inherit',windowsHide:true})
child.on('exit',code=>process.exitCode=code??1)
