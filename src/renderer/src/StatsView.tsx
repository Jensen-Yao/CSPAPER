// 统计仪表盘（W7，对标 Chartero）：阅读时长排行 / 月度时间线 / 分类分布 / 状态分布 / 标题词云
// 全部 canvas + CSS 自绘，零依赖。visible 时才拉数据。
import { useEffect, useRef, useState } from 'react'
import { STATUS_META, type StatsOverview } from './types'

interface Props {
  visible: boolean
  onOpen: (paperId: number) => void
}

const fmtHours = (s: number): string => (s >= 3600 ? `${(s / 3600).toFixed(1)} 小时` : s >= 60 ? `${Math.round(s / 60)} 分钟` : `${s} 秒`)

export default function StatsView({ visible, onOpen }: Props): JSX.Element | null {
  const [d, setD] = useState<StatsOverview | null>(null)
  const barRef = useRef<HTMLCanvasElement>(null)
  const lineRef = useRef<HTMLCanvasElement>(null)
  const ringRef = useRef<HTMLCanvasElement>(null)
  const cloudRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!visible) return
    void window.api.statsOverview().then(setD).catch(() => setD(null))
  }, [visible])

  // 阅读时长 Top10 横向条形
  useEffect(() => {
    if (!d || !barRef.current) return
    const cv = barRef.current
    const dpr = window.devicePixelRatio || 1
    const W = cv.clientWidth
    const H = cv.clientHeight
    cv.width = W * dpr
    cv.height = H * dpr
    const g = cv.getContext('2d')
    if (!g) return
    g.scale(dpr, dpr)
    g.clearRect(0, 0, W, H)
    const rows = d.topRead.slice(0, 10)
    if (rows.length === 0) {
      g.fillStyle = 'rgba(128,120,110,0.7)'
      g.font = '13px sans-serif'
      g.fillText('还没有阅读时长记录——打开 PDF 读几分钟再来看。', 12, 28)
      return
    }
    const max = Math.max(...rows.map((r) => r.seconds), 1)
    const labelW = Math.min(300, W * 0.42)
    const rowH = Math.min(30, (H - 8) / rows.length)
    const barX = labelW + 8
    rows.forEach((r, i) => {
      const y = 6 + i * rowH
      g.fillStyle = 'rgba(120,112,100,0.95)'
      g.font = '11.5px sans-serif'
      const title = r.title.length > 34 ? r.title.slice(0, 33) + '…' : r.title
      g.fillText(title, 4, y + rowH * 0.66, labelW - 8)
      const w = Math.max(2, ((W - barX - 70) * r.seconds) / max)
      g.fillStyle = '#b08d57'
      g.beginPath()
      g.roundRect(barX, y + rowH * 0.24, w, rowH * 0.52, 3)
      g.fill()
      g.fillStyle = 'rgba(120,112,100,0.85)'
      g.fillText(fmtHours(r.seconds), barX + w + 6, y + rowH * 0.66)
    })
    cv.onclick = (e): void => {
      const rect = cv.getBoundingClientRect()
      const i = Math.floor((e.clientY - rect.top - 6) / rowH)
      if (rows[i]) onOpen(rows[i].id)
    }
  }, [d, onOpen])

  // 月度时间线（导入数柱 + 阅读时长线）
  useEffect(() => {
    if (!d || !lineRef.current) return
    const cv = lineRef.current
    const dpr = window.devicePixelRatio || 1
    const W = cv.clientWidth
    const H = cv.clientHeight
    cv.width = W * dpr
    cv.height = H * dpr
    const g = cv.getContext('2d')
    if (!g) return
    g.scale(dpr, dpr)
    g.clearRect(0, 0, W, H)
    const rows = d.monthly
    if (rows.length === 0) return
    const padL = 34
    const padB = 22
    const maxAdd = Math.max(...rows.map((r) => r.added), 1)
    const maxRead = Math.max(...rows.map((r) => r.readSeconds), 1)
    const bw = (W - padL - 8) / rows.length
    g.font = '10.5px sans-serif'
    rows.forEach((r, i) => {
      const h = ((H - padB - 10) * r.added) / maxAdd
      g.fillStyle = 'rgba(122,158,126,0.55)'
      g.fillRect(padL + i * bw + bw * 0.2, H - padB - h, bw * 0.6, h)
      if (i % 2 === 0 || rows.length <= 8) {
        g.fillStyle = 'rgba(120,112,100,0.7)'
        g.fillText(r.ym.slice(2), padL + i * bw + 2, H - 7)
      }
    })
    // 阅读时长折线
    g.strokeStyle = '#b0654a'
    g.lineWidth = 1.6
    g.beginPath()
    rows.forEach((r, i) => {
      const x = padL + i * bw + bw / 2
      const y = H - padB - (H - padB - 10) * (r.readSeconds / maxRead) + 2
      if (i === 0) g.moveTo(x, y)
      else g.lineTo(x, y)
    })
    g.stroke()
    g.fillStyle = 'rgba(120,112,100,0.7)'
    g.fillText(`导入 ${maxAdd} 篇/月峰值`, padL + 2, 12)
    g.fillStyle = '#b0654a'
    g.fillText(`▬ 阅读时长（峰值 ${fmtHours(maxRead)}）`, padL + 140, 12)
  }, [d])

  // 分类分布环图
  useEffect(() => {
    if (!d || !ringRef.current) return
    const cv = ringRef.current
    const dpr = window.devicePixelRatio || 1
    const W = cv.clientWidth
    const H = cv.clientHeight
    cv.width = W * dpr
    cv.height = H * dpr
    const g = cv.getContext('2d')
    if (!g) return
    g.scale(dpr, dpr)
    g.clearRect(0, 0, W, H)
    const cats = d.categories.slice(0, 8)
    const total = cats.reduce((a, b) => a + b.count, 0) || 1
    const cx = Math.min(90, W * 0.22)
    const cy = H / 2
    const R = Math.min(cx, cy) - 10
    const COLORS = ['#b08d57', '#7a9e7e', '#b0654a', '#6b7fa3', '#a37f9e', '#8a8f6a', '#7e9aa3', '#c4a882']
    let a0 = -Math.PI / 2
    cats.forEach((c, i) => {
      const a1 = a0 + (c.count / total) * Math.PI * 2
      g.beginPath()
      g.moveTo(cx, cy)
      g.arc(cx, cy, R, a0, a1)
      g.closePath()
      g.fillStyle = COLORS[i % COLORS.length]
      g.fill()
      a0 = a1
    })
    g.globalCompositeOperation = 'destination-out'
    g.beginPath()
    g.arc(cx, cy, R * 0.55, 0, Math.PI * 2)
    g.fill()
    g.globalCompositeOperation = 'source-over'
    g.font = '11.5px sans-serif'
    cats.forEach((c, i) => {
      const y = 18 + i * 17
      g.fillStyle = COLORS[i % COLORS.length]
      g.fillRect(cx + R + 12, y - 8, 9, 9)
      g.fillStyle = 'rgba(120,112,100,0.95)'
      g.fillText(`${c.name} · ${c.count}`, cx + R + 26, y)
    })
  }, [d])

  // 标题词云
  useEffect(() => {
    if (!d || !cloudRef.current) return
    const cv = cloudRef.current
    const dpr = window.devicePixelRatio || 1
    const W = cv.clientWidth
    const H = cv.clientHeight
    cv.width = W * dpr
    cv.height = H * dpr
    const g = cv.getContext('2d')
    if (!g) return
    g.scale(dpr, dpr)
    g.clearRect(0, 0, W, H)
    const words = d.words.slice(0, 48)
    if (words.length === 0) {
      g.fillStyle = 'rgba(128,120,110,0.7)'
      g.font = '13px sans-serif'
      g.fillText('标题词云会随文献增多而生成。', 12, 28)
      return
    }
    const max = words[0].n
    const COLORS = ['#b08d57', '#7a9e7e', '#b0654a', '#6b7fa3', '#a37f9e', '#8a8f6a']
    let x = 10
    let y = 26
    for (const w of words) {
      const size = Math.max(11, Math.min(30, 11 + Math.sqrt(w.n / max) * 19))
      g.font = `${size}px sans-serif`
      const tw = g.measureText(w.w).width
      if (x + tw > W - 8) {
        x = 10
        y += size + 8
        if (y > H - 6) break
      }
      g.fillStyle = COLORS[Math.floor(Math.random() * COLORS.length)]
      g.globalAlpha = 0.55 + 0.45 * (w.n / max)
      g.fillText(w.w, x, y)
      g.globalAlpha = 1
      x += tw + 10
    }
  }, [d])

  if (!visible) return null
  const readPct = d && d.totalPapers > 0 ? Math.round((d.readingPapers / d.totalPapers) * 100) : 0

  return (
    <div className="stats-view">
      <div className="stats-cards">
        <div className="stat-card">
          <div className="stat-num">{d?.totalPapers ?? '—'}</div>
          <div className="stat-label">文献总数</div>
        </div>
        <div className="stat-card">
          <div className="stat-num">{d ? fmtHours(d.totalReadSeconds) : '—'}</div>
          <div className="stat-label">累计阅读时长</div>
        </div>
        <div className="stat-card">
          <div className="stat-num">{d?.readingPapers ?? '—'}</div>
          <div className="stat-label">在读（{readPct}%）</div>
        </div>
        <div className="stat-card">
          <div className="stat-num">{d ? d.statuses.find((s) => s.status === 'read')?.count ?? 0 : '—'}</div>
          <div className="stat-label">已读完</div>
        </div>
      </div>
      <div className="stats-grid">
        <div className="stats-panel">
          <div className="stats-title">阅读时长 Top 10（点击跳转）</div>
          <canvas ref={barRef} className="stats-canvas" style={{ height: 320 }} />
        </div>
        <div className="stats-panel">
          <div className="stats-title">月度导入与阅读</div>
          <canvas ref={lineRef} className="stats-canvas" style={{ height: 200 }} />
          <div className="stats-title" style={{ marginTop: 10 }}>分类分布</div>
          <canvas ref={ringRef} className="stats-canvas" style={{ height: 180 }} />
        </div>
      </div>
      <div className="stats-panel">
        <div className="stats-title">标题词云</div>
        <canvas ref={cloudRef} className="stats-canvas" style={{ height: 170 }} />
      </div>
      <div className="stats-panel">
        <div className="stats-title">阅读状态分布</div>
        <div className="stats-status-row">
          {(d?.statuses ?? []).map((s) => (
            <span key={s.status} className="status-pill">
              <span className="sp-dot" style={{ background: STATUS_META[s.status]?.color ?? '#98a2ab' }} />
              {STATUS_META[s.status]?.icon === '-new' ? '●' : STATUS_META[s.status]?.icon ?? ''} {STATUS_META[s.status]?.label ?? s.status} · {s.count}
            </span>
          ))}
          {!d?.statuses?.length && <span className="stats-empty">暂无数据</span>}
        </div>
      </div>
    </div>
  )
}
