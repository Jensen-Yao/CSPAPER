import { useEffect, useMemo, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { Paper } from './types'
import { catLabel, statusMeta, withAlpha } from './LibraryPane'
import PaperDetailPanel from './PaperDetailPanel'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

interface Props {
  papers: Paper[]
  activeId: number | null
  onOpen: (p: Paper) => void
  onAddPapers: () => void
  onOpenRecords: () => void
  onOpenOnline?: () => void
  onPapersChanged?: () => void
}

// 缩略图缓存（进程内）：paperId → dataURL
const thumbCache = new Map<number, string>()

// 单张封面：懒加载（进入视口才渲染 PDF 第一页）
function Thumb({ paper }: { paper: Paper }): JSX.Element {
  const [src, setSrc] = useState<string | null>(thumbCache.get(paper.id) ?? null)
  const ref = useRef<HTMLDivElement | null>(null)
  const started = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => entries.forEach((en) => en.isIntersecting && start()),
      { rootMargin: '400px 0px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const start = (): void => {
    if (started.current) return
    started.current = true
    void (async () => {
      try {
        const buf = await window.api.readPdf(paper.path)
        const assetBase = window.location.href.replace(/[^/]*$/, '')
        const d = await pdfjsLib.getDocument({
          data: new Uint8Array(buf),
          standardFontDataUrl: `${assetBase}standard_fonts/`,
          cMapUrl: `${assetBase}cmaps/`,
          cMapPacked: true
        }).promise
        const page = await d.getPage(1)
        const base = page.getViewport({ scale: 1 })
        const scale = Math.min(1.2, 560 / base.width) // 2x 渲染抗模糊，CSS 缩回
        const vp = page.getViewport({ scale })
        const canvas = document.createElement('canvas')
        canvas.width = Math.floor(vp.width)
        canvas.height = Math.floor(vp.height)
        await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp } as any).promise
        const url = canvas.toDataURL('image/jpeg', 0.72)
        thumbCache.set(paper.id, url)
        setSrc(url)
        void d.destroy()
      } catch {
        /* PDF 无法读取（题录占位损坏等），保留占位图 */
      }
    })()
  }

  return (
    <div className="card-thumb" ref={ref}>
      {src ? <img src={src} alt="" loading="lazy" /> : <div className="thumb-ph">📄</div>}
    </div>
  )
}

// AI 小结区块：有缓存直接展示，否则一键生成
function SummaryBlock({ paper, onDone }: { paper: Paper; onDone: (id: number, s: string) => void }): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [val, setVal] = useState(paper.summary ?? '')
  const [err, setErr] = useState('')

  const gen = async (): Promise<void> => {
    setBusy(true)
    setErr('')
    try {
      const s = await window.api.summarizePaper(paper.id)
      setVal(s)
      onDone(paper.id, s)
    } catch (e) {
      setErr(String(e).replace(/^Error: /, '').slice(0, 80))
    } finally {
      setBusy(false)
    }
  }

  if (!val) {
    return (
      <div className="card-sum">
        <span className="sum-label">AI 小结</span>
        <button className="sum-gen" disabled={busy} onClick={() => void gen()}>
          {busy ? '生成中…' : '生成小结'}
        </button>
        {err && <span className="sum-err">{err}</span>}
      </div>
    )
  }
  return (
    <div className="card-sum">
      <span className="sum-label">AI 小结</span>
      <div className="sum-text">{val}</div>
    </div>
  )
}

// 卡片右上角阅读状态角标（v0.6 五态；'-new' 特殊渲染为小圆点）
function StatusBadge({ status }: { status: string }): JSX.Element {
  const m = statusMeta(status)
  return (
    <span className="pcard-status" style={{ color: m.color, background: withAlpha(m.color, 0.1) }} title={`阅读状态：${m.label}`}>
      {m.icon === '-new' ? <i className="sp-newdot" /> : m.icon}
    </span>
  )
}

export default function LibraryHome({ papers, activeId, onOpen, onAddPapers, onOpenRecords, onOpenOnline, onPapersChanged }: Props): JSX.Element {
  // 标签名 → 颜色（卡片 hover 标签行用）
  const [tagColors, setTagColors] = useState<Record<string, string>>({})
  useEffect(() => {
    let on = true
    window.api
      .tagsList()
      .then((ts) => {
        if (on) setTagColors(Object.fromEntries(ts.map((t) => [t.name, t.color])))
      })
      .catch(() => {})
    return () => {
      on = false
    }
  }, [papers])

  // 按导入月份分组（最新月份在前）
  const groups = useMemo(() => {
    const m = new Map<string, Paper[]>()
    for (const p of papers) {
      const d = new Date((p.added_at || '').replace(' ', 'T') + 'Z')
      const key = isNaN(d.getTime()) ? '更早' : `${d.getFullYear()}年${d.getMonth() + 1}月`
      if (!m.has(key)) m.set(key, [])
      m.get(key)!.push(p)
    }
    return [...m.entries()].sort((a, b) => {
      if (a[0] === '更早') return 1
      if (b[0] === '更早') return -1
      return b[0].localeCompare(a[0])
    })
  }, [papers])

  const refresh = (id: number, s: string): void => {
    const p = papers.find((x) => x.id === id)
    if (p) (p as Paper & { summary?: string }).summary = s
  }

  // 单击选中 → 右侧详情栏；双击 / 「打开阅读」进入阅读器
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const selected = papers.find((p) => p.id === selectedId) ?? null

  return (
    <div className="libhome-outer">
      <div className="libhome">
        <div className="libhome-bar">
          <span className="libhome-title">文献库</span>
          <span className="libhome-count">{papers.length} 篇</span>
          <span style={{ flex: 1 }} />
          <button className="btn ghost" onClick={onOpenRecords} title="导入从 CNKI / 万方等批量导出的题录文件">
            导入题录…
          </button>
          <button className="btn ghost" onClick={onOpenOnline} title="DOI / arXiv / 链接 / 关键词在线检索抓取（Translators 脚本）">
            🌐 在线添加
          </button>
          <button className="btn" onClick={onAddPapers} title="导入 PDF，AI 自动归类；也可拖入窗口">
            ⬆ 上传文献
          </button>
        </div>
        {papers.length === 0 && (
          <div className="libhome-empty">
            <div className="big">📚</div>
            <div className="headline">导入第一篇文献入库</div>
            <div className="tip">
              支持拖入 PDF / 整个文件夹；也可以从 Zotero 迁移、导入知网题录，或用浏览器插件一键收藏。
              首次使用可先 <button className="libhome-link" onClick={() => void pickLibrary()}>选择文献库文件夹</button>。
            </div>
          </div>
        )}
        {groups.map(([month, list]) => (
          <div key={month}>
            <div className="libhome-month">
              🗓 {month}
              <span className="libhome-month-n">{list.length} 篇</span>
            </div>
            <div className="libhome-grid">
              {list.map((p) => (
                <div
                  key={p.id}
                  className={`pcard ${p.id === selectedId ? 'active' : ''}`}
                  onClick={() => setSelectedId(p.id)}
                  onDoubleClick={() => onOpen(p)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    window.api.paperMenu(p.id, e.clientX, e.clientY)
                  }}
                  title="单击查看详情，双击进入阅读"
                >
                <StatusBadge status={p.status} />
                <Thumb paper={p} />
                <div className="pcard-body">
                  <div className="pcard-title">{p.title}</div>
                  <div className="pcard-meta">
                    {p.authors && <div className="pcard-authors">作者：{p.authors.split(/[,;，；]/)[0]} 等</div>}
                    <div className="pcard-venue">
                      {p.venue || catLabel(p.category)}
                      {p.year ? ` · ${p.year}` : ''}
                    </div>
                  </div>
                  <SummaryBlock paper={p} onDone={refresh} />
                  {p.last_page != null && p.last_page > 0 && p.n_pages > 0 && p.last_page < p.n_pages && (
                    <div className="pcard-prog" title={`读到第 ${p.last_page} 页，共 ${p.n_pages} 页`}>
                      <i style={{ width: `${Math.round((p.last_page / p.n_pages) * 100)}%` }} />
                    </div>
                  )}
                  {(p.tags?.length ?? 0) > 0 && (
                    <div className="pcard-tags">
                      {(p.tags ?? []).slice(0, 3).map((t) => (
                        <span key={t} className="tag-chip" title={t}>
                          <i className="tag-dot" style={{ background: tagColors[t] ?? '#98a2ab' }} />
                          {t}
                        </span>
                      ))}
                      {(p.tags ?? []).length > 3 && (
                        <span className="tag-chip more" title={(p.tags ?? []).slice(3).join('、')}>
                          +{(p.tags ?? []).length - 3}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
        ))}
      </div>
      {selected && (
        <PaperDetailPanel
          paper={selected}
          onClose={() => setSelectedId(null)}
          onOpen={(p) => {
            setSelectedId(null)
            onOpen(p)
          }}
          onSummarized={refresh}
          onChanged={onPapersChanged}
        />
      )}
    </div>
  )
}

// 空库引导里直接选库文件夹（延迟 import 避免环依赖：App 已把该方法作为 prop 传入的场景）
async function pickLibrary(): Promise<void> {
  await window.api.pickLibrary()
  location.reload()
}
