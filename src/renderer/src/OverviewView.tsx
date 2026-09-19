import { useEffect, useMemo, useRef, useState } from 'react'
import type { Paper } from './types'
import { catLabel } from './LibraryPane'

interface Props {
  papers: Paper[]
  visible: boolean
  tab: 'table' | 'graph'
  onTabChange: (t: 'table' | 'graph') => void
  onOpen: (p: Paper) => void
  onRefresh: () => void
}

type SortKey = 'title' | 'authors' | 'year' | 'venue' | 'category' | 'status'

const COLS: Array<{ key: SortKey; label: string; w: string }> = [
  { key: 'title', label: '标题', w: '34%' },
  { key: 'authors', label: '作者', w: '20%' },
  { key: 'year', label: '年份', w: '8%' },
  { key: 'venue', label: '期刊 / 来源', w: '18%' },
  { key: 'category', label: '分类', w: '12%' },
  { key: 'status', label: '状态', w: '8%' }
]

const PALETTE = ['#98122e', '#1558c0', '#1c7a2e', '#b06a00', '#6b21a8', '#0e7490', '#be185d', '#4d7c0f']

// 纵览：Zotero 式文献总表 + 知识网络（同类/同作者/共现关联的力导向图）
export default function OverviewView({ papers, visible, tab, onTabChange, onOpen, onRefresh }: Props): JSX.Element {
  const [sortKey, setSortKey] = useState<SortKey>('title')
  const [asc, setAsc] = useState(true)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [files, setFiles] = useState<Record<number, string[]>>({})
  const [catFilter, setCatFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [batchCat, setBatchCat] = useState('')
  const [batchBusy, setBatchBusy] = useState(false)

  const filtered = useMemo(() => {
    const cf = catFilter, sf = statusFilter
    if (!cf && !sf) return papers
    return papers.filter((p) => (!cf || p.category === cf) && (!sf || p.status === sf))
  }, [papers, catFilter, statusFilter])

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
    arr.sort((a, b) => {
      const va = (a[sortKey] ?? '') as string | number | null
      const vb = (b[sortKey] ?? '') as string | number | null
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va ?? '').localeCompare(String(vb ?? ''), 'zh')
      return asc ? cmp : -cmp
    })
    return arr
  }, [filtered, sortKey, asc])

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
              <option value="unread">未读</option>
              <option value="reading">在读</option>
              <option value="read">已读</option>
            </select>
            <span style={{ flex: 1 }} />
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
          <div className="ov-table-wrap">
          <table className="ov-table">
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
                  <th key={c.key} style={{ width: c.w }} className="sortable" onClick={() => (sortKey === c.key ? setAsc(!asc) : (setSortKey(c.key), setAsc(true)))}>
                    {c.label}
                    {sortKey === c.key && <span className="ov-arrow">{asc ? '↑' : '↓'}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => (
                <>
                  <tr key={p.id} onClick={() => void toggleRow(p)} title="点击展开附件与信息；双击打开阅读" onDoubleClick={() => onOpen(p)}>
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
                      <span className={`ov-st st-${p.status}`}>{p.status === 'read' ? '已读' : p.status === 'reading' ? '在读' : '未读'}</span>
                    </td>
                  </tr>
                  {expanded === p.id && (
                    <tr key={`${p.id}-x`} className="ov-expand">
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
                </>
              ))}
            </tbody>
          </table>
          </div>
        </>
      ) : (
        <KnowledgeGraph papers={papers} visible={visible} onOpen={onOpen} />
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
  const nodesRef = useRef<GNode[]>([])
  const edgesRef = useRef<GEdge[]>([])
  const dimsRef = useRef<{ w: number; h: number }>({ w: 900, h: 600 })
  const rafRef = useRef(0)
  const dragRef = useRef<GNode | null>(null)
  const hoverRef = useRef<number | null>(null)
  const selRef = useRef<number | null>(null)
  const paperById = useMemo(() => new Map(papers.map((p) => [p.id, p])), [papers])

  useEffect(() => {
    if (!visible) return
    void window.api
      .graphData()
      .then((g) => {
        const cats = [...new Set(g.nodes.map((n) => n.category))]
        const palette = ['#98122e', '#1558c0', '#1c7a2e', '#b06a00', '#6b21a8', '#0e7490', '#be185d', '#4d7c0f']
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
      })
      .catch(() => {})
  }, [visible, papers, resetTick])

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
  const palette = ['#98122e', '#1558c0', '#1c7a2e', '#b06a00', '#6b21a8', '#0e7490', '#be185d', '#4d7c0f']
  const catColor = (c: string): string => palette[Math.max(0, cats.indexOf(c)) % palette.length]

  return (
    <div className="ov-graph-wrap">
      <div className="ov-graph-head">
        <button className="ov-tab" title="重新排布节点" onClick={() => setResetTick((t) => t + 1)}>
          ↻ 重置布局
        </button>
        <span className="hint">圆点 = 文献（颜色 = 分类，大小 = 关联数），连线粗细 = 内容相似度。点击查看详情，可拖拽节点。</span>
        <span className="ov-legend">
          {cats.map((c) => (
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
