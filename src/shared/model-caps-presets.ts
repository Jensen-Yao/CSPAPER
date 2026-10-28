// 模型能力预置库（v0.16.3）：主流模型的已知规格——推理等级档位、上下文、最大输出、
// 输入类型、能力标记。用户配置供应商后按模型名前缀匹配自动带出（可覆盖）。
// 等级词是各模型 API 的真实参数值（reasoning_effort / thinking.type / thinking_budget）。
import type { ModelCaps } from './settings-models'

interface Preset {
  /** 模型名前缀匹配（小写 startsWith） */
  match: string
  caps: Omit<ModelCaps, 'reasoningLevels'> & { reasoningLevels: string[] }
}

// 各家"等级"语义不同：OpenAI 系 reasoning_effort 用 none/low/medium/high（gpt-5.1 加 none，
// o/gpt-5-pro 用 medium/high/max）；GLM-4.7 是 low/high/max；DeepSeek 靠模型选择（reasoner=思考）；
// Gemini/Qwen 是连续 thinking budget——归一为档位词，注入层再换算成各家参数。
export const MODEL_CAPS_PRESETS: Preset[] = [
  // ---- Agnes 免费中转（用户当前端点，2026-10 实测）----
  { match: 'agnes-3.0', caps: { reasoningLevels: ['low', 'medium', 'high'], context: 1000000, maxOutput: 65536, inputs: ['text', 'image', 'video', 'pdf'], caps: ['json', 'system'] } },
  { match: 'agnes-2.5-pro', caps: { reasoningLevels: ['low', 'medium', 'high'], context: 1048576, maxOutput: 65536, inputs: ['text', 'image', 'video', 'pdf'], caps: ['json', 'system'] } },
  { match: 'agnes-2.5-flash', caps: { reasoningLevels: ['low', 'medium', 'high'], context: 1048576, maxOutput: 65536, inputs: ['text', 'image', 'video', 'pdf'], caps: ['json', 'system'] } },
  // ---- OpenAI GPT-6（2026-09/10，Astra/Sol/Luna；reasoning effort low→max）----
  { match: 'gpt-6-astra', caps: { reasoningLevels: ['minimal', 'low', 'medium', 'high', 'xhigh'], context: 1000000, maxOutput: 128000, inputs: ['text', 'image'], caps: ['json', 'system'] } },
  { match: 'gpt-6-sol', caps: { reasoningLevels: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'], context: 400000, maxOutput: 128000, inputs: ['text', 'image'], caps: ['json', 'system'] } },
  { match: 'gpt-6-luna', caps: { reasoningLevels: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'], context: 400000, maxOutput: 65536, inputs: ['text', 'image'], caps: ['json', 'system'] } },
  { match: 'gpt-6', caps: { reasoningLevels: ['minimal', 'low', 'medium', 'high', 'xhigh'], context: 1000000, maxOutput: 128000, inputs: ['text', 'image'], caps: ['json', 'system'] } },
  // ---- GPT-5.6（Sol/Terra/Luna；Responses API 六档）----
  { match: 'gpt-5.6', caps: { reasoningLevels: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], context: 400000, maxOutput: 128000, inputs: ['text', 'image'], caps: ['json', 'system'] } },
  // ---- OpenAI 上一代（保留兜底）----
  { match: 'gpt-5.1', caps: { reasoningLevels: ['none', 'low', 'medium', 'high'], context: 400000, maxOutput: 128000, inputs: ['text', 'image'], caps: ['json', 'system'] } },
  { match: 'gpt-5', caps: { reasoningLevels: ['low', 'medium', 'high'], context: 400000, maxOutput: 128000, inputs: ['text', 'image'], caps: ['json', 'system'] } },
  { match: 'gpt-4.1', caps: { reasoningLevels: [], context: 1000000, maxOutput: 32768, inputs: ['text', 'image'], caps: ['json', 'system'] } },
  { match: 'gpt-4o', caps: { reasoningLevels: [], context: 128000, maxOutput: 16384, inputs: ['text', 'image'], caps: ['json', 'system'] } },
  { match: 'o4-mini', caps: { reasoningLevels: ['low', 'medium', 'high'], context: 200000, maxOutput: 100000, inputs: ['text', 'image'], caps: ['json'] } },
  { match: 'o3', caps: { reasoningLevels: ['low', 'medium', 'high'], context: 200000, maxOutput: 100000, inputs: ['text', 'image'], caps: ['json'] } },
  // ---- Anthropic（2026-02 Opus 4.6：1M beta + adaptive thinking / max effort）----
  { match: 'claude-opus-4-6', caps: { reasoningLevels: ['low', 'medium', 'high', 'max'], context: 1000000, maxOutput: 128000, inputs: ['text', 'image', 'pdf'], caps: ['json', 'system'] } },
  { match: 'claude-opus-4', caps: { reasoningLevels: ['low', 'medium', 'high'], context: 200000, maxOutput: 64000, inputs: ['text', 'image', 'pdf'], caps: ['json', 'system'] } },
  { match: 'claude-sonnet-4', caps: { reasoningLevels: ['low', 'medium', 'high'], context: 200000, maxOutput: 64000, inputs: ['text', 'image', 'pdf'], caps: ['json', 'system'] } },
  { match: 'claude-haiku-4', caps: { reasoningLevels: ['low', 'medium', 'high'], context: 200000, maxOutput: 64000, inputs: ['text', 'image', 'pdf'], caps: ['json', 'system'] } },
  { match: 'claude-3', caps: { reasoningLevels: [], context: 200000, maxOutput: 8192, inputs: ['text', 'image'], caps: ['json', 'system'] } },
  // ---- 智谱 GLM-5.x（2026：5.2 1M ctx 多档 thinking；5/5.1 200k）----
  { match: 'glm-5.2', caps: { reasoningLevels: ['low', 'medium', 'high', 'max'], context: 1000000, maxOutput: 131072, inputs: ['text', 'image'], caps: ['json', 'websearch', 'system'] } },
  { match: 'glm-5.1', caps: { reasoningLevels: ['low', 'high', 'max'], context: 200000, maxOutput: 131072, inputs: ['text', 'image'], caps: ['json', 'websearch', 'system'] } },
  { match: 'glm-5', caps: { reasoningLevels: ['low', 'high', 'max'], context: 200000, maxOutput: 131072, inputs: ['text', 'image'], caps: ['json', 'websearch', 'system'] } },
  { match: 'glm-4.7', caps: { reasoningLevels: ['low', 'high', 'max'], context: 200000, maxOutput: 128000, inputs: ['text', 'image'], caps: ['json', 'websearch', 'system'] } },
  { match: 'glm-4.6', caps: { reasoningLevels: ['low', 'high', 'max'], context: 200000, maxOutput: 128000, inputs: ['text', 'image'], caps: ['json', 'websearch', 'system'] } },
  { match: 'glm-4.5', caps: { reasoningLevels: ['low', 'high', 'max'], context: 128000, maxOutput: 98304, inputs: ['text'], caps: ['json', 'system'] } },
  { match: 'glm-4v', caps: { reasoningLevels: [], context: 128000, maxOutput: 8192, inputs: ['text', 'image'], caps: [] } },
  { match: 'glm-4-flash', caps: { reasoningLevels: [], context: 128000, maxOutput: 4096, inputs: ['text'], caps: ['json'] } },
  // ---- DeepSeek V4（2026 Q2 起；V4 Pro 旗舰）----
  { match: 'deepseek-v4', caps: { reasoningLevels: ['medium', 'high', 'max'], context: 256000, maxOutput: 131072, inputs: ['text'], caps: ['json'] } },
  { match: 'deepseek-reasoner', caps: { reasoningLevels: ['medium', 'max'], context: 128000, maxOutput: 64000, inputs: ['text'], caps: ['json'] } },
  { match: 'deepseek-chat', caps: { reasoningLevels: [], context: 128000, maxOutput: 8192, inputs: ['text'], caps: ['json'] } },
  // ---- 通义 3.5/3.8（2026：Plus 1M ctx）----
  { match: 'qwen3.7', caps: { reasoningLevels: ['low', 'medium', 'high'], context: 1000000, maxOutput: 65536, inputs: ['text', 'image'], caps: ['json', 'system'] } },
  { match: 'qwen-max', caps: { reasoningLevels: ['low', 'medium', 'high'], context: 131072, maxOutput: 32768, inputs: ['text', 'image'], caps: ['json', 'system'] } },
  { match: 'qwen-plus', caps: { reasoningLevels: ['low', 'medium', 'high'], context: 131072, maxOutput: 32768, inputs: ['text', 'image'], caps: ['json', 'system'] } },
  { match: 'qwen3.5', caps: { reasoningLevels: ['low', 'medium', 'high'], context: 1000000, maxOutput: 65536, inputs: ['text', 'image'], caps: ['json', 'system'] } },
  { match: 'qwen3-', caps: { reasoningLevels: ['low', 'medium', 'high'], context: 131072, maxOutput: 32768, inputs: ['text'], caps: ['json'] } },
  { match: 'qwen-turbo', caps: { reasoningLevels: ['low', 'medium', 'high'], context: 1000000, maxOutput: 16384, inputs: ['text'], caps: ['json'] } },
  // ---- Kimi K2.5/K3（2026：K2.5 128k；K2 Thinking 长程工具链）----
  { match: 'kimi-k3', caps: { reasoningLevels: ['low', 'medium', 'high'], context: 256000, maxOutput: 65536, inputs: ['text'], caps: ['json', 'system'] } },
  { match: 'kimi-k2.5', caps: { reasoningLevels: ['low', 'medium', 'high'], context: 128000, maxOutput: 32768, inputs: ['text'], caps: ['json', 'system'] } },
  { match: 'kimi-k2', caps: { reasoningLevels: ['low', 'medium', 'high'], context: 256000, maxOutput: 8192, inputs: ['text'], caps: ['json', 'system'] } },
  { match: 'moonshot-v1', caps: { reasoningLevels: [], context: 128000, maxOutput: 8192, inputs: ['text'], caps: ['json'] } },
  // ---- Gemini 3.x（2025-11 起：3 Pro 1M；3.1 Pro reasoning-first 自适应思考）----
  { match: 'gemini-3.1-pro', caps: { reasoningLevels: ['low', 'medium', 'high'], context: 1048576, maxOutput: 131072, inputs: ['text', 'image', 'video', 'pdf'], caps: ['json', 'system'] } },
  { match: 'gemini-3', caps: { reasoningLevels: ['low', 'medium', 'high'], context: 1048576, maxOutput: 65536, inputs: ['text', 'image', 'video', 'pdf'], caps: ['json', 'system'] } },
  { match: 'gemini-2.5-flash', caps: { reasoningLevels: ['low', 'medium', 'high'], context: 1048576, maxOutput: 65536, inputs: ['text', 'image', 'video', 'pdf'], caps: ['json', 'system'] } },
  { match: 'gemini-2.5-pro', caps: { reasoningLevels: ['low', 'medium', 'high'], context: 1048576, maxOutput: 65536, inputs: ['text', 'image', 'video', 'pdf'], caps: ['json', 'system'] } },
  { match: 'gemini-2.0', caps: { reasoningLevels: [], context: 1048576, maxOutput: 8192, inputs: ['text', 'image'], caps: ['json'] } },
  // ---- Grok ----
  { match: 'grok-4', caps: { reasoningLevels: ['low', 'high'], context: 256000, maxOutput: 32768, inputs: ['text', 'image'], caps: ['json'] } },
  { match: 'grok-3', caps: { reasoningLevels: ['low', 'high'], context: 131072, maxOutput: 16384, inputs: ['text'], caps: ['json'] } },
  // ---- MiniMax / 阶跃 ----
  { match: 'minimax', caps: { reasoningLevels: [], context: 1000000, maxOutput: 32768, inputs: ['text'], caps: ['json'] } },
  { match: 'step-2', caps: { reasoningLevels: [], context: 128000, maxOutput: 8192, inputs: ['text'], caps: ['json'] } }
]

/** 模型名 → 预置能力（最长前缀命中；无命中 undefined） */
export function presetCaps(model: string): ModelCaps | undefined {
  const m = model.toLowerCase()
  let best: Preset | undefined
  for (const p of MODEL_CAPS_PRESETS) {
    if (m.startsWith(p.match) && (!best || p.match.length > best.match.length)) best = p
  }
  return best ? { ...best.caps, reasoningLevels: [...best.caps.reasoningLevels] } : undefined
}
