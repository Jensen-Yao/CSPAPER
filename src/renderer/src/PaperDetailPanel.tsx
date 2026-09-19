import { useEffect, useState } from 'react'
import type { Paper, PaperDetail } from './types'
import { catLabel } from './LibraryPane'

interface Props {
  paper: Paper
  onClose?: () => void
  onOpen?: (p: Paper) => void
  onSummarized?: (id: number, s: string) => void
  /** 嵌入侧栏标签页：去掉固定宽度与关闭/底部按钮 */
  embedded?: boolean
}

// 卡片详情栏：信息 / AI 洞察 / 摘要 / 笔记 / 附件（参考成熟文献工具的信息面板）
export default function PaperDetailPanel({ paper, onClose, onOpen, onSummarized, embedded }: Props): JSX.Element {
  const [detail, setDetail] = useState<PaperDetail | null>(null)
  const [myNote, setMyNote] = useState('')
  const [noteSaved, setNoteSaved] = useState(false)
  const [noteBusy, setNoteBusy] = useState(false)
  const [open, setOpen] = useState<Record<string, boolean>>({ info: true, ai: true, abs: true, notes: false, files: false })
  const [sumBusy, setSumBusy] = useState(false)
  const [summary, setSummary] = useState(paper.summary ?? '')
  const [sumErr, setSumErr] = useState('')

  useEffect(() => {
    setDetail(null)
    setSummary(paper.summary ?? '')
    setSumErr('')
    let cancelled = false
    void window.api
      .paperDetail(paper.id)
      .then((d) => {
        if (!cancelled && d) {
          setDetail(d)
          setMyNote(d.myNotes ?? '')
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [paper.id])

  const saveMine = async (): Promise<void> => {
    setNoteBusy(true)
    try {
      await window.api.myNotesSave(paper.id, myNote)
      setNoteSaved(true)
      setTimeout(() => setNoteSaved(false), 2000)
    } finally {
      setNoteBusy(false)
    }
  }

  const genSummary = async (): Promise<void> => {
    setSumBusy(true)
    setSumErr('')
    try {
      const s = await window.api.summarizePaper(paper.id)
      setSummary(s)
      onSummarized?.(paper.id, s)
    } catch (e) {
      setSumErr(String(e).replace(/^Error: /, '').slice(0, 100))
    } finally {
      setSumBusy(false)
    }
  }

  const sec = (id: string, icon: string, title: string, body: JSX.Element, extra?: JSX.Element): JSX.Element => (
    <div className={`pd-sec ${open[id] ? 'open' : ''}`}>
      <button className="pd-sec-head" onClick={() => setOpen((o) => ({ ...o, [id]: !o[id] }))}>
        <span className="pd-sec-ic">{icon}</span>
        <span className="pd-sec-title">{title}</span>
        <span style={{ flex: 1 }} />
        {extra}
        <span className={`pd-chev ${open[id] ? 'open' : ''}`}>⌄</span>
      </button>
      {open[id] && <div className="pd-sec-body">{body}</div>}
    </div>
  )

  const field = (label: string, value: React.ReactNode): JSX.Element => (
    <div className="pd-field">
      <div className="pd-flabel">{label}</div>
      <div className="pd-fvalue">{value}</div>
    </div>
  )

  return (
    <aside className={`pd-panel ${embedded ? 'embedded' : ''}`}>
      <div className="pd-head">
        <div className="pd-title" title={paper.title}>
          {paper.title}
        </div>
        {onClose && (
          <button className="pd-x" title="关闭" onClick={onClose}>
            ✕
          </button>
        )}
      </div>
      <div className="pd-scroll">
        {!detail && <div className="pd-loading">加载中…</div>}
        {detail && (
          <>
            {sec(
              'info',
              'ℹ️',
              '信息',
              <>
                {field('类型', detail.venue ? '期刊文章' : '文献')}
                {field('标题', <span className="pd-strong">{detail.title}</span>)}
                {detail.authors &&
                  field(
                    '作者',
                    <div className="pd-chips">
                      {detail.authors.split(/[,;，；]/).map((a, i) => (
                        <span key={i} className="pd-chip">
                          {a.trim()}
                        </span>
                      ))}
                    </div>
                  )}
                {detail.venue && field('期刊名称', detail.venue)}
                {detail.year != null && field('发表年份', String(detail.year))}
                {field('分类', catLabel(detail.category))}
                {field('添加日期', (detail.added_at || '').slice(0, 10))}
              </>
            )}
            {sec(
              'ai',
              '✨',
              'AI 洞察',
              summary ? (
                <div className="pd-summary">{summary}</div>
              ) : (
                <div>
                  <button className="sum-gen" disabled={sumBusy} onClick={() => void genSummary()}>
                    {sumBusy ? '分析中…' : '生成 AI 小结'}
                  </button>
                  {sumErr && <div className="sum-err">{sumErr}</div>}
                </div>
              ),
              summary ? (
                <button className="cmp-mini" disabled={sumBusy} title="重新生成" onClick={() => void genSummary()}>
                  {sumBusy ? '…' : '↻'}
                </button>
              ) : undefined
            )}
            {sec(
              'abs',
              '📄',
              '摘要',
              detail.abstract ? <div className="pd-abstract">{detail.abstract}</div> : <div className="pd-dim">未能从 PDF 中提取到摘要文本</div>
            )}
            {sec(
              'notes',
              '✏️',
              '笔记',
              <NotesPreview paperId={paper.id} count={detail.notesCount} />,
              <span className="pd-badge">{detail.notesCount}</span>
            )}
            {sec(
              'files',
              '📎',
              '附件',
              detail.files.length === 0 ? (
                <div className="pd-dim">无附件</div>
              ) : (
                <div className="pd-files">
                  {detail.files.map((f) => (
                    <div key={f} className="pd-file ellipsis" title={f}>
                      📄 {f}
                    </div>
                  ))}
                </div>
              ),
              <span className="pd-badge">{detail.files.length}</span>
            )}
          </>
        )}
      </div>
      {onOpen && !embedded && (
        <div className="pd-foot">
          <button className="btn" style={{ width: '100%' }} onClick={() => onOpen(paper)}>
            打开阅读
          </button>
        </div>
      )}
    </aside>
  )
}

function NotesPreview({ paperId, count }: { paperId: number; count: number }): JSX.Element {
  const [notes, setNotes] = useState<Array<{ id: number; page: number; text: string }>>([])
  useEffect(() => {
    void window.api
      .listHighlights(paperId)
      .then((hs) => setNotes(hs.slice(-5).reverse()))
      .catch(() => {})
  }, [paperId])
  if (count === 0) return <div className="pd-dim">还没有划词标注；在阅读器里选中文字点「高亮」即可保存。</div>
  return (
    <div className="pd-notes">
      {notes.map((n) => (
        <div key={n.id} className="pd-note">
          <span className="pd-note-page">p.{n.page}</span>
          <span className="ellipsis">{n.text}</span>
        </div>
      ))}
      {count > notes.length && <div className="pd-dim">…共 {count} 条</div>}
    </div>
  )
}
