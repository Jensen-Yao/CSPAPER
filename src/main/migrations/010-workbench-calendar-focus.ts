import type Database from 'better-sqlite3'

export const migrationVersion=10
export const migrationName='workbench_calendar_focus'

/** Calendar scheduling gains concrete times and recurrence; reading focus becomes auditable workspace data. */
export const migrationChecksum='09d497e7ac052faf81faa8bf23c4649abc90b4ddb55c4aac59863f2a4896d6b4'

export function up(db:Database.Database):void {
  const columns=db.prepare('PRAGMA table_info(research_calendar_events)').all() as Array<{name:string}>
  const add=(name:string,ddl:string):void=>{ if(!columns.some(column=>column.name===name))db.exec(`ALTER TABLE research_calendar_events ADD COLUMN ${ddl}`) }
  add('start_time','start_time TEXT')
  add('end_time','end_time TEXT')
  add("recurrence","recurrence TEXT NOT NULL DEFAULT 'none'")
  add('recurrence_until','recurrence_until TEXT')
  db.exec(`
    CREATE TABLE IF NOT EXISTS research_focus_sessions(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      paper_id INTEGER NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
      phase TEXT NOT NULL CHECK(phase IN ('reading','short_break','long_break')),
      seconds INTEGER NOT NULL CHECK(seconds BETWEEN 1 AND 86400),
      started_at TEXT NOT NULL,
      ended_at TEXT NOT NULL CHECK(ended_at > started_at),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_focus_workspace_day ON research_focus_sessions(workspace_id,ended_at);
    CREATE INDEX IF NOT EXISTS idx_focus_paper ON research_focus_sessions(paper_id,ended_at);
  `)
}

