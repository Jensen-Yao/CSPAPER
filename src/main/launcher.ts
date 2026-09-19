// 数据目录引导：优先级 环境变量 > 引导文件（AppData/CSPAPER/launcher.json）> 默认（AppData/cspaper）。
// 引导文件让用户能把数据库/索引迁出 C 盘；更改后写引导文件并迁移数据，重启生效。
import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'

export const LAUNCHER_DIR = path.join(app.getPath('appData'), 'CSPAPER')
export const LAUNCHER_FILE = path.join(LAUNCHER_DIR, 'launcher.json')

function readLauncherDataDir(): string | null {
  try {
    const j = JSON.parse(fs.readFileSync(LAUNCHER_FILE, 'utf8')) as { dataDir?: string }
    return typeof j.dataDir === 'string' && j.dataDir.trim() ? j.dataDir.trim() : null
  } catch {
    return null
  }
}

export function applyDataDir(): void {
  const launcherDataDir = readLauncherDataDir()
  if (process.env.CSPAPER_DATA_DIR) {
    app.setPath('userData', path.resolve(process.env.CSPAPER_DATA_DIR))
  } else if (launcherDataDir) {
    app.setPath('userData', launcherDataDir)
  } else {
    app.setPath('userData', path.join(app.getPath('appData'), 'cspaper'))
  }
}

// 项目曾用名 PaperLens：检测到旧版数据目录/数据库时自动改名迁移，老用户数据无缝延续
export function migrateLegacyData(): void {
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
