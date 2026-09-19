// 被引次数与期刊信息（对标 Scite / 影响因子插件）：
// 被引走 OpenAlex 免 Key API（DOI 精确查，无 DOI 退回标题检索 + 简单相似度闸门）；
// 期刊影响因子/分区由用户导入 CSV 存入 venues 表，供详情面板查询展示。
import fs from 'node:fs'
import { dialog } from 'electron'
import { getDb } from './db'

// OpenAlex 礼貌 UA（官方建议带联系方式，这里用应用标识）
const UA = 'CSPAPER/0.6 (mailto:cspaper@app.local)'

// 懒初始化：期刊表（name 唯一，大小写不敏感）
let tableReady = false
function ensureTables(): void {
  if (tableReady) return
  getDb().exec(`CREATE TABLE IF NOT EXISTS venues(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    abbr TEXT,
    if_val REAL,
    zone TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_venues_name ON venues(name COLLATE NOCASE);`)
  tableReady = true
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// ---------- 被引次数更新 ----------
// 标题相似度闸门：去标点归一化后互相包含才算命中（无 DOI 检索防张冠李戴）
function similarTitle(a: string, b: string): boolean {
  const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ').trim()
  const x = norm(a)
  const y = norm(b)
  if (!x || !y) return false
  return x.includes(y) || y.includes(x)
}

// 单篇取被引：DOI 精确优先，404/无 DOI 退回标题检索；取不到返回 null
async function fetchCitedBy(doi: string, title: string): Promise<number | null> {
  const clean = doi.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
  if (clean) {
    // DOI 里的斜杠保留原样（OpenAlex 路径要求），其余字符编码
    const enc = encodeURIComponent(clean).replace(/%2F/gi, '/')
    const r = await fetch(`https://api.openalex.org/works/doi:${enc}`, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(12000)
    })
    if (r.ok) {
      const j = (await r.json()) as { cited_by_count?: unknown }
      if (typeof j.cited_by_count === 'number') return j.cited_by_count
    }
  }
  const q = title.replace(/\s+/g, ' ').trim().slice(0, 120)
  if (!q) return null
  const r2 = await fetch(`https://api.openalex.org/works?search=${encodeURIComponent(q)}&per-page=1`, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(12000)
  })
  if (!r2.ok) return null
  const j2 = (await r2.json()) as { results?: Array<{ cited_by_count?: unknown; display_name?: string; title?: string }> }
  const hit = j2.results?.[0]
  if (!hit || typeof hit.cited_by_count !== 'number') return null
  const name = hit.display_name ?? hit.title ?? ''
  if (!similarTitle(name, title)) return null // 首条标题对不上：宁缺毋滥
  return hit.cited_by_count
}

// 串行逐篇更新 papers.cited_by（每篇间隔 200ms 限流）；单篇失败计 errors 不中断
export async function updateCitations(ids: number[]): Promise<{ updated: number; errors: number }> {
  const db = getDb()
  let updated = 0
  let errors = 0
  const getRow = db.prepare('SELECT id, title, doi FROM papers WHERE id=?')
  const setUpd = db.prepare('UPDATE papers SET cited_by=? WHERE id=?')
  for (let i = 0; i < ids.length; i++) {
    if (i > 0) await sleep(200)
    const row = getRow.get(Number(ids[i])) as { id: number; title: string; doi: string | null } | undefined
    if (!row) {
      errors++
      continue
    }
    try {
      const n = await fetchCitedBy(row.doi ?? '', row.title)
      if (n === null) {
        errors++ // 查不到/不匹配也计入失败，保证 updated+errors = 总数
        continue
      }
      setUpd.run(n, row.id)
      updated++
    } catch (err) {
      console.warn(`[openalex] ${row.title.slice(0, 60)} 被引查询失败:`, String(err).slice(0, 120))
      errors++
    }
  }
  return { updated, errors }
}

// ---------- 期刊查询 ----------
export interface VenueInfo {
  name: string
  if_val: number | null
  zone: string | null
}

// 大小写不敏感：先精确（NOCASE），再 LIKE 模糊（期刊在 CSV 里可能带副标题/括号差异）
export function venueLookup(rawName: string): VenueInfo | null {
  ensureTables()
  const name = String(rawName ?? '').trim()
  if (!name) return null
  const db = getDb()
  const sel = 'SELECT name, if_val, zone FROM venues WHERE'
  const exact = db.prepare(`${sel} name = ? COLLATE NOCASE LIMIT 1`).get(name) as
    | { name: string; if_val: number | null; zone: string | null }
    | undefined
  const row =
    exact ??
    (db
      // 用户输入里的 % _ 会污染 LIKE 模式，先转义；COLLATE 写在左操作数上才对 LIKE 生效
      .prepare(`${sel} name COLLATE NOCASE LIKE ? ESCAPE '\\' LIMIT 1`)
      .get(`%${name.replace(/[\\%_]/g, (c) => `\\${c}`)}%`) as { name: string; if_val: number | null; zone: string | null } | undefined)
  if (!row) return null
  return { name: row.name, if_val: row.if_val ?? null, zone: row.zone ?? null }
}

// ---------- CSV 导入（影响因子/分区表） ----------
// 整段状态机解析：支持引号包裹（内含分隔符/换行）、"" 转义；分隔符按首行逗号/制表符计数自动识别
function parseDelimited(text: string): string[][] {
  const headEnd = text.indexOf('\n')
  const head = headEnd >= 0 ? text.slice(0, headEnd) : text
  const delim = (head.match(/\t/g)?.length ?? 0) > (head.match(/,/g)?.length ?? 0) ? '\t' : ','
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"'
          i++
        } else inQ = false
      } else cur += c
    } else if (c === '"') inQ = true
    else if (c === delim) {
      row.push(cur.trim())
      cur = ''
    } else if (c === '\r') {
      /* 跳过 */
    } else if (c === '\n') {
      row.push(cur.trim())
      rows.push(row)
      row = []
      cur = ''
    } else cur += c
  }
  if (cur || row.length) {
    row.push(cur.trim())
    rows.push(row)
  }
  return rows.filter((r) => r.some((cell) => cell !== ''))
}

// 表头模糊匹配：归一化（小写去空格下划线连字符）后按关键词命中
function normHeader(h: string): string {
  return h.toLowerCase().replace(/[\s_-]+/g, '')
}
function matchCol(headers: string[], keys: Array<{ test: (h: string) => boolean }>): number {
  for (const k of keys) {
    const i = headers.findIndex((h) => k.test(normHeader(h)))
    if (i >= 0) return i
  }
  return -1
}

// 弹窗选 CSV → 逐行 upsert venues，返回导入行数（含更新）
export async function importVenuesCsv(): Promise<{ imported: number }> {
  const r = await dialog.showOpenDialog({
    title: '选择期刊影响因子 CSV（表头需含：期刊名 / 影响因子 / 分区）',
    filters: [{ name: 'CSV / TSV', extensions: ['csv', 'tsv', 'txt'] }],
    properties: ['openFile']
  })
  if (r.canceled || !r.filePaths[0]) return { imported: 0 }
  const text = fs.readFileSync(r.filePaths[0], 'utf8').replace(/^\ufeff/, '')
  const rows = parseDelimited(text)
  if (rows.length < 2) throw new Error('CSV 为空或只有表头')

  const headers = rows[0]
  const nameCol = matchCol(headers, [
    { test: (h) => h.includes('期刊名') },
    { test: (h) => h === 'name' || h.endsWith('name') },
    { test: (h) => h.includes('刊名') || h.includes('期刊') || h.includes('journal') || h.includes('publication') }
  ])
  const ifCol = matchCol(headers, [
    { test: (h) => h.includes('影响因子') || h.includes('因子') },
    { test: (h) => h === 'if' || /^if\d/.test(h) || h.includes('impactfactor') || h === 'impact' || h.endsWith('factor') }
  ])
  const zoneCol = matchCol(headers, [
    { test: (h) => h.includes('分区') },
    { test: (h) => h === 'zone' || h.includes('jcr') || h.includes('quartile') || h.includes('zone') }
  ])
  if (nameCol < 0) throw new Error('未识别到期刊名列（表头需含 name / 期刊名）')

  const db = getDb()
  const find = db.prepare('SELECT id FROM venues WHERE name = ? COLLATE NOCASE')
  const ins = db.prepare('INSERT INTO venues(name, abbr, if_val, zone) VALUES(?,?,?,?)')
  const upd = db.prepare('UPDATE venues SET if_val = COALESCE(?, if_val), zone = COALESCE(?, zone) WHERE id = ?')
  let imported = 0
  const tx = db.transaction(() => {
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]
      const name = (row[nameCol] ?? '').trim()
      if (!name) continue
      const ifRaw = ifCol >= 0 ? (row[ifCol] ?? '') : ''
      const ifVal = parseFloat(ifRaw.replace(/[^0-9.]/g, ''))
      const zone = zoneCol >= 0 ? (row[zoneCol] ?? '').trim() : ''
      const existing = find.get(name) as { id: number } | undefined
      if (existing) upd.run(Number.isFinite(ifVal) ? ifVal : null, zone || null, existing.id)
      else ins.run(name, null, Number.isFinite(ifVal) ? ifVal : null, zone || null)
      imported++
    }
  })
  tx()
  return { imported }
}
