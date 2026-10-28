import fs from 'node:fs'
import path from 'node:path'
import { normalizePath, paperFilesFromEntries, parseFrontmatter } from './paper-files'

export interface LibraryEntry {
  path: string
  slug: string
  category: string
  stamp: string
  basedOn: string
  pdfMtime: number
  pdfSize: number
  mdMtime: number
  mdSize: number
  metadata: Record<string, string> | null
  csl: Record<string, unknown> | null
}
export interface LibraryInventory { root: string; entries: LibraryEntry[]; complete: boolean; errors: string[]; cancelled?: boolean }

/** Filesystem-only work. No Electron or SQLite dependency, so it runs in a worker. */
export function collectLibrary(root: string, previous: Record<string, string> = {}, options: { cancel?: Int32Array; onProgress?: (found: number, current: string) => void } = {}): LibraryInventory {
  const result: LibraryInventory = { root, entries: [], complete: true, errors: [] }
  const cancelled=():boolean=>options.cancel?Atomics.load(options.cancel,0)===1:false
  const base = fs.existsSync(path.join(root, 'papers')) ? path.join(root, 'papers') : root
  const stat = (file: string) => { try { return fs.statSync(file) } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e } }
  const visit = (dir: string, descend = true, categoryRoot = base): void => {
    if(cancelled()){result.complete=false;result.cancelled=true;return}
    let children: fs.Dirent[]
    try { children = fs.readdirSync(dir, { withFileTypes: true }) } catch (error) {
      result.complete = false; result.errors.push(`${dir}: ${String(error)}`); return
    }
    const names=new Set(children.map(child=>child.name))
    const pdfNames=children.filter(child=>child.isFile()&&child.name.toLowerCase().endsWith('.pdf')).map(child=>child.name)
    const noteNames=children.filter(child=>child.isFile()&&child.name.toLowerCase().endsWith('.md')).map(child=>child.name)
    for (const entry of children) {
      if(cancelled()){result.complete=false;result.cancelled=true;return}
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) { if(descend) visit(file,true,categoryRoot); continue }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.pdf')) continue
      try {
        const pdf = fs.statSync(file)
        const files = paperFilesFromEntries(file,undefined,names,pdfNames.length,noteNames)
        const md = stat(files.md), cslStat = stat(files.csl)
        const stamp = [pdf.mtimeMs, pdf.size, md?.mtimeMs ?? 0, md?.size ?? 0, cslStat?.mtimeMs ?? 0, cslStat?.size ?? 0].join(':')
        const changed = previous[normalizePath(file)] !== stamp
        const parents = path.relative(categoryRoot, dir).split(path.sep).filter(Boolean)
        const slug = parents.length >= 2 ? path.basename(dir) : path.basename(file, path.extname(file))
        const category = parents.length >= 2 ? parents.slice(0, -1).map(s => s.replace(/^\d+-/, '')).join('/') : parents[0]?.replace(/^\d+-/, '') || path.basename(root)
        let csl: Record<string, unknown> | null = null
        if (changed && cslStat && cslStat.size < 500000) {
          try { csl = JSON.parse(fs.readFileSync(files.csl, 'utf8')) } catch { result.errors.push(`无法解析 CSL: ${files.csl}`) }
        }
        result.entries.push({ path:file,slug,category,stamp,basedOn:previous[normalizePath(file)] || '',pdfMtime:pdf.mtimeMs,pdfSize:pdf.size,mdMtime:md?.mtimeMs ?? 0,mdSize:md?.size ?? 0,
          metadata: changed ? (md ? parseFrontmatter(fs.readFileSync(files.md, 'utf8')) : {}) : null, csl })
        options.onProgress?.(result.entries.length,file)
      } catch (error) { result.complete = false; result.errors.push(`${file}: ${String(error)}`) }
    }
  }
  if(normalizePath(base)!==normalizePath(root)) visit(root,false,root)
  visit(base)
  return result
}
