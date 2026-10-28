// 自动化（v0.10，对标 ZCode automations / ARIS 夜间循环）：
// 定时无头执行 agent 任务。调度器每 60s 检查到期条目，到点自动「计划 → 免确认执行」，结果进任务列表并通知。
import { getDb, getSettings } from './db'
import { ChatRepository } from './chat/repository'
import type { ChatRuntime } from './chat/runtime'
import { buildContextSnapshot } from './chat/context'
import { getChatServices } from './ipc/chat'
import { snapshotModelBinding } from './model-config'

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
    .run(name.trim().slice(0,80)||'定时任务',goal.trim().slice(0,2000)||'整理文献库中的科研进展',Math.max(30,Math.min(525600,Math.floor(Number.isFinite(intervalMinutes)?intervalMinutes:1440))))
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

export interface UnifiedScheduleOutcome { conversationId:string;runId:string;status:'completed'|'partial'|'failed'|'cancelled'|'interrupted';error?:string }

export async function runHeadlessWithRuntime(schedule:AgentSchedule,runtime:ChatRuntime,repository:ChatRepository):Promise<UnifiedScheduleOutcome> {
  const db=getDb()
  db.prepare('UPDATE agent_schedules SET last_run_at=? WHERE id=?').run(new Date().toISOString(),schedule.id)
  const workspace=repository.ensureWorkspace(getSettings().libraryPath)
  const conversation=repository.createConversation({workspaceId:workspace.id,title:`定时：${schedule.name}`,mode:'act',entry:'work'})
  const model=getSettings().agentModel||getSettings().model||''
  const context=buildContextSnapshot({conversationId:conversation.id,runId:'pending',workspaceId:workspace.id,refs:[],permission:'auto'})
  const submitted=runtime.submitTurn({
    conversationId:conversation.id,clientMessageId:`schedule-${schedule.id}-${Date.now()}`,text:schedule.goal,
    context,modelBinding:snapshotModelBinding(getSettings(),getSettings().agentModelBindingId??getSettings().modelBindingId!,getSettings().thinkingLevel,'act'),mode:'act'
  })
  for(let i=0;i<720;i++) {
    const run=repository.getRun(submitted.run.id)
    if(run&&['completed','partial','failed','cancelled','interrupted'].includes(run.status)) {
      const outcome:UnifiedScheduleOutcome={conversationId:conversation.id,runId:run.id,status:run.status as UnifiedScheduleOutcome['status'],error:run.error?.message}
      const mark=run.status==='completed'?'完成':run.status==='partial'?'部分完成':`失败：${run.error?.message??run.status}`
      db.prepare('UPDATE agent_schedules SET last_result=? WHERE id=?').run(`${mark}（会话 ${conversation.id} / 运行 ${run.id}）`,schedule.id)
      if(run.status==='failed'||run.status==='cancelled'||run.status==='interrupted')throw new Error(mark)
      return outcome
    }
    await new Promise(resolve=>setTimeout(resolve,1000))
  }
  throw new Error('统一自动任务超时')
}

// 无头执行一条：直接提交统一 act runtime；状态只来自持久 run。
const inFlight = new Set<number>()
async function runHeadless(schedule: AgentSchedule): Promise<void> {
  if (inFlight.has(schedule.id)) return
  inFlight.add(schedule.id)
  try {
    const services=getChatServices()
    if(!services)throw new Error('统一对话运行时尚未初始化')
    await runHeadlessWithRuntime(schedule,services.runtime,services.repository)
  } catch(error) {
    getDb().prepare('UPDATE agent_schedules SET last_result=? WHERE id=?').run(String(error).slice(0,500),schedule.id)
    throw error
  } finally {
    inFlight.delete(schedule.id)
  }
}

let ticking = false
let timer:ReturnType<typeof setInterval>|null=null
export async function runDueSchedules(notify:(title:string,detail:string)=>void):Promise<void> {
  if(ticking) return
  ticking=true
  try {
    for(const schedule of listSchedules()) {
      if(!isDue(schedule)||inFlight.has(schedule.id)) continue
      notify('自动任务开始',schedule.name)
      try {await runHeadless(schedule);notify('自动任务完成',`${schedule.name} 已完成，结果见工作台任务列表`)}
      catch(error) {notify('自动任务未完成',`${schedule.name}：${String(error).slice(0,150)}`)}
    }
  } finally {ticking=false}
}
export function startScheduler(notify:(title:string,detail:string)=>void):void {
  if(timer) return
  ensureTable()
  timer=setInterval(()=>{void runDueSchedules(notify)},30_000)
  timer.unref?.()
}
export function stopScheduler():void {
  if(timer) clearInterval(timer)
  timer=null
}
