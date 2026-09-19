// 参考文献抓取（对标 zotero-reference）：从 PDF 文末解析参考文献条目，
// 配置了 API Key 时再用 LLM 批量结构化成题录字段；结果缓存进 refs_cache 表，
// 二次打开直接命中缓存。单条参考文献可一键导入为库内题录（复用 importTranslated 管线）。
import { getDb, getSettings } from './db'
import { extractPagesCached } from './ingest'
import { chatStream } from './llm'
import { fieldsToCsl, importTranslated } from './translators'

export interface RefEntry {
  title: string
  authors?: string
  year?: string
  venue?: string
  doi?: string
  // 原始条目文本（LLM 不可用 / 解析失败时的兜底展示）
  raw: string
}

export interface RefsResult {
  ok: boolean
  refs: RefEntry[]
  cached?: boolean
  error?: string
}

// 懒初始化：refs 缓存表（paper_id 主键，json 存整个条目数组）
let tableReady = false
function ensureTable(): void {
  if (tableReady) return
  getDb().exec(`CREATE TABLE IF NOT EXISTS refs_cache(
    paper_id INTEGER PRIMARY KEY,
    json TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );`)
  tableReady = true
}

// ---------- 文末切条：识别编号式条目起始行并聚合 ----------
// 支持 [1] / 1. / 1、 / (1) / （1） 起始；编号限 1-3 位数字，避免把年份/页码误当编号
const ENTRY_START = /^\s*(?:\[(\d{1,3})\]|[(（](\d{1,3})[)）]|(\d{1,3})[.．、])\s*/

// 找到文末的参考文献区起点（最后一个「References / 参考文献」类独立标题行），
// 找不到就退回整段文末文本（有些 PDF 抽取后标题行不完整/丢失）
function refsRegion(tail: string): string {
  const re = /\n[ \t]*(references|bibliography|works cited|参考文献)[ \t]*[：:]?[ \t]*(?=\n)/gi
  let last: number | null = null
  for (const m of tail.matchAll(re)) {
    if (m.index !== undefined) last = m.index
  }
  return last === null ? tail : tail.slice(last)
}

// 逐行扫描：命中编号起始行则开新条目，其余行并入当前条目（参考文献常跨多行）
function splitEntries(region: string): string[] {
  const out: string[] = []
  let cur = ''
  for (const line of region.split('\n')) {
    const m = line.match(ENTRY_START)
    if (m) {
      if (cur.trim().length > 20) out.push(cur.replace(/\s+/g, ' ').trim())
      cur = line.replace(ENTRY_START, '')
    } else if (cur) {
      cur += ' ' + line
    }
  }
  if (cur.trim().length > 20) out.push(cur.replace(/\s+/g, ' ').trim())
  // 少于 4 条说明切分不可信（标题区/图表说明被误聚合）：返回空让上层走「不缓存、可重试」
  return out.length >= 4 ? out.slice(0, 200) : []
}

// ---------- LLM 批量结构化（一次调用，失败整体降级为 raw 拆分） ----------
async function structureWithLlm(entries: string[]): Promise<Array<Partial<RefEntry>> | null> {
  if (!getSettings().apiKey) return null
  const list = entries.map((raw, i) => `[${i + 1}] ${raw.slice(0, 500)}`).join('\n')
  const prompt =
    '你是文献题录解析助手。下面是一篇论文的参考文献列表（已按条目编号）。' +
    '请把每条解析成结构化题录，只输出一个 JSON 数组，不要任何其他文字。' +
    `要求：1）数组长度必须等于输入条目数（${entries.length}）；` +
    '2）每项格式 {"title":"...","authors":"A, B, C","year":"1998","venue":"期刊/会议名","doi":"10.xxxx/xxxx"}；' +
    '3）authors 用「, 」分隔、保持原文写法；4）某字段解析不出来就留空字符串，不要编造；' +
    '5）title 不要带编号前缀。\n\n' + list
  try {
    let out = ''
    for await (const d of chatStream([
      { role: 'system', content: prompt },
      { role: 'user', content: '请输出 JSON 数组。' }
    ])) {
      out += d
    }
    const json = JSON.parse(out.replace(/^```json\s*/i, '').replace(/```\s*$/g, '')) as unknown
    if (!Array.isArray(json)) return null
    return json.slice(0, entries.length).map((x) => {
      const o = (x ?? {}) as Record<string, unknown>
      const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
      return {
        title: s(o.title),
        authors: s(o.authors),
        year: s(o.year),
        venue: s(o.venue),
        doi: s(o.doi)
      }
    })
  } catch {
    return null // 网络/Key/解析失败：降级为 raw 拆分
  }
}

// 取论文文末参考文献条目（缓存命中直接返回）
export async function listRefs(paperId: number): Promise<RefsResult> {
  ensureTable()
  const db = getDb()
  const row = db.prepare('SELECT id, title, path FROM papers WHERE id=?').get(paperId) as
    | { id: number; title: string; path: string }
    | undefined
  if (!row) return { ok: false, refs: [], error: '论文不存在' }

  // 缓存命中：直接返回（条目列表不随时间变化，除非重新获取）
  const hit = db.prepare('SELECT json FROM refs_cache WHERE paper_id=?').get(paperId) as { json: string } | undefined
  if (hit) {
    try {
      return { ok: true, refs: JSON.parse(hit.json) as RefEntry[], cached: true }
    } catch {
      db.prepare('DELETE FROM refs_cache WHERE paper_id=?').run(paperId) // 缓存损坏就重来
    }
  }

  let pages: string[] = []
  try {
    pages = await extractPagesCached(row.path)
  } catch (err) {
    return { ok: false, refs: [], error: `无法读取 PDF：${String(err).slice(0, 160)}` }
  }
  const region = refsRegion(pages.slice(-4).join('\n'))
  const entries = splitEntries(region)
  if (entries.length === 0) return { ok: true, refs: [] } // 未识别到条目（不写缓存，PDF 同步完成后可重试）

  // 有 API Key 用 LLM 结构化；失败/未配置降级：title 取 raw 前 120 字
  const parsed = await structureWithLlm(entries)
  const refs: RefEntry[] = entries.map((raw, i) => {
    const p = parsed?.[i]
    if (p?.title) {
      return {
        title: p.title,
        ...(p.authors ? { authors: p.authors } : {}),
        ...(p.year ? { year: p.year } : {}),
        ...(p.venue ? { venue: p.venue } : {}),
        ...(p.doi ? { doi: p.doi } : {}),
        raw
      }
    }
    return { title: raw.slice(0, 120), raw }
  })

  db.prepare(
    "INSERT INTO refs_cache(paper_id,json,created_at) VALUES(?,?,datetime('now')) ON CONFLICT(paper_id) DO UPDATE SET json=excluded.json, created_at=excluded.created_at"
  ).run(paperId, JSON.stringify(refs))
  return { ok: true, refs }
}

// 把某条参考文献导入为库内题录（无 PDF，走题录占位管线）
export async function importRef(paperId: number, index: number, category?: string): Promise<{ ok: boolean; slug?: string; error?: string }> {
  ensureTable()
  const db = getDb()
  const row = db.prepare('SELECT id, title FROM papers WHERE id=?').get(paperId) as { id: number; title: string } | undefined
  if (!row) return { ok: false, error: '论文不存在' }
  const hit = db.prepare('SELECT json FROM refs_cache WHERE paper_id=?').get(paperId) as { json: string } | undefined
  if (!hit) return { ok: false, error: '请先获取参考文献列表' }
  let refs: RefEntry[]
  try {
    refs = JSON.parse(hit.json) as RefEntry[]
  } catch {
    return { ok: false, error: '缓存数据损坏，请重新获取参考文献' }
  }
  const ref = refs[index]
  if (!ref) return { ok: false, error: `条目不存在（共 ${refs.length} 条）` }

  // fieldsToCsl 复用 translators 的作者拆分（中文 → literal，西文 → family+given）
  const csl = fieldsToCsl(
    { title: ref.title, authors: ref.authors ?? '', year: ref.year ?? '', venue: ref.venue ?? '', doi: ref.doi ?? '' },
    '',
    'refs'
  )
  csl.id = ref.doi || ref.title // 去重身份：DOI 优先，其次标题
  return importTranslated({ csl, category, origin: `引自《${row.title}》` }, () => {})
}
