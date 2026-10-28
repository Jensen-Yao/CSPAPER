import type Database from 'better-sqlite3'
import { getDb } from './db'

export interface CollectionRow { id:number;name:string;parent_id:number|null;n:number }

function cleanName(name:string) {
  const value=name.trim()
  if(value.length<1||value.length>100)throw new Error('集合名称必须为 1-100 个字符')
  return value
}
function collection(db:Database.Database,id:number) {
  const row=db.prepare('SELECT id,name,parent_id FROM collections WHERE id=?').get(id) as {id:number;name:string;parent_id:number|null}|undefined
  if(!row)throw new Error(`集合 #${id} 不存在`)
  return row
}
function activePaper(db:Database.Database,id:number) {
  const row=db.prepare('SELECT id FROM active_papers WHERE id=?').get(id) as {id:number}|undefined
  if(!row)throw new Error(`文献 #${id} 不存在或不可见`)
  return row.id
}
export function listCollections():CollectionRow[] {
  return getDb().prepare('SELECT c.id,c.name,c.parent_id,COUNT(pc.paper_id) n FROM collections c LEFT JOIN paper_collections pc ON pc.collection_id=c.id GROUP BY c.id ORDER BY c.name').all() as CollectionRow[]
}
export function createCollection(name:string,parentId?:number) {
  const db=getDb(),value=cleanName(name)
  if(parentId!=null)collection(db,parentId)
  const id=Number(db.prepare('INSERT INTO collections(name,parent_id) VALUES(?,?)').run(value,parentId??null).lastInsertRowid)
  return collection(db,id)
}
export function removeCollection(id:number) {
  const db=getDb();collection(db,id)
  db.prepare('DELETE FROM collections WHERE id=?').run(id)
  return true
}
export function setPaperInCollection(collectionId:number,paperId:number,on:boolean) {
  const db=getDb();collection(db,collectionId);activePaper(db,paperId)
  if(on)db.prepare('INSERT OR IGNORE INTO paper_collections(paper_id,collection_id) VALUES(?,?)').run(paperId,collectionId)
  else db.prepare('DELETE FROM paper_collections WHERE paper_id=? AND collection_id=?').run(paperId,collectionId)
  return true
}
export function collectionPapers(collectionId:number) {
  const db=getDb();collection(db,collectionId)
  return (db.prepare('SELECT paper_id FROM paper_collections WHERE collection_id=? ORDER BY paper_id').all(collectionId) as Array<{paper_id:number}>).map(row=>row.paper_id)
}
