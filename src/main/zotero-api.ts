// Zotero Web API v3 同步（v0.9）：userId + apiKey 直连 api.zotero.org。
// 分页（limit=100 + Total-Results）、429 退避、Last-Modified-Version → since= 增量游标（存 meta 表）。
// 采集：条目 + 分类映射 + 标签 + 子笔记 + **PDF 标注**（children 端点）+ CSL-JSON + stored PDF 附件下载（限速）。
// 落地复用导入管线（分类/eqKey 去重/noteMd 增强 +doi 与「Zotero 标注」段/无 PDF 题录占位页）。
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { getSettings, getMeta, setMeta, scanLibrary } from './db'
import { sanitizeCategoryName, findCategoryDir, nextCategoryDir } from './import'
import { createPlaceholderPdf } from './records'

const API = 'https://api.zotero.org'
const API_VERSION = '3'

export interface ZoteroApiStatus {
  configured: boolean
  lastSyncVersion: number | null
  lastSyncAt: string | null
}

export function apiStatus(): ZoteroApiStatus {
  const s = getSettings()
  return {
    configured: !!s.zoteroUserId && !!s.zoteroApiKey,
    lastSyncVersion: getMeta('zotero.syncVersion') ? parseInt(getMeta('zotero.syncVersion')!) : null,
    lastSyncAt: getMeta('zotero.lastSyncAt')
  }
}

// ---------- HTTP ----------
async function zotFetch(userId: string, apiKey: string, sub: string, params: URLSearchParams = new URLSearchParams()): Promise<{ json: unknown; headers: Headers }> {
  const url = `${API}/users/${encodeURIComponent(userId)}/${sub}${params.has('?') ? '' : ''}`
  const u = new URL(url)
  for (const [k, v] of params) u.searchParams.set(k, v)
  let attempt = 0
  for (;;) {
    attempt++
    const resp = await fetch(u, {
      headers: { 'Zotero-API-Version': API_VERSION, Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30000)
    })
    if (resp.status === 429 && attempt <= 5) {
      // 限流退避（Mimir 经验）：优先 Retry-After，否则指数等待
      const wait = parseInt(resp.headers.get('retry-after') ?? '', 10) || Math.min(30000, 1500 * 2 ** attempt)
      await new Promise((r) => setTimeout(r, wait))
      continue
    }
    if (resp.status === 304) return { json: [], headers: resp.headers }
    if (!resp.ok) {
      const body = await resp.text().catch(() => '')
      if (resp.status === 403 || resp.status === 401) throw new Error(`鉴权失败（${resp.status}）：请检查 userId / apiKey 是否匹配`)
      throw new Error(`Zotero API ${resp.status}：${body.slice(0, 160)}`)
    }
    return { json: await resp.json(), headers: resp.headers }
  }
}

export async function verifyApi(userId: string, apiKey: string): Promise<{ ok: boolean; error?: string; items?: number }> {
  try {
    const { json, headers } = await zotFetch(userId, apiKey, 'items', new URLSearchParams({ limit: '1' }))
    const total = parseInt(headers.get('total-results') ?? '0', 10)
    void json
    return { ok: true, items: total }
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 200) }
  }
}

// ---------- API 条目 → 内部形状 ----------
interface ApiChild {
  key: string
  data: { itemType: string; note?: string; annotationType?: string; annotationText?: string; annotationComment?: string; annotationPosition?: string; contentType?: string; linkMode?: string; filename?: string }
}
interface ApiItem {
  key: string
  data: {
    itemType: string
    title?: string
    abstractNote?: string
    date?: string
    publicationTitle?: string
    proceedingsTitle?: string
    bookTitle?: string
    publisher?: string
    DOI?: string
    url?: string
    language?: string
    tags?: Array<{ tag: string }>
    collections?: string[]
    creators?: Array<{ creatorType: string; firstName?: string; lastName?: string; name?: string }>
    [k: string]: unknown
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h\d|li)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// 解析 annotationPosition 里的页码（JSON：{"pageIndex":0,"pageIndexes":[0]} → 用 pageIndex+1）
function pageOf(pos: string | undefined): number | null {
  try {
    const j = JSON.parse(pos ?? '{}') as { pageIndex?: number }
    return typeof j.pageIndex === 'number' ? j.pageIndex + 1 : null
  } catch {
    return null
  }
}

// ---------- 同步 ----------
export interface SyncOptions {
  mode: 'full' | 'incremental'
  downloadPdf?: boolean // 默认 true：stored 附件下载到条目目录
  onProgress?: (p: { done: number; total: number; current: string }) => void
}

export interface SyncResult {
  ok: boolean
  error?: string
  fetched: number
  imported: number
  skipped: number
  failed: number
  version: number | null
}

const eqKey = (dirName: string, key: string): boolean => dirName.toLowerCase().endsWith(`-${key.toLowerCase()}`)
function findDupAcrossDirs(libPapers: string, key: string): string | null {
  try {
    for (const cat of fs.readdirSync(libPapers)) {
      const catDir = path.join(libPapers, cat)
      if (!fs.statSync(catDir).isDirectory()) continue
      for (const slug of fs.readdirSync(catDir)) {
        if (eqKey(slug, key)) return path.join(catDir, slug)
      }
    }
  } catch { /* ignore */ }
  return null
}

export async function syncZotero(opts: SyncOptions): Promise<SyncResult> {
  const s = getSettings()
  const userId = s.zoteroUserId?.trim()
  const apiKey = s.zoteroApiKey?.trim()
  const res: SyncResult = { ok: false, fetched: 0, imported: 0, skipped: 0, failed: 0, version: null }
  if (!userId || !apiKey) {
    res.error = '请先在设置里填写 Zotero userId 与 apiKey'
    return res
  }
  const downloadPdf = opts.downloadPdf !== false
  const libPapers = path.join(s.libraryPath, 'papers')
  fs.mkdirSync(libPapers, { recursive: true })

  // 1) 分类映射
  let collections: Array<{ key: string; data: { name: string } }> = []
  try {
    const r = await zotFetch(userId, apiKey, 'collections', new URLSearchParams({ limit: '100' }))
    collections = r.json as typeof collections
  } catch (err) {
    res.error = String(err).slice(0, 200)
    return res
  }
  const collName = new Map(collections.map((c) => [c.key, sanitizeCategoryName(c.data.name) || 'inbox']))

  // 2) 顶层条目（增量/全量）
  const params = new URLSearchParams({ limit: '100', format: 'json', itemType: '-attachment' })
  const since = opts.mode === 'incremental' ? getMeta('zotero.syncVersion') : null
  if (since) params.set('since', since)
  let start = 0
  let version: number | null = null
  const items: ApiItem[] = []
  for (;;) {
    params.set('start', String(start))
    let headers: Headers
    let page: ApiItem[]
    try {
      const r = await zotFetch(userId, apiKey, 'items', params)
      headers = r.headers
      page = r.json as ApiItem[]
    } catch (err) {
      res.error = String(err).slice(0, 200)
      return res
    }
    version = parseInt(headers.get('last-modified-version') ?? '0', 10) || version
    items.push(...page)
    opts.onProgress?.({ done: items.length, total: Math.max(items.length, parseInt(headers.get('total-results') ?? '0', 10)), current: '拉取条目' })
    if (page.length < 100) break
    start += 100
  }
  res.fetched = items.length

  const upsertDir = (catName: string): string => {
    const dir = catName === 'inbox' ? path.join(libPapers, '99-inbox') : findCategoryDir(libPapers, catName)
    const d = dir ?? nextCategoryDir(libPapers, catName)
    fs.mkdirSync(d, { recursive: true })
    return d
  }

  // 3) 逐条落地
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    const title = (it.data.title || it.data.bookTitle || '').replace(/\s+/g, ' ').trim()
    opts.onProgress?.({ done: i + 1, total: items.length, current: title })
    if (!title) continue
    try {
      const collectionsOf = (it.data.collections ?? []).map((k) => collName.get(k)).filter(Boolean) as string[]
      const catName = collectionsOf[0] || 'inbox'
      const dir = upsertDir(catName)
      const existing = fs.existsSync(dir) ? fs.readdirSync(dir).find((d) => eqKey(d, it.key))
        : (fs.existsSync(libPapers) ? findDupAcrossDirs(libPapers, it.key) : undefined)
      if (existing) {
        res.skipped++
        continue
      }
      const year = parseInt((it.data.date ?? '').match(/(19|20)\d{2}/)?.[0] ?? '', 10) || null
      const venue = it.data.publicationTitle || it.data.proceedingsTitle || it.data.bookTitle || it.data.publisher || ''
      const authors = (it.data.creators ?? [])
        .map((c) => c.name || `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim())
        .filter(Boolean)
        .join(', ')
      const tags = (it.data.tags ?? []).map((t) => t.tag.trim()).filter(Boolean)
      const doi = it.data.DOI || ''
      const abstract = stripHtml(it.data.abstractNote ?? '')

      // 3a) children：子笔记 + 标注 + 附件
      let notes: string[] = []
      let annotations: Array<{ page: number | null; text: string; comment: string }> = []
      let pdfKey: string | null = null
      let pdfName = 'paper.pdf'
      try {
        // children 分页拉取（超 100 条标注/笔记时全量采集）
        let children: ApiChild[] = []
        let cStart = 0
        for (;;) {
          const cParams = new URLSearchParams({ limit: '100', start: String(cStart) })
          const cr = await zotFetch(userId, apiKey, `items/${it.key}/children`, cParams)
          const page = cr.json as ApiChild[]
          children.push(...page)
          if (page.length < 100) break
          cStart += 100
        }
        const r = { json: children }
        for (const ch of children) {
          const d = ch.data
          if (d.itemType === 'note' && d.note) notes.push(stripHtml(d.note))
          else if (d.itemType === 'annotation' && d.annotationType === 'highlight' && d.annotationText)
            annotations.push({ page: pageOf(d.annotationPosition), text: stripHtml(d.annotationText), comment: stripHtml(d.annotationComment ?? '') })
          else if (d.itemType === 'attachment' && d.contentType === 'application/pdf' && d.linkMode === 'imported_file') {
            pdfKey = ch.key
            if (d.filename) pdfName = d.filename
          }
        }
      } catch { /* children 拉取失败不阻塞条目落地 */ }

      // 3b) 目录 + slug + 去重后落地
      const slug = `${year ?? 'nd'}-${it.key.toLowerCase()}`
      const dest = path.join(dir, slug)
      fs.mkdirSync(dest, { recursive: true })

      // PDF：stored 附件下载；拿不到就题录占位
      let hasPdf = false
      if (downloadPdf && pdfKey) {
        try {
          const u = `${API}/users/${encodeURIComponent(userId)}/items/${pdfKey}/file`
          const resp = await fetch(u, { headers: { 'Zotero-API-Version': API_VERSION, Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(60000) })
          if (resp.ok) {
            const buf = Buffer.from(await resp.arrayBuffer())
            if (buf.length > 512 && buf.subarray(0, 4).toString('latin1') === '%PDF') {
              fs.writeFileSync(path.join(dest, 'paper.pdf'), buf)
              hasPdf = true
            }
          }
          await new Promise((r2) => setTimeout(r2, 300)) // 附件下载限速
        } catch { /* 下载失败走占位 */ }
      }
      if (!hasPdf) {
        try {
          fs.writeFileSync(
            path.join(dest, 'paper.pdf'),
            await createPlaceholderPdf({ title, authors, year, venue, doi, abstract })
          )
        } catch { /* 占位失败也不阻断 md */ }
      }

      // 3c) md（含 doi 与「Zotero 标注」段）
      const q = (v: string): string => v.replace(/"/g, "'")
      const tagLine = tags.length ? `tags: [${tags.map((t) => q(t)).join(', ')}]` : 'tags: [status/unread]'
      let md =
        `---\ntitle: "${q(title)}"\nauthors: "${q(authors)}"\nyear: ${year ?? 'null'}\nvenue: "${q(venue)}"\nzotero: "${it.key}"\n` +
        (doi ? `doi: "${q(doi)}"\n` : '') +
        `${tagLine}\nstatus: unread\n---\n\n# ${title}\n\n` +
        `- **作者:** ${authors || '（作者见原文）'}\n- **发表:** ${venue || `${year ?? ''}（待核实）`}\n` +
        (doi ? `- **DOI:** ${doi}\n` : '') +
        `- **来源:** Zotero 云端同步（key: ${it.key}）\n`
      if (abstract) md += `\n## 摘要\n\n${abstract}\n`
      if (tags.length) md += `\n## Zotero 标签\n\n${tags.map((t2) => `- ${t2}`).join('\n')}\n`
      for (const n of notes) md += `\n## Zotero 笔记\n\n${n}\n`
      if (annotations.length)
        md +=
          `\n## Zotero 标注（${annotations.length}）\n\n` +
          annotations.map((a) => `> ${a.page ? `（第 ${a.page} 页）` : ''}${a.text}${a.comment ? `\n\n备注：${a.comment}` : ''}`).join('\n\n') +
          '\n'
      fs.writeFileSync(path.join(dest, `${slug}.md`), md)

      // 3d) CSL-JSON：API 的 item.data 本身就是 Zotero JSON，转成 CSL 兼容侧车（引文引擎优先用）
      try {
        const csl = {
          id: it.key,
          type: String(it.data.itemType ?? 'journalArticle'),
          title,
          author: (it.data.creators ?? []).map((c) => (c.name ? { literal: c.name } : { family: c.lastName ?? '', given: c.firstName ?? '' })),
          ...(year ? { issued: { 'date-parts': [[year]] } } : {}),
          ...(venue ? { 'container-title': venue } : {}),
          ...(doi ? { DOI: doi } : {}),
          ...(it.data.url ? { URL: it.data.url } : {}),
          ...(abstract ? { abstract } : {})
        }
        fs.writeFileSync(path.join(dest, `${slug}.csl.json`), JSON.stringify(csl, null, 2))
      } catch { /* 侧车失败不影响条目 */ }

      res.imported++
    } catch {
      res.failed++
    }
  }

  if (version) setMeta('zotero.syncVersion', String(version))
  setMeta('zotero.lastSyncAt', new Date().toLocaleString('zh-CN'))
  scanLibrary(s.libraryPath)
  res.ok = true
  res.version = version
  return res
}

export function zoteroDataDirHint(): string {
  return path.join(app.getPath('appData'), 'Zotero')
}
