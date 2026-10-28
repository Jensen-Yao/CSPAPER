import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import type { SourceRef } from '../../types'

interface MarkdownNode { type: string; value?: string; url?: string; children?: MarkdownNode[] }
// Transform text nodes only. Code, math and existing links retain their original meaning.
export function remarkCitations() {
  return (tree: MarkdownNode): void => {
    const visit = (node: MarkdownNode): void => {
      if(['link','linkReference','code','inlineCode','math','inlineMath','definition'].includes(node.type))return
      if(!node.children)return
      node.children=node.children.flatMap(child=>{
        if(child.type!=='text') { visit(child); return [child] }
        const value=child.value??'',parts: MarkdownNode[]=[]
        let offset=0
        for(const match of value.matchAll(/\[(\d{1,3})\]/g)) {
          const index=match.index!
          if(index>offset)parts.push({type:'text',value:value.slice(offset,index)})
          parts.push({type:'link',url:`#citation-${match[1]}`,children:[{type:'text',value:match[0]}]})
          offset=index+match[0].length
        }
        if(offset<value.length)parts.push({type:'text',value:value.slice(offset)})
        return parts.length?parts:[child]
      })
    }
    visit(tree)
  }
}

export default function MarkdownContent({text,sources=[],onCitation}:{text:string;sources?:SourceRef[];onCitation?:(source:SourceRef)=>void}) {
  return <div className="chat-markdown"><ReactMarkdown remarkPlugins={[remarkGfm,remarkMath,remarkCitations]} rehypePlugins={[rehypeKatex]} components={{
    a({href,children}) {
      const match=/^#citation-(\d+)$/.exec(href??'')
      if(match) {
        const source=sources.find(item=>item.n===Number(match[1]))
        return <button type="button" className="cite-chip" disabled={!source} title={source?`${source.title} · 第 ${source.page} 页`:'本轮没有可核实的对应来源'} aria-label={source?`打开来源 ${source.n}：${source.title}，第 ${source.page} 页`:'来源不可用'} onClick={()=>source&&onCitation?.(source)}>{children}</button>
      }
      return <a href={href} onClick={event=>{event.preventDefault();if(href&&/^https?:\/\//.test(href))window.api.openExternal(href)}}>{children}</a>
    }
  }}>{text}</ReactMarkdown></div>
}
