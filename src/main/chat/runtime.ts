import crypto from 'node:crypto'
import { isTerminalRunStatus, type ConversationMode, type Run, type RunEvent } from '../../shared/chat'
import type { ContextSnapshot } from '../../shared/context'
import type { ModelBindingSnapshot } from '../../shared/models'
import { ChatEventBus } from './events'
import type { ChatProvider } from './provider'
import { ChatRepository, type CreateTurnResult } from './repository'
import { recoverInterruptedRuns } from './recovery'
import { ASK_READ_TOOLS, askPrompt, plannerContinuationPrompt, plannerPrompt, translationPrompt, type SimplePromptMessage } from './prompts'
import { validateCitations } from './citations'
import { actPrompt } from './prompts'
import { extractPlanSteps, parseModelJsonObject, validatePlan, type PlanStepRecord, type PlanToolPolicy } from './planning'
import { ToolExecutor } from '../tools/executor'
import { getSettings } from '../db'
import type { ToolRegistry } from '../tools/registry'
import type { PermissionMode } from '../tools/policy'
import { undoToolCall } from '../tools/undo'
import type { ToolResult } from '../../shared/tools'
import type { Source } from '../../shared/sources'

export interface RuntimeSubmitInput {
  conversationId:string
  clientMessageId:string
  parentMessageId?:string|null
  text:string
  context:ContextSnapshot
  modelBinding:ModelBindingSnapshot
  mode?:ConversationMode
}

export interface RuntimeSubmitResult extends CreateTurnResult { queued:boolean }

interface ActiveRun { controller:AbortController;promise:Promise<void> }
type ChatModel=Parameters<ChatProvider['stream']>[1]['model']
interface Observation {step:PlanStepRecord;result?:ToolResult;error?:string}
interface ActState {steps:PlanStepRecord[];observations:Observation[];revision:number;partial:boolean}
interface StepInput {runId:string;question:string;workspaceId:string;model:ChatModel;controller:AbortController;executor:ToolExecutor;policies:PlanToolPolicy[];permission:PermissionMode;approvedCallId?:string;menu:string;contextSnapshot:ContextSnapshot;revised:boolean}

/** Stable identity of a plan step: the same tool with the same arguments is never executed twice in one run. */
function stepKey(step:PlanStepRecord):string {
  const sort=(value:unknown):unknown=>Array.isArray(value)?value.map(sort):value&&typeof value==='object'?Object.fromEntries(Object.entries(value as Record<string,unknown>).sort(([x],[y])=>x.localeCompare(y)).map(([k,v])=>[k,sort(v)])):value
  return step.tool+'|'+JSON.stringify(sort(step.args))
}
/** The ask mode requests a tool by answering with a single JSON object; anything else is the final answer. */
export function parseToolRequest(raw:string):{tool:string;args:Record<string,unknown>}|null {
  const text=raw.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/i,'').trim()
  if(!text.startsWith('{'))return null
  try {
    const parsed=JSON.parse(text) as Record<string,unknown>
    if(parsed.tool_calls!==undefined) {
      const first=(parsed.tool_calls as Array<Record<string,unknown>>)[0]
      return typeof first?.tool==='string'?{tool:first.tool.trim(),args:first.args&&typeof first.args==='object'?first.args as Record<string,unknown>:{}}:null
    }
    if(typeof parsed.tool!=='string'||!parsed.tool.trim())return null
    if(Object.keys(parsed).some(key=>!['tool','args'].includes(key)))return null
    return {tool:parsed.tool.trim(),args:parsed.args&&typeof parsed.args==='object'?parsed.args as Record<string,unknown>:{}}
  } catch { return null }
}
function truncateForModel(value:unknown,budget:number):unknown {
  const text=typeof value==='string'?value:JSON.stringify(value)
  if(text.length<=budget)return value
  return text.slice(0,budget)+'…（已截断，共 '+text.length+' 字符）'
}

/** Single execution owner for all chat surfaces. UI may subscribe, but never infer run state from the last message. */
export class ChatRuntime {
  private readonly active=new Map<string,ActiveRun>()
  private readonly queue:string[]=[]
  private readonly waiters=new Set<()=>void>()
  private readonly resumptions=new Map<string,{plan?:PlanStepRecord[];approvedCallId?:string;revision?:number}>()
  /** Tools the user allowed for the rest of a run (“本任务内允许”). */
  private readonly runAllow=new Map<string,Set<string>>()
  /** Translation channel used when no model is configured (binding `free:translation`). */
  freeTranslation?:(text:string,signal:AbortSignal)=>Promise<string>

  constructor(private readonly repository:ChatRepository,private readonly provider:ChatProvider,private readonly events:ChatEventBus,private readonly maxConcurrent=2,private readonly retrieve?:(input:{query:string;runId:string;workspaceId:string;refs:ContextSnapshot['refs'];signal:AbortSignal})=>Promise<Source[]>,private readonly toolRegistry?:ToolRegistry,private readonly permission:'auto'|'confirm'|'readonly'='auto',private readonly limits:{timeoutMs?:number;actTimeoutMs?:number;maxSteps?:number;maxContinuations?:number}={}) {}

  submitTurn(input:RuntimeSubmitInput):RuntimeSubmitResult {
    const turn=this.repository.createTurn(input)
    if(turn.reused) return {...turn,queued:this.active.has(turn.run.id)}
    this.events.appendAndPublish(turn.run.id,'run.status_changed',{status:'queued'})
    this.enqueue(turn.run.id)
    return {...turn,queued:true}
  }
  toolPolicies():Array<{name:string;version:number;risk:PlanStepRecord['risk'];maxCallsPerRun?:number}> {
    return this.toolRegistry?.list().map(tool=>({name:tool.name,version:tool.version,risk:tool.risk}))??[]
  }

  submitPlannedTurn(input:RuntimeSubmitInput,plan:Array<PlanStepRecord & {id?:string}>):RuntimeSubmitResult {
    if(!this.toolRegistry)throw new Error('当前运行时未注册执行工具')
    const policies=this.toolPolicies()
    const normalized=plan.map((step,index)=>({...step,id:step.id||`step-${index+1}`,risk:step.risk??policies.find(policy=>policy.name===step.tool)?.risk}))
    const validated=validatePlan(normalized,policies)
    if(!validated.ok)throw new Error('计划校验失败：'+validated.errors.join('；'))
    const turn=this.repository.createTurn(input)
    if(turn.reused)return {...turn,queued:this.active.has(turn.run.id)}
    this.events.appendAndPublish(turn.run.id,'plan.created',{steps:validated.steps})
    this.resumptions.set(turn.run.id,{plan:validated.steps})
    this.events.appendAndPublish(turn.run.id,'run.status_changed',{status:'queued'})
    this.enqueue(turn.run.id)
    return {...turn,queued:true}
  }


  retryTurn(runId:string,reuseContext=true,contextOverride?:ContextSnapshot):RuntimeSubmitResult {
    const details=this.repository.getRunDetails(runId)
    if(!details) throw new Error('运行不存在')
    if(!isTerminalRunStatus(details.run.status)) throw new Error('运行尚未结束，不能重试')
    const user=this.repository.getMessage(details.run.userMessageId)
    if(!user) throw new Error('原始问题不存在')
    const text=user.parts.filter(part=>part.type==='text').map(part=>part.type==='text'?part.text:'').join('\n')
    const context=contextOverride??details.context
    if(reuseContext&&!contextOverride&&context.conversationId!==details.run.conversationId)throw new Error('原上下文不属于当前会话')
    return this.submitTurn({
      conversationId:details.run.conversationId,
      clientMessageId:'retry_'+details.run.id+'_'+crypto.randomUUID(),
      parentMessageId:user.parentId,
      text,
      context,
      modelBinding:details.modelBinding,
      mode:details.run.mode
    })
  }

  editAndResubmit(input:{conversationId:string;messageId:string;text:string;context:ContextSnapshot;modelBinding?:ModelBindingSnapshot}):RuntimeSubmitResult {
    const message=this.repository.getMessage(input.messageId)
    if(!message||message.conversationId!==input.conversationId||message.role!=='user')throw new Error('只能编辑用户消息')
    const original=this.repository.getRunForUserMessage(input.conversationId,message.id)
    const details=original?this.repository.getRunDetails(original.id):null
    if(input.context.conversationId!==input.conversationId)throw new Error('编辑上下文不属于当前会话')
    return this.submitTurn({
      conversationId:input.conversationId,
      clientMessageId:'edit_'+message.id+'_'+crypto.randomUUID(),
      parentMessageId:message.parentId,
      text:input.text,
      context:input.context,
      modelBinding:input.modelBinding??details?.modelBinding??{bindingId:'unknown',profileId:'unknown',provider:'unknown',model:'unknown',capabilities:[],reasoning:'default'},
      mode:details?.run.mode??'ask'
    })
  }

  /** Stop everything that is queued or running (window closed / app quitting). */
  cancelAll(reason='窗口已关闭'):void {
    for(const runId of [...this.queue]){this.queue.splice(this.queue.indexOf(runId),1);this.resumptions.delete(runId);this.finishCancelled(runId,reason)}
    for(const [runId,active] of this.active)active.controller.abort(new Error(reason))
  }

  cancelRun(runId:string,reason='用户停止'):boolean {
    if(this.queue.includes(runId)) {
      this.queue.splice(this.queue.indexOf(runId),1)
      this.resumptions.delete(runId)
      this.finishCancelled(runId,reason)
      return true
    }
    const active=this.active.get(runId)
    if(!active) {
      const run=this.repository.getRun(runId)
      if(run?.status!=='awaiting_approval')return false
      this.finishCancelled(runId,reason)
      this.pump()
      return true
    }
    active.controller.abort(new Error(reason))
    return true
  }

  async idle():Promise<void> {
    while(this.active.size||this.queue.length) await new Promise<void>(resolve=>this.waiters.add(resolve))
  }

  recover():number { return recoverInterruptedRuns(this.repository).length }

  resumeRun(runId:string):boolean {
    if(this.active.has(runId)||this.queue.includes(runId))return false
    const run=this.repository.prepareRunResume(runId)
    const planEvent=this.repository.listRunEvents(runId).filter(event=>event.type==='plan.created'||event.type==='plan.updated').at(-1)
    const planPayload=planEvent?.payload as {steps?:PlanStepRecord[];revision?:number}|undefined
    const plan=planPayload?.steps
    this.resumptions.set(runId,{plan,revision:planPayload?.revision??0})
    this.events.appendAndPublish(runId,'message.reset',{reason:'resume'},run.assistantMessageId)
    this.events.appendAndPublish(runId,'run.resumed',{status:'queued',reusesCommittedTools:true})
    this.enqueue(runId)
    return true
  }

  private enqueue(runId:string):void {
    this.queue.push(runId)
    this.pump()
  }

  private timeoutMsFor(runId:string):number {
    const run=this.repository.getRun(runId)
    if(run?.mode!=='act') return this.limits.timeoutMs ?? 180000
    if(this.limits.actTimeoutMs != null) return this.limits.actTimeoutMs
    const minutes=Number(getSettings().agentTimeoutMinutes ?? 10)
    return Math.max(1, Math.min(60, Number.isFinite(minutes) ? minutes : 10)) * 60_000
  }

  private pump():void {
    while(this.queue.length&&this.active.size<this.maxConcurrent) {
      const occupied=new Set([...this.active.keys()].map(id=>this.repository.getRun(id)?.conversationId))
      for(const run of this.repository.listUnfinishedRuns())if(run.status==='awaiting_approval')occupied.add(run.conversationId)
      const index=this.queue.findIndex(id=>!occupied.has(this.repository.getRun(id)?.conversationId))
      if(index<0)break
      const runId=this.queue.splice(index,1)[0]
      const controller=new AbortController()
      const timer=setTimeout(() => controller.abort(new DOMException('运行超过时间限制', 'TimeoutError')), this.timeoutMsFor(runId))
      const promise=Promise.resolve().then(()=>this.execute(runId,controller)).finally(() => {
        clearTimeout(timer)
        this.active.delete(runId)
        this.pump()
        if(!this.active.size&&!this.queue.length) { for(const resolve of [...this.waiters])resolve();this.waiters.clear() }
      })
      this.active.set(runId,{controller,promise})
    }
  }

  private async collect(messages:SimplePromptMessage[],model:Parameters<ChatProvider['stream']>[1]['model'],signal:AbortSignal):Promise<string> {
    let output=''
    for await(const delta of this.provider.stream(messages,{model,signal}))output+=delta
    return output
  }

  private toolMenu():string { return this.toolRegistry?.menu()??'' }

  /** Read-only tools available to the ask mode, with their descriptions. */
  private askToolMenu():string {
    if(!this.toolRegistry)return ''
    return this.toolRegistry.list().filter(tool=>ASK_READ_TOOLS.includes(tool.name)).map(tool=>'- '+tool.name+' — '+tool.description+' 参数：'+JSON.stringify(tool.inputSchema)).join('\n')
  }

  /** Ask mode: the model may request read-only tools (one JSON line) before answering; results are fed back as messages. */
  private async streamAskWithTools(runId:string,question:string,userMessageId:string,context:ContextSnapshot,sources:Source[],model:ChatModel,controller:AbortController,workspaceId:string,textSink:(delta:string)=>void):Promise<string> {
    const base=this.promptWithHistory(question,userMessageId,context,sources,this.askToolMenu())
    const system=base[0],conversation:SimplePromptMessage[]=base.slice(1)
    const allowed=new Set(ASK_READ_TOOLS),used=new Set<string>()
    const executor=new ToolExecutor(this.toolRegistry!)
    const assistantId=this.repository.getRun(runId)!.assistantMessageId
    let announced=0
    const syncSources=():void=>{
      const latest=this.repository.listSources(runId)
      const current=this.repository.getMessage(assistantId)
      if(latest.length)this.repository.updateMessage(assistantId,{parts:[...(current?.parts.filter(part=>part.type!=='sources')??[]),{type:'sources',sourceIds:latest.map(source=>source.id)}]})
      if(latest.length>announced){this.events.appendAndPublish(runId,'source.added',{sources:latest.slice(announced).map(source=>source.id)});announced=latest.length}
    }
    for(let round=0;round<4;round++) {
      const raw=await this.collect([system,...conversation],model,controller.signal)
      const request=parseToolRequest(raw)
      if(!request) {
        textSink(raw)
        return raw
      }
      if(!allowed.has(request.tool)||used.has(request.tool+JSON.stringify(request.args))) {
        conversation.push({role:'assistant',content:raw},{role:'user',content:'工具 '+request.tool+' 不可用或已调用过；请直接回答，或改用其他只读工具。'})
        continue
      }
      used.add(request.tool+JSON.stringify(request.args))
      const output=await executor.execute({runId,workspaceId,toolCallId:'call_'+runId+'_ask_'+round,tool:request.tool,args:request.args,signal:controller.signal,repository:this.repository,events:this.events,permission:'readonly'})
      const observation=output.status==='success'?JSON.stringify({summary:output.result.summary,data:truncateForModel(output.result.data,8000)}):JSON.stringify({error:output.status==='failed'?output.error.message:'该工具需要确认，问答模式只允许只读工具'})
      syncSources()
      conversation.push({role:'assistant',content:raw},{role:'user',content:'【工具结果 · '+request.tool+'】\n'+observation+'\n\n请基于以上结果回答原问题（引用时使用【检索来源】编号）；如需继续调用工具，仍只输出一行 JSON。'})
    }
    const final=await this.collect([system,...conversation,{role:'user',content:'工具调用次数已用完，请直接根据已有信息回答。'}],model,controller.signal)
    textSink(final)
    return final
  }

  private async executeAct(runId:string,question:string,contextSnapshot:ContextSnapshot,workspaceId:string,model:ChatModel,controller:AbortController,existingPlan?:PlanStepRecord[],startIndex=0,permissionOverride?:'auto'|'confirm'|'readonly',approvedCallId?:string,existingRevision=0):Promise<{text:string;partial:boolean}|{paused:true}> {
    if(!this.toolRegistry)throw new Error('当前运行时未注册执行工具')
    const executor=new ToolExecutor(this.toolRegistry),policies=this.toolRegistry.list().map(tool=>({name:tool.name,version:tool.version,risk:tool.risk}))
    const menu=this.toolRegistry.menu()
    let steps=existingPlan
    if(!steps){
      this.repository.updateRunStatus(runId,'preparing')
      const prompt=plannerPrompt(question,JSON.stringify(contextSnapshot.refs),menu,JSON.stringify(policies))
      if(contextSnapshot.researchGoal)prompt[prompt.length-1].content+='\n长期研究背景（仅供本轮规划参考，不代表已完成或授权额外操作）：'+contextSnapshot.researchGoal
      if(contextSnapshot.skills?.length)prompt[prompt.length-1].content+='\n用户选择的技能说明（遵循适用内容；工具名称若已过时，以可用工具列表为准）：\n'+contextSnapshot.skills.map(skill=>'【'+skill.name+'】\n'+skill.body).join('\n\n')
      const history=this.historyFor(this.repository.getRun(runId)!.userMessageId)
      prompt.splice(1,0,...history)
      const raw=await this.collect(prompt,model,controller.signal)
      let parsed:unknown
      try{parsed=parseModelJsonObject(raw)}catch(error){throw new Error(String(error)+'；模型原始输出开头：'+raw.slice(0,160).replace(/\s+/g,' '))}
      const parsedSteps=extractPlanSteps(parsed)
      if(!parsedSteps)throw new Error('计划 JSON 缺少 steps 数组；顶层字段：'+Object.keys(parsed as Record<string,unknown>).join(',')+'；原始输出开头：'+raw.slice(0,160).replace(/\s+/g,' '))
      const plan=validatePlan(parsedSteps,policies)
      if(!plan.ok)throw new Error('计划校验失败：'+plan.errors.join('；'))
      steps=plan.steps
      this.events.appendAndPublish(runId,'plan.created',{steps:plan.steps})
    }
    if(contextSnapshot.promptKind==='plan') {
      const lines=steps.map((step,index)=>index+1+'. '+step.purpose+'（'+step.tool+'；'+(step.risk==='read'?'读取':step.risk==='reversible_write'?'可撤销写入':step.risk==='batch_write'?'批量写入':step.risk==='external_effect'?'外部操作':'高风险操作')+'）')
      return {text:'## 任务计划\n\n'+(lines.join('\n')||'没有可执行的工具步骤。')+'\n\n当前仅生成计划，未执行以上工具。你可以提出修改，或明确要求继续执行。',partial:false}
    }
    this.repository.updateRunStatus(runId,'executing_tools')
    const state:ActState={steps,observations:[],revision:existingRevision,partial:false}
    const input:StepInput={runId,question,workspaceId,model,controller,executor,policies,permission:permissionOverride??this.permission,approvedCallId,menu,contextSnapshot,revised:false}
    const paused=await this.runSteps(input,state,startIndex,state.steps.length,true)
    if(paused)return {paused:true}
    // Dynamic continuation: after the plan completes, the planner may append steps based on what the tools returned.
    const executed=new Set<string>()
    const remember=():void=>{for(const item of state.observations)executed.add(stepKey(item.step))}
    remember()
    const maxSteps=this.limits.maxSteps??30,maxRounds=this.limits.maxContinuations??6
    let rounds=0
    while(rounds<maxRounds&&state.observations.length<maxSteps&&!controller.signal.aborted) {
      const remainingSteps=maxSteps-state.observations.length
      const prompt=plannerContinuationPrompt(question,JSON.stringify(state.observations.map(item=>({step:{tool:item.step.tool,args:item.step.args,purpose:item.step.purpose},summary:item.result?.summary,error:item.error}))),menu,{steps:remainingSteps,rounds:maxRounds-rounds})
      if(contextSnapshot.skills?.length)prompt[prompt.length-1].content+='\n所选技能说明：'+JSON.stringify(contextSnapshot.skills.map(skill=>skill.name))
      const raw=await this.collect(prompt,model,controller.signal)
      let parsedSteps:unknown[]|null=null
      try{parsedSteps=extractPlanSteps(parseModelJsonObject(raw))}catch{parsedSteps=null}
      if(!parsedSteps||!parsedSteps.length)break
      const validated=validatePlan(parsedSteps,policies)
      if(!validated.ok)break
      const fresh=validated.steps.filter(step=>!executed.has(stepKey(step)))
      if(!fresh.length)break
      const from=state.steps.length
      state.steps=[...state.steps,...fresh]
      this.events.appendAndPublish(runId,'plan.updated',{steps:state.steps,revision:state.revision,replacesIndex:from,reason:'根据执行结果追加步骤'})
      const againPaused=await this.runSteps(input,state,from,state.steps.length,false)
      if(againPaused)return {paused:true}
      remember()
      rounds++
    }
    const finalRaw=await this.collect([
      {role:'system',content:'你是科研执行代理。基于工具结果输出最终报告；明确已完成、真实产物、失败步骤和后续建议。不得虚构执行成功。'},
      {role:'user',content:JSON.stringify({goal:question,skills:contextSnapshot.skills,tools:this.toolRegistry.list(),observations:state.observations})}
    ],model,controller.signal)
    return {text:finalRaw,partial:state.partial}
  }

  /** Execute steps from `from` to the end. Approval pauses return {paused:true}; a tool failure triggers one plan revision when allowRevision is set. */
  private async runSteps(input:StepInput,state:ActState,from:number,_to:number,allowRevision:boolean):Promise<{paused:true}|null> {
    const {runId,controller}=input
    const startRevision=state.revision
    for(let index=from;index<state.steps.length;) {
      const step=state.steps[index]
      controller.signal.throwIfAborted()
      const toolCallId='call_'+runId+'_'+(state.revision?'r'+state.revision+'_':'')+index
      const output=await input.executor.execute({runId,workspaceId:input.workspaceId,toolCallId,tool:step.tool,args:step.args,signal:controller.signal,repository:this.repository,events:this.events,permission:input.permission,approvalGranted:input.approvedCallId===toolCallId,allowTools:[...(this.runAllow.get(runId)??[])]})
      if(output.status==='approval_required'){
        this.repository.updateRunStatus(runId,'awaiting_approval')
        this.events.appendAndPublish(runId,'approval.required',{toolCallId:output.toolCallId,stepId:step.id,stepIndex:index,tool:step.tool,args:step.args,reason:output.reason,impact:output.impact})
        return {paused:true}
      }
      if(output.status==='failed'){
        state.partial=true;state.observations.push({step,error:output.error?.message??'工具失败'})
        if(allowRevision&&!input.revised){
          input.revised=true
          this.repository.updateRunStatus(runId,'preparing')
          const revisionPrompt=plannerPrompt(input.question,JSON.stringify(state.steps.slice(index)),JSON.stringify(state.observations),JSON.stringify(this.toolRegistry!.list()),true)
          if(input.contextSnapshot.skills?.length)revisionPrompt[revisionPrompt.length-1].content+='\n所选技能说明：'+JSON.stringify(input.contextSnapshot.skills)
          const revisionRaw=await this.collect(revisionPrompt,input.model,controller.signal)
          let revisionParsed:unknown
          try{revisionParsed=parseModelJsonObject(revisionRaw)}catch(error){throw new Error('工具失败后的修订计划不是有效 JSON：'+String(error))}
          const revised=validatePlan((revisionParsed as {steps?:unknown}).steps,input.policies)
          if(!revised.ok)throw new Error('修订计划校验失败：'+revised.errors.join('；'))
          state.steps=[...state.steps.slice(0,index),...revised.steps]
          state.revision++
          this.events.appendAndPublish(runId,'plan.updated',{steps:state.steps,replacesIndex:index,revision:state.revision,reason:'工具失败后自动调整一次'})
          this.repository.updateRunStatus(runId,'executing_tools')
          continue
        }
        index++
        continue
      }
      if(output.result.status==='success') { if(state.revision!==startRevision)state.partial=false } else state.partial=true
      state.observations.push({step,result:output.result})
      index++
    }
    return null
  }

  /** Undo the reversible writes of a finished tool call. */
  undoTool(toolCallId:string):{undone:string[];skipped:string[]} {
    const call=this.repository.getToolCall(toolCallId)
    if(!call)throw new Error('工具调用不存在')
    const workspaceId=this.repository.getConversation(this.repository.getRun(call.run_id)?.conversationId??'')?.workspaceId??''
    return undoToolCall(this.repository,toolCallId,workspaceId)
  }

  async approveTool(input:{toolCallId:string;approved:boolean;revision?:unknown;allowForRun?:boolean}):Promise<boolean> {
    const call=this.repository.getToolCall(input.toolCallId)
    if(!call||call.status!=='awaiting_approval')return false
    if(input.approved&&input.allowForRun) {
      const run=this.repository.getRun(call.run_id)
      if(run) { const set=this.runAllow.get(run.id)??new Set<string>();set.add(call.tool);this.runAllow.set(run.id,set) }
    }
    const run=this.repository.getRun(call.run_id)
    if(!run||run.status!=='awaiting_approval')return false
    const settling=this.active.get(run.id)
    if(settling)await settling.promise
    if(this.repository.getRun(run.id)?.status!=='awaiting_approval'||this.repository.getToolCall(call.tool_call_id)?.status!=='awaiting_approval')return false
    if(input.revision!==undefined)throw new Error('请提交明确的计划修订后重新确认，不能在批准工具时替换参数')
    this.events.appendAndPublish(run.id,'approval.resolved',{toolCallId:input.toolCallId,approved:input.approved})
    if(!input.approved){
      this.repository.updateToolCall(input.toolCallId,'cancelled',{summary:'用户拒绝执行'})
      this.repository.updateRunStatus(run.id,'cancelled',{code:'approval_denied',message:'用户拒绝执行工具',retryable:false})
      this.repository.updateMessage(run.assistantMessageId,{status:'cancelled'})
      this.events.appendAndPublish(run.id,'run.completed',{status:'cancelled'})
      this.pump()
      return true
    }
    const planEvent=this.repository.listRunEvents(run.id).filter(event=>event.type==='plan.created'||event.type==='plan.updated').at(-1)
    const planPayload=planEvent?.payload as {steps?:PlanStepRecord[];revision?:number}|undefined
    const plan=planPayload?.steps??[]
    const revision=planPayload?.revision??0
    const index=plan.findIndex((_step,stepIndex)=>`call_${run.id}_${revision?`r${revision}_`:''}${stepIndex}`===call.tool_call_id)
    if(index<0)return false
    this.resumptions.set(run.id,{plan,approvedCallId:call.tool_call_id,revision})
    this.repository.updateRunStatus(run.id,'queued')
    this.events.appendAndPublish(run.id,'run.status_changed',{status:'queued'})
    this.enqueue(run.id)
    return true
  }

  /** A turn without context objects inherits the nearest ancestor run's context, so a conversation keeps its paper across surfaces. */
  private resolveContext(runId:string,details:{run:Run;context:ContextSnapshot}):ContextSnapshot {
    const context=details.context
    if(context.refs.length||context.inheritContext===false)return context
    const user=this.repository.getMessage(details.run.userMessageId)
    if(!user)return context
    const ancestors=this.repository.messageAncestors(user.id,40)
    for(let index=ancestors.length-1;index>=0;index--) {
      const message=ancestors[index]
      if(message.id===user.id||!message.runId||message.runId===runId)continue
      const previous=this.repository.getRunDetails(message.runId)?.context
      if(previous?.refs.length) {
        const inherited={...context,refs:previous.refs,diagnostics:[...context.diagnostics,{level:'info' as const,code:'context_inherited',message:'已继承本会话上一轮的上下文对象（'+previous.refs.length+' 项）'}]}
        this.repository.updateRunContext(runId,inherited)
        return inherited
      }
    }
    return context
  }

  private async execute(runId:string,controller:AbortController):Promise<void> {
    const details=this.repository.getRunDetails(runId)
    if(!details) return
    const user=this.repository.getMessage(details.run.userMessageId)
    if(!user) return
    const resumption=this.resumptions.get(runId)
    this.resumptions.delete(runId)
    this.repository.updateRunStatus(runId,'generating')
    this.events.appendAndPublish(runId,'run.status_changed',{status:'generating'})
    try {
      const question=user.parts.filter(part=>part.type==='text').map(part=>part.type==='text'?part.text:'').join('\n')
      const workspaceId=this.repository.getConversation(details.run.conversationId)?.workspaceId??''
      const context=this.resolveContext(runId,details)
      const savedSources=this.repository.listSources(runId)
      let sources=savedSources.length?savedSources:this.retrieve?await this.retrieve({query:question,runId,workspaceId,refs:context.refs,signal:controller.signal}):[]
      if(!savedSources.length)for(const source of sources) this.repository.addSource(source)
      if(sources.length)this.repository.updateMessage(details.run.assistantMessageId,{parts:[{type:'sources',sourceIds:sources.map(source=>source.id)}]})
      if(sources.length)this.events.appendAndPublish(runId,'source.added',{sources:sources.map(source=>source.id)})
      const askMenu=details.run.mode==='ask'&&context.promptKind!=='translation'?this.askToolMenu():''
      if(details.run.mode==='ask'&&context.promptKind!=='translation'&&!askMenu&&!sources.length&&!context.refs.length) {
        this.repository.updateMessage(details.run.assistantMessageId,{parts:[{type:'error',code:'retrieval_empty',message:'未检索到可引用来源。可更换更具体的关键词、在上下文选择器添加论文或集合；若索引未完成，请先重建索引。'}]})
      }
      let text=''
      if(details.run.mode==='ask'&&context.promptKind==='translation'&&details.modelBinding.bindingId==='free:translation'&&this.freeTranslation) {
        const answer=await this.freeTranslation(question,controller.signal)
        text+=answer
        this.repository.appendMessageText(details.run.assistantMessageId,answer)
        this.events.appendAndPublish(runId,'message.delta',{delta:answer},details.run.assistantMessageId)
        this.repository.updateMessage(details.run.assistantMessageId,{status:'complete'})
        this.repository.updateRunStatus(runId,'completed')
        this.events.appendAndPublish(runId,'message.completed',{length:text.length,sources:0},details.run.assistantMessageId)
        this.events.appendAndPublish(runId,'run.completed',{status:'completed'})
        return
      }
      const actResult=details.run.mode==='act'
        ?await this.executeAct(runId,question,context,workspaceId,details.modelBinding,controller,resumption?.plan,0,context.permission??this.permission,resumption?.approvedCallId,resumption?.revision??0)
        :undefined
      if(actResult&&'paused'in actResult)return
      const deltas=actResult&&'text'in actResult?[actResult.text]:undefined
      const sink=(delta:string):void=>{text+=delta;this.repository.appendMessageText(details.run.assistantMessageId,delta);this.events.appendAndPublish(runId,'message.delta',{delta},details.run.assistantMessageId)}
      if(deltas) {
        for(const delta of deltas)sink(delta)
      } else if(askMenu) {
        await this.streamAskWithTools(runId,question,details.run.userMessageId,context,sources,details.modelBinding,controller,workspaceId,sink)
      } else for await(const delta of this.provider.stream(this.promptWithHistory(question,details.run.userMessageId,context,sources),{model:details.modelBinding,signal:controller.signal,temperature:details.modelBinding.temperature})) {
        if(controller.signal.aborted) throw new Error('运行已取消')
        text+=delta
        this.repository.appendMessageText(details.run.assistantMessageId,delta)
        this.events.appendAndPublish(runId,'message.delta',{delta},details.run.assistantMessageId)
      }
      // Act tools can persist additional exact sources while the run executes. Re-read
      // them before citation validation so a final report can cite tool-read pages.
      if(details.run.mode==='act')sources=this.repository.listSources(runId)
      const citation=validateCitations(text,sources)
      const currentMessage=this.repository.getMessage(details.run.assistantMessageId)
      const partial=citation.missing.length>0||citation.unknown.length>0||!!(actResult&&'partial'in actResult&&actResult.partial)
      this.repository.updateMessage(details.run.assistantMessageId,{parts:[
        ...(currentMessage?.parts.filter(part=>part.type!=='sources')??[]),
        ...(sources.length?[{type:'sources' as const,sourceIds:sources.map(source=>source.id)}]:[]),
        ...(citationWarningText(citation)?[{type:'error' as const,code:'citation_mismatch',message:citationWarningText(citation)!}]:[])
      ],status:partial?'partial':'complete'})
      this.repository.updateRunStatus(runId,partial?'partial':'completed')
      this.events.appendAndPublish(runId,'message.completed',{length:text.length,sources:sources.length},details.run.assistantMessageId)
      this.events.appendAndPublish(runId,'run.completed',{status:this.repository.getRun(runId)!.status})
    } catch(error) {
      if(controller.signal.aborted && controller.signal.reason?.name!=='TimeoutError') this.finishCancelled(runId,String(controller.signal.reason??'用户停止'),details.run.assistantMessageId)
      else {
        const toolError={code:controller.signal.reason?.name==='TimeoutError'?'run_timeout':'provider_error',message:String(controller.signal.reason??error).slice(0,500),retryable:true}
        this.repository.updateMessage(details.run.assistantMessageId,{status:'failed'})
        this.repository.updateRunStatus(runId,'failed',toolError)
        this.events.appendAndPublish(runId,'error',toolError,details.run.assistantMessageId)
        this.events.appendAndPublish(runId,'run.completed',{status:'failed'})
      }
    }
  }

  private promptWithHistory(question:string,userMessageId:string,context:ContextSnapshot,sources:Source[],toolMenu?:string):Parameters<ChatProvider['stream']>[0] {
    const prompt=context.promptKind==='translation'?translationPrompt(question):askPrompt(question,context,sources,toolMenu)
    return [prompt[0],...this.historyFor(userMessageId),...prompt.slice(1)]
  }

  private historyFor(userMessageId:string):SimplePromptMessage[] {
    const history=this.repository.messageAncestors(userMessageId,40).filter(message=>message.id!==userMessageId&&(message.role==='user'||message.role==='assistant'))
    let chars=0
    const budgeted=history.slice().reverse().flatMap(message=>{
      const content=message.parts.filter(part=>part.type==='text').map(part=>part.type==='text'?part.text:'').join('\n')
      if(!content||chars+content.length>24000)return []
      chars+=content.length;return [{role:message.role as 'user'|'assistant',content}]
    }).reverse()
    return budgeted
  }

  private finishCancelled(runId:string,reason:string,assistantMessageId?:string):void {
    const details=this.repository.getRunDetails(runId)
    if(details&&isTerminalRunStatus(details.run.status))return
    const messageId=assistantMessageId??details?.run.assistantMessageId
    if(!messageId) return
    this.repository.updateMessage(messageId,{status:'cancelled'})
    this.repository.updateRunStatus(runId,'cancelled',{code:'cancelled',message:reason,retryable:false})
    this.events.appendAndPublish(runId,'run.completed',{status:'cancelled',reason},messageId)
  }
}

function citationWarningText(result:{missing:number[];unknown:number[]}):string|null {
  if(!result.missing.length&&!result.unknown.length)return null
  const parts:string[]=[]
  if(result.missing.length)parts.push(`来源已变化：${result.missing.join(',')}`)
  if(result.unknown.length)parts.push(`无效引用：${result.unknown.join(',')}`)
  return parts.join('；')
}
