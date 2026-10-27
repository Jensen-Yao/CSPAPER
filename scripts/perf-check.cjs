// 大库性能体检：向临时库插 5000 篇 + 2 万块向量，测 listPapers / hybridSearch（缓存前后）/ knowledgeGraph
const path = require('path')
process.env.CSPAPER_DATA_DIR = 'F:/tmp/cspaper-perf'
const fs = require('fs')
fs.mkdirSync('F:/tmp/cspaper-perf', { recursive: true })
const { initDb, getDb, listPapers } = require(path.join(__dirname, '../out/main/db.js'))
