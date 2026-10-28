import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, streamText } from 'ai'
import type { ModelBindingSnapshot, ModelError } from '../../shared/models'

export interface PromptMessage {role:'system'|'user'|'assistant';content:string}
export class ModelProviderError extends Error {
  constructor(public readonly code:ModelError['code'],message:string,public readonly retryable:boolean){super(message);this.name='ModelProviderError'}
}
interface TransportOptions {apiKey:string;signal?:AbortSignal;temperature?:number;fetch?:typeof fetch}
interface SdkPrompt {instructions?:string;messages:Array<{role:'user'|'assistant';content:string}>}

/** AI SDK v7 rejects system entries in `messages`; keep their content as top-level instructions. */
export function toSdkPrompt(messages:PromptMessage[]):SdkPrompt {
  const instructions=messages.filter(message=>message.role==='system').map(message=>message.content).join('\n\n')
  return {instructions:instructions||undefined,messages:messages.flatMap(message=>message.role==='system'?[]:[{role:message.role,content:message.content}])}
}

export function reasoningParameters(binding:ModelBindingSnapshot):Record<string,unknown> {
  const level=binding.reasoning
  if(level==='default')return {}
  if(binding.provider==='zhipu')return {thinking:{type:level==='off'?'disabled':'enabled'}}
  if(binding.provider==='qwen')return {enable_thinking:level!=='off',...(level==='off'?{}:{thinking_budget:level==='high'?38912:level==='medium'?8192:2048})}
  const levels=binding.reasoningLevels??[]
  if(!levels.length)return {}
  const exact=levels.find(item=>item===level||(level==='off'&&item==='none'))
  const value=exact??(level==='off'||level==='low'?levels[0]:level==='medium'?levels[Math.floor((levels.length-1)/2)]:levels.at(-1))
  return {reasoning_effort:value}
}

function sdkModel(binding:ModelBindingSnapshot,options:TransportOptions) {
  if(!binding.apiBase)throw new ModelProviderError('provider_error','未配置模型端点',false)
  const url=new URL(binding.apiBase)
  if(!options.apiKey&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new ModelProviderError('missing_key','所选模型配置尚未填写 API Key',false)
  const provider=createOpenAICompatible({name:binding.provider,baseURL:binding.apiBase,apiKey:options.apiKey||undefined,fetch:async(url,init)=>{
    if(init?.body) {
      const body=JSON.parse(String(init.body)) as Record<string,unknown>
      Object.assign(body,reasoningParameters(binding))
      init={...init,body:JSON.stringify(body)}
    }
    return (options.fetch??fetch)(url,init)
  }})
  return provider(binding.model)
}

export function normalizeProviderError(error:unknown,apiKey=''):ModelProviderError {
  if(error instanceof ModelProviderError)return error
  const detail=error as {statusCode?:number;name?:string;message?:string;cause?:{code?:string}}
  const text=String(detail.message??error).split(apiKey||'\0').join(apiKey?'[redacted]':'').slice(0,500)
  if(detail.statusCode===401||detail.statusCode===403)return new ModelProviderError('invalid_key','所选模型的 API Key 无效或无访问权限',false)
  if(detail.statusCode===429)return new ModelProviderError(/quota|balance|余额/i.test(text)?'quota':'rate_limit','模型服务额度不足或请求受限',true)
  if(detail.name==='AbortError')return new ModelProviderError('aborted','模型请求已停止',false)
  if(detail.name==='TimeoutError'||/timeout/i.test(text))return new ModelProviderError('timeout','模型响应超时',true)
  if(detail.cause?.code||/fetch failed|network|ECONN|ENOTFOUND/i.test(text))return new ModelProviderError('network','无法连接所选模型服务',true)
  return new ModelProviderError('provider_error',text||'模型服务返回了无效响应',true)
}

export async function* streamModel(messages:PromptMessage[],binding:ModelBindingSnapshot,options:TransportOptions):AsyncGenerator<string> {
  const signal=options.signal??AbortSignal.timeout(180000)
  try {
    signal.throwIfAborted()
    const prompt=toSdkPrompt(messages)
    const result=streamText({model:sdkModel(binding,options),...prompt,abortSignal:signal,maxRetries:0,temperature:options.temperature??binding.temperature,maxOutputTokens:binding.maxOutputTokens})
    let finish=false,text=false
    for await(const part of result.fullStream) {
      signal.throwIfAborted()
      if(part.type==='error')throw part.error
      if(part.type==='abort')throw new DOMException('请求已停止','AbortError')
      if(part.type==='text-delta'){text ||=!!part.text;yield part.text}
      if(part.type==='finish') {
        if(part.finishReason!=='stop')throw new ModelProviderError('provider_error',part.finishReason==='length'?'模型输出达到长度限制，回答未完成':'模型流未正常完成：'+part.finishReason,true)
        finish=true
      }
    }
    if(!finish)throw new ModelProviderError('provider_error','模型流在结束前断开',true)
    if(!text)throw new ModelProviderError('provider_error','模型没有返回回答内容',true)
  } catch(error) {throw normalizeProviderError(error,options.apiKey)}
}

export async function generateModel(messages:PromptMessage[],binding:ModelBindingSnapshot,options:TransportOptions):Promise<string> {
  try {
    const prompt=toSdkPrompt(messages)
    const result=await generateText({model:sdkModel(binding,options),...prompt,abortSignal:options.signal??AbortSignal.timeout(120000),maxRetries:0,temperature:options.temperature??binding.temperature,maxOutputTokens:binding.maxOutputTokens})
    if(!result.text)throw new ModelProviderError('provider_error','模型没有返回回答内容',true)
    return result.text
  } catch(error) {throw normalizeProviderError(error,options.apiKey)}
}
