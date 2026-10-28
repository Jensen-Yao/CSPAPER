import fs from 'node:fs'
import path from 'node:path'
import { getDb, getSettings, getExtraCats, setExtraCats } from './db'
import { isWithinDirectory, normalizePath } from './paper-files'

/** Plan moves first, then update exact descendants. Compensate file moves on DB failure. */
export function renameLibraryCategory(from: string, to: string): { renamed: string } {
  const db = getDb(), library = getSettings().libraryPath
  const root = fs.existsSync(path.join(library, 'papers')) ? path.join(library, 'papers') : library
  const sources = fs.readdirSync(root, {withFileTypes:true}).filter(e=>e.isDirectory() && !e.name.startsWith('.') && e.name.replace(/^\d+-/,'')===from).map(e=>path.join(root,e.name))
  if (!sources.length) throw new Error('该分类目录已不存在，请刷新文献库')
  const target = path.join(root,(path.basename(sources[0]).match(/^\d+-/)?.[0] || '')+to)
  if (!isWithinDirectory(target,root) || normalizePath(target)===normalizePath(root)) throw new Error('分类路径无效')
  if (sources.length===1 && normalizePath(sources[0])===normalizePath(target)) return {renamed:to}
  const moves:Array<{from:string;to:string}>=[], reserved=new Set<string>()
  for(const source of sources) for(const entry of fs.readdirSync(source)) {
    const original=path.join(source,entry)
    let dest=path.join(target,entry),n=2
    while(fs.existsSync(dest)||reserved.has(normalizePath(dest))) dest=path.join(target,entry+'-'+n++)
    reserved.add(normalizePath(dest));moves.push({from:original,to:dest})
  }
  const rows=db.prepare('SELECT id,path FROM papers WHERE library_root=?').all(normalizePath(library)) as Array<{id:number;path:string}>
  const moved:Array<{from:string;to:string}>=[]
  const targetExisted=fs.existsSync(target)
  try {
    fs.mkdirSync(target,{recursive:true})
    for(const move of moves) {fs.renameSync(move.from,move.to);moved.push(move)}
    db.transaction(()=>{
      for(const row of rows) {
        const move=moves.find(m=>isWithinDirectory(row.path,m.from))
        if(move) db.prepare('UPDATE papers SET path=?,category=? WHERE id=?').run(path.join(move.to,path.relative(move.from,row.path)),to,row.id)
      }
      const excluded=db.prepare('SELECT path FROM library_exclusions WHERE library_root=?').all(normalizePath(library)) as Array<{path:string}>
      for(const row of excluded) {
        const move=moves.find(m=>isWithinDirectory(row.path,m.from))
        if(move) db.prepare('UPDATE library_exclusions SET path=? WHERE path=?').run(normalizePath(path.join(move.to,path.relative(move.from,row.path))),row.path)
      }
      setExtraCats(getExtraCats().map(c=>c===from?to:c))
    })()
  } catch(error) {
    for(const move of moved.reverse()) fs.renameSync(move.to,move.from)
    if(!targetExisted && fs.existsSync(target) && fs.readdirSync(target).length===0) fs.rmdirSync(target)
    throw error
  }
  for(const source of sources) if(normalizePath(source)!==normalizePath(target) && fs.existsSync(source) && fs.readdirSync(source).length===0) fs.rmdirSync(source)
  return {renamed:to}
}
