import { z } from 'zod'
import { webSearch } from '../web-search'
import { readWebPage, slicePage } from '../web-reader'
import { webEnabled } from '../net'
import { documentVersion, newSourceId } from '../chat/context'
import type { Source } from '../../shared/sources'
import type { ToolResult } from '../../shared/tools'
import type { ToolContext, ToolRegistry } from './registry'

function ok(data:unknown,summary:string,extra:Partial<ToolResult>={}):ToolResult {return {status:'success',data,summary,sources:[],artifacts:[],changes:[],...extra,durationMs:0}}
function fail(message:string,code='web_disabled'):ToolResult {return {status:'failed',data:undefined,summary:message,sources:[],artifacts:[],changes:[],error:{code,message,retryable:false},durationMs:0}}

export function registerWebTools(registry:ToolRegistry):void {
  registry.register({
    definition:{name:'web_fetch',version:1,title:'读取网页',description:'读取任意公开网页或 PDF 链接的正文（Markdown），返回标题、作者、站点、语言、内容哈希与抓取时间；长文可用 offset 从中断处继续读取。',risk:'read',defaultPermission:'auto',inputSchema:{type:'object'},canCancel:true,timeoutMs:60000},
    schema:z.object({url:z.string().trim().min(8).max(2000),offset:z.number().int().min(0).default(0),maxChars:z.number().int().min(500).max(60000).default(20000),forceRefresh:z.boolean().default(false)}),
    execute:async(ctx,args)=>{
      if(!webEnabled())return fail('联网已在设置中关闭，可在「设置 → 在线获取」中开启')
      const page=await readWebPage(args.url,{signal:ctx.signal,workspaceId:ctx.workspaceId,forceRefresh:args.forceRefresh})
      const window=slicePage(page,args.offset,args.maxChars)
      const anchor=args.offset>0?'offset-'+args.offset:undefined
      const source:Source={id:newSourceId(),runId:ctx.runId,kind:'web',workspaceId:ctx.workspaceId,title:page.title||page.finalUrl,documentVersion:'web:'+page.contentHash,locator:{uri:page.url,anchor},snippet:page.markdown.slice(0,12000),status:'available',createdAt:page.fetchedAt}
      ctx.repository.addSource(source)
      return ok({title:page.title||page.finalUrl,byline:page.byline,siteName:page.siteName,language:page.language,url:page.url,finalUrl:page.finalUrl,fetchedAt:page.fetchedAt,contentHash:page.contentHash,chars:page.chars,kind:page.kind,fromCache:page.fromCache,truncated:window.truncated,nextOffset:window.nextOffset,text:window.text},
        (page.fromCache?'缓存命中：':'已读取：')+(page.title||page.finalUrl)+(window.nextOffset?'（可继续读取）':''),{sources:[source]})
    }
  })
  registry.register({
    definition:{name:'web_search',version:1,title:'联网搜索',description:'通用网页搜索（必应 / DuckDuckGo）与学术检索（Semantic Scholar、arXiv、PubMed、Crossref、OpenAlex），按 DOI 与 URL 去重；autoRead 可自动读取前 N 条正文。',risk:'read',defaultPermission:'auto',inputSchema:{type:'object'},canCancel:true,timeoutMs:90000},
    schema:z.object({query:z.string().trim().min(1).max(500),limit:z.number().int().min(1).max(20).default(8),general:z.boolean().default(true),academic:z.boolean().default(true),autoRead:z.number().int().min(0).max(3).default(0)}),
    execute:async(ctx,args)=>{
      if(!webEnabled())return fail('联网已在设置中关闭，可在「设置 → 在线获取」中开启')
      const result=await webSearch(args.query,{limit:args.limit,general:args.general,academic:args.academic,signal:ctx.signal})
      const sources:Source[]=result.hits.map(hit=>({id:newSourceId(),runId:ctx.runId,kind:'web',workspaceId:ctx.workspaceId,title:hit.title,documentVersion:`search:${documentVersion(hit.url)}`,locator:{uri:hit.url},snippet:hit.snippet,status:'available',createdAt:new Date().toISOString()}))
      for(const source of sources)ctx.repository.addSource(source)
      const read:Array<{url:string;excerpt:string;error?:string}>=[]
      for(const hit of result.hits.slice(0,args.autoRead)) {
        ctx.signal.throwIfAborted()
        try { const page=await readWebPage(hit.url,{signal:ctx.signal,workspaceId:ctx.workspaceId});read.push({url:hit.url,excerpt:page.markdown.slice(0,1500)}) }
        catch(error){read.push({url:hit.url,excerpt:'',error:String(error).slice(0,160)})}
      }
      const hits=result.hits.map(hit=>({title:hit.title,url:hit.url,snippet:hit.snippet,source:hit.source,doi:hit.doi,year:hit.year,authors:hit.authors,pdfUrl:hit.pdfUrl,excerpt:read.find(item=>item.url===hit.url)?.excerpt||undefined}))
      const summary=result.hits.length?`检索到 ${result.hits.length} 条结果（${result.sources.join(' / ')}）${read.length?`，已读取 ${read.filter(item=>item.excerpt).length} 条正文`:''}${result.errors.length?`；失败来源：${result.errors.map(item=>item.source).join('、')}`:''}`:`未检索到结果${result.errors.length?`：${result.errors.map(item=>`${item.source}（${item.message}）`).join('；')}`:''}`
      return ok({query:args.query,hits,errors:result.errors},summary,{sources})
    }
  })
}
