import { useEffect, useMemo, useRef, useState } from 'react'
import type { DeepHit, Paper, TagRow } from './types'
import { STATUS_META } from './types'

interface Props {
  papers: Paper[]
  cats: string[]
  activeId: number | null
  q: string
  onSetQ: (q: string) => void
  onOpen: (p: Paper) => void
  onOpenHit?: (p: Paper, hit: DeepHit) => void
  onCycleStatus: (p: Paper) => void
  onAddPapers: () => void
  onNewChat: () => void
  onMovePaper: (id: number, cat: string) => void
  onReindex: () => void
  onBack: () => void
  onFwd: () => void
  canBack: boolean
  canFwd: boolean
  onOpenPalette: () => void
  mode: 'read' | 'chat' | 'compare' | 'overview' | 'notes' | 'web'
  onModeChange: (m: 'read' | 'chat' | 'compare' | 'overview' | 'notes' | 'web') => void
  width: number
  onPapersChanged: () => void
  // v0.6 标签筛选：组件内部自持状态；若上层传入 activeTag 则受控，
  // 筛选变化通过 onTagFilter 通知（App 侧可据此联动纵览/卡片墙）
  activeTag?: string | null
  onTagFilter?: (tag: string | null) => void
}

// 标签预设色板（8 色，暖墨优先，与纵览分类配色一致）
export const TAG_COLORS = ['#5b4a3a', '#1558c0', '#1c7a2e', '#b06a00', '#6b21a8', '#0e7490', '#be185d', '#4d7c0f']

// 阅读状态五态元数据（历史数据里有旧三态 'done'，兜底映射到 'read'）
export const statusMeta = (s: string): { label: string; icon: string; color: string } =>
  STATUS_META[s] ?? (s === 'done' ? STATUS_META.read : STATUS_META.unread)

// #rrggbb → rgba(...,a)，用于状态角标/胶囊的透明底；非十六进制输入原样返回
export const withAlpha = (hex: string, a: number): string => {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!m) return hex
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

// sqlite datetime('now') 是 UTC 无时区后缀，补 Z 再解析
const relTime = (s?: string | null): string => {
  if (!s) return ''
  const d = new Date(s.replace(' ', 'T') + 'Z')
  if (isNaN(d.getTime())) return ''
  const diff = (Date.now() - d.getTime()) / 1000
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
  if (diff < 172800) return '昨天'
  if (diff < 2592000) return `${Math.floor(diff / 86400)} 天前`
  return d.toISOString().slice(0, 10)
}

// 分类显示名：inbox 是「未分类」的内部目录名，界面上统一显示中文
export const catLabel = (c: string): string => (c === 'inbox' ? '未分类' : c)

export default function LibraryPane({
  papers,
  cats,
  activeId,
  q,
  onSetQ,
  onOpen,
  onOpenHit,
  onCycleStatus,
  onAddPapers,
  onNewChat,
  onMovePaper,
  onReindex,
  onBack,
  onFwd,
  canBack,
  canFwd,
  onOpenPalette,
  mode,
  onModeChange,
  width,
  onPapersChanged,
  activeTag,
  onTagFilter
}: Props): JSX.Element {
  // ---------- 标签系统（v0.6） ----------
  const [tags, setTags] = useState<TagRow[]>([])
  const [tagsVer, setTagsVer] = useState(0) // 增删改标签后手动递增触发重拉
  useEffect(() => {
    let on = true
    window.api
      .tagsList()
      .then((t) => {
        if (on) setTags(t)
      })
      .catch(() => {})
    return () => {
      on = false
    }
  }, [papers, tagsVer])
  const bumpTags = (): void => setTagsVer((v) => v + 1)

  // 选中标签：activeTag 传入时受控，否则内部自持；变化经 onTagFilter 通知上层
  const [innerTag, setInnerTag] = useState<string | null>(null)
  const selectedTag = activeTag !== undefined ? activeTag : innerTag
  const applyTagFilter = (t: string | null): void => {
    setInnerTag(t)
    onTagFilter?.(t)
  }

  // 按标签过滤后的视图（最近 / 分类树 / 搜索结果共用）
  const papersView = useMemo(
    () => (selectedTag ? papers.filter((p) => (p.tags ?? []).includes(selectedTag)) : papers),
    [papers, selectedTag]
  )

  // 标签右键菜单（简易浮层：重命名 / 改色 / 删除）
  const [tagMenu, setTagMenu] = useState<{ x: number; y: number; tag: TagRow } | null>(null)

  const onCreateTag = async (): Promise<void> => {
    const name = window.prompt('新建标签（名称）')
    const n = name?.trim()
    if (!n) return
    try {
      await window.api.tagsCreate(n)
      bumpTags()
    } catch (e) {
      alert(String(e))
    }
  }
  const doRenameTag = async (): Promise<void> => {
    if (!tagMenu) return
    const { tag } = tagMenu
    const name = window.prompt('重命名标签', tag.name)
    const n = name?.trim()
    if (!n || n === tag.name) {
      setTagMenu(null)
      return
    }
    try {
      await window.api.tagsRename(tag.id, n)
      if (selectedTag === tag.name) applyTagFilter(n)
      setTagMenu(null)
      bumpTags()
      onPapersChanged() // 文献上的 tags 字段含旧名，需刷新
    } catch (e) {
      alert(String(e))
    }
  }
  const doSetTagColor = async (color: string): Promise<void> => {
    if (!tagMenu) return
    try {
      await window.api.tagsSetColor(tagMenu.tag.id, color)
      setTagMenu(null)
      bumpTags()
    } catch (e) {
      alert(String(e))
    }
  }
  const doDeleteTag = async (): Promise<void> => {
    if (!tagMenu) return
    const { tag } = tagMenu
    if (!window.confirm(`删除标签「${tag.name}」？将从所有文献上移除该标签。`)) {
      setTagMenu(null)
      return
    }
    try {
      await window.api.tagsDelete(tag.id)
      if (selectedTag === tag.name) applyTagFilter(null)
      setTagMenu(null)
      bumpTags()
      onPapersChanged()
    } catch (e) {
      alert(String(e))
    }
  }

  const tree = useMemo(() => {
    // 分类树 = 数据库分类列表（含空分类）+ 兜底（行里有但列表漏掉的）
    const m = new Map<string, Paper[]>(cats.map((c) => [c, []]))
    for (const p of papersView) {
      if (!m.has(p.category)) m.set(p.category, [])
      m.get(p.category)!.push(p)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [papersView, cats])

  // 最近：最近打开优先，没打开过的按导入时间（新导入的自然置顶）
  const recent = useMemo(
    () =>
      [...papersView]
        .sort((a, b) => (b.opened_at ?? b.added_at).localeCompare(a.opened_at ?? a.added_at))
        .slice(0, 60),
    [papersView]
  )

  const [view, setView] = useState<'recent' | 'cats'>('recent')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggle = (c: string): void =>
    setExpanded((s) => {
      const n = new Set(s)
      if (n.has(c)) n.delete(c)
      else n.add(c)
      return n
    })

  const kw = q.trim().toLowerCase()
  const match = (p: Paper): boolean => !kw || p.title.toLowerCase().includes(kw) || p.authors.toLowerCase().includes(kw) || p.slug.includes(kw)
  const searching = kw.length > 0

  // 深度搜索：标题命中之外，再搜正文与划词笔记，展示命中片段
  // 注意：依赖只留关键词——papers 数组在后台索引时会频繁换新，挂进依赖会不断重置防抖
  const [deep, setDeep] = useState<DeepHit[]>([])
  useEffect(() => {
    if (!searching || kw.length < 2) {
      setDeep([])
      return
    }
    const t = setTimeout(() => {
      void window.api
        .deepSearch(kw)
        .then(setDeep)
        .catch(() => setDeep([]))
    }, 350)
    return () => clearTimeout(t)
  }, [kw, searching])
  const deepMap = useMemo(() => new Map(deep.map((h) => [h.id, h])), [deep])
  const extraDeep = deep.filter((h) => !papersView.some((p) => p.id === h.id && match(p)))

  // 拖拽移动文献：拖到分类头放下
  const [dragCat, setDragCat] = useState<string | null>(null)
  const onRowDragStart = (e: React.DragEvent, p: Paper): void => {
    e.dataTransfer.setData('text/plain', `paper:${p.id}`)
    e.dataTransfer.effectAllowed = 'move'
  }
  const onCatDrop = (e: React.DragEvent, c: string): void => {
    e.preventDefault()
    e.stopPropagation()
    setDragCat(null)
    const raw = e.dataTransfer.getData('text/plain')
    const id = raw.startsWith('paper:') ? parseInt(raw.slice(6)) : NaN
    if (!isNaN(id)) onMovePaper(id, c)
  }

  // ---------- 弹窗：重命名 / 新建分类 / 移入新分类 / 重命名文献 ----------
  const [renameCat, setRenameCat] = useState<string | null>(null)
  const [renameVal, setRenameVal] = useState('')
  const [renaming, setRenaming] = useState(false)
  useEffect(() => window.api.onCategoryRenameRequest((cat) => {
    setRenameCat(cat)
    setRenameVal(cat)
  }), [])

  const [renamePaper, setRenamePaper] = useState<{ id: number; title: string } | null>(null)
  const [renamePaperVal, setRenamePaperVal] = useState('')
  const [renamingPaper, setRenamingPaper] = useState(false)
  useEffect(() => window.api.onPapersRenameRequest(({ id, title }) => {
    setRenamePaper({ id, title })
    setRenamePaperVal(title)
  }), [])

  const doRenamePaper = async (): Promise<void> => {
    if (!renamePaper || !renamePaperVal.trim() || renamingPaper) return
    setRenamingPaper(true)
    try {
      await window.api.renamePaper(renamePaper.id, renamePaperVal.trim())
      setRenamePaper(null)
      onPapersChanged()
    } catch (e) {
      alert(String(e))
    } finally {
      setRenamingPaper(false)
    }
  }

  const [newCat, setNewCat] = useState<null | { paper?: Paper }>(null) // paper 存在 = 移动这篇并新建
  const [newCatVal, setNewCatVal] = useState('')
  const [creating, setCreating] = useState(false)
  useEffect(() => window.api.onCategoryCreateRequest(() => {
    setNewCat({})
    setNewCatVal('')
  }), [])
  useEffect(() => window.api.onMoveNewRequest(({ id }) => {
    const p = papers.find((x) => x.id === id)
    setNewCat({ paper: p })
    setNewCatVal('')
  }), [papers])

  const doRename = async (): Promise<void> => {
    if (!renameCat || !renameVal.trim() || renaming) return
    setRenaming(true)
    try {
      await window.api.renameCategory(renameCat, renameVal.trim())
      setRenameCat(null)
      onPapersChanged()
    } catch (e) {
      alert(String(e))
    } finally {
      setRenaming(false)
    }
  }
  const doCreateCat = async (): Promise<void> => {
    const name = newCatVal.trim()
    if (!newCat || !name || creating) return
    setCreating(true)
    try {
      if (newCat.paper) await window.api.movePaper(newCat.paper.id, name)
      else await window.api.createCategory(name)
      setNewCat(null)
      onPapersChanged()
    } catch (e) {
      alert(String(e))
    } finally {
      setCreating(false)
    }
  }

  const navBtn = (dir: 'back' | 'fwd'): JSX.Element => (
    <button className="icon-btn" disabled={dir === 'back' ? !canBack : !canFwd} title={dir === 'back' ? '上一篇' : '下一篇'} onClick={dir === 'back' ? onBack : onFwd}>
      {dir === 'back' ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 18l6-6-6-6" />
        </svg>
      )}
    </button>
  )

  const paperRow = (p: Paper, extra?: React.ReactNode, snippet?: DeepHit): JSX.Element => (
    <div
      key={p.id}
      className={`paper-item ${p.id === activeId ? 'active' : ''}`}
      draggable
      onDragStart={(e) => onRowDragStart(e, p)}
      onClick={() => onOpen(p)}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        window.api.paperMenu(p.id, e.clientX, e.clientY)
      }}
      title="拖到分类上可移动；右键更多操作"
    >
      <div className="t">{p.title}</div>
      <div className="m">
        <span
          className="status-dot"
          style={{ background: statusMeta(p.status).color }}
          title={`${statusMeta(p.status).label}（点击切换）`}
          onClick={(e) => {
            e.stopPropagation()
            onCycleStatus(p)
          }}
        />
        <span>{p.year ?? '—'}</span>
        {extra ?? <span className="cat">{catLabel(p.category)}</span>}
      </div>
      {snippet && (
        <div className="deep-snip">
          {snippet.from === 'note' ? '🖍' : '📄'} {snippet.page ? `p.${snippet.page} · ` : ''}
          {snippet.snippet}
        </div>
      )}
    </div>
  )

  return (
    <div className="library" style={{ width }}>
      <div className="lib-func">
        {/* 阅读 / 对话 模式切换（Kimi Workspace 式分段控件） */}
        <div className="mode-toggle">
          <button className={mode === 'read' ? 'on' : ''} onClick={() => onModeChange('read')} title="论文阅读（PDF + 翻译 + 问答）">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 6c-1.8-1.6-4.2-2-8-2v14c3.8 0 6.2.4 8 2 1.8-1.6 4.2-2 8-2V4c-3.8 0-6.2.4-8 2z" />
              <path d="M12 6v14" />
            </svg>
            阅读
          </button>
          <button className={mode === 'chat' ? 'on' : ''} onClick={() => onModeChange('chat')} title="与全库文献对话（RAG）">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a8 8 0 0 1-8 8H4l2.2-2.6A8 8 0 1 1 21 12z" />
            </svg>
            对话
          </button>
          <button className={mode === 'compare' ? 'on' : ''} onClick={() => onModeChange('compare')} title="多篇文献横向对比（AI 提取要点 + 页码出处）">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M3 10h18M9 4v16M15 4v16" />
            </svg>
            对比
          </button>
          <button className={mode === 'overview' ? 'on' : ''} onClick={() => onModeChange('overview')} title="文献总表与知识网络">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="6" cy="6" r="2.6" />
              <circle cx="18" cy="7" r="2.6" />
              <circle cx="12" cy="17" r="2.6" />
              <path d="M7.8 7.6L10.5 15M16.6 9l-3.2 6M8.6 6.4l6.8 .4" />
            </svg>
            纵览
          </button>
          <button className={mode === 'notes' ? 'on' : ''} onClick={() => onModeChange('notes')} title="我的笔记与划词标注（全库聚合）">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 4h11l3 3v13H5z" />
              <path d="M8.5 9.5h7M8.5 13h7M8.5 16.5h4.5" />
            </svg>
            笔记
          </button>
          <button className={mode === 'web' ? 'on' : ''} onClick={() => onModeChange('web')} title="内置文献浏览器（知网 / arXiv 等站点直达，一键保存入库）">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3z" />
            </svg>
            网页
          </button>
        </div>
        <div className="nav-row">
          {navBtn('back')}
          {navBtn('fwd')}
          <span className="nav-label">文献</span>
          <span style={{ flex: 1 }} />
          <span className="cat-count">{papersView.length}</span>
        </div>
        <button className="add-btn" onClick={onAddPapers} title="导入 PDF，AI 自动归类；也可拖入窗口">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
            <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          添加文献
        </button>
        <button className="new-chat-btn" onClick={onNewChat} title="清空并开始新的全库对话">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 21c-4.4 0-8-3.1-8-7 0-2.2 1.2-4.2 3-5.5V4l3.2 1.8c.6-.1 1.2-.2 1.8-.2 4.4 0 8 3.1 8 7s-3.6 7-8 7z" />
            <path d="M12 7.5v5M9.5 10h5" />
          </svg>
          新建对话
        </button>
        <div className="search-wrap">
          <input className="searchbox" placeholder="搜索" value={q} onChange={(e) => onSetQ(e.target.value)} />
          <button className="kbd-hint" title="命令面板（搜索文献 / 执行命令）" onClick={onOpenPalette}>
            {/Mac/.test(navigator.platform) ? '⌘K' : 'Ctrl K'}
          </button>
        </div>
        <div className="func-row">
          <button className="mini-btn" onClick={onReindex} title="清空并重建全库索引">
            重建索引
          </button>
        </div>
      </div>
      <div className="lib-files">
        {/* 文件区子标签：不透明背景，滚动内容不会从后面穿过去 */}
        {!searching && (
          <div className="lib-view-toggle">
            <div className="lib-view-seg">
              <button className={view === 'recent' ? 'on' : ''} onClick={() => setView('recent')} title="最近导入 / 最近打开">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="8.5" />
                  <path d="M12 7.5V12l3 2" />
                </svg>
                最近
              </button>
              <button className={view === 'cats' ? 'on' : ''} onClick={() => setView('cats')} title="按分类浏览">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                </svg>
                分类
              </button>
            </div>
            <span style={{ flex: 1 }} />
            <button className="lib-newcat" title="新建分类" onClick={() => { setNewCat({}); setNewCatVal('') }}>
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              新建分类
            </button>
          </div>
        )}
        <div
          className="lib-files-scroll"
          onContextMenu={(e) => {
            e.preventDefault()
            window.api.blankMenu(e.clientX, e.clientY)
          }}
        >
          {searching ? (
            <>
              <div className="lib-section">搜索结果 · {papersView.filter(match).length}</div>
              {papersView.filter(match).map((p) => paperRow(p, undefined, deepMap.get(p.id)))}
              {extraDeep.length > 0 && (
                <>
                  <div className="lib-section">正文 / 笔记匹配 · {extraDeep.length}</div>
                  {extraDeep.map((h) => {
                    const p = papers.find((x) => x.id === h.id)
                    return (
                      <div
                        key={`${h.id}-${h.page}-${h.from}`}
                        className="paper-item deep"
                        onClick={() => p && onOpen(p)}
                        title={h.snippet}
                      >
                        <div className="t">{p?.title ?? h.title}</div>
                        <div className="deep-snip">
                          {h.from === 'note' ? '🖍' : '📄'} {h.page ? `p.${h.page} · ` : ''}
                          {h.snippet}
                        </div>
                      </div>
                    )
                  })}
                </>
              )}
            </>
          ) : view === 'recent' ? (
            <>
              <div className="lib-section">最近导入 / 打开</div>
              {recent.map((p) =>
                paperRow(
                  p,
                  <>
                    <span className="cat">{catLabel(p.category)}</span>
                    <span title={`导入 ${p.added_at.slice(0, 10)}${p.opened_at ? ` · 打开 ${p.opened_at.slice(0, 10)}` : ''}`}>
                      {p.opened_at ? relTime(p.opened_at) : relTime(p.added_at)}
                    </span>
                  </>
                )
              )}
            </>
          ) : (
            tree.map(([c, list]) => (
              <div key={c}>
                <div
                  className={`cat-item ${dragCat === c ? 'drop-on' : ''}`}
                  onClick={() => toggle(c)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    window.api.categoryMenu(c, e.clientX, e.clientY)
                  }}
                  onDragOver={(e) => {
                    if (e.dataTransfer.types.includes('text/plain')) {
                      e.preventDefault()
                      e.stopPropagation()
                      setDragCat(c)
                    }
                  }}
                  onDragLeave={() => setDragCat((d) => (d === c ? null : d))}
                  onDrop={(e) => onCatDrop(e, c)}
                  title="点击展开 / 收起；右键重命名、导出；拖文献到此移动"
                >
                  <svg
                    className={`chev ${expanded.has(c) ? 'open' : ''}`}
                    width="11"
                    height="11"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                  <span className="ellipsis" style={{ flex: 1 }}>
                    {catLabel(c)}
                  </span>
                  <span className="cat-count">{list.length}</span>
                </div>
                {expanded.has(c) && (
                  <div className="tree-papers">
                    {list.map((p) => paperRow(p))}
                    {list.length === 0 && <div className="tree-empty">空分类，右键可删除；拖文献进来或导入时 AI 归类</div>}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
        {/* 标签区：点击筛选，右键重命名 / 改色 / 删除，「＋」新建 */}
        <div className="tag-section">
          <div className="tag-section-head">
            <span className="tag-section-title">标签{selectedTag ? ` · ${selectedTag}` : ''}</span>
            <span style={{ flex: 1 }} />
            <button className="tag-add-btn" title="新建标签" onClick={() => void onCreateTag()}>
              ＋
            </button>
          </div>
          <div className="tag-list">
            {tags.length === 0 ? (
              <div className="tag-empty">暂无标签</div>
            ) : (
              tags.map((t) => (
                <div
                  key={t.id}
                  className={`tag-row ${selectedTag === t.name ? 'active' : ''}`}
                  onClick={() => applyTagFilter(selectedTag === t.name ? null : t.name)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setTagMenu({ x: e.clientX, y: e.clientY, tag: t })
                  }}
                  title="点击按标签筛选（再点取消）；右键重命名 / 改色 / 删除"
                >
                  <i className="tag-dot" style={{ background: t.color }} />
                  <span className="tag-name">{t.name}</span>
                  <span className="tag-count">{t.count}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {renameCat && (
        <div className="modal-mask" onMouseDown={() => setRenameCat(null)}>
          <div className="modal modal-pad" style={{ width: 440 }} onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>重命名分类</h2>
              <button className="modal-x" title="取消" onClick={() => setRenameCat(null)}>
                ✕
              </button>
            </div>
            <div className="field">
              <label>新名称（小写字母 / 数字 / 连字符）</label>
              <input
                autoFocus
                value={renameVal}
                onChange={(e) => setRenameVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void doRename()
                }}
              />
              <div className="hint">分类文件夹将改名并入，论文的阅读状态与高亮保持不变。</div>
            </div>
            <div className="modal-actions">
              <span style={{ flex: 1 }} />
              <button className="btn ghost" onClick={() => setRenameCat(null)}>
                取消
              </button>
              <button className="btn" onClick={() => void doRename()} disabled={renaming}>
                确认重命名
              </button>
            </div>
          </div>
        </div>
      )}

      {renamePaper && (
        <div className="modal-mask" onMouseDown={() => setRenamePaper(null)}>
          <div className="modal modal-pad" style={{ width: 460 }} onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>重命名文献</h2>
              <button className="modal-x" title="取消" onClick={() => setRenamePaper(null)}>
                ✕
              </button>
            </div>
            <div className="field">
              <label>标题</label>
              <input
                autoFocus
                value={renamePaperVal}
                onChange={(e) => setRenamePaperVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void doRenamePaper()
                }}
              />
              <div className="hint">只改显示标题与检索信息，PDF 文件与阅读进度、高亮不受影响。</div>
            </div>
            <div className="modal-actions">
              <span style={{ flex: 1 }} />
              <button className="btn ghost" onClick={() => setRenamePaper(null)}>
                取消
              </button>
              <button className="btn" onClick={() => void doRenamePaper()} disabled={renamingPaper || !renamePaperVal.trim()}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {newCat && (
        <div className="modal-mask" onMouseDown={() => setNewCat(null)}>
          <div className="modal modal-pad" style={{ width: 440 }} onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>{newCat.paper ? '新建分类并移入' : '新建分类'}</h2>
              <button className="modal-x" title="取消" onClick={() => setNewCat(null)}>
                ✕
              </button>
            </div>
            <div className="field">
              <label>{newCat.paper ? `分类名（将把《${newCat.paper.title.slice(0, 40)}…》移入）` : '分类名（可用中文）'}</label>
              <input
                autoFocus
                value={newCatVal}
                onChange={(e) => setNewCatVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void doCreateCat()
                }}
              />
              <div className="hint">新建后可在导入归类、右键移动与拖拽中使用；空分类可右键删除。</div>
            </div>
            <div className="modal-actions">
              <span style={{ flex: 1 }} />
              <button className="btn ghost" onClick={() => setNewCat(null)}>
                取消
              </button>
              <button className="btn" onClick={() => void doCreateCat()} disabled={creating || !newCatVal.trim()}>
                {newCat.paper ? '移入' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 标签右键菜单：重命名 / 改色（8 色小色板）/ 删除 */}
      {tagMenu && (
        <>
          <div
            className="tag-menu-mask"
            onMouseDown={() => setTagMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault()
              setTagMenu(null)
            }}
          />
          <div
            className="tag-menu"
            style={{
              left: Math.max(6, Math.min(tagMenu.x, window.innerWidth - 210)),
              top: Math.max(6, Math.min(tagMenu.y, window.innerHeight - 140))
            }}
          >
            <div className="tag-menu-head">
              <i className="tag-dot" style={{ background: tagMenu.tag.color }} />
              <span className="ellipsis">{tagMenu.tag.name}</span>
            </div>
            <button className="tag-menu-item" onClick={() => void doRenameTag()}>
              重命名
            </button>
            <div className="tag-menu-item colors">
              <span>改色</span>
              <span className="tag-swatches">
                {TAG_COLORS.map((c) => (
                  <i
                    key={c}
                    className={`tag-swatch ${tagMenu.tag.color.toLowerCase() === c.toLowerCase() ? 'on' : ''}`}
                    style={{ background: c }}
                    title={c}
                    onClick={() => void doSetTagColor(c)}
                  />
                ))}
              </span>
            </div>
            <button className="tag-menu-item danger" onClick={() => void doDeleteTag()}>
              删除…
            </button>
          </div>
        </>
      )}
    </div>
  )
}
