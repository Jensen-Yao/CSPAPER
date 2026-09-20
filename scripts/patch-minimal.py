# -*- coding: utf-8 -*-
# Workbench 极简化补丁：去 emoji、事件渲染改详尽终端风
import re

p = 'src/renderer/src/WorkbenchView.tsx'
s = open(p, encoding='utf-8', newline='').read()

# 1) 去掉工具 emoji 映射
s = re.sub(r"const TOOL_ICON: [^}]+}\n", "", s, count=1)
s = re.sub(r"const toolIcon = [^\n]+\n", "", s, count=1)

# 2) 模板标签去 emoji
s = s.replace("{ label: '📋 主题调研',", "{ label: '主题调研',")
s = s.replace("{ label: '📖 精读论文',", "{ label: '精读论文',")
s = s.replace("{ label: '📊 多文对比',", "{ label: '多文对比',")
s = s.replace("{ label: '🌙 睡眠日报',", "{ label: '睡眠日报',")

# 3) hero 去装饰
s = s.replace("""            <div className="wb-hero">
              <div className="wb-hero-art">✦</div>
              <div className="wb-hero-text">今天要研究什么？</div>
            </div>""", """            <div className="wb-hero">
              <div className="wb-hero-text">今天要研究什么？</div>
            </div>""")

# 4) 杂项去 emoji
s = s.replace('＋ 新任务', '+ 新任务')
s = s.replace('＋\n              </button>\n              <div className="wb-model-wrap">', '+\n              </button>\n              <div className="wb-model-wrap">')
s = s.replace('🧠 {models[0]', '{models[0]')
s = s.replace("'🌙 睡眠日报'技能", "'睡眠日报'技能")

# 5) SkillsPane 卡片头去 emoji
s = s.replace('<span className="wb-card-icon">🎯</span>\n              ', '')
# McpPane 卡片头去 emoji
s = s.replace('<span className="wb-card-icon">🔌</span>\n            ', '')
s = s.replace('<span className="wb-card-icon">🧰</span>\n            ', '')

# 6) 事件渲染改详尽终端风
old_ev = """              {task.events.map((ev, i) => (
                <div key={i} className={`wb-card ${ev.kind} ${ev.ok === false ? 'fail' : ''}`}>
                  <div className="wb-card-head">
                    <span className="wb-card-icon">{ev.kind === 'artifact' ? '📦' : toolIcon(ev.tool)}</span>
                    <span className="wb-card-title">
                      {ev.kind === 'step' && `已执行 ${ev.tool}`}
                      {ev.kind === 'artifact' && `产出：${ev.artifact?.title ?? ''}`}
                      {ev.kind === 'text' && '智能体输出'}
                      {ev.kind === 'done' && '任务完成'}
                      {ev.kind === 'error' && '出错了'}
                      {ev.kind === 'cancelled' && '已中止'}
                      {ev.kind === 'status' && (ev.text ?? '进行中')}
                      {ev.kind === 'plan' && '执行计划'}
                    </span>
                    {ev.ok != null && <span className={`wb-card-state ${ev.ok ? 'ok' : 'bad'}`}>{ev.ok ? '✓' : '✗'}</span>}
                    {ev.ms != null && <span className="wb-ev-ms">{ev.ms}ms</span>}
                  </div>
                  {ev.text && ev.kind !== 'status' && (
                    <div className="wb-card-body ellipsis-2" title={ev.text}>
                      {ev.text}
                    </div>
                  )}
                  {ev.artifact && (
                    <button className="wb-artifact" onClick={() => openArtifact(ev.artifact!)}>
                      在文献库中查看 →
                    </button>
                  )}
                </div>
              ))}
              {task.status === 'running' && (
                <div className="wb-card running">
                  <div className="wb-card-head">
                    <i className="wb-spin" />
                    <span className="wb-card-title">智能体正在执行…</span>
                  </div>
                </div>
              )}"""
new_ev = """              {task.events.map((ev, i) => {
                if (ev.kind === 'status') {
                  return (
                    <div key={i} className="wb-ev">
                      <div className="wb-ev-line">
                        <i className="wb-spin-inline" />
                        <span className="wb-ev-text dim">{ev.text}</span>
                      </div>
                    </div>
                  )
                }
                if (ev.kind === 'text') {
                  return (
                    <div key={i} className="wb-ev">
                      <div className="wb-ev-text">{ev.text}</div>
                    </div>
                  )
                }
                return (
                  <div key={i} className={`wb-ev ${ev.kind} ${ev.ok === false ? 'fail' : ''}`}>
                    <div className="wb-ev-line">
                      {ev.kind === 'step' && <span className="wb-ev-tool">{ev.tool}</span>}
                      {ev.kind === 'artifact' && <span className="wb-ev-tool">artifact</span>}
                      {ev.ok != null && <span className={`wb-ev-state ${ev.ok ? 'ok' : 'bad'}`}>{ev.ok ? '[ok]' : '[fail]'}</span>}
                      {ev.ms != null && <span className="wb-ev-ms">{ev.ms}ms</span>}
                    </div>
                    {ev.text && <div className="wb-ev-text">{ev.text}</div>}
                    {ev.artifact && (
                      <button className="wb-artifact" onClick={() => openArtifact(ev.artifact!)}>
                        在文献库中查看 →
                      </button>
                    )}
                  </div>
                )
              })}
              {task.status === 'running' && (
                <div className="wb-ev">
                  <div className="wb-ev-line">
                    <i className="wb-spin-inline" />
                    <span className="wb-ev-text dim">执行中…</span>
                  </div>
                </div>
              )}"""
assert old_ev in s, 'event render anchor missing'
s = s.replace(old_ev, new_ev)

open(p, 'w', encoding='utf-8', newline='').write(s)
print('minimal patch applied')
