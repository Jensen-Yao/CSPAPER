import type Database from 'better-sqlite3'

export const migrationVersion = 4
export const migrationName = 'legacy_agent_links_v1'

export const migrationChecksum='4be4ffc8736e82b18ce186c2bb12a5d89c511c2c22d601267c88065bd3fe4489'

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_tasks(
      id TEXT PRIMARY KEY,goal TEXT,status TEXT,plan TEXT DEFAULT '[]',events TEXT DEFAULT '[]',answer TEXT,created_at TEXT,
      conversation_id TEXT,run_id TEXT
    );
  `)
  const cols=(db.prepare('PRAGMA table_info(agent_tasks)').all() as Array<{name:string}>).map(column=>column.name)
  if(!cols.includes('conversation_id'))db.exec('ALTER TABLE agent_tasks ADD COLUMN conversation_id TEXT')
  if(!cols.includes('run_id'))db.exec('ALTER TABLE agent_tasks ADD COLUMN run_id TEXT')
  db.exec('CREATE INDEX IF NOT EXISTS idx_agent_tasks_conversation ON agent_tasks(conversation_id,run_id)')
}
