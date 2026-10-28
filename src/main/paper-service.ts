import { getDb, getSettings } from './db'
import { notesFromMarkdown, normalizePath, paperFiles, patchFrontmatter, readPaperMarkdown, replaceMarkdownNotes } from './paper-files'
import { runFileOperation } from './operations/journal'
import { writeFilesAtomically } from './paper-files'

export const META_FIELDS = ['title', 'authors', 'year', 'venue', 'volume', 'issue', 'pages', 'publisher', 'doi', 'language'] as const
export type MetadataField = typeof META_FIELDS[number]
type PaperRecord = Record<string, any> & { id: number; path: string; slug: string }

function record(id: number): PaperRecord {
  const row = getDb().prepare('SELECT * FROM papers WHERE id=?').get(id) as PaperRecord | undefined
  if (!row) throw new Error('文献不存在或已移出库')
  return row
}

export function updatePaperMetadata(id: number, input: Partial<Record<MetadataField, unknown>>): boolean {
  const db = getDb()
  const current = record(id)
  const patch: Record<string, string | number | null> = {}
  for (const key of META_FIELDS) {
    if (!Object.hasOwn(input, key)) continue
    const value = input[key]
    if (key === 'year') {
      const year = value === '' || value == null ? null : Number(value)
      if (year !== null && (!Number.isInteger(year) || year < 1 || year > 9999)) throw new Error('年份应为有效的整数')
      patch.year = year
    } else {
      const text = String(value ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, key === 'authors' ? 10000 : 2000)
      if (key === 'title' && !text) throw new Error('标题不能为空')
      patch[key] = text
    }
  }
  if (!Object.keys(patch).length) return false
  const next = { ...current, ...patch }
  const doc = readPaperMarkdown(current.path, current.slug)
  const complete = Object.fromEntries(META_FIELDS.map(key => [key, next[key] ?? null]))
  let markdown = patchFrontmatter(doc.raw || `# ${next.title}\n`, complete)
  if (Object.hasOwn(patch, 'title')) markdown = markdown.replace(/^# .+$/m, () => '# ' + next.title)
  let csl: Record<string, unknown> = {}
  try { csl = JSON.parse(current.csl || '{}') } catch { /* damaged optional cache */ }
  Object.assign(csl, { title: next.title, author: String(next.authors ?? '').split(/[,;，；]/).filter(Boolean).map(literal => ({ literal: literal.trim() })),
    issued: next.year == null ? undefined : { 'date-parts': [[next.year]] }, 'container-title': next.venue,
    DOI: next.doi || undefined, volume: next.volume || undefined, issue: next.issue || undefined,
    page: next.pages || undefined, publisher: next.publisher || undefined, language: next.language || undefined })
  const json = JSON.stringify(csl)
  const operation=runFileOperation(db,{
    id:`metadata-${id}-${Date.now()}-${Math.random().toString(16).slice(2)}`,kind:'paper.update_metadata',target:`paper:${id}`,
    expectedVersion:current.source_stamp??undefined,edits:[{path:doc.path,content:markdown},{path:paperFiles(current.path,current.slug).csl,content:json}],
    commit:()=>db.transaction(() => {
      const keys=Object.keys(patch)
      db.prepare(`UPDATE papers SET ${keys.map(k=>`${k}=?`).join(',')},csl=?,pvec=NULL,source_stamp=NULL WHERE id=?`).run(...Object.values(patch),json,id)
      db.prepare('INSERT OR REPLACE INTO papers_fts(rowid,title,authors,venue,slug) VALUES(?,?,?,?,?)').run(id,next.title,next.authors,next.venue,next.slug)
    })()
  })
  if(operation.state==='failed')throw new Error(operation.error??'元数据写入失败')
  return true
}

export function excludePaperPath(pdf: string, reason: string): void {
  getDb().prepare('INSERT OR REPLACE INTO library_exclusions(path,library_root,reason) VALUES(?,?,?)').run(normalizePath(pdf), normalizePath(getSettings().libraryPath), reason)
}

export function mergePapers(keepId: number, suppliedIds: number[]): boolean {
  const db = getDb()
  const keep = record(keepId)
  const ids = [...new Set(suppliedIds)].filter(id => id !== keepId)
  if (!ids.length) return false
  const drops = ids.map(record)
  const keepDoc = readPaperMarkdown(keep.path, keep.slug)
  const notes = [notesFromMarkdown(keepDoc.raw)]
  const tags = new Set<string>()
  for (const paper of [keep, ...drops]) {
    for (const row of db.prepare('SELECT t.name FROM tags t JOIN paper_tags pt ON pt.tag_id=t.id WHERE pt.paper_id=?').all(paper.id) as Array<{ name: string }>) tags.add(row.name)
    if (paper.id !== keepId) {
      const text = notesFromMarkdown(readPaperMarkdown(paper.path, paper.slug).raw)
      if (text && !notes.includes(text)) notes.push(`### 合并自：${paper.title}\n\n${text}`)
    }
  }
  let markdown = patchFrontmatter(keepDoc.raw || `# ${keep.title}\n`, { tags: [...tags] })
  markdown = replaceMarkdownNotes(markdown, notes.filter(Boolean).join('\n\n'))
  writeFilesAtomically([{ path: keepDoc.path, content: markdown }], () => {
    db.transaction(() => {
      for (const drop of drops) {
        db.prepare('INSERT OR IGNORE INTO paper_attachments(paper_id,path,name) VALUES(?,?,?)').run(keepId,drop.path,drop.title)
        db.prepare('INSERT OR IGNORE INTO paper_attachments(paper_id,path,name) SELECT ?,path,name FROM paper_attachments WHERE paper_id=?').run(keepId,drop.id)
        db.prepare('INSERT OR IGNORE INTO paper_tags(paper_id,tag_id) SELECT ?,tag_id FROM paper_tags WHERE paper_id=?').run(keepId, drop.id)
        db.prepare('INSERT OR IGNORE INTO paper_collections(paper_id,collection_id) SELECT ?,collection_id FROM paper_collections WHERE paper_id=?').run(keepId, drop.id)
        db.prepare('UPDATE highlights SET paper_id=? WHERE paper_id=?').run(keepId, drop.id)
        const links = db.prepare('SELECT paper_id,related_id,kind FROM paper_related WHERE paper_id=? OR related_id=?').all(drop.id, drop.id) as Array<{ paper_id: number; related_id: number; kind: string }>
        for (const link of links) {
          const a = link.paper_id === drop.id ? keepId : link.paper_id, b = link.related_id === drop.id ? keepId : link.related_id
          if (a !== b) db.prepare('INSERT OR IGNORE INTO paper_related(paper_id,related_id,kind) VALUES(?,?,?)').run(a, b, link.kind)
        }
        db.prepare('DELETE FROM paper_related WHERE paper_id=? OR related_id=?').run(drop.id, drop.id)
        for(const log of db.prepare('SELECT day,seconds FROM read_log WHERE paper_id=?').all(drop.id) as Array<{day:string;seconds:number}>) {
          db.prepare('INSERT INTO read_log(day,paper_id,seconds) VALUES(?,?,?) ON CONFLICT(day,paper_id) DO UPDATE SET seconds=seconds+excluded.seconds').run(log.day,keepId,log.seconds)
        }
        db.prepare('DELETE FROM read_log WHERE paper_id=?').run(drop.id)
        db.prepare('UPDATE papers SET read_seconds=COALESCE(read_seconds,0)+?,furthest_page=max(COALESCE(furthest_page,0),?) WHERE id=?').run(drop.read_seconds || 0, drop.furthest_page || 0, keepId)
        db.prepare('DELETE FROM chunks_fts WHERE rowid IN (SELECT id FROM chunks WHERE paper_id=?)').run(drop.id)
        db.prepare('DELETE FROM papers_fts WHERE rowid=?').run(drop.id)
        excludePaperPath(drop.path, 'merged')
        db.prepare('DELETE FROM papers WHERE id=?').run(drop.id)
      }
    })()
  })
  return true
}

export function duplicatePapers(): Array<Array<{ id: number; title: string; year: number | null; added_at: string }>> {
  const rows = getDb().prepare('SELECT id,title,year,added_at,doi FROM active_papers').all() as Array<{ id:number; title:string; year:number|null; added_at:string; doi:string|null }>
  const parent = new Map(rows.map(p => [p.id, p.id]))
  const find = (id: number): number => { let root = id; while (parent.get(root) !== root) root = parent.get(root)!; while (id !== root) { const next = parent.get(id)!; parent.set(id, root); id = next } return root }
  const seen = new Map<string, number>()
  for (const row of rows) {
    const doi = (row.doi || '').toLowerCase().replace(/^https?:\/\/(dx\.)?doi.org\//, '').trim()
    const title = row.title.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')
    for (const key of [doi && 'doi:' + doi, title && 'title:' + title].filter(Boolean) as string[]) {
      if (seen.has(key)) parent.set(find(row.id), find(seen.get(key)!))
      else seen.set(key, row.id)
    }
  }
  const groups = new Map<number, typeof rows>()
  for (const row of rows) { const root = find(row.id); const group = groups.get(root) ?? []; group.push(row); groups.set(root, group) }
  return [...groups.values()].filter(group => group.length > 1)
}
