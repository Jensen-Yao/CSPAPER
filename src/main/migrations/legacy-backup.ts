import fs from 'node:fs'
import path from 'node:path'
import type Database from 'better-sqlite3'

/** Save a consistent SQLite snapshot, including committed WAL data, before the scope migration. */
export function backupBeforeLibraryMigration(db:Database.Database,dir:string):string|null {
  if(!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='papers'").get()) return null
  if((db.prepare('PRAGMA table_info(papers)').all() as Array<{name:string}>).some(c=>c.name==='library_root')) return null
  const backups=path.join(dir,'backups')
  fs.mkdirSync(backups,{recursive:true})
  const target=path.join(backups,'before-library-v1-'+new Date().toISOString().replace(/[:.]/g,'-')+'.db')
  db.prepare('VACUUM INTO ?').run(target)
  return target
}
