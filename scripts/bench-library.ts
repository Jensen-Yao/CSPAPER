import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import * as store from '../src/main/db'

const root=fs.mkdtempSync(path.join(os.tmpdir(),'cspaper-bench-library-'))
const library=path.join(root,'library'),papers=path.join(library,'papers','bulk')
fs.mkdirSync(papers,{recursive:true})
app.setPath('userData',path.join(root,'data'))
const n=Number(process.env.BENCH_LIBRARY_N??10000)
for(let i=0;i<n;i++){
  const slug=`2026-bulk-${String(i).padStart(5,'0')}`
  fs.writeFileSync(path.join(papers,slug+'.pdf'),`%PDF-1.4\n% ${slug}\n`)
  fs.writeFileSync(path.join(papers,slug+'.md'),`---\ntitle: "Bulk ${i}"\nauthors: "Bench"\nyear: 2026\nvenue: "Benchmark"\ntags: []\n---\n\n# Bulk ${i}\n\nresilience methods evidence analysis results ${i}\n`)
}
app.whenReady().then(async()=>{
  store.initDb();store.saveSettings({libraryPath:library,setupDone:true,embedProvider:'ollama',ollamaUrl:'http://127.0.0.1:9'})
  let ticks=0,maxTickGapMs=0,lastTick=performance.now()
  const heartbeat=setInterval(()=>{const now=performance.now();maxTickGapMs=Math.max(maxTickGapMs,now-lastTick);lastTick=now;ticks++},10)
  const started=Date.now()
  const scan=store.scanLibraryAsync(library)
  const result=await scan
  const scanMs=Date.now()-started
  await new Promise(resolve=>setTimeout(resolve,20))
  const scanMaxTickGapMs=maxTickGapMs
  // Measure only the synchronous list call. Resetting the baseline here avoids charging the
  // pre-list timer wait to list latency while still capturing the full blocking duration.
  lastTick=performance.now()
  const listStarted=performance.now(),count=store.listPapers().length,listMs=performance.now()-listStarted
  await new Promise(resolve=>setTimeout(resolve,20));clearInterval(heartbeat)
  const scanResponsive=ticks>2&&scanMaxTickGapMs<100,listResponsive=listMs<100
  const responsive=scanResponsive&&listResponsive&&maxTickGapMs<100
  const output={n,scanMs,listMs,count,responsive,scanResponsive,listResponsive,scanMaxTickGapMs,maxTickGapMs,ticks,budgetMs:100,result,fixture:root}
  console.log(JSON.stringify(output,null,2))
  app.exit(responsive&&count===n?0:1)
}).catch(error=>{console.error(error);app.exit(1)})
