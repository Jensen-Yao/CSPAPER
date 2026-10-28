import { ipcMain, type WebContents } from 'electron'
import type { Conversation, Run } from '../../shared/chat'
import { getDb, getSettings } from '../db'
import { ChatRepository } from '../chat/repository'
import { ChatRuntime } from '../chat/runtime'
import { ChatEventBus } from '../chat/events'
import { SystemChatProvider } from '../chat/provider'
import { buildContextSnapshot } from '../chat/context'
import { retrieveSources } from '../chat/retrieval'
import { ToolRegistry } from '../tools/registry'
import { registerLibraryTools } from '../tools/library'
import { registerResearchTools } from '../tools/research'
import { registerMcpTools, registerMcpToolList } from '../tools/mcp'
import { registerCollectionTools } from '../tools/collection'
import { collectionPapers } from '../collection-service'
import { callMcpTool, listMcpTools } from '../mcp'
import { snapshotModelBinding } from '../model-config'
import { idSchema, createConversationRequestSchema, listConversationsRequestSchema, loadMessagesRequestSchema, submitTurnRequestSchema, cancelRunRequestSchema, approveToolRequestSchema, subscribeRequestSchema, retryTurnRequestSchema, editAndResubmitRequestSchema } from '../../shared/chat-ipc'
import type { IpcCtx } from './context'

let repository:ChatRepository
let runtime:ChatRuntime
let eventBus:ChatEventBus
let toolRegistry:ToolRegistry
const eventSubscribers=new Set<WebContents>()
export function getChatServices():{repository:ChatRepository;bus:ChatEventBus;runtime:ChatRuntime}|null {return repository&&eventBus&&runtime?{repository,bus:eventBus,runtime}:null}

function activeWorkspaceId():string {
  return repository.ensureWorkspace(getSettings().libraryPath).id
}

function parse<T>(schema:{parse(input:unknown):T},input:unknown):T {
  return schema.parse(typeof input==='object'&&input!==null?input:{})
}
function ownedConversation(id:unknown):Conversation {
  const conversation=repository.getConversation(idSchema.parse(id))
  if(!conversation||conversation.workspaceId!==activeWorkspaceId())throw new Error('会话不属于当前工作区')
  return conversation
}
function ownedRun(id:unknown):Run {
  const run=repository.getRun(idSchema.parse(id))
  if(!run||repository.getConversation(run.conversationId)?.workspaceId!==activeWorkspaceId())throw new Error('运行不属于当前工作区')
  return run
}

export function registerChatIpc(ctx:IpcCtx):void {
  repository=new ChatRepository(getDb())
  const bus=new ChatEventBus(repository);eventBus=bus
  toolRegistry=new ToolRegistry();registerLibraryTools(toolRegistry);registerResearchTools(toolRegistry);registerCollectionTools(toolRegistry);registerMcpTools(toolRegistry)
  runtime=new ChatRuntime(repository,new SystemChatProvider(),bus,2,async request=>{
    const details=repository.getRunDetails(request.runId)
    let paperId:number|undefined,category:string|undefined;let paperIds:number[]|undefined
    for(const ref of details?.context.refs??[]) {
      if(ref.kind==='paper'||ref.kind==='selection')paperId=ref.paperId
      if(ref.kind==='paper')paperIds=[...(paperIds??[]),ref.paperId]
      if(ref.kind==='collection') {
        const ids=collectionPapers(ref.collectionId)
        paperIds=[...(paperIds??[]),...ids]
        paperId=undefined
      }
      if(ref.kind==='category')category=ref.name
    }
    if(paperIds?.length===0)paperIds=undefined
    return retrieveSources({...request,paperId:paperIds&&paperIds.length?undefined:paperId,paperIds,category,refs:details?.context.refs??[]})
  },toolRegistry,'auto')
  runtime.recover()
  bus.subscribe({listener:event=>{for(const subscriber of eventSubscribers)if(!subscriber.isDestroyed())subscriber.send('chat:event',event)}})
  ipcMain.handle('chat:event-subscribe',event=>{
    eventSubscribers.add(event.sender)
    event.sender.once('destroyed',()=>eventSubscribers.delete(event.sender))
    return true
  })
  ipcMain.handle('chat:event-unsubscribe',event=>eventSubscribers.delete(event.sender))

  ipcMain.handle('chat:workspace',()=>({workspaceId:activeWorkspaceId()}))
  ipcMain.handle('chat:conversations-create',(_e,input:unknown)=>repository.createConversation(parse(createConversationRequestSchema,typeof input==='object'&&input!==null?{...input,workspaceId:activeWorkspaceId()}:{workspaceId:activeWorkspaceId()})))
  ipcMain.handle('chat:conversations-list',(_e,input:unknown)=>repository.listConversations(parse(listConversationsRequestSchema,typeof input==='object'&&input!==null?{...input,workspaceId:activeWorkspaceId()}:{workspaceId:activeWorkspaceId()})))
  ipcMain.handle('chat:conversation-get',(_e,id:string)=>ownedConversation(id))
  ipcMain.handle('chat:conversation-rename',(_e,id:string,title:string)=>repository.renameConversation(ownedConversation(id).id,String(title)))
  ipcMain.handle('chat:conversation-archive',(_e,id:string,archived:boolean)=>repository.archiveConversation(ownedConversation(id).id,Boolean(archived)))
  ipcMain.handle('chat:events',(_e,input:unknown)=>{const request=parse(subscribeRequestSchema,input);return request.conversationId?(ownedConversation(request.conversationId),repository.listConversationEvents(request.conversationId,request.afterSeq??0)):[]})
  ipcMain.handle('chat:messages',(_e,input:unknown)=>{const request=parse(loadMessagesRequestSchema,input);ownedConversation(request.conversationId);const result=repository.loadMessages(request);return {...result,eventCursor:repository.conversationEventCursor(request.conversationId)}})
  ipcMain.handle('chat:snapshot',(_e,input:unknown)=>{
    const request=parse(loadMessagesRequestSchema,input)
    return getDb().transaction(()=>{
      const conversation=repository.getConversation(request.conversationId)
      if(!conversation||conversation.workspaceId!==activeWorkspaceId())throw new Error('会话不属于当前工作区')
      const messages=repository.loadMessages(request)
      const runIds=[...new Set(messages.items.flatMap(message=>message.runId?[message.runId]:[]))]
      return {...messages,conversation,eventCursor:repository.conversationEventCursor(conversation.id),runs:runIds.map(id=>({
        run:repository.getRun(id),events:repository.listRunEvents(id),sources:repository.listSources(id),artifacts:repository.listArtifacts(id),context:repository.getRunDetails(id)?.context
      }))}
    })()
  })
  ipcMain.handle('chat:submit',(_e,input:unknown)=>{
    const request=parse(submitTurnRequestSchema,input)
    const conversation=repository.getConversation(request.conversationId)
    if(!conversation||conversation.workspaceId!==activeWorkspaceId()) throw new Error('会话不属于当前工作区')
    const context=buildContextSnapshot({conversationId:request.conversationId,runId:'pending',workspaceId:conversation.workspaceId,refs:request.context,permission:request.permission,promptKind:request.promptKind})
    const modelBinding=snapshotModelBinding(getSettings(),request.modelBindingId,request.reasoning,request.mode)
    return runtime.submitTurn({conversationId:request.conversationId,clientMessageId:request.clientMessageId,parentMessageId:request.parentMessageId??null,text:request.text,context,modelBinding,mode:request.mode})
  })
  ipcMain.handle('chat:approve-tool',(_e,input:unknown)=>{const request=parse(approveToolRequestSchema,input),call=repository.getToolCall(request.toolCallId);if(!call)throw new Error('工具调用不存在');ownedRun(call.run_id);return runtime.approveTool(request)})
  ipcMain.handle('chat:resume',(_e,input:unknown)=>{
    const request=parse(cancelRunRequestSchema,input),run=repository.getRun(request.runId)
    if(!run||repository.getConversation(run.conversationId)?.workspaceId!==activeWorkspaceId())throw new Error('运行不属于当前工作区')
    return runtime.resumeRun(run.id)
  })
  ipcMain.handle('chat:cancel',(_e,input:unknown)=>{
    const request=parse(cancelRunRequestSchema,input);ownedRun(request.runId)
    return runtime.cancelRun(request.runId,request.reason)
  })
  ipcMain.handle('chat:run',(_e,runId:string)=>{const run=ownedRun(runId);return {run,events:repository.listRunEvents(run.id),sources:repository.listSources(run.id),artifacts:repository.listArtifacts(run.id),context:repository.getRunDetails(run.id)?.context}})
  ipcMain.handle('chat:retry',(_e,input:unknown)=>{
    const request=parse(retryTurnRequestSchema,input),details=repository.getRunDetails(request.runId)
    if(!details||repository.getConversation(details.run.conversationId)?.workspaceId!==activeWorkspaceId())throw new Error('运行不属于当前工作区')
    const context=request.reuseContext?details.context:buildContextSnapshot({conversationId:details.run.conversationId,runId:'pending',workspaceId:activeWorkspaceId(),refs:details.context.refs,permission:details.context.permission})
    return runtime.retryTurn(request.runId,request.reuseContext,context)
  })
  ipcMain.handle('chat:edit-and-resubmit',(_e,input:unknown)=>{
    const request=parse(editAndResubmitRequestSchema,input),conversation=repository.getConversation(request.conversationId)
    if(!conversation||conversation.workspaceId!==activeWorkspaceId())throw new Error('会话不属于当前工作区')
    const message=repository.getMessage(request.messageId)
    if(!message||message.conversationId!==conversation.id||message.role!=='user')throw new Error('只能编辑用户消息')
    const originalRun=repository.getRunForUserMessage(conversation.id,message.id),original=originalRun?repository.getRunDetails(originalRun.id):null
    const context=buildContextSnapshot({conversationId:conversation.id,runId:'pending',workspaceId:conversation.workspaceId,refs:request.context,permission:original?.context.permission})
    return runtime.editAndResubmit({conversationId:conversation.id,messageId:message.id,text:request.text,context,modelBinding:original?.modelBinding})
  })
}

export function refreshChatMcpTools():void {
  if(!toolRegistry)return
  for(const tool of listMcpTools())if(!toolRegistry.get(tool.fullName))registerMcpToolList(toolRegistry,[tool],(fullName,args,signal)=>callMcpTool(fullName,args,signal))
}
