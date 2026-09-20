import { app, BrowserWindow, nativeImage, nativeTheme, Tray, Menu } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import * as dbmod from './db'
import { buildIndex, isIndexRunning, indexNeedsRebuild } from './ingest'
import { startBridge } from './bridge'
import { bridgeStatus } from './bridge'
import { applyDataDir, migrateLegacyData } from './launcher'
import { registerPapersIpc } from './ipc/papers'
import { registerAiIpc } from './ipc/ai'
import { registerEcoIpc } from './ipc/eco'
import { registerTranslatorsIpc } from './ipc/translators'
import { registerCiteIpc } from './ipc/cite'
import { registerExtraIpc } from './ipc/extra'
import { registerKnowledgeIpc } from './ipc/extra'
import { registerIntegrateIpc, setupWebSession } from './ipc/integrate'

let win: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false

function send(ev: string, payload: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(ev, payload)
}

// ---------- 工作区重扫描：iCloud/网盘可能随时从别的设备同步来新文献 ----------
// 启动 / dock 重新激活 / 窗口聚焦（节流）/ 定时，都会扫描一遍；有变化才通知界面刷新
let lastScanAt = 0
function rescanLibrary(reason: string): void {
  const s = dbmod.getSettings()
  if (!s.libraryPath || !fs.existsSync(s.libraryPath)) return
  lastScanAt = Date.now()
  try {
    const r = dbmod.scanLibrary(s.libraryPath)
    console.log(`[scan:${reason}] 新增 ${r.added} 更新 ${r.updated} 共 ${r.total}`)
    if (r.added > 0 || r.updated > 0) send('papers:changed', { ids: [] })
    if (indexNeedsRebuild() && !isIndexRunning()) void buildIndex(send).catch((e) => console.error('[index]', e))
  } catch (e) {
    console.error('[scan]', e)
  }
}
function maybeRescan(reason: string, minIntervalMs: number): void {
  if (Date.now() - lastScanAt < minIntervalMs) return
  rescanLibrary(reason)
}

// Windows/Linux 上窗口控制按钮由系统绘制在自绘顶栏右上角（titleBarOverlay），
// 颜色随应用主题同步；macOS 用隐藏标题栏 + 红绿灯。
function overlayColors(theme: string): { color: string; symbolColor: string } {
  const dark = theme === 'dark' || (theme !== 'light' && nativeTheme.shouldUseDarkColors)
  return dark ? { color: '#211d1e', symbolColor: '#ece7e9' } : { color: '#f6f4f2', symbolColor: '#241f21' }
}

function trayIcon(): Electron.NativeImage {
  const p = path.join(app.isPackaged ? process.resourcesPath : app.getAppPath(), 'build/icon.png')
  const img = nativeImage.createFromPath(p)
  if (img.isEmpty()) return nativeImage.createEmpty()
  // 托盘 16px 缩放；个别环境缩放得到空图时退回原图（Windows 会自行缩放）
  const small = img.resize({ width: 16, height: 16 })
  return small.isEmpty() ? img : small
}

// 常驻托盘（W10，对标 Keep Zotero）：开启「关闭时最小化到托盘」后点 X 不退出，插件仍可一键保存
function ensureTray(): void {
  if (tray) return
  try {
    tray = new Tray(trayIcon())
  } catch (e) {
    console.error('[tray] 创建失败:', String(e))
    return // 平台不支持托盘（个别 Linux 桌面）就静默跳过
  }
  tray.setToolTip('CSPAPER')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示主窗口', click: () => showMainWindow() },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          quitting = true
          app.quit()
        }
      }
    ])
  )
  tray.on('click', () => showMainWindow())
  console.log('[tray] 托盘图标已创建')
}

function showMainWindow(): void {
  if (!win || win.isDestroyed()) {
    createWindow()
    return
  }
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function createWindow(): void {
  const { screen } = require('electron') as typeof import('electron')
  const wa = screen.getPrimaryDisplay().workArea
  const w = Math.min(1560, wa.width - 16)
  const h = Math.min(960, wa.height - 8)
  win = new BrowserWindow({
    width: w,
    height: h,
    x: wa.x + Math.max(0, Math.floor((wa.width - w) / 2)),
    y: wa.y + Math.max(0, Math.floor((wa.height - h) / 2)),
    minWidth: 1080,
    minHeight: 640,
    backgroundColor: '#26221e',
    title: 'CSPAPER',
    // 开发态/Windows 任务栏与窗口图标（打包后由 electron-builder 的 build/icon 提供）
    icon: path.join(app.isPackaged ? process.resourcesPath : app.getAppPath(), 'build/icon.png'),
    titleBarStyle: process.platform === 'linux' ? 'default' : 'hidden',
    ...(process.platform === 'win32'
      ? { titleBarOverlay: { ...overlayColors('system'), height: 40 } }
      : process.platform === 'darwin'
        ? { trafficLightPosition: { x: 14, y: 13 } }
        : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  })
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
  // 窗口聚焦时重扫（节流 60s）：软件常驻后台时，云盘同步落地的新文献回到窗口就能看到
  win.on('focus', () => maybeRescan('focus', 60_000))
  // 关闭最小化到托盘（W10）：设置开启且非真正退出时隐藏窗口
  win.on('close', (e) => {
    // 托盘不存在时绝不藏窗（否则应用"消失"找不回）；仅当「关闭到托盘」开启且托盘已就绪时隐藏
    if (quitting || !tray || !dbmod.getSettings().closeToTray) return
    e.preventDefault()
    win!.hide()
  })
  win.on('closed', () => {
    win = null
  })
}

app.setName('CSPAPER')
// Windows 任务栏分组 / 托盘通知需要 AppUserModelId（与 appId 一致）
app.setAppUserModelId('com.jensenyao.cspaper')

applyDataDir()
migrateLegacyData()

app.whenReady().then(() => {
  dbmod.initDb()
  const ctx = {
    getWin: (): BrowserWindow | null => win,
    send,
    onThemeChanged: (theme: string): void => {
      if (process.platform === 'win32' && win && !win.isDestroyed()) {
        try {
          win.setTitleBarOverlay(overlayColors(theme))
        } catch {
          /* 旧系统不支持 */
        }
      }
    }
  }
  registerPapersIpc(ctx)
  registerAiIpc(ctx)
  registerEcoIpc(ctx)
  registerTranslatorsIpc(ctx)
  registerCiteIpc(ctx)
  registerExtraIpc({ send })
  registerKnowledgeIpc()
  registerIntegrateIpc()
  // 内置浏览器会话：独立分区 + Connector 扩展 + PDF 下载自动入库
  setupWebSession((title, detail) => send('app:notice', { title, detail }))
  createWindow()
  // 托盘常驻（W10）：图标占用极小，配合设置里的「关闭时最小化到托盘」使用
  ensureTray()
  // 本地桥接服务：浏览器插件 / Word·WPS 插件一键存文献、检索插引文
  startBridge((title, detail) => send('app:notice', { title, detail }))
  // macOS：Dock 图标与名字（打包后由 app bundle 提供，开发态手动设）
  if (process.platform === 'darwin') {
    try {
      const iconPng = path.join(app.getAppPath(), 'build/icon.png')
      const img = fs.existsSync(iconPng) ? nativeImage.createFromPath(iconPng) : null
      if (img && !img.isEmpty()) app.dock?.setIcon(img)
    } catch {
      /* Dock 图标设置失败不影响使用 */
    }
  }
  // 每次打开软件都重扫工作区：个人云（iCloud 等）多设备同步可能带来新文献
  rescanLibrary('startup')
  // 兜底定时扫描：应用长时间开着、窗口一直没重新聚焦的网盘同步场景
  setInterval(() => maybeRescan('timer', 4 * 60_000), 4 * 60_000)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    // macOS dock 图标被点开（相当于重新打开软件）时重扫
    rescanLibrary('activate')
  })
})

// 设置里开启/关闭「关闭时最小化到托盘」时同步创建/保留托盘
app.on('before-quit', () => {
  quitting = true
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
