// 免 Key 翻译通道：未配置大模型 API Key 时，划词翻译自动走这里，开箱即用。
// 链路：Google gtx 接口（质量好、支持长文）→ MyMemory（免注册兜底，单段限长需切分）。
// 目标语言取自设置里的 translateTarget（默认「中文」），学术场景主要是 英→中。
const TARGET_MAP: Record<string, string> = {
  中文: 'zh-CN',
  简体中文: 'zh-CN',
  英文: 'en',
  日文: 'ja',
  韩文: 'ko',
  法文: 'fr',
  德文: 'de',
  俄文: 'ru'
}

function targetCode(target: string): string {
  return TARGET_MAP[target?.trim()] ?? 'zh-CN'
}

async function googleTranslate(text: string, tl: string): Promise<string | null> {
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(tl)}&dt=t&q=${encodeURIComponent(text)}`
    const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (!resp.ok) return null
    const json = (await resp.json()) as unknown
    const segs = (json as unknown[])?.[0]
    if (!Array.isArray(segs)) return null
    const out = segs
      .map((s) => (Array.isArray(s) ? String(s[0] ?? '') : ''))
      .join('')
      .trim()
    return out || null
  } catch {
    return null // 网络不可达（国内环境常见），交给下一通道
  }
}

// MyMemory 免费接口：无需注册，单次请求限长（约 500 字节），按句子边界切分后逐段翻译
async function myMemoryTranslate(text: string, tl: string): Promise<string | null> {
  // 源语言猜测：译入中文/日文等按英文源处理（学术论文主流），译入英文按中文源处理
  const src = tl.startsWith('zh') || tl === 'ja' || tl === 'ko' ? 'en' : 'zh-CN'
  const chunks: string[] = []
  let cur = ''
  for (const seg of text.split(/(?<=[.!?。！？；;\n])\s*/)) {
    if (cur && cur.length + seg.length > 450) {
      chunks.push(cur)
      cur = seg
    } else {
      cur += (cur ? ' ' : '') + seg
    }
  }
  if (cur.trim()) chunks.push(cur)
  const parts: string[] = []
  for (const chunk of chunks.slice(0, 20)) {
    try {
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=${src}|${tl}`
      const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) })
      if (!resp.ok) return null
      const json = (await resp.json()) as { responseData?: { translatedText?: string } }
      const t = json.responseData?.translatedText
      if (!t) return null
      parts.push(t)
    } catch {
      return null
    }
  }
  const out = parts.join(' ').trim()
  return out || null
}

// 依次尝试各免费通道，全部失败抛错（提示配置 API Key 走 AI 翻译）
export async function freeTranslate(text: string, target: string): Promise<string> {
  const tl = targetCode(target)
  const trimmed = text.trim()
  if (!trimmed) return ''
  const viaGoogle = await googleTranslate(trimmed, tl)
  if (viaGoogle) return viaGoogle
  const viaMyMemory = await myMemoryTranslate(trimmed, tl)
  if (viaMyMemory) return viaMyMemory
  throw new Error('免费翻译通道当前不可用（网络受限），可在设置中配置任意大模型 API Key 使用 AI 翻译')
}
