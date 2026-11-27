// 统一网络层（v0.23）：所有联网请求走 Electron net.fetch（跟随系统代理 / 可手动配置代理），
// 每一跳重定向都经过公网校验，响应体有大小与时间上限，失败原因可读。
import { app, net, session } from 'electron'
import { getSettings } from './db'
import { assertPublicHost, redirectTarget, safePublicHttpsUrl } from './net-guard'

export const USER_AGENT='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 CSPAPER/0.23'
export const BROWSER_PARTITION='persist:cspaper-web'
export const DEFAULT_TIMEOUT_MS=20_000
export const DEFAULT_MAX_BYTES=20*1024*1024

export type NetworkErrorCode='invalid_url'|'blocked'|'timeout'|'too_large'|'aborted'|'http'|'offline'|'network'
export class NetworkError extends Error {
  readonly code:NetworkErrorCode
  readonly status?:number
  constructor(code:NetworkErrorCode,message:string,status?:number){super(message);this.code=code;this.status=status}
}

export interface NetFetchOptions { timeoutMs?:number;maxBytes?:number;signal?:AbortSignal;headers?:Record<string,string>;browserSession?:boolean;maxRedirects?:number;method?:'GET'|'POST';body?:string }
export interface NetResponse { url:string;status:number;contentType:string;buffer:Buffer;headers:Record<string,string>;bytes:number }

let appliedProxy:string|undefined
/** Push the configured proxy (or the system proxy) to the default session and the built-in browser partition. */
export function applyProxySettings():void {
  const proxyUrl=(getSettings().proxyUrl??'').trim()
  if(appliedProxy===proxyUrl)return
  appliedProxy=proxyUrl
  const config=proxyUrl?{proxyUrl}:{mode:'system' as const}
  for(const ses of [session.defaultSession,session.fromPartition(BROWSER_PARTITION)])ses.setProxy(config).catch(()=>{})
}

export function webEnabled():boolean { return getSettings().webEnabled!==false }
export function useBrowserSession():boolean { return getSettings().webUseBrowserSession===true }

function describeStatus(status:number):string {
  if(status===401||status===407)return '需要登录：该站点要求身份验证，可在内置浏览器登录后启用「使用浏览器登录态」'
  if(status===403)return '站点拒绝访问（403）：可能有反爬限制，可在内置浏览器登录后重试'
  if(status===429)return '请求过于频繁（429）：请稍后再试'
  if(status===404)return '页面不存在（404）'
  return `HTTP ${status}`
}

async function readBody(response:Response,maxBytes:number):Promise<Buffer> {
  const declared=Number(response.headers.get('content-length')??'0')
  if(declared>maxBytes)throw new NetworkError('too_large',`响应体超过 ${(maxBytes/1024/1024).toFixed(0)}MB 上限`)
  if(!response.body)return Buffer.alloc(0)
  const reader=response.body.getReader(),chunks:Buffer[]=[];let bytes=0
  for(;;) {
    const chunk=await reader.read()
    if(chunk.done)break
    bytes+=chunk.value.byteLength
    if(bytes>maxBytes){await reader.cancel().catch(()=>{});throw new NetworkError('too_large',`响应体超过 ${(maxBytes/1024/1024).toFixed(0)}MB 上限`)}
    chunks.push(Buffer.from(chunk.value))
  }
  return Buffer.concat(chunks)
}

function toNetworkError(error:unknown,timeoutMs:number):NetworkError {
  const name=String((error as {name?:string})?.name??''),message=String(error)
  if(name==='TimeoutError'||name==='AbortError'&&/超|time/i.test(message))return new NetworkError('timeout',`请求超时（${Math.round(timeoutMs/1000)} 秒）`)
  if(name==='AbortError')return new NetworkError('aborted','请求已取消')
  if(/ERR_PROXY|ERR_TUNNEL|proxy/i.test(message))return new NetworkError('network','代理连接失败：请检查设置中的代理地址')
  if(/ERR_NAME_NOT_RESOLVED|ENOTFOUND/i.test(message))return new NetworkError('network','域名无法解析：请检查网络或代理')
  if(/ERR_INTERNET_DISCONNECTED|ENOTINTERNET|offline/i.test(message))return new NetworkError('offline','当前无网络连接')
  return new NetworkError('network',message.replace(/^Error:\s*/,'').slice(0,160)||'网络请求失败')
}

const MAX_CONCURRENT=4
let activeRequests=0
const waiting:Array<()=>void>=[]
async function acquireSlot():Promise<()=>void> {
  if(activeRequests>=MAX_CONCURRENT)await new Promise<void>(resolve=>waiting.push(resolve))
  activeRequests++
  return ()=>{activeRequests--;waiting.shift()?.()}
}

/** Fetch a public HTTPS URL with bounded redirects, time, size and concurrency. `browserSession` reuses the built-in browser's cookies. */
export async function netFetch(rawUrl:string,options:NetFetchOptions={}):Promise<NetResponse> {
  const first=safePublicHttpsUrl(rawUrl)
  if(!first)throw new NetworkError('invalid_url','仅支持公网 HTTPS 链接（不接受内网、本机或非 http(s) 地址）')
  applyProxySettings()
  const release=await acquireSlot()
  try { return await netFetchInner(first,options) } finally { release() }
}

async function netFetchInner(first:string,options:NetFetchOptions):Promise<NetResponse> {
  const timeoutMs=options.timeoutMs??DEFAULT_TIMEOUT_MS,maxBytes=options.maxBytes??DEFAULT_MAX_BYTES,maxRedirects=options.maxRedirects??5
  const timeout=AbortSignal.timeout(timeoutMs)
  const signal=options.signal?AbortSignal.any([options.signal,timeout]):timeout
  let current=first
  for(let hop=0;hop<=maxRedirects;hop++) {
    signal.throwIfAborted()
    const target=new URL(current)
    await assertPublicHost(target.hostname)
    const headers:Record<string,string>={'User-Agent':USER_AGENT,Accept:'text/html,application/xhtml+xml,application/json,application/pdf,*/*;q=0.8,application/xml;q=0.9', 'Accept-Language':'zh-CN,zh;q=0.9,en;q=0.8',...(options.headers??{})}
    let response:Response
    try {
      const init:RequestInit={method:options.method??'GET',headers,body:options.body,signal,redirect:'manual',credentials:'include'}
      if(options.browserSession||useBrowserSession())response=await session.fromPartition(BROWSER_PARTITION).fetch(current,init)
      else if(app.isReady())response=await net.fetch(current,init)
      else response=await fetch(current,init)
    } catch(error) {
      if(options.signal?.aborted)throw new NetworkError('aborted','请求已取消')
      throw toNetworkError(error,timeoutMs)
    }
    if(response.status>=300&&response.status<400&&options.method&&options.method!=='GET') {
      await response.body?.cancel().catch(()=>{})
      throw new NetworkError('http','接口返回了重定向（'+response.status+'），请检查接口地址',response.status)
    }
    if(response.status>=300&&response.status<400) {
      const location=response.headers.get('location')
      if(!location)throw new NetworkError('http','重定向响应缺少目标地址',response.status)
      if(hop===maxRedirects)throw new NetworkError('http','重定向次数过多',response.status)
      const next=redirectTarget(current,location)
      if(!next)throw new NetworkError('blocked','重定向目标不是公网 HTTPS 地址，已拒绝访问')
      current=next
      continue
    }
    if(!response.ok) {
      await response.body?.cancel().catch(()=>{})
      throw new NetworkError('http',describeStatus(response.status),response.status)
    }
    const finalUrl=response.url||current
    const finalSafe=safePublicHttpsUrl(finalUrl)
    if(!finalSafe)throw new NetworkError('blocked','最终地址不是公网 HTTPS，已拒绝访问')
    if(finalSafe!==current)await assertPublicHost(new URL(finalSafe).hostname)
    let buffer:Buffer
    try { buffer=await readBody(response,maxBytes) } catch(error) { if(error instanceof NetworkError)throw error;throw toNetworkError(error,timeoutMs) }
    return { url:finalSafe,status:response.status,contentType:(response.headers.get('content-type')??'').toLowerCase(),buffer,headers:Object.fromEntries(response.headers.entries()),bytes:buffer.length }
  }
  throw new NetworkError('http','重定向次数过多')
}

export function decodeBuffer(buffer:Buffer,contentType:string):string {
  const match=/charset=([\w-]+)/i.exec(contentType)
  try { return new TextDecoder(match?.[1]??'utf-8').decode(buffer) } catch { return buffer.toString('utf8') }
}

/** Text convenience used by translators and search scripts. */
export async function fetchText(url:string,options:NetFetchOptions={}):Promise<{url:string;text:string;contentType:string;buffer:Buffer}> {
  const response=await netFetch(url,options)
  return {url:response.url,text:decodeBuffer(response.buffer,response.contentType),contentType:response.contentType,buffer:response.buffer}
}
