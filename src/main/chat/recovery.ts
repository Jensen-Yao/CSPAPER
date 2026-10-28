import type { Run } from '../../shared/chat'
import type { ChatRepository } from './repository'

/** Startup recovery never resurrects in-flight work; it records an explicit interrupted terminal state. */
export function recoverInterruptedRuns(repository:ChatRepository):Run[] {
  const recovered:Run[]=[]
  for(const run of repository.listUnfinishedRuns()) {
    for(const call of repository.listToolCalls(run.id))if(call.status==='running')repository.updateToolCall(call.tool_call_id,'failed',{summary:'进程中断，调用结果需要核对',error:{code:'outcome_unknown',message:'工具启动后进程退出，不能自动重复执行',retryable:false}})
    const message=repository.getMessage(run.assistantMessageId)
    repository.updateMessage(run.assistantMessageId,{parts:[...(message?.parts??[]),{type:'error',code:'interrupted',message:'上次运行因应用退出而中断，可从已保存结果继续'}],status:message?.parts.some(part=>part.type==='text'&&part.text)?'partial':'failed'})
    recovered.push(repository.updateRunStatus(run.id,'interrupted',{code:'interrupted',message:'应用在上次运行结束前退出',retryable:true})!)
    repository.appendRunEvent(run.id,'run.completed',{status:'interrupted',reason:'interrupted'})
  }
  return recovered
}
