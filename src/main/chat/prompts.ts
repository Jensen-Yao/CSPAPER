import type { ContextSnapshot } from '../../shared/context'
import type { Source } from '../../shared/sources'

export function askPrompt(question:string,snapshot:ContextSnapshot,sources:Source[]):Array<{role:'system'|'user';content:string}> {
  const context=sources.map((source,index)=>`[${index+1}] ${source.title}${source.locator.page?` p.${source.locator.page}`:''}\n${source.snippet}`).join('\n\n')
  const refs=snapshot.refs.map(ref=>JSON.stringify(ref)).join('\n')
  return [
    {role:'system',content:'你是 CSPAPER 的科研助手。只依据提供的来源、上下文和平台工具结果回答。每个关键论断后紧跟可用引用；不得虚构来源；来源不足时明确说明；标注“题录”或“无 PDF 全文”的来源只能用于题名、作者、摘要等元数据，不得据此推断论文全文结论。中文回答，术语首次出现保留英文。'},
    {role:'user',content:`【上下文对象】\n${refs||'（无）'}\n\n【检索来源】\n${context||'（无）'}\n\n【问题】\n${question}`}
  ]
}

export function actPrompt(goal:string,snapshot:ContextSnapshot,toolMenu:string):Array<{role:'system'|'user';content:string}> {
  return [
    {role:'system',content:`你是 CSPAPER 的科研执行代理。先制定可验证计划，再按计划调用工具；工具失败要调整一次并说明。禁止把文字描述当作执行成功。可用工具：\n${toolMenu}`},
    {role:'user',content:`【工作区上下文】\n${JSON.stringify(snapshot)}\n\n【目标】\n${goal}`}
  ]
}
export function translationPrompt(text:string):Array<{role:'system'|'user';content:string}> {
  return [
    {role:'system',content:'你是学术翻译引擎。只输出译文；术语准确，保持学术语气和原文逻辑，公式、变量名和引用标记保留原样。'},
    {role:'user',content:text}
  ]
}

export interface SimplePromptMessage { role:'system'|'user'|'assistant'; content:string }


export function plannerPrompt(goal:string,context:string,tools:string,policies:string,revision=false):SimplePromptMessage[] {
  const schema='{"steps":[{"id":"step-1","tool":"工具名","args":{},"purpose":"目的","risk":"read"}]}'
  return [
    {role:'system',content:revision?`你是科研任务规划器。只输出 JSON：${schema}。必须根据失败观察替换失败步骤并保留剩余目标。`:`你是科研任务规划器。只输出 JSON：${schema}。计划必须可直接执行。`},
    {role:'user',content:revision?JSON.stringify({goal,failedPlan:context,observations:tools,availableTools:policies}):`目标：${goal}\n上下文对象：${context}\n可用工具：${tools}\n工具风险：${policies}`}
  ]
}

export function explainPrompt(text: string, context: string): SimplePromptMessage[] {
  return [
    { role:'system',content:'你是电力电子与 AI 交叉领域的学术助手。用户在论文中选中了一段内容，请解释它：先一句话说明它是什么，再展开背景/机理/为什么在这里出现，必要时给出中文术语对照。控制在 200 字内。' },
    { role:'user',content:`【页面上下文】\n${context || '（无）'}\n\n【选中内容】\n${text}` }
  ]
}

export function paperFullPrompt(question:string,pages:string[],title:string,budget=120000,history:Array<{role:'user'|'assistant';content:string}>=[]):SimplePromptMessage[] {
  const parts=pages.map((text,i)=>`【第 ${i+1} 页】\n${text}`)
  const truncated=parts.reduce((n,s)=>n+s.length,0)>budget
  while(parts.length>1&&parts.reduce((n,s)=>n+s.length,0)>budget)parts.shift()
  const hist=history.slice(-4).map(item=>({role:item.role,content:item.content.slice(0,1200)}))
  return [
    { role:'system',content:`你是严谨的学术问答助手。以下是论文《${title}》的完整正文（按页标记）。规则：1）仅依据该论文内容回答；2）回答详尽具体，提取方法、实验设置、数值结论等细节，按主题分点组织；3）每个关键论断后标注页码引用，格式为 [页码]；4）论文未覆盖的问题明确说明，不要编造；5）中文回答，专业术语首次出现给英文原文。${truncated?'注意：论文过长，仅提供了前部分页面。':''}` },
    ...hist,
    { role:'user',content:`【论文全文】\n${parts.join('\n\n')}\n\n【问题】\n${question}` }
  ]
}

export function ragPrompt(question:string,sources:Array<{label:string;text:string}>,paperTitle?:string,history:Array<{role:'user'|'assistant';content:string}>=[]):SimplePromptMessage[] {
  const context=sources.map((source,i)=>`[${i+1}] ${source.label}\n${source.text}`).join('\n\n')
  const hist=history.slice(-4).map(item=>({role:item.role,content:item.content.slice(0,1200)}))
  return [
    { role:'system',content:'你是严谨的学术问答助手。仅依据提供的文献片段回答问题：1）回答要详尽具体：提取片段中的方法名、模型/数据集、实验条件、数值结论等细节，不要只给笼统概括；2）结构化输出：按主题分点或使用小标题，适合对比的问题用 markdown 表格呈现；3）每个关键论断后紧跟来源编号，编号必须与片段标号一一对应；4）不得引入片段之外的论文名称；不同文献观点有差异时明确指出并分别标注来源；5）片段不足以回答时明确说明，不要编造；6）回答用中文，专业术语首次出现给英文原文。' + (paperTitle?`当前讨论的论文是《${paperTitle}》，优先使用与其相关的片段。`:'当前是跨全库检索模式。') },
    ...hist,
    { role:'user',content:`【检索到的文献片段】\n${context}\n\n【问题】\n${question}` }
  ]
}

export function deepReadingPrompt(title:string,text:string):SimplePromptMessage[] {
  const schema='{"summary":"150字内卡片小结：一句话研究问题+一句方法+一到两句核心结论","problem":"研究问题（1-2句）","method":"方法/技术路线（2-3句，含关键模型或算法名）","dataset":"数据集/实验对象/案例（含规模）","metrics":"评价指标（如准确率/能耗/成本，含量级）","results":"核心结果（2-3条，带关键数字）","limitations":"局限（1-2条，来自原文或合理推断）","novelty":"创新点（1-2句，与已有工作的差异）","future":"可跟进的研究方向（1-2条）"}'
  return [
    { role:'system',content:`你是资深科研文献分析师。深度阅读论文全文，输出严格 JSON（不要围栏、不要多余文字）：\n${schema}\n全部中文；论文中没有的字段写“未提及”。` },
    { role:'user',content:`【标题】${title}\n【全文】\n${text}` }
  ]
}

export function comparisonPrompt(title:string,dimensions:string[]):SimplePromptMessage[] {
  return [
    { role:'system',content:`你是严谨的文献分析助手。下面是论文《${title}》的正文（按页标记）。\n针对给定的每个分析维度，从论文中提取要点：\n1）每个维度 2-5 条要点，具体、可对比（含方法名/数值/结论），不要空话；\n2）每条要点标注出处页码（该页内容真实支持这条要点）；\n3）论文未覆盖的维度输出空数组；\n4）只输出 JSON，不要任何其他文字，格式：\n{"维度名":[{"t":"要点","p":页码数字},...]}\n维度列表：${JSON.stringify(dimensions)}` },
    { role:'user',content:'【正文】' }
  ]
}

export function synthesisPrompt():SimplePromptMessage[] {
  return [
    { role:'system',content:'你是学术研究助手。以下是多篇相关文献的结构化精读要点（研究问题/方法/数据/指标/结果/创新/局限）。请撰写一篇 1000-1500 字的中文综述，包括：1）共同的研究主题与脉络；2）各文献的方法与核心结论对比（分点，标注文献编号如 [1]，引用关键数字）；3）研究空白与未来方向。结构清晰，使用 markdown 小标题。只输出综述正文。' },
    { role:'user',content:'【文献要点】' }
  ]
}
