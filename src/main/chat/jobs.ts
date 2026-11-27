// 后台模型任务（v0.23 · E1）：精读 / 对比 / 综述 / 题录 / 参考文献 / 兼容代理规划全部作为“有记录的运行”执行——
// 统一模型绑定、统一取消与超时、事件落库；会话以 entry='work' + mode='ask' 记录（与 Work 任务的 act 会话区分），不进入对话列表。
import crypto from 'node:crypto'
import type { ModelBindingSnapshot } from '../../shared/models'
import type { PromptMessage } from '../models/provider'
import { isTerminalRunStatus } from '../../shared/chat'
import type { ChatProvider } from './provider'
import { SystemChatProvider } from './provider'
import { ChatEventBus } from './events'
import { ChatRepository } from './repository'
import { buildContextSnapshot } from './context'
import { getDb, getSettings } from '../db'
import { snapshotModelBinding } from '../model-config'

export type ModelJobKind='deep_reading'|'comparison_cells'|'synthesis'|'metadata'|'references'|'agent_plan'|'field'|'report'
export interface ModelJobOptions {
  kind:ModelJobKind
  title:string
  signal?:AbortSignal
  timeoutMs?:number
  temperature?:number
  modelBinding?:ModelBindingSnapshot
  workspaceId?:string
}

/** Binding used by background jobs: the Paper chat binding, else the first configured profile. */
export function jobModelBinding(settings=getSettings()):ModelBindingSnapshot {
  const profiles=settings.profiles??[]
  const candidates=[settings.modelBindingId,...(profiles.length&&profiles[0].models.length?[`${profiles[0].id}:${profiles[0].models[0]}`]:[])]
  for(const id of candidates) {
    if(!id)continue
    try{return snapshotModelBinding(settings,id,'default','ask')}catch{ /* try the next candidate */ }
  }
  throw new Error('尚未配置可用的模型服务：请到「设置 → 模型服务」选择配置与模型')
}

interface JobServices { repository:ChatRepository;provider:ChatProvider;bus:ChatEventBus }
let shared:JobServices|null=null
/** Share the chat event bus so job progress reaches the same subscribers as chat runs. */
export function configureModelJobs(repository:ChatRepository,provider:ChatProvider,bus:ChatEventBus):void { shared={repository,provider,bus} }
function services():JobServices {
  if(shared)return shared
  const repository=new ChatRepository(getDb())
  shared={repository,provider:new SystemChatProvider(),bus:new ChatEventBus(repository)}
  return shared
}

/** Stream a prompt as a recorded run. Aborts (caller signal or timeout) end in a cancelled / failed terminal state. */
export async function* streamModelJob(messages:PromptMessage[],options:ModelJobOptions):AsyncGenerator<string> {
  const {repository,provider,bus}=services()
  const settings=getSettings()
  const modelBinding=options.modelBinding??jobModelBinding(settings)
  const workspaceId=options.workspaceId??repository.ensureWorkspace(settings.libraryPath).id
  const conversation=repository.createConversation({workspaceId,title:'后台：'+options.title.slice(0,176),mode:'ask',entry:'work'})
  const text=[...messages].reverse().find(message=>message.role==='user')?.content??options.title
  const context=buildContextSnapshot({conversationId:conversation.id,runId:'pending',workspaceId,refs:[],promptKind:'ask',permission:'readonly',inheritContext:false})
  const turn=repository.createTurn({conversationId:conversation.id,clientMessageId:'job_'+crypto.randomUUID(),text:text.slice(0,100000),context,modelBinding,mode:'ask'})
  const runId=turn.run.id
  repository.updateRunStatus(runId,'generating')
  bus.appendAndPublish(runId,'run.status_changed',{status:'generating'})
  const controller=new AbortController()
  const timer=setTimeout(()=>controller.abort(new DOMException('后台模型任务超过时间限制','TimeoutError')),options.timeoutMs??300000)
  const onAbort=():void=>controller.abort(options.signal?.reason)
  if(options.signal?.aborted)onAbort()
  else options.signal?.addEventListener('abort',onAbort,{once:true})
  try {
    for await(const delta of provider.stream(messages,{model:modelBinding,signal:controller.signal,temperature:options.temperature})) {
      repository.appendMessageText(turn.assistantMessage.id,delta)
      bus.appendAndPublish(runId,'message.delta',{delta},turn.assistantMessage.id)
      yield delta
    }
    repository.updateMessage(turn.assistantMessage.id,{status:'complete'})
    repository.updateRunStatus(runId,'completed')
    bus.appendAndPublish(runId,'run.completed',{status:'completed'})
  } catch(error) {
    const timedOut=controller.signal.reason?.name==='TimeoutError'
    const cancelled=controller.signal.aborted&&!timedOut
    repository.updateMessage(turn.assistantMessage.id,{status:cancelled?'cancelled':'failed'})
    const failure={code:cancelled?'cancelled':timedOut?'run_timeout':'provider_error',message:String(controller.signal.reason??error).slice(0,500),retryable:!cancelled}
    repository.updateRunStatus(runId,cancelled?'cancelled':'failed',failure)
    bus.appendAndPublish(runId,'error',failure,turn.assistantMessage.id)
    bus.appendAndPublish(runId,'run.completed',{status:cancelled?'cancelled':'failed'})
    throw error
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort',onAbort)
    // A consumer that stopped early (e.g. a parse failure) must not leave a run stuck in `generating`.
    const status=repository.getRun(runId)?.status
    if(status&&!isTerminalRunStatus(status)) {
      repository.updateRunStatus(runId,'cancelled',{code:'cancelled',message:'后台任务被调用方终止',retryable:false})
      bus.appendAndPublish(runId,'run.completed',{status:'cancelled'})
    }
  }
}

export async function modelJobText(messages:PromptMessage[],options:ModelJobOptions):Promise<string> {
  let out=''
  for await(const delta of streamModelJob(messages,options))out+=delta
  return out
}
