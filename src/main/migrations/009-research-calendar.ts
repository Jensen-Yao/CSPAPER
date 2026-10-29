import type Database from 'better-sqlite3'

export const migrationVersion=9
export const migrationName='research_calendar'
export const migrationChecksum='c0a1a12d41d64f9ab70324fdc0d50b57be7b185a8344c93ea7c4abc19a5bd1e2'

export function up(db:Database.Database):void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS research_calendar_events(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      event_date TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('task','deadline','meeting','milestone')),
      notes TEXT NOT NULL DEFAULT '',
      completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0,1)),
      conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_calendar_workspace_date ON research_calendar_events(workspace_id,event_date,id);
  `)
}
