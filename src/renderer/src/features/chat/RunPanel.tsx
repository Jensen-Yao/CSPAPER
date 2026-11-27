import { useState } from 'react'
import type { Run, RunEvent } from '../../../../shared/chat'

interface Step {id:string;tool:string;purpose:string}
interface Payload {steps?:Step[];toolCallId?:string;tool?:string;summary?:string;reason?:string;impact?:string;status?:string;error?:{message?:string};args?:unknown}
interface ToolRow {toolCallId:string;tool:string;args?:unknown;summary?:string;error?:string;running:boolean}
export const TOOL_LABEL:Record<string,string>={
  'library.search':'库内检索','library.list':'浏览文献库','paper.read':'读取论文','paper.open':'打开文献','paper.import':'导入文献','paper.set_status':'设置阅读状态','paper.set_tags':'设置标签','paper.update_metadata':'更新题录',
  'note.save':'保存笔记','note.append':'追加笔记','note.read':'读取笔记','standalone_note.save':'保存独立笔记','standalone_note.read':'读取独立笔记',
  'comparison.create':'生成对比表','comparison.update':'更新对比表','synthesis.create':'生成综述','citation.format':'生成参考文献','collection.create':'新建集合','collection.add_papers':'加入集合','collection.remove_paper':'移出集合',
  'research.search_web':'检索题录','web_search':'联网搜索','web_fetch':'读取网页','task.create':'创建任务','task.update':'更新任务','project.create':'创建项目','calendar.create':'创建日程','export.markdown':'导出 Markdown'
}
export const toolLabel=(tool?:string):string=>tool?(TOOL_LABEL[tool]??tool):'工具'

/** One row per tool call, merged from tool.started / completed / failed events. */
export function toolRows(events:RunEvent[]):ToolRow[] {
  const rows=new Map<string,ToolRow>()
  for(const event of events) {
    const payload=event.payload as Payload
    if(event.type==='tool.started'&&payload.toolCallId)rows.set(payload.toolCallId,{toolCallId:payload.toolCallId,tool:payload.tool??'',args:payload.args,running:true})
    else if((event.type==='tool.completed'||event.type==='tool.failed')&&payload.toolCallId) {
      const row=rows.get(payload.toolCallId)??{toolCallId:payload.toolCallId,tool:payload.tool??'',running:false}
      rows.set(payload.toolCallId,{...row,tool:(row.tool||payload.tool||''),summary:payload.summary,error:payload.error?.message,running:false})
    }
  }
  return [...rows.values()]
}

export default function RunPanel({events,run}:{events:RunEvent[];run?:Run|null}) {
  const [error,setError]=useState(''),[pending,setPending]=useState(false),[openTool,setOpenTool]=useState(''),[planOpen,setPlanOpen]=useState<boolean|null>(null),[toolsOpen,setToolsOpen]=useState<boolean|null>(null)
  const plan=events.filter(event=>event.type==='plan.created'||event.type==='plan.updated').at(-1)?.payload as Payload|undefined
  const resolved=new Set(events.filter(event=>event.type==='approval.resolved').map(event=>(event.payload as Payload).toolCallId))
  const approvals=run?.status==='awaiting_approval'?events.filter(event=>event.type==='approval.required'&&!resolved.has((event.payload as Payload).toolCallId)):[]
  const tools=toolRows(events),done=tools.filter(row=>!row.running).length
  if(!plan?.steps?.length&&!tools.length&&!approvals.length&&!error&&!run?.error)return null
  const approve=async(id:string,value:boolean)=>{
    setPending(true);setError('')
    try{if(!await window.api.chat.approveTool(id,value))setError('运行状态已变化，请重新打开当前会话')}
    catch(error){setError(String(error))}finally{setPending(false)}
  }
  return <div className="chat-run-panel">
    {!!plan?.steps?.length&&<details className="chat-plan" open={planOpen??(run?.status==='executing_tools'||run?.status==='awaiting_approval')} onToggle={event=>setPlanOpen(event.currentTarget.open)}><summary>执行计划 · {plan.steps.length} 步</summary><ol>{plan.steps.map((step,index)=>{
      const id=`call_${run?.id}_${index}`
      const end=events.find(event=>(event.type==='tool.completed'||event.type==='tool.failed')&&(event.payload as Payload).toolCallId===id)
      const start=events.some(event=>event.type==='tool.started'&&(event.payload as Payload).toolCallId===id)
      return <li key={step.id}><span>{end?(end.type==='tool.failed'?'失败':'完成'):start?'执行中':'待执行'}</span>{step.purpose||toolLabel(step.tool)}<small>{step.tool}</small>{end&&(end.payload as Payload).error&&<small>{(end.payload as Payload).error?.message}</small>}</li>
    })}</ol></details>}
    {tools.length>0&&<details className="chat-tools" open={toolsOpen??(tools.length<=4||(run?.status==='executing_tools'&&tools.length<=8))} onToggle={event=>setToolsOpen(event.currentTarget.open)}><summary>工具调用 · {tools.length}{done<tools.length?` · ${done} 已完成`:''}</summary><ol>{tools.map(row=><li key={row.toolCallId} className={row.error?'fail':row.running?'running':''}>
      <button type="button" onClick={()=>setOpenTool(openTool===row.toolCallId?'':row.toolCallId)}><span className={`chat-tool-state ${row.error?'bad':''}`}>{row.running?'…':row.error?'✕':'✓'}</span><b>{toolLabel(row.tool)}</b><span className="ellipsis">{row.summary||row.error||(row.running?'执行中':'')}</span></button>
      {openTool===row.toolCallId&&<div className="chat-tool-detail">{row.args!==undefined&&<pre>{JSON.stringify(row.args,null,2)}</pre>}{row.summary&&row.summary!==row.error&&<div>{row.summary}</div>}{row.error&&<div className="chat-message-error" role="status">{row.error}</div>}</div>}
    </li>)}</ol></details>}
    {approvals.map(event=>{const payload=event.payload as Payload;return <div key={event.seq} className="chat-approval"><b>需要确认 · {toolLabel(payload.tool)}</b><p>{payload.impact||payload.reason}</p>{payload.args!==undefined&&<pre>{JSON.stringify(payload.args,null,2)}</pre>}<button disabled={pending} onClick={()=>payload.toolCallId&&void approve(payload.toolCallId,true)}>批准执行</button><button disabled={pending} onClick={()=>payload.toolCallId&&void approve(payload.toolCallId,false)}>拒绝</button></div>})}
    {error&&<div className="chat-message-error" role="alert">{error}</div>}
    {run?.error&&<div className="chat-message-error" role="status">{run.error.message}</div>}
  </div>
}
