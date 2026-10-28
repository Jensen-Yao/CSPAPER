import type { ContextRef } from '../../shared/context'
import type { RetrievedChunk } from '../ingest'
import { extractPagesCached, hybridSearch } from '../ingest'
import { getDb } from '../db'
import { readPaperNote } from '../note-service'
import type { Source } from '../../shared/sources'
import { documentVersion, newSourceId } from './context'

export interface RetrievalRequest { query:string;workspaceId:string;paperIds?:number[];paperId?:number;category?:string;refs?:ContextRef[];limit?:number;runId:string;signal?:AbortSignal }

type ActivePaper = {id:number;slug:string;title:string;authors:string;year:number|null;venue:string;doi:string|null;abstract:string|null;summary:string|null;path:string;library_root:string;source_kind:'pdf'|'record'}
function activePaper(paperId:number):ActivePaper|undefined {
  return getDb().prepare('SELECT id,slug,title,authors,year,venue,doi,abstract,summary,path,library_root,source_kind FROM active_papers WHERE id=?').get(paperId) as ActivePaper|undefined
}

/** Exact platform objects must not be erased into ordinary vector-only retrieval. */
export function explicitContextSources(request:RetrievalRequest):Source[] {
  const sources:Source[]=[]
  for(const ref of request.refs??[]) {
    if(ref.kind==='selection') {
      const paper=activePaper(ref.paperId)
      if(!paper)continue
      sources.push({id:newSourceId(),runId:request.runId,kind:'paper_selection',workspaceId:request.workspaceId,paperId:paper.id,title:paper.title,documentVersion:ref.documentVersion,locator:{page:ref.page,uri:`cspaper://paper/${paper.slug}?page=${ref.page}`,anchor:'selection'},snippet:ref.text,status:'available',createdAt:new Date().toISOString()})
    } else if(ref.kind==='note') {
      try {
        if(ref.paperId) {
          const notePaper=activePaper(ref.paperId),note=readPaperNote(request.workspaceId,ref.paperId)
          if(notePaper)sources.push({id:newSourceId(),runId:request.runId,kind:'note',workspaceId:request.workspaceId,paperId:ref.paperId,title:`笔记：${note.title}`,documentVersion:note.version,locator:{uri:`cspaper://paper/${notePaper.slug}?anchor=notes`,anchor:'notes'},snippet:note.text.slice(0,12000),status:'available',createdAt:new Date().toISOString()})
        } else {
          const match=/^standalone-(\d+)$/.exec(ref.noteId)
          if(!match)throw new Error('独立笔记 ID 无效')
          const note=getDb().prepare('SELECT id,title,body_md,updated_at FROM standalone_notes WHERE id=?').get(Number(match[1])) as {id:number;title:string;body_md:string;updated_at:string}|undefined
          if(!note)throw new Error('独立笔记不存在')
          sources.push({id:newSourceId(),runId:request.runId,kind:'note',workspaceId:request.workspaceId,title:note.title,documentVersion:`standalone:${note.id}:${note.updated_at}`,locator:{uri:`cspaper://note/${note.id}`,anchor:'standalone-notes'},snippet:note.body_md.slice(0,12000),status:'available',createdAt:new Date().toISOString()})
        }
      }catch{ /* A missing note remains absent from sources; run context diagnostics still preserve the miss. */ }
    } else if(ref.kind==='web') {
      sources.push({id:newSourceId(),runId:request.runId,kind:'web',workspaceId:request.workspaceId,title:ref.title,documentVersion:ref.documentVersion,locator:{uri:ref.url},snippet:ref.snippet,status:'available',createdAt:new Date().toISOString()})
    }
  }
  request.signal?.throwIfAborted()
  return sources
}

/** Scoped retrieval. Exact selection/note sources are followed by scoped hybrid chunks. */
function paperMetadataSource(paper:ActivePaper,runId:string,workspaceId:string,firstPage=''):Source {
  const lines=[
    `标题：${paper.title}`,
    `作者：${paper.authors||'未提供'}`,
    `年份：${paper.year??'未提供'}`,
    `来源：${paper.venue||'未提供'}`,
    ...(paper.doi?[`DOI：${paper.doi}`]:[]),
    `类型：${paper.source_kind==='record'?'题录条目（无 PDF 全文）':'PDF 文献（正文索引缺失，以下为首页/元数据兜底）'}`,
    ...((paper.abstract||paper.summary||firstPage).trim()?[`内容：${(paper.abstract||paper.summary||firstPage).replace(/\s+/g,' ').trim().slice(0,8000)}`]:[])
  ]
  return {id:newSourceId(),runId,kind:'paper_page',workspaceId,paperId:paper.id,title:paper.source_kind==='record'?`${paper.title}（题录）`:paper.title,documentVersion:documentVersion(paper.path),locator:{page:1,uri:`cspaper://paper/${paper.slug}?page=1`,anchor:paper.source_kind==='record'?'record':'first-page'},snippet:lines.join('\n'),status:'available',createdAt:new Date().toISOString()}
}

export async function retrieveSources(request:RetrievalRequest):Promise<Source[]> {
  request.signal?.throwIfAborted()
  const limit=request.limit??12
  let chunks:RetrievedChunk[]=[]
  try {chunks=await hybridSearch(request.query.slice(0,500),request.paperId,limit,request.category,request.signal)}catch(error){if((error as Error)?.name==='AbortError'||(error as Error)?.name==='TimeoutError')throw error}
  const allowed=request.paperIds?new Set(request.paperIds):null
  const sources:Source[]=[]
  for(const source of explicitContextSources(request))if(sources.length<limit)sources.push(source)
  // Explicit papers are never reduced to an opaque ID. Records always carry metadata;
  // a full-text PDF without chunks falls back to page one until its index is repaired.
  const explicitPaperIds=[...(request.refs??[])].filter(ref=>ref.kind==='paper').map(ref=>ref.paperId)
  const collectionPaperIds=(request.refs??[]).filter(ref=>ref.kind==='collection').flatMap(ref=>getDb().prepare('SELECT paper_id FROM paper_collections WHERE collection_id=? ORDER BY paper_id').all(ref.collectionId) as Array<{paper_id:number}>).map(row=>row.paper_id)
  const chunkCount=getDb().prepare('SELECT COUNT(*) AS n FROM chunks WHERE paper_id=?')
  for(const paperId of new Set(explicitPaperIds)) {
    if(sources.length>=limit)break
    const paper=activePaper(paperId)
    if(!paper)continue
    const hasChunks=(chunkCount.get(paperId) as {n:number}).n>0
    if(paper.source_kind==='record'||!hasChunks) {
      let firstPage=''
      if(paper.source_kind!=='record') {
        try {firstPage=(await extractPagesCached(paper.path,{signal:request.signal,timeoutMs:10000}))[0]??''}catch(error){if((error as Error)?.name==='AbortError'||(error as Error)?.name==='TimeoutError')throw error}
      }
      sources.push(paperMetadataSource(paper,request.runId,request.workspaceId,firstPage))
    }
  }
  const collectionFallbackDone=new Set<number>()
  for(const chunk of chunks) {
    if(request.paperId&&chunk.paperId!==request.paperId) continue
    if(allowed&&!allowed.has(chunk.paperId)) continue
    const paper=activePaper(chunk.paperId)
    if(!paper) continue
    sources.push({id:newSourceId(),runId:request.runId,kind:'chunk',workspaceId:request.workspaceId,paperId:paper.id,title:paper.title,documentVersion:documentVersion(paper.path),locator:{page:chunk.page,uri:`cspaper://paper/${paper.slug}?page=${chunk.page}`},snippet:chunk.snippet,status:'available',createdAt:new Date().toISOString()})
    collectionFallbackDone.add(chunk.paperId)
    if(sources.length>=limit)break
  }
  // A collection can legitimately contain record-only or not-yet-indexed papers.
  // Keep its members visible as bounded metadata/page-one sources instead of silently erasing them.
  for(const paperId of collectionPaperIds) {
    if(sources.length>=limit||collectionFallbackDone.has(paperId))continue
    const paper=activePaper(paperId)
    if(!paper)continue
    const hasChunks=(chunkCount.get(paperId) as {n:number}).n>0
    if(hasChunks)continue
    let firstPage=''
    if(paper.source_kind!=='record') {
      try {firstPage=(await extractPagesCached(paper.path,{signal:request.signal,timeoutMs:10000}))[0]??''}catch(error){if((error as Error)?.name==='AbortError'||(error as Error)?.name==='TimeoutError')throw error}
    }
    sources.push(paperMetadataSource(paper,request.runId,request.workspaceId,firstPage))
    collectionFallbackDone.add(paperId)
  }
  request.signal?.throwIfAborted()
  return sources
}
