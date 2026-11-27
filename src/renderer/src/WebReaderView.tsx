// 网页阅读视图（N-7）：以阅读版式打开抓取到的网页 / PDF 正文；可划词提问、加入对话、刷新快照。
import { useEffect, useRef, useState } from 'react'
import type { WebPageInfo } from '../../shared/web'
import MarkdownContent from './features/chat/MarkdownContent'
import * as Icon from './Icon'
import { dispatchWorkspaceAction, type WorkspaceChatWeb } from './workspace-actions'

interface Props { url:string; onClose:()=>void }

export default function WebReaderView({url,onClose}:Props) {
  const [page,setPage]=useState<WebPageInfo|null>(null)
  const [error,setError]=useState('')
  const [loading,setLoading]=useState(false)
  const [updated,setUpdated]=useState<WebPageInfo|null>(null)
  const [selection,setSelection]=useState<{text:string;x:number;y:number}|null>(null)
  const bodyRef=useRef<HTMLDivElement>(null)
  const load=(force=false)=>{
    setLoading(true);setError('');setUpdated(null);setSelection(null)
    void window.api.webFetch({url,forceRefresh:force}).then(result=>{
      setPage(result)
      // 快照命中缓存时顺带检查线上版本：内容哈希变化则提示“来源已更新”
      if(!force&&result.fromCache)void window.api.webFetch({url,forceRefresh:true}).then(fresh=>{if(fresh.contentHash!==result.contentHash)setUpdated(fresh)}).catch(()=>{})
    }).catch(error=>setError(String(error).replace(/^Error: /,''))).finally(()=>setLoading(false))
  }
  useEffect(()=>{load()},[url])  // eslint-disable-line react-hooks/exhaustive-deps
  const webRef=(text?:string):WorkspaceChatWeb=>({url:page?.finalUrl||page?.url||url,title:page?.title||url,snippet:text??page?.markdown.slice(0,30000)??'',documentVersion:'web:'+(page?.contentHash??'')})
  const ask=(text?:string)=>{
    if(!page)return
    dispatchWorkspaceAction({kind:'chat',paperIds:[],web:[webRef(text)],prompt:text?`请解释这段内容的含义，并说明它在全文中的作用：\n\n${text.slice(0,2000)}`:undefined})
    onClose()
  }
  const onMouseUp=():void=>{
    const text=window.getSelection()?.toString().trim()??''
    if(!text||text.length<2||!bodyRef.current?.contains(window.getSelection()?.anchorNode??null)){setSelection(null);return}
    const rect=window.getSelection()?.getRangeAt(0).getBoundingClientRect()
    setSelection({text,x:rect?rect.left+rect.width/2:100,y:rect?rect.top:100})
  }
  return <div className="modal-mask web-reader-mask" onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}}>
    <section className="web-reader" role="dialog" aria-label="网页阅读" onMouseUp={onMouseUp}>
      <header className="web-reader-head">
        <div className="web-reader-title">
          <b>{page?.title||url}</b>
          <small>{page?.siteName||new URL(url).hostname}{page?.byline?` · ${page.byline}`:''}{page?.fetchedAt?` · 读取于 ${page.fetchedAt.slice(0,16).replace('T',' ')}`:''}{page?.chars?` · ${page.chars} 字`:''}</small>
        </div>
        <div className="web-reader-actions">
          <button className="btn ghost" disabled={!page} onClick={()=>ask()} title="把整页正文作为上下文开始对话"><Icon.Chat size={13}/> 加入对话</button>
          <button className="btn ghost" onClick={()=>load(true)} disabled={loading} title="重新抓取并更新快照"><Icon.Refresh size={13}/> {loading?'读取中…':'刷新'}</button>
          <button className="btn ghost" onClick={()=>void window.api.openExternal(page?.finalUrl||url)} title="在浏览器中打开原网页"><Icon.Globe size={13}/> 原网页</button>
          <button className="pd-x" title="关闭（Esc）" aria-label="关闭" onClick={onClose}>✕</button>
        </div>
      </header>
      {updated&&<div className="web-reader-updated" role="status">来源已更新：线上版本与当前快照不同（最新读取于 {updated.fetchedAt.slice(0,16).replace('T',' ')}）。<button type="button" onClick={()=>{setPage(updated);setUpdated(null)}}>查看最新</button></div>}
      {error&&<div className="chat-message-error" role="alert">{error}</div>}
      {loading&&!page&&<div className="web-reader-state">正在读取网页…</div>}
      {page&&<article className="web-reader-body" ref={bodyRef}>{page.kind==='pdf'?<pre className="web-reader-pdf">{page.markdown}</pre>:<MarkdownContent text={page.markdown} onCitation={()=>{}}/>}</article>}
      {selection&&<div className="web-reader-selection" style={{left:Math.min(selection.x,window.innerWidth-280),top:Math.max(8,selection.y-48)}}><span className="ellipsis">{selection.text.slice(0,60)}</span><button type="button" onClick={()=>ask(selection.text)}>提问这段</button><button type="button" onClick={()=>setSelection(null)}>取消</button></div>}
    </section>
  </div>
}
