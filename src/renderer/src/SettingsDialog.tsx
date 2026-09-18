import { useEffect, useRef, useState } from 'react'
import type { Settings } from './types'
import { ALL_PROVIDERS, PROVIDER_GROUPS, type ProviderPreset } from './providers'

interface Props {
  settings: Settings
  indexed: { papers: number; indexed: number; chunks: number }
  indexInfo: { done: number; total: number; phase: string; current?: string } | null
  onSave: (patch: Partial<Settings>) => Promise<Settings>
  onRescanned: () => void
  onClose: () => void
}

function guessProvider(apiBase: string): string {
  const hit = ALL_PROVIDERS.filter((p) => p.base).find((p) => apiBase.startsWith(p.base))
  return hit?.id ?? 'custom'
}

function workspaceName(p: string): string {
  const parts = p.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}

type Sec = 'appear' | 'lib' | 'model' | 'embed' | 'index'

const NAV: Array<{ id: Sec; icon: string; label: string }> = [
  { id: 'appear', icon: '🎨', label: '外观与翻译' },
  { id: 'lib', icon: '📚', label: '文献库与数据' },
  { id: 'model', icon: '🤖', label: '模型服务' },
  { id: 'embed', icon: '🧬', label: '向量嵌入' },
  { id: 'index', icon: '🗂', label: '索引与关于' }
]

const THINKING_LABEL: Record<string, string> = { default: '默认', off: '关闭', low: '低', medium: '中', high: '高' }

export default function SettingsDialog({ settings, indexed, indexInfo, onSave, onRescanned, onClose }: Props): JSX.Element {
  const [form, setForm] = useState<Settings>(settings)
  const [profiles, setProfiles] = useState<NonNullable<Settings['profiles']>>(
    () =>
      settings.profiles?.length
        ? settings.profiles
        : [
            {
              provider: settings.provider,
              apiBase: settings.apiBase,
              apiKey: settings.apiKey,
              models: settings.models?.length ? settings.models : settings.model ? [settings.model] : []
            }
          ]
  )
  const [sec, setSec] = useState<Sec>('appear')
  const [showPicker, setShowPicker] = useState(false)
  const [pickerKw, setPickerKw] = useState('')
  const [bridgeOn, setBridgeOn] = useState(false)
  const [bridgePort, setBridgePort] = useState(24517)
  const [ver, setVer] = useState('')
  const [dataDir, setDataDir] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [llmTest, setLlmTest] = useState('')
  const [embedTest, setEmbedTest] = useState('')
  const profileSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveProfiles = (list: NonNullable<Settings['profiles']>): void => {
    if (profileSaveTimer.current) clearTimeout(profileSaveTimer.current)
    profileSaveTimer.current = setTimeout(() => {
      void onSave({ profiles: list })
    }, 300)
  }

  const saveRef = useRef<() => Promise<void>>(async () => {})
  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') void saveRef.current()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])
  useEffect(() => {
    void window.api
      .appStatus()
      .then((s) => {
        setBridgeOn(s.bridge.running)
        setBridgePort(s.bridge.port)
        setVer(s.version)
        setDataDir(s.dataDir)
      })
      .catch(() => {})
  }, [])

  const set = (patch: Partial<Settings>): void => setForm((f) => ({ ...f, ...patch }))

  const pickTheme = async (theme: Settings['theme']): Promise<void> => {
    set({ theme })
    await onSave({ theme })
  }

  const pickWorkspace = async (): Promise<void> => {
    const p = await window.api.pickLibrary()
    if (!p) return
    setBusy(true)
    setMsg('切换工作区并扫描…')
    set({ libraryPath: p })
    const s = await onSave({ libraryPath: p })
    const r = await window.api.scanLibrary(s.libraryPath)
    setMsg(`工作区：${workspaceName(p)}（${r.total} 篇）`)
    onRescanned()
    setBusy(false)
  }

  const testLlm = async (): Promise<void> => {
    setLlmTest('测试中…')
    const active = profiles.find((p) => p.models.includes(form.model)) ?? profiles[0]
    const over = active
      ? {
          provider: active.provider,
          apiBase: active.apiBase,
          apiKey: active.apiKey,
          model: active.models.includes(form.model) ? form.model : (active.models[0] ?? form.model)
        }
      : { provider: form.provider, apiBase: form.apiBase, apiKey: form.apiKey, model: form.model }
    await onSave(form)
    const r = await window.api.testLLM(over)
    if (r.ok) {
      const bal = r.balance ? `，余额 ${r.balance.currency === 'CNY' ? '¥' : r.balance.currency + ' '}${r.balance.amount}` : ''
      setLlmTest(`✓ 连接成功：${r.model}（${r.latencyMs}ms）${bal}`)
    } else {
      setLlmTest(`✗ ${r.error ?? '连接失败'}`)
    }
  }

  const testEmbed = async (): Promise<void> => {
    setEmbedTest('测试中…')
    await onSave(form)
    const r = await window.api.testEmbed()
    setEmbedTest(r.ok ? `✓ 嵌入正常，向量维度 ${r.dim}` : `✗ ${r.error ?? '失败'}`)
  }

  const rebuild = async (): Promise<void> => {
    setBusy(true)
    await onSave(form)
    await window.api.rebuildIndex()
    setMsg('已清空索引并开始重建，可关闭本窗口')
    setBusy(false)
  }

  const save = async (): Promise<void> => {
    const active = profiles.find((p) => p.models.includes(form.model)) ?? profiles[0]
    await onSave({
      ...form,
      profiles,
      ...(active ? { provider: active.provider, apiBase: active.apiBase, apiKey: active.apiKey, models: active.models } : {})
    })
    onClose()
  }
  saveRef.current = save
  const closeAndSave = (): void => {
    void save()
  }

  const addFromPreset = (preset: ProviderPreset): void => {
    setProfiles((list) => {
      const next = [...list, { provider: preset.id, apiBase: preset.base, apiKey: '', models: [...preset.models] }]
      saveProfiles(next)
      return next
    })
    set({ provider: preset.id, apiBase: preset.base, model: preset.models[0] ?? form.model })
    setShowPicker(false)
    setPickerKw('')
  }

  const themeCard = (id: Settings['theme'], label: string, preview: JSX.Element): JSX.Element => (
    <div className={`theme-card ${form.theme === id ? 'on' : ''}`} onClick={() => void pickTheme(id)}>
      <div className="theme-thumb">{preview}</div>
      <div className="theme-label">{label}</div>
    </div>
  )

  const exportMobile = async (): Promise<void> => {
    const r = await window.api.exportMobilePack()
    if (r) setMsg(`已导出 ${r.papers} 篇 · ${Math.round(r.bytes / 1024)} KB`)
  }
  const mergeMobile = async (): Promise<void> => {
    const r = await window.api.mergeMobileNotes()
    if (r) {
      setMsg(`已合并：标注 ${r.mergedHighlights} 条 · 状态 ${r.mergedStatus} 项`)
      onRescanned()
    }
  }

  return (
    <div className="modal-mask" onMouseDown={closeAndSave}>
      <div className="modal set-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="set-side">
          <div className="set-brand">设置</div>
          {NAV.map((n) => (
            <button key={n.id} className={`set-nav-item ${sec === n.id ? 'on' : ''}`} onClick={() => setSec(n.id)}>
              <span className="ic">{n.icon}</span>
              {n.label}
            </button>
          ))}
          <div className="set-side-foot">
            <span className={`set-dot ${bridgeOn ? 'on' : ''}`} title="本地服务（浏览器/Word 插件连接用）" />
            v{ver || '0.5.0'}
          </div>
        </div>

        <div className="set-main">
          <div className="modal-head">
            <h2>{NAV.find((n) => n.id === sec)?.label ?? '设置'}</h2>
            <button className="modal-x" title="关闭（自动保存）" onClick={closeAndSave}>
              ✕
            </button>
          </div>
          <div className="modal-scroll">
            {sec === 'appear' && (
              <div className="section">
                <div className="section-title">主题</div>
                <div className="theme-row">
                  {themeCard('system', '跟随系统', <div className="tt tt-split"><div className="tt-side" /><div className="tt-main" /></div>)}
                  {themeCard('light', '浅色', <div className="tt tt-light"><div className="tt-side" /><div className="tt-main" /></div>)}
                  {themeCard('dark', '深色', <div className="tt tt-dark"><div className="tt-side" /><div className="tt-main" /></div>)}
                </div>
                <div className="section-title" style={{ marginTop: 22 }}>翻译</div>
                <div className="field-row">
                  <div className="field grow">
                    <label>翻译目标语言</label>
                    <input value={form.translateTarget} onChange={(e) => set({ translateTarget: e.target.value })} />
                  </div>
                </div>
                <div className="hint">未配置大模型时，划词与全文翻译自动走免费通道；配置后自动升级为术语消歧的学术翻译。</div>
              </div>
            )}

            {sec === 'lib' && (
              <div className="section">
                <div className="section-title">工作区</div>
                <div className="ws-row">
                  <div className="ws-icon">📁</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="ws-name">{workspaceName(form.libraryPath)}</div>
                    <div className="hint">导入、归类、索引全自动；iCloud / OneDrive 同步自动重扫。</div>
                  </div>
                  <button className="btn ghost" onClick={pickWorkspace} disabled={busy}>
                    更改…
                  </button>
                </div>
                <div className="section-title" style={{ marginTop: 24 }}>移动端</div>
                <div className="ws-row">
                  <div style={{ flex: 1 }}>
                    <div className="ws-name">导出 .cspack 数据包</div>
                    <div className="hint">手机 APK 打开即读：PDF、分类、状态、高亮全带走。</div>
                  </div>
                  <button className="btn ghost" onClick={() => void exportMobile()}>
                    导出…
                  </button>
                </div>
                <div className="ws-row">
                  <div style={{ flex: 1 }}>
                    <div className="ws-name">合并手机端阅读数据</div>
                    <div className="hint">把手机上的划词标注与阅读状态合并回桌面端。</div>
                  </div>
                  <button className="btn ghost" onClick={() => void mergeMobile()}>
                    合并…
                  </button>
                </div>
                <div className="hint" style={{ marginTop: 12 }}>
                  💡 已有 Zotero 文献库？「文件 → 从 Zotero 导入」一键迁移；知网题录用「文件 → 导入题录文件」。
                </div>
              </div>
            )}

            {sec === 'model' && (
              <div className="section">
                <div className="section-title">模型与服务商（对话界面可切换）</div>
                {profiles.map((pf, i) => {
                  const isActive = pf.models.includes(form.model)
                  const preset = ALL_PROVIDERS.find((p) => p.id === pf.provider)
                  const upd = (patch: Partial<{ provider: string; apiBase: string; apiKey: string; models: string[] }>): void =>
                    setProfiles((list) => {
                      const next = list.map((x, idx) => (idx === i ? { ...x, ...patch } : x))
                      saveProfiles(next)
                      return next
                    })
                  return (
                    <div className={`profile-card ${isActive ? 'active' : ''}`} key={i}>
                      <div className="field-row">
                        <div className="field pv-field">
                          <label>服务商</label>
                          <div className="pv-row">
                            <div className="pv-avatar" style={{ background: preset?.color ?? '#64748b' }}>{preset?.logo ?? '⚙'}</div>
                            <select
                              value={guessProvider(pf.apiBase)}
                              onChange={(e) => {
                                const hit = ALL_PROVIDERS.find((x) => x.id === e.target.value)!
                                upd(hit.id === 'custom' ? { provider: 'custom' } : { provider: hit.id, apiBase: hit.base, models: hit.models.length ? pf.models : hit.models })
                              }}
                            >
                              {ALL_PROVIDERS.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <div className="field grow">
                          <label>API Base</label>
                          <input value={pf.apiBase} onChange={(e) => upd({ apiBase: e.target.value })} />
                        </div>
                      </div>
                      <div className="field">
                        <label>API Key</label>
                        <input type="password" value={pf.apiKey} onChange={(e) => upd({ apiKey: e.target.value })} placeholder="sk-…" />
                      </div>
                      <div className="field">
                        <label>模型（逗号分隔）</label>
                        <input
                          value={pf.models.join(', ')}
                          onChange={(e) =>
                            upd({
                              models: e.target.value
                                .split(/[,，]/)
                                .map((s) => s.trim())
                                .filter(Boolean)
                            })
                          }
                          placeholder="deepseek-chat, deepseek-reasoner"
                        />
                      </div>
                      <div className="profile-foot">
                        {isActive ? (
                          <span className="active-tag">使用中</span>
                        ) : (
                          <span
                            className="profile-link"
                            onClick={() => set({ provider: pf.provider, apiBase: pf.apiBase, apiKey: pf.apiKey, model: pf.models[0] ?? form.model })}
                          >
                            启用此配置
                          </span>
                        )}
                        <span style={{ flex: 1 }} />
                        {profiles.length > 1 && (
                          <button
                            className="profile-del"
                            onClick={() =>
                              setProfiles((list) => {
                                const next = list.filter((_, idx) => idx !== i)
                                saveProfiles(next)
                                return next
                              })
                            }
                          >
                            删除
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
                <div className="profile-add-row">
                  <button className="profile-add" onClick={() => setShowPicker(true)}>
                    ＋ 从服务商库添加（自动填好接口与模型）
                  </button>
                  <button
                    className="profile-add ghost"
                    onClick={() =>
                      setProfiles((list) => {
                        const next = [...list, { provider: 'custom', apiBase: '', apiKey: '', models: [] }]
                        saveProfiles(next)
                        return next
                      })
                    }
                  >
                    空白配置
                  </button>
                </div>
                <div className="section-title" style={{ marginTop: 22 }}>推理</div>
                <div className="field-row">
                  <div className="field grow">
                    <label>思考深度（支持的服务商生效）</label>
                    <select
                      value={form.thinkingLevel ?? 'default'}
                      onChange={(e) => set({ thinkingLevel: e.target.value as Settings['thinkingLevel'] })}
                    >
                      {Object.entries(THINKING_LABEL).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="test-row">
                  <button className="btn ghost" onClick={() => void testLlm()} disabled={busy}>
                    测试连接
                  </button>
                  <span className="test-result">{llmTest}</span>
                </div>
              </div>
            )}

            {sec === 'embed' && (
              <div className="section">
                <div className="section-title">向量嵌入</div>
                <div className="field-row">
                  <div className="field grow">
                    <label>嵌入来源</label>
                    <select value={form.embedProvider} onChange={(e) => set({ embedProvider: e.target.value as Settings['embedProvider'] })}>
                      <option value="local">本地 e5-small</option>
                      <option value="ollama">Ollama</option>
                      <option value="zhipu">智谱 embedding-3</option>
                    </select>
                  </div>
                  {form.embedProvider === 'ollama' && (
                    <div className="field grow">
                      <label>Ollama 模型</label>
                      <input value={form.ollamaEmbedModel} onChange={(e) => set({ ollamaEmbedModel: e.target.value })} placeholder="bge-m3" />
                    </div>
                  )}
                </div>
                {form.embedProvider === 'ollama' && (
                  <div className="field">
                    <label>Ollama 服务地址</label>
                    <input value={form.ollamaUrl} onChange={(e) => set({ ollamaUrl: e.target.value })} placeholder="http://127.0.0.1:11434" />
                    <div className="hint">需先安装并运行 Ollama，且 ollama pull 对应嵌入模型。</div>
                  </div>
                )}
                <div className="test-row">
                  <button className="btn ghost" onClick={() => void testEmbed()} disabled={busy}>
                    测试嵌入
                  </button>
                  <span className="test-result">{embedTest}</span>
                </div>
              </div>
            )}

            {sec === 'index' && (
              <div className="section">
                <div className="section-title">索引</div>
                <div className="hint" style={{ marginTop: 0 }}>
                  已索引 {indexed.indexed}/{indexed.papers} 篇 · {indexed.chunks} 个文本块
                  {indexInfo ? ` · 正在处理 ${indexInfo.current ?? ''} (${indexInfo.done}/${indexInfo.total})` : ''}
                </div>
                <div style={{ marginTop: 8 }}>
                  <button className="btn ghost" onClick={rebuild} disabled={busy}>
                    重建全库索引
                  </button>
                </div>
                <div className="section-title" style={{ marginTop: 24 }}>数据目录</div>
                <div className="hint" style={{ marginTop: 0 }}>
                  {dataDir || '…'}
                  <br />
                  设置、数据库与索引都保存在这里。
                </div>
                <div className="section-title" style={{ marginTop: 24 }}>关于</div>
                <div className="hint" style={{ marginTop: 0 }}>
                  CSPAPER v{ver || '0.5.0'} · 本地服务端口 {bridgePort}
                  <br />
                  <a
                    href="https://github.com/Jensen-Yao/CSPAPER"
                    style={{ color: 'var(--accent)', cursor: 'pointer' }}
                    onClick={(e) => {
                      e.preventDefault()
                      window.api.openExternal('https://github.com/Jensen-Yao/CSPAPER')
                    }}
                  >
                    GitHub 仓库 ↗
                  </a>
                  {' · '}
                  <a
                    href="http://127.0.0.1:24517/cite-ui"
                    style={{ color: 'var(--accent)', cursor: 'pointer' }}
                    onClick={(e) => {
                      e.preventDefault()
                      window.api.openExternal('http://127.0.0.1:24517/cite-ui')
                    }}
                  >
                    引文助手 ↗
                  </a>
                </div>
              </div>
            )}
          </div>

          <div className="modal-actions">
            <span className="progress-line" style={{ flex: 1 }}>
              {msg}
            </span>
            <button className="btn ghost" onClick={onClose}>
              取消
            </button>
            <button className="btn" onClick={save}>
              保存
            </button>
          </div>
        </div>

        {showPicker && (
          <div className="modal-mask picker-mask" onMouseDown={() => setShowPicker(false)}>
            <div className="modal picker" onMouseDown={(e) => e.stopPropagation()}>
              <div className="modal-head">
                <h2>添加服务商</h2>
                <button className="modal-x" title="关闭" onClick={() => setShowPicker(false)}>
                  ✕
                </button>
              </div>
              <div className="picker-search">
                <input autoFocus placeholder="搜索服务商…" value={pickerKw} onChange={(e) => setPickerKw(e.target.value)} />
              </div>
              <div className="picker-scroll">
                {PROVIDER_GROUPS.map((g) => {
                  const kw = pickerKw.trim().toLowerCase()
                  const items = g.items.filter((p) => !kw || p.name.toLowerCase().includes(kw) || p.base.includes(kw))
                  if (items.length === 0) return null
                  return (
                    <div key={g.title} className="picker-group">
                      <div className="picker-group-title">{g.title}</div>
                      <div className="picker-grid">
                        {items.map((p) => {
                          const added = profiles.some((x) => x.provider === p.id)
                          return (
                            <button
                              key={p.id}
                              className={`pv-card ${added ? 'added' : ''}`}
                              onClick={() => addFromPreset(p)}
                              title={p.note ?? p.base}
                            >
                              <div className="pv-avatar lg" style={{ background: p.color }}>
                                {p.logo}
                              </div>
                              <div className="pv-name">
                                {p.name}
                                {added && <span className="pv-added">已添加</span>}
                              </div>
                              <div className="pv-sub">{p.models.length ? `${p.models.length} 个推荐模型` : p.base || '自定义接口'}</div>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="picker-foot hint">
                点击任意服务商即自动填好 API Base 与推荐模型并设为使用中，粘贴 API Key 即可。全部走 OpenAI 兼容协议（含 Google / Ollama 官方兼容层）。
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
