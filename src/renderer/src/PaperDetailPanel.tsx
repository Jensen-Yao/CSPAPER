import { useEffect, useRef, useState } from 'react'
import { STATUS_KEYS, STATUS_META, type Paper, type PaperDetail, type StyleInfo, type TagRow } from './types'
import { NOTE_TEMPLATES } from './note-templates'
import NotesMarkmapButton from './NotesMarkmapButton'
import { catLabel } from './LibraryPane'

interface Props {
  paper: Paper
  onClose?: () => void
  onOpen?: (p: Paper) => void
  onSummarized?: (id: number, s: string) => void
  /** 面板内数据变更（状态切换等）后通知父级刷新列表 */
  onChanged?: () => void
  /** 嵌入侧栏标签页：去掉固定宽度与关闭/底部按钮 */
  embedded?: boolean
}

// 该文献已挂标签（papersTagsOf 返回，带 id 供移除用）
interface PaperTag {
  id: number
  name: string
  color: string
}

// 卡片详情栏：信息（含标签/状态）/ AI 洞察 / 摘要 / 引用 / 我的笔记 / 标注 / 附件
export default function PaperDetailPanel({ paper, onClose, onOpen, onSummarized, onChanged, embedded }: Props): JSX.Element {
  const [detail, setDetail] = useState<PaperDetail | null>(null)
  // ---- 我的笔记（防抖自动保存） ----
  const [myNote, setMyNote] = useState('')
  const [noteBusy, setNoteBusy] = useState(false)
  const [noteState, setNoteState] = useState<'idle' | 'pending' | 'saved'>('idle')
  const [savedAt, setSavedAt] = useState('')
  const [tplId, setTplId] = useState('')
  const savedRef = useRef('') // 最近一次已落库的内容（防抖期间跳过未变更文本）
  // ---- 标签编辑 ----
  const [tags, setTags] = useState<PaperTag[]>([])
  const [tagInput, setTagInput] = useState('')
  const [tagSugsOpen, setTagSugsOpen] = useState(false)
  const [allTags, setAllTags] = useState<TagRow[]>([])
  const allTagsLoaded = useRef(false)
  // ---- 引用 ----
  const [cslList, setCslList] = useState<StyleInfo[]>([])
  const [styleId, setStyleId] = useState('gbt7714-num')
  const [citeBusy, setCiteBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [citeErr, setCiteErr] = useState('')
  // ---- 阅读状态（五态） ----
  const [status, setStatus] = useState(paper.status)

  const [open, setOpen] = useState<Record<string, boolean>>({ info: true, ai: true, abs: true, cite: false, mine: true, notes: false, files: false })
  const [sumBusy, setSumBusy] = useState(false)
  const [summary, setSummary] = useState(paper.summary ?? '')
  const [sumErr, setSumErr] = useState('')

  useEffect(() => {
    setDetail(null)
    setSummary(paper.summary ?? '')
    setSumErr('')
    setMyNote('')
    setNoteState('idle')
    setSavedAt('')
    setTplId('')
    savedRef.current = ''
    setTags([])
    setTagInput('')
    setStatus(paper.status)
    setCopied(false)
    setCiteErr('')
    let cancelled = false
    void window.api
      .paperDetail(paper.id)
      .then((d) => {
        if (!cancelled && d) {
          setDetail(d)
          setMyNote(d.myNotes ?? '')
          savedRef.current = d.myNotes ?? ''
        }
      })
      .catch(() => {})
    void window.api
      .papersTagsOf(paper.id)
      .then((ts) => {
        if (!cancelled) setTags(ts)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [paper.id])

  // 阅读状态：随父级列表刷新同步（paper 对象更新时）
  useEffect(() => {
    setStatus(paper.status)
  }, [paper.status])

  // 我的笔记：800ms 防抖自动保存
  useEffect(() => {
    if (myNote === savedRef.current) return
    setNoteState('pending')
    const t = window.setTimeout(() => {
      void saveMine()
    }, 800)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myNote, paper.id])

  const saveMine = async (): Promise<void> => {
    setNoteBusy(true)
    try {
      const ok = await window.api.myNotesSave(paper.id, myNote)
      if (ok !== false) {
        savedRef.current = myNote
        const n = new Date()
        setSavedAt(`${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`)
        setNoteState('saved')
      }
    } catch {
      // 保存失败保持「保存中/待保存」状态，下一次输入会再次触发
    } finally {
      setNoteBusy(false)
    }
  }

  // 模板：追加到笔记末尾（笔记为空则直接填入）；选完即复位，便于重复插入同一模板
  const applyTemplate = (tid: string): void => {
    if (!tid) return
    const tpl = NOTE_TEMPLATES.find((t) => t.id === tid)
    if (!tpl) return
    setMyNote((prev) => (prev.trim() ? `${prev.replace(/\s+$/, '')}\n\n${tpl.content}` : tpl.content))
  }

  // ---- 标签 ----
  const ensureAllTags = (): void => {
    if (allTagsLoaded.current) return
    allTagsLoaded.current = true
    void window.api
      .tagsList()
      .then(setAllTags)
      .catch(() => {
        allTagsLoaded.current = false
      })
  }

  const addTag = async (raw: string): Promise<void> => {
    const name = raw.trim()
    if (!name) return
    if (tags.some((t) => t.name === name)) {
      setTagInput('')
      setTagSugsOpen(false)
      return
    }
    try {
      const row = await window.api.paperTagAdd(paper.id, name)
      setTags((ts) => (ts.some((t) => t.id === row.id) ? ts : [...ts, { id: row.id, name: row.name, color: row.color }]))
      setAllTags((ls) => (ls.some((t) => t.id === row.id) ? ls : [...ls, row]))
      setTagInput('')
      setTagSugsOpen(false)
    } catch {
      // 建/挂标签失败：保留输入，便于重试
    }
  }

  const removeTag = async (id: number): Promise<void> => {
    try {
      await window.api.paperTagRemove(paper.id, id)
      setTags((ts) => ts.filter((t) => t.id !== id))
    } catch {
      // 移除失败：保留原状
    }
  }

  const sugTags: TagRow[] = tagInput.trim()
    ? allTags.filter((t) => t.name.includes(tagInput.trim()) && !tags.some((x) => x.id === t.id)).slice(0, 6)
    : []

  // ---- 状态五态 ----
  const changeStatus = async (s: string): Promise<void> => {
    const prev = status
    setStatus(s)
    try {
      await window.api.setStatus(paper.id, s)
      onChanged?.()
    } catch {
      setStatus(prev)
    }
  }

  // ---- 引用 ----
  useEffect(() => {
    let cancelled = false
    void window.api
      .cslStyles()
      .then((ss) => {
        if (cancelled) return
        setCslList(ss)
        // 默认 GB/T 7714；样式列表里没有该 id 时退回第一个
        if (ss.length && !ss.some((s) => s.id === styleId)) setStyleId(ss[0].id)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const copyCitation = async (): Promise<void> => {
    setCiteBusy(true)
    setCiteErr('')
    try {
      const r = await window.api.cslFormat([paper.id], styleId)
      const text = r.ok && r.items && r.items[0] ? r.items[0] : ''
      if (!text) {
        setCiteErr(r.error || '生成引用失败（可到设置里检查引文引擎）')
        return
      }
      try {
        await navigator.clipboard.writeText(text)
      } catch {
        // 非 secure context 兜底：隐藏 textarea + execCommand
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      }
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch (e) {
      setCiteErr(String(e).replace(/^Error: /, '').slice(0, 120))
    } finally {
      setCiteBusy(false)
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

  const statusKeys = STATUS_KEYS.includes(status) ? STATUS_KEYS : [status, ...STATUS_KEYS]
  const statusMeta = STATUS_META[status] ?? STATUS_META.todo

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
                <div className="pd-tags">
                  {tags.length > 0 && (
                    <div className="pd-tags-chips">
                      {tags.map((t) => (
                        <span key={t.id} className="pd-tags-chip" title={t.color ? `标签色 ${t.color}` : undefined}>
                          {t.color && <i className="pd-tags-dot" style={{ background: t.color }} />}
                          {t.name}
                          <button className="pd-tags-x" title="移除标签" onClick={() => void removeTag(t.id)}>
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="pd-tags-wrap">
                    <input
                      className="pd-tags-input"
                      value={tagInput}
                      placeholder="添加标签，回车确认"
                      onChange={(e) => {
                        setTagInput(e.target.value)
                        setTagSugsOpen(true)
                        ensureAllTags()
                      }}
                      onFocus={() => {
                        ensureAllTags()
                      }}
                      onBlur={() => window.setTimeout(() => setTagSugsOpen(false), 150)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void addTag(tagInput)
                      }}
                    />
                    {tagSugsOpen && tagInput.trim() !== '' && sugTags.length > 0 && (
                      <div className="pd-tags-sugs">
                        {sugTags.map((t) => (
                          <button
                            key={t.id}
                            className="pd-tags-sug"
                            title="挂上这个已有标签"
                            onMouseDown={(e) => {
                              e.preventDefault()
                              void addTag(t.name)
                            }}
                          >
                            {t.color && <i className="pd-tags-dot" style={{ background: t.color }} />}
                            {t.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                {field(
                  '状态',
                  <span className="pd-status-row">
                    <i className="pd-status-dot" style={{ background: statusMeta.color }} />
                    <select className="pd-status" value={status} onChange={(e) => void changeStatus(e.target.value)}>
                      {statusKeys.map((k) => (
                        <option key={k} value={k}>
                          {STATUS_META[k]?.label ?? k}
                        </option>
                      ))}
                    </select>
                  </span>
                )}
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
              'cite',
              '📑',
              '引用',
              <div className="pd-cite">
                <div className="pd-cite-row">
                  <select
                    className="pd-cite-select"
                    value={styleId}
                    onChange={(e) => {
                      setStyleId(e.target.value)
                      setCiteErr('')
                    }}
                  >
                    {(cslList.length
                      ? cslList
                      : [{ id: 'gbt7714-num', name: 'GB/T 7714（数字）', kind: 'builtin' as const, numeric: true }]
                    ).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <button
                    className={`pd-cite-copy ${copied ? 'done' : ''}`}
                    disabled={citeBusy}
                    onClick={() => void copyCitation()}
                  >
                    {copied ? '已复制' : citeBusy ? '生成中…' : '复制引用'}
                  </button>
                </div>
                {citeErr && <div className="pd-cite-err">{citeErr}</div>}
              </div>
            )}
            {sec(
              'mine',
              '📝',
              '我的笔记',
              <div className="pd-note-box">
                <div className="pd-note-tpl">
                  <span className="pd-note-tpl-label">模板</span>
                  <select
                    value={tplId}
                    onChange={(e) => {
                      setTplId('')
                      applyTemplate(e.target.value)
                    }}
                  >
                    <option value="">插入模板…</option>
                    {NOTE_TEMPLATES.map((t) => (
                      <option key={t.id} value={t.id} title={t.desc}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <NotesMarkmapButton title={paper.title} markdown={myNote} />
                </div>
                <textarea
                  className="pd-note-ta"
                  value={myNote}
                  placeholder="记录研究问题、方法、启发……"
                  onChange={(e) => setMyNote(e.target.value)}
                />
                <div className="pd-note-meta">
                  <span className={`pd-note-state ${noteState === 'saved' && !noteBusy ? 'ok' : ''}`}>
                    {noteBusy || noteState === 'pending' ? '保存中…' : noteState === 'saved' ? `已保存 ${savedAt}` : '自动保存已开启'}
                  </span>
                </div>
              </div>,
              <span className="pd-note-count">{myNote.length} 字</span>
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
