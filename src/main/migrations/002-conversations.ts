import type Database from 'better-sqlite3'

export const migrationVersion = 2
export const migrationName = 'conversations_v1'

/** Persistent conversations, runs, replayable events, tool calls, citations and artifact links. */
export const migrationChecksum='4711978092bbce663ccdf63f5c4589abec6a8dffe742fd7aa2a04af1061daeb0'

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations(
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT '新会话',
      mode TEXT NOT NULL DEFAULT 'ask' CHECK(mode IN ('ask','act')),
      entry TEXT NOT NULL DEFAULT 'global' CHECK(entry IN ('global','reader','work','compare','notes')),
      active_leaf_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_conversations_workspace ON conversations(workspace_id,archived_at,updated_at DESC,id DESC);

    CREATE TABLE IF NOT EXISTS chat_messages(
      ord INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      parent_id TEXT REFERENCES chat_messages(id) ON DELETE SET NULL,
      client_message_id TEXT,
      role TEXT NOT NULL CHECK(role IN ('user','assistant','system','tool')),
      parts_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'complete' CHECK(status IN ('streaming','complete','partial','cancelled','failed')),
      run_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(conversation_id,client_message_id)
    );
    CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON chat_messages(conversation_id,ord DESC);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_parent ON chat_messages(parent_id);

    CREATE TABLE IF NOT EXISTS chat_runs(
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      user_message_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
      assistant_message_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
      mode TEXT NOT NULL DEFAULT 'ask' CHECK(mode IN ('ask','act')),
      status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','preparing','generating','executing_tools','awaiting_approval','cancelled','failed','partial','completed')),
      model_binding_json TEXT NOT NULL DEFAULT '{}',
      context_snapshot_json TEXT NOT NULL DEFAULT '{}',
      error_json TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      UNIQUE(conversation_id,user_message_id)
    );
    CREATE INDEX IF NOT EXISTS idx_chat_runs_conversation ON chat_runs(conversation_id,status,created_at DESC);

    CREATE TABLE IF NOT EXISTS chat_run_events(
      run_id TEXT NOT NULL REFERENCES chat_runs(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      message_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      PRIMARY KEY(run_id,seq)
    );
    CREATE INDEX IF NOT EXISTS idx_chat_run_events_conversation ON chat_run_events(conversation_id,run_id,seq);

    CREATE TABLE IF NOT EXISTS chat_tool_calls(
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES chat_runs(id) ON DELETE CASCADE,
      tool_call_id TEXT NOT NULL UNIQUE,
      tool TEXT NOT NULL,
      tool_version INTEGER NOT NULL DEFAULT 1,
      args_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','awaiting_approval','running','success','partial','failed','cancelled')),
      result_json TEXT,
      operation_id TEXT UNIQUE,
      started_at TEXT,
      finished_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chat_tool_calls_run ON chat_tool_calls(run_id,status);

    CREATE TABLE IF NOT EXISTS chat_sources(
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES chat_runs(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      paper_id INTEGER,
      title TEXT NOT NULL DEFAULT '',
      document_version TEXT,
      locator_json TEXT NOT NULL DEFAULT '{}',
      snippet TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'available',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chat_sources_run ON chat_sources(run_id,paper_id);

    CREATE TABLE IF NOT EXISTS chat_artifacts(
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES chat_runs(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      entity_id TEXT,
      title TEXT NOT NULL,
      uri TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chat_artifacts_run ON chat_artifacts(run_id,kind);
  `)
}
