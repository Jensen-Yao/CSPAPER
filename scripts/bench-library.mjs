import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { buildSync } from 'esbuild'
const root=process.cwd(),temp=fs.mkdtempSync(path.join(os.tmpdir(),'cspaper-bench-build-'))
fs.symlinkSync(path.join(root,'node_modules'),path.join(temp,'node_modules'),'junction')
for(const [input,output] of [['scripts/bench-library.ts','bench-library.cjs'],['scripts/bench-chat.ts','bench-chat.cjs'],['src/main/library-worker.ts','library-worker.js']])buildSync({entryPoints:[input],bundle:true,platform:'node',packages:'external',outfile:path.join(temp,output)})
const child=spawn(path.join(root,'node_modules/electron/dist/electron.exe'),[path.join(temp,'bench-library.cjs')],{cwd:root,stdio:'inherit',windowsHide:true})
child.on('exit',code=>process.exitCode=code??1)
