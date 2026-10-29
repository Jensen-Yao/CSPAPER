// 工作台 Agent 域 IPC（v0.9）：计划 / 执行 / 中止 / 任务列表与回放
import { ipcMain } from 'electron'
import { planTask, updatePlan, cancelTask, listTasks, getTask, removeTask, setNotifier, recoverInterruptedTasks, type PlanStep, type AgentTask } from '../agent'
import { shell } from 'electron'
import fs from 'node:fs'
import { connectAll, listMcpTools, mcpConfigPath } from '../mcp'
import { listSkills, invalidateSkills, skillDir } from '../skills'
import { listSchedules, createSchedule, removeSchedule, toggleSchedule, startScheduler } from '../automation'
import { attachTaskToConversation, mirrorLegacyEvent } from '../chat/legacy-agent'
import { buildContextSnapshot } from '../chat/context'
import type { PlanStepRecord } from '../chat/planning'
import { snapshotModelBinding } from '../model-config'
import { getDb, getSettings } from '../db'
import { getChatServices } from './chat'
import { ResearchCalendar } from '../research-calendar'
import { ResearchFocus } from '../research-focus'
import { ensureWorkspace } from '../workspaces'
import type { IpcCtx } from './context'

const LEGACY_TOOL_MAP:Record<string,{tool:string;map:(step:PlanStep,goal:string)=>Record<string,unknown>}>={
  search_papers:{tool:'research.search_web',map:(step,goal)=>({query:String(step.args.query??goal),limit:10})},
  search_library:{tool:'library.search',map:(step,goal)=>({query:String(step.args.query??goal),limit:12})},
  list_library:{tool:'library.search',map:(step,goal)=>({query:String(step.args.query??step.args.category??goal),limit:Math.min(50,Number(step.args.limit??12)||12)})},
  import_paper:{tool:'paper.import',map:step=>({url:String(step.args.url??'')})},
  read_paper:{tool:'paper.read',map:step=>({paperId:Number(step.args.paperId),pages:Array.isArray(step.args.pages)?step.args.pages.map(Number):[Number(step.args.pages??1)||1]})},
  ask_paper:{tool:'paper.read',map:step=>({paperId:Number(step.args.paperId),pages:[Number(step.args.pages??1)||1]})},
  write_note:{tool:'note.append',map:step=>({paperId:Number(step.args.paperId),text:String(step.args.text??'')})},
  make_synthesis:{tool:'synthesis.create',map:step=>({paperIds:Array.isArray(step.args.paperIds)?step.args.paperIds.map(Number):[]})},
  compare_papers:{tool:'comparison.create',map:step=>({paperIds:Array.isArray(step.args.paperIds)?step.args.paperIds.map(Number):[],dimensions:Array.isArray(step.args.dimensions)&&step.args.dimensions.length?step.args.dimensions.map(String):['研究方法','数据与实验','核心结论']})},
  cite_format:{tool:'citation.format',map:step=>({paperIds:Array.isArray(step.args.paperIds)?step.args.paperIds.map(Number):[],style:String(step.args.style??'gbt7714-num')})}
}
function unifiedPlan(task:AgentTask,policies:Map<string,string>):PlanStepRecord[] {
  return task.plan.map((step,index)=>{
    const mapped=LEGACY_TOOL_MAP[step.tool]
    const tool=mapped?.tool??step.tool
    return {id:`legacy-${index+1}`,tool,args:mapped?mapped.map(step,task.goal):step.args,purpose:step.purpose||`执行 ${tool}`,risk:policies.get(tool)} as PlanStepRecord
  }).filter(step=>policies.has(step.tool))
}
function getChatToolPolicies():Array<[string,string]> {
  return getChatServices()?.runtime.toolPolicies().map(tool=>[tool.name,tool.risk] as [string,string])??[]
}

function legacyStatus(status:string|undefined|null):AgentTask['status']|null {
  if(status==='queued'||status==='preparing'||status==='generating'||status==='executing_tools'||status==='awaiting_approval')return 'running'
  if(status==='completed')return 'done';if(status==='partial')return 'partial';if(status==='failed'||status==='interrupted')return 'error';if(status==='cancelled')return 'cancelled';return null
}

export function registerAgentIpc(ctx: IpcCtx): void {
  const calendar=new ResearchCalendar(getDb())
  const focus=new ResearchFocus(getDb())
  const workspaceId=()=>ensureWorkspace(getDb(),getSettings().libraryPath).id
  const chat=getChatServices()
  if(chat)chat.bus.subscribe({listener:event=>{
    if(event.type!=='run.status_changed'&&event.type!=='run.completed')return
    const row=getDb().prepare('SELECT id FROM agent_tasks WHERE run_id=?').get(event.runId) as {id:string}|undefined
    if(!row)return
    const status=legacyStatus(event.type==='run.completed'?(event.payload as {status?:string}).status:(event.payload as {status?:string}).status)
    if(status)getDb().prepare('UPDATE agent_tasks SET status=? WHERE id=?').run(status,row.id)
  }})
  setNotifier((event,payload)=>{
    if(event==='agent:event'&&chat){
      const item=payload as {taskId:string;event:import('../agent').AgentEvent}
      mirrorLegacyEvent(item.taskId,item.event,chat.repository,chat.bus)
    }
    ctx.send(event,payload)
  })
  recoverInterruptedTasks()
  startSchedulerOnce(ctx)

  ipcMain.handle('agent:plan', async (_e, goal: string) => {
    const task=await planTask(String(goal ?? '').slice(0,2000))
    const services=getChatServices();if(services)attachTaskToConversation(task,services.repository)
    return task
  })
  ipcMain.handle('agent:update-plan', (_e, id: string, plan: PlanStep[]) => updatePlan(String(id), Array.isArray(plan) ? plan : []))
  ipcMain.handle('agent:run', (_e, id: string) => {
    const services=getChatServices();if(!services)throw new Error('统一运行时尚未初始化')
    const task=getTask(String(id));if(!task||!task.plan.length)throw new Error('任务或计划不存在')
    const link=attachTaskToConversation(task,services.repository),conversation=services.repository.getConversation(link.conversationId)
    if(!conversation)throw new Error('兼容任务会话不存在')
    const settings=getSettings(),modelBinding=snapshotModelBinding(settings,settings.agentModelBindingId??settings.modelBindingId??'',settings.thinkingLevel,'act')
    const context=buildContextSnapshot({conversationId:conversation.id,runId:'pending',workspaceId:conversation.workspaceId,refs:[],permission:'auto'})
    const normalized=unifiedPlan(task,new Map(getChatToolPolicies()))
    if(!normalized.length)throw new Error('旧任务没有可映射到统一工具 Registry 的步骤')
    const submitted=services.runtime.submitPlannedTurn({conversationId:conversation.id,clientMessageId:'legacy-task-'+task.id,parentMessageId:conversation.activeLeafMessageId,text:task.goal,context,modelBinding,mode:'act'},normalized)
    getDb().prepare('UPDATE agent_tasks SET run_id=?,status=? WHERE id=?').run(submitted.run.id,'running',task.id)
    return {ok:true,conversationId:conversation.id,runId:submitted.run.id}
  })
  ipcMain.handle('agent:cancel',(_e,id:string)=>{
    const services=getChatServices(),taskId=String(id)
    if(services){
      const row=getDb().prepare('SELECT run_id FROM agent_tasks WHERE id=?').get(taskId) as {run_id?:string|null}|undefined
      if(row?.run_id&&services.runtime.cancelRun(row.run_id,'用户停止兼容任务'))return true
    }
    return cancelTask(taskId)
  })
  ipcMain.handle('agent:tasks', () => listTasks())
  ipcMain.handle('agent:task', (_e, id: string) => getTask(String(id)))
  ipcMain.handle('agent:task-delete',(_e,id:string)=>removeTask(String(id)))

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
  ipcMain.handle('calendar:list',(_e,start:string,end:string)=>calendar.list(workspaceId(),start,end))
  ipcMain.handle('calendar:save',(_e,input:unknown,id?:number)=>calendar.save(workspaceId(),input as import('../../shared/calendar').CalendarInput,id))
  ipcMain.handle('calendar:remove',(_e,id:number)=>calendar.remove(workspaceId(),id))
  ipcMain.handle('focus:log',(_e,input:unknown)=>focus.log(workspaceId(),input as import('../../shared/calendar').FocusLogInput))
  ipcMain.handle('focus:summary',(_e,date:string)=>focus.summary(workspaceId(),date))
}

let schedulerStarted = false
function startSchedulerOnce(ctx: IpcCtx): void {
  if (schedulerStarted) return
  schedulerStarted = true
  startScheduler((title, detail) => ctx.send('app:notice', { title, detail }))
}
