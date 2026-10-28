import { useRef } from 'react'
import * as Icon from './Icon'

export default function AddLiteratureMenu({onPdf,onOnline,onRecords,onZotero}:{onPdf:()=>void;onOnline?:()=>void;onRecords:()=>void;onZotero?:()=>void}):JSX.Element {
  const ref=useRef<HTMLDetailsElement>(null)
  const actions=[{label:'添加 PDF',hint:'文件或文件夹',action:onPdf,icon:<Icon.Pdf size={16}/>},
    {label:'从标识符或链接添加',hint:'DOI、arXiv、网页',action:onOnline,icon:<Icon.Globe size={16}/>},
    {label:'导入题录',hint:'RIS、BibTeX、知网导出',action:onRecords,icon:<Icon.Doc size={16}/>},
    {label:'从 Zotero 导入',hint:'迁移已有文献与笔记',action:onZotero,icon:<Icon.Library size={16}/>}]
  return <details ref={ref} className="add-literature" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node)) e.currentTarget.open=false}}>
    <summary className="btn"><Icon.Plus size={14}/>添加文献<Icon.ChevronD size={12}/></summary>
    <div className="add-literature-menu" aria-label="添加文献的来源">
      {actions.filter(item=>item.action).map(item=><button key={item.label} onClick={()=>{if(ref.current)ref.current.open=false;item.action?.()}}>{item.icon}<span><b>{item.label}</b><small>{item.hint}</small></span></button>)}
    </div>
  </details>
}
