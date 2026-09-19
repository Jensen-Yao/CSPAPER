// Translators 可扩展抓取框架（W13，对标 Zotero Translators）：
// 「从某网站抓题录」不硬编码在主程序，而是声明式脚本目录——
//   内置脚本随 app 发布（resources/translators/，打包进 extraResources）；
//   用户/社区脚本放进数据目录 translators/ 即生效（fs.watch 热加载，免重启）。
// 脚本格式：声明式 steps 链（fetch/meta/css/json/regex/template/download/jsonlist）
//   + 可选 transform 小段 JS（node:vm 沙箱，无 require/网络，200ms 超时熔断）。
// 输出统一为 CSL-JSON，进入常规导入管线（指纹去重 + AI 归类 + OA PDF）。
// 格式规范见 docs/translators.md。
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { app } from 'electron'
import * as cheerio from 'cheerio'
import { getSettings, getDb, getMeta, setMeta } from './db'

// ---------- 类型 ----------
export type TranslatorOp = 'fetch' | 'meta' | 'css' | 'json' | 'jsonraw' | 'regex' | 'template' | 'download' | 'jsonlist'

export interface TranslatorStep {
  op: TranslatorOp
  url?: string // fetch/download：支持 {字段} 插值（{url}/{q}/{doi}…）
  pick?: string // meta：name/property 属性名（citation_title 等）
  selector?: string // css：选择器
  attr?: string // css：取属性名，或 text/html
  path?: string // json/jsonlist/jsonraw：点路径（a.b.0.c）
  re?: string // regex：正则（取 group 1，无组取整匹配）
  group?: number
  as?: string // 结果写入字段名
  multi?: boolean // css/meta：收集全部匹配（join ', '）
  from?: string // regex：输入字段（默认 html）
  value?: string // template：模板串
  map?: Record<string, string> // jsonlist：结果字段 ← 列表项点路径
  rowTransform?: string // jsonlist：逐行沙箱转换（如 author 数组 → "A, B"）
  ifEmpty?: boolean // 仅当目标字段为空时写入（多来源回退：meta 优先、css 兜底）
}

export interface TranslatorScript {
  id: string
  name: string
  version?: number
  type?: 'web' | 'search'
  matches?: string[] // hostname 后缀匹配（命中其一即可）
  patterns?: string[] // URL 正则（进一步限定页面，如 /abs/ 详情页）
  steps: TranslatorStep[]
  transform?: string
  note?: string
}

export interface ScriptInfo {
  id: string
  name: string
  type: 'web' | 'search'
  matches: string[]
  source: 'builtin' | 'user'
  disabled: boolean
  file: string
  note?: string
}

export interface TranslateResult {
  ok: boolean
  translator?: string
  csl?: Record<string, unknown>
  pdfPath?: string
  error?: string
}

export interface SearchHit extends Record<string, unknown> {
  translator: string
}

// ---------- 目录与加载 ----------
export function builtinDir(): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'translators') : path.join(app.getAppPath(), 'resources', 'translators')
}

export function userDir(): string {
  return path.join(app.getPath('userData'), 'translators')
}

let cache: { at: number; scripts: Array<TranslatorScript & { source: 'builtin' | 'user'; file: string }> } | null = null
let watcher: fs.FSWatcher | null = null

function parseScriptFile(file: string, source: 'builtin' | 'user'): (TranslatorScript & { source: 'builtin' | 'user'; file: string }) | null {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8')) as TranslatorScript
    if (!j || typeof j.id !== 'string' || typeof j.name !== 'string' || !Array.isArray(j.steps)) return null
    return { ...j, source, file }
  } catch {
    return null
  }
}

export function listScripts(): Array<TranslatorScript & { source: 'builtin' | 'user'; file: string }> {
  if (cache) return cache.scripts
  const out: Array<TranslatorScript & { source: 'builtin' | 'user'; file: string }> = []
  const scan = (dir: string, source: 'builtin' | 'user'): void => {
    let files: string[] = []
    try {
      files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.json'))
    } catch {
      return
    }
    for (const f of files) {
      const s = parseScriptFile(path.join(dir, f), source)
      if (s) out.push(s)
    }
  }
  scan(builtinDir(), 'builtin')
  fs.mkdirSync(userDir(), { recursive: true })
  scan(userDir(), 'user')
  out.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'search' ? -1 : 1))
  cache = { at: Date.now(), scripts: out }
  watchUserDir()
  return out
}

// 用户脚本目录热加载：增删改脚本文件立即生效，无需重启
function watchUserDir(): void {
  if (watcher) return
  try {
    watcher = fs.watch(userDir(), () => {
      cache = null
    })
    watcher.on('error', () => {
      try {
        watcher?.close()
      } catch {
        /* ignore */
      }
      watcher = null
    })
  } catch {
    /* 目录监听失败不影响功能，重新列举时自然刷新 */
  }
}

export function invalidateCache(): void {
  cache = null
}

function disabledIds(): string[] {
  try {
    const v = getMeta('disabled_translators')
    return v ? (JSON.parse(v) as string[]) : []
  } catch {
    return []
  }
}

export function setDisabledIds(ids: string[]): void {
  setMeta('disabled_translators', JSON.stringify([...new Set(ids)]))
}

export function listScriptInfo(): ScriptInfo[] {
  const disabled = new Set(disabledIds())
  return listScripts().map((s) => ({
    id: s.id,
    name: s.name,
    type: s.type ?? 'web',
    matches: s.matches ?? [],
    source: s.source,
    disabled: disabled.has(s.id),
    file: s.file,
    note: s.note
  }))
}

// ---------- 匹配 ----------
function hostMatches(script: TranslatorScript, url: string): boolean {
  const matches = script.matches ?? []
  if (matches.length === 0) return false
  let host = ''
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return false
  }
  return matches.some((m) => host === m.toLowerCase() || host.endsWith('.' + m.toLowerCase()))
}

export function matchScript(url: string): (TranslatorScript & { source: 'builtin' | 'user'; file: string }) | null {
  const disabled = new Set(disabledIds())
  let bare: string | null = null
  try {
    bare = new URL(url).href
  } catch {
    return null
  }
  for (const s of listScripts()) {
    if ((s.type ?? 'web') !== 'web') continue
    if (disabled.has(s.id)) continue
    if (!hostMatches(s, url)) continue
    const pats = s.patterns ?? []
    if (pats.length === 0 || pats.some((p) => safeRe(p)?.test(bare!))) return s
  }
  return null
}

function safeRe(p: string): RegExp | null {
  try {
    return new RegExp(p)
  } catch {
    return null
  }
}

// ---------- 执行 ----------
interface ExecCtx {
  url: string
  q?: string
  html: string
  json: unknown
  fields: Record<string, string>
  results: Array<Record<string, string>>
  pdfPath?: string
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 CSPAPER/0.6'

async function httpGet(url: string, timeoutMs = 15000): Promise<{ text: string; buf: ArrayBuffer; type: string }> {
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/json,application/pdf,*/*' },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'follow'
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}：${url.slice(0, 120)}`)
  const type = r.headers.get('content-type') ?? ''
  const buf = await r.arrayBuffer()
  return { text: new TextDecoder('utf-8').decode(buf), buf, type }
}

function dotPath(obj: unknown, p: string): unknown {
  let cur: unknown = obj
  for (const seg of p.split('.')) {
    if (cur == null) return undefined
    if (Array.isArray(cur)) {
      const i = parseInt(seg)
      cur = Number.isNaN(i) ? undefined : cur[i]
    } else if (typeof cur === 'object') {
      cur = (cur as Record<string, unknown>)[seg]
    } else return undefined
  }
  return cur
}

function fill(tpl: string, ctx: ExecCtx): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => {
    if (k === 'url') return ctx.url
    // 只有检索词默认编码；DOI/PDF 链接等含斜杠的值保持原样，避免 URL 被编码破坏
    if (k === 'q') return encodeURIComponent(ctx.q ?? '')
    return ctx.fields[k] ?? ''
  })
}

function applyRe(input: string, step: TranslatorStep): string {
  const re = safeRe(step.re ?? '')
  if (!re) return ''
  if (step.multi) {
    const out: string[] = []
    for (const m of input.matchAll(new RegExp(re.source, 'g' + (re.flags.includes('i') ? 'i' : '')))) {
      out.push((m[step.group ?? 1] ?? m[0]).trim())
      if (out.length >= 50) break
    }
    return out.filter(Boolean).join(', ')
  }
  const m = re.exec(input)
  return m ? (m[step.group ?? 1] ?? m[0]).trim() : ''
}

// 字段写入（ifEmpty：目标已有值时不覆盖）
function setField(ctx: ExecCtx, as: string | undefined, v: string, step: TranslatorStep): void {
  const key = as ?? ''
  if (!key || !v) return
  if (step.ifEmpty && ctx.fields[key]) return
  ctx.fields[key] = v
}

async function applyStep(step: TranslatorStep, ctx: ExecCtx): Promise<void> {
  switch (step.op) {
    case 'fetch': {
      const target = fill(step.url ?? '{url}', ctx)
      const { text } = await httpGet(target)
      ctx.html = text
      try {
        ctx.json = JSON.parse(text)
      } catch {
        ctx.json = null
      }
      return
    }
    case 'meta': {
      if (!ctx.html || !step.pick) return
      const $ = cheerio.load(ctx.html)
      const vals: string[] = []
      $(`meta[name="${step.pick}"], meta[property="${step.pick}"], meta[itemprop="${step.pick}"]`).each((_i, el) => {
        const c = $(el).attr('content')
        if (c && c.trim()) vals.push(c.trim())
      })
      const v = vals.join(', ')
      if (v) setField(ctx, step.as, step.re ? applyRe(v, step) : v, step)
      return
    }
    case 'css': {
      if (!ctx.html || !step.selector) return
      const $ = cheerio.load(ctx.html)
      const vals: string[] = []
      $(step.selector).each((_i, el) => {
        const node = $(el)
        const a = step.attr ?? 'text'
        const raw = a === 'text' ? node.text().trim() : a === 'html' ? (node.html() ?? '').trim() : (node.attr(a) ?? '').trim()
        if (raw) vals.push(step.re ? applyRe(raw, step) : raw)
      })
      const v = step.multi ? vals.filter(Boolean).slice(0, 80).join(', ') : (vals[0] ?? '')
      if (v) setField(ctx, step.as, v, step)
      return
    }
    case 'json': {
      if (ctx.json == null || !step.path) return
      const v = dotPath(ctx.json, step.path)
      if (v == null) return
      const s = Array.isArray(v) ? v.map(String).join(', ') : String(v)
      if (s) setField(ctx, step.as, step.re ? applyRe(s, step) : s, step)
      return
    }
    case 'jsonraw': {
      if (ctx.json == null || !step.path) return
      const v = dotPath(ctx.json, step.path)
      if (v == null) return
      setField(ctx, step.as, JSON.stringify(v), step)
      return
    }
    case 'jsonlist': {
      if (ctx.json == null || !step.path || !step.map) return
      const arr = dotPath(ctx.json, step.path)
      if (!Array.isArray(arr)) return
      for (const item of arr.slice(0, 20)) {
        const row: Record<string, string> = {}
        for (const [field, itemPath] of Object.entries(step.map)) {
          const v = dotPath(item, itemPath)
          if (v != null) row[field] = Array.isArray(v) ? v.map(String).join(', ') : String(v)
        }
        if (row.title) ctx.results.push(step.rowTransform ? (runTransform(row, step.rowTransform) as Record<string, string>) : row)
      }
      return
    }
    case 'regex': {
      const input = (step.from ? ctx.fields[step.from] : ctx.html) ?? ''
      const v = applyRe(input, step)
      if (v) setField(ctx, step.as, v, step)
      return
    }
    case 'template': {
      if (step.as && step.value) setField(ctx, step.as, fill(step.value, ctx), step)
      return
    }
    case 'download': {
      const target = fill(step.url ?? '{url}', ctx)
      const { buf, type } = await httpGet(target, 30000)
      const head = Buffer.from(buf.slice(0, 5)).toString('latin1')
      if (!head.startsWith('%PDF') && !type.includes('pdf')) return // 非 PDF（如机构墙页）就放弃附件
      const file = path.join(app.getPath('temp'), `cspaper-dl-${Date.now()}.pdf`)
      fs.writeFileSync(file, Buffer.from(buf))
      ctx.pdfPath = file
      return
    }
  }
}

// transform 沙箱：无 require/process/fetch，只有字段对象 t，200ms 超时熔断
function runTransform(fields: Record<string, string>, code: string): Record<string, string> {
  try {
    const sandbox: Record<string, unknown> = { t: { ...fields } }
    vm.createContext(sandbox)
    const v = vm.runInContext(`(function(t){ "use strict"; ${code}\n })(t)`, sandbox, { timeout: 200 })
    if (v && typeof v === 'object') {
      const out: Record<string, string> = { ...fields }
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (val == null) delete out[k]
        else out[k] = String(val)
      }
      return out
    }
    return fields
  } catch {
    return fields // 脚本转换失败按原字段继续
  }
}

const TYPE_MAP: Record<string, string> = {
  'journal-article': 'article-journal',
  journalArticle: 'article-journal',
  'proceedings-article': 'paper-conference',
  conferencePaper: 'paper-conference',
  book: 'book',
  bookChapter: 'chapter',
  thesis: 'thesis',
  report: 'report',
  dataset: 'dataset',
  preprint: 'article'
}

export function fieldsToCsl(fields: Record<string, string>, sourceUrl: string, translator: string): Record<string, unknown> {
  const year = parseInt(fields.year ?? '', 10)
  const authors = (fields.authors ?? '')
    .split(/[,;，；]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 60)
    .map((name) => {
      if (/[\u4e00-\u9fff]/.test(name)) return { literal: name }
      const parts = name.split(/\s+/)
      if (parts.length < 2) return { literal: name }
      const family = parts[parts.length - 1]
      return { family, given: parts.slice(0, -1).join(' ') }
    })
  const csl: Record<string, unknown> = {
    id: fields.doi || sourceUrl || translator,
    type: TYPE_MAP[fields.itemType ?? ''] ?? 'article-journal',
    title: fields.title ?? '',
    author: authors,
    ...(Number.isFinite(year) && year > 1000 ? { issued: { 'date-parts': [[year]] } } : {}),
    ...(fields.venue ? { 'container-title': fields.venue } : {}),
    ...(fields.doi ? { DOI: fields.doi } : {}),
    ...(fields.url || sourceUrl ? { URL: fields.url || sourceUrl } : {}),
    ...(fields.abstract ? { abstract: fields.abstract } : {}),
    ...(fields.volume ? { volume: fields.volume } : {}),
    ...(fields.issue ? { issue: fields.issue } : {}),
    ...(fields.pages ? { page: fields.pages } : {}),
    ...(fields.publisher ? { publisher: fields.publisher } : {}),
    ...(fields.language ? { language: fields.language } : {})
  }
  return csl
}

// 执行 web 型脚本：抓页面 → 抽字段 → CSL-JSON（可选 PDF 附件）
export async function runWeb(script: TranslatorScript, url: string): Promise<TranslateResult> {
  const ctx: ExecCtx = { url, html: '', json: null, fields: {}, results: [] }
  for (const step of script.steps) {
    try {
      await applyStep(step, ctx)
    } catch (err) {
      // 单步失败不中断：页面结构差异时后续步骤可能仍能取到别的字段
      console.warn(`[translator:${script.id}] step ${step.op} 失败:`, String(err).slice(0, 160))
    }
  }
  const fields = script.transform ? runTransform(ctx.fields, script.transform) : ctx.fields
  if (!fields.title) return { ok: false, translator: script.id, error: '未抓到标题（页面结构可能已变化，或需要登录）' }
  return { ok: true, translator: script.id, csl: fieldsToCsl(fields, url, script.id), pdfPath: ctx.pdfPath }
}

// 执行 search 型脚本：检索词 → 结果列表（CSL-JSON 数组）
export async function runSearch(script: TranslatorScript, q: string): Promise<SearchHit[]> {
  const ctx: ExecCtx = { url: '', q, html: '', json: null, fields: {}, results: [] }
  for (const step of script.steps) {
    try {
      await applyStep(step, ctx)
    } catch (err) {
      console.warn(`[translator:${script.id}] search step ${step.op} 失败:`, String(err).slice(0, 160))
    }
  }
  return ctx.results.map((r) => {
    const csl = fieldsToCsl(r, r.url ?? '', script.id)
    return { ...csl, translator: script.name, translatorId: script.id }
  })
}

// 全部启用的 search 型脚本并行检索（单源失败不影响其他源）
export async function searchAll(q: string): Promise<SearchHit[]> {
  const disabled = new Set(disabledIds())
  const scripts = listScripts().filter((s) => (s.type ?? 'web') === 'search' && !disabled.has(s.id))
  const settled = await Promise.allSettled(scripts.map((s) => runSearch(s, q)))
  const out: SearchHit[] = []
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') out.push(...r.value)
    else console.warn(`[translator:${scripts[i].id}] 检索失败:`, String(r.reason).slice(0, 160))
  })
  return out
}

// DOI 智能识别：字符串里含 10.xxxx/yyy 时给出 doi.org 链接（在线添加框用）
export function extractDoi(text: string): string | null {
  const m = text.match(/10\.\d{4,9}\/[^\s"）)]+/i)
  return m ? m[0].replace(/[.,;]$/, '') : null
}

// arXiv ID 识别：2501.01234 或 arXiv:2501.01234
export function extractArxivId(text: string): string | null {
  const m = text.match(/(\d{4}\.\d{4,5})(v\d+)?/i)
  return m ? m[0] : null
}

// ---------- 导入管线 ----------
export interface ImportTranslatedPayload {
  csl: Record<string, unknown>
  pdfPath?: string
  category?: string
  origin?: string // 来源说明（如 arXiv 链接），写入 md
}

// 把 translator 抓到的题录导入库：
// 有 PDF 走 importPapers（指纹去重 + AI 归类共用链），无 PDF 生成题录占位页；
// 两种路径都会把完整 CSL-JSON 写进 <slug>.csl.json 侧车文件（引文引擎/详情面板用）。
export async function importTranslated(
  payload: ImportTranslatedPayload,
  send: (ev: string, p: unknown) => void
): Promise<{ ok: boolean; slug?: string; error?: string }> {
  const { importPapers } = await import('./import')
  const csl = payload.csl
  const title = String(csl.title ?? '未命名文献').slice(0, 300)
  const authors = ((csl.author ?? []) as Array<{ given?: string; family?: string; literal?: string }>)
    .map((a) => a.literal ?? [a.given, a.family].filter(Boolean).join(' '))
    .join(', ')
  const year = ((csl.issued ?? {}) as { 'date-parts'?: number[][] })['date-parts']?.[0]?.[0] ?? null
  const venue = Array.isArray(csl['container-title']) ? String(csl['container-title'][0] ?? '') : String(csl['container-title'] ?? '')
  const doi = typeof csl.DOI === 'string' ? csl.DOI : undefined

  try {
    let slug: string
    if (payload.pdfPath && fs.existsSync(payload.pdfPath)) {
      const outcomes = await importPapers([{ path: payload.pdfPath, category: payload.category, meta: { title, authors, year, venue } }], send)
      const hit = outcomes.find((o) => o.ok && o.slug && !o.skipped) ?? outcomes.find((o) => o.ok)
      if (!hit?.slug) return { ok: false, error: hit?.error ?? '导入失败' }
      slug = hit.slug
    } else {
      // 无 PDF：题录占位（复用题录导入管线）
      const { importRecords } = await import('./records')
      const oc = await importRecords([{ title, authors, year, venue, doi: doi ?? '', abstract: typeof csl.abstract === 'string' ? csl.abstract : '' }], payload.category || 'inbox', send)
      const hit = oc.find((o) => o.ok && o.slug)
      if (!hit?.slug) return { ok: false, error: hit?.error ?? '题录入库失败' }
      slug = hit.slug
    }
    // 侧车文件 + DB 元数据列（详情面板/引文引擎优先用完整 CSL）
    try {
      const s = getSettings()
      const row = getDb().prepare('SELECT id, path FROM papers WHERE slug=?').get(slug) as { id: number; path: string } | undefined
      if (row) {
        const dir = path.dirname(row.path)
        fs.writeFileSync(path.join(dir, `${slug}.csl.json`), JSON.stringify(csl, null, 2))
        const origin = payload.origin ? `\n> 来源：${payload.origin}\n` : ''
        getDb()
          .prepare('UPDATE papers SET csl=?, doi=COALESCE(NULLIF(?,""), doi), abstract=?, item_type=? WHERE id=?')
          .run(JSON.stringify(csl), doi ?? '', typeof csl.abstract === 'string' ? csl.abstract.slice(0, 4000) : null, String(csl.type ?? ''), row.id)
        // 来源说明追加进 md（扫描不会覆盖正文区）
        if (origin) {
          const mdPath = path.join(dir, `${slug}.md`)
          if (fs.existsSync(mdPath)) fs.appendFileSync(mdPath, origin)
        }
      }
    } catch (err) {
      console.warn('[translator] 侧车写入失败:', String(err))
    }
    return { ok: true, slug }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}
