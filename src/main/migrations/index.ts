import type Database from 'better-sqlite3'
import { migrationChecksum as libraryChecksum, migrationVersion as libraryVersion, migrationName as libraryName, up as libraryUp } from './001-library'
import { migrationChecksum as conversationsChecksum, migrationVersion as conversationsVersion, migrationName as conversationsName, up as conversationsUp } from './002-conversations'
import { migrationChecksum as operationsChecksum, migrationVersion as operationsVersion, migrationName as operationsName, up as operationsUp } from './003-operation-journal'
import { migrationChecksum as legacyAgentChecksum, migrationVersion as legacyAgentVersion, migrationName as legacyAgentName, up as legacyAgentUp } from './004-legacy-agent-links'
import { migrationChecksum as cursorChecksum, migrationVersion as cursorVersion, migrationName as cursorName, up as cursorUp } from './005-conversation-event-cursor'
import { migrationChecksum as interruptedChecksum, migrationVersion as interruptedVersion, migrationName as interruptedName, up as interruptedUp } from './006-interrupted-runs'
import { migrationChecksum as activeOrderChecksum, migrationVersion as activeOrderVersion, migrationName as activeOrderName, up as activeOrderUp } from './007-active-library-order'
import { migrationChecksum as sourceKindChecksum, migrationVersion as sourceKindVersion, migrationName as sourceKindName, up as sourceKindUp } from './008-paper-source-kind'
import { migrationChecksum as calendarChecksum, migrationVersion as calendarVersion, migrationName as calendarName, up as calendarUp } from './009-research-calendar'
import { migrationChecksum as workbenchChecksum, migrationVersion as workbenchVersion, migrationName as workbenchName, up as workbenchUp } from './010-workbench-calendar-focus'

interface AppliedMigration { version: number; name: string; checksum: string | null; applied_at: string }

const migrations: Array<{version:number;name:string;checksum:string;up:(db:Database.Database)=>void}> = [
  { version: libraryVersion, name: libraryName, checksum: libraryChecksum, up: libraryUp },
  { version: conversationsVersion, name: conversationsName, checksum: conversationsChecksum, up: conversationsUp },
  { version: operationsVersion, name: operationsName, checksum: operationsChecksum, up: operationsUp },
  { version: legacyAgentVersion, name: legacyAgentName, checksum: legacyAgentChecksum, up: legacyAgentUp },
  { version: cursorVersion, name: cursorName, checksum: cursorChecksum, up: cursorUp },
  { version: interruptedVersion, name: interruptedName, checksum: interruptedChecksum, up: interruptedUp },
  { version: activeOrderVersion, name: activeOrderName, checksum: activeOrderChecksum, up: activeOrderUp },
  { version: sourceKindVersion, name: sourceKindName, checksum: sourceKindChecksum, up: sourceKindUp },
  { version: calendarVersion, name: calendarName, checksum: calendarChecksum, up: calendarUp },
  { version: workbenchVersion, name: workbenchName, checksum: workbenchChecksum, up: workbenchUp }
]

/** Apply each schema migration exactly once. Failures roll back only that migration. */
export function runMigrations(db:Database.Database):void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations(
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    checksum TEXT,
    applied_at TEXT NOT NULL
  )`)
  if(!(db.prepare('PRAGMA table_info(schema_migrations)').all() as Array<{name:string}>).some(column=>column.name==='checksum')) {
    db.exec('ALTER TABLE schema_migrations ADD COLUMN checksum TEXT')
    const backfill=db.prepare('UPDATE schema_migrations SET checksum=? WHERE version=?')
    db.transaction(()=>{for(const migration of migrations)backfill.run(migration.checksum,migration.version)})()
  }
  const rows=db.prepare('SELECT version,name,checksum FROM schema_migrations').all() as Array<{version:number;name:string;checksum:string|null}>
  for(const row of rows) {
    const migration=migrations.find(item=>item.version===row.version)
    if(!migration)continue
    if(row.name!==migration.name||row.checksum!==migration.checksum)throw new Error(`迁移 ${row.version} 与已应用版本不一致，需新增迁移而不是修改历史`)
  }
  const applied=new Set(rows.map(row=>row.version))
  for(const migration of migrations) {
    if(applied.has(migration.version))continue
    const transaction=db.transaction((target:typeof migration)=>{
      target.up(db)
      db.prepare('INSERT INTO schema_migrations(version,name,checksum,applied_at) VALUES(?,?,?,?)').run(target.version,target.name,target.checksum,new Date().toISOString())
    })
    transaction(migration)
  }
}

export function appliedMigrations(db:Database.Database):AppliedMigration[] {
  return db.prepare('SELECT version,name,checksum,applied_at FROM schema_migrations ORDER BY version').all() as AppliedMigration[]
}
