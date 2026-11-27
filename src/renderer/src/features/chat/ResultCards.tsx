import { useState, type ReactNode } from 'react'
import type { ArtifactRef } from '../../../../shared/tools'
import MarkdownContent from './MarkdownContent'

const labels:Record<string,string>={note:'笔记',comparison:'对比表',synthesis:'综述',paper:'文献',task:'任务',project:'项目',calendar:'日程',file:'导出文件',web:'网页',report:'报告',citation:'引文'}
const PREVIEWABLE=new Set(['comparison','note'])

/** Real artifacts produced by a run: open in place, or preview inline (comparison tables and notes). */
export default function ResultCards({artifacts,onOpen}:{artifacts:ArtifactRef[];onOpen:(artifact:ArtifactRef)=>void}) {
  const [previews,setPreviews]=useState<Record<string,ReactNode|null>>({})
  const [busy,setBusy]=useState('')
  if(!artifacts.length)return null
  const preview=async(artifact:ArtifactRef)=>{
    setBusy(artifact.id)
    try {
      let node:ReactNode=null
      if(artifact.kind==='comparison') {
        const [tables,papers]=await Promise.all([window.api.compareList(),window.api.listPapers()])
        const table=tables.find(item=>String(item.id)===artifact.entityId)
        if(!table)node=<div className="chat-result-empty">对比表不存在或已删除</div>
        else {
          const dims=table.data.dimensions,titleOf=new Map(papers.map(paper=>[paper.id,paper.title]))
          node=<div className="chat-result-preview"><table><thead><tr><th>文献</th>{dims.map(dim=><th key={dim}>{dim}</th>)}</tr></thead><tbody>{table.data.paperIds.slice(0,4).map(id=><tr key={id}><td title={titleOf.get(id)}>{(titleOf.get(id)??`#${id}`).slice(0,24)}</td>{dims.map(dim=><td key={dim}>{(table.data.cells[String(id)]?.[dim]??[]).slice(0,2).map(cell=>cell.t).join('；')||'—'}</td>)}</tr>)}</tbody></table>{table.data.paperIds.length>4&&<div className="chat-result-empty">另有 {table.data.paperIds.length-4} 篇未展示</div>}</div>
        }
      } else if(artifact.kind==='note') {
        const standalone=/^standalone-(\d+)$/.exec(artifact.entityId??'')
        const text=standalone?((await window.api.standaloneNotesGet(Number(standalone[1]))) as {body_md?:string}|undefined)?.body_md:await window.api.myNotesGet(Number(artifact.entityId))
        node=<div className="chat-result-preview"><MarkdownContent text={String(text??'').slice(0,3000)} onCitation={()=>{}}/></div>
      }
      setPreviews(current=>({...current,[artifact.id]:node}))
    } catch(error) { setPreviews(current=>({...current,[artifact.id]:<div className="chat-result-empty">{String(error).replace(/^Error: /,'')}</div>})) }
    finally { setBusy('') }
  }
  return <div className="chat-result-cards">{artifacts.map(artifact=>{
    const open=previews[artifact.id]!==undefined
    return <div key={artifact.id} className="chat-result-card">
      <div className="chat-result-head"><button type="button" className="chat-result-open" onClick={()=>onOpen(artifact)}><b>{artifact.title}</b><small>{labels[artifact.kind]??'产物'}</small></button>
        {PREVIEWABLE.has(artifact.kind)&&<button type="button" className="chat-result-preview-btn" disabled={busy===artifact.id} onClick={()=>open?setPreviews(current=>({...current,[artifact.id]:undefined})):void preview(artifact)}>{open?'收起':busy===artifact.id?'加载中…':'预览'}</button>}
      </div>
      {open&&previews[artifact.id]}
    </div>
  })}</div>
}
