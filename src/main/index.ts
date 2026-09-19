import { app, BrowserWindow, ipcMain, dialog, shell, Menu, clipboard, nativeImage, nativeTheme } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import * as dbmod from './db'
import { buildIndex, isIndexRunning, indexNeedsRebuild, hybridSearch, extractPagesCached } from './ingest'
import { chatStream, translateMessages, explainMessages, ragMessages, paperFullMessages, testLLM, type ChatMessage } from './llm'
import { freeTranslate } from './free-translate'
import { importPapers, previewImport, movePaperToCategory, createCategory, deleteCategory, deletePaper, renamePaper, sanitizeCategoryName } from './import'
import { embed } from './embed'
import { detectZoteroDataDir, previewZoteroForUi, importFromZotero, type ZoteroImportItem } from './zotero'
import { startBridge } from './bridge'
import { parseRecords, importRecords, type RecordEntry } from './records'
import { exportMobilePack, mergeMobileNotes } from './mobilepack'
import { listCompare, createCompare, deleteCompare, saveCompare, generateCells, summarizePaper, deepSearch, exportCompare, paperDetail, getMyNotesText, saveMyNotesText, knowledgeGraph, type CompareData } from './insight'
import { bridgeStatus } from './bridge'

let win: BrowserWindow | null = null

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
    backgroundColor: '#16171a',
    title: 'CSPAPER',
    titleBarStyle: process.platform === 'linux' ? 'default' : 'hidden',
    ...(process.platform === 'win32'
      ? { titleBarOverlay: { ...overlayColors('system'), height: 40 } }
      : process.platform === 'darwin'
        ? { trafficLightPosition: { x: 14, y: 13 } }
        : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
  // 窗口聚焦时重扫（节流 60s）：软件常驻后台时，云盘同步落地的新文献回到窗口就能看到
  win.on('focus', () => maybeRescan('focus', 60_000))
}

app.setName('CSPAPER')

// 数据目录：优先级 环境变量 > 引导文件（AppData/CSPAPER/launcher.json）> 默认（AppData/cspaper）。
// 引导文件让用户能把数据库/索引迁出 C 盘；更改后写引导文件并迁移数据，重启生效。
const LAUNCHER_DIR = path.join(app.getPath('appData'), 'CSPAPER')
const LAUNCHER_FILE = path.join(LAUNCHER_DIR, 'launcher.json')
function readLauncherDataDir(): string | null {
  try {
    const j = JSON.parse(fs.readFileSync(LAUNCHER_FILE, 'utf8')) as { dataDir?: string }
    return typeof j.dataDir === 'string' && j.dataDir.trim() ? j.dataDir.trim() : null
  } catch {
    return null
  }
}

const launcherDataDir = readLauncherDataDir()
if (process.env.CSPAPER_DATA_DIR) {
  app.setPath('userData', path.resolve(process.env.CSPAPER_DATA_DIR))
} else if (launcherDataDir) {
  app.setPath('userData', launcherDataDir)
} else {
  app.setPath('userData', path.join(app.getPath('appData'), 'cspaper'))
}

// 项目曾用名 PaperLens：检测到旧版数据目录/数据库时自动改名迁移，老用户数据无缝延续
function migrateLegacyData(): void {
  try {
    const oldDir = path.join(app.getPath('appData'), 'paperlens')
    const newDir = app.getPath('userData')
    if (path.resolve(oldDir) !== path.resolve(newDir) && fs.existsSync(oldDir) && !fs.existsSync(newDir)) {
      fs.renameSync(oldDir, newDir)
    }
    for (const suffix of ['', '-wal', '-shm']) {
      const oldDb = path.join(newDir, `paperlens.db${suffix}`)
      const newDb = path.join(newDir, `cspaper.db${suffix}`)
      if (fs.existsSync(oldDb) && !fs.existsSync(newDb)) fs.renameSync(oldDb, newDb)
    }
  } catch {
    /* 迁移失败按全新安装处理，不影响启动 */
  }
}
migrateLegacyData()

app.whenReady().then(() => {
  dbmod.initDb()
  registerIpc()
  createWindow()
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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

function registerIpc(): void {
  ipcMain.handle('settings:get', () => dbmod.getSettings())
  ipcMain.handle('settings:save', (_e, patch) => dbmod.saveSettings(patch))

  ipcMain.handle('library:pick', async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory'], message: '选择工作区文件夹（论文存储结构由应用自动管理）' })
    return r.canceled ? null : r.filePaths[0]
  })

  ipcMain.handle('library:scan', (_e, libPath?: string) => {
    const p = libPath ?? dbmod.getSettings().libraryPath
    const r = dbmod.scanLibrary(p)
    if (libPath) dbmod.saveSettings({ libraryPath: libPath })
    const pending = indexNeedsRebuild()
    if (pending && !isIndexRunning()) void buildIndex(send).catch((e) => console.error('[index]', e))
    return { ...r, indexing: pending }
  })

  ipcMain.handle('papers:list', () => dbmod.listPapers())
  ipcMain.handle('categories:list', () => dbmod.listCategoryNames())
  ipcMain.handle('papers:status', (_e, id: number, status: string) => dbmod.setStatus(id, status))

  // 添加文献（AI 自动归类）
  ipcMain.handle('papers:pick-import', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: '选择要导入的 PDF 论文',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      properties: ['openFile', 'multiSelections']
    })
    return r.canceled ? [] : r.filePaths
  })
  ipcMain.handle('papers:pick-import-folder', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: '选择文件夹（导入其中所有 PDF）',
      properties: ['openDirectory']
    })
    return r.canceled ? null : r.filePaths[0]
  })
  // 导入预检：逐篇 AI 识别推荐分类/标题（不落盘），弹窗展示给用户确认调整
  ipcMain.handle('papers:preview-import', (_e, paths: string[]) => previewImport(paths, send))
  ipcMain.handle('papers:import', async (_e, items: Array<{ path: string; category?: string }>) => {
    const outcomes = await importPapers(items, send)
    const r = dbmod.scanLibrary(dbmod.getSettings().libraryPath)
    if (indexNeedsRebuild() && !isIndexRunning()) void buildIndex(send).catch(() => {})
    send('papers:changed', { ids: outcomes.filter((o) => o.ok).map((o) => o.slug) }) // 兜底同步界面（弹窗收尾之外的路径）
    return { outcomes, scan: r }
  })
  ipcMain.handle('papers:rename', (_e, id: number, title: string) => {
    const r = renamePaper(id, String(title))
    // pvec 被清空 → 触发增量补嵌（只重嵌这一篇的整篇向量）
    if (indexNeedsRebuild() && !isIndexRunning()) void buildIndex(send).catch(() => {})
    send('papers:changed', { ids: [id] })
    return r
  })

  // Zotero 文献库迁移：探测数据目录 → 预览（只读副本，Zotero 开着也能读）→ 选择导入
  ipcMain.handle('zotero:detect', () => detectZoteroDataDir())
  ipcMain.handle('zotero:pick-dir', async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory'], message: '选择 Zotero 数据目录（内含 zotero.sqlite）' })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle('zotero:preview', (_e, dataDir?: string) => previewZoteroForUi(dataDir))
  ipcMain.handle('zotero:import', (_e, items: ZoteroImportItem[]) => importFromZotero(items, send))

  // 题录文件导入：RIS / EndNote(.enw) / CNKI 自定义格式 → 生成题录页入库（可后续替换为原文 PDF）
  ipcMain.handle('records:pick-parse', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: '选择题录文件（RIS / EndNote / CNKI 导出）',
      filters: [{ name: '题录文件', extensions: ['ris', 'enw', 'txt', 'ciw', 'bib'] }],
      properties: ['openFile']
    })
    if (r.canceled || !r.filePaths[0]) return null
    const entries = parseRecords(fs.readFileSync(r.filePaths[0], 'utf8'))
    return { file: path.basename(r.filePaths[0]), entries }
  })
  ipcMain.handle('records:import', (_e, entries: RecordEntry[], category: string) => importRecords(entries, category, send))

  // 移动端数据互导：导出 .cspack 数据包 / 合并手机端阅读数据
  ipcMain.handle('mobile:export-pack', async () => {
    const d = new Date()
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
    const r = await dialog.showSaveDialog(win!, {
      title: '导出移动端数据包',
      defaultPath: `CSPAPER-Mobile-${stamp}.cspack`,
      filters: [{ name: 'CSPAPER 数据包', extensions: ['cspack'] }]
    })
    if (r.canceled || !r.filePath) return null
    return exportMobilePack(r.filePath, send)
  })
  ipcMain.handle('mobile:merge-notes', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: '选择手机端导出的阅读数据',
      filters: [{ name: 'CSPAPER 阅读数据', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (r.canceled || !r.filePaths[0]) return null
    const result = mergeMobileNotes(r.filePaths[0])
    send('papers:changed', { ids: [] })
    return result
  })

  // 深度搜索：正文（FTS）+ 划词笔记
  ipcMain.handle('search:deep', (_e, q: string) => deepSearch(q))

  // AI 文献卡片小结 / AI 对比表格（可追溯引用）
  ipcMain.handle('papers:summarize', (_e, id: number) => summarizePaper(id))
  ipcMain.handle('compare:list', () => listCompare())
  ipcMain.handle('compare:create', (_e, title?: string) => createCompare(title))
  ipcMain.handle('compare:delete', (_e, id: number) => deleteCompare(id))
  ipcMain.handle('compare:save', (_e, id: number, data: CompareData) => saveCompare(id, data))
  ipcMain.handle('compare:generate', (_e, paperId: number, dimensions: string[]) => generateCells(paperId, dimensions, send))
  ipcMain.handle('compare:export', (_e, id: number, format: 'md' | 'csv') => exportCompare(id, format, win))
  ipcMain.handle('papers:detail', (_e, id: number) => paperDetail(id))
  ipcMain.handle('graph:data', () => knowledgeGraph())
  ipcMain.handle('notes:mine-get', (_e, id: number) => getMyNotesText(id))
  ipcMain.handle('notes:mine-save', (_e, id: number, text: string) => saveMyNotesText(id, text))
  ipcMain.handle('data:open', async () => {
    const r = await shell.openPath(app.getPath('userData'))
    return r === '' ? true : String(r)
  })
  // 更改数据存储目录：迁移当前数据（跳过缓存）+ 写引导文件，重启后生效
  ipcMain.handle('data:change-dir', async () => {
    const cur = app.getPath('userData')
    const r = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory', 'createDirectory'],
      message: '选择新的数据存储位置（将复制现有数据，重启后生效）'
    })
    if (r.canceled || !r.filePaths[0]) return null
    const target = path.resolve(r.filePaths[0])
    if (path.resolve(cur).toLowerCase() === target.toLowerCase()) return null
    fs.mkdirSync(target, { recursive: true })
    const skip = new Set(['Caches', 'GPUCache', 'Code Cache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'blob_storage', 'Crashpad'])
    for (const entry of fs.readdirSync(cur)) {
      if (skip.has(entry)) continue
      fs.cpSync(path.join(cur, entry), path.join(target, entry), { recursive: true, force: false })
    }
    fs.mkdirSync(LAUNCHER_DIR, { recursive: true })
    fs.writeFileSync(LAUNCHER_FILE, JSON.stringify({ dataDir: target }, null, 2))
    return target
  })
  ipcMain.handle('app:status', () => ({
    bridge: bridgeStatus(),
    papers: (dbmod.getDb().prepare('SELECT COUNT(*) AS n FROM papers').get() as { n: number }).n,
    categories: (dbmod.getDb().prepare("SELECT COUNT(DISTINCT category) AS n FROM papers").get() as { n: number }).n,
    version: app.getVersion(),
    dataDir: app.getPath('userData')
  }))

  // 手动归类：右键菜单 / 拖拽都走这里（移动文件夹 + 原地改写 DB，保留行身份）
  ipcMain.handle('papers:move', (_e, id: number, category: string) => {
    const libPapers = path.join(dbmod.getSettings().libraryPath, 'papers')
    const r = movePaperToCategory(id, String(category), libPapers)
    send('papers:changed', { ids: [id] })
    return r ? { ok: true, ...r } : { ok: false }
  })

  ipcMain.handle('category:create', (_e, name: string) => {
    const libPapers = path.join(dbmod.getSettings().libraryPath, 'papers')
    return createCategory(String(name), libPapers)
  })
  ipcMain.handle('category:delete', (_e, name: string) => {
    const libPapers = path.join(dbmod.getSettings().libraryPath, 'papers')
    return deleteCategory(String(name), libPapers)
  })

  // 最近打开时间（「最近」视图排序用）
  ipcMain.on('papers:opened', (_e, id: number) => dbmod.markOpened(id))

  // 右键菜单：导出 / 分享 / 移动归类
  ipcMain.on('papers:menu', (_e, id: number, x: number, y: number) => {
    const p = dbmod.getDb().prepare('SELECT id, slug, title, authors, year, venue, path, category FROM papers WHERE id=?').get(id) as
      | { id: number; slug: string; title: string; authors: string; year: number | null; venue: string; path: string; category: string }
      | undefined
    if (!p || !win) return
    const libPapers = path.join(dbmod.getSettings().libraryPath, 'papers')
    const cats = dbmod.listCategoryNames().filter((c) => c !== p.category)
    const menu = Menu.buildFromTemplate([
      {
        label: '导出 PDF…',
        click: () => {
          void dialog
            .showSaveDialog(win!, { defaultPath: `${p.title.slice(0, 60) || p.slug}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] })
            .then((r) => {
              if (r.canceled || !r.filePath) return
              try {
                fs.copyFileSync(p.path, r.filePath)
              } catch (err) {
                dialog.showMessageBox(win!, { message: `导出失败：${String(err)}` })
              }
            })
        }
      },
      { label: process.platform === 'win32' ? '在文件资源管理器中显示' : '在访达中显示', click: () => shell.showItemInFolder(p.path) },
      { label: '复制标题', click: () => clipboard.writeText(p.title) },
      {
        label: '复制引用',
        click: () => clipboard.writeText(`${p.title} (${p.year ?? 'n.d.'})`)
      },
      { type: 'separator' },
      {
        label: '导出标注笔记 (Markdown)…',
        click: () => void exportNotes(p, 'md')
      },
      {
        label: '导出标注笔记 (Word)…',
        click: () => void exportNotes(p, 'doc')
      },
      { type: 'separator' },
      {
        label: '重命名…',
        click: () => win!.webContents.send('papers:rename-request', { id, title: p.title })
      },
      {
        label: '移动到分类',
        submenu: [
          ...cats.map((c) => ({
            label: c,
            click: () => {
              try {
                movePaperToCategory(id, c, libPapers)
                send('papers:changed', { ids: [id] })
              } catch (err) {
                dialog.showMessageBox(win!, { message: `移动失败：${String(err)}` })
              }
            }
          })),
          ...(cats.length ? [{ type: 'separator' as const }] : []),
          {
            label: '新建分类并移入…',
            click: () => win!.webContents.send('papers:move-new-request', { id, title: p.title })
          }
        ]
      },
      {
        label: '删除文献…',
        click: () => {
          const ok = dialog.showMessageBoxSync(win!, {
            type: 'warning',
            title: '删除文献',
            message: `删除《${p.title.slice(0, 80) || p.slug}》？`,
            detail: '论文文件夹将移入系统废纸篓（可找回），阅读状态、高亮与索引一并清除。',
            buttons: ['移入废纸篓', '取消'],
            defaultId: 1,
            cancelId: 1,
            noLink: true
          })
          if (ok !== 0) return
          deletePaper(id)
            .then(() => send('papers:changed', { ids: [] }))
            .catch((err) => dialog.showMessageBox(win!, { message: `删除失败：${String(err)}` }))
        }
      }
    ])
    menu.popup({ window: win, x: Math.round(x), y: Math.round(y) })
  })

  // 文件区空白处右键：导入 / 新建分类
  ipcMain.on('library:blank-menu', (_e, x: number, y: number) => {
    if (!win) return
    const menu = Menu.buildFromTemplate([
      { label: '导入 PDF 文献…', click: () => win!.webContents.send('app:import-request', null) },
      { label: '新建分类…', click: () => win!.webContents.send('category:create-request', null) }
    ])
    menu.popup({ window: win, x: Math.round(x), y: Math.round(y) })
  })

  // 划词高亮持久化
  ipcMain.handle(
    'highlights:add',
    (_e, paperId: number, page: number, rects: Array<{ x: number; y: number; w: number; h: number }>, text: string, color?: string) => {
      const r = dbmod
        .getDb()
        .prepare('INSERT INTO highlights(paper_id,page,rects,text,color) VALUES(?,?,?,?,?)')
        .run(paperId, page, JSON.stringify(rects), text.slice(0, 500), color || 'yellow')
      return Number(r.lastInsertRowid)
    }
  )
  ipcMain.handle('highlights:list', (_e, paperId: number) =>
    (dbmod.getDb().prepare('SELECT id, page, rects, text, color FROM highlights WHERE paper_id=?').all(paperId) as Array<{
      id: number
      page: number
      rects: string
      text: string
      color: string
    }>).map((h) => ({ ...h, rects: JSON.parse(h.rects) }))
  )
  ipcMain.handle('highlights:delete', (_e, hid: number) => {
    dbmod.getDb().prepare('DELETE FROM highlights WHERE id=?').run(hid)
    return true
  })

  ipcMain.handle('pdf:read', (_e, pdfPath: string) => {
    const libSetting = dbmod.getSettings().libraryPath
    if (!libSetting) throw new Error('文献库未设置，请先在设置中选择工作区文件夹')
    const lib = path.resolve(libSetting)
    const abs = path.resolve(pdfPath)
    // Windows 路径大小写不敏感，统一小写后做前缀比较；分隔符由 resolve 归一化
    const norm = (p: string): string => (process.platform === 'win32' ? p.toLowerCase() : p)
    if (!norm(abs).startsWith(norm(lib) + path.sep) && norm(abs) !== norm(lib)) {
      throw new Error(`文件不在文献库内：${abs}`)
    }
    // 不预检 existsSync：iCloud/网盘占位文件在读取时会按需下载，预检反而拦掉
    try {
      return fs.readFileSync(abs)
    } catch {
      throw new Error(
        `无法读取（文件未同步到本机或已移动）：${abs}\n若是 iCloud / 网盘文献，请在文件管理器中右键对应文件夹选择「始终保留在此设备上」，同步完成后再试。`
      )
    }
  })

  // 渲染端主题变化时同步 Windows 标题栏 overlay 颜色
  ipcMain.on('ui:theme', (_e, theme: string) => {
    if (process.platform === 'win32' && win && !win.isDestroyed()) {
      try {
        win.setTitleBarOverlay(overlayColors(theme))
      } catch {
        /* 旧系统不支持 */
      }
    }
  })

  // 分类右键菜单：重命名 / 导出 / 删除（仅空分类）
  ipcMain.on('category:menu', (_e, cat: string, x: number, y: number) => {
    if (!win) return
    const cnt = (dbmod.getDb().prepare('SELECT COUNT(*) AS n FROM papers WHERE category=?').get(cat) as { n: number }).n
    const menu = Menu.buildFromTemplate([
      {
        label: '重命名…',
        click: () => win!.webContents.send('category:rename-request', cat)
      },
      {
        label: '导出该分类…',
        click: () => void exportCategory(cat)
      },
      ...(cnt === 0
        ? [
            {
              label: '删除该空分类',
              click: () => {
                const libPapers = path.join(dbmod.getSettings().libraryPath, 'papers')
                try {
                  deleteCategory(cat, libPapers)
                  send('papers:changed', { ids: [] })
                } catch (err) {
                  dialog.showMessageBox(win!, { message: String(err) })
                }
              }
            } as Electron.MenuItemConstructorOptions
          ]
        : [])
    ])
    menu.popup({ window: win, x: Math.round(x), y: Math.round(y) })
  })

  ipcMain.handle('category:rename', (_e, from: string, to: string) => {
    // 分类名允许中文（与新建/移动归类同一套清洗规则），只做文件系统安全清洗
    const toSlug = sanitizeCategoryName(String(to))
    if (!toSlug) throw new Error('名称无效')
    const lib = dbmod.getSettings().libraryPath
    const papersDir = path.join(lib, 'papers')
    const base = fs.existsSync(papersDir) ? papersDir : lib
    const eq = (a: string, b: string): boolean => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b)
    // 磁盘上属于该分类的所有目录（分类名 = 目录名去掉 NN- 编号前缀；历史操作可能分裂成多个）
    const catDirs = fs
      .readdirSync(base)
      .filter((d) => !d.startsWith('.') && fs.statSync(path.join(base, d)).isDirectory() && eq(d.replace(/^\d+-/, ''), from))
    if (catDirs.length === 0) throw new Error(`未找到分类「${from}」的文件夹（可能已被移动）`)
    const prefix = catDirs[0].match(/^(\d+-)/)?.[1] ?? ''
    const target = path.join(base, `${prefix}${toSlug}`)
    const db = dbmod.getDb()
    const updPath = db.prepare('UPDATE papers SET path=? WHERE id=?')
    const rows = db.prepare('SELECT id, path FROM papers WHERE category=?').all(from) as Array<{ id: number; path: string }>
    for (const dir of catDirs) {
      const src = path.join(base, dir)
      if (eq(dir, path.basename(target))) continue
      fs.mkdirSync(target, { recursive: true })
      // 逐个论文目录并入目标（重名自动加 -N 后缀）；同步改写 DB 行的 path，
      // 保留行身份——阅读状态/高亮不丢，也不会触发整批重新嵌入
      for (const entry of fs.readdirSync(src)) {
        let dest = path.join(target, entry)
        let k = 2
        while (fs.existsSync(dest)) dest = path.join(target, `${entry}-${k++}`)
        fs.renameSync(path.join(src, entry), dest)
        for (const row of rows) {
          if (eq(path.dirname(path.dirname(row.path)), src)) updPath.run(path.join(dest, path.basename(row.path)), row.id)
        }
      }
      try {
        fs.rmdirSync(src) // 内容已全部并入，删掉空壳；有残留就留给扫描
      } catch {
        /* 目录非空 */
      }
    }
    db.prepare('UPDATE papers SET category=? WHERE category=?').run(toSlug, from)
    const r = dbmod.scanLibrary(lib)
    return { renamed: toSlug, scan: r }
  })

  // 导出标注笔记：把划词高亮按页整理成 Markdown 或 Word(.doc，HTML 格式) 文档
  async function exportNotes(
    p: { id: number; title: string; authors: string; year: number | null; venue: string; slug: string },
    format: 'md' | 'doc'
  ): Promise<void> {
    if (!win) return
    const hs = dbmod.getDb().prepare('SELECT page, text FROM highlights WHERE paper_id=? ORDER BY page, id').all(p.id) as Array<{
      page: number
      text: string
    }>
    if (hs.length === 0) {
      dialog.showMessageBox(win, {
        message: `《${p.title.slice(0, 60) || p.slug}》还没有划词标注`,
        detail: '先在阅读器里选中文字点「高亮」，再来导出笔记。'
      })
      return
    }
    const base = `${p.title.slice(0, 60) || p.slug}-笔记`
    let savedPath = ''
    if (format === 'md') {
      const r = await dialog.showSaveDialog(win, { defaultPath: `${base}.md`, filters: [{ name: 'Markdown', extensions: ['md'] }] })
      if (r.canceled || !r.filePath) return
      savedPath = r.filePath
      const lines: string[] = [
        `# 《${p.title}》阅读笔记`,
        '',
        `- **作者:** ${p.authors || '（见原文）'}`,
        `- **发表:** ${p.venue || p.year || ''}`,
        `- **导出时间:** ${new Date().toLocaleString('zh-CN')}`,
        `- **标注数量:** ${hs.length}`,
        '',
        '## 划词标注',
        ''
      ]
      let page = 0
      for (const h of hs) {
        if (h.page !== page) {
          page = h.page
          lines.push('', `### 第 ${page} 页`, '')
        }
        lines.push(`> ${h.text.replace(/\n/g, '\n> ')}`, '')
      }
      fs.writeFileSync(r.filePath, lines.join('\n'), 'utf8')
    } else {
      const r = await dialog.showSaveDialog(win, { defaultPath: `${base}.doc`, filters: [{ name: 'Word 文档', extensions: ['doc'] }] })
      if (r.canceled || !r.filePath) return
      savedPath = r.filePath
      const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      const body: string[] = []
      let page = 0
      for (const h of hs) {
        if (h.page !== page) {
          page = h.page
          body.push(`<h3>第 ${page} 页</h3>`)
        }
        body.push(`<blockquote><p>${esc(h.text).replace(/\n/g, '<br>')}</p></blockquote>`)
      }
      const html =
        `<html><head><meta charset="utf-8"><title>${esc(p.title)}</title>` +
        `<style>body{font-family:"Microsoft YaHei",sans-serif;line-height:1.7}blockquote{border-left:3px solid #4a90d9;margin:8px 0;padding:4px 12px;background:#f5f8fc}</style>` +
        `</head><body><h1>《${esc(p.title)}》阅读笔记</h1>` +
        `<p><b>作者：</b>${esc(p.authors || '（见原文）')}　<b>发表：</b>${esc(p.venue || String(p.year ?? ''))}<br>` +
        `<b>导出时间：</b>${new Date().toLocaleString('zh-CN')}　<b>标注：</b>${hs.length} 条</p>` +
        `<h2>划词标注</h2>${body.join('\n')}</body></html>`
      fs.writeFileSync(r.filePath, html, 'utf8')
    }
    dialog.showMessageBox(win, { message: '标注笔记已导出', detail: savedPath })
  }

  async function exportCategory(cat: string): Promise<void> {
    const db = dbmod.getDb()
    const rows = db.prepare('SELECT path, slug FROM papers WHERE category=?').all(cat) as Array<{ path: string; slug: string }>
    if (!win) return
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], message: `选择导出「${cat}」的目标文件夹` })
    if (r.canceled || !r.filePaths[0]) return
    const destRoot = r.filePaths[0]
    let copied = 0
    for (const row of rows) {
      const srcDir = path.dirname(row.path)
      const destDir = path.join(destRoot, row.slug)
      try {
        fs.mkdirSync(destDir, { recursive: true })
        for (const f of fs.readdirSync(srcDir)) fs.copyFileSync(path.join(srcDir, f), path.join(destDir, f))
        copied++
      } catch (err) {
        console.error('[export]', row.slug, err)
      }
    }
    dialog.showMessageBox(win, { message: `已导出 ${copied}/${rows.length} 篇到 ${destRoot}` })
  }

  ipcMain.handle('index:status', () => {
    const total = dbmod.getDb().prepare('SELECT COUNT(*) AS n FROM papers').get() as { n: number }
    const done = dbmod.getDb().prepare('SELECT COUNT(*) AS n FROM papers WHERE indexed=1').get() as { n: number }
    const nChunks = dbmod.getDb().prepare('SELECT COUNT(*) AS n FROM chunks').get() as { n: number }
    return { papers: total.n, indexed: done.n, chunks: nChunks.n, running: isIndexRunning() }
  })
  ipcMain.handle('index:rebuild', async () => {
    dbmod.getDb().exec('DELETE FROM chunks; DELETE FROM chunks_fts; DELETE FROM papers_fts; UPDATE papers SET indexed=0, pvec=NULL')
    if (!isIndexRunning()) void buildIndex(send).catch((e) => send('index:error', String(e)))
    return true
  })
  ipcMain.on('index:start', () => {
    if (!isIndexRunning()) void buildIndex(send).catch((e) => send('index:error', String(e)))
  })

  // 连接测试：over = 渲染端当前编辑值（先保存再测会读到旧全局配置，正确 key 也测不过）
  ipcMain.handle('llm:test', (_e, over?: import('./llm').LlmEndpoint) => testLLM(over))
  ipcMain.handle('embed:test', async () => {
    try {
      const { dim } = await embed(['connection test'])
      return { ok: true, dim }
    } catch (err) {
      return { ok: false, error: String(err).slice(0, 300) }
    }
  })

  // LLM 流式：reqId 关联渲染端回调
  ipcMain.on(
    'llm:stream',
    async (
      _e,
      args: {
        reqId: number
        mode: 'chat' | 'translate' | 'explain' | 'rag'
        messages?: ChatMessage[]
        text?: string
        context?: string
        question?: string
        scopePaperId?: number
        category?: string
        paperTitle?: string
        history?: Array<{ role: 'user' | 'assistant'; content: string }>
      }
    ) => {
      try {
        let msgs: ChatMessage[]
        let sources: import('./ingest').RetrievedChunk[] = []
        if (args.mode === 'translate') {
          const s = dbmod.getSettings()
          // 免 Key 开箱即用：未配置 API Key 时划词翻译走免费通道，不要求用户先配模型
          if (!s.apiKey || !s.apiKey.trim()) {
            try {
              send(`llm:delta:${args.reqId}`, await freeTranslate(args.text!, s.translateTarget))
            } catch (err) {
              send(`llm:delta:${args.reqId}`, `⚠️ ${String(err)}`)
            }
            send(`llm:end:${args.reqId}`, null)
            return
          }
          msgs = translateMessages(args.text!, args.context ?? '', s.translateTarget)
        }
        else if (args.mode === 'explain') msgs = explainMessages(args.text!, args.context ?? '')
        else if (args.mode === 'rag') {
          if (args.scopePaperId) {
            // 整篇模式：完整论文正文进提示词（按页标记，引用为 [页码]）
            const paper = dbmod
              .getDb()
              .prepare('SELECT id, slug, title, path FROM papers WHERE id=?')
              .get(args.scopePaperId) as { id: number; slug: string; title: string; path: string } | undefined
            if (!paper) throw new Error('论文不存在')
            let pages: string[] = []
            try {
              pages = await extractPagesCached(paper.path)
            } catch {
              pages = []
            }
            if (pages.length > 0) {
              sources = pages.map((t, i) => ({ paperId: paper.id, slug: paper.slug, title: paper.title, page: i + 1, text: t, score: 1, snippet: '' }))
              msgs = paperFullMessages(args.question!, pages, paper.title, undefined, args.history)
            } else {
              sources = await hybridSearch(args.question!, args.scopePaperId, 10, args.category)
              msgs = ragMessages(args.question!, sources.map((s, i) => ({ label: `${s.title} (p.${s.page})`, text: s.text })), paper.title, args.history)
            }
          } else {
            sources = await hybridSearch(args.question!, undefined, 16, args.category)
            if (sources.length === 0) {
              send(`llm:delta:${args.reqId}`, '⚠️ 检索不到相关片段（可能索引尚未建好），请先重建索引。')
              send(`llm:end:${args.reqId}`, null)
              return
            }
            msgs = ragMessages(
              args.question!,
              sources.map((s, i) => ({ label: `${s.title} (p.${s.page})`, text: s.text })),
              args.paperTitle,
              args.history
            )
          }
        } else msgs = args.messages ?? []

        for await (const delta of chatStream(msgs)) send(`llm:delta:${args.reqId}`, delta)
        if (args.mode === 'rag')
          send(
            `llm:sources:${args.reqId}`,
            sources.map((s, i) => ({ n: i + 1, slug: s.slug, title: s.title, page: s.page, snippet: s.snippet || undefined }))
          )
        send(`llm:end:${args.reqId}`, null)
      } catch (err) {
        send(`llm:delta:${args.reqId}`, `\n\n❌ ${String(err)}`)
        send(`llm:end:${args.reqId}`, null)
      }
    }
  )

  ipcMain.on('open-external', (_e, url: string) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
  })
}
