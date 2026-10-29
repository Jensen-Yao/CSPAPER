import { z } from 'zod'

export const planStepSchema = z.object({
  id:z.string().min(1),
  tool:z.string().min(1),
  args:z.record(z.string(),z.unknown()).default({}),
  purpose:z.string().trim().min(1).max(2000),
  risk:z.enum(['read','reversible_write','batch_write','external_effect','destructive']).optional()
})
export type PlanStepRecord = z.infer<typeof planStepSchema>

export interface PlanToolPolicy { name:string;version:number;risk:PlanStepRecord['risk'];maxCallsPerRun?:number }

export function validatePlan(plan:unknown,tools:PlanToolPolicy[]):{ok:true;steps:PlanStepRecord[]}|{ok:false;errors:string[]} {
  const parsed=z.array(planStepSchema).safeParse(plan)
  if(!parsed.success) return {ok:false,errors:parsed.error.issues.map(issue=>`${issue.path.join('.')}: ${issue.message}`)}
  const errors:string[]=[],counts=new Map<string,number>()
  for(const [index,step] of parsed.data.entries()) {
    const policy=tools.find(tool=>tool.name===step.tool)
    if(!policy) {errors.push(`步骤 ${index+1}: 未知工具 ${step.tool}`);continue}
    if(policy.risk!==step.risk) errors.push(`步骤 ${index+1}: ${step.tool} 风险应为 ${policy.risk}`)
    const next=(counts.get(step.tool)??0)+1;counts.set(step.tool,next)
    if(policy.maxCallsPerRun&&next>policy.maxCallsPerRun) errors.push(`${step.tool} 超过单次运行上限 ${policy.maxCallsPerRun}`)
  }
  return errors.length?{ok:false,errors}:{ok:true,steps:parsed.data}
}

/** Models sometimes wrap strict JSON in prose or fences. Select the outermost JSON object without executing markdown. */
export function parseModelJsonObject(raw:string):unknown {
  const text=raw.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/i,'')
  try{return JSON.parse(text)}catch{}
  const start=text.indexOf('{'),end=text.lastIndexOf('}')
  if(start<0||end<=start)throw new Error('模型计划不是有效 JSON')
  return JSON.parse(text.slice(start,end+1))
}

export function extractPlanSteps(parsed:unknown):unknown[]|null {
  if(Array.isArray(parsed))return parsed
  if(!parsed||typeof parsed!=='object')return null
  const record=parsed as Record<string,unknown>
  for(const key of ['steps','plan','tools']) {
    const value=record[key]
    if(Array.isArray(value))return value
    if(value&&typeof value==='object'&&Array.isArray((value as Record<string,unknown>).steps))return (value as Record<string,unknown>).steps as unknown[]
  }
  return null
}
