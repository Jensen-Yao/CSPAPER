import { normalizePath, notesFromMarkdown, paperFiles, patchFrontmatter, readPaperMarkdown, replaceMarkdownNotes, writeFilesAtomically } from './paper-files'
// Zotero Web API v3 同步（v0.9）：userId + apiKey 直连 api.zotero.org。
// 分页（limit=100 + Total-Results）、429 退避、Last-Modified-Version → since= 增量游标（存 meta 表）。
// 采集：条目 + 分类映射 + 标签 + 子笔记 + **PDF 标注**（children 端点）+ CSL-JSON + stored PDF 附件下载（限速）。
// 落地复用导入管线（分类/eqKey 去重/noteMd 增强 +doi 与「Zotero 标注」段/无 PDF 题录占位页）。
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { getSettings, getMeta, setMeta, scanLibraryAsync } from './db'
import { sanitizeCategoryName, findCategoryDir, nextCategoryDir } from './import'
import { createPlaceholderPdf } from './records'

const API = 'https://api.zotero.org'
const API_VERSION = '3'
function syncKey():string { const s=getSettings();return 'zotero.syncVersion:'+s.zoteroUserId+':'+normalizePath(s.libraryPath) }

export interface ZoteroApiStatus {
  configured: boolean
  lastSyncVersion: number | null
  lastSyncAt: string | null
}

export function apiStatus(): ZoteroApiStatus {
  const s = getSettings()
  return {
    configured: !!s.zoteroUserId && !!s.zoteroApiKey,
    lastSyncVersion: getMeta(syncKey()) ? parseInt(getMeta(syncKey())!) : null,
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
  version?: number
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
  updated?: number
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
  const since = opts.mode === 'incremental' ? getMeta(syncKey()) : null
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
      const localName=fs.readdirSync(dir).find(d=>eqKey(d,it.key))
      const existing=localName?path.join(dir,localName):findDupAcrossDirs(libPapers,it.key)
      let isUpdate = false
      if (existing) {
        // upsert：远端版本更新则重写 md（此前永远 skip，Zotero 改了卷期页本地不变）
        try {
          const mdFile=path.basename(paperFiles(path.join(existing,'paper.pdf')).md)
          if (mdFile) {
            const raw = fs.readFileSync(path.join(existing, mdFile), 'utf8')
            const mVer = raw.match(/^zotero-version:\s*(\d+)/m)
            const localVer = mVer ? parseInt(mVer[1], 10) : 0
            if ((it.version ?? 0) > localVer) {
              isUpdate = true
              res.updated = (res.updated ?? 0) + 1
            } else {
              res.skipped++
              continue
            }
          } else {
            res.skipped++
            continue
          }
        } catch {
          res.failed++
          continue
        }
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
      } catch(error) { throw new Error('Zotero 子条目未完整获取：'+String(error)) }

      // 3b) 目录 + slug + 去重后落地
      const slug=existing?path.basename(existing):`${year ?? 'nd'}-${it.key.toLowerCase()}`
      const dest = existing ?? path.join(dir, slug)
      fs.mkdirSync(dest, { recursive: true })

      // PDF：stored 附件下载；拿不到就题录占位（更新时保留本地已有 PDF，不重下）
      let hasPdf = false
      if (isUpdate && fs.existsSync(path.join(dest, 'paper.pdf'))) {
        hasPdf = true
      }
      if (!isUpdate && downloadPdf && pdfKey) {
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
        `zotero-version: ${it.version ?? 0}
` +
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
      const doc=readPaperMarkdown(path.join(dest,'paper.pdf'),slug)
      const localNotes=notesFromMarkdown(doc.raw)
      if(localNotes) md=replaceMarkdownNotes(md,localNotes)
      md=patchFrontmatter(md,{source_kind:hasPdf?'pdf':'record',doi,abstract,volume:it.data.volume??'',issue:it.data.issue??'',pages:it.data.pages??'',publisher:it.data.publisher??'',language:it.data.language??''})
      writeFilesAtomically([{path:doc.path,content:md}])

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
          ...(abstract?{abstract}:{}),volume:it.data.volume,issue:it.data.issue,page:it.data.pages,publisher:it.data.publisher,language:it.data.language
        }
        fs.writeFileSync(path.join(dest, `${slug}.csl.json`), JSON.stringify(csl, null, 2))
      } catch { /* 侧车失败不影响条目 */ }

      res.imported++
    } catch {
      res.failed++
    }
  }

  // 有失败项不推进增量游标：失败条目 version ≤ 新游标后 since= 增量永远漏拉
  if (version && res.failed === 0) setMeta(syncKey(),String(version))
  setMeta('zotero.lastSyncAt', new Date().toLocaleString('zh-CN'))
  await scanLibraryAsync(s.libraryPath)
  res.ok = res.failed === 0
  if(res.failed) res.error=`有 ${res.failed} 条文献未同步，已保留游标，请重试`
  res.version = version
  return res
}

export function zoteroDataDirHint(): string {
  return path.join(app.getPath('appData'), 'Zotero')
}


// ---------- 标注写回 Zotero（v0.15.2：本地高亮 → 远端 annotation 子条目） ----------
// 找到论文对应的 Zotero 条目 key（目录名 -key 后缀约定），把未写回过的高亮逐条 POST。
export async function pushHighlightsToZotero(paperId: number): Promise<{ pushed: number; itemKey: string | null }> {
  const db = (await import('./db')).getDb()
  const s = (await import('./db')).getSettings()
  const userId = s.zoteroUserId ?? ''
  const apiKey = s.zoteroApiKey ?? ''
  if (!userId || !apiKey) throw new Error('未配置 Zotero 用户 ID / API Key')
  const row = db.prepare('SELECT path, slug FROM papers WHERE id=?').get(paperId) as { path: string; slug: string } | undefined
  if (!row) throw new Error('论文不存在')
  const key = row.slug.match(/-([a-z0-9]{8})$/i)?.[1]
  if (!key) throw new Error('该文献不是 Zotero 同步来源（目录名无 -key 后缀），无法写回')
  // 已写回标记：tag=csl 写在 highlights.tag 列（写回过的存 zotero:<annotationKey>）
  const hls = db.prepare("SELECT id, page, text, color FROM highlights WHERE paper_id=? AND (tag IS NULL OR tag='' OR tag NOT LIKE 'zotero:%') ORDER BY id").all(paperId) as Array<{
    id: number
    page: number | null
    text: string
    color: string | null
  }>
  let pushed = 0
  const mark = db.prepare('UPDATE highlights SET tag=? WHERE id=?')
  for (const h of hls) {
    const body = {
      itemType: 'annotation',
      parentItem: key,
      annotationType: 'highlight',
      annotationText: h.text.slice(0, 2000),
      annotationColor: h.color === 'blue' ? '#4285f4' : h.color === 'green' ? '#46c882' : h.color === 'red' ? '#eb5050' : '#ffd200',
      annotationPageLabel: h.page != null ? String(h.page) : '',
      tags: []
    }
    try {
      const resp = await fetch(`${API}/users/${encodeURIComponent(userId)}/items`, {
        method: 'POST',
        headers: { 'Zotero-API-Version': API_VERSION, Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify([body]),
        signal: AbortSignal.timeout(30_000)
      })
      if (!resp.ok) continue
      const j = (await resp.json()) as { success?: Record<string, string>; successKeys?: string[] }
      const newKey = j.success?.['0'] ?? j.successKeys?.[0]
      mark.run(newKey ? `zotero:${newKey}` : 'zotero:sent', h.id)
      pushed++
      await new Promise((r) => setTimeout(r, 200)) // 限速
    } catch {
      break // 网络问题中止剩余（下次续传）
    }
  }
  return { pushed, itemKey: key }
}
