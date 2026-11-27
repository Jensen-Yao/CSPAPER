// 结构化输出管线（v0.23）：剥离思考标签 → 修复常见 JSON 瑕疵 → 校验 → 失败自动重试 → 字段级降级。
// 精读 / 对比 / 小结共用，模型“先思考再输出”或夹杂围栏与尾逗号时也能稳定取回字段。
import { z } from 'zod'
import type { ChatMessage } from '../llm'

export const EMPTY_MARKERS=new Set(['未提及','未提供','无','n/a','na','none','null','undefined','not mentioned','not specified','-','—'])
export function isEmptyField(value:unknown):boolean {
  const text=String(value??'').trim()
  return !text||EMPTY_MARKERS.has(text.toLowerCase())
}
export function stripThink(raw:string):string {
  let text=raw
  for(let round=0;round<4;round++) {
    const next=text.replace(/<(think|thought|reasoning|thinking)>[\s\S]*?<\/\1>/gi,'').replace(/```(?:thinking|thought|reasoning)[\s\S]*?```/gi,'')
    if(next===text)break
    text=next
  }
  // Unclosed leading think block: keep everything after the last closing tag if the opening tag precedes any JSON.
  if(/<(think|thought|reasoning|thinking)>/i.test(text)&&!/<\/(think|thought|reasoning|thinking)>/i.test(text)) {
    const cut=text.replace(/<(think|thought|reasoning|thinking)>[\s\S]*/i,'')
    if(cut.trim())text=cut
  }
  return text.trim()
}
export function repairJson(text:string):string {
  let out=text
  // Remove JavaScript-style comments outside strings.
  out=out.replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*/g,(match,string)=>string??'')
  out=out.replace(/("(?:\\.|[^"\\])*")|\/\*[\s\S]*?\*\//g,(match,string)=>string??'')
  // Trailing commas before ] or }
  out=out.replace(/,(\s*[}\]])/g,'$1')
  // Python / JavaScript literals
  out=out.replace(/\bTrue\b/g,'true').replace(/\bFalse\b/g,'false').replace(/\bNone\b/g,'null')
  // Raw control characters inside strings
  out=out.replace(/"([^"\\]*)"/g,(_match,body:string)=>'"'+body.replace(/\s*\n\s*/g,' ').replace(/[\u0000-\u001f]/g,' ')+'"')
  return out
}
function parseLoose(text:string):unknown {
  try { return JSON.parse(text) } catch { /* fall through */ }
  try { return JSON.parse(repairJson(text)) } catch { /* fall through */ }
  return undefined
}
/** Slice the outermost balanced JSON object or array, ignoring braces inside strings. */
export function extractJsonCandidate(raw:string):string|null {
  let text=raw.trim().replace(/^```(?:json|jsonc)?\s*/i,'').replace(/\s*```\s*$/i,'').trim()
  const start=text.search(/[{[]/)
  if(start<0)return null
  text=text.slice(start)
  const open=text[0],close=open==='{'?'}':']'
  let depth=0,inString=false,escaped=false
  for(let index=0;index<text.length;index++) {
    const char=text[index]
    if(inString) {
      if(escaped)escaped=false
      else if(char==='\\')escaped=true
      else if(char==='"')inString=false
      continue
    }
    if(char==='"')inString=true
    else if(char===open)depth++
    else if(char===close) { depth--; if(depth===0)return text.slice(0,index+1) }
  }
  // Unbalanced (truncated) output: close what was opened so partial fields survive.
  const closed=(text.match(new RegExp('\\'+open,'g'))||[]).length-(text.match(new RegExp('\\'+close,'g'))||[]).length
  return closed>0?text+close.repeat(closed):text
}
export interface StructuredResult<T> { ok:boolean;value?:T;partial:Record<string,string>;complete:number;total:number;raw:string;error?:string;attempts:number }

export function parseStructured<T>(raw:string,schema:z.ZodType<T>,options:{labels?:Record<string,string[]>}={}):StructuredResult<T> {
  const stripped=stripThink(raw),candidate=extractJsonCandidate(stripped)
  const parsed=schema.safeParse(candidate?parseLoose(candidate):undefined)
  const shape=(schema as unknown as {shape?:Record<string,z.ZodTypeAny>}).shape??{}
  const keys=Object.keys(shape)
  const partial:Record<string,string>={}
  const loose=candidate?parseLoose(candidate):undefined
  for(const key of keys) {
    const value=(loose as Record<string,unknown>|undefined)?.[key]
    if(typeof value==='string')partial[key]=value.trim()
    else if(Array.isArray(value))partial[key]=JSON.stringify(value)
    else if(value!==null&&value!==undefined)partial[key]=String(value)
  }
  // Field-level fallback: labelled lines in prose ("研究问题：…").
  for(const key of keys) {
    if(partial[key]&&!isEmptyField(partial[key]))continue
    for(const label of options.labels?.[key]??[]) {
      const match=new RegExp('(?:^|\\n)\\s*(?:[-*•]|\\d+[.、)])?\\s*(?:\\*\\*)?'+label+'(?:\\*\\*)?\\s*[:：]\\s*([^\\n]+)').exec(stripped)
      if(match){partial[key]=match[1].replace(/\*\*/g,'').trim();break}
    }
  }
  const complete=keys.filter(key=>!isEmptyField(partial[key])).length
  if(parsed.success)return {ok:true,value:parsed.data,partial,complete,total:keys.length,raw,attempts:1}
  const issues=parsed.success?[]:parsed.error.issues.map(issue=>`${issue.path.join('.')}: ${issue.message}`).slice(0,6)
  return {ok:false,partial,complete,total:keys.length,raw,error:issues.join('；')||'输出不是有效 JSON',attempts:1}
}

export interface GenerateStructuredOptions<T> {
  prompt:ChatMessage[]
  schema:z.ZodType<T>
  stream:(messages:ChatMessage[],opts?:{signal?:AbortSignal})=>AsyncGenerator<string>
  signal?:AbortSignal
  labels?:Record<string,string[]>
  minComplete?:number
}
/** Generate, validate, retry once with the error fed back, then degrade field by field. */
export async function generateStructured<T>(options:GenerateStructuredOptions<T>):Promise<StructuredResult<T>> {
  const collect=async(messages:ChatMessage[]):Promise<string>=>{let out='';for await(const delta of options.stream(messages,{signal:options.signal}))out+=delta;return out}
  const raw=await collect(options.prompt)
  let result=parseStructured(raw,options.schema,{labels:options.labels})
  result.attempts=1
  const minimum=options.minComplete??1
  if(result.ok&&result.complete>=minimum)return result
  const issue=result.ok?`有 ${result.total-result.complete} 个字段为空`:(result.error??'输出不是有效 JSON')
  const repair=[...options.prompt,{role:'assistant',content:raw.slice(-6000)},{role:'user',content:`上面的输出不是可解析的结构化结果（${issue}）。请只输出严格 JSON：不要思考过程、不要 Markdown 围栏、不要任何多余文字；字符串内不要换行；论文没有的字段写“未提及”。`}] as ChatMessage[]
  const retried=await collect(repair)
  const second=parseStructured(retried,options.schema,{labels:options.labels})
  second.attempts=2
  if(second.ok&&second.complete>=minimum)return second
  // Keep whichever attempt carries more usable fields.
  const best=second.complete>result.complete?second:result
  best.attempts=2
  return best
}
