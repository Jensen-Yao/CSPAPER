import { useEffect, useMemo, useRef, useState } from 'react'
import { renderRich, type Jump } from './rich'
import { buildSuggestions } from './suggest'
import { ModelPill, ThinkingPill, ScopePill, type ChatScope } from './ChatControls'
import { isCommandInput, parseSlash, DEEP_ALIAS, SLASH_CMDS } from './slash'
import type { ChatMsg, Paper, SourceRef } from './types'

interface Props {
  papers: Paper[]
  paperCount: number
  cats: string[]
  catCounts: Map<string, number>
  scope: ChatScope
  onScopeChange: (s: ChatScope) => void
  models: string[]
  model: string
  thinking: string
  onChangeModel: (m: string) => void
  onChangeThinking: (l: string) => void
  onJump: Jump
  resetKey: number
  // 对话字号（问答/翻译/对话共用）
  fs: number
  onFs: (delta: number) => void
}

// 全库对话主界面（Chat 模式）：hero 欢迎态 + 全屏 RAG 问答。
// 建议问题由库内内容实时生成（标题关键词/分类/近期文献），不再是固定三条
export default function ChatView({
  papers,
  paperCount,
  cats,
  catCounts,
  scope,
  onScopeChange,
  models,
  model,
  thinking,
  onChangeModel,
  onChangeThinking,
  onJump,
  resetKey,
  fs,
  onFs
}: Props): JSX.Element {
  const [msgs, setMsgs] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const scrollBottom = () => setTimeout(() => scrollRef.current?.scrollTo({ top: 1e9, behavior: 'smooth' }), 50)

  const suggestions = useMemo(() => buildSuggestions(papers, catCounts), [papers, catCounts])

  // 侧栏「新建对话」：清空当前会话回到欢迎页
  useEffect(() => {
    if (resetKey > 0) setMsgs([])
  }, [resetKey])

  const [chatNotice, setChatNotice] = useState('')
  const flash = (m: string): void => {
    setChatNotice(m)
    window.setTimeout(() => setChatNotice(''), 2600)
  }
  /** 对话侧斜杠命令（与 Work 合成器同框架）：消费返回 true */
  const execSlash = (raw: string): boolean => {
    const p = parseSlash(raw)
    if (!p) return false
    const { name, args } = p
    if (name === 'model') {
      void window.api.getSettings().then((s0) => {
        const st = s0 as { models?: string[]; model?: string }
        const all = st.models?.length ? st.models : st.model ? [st.model] : []
        const hit = all.find((m) => m.toLowerCase().includes((args || '').toLowerCase()))
        if (hit) {
          void window.api.saveSettings({ model: hit })
          flash('对话模型已切换：' + hit)
        } else flash(all.length ? '可用模型：' + all.join('、') : '未配置模型')
      })
      return true
    }
    if (name === 'deep') {
      const lv = (args || '').toLowerCase()
      const map: Record<string, string> = { low: 'low', mid: 'medium', medium: 'medium', high: 'high', 低: 'low', 中: 'medium', 高: 'high' }
      if (!map[lv]) {
        flash('用法：/deep low|mid|high（对话思考强度）')
        return true
      }
      void window.api.saveSettings({ thinkingLevel: map[lv] as 'low' | 'medium' | 'high' })
      flash('思考强度：' + map[lv])
      return true
    }
    if (name === 'clear' || name === 'new') {
      setMsgs([])
      flash('已开始新对话')
      return true
    }
    if (name === 'goal') {
      void window.api.saveSettings({ agentGoal: args })
      flash(args ? '长期目标已设定（对 Work 任务生效）：' + args.slice(0, 60) : '已清除长期目标')
      return true
    }
    if (name === 'help') {
      flash('对话可用命令：/goal　/model　/deep　/clear　/help（其余命令在 Work 工作台）')
      return true
    }
    // 其余命令引导去 Work
    flash('/' + name + ' 请在 Work 工作台执行（顶栏切换到 Work）')
    return true
  }

  const send = (raw?: string): void => {
    const q = (raw ?? input).trim()
    if (!q || busy) return
    if (isCommandInput(q) && execSlash(q)) {
      setInput('')
      return
    }
    // 带最近两轮问答做多轮追问（在追加本轮消息之前取历史）
    const history = msgs.slice(-4).map((m) => ({ role: m.role, content: m.content }))
    setInput('')
    setMsgs((ms) => [...ms, { role: 'user', content: q }, { role: 'assistant', content: '' }])
    setBusy(true)
    scrollBottom()
    window.api.stream(
      { mode: 'rag', question: q, category: scope.type === 'cat' ? scope.cat : undefined, history },
      {
        onDelta: (d) =>
          setMsgs((ms) => {
            const next = [...ms]
            const last = next[next.length - 1]
            if (last?.role === 'assistant') next[next.length - 1] = { ...last, content: last.content + d }
            return next
          }),
        onSources: (srcs) =>
          setMsgs((ms) => {
            const next = [...ms]
            const last = next[next.length - 1]
            if (last?.role === 'assistant') next[next.length - 1] = { ...last, sources: srcs as SourceRef[] }
            return next
          }),
        onEnd: () => {
          setBusy(false)
          scrollBottom()
        }
      }
    )
  }

  // 引用跳转带上「该轮的问题 + 芯片所在回答的局部上下文」：
  // snippet 未命中或缺失时用它做关键词定位，read 模式整篇问答也靠它精确定位段落
  const jumpFor = (i: number): Jump => {
    const q = msgs[i - 1]?.role === 'user' ? msgs[i - 1].content : ''
    return (slug, page, snippet, ctx) => onJump(slug, page, snippet, [q, ctx].filter(Boolean).join('\n'))
  }

  const fsCtl = (
    <div className="fs-ctl" title={`对话字号（当前 ${fs}px，问答/翻译/对话共用）`}>
      <button onClick={() => onFs(-1)} title="减小字号">
        A−
      </button>
      <button onClick={() => onFs(1)} title="增大字号">
        A+
      </button>
    </div>
  )

  const noticeBar = chatNotice ? <div className="wb-notice" style={{ width: '100%', marginBottom: 6 }}>{chatNotice}</div> : null
  const inputBox = (
    <div className="hero-input">
      {noticeBar}
      <textarea
        className="hero-textarea"
        placeholder="与全库文献对话，如：这个库里有哪些关于热建模的论文？支持 /model /deep /clear /goal 命令"
        value={input}
        rows={2}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            send()
          }
        }}
      />
      <div className="hero-input-foot">
        <ScopePill cats={cats} scope={scope} onChange={onScopeChange} paperCount={paperCount} catCounts={catCounts} />
        <ModelPill models={models} model={model} onChange={onChangeModel} />
        <ThinkingPill level={thinking} onChange={onChangeThinking} />
        {fsCtl}
        <span style={{ flex: 1 }} />
        <button className="send-btn" onClick={() => send()} disabled={busy || !input.trim()}>
          发送
        </button>
      </div>
    </div>
  )

  return (
    <div className="chat-view">
      {msgs.length === 0 ? (
        <div className="chat-hero-wrap">
          <div className="chat-hero">
            <div className="big">💬</div>
            <div className="headline">与全库文献对话</div>
            <div className="tip">跨所有论文语义检索，回答自带页码引用，点击引用直达原文</div>
          </div>
          {inputBox}
          <div className="hero-suggest">
            {suggestions.map((s) => (
              <button key={s} onClick={() => send(s)}>
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="chat-log" ref={scrollRef}>
            {msgs.map((m, i) => (
              <div key={i} className={`msg ${m.role}`}>
                <div className="who">{m.role === 'user' ? '你' : 'AI'}</div>
                <div className="bubble">{renderRich(m.content, m.sources, jumpFor(i))}</div>
              </div>
            ))}
            {busy && (
              <div className="thinking">
                <span className="b" /> <span className="b" /> <span className="b" /> 检索并思考中…
              </div>
            )}
          </div>
          <div className="chat-view-input">{inputBox}</div>
        </>
      )}
    </div>
  )
}
