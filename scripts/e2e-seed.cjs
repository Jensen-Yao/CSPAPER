// e2e 种子脚本：在临时数据目录预置设置（electron 环境运行）
const { app } = require('electron')
const path = require('path')
app.whenReady().then(() => {
  const dataDir = process.argv[2]
  app.setPath('userData', dataDir)
  const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'))
  const db = new Database(path.join(dataDir, 'cspaper.db'))
  db.exec("CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);")
  const settings = {
    setupDone: true,
    libraryPath: 'F:/tmp/cspaper-sample',
    apiBase: 'http://127.0.0.1:9390/v1',
    apiKey: 'mock-key',
    model: 'mock-model',
    provider: 'custom',
    agentModel: 'mock-model',
    agentMaxSteps: 12,
    embedProvider: 'local',
    translateTarget: '中文',
    theme: 'light'
  }
  db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES('settings',?)").run(JSON.stringify(settings))
  console.log('SEEDED')
  app.exit(0)
})
