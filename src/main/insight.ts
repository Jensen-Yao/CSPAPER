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
  const paper = db.prepare('SELECT id, slug, title, path FROM papers WHERE deleted_at IS NULL AND id=?').get(paperId) as
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
// ---------- 深度精读：结构化抽取（v0.13） ----------
export interface PaperExtract {
  paper_id: number
  problem: string
  method: string
  dataset: string
  metrics: string
  results: string
  limitations: string
  novelty: string
  future: string
  extracted_at: string
}

export function getExtract(paperId: number): PaperExtract | null {
  try {
    const db = getDb()
    const r = db.prepare('SELECT * FROM paper_extract WHERE paper_id=?').get(paperId) as PaperExtract | undefined
    return r ?? null
  } catch {
    return null
  }
}

/**
 * 深度精读：全文（预算 ~90k 字符，远超旧版 3 页 24k）一次调用，
 * 同时产出卡片小结（兼容 papers.summary）与 8 个结构化字段（入库 paper_extract）。
 */
export async function extractPaper(paperId: number): Promise<{ summary: string; extract: PaperExtract | null }> {
  const db = getDb()
  const paper = db.prepare('SELECT id, title, path FROM papers WHERE deleted_at IS NULL AND id=?').get(paperId) as
    | { id: number; title: string; path: string }
    | undefined
  if (!paper) throw new Error('论文不存在')
  let pages: string[] = []
  try {
    pages = await extractPagesCached(paper.path)
  } catch {
    pages = []
  }
  const full = pages.join('\n\n')
  const text = full.slice(0, 90000)
  if (!text.trim()) throw new Error('无法读取论文正文')
  const prompt =
    '你是资深科研文献分析师。深度阅读论文全文，输出严格 JSON（不要围栏、不要多余文字）：\n' +
    '{"summary":"150字内卡片小结：一句话研究问题+一句方法+一到两句核心结论",' +
    '"problem":"研究问题（1-2句）","method":"方法/技术路线（2-3句，含关键模型或算法名）",' +
    '"dataset":"数据集/实验对象/案例（含规模）","metrics":"评价指标（如准确率/能耗/成本，含量级）",' +
    '"results":"核心结果（2-3条，带关键数字）","limitations":"局限（1-2条，来自原文或合理推断）",' +
    '"novelty":"创新点（1-2句，与已有工作的差异）","future":"可跟进的研究方向（1-2条）"}\n' +
    '全部中文；论文中没有的字段写"未提及"。'
  let out = ''
  for await (const d of chatStream([{ role: 'system', content: prompt }, { role: 'user', content: `【标题】${paper.title}\n【全文】\n${text}` }])) {
    out += d
  }
  const cleaned = out.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  let summary = ''
  let ext: PaperExtract | null = null
  try {
    const j = JSON.parse(cleaned) as Partial<PaperExtract> & { summary?: string }
    summary = String(j.summary ?? '').trim()
    const f = (x: unknown): string => String(x ?? '').trim().slice(0, 1200)
    ext = {
      paper_id: paperId,
      problem: f(j.problem),
      method: f(j.method),
      dataset: f(j.dataset),
      metrics: f(j.metrics),
      results: f(j.results),
      limitations: f(j.limitations),
      novelty: f(j.novelty),
      future: f(j.future),
      extracted_at: new Date().toISOString().slice(0, 19).replace('T', ' ')
    }
    db.exec(`CREATE TABLE IF NOT EXISTS paper_extract(
      paper_id INTEGER PRIMARY KEY,
      problem TEXT, method TEXT, dataset TEXT, metrics TEXT, results TEXT,
      limitations TEXT, novelty TEXT, future TEXT, extracted_at TEXT)`)
    db.prepare(
      `INSERT INTO paper_extract(paper_id, problem, method, dataset, metrics, results, limitations, novelty, future, extracted_at)
       VALUES(@paper_id, @problem, @method, @dataset, @metrics, @results, @limitations, @novelty, @future, @extracted_at)
       ON CONFLICT(paper_id) DO UPDATE SET problem=excluded.problem, method=excluded.method, dataset=excluded.dataset,
         metrics=excluded.metrics, results=excluded.results, limitations=excluded.limitations,
         novelty=excluded.novelty, future=excluded.future, extracted_at=excluded.extracted_at`
    ).run(ext)
  } catch {
    // JSON 解析失败：退化为把整段输出当 summary（与旧版行为一致）
    summary = cleaned.replace(/^["「]|["」]$/g, '').slice(0, 600)
  }
  if (!summary) throw new Error('AI 未返回有效内容')
  db.prepare('UPDATE papers SET summary=? WHERE id=?').run(summary.slice(0, 600), paperId)
  return { summary, extract: ext }
}

export async function summarizePaper(paperId: number): Promise<string> {
  const { summary } = await extractPaper(paperId)
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
    const p = db.prepare('SELECT id, slug, title, authors, year, venue, category FROM papers WHERE deleted_at IS NULL AND id=?').get(pid) as
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

// ---------- AI 综合总结：map-reduce（v0.13 深度版） ----------
// map：每篇复用 paper_extract 结构化精读（无缓存则现场全文精读）——覆盖全文而非旧版前 3 页
// reduce：各篇结构化要点 + 小结喂 LLM 综合成文
export async function synthesizePapers(
  ids: number[],
  send: (ev: string, payload: unknown) => void
): Promise<{ slug: string; title: string }> {
  const db = getDb()
  const parts: string[] = []
  let done = 0
  for (const pid of ids) {
    const row = db.prepare('SELECT id, title, authors, year, summary, path FROM papers WHERE deleted_at IS NULL AND id=?').get(pid) as
      | { id: number; title: string; authors: string; year: number | null; summary: string | null; path: string }
      | undefined
    if (!row) continue
    // map：优先结构化精读缓存；没有就现场深度精读（失败退回前 3 页正文）
    let ext = getExtract(pid)
    if (!ext) {
      try {
        ext = (await extractPaper(pid)).extract
      } catch {
        ext = null
      }
    }
    if (ext) {
      parts.push(
        `【文献：${row.title}（${row.authors}，${row.year ?? ''}）】\n` +
          `研究问题：${ext.problem}\n方法路线：${ext.method}\n数据与对象：${ext.dataset}\n评价指标：${ext.metrics}\n核心结果：${ext.results}\n创新点：${ext.novelty}\n局限：${ext.limitations}`
      )
    } else {
      let text = ''
      try {
        const pages = await extractPagesCached(row.path)
        text = pages.slice(0, 3).join('\n').slice(0, 12000)
      } catch {
        text = row.summary ?? ''
      }
      parts.push(`【文献：${row.title}（${row.authors}，${row.year ?? ''}）】\n${text}`)
    }
    done++
    send('ai:progress', { done, total: ids.length })
  }
  if (parts.length < 2) throw new Error('至少需要 2 篇有正文的文献')
  const prompt =
    '你是学术研究助手。以下是多篇相关文献的结构化精读要点（研究问题/方法/数据/指标/结果/创新/局限）。' +
    '请撰写一篇 1000-1500 字的中文综述，包括：' +
    '1）共同的研究主题与脉络；2）各文献的方法与核心结论对比（分点，标注文献编号如 [1]，引用关键数字）；' +
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
  // 综述无原文 PDF：生成题录占位页，否则 scanLibrary（按 PDF 发现条目）看不到这条知识
  try {
    const { createPlaceholderPdf } = await import('./records')
    fs.writeFileSync(
      path.join(dest, 'paper.pdf'),
      await createPlaceholderPdf({ title, authors: 'CSPAPER AI 综述', year: new Date().getFullYear(), venue: 'AI 知识库', abstract: out.slice(0, 1200) })
    )
  } catch (err) {
    console.error('[synthesis] 占位页生成失败:', String(err))
  }
  scanLibrary(s2.libraryPath)
  return { slug, title }
}

// ---------- 我的笔记：存于文献 md 文件的「我的笔记」小节 ----------
// ---------- 我的笔记：存于文献 md 文件的「我的笔记」小节 ----------
// v0.19：笔记区用 HTML 注释哨兵界定。此前以「下一个 ## 」当结束边界，用户笔记里
// 出现任何二级标题（插模板/自己写「## 方法」）都会被截断，且保存时旧尾部重复堆回。
const NOTES_HEAD = '## 我的笔记'
const NOTES_OPEN = '<!-- cspaper:notes:start -->'
const NOTES_CLOSE = '<!-- cspaper:notes:end -->'
// md 内已知的固定章节（导入模板生成）：旧格式无哨兵时作为笔记区的结束边界
const NOTES_KNOWN_SECTIONS = ['## 阅读状态', '## 速览', '## Zotero 标注', '## 参考文献']

/** 读笔记：优先哨兵；旧格式回退到已知章节标题（绝不用任意 ##） */
export function getMyNotesText(paperId: number): string {
  const db = getDb()
  const row = db.prepare('SELECT path FROM papers WHERE deleted_at IS NULL AND id=?').get(paperId) as { path: string } | undefined
  if (!row) return ''
  try {
    const dir = path.dirname(row.path)
    const mdFile = fs.readdirSync(dir).find((f) => f.toLowerCase().endsWith('.md'))
    if (!mdFile) return ''
    const raw = fs.readFileSync(path.join(dir, mdFile), 'utf8')
    const hi = raw.indexOf(NOTES_HEAD)
    if (hi < 0) return ''
    const after = raw.slice(hi + NOTES_HEAD.length)
    const oi = after.indexOf(NOTES_OPEN)
    if (oi >= 0) {
      const ci = after.indexOf(NOTES_CLOSE, oi)
      return (ci >= 0 ? after.slice(oi + NOTES_OPEN.length, ci) : after.slice(oi + NOTES_OPEN.length)).trim()
    }
    // 旧格式：截到第一个已知章节；没有已知章节则整个尾部都是笔记
    let ei = after.length
    for (const sec of NOTES_KNOWN_SECTIONS) {
      const k = after.indexOf('\n' + sec)
      if (k >= 0 && k < ei) ei = k
    }
    return after.slice(0, ei).trim()
  } catch {
    return ''
  }
}

/** 写笔记：整段用哨兵重写，笔记内任意 ## 不再影响边界 */
export function saveMyNotesText(paperId: number, text: string): boolean {
  const db = getDb()
  const row = db.prepare('SELECT path FROM papers WHERE deleted_at IS NULL AND id=?').get(paperId) as { path: string } | undefined
  if (!row) return false
  const dir = path.dirname(row.path)
  try {
    const mdFile = fs.readdirSync(dir).find((f) => f.toLowerCase().endsWith('.md'))
    if (!mdFile) return false
    const mdPath = path.join(dir, mdFile)
    let raw = fs.readFileSync(mdPath, 'utf8')
    const body = '\n' + NOTES_OPEN + '\n' + text.trim() + '\n' + NOTES_CLOSE + '\n'
    const hi = raw.indexOf(NOTES_HEAD)
    if (hi >= 0) {
      const after = raw.slice(hi + NOTES_HEAD.length)
      const oi = after.indexOf(NOTES_OPEN)
      if (oi >= 0) {
        // 新格式：整段哨兵区替换
        const ci = after.indexOf(NOTES_CLOSE, oi)
        const endRel = ci >= 0 ? ci + NOTES_CLOSE.length : after.length
        raw = raw.slice(0, hi) + NOTES_HEAD + '\n' + body + after.slice(endRel)
      } else {
        // 旧格式一次性迁移为哨兵区
        raw = raw.slice(0, hi) + NOTES_HEAD + '\n' + body
      }
    } else {
      raw = raw.replace(/\s*$/, '') + '\n\n' + NOTES_HEAD + '\n' + body
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
    .prepare('SELECT id, slug, title, authors, year, venue, category, status, added_at, summary, path, doi, volume, issue, pages, publisher, language FROM papers WHERE deleted_at IS NULL AND id=?')
    .get(id) as
    | { id: number; slug: string; title: string; authors: string; year: number | null; venue: string; category: string; status: string; added_at: string; summary: string | null; path: string; doi: string | null; volume: string | null; issue: string | null; pages: string | null; publisher: string | null; language: string | null }
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
  let fails = 0
  while (sumQueue.length > 0) {
    const id = sumQueue.shift()!
    try {
      await summarizePaper(id)
      fails = 0
      send('summary:done', { id })
      send('papers:changed', { ids: [id] })
    } catch (err) {
      // 单篇失败（PDF 损坏等）不连坐：上报后继续下一篇；连续 3 次失败视为配置问题，熔断整队
      fails++
      send('summary:failed', { id, error: String(err).slice(0, 120) })
      if (fails >= 3) {
        sumQueue.length = 0
        break
      }
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

// 中文停用词（Intl.Segmenter 分词后仍会出现的通用词）
const ZH_STOP = new Set([
  '研究', '方法', '分析', '基于', '系统', '综述', '应用', '技术', '一种', '及其', '面向', '问题', '影响', '进展',
  '模型', '框架', '结果', '本文', '提出', '通过', '进行', '以及', '可以', '不同', '具有', '相关', '领域', '工作',
  '论文', '提供', '重要', '有效', '主要', '作为', '关于', '表明', '采用', '结合', '实现', '考虑', '提高', '减少',
  '利用', '方面', '情况', '过程', '条件', '性能', '结构', '功能', '特性', '方案', '设计', '优化', '改进'
])
const EN_STOP_INSIGHT = new Set([
  'the', 'and', 'for', 'with', 'based', 'from', 'into', 'onto', 'via', 'using', 'under', 'over', 'between', 'among',
  'research', 'study', 'method', 'methods', 'approach', 'approaches', 'analysis', 'model', 'models', 'modeling',
  'framework', 'frameworks', 'system', 'systems', 'journal', 'international', 'proceedings', 'conference',
  'university', 'press', 'review', 'applied', 'result', 'results', 'paper', 'papers', 'propose', 'proposed',
  'novel', 'toward', 'towards', 'ieee', 'access', 'springer', 'elsevier', 'science', 'nature'
])
// 中文用 Intl.Segmenter 真分词（不再产生"的电/务规"式二字组碎片），英文按词并滤停用词
const zhSeg = new Intl.Segmenter('zh', { granularity: 'word' })
const tokenize = (text: string): string[] => {
  const t = (text || '').toLowerCase()
  const terms: string[] = []
  for (const w of t.match(/[a-z][a-z0-9-]{2,}/g) ?? []) {
    if (!EN_STOP_INSIGHT.has(w)) terms.push(w)
  }
  for (const s of zhSeg.segment(t)) {
    const v = s.segment
    if (/^[\u4e00-\u9fff]{2,}$/.test(v) && !ZH_STOP.has(v)) terms.push(v)
  }
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
      ? db.prepare('SELECT id, title, authors, summary, category, year, path FROM papers WHERE deleted_at IS NULL AND category=?').all(category)
      : db.prepare('SELECT id, title, authors, summary, category, year, path FROM papers WHERE deleted_at IS NULL AND deleted_at IS NULL').all()
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

  // 语义向量（papers.pvec，e5 整篇向量）：有则语义相似为主(0.7)、词法为辅(0.3)，
  // 无向量库自动退化为纯词法（与旧版一致）
  const pvecs = new Map<number, Float32Array>()
  try {
    const pv = db.prepare('SELECT id, pvec FROM papers WHERE deleted_at IS NULL AND pvec IS NOT NULL').all() as Array<{ id: number; pvec: Buffer }>
    for (const r of pv) {
      if (r.pvec && r.pvec.byteLength >= 8) pvecs.set(r.id, new Float32Array(r.pvec.buffer, r.pvec.byteOffset, r.pvec.byteLength / 4))
    }
  } catch {
    /* pvec 列不存在（旧库）时退化词法 */
  }

  // 两两相似度
  const sims: Array<{ a: number; b: number; w: number }> = []
  for (let i = 0; i < metas.length; i++) {
    for (let j = i + 1; j < metas.length; j++) {
      const va = pvecs.get(metas[i].id)
      const vb = pvecs.get(metas[j].id)
      const lex = cosine(vectors.get(metas[i].id)!, vectors.get(metas[j].id)!)
      let w: number
      if (va && vb) {
        // 归一化向量点积即余弦
        let dot = 0
        const n = Math.min(va.length, vb.length)
        for (let k = 0; k < n; k++) dot += va[k] * vb[k]
        w = Math.max(0, dot) * 0.7 + lex * 0.3
      } else {
        w = lex
      }
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

// ---------- 知识体系 v0.7：关键词共现 / 作者合作 / 主题星系（对标 CiteSpace·VOSviewer 范式） ----------
// 全部离线计算，来自 DB 标题/小结/正文词频与作者字段，不调 AI。

const KW_STOP = new Set([
  'the', 'and', 'for', 'with', 'based', 'from', 'into', 'onto', 'via', 'using', 'under', 'over', 'between', 'among',
  'research', 'study', 'method', 'methods', 'approach', 'analysis', 'model', 'modeling', 'framework', 'system', 'systems',
  'journal', 'international', 'proceedings', 'conference', 'university', 'press', 'review', 'applied', 'ieee', 'access',
  'of', 'in', 'on', 'to', 'a', 'an', 'by', 'at', 'as', 'is', 'are', 'its', 'their', 'this', 'that', 'these', 'those'
])
// 中文二字组里的高频虚词组合（词频统计时过滤）
const CJK_STOP = new Set(['研究', '方法', '分析', '基于', '系统', '综述', '进展', '应用', '技术', '影响', '问题', '关于', '一种', '及其', '面向'])

export interface KwNode {
  id: string // 关键词
  n: number // 总频次
  papers: number[] // 命中论文 id
}
export interface KwEdge {
  a: string
  b: string
  w: number // 共现论文数
}

// 每篇文献的关键词集合：标题（英文词 + 中文二字组，权重×2）+ AI 小结前 400 字（×1）
function paperKeywords(r: { id: number; title: string; summary: string | null }): string[] {
  const raw = tokenize(`${r.title}\n${r.title}\n${(r.summary ?? '').slice(0, 400)}`)
  const set = new Set<string>()
  for (const t of raw) {
    if (/^[a-z0-9-]{2,}$/.test(t)) {
      if (t.length >= 3 && !KW_STOP.has(t) && !/^\d+$/.test(t)) set.add(t)
    } else if (!CJK_STOP.has(t)) {
      set.add(t)
    }
  }
  return [...set]
}

export function keywordGraph(category?: string, topK = 48): { nodes: KwNode[]; edges: KwEdge[] } {
  const db = getDb()
  const rows = (
    category
      ? db.prepare('SELECT id, title, summary FROM papers WHERE deleted_at IS NULL AND category=?').all(category)
      : db.prepare('SELECT id, title, summary FROM papers WHERE deleted_at IS NULL AND deleted_at IS NULL').all()
  ) as Array<{ id: number; title: string; summary: string | null }>
  const freq = new Map<string, number>()
  const paperIds = new Map<string, number[]>()
  const pair = new Map<string, number>()
  for (const r of rows) {
    const kws = paperKeywords(r)
    for (const k of kws) {
      freq.set(k, (freq.get(k) ?? 0) + 1)
      const arr = paperIds.get(k) ?? []
      arr.push(r.id)
      paperIds.set(k, arr)
    }
    for (let i = 0; i < kws.length; i++)
      for (let j = i + 1; j < kws.length; j++) {
        const key = kws[i] < kws[j] ? `${kws[i]}\n${kws[j]}` : `${kws[j]}\n${kws[i]}`
        pair.set(key, (pair.get(key) ?? 0) + 1)
      }
  }
  const nodes: KwNode[] = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK)
    .map(([id, n]) => ({ id, n, papers: (paperIds.get(id) ?? []).slice(0, 60) }))
  const keep = new Set(nodes.map((n) => n.id))
  const edges: KwEdge[] = [...pair.entries()]
    .map(([k, w]) => {
      const [a, b] = k.split('\n')
      return { a, b, w }
    })
    .filter((e) => keep.has(e.a) && keep.has(e.b))
    .sort((x, y) => y.w - x.w)
    .slice(0, topK * 3)
  return { nodes, edges }
}

export interface AuNode {
  id: string // 作者名
  n: number // 论文数
}
export interface AuEdge {
  a: string
  b: string
  w: number // 合著论文数
}

export function authorGraph(category?: string, topK = 60): { nodes: AuNode[]; edges: AuEdge[] } {
  const db = getDb()
  const rows = (
    category
      ? db.prepare('SELECT id, authors FROM papers WHERE deleted_at IS NULL AND category=?').all(category)
      : db.prepare('SELECT id, authors FROM papers WHERE deleted_at IS NULL AND deleted_at IS NULL').all()
  ) as Array<{ id: number; authors: string }>
  const freq = new Map<string, number>()
  const pair = new Map<string, number>()
  for (const r of rows) {
    const names = r.authors
      .split(/[,;，；]/)
      .map((s) => s.trim().replace(/\s+/g, ' '))
      .filter((s) => s && s.length <= 40)
    for (const n of names) freq.set(n, (freq.get(n) ?? 0) + 1)
    for (let i = 0; i < names.length; i++)
      for (let j = i + 1; j < names.length; j++) {
        const key = names[i] < names[j] ? `${names[i]}\n${names[j]}` : `${names[j]}\n${names[i]}`
        pair.set(key, (pair.get(key) ?? 0) + 1)
      }
  }
  const nodes: AuNode[] = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK)
    .map(([id, n]) => ({ id, n }))
  const keep = new Set(nodes.map((n) => n.id))
  const edges: AuEdge[] = [...pair.entries()]
    .map(([k, w]) => {
      const [a, b] = k.split('\n')
      return { a, b, w }
    })
    .filter((e) => keep.has(e.a) && keep.has(e.b))
    .sort((x, y) => y.w - x.w)
    .slice(0, topK * 2)
  return { nodes, edges }
}

export interface TopicCluster {
  label: string // 簇内最高频关键词
  keywords: string[] // 前 6 个关键词
  paperIds: number[]
}

// 主题星系：相似度图做连通分量聚类，每簇给出高频关键词与论文清单（点击可展开）
export function topicClusters(category?: string): TopicCluster[] {
  const db = getDb()
  const rows = (
    category
      ? db.prepare('SELECT id, title, summary FROM papers WHERE deleted_at IS NULL AND category=?').all(category)
      : db.prepare('SELECT id, title, summary FROM papers WHERE deleted_at IS NULL AND deleted_at IS NULL').all()
  ) as Array<{ id: number; title: string; summary: string | null }>
  if (rows.length === 0) return []
  const kwOf = new Map<number, string[]>()
  for (const r of rows) kwOf.set(r.id, paperKeywords(r))

  // ---- 优先语义聚类：papers.pvec K-means（k 自适应 ⌊√(n/2)⌋，限 2..12） ----
  const pvecs = new Map<number, Float32Array>()
  try {
    const pv = db.prepare('SELECT id, pvec FROM papers WHERE deleted_at IS NULL AND pvec IS NOT NULL').all() as Array<{ id: number; pvec: Buffer }>
    for (const r of pv) {
      if (r.pvec && r.pvec.byteLength >= 8) pvecs.set(r.id, new Float32Array(r.pvec.buffer, r.pvec.byteOffset, r.pvec.byteLength / 4))
    }
  } catch {
    /* pvec 列不存在（旧库）时退化词法 */
  }
  const usable = rows.filter((r) => pvecs.has(r.id))
  if (usable.length >= 6 && pvecs.size >= usable.length) {
    return kmeansClusters(usable, pvecs, kwOf)
  }

  // ---- 退化：关键词共享并查集（旧算法，无向量库时使用） ----
  return keywordClusters(rows, kwOf)
}

// 语义 K-means：k=⌊√(n/2)⌋ 限 2..12，20 轮迭代；簇标签 = 簇内 TF-IDF 最高词，代表文献 = 离质心最近
function kmeansClusters(
  rows: Array<{ id: number; title: string; summary: string | null }>,
  pvecs: Map<number, Float32Array>,
  kwOf: Map<number, string[]>
): TopicCluster[] {
  const n = rows.length
  const dim = pvecs.get(rows[0].id)!.length
  const k = Math.max(2, Math.min(12, Math.floor(Math.sqrt(n / 2))))
  // 确定性初始化：按 id 排序均匀取 k 个种子（同库每次结果一致，可复现）
  const seeds = [...rows].sort((a, b) => a.id - b.id).filter((_, i) => i % Math.max(1, Math.floor(n / k)) === 0).slice(0, k)
  const centroids: Float32Array[] = seeds.map((s) => Float32Array.from(pvecs.get(s.id)!))
  const assign = new Array<number>(n).fill(0)
  for (let iter = 0; iter < 20; iter++) {
    let moved = false
    for (let i = 0; i < n; i++) {
      const v = pvecs.get(rows[i].id)!
      let best = 0
      let bestD = -Infinity
      for (let c = 0; c < centroids.length; c++) {
        let dot = 0
        for (let d = 0; d < dim; d++) dot += v[d] * centroids[c][d]
        if (dot > bestD) {
          bestD = dot
          best = c
        }
      }
      if (assign[i] !== best) {
        assign[i] = best
        moved = true
      }
    }
    // 更新质心（归一化均值）
    for (let c = 0; c < centroids.length; c++) {
      const cen = new Float32Array(dim)
      let cnt = 0
      for (let i = 0; i < n; i++) {
        if (assign[i] !== c) continue
        cnt++
        const v = pvecs.get(rows[i].id)!
        for (let d = 0; d < dim; d++) cen[d] += v[d]
      }
      if (cnt > 0) {
        let norm = 0
        for (let d = 0; d < dim; d++) norm += cen[d] * cen[d]
        norm = Math.sqrt(norm) || 1
        for (let d = 0; d < dim; d++) centroids[c][d] = cen[d] / norm
      }
    }
    if (!moved && iter > 1) break
  }
  // 组簇：标签 = 簇内高频（且非全库泛化）关键词；代表文献 = 离质心最近
  const df = new Map<string, number>()
  for (const [, kws] of kwOf) for (const w of new Set(kws)) df.set(w, (df.get(w) ?? 0) + 1)
  const groups = new Map<number, Array<{ r: (typeof rows)[number]; sim: number }>>()
  for (let i = 0; i < n; i++) {
    const v = pvecs.get(rows[i].id)!
    let dot = 0
    for (let d = 0; d < dim; d++) dot += v[d] * centroids[assign[i]][d]
    const arr = groups.get(assign[i]) ?? []
    arr.push({ r: rows[i], sim: dot })
    groups.set(assign[i], arr)
  }
  const out: TopicCluster[] = []
  for (const [, members] of groups) {
    if (members.length < 2) continue
    const freq = new Map<string, number>()
    for (const m of members) for (const w of kwOf.get(m.r.id) ?? []) freq.set(w, (freq.get(w) ?? 0) + 1)
    const kws = [...freq.entries()]
      .map(([w, c]) => [w, c * Math.log(1 + n / (df.get(w) ?? 1))] as const) // TF-IDF：压制全库泛化词
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([w]) => w)
    const rep = [...members].sort((a, b) => b.sim - a.sim)[0].r
    out.push({
      label: kws[0] ?? rep.title.slice(0, 18),
      keywords: kws.length ? kws : [rep.title.slice(0, 12)],
      paperIds: members.map((m) => m.r.id).sort((a, b) => a - b)
    })
  }
  return out.sort((a, b) => b.paperIds.length - a.paperIds.length).slice(0, 12)
}

// 关键词共享并查集聚类（旧算法，退化路径）
function keywordClusters(
  rows: Array<{ id: number; title: string; summary: string | null }>,
  kwOf: Map<number, string[]>
): TopicCluster[] {
  const parent = new Map<number, number>()
  for (const r of rows) parent.set(r.id, r.id)
  // 路径减半：cur 必须向祖先推进，否则合并过的节点会原地打转死循环（曾致主进程 100% 卡死）
  const find = (x: number): number => {
    let cur = x
    while (parent.get(cur) !== cur) {
      const p = parent.get(cur)!
      const g = parent.get(p) ?? p
      parent.set(cur, g)
      cur = g
    }
    return cur
  }
  const kwPapers = new Map<string, number[]>()
  for (const [pid, kws] of kwOf) for (const k of kws) (kwPapers.get(k) ?? kwPapers.set(k, []).get(k)!).push(pid)
  // 两篇共享 ≥2 个关键词才连边：单个二字组重合太常见，全连会把整库糊成一大团
  const pairCount = new Map<string, number>()
  for (const [, pids] of kwPapers) {
    if (pids.length > 40) continue // 泛化词（出现在 40+ 篇）不参与连边
    for (let i = 0; i < pids.length; i++)
      for (let j = i + 1; j < pids.length; j++) {
        const key = pids[i] < pids[j] ? `${pids[i]}-${pids[j]}` : `${pids[j]}-${pids[i]}`
        pairCount.set(key, (pairCount.get(key) ?? 0) + 1)
      }
  }
  for (const [key, n] of pairCount) {
    if (n < 2) continue
    const [a, b] = key.split('-').map(Number)
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }
  const clusters = new Map<number, number[]>()
  for (const r of rows) {
    const root = find(r.id)
    const arr = clusters.get(root) ?? []
    arr.push(r.id)
    clusters.set(root, arr)
  }
  const out: TopicCluster[] = []
  for (const [, pids] of clusters) {
    if (pids.length < 2) continue // 单篇散点不构成主题
    const freq = new Map<string, number>()
    for (const pid of pids) for (const k of kwOf.get(pid) ?? []) freq.set(k, (freq.get(k) ?? 0) + 1)
    const kws = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k]) => k)
    out.push({ label: kws[0] ?? '未命名主题', keywords: kws, paperIds: pids.sort((a, b) => a - b) })
  }
  return out.sort((a, b) => b.paperIds.length - a.paperIds.length).slice(0, 12)
}
