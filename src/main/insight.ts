// AI 洞察：文献卡片小结、多篇对比表格（可追溯引用）、深度搜索、对比表导出
import fs from 'node:fs'
import path from 'node:path'
import { dialog, BrowserWindow } from 'electron'
import { getDb, getSettings, scanLibrary } from './db'
import { chatStream } from './llm'
import { extractPagesCached } from './ingest'
import { findCategoryDir, nextCategoryDir } from './import'

export interface CompareCell {
  t: string
  p: number | null // 出处页码（可点击跳回原文）
}

export interface CompareData {
  paperIds: number[]
  dimensions: string[]
  fields?: string[] // 基础字段列（直接提取，无需 AI）
  cells: Record<string, Record<string, CompareCell[]>>
}

export interface CompareTable {
  id: number
  title: string
  data: CompareData
  created_at: string
}

const DEFAULT_DIMENSIONS = ['研究问题', '研究成果']
const DEFAULT_FIELDS = ['作者', '期刊名称']

const parseData = (raw: string): CompareData => {
  const d = JSON.parse(raw || '{}') as Partial<CompareData>
  return {
    paperIds: Array.isArray(d.paperIds) ? d.paperIds : [],
    dimensions: Array.isArray(d.dimensions) && d.dimensions.length ? d.dimensions : [...DEFAULT_DIMENSIONS],
    fields: Array.isArray(d.fields) ? d.fields : [...DEFAULT_FIELDS],
    cells: d.cells && typeof d.cells === 'object' ? d.cells : {}
  }
}

export function listCompare(): CompareTable[] {
  const rows = getDb().prepare('SELECT id, title, data, created_at FROM compare_tables ORDER BY id DESC').all() as Array<{
    id: number
    title: string
    data: string
    created_at: string
  }>
  return rows.map((r) => ({ id: r.id, title: r.title, data: parseData(r.data), created_at: r.created_at }))
}

export function createCompare(title?: string): CompareTable {
  const db = getDb()
  const n = (db.prepare('SELECT COUNT(*) AS n FROM compare_tables').get() as { n: number }).n
  const t = title?.trim() || `对比表 ${n + 1}`
  const r = db.prepare("INSERT INTO compare_tables(title, data) VALUES(?, '{}')").run(t)
  return { id: Number(r.lastInsertRowid), title: t, data: parseData('{}'), created_at: new Date().toISOString() }
}

export function deleteCompare(id: number): boolean {
  getDb().prepare('DELETE FROM compare_tables WHERE id=?').run(id)
  return true
}

export function saveCompare(id: number, data: CompareData): CompareData {
  getDb().prepare('UPDATE compare_tables SET data=? WHERE id=?').run(JSON.stringify(data), id)
  return data
}

// ---------- AI 生成：单篇 × 多维度 要点（带页码出处） ----------
export async function generateCells(
  paperId: number,
  dimensions: string[],
  send?: (ev: string, p: unknown) => void
): Promise<Record<string, CompareCell[]>> {
  const db = getDb()
  const paper = db.prepare('SELECT id, slug, title, path FROM papers WHERE id=?').get(paperId) as
    | { id: number; slug: string; title: string; path: string }
    | undefined
  if (!paper) throw new Error('论文不存在')
  send?.('compare:progress', { paperId, phase: 'reading' })
  let pages: string[] = []
  try {
    pages = await extractPagesCached(paper.path)
  } catch {
    pages = []
  }
  if (pages.length === 0) throw new Error('无法读取论文正文（题录占位页或 PDF 损坏）')
  const marked = pages
    .slice(0, 16)
    .map((t, i) => `【第${i + 1}页】\n${t}`)
    .join('\n\n')
    .slice(0, 90000)
  send?.('compare:progress', { paperId, phase: 'thinking' })
  const prompt =
    `你是严谨的文献分析助手。下面是论文《${paper.title}》的正文（按页标记）。\n` +
    `针对给定的每个分析维度，从论文中提取要点：\n` +
    `1）每个维度 2-5 条要点，具体、可对比（含方法名/数值/结论），不要空话；\n` +
    `2）每条要点标注出处页码（该页内容真实支持这条要点）；\n` +
    `3）论文未覆盖的维度输出空数组；\n` +
    `4）只输出 JSON，不要任何其他文字，格式：\n` +
    `{"维度名":[{"t":"要点","p":页码数字},...]}\n` +
    `维度列表：${JSON.stringify(dimensions)}`
  let out = ''
  for await (const d of chatStream([{ role: 'system', content: prompt }, { role: 'user', content: marked }])) out += d
  send?.('compare:progress', { paperId, phase: 'parsing' })
  let json: Record<string, unknown>
  try {
    json = JSON.parse(out.replace(/^```json\s*/i, '').replace(/```\s*$/g, ''))
  } catch {
    throw new Error('AI 未返回有效 JSON，请重试或换模型')
  }
  const cells: Record<string, CompareCell[]> = {}
  for (const dim of dimensions) {
    const arr = json[dim]
    cells[dim] = Array.isArray(arr)
      ? (arr as Array<{ t?: unknown; p?: unknown }>)
          .filter((x) => x && typeof x.t === 'string' && x.t.trim())
          .slice(0, 6)
          .map((x) => ({ t: String(x.t).trim(), p: Number(x.p) > 0 ? Number(x.p) : null }))
      : []
  }
  return cells
}

// ---------- AI 文献卡片小结（约 150 字，研究问题/方法/核心结果） ----------
export async function summarizePaper(paperId: number): Promise<string> {
  const db = getDb()
  const paper = db.prepare('SELECT id, title, path FROM papers WHERE id=?').get(paperId) as
    | { id: number; title: string; path: string }
    | undefined
  if (!paper) throw new Error('论文不存在')
  let pages: string[] = []
  try {
    pages = await extractPagesCached(paper.path)
  } catch {
    pages = []
  }
  const text = pages.slice(0, 3).join('\n\n').slice(0, 24000)
  if (!text.trim()) throw new Error('无法读取论文正文')
  const prompt =
    '你是文献阅读助手。用中文为这篇论文写一段卡片式小结，150 字以内：一句话研究问题，一句方法，' +
    '一到两句核心结果/结论。信息密度优先，不要套话，不要分点，只输出小结本身。'
  let out = ''
  for await (const d of chatStream([{ role: 'system', content: prompt }, { role: 'user', content: `【标题】${paper.title}\n【正文首页】\n${text}` }])) {
    out += d
  }
  const summary = out.trim().replace(/^["「]|["」]$/g, '')
  if (!summary) throw new Error('AI 未返回小结')
  db.prepare('UPDATE papers SET summary=? WHERE id=?').run(summary, paperId)
  return summary
}

// ---------- 深度搜索：正文（FTS）+ 划词笔记，按文献聚合 ----------
export interface DeepHit {
  id: number
  slug: string
  title: string
  snippet: string
  page: number | null
  from: 'content' | 'note'
}

export function deepSearch(q: string): DeepHit[] {
  const kw = q.trim()
  if (kw.length < 2) return []
  const db = getDb()
  const hits = new Map<number, DeepHit>()
  // 正文全文匹配：trigram 分词对 2 字短词（常见中文词长）无能为力，短词回退 LIKE 扫描
  const phrase = `"${kw.replace(/"/g, '""')}"`
  try {
    const rows =
      kw.length >= 3
        ? (db
            .prepare(
              `SELECT p.id AS id, p.slug AS slug, p.title AS title,
                snippet(chunks_fts, 0, '', '', '…', 16) AS snip,
                chunks_fts.page AS page
         FROM chunks_fts JOIN papers p ON p.id = chunks_fts.paper_id
         WHERE chunks_fts MATCH ?
         LIMIT 30`
            )
            .all(phrase) as Array<{ id: number; slug: string; title: string; snip: string; page: number }>)
        : (db
            .prepare(
              `SELECT p.id AS id, p.slug AS slug, p.title AS title, c.page AS page, c.text AS text
         FROM chunks c JOIN papers p ON p.id = c.paper_id
         WHERE c.text LIKE ?
         LIMIT 30`
            )
            .all(`%${kw}%`) as Array<{ id: number; slug: string; title: string; page: number; text: string }>)
    for (const r of rows) {
      if (hits.has(r.id)) continue
      const snip =
        'snip' in r
          ? (r as { snip: string }).snip
          : (() => {
              const i = (r as { text: string }).text.indexOf(kw)
              const t = (r as { text: string }).text
              return i < 0 ? t.slice(0, 80) : t.slice(Math.max(0, i - 30), i + 70)
            })()
      hits.set(r.id, { id: r.id, slug: r.slug, title: r.title, snippet: snip, page: r.page, from: 'content' })
    }
  } catch {
    /* FTS 语法不合法等：忽略正文层 */
  }
  // 划词笔记
  try {
    const rows = db
      .prepare(
        `SELECT p.id AS id, p.slug AS slug, p.title AS title, h.page AS page, h.text AS text
         FROM highlights h JOIN papers p ON p.id = h.paper_id
         WHERE h.text LIKE ?
         LIMIT 20`
      )
      .all(`%${kw}%`) as Array<{ id: number; slug: string; title: string; page: number; text: string }>
    for (const r of rows) {
      if (hits.has(r.id)) continue
      const i = r.text.indexOf(kw)
      const snip = i < 0 ? r.text.slice(0, 80) : r.text.slice(Math.max(0, i - 30), i + 60)
      hits.set(r.id, { id: r.id, slug: r.slug, title: r.title, snippet: snip, page: r.page, from: 'note' })
    }
  } catch {
    /* 忽略笔记层 */
  }
  return [...hits.values()].slice(0, 12)
}

// ---------- 对比表导出：Markdown / CSV（Excel 直接打开） ----------
function buildMarkdown(title: string, paperRows: Array<Record<string, string>>, cols: string[]): string {
  const esc = (s: string): string => s.replace(/\|/g, '\\|').replace(/\n/g, '<br>')
  const lines = [
    `# ${title}`,
    '',
    `| ${cols.join(' | ')} |`,
    `| ${cols.map(() => '---').join(' | ')} |`
  ]
  for (const row of paperRows) {
    lines.push(`| ${cols.map((c) => esc(row[c] ?? '')).join(' | ')} |`)
  }
  lines.push('', '> 由 CSPAPER AI 对比表生成', '')
  return lines.join('\n')
}

function buildCsv(paperRows: Array<Record<string, string>>, cols: string[]): string {
  const esc = (s: string): string => `"${(s ?? '').replace(/"/g, '""')}"`
  const lines = [cols.map(esc).join(',')]
  for (const row of paperRows) lines.push(cols.map((c) => esc(row[c] ?? '')).join(','))
  // BOM 让 Excel 正确识别 UTF-8
  return '\ufeff' + lines.join('\r\n')
}

export async function exportCompare(
  id: number,
  format: 'md' | 'csv',
  win: BrowserWindow | null
): Promise<void> {
  const db = getDb()
  const table = db.prepare('SELECT id, title, data FROM compare_tables WHERE id=?').get(id) as
    | { id: number; title: string; data: string }
    | undefined
  if (!table || !win) return
  const data = parseData(table.data)
  const fields = data.fields ?? ['作者', '期刊名称']
  const cols = ['标题', ...fields.filter((f) => f !== '标题'), ...data.dimensions]
  const fieldVal = (f: string, p: { title: string; authors: string; year: number | null; venue: string; category: string }): string => {
    switch (f) {
      case '标题': return p.title
      case '作者': return p.authors
      case '期刊名称': return p.venue
      case '发表年份': return p.year != null ? String(p.year) : ''
      case '分类': return p.category
      default: return ''
    }
  }
  const paperRows: Array<Record<string, string>> = []
  for (const pid of data.paperIds) {
    const p = db.prepare('SELECT id, slug, title, authors, year, venue, category FROM papers WHERE id=?').get(pid) as
      | { id: number; slug: string; title: string; authors: string; year: number | null; venue: string; category: string }
      | undefined
    if (!p) continue
    const cells = data.cells[String(pid)] ?? {}
    const row: Record<string, string> = {}
    for (const f of cols) row[f] = f === '标题' ? p.title : fieldVal(f, p)
    for (const dim of data.dimensions) {
      row[dim] = (cells[dim] ?? []).map((c) => (c.p ? `• ${c.t} [p.${c.p}]` : `• ${c.t}`)).join('\n')
    }
    paperRows.push(row)
  }
  const ext = format === 'md' ? 'md' : 'csv'
  const r = await dialog.showSaveDialog(win, {
    title: '导出对比表',
    defaultPath: `${table.title}.${ext}`,
    filters: [{ name: format === 'md' ? 'Markdown' : 'CSV', extensions: [ext] }]
  })
  if (r.canceled || !r.filePath) return
  const content =
    format === 'md'
      ? buildMarkdown(table.title, paperRows, cols)
      : buildCsv(paperRows, cols)
  fs.writeFileSync(r.filePath, content, 'utf8')
  dialog.showMessageBox(win, { message: '对比表已导出', detail: r.filePath })
}

// ---------- 文献详情（卡片详情栏）：元数据 + 摘要抽取 + 附件清单 ----------
export interface PaperDetail {
  id: number
  slug: string
  title: string
  authors: string
  year: number | null
  venue: string
  category: string
  status: string
  added_at: string
  summary: string | null
  abstract: string
  files: string[]
  notesCount: number
  myNotes: string
}

// ---------- AI 综合总结：选取的文献 → 生成知识综述 md，存入「AI 知识库」分类 ----------
export async function synthesizePapers(
  ids: number[],
  send: (ev: string, payload: unknown) => void
): Promise<{ slug: string; title: string }> {
  const db = getDb()
  const parts: string[] = []
  for (const pid of ids) {
    const row = db.prepare('SELECT id, title, authors, year, summary, path FROM papers WHERE id=?').get(pid) as
      | { id: number; title: string; authors: string; year: number | null; summary: string | null; path: string }
      | undefined
    if (!row) continue
    let text = ''
    try {
      const pages = await extractPagesCached(row.path)
      text = pages.slice(0, 3).join('\n').slice(0, 12000)
    } catch { text = row.summary ?? '' }
    parts.push(`【文献：${row.title}（${row.authors}，${row.year ?? ''}）】
${text}`)
    send('ai:progress', { done: parts.length, total: ids.length })
  }
  if (parts.length < 2) throw new Error('至少需要 2 篇有正文的文献')
  const prompt =
    '你是学术研究助手。以下是多篇相关文献的正文节选。请撰写一篇 800-1200 字的中文综述，包括：' +
    '1）共同的研究主题；2）各文献的方法与核心结论对比（分点，标注文献编号如 [1]）；' +
    '3）研究空白与未来方向。结构清晰，使用 markdown 小标题。只输出综述正文。'
  let out = ''
  for await (const d of chatStream([{ role: 'system', content: prompt }, { role: 'user', content: parts.join('\n\n') }])) out += d
  if (!out.trim()) throw new Error('AI 未返回内容')

  // 写入 md → AI 知识库分类
  const s2 = getSettings()
  const libPapers = path.join(s2.libraryPath, 'papers')
  fs.mkdirSync(libPapers, { recursive: true })
  const catName = 'AI 知识库'
  let dir = findCategoryDir(libPapers, catName)
  if (!dir) dir = nextCategoryDir(libPapers, catName)
  fs.mkdirSync(dir, { recursive: true })
  const slug = 'ai-synthesis-' + Date.now()
  const dest = path.join(dir, slug)
  fs.mkdirSync(dest, { recursive: true })
  const title = `AI 综述：${ids.length} 篇文献综合分析`
  const safe = out.replace(/"/g, "'")
  const md = `---
title: "${title}"
authors: "CSPAPER AI"
year: ${new Date().getFullYear()}
venue: "AI 知识库"
tags: [ai/synthesis]
status: read
---

# ${title}

**综合文献：**
${parts.map((_, i) => `- [${i + 1}] 文献 ${i + 1}`).join('\n')}

${out}
`
  fs.writeFileSync(path.join(dest, `${slug}.md`), md, 'utf8')
  // 无正文 PDF —— 不生成占位文件；卡片墙/搜索仍可见（md 驱动）
  scanLibrary(s2.libraryPath)
  return { slug, title }
}

// ---------- 我的笔记：存于文献 md 文件的「我的笔记」小节 ----------
export function getMyNotesText(paperId: number): string {
  const db = getDb()
  const row = db.prepare('SELECT path FROM papers WHERE id=?').get(paperId) as { path: string } | undefined
  if (!row) return ''
  try {
    const dir = path.dirname(row.path)
    const mdFile = fs.readdirSync(dir).find((f) => f.toLowerCase().endsWith('.md'))
    if (!mdFile) return ''
    const raw = fs.readFileSync(path.join(dir, mdFile), 'utf8')
    const si = raw.indexOf('## 我的笔记')
    if (si < 0) return ''
    let ei = raw.indexOf('\n## ', si + 10)
    if (ei < 0) ei = raw.length
    return raw.slice(si + '## 我的笔记'.length, ei).trim()
  } catch {
    return ''
  }
}

export function saveMyNotesText(paperId: number, text: string): boolean {
  const db = getDb()
  const row = db.prepare('SELECT path FROM papers WHERE id=?').get(paperId) as { path: string } | undefined
  if (!row) return false
  const dir = path.dirname(row.path)
  try {
    const mdFile = fs.readdirSync(dir).find((f) => f.toLowerCase().endsWith('.md'))
    if (!mdFile) return false
    const mdPath = path.join(dir, mdFile)
    let raw = fs.readFileSync(mdPath, 'utf8')
    const si = raw.indexOf('## 我的笔记')
    if (si >= 0) {
      let ei = raw.indexOf('\n## ', si + 10)
      if (ei < 0) ei = raw.length
      raw = raw.slice(0, si) + '## 我的笔记\n\n' + text.trim() + '\n' + raw.slice(ei)
    } else {
      raw = raw.replace(/\s*$/, '') + '\n\n## 我的笔记\n\n' + text.trim() + '\n'
    }
    fs.writeFileSync(mdPath, raw)
    return true
  } catch {
    return false
  }
}

export async function paperDetail(id: number): Promise<PaperDetail | null> {
  const db = getDb()
  const row = db
    .prepare('SELECT id, slug, title, authors, year, venue, category, status, added_at, summary, path FROM papers WHERE id=?')
    .get(id) as
    | { id: number; slug: string; title: string; authors: string; year: number | null; venue: string; category: string; status: string; added_at: string; summary: string | null; path: string }
    | undefined
  if (!row) return null
  const dir = path.dirname(row.path)
  let files: string[] = []
  try {
    files = fs.readdirSync(dir).filter((f) => !f.startsWith('.'))
  } catch {
    files = []
  }
  let abstract = ''
  try {
    const pages = await extractPagesCached(row.path)
    const first = (pages[0] ?? '').replace(/\s+/g, ' ').trim()
    const m = first.match(/(摘\s*要|Abstract)[:：]?\s*(.{80,700})/i)
    abstract = m ? m[2].trim() : first.slice(0, 400)
  } catch {
    abstract = ''
  }
  const notesCount = (db.prepare('SELECT COUNT(*) AS n FROM highlights WHERE paper_id=?').get(id) as { n: number }).n
  return { ...row, abstract, files, notesCount, myNotes: getMyNotesText(id) }
}

// ---------- 导入后自动小结队列（配置了 API Key 时） ----------
const sumQueue: number[] = []
let sumRunning = false

export function enqueueSummaries(ids: number[], send: (ev: string, p: unknown) => void): void {
  sumQueue.push(...ids.filter((id) => !sumQueue.includes(id)))
  void pump(send)
}

async function pump(send: (ev: string, p: unknown) => void): Promise<void> {
  if (sumRunning) return
  sumRunning = true
  while (sumQueue.length > 0) {
    const id = sumQueue.shift()!
    try {
      await summarizePaper(id)
      send('summary:done', { id })
      send('papers:changed', { ids: [id] })
    } catch {
      sumQueue.length = 0 // 无 Key / 连续失败：放弃整队，避免反复报错
      break
    }
  }
  sumRunning = false
}

// ---------- 知识网络：基于文本相似度的稀疏关联图 ----------
// 相似度 = 标题(×3) + AI 小结(×2) + 正文块(×1) 的词频向量余弦值；
// 中文按二字组切词，英文按单词切词；每个节点只保留最相似的 k 条边，避免"全连"。
export interface GraphNode {
  id: number
  title: string
  category: string
  year: number | null
  degree: number
  cluster?: number
}
export interface GraphEdge {
  a: number
  b: number
  w: number
}

const tokenize = (text: string): string[] => {
  const t = (text || '').toLowerCase()
  const terms: string[] = []
  for (const w of t.match(/[a-z0-9][a-z0-9-]{1,}/g) ?? []) terms.push(w)
  const cjk = t.replace(/[^\u4e00-\u9fff]/g, '')
  for (let i = 0; i < cjk.length - 1; i++) terms.push(cjk.slice(i, i + 2))
  return terms
}

const tfVector = (terms: string[]): Map<string, number> => {
  const v = new Map<string, number>()
  for (const t of terms) v.set(t, (v.get(t) ?? 0) + 1)
  return v
}

const cosine = (a: Map<string, number>, b: Map<string, number>): number => {
  let dot = 0
  let na = 0
  let nb = 0
  for (const [, x] of a) na += x * x
  for (const [, x] of b) nb += x * x
  if (!na || !nb) return 0
  for (const [t, x] of a) {
    const y = b.get(t)
    if (y) dot += x * y
  }
  return dot / Math.sqrt(na * nb)
}

export function knowledgeGraph(category?: string): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const db = getDb()
  // 分类筛选：空 = 全库；指定分类只在该分类内构图（跨分类硬连不相关论文反而干扰）
  const rows = (
    category
      ? db.prepare('SELECT id, title, authors, summary, category, year, path FROM papers WHERE category=?').all(category)
      : db.prepare('SELECT id, title, authors, summary, category, year, path FROM papers').all()
  ) as Array<{ id: number; title: string; authors: string; summary: string | null; category: string; year: number | null; path: string }>
  const chunkStmt = db.prepare('SELECT text FROM chunks WHERE paper_id = ? LIMIT 40')

  // 词频向量
  const vectors = new Map<number, Map<string, number>>()
  const metas = rows.map((r) => {
    let chunkText = ''
    try {
      chunkText = (chunkStmt.all(r.id) as Array<{ text: string }>).map((c) => c.text).join(' ').slice(0, 4000)
    } catch {
      chunkText = ''
    }
    const v = tfVector([
      ...tokenize(r.title),
      ...tokenize(r.title),
      ...tokenize(r.title),
      ...tokenize(r.summary ?? ''),
      ...tokenize(r.summary ?? ''),
      ...tokenize(chunkText)
    ])
    vectors.set(r.id, v)
    return { id: r.id, title: r.title, category: r.category, year: r.year }
  })

  // 两两相似度
  const sims: Array<{ a: number; b: number; w: number }> = []
  for (let i = 0; i < metas.length; i++) {
    for (let j = i + 1; j < metas.length; j++) {
      const w = cosine(vectors.get(metas[i].id)!, vectors.get(metas[j].id)!)
      if (w >= 0.08) sims.push({ a: metas[i].id, b: metas[j].id, w })
    }
  }
  sims.sort((x, y) => y.w - x.w)

  // kNN 稀疏化：每节点最多保留 3 条最强边
  const K = 3
  const degree = new Map<number, number>()
  const kept: GraphEdge[] = []
  for (const s of sims) {
    if ((degree.get(s.a) ?? 0) >= K || (degree.get(s.b) ?? 0) >= K) continue
    kept.push({ a: s.a, b: s.b, w: Math.round(s.w * 100) / 100 })
    degree.set(s.a, (degree.get(s.a) ?? 0) + 1)
    degree.set(s.b, (degree.get(s.b) ?? 0) + 1)
  }

  const nodes: GraphNode[] = metas.map((m) => ({ ...m, degree: degree.get(m.id) ?? 0 }))

  // 连通分量聚类：有边相连的文献归为同一簇，用不同颜色区分
  const parent = new Map<number, number>()
  for (const m of metas) parent.set(m.id, m.id)
  const find = (x: number): number => {
    let cur = x
    while (parent.get(cur) !== cur) {
      const next = parent.get(cur)
      if (next === undefined) break
      parent.set(cur, next)
      cur = next
    }
    return cur
  }
  for (const e of kept) {
    const ra = find(e.a)
    const rb = find(e.b)
    if (ra !== rb) parent.set(ra, rb)
  }
  const clusterMap = new Map<number, number>()
  let nextCluster = 0
  for (const n of nodes) {
    const root = find(n.id)
    if (!clusterMap.has(root)) clusterMap.set(root, nextCluster++)
    n.cluster = clusterMap.get(root)!
  }

  return { nodes, edges: kept }
}
