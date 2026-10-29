import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { up as library } from '../../src/main/migrations/001-library'
import { up as conversations } from '../../src/main/migrations/002-conversations'
import { up as cursor } from '../../src/main/migrations/005-conversation-event-cursor'
import { up as interrupted } from '../../src/main/migrations/006-interrupted-runs'
import { backupBeforeLibraryMigration } from '../../src/main/migrations/legacy-backup'
import { runMigrations } from '../../src/main/migrations'
import { ChatRepository } from '../../src/main/chat/repository'
import type { Test } from './chat-events.test'

export async function testMigrations(test:Test):Promise<void> {
  await test('legacy WAL data is included in the pre-migration backup',()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'cspaper-wal-backup-')),file=path.join(root,'legacy.db')
    const db=new Database(file)
    try {
      db.pragma('journal_mode=WAL')
      db.exec('CREATE TABLE papers(id INTEGER PRIMARY KEY,title TEXT,path TEXT,deleted_at TEXT,missing_at TEXT)')
      db.prepare('INSERT INTO papers(id,title,path) VALUES(1,?,?)').run('WAL-PRESERVE','legacy.pdf')
      const backup=backupBeforeLibraryMigration(db,root)
      assert.ok(backup&&fs.existsSync(backup))
      const copy=new Database(backup,{readonly:true})
      try{assert.equal((copy.prepare('SELECT title FROM papers WHERE id=1').get() as {title:string}).title,'WAL-PRESERVE')}finally{copy.close()}
      db.exec('ALTER TABLE papers ADD COLUMN library_root TEXT')
      assert.equal(backupBeforeLibraryMigration(db,root),null)
    } finally{db.close()}
  })
  await test('migration checksums are persisted and reject historical drift',()=>{
    const db=new Database(':memory:')
    try {
      db.exec('CREATE TABLE papers(id INTEGER PRIMARY KEY,slug TEXT,title TEXT,year INTEGER,category TEXT,library_root TEXT,deleted_at TEXT,missing_at TEXT)')
      runMigrations(db)
      const applied=db.prepare('SELECT version,checksum FROM schema_migrations ORDER BY version').all() as Array<{version:number;checksum:string|null}>
      assert.equal(applied.length,10)
      assert.ok(applied.every(row=>/^[a-f0-9]{64}$/.test(row.checksum??'')))
      db.prepare('UPDATE schema_migrations SET checksum=? WHERE version=?').run('tampered',1)
      assert.throws(()=>runMigrations(db),/迁移 1 与已应用版本不一致/)
    } finally{db.close()}
  })
  await test('failed migration statement rolls back its record and temporary tables',()=>{
    const db=new Database(':memory:')
    try {
      db.exec(`CREATE TABLE papers(
        id INTEGER PRIMARY KEY,slug TEXT,title TEXT,path TEXT,year INTEGER,category TEXT,
        n_pages INTEGER DEFAULT 0,indexed INTEGER DEFAULT 0,file_size INTEGER,
        deleted_at TEXT,missing_at TEXT,library_root TEXT
      )`)
      runMigrations(db)
      db.prepare('DELETE FROM schema_migrations WHERE version>=6').run()
      db.exec('DROP TABLE chat_runs')
      assert.throws(()=>runMigrations(db))
      const applied=db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{version:number}>
      assert.equal(applied.at(-1)?.version,5)
      assert.equal((db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE 'run_backup_%'").get() as {n:number}).n,0)
      // The failed migration must be retryable after the schema defect is repaired.
      db.exec(`CREATE TABLE chat_runs(
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        user_message_id TEXT NOT NULL,
        assistant_message_id TEXT,
        status TEXT NOT NULL CHECK(status IN ('queued','preparing','running','awaiting_approval','partial','completed','failed','cancelled'))
      )`)
      runMigrations(db)
      assert.equal((db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as {n:number}).n,10)
    } finally{db.close()}
  })
  await test('interrupted-state migration preserves every dependent record with foreign keys enabled',()=>{
    const db=new Database(':memory:')
    try {
      db.pragma('foreign_keys=ON')
      db.exec('CREATE TABLE papers(id INTEGER PRIMARY KEY,library_root TEXT,deleted_at TEXT,missing_at TEXT)')
      library(db);conversations(db);cursor(db)
      const repo=new ChatRepository(db),workspace=repo.ensureWorkspace('C:/migration-fixture'),conversation=repo.createConversation({workspaceId:workspace.id})
      const turn=repo.createTurn({conversationId:conversation.id,clientMessageId:'old-turn',text:'before',modelBinding:{bindingId:'p:m',profileId:'p',provider:'mock',model:'m',capabilities:['text'],reasoning:'default'},context:{conversationId:conversation.id,runId:'pending',refs:[],budget:{totalChars:100,usedChars:0,reservedForOutput:0},diagnostics:[],createdAt:new Date().toISOString()}})
      repo.appendRunEvent(turn.run.id,'message.delta',{delta:'preserve'})
      repo.createToolCall({runId:turn.run.id,toolCallId:'old-call',tool:'note.append',args:{text:'preserve'},operationId:'old-op'})
      repo.addSource({id:'source-old',runId:turn.run.id,workspaceId:workspace.id,kind:'chunk',title:'source',snippet:'original',locator:{page:2},status:'available'})
      repo.addArtifact({id:'artifact-old',runId:turn.run.id,kind:'note',entityId:'1',title:'note'})
      const tables=['chat_runs','chat_run_events','chat_tool_calls','chat_sources','chat_artifacts']
      const before=tables.map(table=>db.prepare(`SELECT * FROM ${table}`).all())
      db.transaction(()=>interrupted(db))()
      assert.deepEqual(tables.map(table=>db.prepare(`SELECT * FROM ${table}`).all()),before)
      assert.equal(db.pragma('foreign_keys',{simple:true}),1)
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
      assert.equal(repo.updateRunStatus(turn.run.id,'interrupted')?.status,'interrupted')
      assert.throws(()=>repo.updateRunStatus(turn.run.id,'completed'),/已结束/)
    } finally {db.close()}
  })
}
