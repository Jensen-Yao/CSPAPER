import { useEffect, useMemo, useRef, useState } from 'react'
import type { Highlight, Paper } from './types'

interface Props {
  papers: Paper[]
  visible: boolean
  onOpenPaper: (paperId: number, page?: number) => void
  onRefresh: () => void
}

type NoteFilter = 'all' | 'note' | 'hl'

/** 每篇文献聚合出的笔记数据：我的笔记（markdown）+ 划词标注 */
interface PaperNotes {
  note: string
  highlights: Highlight[]
}

/** 列表行：文献 + 聚合笔记 */
interface Row {
  paper: Paper
  note: string
  highlights: Highlight[]
}

const PAGE_SIZE = 200 // 首屏只加载前 200 篇，其余走「加载更多」
const BATCH = 12 // 分批拉取，避免几百篇一次打满 IPC

// 高亮颜色名 → 色点（与 PdfViewer 的三色浮条一致；其余值当作 CSS 颜色直接用）
const HL_DOT: Record<string, string> = {
  yellow: '#e7c04a',
  green: '#4cb27e',
  red: '#e06a5a'
}
const hlDotColor = (c?: string): string => (c && HL_DOT[c]) || c || HL_DOT.yellow

// markdown → 纯文本（预览用）：去代码块/链接/标题井号/引用符/加粗斜体标记
function mdToPlain(md: string): string {
  return md
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[([^\]]*)\]\(([^)]*)\)/g, '$1')
    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/(^|\s)[*_~]{1,3}([^*_~\n]+)[*_~]{1,3}($|\s)/g, '$1$2$3')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

// 下载文件名的 Windows 非法字符
const safeFileName = (s: string): string => s.replace(/[\\/:*?"<>|]/g, '_').trim() || 'untitled'

// 该篇是否有任何内容（笔记或标注）——无内容的文献不出现在列表与导出里
const hasContent = (r: Row): boolean => r.note.trim() !== '' || r.highlights.length > 0

// 单篇文献 → markdown 小节（## 标题 + 笔记正文 + 标注引用块）
function paperSection(r: Row): string[] {
  const lines: string[] = [`## ${r.paper.title}`, '']
  const meta = [r.paper.authors, r.paper.venue, r.paper.year != null ? String(r.paper.year) : '']
    .map((x) => x.trim())
    .filter(Boolean)
    .join(' · ')
  if (meta) lines.push(`*${meta}*`, '')
  const note = r.note.trim()
  if (note) lines.push(note, '')
  if (r.highlights.length) {
    if (note) lines.push('**划词标注**', '')
    for (const h of r.highlights) lines.push(`> 第 ${h.page} 页：${h.text.replace(/\s*\n\s*/g, ' ')}`, '')
  }
  return lines
}

function downloadText(name: string, text: string, mime: string): void {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: mime }))
  a.download = name
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
}

/**
 * 笔记中心：全库「我的笔记 + 划词标注」聚合工作区。
 * visible 变 true 且有文献时才拉取数据（分批、带缓存），支持搜索 / 类型过滤 /
 * 就地编辑（防抖自动保存）/ 导出 Markdown。
 */
export default function NotesView({ papers, visible, onOpenPaper, onRefresh }: Props): JSX.Element | null {
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [entries, setEntries] = useState<Record<number, PaperNotes>>({})
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<NoteFilter>('all')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [saveHint, setSaveHint] = useState<'idle' | 'saving' | 'saved'>('idle')

  // 数据缓存 + 加载代次：papers 长度变化（导入/删除）即整体失效重拉
  const cacheRef = useRef<Map<number, PaperNotes>>(new Map())
  const lenRef = useRef(papers.length)
  const runRef = useRef(0)
  // 就地编辑的防抖保存
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<{ id: number; text: string } | null>(null)

  // papers 数量变化 → 缓存失效，并取消进行中的分批拉取
  useEffect(() => {
    if (lenRef.current !== papers.length) {
      lenRef.current = papers.length
      cacheRef.current = new Map()
      runRef.current += 1
    }
  }, [papers.length])

  // 分批加载前 limit 篇的笔记与标注（串行分批，逐批上屏）
  useEffect(() => {
    if (!visible || papers.length === 0) return
    const targets = papers.slice(0, limit)
    const missing = targets.filter((p) => !cacheRef.current.has(p.id))
    if (missing.length === 0) return
    const run = ++runRef.current
    setLoading(true)
    void (async () => {
      for (let i = 0; i < missing.length; i += BATCH) {
        if (runRef.current !== run) return
        const chunk = missing.slice(i, i + BATCH)
        const got = await Promise.all(
          chunk.map(async (p): Promise<[number, PaperNotes]> => {
            try {
              const [note, hls] = await Promise.all([window.api.myNotesGet(p.id), window.api.listHighlights(p.id)])
              return [p.id, { note: note ?? '', highlights: hls ?? [] }]
            } catch {
              return [p.id, { note: '', highlights: [] }]
            }
          })
        )
        if (runRef.current !== run) return
        for (const [id, e] of got) cacheRef.current.set(id, e)
        // 从缓存按 papers 顺序重建，保证渲染顺序稳定
        const snap: Record<number, PaperNotes> = {}
        for (const p of targets) {
          const e = cacheRef.current.get(p.id)
          if (e) snap[p.id] = e
        }
        setEntries(snap)
      }
      if (runRef.current === run) setLoading(false)
    })()
  }, [visible, papers, papers.length, limit])

  // 卸载时取消加载、把未落盘的编辑立即保存
  useEffect(() => {
    return () => {
      runRef.current += 1
      if (saveTimer.current) clearTimeout(saveTimer.current)
      const p = pendingRef.current
      pendingRef.current = null
      if (p) void window.api.myNotesSave(p.id, p.text).catch(() => {})
    }
  }, [])

  const doSave = async (id: number, text: string): Promise<void> => {
    try {
      await window.api.myNotesSave(id, text)
      const prev = cacheRef.current.get(id)
      cacheRef.current.set(id, { note: text, highlights: prev?.highlights ?? [] })
      setEntries((m) => ({ ...m, [id]: { note: text, highlights: m[id]?.highlights ?? [] } }))
      setSaveHint('saved')
      window.setTimeout(() => setSaveHint((s) => (s === 'saved' ? 'idle' : s)), 1600)
      onRefresh() // 通知外部笔记有变化（刷新库侧统计等）
    } catch {
      setSaveHint('idle')
    }
  }

  const scheduleSave = (id: number, text: string): void => {
    setDraft(text)
    pendingRef.current = { id, text }
    setSaveHint('saving')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null
      const p = pendingRef.current
      pendingRef.current = null
      if (p) void doSave(p.id, p.text)
    }, 800)
  }

  const flushSave = (): void => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    const p = pendingRef.current
    pendingRef.current = null
    if (p) void doSave(p.id, p.text)
  }

  const startEdit = (r: Row): void => {
    flushSave()
    setEditingId(r.paper.id)
    setDraft(r.note)
    setSaveHint('idle')
  }

  const closeEdit = (): void => {
    flushSave()
    setEditingId(null)
  }

  // 过滤 + 统计（基于已加载的前 limit 篇）
  const { rows, all, stats } = useMemo(() => {
    const loaded = papers.slice(0, limit)
    const ql = q.trim().toLowerCase()
    let withNotes = 0
    let hlCount = 0
    const mapped: Row[] = loaded.map((p) => {
      const e = entries[p.id] ?? { note: '', highlights: [] }
      if (e.note.trim()) withNotes += 1
      hlCount += e.highlights.length
      return { paper: p, note: e.note, highlights: e.highlights }
    })
    const match = (r: Row): boolean => {
      const noteHit = r.note.trim() !== ''
      const hlHit = r.highlights.length > 0
      if (filter === 'note' && !noteHit) return false
      if (filter === 'hl' && !hlHit) return false
      if (!hasContent(r)) return false
      if (!ql) return true
      const inTitle = r.paper.title.toLowerCase().includes(ql)
      const inNote = noteHit && r.note.toLowerCase().includes(ql)
      const inHl = hlHit && r.highlights.some((h) => h.text.toLowerCase().includes(ql))
      if (filter === 'note') return inNote || inTitle
      if (filter === 'hl') return inHl
      return inTitle || inNote || inHl
    }
    return { rows: mapped.filter(match), all: mapped, stats: { withNotes, highlights: hlCount } }
  }, [papers, entries, limit, q, filter])

  if (!visible) return null

  const exporting = all.filter(hasContent)

  const exportAll = (): void => {
    if (exporting.length === 0) return
    const head = [`# CSPAPER 笔记导出`, '', `> 导出时间：${new Date().toLocaleString()}　共 ${exporting.length} 篇`, '', '---', '']
    const md = head.concat(...exporting.map((r) => paperSection(r))).join('\n')
    downloadText('CSPAPER-笔记.md', `${md.trim()}\n`, 'text/markdown')
  }

  const filterActive = q.trim() !== '' || filter !== 'all'

  return (
    <div className="notes-view">
      <div className="note-toolbar">
        <input
          className="note-search"
          placeholder="搜索标题 / 笔记内容 / 标注文本…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="note-chips">
          {(
            [
              ['all', '全部'],
              ['note', '我的笔记'],
              ['hl', '划词标注']
            ] as Array<[NoteFilter, string]>
          ).map(([k, label]) => (
            <button key={k} className={`note-chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>
              {label}
            </button>
          ))}
        </div>
        <span className="note-stats">
          {stats.withNotes} 篇有笔记 / {stats.highlights} 条标注
          {filterActive && ` · 筛出 ${rows.length} 篇`}
        </span>
        <span style={{ flex: 1 }} />
        <button className="btn ghost note-export" disabled={exporting.length === 0} onClick={exportAll}>
          导出全部笔记 (Markdown)
        </button>
      </div>

      <div className="note-list">
        {loading && all.length === 0 && <div className="note-empty">正在加载全库笔记…</div>}
        {!loading && all.length === 0 && (
          <div className="note-empty">
            {papers.length === 0
              ? '文献库还是空的；先导入几篇 PDF 吧。'
              : '还没有任何笔记或标注。打开文献后划词点「高亮」，或在详情栏写下「我的笔记」，这里就会聚合展示。'}
          </div>
        )}

        {rows.map((r) => (
          <NoteCard
            key={r.paper.id}
            row={r}
            editing={editingId === r.paper.id}
            draft={draft}
            saveHint={saveHint}
            onEdit={() => startEdit(r)}
            onCloseEdit={closeEdit}
            onDraft={(text) => scheduleSave(r.paper.id, text)}
            onOpenPaper={onOpenPaper}
            onExportOne={() => {
              const md = paperSection(r).join('\n')
              downloadText(`${safeFileName(r.paper.title)}-笔记.md`, `${md.trim()}\n`, 'text/markdown')
            }}
          />
        ))}

        {rows.length === 0 && all.length > 0 && <div className="note-empty">没有匹配的笔记；换个关键词或切换类型过滤试试。</div>}

        {loading && all.length > 0 && <div className="note-loading-hint">正在加载更多笔记…</div>}
        {papers.length > limit && (
          <div className="note-more-wrap">
            <button className="btn ghost" disabled={loading} onClick={() => setLimit((l) => l + PAGE_SIZE)}>
              加载更多（已加载 {Math.min(limit, papers.length)} / {papers.length} 篇）
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------- 单篇笔记卡片 ----------
interface CardProps {
  row: Row
  editing: boolean
  draft: string
  saveHint: 'idle' | 'saving' | 'saved'
  onEdit: () => void
  onCloseEdit: () => void
  onDraft: (text: string) => void
  onOpenPaper: (paperId: number, page?: number) => void
  onExportOne: () => void
}

function NoteCard({ row, editing, draft, saveHint, onEdit, onCloseEdit, onDraft, onOpenPaper, onExportOne }: CardProps): JSX.Element {
  const preview = useMemo(() => mdToPlain(row.note), [row.note])
  const clipped = preview.length > 300 ? `${preview.slice(0, 300)}…` : preview
  return (
    <div className={`note-card ${editing ? 'editing' : ''}`}>
      <div className="note-card-head">
        <button className="note-title" title={`${row.paper.title}（点击打开文献）`} onClick={() => onOpenPaper(row.paper.id)}>
          {row.paper.title}
        </button>
        <div className="note-actions">
          {editing && saveHint !== 'idle' && (
            <span className={`note-save ${saveHint}`}>{saveHint === 'saving' ? '保存中…' : '已保存'}</span>
          )}
          {editing ? (
            <button className="cmp-mini" onClick={onCloseEdit} title="保存并收起编辑框（Esc 同效）">
              完成
            </button>
          ) : (
            <button className="cmp-mini" onClick={onEdit} title="就地编辑我的笔记（自动保存）">
              编辑
            </button>
          )}
          <button className="cmp-mini" onClick={onExportOne} title="导出此笔记为 Markdown 文件">
            导出此笔记
          </button>
        </div>
      </div>

      {editing ? (
        <textarea
          className="note-edit-area"
          autoFocus
          value={draft}
          placeholder="用 Markdown 记录这篇文献的笔记…（停顿 0.8 秒自动保存）"
          onChange={(e) => onDraft(e.target.value)}
          onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
            if (e.key === 'Escape') onCloseEdit()
          }}
        />
      ) : (
        <>
          {clipped && <div className="note-preview">{clipped}</div>}
          {row.highlights.length > 0 && (
            <div className="note-hls">
              {row.highlights.map((h) => (
                <button
                  key={h.id}
                  className="note-hl-item"
                  title="点击跳转到原文位置"
                  onClick={() => onOpenPaper(row.paper.id, h.page)}
                >
                  <i className="note-hl-dot" style={{ background: hlDotColor(h.color) }} />
                  <span className="note-hl-text">{h.text}</span>
                  <span className="note-hl-page">第 {h.page} 页</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
