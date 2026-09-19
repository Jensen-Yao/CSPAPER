// 集成域 IPC（v0.7）：内置浏览器的保存入库 / 会话装配 + 浏览器与 Office 插件一键安装引导
import { app, ipcMain, shell, dialog, clipboard, session } from 'electron'
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { matchScript, runWeb, importTranslated, extractDoi } from '../translators'
import { getSettings } from '../db'
import { importPapers } from '../import'

// 内置浏览器扩展目录：开发态在项目 extension/，打包后经 extraResources 放 resources/extension
export function extensionDir(): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'extension') : path.join(app.getAppPath(), 'extension')
}

// 内置浏览器会话：独立分区（持久 cookie）+ 加载 CSPAPER Connector 扩展 + PDF 下载自动入库
export function setupWebSession(notify: (title: string, detail: string) => void): void {
  try {
    const ses = session.fromPartition('persist:cspaper-web')
    const extDir = extensionDir()
    if (fs.existsSync(path.join(extDir, 'manifest.json'))) {
      // Electron 原生支持 Chrome 扩展：内置浏览器里 Connector 的右键菜单与后台逻辑直接可用
      void ses.loadExtension(extDir).catch(() => {})
    }
    ses.on('will-download', (_e, item) => {
      const url = item.getURL()
      const isPdf = /\.pdf(\?|#|$)/i.test(url) || (item.getMimeType() || '').includes('pdf')
      if (!isPdf) {
        // 非 PDF 下载交给系统默认行为（存到下载目录）
        item.setSavePath(path.join(app.getPath('downloads'), item.getFilename()))
        return
      }
      item.cancel()
      void (async () => {
        try {
          const resp = await fetch(url, { signal: AbortSignal.timeout(60000), headers: { 'User-Agent': 'Mozilla/5.0 CSPAPER' } })
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
          const buf = Buffer.from(await resp.arrayBuffer())
          if (buf.length < 1024) throw new Error('下载内容为空')
          const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cspaper-web-')), 'paper.pdf')
          fs.writeFileSync(tmp, buf)
          // 有匹配的抓取脚本就带上权威题录，否则按文件名导入
          const s = matchScript(url)
          let slug: string | undefined
          if (s) {
            const r = await runWeb(s, url)
            if (r.ok && r.csl) {
              const imp = await importTranslated({ csl: r.csl, pdfPath: tmp, origin: url }, () => {})
              slug = imp.slug
            }
          }
          if (!slug) {
            const fb = decodeURIComponent(url.split('/').pop() ?? 'paper').replace(/\.pdf.*$/i, '').replace(/[<>:"/\\|?*]/g, ' ').slice(0, 80) || '网页 PDF'
            const outcomes = await importPapers([{ path: tmp, category: 'inbox', meta: { title: fb } }], () => {})
            slug = outcomes.find((o) => o.ok)?.slug
          }
          if (slug) notify('已从内置浏览器保存文献', `《${slug}》入库成功`)
          else notify('保存失败', 'PDF 已下载但入库失败，可手动拖入窗口')
        } catch (err) {
          notify('PDF 下载失败', String(err).slice(0, 120))
        }
      })()
    })
  } catch {
    /* 会话装配失败不影响主程序 */
  }
}

function registerIntegrateIpc(): void {
  // 内置浏览器「保存此页」：脚本抓取 → 题录入库（无 PDF 自动生成题录页）
  ipcMain.handle('web:save-page', (_e, url: string, category?: string) => {
    const target = String(url ?? '').trim()
    if (!/^https?:\/\//i.test(target)) return { ok: false, error: '不是有效网址' }
    const doi = extractDoi(target)
    const script = matchScript(doi ? `https://doi.org/${doi}` : target)
    if (!script) return { ok: false, matched: false, error: '没有匹配的抓取脚本（可在设置 → 在线获取 查看脚本列表）' }
    void (async () => {
      const r = await runWeb(script, doi ? `https://doi.org/${doi}` : target)
      if (!r.ok) return
      const imp = await importTranslated({ csl: r.csl!, pdfPath: r.pdfPath, category, origin: target }, () => {})
      if (imp.ok) dialog.showMessageBox({ message: '已保存到文献库', detail: `《${String((r.csl as { title?: string }).title ?? '').slice(0, 80)}》\n分类：${getSettings().libraryPath ? '见库内' : ''}（${script.name}）` })
      else dialog.showMessageBox({ message: '保存失败', detail: imp.error ?? '' })
    })()
    return { ok: true, matched: true, translator: script.name }
  })

  // 打开扩展文件夹（引导装载到外部浏览器）：路径自动进剪贴板
  ipcMain.handle('ext:open-folder', () => {
    const dir = extensionDir()
    if (!fs.existsSync(dir)) return false
    clipboard.writeText(dir)
    void shell.openPath(dir)
    return true
  })

  // 一键打开 Chrome / Edge 的扩展管理页（企业策略外无法静默装 unpacked，引导到 3 步装载）
  ipcMain.handle('ext:install-guide', (_e, browser: 'chrome' | 'edge') => {
    const pf = process.env['ProgramFiles'] ?? 'C:\\Program Files'
    const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
    const lad = process.env['LOCALAPPDATA'] ?? ''
    const candidates =
      browser === 'chrome'
        ? [path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'), path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'), path.join(lad, 'Google', 'Chrome', 'Application', 'chrome.exe')]
        : [path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe')]
    const exe = candidates.find((c) => fs.existsSync(c))
    if (!exe) return { ok: false, found: false, error: `未找到 ${browser === 'chrome' ? 'Chrome' : 'Edge'}（可手动打开扩展管理页）` }
    try {
      spawn(exe, [browser === 'chrome' ? 'chrome://extensions' : 'edge://extensions'], { detached: true, stdio: 'ignore' }).unref()
      clipboard.writeText(extensionDir())
      return { ok: true, found: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  // Word 加载项 sideload 引导：打开清单目录 + 步骤说明（Office 要求用户确认一次）
  ipcMain.handle('word:sideload', () => {
    const dir = path.join(app.getAppPath(), 'word-addon')
    if (!fs.existsSync(path.join(dir, 'manifest.xml'))) return { ok: false, error: '未找到 word-addon/manifest.xml' }
    clipboard.writeText(path.join(dir, 'manifest.xml'))
    dialog.showMessageBox({
      type: 'info',
      title: '安装 Word / WPS 引文插件',
      message: 'Word 加载项装载（约 30 秒）',
      detail:
        '清单路径已复制到剪贴板。\n\n' +
        '【Word】\n' +
        '1. 打开 Word → 插入 → 获取加载项\n' +
        '2. 左下「更多加载项」→「我的加载项」→「共享文件夹」\n' +
        '3. 若列表为空：信任中心 → 受信任的加载项目录 → 目录网址填清单所在文件夹路径，勾选「显示在菜单中」\n' +
        '4. 选中 CSPAPER 引文 → 添加。确保 CSPAPER 桌面端正在运行（本地服务 127.0.0.1:24517）\n\n' +
        '【WPS 文字】\n' +
        '直接使用引文助手网页：搜索文献 → 生成参考文献 → 复制粘贴（帮助菜单里也有一键入口）。\n\n' +
        '点「确定」将打开 word-addon 文件夹。'
    }).then(() => shell.openPath(dir))
    return { ok: true }
  })

  ipcMain.handle('wps:open-cite', () => {
    shell.openExternal('http://127.0.0.1:24517/cite-ui')
    return true
  })
}

export { registerIntegrateIpc }
