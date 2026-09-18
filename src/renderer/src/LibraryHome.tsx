import { useEffect, useMemo, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { Paper } from './types'
import { catLabel } from './LibraryPane'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

interface Props {
  papers: Paper[]
  activeId: number | null
  onOpen: (p: Paper) => void
  onAddPapers: () => void
  onOpenRecords: () => void
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
        const scale = Math.min(1.2, 560 / base.width) // 2x for retina display then CSS scale back
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
        /* PDF cannot be read (for example, an entry placeholder failed), leave the placeholder empty */
      }
    })()
  }

  return (
    <div className="card-thumb" ref={ref}>
      {src ? <img src={src} alt="" loading="lazy" /> : <div className="thumb-ph">📄</div>}
    </div>
  )
}

// AI summary block: shows the cached one, otherwise provides one-click generation
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
        <span className="sum-label">AI summary</span>
        <button className="sum-gen" disabled={busy} onClick={() => void gen()}>
          {busy ? 'Generating…' : 'Generate summary'}
        </button>
        {err && <span className="sum-err">{err}</span>}
      </div>
    )
  }
  return (
    <div className="card-sum">
      <span className="sum-label">AI summary</span>
      <div className="sum-text">{val}</div>
    </div>
  )
}

export default function LibraryHome({ papers, activeId, onOpen, onAddPapers, onOpenRecords }: Props): JSX.Element {
  // Group by import month (same as the reference product's "2026年3月" style), newest month first
  const groups = useMemo(() => {
    const m = new Map<string, Paper[]>()
    for (const p of papers) {
      const d = new Date((p.added_at || '').replace(' ', 'T') + 'Z')
      const key = isNaN(d.getTime()) ? 'Earlier' : `${d.getFullYear()} year ${d.getMonth() + 1} month`
      if (!m.has(key)) m.set(key, [])
      m.get(key)!.push(p)
    }
    return [...m.entries()].sort((a, b) => {
      if (a[0] === 'Earlier') return 1
      if (b[0] === 'Earlier') return -1
      return b[0].localeCompare(a[0])
    })
  }, [papers])

  const refresh = (id: number, s: string): void => {
    const p = papers.find((x) => x.id === id)
    if (p) (p as Paper & { summary?: string }).summary = s
  }

  return (
    <div className="libhome">
      <div className="libhome-bar">
        <span className="libhome-count">{papers.length} papers in library</span>
        <span style={{ flex: 1 }} />
        <button className="btn ghost" onClick={onOpenRecords} title="Import titles exported in bulk from CNKI / Wanfang, etc.">
          Import titles…
        </button>
        <button className="btn" onClick={onAddPapers} title="Import PDF, auto categorize with AI; can also drag into the window">
          ⬆ Upload literature
        </button>
      </div>
      {papers.length === 0 && (
        <div className="libhome-empty">
          <div className="big">📚</div>
          <div className="headline">Import the first paper into the library</div>
          <div className="tip">Support dragging in a PDF / entire folder; can also import Zotero library, CNKI titles, or save directly from the browser.</div>
        </div>
      )}
      {groups.map(([month, list]) => (
        <div key={month}>
          <div className="libhome-month">🗓 {month}</div>
          <div className="libhome-grid">
            {list.map((p) => (
              <div
                key={p.id}
                className={`pcard ${p.id === activeId ? 'active' : ''}`}
                onClick={() => onOpen(p)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  window.api.paperMenu(p.id, e.clientX, e.clientY)
                }}
                title={`${catLabel(p.category)} · ${p.status}`}
              >
                <Thumb paper={p} />
                <div className="pcard-body">
                  <div className="pcard-title">{p.title}</div>
                  <div className="pcard-meta">
                    {p.authors && <div className="pcard-authors">Authors: {p.authors.split(/[,;，；]/)[0]}{' et al.'}</div>}
                    <div className="pcard-venue">
                      {p.venue || catLabel(p.category)}
                      {p.year ? ` · ${p.year}` : ''}
                    </div>
                  </div>
                  <SummaryBlock paper={p} onDone={refresh} />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
