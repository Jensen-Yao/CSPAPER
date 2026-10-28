import { parentPort, workerData } from 'node:worker_threads'
import { collectLibrary, type LibraryInventory } from './library-inventory'
try {
  const inventory=collectLibrary(workerData.root,workerData.previous,{
    onEntries:(entries,found)=>parentPort?.postMessage({batch:true,entries,found})
  })
  // The payload was already streamed in small batches; send only completion metadata.
  const completion:LibraryInventory={...inventory,entries:[]}
  parentPort?.postMessage({ ok: true, inventory: completion })
} catch (error) { parentPort?.postMessage({ ok: false, error: String(error) }) }
