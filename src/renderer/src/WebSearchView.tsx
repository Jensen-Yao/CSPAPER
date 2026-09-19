// 内置学术搜索引擎（v0.7.1）：
// 起始页 = 大搜索框 +「聚合检索」（免 Key 学术 API 原生结果列表，可一键入库）+ 站点直达检索（关键词拼进各站搜索 URL）；
// web 模式 = <webview>（persist:cspaper-web 分区，主进程已装 CSPAPER Connector 扩展 + PDF 下载自动入库）。
import { useEffect, useRef, useState } from 'react'
import type { WebviewTag } from 'electron'
import './websearch.css'

// <webview> 的 JSX 属性由 @types/react（WebViewHTMLAttributes）内置提供，无需自行声明

const HINT_KEY = 'ws.hintHidden'
const RECENT_KEY = 'ws.recent'

// 站点直达检索：关键词直接拼进该站的搜索结果页
const ENGINES: Array<{ label: string; host: string; home: string; search: (q: string) => string }> = [
  { label: '谷歌学术', host: 'scholar.google.com', home: 'https://scholar.google.com', search: (q) => `https://scholar.google.com/scholar?q=${encodeURIComponent(q)}` },
  { label: '知网', host: 'kns.cnki.net', home: 'https://kns.cnki.net', search: (q) => `https://kns.cnki.net/kns8s/defaultresult/index?kw=${encodeURIComponent(q)}&korder=SU` },
  { label: '万方', host: 'd.wanfangdata.com.cn', home: 'https://d.wanfangdata.com.cn', search: (q) => `https://s.wanfangdata.com.cn/paper?q=${encodeURIComponent(q)}` },
  { label: '百度学术', host: 'xueshu.baidu.com', home: 'https://xueshu.baidu.com', search: (q) => `https://xueshu.baidu.com/s?wd=${encodeURIComponent(q)}` },
  { label: 'arXiv', host: 'arxiv.org', home: 'https://arxiv.org', search: (q) => `https://arxiv.org/search/?query=${encodeURIComponent(q)}&searchtype=all` },
  { label: 'PubMed', host: 'pubmed.ncbi.nlm.nih.gov', home: 'https://pubmed.ncbi.nlm.nih.gov', search: (q) => `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(q)}` },
  { label: 'Semantic Scholar', host: 'www.semanticscholar.org', home: 'https://www.semanticscholar.org', search: (q) => `https://www.semanticscholar.org/search?q=${encodeURIComponent(q)}` },
  { label: 'X-MOL', host: 'www.x-mol.com', home: 'https://www.x-mol.com', search: (q) => `https://www.x-mol.com/search/q?option=${encodeURIComponent(q)}` }
]

interface AggHit {
  title: string
  authors: string
  year: number | null
  venue: string
  doi?: string
  url?: string
  abstract?: string
  source: string // 来源引擎名
  csl: Record<string, unknown>
}

// 地址栏输入 → 可导航 URL：已有协议原样，否则自动补 https://；像搜索词（含空格/中文且无点号）返回空交给搜索引擎
function normalizeUrl(raw: string): string {
  const s = raw.trim()
  if (!s) return ''
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s
  if (/^[\w.-]+\.[a-z]{2,}(\/|$|:\d)/i.test(s)) return 'https://' + s
  return '' // 不是 URL，是搜索词
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

type SaveState = { kind: 'idle' | 'busy' | 'ok' | 'err'; text: string; tip?: string }

export default function WebSearchView({ visible }: { visible: boolean }): JSX.Element | null {
  const webRef = useRef<WebviewTag | null>(null)
  const [mode, setMode] = useState<'home' | 'web'>('home')
  const [addr, setAddr] = useState('') // 地址栏内容（编辑中即草稿，导航事件后回写真实 URL）
  const [pageUrl, setPageUrl] = useState('') // 当前页真实 URL（保存/复制用它）
  const [pageTitle, setPageTitle] = useState('')
  const [loading, setLoading] = useState(false)
  const [canBack, setCanBack] = useState(false)
  const [canFwd, setCanFwd] = useState(false)
  const [save, setSave] = useState<SaveState>({ kind: 'idle', text: '保存此页' })
  const [copied, setCopied] = useState(false)
  const [toast, setToast] = useState('')
  const [hintOn, setHintOn] = useState(() => localStorage.getItem(HINT_KEY) !== '1')

  // 聚合检索状态
  const [q, setQ] = useState('')
  const [searching, setSearching] = useState(false)
  const [hits, setHits] = useState<AggHit[] | null>(null)
  const [searchErr, setSearchErr] = useState('')
  const [importedSlugs, setImportedSlugs] = useState<Record<number, string>>({})
  const [importing, setImporting] = useState<number | null>(null)
  const [recent, setRecent] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[]
    } catch {
      return []
    }
  })
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = (text: string): void => {
    setToast(text)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 2200)
  }

  // webview 事件不能用 React 合成事件，挂载后手动绑定（StrictMode 下依赖清理配对）
  useEffect(() => {
    const wv = webRef.current
    if (!wv) return
    const syncNav = (url?: string): void => {
      const u = url ?? wv.getURL()
      setAddr(u)
      setPageUrl(u)
      setCanBack(wv.canGoBack())
      setCanFwd(wv.canGoForward())
    }
    const onStart = (): void => setLoading(true)
    const onStop = (): void => {
      setLoading(false)
      syncNav()
    }
    const onNav = (e: Electron.DidNavigateEvent): void => syncNav(e.url)
    const onNavInPage = (e: Electron.DidNavigateInPageEvent): void => {
      if (e.isMainFrame) syncNav(e.url)
    }
    const onTitle = (e: Electron.PageTitleUpdatedEvent): void => setPageTitle(e.title)
    // 旧式弹窗事件：拦截外部新窗（allowpopups 未开时本就不弹），仅提示
    const onNewWindow = (e: Event): void => {
      e.preventDefault()
      showToast('已拦截弹窗')
    }
    wv.addEventListener('did-start-loading', onStart)
    wv.addEventListener('did-stop-loading', onStop)
    wv.addEventListener('did-navigate', onNav)
    wv.addEventListener('did-navigate-in-page', onNavInPage)
    wv.addEventListener('page-title-updated', onTitle)
    wv.addEventListener('new-window', onNewWindow as EventListener)
    return () => {
      wv.removeEventListener('did-start-loading', onStart)
      wv.removeEventListener('did-stop-loading', onStop)
      wv.removeEventListener('did-navigate', onNav)
      wv.removeEventListener('did-navigate-in-page', onNavInPage)
      wv.removeEventListener('page-title-updated', onTitle)
      wv.removeEventListener('new-window', onNewWindow as EventListener)
    }
  }, [])

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      if (copyTimer.current) clearTimeout(copyTimer.current)
      if (toastTimer.current) clearTimeout(toastTimer.current)
    },
    []
  )

  const nav = (raw: string): void => {
    const u = normalizeUrl(raw)
    if (!u) return
    setMode('web')
    setAddr(u)
    void webRef.current?.loadURL(u).catch(() => {})
  }

  // ---------- 聚合检索：Crossref / OpenAlex 等免 Key 学术 API（translators 检索型脚本） ----------
  const runAgg = (query: string): void => {
    const term = query.trim()
    if (!term) return
    setMode('home')
    setQ(term)
    setSearching(true)
    setHits(null)
    setSearchErr('')
    setImportedSlugs({})
    const next = [term, ...recent.filter((r) => r !== term)].slice(0, 8)
    setRecent(next)
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next))
    } catch {
      /* 忽略 */
    }
    void window.api
      .translatorsSearch(term)
      .then((raw) => {
        const hitsOut: AggHit[] = raw
          .map((h) => {
            const { translator, translatorId, ...csl } = h as Record<string, unknown> & { translator?: string; translatorId?: string }
            const year = ((csl.issued as { 'date-parts'?: number[][] } | undefined)?.['date-parts']?.[0]?.[0] ?? null) as number | null
            const authors = ((csl.author ?? []) as Array<{ given?: string; family?: string; literal?: string }>)
              .map((a) => a.literal ?? [a.given, a.family].filter(Boolean).join(' '))
              .slice(0, 6)
              .join(', ')
            const ct = csl['container-title']
            return {
              title: String(csl.title ?? ''),
              authors,
              year: typeof year === 'number' ? year : null,
              venue: Array.isArray(ct) ? String(ct[0] ?? '') : String(ct ?? ''),
              doi: typeof csl.DOI === 'string' ? csl.DOI : undefined,
              url: typeof csl.URL === 'string' ? csl.URL : undefined,
              abstract: typeof csl.abstract === 'string' ? csl.abstract : undefined,
              source: String(translator ?? '聚合'),
              csl: csl as Record<string, unknown>
            }
          })
          .filter((h) => h.title)
        setHits(hitsOut)
        if (hitsOut.length === 0) setSearchErr('没有检索到结果——换个关键词试试，或用下方站点直达在谷歌学术/知网里搜')
      })
      .catch((e) => setSearchErr(String(e).slice(0, 160)))
      .finally(() => setSearching(false))
  }

  // 地址栏回车：像 URL 就导航，否则当搜索词进聚合检索
  const addrGo = (): void => {
    const u = normalizeUrl(addr.trim())
    if (u) nav(u)
    else runAgg(addr.trim())
  }

  const importHit = async (i: number): Promise<void> => {
    if (importing !== null) return
    const h = hits?.[i]
    if (!h) return
    setImporting(i)
    try {
      const r = await window.api.translatorsImport({ csl: h.csl, category: 'inbox', origin: h.url })
      if (r.ok && r.slug) setImportedSlugs((m) => ({ ...m, [i]: r.slug! }))
      else showToast(r.error ?? '导入失败')
    } catch (e) {
      showToast(String(e).slice(0, 100))
    } finally {
      setImporting(null)
    }
  }

  const openHit = (h: AggHit): void => {
    const target = h.url || (h.doi ? `https://doi.org/${h.doi}` : '')
    if (target) nav(target)
    else showToast('该结果没有可打开的原文链接')
  }

  // 「保存此页」：主进程用抓取脚本抓当前页题录入库（matched=false 表示无脚本命中）
  const savePage = async (): Promise<void> => {
    if (save.kind === 'busy') return
    const url = pageUrl || webRef.current?.getURL() || ''
    if (!/^https?:\/\//i.test(url)) {
      setSave({ kind: 'err', text: '✗ 失败', tip: '当前没有可保存的网页' })
      armSaveReset()
      return
    }
    setSave({ kind: 'busy', text: '保存中…' })
    try {
      const r = await window.api.webSavePage(url)
      if (r.ok) {
        setSave({ kind: 'ok', text: '✓ 已入库', tip: r.translator ? `已由「${r.translator}」脚本抓取入库` : '已入库' })
      } else {
        setSave({ kind: 'err', text: '✗ 失败', tip: r.error ?? '保存失败' })
      }
    } catch (err) {
      setSave({ kind: 'err', text: '✗ 失败', tip: String(err).slice(0, 120) })
    }
    armSaveReset()
  }
  const armSaveReset = (): void => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => setSave({ kind: 'idle', text: '保存此页' }), 2600)
  }

  // 复制当前链接（代替「在系统浏览器打开」——链接进剪贴板，粘贴即开）
  const copyLink = async (): Promise<void> => {
    const url = pageUrl || webRef.current?.getURL() || ''
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      if (copyTimer.current) clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopied(false), 2000)
    } catch {
      showToast('复制失败')
    }
  }

  const closeHint = (): void => {
    setHintOn(false)
    localStorage.setItem(HINT_KEY, '1')
  }

  const activeHost = mode === 'web' ? hostOf(pageUrl) : ''
  const goHome = (): void => setMode('home')

  return (
    <div className={`ws-host ${visible ? '' : 'ws-hidden'}`}>
      {mode === 'web' && (
        <div className="ws-toolbar">
          <button className="ws-btn" title="后退" disabled={!canBack} onClick={() => webRef.current?.goBack()}>
            ←
          </button>
          <button className="ws-btn" title="前进" disabled={!canFwd} onClick={() => webRef.current?.goForward()}>
            →
          </button>
          <button className="ws-btn" title={loading ? '停止加载' : '刷新'} onClick={() => (loading ? webRef.current?.stop() : webRef.current?.reload())}>
            ⟳
          </button>
          <button className="ws-btn" title="回到学术搜索起始页" onClick={goHome}>
            ⌂
          </button>
          <input
            className="ws-addr"
            value={addr}
            spellCheck={false}
            placeholder="输入网址或搜索词，回车执行（网址自动补 https://）"
            title={pageTitle || pageUrl || undefined}
            onChange={(e) => setAddr(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                addrGo()
                ;(e.target as HTMLInputElement).blur()
              }
              if (e.key === 'Escape') setAddr(pageUrl)
            }}
          />
          <button
            className={`ws-save ${save.kind}`}
            disabled={save.kind === 'busy'}
            title={save.kind === 'err' ? save.tip : save.kind === 'ok' ? save.tip : '用抓取脚本抓取当前页题录并入库（有 PDF 会一并下载）'}
            onClick={() => void savePage()}
          >
            {save.text}
          </button>
          <button className="ws-copy" title="复制当前链接到剪贴板，可在系统浏览器中粘贴打开" onClick={() => void copyLink()}>
            {copied ? '✓ 已复制' : '在浏览器打开'}
          </button>
        </div>
      )}

      {mode === 'web' && (
        <div className="ws-chips">
          {ENGINES.map((s) => (
            <button key={s.host} className={`ws-chip ${activeHost === s.host ? 'on' : ''}`} title={`${s.label} 检索`} onClick={() => nav(s.home)}>
              {s.label}
            </button>
          ))}
        </div>
      )}

      {mode === 'home' && (
        <div className="ws-home">
          <div className="ws-logo">
            <span className="ws-logo-mark">C</span>
            <span className="ws-logo-text">CSPAPER 学术搜索</span>
          </div>
          <div className="ws-search">
            <input
              className="ws-search-input"
              value={q}
              autoFocus
              spellCheck={false}
              placeholder="输入标题 / 关键词 / DOI，聚合检索多个学术源"
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') runAgg(q)
              }}
            />
            <button className="ws-search-go" onClick={() => runAgg(q)}>
              聚合检索
            </button>
          </div>
          <div className="ws-engines">
            <span className="ws-engines-label">站点直达：</span>
            {ENGINES.map((s) => (
              <button key={s.host} className="ws-chip" title={`在 ${s.label} 搜索「${q || '…'}」`} onClick={() => (q.trim() ? nav(s.search(q.trim())) : nav(s.home))}>
                {s.label}
              </button>
            ))}
          </div>
          {recent.length > 0 && hits === null && !searching && (
            <div className="ws-recent">
              <span className="ws-engines-label">最近：</span>
              {recent.map((r) => (
                <button key={r} className="ws-chip ws-recent-chip" onClick={() => runAgg(r)}>
                  {r}
                </button>
              ))}
            </div>
          )}

          {searching && <div className="ws-searching">正在检索 Crossref / OpenAlex …</div>}
          {searchErr && <div className="ws-search-err">{searchErr}</div>}

          {hits && hits.length > 0 && (
            <div className="ws-results">
              <div className="ws-results-head">
                「{q}」· {hits.length} 条结果
                <button className="ws-chip" onClick={() => runAgg(q)} title="重新检索">
                  ↻
                </button>
              </div>
              {hits.map((h, i) => (
                <div key={i} className={`ws-result ${importedSlugs[i] ? 'done' : ''}`}>
                  <div className="ws-result-main">
                    <div className="ws-result-title" title={h.title} onClick={() => openHit(h)}>
                      {h.title}
                    </div>
                    <div className="ws-result-meta">
                      {[h.authors, h.venue, h.year].filter(Boolean).join(' · ') || '—'}
                    </div>
                    {h.abstract && <div className="ws-result-abs">{h.abstract.slice(0, 180)}{h.abstract.length > 180 ? '…' : ''}</div>}
                  </div>
                  <div className="ws-result-side">
                    <span className="ws-src">{h.source}</span>
                    {importedSlugs[i] ? (
                      <span className="ws-imported">✓ 已入库</span>
                    ) : (
                      <button className="ws-import" disabled={importing === i} onClick={() => void importHit(i)}>
                        {importing === i ? '入库中…' : '导入'}
                      </button>
                    )}
                    <button className="ws-open" title="在内置浏览器打开原文/详情页" onClick={() => openHit(h)}>
                      原文
                    </button>
                  </div>
                </div>
              ))}
              <div className="ws-results-foot">入库后进入「未分类」，可在库内移动；也可点「原文」到源页面查看全文。</div>
            </div>
          )}
        </div>
      )}

      <div className={`ws-stage ${mode === 'web' ? '' : 'ws-hidden'}`}>
        <webview ref={webRef} src="about:blank" partition="persist:cspaper-web" className="ws-frame" />
        {loading && <div className="ws-progress" />}
        {toast && <div className="ws-toast">{toast}</div>}
      </div>

      {hintOn && mode === 'web' && (
        <div className="ws-hint">
          <span className="ws-hint-text">
            内置浏览器已装载 CSPAPER Connector 扩展：页面点右键可用「保存到 CSPAPER」；带 PDF 链接的点击下载会自动入库
          </span>
          <button className="ws-hint-x" title="不再显示" onClick={closeHint}>
            ✕
          </button>
        </div>
      )}
    </div>
  )
}
