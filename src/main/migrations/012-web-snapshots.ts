import type Database from 'better-sqlite3'

export const migrationVersion=12
export const migrationName='web_snapshots'

/** Web pages read by web_fetch / conversations are stored as versioned Markdown snapshots so citations stay reviewable offline. */
export const migrationChecksum='c8a5d3b1f7e29c04a6d8b2e4f0c1a3b5d7e9f2a4c6b8d0e2f4a6c8b0d2e4f6a8'

export function up(db:Database.Database):void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS web_snapshots(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id TEXT NOT NULL,
      url TEXT NOT NULL,
      final_url TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      content_type TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'html' CHECK(kind IN ('html','pdf')),
      title TEXT NOT NULL DEFAULT '',
      byline TEXT NOT NULL DEFAULT '',
      excerpt TEXT NOT NULL DEFAULT '',
      language TEXT NOT NULL DEFAULT '',
      markdown TEXT NOT NULL,
      bytes INTEGER NOT NULL DEFAULT 0,
      fetched_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_web_snapshots_url_hash ON web_snapshots(workspace_id,url,content_hash);
    CREATE INDEX IF NOT EXISTS idx_web_snapshots_url_fetched ON web_snapshots(workspace_id,url,fetched_at);
  `)
}
