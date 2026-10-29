import { useEffect, useRef, useState } from 'react'
import type { ScriptInfo, Settings, StyleInfo } from './types'
import { ALL_PROVIDERS, PROVIDER_GROUPS, type ProviderPreset } from './providers'
import { presetCaps } from './model-caps-presets'
import * as Icon from './Icon'
import { useDialog } from './Dialog'

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

function fmtSize(n?: number): string {
  if (n == null || !Number.isFinite(n)) return ''
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`
}

type Sec = 'appear' | 'lib' | 'translators' | 'cites' | 'zoterosync' | 'agent' | 'model' | 'embed' | 'plugins' | 'index'

const NAV: Array<{ id: Sec; icon: JSX.Element; label: string }> = [
  { id: 'appear', icon: <Icon.Sparkle size={14} />, label: '外观与翻译' },
  { id: 'lib', icon: <Icon.Folder size={14} />, label: '文献库与数据' },
  { id: 'translators', icon: <Icon.Globe size={14} />, label: '在线获取' },
  { id: 'cites', icon: <Icon.Quote size={14} />, label: '引文样式' },
  { id: 'model', icon: <Icon.Zap size={14} />, label: '模型服务' },
  { id: 'embed', icon: <Icon.Graph size={14} />, label: '向量嵌入' },
  { id: 'agent', icon: <Icon.Target size={14} />, label: '智能体' },
  { id: 'zoterosync', icon: <Icon.Refresh size={14} />, label: 'Zotero 同步' },
  { id: 'plugins', icon: <Icon.Grid size={14} />, label: '插件与安装' },
  { id: 'index', icon: <Icon.Info size={14} />, label: '索引与关于' }
]

const THINKING_LABEL: Record<string, string> = { default: '默认', off: '关闭', low: '低', medium: '中', high: '高' }

export default function SettingsDialog({ settings, indexed, indexInfo, onSave, onRescanned, onClose }: Props): JSX.Element {
  const dlg = useDialog()
  const [form, setForm] = useState<Settings>(settings)
  const [profiles, setProfiles] = useState<NonNullable<Settings['profiles']>>(
    () =>
      settings.profiles?.length
        ? settings.profiles.map((profile,index)=>({id:profile.id??`profile-${index+1}`,...profile}))
        : [
            {
              provider: settings.provider,
              apiBase: settings.apiBase,
              apiKey: settings.apiKey,
              models: settings.models?.length ? settings.models : settings.model ? [settings.model] : [],id:'profile-1'
            }
          ]
  )
  const [sec, setSec] = useState<Sec>('appear')
  const [showPicker, setShowPicker] = useState(false)
  // 模型页子视图：'list' = 供应商列表；数字 = 编辑第 N 个配置
  const [modelTab, setModelTab] = useState<'list' | number>('list')
  // 上游模型列表拉取状态（按 profile 下标）
  const [fetchState, setFetchState] = useState<Record<string, { busy: boolean; list: string[]; msg: string }>>({})
  const [pickerKw, setPickerKw] = useState('')
  const [bridgeOn, setBridgeOn] = useState(false)
  const [bridgePort, setBridgePort] = useState(24517)
  const [ver, setVer] = useState('')
  const [dataDir, setDataDir] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [llmTest, setLlmTest] = useState('')
  const [embedTest, setEmbedTest] = useState('')
  // —— 在线获取（抓取脚本）——
  const [scripts, setScripts] = useState<ScriptInfo[]>([])
  const [scriptDir, setScriptDir] = useState('')
  // —— 引文样式 ——
  const [styles, setStyles] = useState<StyleInfo[]>([])
  const [engine, setEngine] = useState<{ downloaded: boolean; size?: number } | null>(null)
  const [cslQ, setCslQ] = useState('')
  const [cslIds, setCslIds] = useState<string[]>([])
  const [cslSearching, setCslSearching] = useState(false)
  const [cslBusy, setCslBusy] = useState(false)
  const [cslMsg, setCslMsg] = useState('')
  // —— 插件与安装（浏览器扩展一键装载反馈）——
  const [extMsg, setExtMsg] = useState<Partial<Record<'chrome' | 'edge', string>>>({})
  // Zotero 云端同步：验证/同步消息 + 上次同步时间
  const [zotMsg, setZotMsg] = useState('')
  const [zotBusy, setZotBusy] = useState(false)
  const [zotLastSync, setZotLastSync] = useState('')
  useEffect(() => {
    if (sec !== 'zoterosync') return
    void window.api.zoteroApiStatus().then((st) => {
      if (st.lastSyncAt) setZotLastSync(st.lastSyncAt)
    })
    return window.api.onZoteroSyncDone((p) => {
      setZotBusy(false)
      setZotMsg(p.ok ? `✓ 同步完成：拉取 ${p.fetched ?? 0} 条，导入 ${p.imported ?? 0}，跳过 ${p.skipped ?? 0}，失败 ${p.failed ?? 0}` : `✗ ${p.error ?? '同步失败'}`)
      void window.api.zoteroApiStatus().then((st) => {
        if (st.lastSyncAt) setZotLastSync(st.lastSyncAt)
      })
    })
  }, [sec])
  const verifyZotero = async (): Promise<void> => {
    setZotBusy(true)
    setZotMsg('验证中…')
    try {
      const r = await window.api.zoteroApiVerify(form.zoteroUserId ?? '', form.zoteroApiKey ?? '')
      setZotMsg(r.ok ? `✓ 连接成功${r.items != null ? `：云端共 ${r.items} 条` : ''}（记得先保存凭据）` : `✗ ${r.error ?? '验证失败'}`)
    } catch (e) {
      setZotMsg(`✗ ${String(e).slice(0, 120)}`)
    } finally {
      setZotBusy(false)
    }
  }
  const runZoteroSync = async (mode: 'full' | 'incremental'): Promise<void> => {
    if (zotBusy) return
    setZotBusy(true)
    setZotMsg(mode === 'full' ? '正在全量同步…' : '正在增量同步…')
    try {
      await window.api.zoteroApiSync(mode)
    } catch (error) {
      setZotBusy(false)
      setZotMsg(`✗ 同步启动失败：${String(error).slice(0,120)}`)
    }
  }
  const profileSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveProfiles = (list: NonNullable<Settings['profiles']>): void => {
    if (profileSaveTimer.current) clearTimeout(profileSaveTimer.current)
    profileSaveTimer.current = setTimeout(() => {
      void onSave({ profiles:list.map((profile,index)=>({id:profile.id??`profile-${index+1}`,...profile})) })
        .catch(error=>setMsg(`✗ 配置自动保存失败：${String(error).slice(0,120)}`))
    }, 300)
  }

  const saveRef = useRef<() => Promise<void>>(async () => {})
  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      // 子浮层（picker 搜索/命令面板）打开时不关整个设置——只关子层自己的处理已 stopPropagation
      if (showPicker) return
      if (busy) { onClose(); return }
      void saveRef.current()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [showPicker, busy])
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

  // 进入对应分区时才加载（脚本/样式列表走文件系统，懒加载保持设置窗口打开迅速）
  useEffect(() => {
    if (sec === 'translators') {
      void window.api
        .translatorsList()
        .then((r) => {
          setScripts(r.scripts)
          setScriptDir(r.userDir)
        })
        .catch(() => {})
    }
    if (sec === 'cites') void refreshCsl()
  }, [sec])

  // 样式库搜索（离线 catalog，轻量；防抖后检索）
  useEffect(() => {
    const q = cslQ.trim()
    if (!q) {
      setCslIds([])
      return
    }
    setCslSearching(true)
    const t = setTimeout(() => {
      void window.api
        .cslCatalogSearch(q)
        .then((ids) => setCslIds(ids.slice(0, 60)))
        .catch(() => setCslIds([]))
        .finally(() => setCslSearching(false))
    }, 300)
    return () => clearTimeout(t)
  }, [cslQ])

  const refreshCsl = async (): Promise<void> => {
    try {
      const [list, eng] = await Promise.all([window.api.cslStyles(), window.api.cslEngineStatus()])
      setStyles(list)
      setEngine(eng)
    } catch {
      /* 忽略：列表加载失败不阻塞设置页 */
    }
  }

  // 启停脚本：本地即时翻转，后台把「禁用后剩余的禁用名单」写回（translatorsSetDisabled 语义是设置禁用集合）
  const toggleScript = (s: ScriptInfo): void => {
    const nextDisabled = scripts.filter((x) => (x.id === s.id ? !s.disabled : x.disabled)).map((x) => x.id)
    setScripts((list) => list.map((x) => (x.id === s.id ? { ...x, disabled: !s.disabled } : x)))
    void window.api.translatorsSetDisabled(nextDisabled).catch(() => {})
  }

  const reloadScripts = async (): Promise<void> => {
    const n = await window.api.translatorsReload()
    const r = await window.api.translatorsList()
    setScripts(r.scripts)
    setScriptDir(r.userDir)
    setMsg(`已重新加载 ${n} 个抓取脚本`)
  }

  const removeStyle = async (id: string): Promise<void> => {
    const ok = await window.api.cslRemoveStyle(id)
    if (ok) {
      setCslMsg(`已删除样式 ${id}`)
      await refreshCsl()
    } else {
      setCslMsg(`删除 ${id} 失败`)
    }
  }

  const importStyleFile = async (): Promise<void> => {
    const r = await window.api.cslImportStyle()
    if (r == null) return // 用户取消了文件选择
    if (r.ok) {
      setCslMsg(`已导入样式 ${r.id ?? ''}`)
      await refreshCsl()
    } else {
      setCslMsg(`✗ ${r.error ?? '导入失败'}`)
    }
  }

  const downloadStyle = async (id: string): Promise<void> => {
    if (cslBusy) return
    setCslBusy(true)
    setCslMsg(`正在下载 ${id}…`)
    try {
      const r = await window.api.cslDownloadStyle(id)
      if (r.ok) {
        setCslMsg(`已安装 ${id}`)
        await refreshCsl()
      } else {
        setCslMsg(`✗ ${r.error ?? '下载失败'}`)
      }
    } finally {
      setCslBusy(false)
    }
  }

  const downloadEngine = async (): Promise<void> => {
    if (cslBusy) return
    setCslBusy(true)
    setCslMsg('正在下载 citeproc 引擎…')
    try {
      const r = await window.api.cslEngineDownload()
      if (r.ok) {
        setCslMsg('引擎已就绪')
        await refreshCsl()
      } else {
        setCslMsg(`✗ ${r.error ?? '下载失败'}`)
      }
    } finally {
      setCslBusy(false)
    }
  }

  const set = (patch: Partial<Settings>): void => setForm((f) => ({ ...f, ...patch }))

  const pickTheme = async (theme: Settings['theme']): Promise<void> => {
    set({ theme })
    try{await onSave({ theme })}catch(error){setMsg(`✗ 主题保存失败：${String(error).slice(0,120)}`)}
  }

  const changeDataDir = async (): Promise<void> => {
    try {
      const target = await window.api.dataChangeDir()
      if (!target) return
      setDataDir(target)
      setMsg('数据目录已迁移，重启 CSPAPER 后生效')
    } catch(error) {
      setMsg(`✗ 数据目录迁移失败：${String(error).slice(0,120)}`)
    }
  }

  const pickWorkspace = async (): Promise<void> => {
    const p = await window.api.pickLibrary()
    if (!p) return
    setBusy(true)
    setMsg('切换工作区并扫描…')
    set({ libraryPath: p })
    try {
      const s = await onSave({ libraryPath: p })
      const r = await window.api.scanLibrary(s.libraryPath)
      setMsg(`工作区：${workspaceName(p)}（${r.total} 篇）`)
      onRescanned()
    } catch(error) {
      setMsg(`✗ 工作区切换失败：${String(error).slice(0,120)}`)
    } finally {
      setBusy(false)
    }
  }

  const testLlm = async (): Promise<void> => {
    setBusy(true);setLlmTest('测试中…')
    try {
      const active = profiles.find((p) => p.models.includes(form.model)) ?? profiles[0]
      const over = active
        ? {
            provider: active.provider,
            apiBase: active.apiBase,
            apiKey: active.apiKey,
            model: active.models.includes(form.model) ? form.model : (active.models[0] ?? form.model)
          }
        : { provider: form.provider, apiBase: form.apiBase, apiKey: form.apiKey, model: form.model }
      await onSave({ ...form, profiles })
      const r = await window.api.testLLM(over)
      if (r.ok) {
        const bal = r.balance ? `，余额 ${r.balance.currency === 'CNY' ? '¥' : r.balance.currency + ' '}${r.balance.amount}` : ''
        setLlmTest(`✓ 连接成功：${r.model}（${r.latencyMs}ms）${bal}`)
      } else {
        setLlmTest(`✗ ${r.error ?? '连接失败'}`)
      }
    } catch(error) {
      setLlmTest(`✗ 测试失败：${String(error).slice(0,120)}`)
    } finally {
      setBusy(false)
    }
  }

  const testEmbed = async (): Promise<void> => {
    setBusy(true);setEmbedTest('测试中…')
    try {
      await onSave({ ...form, profiles })
      const r = await window.api.testEmbed()
      setEmbedTest(r.ok ? `✓ 嵌入正常，向量维度 ${r.dim}` : `✗ ${r.error ?? '失败'}`)
    } catch(error) {
      setEmbedTest(`✗ 测试失败：${String(error).slice(0,120)}`)
    } finally {
      setBusy(false)
    }
  }

  const rebuild = async (): Promise<void> => {
    setBusy(true)
    try {
      await onSave({ ...form, profiles })
      await window.api.rebuildIndex()
      setMsg('已清空索引并开始重建，可关闭本窗口')
    } catch(error) {
      setMsg(`✗ 索引重建启动失败：${String(error).slice(0,120)}`)
    } finally {
      setBusy(false)
    }
  }

  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      const active = profiles.find((p) => p.models.includes(form.model)) ?? profiles[0]
      await onSave({
        ...form,
        profiles,
        ...(active ? { provider: active.provider, apiBase: active.apiBase, apiKey: active.apiKey, models: active.models } : {})
      })
      if (profileSaveTimer.current) {
        clearTimeout(profileSaveTimer.current)
        profileSaveTimer.current = null
      }
      onClose()
    } catch(error) {
      setMsg(`✗ 设置保存失败：${String(error).slice(0,140)}`)
      setBusy(false)
    }
  }
  saveRef.current = save
  const closeAndSave = (): void => {
    if(busy){ onClose(); return }
    void save()
  }

  const addFromPreset = (preset: ProviderPreset): void => {
    setProfiles((list) => {
      const next = [...list, { id:'profile-'+Date.now().toString(36)+Math.random().toString(36).slice(2,6),provider: preset.id, apiBase: preset.base, apiKey: '', models: [...preset.models] }]
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
    setBusy(true)
    try {
      const r = await window.api.exportMobilePack()
      if (r) setMsg(`已导出 ${r.papers} 篇 · ${Math.round(r.bytes / 1024)} KB`)
    } catch(error) {
      setMsg(`✗ 移动端数据包导出失败：${String(error).slice(0,120)}`)
    } finally {
      setBusy(false)
    }
  }

  // 浏览器扩展一键装载：自动打开对应浏览器的扩展管理页，扩展目录路径已进剪贴板
  const installGuide = async (browser: 'chrome' | 'edge'): Promise<void> => {
    const name = browser === 'chrome' ? 'Chrome' : 'Edge'
    try {
      const r = await window.api.extInstallGuide(browser)
      if (r.ok) {
        setExtMsg((m) => ({ ...m, [browser]: `✓ 已打开 ${name} 扩展管理页：开启右上角「开发者模式」→「加载已解压的扩展程序」→ 粘贴路径` }))
      } else {
        setExtMsg((m) => ({ ...m, [browser]: `✗ ${r.error ?? `未能启动 ${name}，可先「打开扩展文件夹」手动装载`}` }))
      }
    } catch (err) {
      setExtMsg((m) => ({ ...m, [browser]: `✗ ${String(err).slice(0, 120)}` }))
    }
  }

  const mergeMobile = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await window.api.mergeMobileNotes()
      if (r) {
        setMsg(`已合并：标注 ${r.mergedHighlights} 条 · 状态 ${r.mergedStatus} 项`)
        onRescanned()
      }
    } catch(error) {
      setMsg(`✗ 移动端数据合并失败：${String(error).slice(0,120)}`)
    } finally {
      setBusy(false)
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
                <div className="section-title" style={{ marginTop: 24 }}>数据存储位置</div>
                <div className="ws-row">
                  <div className="ws-icon">💽</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="ws-name ellipsis" title={dataDir}>{dataDir}</div>
                    <div className="hint">数据库、索引与设置所在位置；更改后自动迁移，重启生效。</div>
                  </div>
                  <button className="btn ghost" onClick={() => void changeDataDir()}>更改…</button>
                </div>
                <div className="section-title" style={{ marginTop: 24 }}>导入与窗口</div>
                <div className="field">
                  <label>导入重命名模板</label>
                  <input
                    value={form.renameTemplate ?? ''}
                    placeholder="{author}_{year}_{title}"
                    onChange={(e) => set({ renameTemplate: e.target.value })}
                  />
                  <div className="hint">{'导入 PDF 时按模板重命名文件，可用占位符 {author} {year} {title}；留空保持原文件名。'}</div>
                </div>
                <label className="set-check">
                  <input
                    type="checkbox"
                    checked={!!form.closeToTray}
                    onChange={(e) => set({ closeToTray: e.target.checked })}
                  />
                  关闭窗口时最小化到系统托盘
                </label>
                <div className="hint" style={{ marginTop: 4 }}>开启后点关闭只是隐藏到托盘（托盘图标右键退出），导入与索引不中断。</div>
                <div className="hint" style={{ marginTop: 12 }}>
                  💡 已有 Zotero 文献库？「文件 → 从 Zotero 导入」一键迁移；知网题录用「文件 → 导入题录文件」。
                </div>
              </div>
            )}

            {sec === 'translators' && (
              <div className="section set-translators">
                <div className="section-title">抓取脚本（对标 Zotero Translators）</div>
                <div className="set-translators-tools">
                  <button className="btn ghost" onClick={() => void window.api.translatorsOpenDir()}>
                    打开脚本目录
                  </button>
                  <button className="btn ghost" onClick={() => void reloadScripts()}>
                    重新加载
                  </button>
                </div>
                <div className="set-translators-list">
                  {scripts.length === 0 && <div className="hint">没有加载到脚本。内置脚本随应用发布；也可把自制 .json 脚本放进数据目录的 translators/ 文件夹。</div>}
                  {scripts.map((s) => (
                    <div key={s.id} className={`set-translators-row ${s.disabled ? 'off' : ''}`}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="set-translators-name">
                          <span className="ellipsis" title={`${s.name}（${s.id}）`}>
                            {s.name}
                          </span>
                          <span className={`set-translators-badge ${s.source === 'user' ? 'user' : ''}`}>{s.source === 'builtin' ? '内置' : '用户'}</span>
                          <span className="set-translators-badge">{s.type === 'search' ? '检索' : '网页抓取'}</span>
                        </div>
                        <div className="set-translators-sub ellipsis" title={s.matches.join(' · ')}>
                          {s.matches.length ? s.matches.join(' · ') : s.note ?? '通用站点'}
                        </div>
                      </div>
                      <button
                        className={`set-switch ${s.disabled ? '' : 'on'}`}
                        title={s.disabled ? '已停用，点击启用' : '已启用，点击停用'}
                        onClick={() => toggleScript(s)}
                      />
                    </div>
                  ))}
                </div>
                <div className="hint" style={{ marginTop: 12 }}>
                  把 .json 抓取脚本放进数据目录的 translators/ 文件夹即自动生效（热加载，免重启）；停用的脚本不参与匹配与在线检索。
                  {scriptDir && (
                    <>
                      {' '}
                      脚本目录：<span className="set-mono" title={scriptDir}>{scriptDir}</span>
                    </>
                  )}
                  格式文档见 docs/translators.md。
                </div>
              </div>
            )}

            {sec === 'cites' && (
              <div className="section set-cites">
                <div className="section-title">已安装样式</div>
                <div className="set-cites-list">
                  {styles.length === 0 && <div className="hint">还没有安装样式，可从下方官方样式库按需下载。</div>}
                  {styles.map((st) => (
                    <div key={st.id} className="set-cites-row">
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="set-cites-name ellipsis">
                          {st.name}
                          {st.kind === 'builtin' && <span className="set-translators-badge">内置</span>}
                        </div>
                        <div className="set-cites-id ellipsis" title={st.id}>
                          {st.id}
                        </div>
                      </div>
                      {st.kind === 'csl' && (
                        <button className="set-cites-del" title="从本机删除该样式" onClick={() => void removeStyle(st.id)}>
                          删除
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <div className="set-cites-tools">
                  <button className="btn ghost" onClick={() => void importStyleFile()}>
                    导入 .csl 文件…
                  </button>
                </div>

                <div className="section-title" style={{ marginTop: 20 }}>从样式库添加</div>
                <div className="set-cites-catalog">
                  <input
                    placeholder="搜索样式名，如 apa / chinese / nature…"
                    value={cslQ}
                    onChange={(e) => setCslQ(e.target.value)}
                  />
                  {cslSearching && <div className="hint">搜索中…</div>}
                  {!cslSearching && cslIds.length > 0 && (
                    <div className="set-cites-ids">
                      {cslIds.map((id) => (
                        <button key={id} className="set-cites-id-chip" title={`下载并安装 ${id}`} disabled={cslBusy} onClick={() => void downloadStyle(id)}>
                          {id}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="hint">官方 CSL 样式库共 10000+ 样式，按需下载到本机；装好的样式会出现在上面「已安装样式」里。</div>
                </div>

                <div className="set-cites-engine">
                  <span className="set-cites-engine-ic">⚙️</span>
                  {engine?.downloaded ? (
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="set-cites-name">citeproc 引擎已就绪</div>
                      <div className="hint">完整 CSL 样式由外部引擎在本机渲染（{fmtSize(engine.size)}，已下载到数据目录）。</div>
                    </div>
                  ) : (
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="set-cites-name">外部 citeproc 引擎未下载</div>
                      <div className="hint">完整 CSL 样式需要外部 citeproc 引擎（CPAL/AGPL 许可组件，不随 CSPAPER 分发；点击后从 jsDelivr 下载到本机数据目录运行）。</div>
                    </div>
                  )}
                  {!engine?.downloaded && (
                    <button className="btn ghost" disabled={cslBusy} onClick={() => void downloadEngine()}>
                      下载引擎
                    </button>
                  )}
                </div>
                {cslMsg && (
                  <div className="test-result" style={{ marginTop: 10 }}>
                    {cslMsg}
                  </div>
                )}
              </div>
            )}

            {sec === 'model' && modelTab === 'list' && (
              <div className="section">
                <div className="section-title" style={{ display: 'flex', alignItems: 'center' }}>
                  模型与服务商
                  <span style={{ flex: 1 }} />
                  <button className="btn ghost" style={{ padding: '4px 10px' }} onClick={() => setShowPicker(true)}>
                    <Icon.Plus size={12} /> 添加供应商
                  </button>
                </div>
                {/* 供应商列表（对标 Codex 式设置：一行一供应商，状态点 + 模型数 + 启用徽标） */}
                <div className="prov-list">
                  {profiles.map((pf, i) => {
                    const isActive = pf.models.includes(form.model)
                    const preset = ALL_PROVIDERS.find((p) => p.id === pf.provider)
                    return (
                      <button key={i} className={`prov-row ${isActive ? 'active' : ''}`} onClick={() => setModelTab(i)}>
                        <span className="pv-avatar" style={{ background: preset?.color ?? '#64748b' }}>{preset?.logo ?? '⚙'}</span>
                        <span className="prov-name ellipsis">{preset?.name ?? pf.provider}</span>
                        <span className="prov-models ellipsis">{pf.models.slice(0, 2).join('、')}{pf.models.length > 2 ? ` +${pf.models.length - 2}` : ''}</span>
                        {isActive && <i className="dot ok" title="使用中" />}
                        <Icon.ChevronR size={13} />
                      </button>
                    )
                  })}
                  {profiles.length === 0 && <div className="tag-empty" style={{ padding: 24 }}>还没有配置——点右上「添加供应商」，粘贴 Key 即用</div>}
                </div>
                <div className="section-title" style={{ marginTop: 18 }}>推理</div>
                <div className="field-row">
                  <div className="field grow">
                    <label>思考深度（跟随当前模型档位；agent 与对话共用）</label>
                    <select
                      value={form.thinkingLevel ?? 'default'}
                      onChange={(e) => set({ thinkingLevel: e.target.value as Settings['thinkingLevel'] })}
                    >
                      {(() => {
                        const activeProfile=profiles.find((profile) => profile.models.includes(form.model))
                        const levels=activeProfile?.modelCaps?.[form.model]?.reasoningLevels ?? presetCaps(form.model)?.reasoningLevels ?? []
                        const options=['default',...levels,...(levels.includes(form.thinkingLevel??'')||!form.thinkingLevel?[]:[form.thinkingLevel!])]
                        return options.map((k) => (
                          <option key={k} value={k}>
                            {THINKING_LABEL[k] ?? k}
                          </option>
                        ))
                      })()}
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

            {sec === 'model' && modelTab !== 'list' && (() => {
              const i = modelTab as number
              const pf = profiles[i]
              if (!pf) return null
              const isActive = pf.models.includes(form.model)
              const preset = ALL_PROVIDERS.find((p) => p.id === pf.provider)
              const upd = (patch: Partial<{ provider: string; apiBase: string; apiKey: string; models: string[]; modelCaps: Record<string, import('./types').ModelCaps> }>): void =>
                setProfiles((list) => {
                  const next = list.map((x, idx) => (idx === i ? { ...x, ...patch } : x))
                  saveProfiles(next)
                  return next
                })
              return (
              <div className="section">
                <div className="section-title" style={{ display: 'flex', alignItems: 'center' }}>
                  <button className="btn ghost" style={{ padding: '3px 9px', marginRight: 10 }} onClick={() => setModelTab('list')}>←</button>
                  {preset?.name ?? pf.provider}
                  {isActive && <span className="active-tag" style={{ marginLeft: 10 }}>使用中</span>}
                  <span style={{ flex: 1 }} />
                  {profiles.length > 1 && (
                    <button
                      className="btn ghost"
                      style={{ padding: '3px 10px', color: '#b4443c' }}
                      onClick={() => {
                        void dlg.confirm({ title: `删除「${preset?.name ?? pf.provider}」配置？`, okText: '删除', danger: true }).then((ok) => {
                          if (!ok) return
                          setProfiles((list) => {
                            const next = list.filter((_, idx) => idx !== i)
                            saveProfiles(next)
                            return next
                          })
                          setModelTab('list')
                        })
                      }}
                    >
                      删除
                    </button>
                  )}
                </div>
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
                      <div className="field-row">
                      <div className="field">
                        <label>API Key</label>
                        <input type="password" value={pf.apiKey} onChange={(e) => upd({ apiKey: e.target.value })} placeholder="sk-…" />
                      </div>
                      <div className="field">
                        <label>模型（逗号分隔，或从服务端拉取）</label>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <input
                            list={`dl-models-${pf.apiBase}`}
                            value={pf.models.join(', ')}
                            onChange={(e) =>
                              upd({
                                models: e.target.value
                                  .split(/[,，]/)
                                  .map((s) => s.trim())
                                  .filter(Boolean)
                              })
                            }
                            placeholder="点「拉取列表」自动填入"
                          />
                          <datalist id={`dl-models-${pf.apiBase}`}>
                            {(fetchState[i]?.list ?? []).map((m) => (
                              <option key={m} value={m} />
                            ))}
                          </datalist>
                          <button
                            className="btn ghost"
                            style={{ flex: 'none', whiteSpace: 'nowrap' }}
                            disabled={fetchState[pf.apiBase]?.busy}
                            onClick={() => {
                              const baseKey = pf.apiBase
                              setFetchState((st) => ({ ...st, [baseKey]: { busy: true, list: st[baseKey]?.list ?? [], msg: '' } }))
                              void window.api
                                .fetchModels(pf.apiBase, pf.apiKey)
                                .then((list) => {
                                  // 回调按 apiBase 重新定位当前配置（期间列表可能被增删，下标会漂移）
                                  setProfiles((cur) => {
                                    const next = cur.map((x) => (x.apiBase === baseKey ? { ...x, models: [...new Set([...list, ...x.models])] } : x))
                                    saveProfiles(next)
                                    return next
                                  })
                                  setFetchState((st) => ({ ...st, [baseKey]: { busy: false, list, msg: `已拉取 ${list.length} 个模型并填入（输入框可继续补）` } }))
                                })
                                .catch((e2) => setFetchState((st) => ({ ...st, [baseKey]: { busy: false, list: st[baseKey]?.list ?? [], msg: String(e2).replace(/^Error: /, '').slice(0, 90) } })))
                            }}
                          >
                            {fetchState[pf.apiBase]?.busy ? '拉取中…' : '拉取列表'}
                          </button>
                        </div>
                        {fetchState[pf.apiBase]?.msg && <div className="test-result" style={{ marginTop: 4, fontSize: 11 }}>{fetchState[pf.apiBase].msg}</div>}
                      </div>
                      </div>
                      <div className="profile-foot">
                        {isActive ? (
                          <span className="active-tag">使用中</span>
                        ) : (
                          <span
                            className="profile-link"
                            onClick={() =>
                              set({
                                provider: pf.provider,
                                apiBase: pf.apiBase,
                                // 该配置没填 Key 时不覆盖现有 Key（防误清空）
                                apiKey: pf.apiKey || form.apiKey,
                                model: pf.models[0] ?? form.model
                              })
                            }
                          >
                            启用此配置
                          </span>
                        )}
                        <span style={{ flex: 1 }} />
                      </div>
                {/* 模型能力编辑器（v0.16.2）：推理等级是模型自带档位，per-model 可视化编辑 */}
                <div className="section-title" style={{ marginTop: 20 }}>
                  模型能力 · {preset?.name ?? pf.provider}
                  <span className="ov-dim" style={{ fontWeight: 400, marginLeft: 8 }}>推理等级 = 模型自带档位（如 gpt-5.6 的 none/low/medium/high/xhigh/max），对话与 Work 的「推理」档位会映射到这里的词</span>
                </div>
                {pf.models.slice(0, 24).map((m) => {
                    // 预置库兜底：主流模型自动带出已知规格（编辑后存 modelCaps 覆盖）
                    const preset = presetCaps(m)
                    const caps = pf.modelCaps?.[m] ?? preset ?? { reasoningLevels: [] }
                    const isPreset = !pf.modelCaps?.[m] && !!preset
                    const updCaps = (patch: Partial<import('./types').ModelCaps>): void => {
                      upd({ modelCaps: { ...(pf.modelCaps ?? {}), [m]: { ...caps, ...patch } } } as Parameters<typeof upd>[0])
                    }
                    const isCur = form.model === m
                    return (
                      <div key={m} className={`mcaps ${isCur ? 'cur' : ''}`}>
                        <div className="mcaps-head">
                          <b>{m}</b>
                          {isCur && <span className="active-tag">当前</span>}
                          {isPreset && <span className="cat-count" title="来自内置模型能力库，可直接编辑覆盖">预置</span>}
                          <span style={{ flex: 1 }} />
                          <input
                            className="set-input"
                            style={{ width: 110 }}
                            placeholder="上下文 tokens"
                            value={caps.context ?? ''}
                            onChange={(e) => updCaps({ context: parseInt(e.target.value.replace(/\D/g, '')) || undefined })}
                          />
                          <input
                            className="set-input"
                            style={{ width: 110 }}
                            placeholder="最大输出"
                            value={caps.maxOutput ?? ''}
                            onChange={(e) => updCaps({ maxOutput: parseInt(e.target.value.replace(/\D/g, '')) || undefined })}
                          />
                        </div>
                        <div className="mcaps-row">
                          <span className="mcaps-k">输入</span>
                          {(['text', 'image', 'video', 'pdf'] as const).map((t) => {
                            const on = (caps.inputs ?? ['text']).includes(t)
                            return (
                              <button key={t} className={`wb-chip ${on ? 'on' : ''}`} style={on ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined} onClick={() => updCaps({ inputs: on ? (caps.inputs ?? ['text']).filter((x) => x !== t) : [...(caps.inputs ?? ['text']), t] })}>
                                {t === 'text' ? '文本' : t === 'image' ? '图片' : t === 'video' ? '视频' : 'PDF'}
                              </button>
                            )
                          })}
                          <span className="mcaps-k" style={{ marginLeft: 10 }}>能力</span>
                          {(['json', 'websearch', 'system'] as const).map((t) => {
                            const on = (caps.caps ?? []).includes(t)
                            return (
                              <button key={t} className={`wb-chip ${on ? 'on' : ''}`} style={on ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined} onClick={() => updCaps({ caps: on ? (caps.caps ?? []).filter((x) => x !== t) : [...(caps.caps ?? []), t] })}>
                                {t === 'json' ? '结构化输出' : t === 'websearch' ? '联网搜索' : '系统消息'}
                              </button>
                            )
                          })}
                        </div>
                        <div className="mcaps-row">
                          <span className="mcaps-k">推理等级</span>
                          {caps.reasoningLevels.map((lv, li) => (
                            <span key={li} className="wb-chip on" style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}>
                              {lv}
                              <button className="mcaps-x" title="删除该等级" onClick={() => updCaps({ reasoningLevels: caps.reasoningLevels.filter((_, j) => j !== li) })}>×</button>
                            </span>
                          ))}
                          <input
                            className="set-input"
                            style={{ width: 80 }}
                            placeholder="+ 等级"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                const v = e.currentTarget.value.trim()
                                if (v && !caps.reasoningLevels.includes(v)) updCaps({ reasoningLevels: [...caps.reasoningLevels, v] })
                                e.currentTarget.value = ''
                              }
                            }}
                          />
                          <span className="ov-dim">从低到高排列（如 low / high / max）</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })()}

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

            {sec === 'agent' && (
              <div className="section">
                <div className="section-title">智能体模型</div>
                <div className="hint" style={{ marginBottom: 10 }}>
                  科研工作台的 agent 建议绑定能力更强的模型（可与对话模型不同）。留空则使用上方「模型服务」的当前模型。
                </div>
                <select
                  className="set-input"
                  style={{ width: '100%', marginBottom: 12 }}
                  value={form.agentModel ?? ''}
                  onChange={(e) => set({ agentModel: e.target.value })}
                >
                  <option value="">（使用对话模型：{form.model || '未配置'}）</option>
                  {(form.models ?? []).map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <div className="section-title">执行护栏</div>
                <div className="set-row" style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ fontSize: 12.5 }}>单任务最大步数</span>
                  <input
                    className="set-input"
                    style={{ width: 90 }}
                    value={String(form.agentMaxSteps ?? 24)}
                    onChange={(e) => {
                      const v = parseInt(e.target.value.replace(/\D/g, ''), 10)
                      set({ agentMaxSteps: Math.max(4, Math.min(60, isNaN(v) ? 24 : v)) })
                    }}
                  />
                  <span className="hint">步数越多越彻底，也越耗时耗 token</span>
                </div>
                <div className="set-row" style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ fontSize: 12.5 }}>单任务超时（分钟）</span>
                  <input
                    className="set-input"
                    style={{ width: 90 }}
                    value={String(form.agentTimeoutMinutes ?? 10)}
                    onChange={(e) => {
                      const v = parseInt(e.target.value.replace(/\D/g, ''), 10)
                      set({ agentTimeoutMinutes: Math.max(1, Math.min(60, isNaN(v) ? 10 : v)) })
                    }}
                  />
                  <span className="hint">Work / 深度调研适用；普通问答仍保持 3 分钟保护</span>
                </div>
                <div className="section-title">MCP / 技能 / 自动化</div>
                <div className="hint">
                  三者的管理入口在 顶栏 Work → 左栏对应面板。MCP 服务器配置文件在数据目录 mcp.json；技能目录放入 .md 即热生效。
                </div>
              </div>
            )}
            {sec === 'zoterosync' && (
              <div className="section">
                <div className="section-title">Zotero 云端同步（Web API）</div>
                <div className="hint" style={{ marginBottom: 10 }}>
                  填入 Zotero 的 userId 与 apiKey（在 zotero.org/settings/keys 创建 key，同一页面顶部可见你的 userID），
                  即可云端全量/增量同步：条目、分类、标签、笔记、PDF 标注、附件与 CSL 题录自动入库。与「本地导入」并存。
                  增量同步会按版本更新远端改动过的条目（本地 PDF 不重复下载）；在文献详情面板可把本地高亮一键写回 Zotero。
                </div>
                <div className="set-row" style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                  <input
                    className="set-input"
                    style={{ flex: 1 }}
                    placeholder="Zotero userID（数字）"
                    value={form.zoteroUserId ?? ''}
                    onChange={(e) => set({ zoteroUserId: e.target.value.trim() })}
                  />
                  <input
                    className="set-input"
                    style={{ flex: 1 }}
                    type="password"
                    placeholder="Zotero apiKey"
                    value={form.zoteroApiKey ?? ''}
                    onChange={(e) => set({ zoteroApiKey: e.target.value.trim() })}
                  />
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button className="btn ghost" onClick={() => void verifyZotero()}>
                    验证连接
                  </button>
                  <button
                    className="btn ghost"
                    disabled={zotBusy || !(form.zoteroUserId && form.zoteroApiKey)}
                    onClick={() => void runZoteroSync('full')}
                    title="拉取全部条目（按 key 去重，已有条目自动跳过）"
                  >
                    立即全量同步
                  </button>
                  <button
                    className="btn ghost"
                    disabled={zotBusy || !(form.zoteroUserId && form.zoteroApiKey)}
                    onClick={() => void runZoteroSync('incremental')}
                    title="只拉取上次同步之后的变更"
                  >
                    增量同步
                  </button>
                  <span className="hint">{zotMsg || (zotLastSync ? `上次同步：${zotLastSync}` : '')}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
                  <input
                    type="checkbox"
                    id="zoteroAutoSync"
                    checked={!!form.zoteroAutoSync}
                    onChange={(e) => set({ zoteroAutoSync: e.target.checked })}
                  />
                  <label htmlFor="zoteroAutoSync" style={{ fontSize: 12.5, cursor: 'pointer' }}>
                    启动软件时自动执行增量同步（后台静默）
                  </label>
                </div>
                <div className="hint" style={{ marginTop: 10 }}>
                  同步结果自动入库：有 PDF 附件下载原文，无 PDF 生成题录页；标注与笔记写入文献的 md 笔记区。同步在后台执行，可关闭设置页。
                </div>
              </div>
            )}
            {sec === 'plugins' && (
              <div className="section">
                <div className="section-title">内置浏览器</div>
                <div className="ws-row">
                  <div className="ws-icon">🧭</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="ws-name">已内置 CSPAPER Connector——内置浏览器里直接右键保存文献，无需安装</div>
                    <div className="hint">打开内置浏览器：左侧模式栏「网页」。知网、万方、arXiv 等站点已备好快捷入口，保存的题录与 PDF 自动入库。</div>
                  </div>
                </div>

                <div className="section-title" style={{ marginTop: 22 }}>Chrome 一键安装</div>
                <div className="ws-row">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="ws-name">在系统 Chrome 里也能「右键保存到 CSPAPER」</div>
                    <div className="hint">点击后自动打开 Chrome 扩展管理页（需先开启右上角开发者模式），扩展文件夹路径已复制到剪贴板。</div>
                    {extMsg.chrome && (
                      <div className="hint" style={{ color: extMsg.chrome.startsWith('✗') ? 'var(--danger)' : 'var(--ok)' }}>
                        {extMsg.chrome}
                      </div>
                    )}
                  </div>
                  <button className="btn ghost" style={{ flexShrink: 0 }} onClick={() => void installGuide('chrome')}>
                    一键打开 Chrome 扩展页
                  </button>
                  <button className="btn ghost" style={{ flexShrink: 0 }} onClick={() => void window.api.extOpenFolder()}>
                    打开扩展文件夹
                  </button>
                </div>

                <div className="section-title" style={{ marginTop: 22 }}>Edge 一键安装</div>
                <div className="ws-row">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="ws-name">Edge 同样支持（Win11 自带，无需另装浏览器）</div>
                    <div className="hint">点击后自动打开 Edge 扩展管理页（需先开启左下角开发人员模式），扩展文件夹路径已复制到剪贴板。</div>
                    {extMsg.edge && (
                      <div className="hint" style={{ color: extMsg.edge.startsWith('✗') ? 'var(--danger)' : 'var(--ok)' }}>
                        {extMsg.edge}
                      </div>
                    )}
                  </div>
                  <button className="btn ghost" style={{ flexShrink: 0 }} onClick={() => void installGuide('edge')}>
                    一键打开 Edge 扩展页
                  </button>
                  <button className="btn ghost" style={{ flexShrink: 0 }} onClick={() => void window.api.extOpenFolder()}>
                    打开扩展文件夹
                  </button>
                </div>

                <div className="section-title" style={{ marginTop: 22 }}>Word / WPS</div>
                <div className="ws-row">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="ws-name">在 Word / WPS 里搜索并插入引文</div>
                    <div className="hint">Word 走加载项装载（约 30 秒，过程有步骤引导）；WPS 直接用网页版：搜索 → 生成参考文献 → 粘贴。使用前请确保 CSPAPER 桌面端正在运行。</div>
                  </div>
                  <button className="btn ghost" style={{ flexShrink: 0 }} onClick={() => void window.api.wordSideload()}>
                    安装到 Word（引导）
                  </button>
                  <button className="btn ghost" style={{ flexShrink: 0 }} onClick={() => void window.api.wpsOpenCite()}>
                    打开 WPS 引文助手
                  </button>
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
                  <div style={{ marginTop: 8 }}>
                    <button className="btn ghost" onClick={() => void window.api.dataOpen()}>
                      打开数据目录
                    </button>
                  </div>
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
            <button className="btn" onClick={() => void save()} disabled={busy}>{busy ? '处理中…' : '保存'}</button>

          </div>
        </div>

        {showPicker && (
          <div className="modal-mask picker-mask" onMouseDown={() => setShowPicker(false)}>
            <div className="modal picker" onMouseDown={(e) => e.stopPropagation()}>
              <div className="modal-head">
                <h2>添加服务商</h2>
                <button className="modal-x" title="关闭" onClick={() => setShowPicker(false)}>
                  <Icon.X size={13} />
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
