import type Database from 'better-sqlite3'

export const migrationVersion = 3
export const migrationName = 'operations_journal_v1'

export const migrationChecksum='d43e5f1b4849b2e86186a28d3794c76064d20d29e2a8d2898ae1277b3b3a0aab'

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS operation_journal(
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      target TEXT NOT NULL,
      expected_version TEXT,
      before_digest_json TEXT NOT NULL,
      after_digest_json TEXT NOT NULL,
      backup_dir TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('pending','committed','failed','rolled_back','needs_review','conflict')),
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_operation_journal_state ON operation_journal(state,created_at);
  `)
}
