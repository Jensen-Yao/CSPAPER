import { getDb } from './db'

export interface WebSnapshot {
  id:number;url:string;finalUrl:string;contentHash:string;contentType:string;kind:'html'|'pdf'
  title:string;byline:string;excerpt:string;language:string;markdown:string;bytes:number;fetchedAt:string
}
interface Row {id:number;url:string;final_url:string;content_hash:string;content_type:string;kind:'html'|'pdf';title:string;byline:string;excerpt:string;language:string;markdown:string;bytes:number;fetched_at:string}
const toSnapshot=(row:Row):WebSnapshot=>({id:row.id,url:row.url,finalUrl:row.final_url,contentHash:row.content_hash,contentType:row.content_type,kind:row.kind,title:row.title,byline:row.byline,excerpt:row.excerpt,language:row.language,markdown:row.markdown,bytes:row.bytes,fetchedAt:row.fetched_at})

export const SNAPSHOT_MAX_AGE_MS=24*3600*1000

/** Newest snapshot for a URL, regardless of age. */
export function latestSnapshot(workspaceId:string,url:string):WebSnapshot|null {
  const row=getDb().prepare('SELECT * FROM web_snapshots WHERE workspace_id=? AND url=? ORDER BY fetched_at DESC,id DESC LIMIT 1').get(workspaceId,url) as Row|undefined
  return row?toSnapshot(row):null
}
export function snapshotById(workspaceId:string,id:number):WebSnapshot|null {
  const row=getDb().prepare('SELECT * FROM web_snapshots WHERE workspace_id=? AND id=?').get(workspaceId,id) as Row|undefined
  return row?toSnapshot(row):null
}
export function saveSnapshot(input:Omit<WebSnapshot,'id'>&{workspaceId:string}):WebSnapshot {
  getDb().prepare(`INSERT INTO web_snapshots(workspace_id,url,final_url,content_hash,content_type,kind,title,byline,excerpt,language,markdown,bytes,fetched_at)
    VALUES(@workspaceId,@url,@finalUrl,@contentHash,@contentType,@kind,@title,@byline,@excerpt,@language,@markdown,@bytes,@fetchedAt)
    ON CONFLICT(workspace_id,url,content_hash) DO UPDATE SET fetched_at=excluded.fetched_at`)
    .run({workspaceId:input.workspaceId,url:input.url,finalUrl:input.finalUrl,contentHash:input.contentHash,contentType:input.contentType,kind:input.kind,title:input.title,byline:input.byline,excerpt:input.excerpt,language:input.language,markdown:input.markdown,bytes:input.bytes,fetchedAt:input.fetchedAt} as unknown as Record<string,unknown>)
  return latestSnapshot(input.workspaceId,input.url)!
}
export function listSnapshots(workspaceId:string,limit=100):Array<WebSnapshot&{workspaceId:string}> {
  return (getDb().prepare('SELECT * FROM web_snapshots WHERE workspace_id=? ORDER BY fetched_at DESC,id DESC LIMIT ?').all(workspaceId,Math.max(1,Math.min(500,limit))) as Row[]).map(row=>({...toSnapshot(row),workspaceId}))
}
export function searchSnapshots(workspaceId:string,query:string,limit=20):Array<WebSnapshot&{workspaceId:string}> {
  const term=query.trim().slice(0,200)
  if(!term)return []
  return (getDb().prepare("SELECT * FROM web_snapshots WHERE workspace_id=? AND (title LIKE ? OR markdown LIKE ?) ORDER BY fetched_at DESC,id DESC LIMIT ?").all(workspaceId,`%${term}%`,`%${term}%`,Math.max(1,Math.min(100,limit))) as Row[]).map(row=>({...toSnapshot(row),workspaceId}))
}
