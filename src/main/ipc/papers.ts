// 文献库域 IPC：库扫描/导入/移动/删除/右键菜单/分类/高亮/PDF 读取/索引/标签/阅读进度
import { ipcMain, dialog, shell, Menu, clipboard } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import * as dbmod from '../db'
import { buildIndex, isIndexRunning, indexNeedsRebuild } from '../ingest'
import { logReadTime } from '../stats'
import {
  importPapers,
  previewImport,
  movePaperToCategory,
  createCategory,
  deleteCategory,
  deletePaper,
  renamePaper,
  sanitizeCategoryName
} from '../import'
import type { IpcCtx } from './context'

export function registerPapersIpc(ctx: IpcCtx): void {
  const { send, getWin } = ctx

  ipcMain.handle('library:pick', async () => {
    const r = await dialog.showOpenDialog(getWin()!, { properties: ['openDirectory'], message: '选择工作区文件夹（论文存储结构由应用自动管理）' })
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

  // 阅读进度记忆与时长统计（W2/W7）：日表供统计仪表盘按月聚合
  ipcMain.on('papers:lastpage', (_e, id: number, page: number) => dbmod.setLastPage(id, page))
  ipcMain.on('papers:readtime', (_e, id: number, seconds: number) => {
    dbmod.addReadSeconds(id, seconds)
    try {
      logReadTime(id, seconds)
    } catch {
      /* 日表失败不影响主计数 */
    }
  })

  // ---------- 标签系统（W1） ----------
  ipcMain.handle('tags:list', () => dbmod.listTags())
  ipcMain.handle('tags:create', (_e, name: string, color?: string) => dbmod.createTag(String(name), color))
  ipcMain.handle('tags:rename', (_e, id: number, name: string) => dbmod.renameTag(id, String(name)))
  ipcMain.handle('tags:delete', (_e, id: number) => {
    dbmod.deleteTag(id)
    return true
  })
  ipcMain.handle('tags:set-color', (_e, id: number, color: string) => {
    dbmod.setTagColor(id, String(color))
    return true
  })
  ipcMain.handle('papers:tag-add', (_e, id: number, name: string, color?: string) => dbmod.addPaperTag(id, String(name), color))
  ipcMain.handle('papers:tag-remove', (_e, id: number, tagId: number) => {
    dbmod.removePaperTag(id, tagId)
    return true
  })
  ipcMain.handle('papers:tags-of', (_e, id: number) => dbmod.paperTags(id))

  // 添加文献（AI 自动归类）
  ipcMain.handle('papers:pick-import', async () => {
    const r = await dialog.showOpenDialog(getWin()!, {
      title: '选择要导入的 PDF 论文',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      properties: ['openFile', 'multiSelections']
    })
    return r.canceled ? [] : r.filePaths
  })
  ipcMain.handle('papers:pick-import-folder', async () => {
    const r = await dialog.showOpenDialog(getWin()!, {
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
    const win = getWin()
    if (!p || !win) return
    const libPapers = path.join(dbmod.getSettings().libraryPath, 'papers')
    const cats = dbmod.listCategoryNames().filter((c) => c !== p.category)
    const menu = Menu.buildFromTemplate([
      {
        label: '导出 PDF…',
        click: () => {
          void dialog
            .showSaveDialog(win, { defaultPath: `${p.title.slice(0, 60) || p.slug}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] })
            .then((r) => {
              if (r.canceled || !r.filePath) return
              try {
                fs.copyFileSync(p.path, r.filePath)
              } catch (err) {
                dialog.showMessageBox(win, { message: `导出失败：${String(err)}` })
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
        click: () => win.webContents.send('papers:rename-request', { id, title: p.title })
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
                dialog.showMessageBox(win, { message: `移动失败：${String(err)}` })
              }
            }
          })),
          ...(cats.length ? [{ type: 'separator' as const }] : []),
          {
            label: '新建分类并移入…',
            click: () => win.webContents.send('papers:move-new-request', { id, title: p.title })
          }
        ]
      },
      {
        label: '删除文献…',
        click: () => {
          const ok = dialog.showMessageBoxSync(win, {
            type: 'warning',
            title: '删除文献',
            message: `删除《${p.title.slice(0, 80) || p.slug}》？`,
            detail: '「移入废纸篓」同时删除磁盘文件（可从系统废纸篓找回）；「仅移出库」保留磁盘文件，文献从库中消失。',
            buttons: ['移入废纸篓', '仅移出库（保留文件）', '取消'],
            defaultId: 0,
            cancelId: 2,
            noLink: true
          })
          if (ok === 2) return
          deletePaper(id, { keepFiles: ok === 1 })
            .then(() => send('papers:changed', { ids: [] }))
            .catch((err) => dialog.showMessageBox(win, { message: `删除失败：${String(err)}` }))
        }
      }
    ])
    menu.popup({ window: win, x: Math.round(x), y: Math.round(y) })
  })

  // 文件区空白处右键：导入 / 新建分类
  ipcMain.on('library:blank-menu', (_e, x: number, y: number) => {
    const win = getWin()
    if (!win) return
    const menu = Menu.buildFromTemplate([
      { label: '导入 PDF 文献…', click: () => win.webContents.send('app:import-request', null) },
      { label: '新建分类…', click: () => win.webContents.send('category:create-request', null) }
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
    ctx.onThemeChanged?.(theme)
  })

  // 分类右键菜单：重命名 / 导出 / 删除（仅空分类）
  ipcMain.on('category:menu', (_e, cat: string, x: number, y: number) => {
    const win = getWin()
    if (!win) return
    const cnt = (dbmod.getDb().prepare('SELECT COUNT(*) AS n FROM papers WHERE category=?').get(cat) as { n: number }).n
    const menu = Menu.buildFromTemplate([
      {
        label: '重命名…',
        click: () => win.webContents.send('category:rename-request', cat)
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
                  dialog.showMessageBox(win, { message: String(err) })
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
    const win = getWin()
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
    const win = getWin()
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
}
