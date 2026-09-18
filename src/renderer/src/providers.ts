// 服务商预设库：一键添加供应商配置（自动填好 API Base 与推荐模型，粘贴 Key 即用）
// 全部为 OpenAI 兼容端点（含 Google / Ollama / LM Studio 的官方兼容层）
export interface ProviderPreset {
  id: string
  name: string
  base: string
  models: string[]
  logo: string // 品牌首字（彩色头像用）
  color: string // 品牌色
  note?: string
}

export const PROVIDER_GROUPS: Array<{ title: string; items: ProviderPreset[] }> = [
  {
    title: '国内主流',
    items: [
      { id: 'zhipu', name: '智谱 GLM', base: 'https://open.bigmodel.cn/api/paas/v4', models: ['glm-4.6', 'glm-4.5-air', 'glm-4.5'], logo: '智', color: '#3b5bfd' },
      { id: 'deepseek', name: 'DeepSeek', base: 'https://api.deepseek.com/v1', models: ['deepseek-chat', 'deepseek-reasoner'], logo: 'DS', color: '#4d6bfe' },
      { id: 'qwen', name: '通义千问', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen-plus', 'qwen-turbo', 'qwen-max'], logo: '通', color: '#615ced' },
      { id: 'moonshot', name: 'Kimi 月之暗面', base: 'https://api.moonshot.cn/v1', models: ['kimi-k2-0711-preview', 'moonshot-v1-8k'], logo: 'K', color: '#0d0d12' },
      { id: 'siliconflow', name: '硅基流动', base: 'https://api.siliconflow.cn/v1', models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-7B-Instruct'], logo: '硅', color: '#7c3aed' },
      { id: 'volces', name: '火山方舟 · 豆包', base: 'https://ark.cn-beijing.volces.com/api/v3', models: ['doubao-seed-1-6-250615'], logo: '豆', color: '#db2b2b', note: '模型填控制台的推理接入点 ID' },
      { id: 'stepfun', name: '阶跃星辰', base: 'https://api.stepfun.com/v1', models: ['step-2-16k'], logo: '阶', color: '#0057ff' },
      { id: 'minimax', name: 'MiniMax', base: 'https://api.minimax.chat/v1', models: ['abab6.5s-chat'], logo: 'M', color: '#f23f5d' }
    ]
  },
  {
    title: '国际主流',
    items: [
      { id: 'openai', name: 'OpenAI', base: 'https://api.openai.com/v1', models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'], logo: 'O', color: '#10a37f' },
      { id: 'gemini', name: 'Google Gemini', base: 'https://generativelanguage.googleapis.com/v1beta/openai', models: ['gemini-2.5-flash', 'gemini-2.5-pro'], logo: 'G', color: '#1a73e8', note: '官方 OpenAI 兼容层' },
      { id: 'xai', name: 'xAI Grok', base: 'https://api.x.ai/v1', models: ['grok-3-mini', 'grok-3'], logo: '𝕏', color: '#111111' },
      { id: 'openrouter', name: 'OpenRouter', base: 'https://openrouter.ai/api/v1', models: ['openai/gpt-4o-mini', 'anthropic/claude-sonnet-4', 'google/gemini-2.5-flash'], logo: 'OR', color: '#6b7280', note: '一个 Key 用几百个模型，含 Claude' },
      { id: 'groq', name: 'Groq', base: 'https://api.groq.com/openai/v1', models: ['llama-3.3-70b-versatile'], logo: 'Gq', color: '#f55036' },
      { id: 'mistral', name: 'Mistral', base: 'https://api.mistral.ai/v1', models: ['mistral-large-latest'], logo: 'Mi', color: '#fa520f' },
      { id: 'fireworks', name: 'Fireworks', base: 'https://api.fireworks.ai/inference/v1', models: ['accounts/fireworks/models/llama-v3p3-70b-instruct'], logo: 'Fw', color: '#8b5cf6' },
      { id: 'together', name: 'Together', base: 'https://api.together.xyz/v1', models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo'], logo: 'Tg', color: '#0f6fff' }
    ]
  },
  {
    title: '本地部署（免费离线）',
    items: [
      { id: 'ollama', name: 'Ollama', base: 'http://127.0.0.1:11434/v1', models: ['qwen3:8b', 'llama3.1:8b'], logo: 'Ol', color: '#111111', note: '本机推理，配合本地嵌入可完全离线' },
      { id: 'lmstudio', name: 'LM Studio', base: 'http://127.0.0.1:1234/v1', models: [], logo: 'LM', color: '#4b5563', note: '模型以本机加载为准，留空自动' }
    ]
  },
  {
    title: '自定义',
    items: [
      { id: 'custom', name: 'OpenAI 兼容接口', base: '', models: [], logo: '⚙', color: '#64748b', note: '任意 /chat/completions 兼容服务：中转站、公司网关、new-api 等' }
    ]
  }
]

export const ALL_PROVIDERS: ProviderPreset[] = PROVIDER_GROUPS.flatMap((g) => g.items)
