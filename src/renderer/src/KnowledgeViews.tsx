import { useEffect, useMemo, useRef, useState } from 'react'
import type { Paper, TagRow } from './types'
import { catLabel, withAlpha } from './LibraryPane'
import './knowledge.css'

/* ============================================================
   知识体系（纵览「知识」tab）
   相似网络 / 关键词共现 / 作者合作 / 主题星系 / 知识库
   对标 CiteSpace / VOSviewer 范式：共现网络 + 聚类星系 + 知识沉淀
   ============================================================ */

const PALETTE = ['#5b4a3a', '#1558c0', '#1c7a2e', '#b06a00', '#6b21a8', '#0e7490', '#be185d', '#4d7c0f']

// hex 混色（频次渐变着色用），返回 rgb() 字符串
function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16)
  const pb = parseInt(b.slice(1), 16)
  const r = Math.round(((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t)
  const g = Math.round(((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t)
  const bl = Math.round((pa & 255) * (1 - t) + (pb & 255) * t)
  return `rgb(${r}, ${g}, ${bl})`
}
const isDarkTheme = (): boolean => document.documentElement.getAttribute('data-theme') === 'dark'

// 可复现的伪随机（主题星系重掷布局用）
function seededRng(seed: number): () => number {
  let s = seed % 2147483647
  if (s <= 0) s += 2147483646
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

// ---------- API 返回结构（与 types.ts 声明一致，局部重写避免耦合） ----------
interface KwData {
  nodes: Array<{ id: string; n: number; papers: number[] }>
  edges: Array<{ a: string; b: string; w: number }>
}
interface AuData {
  nodes: Array<{ id: string; n: number }>
  edges: Array<{ a: string; b: string; w: number }>
}
interface TopicT {
  label: string
  keywords: string[]
  paperIds: number[]
}

// ---------- 力导向画布通用引擎（关键词/作者共用） ----------
// 节点描述由父层给定（id/label/半径/颜色），引擎负责布局初始化、
// 预跑收敛、rAF 拖拽交互与绘制；选中状态受控（selected/onSelect）。
interface FgDesc {
  id: string
  label: string
  r: number
  color: string
  pinned?: boolean // true = 无边的孤立节点：钉在外缘小圆位置
}
interface FgNode extends FgDesc {
  x: number
  y: number
  vx: number
  vy: number
  ax: number // pinned 节点的锚点
  ay: number
}
interface FgEdge {
  a: string
  b: string
  w: number
}

function ForceGraph({
  visible,
  nodes,
  edges,
  selected,
  onSelect,
  springTarget,
  emptyText,
  labelMax = 36
}: {
  visible: boolean
  nodes: FgDesc[]
  edges: FgEdge[]
  selected: string | null
  onSelect: (id: string | null) => void
  springTarget: (w: number) => number
  emptyText: string
  labelMax?: number
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const nodesRef = useRef<FgNode[]>([])
  const edgesRef = useRef<FgEdge[]>([])
  const dimsRef = useRef<{ w: number; h: number }>({ w: 900, h: 600 })
  const rafRef = useRef(0)
  const dragRef = useRef<FgNode | null>(null)
  const hoverRef = useRef<string | null>(null)
  const selRef = useRef<string | null>(null)
  const ticksRef = useRef(0)
  const darkRef = useRef(false)
  const selectCb = useRef(onSelect)
  selectCb.current = onSelect
  const springRef = useRef(springTarget)
  springRef.current = springTarget
  const [built, setBuilt] = useState(0)

  useEffect(() => {
    selRef.current = selected
  }, [selected])

  // 单步力学：斥力 + 弹簧 + 向心，写入速度/位置（draw=true 时顺带绘制）
  const stepSim = (draw: boolean): void => {
    const nodesL = nodesRef.current
    const { w, h } = dimsRef.current
    if (nodesL.length > 0) {
      for (let i = 0; i < nodesL.length; i++) {
        for (let j = i + 1; j < nodesL.length; j++) {
          const a = nodesL[i]
          const b = nodesL[j]
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
          const ux = dx / d
          const uy = dy / d
          a.vx -= ux * f
          a.vy -= uy * f
          b.vx += ux * f
          b.vy += uy * f
        }
      }
      const byId = new Map(nodesL.map((n) => [n.id, n]))
      for (const e of edgesRef.current) {
        const a = byId.get(e.a)
        const b = byId.get(e.b)
        if (!a || !b) continue
        const dx = b.x - a.x
        const dy = b.y - a.y
        const d = Math.sqrt(dx * dx + dy * dy) || 1
        const f = (d - springRef.current(e.w)) * 0.02
        a.vx += (dx / d) * f
        a.vy += (dy / d) * f
        b.vx -= (dx / d) * f
        b.vy -= (dy / d) * f
      }
      for (const n of nodesL) {
        if (dragRef.current === n) {
          n.vx = 0
          n.vy = 0
          if (n.pinned) {
            n.ax = n.x
            n.ay = n.y
          }
          continue
        }
        if (n.pinned) {
          n.x = n.ax
          n.y = n.ay
          n.vx = 0
          n.vy = 0
          continue
        }
        n.vx += (w / 2 - n.x) * 0.004
        n.vy += (h / 2 - n.y) * 0.004
        n.vx *= 0.86
        n.vy *= 0.86
        const m = n.r + 10
        n.x = Math.max(m, Math.min(w - m, n.x + Math.max(-8, Math.min(8, n.vx))))
        n.y = Math.max(m, Math.min(h - m, n.y + Math.max(-8, Math.min(8, n.vy))))
      }
    }
    if (draw) drawCanvas()
  }

  const drawCanvas = (): void => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    const { w, h } = dimsRef.current
    canvas.width = w * dpr
    canvas.height = h * dpr
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    const nodesL = nodesRef.current
    const byId = new Map(nodesL.map((n) => [n.id, n]))
    const focus = hoverRef.current ?? selRef.current
    const neighbors = new Set<string>()
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
      ctx.strokeStyle = dim ? 'rgba(130,125,140,0.08)' : `rgba(120,120,150,${0.12 + Math.min(0.45, e.w * 0.09)})`
      ctx.lineWidth = 0.8 + Math.min(4, e.w * 0.9)
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
    }
    const dark = darkRef.current
    for (const n of nodesL) {
      const isSel = selRef.current === n.id
      const dim = focus != null && !neighbors.has(n.id)
      ctx.globalAlpha = dim ? 0.2 : 1
      ctx.beginPath()
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2)
      ctx.fillStyle = n.color
      ctx.fill()
      if (isSel) {
        ctx.strokeStyle = n.color
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(n.x, n.y, n.r + 5, 0, Math.PI * 2)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
      if (nodesL.length <= labelMax || hoverRef.current === n.id || isSel) {
        ctx.font = `${n.r > 14 ? 12 : 11}px "Microsoft YaHei", sans-serif`
        ctx.lineWidth = 3
        ctx.strokeStyle = dark ? 'rgba(23,22,24,0.75)' : 'rgba(255,255,255,0.7)'
        ctx.strokeText(n.label.slice(0, 26) + (n.label.length > 26 ? '…' : ''), n.x + n.r + 5, n.y + 4)
        ctx.fillStyle = dim ? (dark ? 'rgba(157,150,153,0.45)' : 'rgba(140,135,150,0.45)') : dark ? 'rgba(235,232,233,0.88)' : 'rgba(35,32,38,0.88)'
        ctx.fillText(n.label.slice(0, 26) + (n.label.length > 26 ? '…' : ''), n.x + n.r + 5, n.y + 4)
      }
    }
  }

  // 建图：初始化位置（孤立节点按 n 序沿外缘均布）+ 预跑 300 轮收敛
  useEffect(() => {
    const wrap = canvasRef.current?.parentElement
    const w = wrap?.clientWidth || 900
    const h = wrap?.clientHeight || 600
    dimsRef.current = { w, h }
    darkRef.current = isDarkTheme()
    const linked = new Set<string>()
    for (const e of edges) {
      linked.add(e.a)
      linked.add(e.b)
    }
    const ring = nodes.filter((n) => n.pinned && !linked.has(n.id))
    const core = nodes.filter((n) => !n.pinned || linked.has(n.id))
    const inner: FgNode[] = []
    core.forEach((n, i) => {
      inner.push({
        ...n,
        x: w / 2 + Math.cos((i / Math.max(1, core.length)) * Math.PI * 2) * w * 0.3,
        y: h / 2 + Math.sin((i / Math.max(1, core.length)) * Math.PI * 2) * h * 0.3,
        vx: 0,
        vy: 0,
        ax: 0,
        ay: 0
      })
    })
    const R = Math.max(60, Math.min(w, h) * 0.46)
    ring.forEach((n, i) => {
      const a = -Math.PI / 2 + (i / Math.max(1, ring.length)) * Math.PI * 2
      const x = w / 2 + Math.cos(a) * R
      const y = h / 2 + Math.sin(a) * R
      inner.push({ ...n, x, y, vx: 0, vy: 0, ax: x, ay: y })
    })
    nodesRef.current = inner
    edgesRef.current = edges
    ticksRef.current = 0
    for (let it = 0; it < 300; it++) stepSim(false)
    selRef.current = null
    selectCb.current(null)
    setBuilt((b) => b + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges])

  // rAF：预跑结束后仍随拖拽松弛重排；1500 帧后休眠，拖拽时唤醒
  useEffect(() => {
    if (!visible) return
    const onResize = (): void => {
      const wrap = canvasRef.current?.parentElement
      if (wrap) dimsRef.current = { w: wrap.clientWidth || 900, h: wrap.clientHeight || 600 }
    }
    onResize()
    const t0 = Date.now()
    const step = (): void => {
      // 硬停：超过 6 秒或运动收敛后彻底停止 rAF（拖拽/重置时经 built 唤醒重挂），绝不常驻空转
      ticksRef.current++
      const settled = ticksRef.current > 60 && nodesRef.current.every((n) => Math.abs(n.vx) + Math.abs(n.vy) < 0.008)
      if (ticksRef.current > 400 || Date.now() - t0 > 6000 || settled) return
      stepSim(true)
      rafRef.current = requestAnimationFrame(step)
    }
    step()
    window.addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener('resize', onResize)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, built])

  if (nodes.length === 0) return <div className="kv-empty">{visible ? emptyText : ''}</div>

  const nodeAt = (mx: number, my: number): FgNode | null => {
    let hit: FgNode | null = null
    for (const n of nodesRef.current) {
      const rr = Math.max(n.r + 6, 14)
      if ((n.x - mx) ** 2 + (n.y - my) ** 2 < rr * rr) hit = n
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
    hit.x = Math.max(30, Math.min(dimsRef.current.w - 30, ev.clientX - rect.left))
    hit.y = Math.max(24, Math.min(dimsRef.current.h - 24, ev.clientY - rect.top))
  }
  const onDown = (ev: React.MouseEvent): void => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const hit = nodeAt(ev.clientX - rect.left, ev.clientY - rect.top)
    if (hit) {
      dragRef.current = hit
      ticksRef.current = 0 // 唤醒休眠的力学循环
    }
  }
  const onUp = (ev: React.MouseEvent): void => {
    const dragged = dragRef.current
    dragRef.current = null
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const hit = nodeAt(ev.clientX - rect.left, ev.clientY - rect.top)
    const id = hit && hit !== dragged ? hit.id : (hit ?? dragged)?.id ?? null
    selRef.current = id
    onSelect(id)
  }

  return <canvas ref={canvasRef} onMouseMove={(e) => { onHover(e); onDrag(e) }} onMouseDown={onDown} onMouseUp={onUp} />
}

// ---------- 视图 1：相似网络（自纵览 KnowledgeGraph 迁移，语义相似 kNN 图） ----------
function SimNetView({
  papers,
  visible,
  cat,
  onOpen
}: {
  papers: Paper[]
  visible: boolean
  cat: string
  onOpen: (p: Paper) => void
}): JSX.Element {
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
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [ready, setReady] = useState(false)
  const [empty, setEmpty] = useState(false)
  const [resetTick, setResetTick] = useState(0)
  const nodesRef = useRef<GNode[]>([])
  const edgesRef = useRef<GEdge[]>([])
  const dimsRef = useRef<{ w: number; h: number }>({ w: 900, h: 600 })
  const rafRef = useRef(0)
  const dragRef = useRef<GNode | null>(null)
  const hoverRef = useRef<number | null>(null)
  const selRef = useRef<number | null>(null)
  const ticksRef = useRef(0)
  const paperById = useMemo(() => new Map(papers.map((p) => [p.id, p])), [papers])
  const catPapers = useMemo(() => (cat ? papers.filter((p) => p.category === cat) : papers), [papers, cat])

  useEffect(() => {
    if (!visible) return
    setReady(false)
    setEmpty(false)
    void window.api
      .graphData(cat || undefined)
      .then((g) => {
        if (g.nodes.length === 0) {
          setEmpty(true)
          return
        }
        const cats = [...new Set(g.nodes.map((n) => n.category))]
        const w = wrapRef.current?.clientWidth || 900
        const h = wrapRef.current?.clientHeight || 600
        nodesRef.current = g.nodes.map((n, i) => ({
          ...n,
          color: PALETTE[Math.max(0, cats.indexOf(n.category)) % PALETTE.length],
          x: w / 2 + Math.cos((i / Math.max(1, g.nodes.length)) * Math.PI * 2) * w * 0.3,
          y: h / 2 + Math.sin((i / Math.max(1, g.nodes.length)) * Math.PI * 2) * h * 0.3,
          vx: 0,
          vy: 0
        }))
        edgesRef.current = g.edges
        dimsRef.current = { w, h }
        ticksRef.current = 0
        setReady(true)
        setSelected(null)
        selRef.current = null
      })
      .catch(() => {})
  }, [visible, papers, resetTick, cat])

  useEffect(() => {
    if (!visible || !ready) return
    const dark = isDarkTheme()
    const draw = (): void => {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
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
          const text = n.title.slice(0, 24) + (n.title.length > 24 ? '…' : '')
          ctx.font = '11px "Microsoft YaHei", sans-serif'
          ctx.lineWidth = 3
          ctx.strokeStyle = dark ? 'rgba(23,22,24,0.75)' : 'rgba(255,255,255,0.7)'
          ctx.strokeText(text, n.x + r + 5, n.y + 4)
          ctx.fillStyle = dim ? 'rgba(140,135,150,0.45)' : dark ? 'rgba(235,232,233,0.88)' : 'rgba(35,32,38,0.88)'
          ctx.fillText(text, n.x + r + 5, n.y + 4)
        }
      }
    }
    const t0 = Date.now()
    const step = (): void => {
      // 硬停：超时/收敛后停止 rAF，拖拽唤醒（与关键词视图同一策略）
      ticksRef.current++
      if (ticksRef.current > 400 || Date.now() - t0 > 6000) return
      const nodes = nodesRef.current
      const { w, h } = dimsRef.current
      if (nodes.length > 0) {
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
      }
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
  const onDown = (ev: React.MouseEvent): void => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const hit = nodeAt(ev.clientX - rect.left, ev.clientY - rect.top)
    if (hit) {
      dragRef.current = hit
      ticksRef.current = 0
    }
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

  const cats = useMemo(() => [...new Set(catPapers.map((p) => p.category))].sort((a, b) => a.localeCompare(b)), [catPapers])
  const catColor = (c: string): string => PALETTE[Math.max(0, cats.indexOf(c)) % PALETTE.length]

  return (
    <div className="kv-view">
      <div className="kv-head">
        <button className="kv-chip" title="重新排布节点" onClick={() => setResetTick((t) => t + 1)}>
          ↻ 重置布局
        </button>
        <span className="kv-hint">
          {cat ? `仅「${catLabel(cat)}」内构图。` : ''}圆点 = 文献（颜色 = 分类，大小 = 关联数），连线粗细 = 内容相似度。点击查看详情，可拖拽节点。
        </span>
        <span className="kv-legend">
          {cats.map((c) => (
            <span key={c} className="kv-leg">
              <i style={{ background: catColor(c) }} />
              {catLabel(c)}
            </span>
          ))}
        </span>
      </div>
      <div className="kv-canvas-wrap" ref={wrapRef}>
        {ready ? (
          <canvas
            ref={canvasRef}
            onMouseMove={(e) => {
              onHover(e)
              onDrag(e)
            }}
            onMouseDown={onDown}
            onMouseUp={onSelect}
          />
        ) : (
          <div className="kv-empty">{visible ? (empty ? '暂无可构建相似网络的文献（需先建立语义索引）' : '正在计算相似网络…') : ''}</div>
        )}
        {selPaper && (
          <div className="kv-panel">
            <div className="kv-panel-head">
              <span className="kv-panel-title">{selPaper.title}</span>
              <button className="kv-panel-close" title="关闭" onClick={() => { selRef.current = null; setSelected(null) }}>
                ×
              </button>
            </div>
            <div className="kv-panel-sub">
              {selPaper.authors || '—'} · {selPaper.venue || catLabel(selPaper.category)} {selPaper.year ? `· ${selPaper.year}` : ''}
            </div>
            {similar.length > 0 && (
              <>
                <div className="kv-panel-sec">相似文献</div>
                <div className="kv-panel-list">
                  {similar.map((s) => (
                    <div
                      key={s.id}
                      className="kv-panel-row"
                      title={`${s.paper!.title}（关联度 ${Math.round(s.w * 100)}%）`}
                      onClick={() => {
                        selRef.current = s.id
                        setSelected(s.id)
                      }}
                    >
                      <span className="kv-ell">{s.paper!.title}</span>
                      <span className="kv-panel-meta">{Math.round(s.w * 100)}%</span>
                    </div>
                  ))}
                </div>
              </>
            )}
            <button className="kv-btn-mini" onClick={() => onOpen(selPaper)}>
              打开阅读
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------- 视图 2：关键词共现（半径 ∝ √频次，按频次渐变着色） ----------
function KeywordCoView({
  visible,
  cat,
  paperById,
  onOpen
}: {
  visible: boolean
  cat: string
  paperById: Map<number, Paper>
  onOpen: (p: Paper) => void
}): JSX.Element {
  const [data, setData] = useState<KwData | null>(null)
  const [sel, setSel] = useState<string | null>(null)

  useEffect(() => {
    if (!visible) return
    setData(null)
    setSel(null)
    let on = true
    window.api
      .graphKeywords(cat || undefined)
      .then((d) => {
        if (on) setData(d)
      })
      .catch(() => {})
    return () => {
      on = false
    }
  }, [visible, cat])

  const descs = useMemo<FgDesc[]>(() => {
    if (!data) return []
    const nMax = Math.max(1, ...data.nodes.map((n) => n.n))
    const dark = isDarkTheme()
    return data.nodes.map((n) => ({
      id: n.id,
      label: n.id,
      r: Math.min(28, 5 + Math.sqrt(n.n) * 2.4),
      color: mixHex(dark ? '#6e6257' : '#cdbfa4', dark ? '#e2c391' : '#5b4a3a', Math.pow(n.n / nMax, 0.55))
    }))
  }, [data])

  const selNode = data?.nodes.find((n) => n.id === sel) ?? null
  const selPapers = selNode ? selNode.papers.map((id) => paperById.get(id)).filter((p): p is Paper => !!p) : []

  return (
    <div className="kv-view">
      <div className="kv-head">
        <span className="kv-hint">圆点 = 关键词（大小 / 颜色深浅 = 出现频次），连线粗细 = 共现论文数。点击查看命中文献，可拖拽节点。</span>
      </div>
      <div className="kv-canvas-wrap">
        {data ? (
          <ForceGraph
            visible={visible}
            nodes={descs}
            edges={data.edges}
            selected={sel}
            onSelect={setSel}
            springTarget={(w) => 60 + 130 / Math.max(1, w)}
            emptyText="该分类暂无关键词共现"
            labelMax={50}
          />
        ) : (
          <div className="kv-empty">{visible ? '正在统计关键词…' : ''}</div>
        )}
        {selNode && (
          <div className="kv-panel">
            <div className="kv-panel-head">
              <span className="kv-panel-title">{selNode.id}</span>
              <button className="kv-panel-close" title="关闭" onClick={() => setSel(null)}>
                ×
              </button>
            </div>
            <div className="kv-panel-sub">
              出现 {selNode.n} 次 · 命中 {selNode.papers.length} 篇
            </div>
            {selPapers.length > 0 && (
              <>
                <div className="kv-panel-sec">相关文献</div>
                <div className="kv-panel-list">
                  {selPapers.map((p) => (
                    <div key={p.id} className="kv-panel-row" title={p.title} onClick={() => onOpen(p)}>
                      <span className="kv-ell">{p.title}</span>
                      <span className="kv-panel-meta">{p.year ?? ''}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------- 视图 3：作者合作（合著网络；孤立方按论文数排布在外缘小圆） ----------
function AuthorCoView({
  visible,
  cat,
  catPapers,
  onOpen
}: {
  visible: boolean
  cat: string
  catPapers: Paper[]
  onOpen: (p: Paper) => void
}): JSX.Element {
  const [data, setData] = useState<AuData | null>(null)
  const [sel, setSel] = useState<string | null>(null)

  useEffect(() => {
    if (!visible) return
    setData(null)
    setSel(null)
    let on = true
    window.api
      .graphAuthors(cat || undefined)
      .then((d) => {
        if (on) setData(d)
      })
      .catch(() => {})
    return () => {
      on = false
    }
  }, [visible, cat])

  const descs = useMemo<FgDesc[]>(() => {
    if (!data) return []
    const nMax = Math.max(1, ...data.nodes.map((n) => n.n))
    const dark = isDarkTheme()
    return [...data.nodes]
      .sort((a, b) => b.n - a.n)
      .map((n) => ({
        id: n.id,
        label: n.id,
        r: Math.min(24, 6 + Math.sqrt(n.n) * 2.2),
        color: mixHex(dark ? '#4f6b94' : '#a8bcd8', dark ? '#8fb4e8' : '#1558c0', Math.pow(n.n / nMax, 0.55)),
        pinned: true // 引擎只钉住无合著边的孤立方
      }))
  }, [data])

  // 作者 → 论文：先按分隔符精确匹配作者名，退化用子串包含
  const papersOf = (name: string): Paper[] => {
    const exact = catPapers.filter((p) =>
      p.authors
        .split(/[,;，；]/)
        .map((s) => s.trim())
        .includes(name)
    )
    if (exact.length > 0) return exact
    return catPapers.filter((p) => p.authors.includes(name))
  }
  const selPapers = sel ? papersOf(sel) : []

  return (
    <div className="kv-view">
      <div className="kv-head">
        <span className="kv-hint">圆点 = 作者（大小 = 论文数），连线 = 合著；无合著的独立作者排布在外缘。点击查看其文献，可拖拽节点。</span>
      </div>
      <div className="kv-canvas-wrap">
        {data ? (
          <ForceGraph
            visible={visible}
            nodes={descs}
            edges={data.edges}
            selected={sel}
            onSelect={setSel}
            springTarget={(w) => 70 + 120 / Math.max(1, w)}
            emptyText="该分类暂无作者数据"
            labelMax={64}
          />
        ) : (
          <div className="kv-empty">{visible ? '正在统计作者…' : ''}</div>
        )}
        {sel && (
          <div className="kv-panel">
            <div className="kv-panel-head">
              <span className="kv-panel-title">{sel}</span>
              <button className="kv-panel-close" title="关闭" onClick={() => setSel(null)}>
                ×
              </button>
            </div>
            <div className="kv-panel-sub">{selPapers.length} 篇论文{cat ? `（${catLabel(cat)}内）` : ''}</div>
            {selPapers.length > 0 && (
              <div className="kv-panel-list">
                {selPapers.map((p) => (
                  <div key={p.id} className="kv-panel-row" title={p.title} onClick={() => onOpen(p)}>
                    <span className="kv-ell">{p.title}</span>
                    <span className="kv-panel-meta">{p.year ?? ''}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------- 视图 4：主题星系（圆打包布局，非力导向） ----------
interface GalCircle {
  x: number
  y: number
  r: number
  color: string
  t: TopicT
}

// 简单 circle packing：按半径降序 + 种子洗牌，从中心沿黄金角螺旋外推，避让已放置圆
function packTopics(topics: TopicT[], w: number, h: number, seed: number): GalCircle[] {
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return []
  if (topics.length === 0 || w < 80 || h < 80) return []
  const rand = seededRng(seed * 7919 + 13)
  const cx = w / 2
  const cy = h / 2
  const items = topics.map((t) => ({ t, r: Math.max(34, Math.min(96, 22 + Math.sqrt(t.paperIds.length) * 9)) }))
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[items[i], items[j]] = [items[j], items[i]]
  }
  items.sort((a, b) => b.r - a.r)
  const placed: GalCircle[] = []
  const start = rand() * Math.PI * 2
  for (const it of items) {
    if (placed.length === 0) {
      placed.push({ x: cx, y: cy, r: it.r, color: '', t: it.t })
      continue
    }
    const stepD = 3.2 * ((it.r + 20) / 8)
    let px = cx
    let py = cy
    let found = false
    let fx = cx
    let fy = cy
    let hasFb = false
    for (let t = 1; t < 4000 && !found; t++) {
      const d = stepD * Math.sqrt(t)
      const a = start + t * 2.399963
      const x = cx + Math.cos(a) * d
      const y = cy + Math.sin(a) * d
      if (x - it.r < 8 || x + it.r > w - 8 || y - it.r < 24 || y + it.r > h - 24) continue
      if (!hasFb) {
        hasFb = true
        fx = x
        fy = y
      }
      if (placed.every((p) => (p.x - x) ** 2 + (p.y - y) ** 2 >= (p.r + it.r + 10) ** 2)) {
        px = x
        py = y
        found = true
      }
    }
    if (!found) {
      px = fx
      py = fy
    }
    placed.push({ x: px, y: py, r: it.r, color: '', t: it.t })
  }
  placed.forEach((p, i) => {
    p.color = PALETTE[(i * 5 + seed) % PALETTE.length]
  })
  return placed
}

function TopicGalaxyView({
  visible,
  cat,
  paperById,
  onOpen
}: {
  visible: boolean
  cat: string
  paperById: Map<number, Paper>
  onOpen: (p: Paper) => void
}): JSX.Element {
  const [topics, setTopics] = useState<TopicT[] | null>(null)
  const [seed, setSeed] = useState(1)
  const [selLabel, setSelLabel] = useState<string | null>(null)
  const boxRef = useRef<HTMLDivElement | null>(null)
  const [box, setBox] = useState({ w: 900, h: 560 })

  useEffect(() => {
    if (!visible) return
    setTopics(null)
    setSelLabel(null)
    let on = true
    window.api
      .graphTopics(cat || undefined)
      .then((d) => {
        if (on) setTopics(d)
      })
      .catch(() => {})
    return () => {
      on = false
    }
  }, [visible, cat])

  useEffect(() => {
    const measure = (): void => {
      const el = boxRef.current
      if (el && el.clientWidth > 0) setBox({ w: el.clientWidth, h: el.clientHeight })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  const placed = useMemo(() => (topics ? packTopics(topics, box.w, box.h, seed) : []), [topics, box, seed])
  const selTopic = topics?.find((t) => t.label === selLabel) ?? null
  const selPapers = selTopic ? selTopic.paperIds.map((id) => paperById.get(id)).filter((p): p is Paper => !!p) : []
  const dark = isDarkTheme()

  return (
    <div className="kv-view">
      <div className="kv-head">
        <span className="kv-hint">每个圆 = 一个主题簇（大小 ∝ 论文数，圆下缘小字为高频关键词）。点击圆查看主题详情。</span>
        <span className="kv-nav-right">
          <button
            className="kv-chip"
            title="重掷星系布局"
            onClick={() => {
              setSeed((s) => s + 1)
              setSelLabel(null)
            }}
          >
            ↻ 重新排布
          </button>
        </span>
      </div>
      {topics === null ? (
        <div className="kv-empty">{visible ? '正在聚类主题…' : ''}</div>
      ) : placed.length === 0 ? (
        <div className="kv-empty">该分类暂无主题聚类</div>
      ) : (
        <div className="kv-galaxy" ref={boxRef}>
          {placed.map((c) => (
            <div
              key={c.t.label}
              className={`kv-cluster ${selLabel === c.t.label ? 'on' : ''}`}
              style={{
                left: c.x - c.r,
                top: c.y - c.r,
                width: c.r * 2,
                height: c.r * 2,
                borderColor: c.color,
                background: withAlpha(c.color, dark ? 0.14 : 0.07)
              }}
              title={c.t.label}
              onClick={() => setSelLabel(selLabel === c.t.label ? null : c.t.label)}
            >
              <div className="kv-cluster-name" style={{ fontSize: Math.max(11, Math.min(15, Math.round(c.r * 0.2))) }}>
                {c.t.label}
              </div>
              <div className="kv-cluster-count">{c.t.paperIds.length} 篇</div>
              {c.t.keywords.length > 0 && (
                <div className="kv-cluster-kws" style={{ color: c.color }}>
                  {c.t.keywords.slice(0, 3).join(' · ')}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {selTopic && (
        <div className="kv-panel">
          <div className="kv-panel-head">
            <span className="kv-panel-title">{selTopic.label}</span>
            <button className="kv-panel-close" title="关闭" onClick={() => setSelLabel(null)}>
              ×
            </button>
          </div>
          <div className="kv-panel-sub">{selTopic.paperIds.length} 篇论文{cat ? `（${catLabel(cat)}内）` : ''}</div>
          {selTopic.keywords.length > 0 && (
            <>
              <div className="kv-panel-sec">主题关键词</div>
              <div className="kv-panel-kws">
                {selTopic.keywords.map((k) => (
                  <span key={k} className="kv-kw-chip">
                    {k}
                  </span>
                ))}
              </div>
            </>
          )}
          {selPapers.length > 0 && (
            <>
              <div className="kv-panel-sec">簇内文献</div>
              <div className="kv-panel-list">
                {selPapers.map((p) => (
                  <div key={p.id} className="kv-panel-row" title={p.title} onClick={() => onOpen(p)}>
                    <span className="kv-ell">{p.title}</span>
                    <span className="kv-panel-meta">{p.year ?? ''}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ---------- 视图 5：知识库（AI 综述卡片 + 标签体系沉淀） ----------
function KnowledgeBaseView({
  visible,
  catPapers,
  onOpen
}: {
  visible: boolean
  catPapers: Paper[]
  onOpen: (p: Paper) => void
}): JSX.Element {
  const [tags, setTags] = useState<TagRow[]>([])
  const [selTag, setSelTag] = useState<string | null>(null)

  useEffect(() => {
    if (!visible) return
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
  }, [visible, catPapers])

  const aiPapers = useMemo(() => catPapers.filter((p) => p.category.includes('AI')), [catPapers])
  const tagPapers = selTag ? catPapers.filter((p) => (p.tags ?? []).includes(selTag)) : []
  const sumPreview = (s?: string): string => {
    if (!s) return '（暂无摘要，可在详情页用 AI 生成）'
    return s.length > 200 ? s.slice(0, 200) + '…' : s
  }

  return (
    <div className="kv-kbwrap">
      <div className="kv-kb">
        <div className="kv-kb-note">知识库 = AI 综述 + 标签体系沉淀的领域知识{catPapers.length > 0 ? `（当前 ${catPapers.length} 篇）` : ''}</div>

        <div className="kv-kb-sec">AI 综述（{aiPapers.length}）</div>
        {aiPapers.length === 0 ? (
          <div className="kv-empty">该分类暂无 AI 综述</div>
        ) : (
          <div className="kv-kb-grid">
            {aiPapers.map((p) => (
              <div key={p.id} className="kv-kb-card">
                <div className="kv-kb-title" title={p.title}>
                  {p.title}
                </div>
                <div className="kv-kb-meta">
                  {p.year ?? '—'} · {p.venue || catLabel(p.category)}
                </div>
                <div className="kv-kb-sum">{sumPreview(p.summary)}</div>
                <div className="kv-kb-foot">
                  <button className="kv-btn-mini" onClick={() => onOpen(p)}>
                    打开阅读
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="kv-kb-sec">标签体系（{tags.length}）</div>
        {tags.length === 0 ? (
          <div className="kv-empty">暂无标签，可在文献详情页为论文添加标签沉淀领域知识</div>
        ) : (
          <div className="kv-tags">
            {tags.map((t) => (
              <button
                key={t.id}
                className={`kv-tag-card ${selTag === t.name ? 'on' : ''}`}
                title={`查看标签「${t.name}」下的论文`}
                onClick={() => setSelTag(selTag === t.name ? null : t.name)}
              >
                <i style={{ background: t.color }} />
                {t.name}
                <span className="kv-tag-n">{t.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {selTag && (
        <div className="kv-panel">
          <div className="kv-panel-head">
            <span className="kv-panel-title">{selTag}</span>
            <button className="kv-panel-close" title="关闭" onClick={() => setSelTag(null)}>
              ×
            </button>
          </div>
          <div className="kv-panel-sub">{tagPapers.length} 篇论文{catPapers.length > 0 ? '（按当前分类过滤）' : ''}</div>
          {tagPapers.length > 0 && (
            <div className="kv-panel-list">
              {tagPapers.map((p) => (
                <div key={p.id} className="kv-panel-row" title={p.title} onClick={() => onOpen(p)}>
                  <span className="kv-ell">{p.title}</span>
                  <span className="kv-panel-meta">{p.year ?? ''}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------- 对外入口：知识 tab（子导航 + 统一分类筛选） ----------
type SubTab = 'sim' | 'kw' | 'au' | 'topic' | 'kb'
const SUBTABS: Array<{ key: SubTab; label: string }> = [
  { key: 'sim', label: '相似网络' },
  { key: 'kw', label: '关键词共现' },
  { key: 'au', label: '作者合作' },
  { key: 'topic', label: '主题星系' },
  { key: 'kb', label: '知识库' }
]

export default function KnowledgeView({
  papers,
  visible,
  onOpen
}: {
  papers: Paper[]
  visible: boolean
  onOpen: (p: Paper) => void
}): JSX.Element | null {
  const [sub, setSub] = useState<SubTab>('sim')
  const cats = useMemo(() => [...new Set(papers.map((p) => p.category))].sort((a, b) => a.localeCompare(b)), [papers])
  const [cat, setCat] = useState('')
  const paperById = useMemo(() => new Map(papers.map((p) => [p.id, p])), [papers])
  const catPapers = useMemo(() => (cat ? papers.filter((p) => p.category === cat) : papers), [papers, cat])

  return (
    <div className="kv-wrap">
      <div className="kv-nav">
        {SUBTABS.map((t) => (
          <button key={t.key} className={`kv-chip ${sub === t.key ? 'on' : ''}`} onClick={() => setSub(t.key)}>
            {t.label}
          </button>
        ))}
        <span className="kv-nav-right">
          <span className="kv-cat-label">分类</span>
          <select className="kv-cat" value={cat} onChange={(e) => setCat(e.target.value)} title="只看某个分类内的知识体系">
            <option value="">全部分类</option>
            {cats.map((c) => (
              <option key={c} value={c}>
                {catLabel(c)}
              </option>
            ))}
          </select>
        </span>
      </div>
      {sub === 'sim' && <SimNetView papers={papers} visible={visible} cat={cat} onOpen={onOpen} />}
      {sub === 'kw' && <KeywordCoView visible={visible} cat={cat} paperById={paperById} onOpen={onOpen} />}
      {sub === 'au' && <AuthorCoView visible={visible} cat={cat} catPapers={catPapers} onOpen={onOpen} />}
      {sub === 'topic' && <TopicGalaxyView visible={visible} cat={cat} paperById={paperById} onOpen={onOpen} />}
      {sub === 'kb' && <KnowledgeBaseView visible={visible} catPapers={catPapers} onOpen={onOpen} />}
    </div>
  )
}
