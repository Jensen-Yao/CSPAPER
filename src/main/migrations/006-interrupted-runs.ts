import type Database from 'better-sqlite3'

export const migrationVersion=6
export const migrationName='interrupted_run_state'

/** SQLite CHECK constraints require rebuilding the parent; preserve every dependent row inside the migration transaction. */
export const migrationChecksum='6a62105c229d9a9b4e8afa273615f8520f4f3d0585c4a10f5a7730687f827168'

export function up(db:Database.Database):void {
  const schema=(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='chat_runs'").get() as {sql:string}).sql
  const indexes=(db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='chat_runs' AND sql IS NOT NULL").all() as {sql:string}[]).map(row=>row.sql)
  const children=['chat_run_events','chat_tool_calls','chat_sources','chat_artifacts']
  for(const table of children){
    db.exec(`CREATE TEMP TABLE run_backup_${table} AS SELECT * FROM ${table}; DELETE FROM ${table};`)
  }
  const next=schema.replace(/CREATE TABLE (?:IF NOT EXISTS )?["`]?chat_runs["`]?/i,'CREATE TABLE chat_runs_next').replace("'partial','completed'","'partial','completed','interrupted'")
  if(next===schema||!next.includes("'interrupted'"))throw new Error('运行状态迁移无法识别旧表结构')
  db.exec(next)
  db.exec('INSERT INTO chat_runs_next SELECT * FROM chat_runs; DROP TABLE chat_runs; ALTER TABLE chat_runs_next RENAME TO chat_runs;')
  for(const sql of indexes)db.exec(sql)
  for(const table of children){
    db.exec(`INSERT INTO ${table} SELECT * FROM run_backup_${table}; DROP TABLE run_backup_${table};`)
    if(db.prepare(`PRAGMA foreign_key_check(${table})`).all().length)throw new Error('运行状态迁移发现无效关联：'+table)
  }
}
