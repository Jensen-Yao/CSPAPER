const { app } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
app.whenReady().then(() => {
  try {
    const Database = require('better-sqlite3')
    const os = require('node:os')
    const dataDir = 'D:\Documents\Zotero doc'
    const sqlite = path.join(dataDir, 'zotero.sqlite')
    let tmp = null
    let db
    try {
      db = new Database(sqlite, { readonly: true, fileMustExist: true })
    } catch (e1) {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zot-enh-'))
      for (const suf of ['', '-wal']) { const s = sqlite + suf; if (fs.existsSync(s)) fs.copyFileSync(s, path.join(tmp, 'zotero.sqlite' + suf)) }
      db = new Database(path.join(tmp, 'zotero.sqlite'))
    }
    const PDF_TYPES = ['journalArticle','conferencePaper','preprint','report','thesis','book','bookSection','manuscript','document','dictionaryEntry','encyclopediaArticle']
    const rows = db.prepare(`SELECT i.itemID AS itemID, i.key AS key FROM items i JOIN itemTypes it ON it.itemTypeID=i.itemTypeID WHERE it.typeName IN (${PDF_TYPES.map(()=>'?').join(',')}) AND NOT EXISTS (SELECT 1 FROM deletedItems d WHERE d.itemID=i.itemID)`).all(...PDF_TYPES)
    const fieldStmt = db.prepare(`SELECT f.fieldName AS name, v.value AS value FROM itemData d JOIN fields f ON f.fieldID=d.fieldID JOIN itemDataValues v ON v.valueID=d.valueID WHERE d.itemID=?`)
    const tagStmt = db.prepare(`SELECT t.name AS name FROM itemTags it JOIN tags t ON t.tagID=it.tagID WHERE it.itemID=?`)
    const noteStmt = db.prepare(`SELECT n.note AS note FROM itemNotes n WHERE n.parentItemID=? AND NOT EXISTS (SELECT 1 FROM deletedItems d WHERE d.itemID=n.itemID)`)
    let withAbs = 0, withTags = 0, withNotes = 0, sample = null
    for (const row of rows) {
      const fields = {}; for (const f of fieldStmt.all(row.itemID)) fields[f.name] = f.value
      const tags = tagStmt.all(row.itemID).map(t => t.name)
      const notes = noteStmt.all(row.itemID).map(n => n.note.replace(/<[^>]*>/g, '').trim()).filter(Boolean)
      if (fields.abstractNote) withAbs++
      if (tags.length) withTags++
      if (notes.length) withNotes++
      if (!sample && fields.abstractNote && tags.length) sample = { title: (fields.title||'').slice(0, 40), tags, abs: (fields.abstractNote||'').slice(0, 60) }
    }
    console.log(JSON.stringify({ 条目: rows.length, 有摘要: withAbs, 有标签: withTags, 有子笔记: withNotes, 样例: sample }))
    db.close(); fs.rmSync(tmp, { recursive: true, force: true })
  } catch (e) { console.error('FAIL', String(e).slice(0, 200)) }
  app.exit(0)
})
