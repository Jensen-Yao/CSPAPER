import type Database from 'better-sqlite3'

export const migrationVersion = 5
export const migrationName = 'conversation_event_cursor'

export const migrationChecksum='477451035f24877a239d2c9586243dd32dac25ac61c742cc881201729d63c81b'

export function up(db: Database.Database): void {
  db.exec(`
    ALTER TABLE chat_run_events ADD COLUMN conversation_seq INTEGER;
    WITH ordered AS (
      SELECT rowid AS event_id, ROW_NUMBER() OVER (PARTITION BY conversation_id ORDER BY rowid) AS cursor
      FROM chat_run_events
    ) UPDATE chat_run_events SET conversation_seq=(SELECT cursor FROM ordered WHERE event_id=chat_run_events.rowid);
    CREATE UNIQUE INDEX idx_chat_events_cursor ON chat_run_events(conversation_id,conversation_seq);
  `)
}
