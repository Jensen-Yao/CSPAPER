import type Database from 'better-sqlite3'

export const migrationVersion=13
export const migrationName='agent_schedule_runs'

/** Every headless automation run is recorded so failures, durations and resulting conversations stay reviewable. */
export const migrationChecksum='d9b6e4c2a1f8e3075b9d2c4e6a8b0d2f4a6c8e0b2d4f6a8c0e2b4d6f8a0c2e4b'

export function up(db:Database.Database):void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_schedule_runs(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schedule_id INTEGER NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running','completed','partial','failed','cancelled','interrupted')),
      conversation_id TEXT,
      run_id TEXT,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_schedule_runs_schedule ON agent_schedule_runs(schedule_id,started_at);
  `)
}
