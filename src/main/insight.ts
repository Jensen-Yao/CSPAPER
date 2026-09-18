// AI 洞察：文献卡片小结、多篇对比表格（可追溯引用）、深度搜索、对比表导出
import fs from 'node:fs'
import { dialog, BrowserWindow } from 'electron'
import { getDb } from './db'
import { chatStream } from './llm'
import { extractPagesCached } from './ingest'

export interface CompareCell {
  t: string
  p: number | null // 出处页码（可点击跳回原文）
}

export interface CompareData {
  paperIds: number[]
  dimensions: string[]
  cells: Record<string, Record<string, CompareCell[]>>
}

export interface CompareTable {
  id: number
  title: string
  data: CompareData
  created_at: string
}

const DEFAULT_DIMENSIONS = ['研究问题', '研究成果']

const parseData = (raw: string): CompareData => {
  const d = JSON.parse(raw || '{}') as Partial<CompareData>
  return {
    paperIds: Array.isArray(d.paperIds) ? d.paperIds : [],
    dimensions: Array.isArray(d.dimensions) && d.dimensions.length ? d.dimensions : [...DEFAULT_DIMENSIONS],
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
function buildMarkdown(title: string, paperRows: Array<Record<string, string>>, dimensions: string[]): string {
  const cols = ['标题', ...dimensions, '作者', '期刊']
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

function buildCsv(paperRows: Array<Record<string, string>>, dimensions: string[]): string {
  const cols = ['标题', ...dimensions, '作者', '期刊']
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
  const paperRows: Array<Record<string, string>> = []
  for (const pid of data.paperIds) {
    const p = db.prepare('SELECT id, slug, title, authors, venue FROM papers WHERE id=?').get(pid) as
      | { id: number; slug: string; title: string; authors: string; venue: string }
      | undefined
    if (!p) continue
    const cells = data.cells[String(pid)] ?? {}
    const row: Record<string, string> = {
      标题: p.title,
      作者: p.authors,
      期刊: p.venue
    }
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
      ? buildMarkdown(table.title, paperRows, data.dimensions)
      : buildCsv(paperRows, data.dimensions)
  fs.writeFileSync(r.filePath, content, 'utf8')
  dialog.showMessageBox(win, { message: '对比表已导出', detail: r.filePath })
}
