import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { buildSync } from 'esbuild'

const root=process.cwd(),temp=fs.mkdtempSync(path.join(os.tmpdir(),'cspaper-test-build-'))
fs.symlinkSync(path.join(root,'node_modules'),path.join(temp,'node_modules'),'junction')
for(const [input,output] of [['scripts/core-regression.ts','core-regression.cjs'],['src/main/library-worker.ts','library-worker.js']])
  buildSync({entryPoints:[input],bundle:true,platform:'node',packages:'external',outfile:path.join(temp,output)})
const child=spawn(path.join(root,'node_modules/electron/dist/electron.exe'),[path.join(temp,'core-regression.cjs')],{cwd:root,stdio:['ignore','pipe','pipe'],windowsHide:true})
const timeout=setTimeout(()=>{child.kill();process.exitCode=1},120000)
child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr)
child.on('exit',code=>{clearTimeout(timeout);process.exitCode=code??1})
