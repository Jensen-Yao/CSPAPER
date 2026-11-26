import type Database from 'better-sqlite3'

export const migrationVersion=11
export const migrationName='research_projects_tasks'

/** Projects and tasks give reading, conversations and artifacts a shared research context. */
export const migrationChecksum='b7f4c2a9d1e60835a4c7b2d9f1e3a5c7d9b2f4e6a8c0d2f4b6e8a0c2d4f6b8a0'

export function up(db:Database.Database):void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS research_projects(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT '#9e3b2f',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','done')),
      due_date TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_projects_workspace_updated ON research_projects(workspace_id,updated_at);
    CREATE INDEX IF NOT EXISTS idx_projects_workspace_status ON research_projects(workspace_id,status);

    CREATE TABLE IF NOT EXISTS research_tasks(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      project_id INTEGER NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','doing','done')),
      priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high')),
      due_date TEXT,
      paper_id INTEGER REFERENCES papers(id) ON DELETE SET NULL,
      conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_workspace_due ON research_tasks(workspace_id,status,due_date);
    CREATE INDEX IF NOT EXISTS idx_tasks_project_status ON research_tasks(project_id,status,id);
  `)
}
