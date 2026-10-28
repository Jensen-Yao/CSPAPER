import { useState } from 'react'
import type { Run, RunEvent } from '../../../../shared/chat'

interface Step {id:string;tool:string;purpose:string}
interface Payload {steps?:Step[];toolCallId?:string;tool?:string;summary?:string;reason?:string;impact?:string;status?:string;error?:{message:string}}
export default function RunPanel({events,run}:{events:RunEvent[];run?:Run|null}) {
  const [error,setError]=useState(''),[pending,setPending]=useState(false)
  const plan=events.filter(event=>event.type==='plan.created'||event.type==='plan.updated').at(-1)?.payload as Payload|undefined
  const resolved=new Set(events.filter(event=>event.type==='approval.resolved').map(event=>(event.payload as Payload).toolCallId))
  const approvals=run?.status==='awaiting_approval'?events.filter(event=>event.type==='approval.required'&&!resolved.has((event.payload as Payload).toolCallId)):[]
  const approve=async(id:string,value:boolean)=>{
    setPending(true);setError('')
    try{if(!await window.api.chat.approveTool(id,value))setError('运行状态已变化，请重新打开当前会话')}
    catch(error){setError(String(error))}finally{setPending(false)}
  }
  return <div className="chat-run-panel">
    {!!plan?.steps?.length&&<details className="chat-plan" open={run?.status==='executing_tools'||run?.status==='awaiting_approval'}><summary>执行计划 · {plan.steps.length} 步</summary><ol>{plan.steps.map((step,index)=>{
      const id=`call_${run?.id}_${index}`
      const end=events.find(event=>(event.type==='tool.completed'||event.type==='tool.failed')&&(event.payload as Payload).toolCallId===id)
      const start=events.some(event=>event.type==='tool.started'&&(event.payload as Payload).toolCallId===id)
      return <li key={step.id}><span>{end?(end.type==='tool.failed'?'失败':'完成'):start?'执行中':'待执行'}</span>{step.purpose||step.tool}{end&&(end.payload as Payload).error&&<small>{(end.payload as Payload).error?.message}</small>}</li>
    })}</ol></details>}
    {approvals.map(event=>{const payload=event.payload as Payload;return <div key={event.seq} className="chat-approval"><b>需要确认 · {payload.tool}</b><p>{payload.impact||payload.reason}</p><button disabled={pending} onClick={()=>payload.toolCallId&&void approve(payload.toolCallId,true)}>批准执行</button><button disabled={pending} onClick={()=>payload.toolCallId&&void approve(payload.toolCallId,false)}>拒绝</button></div>})}
    {error&&<div className="chat-message-error" role="alert">{error}</div>}
    {run?.error&&<div className="chat-message-error" role="status">{run.error.message}</div>}
  </div>
}
