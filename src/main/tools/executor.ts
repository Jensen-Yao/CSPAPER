import crypto from 'node:crypto'
import type { ToolDefinition, ToolResult } from '../../shared/tools'
import { ChatEventBus } from '../chat/events'
import type { ChatRepository } from '../chat/repository'
import { ToolRegistry, type ToolContext } from './registry'
import { authorize, type PermissionMode } from './policy'

export interface ExecuteToolInput { runId:string;workspaceId:string;toolCallId?:string;tool:string;args:unknown;signal:AbortSignal;repository:ChatRepository;events?:ChatEventBus;permission?:PermissionMode;approvalGranted?:boolean }
export type ExecuteToolOutput =
  | {status:'success';result:ToolResult;toolCallId:string}
  | {status:'approval_required';toolCallId:string;reason:string;impact:string}
  | {status:'failed';toolCallId:string;error:NonNullable<ToolResult['error']>}

/** One execution and persistence owner. Every model-visible tool call becomes an auditable record. */
export class ToolExecutor {
  constructor(private readonly registry:ToolRegistry) {}

  execute(input:ExecuteToolInput):Promise<ExecuteToolOutput> {
    return this.executeImpl(input)
  }

  private async executeImpl(input:ExecuteToolInput):Promise<ExecuteToolOutput> {
    const registered=this.registry.require(input.tool)
    const toolCallId=input.toolCallId??('call_'+crypto.randomUUID())
    const decision=authorize(registered.definition,input.permission??'auto')
    const existing=input.toolCallId?input.repository.getToolCall(input.toolCallId):null
    const record=existing??input.repository.createToolCall({runId:input.runId,toolCallId,tool:registered.definition.name,toolVersion:registered.definition.version,args:input.args,operationId:'op_'+toolCallId})
    if(existing&&(existing.run_id!==input.runId||existing.tool!==input.tool||existing.args_json!==JSON.stringify(input.args)))throw new Error('工具调用身份或参数与持久记录不一致')
    if(existing?.result_json&&['success','partial'].includes(existing.status))return {status:'success',result:JSON.parse(existing.result_json) as ToolResult,toolCallId}
    if(existing&&['running','failed','cancelled'].includes(existing.status))return {status:'failed',toolCallId,error:{code:'tool_not_replayable',message:'工具调用已结束或结果尚待恢复，请勿重复执行',retryable:false}}
    if(input.permission==='readonly'&&registered.definition.risk!=='read') {
      const error={code:'readonly',message:'当前会话为只读模式，不能执行写操作',retryable:false}
      input.repository.updateToolCall(toolCallId,'failed',{summary:error.message,error})
      return {status:'failed',toolCallId,error}
    }
    if(decision.status==='approval_required'&&!(input.approvalGranted&&existing?.status==='awaiting_approval')) {
      input.repository.updateToolCall(record.tool_call_id,'awaiting_approval')
      return {status:'approval_required',toolCallId:record.tool_call_id,reason:decision.request.reason,impact:decision.request.impact}
    }
    const started=Date.now()
    let timeoutHandle:ReturnType<typeof setTimeout>|undefined
    let timeoutSignal:AbortSignal|undefined
    const context:ToolContext={runId:input.runId,workspaceId:input.workspaceId,signal:input.signal,repository:input.repository,operationId:record.operation_id??undefined}
    input.repository.updateToolCall(record.tool_call_id,'running')
    try {
      const parsed=registered.schema.parse(input.args)
      if(input.signal.aborted) throw new Error('cancelled')
      input.events?.appendAndPublish(input.runId,'tool.started',{toolCallId,tool:input.tool,args:parsed})
      const timeoutMs=registered.definition.timeoutMs??30000
      timeoutSignal=AbortSignal.any([input.signal,AbortSignal.timeout(timeoutMs)])
      context.signal=timeoutSignal
      const execution=registered.execute(context,parsed);execution.catch(()=>{})
      const timedExecution=Promise.race([
        execution,
        new Promise<never>((_resolve,reject)=>{
          timeoutHandle=setTimeout(()=>reject(new DOMException(`工具执行超过 ${timeoutMs}ms`, 'TimeoutError')),timeoutMs)
        })
      ])
      const raw=await timedExecution
      if(timeoutHandle)clearTimeout(timeoutHandle)
      if(timeoutSignal?.aborted) throw new Error('cancelled')
      const result:ToolResult={...raw,durationMs:Date.now()-started}
      const persistedStatus=result.status==='partial'?'partial':result.status==='failed'?'failed':result.status==='cancelled'?'cancelled':'success'
      input.repository.updateToolCall(record.tool_call_id,persistedStatus,result)
      input.events?.appendAndPublish(input.runId,persistedStatus==='failed'||persistedStatus==='cancelled'?'tool.failed':'tool.completed',{toolCallId,tool:input.tool,status:persistedStatus,summary:result.summary,artifacts:result.artifacts,changes:result.changes,error:result.error})
      return {status:'success',result,toolCallId:record.tool_call_id}
    } catch(error) {
      if(timeoutHandle)clearTimeout(timeoutHandle)
      const aborted=input.signal.aborted||/cancel/i.test(String(error))
      const result:ToolResult={
        status:aborted?'cancelled':'failed',summary:aborted?'工具已取消':'工具执行失败',sources:[],artifacts:[],changes:[],
        error:{code:(error as {name?:string}).name==='TimeoutError'||!!timeoutSignal?.aborted?'tool_timeout':aborted?'cancelled':'tool_failed',message:String(error).slice(0,500),retryable:true},durationMs:Date.now()-started
      }
      input.repository.updateToolCall(record.tool_call_id,aborted?'cancelled':'failed',result)
      input.events?.appendAndPublish(input.runId,'tool.failed',{toolCallId,tool:input.tool,error:result.error})
      return {status:'failed',toolCallId:record.tool_call_id,error:result.error!}
    }
  }
}
