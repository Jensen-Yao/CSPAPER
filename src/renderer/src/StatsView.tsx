// 统计仪表盘（W7 重制）：4 数字卡 + 六形态大画布（词云 / 气泡 / 树图 / 时序 / 热力 / 排行）
// + 月度导入/阅读 + 阅读时长 Top10 + 状态分布 + 点击词/作者/分类弹论文列表。
// 全部 canvas + CSS 自绘，零第三方依赖。visible 时并行拉 statsOverview / statsExtra / listPapers。
// 样式在 stats2.css（.st2- 前缀），不依赖 styles.css 的 .stats-* 旧类。
import { useEffect, useRef, useState } from 'react'
import { STATUS_META, type Paper, type StatsOverview } from './types'
import './stats2.css'

interface Props {
  visible: boolean
  onOpen: (paperId: number) => void
}

// statsExtra 返回结构（types.ts 内联声明，这里落成本地类型）
interface StatsExtra {
  wordsByYear: Array<{ w: string; total: number; years: Array<{ y: string; n: number }> }>
  authorsTop: Array<{ author: string; n: number }>
  heatmap: Array<{ day: string; seconds: number }>
}

type ViewKey = 'cloud' | 'bubble' | 'tree' | 'timeline' | 'heat' | 'rank'

const VIEWS: Array<{ key: ViewKey; label: string; title: string }> = [
  { key: 'cloud', label: '词云', title: '标题词云' },
  { key: 'bubble', label: '气泡', title: '标题词频 · 气泡图' },
  { key: 'tree', label: '树图', title: '分类分布 · 矩形树图' },
  { key: 'timeline', label: '时序', title: '关键词年度时序 · 近 10 年' },
  { key: 'heat', label: '热力', title: '阅读热力图 · 近 53 周' },
  { key: 'rank', label: '排行', title: '作者排行 · 前 15' }
]

const PALETTE = ['#b08d57', '#7a9e7e', '#b0654a', '#6b7fa3', '#a37f9e', '#8a8f6a', '#7e9aa3', '#c4a882', '#a3675e', '#9e8f6b']
// 频次梯度色板（暖墨家族，深 → 浅）：气泡图按名次取色
const RAMP = ['#5f4526', '#8a6a3f', '#b08d57', '#cfae74', '#e6d7b8']
const HEAT_LIGHT = ['rgba(60,50,35,0.07)', '#e3d4b2', '#d3b276', '#b08d57', '#7c5f33']
const HEAT_DARK = ['rgba(255,255,255,0.05)', '#4a3f2b', '#6d5a3a', '#96784a', '#c9a86a']

const fmtHours = (s: number): string => (s >= 3600 ? `${(s / 3600).toFixed(1)} 小时` : s >= 60 ? `${Math.round(s / 60)} 分钟` : `${s} 秒`)
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v))
const trunc = (s: string, n: number): string => (s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s)

function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}
function rampColor(t: number): string {
  const x = clamp(t, 0, 1) * (RAMP.length - 1)
  const i = Math.min(RAMP.length - 2, Math.floor(x))
  const f = x - i
  const a = hexRgb(RAMP[i])
  const b = hexRgb(RAMP[i + 1])
  const c = a.map((v, k) => Math.round(v + (b[k] - v) * f))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}
function isLightColor(hex: string): boolean {
  const [r, g, b] = hexRgb(hex)
  return 0.299 * r + 0.587 * g + 0.114 * b > 152
}

// 主题感知的画布配色（styles.css 的 html[data-theme] 决定）
function themeColors(): { dark: boolean; text: string; dim: string; faint: string; grid: string; soft: string } {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark'
  return dark
    ? { dark, text: '#d8d3d5', dim: 'rgba(157,150,153,0.9)', faint: 'rgba(157,150,153,0.62)', grid: 'rgba(255,255,255,0.08)', soft: 'rgba(196,168,130,0.16)' }
    : { dark, text: '#3a352f', dim: 'rgba(110,103,94,0.95)', faint: 'rgba(133,127,120,0.72)', grid: 'rgba(30,25,18,0.08)', soft: 'rgba(91,74,58,0.08)' }
}

// 高分屏适配 + 清屏 + 绘制
function renderCanvas(cv: HTMLCanvasElement, paint: (g: CanvasRenderingContext2D, W: number, H: number) => void): void {
  const dpr = window.devicePixelRatio || 1
  const W = cv.clientWidth
  const H = cv.clientHeight
  if (W < 2 || H < 2) return
  cv.width = Math.round(W * dpr)
  cv.height = Math.round(H * dpr)
  const g = cv.getContext('2d')
  if (!g) return
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.clearRect(0, 0, W, H)
  paint(g, W, H)
}

// 画布右上角悬浮提示
function drawTip(g: CanvasRenderingContext2D, W: number, text: string): void {
  g.font = '11.5px sans-serif'
  const w = Math.ceil(g.measureText(text).width) + 18
  const x = W - w - 8
  g.beginPath()
  g.roundRect(x, 8, w, 24, 6)
  g.fillStyle = 'rgba(32,27,22,0.92)'
  g.fill()
  g.fillStyle = '#f3ede4'
  g.textBaseline = 'alphabetic'
  g.fillText(text, x + 9, 23)
}

function drawEmpty(g: CanvasRenderingContext2D, W: number, H: number, text: string): void {
  g.fillStyle = themeColors().faint
  g.font = '13px sans-serif'
  g.textAlign = 'center'
  g.fillText(text, W / 2, H / 2)
  g.textAlign = 'left'
}

// 气泡图圆形
interface Circle {
  x: number
  y: number
  r: number
  w: string
  n: number
  i: number
}

// 从中心螺旋放置防重叠（放不下则缩小半径重试）
function layoutCircles(words: Array<{ w: string; n: number }>, W: number, H: number): Circle[] {
  const out: Circle[] = []
  const max = words[0].n || 1
  const cx = W / 2
  const cy = H / 2
  const Rmax = Math.min(W, H) * 0.26
  const diag = Math.max(W, H)
  for (let i = 0; i < words.length; i++) {
    const it = words[i]
    let r = clamp(12 + (Rmax - 12) * Math.sqrt(it.n / max), 10, Rmax)
    let done = false
    for (let tries = 0; tries < 7 && !done && r >= 8; tries++) {
      for (let t = 0; t < 720; t++) {
        const rad = r * 0.55 + t * 1.55
        if (rad > diag) break
        const ang = t * 0.34
        const x = cx + rad * Math.cos(ang)
        const y = cy + rad * Math.sin(ang)
        if (x - r < 3 || x + r > W - 3 || y - r < 3 || y + r > H - 3) continue
        let collide = false
        for (const p of out) {
          const dx = p.x - x
          const dy = p.y - y
          const rr = p.r + r + 2
          if (dx * dx + dy * dy < rr * rr) {
            collide = true
            break
          }
        }
        if (!collide) {
          out.push({ x, y, r, w: it.w, n: it.n, i })
          done = true
          break
        }
      }
      if (!done) r *= 0.82
    }
  }
  return out
}

// 树图：占比交替分割（近似 squarify），宽 > 高时左右切，否则上下切
interface TreeMapItem {
  name: string
  count: number
  names: string[]
  i: number
}
interface TreeMapRect {
  item: TreeMapItem
  x: number
  y: number
  w: number
  h: number
}
function layoutTree(items: TreeMapItem[], x: number, y: number, w: number, h: number, out: TreeMapRect[]): void {
  if (items.length === 0 || w <= 1 || h <= 1) return
  if (items.length === 1) {
    out.push({ item: items[0], x, y, w, h })
    return
  }
  const total = items.reduce((a, b) => a + b.count, 0) || 1
  let acc = 0
  let sp = 0
  for (let i = 0; i < items.length - 1; i++) {
    acc += items[i].count
    sp = i + 1
    if (acc >= total / 2) break
  }
  if (sp === 0) sp = 1
  const a = items.slice(0, sp)
  const b = items.slice(sp)
  const frac = clamp(a.reduce((s, it) => s + it.count, 0) / total, 0.12, 0.88)
  if (w >= h) {
    layoutTree(a, x, y, w * frac, h, out)
    layoutTree(b, x + w * frac, y, w * (1 - frac), h, out)
  } else {
    layoutTree(a, x, y, w, h * frac, out)
    layoutTree(b, x, y + h * frac, w, h * (1 - frac), out)
  }
}

// 大画布命中区域：hover 高亮 key + 提示文本 + 可选点击行为
interface Hit {
  contains: (x: number, y: number) => boolean
  key: string | null
  tip: string
  pick?: () => void
}

export default function StatsView({ visible, onOpen }: Props): JSX.Element | null {
  const [ov, setOv] = useState<StatsOverview | null>(null)
  const [ex, setEx] = useState<StatsExtra | null>(null)
  const [papers, setPapers] = useState<Paper[]>([])
  const [view, setView] = useState<ViewKey>('cloud')
  const [popup, setPopup] = useState<{ title: string; items: Paper[] } | null>(null)

  const stageRef = useRef<HTMLCanvasElement>(null)
  const monthlyRef = useRef<HTMLCanvasElement>(null)
  const topRef = useRef<HTMLCanvasElement>(null)
  const hoverRef = useRef<string | null>(null)
  const redrawRef = useRef<() => void>(() => {})

  // ---------- 论文列表浮层（词/作者/分类共用） ----------
  const openWord = (w: string): void => {
    const key = w.toLowerCase()
    setPopup({ title: `关键词 ${w}`, items: papers.filter((p) => p.title.toLowerCase().includes(key)).slice(0, 200) })
  }
  const openAuthor = (a: string): void => {
    setPopup({ title: `作者 ${a}`, items: papers.filter((p) => p.authors.includes(a)).slice(0, 200) })
  }
  const openCats = (names: string[], label: string): void => {
    const set = new Set(names)
    setPopup({ title: `分类 ${label}`, items: papers.filter((p) => set.has(p.category)).slice(0, 200) })
  }

  useEffect(() => {
    if (!popup) return
    const h = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setPopup(null)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [popup])

  // ---------- 数据加载（visible 时并行拉取） ----------
  useEffect(() => {
    if (!visible) return
    let alive = true
    void Promise.all([window.api.statsOverview(), window.api.statsExtra(), window.api.listPapers()])
      .then(([o, e2, ps]) => {
        if (!alive) return
        setOv(o)
        setEx(e2)
        setPapers(ps)
      })
      .catch(() => {
        if (!alive) return
        setOv(null)
        setEx(null)
      })
    return () => {
      alive = false
    }
  }, [visible])

  // ---------- 大画布：注册悬停 / 点击命中 ----------
  const mountStage = (paint: (g: CanvasRenderingContext2D, W: number, H: number) => void, hits: Hit[]): void => {
    const cv = stageRef.current
    if (!cv) return
    renderCanvas(cv, paint)
    cv.onmousemove = (e): void => {
      const r = cv.getBoundingClientRect()
      const key = hits.find((h) => h.contains(e.clientX - r.left, e.clientY - r.top))?.key ?? null
      if (key !== hoverRef.current) {
        hoverRef.current = key
        renderCanvas(cv, paint)
      }
    }
    cv.onmouseleave = (): void => {
      if (hoverRef.current !== null) {
        hoverRef.current = null
        renderCanvas(cv, paint)
      }
    }
    cv.onclick = (e): void => {
      const r = cv.getBoundingClientRect()
      const h = hits.find((h2) => h2.contains(e.clientX - r.left, e.clientY - r.top))
      if (h?.pick) h.pick()
    }
  }

  // ---------- 词云：横排流式，按频次定字号，色板轮换 ----------
  const drawCloud = (): void => {
    const cv = stageRef.current
    if (!cv) return
    const hits: Hit[] = []
    const paint = (g: CanvasRenderingContext2D, W: number, H: number): void => {
      hits.length = 0
      const tc = themeColors()
      const words = ov?.words.slice(0, 60) ?? []
      if (words.length === 0) {
        drawEmpty(g, W, H, '标题词云会随文献增多而生成。')
        return
      }
      const max = words[0].n || 1
      let x = 16
      let y = 38
      let lineH = 34
      words.forEach((wd, i) => {
        const size = Math.round(12 + 22 * Math.sqrt(wd.n / max))
        g.font = `${size}px sans-serif`
        const tw = g.measureText(wd.w).width
        if (x + tw > W - 16) {
          x = 16
          y += lineH + 8
          lineH = size + 8
        }
        if (y > H - 8) return
        const key = `c${i}`
        const hov = hoverRef.current === key
        g.globalAlpha = hov ? 1 : 0.78 + 0.22 * (wd.n / max)
        g.fillStyle = hov ? tc.text : PALETTE[i % PALETTE.length]
        g.fillText(wd.w, x, y)
        g.globalAlpha = 1
        if (hov) {
          g.fillStyle = tc.text
          g.fillRect(x, y + 3, tw, 2)
        }
        hits.push({
          contains: (px, py) => px >= x - 2 && px <= x + tw + 2 && py >= y - size * 0.9 && py <= y + 6,
          key,
          tip: `${wd.w} × ${wd.n}`,
          pick: () => openWord(wd.w)
        })
        x += tw + 12
        lineH = Math.max(lineH, size + 8)
      })
      const hv = hits.find((h) => h.key === hoverRef.current)
      if (hv) drawTip(g, W, hv.tip)
    }
    mountStage(paint, hits)
  }

  // ---------- 气泡图：半径 ∝ √n，中心螺旋排布 ----------
  const drawBubble = (): void => {
    const cv = stageRef.current
    if (!cv) return
    const hits: Hit[] = []
    let cache: { W: number; H: number; circles: Circle[] } | null = null
    const paint = (g: CanvasRenderingContext2D, W: number, H: number): void => {
      hits.length = 0
      const tc = themeColors()
      const words = ov?.words.slice(0, 60) ?? []
      if (words.length === 0) {
        drawEmpty(g, W, H, '暂无标题词频数据——导入文献后自动生成。')
        return
      }
      if (!cache || cache.W !== W || cache.H !== H) cache = { W, H, circles: layoutCircles(words, W, H) }
      const circles = cache.circles
      if (circles.length === 0) {
        drawEmpty(g, W, H, '画布太小，放不下词频气泡。')
        return
      }
      const last = words.length - 1
      for (const c of circles) {
        const t = last > 0 ? Math.pow(c.i / last, 0.7) : 0
        const hov = hoverRef.current === `b${c.i}`
        g.beginPath()
        g.arc(c.x, c.y, hov ? c.r + 1.5 : c.r, 0, Math.PI * 2)
        g.fillStyle = rampColor(t)
        g.fill()
        if (hov) {
          g.strokeStyle = tc.text
          g.lineWidth = 1.5
          g.stroke()
        }
        if (c.r >= 11) {
          g.font = `${Math.round(clamp(c.r * 0.5, 9, 15))}px sans-serif`
          g.fillStyle = t < 0.42 ? '#f6f1e7' : '#3d2f1f'
          g.textAlign = 'center'
          g.textBaseline = 'middle'
          g.fillText(c.w, c.x, c.y, c.r * 1.8)
          g.textAlign = 'left'
          g.textBaseline = 'alphabetic'
        }
        hits.push({
          contains: (px, py) => (px - c.x) * (px - c.x) + (py - c.y) * (py - c.y) <= (c.r + 3) * (c.r + 3),
          key: `b${c.i}`,
          tip: `${c.w} × ${c.n}`,
          pick: () => openWord(c.w)
        })
      }
      const hv = hits.find((h) => h.key === hoverRef.current)
      if (hv) drawTip(g, W, hv.tip)
    }
    mountStage(paint, hits)
  }

  // ---------- 树图：分类占比矩形分割 ----------
  const drawTree = (): void => {
    const cv = stageRef.current
    if (!cv) return
    const hits: Hit[] = []
    const paint = (g: CanvasRenderingContext2D, W: number, H: number): void => {
      hits.length = 0
      const tc = themeColors()
      const catsAll = ov?.categories ?? []
      if (catsAll.length === 0) {
        drawEmpty(g, W, H, '暂无分类数据——先在文献库中整理分类。')
        return
      }
      const sorted = [...catsAll].sort((a, b) => b.count - a.count)
      const top = sorted.slice(0, 12)
      const rest = sorted.slice(12)
      const items: TreeMapItem[] = top.map((c, i) => ({
        name: c.name,
        count: c.count,
        names: c.name === '其他' ? [] : [c.name],
        i
      }))
      if (rest.length > 0) {
        items.push({ name: '其他', count: rest.reduce((a, b) => a + b.count, 0), names: rest.map((c) => c.name), i: items.length })
      }
      const rects: TreeMapRect[] = []
      layoutTree(items, 0, 0, W, H, rects)
      for (const rc of rects) {
        const col = PALETTE[rc.item.i % PALETTE.length]
        const hov = hoverRef.current === `t${rc.item.i}`
        g.globalAlpha = hov ? 1 : 0.92
        g.fillStyle = col
        g.beginPath()
        g.roundRect(rc.x + 1, rc.y + 1, Math.max(1, rc.w - 2), Math.max(1, rc.h - 2), 4)
        g.fill()
        g.globalAlpha = 1
        if (hov) {
          g.strokeStyle = tc.text
          g.lineWidth = 1.5
          g.stroke()
        }
        const ink = isLightColor(col) ? 'rgba(40,32,20,0.92)' : 'rgba(252,248,240,0.95)'
        const inkDim = isLightColor(col) ? 'rgba(40,32,20,0.62)' : 'rgba(252,248,240,0.72)'
        if (rc.w > 48 && rc.h > 34) {
          g.fillStyle = ink
          g.font = '600 12.5px sans-serif'
          g.fillText(trunc(rc.item.name, Math.floor(rc.w / 13)), rc.x + 9, rc.y + 20, rc.w - 16)
          g.fillStyle = inkDim
          g.font = '10.5px sans-serif'
          g.fillText(`${rc.item.count} 篇`, rc.x + 9, rc.y + 35, rc.w - 16)
        } else if (rc.w > 32 && rc.h > 20) {
          g.fillStyle = ink
          g.font = '11px sans-serif'
          g.fillText(trunc(rc.item.name, Math.floor(rc.w / 12)), rc.x + 5, rc.y + 14, rc.w - 8)
        }
        hits.push({
          contains: (px, py) => px >= rc.x && px <= rc.x + rc.w && py >= rc.y && py <= rc.y + rc.h,
          key: `t${rc.item.i}`,
          tip: `${rc.item.name} · ${rc.item.count} 篇`,
          pick: () => openCats(rc.item.names.length > 0 ? rc.item.names : [rc.item.name], rc.item.name)
        })
      }
      const hv = hits.find((h) => h.key === hoverRef.current)
      if (hv) drawTip(g, W, hv.tip)
    }
    mountStage(paint, hits)
  }

  // ---------- 时序：关键词年度折线组 + 右侧图例 ----------
  const drawTimeline = (): void => {
    const cv = stageRef.current
    if (!cv) return
    const hits: Hit[] = []
    const paint = (g: CanvasRenderingContext2D, W: number, H: number): void => {
      hits.length = 0
      const tc = themeColors()
      const series = ex?.wordsByYear ?? []
      if (series.length === 0) {
        drawEmpty(g, W, H, '近 10 年关键词时序暂无数据。')
        return
      }
      const yset = new Set<string>()
      for (const s of series) for (const p of s.years) yset.add(p.y)
      const years = [...yset].sort((a, b) => Number(a) - Number(b))
      if (years.length === 0) return
      const padL = 40
      const padR = 122
      const padT = 16
      const padB = 28
      const plotW = W - padL - padR
      const plotH = H - padT - padB
      if (plotW < 40 || plotH < 40) return
      let ymax = 1
      for (const s of series) for (const p of s.years) ymax = Math.max(ymax, p.n)
      const ytop = Math.ceil(ymax * 1.15)
      const X = (yi: number): number => padL + (plotW * yi) / Math.max(1, years.length - 1)
      const Y = (n: number): number => padT + plotH - (plotH * n) / ytop
      // 网格 + Y 轴刻度
      g.font = '10px sans-serif'
      g.strokeStyle = tc.grid
      g.lineWidth = 1
      for (let k = 0; k <= 4; k++) {
        const v = Math.round((ytop * k) / 4)
        const y = Y(v)
        g.beginPath()
        g.moveTo(padL, y)
        g.lineTo(padL + plotW, y)
        g.stroke()
        g.fillStyle = tc.faint
        g.textAlign = 'right'
        g.fillText(String(v), padL - 6, y + 3)
        g.textAlign = 'left'
      }
      // X 轴年份
      const step = Math.max(1, Math.ceil(years.length / Math.max(1, Math.floor(plotW / 46))))
      years.forEach((yr, i) => {
        if (i % step === 0 || i === years.length - 1) {
          g.fillStyle = tc.faint
          g.fillText(yr, X(i) - 10, H - 10)
        }
      })
      // 各关键词折线
      const anyHover = (hoverRef.current ?? '').startsWith('p')
      series.forEach((s, si) => {
        const col = PALETTE[si % PALETTE.length]
        const map = new Map(s.years.map((p) => [p.y, p.n]))
        const active = hoverRef.current?.startsWith(`p${si}_`) ?? false
        g.globalAlpha = anyHover && !active ? 0.3 : 1
        g.strokeStyle = col
        g.lineWidth = active ? 2.4 : 1.6
        g.beginPath()
        years.forEach((yr, yi) => {
          const x = X(yi)
          const y = Y(map.get(yr) ?? 0)
          if (yi === 0) g.moveTo(x, y)
          else g.lineTo(x, y)
        })
        g.stroke()
        // 数据点命中区 + 悬停圆点
        years.forEach((yr, yi) => {
          const x = X(yi)
          const y = Y(map.get(yr) ?? 0)
          const key = `p${si}_${yi}`
          if (hoverRef.current === key) {
            g.beginPath()
            g.arc(x, y, 4.5, 0, Math.PI * 2)
            g.fillStyle = col
            g.fill()
            g.strokeStyle = tc.dark ? '#1d1b1d' : '#ffffff'
            g.lineWidth = 1.5
            g.stroke()
          }
          hits.push({
            contains: (px, py) => (px - x) * (px - x) + (py - y) * (py - y) <= 576,
            key,
            tip: `${s.w} · ${yr} · ${map.get(yr) ?? 0} 篇`,
            pick: () => openWord(s.w)
          })
        })
        g.globalAlpha = 1
      })
      // 右侧图例（词 + 近10年总量），垂直居中避让悬浮提示
      const legendTop = Math.max(padT + 8, Math.round(H / 2 - (series.length * 17) / 2))
      series.forEach((s, si) => {
        const ly = legendTop + si * 17
        g.fillStyle = PALETTE[si % PALETTE.length]
        g.fillRect(W - padR + 16, ly - 8, 9, 9)
        g.fillStyle = tc.dim
        g.font = '11px sans-serif'
        g.fillText(`${trunc(s.w, 6)} ${s.total}`, W - padR + 30, ly)
      })
      const hv = hits.find((h) => h.key === hoverRef.current)
      if (hv) drawTip(g, W, hv.tip)
    }
    mountStage(paint, hits)
  }

  // ---------- 热力：GitHub 风格 53 周 × 7 天 ----------
  const drawHeat = (): void => {
    const cv = stageRef.current
    if (!cv) return
    const hits: Hit[] = []
    const paint = (g: CanvasRenderingContext2D, W: number, H: number): void => {
      hits.length = 0
      const tc = themeColors()
      const recs = ex?.heatmap ?? []
      if (recs.length === 0) {
        drawEmpty(g, W, H, '还没有阅读记录——打开 PDF 读几分钟再来看。')
        return
      }
      const days = new Map(recs.map((d) => [d.day, d.seconds]))
      const WEEKS = 53
      let cell = clamp(Math.floor((W - 42) / WEEKS), 7, 15)
      const gap = cell >= 11 ? 3 : 2
      const step = cell + gap
      const gridW = WEEKS * step - gap
      const gridH = 7 * step - gap
      const x0 = Math.max(34, W - gridW - 8)
      const y0 = Math.max(12, Math.round((H - gridH - 34) / 2))
      const pad2 = (v: number): string => String(v).padStart(2, '0')
      const fmtDay = (d: Date): string => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
      const today = new Date()
      const endSunday = new Date(today)
      endSunday.setDate(today.getDate() + (6 - ((today.getDay() + 6) % 7)))
      const ramp = tc.dark ? HEAT_DARK : HEAT_LIGHT
      const months: Array<{ x: number; label: string }> = []
      let lastMonth = -1
      for (let c = 0; c < WEEKS; c++) {
        for (let r = 0; r < 7; r++) {
          const d = new Date(endSunday)
          d.setDate(endSunday.getDate() - ((WEEKS - 1 - c) * 7 + (6 - r)))
          if (d > today) continue
          const key = fmtDay(d)
          const secs = days.get(key) ?? 0
          const lvl = secs <= 0 ? 0 : secs <= 600 ? 1 : secs <= 1800 ? 2 : secs <= 3600 ? 3 : 4
          const x = x0 + c * step
          const y = y0 + r * step
          g.fillStyle = ramp[lvl]
          g.beginPath()
          g.roundRect(x, y, cell, cell, 2.5)
          g.fill()
          hits.push({
            contains: (px, py) => px >= x && px <= x + cell && py >= y && py <= y + cell,
            key,
            tip: `${key} · ${secs > 0 ? fmtHours(secs) : '无阅读'}`
          })
          if (r === 0 && d.getMonth() !== lastMonth) {
            months.push({ x, label: `${d.getMonth() + 1}月` })
            lastMonth = d.getMonth()
          }
        }
      }
      // 月份标签（左侧）+ 周一/三/五 + 色阶图例（右）
      const labelY = y0 + gridH + 18
      g.font = '10px sans-serif'
      g.fillStyle = tc.faint
      let lastX = -100
      for (const mo of months) {
        if (mo.x - lastX >= 26) {
          g.fillText(mo.label, mo.x, labelY)
          lastX = mo.x
        }
      }
      const wl = ['一', '', '三', '', '五', '', '']
      wl.forEach((t, r) => {
        if (t) g.fillText(t, x0 - 16, y0 + r * step + cell - 1)
      })
      const lx = x0 + gridW - (5 * step + 40)
      if (lx > lastX + 40) {
        g.fillText('少', lx, labelY)
        for (let k = 0; k < 5; k++) {
          g.fillStyle = ramp[k]
          g.beginPath()
          g.roundRect(lx + 14 + k * step, labelY - 8, cell, cell, 2.5)
          g.fill()
        }
        g.fillStyle = tc.faint
        g.fillText('多', lx + 14 + 5 * step + 3, labelY)
      }
      const hv = hits.find((h) => h.key === hoverRef.current)
      if (hv) drawTip(g, W, hv.tip)
    }
    mountStage(paint, hits)
  }

  // ---------- 排行：作者横向条形 ----------
  const drawRank = (): void => {
    const cv = stageRef.current
    if (!cv) return
    const hits: Hit[] = []
    const paint = (g: CanvasRenderingContext2D, W: number, H: number): void => {
      hits.length = 0
      const tc = themeColors()
      const rows = ex?.authorsTop.slice(0, 15) ?? []
      if (rows.length === 0) {
        drawEmpty(g, W, H, '暂无作者数据。')
        return
      }
      const max = Math.max(1, ...rows.map((r) => r.n))
      const nameW = Math.min(180, Math.round(W * 0.26))
      const barX = nameW + 12
      const barW = Math.max(40, W - barX - 58)
      const rowH = Math.min(26, (H - 8) / rows.length)
      const bh = Math.min(16, rowH * 0.56)
      rows.forEach((r, i) => {
        const y = 4 + i * rowH
        const key = `r${i}`
        const hov = hoverRef.current === key
        if (hov) {
          g.fillStyle = tc.soft
          g.beginPath()
          g.roundRect(2, y, W - 4, rowH, 5)
          g.fill()
        }
        g.fillStyle = tc.text
        g.font = '12px sans-serif'
        g.fillText(trunc(r.author, Math.floor(nameW / 12)), 6, y + rowH / 2 + 4, nameW - 8)
        const w = Math.max(3, (barW * r.n) / max)
        g.fillStyle = hov ? PALETTE[2] : PALETTE[i % PALETTE.length]
        g.beginPath()
        g.roundRect(barX, y + (rowH - bh) / 2, w, bh, 4)
        g.fill()
        g.fillStyle = tc.dim
        g.font = '10.5px sans-serif'
        g.fillText(`${r.n} 篇`, barX + w + 6, y + rowH / 2 + 4)
        hits.push({
          contains: (px, py) => px >= 0 && px <= W && py >= y && py <= y + rowH,
          key,
          tip: `${r.author} · ${r.n} 篇`,
          pick: () => openAuthor(r.author)
        })
      })
      const hv = hits.find((h) => h.key === hoverRef.current)
      if (hv) drawTip(g, W, hv.tip)
    }
    mountStage(paint, hits)
  }

  const drawStage = (): void => {
    const cv = stageRef.current
    if (!cv || !visible) return
    if (!ov) {
      renderCanvas(cv, (g, W, H) => drawEmpty(g, W, H, ex === null ? '正在加载统计数据…' : '暂无数据'))
      cv.onmousemove = null
      cv.onmouseleave = null
      cv.onclick = null
      return
    }
    if (view === 'cloud') drawCloud()
    else if (view === 'bubble') drawBubble()
    else if (view === 'tree') drawTree()
    else if (view === 'timeline') drawTimeline()
    else if (view === 'heat') drawHeat()
    else drawRank()
  }

  // ---------- 月度导入柱 + 阅读时长折线（单图） ----------
  const drawMonthly = (): void => {
    const cv = monthlyRef.current
    if (!cv || !visible) return
    renderCanvas(cv, (g, W, H) => {
      const tc = themeColors()
      const rows = ov?.monthly ?? []
      if (rows.length === 0) {
        drawEmpty(g, W, H, '暂无月度数据。')
        return
      }
      const padL = 36
      const padB = 20
      const padT = 10
      const maxAdd = Math.max(1, ...rows.map((r) => r.added))
      const maxRead = Math.max(1, ...rows.map((r) => r.readSeconds))
      const bw = (W - padL - 8) / rows.length
      g.font = '10px sans-serif'
      rows.forEach((r, i) => {
        const h = ((H - padB - padT) * r.added) / maxAdd
        g.fillStyle = 'rgba(122,158,126,0.5)'
        g.fillRect(padL + i * bw + bw * 0.22, H - padB - h, bw * 0.56, h)
        if (i % 2 === 0 || rows.length <= 8) {
          g.fillStyle = tc.faint
          g.fillText(r.ym.slice(2), padL + i * bw + 1, H - 6)
        }
      })
      g.strokeStyle = '#b0654a'
      g.lineWidth = 1.6
      g.beginPath()
      rows.forEach((r, i) => {
        const x = padL + i * bw + bw / 2
        const y = H - padB - (H - padB - padT) * (r.readSeconds / maxRead)
        if (i === 0) g.moveTo(x, y)
        else g.lineTo(x, y)
      })
      g.stroke()
      g.fillStyle = 'rgba(122,158,126,0.95)'
      g.fillRect(W - 152, 6, 8, 8)
      g.fillStyle = tc.dim
      g.fillText('导入', W - 141, 13)
      g.strokeStyle = '#b0654a'
      g.beginPath()
      g.moveTo(W - 106, 10)
      g.lineTo(W - 94, 10)
      g.stroke()
      g.fillText('阅读时长', W - 90, 13)
    })
  }

  // ---------- 阅读时长 Top10（点击打开论文） ----------
  const drawTop = (): void => {
    const cv = topRef.current
    if (!cv || !visible) return
    renderCanvas(cv, (g, W, H) => {
      const tc = themeColors()
      const rows = ov?.topRead.slice(0, 10) ?? []
      if (rows.length === 0) {
        drawEmpty(g, W, H, '还没有阅读时长记录——打开 PDF 读几分钟再来看。')
        cv.onclick = null
        return
      }
      const max = Math.max(1, ...rows.map((r) => r.seconds))
      const labelW = Math.min(280, Math.round(W * 0.42))
      const rowH = Math.min(26, (H - 8) / rows.length)
      const barX = labelW + 10
      rows.forEach((r, i) => {
        const y = 4 + i * rowH
        g.fillStyle = tc.dim
        g.font = '11.5px sans-serif'
        g.fillText(trunc(r.title, 30), 4, y + rowH * 0.68, labelW - 6)
        const w = Math.max(2, ((W - barX - 64) * r.seconds) / max)
        g.fillStyle = PALETTE[2]
        g.beginPath()
        g.roundRect(barX, y + rowH * 0.26, w, rowH * 0.48, 3)
        g.fill()
        g.fillStyle = tc.dim
        g.font = '10.5px sans-serif'
        g.fillText(fmtHours(r.seconds), barX + w + 6, y + rowH * 0.68)
      })
      cv.onclick = (e): void => {
        const r = cv.getBoundingClientRect()
        const row = rows[Math.floor((e.clientY - r.top - 4) / rowH)]
        if (row) onOpen(row.id)
      }
    })
  }

  // 每次渲染后刷新重绘闭包
  useEffect(() => {
    redrawRef.current = () => {
      try {
        drawStage()
        drawMonthly()
        drawTop()
      } catch (e) {
        console.error('[stats] draw failed:', e)
      }
    }
  })

  // 挂载 / 尺寸变化时重绘
  useEffect(() => {
    if (!visible) return
    redrawRef.current()
    const ro = new ResizeObserver(() => redrawRef.current())
    const els = [stageRef.current, monthlyRef.current, topRef.current]
    for (const el of els) if (el) ro.observe(el)
    return () => ro.disconnect()
  }, [visible])

  // 视图 / 数据变化 → 重绘大画布（清掉悬停状态）
  useEffect(() => {
    hoverRef.current = null
    drawStage()
  }, [view, ov, ex])

  // 数据到达 → 下方两图重绘
  useEffect(() => {
    drawMonthly()
    drawTop()
  }, [ov])

  if (!visible) return null
  const readPct = ov && ov.totalPapers > 0 ? Math.round((ov.readingPapers / ov.totalPapers) * 100) : 0
  const cards: Array<{ num: string; label: string; color: string }> = [
    { num: ov ? String(ov.totalPapers) : '—', label: '文献总数', color: PALETTE[0] },
    { num: ov ? fmtHours(ov.totalReadSeconds) : '—', label: '累计阅读时长', color: PALETTE[2] },
    { num: ov ? String(ov.readingPapers) : '—', label: ov ? `在读 · 占 ${readPct}%` : '在读', color: PALETTE[1] },
    { num: ov ? String(ov.statuses.find((s) => s.status === 'read')?.count ?? 0) : '—', label: '已读完', color: PALETTE[3] }
  ]

  return (
    <div className="st2-view">
      {/* 顶部数字卡 */}
      <div className="st2-cards">
        {cards.map((c) => (
          <div key={c.label} className="st2-card" style={{ ['--st2-accent' as string]: c.color }}>
            <div className="st2-num">{c.num}</div>
            <div className="st2-label">{c.label}</div>
          </div>
        ))}
      </div>

      {/* 六形态大画布 */}
      <div className="st2-panel">
        <div className="st2-head">
          <div className="st2-head-title">{VIEWS.find((v) => v.key === view)?.title ?? ''}</div>
          <div className="st2-chips">
            {VIEWS.map((v) => (
              <button key={v.key} className={`st2-chip ${view === v.key ? 'on' : ''}`} onClick={() => setView(v.key)}>
                {v.label}
              </button>
            ))}
          </div>
        </div>
        <canvas ref={stageRef} className="st2-canvas" style={{ height: 380 }} />
      </div>

      {/* 月度时间线 + 阅读时长 Top10 */}
      <div className="st2-grid">
        <div className="st2-panel">
          <div className="st2-head">
            <div className="st2-head-title">月度导入与阅读时长</div>
          </div>
          <canvas ref={monthlyRef} className="st2-canvas" style={{ height: 200 }} />
        </div>
        <div className="st2-panel">
          <div className="st2-head">
            <div className="st2-head-title">阅读时长 Top 10（点击打开）</div>
          </div>
          <canvas ref={topRef} className="st2-canvas" style={{ height: 200 }} />
        </div>
      </div>

      {/* 阅读状态分布 */}
      <div className="st2-panel">
        <div className="st2-head">
          <div className="st2-head-title">阅读状态分布</div>
        </div>
        <div className="st2-status">
          {(ov?.statuses ?? []).map((s) => (
            <span key={s.status} className="st2-status-item">
              <span className="st2-dot" style={{ background: STATUS_META[s.status]?.color ?? '#98a2ab' }} />
              {STATUS_META[s.status]?.label ?? s.status} · {s.count}
            </span>
          ))}
          {ov && ov.statuses.length === 0 && <span className="st2-empty">暂无数据</span>}
          {!ov && <span className="st2-empty">—</span>}
        </div>
      </div>

      {/* 论文列表浮层 */}
      {popup && (
        <>
          <div className="st2-mask" onMouseDown={() => setPopup(null)} />
          <div className="st2-pop">
            <div className="st2-pop-head">
              <span className="st2-pop-title">
                {popup.title} · {popup.items.length} 篇
              </span>
              <button className="st2-pop-x" onClick={() => setPopup(null)} aria-label="关闭">
                ×
              </button>
            </div>
            <div className="st2-pop-list">
              {popup.items.length === 0 && <div className="st2-pop-empty">没有匹配的论文</div>}
              {popup.items.map((p) => (
                <button
                  key={p.id}
                  className="st2-pop-row"
                  onClick={() => {
                    setPopup(null)
                    onOpen(p.id)
                  }}
                >
                  <span className="st2-pop-row-title">{p.title}</span>
                  <span className="st2-pop-row-sub">{[p.authors || '', p.year != null ? String(p.year) : ''].filter(Boolean).join(' · ')}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
