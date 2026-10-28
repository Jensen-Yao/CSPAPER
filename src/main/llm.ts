import { getSettings } from './db'

import { streamModel, generateModel, type PromptMessage } from './models/provider'
import type { ModelBindingSnapshot } from '../shared/models'
import { presetCaps } from '../shared/model-caps-presets'
import { explainPrompt, paperFullPrompt, ragPrompt } from './chat/prompts'
export type ChatMessage=PromptMessage
export type ThinkingLevel=string
export interface LlmEndpoint {apiBase?:string;apiKey?:string;model?:string;provider?:string;thinkingLevel?:ThinkingLevel}

function endpointSnapshot(over?:LlmEndpoint):{binding:ModelBindingSnapshot;apiKey:string} {
  const saved=getSettings(),endpoint={...saved,...over},caps=presetCaps(endpoint.model)
  return {binding:{bindingId:'compatibility',profileId:saved.modelBindingId?.split(':')[0]??'compatibility',provider:endpoint.provider,model:endpoint.model,apiBase:endpoint.apiBase.replace(/\/+$/,''),capabilities:['text','streaming'],reasoning:endpoint.thinkingLevel,reasoningLevels:caps?.reasoningLevels},apiKey:endpoint.apiKey}
}
export async function* chatStream(messages:ChatMessage[],opts:{temperature?:number;signal?:AbortSignal;endpoint?:LlmEndpoint}={}):AsyncGenerator<string> {
  const snapshot=endpointSnapshot(opts.endpoint)
  yield* streamModel(messages,snapshot.binding,{apiKey:snapshot.apiKey,signal:opts.signal,temperature:opts.temperature??0.3})
}

export function translateMessages(text: string, context: string, target: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content:
        `你是电力电子与 AI 交叉领域的资深学术翻译。将用户给出的文本翻译为${target}，要求：` +
        `1）术语准确（如 bond wire→键合线、junction temperature→结温、DC-link→母线电容、TSEP→热敏电参数）；` +
        `2）保持学术语气与原文逻辑；3）公式、变量名、引用标记保留原样；4）只输出译文。`
    },
    {
      role: 'user',
      content: `【所在页面上下文（仅供理解术语，不要翻译）】\n${context || '（无）'}\n\n【待翻译文本】\n${text}`
    }
  ]
}

export function explainMessages(text: string, context: string): ChatMessage[] {
  return explainPrompt(text,context) as ChatMessage[]
}

export async function chatOnce(messages:ChatMessage[],over?:LlmEndpoint):Promise<{latencyMs:number;reply:string}> {
  const snapshot=endpointSnapshot(over),start=Date.now()
  const reply=await generateModel(messages,snapshot.binding,{apiKey:snapshot.apiKey,temperature:0.3})
  return {reply,latencyMs:Date.now()-start}
}

export interface TestResult {
  ok: boolean
  model?: string
  latencyMs?: number
  balance?: { amount: string; currency: string } | null
  error?: string
}

// 连接测试 + 余额查询（DeepSeek 有官方余额接口，其余查不到就返回 null）。
// over = 设置页当前编辑值：先保存再测试的旧逻辑测的是旧全局配置，正确 key 也会失败
export async function testLLM(over?: LlmEndpoint): Promise<TestResult> {
  const s = getSettings()
  const apiBase = (over?.apiBase ?? s.apiBase ?? '').replace(/\/+$/, '')
  const apiKey = over?.apiKey ?? s.apiKey
  const model = over?.model ?? s.model
  const provider = over?.provider ?? s.provider
  if (!apiKey) return { ok: false, error: '未配置 API Key' }
  if (!apiBase) return { ok: false, error: '未配置 API Base' }
  if (!model) return { ok: false, error: '未配置模型名' }
  try {
    const { latencyMs } = await chatOnce([{ role: 'user', content: 'hi' }], { apiBase, apiKey, model, provider })
    let balance: { amount: string; currency: string } | null = null
    try {
      if (provider === 'deepseek') {
        const root = apiBase.replace(/\/v1\/?$/, '')
        const r = await fetch(`${root}/user/balance`, { headers: { Authorization: `Bearer ${apiKey}` } })
        if (r.ok) {
          const j = (await r.json()) as { balance_infos?: Array<{ total_balance: string; currency: string }> }
          const b = j.balance_infos?.[0]
          if (b) balance = { amount: b.total_balance, currency: b.currency }
        }
      }
    } catch {
      balance = null
    }
    return { ok: true, model, latencyMs, balance }
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 300) }
  }
}

// 整篇模式：全文按页标记进提示词，引用格式为 [页码]
export function paperFullMessages(
  question: string,
  pages: string[],
  title: string,
  budget = 120000,
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
): ChatMessage[] {
  return paperFullPrompt(question,pages,title,budget,history) as ChatMessage[]
}

export function ragMessages(
  question: string,
  sources: Array<{ label: string; text: string }>,
  paperTitle?: string,
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
): ChatMessage[] {
  return ragPrompt(question,sources,paperTitle,history) as ChatMessage[]
}

// ---------- 上游模型列表（v0.16.2）：GET /models 拉取可用模型名 ----------
export async function fetchModelList(apiBase: string, apiKey: string): Promise<string[]> {
  const base = apiBase.replace(/\/$/, '')
  const url = base.endsWith('/v1') ? `${base}/models` : `${base}/v1/models`
  const resp = await fetch(url, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    signal: AbortSignal.timeout(15000)
  })
  if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}——检查 API Base 与 Key`)
  const j = (await resp.json()) as { data?: Array<{ id?: string }> }
  const ids = (j.data ?? []).map((m) => m.id).filter((x): x is string => !!x)
  return ids.sort()
}
