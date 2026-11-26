// Work › 项目与任务（v0.22）：项目列表 + 任务看板（待办 / 进行中 / 已完成）。
// 任务支持拖拽换列、就地完成、编辑、删除、关联文献与「交给 Work」起草 AI 任务。
import { useEffect, useMemo, useState } from 'react'
import type { Paper } from './types'
import { taskInputOf, type ResearchProject, type ResearchTask, type ProjectInput, type TaskInput } from '../../shared/projects'
import { useDialog } from './Dialog'
import FormDialog from './FormDialog'
import { notifyTasksChanged } from './workspace-actions'
import * as Icon from './Icon'

const PRIORITY_LABEL: Record<ResearchTask['priority'], string> = { low: '低', medium: '中', high: '高' }
const PROJECT_STATUS_LABEL: Record<ResearchProject['status'], string> = { active: '进行中', paused: '已暂停', done: '已完成' }
const COLUMNS: Array<{ status: ResearchTask['status']; label: string }> = [
  { status: 'todo', label: '待办' },
  { status: 'doing', label: '进行中' },
  { status: 'done', label: '已完成' }
]
const EMPTY_PROJECT: ProjectInput = { name: '', description: '', color: '#9e3b2f', status: 'active', dueDate: null }
const EMPTY_TASK: Omit<TaskInput, 'projectId'> = { title: '', notes: '', status: 'todo', priority: 'medium', dueDate: null, paperId: null, conversationId: null }

const dayText = (date: Date): string => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

interface Props {
  papers: Paper[]
  focusProjectId?: number | null
  onOpenPaper: (paper: Paper) => void
  onDraftTask: (task: ResearchTask) => void
}

export default function ProjectsPane({ papers, focusProjectId, onOpenPaper, onDraftTask }: Props): JSX.Element {
  const dlg = useDialog()
  const today = dayText(new Date())
  const [projects, setProjects] = useState<ResearchProject[]>([])
  const [tasks, setTasks] = useState<ResearchTask[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [projectForm, setProjectForm] = useState<{ id: number | null } & Partial<ProjectInput> | null>(null)
  const [taskForm, setTaskForm] = useState<{ id: number | null } & Partial<TaskInput> | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [dragId, setDragId] = useState<number | null>(null)

  const refresh = async (): Promise<void> => {
    try {
      const [projectRows, taskRows] = await Promise.all([window.api.projectsList(), window.api.tasksList()])
      setProjects(projectRows)
      setTasks(taskRows)
      setSelectedId(current => (projectRows.some(project => project.id === current) ? current : projectRows[0]?.id ?? null))
      setError('')
    } catch (error) {
      setError(String(error).replace(/^Error: /, ''))
    }
  }
  useEffect(() => { void refresh() }, [])
  useEffect(() => { if (focusProjectId) setSelectedId(focusProjectId) }, [focusProjectId])

  // 所有写操作统一：成功后刷新并广播，研究台/今日页同步更新
  const mutate = async (run: () => Promise<unknown>): Promise<boolean> => {
    if (saving) return false
    setSaving(true); setError('')
    try {
      await run()
      await refresh()
      notifyTasksChanged()
      return true
    } catch (error) {
      setError(String(error).replace(/^Error: /, ''))
      return false
    } finally {
      setSaving(false)
    }
  }

  const selected = projects.find(project => project.id === selectedId) ?? null
  const projectTasks = useMemo(() => tasks.filter(task => task.projectId === selectedId), [tasks, selectedId])
  const byStatus = useMemo(() => ({
    todo: projectTasks.filter(task => task.status === 'todo'),
    doing: projectTasks.filter(task => task.status === 'doing'),
    done: projectTasks.filter(task => task.status === 'done')
  }), [projectTasks])
  const doneCount = byStatus.done.length
  const percent = projectTasks.length ? Math.round((doneCount / projectTasks.length) * 100) : 0

  const saveProject = async (): Promise<void> => {
    if (!projectForm?.name?.trim()) return
    const { id, ...input } = projectForm
    if (await mutate(() => window.api.projectsSave(input as ProjectInput, id ?? undefined))) setProjectForm(null)
  }
  const saveTask = async (): Promise<void> => {
    if (!taskForm?.title?.trim() || !selected) return
    const { id, ...input } = taskForm
    if (await mutate(() => window.api.tasksSave({ ...input, projectId: selected.id } as TaskInput, id ?? undefined))) setTaskForm(null)
  }
  const moveTask = (task: ResearchTask, status: ResearchTask['status']): void => {
    if (task.status === status) return
    void mutate(() => window.api.tasksSave({ ...taskInputOf(task), status }, task.id))
  }
  const removeProject = async (project: ResearchProject): Promise<void> => {
    if (!await dlg.confirm({ title: `删除项目「${project.name}」？`, message: '项目下的任务会一并删除；文献、笔记和会话不受影响。', okText: '删除项目', danger: true })) return
    await mutate(() => window.api.projectsRemove(project.id))
  }
  const removeTask = async (task: ResearchTask): Promise<void> => {
    if (!await dlg.confirm({ title: `删除任务「${task.title}」？`, message: '只删除任务记录，不删除关联文献或会话。', okText: '删除任务', danger: true })) return
    await mutate(() => window.api.tasksRemove(task.id))
  }

  return <div className="projects-pane">
    <header className="projects-head">
      <div>
        <small>Work · Projects</small>
        <h1>项目与任务</h1>
        <p>把阅读、对话和成果组织成可推进的研究项目。</p>
      </div>
      <div className="projects-actions">
        <button className="rh-btn" onClick={() => setProjectForm({ id: null, ...EMPTY_PROJECT })}><Icon.Plus size={14} /> 新建项目</button>
        <button className="rh-primary" disabled={!selected || saving} onClick={() => setTaskForm({ id: null, ...EMPTY_TASK })}><Icon.Plus size={14} /> 新建任务</button>
      </div>
    </header>

    {error && <div className="rh-error" role="alert"><Icon.Warning size={14} /><span>{error}</span><button className="rh-mini" onClick={() => setError('')}>关闭</button></div>}

    <div className="projects-layout">
      <aside className="projects-list" aria-label="项目列表">
        {projects.length === 0 && <div className="projects-empty"><b>还没有项目</b><span>创建一个项目，把任务、文献和成果放在一起。</span><button className="rh-btn" onClick={() => setProjectForm({ id: null, ...EMPTY_PROJECT })}><Icon.Plus size={14} /> 新建项目</button></div>}
        {projects.map(project => {
          const open = project.taskCounts.todo + project.taskCounts.doing
          const all = open + project.taskCounts.done
          return <button key={project.id} className={`project-row ${project.id === selectedId ? 'on' : ''}`} aria-current={project.id === selectedId ? 'true' : undefined} onClick={() => { setSelectedId(project.id); setTaskForm(null) }}>
            <i className="project-color" style={{ background: project.color }} />
            <span className="project-row-main">
              <strong>{project.name}</strong>
              <small>{PROJECT_STATUS_LABEL[project.status]} · {all ? `${open} 个未完成 / ${all}` : '暂无任务'}</small>
            </span>
            {project.dueDate && <span className={`project-due ${project.dueDate < today && project.status !== 'done' ? 'overdue' : ''}`}>{project.dueDate.slice(5)}</span>}
          </button>
        })}
      </aside>

      <section className="project-board" aria-label="任务看板">
        {selected ? <>
          <header className="project-board-head">
            <div className="project-board-title">
              <small><span className="project-state">{PROJECT_STATUS_LABEL[selected.status]}</span>{selected.dueDate && <span className={selected.dueDate < today && selected.status !== 'done' ? 'overdue' : ''}>截止 {selected.dueDate}</span>}</small>
              <h2>{selected.name}</h2>
              {selected.description && <p>{selected.description}</p>}
            </div>
            <div className="project-progress" aria-label={`完成 ${doneCount} / ${projectTasks.length}`}>
              <strong>{doneCount}<em>/{projectTasks.length}</em></strong>
              <div className="rh-bar" aria-hidden="true"><i style={{ width: `${percent}%` }} /></div>
              <small>{projectTasks.length ? `${percent}% 已完成` : '还没有任务'}</small>
            </div>
            <div className="project-board-actions">
              <button className="wb-mini" onClick={() => setProjectForm({ id: selected.id, name: selected.name, description: selected.description, color: selected.color, status: selected.status, dueDate: selected.dueDate })}>编辑项目</button>
              <button className="wb-mini danger" onClick={() => void removeProject(selected)}>删除</button>
            </div>
          </header>
          <div className="task-columns">
            {COLUMNS.map(column => <section
              key={column.status}
              className={`task-column ${dragId !== null ? 'droppable' : ''}`}
              aria-label={`${column.label}任务`}
              // 阻止冒泡：任务拖放不能触发窗口级的「拖入 PDF 导入」
              onDragOver={event => { event.preventDefault(); event.stopPropagation() }}
              onDrop={event => {
                event.preventDefault()
                event.stopPropagation()
                const task = projectTasks.find(item => item.id === dragId)
                setDragId(null)
                if (task) moveTask(task, column.status)
              }}
            >
              <header><h3>{column.label}</h3><span>{byStatus[column.status].length}</span></header>
              {byStatus[column.status].map(task => <article
                key={task.id}
                className={`task-card ${task.status === 'done' ? 'done' : ''} ${dragId === task.id ? 'dragging' : ''}`}
                draggable
                onDragStart={() => setDragId(task.id)}
                onDragEnd={() => setDragId(null)}
              >
                <button type="button" className="task-check" aria-label={task.status === 'done' ? `标记待办：${task.title}` : `完成任务：${task.title}`} onClick={() => moveTask(task, task.status === 'done' ? 'todo' : 'done')}>{task.status === 'done' && <Icon.Check size={12} />}</button>
                <div className="task-main">
                  <strong>{task.title}</strong>
                  {task.notes && <p>{task.notes}</p>}
                  <div className="task-meta">
                    <span className={`task-priority ${task.priority}`}>{PRIORITY_LABEL[task.priority]}</span>
                    {task.dueDate && <span className={task.dueDate < today && task.status !== 'done' ? 'overdue' : ''}>截止 {task.dueDate}</span>}
                    {task.paperId && <button type="button" onClick={() => { const paper = papers.find(item => item.id === task.paperId); if (paper) onOpenPaper(paper) }}><Icon.Pdf size={12} /> 打开文献</button>}
                  </div>
                </div>
                <div className="task-actions">
                  <button type="button" title="交给 Work 起草任务" onClick={() => onDraftTask(task)}><Icon.Zap size={13} /></button>
                  <button type="button" title="编辑任务" onClick={() => setTaskForm({ id: task.id, ...taskInputOf(task) })}><Icon.Gear size={13} /></button>
                  <button type="button" title="删除任务" onClick={() => void removeTask(task)}><Icon.X size={13} /></button>
                </div>
              </article>)}
              {byStatus[column.status].length === 0 && <div className="task-empty">{dragId !== null ? '拖到这里' : column.status === 'done' ? '完成的任务会移到这里' : '拖动任务到这里，或点「新建任务」'}</div>}
            </section>)}
          </div>
        </> : <div className="projects-empty board-empty"><b>选择一个项目</b><span>从左侧选择项目，或创建新项目开始。</span></div>}
      </section>
    </div>

    {projectForm && <FormDialog title={projectForm.id ? '编辑项目' : '新建项目'} saveLabel="保存项目" saving={saving} disabled={!projectForm.name?.trim()} error={error} onClose={() => setProjectForm(null)} onSave={() => void saveProject()}>
      <input className="quick-capture-title" placeholder="项目名称" value={projectForm.name ?? ''} maxLength={120} autoFocus onChange={event => setProjectForm({ ...projectForm, name: event.target.value })} />
      <textarea className="quick-capture-text" rows={3} placeholder="项目目标或说明（可选）" value={projectForm.description ?? ''} onChange={event => setProjectForm({ ...projectForm, description: event.target.value })} />
      <div className="project-form-row">
        <label>状态<select value={projectForm.status ?? 'active'} onChange={event => setProjectForm({ ...projectForm, status: event.target.value as ProjectInput['status'] })}><option value="active">进行中</option><option value="paused">已暂停</option><option value="done">已完成</option></select></label>
        <label>截止日期<input type="date" value={projectForm.dueDate ?? ''} onChange={event => setProjectForm({ ...projectForm, dueDate: event.target.value || null })} /></label>
        <label>颜色<input type="color" value={projectForm.color ?? '#9e3b2f'} onChange={event => setProjectForm({ ...projectForm, color: event.target.value })} /></label>
      </div>
    </FormDialog>}

    {taskForm && selected && <FormDialog title={taskForm.id ? '编辑任务' : '新建任务'} saveLabel="保存任务" saving={saving} disabled={!taskForm.title?.trim()} error={error} onClose={() => setTaskForm(null)} onSave={() => void saveTask()} wide>
      <input className="quick-capture-title" placeholder="任务标题" value={taskForm.title ?? ''} maxLength={240} autoFocus onChange={event => setTaskForm({ ...taskForm, title: event.target.value })} />
      <textarea className="quick-capture-text" rows={3} placeholder="任务说明（可选）" value={taskForm.notes ?? ''} onChange={event => setTaskForm({ ...taskForm, notes: event.target.value })} />
      <div className="project-form-row">
        <label>状态<select value={taskForm.status ?? 'todo'} onChange={event => setTaskForm({ ...taskForm, status: event.target.value as TaskInput['status'] })}><option value="todo">待办</option><option value="doing">进行中</option><option value="done">已完成</option></select></label>
        <label>优先级<select value={taskForm.priority ?? 'medium'} onChange={event => setTaskForm({ ...taskForm, priority: event.target.value as TaskInput['priority'] })}><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label>
        <label>截止日期<input type="date" value={taskForm.dueDate ?? ''} onChange={event => setTaskForm({ ...taskForm, dueDate: event.target.value || null })} /></label>
        <label className="project-form-grow">关联文献<select value={taskForm.paperId ?? ''} onChange={event => setTaskForm({ ...taskForm, paperId: event.target.value ? Number(event.target.value) : null })}><option value="">不关联</option>{papers.map(paper => <option key={paper.id} value={paper.id}>{paper.title.slice(0, 80)}</option>)}</select></label>
      </div>
    </FormDialog>}
  </div>
}