// CSL 引文引擎（W8）：
// - 内置 12 种样式：cite-formats.ts 原创实现，开箱即用（Apache-2.0 干净）。
// - 完整 CSL（万种样式）：可选外部引擎 citeproc.js（CPAL/AGPL 许可，与本项目许可证不兼容，
//   因此**不随 CSPAPER 分发、不进入仓库与安装包**）——用户在设置里点「下载 CSL 引擎」后
//   由应用从 jsDelivr 下载到本机数据目录运行；样式 .csl 文件同样按需下载/导入到数据目录。
//   这是「用户自装可选组件」模式：CSPAPER 只负责调用，不复制、不再分发该组件。
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { app } from 'electron'
import { BUILTIN_STYLES, formatBuiltin, isNumericStyle, type CiteItem } from './cite-formats'
import { getDb } from './db'

const CDN_ENGINE = 'https://cdn.jsdelivr.net/npm/citeproc@2.4.63/citeproc.js'
const CDN_LOCALE = (lang: string): string => `https://cdn.jsdelivr.net/gh/citation-style-language/locales@master/locales-${lang}.xml`
const CDN_STYLE = (id: string): string => `https://cdn.jsdelivr.net/gh/citation-style-language/styles@master/${encodeURIComponent(id)}.csl`

function cslDir(): string {
  return path.join(app.getPath('userData'), 'csl')
}
function stylesDir(): string {
  return path.join(app.getPath('userData'), 'styles')
}
function engineFile(): string {
  return path.join(cslDir(), 'citeproc.js')
}
function localeFile(lang: string): string {
  return path.join(cslDir(), 'locales', `locales-${lang}.xml`)
}
function styleFile(id: string): string {
  return path.join(stylesDir(), `${id.replace(/[\\/:*?"<>|]/g, '_')}.csl`)
}

function catalogFile(): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'csl-catalog.json') : path.join(app.getAppPath(), 'resources', 'csl-catalog.json')
}

export interface FullStyleInfo {
  id: string
  name: string
  kind: 'builtin' | 'csl'
  numeric: boolean
  note?: string
  engineRequired?: boolean
}

export function listStyles(): FullStyleInfo[] {
  const out: FullStyleInfo[] = BUILTIN_STYLES.map((s) => ({ id: s.id, name: s.name, kind: 'builtin' as const, numeric: s.numeric, note: s.note }))
  try {
    for (const f of fs.readdirSync(stylesDir())) {
      if (!f.toLowerCase().endsWith('.csl')) continue
      const id = f.replace(/\.csl$/i, '')
      const raw = fs.readFileSync(path.join(stylesDir(), f), 'utf8')
      const title = raw.match(/<title[^>]*>([^<]+)<\/title>/)?.[1] ?? id
      out.push({ id, name: title, kind: 'csl', numeric: false, engineRequired: true })
    }
  } catch {
    /* 样式目录不存在 */
  }
  return out
}

// ---------- 目录检索（离线 catalog + 按需下载） ----------
interface Catalog {
  updated: string
  count: number
  styles: string[]
}

let catalog: Catalog | null = null
function loadCatalog(): Catalog | null {
  if (catalog) return catalog
  try {
    catalog = JSON.parse(fs.readFileSync(catalogFile(), 'utf8')) as Catalog
    return catalog
  } catch {
    return null
  }
}

export function searchCatalog(q: string): string[] {
  const cat = loadCatalog()
  if (!cat) return []
  const needle = q.trim().toLowerCase()
  if (!needle) return cat.styles.slice(0, 60)
  return cat.styles.filter((s) => s.toLowerCase().includes(needle)).slice(0, 60)
}

async function fetchToFile(url: string, dest: string, timeoutMs = 30000): Promise<void> {
  const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!r.ok) throw new Error(`下载失败 HTTP ${r.status}：${url}`)
  const buf = Buffer.from(await r.arrayBuffer())
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, buf)
}

export async function downloadEngine(): Promise<{ ok: boolean; error?: string }> {
  try {
    await fetchToFile(CDN_ENGINE, engineFile())
    // 预取中英 locale（其余语言格式化时按需下载）
    await Promise.allSettled([downloadLocale('zh-CN'), downloadLocale('en-US')])
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

export function engineStatus(): { downloaded: boolean; size?: number } {
  try {
    const st = fs.statSync(engineFile())
    return { downloaded: st.size > 100000, size: st.size }
  } catch {
    return { downloaded: false }
  }
}

async function downloadLocale(lang: string): Promise<void> {
  if (fs.existsSync(localeFile(lang))) return
  await fetchToFile(CDN_LOCALE(lang), localeFile(lang))
}

export async function downloadStyle(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const safe = id.replace(/[^a-zA-Z0-9_.-]/g, '')
    if (!safe || safe !== id) throw new Error('样式 id 不合法')
    await fetchToFile(CDN_STYLE(safe), styleFile(safe))
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

export function removeStyle(id: string): boolean {
  try {
    fs.rmSync(styleFile(id), { force: true })
    return true
  } catch {
    return false
  }
}

export function importStyleFile(src: string): { ok: boolean; id?: string; error?: string } {
  try {
    const raw = fs.readFileSync(src, 'utf8')
    if (!raw.includes('<style')) throw new Error('不是有效的 CSL 样式文件')
    const id = path.basename(src).replace(/\.csl$/i, '').replace(/[\\/:*?"<>|]/g, '_') || 'imported-style'
    fs.mkdirSync(stylesDir(), { recursive: true })
    fs.writeFileSync(styleFile(id), raw)
    return { ok: true, id }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

// ---------- 论文行 → CiteItem（优先 papers.csl 完整字段） ----------
function rowToCiteItem(row: Record<string, unknown>): CiteItem {
  if (typeof row.csl === 'string' && row.csl) {
    try {
      const c = JSON.parse(row.csl) as Record<string, unknown>
      const authors = ((c.author ?? []) as Array<{ given?: string; family?: string; literal?: string }>)
        .map((a) => a.literal ?? [a.given, a.family].filter(Boolean).join(' '))
        .join(', ')
      const year = ((c.issued ?? {}) as { 'date-parts'?: number[][] })['date-parts']?.[0]?.[0] ?? null
      const ct = c['container-title']
      return {
        id: row.id as number,
        type: String(c.type ?? ''),
        title: String(c.title ?? row.title ?? ''),
        authors,
        year: typeof year === 'number' ? year : (row.year as number | null),
        venue: Array.isArray(ct) ? String(ct[0] ?? '') : String(ct ?? row.venue ?? ''),
        doi: typeof c.DOI === 'string' ? c.DOI : (row.doi as string | undefined),
        url: typeof c.URL === 'string' ? c.URL : undefined,
        volume: typeof c.volume === 'string' ? c.volume : undefined,
        issue: typeof c.issue === 'string' ? c.issue : undefined,
        pages: typeof c.page === 'string' ? c.page : undefined,
        publisher: typeof c.publisher === 'string' ? c.publisher : undefined
      }
    } catch {
      /* csl 列损坏按列拼装 */
    }
  }
  return {
    id: row.id as number,
    type: String(row.item_type ?? ''),
    title: String(row.title ?? ''),
    authors: String(row.authors ?? ''),
    year: (row.year as number | null) ?? null,
    venue: String(row.venue ?? ''),
    doi: typeof row.doi === 'string' ? row.doi : undefined
  }
}

// ---------- 可选 CSL 引擎 ----------
let engineModule: unknown = null

function loadEngine(): { Engine: new (sys: unknown, style: string, lang: string, force: boolean) => CiteprocEngineLike } {
  if (engineModule) return engineModule as ReturnType<typeof loadEngine>
  const code = fs.readFileSync(engineFile(), 'utf8')
  const sandbox = {
    module: { exports: {} as Record<string, unknown> },
    exports: {} as Record<string, unknown>,
    console,
    setTimeout,
    clearTimeout
  }
  ;(sandbox as Record<string, unknown>).window = sandbox
  vm.createContext(sandbox)
  vm.runInContext(code, sandbox, { timeout: 5000 })
  const CSL = sandbox.module.exports && Object.keys(sandbox.module.exports).length ? sandbox.module.exports : (sandbox as Record<string, unknown>).CSL
  if (!CSL || typeof (CSL as { Engine?: unknown }).Engine !== 'function') throw new Error('citeproc 引擎文件无效（可尝试重新下载）')
  engineModule = CSL
  return CSL as ReturnType<typeof loadEngine>
}

interface CiteprocEngineLike {
  updateItems(ids: string[]): void
  makeBibliography(): [{ entry_ids: string[][] } | Record<string, unknown>, string[]] | false
  setLocale?: (lang: string) => void
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#38;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

// 用可选引擎按 .csl 样式格式化（引擎/locale 缺失时自动按需下载）
async function cslEngineFormat(items: CiteItem[], styleId: string): Promise<string[]> {
  const styleXml = fs.readFileSync(styleFile(styleId), 'utf8')
  // 样式默认 locale + 中英兜底，全部预取（retrieveLocale 需要同步返回）
  const defaultLocales = [...styleXml.matchAll(/xml:lang="([^"]+)"/g)].map((m) => m[1])
  const langs = [...new Set(['zh-CN', 'en-US', ...defaultLocales])].slice(0, 6)
  for (const lang of langs) {
    try {
      await downloadLocale(lang)
    } catch {
      /* 该语言缺失时 citeproc 会回退 en-US */
    }
  }
  const CSL = loadEngine()
  const itemsById: Record<string, CiteItem & Record<string, unknown>> = {}
  for (const it of items) {
    const id = String(it.id ?? it.title)
    itemsById[id] = { ...it, id, type: it.type || 'article-journal' }
  }
  const sys = {
    retrieveLocale: (lang: string): string | undefined => {
      try {
        return fs.readFileSync(localeFile(lang), 'utf8')
      } catch {
        return undefined
      }
    },
    retrieveItem: (id: string): (CiteItem & Record<string, unknown>) | undefined => itemsById[id]
  }
  const lang = defaultLocales[0] && fs.existsSync(localeFile(defaultLocales[0])) ? defaultLocales[0] : 'zh-CN'
  const engine = new CSL.Engine(sys, styleXml, lang, false)
  engine.updateItems(Object.keys(itemsById))
  const bib = engine.makeBibliography()
  if (!bib || !Array.isArray(bib[1])) throw new Error('样式未产出参考文献（条目字段可能不足）')
  return bib[1].map(stripHtml)
}

// ---------- 对外格式化入口 ----------
export async function formatCite(ids: number[], styleId: string): Promise<{ ok: boolean; items?: string[]; error?: string; style?: string }> {
  if (!ids.length) return { ok: false, error: '未选择文献' }
  const db = getDb()
  const placeholders = ids.map(() => '?').join(',')
  const rows = db
    .prepare(`SELECT id, title, authors, year, venue, doi, item_type, csl FROM papers WHERE id IN (${placeholders})`)
    .all(...ids) as Array<Record<string, unknown>>
  // 保持调用方传入的顺序
  const byId = new Map(rows.map((r) => [r.id as number, r]))
  const items = ids.map((id) => rowToCiteItem(byId.get(id) ?? { id, title: '（未找到）', authors: '', year: null, venue: '' }))

  if (BUILTIN_STYLES.some((s) => s.id === styleId)) {
    return { ok: true, items: formatBuiltin(styleId, items), style: styleId }
  }
  // CSL 样式：文件缺失时按需从官方样式库下载；引擎缺失时给出明确指引
  if (!fs.existsSync(styleFile(styleId))) {
    const dl = await downloadStyle(styleId)
    if (!dl.ok) return { ok: false, error: `样式「${styleId}」下载失败：${dl.error}` }
  }
  if (!engineStatus().downloaded) {
    return { ok: false, error: 'CSL 样式需要可选引擎：请在 设置 → 引文样式 → 下载 CSL 引擎（外部组件，按需下载到本机）' }
  }
  try {
    return { ok: true, items: await cslEngineFormat(items, styleId), style: styleId }
  } catch (err) {
    return { ok: false, error: `CSL 格式化失败：${String(err).slice(0, 200)}` }
  }
}

export { isNumericStyle }
