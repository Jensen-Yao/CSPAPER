import { useEffect, useMemo, useRef, useState } from 'react'
import type { Paper } from './types'
import { catLabel } from './LibraryPane'

interface Props {
  papers: Paper[]
  visible: boolean
  tab: 'table' | 'graph'
  onTabChange: (t: 'table' | 'graph') => void
  onOpen: (p: Paper) => void
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
export default function OverviewView({ papers, visible, tab, onTabChange, onOpen }: Props): JSX.Element {
  const [sortKey, setSortKey] = useState<SortKey>('title')
  const [asc, setAsc] = useState(true)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [files, setFiles] = useState<Record<number, string[]>>({})

  const sorted = useMemo(() => {
    const arr = [...papers]
    arr.sort((a, b) => {
      const va = (a[sortKey] ?? '') as string | number | null
      const vb = (b[sortKey] ?? '') as string | number | null
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va ?? '').localeCompare(String(vb ?? ''), 'zh')
      return asc ? cmp : -cmp
    })
    return arr
  }, [papers, sortKey, asc])

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
        <div className="ov-table-wrap">
          <table className="ov-table">
            <thead>
              <tr>
                <th style={{ width: 26 }} />
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
                    <td className="ov-chev">{expanded === p.id ? '⌄' : '›'}</td>
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
      ) : (
        <KnowledgeGraph papers={papers} visible={visible} onOpen={onOpen} />
      )}
    </div>
  )
}

// ---------- 知识网络：力导向图（零依赖 canvas 实现） ----------
interface GNode {
  id: number
  x: number
  y: number
  vx: number
  vy: number
  paper: Paper
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
  const [selected, setSelected] = useState<Paper | null>(null)
  const nodesRef = useRef<GNode[]>([])
  const rafRef = useRef(0)

  const cats = useMemo(() => [...new Set(papers.map((p) => p.category))], [papers])
  const catColor = (c: string): string => PALETTE[Math.max(0, cats.indexOf(c)) % PALETTE.length]

  // 构建节点与边：同分类 + 共同作者
  const build = (): void => {
    const w = wrapRef.current?.clientWidth ?? 900
    const h = wrapRef.current?.clientHeight ?? 600
    nodesRef.current = papers.map((p, i) => ({
      id: p.id,
      x: w / 2 + Math.cos((i / Math.max(1, papers.length)) * Math.PI * 2) * w * 0.28,
      y: h / 2 + Math.sin((i / Math.max(1, papers.length)) * Math.PI * 2) * h * 0.28,
      vx: 0,
      vy: 0,
      paper: p,
      color: catColor(p.category)
    }))
    const byId = new Map(nodesRef.current.map((n) => [n.id, n]))
    const edges: GEdge[] = []
    const authorsOf = (p: Paper): Set<string> => new Set(p.authors.split(/[,;，；]/).map((s) => s.trim()).filter(Boolean))
    for (let i = 0; i < papers.length; i++) {
      for (let j = i + 1; j < papers.length; j++) {
        let wgt = 0
        if (papers[i].category === papers[j].category) wgt += 1
        const ai = authorsOf(papers[i])
        const aj = authorsOf(papers[j])
        if ([...ai].some((a) => aj.has(a) && a)) wgt += 2
        if (wgt > 0 && byId.has(papers[i].id) && byId.has(papers[j].id)) edges.push({ a: papers[i].id, b: papers[j].id, w: wgt })
      }
    }
    edgesRef.current = edges
    dimsRef.current = { w, h }
  }

  const edgesRef = useRef<GEdge[]>([])
  const dimsRef = useRef<{ w: number; h: number }>({ w: 900, h: 600 })
  const selRef = useRef<Paper | null>(null)
  const hoverRef = useRef<GNode | null>(null)

  useEffect(() => {
    build()
    setSelected(null)
    selRef.current = null
  }, [papers])

  useEffect(() => {
    if (!visible) return
    let ticks = 0
    const step = (): void => {
      rafRef.current = requestAnimationFrame(step)
      const nodes = nodesRef.current
      const edges = edgesRef.current
      const { w, h } = dimsRef.current
      if (nodes.length === 0) return
      // 斥力
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j]
          let dx = b.x - a.x, dy = b.y - a.y
          let d2 = dx * dx + dy * dy
          if (d2 < 1) { dx = 1; dy = 1; d2 = 2 }
          const f = 2600 / d2
          const d = Math.sqrt(d2)
          a.vx -= (dx / d) * f; a.vy -= (dy / d) * f
          b.vx += (dx / d) * f; b.vy += (dy / d) * f
        }
      }
      // 弹簧
      for (const e of edges) {
        const a = nodes.find((n) => n.id === e.a), b = nodes.find((n) => n.id === e.b)
        if (!a || !b) continue
        const dx = b.x - a.x, dy = b.y - a.y
        const d = Math.sqrt(dx * dx + dy * dy) || 1
        const target = 220 / e.w
        const f = (d - target) * 0.012 * e.w
        a.vx += (dx / d) * f; a.vy += (dy / d) * f
        b.vx -= (dx / d) * f; b.vy -= (dy / d) * f
      }
      // 向心 + 阻尼 + 积分
      for (const n of nodes) {
        n.vx += (w / 2 - n.x) * 0.004
        n.vy += (h / 2 - n.y) * 0.004
        n.vx *= 0.86; n.vy *= 0.86
        n.x = Math.max(50, Math.min(w - 50, n.x + Math.max(-8, Math.min(8, n.vx))))
        n.y = Math.max(40, Math.min(h - 50, n.y + Math.max(-8, Math.min(8, n.vy))))
      }
      ticks++
      if (ticks > 1200) return // 收敛后停帧，仍可交互重绘
      draw()
    }
    const draw = (): void => {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')!
      const dpr = window.devicePixelRatio || 1
      const { w, h } = dimsRef.current
      canvas.width = w * dpr; canvas.height = h * dpr
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      const nodes = nodesRef.current
      const byId = new Map(nodes.map((n) => [n.id, n]))
      for (const e of edgesRef.current) {
        const a = byId.get(e.a), b = byId.get(e.b)
        if (!a || !b) continue
        ctx.strokeStyle = 'rgba(120,120,135,0.3)'
        ctx.lineWidth = 1 + e.w * 0.6
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
      }
      for (const n of nodes) {
        const r = selRef.current?.id === n.id ? 13 : hoverRef.current?.id === n.id ? 11 : 8
        ctx.beginPath()
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2)
        ctx.fillStyle = n.color
        ctx.fill()
        if (selRef.current?.id === n.id) {
          ctx.strokeStyle = n.color; ctx.lineWidth = 2
          ctx.beginPath(); ctx.arc(n.x, n.y, r + 5, 0, Math.PI * 2); ctx.stroke()
        }
        if (nodes.length <= 24 || hoverRef.current?.id === n.id || selRef.current?.id === n.id) {
          ctx.fillStyle = 'rgba(35,32,38,0.82)'
          ctx.font = '11px "Microsoft YaHei", sans-serif'
          const label = n.paper.title.slice(0, 22) + (n.paper.title.length > 22 ? '…' : '')
          ctx.fillText(label, n.x + r + 5, n.y + 4)
        }
      }
    }
    step()
    const onResize = (): void => {
      build()
      draw()
    }
    window.addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener('resize', onResize)
    }
  }, [visible, papers])

  const pick = (ev: React.MouseEvent): void => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const mx = ev.clientX - rect.left
    const my = ev.clientY - rect.top
    let hit: GNode | null = null
    for (const n of nodesRef.current) {
      if ((n.x - mx) ** 2 + (n.y - my) ** 2 < 15 ** 2) hit = n
    }
    hoverRef.current = hit
    if (hit) {
      setSelected(hit.paper)
      selRef.current = hit.paper
    }
  }

  return (
    <div className="ov-graph-wrap">
      <div className="ov-graph-head">
        <span className="hint">圆点=文献（颜色=分类），连线=同类 / 同作者关联。点击节点查看详情。</span>
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
        <canvas ref={canvasRef} onClick={pick} onMouseMove={pick} />
        {selected && (
          <div className="ov-sel">
            <div className="ov-sel-title">{selected.title}</div>
            <div className="ov-dim">
              {selected.authors || '—'} · {selected.venue || catLabel(selected.category)} {selected.year ? `· ${selected.year}` : ''}
            </div>
            <button className="cmp-mini" onClick={() => onOpen(selected)}>
              打开阅读
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
