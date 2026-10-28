import type Database from 'better-sqlite3'

export const migrationVersion=7
export const migrationName='active_library_order_index'

/** Keeps the 10k-library list on index order instead of a temporary B-tree sort. */
export const migrationChecksum='18e4d226b10f9f2ef7be43cca42d67b679e8deaa49b9b6af759400f833f5d78a'

export function up(db:Database.Database):void {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_papers_active_order
    ON papers(library_root, category, year, slug)
    WHERE deleted_at IS NULL AND missing_at IS NULL;
  `)
}
