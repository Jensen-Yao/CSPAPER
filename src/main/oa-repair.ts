import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import dns from 'node:dns/promises'
import { createHash } from 'node:crypto'
import { app } from 'electron'
import { getDb, getSettings, scanLibraryAsync } from './db'
import { patchFrontmatter, readPaperMarkdown } from './paper-files'
import { runFileOperation } from './operations/journal'

const UA = 'CSPAPER/0.20 (mailto:cspaper@app.local)'
const MAX_PDF_BYTES = 100 * 1024 * 1024

export type OaRepairStatus = 'available' | 'not_available' | 'no_identifier' | 'no_match' | 'download_failed' | 'invalid_pdf' | 'cancelled' | 'error'

export interface OaRepairCandidate {
  paperId: number
  slug: string
  title: string
  doi: string | null
  status: OaRepairStatus
  pdfUrl?: string
  landingUrl?: string
  sourceName?: string
  license?: string | null
  matchedBy?: 'doi' | 'title'
  reason?: string
}

export interface OaRepairPreview {
  total: number
  counts: Record<OaRepairStatus, number>
  candidates: OaRepairCandidate[]
}

export interface OaRepairOutcome extends OaRepairCandidate {
  repaired: boolean
  bytes?: number
  operationId?: string
  backupDir?: string
  error?: string
}

export interface OaRepairApplyResult {
  total: number
  repaired: number
  failed: number
  skipped: number
  cancelled?: boolean
  outcomes: OaRepairOutcome[]
}

export interface OaRepairProgress {
  phase: 'preview' | 'apply'
  done: number
  total: number
  current: string
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>
type RecordRow = { id:number;slug:string;title:string;doi:string|null;path:string;source_kind:'pdf'|'record' }

interface OaLocation { pdf_url?: string | null; landing_page_url?: string | null; license?: string | null; source?: { display_name?: string | null } | null }
interface OaWork { id?: string; doi?: string | null; title?: string | null; display_name?: string | null; best_oa_location?: OaLocation | null; locations?: OaLocation[] | null }

function emptyCounts(): Record<OaRepairStatus, number> {
  return { available:0,not_available:0,no_identifier:0,no_match:0,download_failed:0,invalid_pdf:0,cancelled:0,error:0 }
}

function summarize(items:Array<OaRepairCandidate|OaRepairOutcome>):Record<OaRepairStatus,number> {
  const counts=emptyCounts()
  for(const item of items)counts[item.status]++
  return counts
}

function normalizeTitle(value:string):string {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g,' ').trim()
}

function titlesMatch(local:string,remote:string):boolean {
  const a=normalizeTitle(local),b=normalizeTitle(remote)
  if(!a||!b)return false
  if(a===b)return true
  const left=new Set(a.split(' ').filter(Boolean)),right=new Set(b.split(' ').filter(Boolean))
  let shared=0
  for(const token of left)if(right.has(token))shared++
  const dice=(2*shared)/(left.size+right.size)
  // 长标题允许多出副标题，但短标题必须接近重合，避免“深度学习”这类泛名串库。
  const inclusion=(a.includes(b)||b.includes(a))&&Math.min(a.length,b.length)>=20
  return dice>=0.82||inclusion
}

function safePublicHttpsUrl(raw:string):string|null {
  try {
    const url=new URL(raw)
    if(url.protocol!=='https:'||url.username||url.password)return null
    if(net.isIP(url.hostname))return null
    const host=url.hostname.toLowerCase()
    if(host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.endsWith('.internal')||host.endsWith('.home'))return null
    return url.toString()
  } catch {
    return null
  }
}

const blockedIps=new net.BlockList()
for(const [address,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.168.0.0',16],['198.18.0.0',15],['224.0.0.0',4],['240.0.0.0',4]] as Array<[string,number]>)blockedIps.addSubnet(address,prefix)
blockedIps.addAddress('::1','ipv6')
blockedIps.addSubnet('fc00::',7,'ipv6')
blockedIps.addSubnet('fe80::',10,'ipv6')
function isBlockedIp(rawIp:string):boolean {
  const ip=rawIp.toLowerCase()
  if(ip==='::')return true
  const mapped=ip.startsWith('::ffff:')&&net.isIPv4(ip.slice(7))?ip.slice(7):ip
  return blockedIps.check(mapped,net.isIPv6(mapped)?'ipv6':'ipv4')
}
type ResolveHostLike=(hostname:string)=>Promise<string[]>
const resolveHost:ResolveHostLike=async hostname=>(await dns.lookup(hostname,{all:true,verbatim:true})).map(item=>item.address)
async function assertPublicHost(hostname:string,resolver:ResolveHostLike):Promise<void> {
  if(net.isIP(hostname)) {
    if(isBlockedIp(hostname))throw new Error('PDF 地址解析到内网/本机地址，已拒绝下载')
    return
  }
  const addresses=await resolver(hostname)
  if(!addresses.length)throw new Error('PDF 域名没有可解析地址，已拒绝下载')
  if(addresses.some(address=>isBlockedIp(address)))throw new Error('PDF 域名解析到内网/本机地址，已拒绝下载')
}
function requestSignal(timeoutMs:number,external?:AbortSignal):{signal:AbortSignal;cleanup:()=>void} {
  const controller=new AbortController()
  const timer=setTimeout(()=>controller.abort(new DOMException('请求超过时间限制','TimeoutError')),timeoutMs)
  const abort=():void=>controller.abort(external?.reason)
  if(external?.aborted)abort()
  else external?.addEventListener('abort',abort,{once:true})
  return {signal:controller.signal,cleanup:()=>{
    clearTimeout(timer)
    external?.removeEventListener('abort',abort)
  }}
}
function recordRows(paperIds?:number[]):RecordRow[] {
  const db=getDb()
  if(paperIds?.length) {
    return db.prepare(`SELECT id,slug,title,doi,path,source_kind FROM active_papers WHERE source_kind='record' AND id IN (${paperIds.map(()=>'?').join(',')}) ORDER BY id`).all(...paperIds) as RecordRow[]
  }
  return db.prepare("SELECT id,slug,title,doi,path,source_kind FROM active_papers WHERE source_kind='record' ORDER BY id").all() as RecordRow[]
}

function encodeDoi(doi:string):string {
  return encodeURIComponent(doi.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i,'')).replace(/%2F/gi,'/')
}

function isAbortError(error:unknown):boolean {
  return error instanceof DOMException&&error.name==='AbortError'||/abort/i.test(String((error as Error)?.message??error))
}
async function getJson(url:string,fetchImpl:FetchLike,external?:AbortSignal):Promise<unknown> {
  const request=requestSignal(15_000,external)
  try {
    const response=await fetchImpl(url,{headers:{'User-Agent':UA},signal:request.signal})
    if(!response.ok)throw new Error(`HTTP ${response.status}`)
    return await response.json()
  } finally {request.cleanup()}
}

function fromWork(work:OaWork|undefined):{pdfUrl?:string;landingUrl?:string;sourceName?:string;license?:string|null} {
  const locations=[work?.best_oa_location,...(work?.locations??[])] as OaLocation[]
  for(const location of locations) {
    const pdf=typeof(location?.pdf_url)==='string'?safePublicHttpsUrl(location.pdf_url):null
    if(!pdf)continue
    return {
      pdfUrl:pdf,
      landingUrl:typeof(location.landing_page_url)==='string'?location.landing_page_url:undefined,
      sourceName:location.source?.display_name??'OpenAlex 开放获取',
      license:location.license??null
    }
  }
  return {}
}

async function locate(row:RecordRow,fetchImpl:FetchLike,signal?:AbortSignal):Promise<OaRepairCandidate> {
  const base={paperId:row.id,slug:row.slug,title:row.title,doi:row.doi?.trim()||null}
  const doi=base.doi?encodeDoi(base.doi):''
  if(doi) {
    try {
      const work=await getJson(`https://api.openalex.org/works/doi:${doi}?mailto=cspaper%40app.local`,fetchImpl,signal) as OaWork
      const link=fromWork(work)
      if(link.pdfUrl)return {...base,status:'available',matchedBy:'doi',...link}
      return {...base,status:'not_available',matchedBy:'doi',reason:'OpenAlex 匹配到文献，但没有提供可直接下载的 OA PDF',landingUrl:link.landingUrl,sourceName:link.sourceName,license:link.license}
    } catch(error) {
      if(isAbortError(error))throw error
      /* DOI 失败时允许标题检索兜底 */
    }
  }
  const title=row.title.replace(/\s+/g,' ').trim().slice(0,120)
  if(!title)return {...base,status:'no_identifier',reason:'缺少 DOI 和可用标题，无法安全匹配'}
  try {
    const result=await getJson(`https://api.openalex.org/works?search=${encodeURIComponent(title)}&per-page=1&mailto=cspaper%40app.local`,fetchImpl,signal) as {results?:OaWork[]}
    const work=result.results?.[0]
    const remote=work?.display_name??work?.title??''
    if(!work||!remote||!titlesMatch(row.title,remote))return {...base,status:'no_match',reason:'标题检索没有足够相似的 OpenAlex 记录，为避免串库不导入'}
    const link=fromWork(work)
    if(link.pdfUrl)return {...base,status:'available',matchedBy:'title',...link}
    return {...base,status:'not_available',matchedBy:'title',reason:'OpenAlex 标题匹配成功，但没有可直接下载的 OA PDF',landingUrl:link.landingUrl,sourceName:link.sourceName,license:link.license}
  } catch(error) {
    if(isAbortError(error))throw error
    return {...base,status:'error',reason:String(error).slice(0,200)}
  }
}

export async function previewOaRepairs(input:{paperIds?:number[];fetchImpl?:FetchLike;signal?:AbortSignal;resolveHostImpl?:ResolveHostLike;onProgress?:(p:OaRepairProgress)=>void}={}):Promise<OaRepairPreview> {
  const fetchImpl=input.fetchImpl??((url,init)=>fetch(url,init))
  const rows=recordRows(input.paperIds?.map(Number).filter(Number.isInteger))
  const out:OaRepairCandidate[]=[]
  for(let i=0;i<rows.length;i++) {
    input.onProgress?.({phase:'preview',done:i,total:rows.length,current:rows[i].title})
    out.push(await locate(rows[i],fetchImpl,input.signal))
    if(i+1<rows.length)await new Promise(resolve=>setTimeout(resolve,120))
  }
  input.onProgress?.({phase:'preview',done:rows.length,total:rows.length,current:''})
  return {total:out.length,counts:summarize(out),candidates:out}
}

async function downloadPdf(url:string,fetchImpl:FetchLike,external?:AbortSignal,resolver:ResolveHostLike=resolveHost):Promise<{file:string;bytes:number}> {
  const parsed=new URL(url)
  if(!safePublicHttpsUrl(parsed.toString()))throw new Error('PDF 地址不是公网 HTTPS，已拒绝下载')
  await assertPublicHost(parsed.hostname,resolver)
  const request=requestSignal(90_000,external)
  try {
    const response=await fetchImpl(url,{headers:{'User-Agent':UA},signal:request.signal})
    if(!response.ok)throw new Error(`PDF 下载失败 HTTP ${response.status}`)
    // fetch 会跟随重定向；最终地址仍必须是公网 HTTPS 且不能解析到内网，防止 OA 链接转到内网地址。
    if(response.url){
      const redirected=new URL(response.url)
      if(!safePublicHttpsUrl(redirected.toString()))throw new Error('PDF 重定向到非公网 HTTPS 地址，已拒绝下载')
      await assertPublicHost(redirected.hostname,resolver)
    }
    const declared=Number(response.headers.get('content-length')??'0')
    if(declared>MAX_PDF_BYTES)throw new Error('PDF 超过 100MB 上限')
    const chunks:Array<Uint8Array>=[]
    let bytes=0
    if(response.body) {
      const reader=response.body.getReader()
      for(;;) {
        const chunk=await reader.read()
        if(chunk.done)break
        bytes+=chunk.value.byteLength
        if(bytes>MAX_PDF_BYTES)throw new Error('PDF 超过 100MB 上限')
        chunks.push(chunk.value)
      }
    } else {
      const buffer=Buffer.from(await response.arrayBuffer())
      bytes=buffer.byteLength
      if(bytes>MAX_PDF_BYTES)throw new Error('PDF 超过 100MB 上限')
      chunks.push(buffer)
    }
    const pdf=Buffer.concat(chunks.map(chunk=>Buffer.from(chunk)))
    if(bytes<1024||pdf.subarray(0,5).toString('latin1')!=='%PDF-')throw new Error('下载内容不是有效 PDF')
    const dir=fs.mkdtempSync(path.join(app.getPath('temp'),'cspaper-oa-'))
    const file=path.join(dir,'paper.pdf')
    fs.writeFileSync(file,pdf)
    return {file,bytes}
  } finally {request.cleanup()}
}

function sha256(value:string|Buffer):string {
  return createHash('sha256').update(value).digest('hex')
}

export async function applyOaRepairs(input:{paperIds?:number[];fetchImpl?:FetchLike;signal?:AbortSignal;resolveHostImpl?:ResolveHostLike;onProgress?:(p:OaRepairProgress)=>void}={}):Promise<OaRepairApplyResult> {
  const db=getDb(),fetchImpl=input.fetchImpl??((url,init)=>fetch(url,init)),resolver=input.resolveHostImpl??resolveHost
  const rows=recordRows(input.paperIds?.map(Number).filter(Number.isInteger))
  const outcomes:OaRepairOutcome[]=[]
  let cancelled=false
  for(let i=0;i<rows.length;i++) {
    if(input.signal?.aborted){cancelled=true;break}
    const row=rows[i]
    input.onProgress?.({phase:'apply',done:i,total:rows.length,current:row.title})
    let candidate:OaRepairCandidate
    try{candidate=await locate(row,fetchImpl,input.signal)}
    catch(error) {
      if(isAbortError(error)){cancelled=true;break}
      outcomes.push({paperId:row.id,slug:row.slug,title:row.title,doi:row.doi,status:'error',repaired:false,error:String(error).slice(0,500)})
      continue
    }
    if(candidate.status!=='available') {
      outcomes.push({...candidate,repaired:false,error:candidate.reason})
      continue
    }
    let tempFile=''
    try {
      const pdfUrl=candidate.pdfUrl!
      const downloaded=await downloadPdf(pdfUrl,fetchImpl,input.signal,resolver)
      tempFile=downloaded.file
      const source=fs.statSync(tempFile),pdf=Buffer.from(fs.readFileSync(tempFile))
      const operationId=`oa-repair-${row.id}-${sha256(pdfUrl)}-${sha256(pdf)}`
      const existing=db.prepare('SELECT state,error FROM operation_journal WHERE id=?').get(operationId) as {state:string;error:string|null}|undefined
      if(existing?.state==='committed')throw new Error('该 PDF 版本已由操作日志幂等拦截，不能重复替换')
      if(existing)throw new Error(`存在未恢复的开放获取操作 ${operationId}（${existing.state}），请先处理操作记录`)
      const doc=readPaperMarkdown(row.path,row.slug)
      const markdown=patchFrontmatter(doc.raw||`# ${row.title}\n`,{source_kind:'pdf',oa_pdf_url:pdfUrl,source:'OpenAlex 开放获取'})
      const record=runFileOperation(db,{
        id:operationId,
        kind:'oa.repair_pdf',
        target:`paper:${row.id}`,
        expectedVersion:String((db.prepare('SELECT file_mtime,file_size FROM active_papers WHERE id=?').get(row.id) as {file_mtime?:number;file_size?:number}).file_mtime??0),
        edits:[{path:row.path,sourcePath:tempFile},{path:doc.path,content:markdown}],
        commit:()=> {
          db.prepare(`UPDATE papers SET source_kind='pdf',source_stamp=NULL,file_mtime=?,file_size=?,indexed=0,pvec=NULL,missing_at=NULL WHERE id=?`)
            .run(Math.round(source.mtimeMs),source.size,row.id)
        }
      })
      if(record.state==='failed')throw new Error(record.error||'PDF 替换失败')
      outcomes.push({...candidate,repaired:true,bytes:downloaded.bytes,operationId,backupDir:record.backup_dir})
    } catch(error) {
      if(isAbortError(error)) {
        cancelled=true
        outcomes.push({...candidate,repaired:false,status:'cancelled',error:'用户停止下载，本篇未替换'})
        break
      }
      const invalid=/不是有效 PDF/.test(String(error))
      outcomes.push({...candidate,repaired:false,status:invalid?'invalid_pdf':'download_failed',error:String(error).slice(0,500)})
    } finally {
      if(tempFile) {
        try {fs.rmSync(path.dirname(tempFile),{recursive:true,force:true})} catch {/* temporary cleanup is best-effort */}
      }
    }
    if(i+1<rows.length)await new Promise(resolve=>setTimeout(resolve,120))
  }
  input.onProgress?.({phase:'apply',done:cancelled?outcomes.length:rows.length,total:rows.length,current:''})
  const repaired=outcomes.filter(item=>item.repaired).length
  const failed=outcomes.filter(item=>item.status==='download_failed'||item.status==='invalid_pdf'||item.status==='error').length
  if(repaired>0)await scanLibraryAsync(getSettings().libraryPath)
  return {total:rows.length,repaired,failed,skipped:Math.max(0,rows.length-repaired-failed),cancelled,outcomes}
}
