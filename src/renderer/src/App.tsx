import WorkspaceNavigation from './WorkspaceNavigation'
import { WORKSPACE_ACTION, type WorkspaceAction } from './workspace-actions'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import LibraryPane from './LibraryPane'
import PdfViewer, { type ViewerHandle } from './PdfViewer'
import SidePanel, { type SideControl } from './SidePanel'
import SettingsDialog from './SettingsDialog'
import SetupWizard from './SetupWizard'
import CommandPalette from './CommandPalette'
import ResizeHandle from './ResizeHandle'
import BrandIcon from './BrandIcon'
import ChatView from './ChatView'
import RefViewer from './RefViewer'
import ImportDialog from './ImportDialog'
import ZoteroImportDialog from './ZoteroImportDialog'
import RecordsDialog from './RecordsDialog'
import LibraryHome from './LibraryHome'
import CompareView from './CompareView'
import OverviewView from './OverviewView'
import NotesView from './NotesView'
import OnlineAddDialog from './OnlineAddDialog'
import WebSearchView from './WebSearchView'
import WorkbenchView from './WorkbenchView'
import * as Icon from './Icon'
import { useDialog } from './Dialog'
import { presetCaps } from './model-caps-presets'
import { STATUS_KEYS } from './types'
import type { ChatScope } from './ChatControls'
import type { Paper, Settings, SourceRef } from './types'

export interface Tab {
  paper: Paper
}

const SidebarIcon = (): JSX.Element => <Icon.Sidebar size={15} />
const PanelIcon = (): JSX.Element => <Icon.Panel size={15} />
const GearIcon = (): JSX.Element => <Icon.Gear size={15} />

type MenuItem = { label: string; hint?: string; action?: () => void; sep?: boolean }

const MenuBar = ({ menus, openMenu, setOpenMenu }: { menus: Array<{ name: string; items: MenuItem[] }>; openMenu: string | null; setOpenMenu: (m: string | null) => void }): JSX.Element => (
  <div className="app-menu">
    {menus.map((m) => (
      <div key={m.name} className="menu-wrap">
        <button
          className={`menu-btn ${openMenu === m.name ? 'on' : ''}`}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => setOpenMenu(openMenu === m.name ? null : m.name)}
          onMouseEnter={() => openMenu && setOpenMenu(m.name)}
        >
          {m.name}
        </button>
        {openMenu === m.name && (
          <div className="menu-dropdown" onMouseDown={(e) => e.stopPropagation()}>
            {m.items.map((it, i) =>
              it.sep ? (
                <div key={i} className="menu-sep" />
              ) : (
                <button
                  key={i}
                  className="menu-item"
                  onClick={() => {
                    setOpenMenu(null)
                    it.action?.()
                  }}
                >
                  <span>{it.label}</span>
                  {it.hint && <span className="menu-hint">{it.hint}</span>}
                </button>
              )
            )}
          </div>
        )}
      </div>
    ))}
  </div>
)

const PROVIDER_LABEL: Record<string, string> = {
  zhipu: '智谱',
  deepseek: 'DeepSeek',
  qwen: '通义',
  moonshot: 'Kimi',
  openai: 'OpenAI',
  custom: '自定义'
}

export default function App(): JSX.Element {
  const dlg = useDialog()
  const [papers, setPapers] = useState<Paper[]>([])
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [hist, setHist] = useState<number[]>([])
  const [hIdx, setHIdx] = useState(-1)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showLib, setShowLib] = useState(true)
  const [showSide,setShowSide]=useState(false)
  const [showLibraryHome,setShowLibraryHome]=useState(true)
  const [indexInfo, setIndexInfo] = useState<{ done: number; total: number; phase: string } | null>(null)
  const [importInfo, setImportInfo] = useState('')
  const [cats, setCats] = useState<string[]>([])
  const [importFiles, setImportFiles] = useState<string[] | null>(null)
  const [zoteroOpen, setZoteroOpen] = useState(false)
  const [recordsOpen, setRecordsOpen] = useState(false)
  const [importSeq, setImportSeq] = useState(0)
  const [importBusy, setImportBusy] = useState(false)
  const importBusyRef = useRef(false)
  const [chatReset, setChatReset] = useState(0)
  const [indexedCount, setIndexedCount] = useState({ papers: 0, indexed: 0, chunks: 0, recordOnly: 0, fulltext: 0 })
  const [pendingJump, setPendingJump] = useState<{ slug: string; page: number; snippet?: string; probe?: string } | null>(null)
  const [pageCtx, setPageCtx] = useState('')
  const [floatBar, setFloatBar] = useState<{ x: number; y: number; text: string } | null>(null)
  const [q, setQ] = useState('')
  const [llmChip, setLlmChip] = useState('')
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [mode, setMode] = useState<'read' | 'chat' | 'compare' | 'overview' | 'notes' | 'web'>('read')
  const [topMode, setTopMode] = useState<'work' | 'paper'>('paper')
  const [overviewTab, setOverviewTab] = useState<'table' | 'graph' | 'stats'>('table')
  const [onlineOpen, setOnlineOpen] = useState(false)
  const [findSignal, setFindSignal] = useState(0)
  const [sideTab, setSideTab] = useState<'chat' | 'translate' | 'full' | 'notes' | 'refs' | 'info'>('chat')
  const [pageNo, setPageNo] = useState(1)
  const [appStatus, setAppStatus] = useState<Awaited<ReturnType<typeof window.api.appStatus>> | null>(null)
  const isMac = /Mac/.test(navigator.platform)

  // 命令面板：Ctrl/Cmd + K 全局唤起；Ctrl+F 分流——阅读模式进 PDF 内查找，其他模式聚焦侧栏搜索
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        if (mode === 'read' && activeId !== null) {
          setFindSignal((n) => n + 1)
        } else {
          setShowLib(true)
          setTimeout(() => (document.querySelector('.searchbox') as HTMLInputElement | null)?.focus(), 60)
        }
        return
      }
      // Alt+1~5 快捷改当前论文阅读状态（W2，对标 Reading List 插件）
      if (e.altKey && !e.ctrlKey && !e.metaKey && /^[1-5]$/.test(e.key)) {
        const p = tabs.find((t) => t.paper.id === activeId)?.paper
        if (!p) return
        e.preventDefault()
        const next = STATUS_KEYS[parseInt(e.key, 10) - 1]
        void window.api.setStatus(p.id, next)
        setPapers((ps) => ps.map((x) => (x.id === p.id ? { ...x, status: next } : x)))
        setTabs((ts) => ts.map((t) => (t.paper.id === p.id ? { ...t, paper: { ...t.paper, status: next } } : t)))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, activeId, tabs])

  const viewerRef = useRef<ViewerHandle>(null)
  const sideControl = useRef<SideControl>(null)
  const pageCtxRef = useRef('')

  const activePaper = tabs.find((t) => t.paper.id === activeId)?.paper ?? null

  useEffect(() => {
    if (!settings) return
    if (isMac) document.documentElement.classList.add('mac')
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const apply = () => {
      const t = settings.theme === 'system' ? (mq.matches ? 'light' : 'dark') : settings.theme
      document.documentElement.dataset.theme = t
      window.api.syncTheme(t)
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [settings?.theme])

  // 刷新文献与分类列表；同时把打开的标签页/引用面板里的旧 paper 对象换成最新数据
  //（手动移动/重命名后 path 变了，不同步的话下次打开会读到失效路径）；已删除的论文同步关掉标签页/引用面板
  const refreshPapers = useCallback(async (): Promise<Paper[]> => {
    const [ps, cs] = await Promise.all([window.api.listPapers(), window.api.listCategories()])
    setPapers(ps)
    setCats(cs)
    setTabs((ts) => {
      const next: Tab[] = []
      for (const t of ts) {
        const fresh = ps.find((p) => p.id === t.paper.id)
        if (fresh) next.push({ paper: fresh })
      }
      return next
    })
    setRefView((rv) => {
      if (!rv) return rv
      const fresh = ps.find((p) => p.id === rv.paper.id)
      return fresh ? { ...rv, paper: fresh } : null
    })
    return ps
  }, [])

  // 被删除论文的标签页收起后，激活标签落到列表末位（无标签则清空）
  useEffect(() => {
    if (activeId !== null && !tabs.some((t) => t.paper.id === activeId)) {
      setActiveId(tabs.length ? tabs[tabs.length - 1].paper.id : null)
    }
  }, [tabs, activeId])

  const refreshLlmChip = useCallback(async () => {
    if (!settings?.apiKey) {
      setLlmChip('未连接')
      return
    }
    const r = await window.api.testLLM()
    if (r.ok) {
      const bal = r.balance ? ` · ${r.balance.currency === 'CNY' ? '¥' : r.balance.currency + ' '}${r.balance.amount}` : ''
      setLlmChip(`${r.model} · ${r.latencyMs}ms${bal}`)
    } else {
      setLlmChip('连接失败')
    }
  }, [settings?.apiKey, settings?.model, settings?.apiBase])

  useEffect(() => {
    void (async () => {
      setSettings(await window.api.getSettings())
      await refreshPapers()
      setIndexedCount(await window.api.indexStatus())
    })().catch(error=>dlg.toast('加载文献库失败：'+String(error),'error'))
    const off = window.api.onIndexProgress((p) => {
      setIndexInfo(p)
      if (p.phase === 'done') {
        setIndexInfo(null)
        void window.api.indexStatus().then(setIndexedCount)
      }
    })
    // 导入进度（状态栏）：弹窗关闭时也能看到后台导入到哪了
    const offImp = window.api.onImportProgress((p) => {
      if (p.total > 0 && p.done < p.total) setImportInfo(`导入中 ${p.done}/${p.total}`)
      else setImportInfo('')
    })
    // 主进程菜单触发的变更（右键移动/删除空分类）与导入入口
    const offChg = window.api.onPapersChanged(() => void refreshPapers())
    const offIdxErr = window.api.onIndexError((err) => {
      setIndexInfo(null)
      dlg.toast(`索引失败：${err.slice(0, 120)}`, 'error')
    })
    const offReq = window.api.onImportRequest(() => {
      if (!importBusyRef.current) {
        setImportFiles([])
        setImportSeq((s) => s + 1)
      }
    })
    // 浏览器插件通过本地桥接服务保存文献成功后的提示
    const offNotice = window.api.onAppNotice(({ title, detail }) => {
      setImportInfo(`${title}：${detail}`)
      setTimeout(() => setImportInfo(''), 6000)
      void refreshPapers()
    })
    const timer = setInterval(() => {
      void window.api.indexStatus().then(setIndexedCount)
      void window.api.appStatus().then(setAppStatus).catch(() => setAppStatus(null))
    }, 8000)
    void window.api.appStatus().then(setAppStatus).catch(() => {})
    return () => {
      off()
      offImp()
      offChg()
      offIdxErr()
      offReq()
      offNotice()
      clearInterval(timer)
    }
  }, [refreshPapers])

  useEffect(() => {
    void refreshLlmChip()
  }, [refreshLlmChip])

  // 打开论文并记录历史（前进/后退切换）；probe = 问题+回答上下文，引用跳转的关键词定位用
  const openPaper = useCallback(
    (p: Paper, jumpPage?: number, snippet?: string, probe?: string) => {
      setTabs((ts) => (ts.some((t) => t.paper.id === p.id) ? ts : [...ts, { paper: p }]))
      setActiveId(p.id)
      setShowLibraryHome(false)
      setPendingJump(jumpPage ? { slug: p.slug, page: jumpPage, snippet, probe } : null)
      // 「最近」视图排序依据：与 sqlite datetime('now') 同格式（UTC）
      void window.api.markOpened(p.id)
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ')
      setPapers((ps) => ps.map((x) => (x.id === p.id ? { ...x, opened_at: now } : x)))
      setHist((h) => {
        const cut = h.slice(0, hIdx + 1)
        if (cut[cut.length - 1] === p.id) return cut
        cut.push(p.id)
        setHIdx(cut.length - 1)
        return cut
      })
    },
    [hIdx]
  )


  const closeTab = useCallback(
    (id: number) => {
      const idx = tabs.findIndex((t) => t.paper.id === id)
      const next = tabs.filter((t) => t.paper.id !== id)
      setTabs(next)
      if (id === activeId) setActiveId(next.length ? next[Math.min(idx, next.length - 1)].paper.id : null)
    },
    [tabs, activeId]
  )

  // 五态循环：待读 → 在读 → 已读 → 稍后读 → 暂不读 → 待读（W2）
  const cycleStatus = useCallback(async (p: Paper) => {
    const cur = STATUS_KEYS.includes(p.status) ? STATUS_KEYS.indexOf(p.status) : 1
    const next = STATUS_KEYS[(cur + 1) % STATUS_KEYS.length]
    await window.api.setStatus(p.id, next)
    setPapers((ps) => ps.map((x) => (x.id === p.id ? { ...x, status: next } : x)))
    setTabs((ts) => ts.map((t) => (t.paper.id === p.id ? { ...t, paper: { ...t.paper, status: next } } : t)))
  }, [])

  const onSelect = useCallback((text: string, x: number, y: number) => {
    setFloatBar({ x, y, text })
  }, [])
  const doHighlight = useCallback((color?: string) => {
    setFloatBar(null)
    void viewerRef.current?.highlightSelection(color)
  }, [])
  const doTranslate = useCallback((text: string) => {
    setFloatBar(null)
    setShowSide(true)
    sideControl.current?.translate(text, pageCtxRef.current)
  }, [])
  useEffect(()=>{
    const handler=(event:Event)=>{
      const detail=(event as CustomEvent<{text:string;context?:string}>).detail
      if(!detail?.text)return
      setShowSide(true)
      sideControl.current?.translate(detail.text,detail.context??pageCtxRef.current)
    }
    window.addEventListener('cspaper:translate-request',handler)
    return ()=>window.removeEventListener('cspaper:translate-request',handler)
  },[])
  const doExplain = useCallback((text: string) => {
    setFloatBar(null)
    setShowSide(true)
    sideControl.current?.explain(text, pageCtxRef.current)
  }, [])
  const onEditHighlight = useCallback((hid: number, patch: { color?: string; comment?: string }) => {
    viewerRef.current?.patchHighlightLocal(hid, patch) // 正文划线即时变色
    void window.api.updateHighlight(hid, patch)
  }, [])
  const onDeleteHighlight = useCallback((hid: number) => {
    void window.api.deleteHighlight(hid)
    viewerRef.current?.removeHighlightLocal(hid)
  }, [])

  // 导入走弹窗（拖入窗口 = 直接带着文件打开并自动开始；导入进行中忽略新的窗口拖入）
  const addPapers = useCallback(() => {
    setImportFiles([])
    setImportSeq((s) => s + 1)
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setFloatBar(null)
      if (importBusyRef.current) return
      const paths = [...e.dataTransfer.files]
        .map((f) => window.api.pathForFile(f))
        .filter(Boolean)
        .filter((p) => p.toLowerCase().endsWith('.pdf'))
      if (paths.length > 0) {
        setImportFiles(paths)
        setImportSeq((s) => s + 1)
      }
    },
    [importBusy]
  )

  // 引用跳转 / 侧栏点开论文：都回到阅读模式
  const jumpTo = useCallback(
    (slug: string, page: number, snippet?: string, probe?: string, source?: SourceRef) => {
      const p = papers.find((x) => x.slug === slug)
      if (p) {
        setMode('read')
        openPaper(p, page, snippet, probe)
      }
    },
    [papers, openPaper]
  )

  const openPaperFromTree = useCallback(
    (p: Paper) => {
      setMode('read')
      openPaper(p)
    },
    [openPaper]
  )

  // 导入完成后刷新并自动在阅读区打开第一篇成功导入的论文
  const importDone = useCallback(
    async (outcomes: { ok: boolean; slug?: string }[]) => {
      const ps = await refreshPapers()
      const first = outcomes.find((o) => o.ok && o.slug)
      if (first?.slug) {
        const p = ps.find((x) => x.slug === first.slug)
        if (p) openPaperFromTree(p)
      }
      setImportBusy(false)
    },
    [refreshPapers, openPaperFromTree]
  )

  // 新建对话：切到对话模式并清空当前会话
  const newChat = useCallback(() => {
    setMode('chat')
    setChatReset((k) => k + 1)
  }, [])

  // 手动归类（拖拽 / 弹窗）：移动文件夹 + 刷新
  const movePaper = useCallback(
    async (id: number, cat: string) => {
      try {
        await window.api.movePaper(id, cat)
        await refreshPapers()
      } catch (e) {
        dlg.toast(String(e).replace(/^Error: /, '').slice(0, 140), 'error')
      }
    },
    [refreshPapers]
  )

// 相对当前论文在排序列表中前后移动（而非浏览历史）
  const navBack = useCallback(() => {
    const idx = papers.findIndex((p) => p.id === activeId)
    if (idx > 0) openPaperFromTree(papers[idx - 1])
  }, [papers, activeId, openPaperFromTree])
  const navFwd = useCallback(() => {
    const idx = papers.findIndex((p) => p.id === activeId)
    if (idx >= 0 && idx < papers.length - 1) openPaperFromTree(papers[idx + 1])
  }, [papers, activeId, openPaperFromTree])

  const saveSettings = useCallback(async (patch: Partial<Settings>) => {
    try {
      const s = await window.api.saveSettings(patch)
      setSettings(s)
      return s
    } catch (error) {
      dlg.toast(`设置保存失败：${String(error).replace(/^Error: /, '').slice(0, 120)}`, 'error')
      throw error
    }
  }, [dlg])

  const profiles = settings?.profiles ?? []
  const models = profiles.length ? profiles.flatMap((p) => p.models) : settings?.models?.length ? settings.models : settings?.model ? [settings.model] : []
  const model = settings?.model ?? ''
  const thinking = settings?.thinkingLevel ?? 'default'

  // 对话模式：检索范围与引用面板
  const [chatScope, setChatScope] = useState<ChatScope>({ type: 'all', cat: '' })
  const [refView, setRefView] = useState<{ paper: Paper; page: number; snippet?: string; probe?: string; documentVersion?: string } | null>(null)
  const [refWidth, setRefWidth] = useState(() => Number(localStorage.getItem('pl.refW')) || 460)

  // 对话字号（问答/翻译/对话三处共用），CSS 变量 --chat-fs 驱动，localStorage 记忆
  const [chatFs, setChatFs] = useState(() => Math.max(11, Math.min(19, Number(localStorage.getItem('pl.chatFs')) || 15)))
  useEffect(() => {
    document.documentElement.style.setProperty('--chat-fs', `${chatFs}px`)
  }, [chatFs])
  const changeFs = useCallback((d: number) => {
    setChatFs((f) => {
      const n = Math.max(11, Math.min(19, f + d))
      localStorage.setItem('pl.chatFs', String(n))
      return n
    })
  }, [])
  const resetFs = useCallback(() => {
    localStorage.setItem('pl.chatFs', '15')
    setChatFs(15)
  }, [])

  const catCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of papers) m.set(p.category, (m.get(p.category) ?? 0) + 1)
    return m
  }, [papers])
  // Chat 模式点引用：在右侧引用面板打开，不离开对话
  const openCite = useCallback(
    (slug: string, page: number, snippet?: string, probe?: string, source?: SourceRef) => {
      const p = papers.find((x) => x.slug === slug)
      if (p) {
        setTopMode('paper')
        // RefViewer 挂在对话容器内：不在 chat 模式时先切过去，否则跳转不可见
        if (mode !== 'chat') setMode('chat')
        setRefView({ paper: p, page, snippet, probe, documentVersion:source?.documentVersion })
      }
    },
    [papers, mode]
  )
  useEffect(()=>{
    const handle=(event:Event)=>{
      const action=(event as CustomEvent<WorkspaceAction>).detail
      if(action.kind==='artifact') {
        setTopMode('paper')
        if(action.artifact.kind==='comparison')setMode('compare')
        else if(action.artifact.kind==='note'||action.artifact.kind==='synthesis')setMode('notes')
      } else if(action.kind==='chat') { setTopMode('paper');setMode('chat');if(action.fresh)setRefView(null) }
      else if(action.kind==='citation')openCite(action.slug,action.page,action.snippet,action.probe,{documentVersion:action.documentVersion} as SourceRef)
      else if(action.kind==='paper') {
        const paper=papers.find(item=>item.id===action.paperId)
        if(paper){setTopMode('paper');setMode('read');openPaper(paper,action.page)}
      }
    }
    window.addEventListener(WORKSPACE_ACTION,handle)
    return ()=>window.removeEventListener(WORKSPACE_ACTION,handle)
  },[papers,openPaper,openCite])
  const activeProfile = profiles.find((profile) => profile.models.includes(model))
  const thinkingLevels = activeProfile?.modelCaps?.[model]?.reasoningLevels ?? presetCaps(model)?.reasoningLevels ?? []
  const changeModel = useCallback(
    (m: string) => {
      // 跨供应商：该模型属于哪个配置，就同步切换到那个供应商
      const pf = profiles.find((p) => p.models.includes(m))
      if (pf) {
        const levels=pf.modelCaps?.[m]?.reasoningLevels ?? presetCaps(m)?.reasoningLevels ?? []
        void saveSettings({
          model: m,
          provider: pf.provider,
          apiBase: pf.apiBase,
          apiKey: pf.apiKey,
          ...(levels.length&&!levels.includes(thinking)?{thinkingLevel:'default'}:{})
        })
      } else void saveSettings({ model: m })
    },
    [profiles, saveSettings, thinking]
  )
  const addThinkingLevel = useCallback(
    async (level: string) => {
      if(!settings||!activeProfile||!model) return
      const current=activeProfile.modelCaps?.[model] ?? presetCaps(model)
      const levels=current?.reasoningLevels ?? []
      if(levels.includes(level)) { await saveSettings({thinkingLevel:level}); return }
      const modelCaps={...(activeProfile.modelCaps??{}),[model]:{...current,reasoningLevels:[...levels,level]}}
      await saveSettings({profiles:(settings.profiles??[]).map(profile=>profile.id===activeProfile.id?{...profile,modelCaps}:profile),thinkingLevel:level})
    },
    [activeProfile,model,saveSettings,settings]
  )
  const changeThinking = useCallback(
    (l: string) => {
      void saveSettings({ thinkingLevel: l as Settings['thinkingLevel'] })
    },
    [saveSettings]
  )

  // 侧栏无级拖宽（宽度记忆在 localStorage）
  const [libWidth, setLibWidth] = useState(() => Number(localStorage.getItem('pl.libW')) || 264)
  const [sideWidth,setSideWidth]=useState(()=>Math.max(320,Math.min(440,Number(localStorage.getItem('pl.sideW'))||360)))
  useEffect(()=>{
    const query=window.matchMedia('(max-width: 1250px)')
    const collapse=()=>{if(query.matches)setShowSide(false)}
    collapse();query.addEventListener('change',collapse)
    return ()=>query.removeEventListener('change',collapse)
  },[])
  // 文件菜单 / 空库引导：直接选库文件夹并扫描（与设置页同效）
  const pickLibraryNow = useCallback(async () => {
    const p = await window.api.pickLibrary()
    if (!p) return
    const s = await saveSettings({ libraryPath: p })
    await window.api.scanLibrary(s.libraryPath)
    await refreshPapers()
  }, [saveSettings, refreshPapers])

  const statusLeft = importInfo || (indexInfo ? `正在索引 ${indexInfo.done}/${indexInfo.total}` : `已索引 ${indexedCount.indexed}/${indexedCount.papers} 篇 · 原文 ${indexedCount.fulltext} · 题录 ${indexedCount.recordOnly} · ${indexedCount.chunks} 块`)
  const curIdx = papers.findIndex((p) => p.id === activeId)
  const canBack = curIdx > 0
  const canFwd = curIdx >= 0 && curIdx < papers.length - 1

  // 首次启动：走完「文献库 → LLM → 嵌入」向导才进主界面（已有文献库的老用户自动跳过）
  if (settings && !settings.setupDone && papers.length === 0) {
    return (
      <SetupWizard
        initial={settings}
        onDone={() => {
          void (async () => {
            setSettings(await window.api.getSettings())
            await refreshPapers()
            setIndexedCount(await window.api.indexStatus())
          })()
        }}
        onZoteroImport={() => setZoteroOpen(true)}
      />
    )
  }

  const menus = [
    {
      name: '文件',
      items: [
        { label: '导入 PDF 文献…', hint: '拖入窗口也可以', action: addPapers },
        { label: '在线添加…', hint: 'DOI / arXiv / 链接 / 关键词', action: () => setOnlineOpen(true) },
        { label: '从 Zotero 导入…', hint: '迁移文献库', action: () => setZoteroOpen(true) },
        { label: '导入题录文件…', hint: 'RIS / CNKI 导出', action: () => setRecordsOpen(true) },
        { label: '导出移动端数据包…', hint: '手机端阅读', action: () => void window.api.exportMobilePack() },
        { label: '从手机合并阅读数据…', action: () => void window.api.mergeMobileNotes() },
        { label: '选择文献库文件夹…', action: () => void pickLibraryNow() },
        { label: '重建全库索引', action: () => void window.api.rebuildIndex() },
        { sep: true, label: '' },
        { label: '设置…', action: () => setShowSettings(true) },
        { label: '退出', action: () => void window.api.appQuit() }
      ] as MenuItem[]
    },
    {
      name: '视图',
      items: [
        { label: '命令面板…', hint: isMac ? '⌘K' : 'Ctrl+K', action: () => setPaletteOpen(true) },
        { sep: true, label: '' },
        { label: showLib ? '隐藏文献侧栏' : '显示文献侧栏', action: () => setShowLib((v) => !v) },
        { label: showSide ? '隐藏问答面板' : '显示问答面板', action: () => setShowSide((v) => !v) },
        { sep: true, label: '' },
        { label: '放大', hint: isMac ? '⌘ +' : 'Ctrl +', action: () => viewerRef.current?.zoomBy(0.15) },
        { label: '缩小', hint: isMac ? '⌘ -' : 'Ctrl -', action: () => viewerRef.current?.zoomBy(-0.15) },
        { label: '适应宽度', hint: isMac ? '⌘ 0' : 'Ctrl 0', action: () => viewerRef.current?.zoomReset() },
        { sep: true, label: '' },
        { label: '增大对话字号', hint: '问答/翻译/对话', action: () => changeFs(1) },
        { label: '减小对话字号', hint: '问答/翻译/对话', action: () => changeFs(-1) },
        { label: '重置对话字号', hint: '13px', action: resetFs },
        { sep: true, label: '' },
        { label: '重新加载', hint: isMac ? '⌘ R' : 'Ctrl R', action: () => location.reload() }
      ] as MenuItem[]
    },
    {
      name: '纵览',
      items: [
        { label: '文献表格', hint: 'Zotero 式总表', action: () => { setMode('overview'); setOverviewTab('table') } },
        { label: '知识网络', hint: '关联图谱', action: () => { setMode('overview'); setOverviewTab('graph') } },
        { label: '统计仪表盘', hint: '时长/时间线/词云', action: () => { setMode('overview'); setOverviewTab('stats') } },
        { sep: true, label: '' },
        { label: '笔记中心', hint: '全库笔记与标注', action: () => setMode('notes') },
        { label: '文献浏览器', hint: '知网/arXiv 等站点直达', action: () => setMode('web') }
      ] as MenuItem[]
    },
    {
      name: '帮助',
      items: [
        { label: '命令面板…', hint: isMac ? '⌘K' : 'Ctrl+K', action: () => setPaletteOpen(true) },
        { label: '引文助手（Word / WPS 插引文）', action: () => window.api.openExternal('http://127.0.0.1:24517/cite-ui') },
        { label: '浏览器插件说明', action: () => window.api.openExternal('https://github.com/Jensen-Yao/CSPAPER#-浏览器插件') },
        { label: 'GitHub 仓库', action: () => window.api.openExternal('https://github.com/Jensen-Yao/CSPAPER') }
      ] as MenuItem[]
    }
  ]

  return (
    <div
      className={`shell ${showSide?'with-assistant':''}`}
      onMouseDown={() => {
        setFloatBar(null)
        setOpenMenu(null)
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <div className="titlebar">
        {!isMac && (
          <MenuBar menus={menus} openMenu={openMenu} setOpenMenu={setOpenMenu} />
        )}
        <div className="tb-side tb-left">
          <div className="top-switch">
            <button className={topMode === 'work' ? 'on' : ''} title="科研工作台：给目标，agent 执行" onClick={() => setTopMode('work')}>
              <Icon.Zap size={13} /> Work
            </button>
            <button className={topMode === 'paper' ? 'on' : ''} title="文献库：阅读 / 对话 / 纵览 / 笔记" onClick={() => setTopMode('paper')}>
              <Icon.Library size={13} /> Paper
            </button>
          </div>
          {topMode === 'paper' && (
            <button
              className={`icon-btn tb-toggle ${showLib ? 'on' : ''}`}
              title={showLib ? '隐藏 文献边栏' : '显示 文献边栏'}
              onClick={() => setShowLib((v) => !v)}
            >
              <SidebarIcon />
            </button>
          )}
        </div>
        <div className="tb-drag" />
        <div className="tb-title"><BrandIcon /><span className="tb-title-name">CSPAPER</span></div>
        <div className="tb-drag" />
        <div className="tb-side tb-right">
          {topMode==='paper' && mode === 'read' && !showLibraryHome && (
            <button
              className={`icon-btn tb-toggle ${showSide ? 'on' : ''}`}
              title={showSide ? '隐藏 问答·翻译面板' : '显示 问答·翻译面板'}
              onClick={() => setShowSide((v) => !v)}
            >
              <PanelIcon />
            </button>
          )}
          <button className="icon-btn" title="设置" onClick={() => setShowSettings(true)}>
            <GearIcon />
          </button>
        </div>
      </div>

      {topMode==='paper'&&<WorkspaceNavigation mode={mode} libraryVisible={showLibraryHome || tabs.length===0} openCount={tabs.length}
        onLibrary={()=>{setMode('read');setShowLibraryHome(true)}}
        onResume={()=>{setMode('read');setShowLibraryHome(false)}}
        onNavigate={next=>{setMode(next);setFloatBar(null)}}/>}
      <div className="body3">
        <div className={topMode === 'work' ? '' : 'pane-hidden'} style={{ display: 'flex', flex: 1, minWidth: 0 }}>
          <WorkbenchView
            visible={topMode === 'work'}
            papers={papers}
            models={models}
            profiles={profiles}
            onOpenPaper={(p) => {
              setTopMode('paper')
              openPaperFromTree(p)
            }}
            onOpenCompare={() => {
              setTopMode('paper')
              setMode('compare')
            }}
            onOpenNotes={() => {
              setTopMode('paper')
              setMode('notes')
            }}
            onOpenSettings={() => setShowSettings(true)}
          />
        </div>
        <div className={`paper-workspace ${topMode==='paper'?'':'pane-hidden'}`}>
        {showLib && (
          <>
            <LibraryPane
              width={libWidth}
              papers={papers}
              cats={cats}
              activeId={activeId}
              q={q}
              onSetQ={setQ}
              onOpen={openPaperFromTree}
              onOpenHit={(p, h) => jumpTo(p.slug, h.page ?? 1, h.snippet)}
              onCycleStatus={cycleStatus}
              onAddPapers={addPapers}
              onNewChat={newChat}
              onMovePaper={(id, cat) => void movePaper(id, cat)}
              onReindex={() => {
                void window.api.rebuildIndex()
              }}
              onBack={navBack}
              onFwd={navFwd}
              canBack={canBack}
              canFwd={canFwd}
              onOpenPalette={() => setPaletteOpen(true)}
              mode={mode}
              onModeChange={setMode}
              onPapersChanged={refreshPapers}
            />
            <ResizeHandle id="library" label="文献栏宽度" width={libWidth} min={200} max={520} defaultWidth={264} storageKey="pl.libW" edge="right" onWidthChange={setLibWidth} />
          </>
        )}
        <div className="workspace">
          {/* 阅读区：模式切换只隐藏不卸载，保留标签页与滚动状态 */}
          <div className={`main-win ${mode === 'read' ? '' : 'pane-hidden'}`}>
            <div className={`library-surface ${showLibraryHome || tabs.length===0?'':'pane-hidden'}`}><LibraryHome
                papers={papers}
                activeId={activeId}
                onOpen={openPaperFromTree}
                onAddPapers={addPapers}
                onOpenRecords={() => setRecordsOpen(true)}
                onOpenOnline={() => setOnlineOpen(true)}
                onOpenZotero={()=>setZoteroOpen(true)}
                onPapersChanged={refreshPapers}
              /></div>
            <div className={`reader-surface ${!showLibraryHome&&tabs.length>0?'':'pane-hidden'}`}><PdfViewer
                ref={viewerRef}
                tabs={tabs}
                activeId={activeId}
                findSignal={findSignal}
                onActivate={setActiveId}
                onCloseTab={closeTab}
                pendingJump={pendingJump}
                onJumped={() => setPendingJump(null)}
                onPageContext={(t) => {
                  pageCtxRef.current = t
                  setPageCtx(t)
                }}
                onSelect={onSelect}
                onDeleteHighlight={onDeleteHighlight}
                onEditHighlight={onEditHighlight}
                visible={topMode==='paper' && mode==='read' && !showLibraryHome}
                onPageChange={setPageNo}
                onOpenFulltext={() => sideControl.current?.openFulltext()}
              /></div>
            {showSide && !showLibraryHome && tabs.length>0 && (
              <ResizeHandle id="assistant" label="助手栏宽度" width={sideWidth} min={300} max={700} defaultWidth={380} storageKey="pl.sideW" edge="left" onWidthChange={setSideWidth} />)}
            {/* 问答面板常驻 + 右缘功能竖轨：面板收起时轨道仍可点击展开 */}
            <div className="side-wrap">
              <SidePanel
                ref={sideControl}
                width={sideWidth}
                paper={activePaper}
                pageContext={pageCtx}
                pageNum={pageNo}
                onJump={jumpTo}
                onDeleteHighlight={onDeleteHighlight}
                onPapersChanged={refreshPapers}
                collapsed={!showSide || showLibraryHome || tabs.length===0}
                onTabChange={setSideTab}
                models={models}
                profiles={profiles}
                model={model}
                thinking={thinking}
                thinkingLevels={thinkingLevels}
                onChangeModel={changeModel}
                onChangeThinking={changeThinking}
                onAddThinkingLevel={addThinkingLevel}
                fs={chatFs}
                onFs={changeFs}
              />
              <div className="side-rail">
                {([['chat', <Icon.Chat size={14} />, '问答'], ['translate', <Icon.Globe size={14} />, '翻译'], ['full', <Icon.Doc size={14} />, '全文翻译'], ['notes', <Icon.Highlight size={14} />, '划词标注'], ['refs', <Icon.Book size={14} />, '参考文献'], ['info', <Icon.Info size={14} />, '文献详情']] as const).map(
                  ([k, ico, tip]) => (
                    <button
                      key={k}
                      className={`side-rail-btn ${sideTab === k && showSide ? 'on' : ''}`}
                      title={tip}
                      onClick={() => {
                        if(!tabs.length) {
                          if(k==='chat') setMode('chat')
                          else {
                            setTopMode('paper')
                            setMode('read')
                            setShowLibraryHome(true)
                            setShowSide(false)
                            dlg.toast('请先打开一篇文献，再使用'+tip)
                          }
                          return
                        }
                        setTopMode('paper')
                        setMode('read')
                        setShowLibraryHome(false)
                        setShowSide(true)
                        sideControl.current?.openTab(k)
                      }}
                    >
                      {ico}
                    </button>
                  )
                )}
              </div>
            </div>
          </div>
          {/* 对话区：同样常驻，保留对话历史 */}
          <div className={`chat-wrap ${mode === 'chat' ? '' : 'pane-hidden'}`}>
            <ChatView
              papers={papers}
              paperCount={papers.length}
              cats={cats}
              catCounts={catCounts}
              scope={chatScope}
              onScopeChange={setChatScope}
              models={models}
              profiles={profiles}
              model={model}
              thinking={thinking}
              thinkingLevels={thinkingLevels}
              onChangeModel={changeModel}
              onChangeThinking={changeThinking}
              onAddThinkingLevel={addThinkingLevel}
              onJump={openCite}
              resetKey={chatReset}
              fs={chatFs}
              onFs={changeFs}
              onOpenSettings={() => setShowSettings(true)}
          />
            {refView && (
              <>
                <ResizeHandle id="citation" label="引用原文栏宽度" width={refWidth} min={320} max={900} defaultWidth={460} storageKey="pl.refW" edge="left" onWidthChange={setRefWidth} /><RefViewer paper={refView.paper} page={refView.page} snippet={refView.snippet} probe={refView.probe} documentVersion={refView.documentVersion} width={refWidth} onClose={() => setRefView(null)} />
              </>
            )}
          </div>
          {/* 对比区：AI 多文献横向对比表格 */}
          <div className={`cmp-host ${mode === 'compare' ? '' : 'pane-hidden'}`}>
            <CompareView papers={papers} onJump={openCite} />
          </div>
          {/* 纵览区：文献总表 + 知识网络 + 统计 */}
          <div className={`ov-host ${mode === 'overview' ? '' : 'pane-hidden'}`}>
            <OverviewView papers={papers} visible={topMode==='paper' && mode==='overview'} tab={overviewTab} onTabChange={setOverviewTab} onOpen={openPaperFromTree} onRefresh={refreshPapers} />
          </div>
          {/* 笔记中心：全库我的笔记 + 划词标注聚合（W3） */}
          <div className={`ov-host ${mode === 'notes' ? '' : 'pane-hidden'}`}>
            <NotesView papers={papers} visible={topMode==='paper' && mode==='notes'} onOpenPaper={(id, page) => { const p = papers.find((x) => x.id === id); if (p) { setTopMode('paper'); setMode('read'); openPaper(p, page) } }} onRefresh={refreshPapers} />
          </div>
          {/* 内置文献浏览器：站点快捷入口 + Connector 扩展 + 一键保存入库 */}
          <WebSearchView visible={topMode==='paper' && mode==='web'} />
        </div>
        </div>
      </div>

      <div className="statusbar">
        <span className="chip"><Icon.Library size={12} /> {appStatus ? `${appStatus.papers} 篇 · ${appStatus.categories} 类` : ''}</span>
        <span className="chip ellipsis" style={{ maxWidth: 420 }}><Icon.Zap size={12} /> {statusLeft}</span>
        <span style={{ flex: 1 }} />
        <span
          className={`chip bridge-chip ${appStatus?.bridge.running ? 'on' : 'off'}`}
          title={appStatus?.bridge.running ? `本地服务运行中（端口 ${appStatus.bridge.port}）——浏览器/Word 插件可连接` : '本地服务未运行'}
          onClick={() => void window.api.appStatus()}
        >
          <i className={`dot ${appStatus?.bridge.running ? 'ok' : ''}`} />
          {appStatus?.bridge.running ? '服务就绪' : '服务离线'}
        </span>
        <span className="chip" title={llmChip} onClick={() => void refreshLlmChip()}>
          <Icon.Gear size={12} /> {llmChip || `${settings?.model ?? ''}${settings ? ` · ${PROVIDER_LABEL[settings.provider] ?? ''}` : ''}`}
        </span>
      </div>

      {floatBar && (
        <div
          className="float-bar"
          style={{ left: Math.min(floatBar.x, window.innerWidth - 210), top: Math.min(floatBar.y + 8, window.innerHeight - 50) }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <span className="fbdots">
            <button className="fbdot yellow" title="高亮 · 重要" onClick={() => doHighlight('yellow')} />
            <button className="fbdot blue" title="高亮 · 方法" onClick={() => doHighlight('blue')} />
            <button className="fbdot green" title="高亮 · 结论" onClick={() => doHighlight('green')} />
            <button className="fbdot red" title="高亮 · 疑问" onClick={() => doHighlight('red')} />
          </span>
          <button onClick={() => doTranslate(floatBar.text)}>翻译</button>
          <button onClick={() => doExplain(floatBar.text)}>解释</button>
        </div>
      )}
      {showSettings && settings && (
        <SettingsDialog settings={settings} indexed={indexedCount} indexInfo={indexInfo} onSave={saveSettings} onRescanned={refreshPapers} onClose={() => setShowSettings(false)} />
      )}
      {importFiles !== null && settings && (
        <ImportDialog
          key={importSeq}
          initialFiles={importFiles}
          initialCats={cats}
          hasApiKey={!!settings.apiKey}
          onBusyChange={(b) => { importBusyRef.current = b; setImportBusy(b) }}
          onClose={() => setImportFiles(null)}
          onFinished={(outcomes) => void importDone(outcomes)}
        />
      )}
      {zoteroOpen && <ZoteroImportDialog initialCats={cats} onClose={() => setZoteroOpen(false)} onFinished={() => void refreshPapers()} />}
      {recordsOpen && <RecordsDialog initialCats={cats} onClose={() => setRecordsOpen(false)} onFinished={() => void refreshPapers()} />}
      <OnlineAddDialog open={onlineOpen} cats={cats} onClose={() => setOnlineOpen(false)} onDone={() => void refreshPapers()} />
      {paletteOpen && (
        <CommandPalette
          papers={papers}
          onClose={() => setPaletteOpen(false)}
          onOpenPaper={openPaperFromTree}
          commands={[
            { id: 'add', label: '导入 PDF 文献…', hint: '文件', run: addPapers },
            { id: 'online', label: '在线添加文献…', hint: 'DOI / arXiv / 链接 / 关键词', run: () => setOnlineOpen(true) },
            { id: 'notes', label: '打开笔记中心', hint: '视图', run: () => setMode('notes') },
            { id: 'web', label: '打开文献浏览器', hint: '知网 / arXiv 等站点', run: () => setMode('web') },
            { id: 'stats', label: '打开统计仪表盘', hint: '视图', run: () => { setMode('overview'); setOverviewTab('stats') } },
            { id: 'zotero', label: '从 Zotero 导入…', hint: '文件', run: () => setZoteroOpen(true) },
            { id: 'picklib', label: '选择文献库文件夹…', hint: '文件', run: () => void pickLibraryNow() },
            { id: 'reindex', label: '重建全库索引', hint: '文件', run: () => void window.api.rebuildIndex() },
            { id: 'settings', label: '打开设置…', hint: '界面', run: () => setShowSettings(true) },
            { id: 'theme', label: '切换 深色/浅色 主题', hint: '界面', run: () => void saveSettings({ theme: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark' }) },
            { id: 'sidebar', label: showLib ? '隐藏文献侧栏' : '显示文献侧栏', hint: '视图', run: () => setShowLib((v) => !v) },
            { id: 'panel', label: showSide ? '隐藏问答面板' : '显示问答面板', hint: '视图', run: () => setShowSide((v) => !v) },
            { id: 'reload', label: '重新加载窗口', hint: '视图', run: () => location.reload() }
          ]}
        />
      )}
    </div>
  )
}
