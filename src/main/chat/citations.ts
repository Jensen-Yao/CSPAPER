import type { Source } from '../../shared/sources'

export interface CitationMatch { label:number;sourceId:string;source:Source }

/** Parse model citation labels and bind them to exact source IDs. Display numbers never identify a source by themselves. */
export function validateCitations(markdown:string,sources:Source[]):{matches:CitationMatch[];missing:number[];unknown:number[]} {
  const prose=markdown.replace(/```[\s\S]*?```/g,'').replace(/`[^`]*`/g,'')
  const labels=[...prose.matchAll(/\[(\d{1,3})(?:,\s*\d{1,3})*\]/g)].flatMap(match=>match[0].match(/\d{1,3}/g)??[])
  const missing:number[]=[],unknown:number[]=[],matches:CitationMatch[]=[]
  for(const label of labels) {
    const source=sources[Number(label)-1]
    if(!source) {unknown.push(Number(label));continue}
    if(source.status!=='available') missing.push(Number(label))
    else matches.push({label:Number(label),sourceId:source.id,source})
  }
  return {matches,missing:[...new Set(missing)],unknown:[...new Set(unknown)]}
}

export function citationWarning(result:{missing:number[];unknown:number[]}):string|null {
  if(!result.missing.length&&!result.unknown.length) return null
  const parts:string[]=[]
  if(result.missing.length)parts.push(`来源已变化：${result.missing.join(',')}`)
  if(result.unknown.length)parts.push(`无效引用：${result.unknown.join(',')}`)
  return parts.join('；')
}
