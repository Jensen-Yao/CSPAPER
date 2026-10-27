// 条目关联（v0.13 对标 Zotero related items）：
// manual = 用户手动关联；auto = 语义相似自动建议（pvec 最近邻 top5，随时刷新）。
import { getDb } from './db'

export interface RelatedRow {
  id: number
  title: string
  kind: 'manual' | 'auto'
}

function ensureTable(): void {
  getDb().exec(`CREATE TABLE IF NOT EXISTS paper_related(
    paper_id INTEGER NOT NULL,
    related_id INTEGER NOT NULL,
    kind TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT DEFAULT (datetime('now','localtime')),
    PRIMARY KEY(paper_id, related_id)
  )`)
}

export function listRelated(paperId: number): RelatedRow[] {
  ensureTable()
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT r.related_id AS id, p.title AS title, r.kind AS kind
       FROM paper_related r JOIN papers p ON p.id = r.related_id
       WHERE r.paper_id = ? ORDER BY r.kind DESC, r.created_at DESC`
    )
    .all(paperId) as RelatedRow[]
  return rows
}

export function setRelated(a: number, b: number, kind: 'manual' | 'auto' = 'manual'): void {
  ensureTable()
  const db = getDb()
  db.prepare('INSERT OR REPLACE INTO paper_related(paper_id, related_id, kind) VALUES(?,?,?)').run(a, b, kind)
  db.prepare('INSERT OR REPLACE INTO paper_related(paper_id, related_id, kind) VALUES(?,?,?)').run(b, a, kind)
}

export function removeRelated(a: number, b: number): void {
  ensureTable()
  const db = getDb()
  db.prepare('DELETE FROM paper_related WHERE (paper_id=? AND related_id=?) OR (paper_id=? AND related_id=?)').run(a, b, b, a)
}

/** 刷新一篇的自动建议（语义 top5，覆盖写 auto 行；manual 行不动） */
export function refreshAutoRelated(paperId: number, topN = 5): number {
  ensureTable()
  const db = getDb()
  const me = db.prepare('SELECT id, title, abstract, summary FROM papers WHERE id=?').get(paperId) as
    | { id: number; title: string; abstract: string | null; summary: string | null }
    | undefined
  if (!me) return 0
  const others = db.prepare('SELECT id, pvec FROM papers WHERE pvec IS NOT NULL AND id != ?').all(paperId) as Array<{
    id: number
    pvec: Buffer
  }>
  if (others.length === 0) return 0
  const mine = db.prepare('SELECT pvec FROM papers WHERE id=?').get(paperId) as { pvec: Buffer } | undefined
  let qv: Float32Array | null = null
  if (mine?.pvec) qv = new Float32Array(mine.pvec.buffer, mine.pvec.byteOffset, mine.pvec.byteLength / 4)
  if (!qv) return 0
  const sims: Array<{ id: number; s: number }> = []
  for (const r of others) {
    const v = new Float32Array(r.pvec.buffer, r.pvec.byteOffset, r.pvec.byteLength / 4)
    let dot = 0
    const n = Math.min(v.length, qv.length)
    for (let d = 0; d < n; d++) dot += v[d] * qv[d]
    sims.push({ id: r.id, s: dot })
  }
  sims.sort((a, b) => b.s - a.s)
  db.prepare('DELETE FROM paper_related WHERE paper_id=? AND kind=?').run(paperId, 'auto')
  const ins = db.prepare('INSERT OR IGNORE INTO paper_related(paper_id, related_id, kind) VALUES(?,?,?)')
  let wrote = 0
  for (const s of sims.slice(0, topN)) {
    // 对向也写成 auto（双向可发现，但不覆盖 manual）
    ins.run(paperId, s.id, 'auto')
    db.prepare('INSERT OR IGNORE INTO paper_related(paper_id, related_id, kind) VALUES(?,?,?)').run(s.id, paperId, 'auto')
    wrote++
  }
  return wrote
}
