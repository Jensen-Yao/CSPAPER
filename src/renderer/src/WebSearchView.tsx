// 内置文献浏览器（v0.7）：<webview> 固定分区 persist:cspaper-web，
// 该分区在主进程已装载 CSPAPER Connector 扩展（右键保存）并接管 PDF 下载自动入库。
import { useEffect, useRef, useState } from 'react'
import type { WebviewTag } from 'electron'
import './websearch.css'

// <webview> 的 JSX 属性由 @types/react（WebViewHTMLAttributes）内置提供，无需自行声明

// 主页与快捷芯片对应的学术站点
const HOME = 'https://kns.cnki.net'
const HINT_KEY = 'ws.hintHidden'

const SITES: Array<{ label: string; host: string; url: string }> = [
  { label: '知网', host: 'kns.cnki.net', url: 'https://kns.cnki.net' },
  { label: '万方', host: 'd.wanfangdata.com.cn', url: 'https://d.wanfangdata.com.cn' },
  { label: '百度学术', host: 'xueshu.baidu.com', url: 'https://xueshu.baidu.com' },
  { label: '谷歌学术', host: 'scholar.google.com', url: 'https://scholar.google.com' },
  { label: 'arXiv', host: 'arxiv.org', url: 'https://arxiv.org' },
  { label: 'PubMed', host: 'pubmed.ncbi.nlm.nih.gov', url: 'https://pubmed.ncbi.nlm.nih.gov' },
  { label: 'X-MOL', host: 'www.x-mol.com', url: 'https://www.x-mol.com' },
  { label: 'Semantic Scholar', host: 'www.semanticscholar.org', url: 'https://www.semanticscholar.org' }
]

// 地址栏输入 → 可导航 URL：已有协议原样，否则自动补 https://
function normalizeUrl(raw: string): string {
  const s = raw.trim()
  if (!s) return ''
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s
  return 'https://' + s
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
  const [addr, setAddr] = useState(HOME) // 地址栏内容（编辑中即草稿，导航事件后回写真实 URL）
  const [pageUrl, setPageUrl] = useState(HOME) // 当前页真实 URL（保存/复制用它）
  const [pageTitle, setPageTitle] = useState('')
  const [loading, setLoading] = useState(false)
  const [canBack, setCanBack] = useState(false)
  const [canFwd, setCanFwd] = useState(false)
  const [save, setSave] = useState<SaveState>({ kind: 'idle', text: '保存此页' })
  const [copied, setCopied] = useState(false)
  const [toast, setToast] = useState('')
  const [hintOn, setHintOn] = useState(() => localStorage.getItem(HINT_KEY) !== '1')
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
    setAddr(u)
    void webRef.current?.loadURL(u).catch(() => {})
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

  const activeHost = hostOf(pageUrl)

  return (
    <div className={`ws-host ${visible ? '' : 'ws-hidden'}`}>
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
        <button className="ws-btn" title="主页（知网首页）" onClick={() => nav(HOME)}>
          ⌂
        </button>
        <input
          className="ws-addr"
          value={addr}
          spellCheck={false}
          placeholder="输入网址，回车访问（自动补 https://）"
          title={pageTitle || pageUrl || undefined}
          onChange={(e) => setAddr(e.target.value)}
          onBlur={() => {
            if (!addr.trim()) setAddr(pageUrl)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              nav(addr)
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
        <button
          className="ws-copy"
          title="复制当前链接到剪贴板，可在系统浏览器中粘贴打开"
          onClick={() => void copyLink()}
        >
          {copied ? '✓ 已复制' : '在浏览器打开'}
        </button>
      </div>

      <div className="ws-chips">
        {SITES.map((s) => (
          <button key={s.host} className={`ws-chip ${activeHost === s.host ? 'on' : ''}`} title={s.url} onClick={() => nav(s.url)}>
            {s.label}
          </button>
        ))}
      </div>

      <div className="ws-stage">
        <webview ref={webRef} src={HOME} partition="persist:cspaper-web" className="ws-frame" />
        {loading && <div className="ws-progress" />}
        {toast && <div className="ws-toast">{toast}</div>}
      </div>

      {hintOn && (
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
