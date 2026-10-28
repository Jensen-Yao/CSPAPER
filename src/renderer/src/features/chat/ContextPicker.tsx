import { useMemo, useState } from 'react'
import * as Icon from '../../Icon'
import type { Paper } from '../../types'

export interface ContextCollection { id:number;name:string;n:number }
export default function ContextPicker({papers,collections=[],selected,selectedCollections=[],onChange,onCollectionsChange}:{papers:Paper[];collections?:ContextCollection[];selected:number[];selectedCollections?:number[];onChange:(ids:number[])=>void;onCollectionsChange?:(ids:number[])=>void}) {
  const [open,setOpen]=useState(false),[query,setQuery]=useState('')
  const q=query.trim().toLowerCase()
  const filtered=useMemo(()=>{
    return (q?papers.filter(paper=>paper.title.toLowerCase().includes(q)||paper.authors.toLowerCase().includes(q)||paper.slug.toLowerCase().includes(q)):papers).slice(0,30)
  },[papers,q])
  const filteredCollections=useMemo(()=>{
    return q?collections.filter(collection=>collection.name.toLowerCase().includes(q)):collections
  },[collections,q])
  const selectedPapers=papers.filter(paper=>selected.includes(paper.id))
  const selectedCollectionRows=collections.filter(collection=>selectedCollections.includes(collection.id))
  const togglePaper=(id:number)=>onChange(selected.includes(id)?selected.filter(item=>item!==id):[...selected,id])
  const toggleCollection=(id:number)=>{if(!onCollectionsChange)return;onCollectionsChange(selectedCollections.includes(id)?selectedCollections.filter(item=>item!==id):[...selectedCollections,id])}
  const clear=()=>{onChange([]);onCollectionsChange?.([])}
  const count=selected.length+selectedCollections.length
  return <div className="chat-context-picker">
    <button className={`wb-pill ${open||count?'on':''}`} onClick={()=>setOpen(!open)} title="选择参与对话的文献和集合">
      {<Icon.Library size={13}/>}{count?`${count} 个上下文`:'上下文'}<span className="wb-pill-caret">▾</span>
    </button>
    {(selectedPapers.length>0||selectedCollectionRows.length>0)&&(
      <div className="chat-context-chips">
        {selectedPapers.map(paper=><button key={'paper-'+paper.id} className="chat-context-chip" title={paper.title} onClick={()=>togglePaper(paper.id)}>{paper.title.slice(0,26)} ✕</button>)}
        {selectedCollectionRows.map(collection=><button key={'collection-'+collection.id} className="chat-context-chip" title={collection.name} onClick={()=>toggleCollection(collection.id)}>{collection.name.slice(0,26)} ✕</button>)}
      </div>
    )}
    {open&&(
      <>
        <div className="wb-pop-mask" onClick={()=>setOpen(false)}/>
        <div className="chat-context-pop">
          <input autoFocus value={query} placeholder="搜索文献 / 集合" onChange={event=>setQuery(event.target.value)}/>
          <div className="chat-context-list">
            {filtered.map(paper=>(
              <button key={paper.id} className={selected.includes(paper.id)?'on':''} onClick={()=>togglePaper(paper.id)}>
                <b className="ellipsis">{paper.title}</b>
                <small>{paper.year??''} · {paper.category}</small>
              </button>
            ))}
            {onCollectionsChange&&filteredCollections.map(collection=>(
              <button key={'ctx-collection-'+collection.id} className={selectedCollections.includes(collection.id)?'on':''} onClick={()=>toggleCollection(collection.id)}>
                <b className="ellipsis">{collection.name}</b>
                <small>集合 · {collection.n} 篇</small>
              </button>
            ))}
            {!filtered.length&&(!onCollectionsChange||!filteredCollections.length)&&<div className="wb-dim">没有匹配上下文</div>}
          </div>
          <footer>
            <button onClick={clear}>清空</button>
            <button className="primary" onClick={()=>setOpen(false)}>完成（{count}）</button>
          </footer>
        </div>
      </>
    )}
  </div>
}
