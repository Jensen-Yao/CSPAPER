// 验证冒烟数据目录里的 DB 迁移状态（electron 环境）：npx electron scripts/check-mig.cjs <dataDir>
const { app } = require('electron')
const fs = require('fs')
const path = require('path')

const dataDir = process.argv[2]
const resultFile = path.join(__dirname, '..', 'check-mig-result.txt')

app.whenReady().then(() => {
  const out = []
  try {
    const Database = require(path.join(__dirname, '..', 'node_modules', 'better-sqlite3'))
    const db = new Database(path.join(dataDir, 'cspaper.db'), { readonly: true })
    const cols = db.prepare('PRAGMA table_info(papers)').all().map((c) => c.name)
    out.push('migratedCols=' + ['doi', 'csl', 'last_page', 'read_seconds', 'file_mtime', 'md_size'].every((c) => cols.includes(c)))
    out.push('tagsTables=' + !!db.prepare("SELECT name FROM sqlite_master WHERE name='paper_tags'").get())
    out.push('settingsRow=' + !!db.prepare("SELECT value FROM meta WHERE key='settings'").get())
    db.close()
  } catch (e) {
    out.push('ERR ' + e.message)
  }
  fs.writeFileSync(resultFile, out.join('\n'))
  console.log(out.join('\n'))
  app.exit(0)
})
