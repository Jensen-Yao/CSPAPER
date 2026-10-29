import { modelSettings } from './model-config'
import { chatStream } from './llm'
import { getDb, getSettings } from './db'
import { listMcpTools } from './mcp'
import { listSkills } from './skills'

/** Legacy Work API compatibility facade. Execution is owned exclusively by ChatRuntime. */
export interface PlanStep { tool:string;args:Record<string,unknown>;purpose:string }
export interface AgentEvent {
  t:number;kind:'plan'|'step'|'text'|'artifact'|'done'|'error'|'cancelled'|'status';tool?:string;text?:string;ok?:boolean;ms?:number;sid?:number;stream?:boolean;
  artifact?:{kind:string;title:string;paperId?:number;tableId?:number;slug?:string}
}
export interface AgentTask {
  id:string;goal:string;status:'awaiting-confirm'|'running'|'done'|'partial'|'error'|'cancelled';plan:PlanStep[];events:AgentEvent[];answer:string;createdAt:string
  conversationId?:string|null;runId?:string|null
}

let send:(event:string,payload:unknown)=>void=()=>{}

function ensureTable():void {
  getDb().exec(`CREATE TABLE IF NOT EXISTS agent_tasks(
    id TEXT PRIMARY KEY,goal TEXT,status TEXT,plan TEXT DEFAULT '[]',events TEXT DEFAULT '[]',answer TEXT DEFAULT '',created_at TEXT DEFAULT (datetime('now')),conversation_id TEXT,run_id TEXT
  );`)
}
interface TaskRow {id:string;goal:string;status:string;plan:string;events:string;answer:string;created_at:string;conversation_id?:string|null;run_id?:string|null}
function rowToTask(row:TaskRow):AgentTask {
  let plan:PlanStep[]=[],events:AgentEvent[]=[]
  try{plan=JSON.parse(row.plan||'[]')}catch{}
  try{events=JSON.parse(row.events||'[]')}catch{}
  return {id:row.id,goal:row.goal,status:row.status as AgentTask['status'],plan,events,answer:row.answer,createdAt:row.created_at,conversationId:row.conversation_id??null,runId:row.run_id??null}
}
function saveTask(task:AgentTask):void {
  getDb().prepare(`INSERT INTO agent_tasks(id,goal,status,plan,events,answer,created_at,conversation_id,run_id)
    VALUES(?,?,?,?,?,?,datetime('now'),?,?)
    ON CONFLICT(id) DO UPDATE SET status=excluded.status,plan=excluded.plan,events=excluded.events,answer=excluded.answer,conversation_id=excluded.conversation_id,run_id=excluded.run_id`)
    .run(task.id,task.goal,task.status,JSON.stringify(task.plan),JSON.stringify(task.events.slice(-240)),task.answer,task.conversationId??null,task.runId??null)
}
function emit(task:AgentTask,event:Omit<AgentEvent,'t'>):void {
  const full={t:Date.now(),...event};task.events.push(full);saveTask(task)
  send('agent:event',{taskId:task.id,event:full,replace:false})
}
function loadTask(id:string):AgentTask|null {
  const row=getDb().prepare('SELECT * FROM agent_tasks WHERE id=?').get(id) as TaskRow|undefined
  return row?rowToTask(row):null
}
function toolMenu():string {
  const unified=[
    'research.search_web {query} — 联网检索题录',
    'library.search {query, limit?} — 检索本地文献库',
    'paper.read {paperId, pages[]} — 读取论文页',
    'paper.import {url} — 从网页/DOI/arXiv 入库',
    'note.append {paperId, text} — 追加笔记',
    'synthesis.create {paperIds[]} — 生成综述',
    'comparison.create {paperIds[], dimensions?} — 生成对比表',
    'citation.format {paperIds[], style?} — 生成参考文献'
  ]
  const mcp=listMcpTools().map(tool=>`${tool.fullName} ${tool.description.slice(0,90)}`)
  const skills=listSkills().map(skill=>`${skill.name} — ${skill.description.slice(0,90)}`)
  return [...unified,...mcp,...skills].join('\\n')
}
export async function planTask(goal:string):Promise<AgentTask> {
  ensureTable()
  const task:AgentTask={id:'t'+Date.now()+Math.floor(Math.random()*1000),goal,status:'awaiting-confirm',plan:[],events:[],answer:'',createdAt:new Date().toISOString()}
  const settings=getSettings(),model=settings.agentModel||settings.model
  let raw=''
  try {
    for await(const delta of chatStream([
      {role:'system',content:'你是科研工作流规划器。只输出 JSON：{"steps":[{"tool":"工具名","args":{},"purpose":"目的"}]}。使用给定工具名，不要发明工具。\\n'+toolMenu()},
      {role:'user',content:goal}
    ],{endpoint:modelSettings(settings,model)}))raw+=delta
    const parsed=JSON.parse(raw.replace(/^```json\\s*|```\\s*$/g,'').trim()) as {steps?:PlanStep[]}
    task.plan=(parsed.steps??[]).filter(step=>step&&step.tool)
    if(!task.plan.length)throw new Error('empty plan')
  }catch(error) {
    task.status='error';task.events.push({t:Date.now(),kind:'error',text:'计划解析失败：'+String(error).slice(0,200)})
  }
  saveTask(task);if(task.status!=='error')emit(task,{kind:'plan',text:JSON.stringify(task.plan)})
  return task
}
export function updatePlan(id:string,plan:PlanStep[]):AgentTask|null {
  ensureTable();const task=loadTask(id);if(!task)return null
  task.plan=plan;saveTask(task);return task
}
export function recoverInterruptedTasks():void {
  ensureTable()
  getDb().prepare("UPDATE agent_tasks SET status='error',answer='上次运行被中断，可重新执行任务' WHERE status='running'").run()
}
export function cancelTask(id:string):boolean {
  ensureTable();const task=loadTask(id);if(!task)return false
  if(task.status!=='running')return false
  task.status='cancelled';saveTask(task);emit(task,{kind:'cancelled',text:'任务已停止'});return true
}
export function listTasks():Array<Pick<AgentTask,'id'|'goal'|'status'|'createdAt'|'answer'|'conversationId'|'runId'>> {
  ensureTable()
  return (getDb().prepare('SELECT * FROM agent_tasks ORDER BY created_at DESC LIMIT 50').all() as TaskRow[]).map(row=>{const task=rowToTask(row);return{id:task.id,goal:task.goal,status:task.status,createdAt:task.createdAt,answer:task.answer,conversationId:task.conversationId??null,runId:task.runId??null}})
}
export function getTask(id:string):AgentTask|null {ensureTable();return loadTask(id)}
export function removeTask(id:string):boolean {
  ensureTable()
  const task=loadTask(id)
  if(!task)return false
  if(task.status==='running')throw new Error('任务仍在执行，请先停止再删除')
  return getDb().prepare('DELETE FROM agent_tasks WHERE id=?').run(id).changes>0
}
export function setNotifier(fn:(event:string,payload:unknown)=>void):void {send=fn}
