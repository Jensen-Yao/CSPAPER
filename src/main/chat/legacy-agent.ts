import { getDb, getSettings } from '../db'
import type { AgentEvent, AgentTask } from '../agent'
import { ChatRepository } from './repository'
import type { RunEventType, RunStatus } from '../../shared/chat'
import { isTerminalRunStatus } from '../../shared/chat'
import { ChatEventBus } from './events'

export interface LegacyLink { conversationId:string;runId?:string|null }
interface LegacyLinkRow { conversation_id:string;run_id:string }

export function attachTaskToConversation(task:AgentTask,repository:ChatRepository):LegacyLink {
  const db=getDb(),existing=db.prepare('SELECT conversation_id,run_id FROM agent_tasks WHERE id=?').get(task.id) as LegacyLinkRow|undefined
  if(existing?.conversation_id)return {conversationId:existing.conversation_id,runId:existing.run_id??null}
  const workspace=repository.ensureWorkspace(getSettings().libraryPath)
  const conversation=repository.createConversation({workspaceId:workspace.id,title:task.goal.slice(0,120)||'科研任务',mode:'act',entry:'work'})
  db.prepare('UPDATE agent_tasks SET conversation_id=?,run_id=NULL WHERE id=?').run(conversation.id,task.id)
  return {conversationId:conversation.id,runId:null}
}

function eventKind(event:AgentEvent):RunEventType {
  if(event.kind==='plan')return 'plan.created'
  if(event.kind==='step')return event.ok===false?'tool.failed':'tool.completed'
  if(event.kind==='artifact')return 'artifact.created'
  if(event.kind==='text')return 'message.delta'
  if(event.kind==='error')return 'error'
  return 'run.status_changed'
}

function terminalStatus(event:AgentEvent):RunStatus|null {
  if(event.kind==='cancelled')return 'cancelled'
  if(event.kind==='error')return 'failed'
  if(event.kind==='done')return (event.text||'').includes('部分完成')?'partial':'completed'
  return null
}

export function mirrorLegacyEvent(taskId:string,event:AgentEvent,repository:ChatRepository,bus:ChatEventBus):void {
  const db=getDb(),link=db.prepare('SELECT conversation_id,run_id FROM agent_tasks WHERE id=?').get(taskId) as LegacyLinkRow|undefined
  if(!link?.run_id)return
  const run=repository.getRun(link.run_id)
  if(!run||isTerminalRunStatus(run.status))return
  const status=terminalStatus(event)
  if(event.kind==='text'&&event.text)repository.appendMessageText(run.assistantMessageId,event.text)
  if(event.kind==='done')repository.updateMessage(run.assistantMessageId,{status:status==='partial'?'partial':'complete'})
  bus.appendAndPublish(link.run_id,eventKind(event),{legacy:event,taskId},run.assistantMessageId)
  if(status)repository.updateRunStatus(link.run_id,status,status==='failed'?{code:'legacy_agent_failed',message:event.text||'',retryable:true}:null)
}
