import { parentPort, workerData } from 'node:worker_threads'
import { collectLibrary } from './library-inventory'
try {
  const inventory=collectLibrary(workerData.root,workerData.previous,{
    onProgress:(found,current)=>parentPort?.postMessage({progress:true,found,current})
  })
  parentPort?.postMessage({ ok: true, inventory })
} catch (error) { parentPort?.postMessage({ ok: false, error: String(error) }) }
