// 研究台（v0.22）：Paper 模式首页。一屏回答「今天做什么、读什么、记什么」，
// 数据全部来自当前工作区（阅读记录 / 专注 / 日历 / 任务 / 笔记 / 会话），不展示假数据。
import { useEffect, useMemo, useState } from 'react'
import type { Paper } from './types'
import type { CalendarEvent, FocusSummary } from '../../shared/calendar'
import type { ResearchProject, ResearchTask } from '../../shared/projects'
import type { Conversation } from '../../shared/chat'
import * as Icon from './Icon'
import { statusMeta } from './LibraryPane'
import { TASKS_CHANGED_EVENT } from './workspace-actions'

interface Props {
  papers: Paper[]
  indexed: { papers: number; indexed: number; chunks: number; recordOnly: number; fulltext: number }
  visible: boolean
  onOpenPaper: (paper: Paper) => void
  onOpenLibrary: () => void
  onPaperStatus: (id: number, status: string) => void
  onOpenNotes: () => void
  onOpenNote: (noteId: number) => void
  onOpenChat: () => void
  onOpenConversation: (key: string) => void
  onOpenCompare: () => void
  onImport: () => void
  onQuickCapture: () => void
  onOpenWork: () => void
  onOpenProjects: (projectId?: number) => void
}

interface NoteRow { id: number; title: string; updated_at: string }

const dayText = (date: Date): string => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const eventKind: Record<CalendarEvent['kind'], string> = { task: '任务', deadline: '截止', meeting: '会议', milestone: '里程碑' }
const priorityLabel: Record<ResearchTask['priority'], string> = { low: '低', medium: '中', high: '高' }
const QUEUE_STATUSES = ['todo', 'unread', 'reading']

/** sqlite datetime('now') 是 UTC 无时区后缀，补 Z 再解析；超过两天显示日期。 */
const relTime = (value?: string | null): string => {
  if (!value) return ''
  const time = new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z').getTime()
  if (!Number.isFinite(time)) return ''
  const diff = (Date.now() - time) / 1000
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
  if (diff < 172800) return '昨天'
  return value.slice(0, 10)
}

const progressOf = (paper: Paper): number => {
  const page = paper.furthest_page ?? paper.last_page ?? 0
  return paper.n_pages ? Math.min(100, Math.round((page / paper.n_pages) * 100)) : 0
}

export default function ResearchHub({ papers, indexed, visible, onOpenPaper, onOpenLibrary, onPaperStatus, onOpenNotes, onOpenNote, onOpenChat, onOpenConversation, onOpenCompare, onImport, onQuickCapture, onOpenWork, onOpenProjects }: Props): JSX.Element {
  const today = dayText(new Date())
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [focus, setFocus] = useState<FocusSummary | null>(null)
  const [notes, setNotes] = useState<NoteRow[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [tasks, setTasks] = useState<ResearchTask[]>([])
  const [projects, setProjects] = useState<ResearchProject[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const refresh = async (): Promise<void> => {
    try {
      const until = dayText(new Date(Date.now() + 7 * 86400000))
      const [eventRows, summary, noteRows, page, projectRows, taskRows] = await Promise.all([
        window.api.calendarList(today, until),
        window.api.focusSummary(today),
        window.api.standaloneNotesList(),
        window.api.chat.listConversations({ limit: 6 }),
        window.api.projectsList(),
        window.api.tasksList()
      ])
      setEvents(eventRows); setFocus(summary); setNotes(noteRows.slice(0, 4)); setConversations(page.items.slice(0, 4)); setProjects(projectRows); setTasks(taskRows)
      setError('')
    } catch (error) {
      setError(String(error).replace(/^Error: /, ''))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!visible) return
    void refresh()
    const handler = (): void => { void refresh() }
    window.addEventListener('cspaper:notes-changed', handler)
    window.addEventListener(TASKS_CHANGED_EVENT, handler)
    return () => { window.removeEventListener('cspaper:notes-changed', handler); window.removeEventListener(TASKS_CHANGED_EVENT, handler) }
  }, [visible])

  const continueReading = useMemo(() => papers
    .filter(paper => paper.source_kind === 'pdf' && paper.opened_at && !['read', 'done'].includes(paper.status))
    .sort((a, b) => (b.opened_at ?? '').localeCompare(a.opened_at ?? ''))
    .slice(0, 4), [papers])
  const queue = useMemo(() => papers
    .filter(paper => paper.source_kind === 'pdf' && QUEUE_STATUSES.includes(paper.status))
    .sort((a, b) => (QUEUE_STATUSES.indexOf(b.status) - QUEUE_STATUSES.indexOf(a.status)) || (a.added_at ?? '').localeCompare(b.added_at ?? ''))
    .slice(0, 6), [papers])
  const queueCount = useMemo(() => papers.filter(paper => paper.source_kind === 'pdf' && QUEUE_STATUSES.includes(paper.status)).length, [papers])
  const dueTasks = useMemo(() => tasks
    .filter(task => !!task.dueDate && task.dueDate <= today && task.status !== 'done')
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '')), [tasks, today])
  const overdue = dueTasks.filter(task => (task.dueDate ?? '') < today).length
  const todayEvents = events.filter(event => event.occurrenceDate === today)
  const pdfCount = papers.filter(paper => paper.source_kind === 'pdf').length
  const hour = new Date().getHours()
  const greeting = hour < 6 ? '晚上好' : hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好'
  const hint = loading ? <p className="rh-loading">正在读取当前工作区…</p> : null

  return <div className="research-hub">
    <div className="rh-scroll">
      <div className="rh-inner">
        <header className="rh-hero">
          <div className="rh-hero-text">
            <small className="rh-eyebrow">{new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })} · 研究台</small>
            <h1>{greeting}，今天推进哪项研究？</h1>
            <p>从上次停下的位置继续读，或先记下一条想法。阅读、日程、任务与会话都来自当前工作区。</p>
          </div>
          <div className="rh-actions">
            <button className="rh-primary" title="Ctrl / Cmd + Shift + N" onClick={onQuickCapture}><Icon.Notes size={14}/> 快速记录</button>
            <button className="rh-btn" onClick={onImport}><Icon.Upload size={14}/> 导入文献</button>
            <button className="rh-btn" onClick={onOpenChat}><Icon.Chat size={14}/> 问文献库</button>
          </div>
        </header>

        {error && <div className="rh-error" role="alert"><Icon.Warning size={14}/><span>部分数据读取失败：{error}</span><button className="rh-mini" onClick={() => void refresh()}>重试</button></div>}

        {papers.length === 0 && !loading && <section className="rh-card rh-onboard">
          <span className="rh-onboard-icon"><Icon.Library size={20}/></span>
          <div><b>文献库还是空的</b><span>拖入 PDF、从 Zotero 迁移，或用 DOI / arXiv 链接在线添加。</span></div>
          <button className="rh-primary" onClick={onImport}><Icon.Upload size={14}/> 导入文献</button>
        </section>}

        <section className="rh-metrics" aria-label="今日概览">
          <div><small>继续阅读</small><strong>{loading ? '—' : continueReading.length}<em>篇</em></strong><span>最近打开的 PDF</span></div>
          <div><small>今日专注</small><strong>{focus ? Math.round(focus.readingSeconds / 60) : 0}<em>分钟</em></strong><span>{focus?.cycles ?? 0} 个阅读轮次</span></div>
          <div><small>阅读队列</small><strong>{loading ? '—' : queueCount}<em>篇</em></strong><span>待读 / 稍后读 / 在读</span></div>
          <div className={overdue ? 'warn' : ''}><small>今日到期</small><strong>{loading ? '—' : dueTasks.length}<em>项</em></strong><span>{overdue ? `${overdue} 项已逾期` : `${projects.length} 个研究项目`}</span></div>
        </section>

        <div className="rh-layout">
          <div className="rh-main">
            <section className="rh-card" aria-label="继续阅读">
              <header><div><h2>继续阅读</h2><small>从上次停下的位置接着读</small></div><button onClick={onOpenLibrary}>全部文献</button></header>
              {hint}
              {!loading && (continueReading.length ? continueReading.map(paper => {
                const percent = progressOf(paper)
                return <article key={paper.id} className="rh-paper">
                  <button className="rh-paper-title" onClick={() => onOpenPaper(paper)}>{paper.title}</button>
                  <button className="rh-btn rh-paper-action" onClick={() => onOpenPaper(paper)}>继续</button>
                  <div className="rh-paper-meta">
                    <span>{paper.last_page ? `读到第 ${paper.last_page} 页` : '未开始'}</span>
                    <span>{statusMeta(paper.status).label}</span>
                    <span>{paper.category || '未分类'}</span>
                    <span>{relTime(paper.opened_at)}</span>
                  </div>
                  <div className="rh-bar" aria-hidden="true"><i style={{ width: `${percent}%` }} /></div>
                </article>
              }) : <div className="rh-empty"><b>没有进行中的阅读</b><span>打开一篇 PDF 后，它会出现在这里，并记住你的阅读位置。</span></div>)}
            </section>

            <section className="rh-card" aria-label="阅读队列">
              <header><div><h2>阅读队列</h2><small>待读、稍后读与在读的文献</small></div><button onClick={onOpenLibrary}>文献库</button></header>
              {hint}
              {!loading && (queue.length ? queue.map(paper => {
                const meta = statusMeta(paper.status)
                return <div key={paper.id} className="rh-queue-row">
                  <span className="rh-queue-dot" style={{ background: meta.color }} />
                  <button className="rh-queue-title" title={paper.title} onClick={() => onOpenPaper(paper)}>{paper.title}</button>
                  <span className="rh-status" style={{ color: meta.color, background: `color-mix(in srgb, ${meta.color} 12%, transparent)` }}>{meta.label}</span>
                  {paper.status !== 'reading' && <button className="rh-mini" onClick={() => { onPaperStatus(paper.id, 'reading'); onOpenPaper(paper) }}>开始阅读</button>}
                  <button className="rh-mini" title="标记为已读" onClick={() => onPaperStatus(paper.id, 'read')}>已读</button>
                  {paper.status !== 'todo' && <button className="rh-mini" title="移到稍后读" onClick={() => onPaperStatus(paper.id, 'todo')}>稍后读</button>}
                </div>
              }) : <div className="rh-empty"><b>阅读队列是空的</b><span>把文献标记为「稍后读」或「待读」，它会出现在这里。</span></div>)}
            </section>
          </div>

          <aside className="rh-side">
            <section className="rh-card" aria-label="今日安排">
              <header><div><h2>今日安排</h2><small>日程与截止</small></div><button onClick={onOpenWork}>科研日历</button></header>
              {hint}
              {!loading && (todayEvents.length ? todayEvents.map(event => <div key={`${event.id}-${event.occurrenceDate}`} className={`rh-row ${event.completed ? 'done' : ''}`}>
                <small>{event.startTime || '全天'} · {eventKind[event.kind]}</small>
                <strong>{event.title}</strong>
              </div>) : <div className="rh-empty compact"><b>今天没有日程</b><span>在科研日历里安排阅读、组会或截止日期。</span></div>)}
            </section>

            <section className="rh-card" aria-label="今日任务">
              <header><div><h2>今日任务</h2><small>今天到期与逾期</small></div><button onClick={() => onOpenProjects()}>项目</button></header>
              {hint}
              {!loading && (dueTasks.length ? dueTasks.slice(0, 5).map(task => <button key={task.id} className={`rh-row clickable ${task.dueDate && task.dueDate < today ? 'overdue' : ''}`} onClick={() => onOpenProjects(task.projectId)}>
                <small>{task.projectName} · {priorityLabel[task.priority]}优先级{task.dueDate && task.dueDate < today ? ' · 已逾期' : ''}</small>
                <strong>{task.title}</strong>
              </button>) : <div className="rh-empty compact"><b>今天没有到期任务</b><span>在 Work 的项目页创建任务并设置截止日期。</span></div>)}
            </section>

            <section className="rh-card" aria-label="最近笔记">
              <header><div><h2>最近笔记</h2><small>独立笔记</small></div><button onClick={onOpenNotes}>全部笔记</button></header>
              {hint}
              {!loading && (notes.length ? notes.map(note => <button key={note.id} className="rh-row clickable" onClick={() => onOpenNote(note.id)}>
                <small>{relTime(note.updated_at)}</small>
                <strong>{note.title}</strong>
              </button>) : <div className="rh-empty compact"><b>还没有笔记</b><span>阅读时划词高亮，或按 Ctrl / Cmd + Shift + N 快速记录。</span><button className="rh-btn" onClick={onQuickCapture}><Icon.Plus size={14}/> 快速记录</button></div>)}
            </section>

            <section className="rh-card" aria-label="最近会话">
              <header><div><h2>最近会话</h2><small>继续之前的追问</small></div><button onClick={onOpenChat}>新对话</button></header>
              {hint}
              {!loading && (conversations.length ? conversations.map(conversation => <button key={conversation.id} className="rh-row clickable" onClick={() => onOpenConversation(conversation.entry === 'work' ? `work:${conversation.id}` : conversation.id)}>
                <small>{conversation.entry === 'work' ? 'Work 会话' : '文献问答'} · {relTime(conversation.updatedAt)}</small>
                <strong>{conversation.title}</strong>
              </button>) : <div className="rh-empty compact"><b>还没有对话</b><span>问文献库一个可溯源的问题，回答会标注页码。</span></div>)}
            </section>
          </aside>
        </div>
      </div>
    </div>
    <footer className="rh-foot">
      <span><Icon.Library size={12}/> {papers.length} 篇文献 · {pdfCount} PDF</span>
      <span>已索引 {indexed.indexed}/{indexed.papers}</span>
      <span>原文 {indexed.fulltext} · 题录 {indexed.recordOnly} · {indexed.chunks} 个检索块</span>
      <span style={{ flex: 1 }} />
      <button className="rh-foot-link" onClick={onOpenCompare}><Icon.Compare size={12}/> 新建对比表</button>
      <button className="rh-foot-link" onClick={onOpenNotes}><Icon.Notes size={12}/> 笔记中心</button>
    </footer>
  </div>
}