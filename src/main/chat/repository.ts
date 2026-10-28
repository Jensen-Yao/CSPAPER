import crypto from 'node:crypto'
import type Database from 'better-sqlite3'
import type { Conversation, ConversationMode, Message, MessagePart, MessageRole, MessageStatus, Run, RunEvent, RunEventType, RunStatus } from '../../shared/chat'
import { isTerminalRunStatus } from '../../shared/chat'
import type { ContextSnapshot } from '../../shared/context'
import type { ModelBindingSnapshot } from '../../shared/models'
import type { ArtifactRef, DomainChange, ToolError } from '../../shared/tools'
import type { Source } from '../../shared/sources'
import { ensureWorkspace, type Workspace } from '../workspaces'

export interface ConversationRow {
  id:string;workspace_id:string;title:string;mode:ConversationMode;entry:Conversation['entry'];active_leaf_id:string|null;created_at:string;updated_at:string;archived_at:string|null
}
export interface MessageRow {
  ord:number;id:string;conversation_id:string;parent_id:string|null;client_message_id:string|null;role:MessageRole;parts_json:string;status:MessageStatus;run_id:string|null;created_at:string;updated_at:string
}
export interface RunRow {
  id:string;conversation_id:string;user_message_id:string;assistant_message_id:string;mode:ConversationMode;status:RunStatus;model_binding_json:string;context_snapshot_json:string;error_json:string|null;created_at:string;started_at:string|null;finished_at:string|null
}
export interface ToolCallRecord {
  id:string;run_id:string;tool_call_id:string;tool:string;tool_version:number;args_json:string;status:'pending'|'awaiting_approval'|'running'|'success'|'partial'|'failed'|'cancelled';result_json:string|null;operation_id:string|null;started_at:string|null;finished_at:string|null;created_at:string;updated_at:string
}
export interface CreateTurnResult { run:Run; userMessage:Message; assistantMessage:Message; reused:boolean }

function parseJson<T>(value:string,fallback:T):T {
  try { return JSON.parse(value) as T } catch { return fallback }
}
function rowToConversation(row:ConversationRow):Conversation {
  return { id:row.id,workspaceId:row.workspace_id,title:row.title,mode:row.mode,entry:row.entry,activeLeafMessageId:row.active_leaf_id,createdAt:row.created_at,updatedAt:row.updated_at,archivedAt:row.archived_at }
}
function rowToMessage(row:MessageRow):Message {
  return { id:row.id,conversationId:row.conversation_id,parentId:row.parent_id,clientMessageId:row.client_message_id,role:row.role,parts:parseJson<MessagePart[]>(row.parts_json,[]),status:row.status,runId:row.run_id,createdAt:row.created_at,updatedAt:row.updated_at }
}
function rowToRun(row:RunRow):Run {
  return { id:row.id,conversationId:row.conversation_id,mode:row.mode,userMessageId:row.user_message_id,assistantMessageId:row.assistant_message_id,status:row.status,error:row.error_json?parseJson<Run['error']>(row.error_json,null):null,createdAt:row.created_at,startedAt:row.started_at,finishedAt:row.finished_at }
}

function rowToRunOrNull(row:RunRow|undefined):Run|null { return row?rowToRun(row):null }

export class ChatRepository {
  constructor(private readonly db:Database.Database,private readonly newId:()=>string=() => crypto.randomUUID()) {}

  ensureWorkspace(rootPath:string,displayName=''):Workspace { return ensureWorkspace(this.db,rootPath,displayName) }

  createConversation(input:{workspaceId:string;title?:string;mode?:ConversationMode;entry?:Conversation['entry']}):Conversation {
    const now=new Date().toISOString(),id='cv_'+this.newId()
    this.db.prepare('INSERT INTO conversations(id,workspace_id,title,mode,entry,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
      .run(id,input.workspaceId,(input.title??'新会话').slice(0,180),input.mode??'ask',input.entry??'global',now,now)
    return this.getConversation(id)!
  }

  listConversations(input:{workspaceId:string;includeArchived?:boolean;cursor?:string|null;limit?:number}):{items:Conversation[];nextCursor:string|null} {
    const limit=Math.max(1,Math.min(100,input.limit??50))
    const rows=this.db.prepare(`
      SELECT c.* FROM conversations c
      WHERE c.workspace_id=? AND (? = 0 OR c.archived_at IS NULL)
        AND (? IS NULL OR c.updated_at < (SELECT x.updated_at FROM conversations x WHERE x.id=?)
             OR (c.updated_at = (SELECT x.updated_at FROM conversations x WHERE x.id=?) AND c.id < ?))
      ORDER BY c.updated_at DESC,c.id DESC LIMIT ?
    `).all(input.workspaceId,input.includeArchived?0:1,input.cursor??null,input.cursor,input.cursor,input.cursor,limit+1) as ConversationRow[]
    const page=rows.slice(0,limit).map(rowToConversation)
    return { items:page,nextCursor:rows.length>limit?rows[limit-1].id:null }
  }

  getConversation(id:string):Conversation|null {
    const row=this.db.prepare('SELECT * FROM conversations WHERE id=?').get(id) as ConversationRow|undefined
    return row?rowToConversation(row):null
  }

  renameConversation(id:string,title:string):Conversation|null {
    this.db.prepare('UPDATE conversations SET title=?,updated_at=? WHERE id=?').run(title.slice(0,180),new Date().toISOString(),id)
    return this.getConversation(id)
  }

  archiveConversation(id:string,archived:boolean):Conversation|null {
    this.db.prepare('UPDATE conversations SET archived_at=?,updated_at=? WHERE id=?').run(archived?new Date().toISOString():null,new Date().toISOString(),id)
    return this.getConversation(id)
  }

  /** Permanently removes a terminal conversation and its replayable evidence. Active runs must be stopped first. */
  deleteConversation(id:string):boolean {
    return this.db.transaction(() => {
      const conversation=this.getConversation(id)
      if(!conversation)return false
      const active=this.db.prepare("SELECT id FROM chat_runs WHERE conversation_id=? AND status IN ('queued','preparing','generating','executing_tools','awaiting_approval') LIMIT 1").get(id)
      if(active)throw new Error('任务仍在执行，请先停止再删除会话')
      this.db.prepare('DELETE FROM agent_tasks WHERE conversation_id=?').run(id)
      this.db.prepare('DELETE FROM conversations WHERE id=?').run(id)
      return true
    })()
  }

  appendMessage(input:{conversationId:string;parentId?:string|null;clientMessageId?:string|null;role:MessageRole;parts?:MessagePart[];status?:MessageStatus;runId?:string|null}):Message {
    if(input.clientMessageId) {
      const existing=this.getMessageByClientId(input.conversationId,input.clientMessageId)
      if(existing) return existing
    }
    const now=new Date().toISOString(),id='msg_'+this.newId()
    this.db.transaction(() => {
      if(!this.getConversation(input.conversationId)) throw new Error('会话不存在或已删除')
      if(input.parentId) {
        const parent=this.getMessage(input.parentId)
        if(!parent||parent.conversationId!==input.conversationId) throw new Error('父消息不属于当前会话')
      }
      this.db.prepare('INSERT INTO chat_messages(id,conversation_id,parent_id,client_message_id,role,parts_json,status,run_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(id,input.conversationId,input.parentId??null,input.clientMessageId??null,input.role,JSON.stringify(input.parts??[]),input.status??'complete',input.runId??null,now,now)
      this.db.prepare('UPDATE conversations SET active_leaf_id=?,updated_at=? WHERE id=?').run(id,now,input.conversationId)
    })()
    return this.getMessage(id)!
  }

  getMessage(id:string):Message|null {
    const row=this.db.prepare('SELECT * FROM chat_messages WHERE id=?').get(id) as MessageRow|undefined
    return row?rowToMessage(row):null
  }

  getMessageByClientId(conversationId:string,clientMessageId:string):Message|null {
    const row=this.db.prepare('SELECT * FROM chat_messages WHERE conversation_id=? AND client_message_id=?').get(conversationId,clientMessageId) as MessageRow|undefined
    return row?rowToMessage(row):null
  }

  messageAncestors(messageId:string,limit=200):Message[] {
    return (this.db.prepare(`WITH RECURSIVE branch AS (
      SELECT *,0 depth FROM chat_messages WHERE id=?
      UNION ALL SELECT parent.*,branch.depth+1 FROM chat_messages parent JOIN branch ON parent.id=branch.parent_id WHERE branch.depth<?
    ) SELECT * FROM branch ORDER BY depth DESC`).all(messageId,limit-1) as MessageRow[]).map(rowToMessage)
  }

  loadMessages(input:{conversationId:string;beforeMessageId?:string|null;limit?:number}):{items:Message[];hasMore:boolean} {
    const limit=Math.max(1,Math.min(200,input.limit??80))
    let beforeOrd:number|null=null
    if(input.beforeMessageId) {
      const cursor=this.db.prepare('SELECT ord FROM chat_messages WHERE conversation_id=? AND id=?').get(input.conversationId,input.beforeMessageId) as {ord:number}|undefined
      if(!cursor) throw new Error('消息游标无效')
      beforeOrd=cursor.ord
    }
    const rows=this.db.prepare('SELECT * FROM chat_messages WHERE conversation_id=? AND (? IS NULL OR ord < ?) ORDER BY ord DESC LIMIT ?')
      .all(input.conversationId,beforeOrd,beforeOrd,limit+1) as MessageRow[]
    return { items:rows.slice(0,limit).map(rowToMessage).reverse(),hasMore:rows.length>limit }
  }

  appendMessageText(messageId:string,delta:string):Message|null {
    const message=this.getMessage(messageId)
    if(!message) return null
    const parts=[...message.parts],last=parts[parts.length-1]
    if(last?.type==='text') parts[parts.length-1]={type:'text',text:last.text+delta}
    else parts.push({type:'text',text:delta})
    return this.updateMessage(messageId,{parts,status:'streaming'})
  }

  updateMessage(id:string,patch:{parts?:MessagePart[];status?:MessageStatus}):Message|null {
    const current=this.getMessage(id)
    if(!current) return null
    this.db.prepare('UPDATE chat_messages SET parts_json=?,status=?,updated_at=? WHERE id=?')
      .run(JSON.stringify(patch.parts??current.parts),patch.status??current.status,new Date().toISOString(),id)
    return this.getMessage(id)
  }

  createTurn(input:{conversationId:string;clientMessageId:string;parentMessageId?:string|null;text:string;context:ContextSnapshot;modelBinding:ModelBindingSnapshot;mode?:ConversationMode}):CreateTurnResult {
    const existingUser=this.getMessageByClientId(input.conversationId,input.clientMessageId)
    if(existingUser) {
      const row=this.db.prepare('SELECT * FROM chat_runs WHERE conversation_id=? AND user_message_id=?').get(input.conversationId,existingUser.id) as RunRow|undefined
      if(row) return { run:rowToRun(row),userMessage:existingUser,assistantMessage:this.getMessage(row.assistant_message_id)!,reused:true }
    }
    const now=new Date().toISOString(),userId='msg_'+this.newId(),assistantId='msg_'+this.newId(),runId='run_'+this.newId(),context={...input.context,runId}
    this.db.transaction(() => {
      const conversation=this.getConversation(input.conversationId)
      if(!conversation) throw new Error('会话不存在或已删除')
      if(input.parentMessageId) {
        const parent=this.getMessage(input.parentMessageId)
        if(!parent||parent.conversationId!==input.conversationId) throw new Error('父消息不属于当前会话')
      }
      this.db.prepare('INSERT INTO chat_messages(id,conversation_id,parent_id,client_message_id,role,parts_json,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(userId,input.conversationId,input.parentMessageId??null,input.clientMessageId,'user',JSON.stringify([{type:'text',text:input.text}]),'complete',now,now)
      this.db.prepare('INSERT INTO chat_messages(id,conversation_id,parent_id,role,parts_json,status,run_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(assistantId,input.conversationId,userId,'assistant','[]','streaming',runId,now,now)
      this.db.prepare(`INSERT INTO chat_runs(id,conversation_id,user_message_id,assistant_message_id,mode,status,model_binding_json,context_snapshot_json,created_at) VALUES(?,?,?,?,?,'queued',?,?,?)`)
        .run(runId,input.conversationId,userId,assistantId,input.mode??conversation.mode,JSON.stringify(input.modelBinding),JSON.stringify(context),now)
      this.db.prepare('UPDATE conversations SET active_leaf_id=?,updated_at=? WHERE id=?').run(assistantId,now,input.conversationId)
      if(conversation.title==='新会话')this.db.prepare('UPDATE conversations SET title=? WHERE id=?').run(input.text.replace(/\s+/g,' ').slice(0,80),input.conversationId)
    })()
    return { run:this.getRun(runId)!,userMessage:this.getMessage(userId)!,assistantMessage:this.getMessage(assistantId)!,reused:false }
  }

  getRunDetails(id:string):{run:Run;modelBinding:ModelBindingSnapshot;context:ContextSnapshot}|null {
    const row=this.db.prepare('SELECT * FROM chat_runs WHERE id=?').get(id) as RunRow|undefined
    if(!row) return null
    return {
      run:rowToRun(row),
      modelBinding:parseJson<ModelBindingSnapshot>(row.model_binding_json,{bindingId:'unknown',profileId:'unknown',provider:'unknown',model:'unknown',capabilities:[],reasoning:'default'}),
      context:parseJson<ContextSnapshot>(row.context_snapshot_json,{conversationId:row.conversation_id,runId:row.id,refs:[],budget:{totalChars:0,usedChars:0,reservedForOutput:0},diagnostics:[],createdAt:row.created_at})
    }
  }

  listUnfinishedRuns():Run[] {
    return (this.db.prepare("SELECT * FROM chat_runs WHERE status IN ('queued','preparing','generating','executing_tools','awaiting_approval') ORDER BY created_at").all() as RunRow[]).map(rowToRun)
  }

  getRun(id:string):Run|null {
    const row=this.db.prepare('SELECT * FROM chat_runs WHERE id=?').get(id) as RunRow|undefined
    return row?rowToRun(row):null
  }

  getRunForUserMessage(conversationId:string,userMessageId:string):Run|null {
    return rowToRunOrNull(this.db.prepare('SELECT * FROM chat_runs WHERE conversation_id=? AND user_message_id=?').get(conversationId,userMessageId) as RunRow|undefined)
  }

  listRuns(conversationId:string):Run[] {
    return (this.db.prepare('SELECT * FROM chat_runs WHERE conversation_id=? ORDER BY created_at DESC').all(conversationId) as RunRow[]).map(rowToRun)
  }

  updateRunStatus(id:string,status:RunStatus,error?:ToolError|null):Run|null {
    const current=this.getRun(id)
    if(!current)return null
    if(isTerminalRunStatus(current.status)) {
      if(current.status===status)return current
      throw new Error('已结束的运行不能直接变更状态')
    }
    const terminal=isTerminalRunStatus(status)?status:null
    const now=new Date().toISOString()
    this.db.prepare(`UPDATE chat_runs SET status=?,error_json=?,started_at=CASE WHEN started_at IS NULL AND ?!='queued' THEN ? ELSE started_at END,
      finished_at=CASE WHEN ? IS NULL THEN NULL ELSE ? END WHERE id=?`)
      .run(status,error?JSON.stringify(error):null,status,now,terminal,terminal?now:null,id)
    return this.getRun(id)
  }

  prepareRunResume(id:string):Run {
    const run=this.getRun(id)
    if(!run||run.status!=='interrupted')throw new Error('仅中断运行可以继续')
    const uncertain=this.listToolCalls(id).some(call=>call.status==='running'||(call.status==='failed'&&call.result_json?.includes('outcome_unknown')))
    if(uncertain)throw new Error('存在结果尚不明确的工具写入，需先核对操作记录')
    this.db.transaction(()=>{
      const message=this.getMessage(run.assistantMessageId)!
      this.updateMessage(message.id,{parts:message.parts.filter(part=>part.type!=='text'&&part.type!=='error'),status:'streaming'})
      this.db.prepare("UPDATE chat_runs SET status='queued',error_json=NULL,started_at=NULL,finished_at=NULL WHERE id=? AND status='interrupted'").run(id)
    })()
    return this.getRun(id)!
  }

  appendRunEvent(runId:string,type:RunEventType,payload:unknown,messageId?:string):RunEvent {
    return this.db.transaction(() => {
      const run=this.getRun(runId)
      if(!run) throw new Error('运行不存在')
      const seq=(this.db.prepare('SELECT COALESCE(MAX(seq)+1,1) n FROM chat_run_events WHERE run_id=?').get(runId) as {n:number}).n
      const createdAt=new Date().toISOString(),cursor=this.conversationEventCursor(run.conversationId)+1
      this.db.prepare('INSERT INTO chat_run_events(run_id,conversation_id,message_id,seq,type,payload_json,created_at,conversation_seq) VALUES(?,?,?,?,?,?,?,?)')
        .run(runId,run.conversationId,messageId??run.assistantMessageId,seq,type,JSON.stringify(payload),createdAt,cursor)
      return { runId,conversationId:run.conversationId,messageId:messageId??run.assistantMessageId,seq,cursor,type,payload,createdAt }
    })()
  }

  conversationEventCursor(conversationId:string):number {
    return (this.db.prepare('SELECT COALESCE(MAX(conversation_seq),0) cursor FROM chat_run_events WHERE conversation_id=?').get(conversationId) as {cursor:number}).cursor
  }

  listConversationEvents(conversationId:string,afterSeq=0):RunEvent[] {
    return (this.db.prepare('SELECT * FROM chat_run_events WHERE conversation_id=? AND conversation_seq>? ORDER BY conversation_seq').all(conversationId,afterSeq) as Array<{run_id:string;conversation_id:string;message_id:string;seq:number;conversation_seq:number;type:RunEventType;payload_json:string;created_at:string}>)
      .map(row=>({runId:row.run_id,conversationId:row.conversation_id,messageId:row.message_id,seq:row.seq,cursor:row.conversation_seq,type:row.type,payload:parseJson<unknown>(row.payload_json,{}),createdAt:row.created_at}))
  }

  listRunEvents(runId:string,afterSeq=0):RunEvent[] {
    return (this.db.prepare('SELECT * FROM chat_run_events WHERE run_id=? AND seq>? ORDER BY seq').all(runId,afterSeq) as Array<{run_id:string;conversation_id:string;message_id:string;seq:number;type:RunEventType;payload_json:string;created_at:string}>)
      .map(row=>({runId:row.run_id,conversationId:row.conversation_id,messageId:row.message_id,seq:row.seq,type:row.type,payload:parseJson<unknown>(row.payload_json,{}),createdAt:row.created_at}))
  }

  addSource(input:Omit<Source,'createdAt'>):Source {
    const createdAt=new Date().toISOString()
    this.db.prepare('INSERT INTO chat_sources(id,run_id,kind,workspace_id,paper_id,title,document_version,locator_json,snippet,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(input.id,input.runId,input.kind,input.workspaceId,input.paperId??null,input.title,input.documentVersion??null,JSON.stringify(input.locator),input.snippet,input.status,createdAt)
    return {...input,createdAt}
  }

  listSources(runId:string):Source[] {
    return (this.db.prepare('SELECT * FROM chat_sources WHERE run_id=? ORDER BY created_at,id').all(runId) as Array<any>).map(row=>({
      id:row.id,runId:row.run_id,kind:row.kind,workspaceId:row.workspace_id,paperId:row.paper_id??undefined,title:row.title,documentVersion:row.document_version??undefined,locator:JSON.parse(row.locator_json||'{}'),snippet:row.snippet,status:row.status,createdAt:row.created_at
    }))
  }

  addArtifact(input:Omit<ArtifactRef,'id'> & {runId:string;id:string}):ArtifactRef {
    this.db.prepare('INSERT INTO chat_artifacts(id,run_id,kind,entity_id,title,uri,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(input.id,input.runId,input.kind,input.entityId??null,input.title,input.uri??null,new Date().toISOString())
    return {id:input.id,kind:input.kind,entityId:input.entityId,title:input.title,uri:input.uri}
  }

  listArtifacts(runId:string):ArtifactRef[] {
    return (this.db.prepare('SELECT * FROM chat_artifacts WHERE run_id=? ORDER BY created_at,id').all(runId) as Array<any>).map(row=>({id:row.id,kind:row.kind,entityId:row.entity_id??undefined,title:row.title,uri:row.uri??undefined}))
  }

  createToolCall(input:{runId:string;toolCallId:string;tool:string;toolVersion?:number;args:unknown;operationId?:string}):ToolCallRecord {
    const now=new Date().toISOString(),id='tc_'+this.newId()
    this.db.prepare('INSERT INTO chat_tool_calls(id,run_id,tool_call_id,tool,tool_version,args_json,status,operation_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,? ,?,?)')
      .run(id,input.runId,input.toolCallId,input.tool,input.toolVersion??1,JSON.stringify(input.args),'pending',input.operationId,now,now)
    return this.getToolCall(input.toolCallId)!
  }

  getToolCall(toolCallId:string):ToolCallRecord|null {
    return (this.db.prepare('SELECT * FROM chat_tool_calls WHERE tool_call_id=?').get(toolCallId) as ToolCallRecord|undefined)??null
  }

  listToolCalls(runId:string):ToolCallRecord[] { return this.db.prepare('SELECT * FROM chat_tool_calls WHERE run_id=? ORDER BY rowid').all(runId) as ToolCallRecord[] }

  updateToolCall(toolCallId:string,status:ToolCallRecord['status'],result?:{summary:string;data?:unknown;sources?:Source[];artifacts?:ArtifactRef[];changes?:DomainChange[];error?:ToolError}):ToolCallRecord|null {
    const now=new Date().toISOString(),finished=['success','partial','failed','cancelled'].includes(status)?now:null
    this.db.prepare('UPDATE chat_tool_calls SET status=?,result_json=?,started_at=COALESCE(started_at,?),finished_at=?,updated_at=? WHERE tool_call_id=?')
      .run(status,result?JSON.stringify(result):null,status==='running'?now:null,finished,now,toolCallId)
    return this.getToolCall(toolCallId)
  }
}
