import type Database from 'better-sqlite3'
import fs from 'node:fs'

export const migrationVersion=8
export const migrationName='paper_source_kind'

/**
 * Existing Zotero imports used generated one-page PDFs for record-only items.
 * Preserve those bibliographic entries while making their limited evidence explicit.
 */
export const migrationChecksum='68c41f90408f64f718b047b96c680ab7c072ac20f757be5df1741ecc8db8e743'

/** CSPAPER's generated title page is a five-object, 794px-wide JPEG-only PDF. */
function isGeneratedRecordPdf(file:string):boolean {
  try {
    const bytes=fs.readFileSync(file).subarray(0,4096).toString('latin1')
    return /\/MediaBox \[0 0 794 \d+\]/.test(bytes) &&
      bytes.includes('/Width 794') &&
      bytes.includes('/Filter /DCTDecode') &&
      bytes.includes('/Type /Catalog')
  } catch {
    return false
  }
}

export function up(db:Database.Database):void {
  const columns=db.prepare('PRAGMA table_info(papers)').all() as Array<{name:string}>
  if(!columns.some(column=>column.name==='indexed')) db.exec('ALTER TABLE papers ADD COLUMN indexed INTEGER DEFAULT 0')
  if(!columns.some(column=>column.name==='n_pages')) db.exec('ALTER TABLE papers ADD COLUMN n_pages INTEGER DEFAULT 0')
  if(!columns.some(column=>column.name==='file_size')) db.exec('ALTER TABLE papers ADD COLUMN file_size INTEGER')
  if(!columns.some(column=>column.name==='path')) db.exec('ALTER TABLE papers ADD COLUMN path TEXT')
  if(!columns.some(column=>column.name==='source_kind')) db.exec(`ALTER TABLE papers ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'pdf'`)
  const setRecord=db.prepare("UPDATE papers SET source_kind='record' WHERE id=?")
  const candidates=db.prepare(`SELECT id,path FROM papers WHERE source_kind='pdf' AND COALESCE(n_pages,0)<=1 AND path IS NOT NULL`).all() as Array<{id:number,path:string}>
  for(const row of candidates) if(isGeneratedRecordPdf(row.path)) setRecord.run(row.id)
  const hasChunks=!!(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='chunks'").get())
  if(hasChunks) {
    db.exec(`
      UPDATE papers
      SET indexed=0,pvec=NULL
      WHERE source_kind='pdf' AND indexed=1
        AND NOT EXISTS(SELECT 1 FROM chunks WHERE paper_id=papers.id);
    `)
  }
}
