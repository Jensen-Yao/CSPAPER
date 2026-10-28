import { parentPort, workerData } from 'node:worker_threads'
import Database from 'better-sqlite3'
import { collectLibrary } from './library-inventory'
import { applyLibraryInventoryAsync } from './library-store'

async function run():Promise<void> {
  const workerStarted=Date.now()
  const inventory=collectLibrary(workerData.root,workerData.previous,{
    onEntries:(_entries,found)=>parentPort?.postMessage({batch:true,found})
  })
  parentPort?.postMessage({ready:true})
  await new Promise<void>(resolve=>parentPort?.once('message',(message:{apply?:boolean})=>{if(message.apply)resolve()}))
  const applyStarted=Date.now()
  const db=new Database(workerData.dbFile)
  try {
    db.pragma('busy_timeout = 5000')
    const result=await applyLibraryInventoryAsync(db,inventory)
    parentPort?.postMessage({
      ok:true,
      result,
      timing:{workerMs:Date.now()-workerStarted,applyMs:Date.now()-applyStarted}
    })
  } finally { db.close() }
}
run().catch(error=>parentPort?.postMessage({ok:false,error:String(error)}))
