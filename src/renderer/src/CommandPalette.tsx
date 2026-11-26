import { useEffect, useMemo, useRef, useState } from 'react'
import type { Paper } from './types'
import { catLabel } from './LibraryPane'

export interface PaletteCommand {
  id: string
  label: string
  hint?: string
  run: () => void
}

interface Props {
  papers: Paper[]
  commands: PaletteCommand[]
  onClose: () => void
  onOpenPaper: (p: Paper) => void
  onOpenNote?: (noteId: number) => void
  onOpenConversation?: (conversationId: string) => void
}

type Row =
  | { kind: 'command'; cmd: PaletteCommand }
  | { kind: 'paper'; paper: Paper }
  | { kind: 'note'; noteId: number; title: string; updated: string }
  | { kind: 'conversation'; conversationId: string; title: string; updated: string }

export default function CommandPalette({ papers, commands, onClose, onOpenPaper, onOpenNote, onOpenConversation }: Props): JSX.Element {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const [notes, setNotes] = useState<Array<{ id: number; title: string; updated_at: string }>>([])
  const [conversations, setConversations] = useState<Array<{ id: string; title: string; updatedAt: string }>>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    void window.api.standaloneNotesList().then(setNotes).catch(() => setNotes([]))
    void window.api.chat.listConversations({ limit: 100 }).then(page => setConversations(page.items)).catch(() => setConversations([]))
  }, [])

  const kw = q.trim().toLowerCase()

  const rows = useMemo<Row[]>(() => {
    const hit = (s: string): boolean => !kw || s.toLowerCase().includes(kw)
    const cmds: Row[] = commands.filter((c) => hit(c.label)).map((cmd) => ({ kind: 'command', cmd }))
    const pprs: Row[] = papers
      .filter((p) => hit(p.title) || hit(p.slug) || hit(p.category) || String(p.year ?? '').includes(kw))
      .slice(0, 20)
      .map((paper) => ({ kind: 'paper', paper }))
    const noteRows: Row[] = notes.filter(note => hit(note.title)).slice(0, 8).map(note => ({ kind: 'note', noteId: note.id, title: note.title, updated: note.updated_at }))
    const conversationRows: Row[] = conversations.filter(conversation => hit(conversation.title)).slice(0, 8).map(conversation => ({ kind: 'conversation', conversationId: conversation.id, title: conversation.title, updated: conversation.updatedAt }))
    return [...cmds, ...pprs, ...noteRows, ...conversationRows]
  }, [kw, commands, papers, notes, conversations])

  useEffect(() => {
    setSel(0)
  }, [kw])

  useEffect(() => {
    listRef.current?.querySelector('.palette-item.sel')?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  const runRow = (r: Row): void => {
    onClose()
    if (r.kind === 'command') r.cmd.run()
    else if (r.kind === 'paper') onOpenPaper(r.paper)
    else if (r.kind === 'note') onOpenNote?.(r.noteId)
    else onOpenConversation?.(r.conversationId)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') onClose()
    else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSel((s) => Math.min(rows.length - 1, s + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSel((s) => Math.max(0, s - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const r = rows[sel]
      if (r) runRow(r)
    }
  }

  const groups: Array<{ label: string; items: Array<{ row: Row; i: number }> }> = []
  rows.forEach((row, i) => {
    const label = row.kind === 'command' ? '命令' : row.kind === 'paper' ? '文献' : row.kind === 'note' ? '笔记' : '会话'
    const g = groups[groups.length - 1]
    if (g && g.label === label) g.items.push({ row, i })
    else groups.push({ label, items: [{ row, i }] })
  })

  return (
    <div className="palette-mask" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-head">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            ref={inputRef}
            className="palette-input"
            placeholder="搜索文献、笔记、会话，或输入命令…" aria-label="全局搜索"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <span className="kbd">esc</span>
        </div>
        <div className="palette-list" ref={listRef}>
          {rows.length === 0 && <div className="palette-empty">没有匹配的结果</div>}
          {groups.map((g) => (
            <div key={g.label}>
              <div className="palette-group">{g.label}</div>
              {g.items.map(({ row, i }) => (
                <div
                  key={row.kind === 'command' ? row.cmd.id : row.kind === 'paper' ? `p${row.paper.id}` : row.kind === 'note' ? `n${row.noteId}` : `c${row.conversationId}`}
                  className={`palette-item ${i === sel ? 'sel' : ''}`}
                  onMouseEnter={() => setSel(i)}
                  onClick={() => runRow(row)}
                >
                  {row.kind === 'command' ? (
                    <>
                      <span className="pi-label">{row.cmd.label}</span>
                      {row.cmd.hint && <span className="pi-meta">{row.cmd.hint}</span>}
                    </>
                  ) : row.kind === 'paper' ? (
                    <>
                      <span className="pi-label">{row.paper.title}</span>
                      <span className="pi-meta">
                        {row.paper.year ?? '—'} · {catLabel(row.paper.category)}
                      </span>
                    </>
                  ) : row.kind === 'note' ? (
                    <>
                      <span className="pi-label">{row.title}</span>
                      <span className="pi-meta">笔记</span>
                    </>
                  ) : (
                    <>
                      <span className="pi-label">{row.title}</span>
                      <span className="pi-meta">会话</span>
                    </>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
