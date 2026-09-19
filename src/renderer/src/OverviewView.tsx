import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { Paper, TagRow } from './types'
import { STATUS_KEYS, STATUS_META } from './types'
import { catLabel, statusMeta, withAlpha } from './LibraryPane'
import StatsView from './StatsView'

interface Props {
  papers: Paper[]
  visible: boolean
  tab: 'table' | 'graph' | 'stats'
  onTabChange: (t: 'table' | 'graph' | 'stats') => void
  onOpen: (p: Paper) => void
  onRefresh: () => void
  // v0.6 外部标签筛选（如左栏标签区联动传入）；与内部下拉叠加（内部优先）
  externalTagFilter?: string | null
}

type SortKey = 'title' | 'authors' | 'year' | 'venue' | 'category' | 'status' | 'cited'
type ColKey = SortKey | 'tags' | 'progress' // tags / progress 仅作列头展示，不参与排序

interface Col {
  key: ColKey
  label: string
  w: string
  sort?: boolean // false = 不可排序
}

const COLS: Col[] = [
  { key: 'title', label: '标题', w: '25%' },
  { key: 'authors', label: '作者', w: '13%' },
  { key: 'year', label: '年份', w: '6%' },
  { key: 'venue', label: '期刊 / 来源', w: '13%' },
  { key: 'category', label: '分类', w: '8%' },
  { key: 'status', label: '状态', w: '9%' },
  { key: 'tags', label: '标签', w: '11%', sort: false },
  { key: 'progress', label: '进度', w: '9%', sort: false },
  { key: 'cited', label: '被引', w: '6%' }
]

// 简单窗口化：行数超过该值时只渲染可视范围 ±OVERSCAN 行，用 spacer 行撑高度
const WIN_THRESHOLD = 300
const WIN_ROW_H = 36
const WIN_OVERSCAN = 20

const PALETTE = ['#5b4a3a', '#1558c0', '#1c7a2e', '#b06a00', '#6b21a8', '#0e7490', '#be185d', '#4d7c0f']

// 纵览：Zotero 式文献总表 + 知识网络（同类/同作者/共现关联的力导向图）
export default function OverviewView({ papers, visible, tab, onTabChange, onOpen, onRefresh, externalTagFilter }: Props): JSX.Element {
  const [sortKey, setSortKey] = useState<SortKey>('title')
  const [asc, setAsc] = useState(true)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [files, setFiles] = useState<Record<number, string[]>>({})
  const [catFilter, setCatFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [batchCat, setBatchCat] = useState('')
  const [batchBusy, setBatchBusy] = useState(false)

  // ---------- 标签（v0.6） ----------
  const [tags, setTags] = useState<TagRow[]>([])
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
  }, [papers])
  const tagColorMap = useMemo(() => new Map(tags.map((t) => [t.name, t.color])), [tags])
  const tagColor = (name: string): string => tagColorMap.get(name) ?? '#98a2ab'
  const [tagFilter, setTagFilter] = useState('')
  const effTag = tagFilter || externalTagFilter || ''

  // ---------- 阅读状态五态（v0.6）：乐观更新本地覆盖，setStatus 后 onRefresh 同步 ----------
  const [statusOverride, setStatusOverride] = useState<Record<number, string>>({})
  useEffect(() => setStatusOverride({}), [papers])
  const [statusMenu, setStatusMenu] = useState<{ id: number; x: number; y: number } | null>(null)
  const applyStatus = async (id: number, st: string): Promise<void> => {
    setStatusMenu(null)
    setStatusOverride((o) => ({ ...o, [id]: st }))
    try {
      await window.api.setStatus(id, st)
    } catch (e) {
      alert(String(e))
    }
    onRefresh()
  }

  // ---------- 被引（v0.6）：对当前筛选后的可见行批量更新 ----------
  const [citedBusy, setCitedBusy] = useState(false)
  const doCitedUpdate = async (): Promise<void> => {
    if (citedBusy || filtered.length === 0) return
    setCitedBusy(true)
    try {
      await window.api.citedUpdate(filtered.map((p) => p.id))
      onRefresh()
    } catch (e) {
      alert(String(e))
    } finally {
      setCitedBusy(false)
    }
  }

  const filtered = useMemo(() => {
    const cf = catFilter, sf = statusFilter, tf = effTag
    if (!cf && !sf && !tf) return papers
    return papers.filter(
      (p) => (!cf || p.category === cf) && (!sf || p.status === sf) && (!tf || (p.tags ?? []).includes(tf))
    )
  }, [papers, catFilter, statusFilter, effTag])

  const cats = useMemo(() => [...new Set(papers.map((p) => p.category))], [papers])

  // 批量移动分类：逐篇调用 movePaper（主进程内部改路径并保持高亮/状态）
  const applyBatchMove = async (): Promise<void> => {
    if (!batchCat || checked.size === 0) return
    setBatchBusy(true)
    try {
      for (const id of checked) await window.api.movePaper(id, batchCat)
      setChecked(new Set())
      onRefresh()
    } finally {
      setBatchBusy(false)
    }
  }

  const sorted = useMemo(() => {
    const arr = [...filtered]
    const val = (p: Paper): string | number => {
      if (sortKey === 'cited') return p.cited_by ?? -1
      return (p[sortKey] ?? '') as string | number
    }
    arr.sort((a, b) => {
      const va = val(a)
      const vb = val(b)
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'zh')
      return asc ? cmp : -cmp
    })
    return arr
  }, [filtered, sortKey, asc])

  // ---------- 简单窗口化：>300 行时只渲染可视范围 ±20 行（spacer 行撑高度） ----------
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const windowing = sorted.length > WIN_THRESHOLD
  const [range, setRange] = useState<[number, number]>([0, WIN_THRESHOLD + WIN_OVERSCAN * 2])
  useEffect(() => {
    const el = wrapRef.current
    if (!el || !windowing) {
      setRange([0, sorted.length])
      return
    }
    const calc = (): void => {
      const s = Math.max(0, Math.floor(el.scrollTop / WIN_ROW_H) - WIN_OVERSCAN)
      const e = Math.min(sorted.length, s + Math.ceil(el.clientHeight / WIN_ROW_H) + WIN_OVERSCAN * 2)
      setRange([s, e])
    }
    calc()
    el.addEventListener('scroll', calc, { passive: true })
    return () => el.removeEventListener('scroll', calc)
  }, [windowing, sorted.length])

  // ---------- 行内渲染小件 ----------
  // 标签列：圆点 + 名，最多 3 个，超出折叠为 +N
  const tagChips = (p: Paper): JSX.Element => {
    const ts = p.tags ?? []
    if (ts.length === 0) return <span className="ov-dim">—</span>
    return (
      <div className="tag-chips">
        {ts.slice(0, 3).map((t) => (
          <span key={t} className="tag-chip" title={t}>
            <i className="tag-dot" style={{ background: tagColor(t) }} />
            {t}
          </span>
        ))}
        {ts.length > 3 && (
          <span className="tag-chip more" title={ts.slice(3).join('、')}>
            +{ts.length - 3}
          </span>
        )}
      </div>
    )
  }
  // 进度列：last_page/n_pages 细进度条（无页数或未开始不显示）
  const progOf = (p: Paper): { pct: number; title: string } | null => {
    if (!p.n_pages || !p.last_page || p.last_page <= 0) return null
    const pct = Math.max(0, Math.min(100, Math.round((p.last_page / p.n_pages) * 100)))
    return { pct, title: `${p.last_page} / ${p.n_pages} 页 · ${pct}%` }
  }

  const toggleRow = async (p: Paper): Promise<void> => {
    if (expanded === p.id) return setExpanded(null)
    setExpanded(p.id)
    if (!files[p.id]) {
      try {
        const d = await window.api.paperDetail(p.id)
        setFiles((f) => ({ ...f, [p.id]: d?.files ?? [] }))
      } catch {
        setFiles((f) => ({ ...f, [p.id]: [] }))
      }
    }
  }

  return (
    <div className="ov-wrap">
      <div className="ov-tabs">
        <button className={`ov-tab ${tab === 'table' ? 'on' : ''}`} onClick={() => onTabChange('table')}>
          ☰ 文献表格
        </button>
        <button className={`ov-tab ${tab === 'graph' ? 'on' : ''}`} onClick={() => onTabChange('graph')}>
          ✦ 知识网络
        </button>
        <button className={`ov-tab ${tab === 'stats' ? 'on' : ''}`} onClick={() => onTabChange('stats')}>
          ▤ 统计
        </button>
        <span className="ov-count">{papers.length} 篇</span>
      </div>
      {tab === 'table' ? (
        <>
          <div className="ov-filters">
            <span className="ov-flabel">筛选</span>
            <select className="ov-filter" value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
              <option value="">全部分类</option>
              {cats.map((c) => (
                <option key={c} value={c}>
                  {catLabel(c)}
                </option>
              ))}
            </select>
            <select className="ov-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">全部状态</option>
              {STATUS_KEYS.map((k) => (
                <option key={k} value={k}>
                  {STATUS_META[k].label}
                </option>
              ))}
            </select>
            <select
              className="ov-filter"
              value={effTag}
              onChange={(e) => setTagFilter(e.target.value)}
              title="按标签筛选"
            >
              <option value="">全部标签</option>
              {tags.map((t) => (
                <option key={t.id} value={t.name}>
                  {t.name}（{t.count}）
                </option>
              ))}
            </select>
            <span style={{ flex: 1 }} />
            <button
              className="btn ghost"
              disabled={citedBusy || filtered.length === 0}
              title="联网更新当前可见文献的被引数"
              onClick={() => void doCitedUpdate()}
            >
              {citedBusy ? '更新中…' : '更新被引'}
            </button>
            {checked.size > 0 && (
              <>
                <span className="ov-batch-label">已选 {checked.size} 篇</span>
                <select className="ov-filter" value={batchCat} onChange={(e) => setBatchCat(e.target.value)}>
                  <option value="">移动到分类…</option>
                  {cats.map((c) => (
                    <option key={c} value={c}>
                      {catLabel(c)}
                    </option>
                  ))}
                </select>
                <button className="btn ghost" disabled={!batchCat || batchBusy} onClick={() => void applyBatchMove()}>
                  应用
                </button>
                <button className="btn ghost" onClick={() => setChecked(new Set())}>
                  取消选择
                </button>
              </>
            )}
          </div>
          <div className="ov-table-wrap" ref={wrapRef}>
          <table className={`ov-table ${windowing ? 'win' : ''}`}>
            <thead>
              <tr>
                <th style={{ width: 34 }}>
                  <input
                    type="checkbox"
                    checked={sorted.length > 0 && sorted.every((p) => checked.has(p.id))}
                    onChange={(e) => setChecked(e.target.checked ? new Set(sorted.map((p) => p.id)) : new Set())}
                  />
                </th>
                {COLS.map((c) => (
                  <th
                    key={c.key}
                    style={{ width: c.w }}
                    className={c.sort === false ? '' : 'sortable'}
                    onClick={() => {
                      if (c.key === 'tags' || c.key === 'progress') return
                      if (sortKey === c.key) setAsc(!asc)
                      else {
                        setSortKey(c.key)
                        setAsc(true)
                      }
                    }}
                  >
                    {c.label}
                    {sortKey === c.key && <span className="ov-arrow">{asc ? '↑' : '↓'}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {range[0] > 0 && (
                <tr className="ov-spacer" style={{ height: range[0] * WIN_ROW_H }}>
                  <td colSpan={COLS.length + 1} />
                </tr>
              )}
              {sorted.slice(range[0], range[1]).map((p) => (
                <Fragment key={p.id}>
                  <tr onClick={() => void toggleRow(p)} title="点击展开附件与信息；双击打开阅读" onDoubleClick={() => onOpen(p)}>
                    <td className="ov-check">
                      <input
                        type="checkbox"
                        checked={checked.has(p.id)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) =>
                          setChecked((prev) => {
                            const n = new Set(prev)
                            if (e.target.checked) n.add(p.id)
                            else n.delete(p.id)
                            return n
                          })
                        }
                      />
                    </td>
                    <td className="ov-title">{p.title}</td>
                    <td>{p.authors || '—'}</td>
                    <td>{p.year ?? '—'}</td>
                    <td>{p.venue || '—'}</td>
                    <td>{catLabel(p.category)}</td>
                    <td>
                      {(() => {
                        const m = statusMeta(statusOverride[p.id] ?? p.status)
                        return (
                          <span
                            className="status-pill"
                            style={{ color: m.color, background: withAlpha(m.color, 0.12), borderColor: withAlpha(m.color, 0.28) }}
                            title="点击选择阅读状态"
                            onClick={(e) => {
                              e.stopPropagation()
                              setStatusMenu({ id: p.id, x: e.clientX, y: e.clientY })
                            }}
                          >
                            {<i className="sp-newdot" style={{ background: m.color }} />}
                            <span>{m.label}</span>
                          </span>
                        )
                      })()}
                    </td>
                    <td>{tagChips(p)}</td>
                    <td>
                      {(() => {
                        const pr = progOf(p)
                        if (!pr) return null
                        return (
                          <div className="prog-wrap" title={pr.title}>
                            <div className="prog-bar">
                              <i style={{ width: `${pr.pct}%` }} />
                            </div>
                            <span className="prog-text">{pr.pct}%</span>
                          </div>
                        )
                      })()}
                    </td>
                    <td className="ov-cited">{p.cited_by ?? '—'}</td>
                  </tr>
                  {expanded === p.id && (
                    <tr className="ov-expand">
                      <td />
                      <td colSpan={COLS.length}>
                        <div className="ov-detail">
                          <div>
                            <b>{p.title}</b>
                            <div className="ov-dim">{p.slug} · 添加于 {(p.added_at || '').slice(0, 10)}</div>
                            {p.summary && <div className="ov-sum">{p.summary}</div>}
                          </div>
                          <div className="ov-actions">
                            <button className="cmp-mini" onClick={() => onOpen(p)}>
                              打开阅读
                            </button>
                          </div>
                        </div>
                        <div className="ov-files">
                          {(files[p.id] ?? []).map((f) => (
                            <span key={f} className="pd-file">
                              📄 {f}
                            </span>
                          ))}
                          {files[p.id]?.length === 0 && <span className="ov-dim">无附件</span>}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {range[1] < sorted.length && (
                <tr className="ov-spacer" style={{ height: (sorted.length - range[1]) * WIN_ROW_H }}>
                  <td colSpan={COLS.length + 1} />
                </tr>
              )}
            </tbody>
          </table>
          </div>
        </>
      ) : tab === 'graph' ? (
        <KnowledgeGraph papers={papers} visible={visible} onOpen={onOpen} />
      ) : (
        <StatsView visible={visible && tab === 'stats'} onOpen={(id) => { const p = papers.find((x) => x.id === id); if (p) onOpen(p) }} />
      )}

      {/* 阅读状态五选一小浮层 */}
      {statusMenu && (
        <>
          <div className="status-menu-mask" onMouseDown={() => setStatusMenu(null)} />
          <div
            className="status-menu"
            style={{
              left: Math.max(6, Math.min(statusMenu.x, window.innerWidth - 140)),
              top: Math.max(6, Math.min(statusMenu.y, window.innerHeight - 190))
            }}
          >
            {STATUS_KEYS.map((k) => {
              const m = STATUS_META[k]
              const cur = statusOverride[statusMenu.id] ?? papers.find((x) => x.id === statusMenu.id)?.status ?? ''
              return (
                <button
                  key={k}
                  className={`status-menu-item ${cur === k ? 'on' : ''}`}
                  onClick={() => void applyStatus(statusMenu.id, k)}
                >
                  {m.icon === '-new' ? <i className="sp-newdot" /> : <span className="sp-ico">{m.icon}</span>}
                  <span>{m.label}</span>
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}


// ---------- 知识网络：基于文本相似度的力导向图（边 = 语义关联强度，kNN 稀疏化） ----------
interface GNode {
  id: number
  title: string
  category: string
  degree: number
  x: number
  y: number
  vx: number
  vy: number
  color: string
}
interface GEdge {
  a: number
  b: number
  w: number
}

function KnowledgeGraph({ papers, visible, onOpen }: { papers: Paper[]; visible: boolean; onOpen: (p: Paper) => void }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [ready, setReady] = useState(false)
  const [resetTick, setResetTick] = useState(0)
  // 分类筛选：空 = 全库；选定分类只在该分类内构图（W13 反馈：知识网络要能按分类看）
  const [graphCat, setGraphCat] = useState('')
  const nodesRef = useRef<GNode[]>([])
  const edgesRef = useRef<GEdge[]>([])
  const dimsRef = useRef<{ w: number; h: number }>({ w: 900, h: 600 })
  const rafRef = useRef(0)
  const dragRef = useRef<GNode | null>(null)
  const hoverRef = useRef<number | null>(null)
  const selRef = useRef<number | null>(null)
  const paperById = useMemo(() => new Map(papers.map((p) => [p.id, p])), [papers])
  const graphCats = useMemo(() => [...new Set(papers.map((p) => p.category))].sort((a, b) => a.localeCompare(b)), [papers])

  useEffect(() => {
    if (!visible) return
    void window.api
      .graphData(graphCat || undefined)
      .then((g) => {
        const cats = [...new Set(g.nodes.map((n) => n.category))]
        const palette = ['#5b4a3a', '#1558c0', '#1c7a2e', '#b06a00', '#6b21a8', '#0e7490', '#be185d', '#4d7c0f']
        const w = wrapRef.current?.clientWidth || 900
        const h = wrapRef.current?.clientHeight || 600
        nodesRef.current = g.nodes.map((n, i) => ({
          ...n,
          color: palette[Math.max(0, cats.indexOf(n.category)) % palette.length],
          x: w / 2 + Math.cos((i / Math.max(1, g.nodes.length)) * Math.PI * 2) * w * 0.3,
          y: h / 2 + Math.sin((i / Math.max(1, g.nodes.length)) * Math.PI * 2) * h * 0.3,
          vx: 0,
          vy: 0
        }))
        edgesRef.current = g.edges
        dimsRef.current = { w, h }
        setReady(true)
        setSelected(null)
      })
      .catch(() => {})
  }, [visible, papers, resetTick, graphCat])

  useEffect(() => {
    if (!visible || !ready) return
    let ticks = 0
    const draw = (): void => {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')!
      const dpr = window.devicePixelRatio || 1
      const { w, h } = dimsRef.current
      canvas.width = w * dpr
      canvas.height = h * dpr
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      const nodes = nodesRef.current
      const byId = new Map(nodes.map((n) => [n.id, n]))
      const focus = hoverRef.current ?? selRef.current
      const neighbors = new Set<number>()
      if (focus != null) {
        neighbors.add(focus)
        for (const e of edgesRef.current) {
          if (e.a === focus) neighbors.add(e.b)
          if (e.b === focus) neighbors.add(e.a)
        }
      }
      for (const e of edgesRef.current) {
        const a = byId.get(e.a)
        const b = byId.get(e.b)
        if (!a || !b) continue
        const dim = focus != null && !(e.a === focus || e.b === focus)
        ctx.strokeStyle = dim ? 'rgba(130,125,140,0.08)' : `rgba(120,120,150,${0.22 + e.w * 0.6})`
        ctx.lineWidth = 0.8 + e.w * 2.4
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
      }
      for (const n of nodes) {
        const isSel = selRef.current === n.id
        const dim = focus != null && !neighbors.has(n.id)
        ctx.globalAlpha = dim ? 0.2 : 1
        const r = 7 + Math.min(6, n.degree * 1.6)
        ctx.beginPath()
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2)
        ctx.fillStyle = n.color
        ctx.fill()
        if (isSel) {
          ctx.strokeStyle = n.color
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.arc(n.x, n.y, r + 5, 0, Math.PI * 2)
          ctx.stroke()
        }
        ctx.globalAlpha = 1
        if (nodes.length <= 30 || hoverRef.current === n.id || isSel) {
          ctx.fillStyle = dim ? 'rgba(140,135,150,0.45)' : 'rgba(35,32,38,0.85)'
          ctx.font = '11px "Microsoft YaHei", sans-serif'
          ctx.fillText(n.title.slice(0, 24) + (n.title.length > 24 ? '…' : ''), n.x + r + 5, n.y + 4)
        }
      }
    }
    const step = (): void => {
      rafRef.current = requestAnimationFrame(step)
      const nodes = nodesRef.current
      const { w, h } = dimsRef.current
      if (nodes.length === 0) return
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i]
          const b = nodes[j]
          let dx = b.x - a.x
          let dy = b.y - a.y
          let d2 = dx * dx + dy * dy
          if (d2 < 1) {
            dx = 1
            dy = 1
            d2 = 2
          }
          const f = 2800 / d2
          const d = Math.sqrt(d2)
          a.vx -= (dx / d) * f
          a.vy -= (dy / d) * f
          b.vx += (dx / d) * f
          b.vy += (dy / d) * f
        }
      }
      for (const e of edgesRef.current) {
        const a = nodes.find((n) => n.id === e.a)
        const b = nodes.find((n) => n.id === e.b)
        if (!a || !b) continue
        const dx = b.x - a.x
        const dy = b.y - a.y
        const d = Math.sqrt(dx * dx + dy * dy) || 1
        const target = 230 / e.w
        const f = (d - target) * 0.012 * e.w
        a.vx += (dx / d) * f
        a.vy += (dy / d) * f
        b.vx -= (dx / d) * f
        b.vy -= (dy / d) * f
      }
      for (const n of nodes) {
        n.vx += (w / 2 - n.x) * 0.004
        n.vy += (h / 2 - n.y) * 0.004
        n.vx *= 0.86
        n.vy *= 0.86
        if (dragRef.current && dragRef.current.id === n.id) {
          n.vx = 0
          n.vy = 0
          continue
        }
        n.x = Math.max(50, Math.min(w - 50, n.x + Math.max(-8, Math.min(8, n.vx))))
        n.y = Math.max(40, Math.min(h - 50, n.y + Math.max(-8, Math.min(8, n.vy))))
      }
      ticks++
      if (ticks > 1500) return
      draw()
    }
    step()
    const onResize = (): void => {
      dimsRef.current = { w: wrapRef.current?.clientWidth || 900, h: wrapRef.current?.clientHeight || 600 }
    }
    window.addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener('resize', onResize)
    }
  }, [visible, ready])

  const nodeAt = (mx: number, my: number): GNode | null => {
    let hit: GNode | null = null
    for (const n of nodesRef.current) {
      if ((n.x - mx) ** 2 + (n.y - my) ** 2 < 16 ** 2) hit = n
    }
    return hit
  }
  const onHover = (ev: React.MouseEvent): void => {
    if (dragRef.current) return
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const hit = nodeAt(ev.clientX - rect.left, ev.clientY - rect.top)
    hoverRef.current = hit?.id ?? null
    canvas.style.cursor = hit ? 'pointer' : 'default'
  }
  const onDrag = (ev: React.MouseEvent): void => {
    const hit = dragRef.current
    if (!hit || !canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    hit.x = Math.max(40, Math.min(dimsRef.current.w - 40, ev.clientX - rect.left))
    hit.y = Math.max(30, Math.min(dimsRef.current.h - 30, ev.clientY - rect.top))
  }
  const onUp = (): void => {
    dragRef.current = null
  }
  const onDown = (ev: React.MouseEvent): void => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const hit = nodeAt(ev.clientX - rect.left, ev.clientY - rect.top)
    if (hit) dragRef.current = hit
  }
  const onSelect = (ev: React.MouseEvent): void => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const hit = nodeAt(ev.clientX - rect.left, ev.clientY - rect.top)
    if (hit) {
      selRef.current = hit.id
      setSelected(hit.id)
    } else {
      selRef.current = null
      setSelected(null)
    }
  }

  const selPaper = selected != null ? paperById.get(selected) ?? null : null
  const similar = useMemo(() => {
    if (selected == null) return []
    return edgesRef.current
      .filter((e) => e.a === selected || e.b === selected)
      .map((e) => ({ id: e.a === selected ? e.b : e.a, w: e.w }))
      .sort((x, y) => y.w - x.w)
      .map((s) => ({ ...s, paper: paperById.get(s.id) }))
      .filter((s) => s.paper)
  }, [selected, papers, paperById])

  const cats = useMemo(() => [...new Set(papers.map((p) => p.category))], [papers])
  const palette = ['#5b4a3a', '#1558c0', '#1c7a2e', '#b06a00', '#6b21a8', '#0e7490', '#be185d', '#4d7c0f']
  const catColor = (c: string): string => palette[Math.max(0, cats.indexOf(c)) % palette.length]

  return (
    <div className="ov-graph-wrap">
      <div className="ov-graph-head">
        <button className="ov-tab" title="重新排布节点" onClick={() => setResetTick((t) => t + 1)}>
          ↻ 重置布局
        </button>
        <select className="ov-filter" value={graphCat} onChange={(e) => setGraphCat(e.target.value)} title="只看某个分类内的知识网络">
          <option value="">全部分类</option>
          {graphCats.map((c) => (
            <option key={c} value={c}>
              {catLabel(c)}
            </option>
          ))}
        </select>
        <span className="hint">{graphCat ? `仅「${catLabel(graphCat)}」内构图` : '圆点 = 文献（颜色 = 分类，大小 = 关联数），连线粗细 = 内容相似度。点击查看详情，可拖拽节点。'}</span>
        <span className="ov-legend">
          {(graphCat ? cats.filter((c) => c === graphCat) : cats).map((c) => (
            <span key={c} className="ov-leg">
              <i style={{ background: catColor(c) }} />
              {catLabel(c)}
            </span>
          ))}
        </span>
      </div>
      <div className="ov-graph" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          onMouseMove={(e) => {
            onHover(e)
            onDrag(e)
          }}
          onMouseDown={onDown}
          onMouseUp={onSelect}
        />
        {selPaper && (
          <div className="ov-sel">
            <div className="ov-sel-title">{selPaper.title}</div>
            <div className="ov-dim">
              {selPaper.authors || '—'} · {selPaper.venue || catLabel(selPaper.category)} {selPaper.year ? `· ${selPaper.year}` : ''}
            </div>
            {similar.length > 0 && (
              <div className="ov-sim">
                <div className="ov-sim-title">相似文献</div>
                {similar.map((s) => (
                  <div
                    key={s.id}
                    className="ov-sim-row"
                    title={`${s.paper!.title}（关联度 ${Math.round(s.w * 100)}%）`}
                    onClick={() => {
                      selRef.current = s.id
                      setSelected(s.id)
                    }}
                  >
                    <span className="ellipsis">{s.paper!.title}</span>
                    <span className="ov-sim-w">{Math.round(s.w * 100)}%</span>
                  </div>
                ))}
              </div>
            )}
            <button className="cmp-mini" onClick={() => onOpen(selPaper)}>
              打开阅读
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
