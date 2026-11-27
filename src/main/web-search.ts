// 联网检索（v0.23）：通用搜索（必应 / DuckDuckGo 结果页）+ 学术源（Semantic Scholar、arXiv、PubMed、Crossref、OpenAlex），
// 按 DOI 与规范化 URL 去重，失败的单源不影响其他来源。
import * as cheerio from 'cheerio'
import { fetchText, webEnabled, NetworkError } from './net'
import { searchAll } from './translators'

import type { WebHit, WebHitSource, WebSearchResult } from '../shared/web'
export type { WebHit, WebHitSource, WebSearchResult } from '../shared/web'
export interface WebSearchOptions { limit?:number;academic?:boolean;signal?:AbortSignal;general?:boolean }

export function normalizeUrl(raw:string):string {
  try {
    const url=new URL(raw)
    for(const key of [...url.searchParams.keys()])if(/^(utm_|fbclid|gclid|ref|source|ping|icmpid|mkt|form|setlang|cvid|qs|sp|pq|sk|ghsh|ghacc|ghpl)/i.test(key)||key.startsWith('utm'))url.searchParams.delete(key)
    url.hash=''
    let s=url.toString()
    if(url.pathname==='/'&&!url.search)s=s.slice(0,-1)
    return s.replace(/^https:\/\/www\./,'https://')
  } catch { return raw.trim() }
}
export function normalizeDoi(raw:string|undefined|null):string|undefined {
  if(!raw)return undefined
  const m=/10\.\d{4,9}\/[^\s"<>]+/i.exec(raw.replace(/^https?:\/\/(dx\.)?doi\.org\//i,''))
  return m?m[0].toLowerCase().replace(/[.,;)]+$/,''):undefined
}

function decodeBingUrl(href:string):string {
  try {
    const url=new URL(href,'https://www.bing.com')
    if(url.pathname==='/ck/a') {
      const u=url.searchParams.get('u')??''
      if(u.startsWith('a1'))return Buffer.from(u.slice(2),'base64').toString('utf8')
    }
    return url.toString()
  } catch { return href }
}

async function searchBing(query:string,limit:number,signal?:AbortSignal):Promise<WebHit[]> {
  const {text}=await fetchText(`https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${Math.min(limit*2,30)}&setlang=zh-hans`,{signal,timeoutMs:15_000,headers:{Cookie:'SRCHHPGUSR=ADLT=OFF&NRSLT=20'}})
  const $=cheerio.load(text),hits:WebHit[]=[]
  $('li.b_algo').each((_i,el)=>{
    if(hits.length>=limit)return false
    const anchor=$(el).find('h2 a').first(),title=anchor.text().replace(/\s+/g,' ').trim()
    const url=decodeBingUrl(anchor.attr('href')??'')
    const snippet=$(el).find('.b_caption p, .b_linepar2, .b_linepar, p').first().text().replace(/\s+/g,' ').trim()
    if(title&&url)hits.push({title,url,snippet,source:'bing'})
  })
  if(!hits.length&&/captcha|unusual traffic|验证/i.test(text.slice(0,20000)))throw new Error('必应返回了人机验证页面')
  return hits
}

async function searchDuckDuckGo(query:string,limit:number,signal?:AbortSignal):Promise<WebHit[]> {
  const {text}=await fetchText(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {signal,timeoutMs:15_000})
  const $=cheerio.load(text),hits:WebHit[]=[]
  $('.result').each((_i,el)=>{
    if(hits.length>=limit)return false
    const anchor=$(el).find('a.result__a').first()
    const href=anchor.attr('href')??''
    let url=href
    try { const parsed=new URL(href,'https://duckduckgo.com');if(parsed.pathname==='/l/')url=parsed.searchParams.get('uddg')??href } catch { /* keep href */ }
    const title=anchor.text().replace(/\s+/g,' ').trim(),snippet=$(el).find('.result__snippet').first().text().replace(/\s+/g,' ').trim()
    if(title&&url.startsWith('http'))hits.push({title,url,snippet,source:'duckduckgo'})
  })
  if(!hits.length&&/anomaly|captcha|bots/i.test(text.slice(0,20000)))throw new Error('DuckDuckGo 返回了人机验证页面')
  return hits
}

async function searchSemanticScholar(query:string,limit:number,signal?:AbortSignal):Promise<WebHit[]> {
  const {text}=await fetchText(`https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${Math.min(limit,10)}&fields=title,year,authors,venue,externalIds,abstract,openAccessPdf,citationCount`,{signal,timeoutMs:15_000})
  const json=JSON.parse(text) as {data?:Array<{title?:string;year?:number;authors?:Array<{name?:string}>;venue?:string;externalIds?:{DOI?:string;ArXiv?:string};abstract?:string;openAccessPdf?:{url?:string};citationCount?:number;paperId?:string}>}
  return (json.data??[]).map(item=>({title:item.title??'',url:item.externalIds?.DOI?`https://doi.org/${item.externalIds.DOI}`:item.externalIds?.ArXiv?`https://arxiv.org/abs/${item.externalIds.ArXiv}`:`https://www.semanticscholar.org/paper/${item.paperId??''}`,snippet:(item.abstract??'').replace(/\s+/g,' ').slice(0,400),source:'semantic_scholar',doi:item.externalIds?.DOI,year:item.year,authors:(item.authors??[]).map(author=>author.name??'').filter(Boolean).join(', '),pdfUrl:item.openAccessPdf?.url,citations:item.citationCount}))
}

async function searchArxiv(query:string,limit:number,signal?:AbortSignal):Promise<WebHit[]> {
  const term=query.trim().split(/\s+/).slice(0,8).map(token=>`all:${token}`).join('+AND+')
  const {text}=await fetchText(`https://export.arxiv.org/api/query?search_query=${term}&max_results=${Math.min(limit,10)}&sortBy=relevance`,{signal,timeoutMs:20_000})
  const $=cheerio.load(text,{xmlMode:true}),hits:WebHit[]=[]
  $('entry').each((_i,el)=>{
    const title=$(el).find('title').first().text().replace(/\s+/g,' ').trim(),id=$(el).find('id').first().text().trim()
    const pdf=$(el).find('link[title="pdf"]').attr('href')??undefined
    const year=Number($(el).find('published').first().text().slice(0,4))||undefined
    const arxivId=id.split('/abs/')[1]?.replace(/v\d+$/,'')
    if(title&&id)hits.push({title,url:id.replace(/v\d+$/,''),snippet:$(el).find('summary').first().text().replace(/\s+/g,' ').trim().slice(0,400),source:'arxiv',doi:arxivId?`10.48550/arxiv.${arxivId}`:undefined,year,authors:$(el).find('author name').map((_j,a)=>$(a).text()).get().join(', '),pdfUrl:pdf})
  })
  return hits
}

async function searchPubMed(query:string,limit:number,signal?:AbortSignal):Promise<WebHit[]> {
  const base='https://eutils.ncbi.nlm.nih.gov/entrez/eutils/'
  const search=await fetchText(`${base}esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmax=${Math.min(limit,10)}&retmode=json`,{signal,timeoutMs:15_000})
  const ids=(JSON.parse(search.text) as {esearchresult?:{idlist?:string[]}}).esearchresult?.idlist??[]
  if(!ids.length)return []
  const summary=await fetchText(`${base}esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json`,{signal,timeoutMs:15_000})
  const json=JSON.parse(summary.text) as {result?:{uids?:string[]}&Record<string,unknown>}
  return (json.result?.uids??[]).flatMap(uid=>{
    const item=json.result?.[uid] as {title?:string;authors?:Array<{name?:string}>;pubdate?:string;source?:string;articleids?:Array<{idtype?:string;value?:string}>;elocationid?:string}|undefined
    if(!item?.title)return []
    return [{title:item.title.replace(/<[^>]+>/g,''),url:`https://pubmed.ncbi.nlm.nih.gov/${uid}/`,snippet:`${item.source??''} ${item.pubdate??''}`.trim(),source:'pubmed',doi:item.articleids?.find(entry=>entry.idtype==='doi')?.value??normalizeDoi(item.elocationid),year:Number((item.pubdate??'').slice(0,4))||undefined,authors:(item.authors??[]).map(author=>author.name??'').join(', ')}]
  })
}

async function searchScholarlyScripts(query:string):Promise<WebHit[]> {
  const rows=await searchAll(query)
  return rows.flatMap(row=>{
    const r=row as Record<string,unknown>,url=String(r.url??''),title=String(r.title??'').replace(/<[^>]+>/g,'').trim()
    if(!/^https?:\/\//i.test(url)||!title)return []
    const source:WebHitSource=/openalex/i.test(String(r.translator))?'openalex':'crossref'
    return [{title,url,snippet:String(r.abstract??'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,400),source,doi:normalizeDoi(String(r.doi??'')),year:Number(r.year)||undefined,authors:typeof r.authors==='string'?r.authors:undefined}]
  })
}

async function settle<T>(source:string,run:()=>Promise<T>,errors:WebSearchResult['errors']):Promise<T|undefined> {
  try { return await run() } catch(error) { errors.push({source,message:error instanceof NetworkError?error.message:String(error).slice(0,160)});return undefined }
}

/** Unified web search. `general` adds Bing / DuckDuckGo results; academic sources are always consulted when the query looks scholarly or `academic` is true. */
export async function webSearch(query:string,options:WebSearchOptions={}):Promise<WebSearchResult> {
  const q=query.trim().slice(0,500)
  if(!q)return {hits:[],sources:[],errors:[{source:'input',message:'检索词为空'}]}
  if(!webEnabled())return {hits:[],sources:[],errors:[{source:'policy',message:'联网已在设置中关闭'}]}
  const limit=Math.max(1,Math.min(30,options.limit??10)),errors:WebSearchResult['errors']=[]
  const scholarly=options.academic??true,general=options.general??!scholarly
  const [bing,ddg,s2,arxiv,pubmed,scripts]=await Promise.all([
    general?settle('bing',()=>searchBing(q,limit,options.signal),errors):Promise.resolve(undefined),
    general?settle('duckduckgo',()=>searchDuckDuckGo(q,limit,options.signal),errors):Promise.resolve(undefined),
    scholarly?settle('semantic_scholar',()=>searchSemanticScholar(q,limit,options.signal),errors):Promise.resolve(undefined),
    scholarly?settle('arxiv',()=>searchArxiv(q,limit,options.signal),errors):Promise.resolve(undefined),
    scholarly?settle('pubmed',()=>searchPubMed(q,limit,options.signal),errors):Promise.resolve(undefined),
    scholarly?settle('crossref/openalex',()=>searchScholarlyScripts(q),errors):Promise.resolve(undefined)
  ])
  // Interleave sources so each contributes its best results before any single source dominates.
  const buckets=[s2,arxiv,pubmed,scripts,bing,ddg].filter((bucket):bucket is WebHit[]=>Array.isArray(bucket)&&bucket.length>0)
  const seenUrl=new Set<string>(),seenDoi=new Set<string>(),hits:WebHit[]=[]
  for(let rank=0;hits.length<limit*3;rank++) {
    let added=false
    for(const bucket of buckets) {
      const hit=bucket[rank]
      if(!hit)continue
      const url=normalizeUrl(hit.url),doi=normalizeDoi(hit.doi)
      if(seenUrl.has(url)||(doi&&seenDoi.has(doi)))continue
      seenUrl.add(url);if(doi)seenDoi.add(doi)
      hits.push({...hit,url});added=true
    }
    if(!added)break
  }
  const sources=[...new Set(hits.map(hit=>hit.source))]
  return {hits:hits.slice(0,limit),sources,errors}
}
