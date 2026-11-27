// 网页阅读（v0.23）：任意公开网页 → 干净的 Markdown 正文（Readability 正文抽取 + Turndown 转换），
// PDF 链接 → 页级文本；结果带内容哈希与抓取时间，并以快照入库可离线回看。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { parseHTML } from 'linkedom'
import { Readability } from '@mozilla/readability'
import Turndown from 'turndown'
import { decodeBuffer, netFetch } from './net'
import { extractPages } from './ingest'
import { latestSnapshot, saveSnapshot, SNAPSHOT_MAX_AGE_MS } from './web-cache'

export interface WebPage {
  url:string;finalUrl:string;title:string;byline:string;excerpt:string;language:string;siteName:string
  markdown:string;chars:number;contentHash:string;fetchedAt:string;contentType:string;kind:'html'|'pdf'
  fromCache:boolean;pdfPath?:string;doi?:string;pdfUrl?:string;publishedAt?:string
}
export interface ReadWebOptions { signal?:AbortSignal;forceRefresh?:boolean;browserSession?:boolean;workspaceId?:string;maxBytes?:number;timeoutMs?:number;maxAgeMs?:number }

const REMOVE_SELECTOR=['script','style','noscript','iframe','form','button','input','select','textarea','svg','canvas','video','audio','nav','footer','aside','template','.ad','.ads','.sidebar','.comment','.comments','.share','.social','.related','.recommend','.breadcrumb','.cookie','.newsletter','.popup','.modal','.tooltip','#comments','#sidebar','#footer','#nav','.navigation','.menu'].join(',')

function metaContent(document:Document,name:string):string {
  return (document.querySelector(`meta[name="${name}"],meta[property="${name}"]`)?.getAttribute('content')??'').trim()
}
function metaAll(document:Document,name:string):string[] {
  return [...document.querySelectorAll(`meta[name="${name}"]`)].map(node=>(node.getAttribute('content')??'').trim()).filter(Boolean)
}
function absolute(raw:string,base:string):string {
  try { const url=new URL(raw,base);return /^https?:$/.test(url.protocol)?url.toString():'' } catch { return '' }
}
function escapeCell(text:string):string { return text.replace(/\|/g,'\\|').replace(/\r?\n/g,' ').replace(/\s+/g,' ').trim() }

export function htmlToMarkdown(html:string,baseUrl:string):{title:string;byline:string;excerpt:string;language:string;siteName:string;markdown:string;doi?:string;pdfUrl?:string;publishedAt?:string} {
  const {document}=parseHTML(html)
  const meta={
    title:metaContent(document,'citation_title')||metaContent(document,'og:title')||document.querySelector('title')?.textContent?.trim()||'',
    authors:metaAll(document,'citation_author'),
    doi:metaContent(document,'citation_doi'),
    pdfUrl:absolute(metaContent(document,'citation_pdf_url'),baseUrl)||undefined,
    date:metaContent(document,'citation_publication_date')||metaContent(document,'article:published_time')||metaContent(document,'date')||undefined,
    description:metaContent(document,'og:description')||metaContent(document,'description')||metaContent(document,'citation_abstract'),
    siteName:metaContent(document,'og:site_name'),
    language:document.documentElement?.getAttribute('lang')?.trim()||metaContent(document,'og:locale')||''
  }
  let contentHTML='',readableTitle='',byline=meta.authors.join(', '),excerpt=meta.description,language=meta.language
  try {
    const article=new Readability(document as unknown as Document,{charThreshold:250}).parse()
    if(article&&article.content&&((article.textContent??'').length>=200)) {
      contentHTML=article.content;readableTitle=article.title??'';byline=article.byline||byline;excerpt=article.excerpt||excerpt;language=article.lang||language
    }
  } catch { /* non-article pages fall back to the body below */ }
  if(!contentHTML) {
    const clone=document.body?.cloneNode(true) as HTMLElement|undefined
    if(clone) {
      clone.querySelectorAll(REMOVE_SELECTOR).forEach(node=>node.remove())
      clone.querySelectorAll('[style*="display:none"],[hidden],[aria-hidden="true"]').forEach(node=>node.remove())
      const main=clone.querySelector('main,article,[role="main"],.content,#content,.post,.entry,.article')??clone
      contentHTML=main.innerHTML
    }
  }
  const turndown=new Turndown({headingStyle:'atx',hr:'---',bulletListMarker:'-',codeBlockStyle:'fenced',emDelimiter:'*'})
  turndown.remove(REMOVE_SELECTOR.split(',') as unknown as Parameters<Turndown['remove']>[0])
  turndown.addRule('absoluteLink',{filter:'a',replacement:(content,node)=>{const href=absolute((node as HTMLElement).getAttribute('href')??'',baseUrl);const text=(content||'').trim();return href&&text?`[${text}](${href})`:text}})
  turndown.addRule('tableGfm',{filter:'table',replacement:(_content,node)=>{
    const rows=[...(node as HTMLElement).querySelectorAll('tr')].map(row=>[...row.querySelectorAll('th,td')].map(cell=>escapeCell(cell.textContent??'')))
    if(!rows.length||rows.every(row=>!row.some(Boolean)))return ''
    const width=Math.max(...rows.map(row=>row.length))
    const pad=(row:string[])=>[...row,...Array(width-row.length).fill('')]
    const [head,...body]=rows.map(pad)
    return `\n\n| ${head.join(' | ')} |\n| ${head.map(()=>'---').join(' | ')} |\n${body.map(row=>`| ${row.join(' | ')} |`).join('\n')}\n\n`
  }})
  turndown.addRule('image',{filter:'img',replacement:(_content,node)=>{const src=absolute((node as HTMLElement).getAttribute('src')??'',baseUrl);return src?`![${(node as HTMLElement).getAttribute('alt')??''}](${src})`:''}})
  const fragment=parseHTML('<div id="cspaper-root">'+contentHTML+'</div>')
  const markdown=turndown.turndown((fragment.document.querySelector('#cspaper-root')??fragment.document.body) as unknown as HTMLElement)
    .replace(/\[([^\]]*)\]\(\s*\)/g,'$1')
    .replace(/\n{3,}/g,'\n\n')
    .trim()
  return {title:(meta.title||readableTitle).replace(/\s+/g,' ').slice(0,500),byline:byline.slice(0,500),excerpt:(excerpt||'').replace(/\s+/g,' ').slice(0,600),language:language.slice(0,16),siteName:(meta.siteName||new URL(baseUrl).hostname).slice(0,200),markdown,doi:meta.doi||undefined,pdfUrl:meta.pdfUrl,publishedAt:meta.date}
}

function isPdf(response:{contentType:string;buffer:Buffer;url:string}):boolean {
  return response.contentType.includes('pdf')||response.buffer.subarray(0,5).toString()==='%PDF-'||/\.pdf(\?|#|$)/i.test(response.url)
}

export async function readWebPage(rawUrl:string,options:ReadWebOptions={}):Promise<WebPage> {
  const requested=new URL(rawUrl).toString()
  const workspaceId=options.workspaceId
  if(workspaceId&&!options.forceRefresh) {
    const cached=latestSnapshot(workspaceId,requested)
    if(cached&&Date.now()-Date.parse(cached.fetchedAt)<(options.maxAgeMs??SNAPSHOT_MAX_AGE_MS)) {
      return {url:cached.url,finalUrl:cached.finalUrl,title:cached.title,byline:cached.byline,excerpt:cached.excerpt,language:cached.language,siteName:new URL(cached.finalUrl).hostname,markdown:cached.markdown,chars:cached.markdown.length,contentHash:cached.contentHash,fetchedAt:cached.fetchedAt,contentType:cached.contentType,kind:cached.kind,fromCache:true}
    }
  }
  const response=await netFetch(rawUrl,{signal:options.signal,browserSession:options.browserSession,maxBytes:options.maxBytes,timeoutMs:options.timeoutMs})
  const fetchedAt=new Date().toISOString()
  let page:WebPage
  if(isPdf(response)) {
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cspaper-web-')),pdfPath=path.join(dir,'paper.pdf')
    fs.writeFileSync(pdfPath,response.buffer)
    const pages=await extractPages(pdfPath)
    const markdown=pages.map((text,index)=>`## 第 ${index + 1} 页\n\n${text.trim()}`).join('\n\n')
    const firstLine=pages[0]?.split(/\r?\n/).map(line=>line.trim()).find(line=>line.length>8)?.slice(0,200)??''
    page={url:requested,finalUrl:response.url,title:firstLine||path.basename(new URL(response.url).pathname).replace(/\.pdf$/i,''),byline:'',excerpt:pages[0]?.replace(/\s+/g,' ').slice(0,600)??'',language:'',siteName:new URL(response.url).hostname,markdown,chars:markdown.length,contentHash:'',fetchedAt,contentType:response.contentType,kind:'pdf',fromCache:false,pdfPath}
  } else {
    const html=decodeBuffer(response.buffer,response.contentType)
    if(!/<html[\s>]|<!doctype html/i.test(html.slice(0,2000))&&!/<body[\s>]/i.test(html))throw new Error(`目标不是网页（${response.contentType.split(';')[0]||'未知类型'}），web_fetch 仅支持 HTML 与 PDF`)
    const parsed=htmlToMarkdown(html,response.url)
    page={url:requested,finalUrl:response.url,...parsed,chars:parsed.markdown.length,contentHash:'',fetchedAt,contentType:response.contentType,kind:'html',fromCache:false}
  }
  page.contentHash=createHash('sha256').update(page.finalUrl+'\n'+page.markdown).digest('hex').slice(0,16)
  if(workspaceId)saveSnapshot({workspaceId,url:page.url,finalUrl:page.finalUrl,contentHash:page.contentHash,contentType:page.contentType,kind:page.kind,title:page.title,byline:page.byline,excerpt:page.excerpt,language:page.language,markdown:page.markdown,bytes:Buffer.byteLength(page.markdown),fetchedAt:page.fetchedAt})
  return page
}

/** Read a bounded window so long pages can be continued with `offset`. */
export function slicePage(page:WebPage,offset=0,maxChars=20000):{text:string;nextOffset:number|null;truncated:boolean} {
  const start=Math.max(0,Math.min(offset,page.markdown.length))
  const end=Math.min(page.markdown.length,start+maxChars)
  return {text:page.markdown.slice(start,end),nextOffset:end<page.markdown.length?end:null,truncated:start>0||end<page.markdown.length}
}
