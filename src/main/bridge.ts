// 本地桥接服务：浏览器插件 / Word·WPS 插件 / 移动端与桌面端通信的 HTTP 接口。
// 安全模型（与 Zotero 客户端一致）：
// 1) 只绑定 127.0.0.1，外部设备不可达；
// 2) POST 一律要求 Content-Type: application/json（跨站表单/简单请求发不出来，
//    跨域 JSON 请求会被浏览器预检拦截——本服务不回 OPTIONS，恶意网页无法注入）；
// 3) 不返回 CORS 头，任何网页都读不到响应内容。
import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { app } from 'electron'
import { getDb, getSettings } from './db'
import { importPapers, crossrefMeta } from './import'
import { gbt7714, bibtex, type CiteRecord } from './cite'
import { CITE_UI_HTML, WORD_TASKPANE_HTML } from './citeui'

export const BRIDGE_PORT = 24517

let server: http.Server | null = null

export function bridgeStatus(): { running: boolean; port: number; version: string } {
  return { running: !!server, port: BRIDGE_PORT, version: app.getVersion() }
}

export function startBridge(notify: (title: string, detail: string) => void): void {
  if (server) return
  server = http.createServer((req, res) => {
    void handle(req, res, notify).catch(() => {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'internal error' }))
    })
  })
  server.on('error', () => {
    server = null // 端口被占等情况：静默降级，插件功能不可用但不影响主程序
  })
  server.listen(BRIDGE_PORT, '127.0.0.1')
}

export function stopBridge(): void {
  server?.close()
  server = null
}

function json(res: http.ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = ''
    req.on('data', (c: Buffer) => {
      buf += c.toString('utf8')
      if (buf.length > 20 * 1024 * 1024) reject(new Error('body too large'))
    })
    req.on('end', () => resolve(buf))
    req.on('error', reject)
  })
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse, notify: (title: string, detail: string) => void): Promise<void> {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${BRIDGE_PORT}`)
  const db = getDb()

  // 插件探测：GET /ping
  if (req.method === 'GET' && url.pathname === '/ping') {
    const n = (db.prepare('SELECT COUNT(*) AS n FROM papers').get() as { n: number }).n
    return json(res, 200, { ok: true, name: 'CSPAPER', version: app.getVersion(), papers: n })
  }

  // 引文助手页面（Word / WPS 插引文用）：GET /cite-ui
  if (req.method === 'GET' && url.pathname === '/cite-ui') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    return void res.end(CITE_UI_HTML)
  }

  // Word 加载项任务窗格：GET /word-taskpane
  if (req.method === 'GET' && url.pathname === '/word-taskpane') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    return void res.end(WORD_TASKPANE_HTML)
  }

  // 文献检索（Word/WPS 插件插引文用）：GET /papers?q=关键词&limit=20
  if (req.method === 'GET' && url.pathname === '/papers') {
    const q = (url.searchParams.get('q') ?? '').trim()
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 50)
    const rows = q
      ? db
          .prepare('SELECT id, title, authors, year, venue, category FROM papers WHERE title LIKE ? OR authors LIKE ? OR venue LIKE ? ORDER BY opened_at DESC LIMIT ?')
          .all(...Array<string>(3).fill(`%${q}%`), limit)
      : (db.prepare('SELECT id, title, authors, year, venue, category FROM papers ORDER BY opened_at DESC LIMIT ?').all(limit) as unknown[])
    return json(res, 200, { ok: true, papers: rows })
  }

  // 生成引文：GET /cite?ids=1,2&style=gbt7714|bibtex
  if (req.method === 'GET' && url.pathname === '/cite') {
    const ids = (url.searchParams.get('ids') ?? '')
      .split(',')
      .map((s) => parseInt(s, 10))
      .filter((n) => !isNaN(n))
    if (ids.length === 0) return json(res, 400, { ok: false, error: 'ids required' })
    const rows = ids
      .map((id) =>
        db.prepare('SELECT id, title, authors, year, venue FROM papers WHERE id=?').get(id) as
          | { id: number; title: string; authors: string; year: number | null; venue: string }
          | undefined
      )
      .filter((r): r is { id: number; title: string; authors: string; year: number | null; venue: string } => !!r)
      .map((r) => ({ ...r, itemType: 'journalArticle' }) as CiteRecord)
    if (url.searchParams.get('style') === 'bibtex') {
      return json(res, 200, { ok: true, text: rows.map((r) => bibtex(r)).join('\n\n') })
    }
    return json(res, 200, { ok: true, text: rows.map((r, i) => gbt7714(r, i + 1)).join('\n') })
  }

  // 一键存入：POST /save-paper（浏览器插件调用）
  if (req.method === 'POST' && url.pathname === '/save-paper') {
    if (!/application\/json/i.test(String(req.headers['content-type'] ?? ''))) {
      return json(res, 415, { ok: false, error: 'content-type must be application/json' })
    }
    let body: {
      pdfUrl?: string
      title?: string
      authors?: string
      year?: number | null
      venue?: string
      doi?: string
      category?: string
      source?: string
    }
    try {
      body = JSON.parse(await readBody(req))
    } catch {
      return json(res, 400, { ok: false, error: 'invalid json' })
    }
    const pdfUrl = resolvePdfUrl(body.pdfUrl ?? '')
    if (!pdfUrl) {
      return json(res, 422, { ok: false, error: '未找到可直接下载的 PDF 链接（CNKI 等站点请先下载 PDF 再拖入 CSPAPER）' })
    }
    let tmpFile = ''
    try {
      const resp = await fetch(pdfUrl, {
        signal: AbortSignal.timeout(60_000),
        headers: { 'User-Agent': 'Mozilla/5.0 CSPAPER-Connector' }
      })
      if (!resp.ok) throw new Error(`PDF 下载失败 HTTP ${resp.status}`)
      const buf = Buffer.from(await resp.arrayBuffer())
      if (buf.length < 1024) throw new Error('PDF 下载内容为空')
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cspaper-bridge-'))
      tmpFile = path.join(dir, 'paper.pdf')
      fs.writeFileSync(tmpFile, buf)
    } catch (err) {
      return json(res, 502, { ok: false, error: String(err).slice(0, 200) })
    }
    // 有 DOI 但缺标题：用 Crossref 权威元数据补全
    let meta = {
      title: body.title || '',
      authors: body.authors || '',
      year: body.year ?? null,
      venue: body.venue || ''
    }
    if (body.doi && (!meta.title || !meta.authors)) {
      const m = await crossrefMeta(body.doi)
      if (m) {
        meta = { ...meta, title: meta.title || m.title, authors: meta.authors || m.authors, year: meta.year ?? m.year, venue: meta.venue || m.venue }
      }
    }
    const outcomes = await importPapers(
      [{ path: tmpFile, category: body.category || 'inbox', meta }],
      () => {}
    )
    const ok = outcomes[0]?.ok
    if (ok) notify('已从浏览器保存文献', `${outcomes[0].title ?? ''}（来源：${body.source ?? '浏览器插件'}）`)
    return json(res, ok ? 200 : 500, { ok, outcome: outcomes[0] })
  }

  json(res, 404, { ok: false, error: 'not found' })
}

// 常见阅读页 → PDF 直链
function resolvePdfUrl(url: string): string {
  const u = url.trim()
  if (!u) return ''
  const arxiv = u.match(/arxiv\.org\/(?:abs|pdf)\/([^\s?#]+?)(?:\.pdf)?(?:[?#].*)?$/i)
  if (arxiv) return `https://arxiv.org/pdf/${arxiv[1]}.pdf`
  return /\.pdf(\?|#|$)/i.test(u) || /\/pdf\//i.test(u) ? u : ''
}
