import type Database from 'better-sqlite3'
import { READING_STATUSES } from '../shared/paper'
import { normalizePath, parseList } from './paper-files'
import type { LibraryInventory } from './library-inventory'

export interface ScanResult { added: number; updated: number; total: number; missing: number; errors: string[]; timing?: { workerMs:number; applyMs:number } }

/** Each yielded transaction is bounded; user edits can run between batches. */
function* reconciliation(db: Database.Database, inventory: LibraryInventory): Generator<()=>void,ScanResult> {
  const root = normalizePath(inventory.root)
  const result: ScanResult = { added:0,updated:0,total:0,missing:0,errors:[...inventory.errors] }
  const old = new Map((db.prepare('SELECT * FROM papers WHERE library_root=?').all(root) as Array<Record<string, any>>).map(p => [normalizePath(p.path), p]))
  const slugs = new Map((db.prepare('SELECT slug,path FROM papers').all() as Array<{slug:string;path:string}>).map(p => [p.slug,normalizePath(p.path)]))
  const excluded = new Set((db.prepare('SELECT path FROM library_exclusions WHERE library_root=?').all(root) as Array<{path:string}>).map(r => r.path))
  const seen = new Set<string>()
  const fields = ['title','authors','year','venue','doi','volume','issue','pages','publisher','language','abstract']
  const columns = [...fields,'source_kind','slug','path','category','library_root','source_stamp','file_mtime','file_size','md_mtime','md_size','csl','item_type']
  const save = db.prepare(`INSERT INTO papers(${columns.join(',')}) VALUES(${columns.map(c=>'@'+c).join(',')}) ON CONFLICT(path) DO UPDATE SET ${columns.filter(c=>c!=='path').map(c=>`${c}=excluded.${c}`).join(',')},missing_at=NULL`)
  const titleIndex = db.prepare('INSERT OR REPLACE INTO papers_fts(rowid,title,authors,venue,slug) VALUES(?,?,?,?,?)')
  const markMissing = db.prepare("UPDATE papers SET missing_at=COALESCE(missing_at,datetime('now')) WHERE id=?")
  const clearMissing = db.prepare('UPDATE papers SET missing_at=NULL,category=? WHERE id=?')
  const tagLookup = db.prepare('SELECT id FROM tags WHERE name=?')
  const tagCreate = db.prepare("INSERT OR IGNORE INTO tags(name,color) VALUES(?,'#5a7256')")
  const link = db.prepare('INSERT OR IGNORE INTO paper_tags(paper_id,tag_id) VALUES(?,?)')
  const currentById=db.prepare('SELECT * FROM papers WHERE id=?')
  const currentByPath=db.prepare('SELECT * FROM papers WHERE path=?')
  const excludedNow=db.prepare('SELECT 1 FROM library_exclusions WHERE library_root=? AND path=?')
  for(let offset=0;offset<inventory.entries.length;offset+=20)yield db.transaction(() => {
    for (const entry of inventory.entries.slice(offset,offset+20)) {
      const key = normalizePath(entry.path)
      seen.add(key)
      if (excluded.has(key)||excludedNow.get(root,key)) continue
      const initial=old.get(key)
      const before=(initial?currentById.get(initial.id):currentByPath.get(entry.path)) as Record<string,any>|undefined
      if(initial&&(!before||normalizePath(before.path)!==key))continue
      // A user edit may have committed while the worker was reading. Never overwrite it.
      if (before && (before.source_stamp || '') !== entry.basedOn) continue
      result.total++
      if (before && entry.metadata === null && before.source_stamp === entry.stamp) {
        if (before.missing_at || before.category !== entry.category) { clearMissing.run(entry.category,before.id); result.updated++ }
        continue
      }
      const fm = entry.metadata ?? {}
      const csl = entry.csl ?? (() => { try { return JSON.parse(before?.csl || '{}') } catch { return {} } })()
      const cslFields: Record<string, unknown> = { title:csl.title,authors:Array.isArray(csl.author)?csl.author.map((a:any)=>a.literal || [a.given,a.family].filter(Boolean).join(' ')).join(', '):'',
        year:csl.issued?.['date-parts']?.[0]?.[0],venue:Array.isArray(csl['container-title'])?csl['container-title'][0]:csl['container-title'],doi:csl.DOI,volume:csl.volume,issue:csl.issue,pages:csl.page,publisher:csl.publisher,language:csl.language }
      const values: Record<string, any> = {}
      // A replaced PDF larger than the generated title-page threshold becomes full text again.
      values.source_kind = fm.source_kind === 'record' ? 'record' : fm.source_kind === 'pdf' ? 'pdf' : entry.pdfSize > 102400 || before?.source_kind !== 'record' ? 'pdf' : 'record'
      for (const field of fields) values[field] = Object.hasOwn(fm,field) ? fm[field] : before?.[field] ?? cslFields[field] ?? ''
      values.title ||= entry.slug.replace(/-/g,' ')
      values.year = parseInt(values.year,10) || null
      let slug = before?.slug || entry.slug
      for (let n=2; slugs.has(slug) && slugs.get(slug)!==key; n++) slug = entry.slug + '-' + n
      slugs.set(slug,key)
      // Align differently-cased paths without replacing document identity.
      if (before && before.path !== entry.path) db.prepare('UPDATE papers SET path=? WHERE id=?').run(entry.path,before.id)
      const data = { ...values,slug,path:entry.path,category:entry.category,library_root:root,source_stamp:entry.stamp,
        file_mtime:entry.pdfMtime,file_size:entry.pdfSize,md_mtime:entry.mdMtime,md_size:entry.mdSize,
        csl:Object.keys(csl).length?JSON.stringify(csl):null,item_type:csl.type || before?.item_type || 'article-journal',abstract:values.abstract || null }
      const saved = save.run(data)
      const id = before?.id ?? Number(saved.lastInsertRowid)
      titleIndex.run(id,values.title,values.authors,values.venue,slug)
      if (before && (before.file_mtime !== entry.pdfMtime || before.file_size !== entry.pdfSize)) {
        db.prepare('DELETE FROM chunks_fts WHERE rowid IN (SELECT id FROM chunks WHERE paper_id=?)').run(id)
        db.prepare('DELETE FROM chunks WHERE paper_id=?').run(id)
        db.prepare('UPDATE papers SET indexed=0,pvec=NULL WHERE id=?').run(id)
      } else if (before && (before.title!==values.title || before.authors!==values.authors)) db.prepare('UPDATE papers SET pvec=NULL WHERE id=?').run(id)
      if (Object.hasOwn(fm,'tags')) {
        db.prepare('DELETE FROM paper_tags WHERE paper_id=?').run(id)
        for (const name of parseList(fm.tags).filter(n=>!n.startsWith('status/'))) {
          tagCreate.run(name)
          link.run(id,(tagLookup.get(name) as {id:number}).id)
        }
      }
      if (!before && (READING_STATUSES as readonly string[]).includes(fm.status)) db.prepare('UPDATE papers SET status=? WHERE id=?').run(fm.status,id)
      if (before) result.updated++; else result.added++
    }
  })
  if(inventory.complete) {
    const missing=[...old].filter(([key,row])=>!seen.has(key)&&!row.missing_at)
    for(let offset=0;offset<missing.length;offset+=20)yield db.transaction(()=>{
      for(const [key,row] of missing.slice(offset,offset+20)) {
        const current=currentById.get(row.id) as Record<string,any>|undefined
        if(current&&normalizePath(current.path)===key&&current.source_stamp===row.source_stamp&&!current.missing_at){markMissing.run(row.id);result.missing++}
      }
    })
  }
  return result
}

export function applyLibraryInventory(db:Database.Database,inventory:LibraryInventory):ScanResult {
  const iterator=reconciliation(db,inventory)
  let step=iterator.next()
  while(!step.done){step.value();step=iterator.next()}
  return step.value
}

export async function applyLibraryInventoryAsync(db:Database.Database,inventory:LibraryInventory):Promise<ScanResult> {
  const iterator=reconciliation(db,inventory)
  let step=iterator.next()
  while(!step.done){step.value();await new Promise<void>(resolve=>setImmediate(resolve));step=iterator.next()}
  return step.value
}
