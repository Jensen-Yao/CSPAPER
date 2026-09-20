// 自动化（v0.10，对标 ZCode automations / ARIS 夜间循环）：
// 定时无头执行 agent 任务。调度器每 60s 检查到期条目，到点自动「计划 → 免确认执行」，结果进任务列表并通知。
import { getDb } from './db'
import { planTask, runTask } from './agent'

export interface AgentSchedule {
  id: number
  name: string
  goal: string
  interval_minutes: number
  enabled: number
  last_run_at: string | null
  last_result: string | null
}

function ensureTable(): void {
  getDb().exec(`CREATE TABLE IF NOT EXISTS agent_schedules(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    goal TEXT,
    interval_minutes INTEGER DEFAULT 1440,
    enabled INTEGER DEFAULT 1,
    last_run_at TEXT,
    last_result TEXT
  );`)
}

export function listSchedules(): AgentSchedule[] {
  ensureTable()
  return getDb().prepare('SELECT * FROM agent_schedules ORDER BY id DESC').all() as AgentSchedule[]
}

export function createSchedule(name: string, goal: string, intervalMinutes: number): AgentSchedule {
  ensureTable()
  const r = getDb()
    .prepare('INSERT INTO agent_schedules(name, goal, interval_minutes) VALUES(?,?,?)')
    .run(name.trim().slice(0, 80) || '定时任务', goal.trim().slice(0, 2000), Math.max(30, Math.floor(intervalMinutes)))
  const id = Number(r.lastInsertRowid)
  return getDb().prepare('SELECT * FROM agent_schedules WHERE id=?').get(id) as AgentSchedule
}

export function removeSchedule(id: number): void {
  ensureTable()
  getDb().prepare('DELETE FROM agent_schedules WHERE id=?').run(id)
}

export function toggleSchedule(id: number, enabled: boolean): void {
  ensureTable()
  getDb().prepare('UPDATE agent_schedules SET enabled=? WHERE id=?').run(enabled ? 1 : 0, id)
}

function isDue(s: AgentSchedule): boolean {
  if (!s.enabled) return false
  if (!s.last_run_at) return true
  const last = new Date(s.last_run_at.replace(' ', 'T')).getTime()
  if (Number.isNaN(last)) return true
  return Date.now() - last >= s.interval_minutes * 60_000
}

// 无头执行一条：计划 → 免确认直接跑（计划为空也照跑，ReAct 自行规划）
async function runHeadless(s: AgentSchedule): Promise<void> {
  const db = getDb()
  const t = await planTask(s.goal)
  const run = getDb().prepare('SELECT id FROM agent_tasks WHERE id=?').get(t.id) as { id: string } | undefined
  if (!run) return
  db.prepare("UPDATE agent_tasks SET status='running' WHERE id=?").run(t.id)
  const r = await runTask(t.id)
  const mark = r.ok ? '完成' : `失败：${r.error ?? ''}`
  db.prepare("UPDATE agent_schedules SET last_run_at=datetime('now','localtime'), last_result=? WHERE id=?").run(
    `${mark}（任务 ${t.id}）`,
    s.id
  )
}

let ticking = false
export function startScheduler(notify: (title: string, detail: string) => void): void {
  ensureTable()
  setInterval(() => {
    if (ticking) return
    ticking = true
    try {
      for (const s of listSchedules()) {
        if (!isDue(s)) continue
        notify('自动任务开始', `${s.name}：${s.goal.slice(0, 60)}`)
        void runHeadless(s)
          .then(() => notify('自动任务结束', `${s.name} 已完成，结果见工作台任务列表`))
          .catch((e) => notify('自动任务失败', String(e).slice(0, 100)))
      }
    } finally {
      ticking = false
    }
  }, 60_000)
}
