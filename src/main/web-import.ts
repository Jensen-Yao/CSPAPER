// 通用入库（v0.23）：任意链接 / 渲染后的 HTML → PDF 入库或题录入库；站点抓取脚本不再是可以导入的前提。
import { readWebPage, htmlToMarkdown } from './web-reader'
import { importTranslated } from './translators'
import { importPapers } from './import'

export interface GenericImportResult { slug:string;title:string;kind:'pdf'|'record' }
export interface PageMeta { url:string;title:string;byline:string;excerpt:string;doi?:string;pdfUrl?:string;publishedAt?:string;pdfPath?:string }

async function importPdfFile(pdfPath:string,title:string,send:(ev:string,p:unknown)=>void):Promise<GenericImportResult> {
  const outcomes=await importPapers([{path:pdfPath,category:'inbox',meta:{title}}],send)
  const hit=outcomes.find(outcome=>outcome.ok&&outcome.slug)
  if(!hit?.slug)throw new Error(hit?.error??'PDF 入库失败')
  return {slug:hit.slug,title,kind:'pdf'}
}

/** Build a record from page metadata, or download the linked PDF when the page exposes one. */
export async function importFromPageMeta(meta:PageMeta,send:(ev:string,p:unknown)=>void=()=>{}):Promise<GenericImportResult> {
  const title=(meta.title||'').replace(/\s+/g,' ').trim().slice(0,300)||new URL(meta.url).hostname
  if(meta.pdfPath)return importPdfFile(meta.pdfPath,title,send)
  if(meta.pdfUrl) {
    try {
      const pdf=await readWebPage(meta.pdfUrl,{timeoutMs:60000})
      if(pdf.kind==='pdf'&&pdf.pdfPath)return importPdfFile(pdf.pdfPath,title,send)
    } catch { /* fall back to a record */ }
  }
  const authors=meta.byline.split(/[,，;；]/).map(name=>name.trim()).filter(Boolean)
  const year=meta.publishedAt?Number(meta.publishedAt.slice(0,4)):undefined
  const csl:Record<string,unknown>={type:meta.doi?'article-journal':'webpage',title,URL:meta.url,id:'cspaper-'+Date.now(),...(meta.doi?{DOI:meta.doi}:{}),...(authors.length?{author:authors.map(name=>({literal:name}))}:{}),...(year&&Number.isFinite(year)?{issued:{'date-parts':[[year]]}}:{}),...(meta.excerpt?{abstract:meta.excerpt}:{}),...(meta.publishedAt?{accessed:{raw:meta.publishedAt}}:{})}
  const imported=await importTranslated({csl,origin:meta.url},send)
  if(!imported.ok||!imported.slug)throw new Error(imported.error??'题录入库失败')
  return {slug:imported.slug,title,kind:'record'}
}

/** Read a public link (PDF or HTML) and import it. */
export async function importGenericUrl(url:string,send:(ev:string,p:unknown)=>void=()=>{},options:{browserSession?:boolean}={}):Promise<GenericImportResult> {
  const page=await readWebPage(url,{timeoutMs:30000,browserSession:options.browserSession})
  return importFromPageMeta({url:page.finalUrl||url,title:page.title,byline:page.byline,excerpt:page.excerpt,doi:page.doi,pdfUrl:page.pdfUrl,publishedAt:page.publishedAt,pdfPath:page.kind==='pdf'?page.pdfPath:undefined},send)
}

/** Import a page the built-in browser already rendered (login-walled sites such as CNKI or publisher pages). */
export async function importRenderedHtml(url:string,html:string,send:(ev:string,p:unknown)=>void=()=>{}):Promise<GenericImportResult> {
  const parsed=htmlToMarkdown(html,url)
  return importFromPageMeta({url,title:parsed.title,byline:parsed.byline,excerpt:parsed.excerpt,doi:parsed.doi,pdfUrl:parsed.pdfUrl,publishedAt:parsed.publishedAt},send)
}
