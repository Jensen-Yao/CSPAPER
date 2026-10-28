import type Database from 'better-sqlite3'

export const migrationVersion = 1
export const migrationName = 'library_scope_v1'

/** This migration records the existing v0.19 library-scope model; it is idempotent for upgraded databases. */
export const migrationChecksum='8383ef18f46a4798b1b13fcedaff8c9ce30c7f9f847b1566e0c7cbfa0ff1f44c'

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces(
      id TEXT PRIMARY KEY,
      root_path TEXT NOT NULL,
      normalized_root TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_workspaces_root ON workspaces(normalized_root);
    CREATE TABLE IF NOT EXISTS library_exclusions(
      path TEXT PRIMARY KEY,
      library_root TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_papers_library ON papers(library_root,deleted_at,missing_at);
  `)
}
