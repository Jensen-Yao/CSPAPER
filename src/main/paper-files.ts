import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

/** One identity rule for every PDF/Markdown/CSL consumer, including flat libraries. */
export function normalizePath(value: string): string {
  const resolved = path.resolve(value)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

export function isWithinDirectory(file: string, root: string): boolean {
  const rel = path.relative(normalizePath(root), normalizePath(file))
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel))
}

export function paperFilesFromEntries(pdf:string,slug:string|undefined,names:Set<string>,pdfCount:number,notes:string[]):{md:string;csl:string} {
  const dir=path.dirname(pdf),stem=path.basename(pdf,path.extname(pdf)),exactName=`${stem}.md`,exact=path.join(dir,exactName)
  let md=exact
  if(!names.has(exactName)&&pdfCount<=1) {
    const candidates=[...new Set([path.basename(dir),slug].filter(Boolean))].map(name=>({name:`${name}.md`,path:path.join(dir,`${name}.md`)}))
    const found=candidates.find(candidate=>names.has(candidate.name))
    md=found?.path??(notes.length===1?path.join(dir,notes[0]):stem==='paper'?candidates[0]?.path??exact:exact)
  }
  return {md,csl:md.replace(/\.md$/i,'.csl.json')}
}

export function paperFiles(pdf: string, slug?: string): { md: string; csl: string } {
  const dir=path.dirname(pdf)
  const entries=fs.existsSync(dir)?fs.readdirSync(dir):[]
  const pdfs=entries.filter(file=>file.toLowerCase().endsWith('.pdf'))
  const notes=entries.filter(file=>file.toLowerCase().endsWith('.md'))
  return paperFilesFromEntries(pdf,slug,new Set(entries),pdfs.length,notes)
}

export function ownsPaperDirectory(pdf: string, library: string): boolean {
  const root = fs.existsSync(path.join(library, 'papers')) ? path.join(library, 'papers') : library
  const rel = path.relative(root, pdf)
  return isWithinDirectory(pdf, root) && rel.split(path.sep).length >= 3 &&
    fs.readdirSync(path.dirname(pdf)).filter(f => f.toLowerCase().endsWith('.pdf')).length === 1
}

export function parseList(raw: string): string[] {
  const value = raw.trim().replace(/^\[|\]$/g, '')
  const values: string[] = []
  let token = '', quote = '', escaped = false
  for (const c of value) {
    if (escaped) { token += c; escaped = false; continue }
    if (quote && c === '\\') { token += c; escaped = true; continue }
    if ((c === '"' || c === "'") && (!quote || c === quote)) { quote = quote ? '' : c; token += c; continue }
    if (!quote && /[,，;；]/.test(c)) { values.push(unquote(token)); token = '' } else token += c
  }
  values.push(unquote(token))
  return [...new Set(values.map(v => v.trim()).filter(Boolean))]
}

function unquote(value: string): string {
  const s = value.trim()
  if (s.startsWith('"') && s.endsWith('"')) {
    try { return JSON.parse(s) as string } catch { return s.slice(1, -1) }
  }
  if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'")
  return s === 'null' || s === '~' ? '' : s
}

export function parseFrontmatter(raw: string): Record<string, string> {
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  const out: Record<string, string> = {}
  const match = text.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)
  if (match) {
    const lines = match[1].split('\n')
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^([\w-]+):\s*(.*)$/)
      if (!m) continue
      let value = m[2].trim()
      if (value === '|' || value === '>') {
        const block: string[] = []
        while (i + 1 < lines.length && /^\s{2,}/.test(lines[i + 1])) block.push(lines[++i].trim())
        value = block.join(' ')
      }
      out[m[1]] = unquote(value)
    }
  }
  if (!out.title) out.title = text.match(/^# (.+)$/m)?.[1]?.trim() ?? ''
  return out
}

export function patchFrontmatter(raw: string, patch: Record<string, unknown>): string {
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  const match = text.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)
  let front = match?.[1] ?? ''
  for (const [key, value] of Object.entries(patch)) {
    if (!/^[\w-]+$/.test(key)) throw new Error('无效的元数据字段')
    const line = `${key}: ${JSON.stringify(value ?? null)}`
    const re = new RegExp(`^${key}:[^\n]*(?:\n[ \\t]+[^\n]*)*`, 'm')
    front = re.test(front) ? front.replace(re, () => line) : `${front}${front ? '\n' : ''}${line}`
  }
  return `---\n${front}\n---\n${match ? text.slice(match[0].length) : '\n' + text}`
}

function renameWithRetry(from:string,to:string):void {
  let lastError:unknown
  for(let attempt=0;attempt<20;attempt++) {
    try{fs.renameSync(from,to);return}
    catch(error) {
      lastError=error
      const code=(error as NodeJS.ErrnoException).code
      if(code!=='EPERM'&&code!=='EBUSY'&&code!=='ETXTBSY')throw error
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,25)
    }
  }
  throw lastError
}

export interface AtomicFileEdit {
  path: string
  /** UTF-8 text or binary content. Use sourcePath for a large binary source file. */
  content?: string | Buffer
  /** Read this file as binary content without forcing callers to load it first. */
  sourcePath?: string
}

/** Atomic replacement with rollback for text and binary multi-file operations. DB callers run inside a transaction. */
export function writeFilesAtomically(edits: AtomicFileEdit[], commit: () => void = () => {}): void {
  const unique = new Map(edits.map(e => [normalizePath(e.path), e]))
  const staged: Array<{ path: string; temp: string; before: Buffer | null }> = []
  try {
    for (const edit of unique.values()) {
      const content = Buffer.isBuffer(edit.content) || typeof edit.content === 'string'
        ? Buffer.from(edit.content as string | Buffer)
        : fs.readFileSync(edit.sourcePath!)
      const before = fs.existsSync(edit.path) ? fs.readFileSync(edit.path) : null
      if (before?.equals(content)) continue
      const temp = edit.path + `.cspaper-${randomUUID()}.tmp`
      staged.push({ path: edit.path, temp, before })
      fs.writeFileSync(temp, content, { flag: 'wx' })
    }
    for (const edit of staged) renameWithRetry(edit.temp, edit.path)
    commit()
  } catch (error) {
    for (const edit of [...staged].reverse()) {
      if (fs.existsSync(edit.temp)) fs.unlinkSync(edit.temp)
      if (edit.before !== null) fs.writeFileSync(edit.path, edit.before)
      else if (fs.existsSync(edit.path)) fs.unlinkSync(edit.path)
    }
    throw error
  }
}

export function readPaperMarkdown(pdf: string, slug?: string): { path: string; raw: string } {
  const md = paperFiles(pdf, slug).md
  return { path: md, raw: fs.existsSync(md) ? fs.readFileSync(md, 'utf8') : '' }
}

const NOTES_HEAD = '## 我的笔记'
const NOTES_OPEN = '<!-- cspaper:notes:start -->'
const NOTES_CLOSE = '<!-- cspaper:notes:end -->'
const KNOWN_SECTIONS = ['阅读状态', '速览', 'Zotero 标注', 'Zotero 笔记', '参考文献']

function noteRange(raw: string): { start: number; end: number } | null {
  const head = raw.indexOf(NOTES_HEAD)
  if (head < 0) return null
  const start = head + NOTES_HEAD.length
  const open = raw.indexOf(NOTES_OPEN, start)
  if (open >= 0) {
    const close = raw.indexOf(NOTES_CLOSE, open)
    if (close < 0) throw new Error('笔记结束标记缺失，请先修复 Markdown 文件')
    return { start: open, end: close + NOTES_CLOSE.length }
  }
  let end = raw.length
  for (const name of KNOWN_SECTIONS) {
    const found = raw.indexOf('\n## ' + name, start)
    if (found >= 0) end = Math.min(end, found)
  }
  return { start, end }
}

export function notesFromMarkdown(raw: string): string {
  const range = noteRange(raw)
  if (!range) return ''
  return raw.slice(range.start, range.end).replace(NOTES_OPEN, '').replace(NOTES_CLOSE, '').trim()
}

export function replaceMarkdownNotes(raw: string, text: string): string {
  const normalized = raw.replace(/\r\n/g, '\n')
  const range = noteRange(normalized)
  const body = `${NOTES_OPEN}\n${text.trim()}\n${NOTES_CLOSE}`
  if (range) return normalized.slice(0, range.start).replace(/\s*$/, '\n') + body + '\n' + normalized.slice(range.end)
  return normalized.replace(/\s*$/, '') + `\n\n${NOTES_HEAD}\n${body}\n`
}
