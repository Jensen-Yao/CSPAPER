import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import type Database from 'better-sqlite3'
import { scanLibraryAsync } from '../../src/main/db'
import { normalizePath } from '../../src/main/paper-files'
import type { Test } from './chat-events.test'

export async function testLibraryScan(test:Test,db:Database.Database,root:string):Promise<void> {
  await test('concurrent library scans deduplicate only requests for the same normalized root',async()=>{
    const a=path.join(root,'parallel-a'),b=path.join(root,'parallel-b')
    for(const [library,count] of [[a,1],[b,2]] as const){
      fs.mkdirSync(path.join(library,'papers'),{recursive:true})
      for(let i=0;i<count;i++)fs.writeFileSync(path.join(library,'papers',`paper-${i}.pdf`),'%PDF-1.4\n% isolated scan fixture')
    }
    const first=scanLibraryAsync(a),same=scanLibraryAsync(path.join(a,'.')),other=scanLibraryAsync(b)
    assert.equal(first,same);assert.notEqual(first,other)
    const [one,two]=await Promise.all([first,other])
    assert.equal(one.added,1);assert.equal(two.added,2)
    const count=(library:string)=>(db.prepare('SELECT COUNT(*) n FROM papers WHERE library_root=?').get(normalizePath(library)) as {n:number}).n
    assert.equal(count(a),1);assert.equal(count(b),2)
  })
}
