import type { ContextRef } from '../../shared/context'
import type { RetrievedChunk } from '../ingest'
import { extractPagesCached, hybridSearch } from '../ingest'
import { getDb } from '../db'
import { readPaperNote } from '../note-service'
import type { Source } from '../../shared/sources'
import { documentVersion, newSourceId } from './context'
import { readWebPage } from '../web-reader'
import { webEnabled } from '../net'

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

/** Query tokens: CJK bigrams plus Latin words, used to rank pages of a single long paper. */
function queryTokens(query:string):string[] {
  const tokens=new Set<string>()
  for(const word of query.toLowerCase().match(/[a-z0-9][a-z0-9_-]{1,}/g)??[])if(!['this','that','what','about','the','paper'].includes(word))tokens.add(word)
  const cjk=query.replace(/[^\u4e00-\u9fff]/g,'')
  for(let index=0;index+1<cjk.length;index++)if(!'这篇了么什的是和与或在有不'.includes(cjk[index]))tokens.add(cjk.slice(index,index+2))
  return [...tokens]
}
const SECTION_PATTERN=/(^|\n)\s*(\d{1,2}\.?\s+)?(abstract|introduction|related work|background|method|methods|methodology|approach|experiment|experiments|experimental setup|evaluation|results|discussion|limitation|conclusion|conclusions|摘要|引言|相关工作|方法|实验|结果|评估|讨论|局限|结论)\b/i
/** Pages of one paper that enter the context: every page when it fits, otherwise the opening, section starts, the end and the pages most relevant to the question. */
export function selectContextPages(pages:string[],query:string,budget:number):number[] {
  const sizes=pages.map(text=>text.length),total=sizes.reduce((sum,size)=>sum+size,0)
  if(total<=budget)return pages.map((_page,index)=>index)
  const tokens=queryTokens(query)
  const chosen=new Set<number>()
  const push=(index:number):boolean=>{if(index<0||index>=pages.length||chosen.has(index))return false;chosen.add(index);return true}
  push(0);push(1)
  pages.forEach((text,index)=>{if(SECTION_PATTERN.test(text)){push(index);push(index+1)}})
  push(pages.length-1);push(pages.length-2)
  const scored=pages.map((text,index)=>({index,score:tokens.reduce((sum,token)=>sum+(text.toLowerCase().includes(token)?1:0),0)})).filter(item=>!chosen.has(item.index)&&item.score>0).sort((x,y)=>y.score-x.score)
  for(const item of scored)push(item.index)
  let used=0
  const ordered=[...chosen].sort((x,y)=>x-y).filter(index=>{const next=used+sizes[index];if(next>budget&&used>0)return false;used=next;return true})
  if(!ordered.includes(0))ordered.unshift(0)
  return ordered.sort((x,y)=>x-y)
}
export const FULL_TEXT_PAGE_BUDGET=48000

/** Full-text mode: one explicit PDF becomes page-level sources under a character budget, with a compact metadata source first. */
async function paperPageSources(paper:ActivePaper,request:RetrievalRequest,budget=FULL_TEXT_PAGE_BUDGET):Promise<Source[]|null> {
  let pages:string[]
  try {pages=await extractPagesCached(paper.path,{signal:request.signal,timeoutMs:20000})}catch(error){if((error as Error)?.name==='AbortError'||(error as Error)?.name==='TimeoutError')throw error;return null}
  if(!pages.length)return null
  const version=documentVersion(paper.path),now=new Date().toISOString()
  const head=[`标题：${paper.title}`,`作者：${paper.authors||'未提供'}`,`年份：${paper.year??'未提供'}`,`来源：${paper.venue||'未提供'}`,...(paper.doi?[`DOI：${paper.doi}`]:[]),`共 ${pages.length} 页`]
  const digest=(paper.abstract||paper.summary||'').replace(/\s+/g,' ').trim()
  if(digest)head.push(`摘要：${digest.slice(0,4000)}`)
  const sources:Source[]=[{id:newSourceId(),runId:request.runId,kind:'paper_page',workspaceId:request.workspaceId,paperId:paper.id,title:paper.title,documentVersion:version,locator:{page:1,uri:`cspaper://paper/${paper.slug}?page=1`,anchor:'metadata'},snippet:head.join('\n'),status:'available',createdAt:now}]
  for(const index of selectContextPages(pages,request.query,budget)) {
    const page=index+1
    sources.push({id:newSourceId(),runId:request.runId,kind:'paper_page',workspaceId:request.workspaceId,paperId:paper.id,title:`${paper.title} p.${page}`,documentVersion:version,locator:{page,uri:`cspaper://paper/${paper.slug}?page=${page}`},snippet:pages[index],status:'available',createdAt:now})
  }
  return sources
}

/** Web context: a search snippet is replaced by the page body; URLs pasted into the question are read as well. */
async function enrichWebSources(sources:Source[],request:RetrievalRequest,query:string):Promise<Source[]> {
  if(!webEnabled())return sources
  const out=[...sources],seen=new Set(out.map(source=>source.locator.uri))
  const candidates:Array<{source?:Source;url:string}>=[]
  for(const source of out)if(source.kind==='web'&&source.snippet.length<600&&/^https:\/\//i.test(source.locator.uri??''))candidates.push({source,url:source.locator.uri!})
  for(const match of query.matchAll(/https:\/\/[^\s<>"'）)]+/g)) {const url=match[0].replace(/[.,;:]+$/,'');if(!seen.has(url)){seen.add(url);candidates.push({url})}}
  for(const candidate of candidates.slice(0,3)) {
    try {
      const page=await readWebPage(candidate.url,{signal:request.signal,workspaceId:request.workspaceId,timeoutMs:15000})
      const snippet=page.markdown.slice(0,20000)
      if(candidate.source) {candidate.source.snippet=snippet||candidate.source.snippet;candidate.source.title=page.title||candidate.source.title;candidate.source.documentVersion=`web:${page.contentHash}`}
      else out.push({id:newSourceId(),runId:request.runId,kind:'web',workspaceId:request.workspaceId,title:page.title||page.finalUrl,documentVersion:`web:${page.contentHash}`,locator:{uri:page.url},snippet,status:'available',createdAt:page.fetchedAt})
    } catch { /* a page that cannot be read keeps its search snippet */ }
  }
  return out
}
export async function retrieveSources(request:RetrievalRequest):Promise<Source[]> {
  request.signal?.throwIfAborted()
  const limit=request.limit??12
  let chunks:RetrievedChunk[]=[]
  try {chunks=await hybridSearch(request.query.slice(0,500),request.paperId,limit,request.category,request.signal)}catch(error){if((error as Error)?.name==='AbortError'||(error as Error)?.name==='TimeoutError')throw error}
  const allowed=request.paperIds?new Set(request.paperIds):null
  const sources:Source[]=[]
  for(const source of explicitContextSources(request))if(sources.length<limit)sources.push(source)
  const explicitPaperIds=[...(request.refs??[])].filter(ref=>ref.kind==='paper').map(ref=>ref.paperId)
  const collectionPaperIds=(request.refs??[]).filter(ref=>ref.kind==='collection').flatMap(ref=>getDb().prepare('SELECT paper_id FROM paper_collections WHERE collection_id=? ORDER BY paper_id').all(ref.collectionId) as Array<{paper_id:number}>).map(row=>row.paper_id)
  const chunkCount=getDb().prepare('SELECT COUNT(*) AS n FROM chunks WHERE paper_id=?')
  // Full-text mode: exactly one paper in focus → the paper itself enters the context page by page.
  const focusIds=request.paperId?[request.paperId]:[...new Set(explicitPaperIds)]
  const focusPaper=focusIds.length===1?activePaper(focusIds[0]):undefined
  let fullText:Source[]|null=null
  if(focusPaper&&focusPaper.source_kind!=='record') {
    try {fullText=await paperPageSources(focusPaper,request)}catch(error){if((error as Error)?.name==='AbortError'||(error as Error)?.name==='TimeoutError')throw error;fullText=null}
  }
  if(fullText) {
    const covered=new Set(fullText.map(source=>source.locator.page))
    for(const source of fullText)sources.push(source)
    // Hybrid chunks only add pages the full-text window did not include.
    let extra=0
    for(const chunk of chunks) {
      if(sources.length>=limit+fullText.length||extra>=4)break
      if(covered.has(chunk.page))continue
      const paper=activePaper(chunk.paperId)
      if(!paper||paper.id!==focusPaper!.id)continue
      sources.push({id:newSourceId(),runId:request.runId,kind:'chunk',workspaceId:request.workspaceId,paperId:paper.id,title:paper.title,documentVersion:documentVersion(paper.path),locator:{page:chunk.page,uri:`cspaper://paper/${paper.slug}?page=${chunk.page}`},snippet:chunk.snippet,status:'available',createdAt:new Date().toISOString()})
      extra++
    }
    request.signal?.throwIfAborted()
    return enrichWebSources(sources,request,request.query)
  }
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
  return enrichWebSources(sources,request,request.query)
}
