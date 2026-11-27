import fs from 'node:fs'

/**
 * Windows may refuse a rename for a short while when another process (PDF indexer, extractor worker,
 * antivirus, Explorer preview) still holds a handle on the directory or a file inside it. Retry briefly
 * on those transient codes instead of failing the move.
 */
export function renameWithRetry(from:string,to:string,attempts=10,delayMs=100):void {
  for(let attempt=1;;attempt++) {
    try { fs.renameSync(from,to);return }
    catch(error) {
      const code=String((error as {code?:string})?.code??'')
      if((code==='EPERM'||code==='EBUSY'||code==='EACCES')&&attempt<attempts) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,delayMs)
        continue
      }
      throw error
    }
  }
}
