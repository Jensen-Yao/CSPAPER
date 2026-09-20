// 工作台 Agent 域 IPC（v0.9）：计划 / 执行 / 中止 / 任务列表与回放
import { ipcMain } from 'electron'
import { planTask, updatePlan, runTask, cancelTask, listTasks, getTask, setNotifier, type PlanStep } from '../agent'
import { shell } from 'electron'
import fs from 'node:fs'
import { connectAll, listMcpTools, mcpConfigPath } from '../mcp'
import { listSkills, invalidateSkills, skillDir } from '../skills'
import { listSchedules, createSchedule, removeSchedule, toggleSchedule, startScheduler } from '../automation'
import type { IpcCtx } from './context'

export function registerAgentIpc(ctx: IpcCtx): void {
  setNotifier(ctx.send)

  ipcMain.handle('agent:plan', (_e, goal: string) => planTask(String(goal ?? '').slice(0, 2000)))
  ipcMain.handle('agent:update-plan', (_e, id: string, plan: PlanStep[]) => updatePlan(String(id), Array.isArray(plan) ? plan : []))
  ipcMain.handle('agent:run', (_e, id: string) => {
    // 异步执行：结果经 agent:event 推送，这里立即返回
    void runTask(String(id)).catch((e) => ctx.send('agent:event', { taskId: id, event: { t: Date.now(), kind: 'error', text: String(e).slice(0, 200) } }))
    return { ok: true }
  })
  ipcMain.handle('agent:cancel', (_e, id: string) => cancelTask(String(id)))
  ipcMain.handle('agent:tasks', () => listTasks())
  ipcMain.handle('agent:task', (_e, id: string) => getTask(String(id)))

  // ---------- MCP / 技能 / 自动化（v0.10） ----------
  ipcMain.handle('agent:mcp-status', async () => {
    const results = await connectAll()
    return { results, tools: listMcpTools().map((t) => ({ fullName: t.fullName, server: t.server, description: t.description.slice(0, 100) })), configPath: mcpConfigPath() }
  })
  ipcMain.handle('agent:mcp-open-config', async () => {
    const p = mcpConfigPath()
    if (!fs.existsSync(p)) fs.writeFileSync(p, JSON.stringify({ mcpServers: {} }, null, 2))
    await shell.openPath(p)
    return true
  })
  ipcMain.handle('agent:skills', () => {
    invalidateSkills()
    return listSkills().map((x) => ({ name: x.name, description: x.description, source: x.source }))
  })
  ipcMain.handle('agent:skills-open-dir', async () => {
    fs.mkdirSync(skillDir(), { recursive: true })
    await shell.openPath(skillDir())
    return true
  })
  ipcMain.handle('agent:auto-list', () => listSchedules())
  ipcMain.handle('agent:auto-create', (_e, name: string, goal: string, minutes: number) => {
    startSchedulerOnce(ctx)
    return createSchedule(String(name), String(goal), Number(minutes) || 1440)
  })
  ipcMain.handle('agent:auto-remove', (_e, id: number) => {
    removeSchedule(Number(id))
    return true
  })
  ipcMain.handle('agent:auto-toggle', (_e, id: number, enabled: boolean) => {
    toggleSchedule(Number(id), enabled)
    return true
  })
}

let schedulerStarted = false
function startSchedulerOnce(ctx: IpcCtx): void {
  if (schedulerStarted) return
  schedulerStarted = true
  startScheduler((title, detail) => ctx.send('app:notice', { title, detail }))
}
