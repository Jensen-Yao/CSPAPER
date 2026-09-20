// 工作台 Agent 域 IPC（v0.9）：计划 / 执行 / 中止 / 任务列表与回放
import { ipcMain } from 'electron'
import { planTask, updatePlan, runTask, cancelTask, listTasks, getTask, setNotifier, type PlanStep } from '../agent'
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
}
