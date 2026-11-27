/** Derive a short, readable task / conversation title from the user's goal. */
export function summarizeTaskTitle(text:string,max=28):string {
  let title=text.replace(/\s+/g,' ').trim()
  title=title.replace(/^\/(?:plan|auto|goal|tpl)\s+/,'')
  // 剥掉口语化的请求前缀（可叠加，如“请帮我…”）
  const prefix=/^(?:请帮我一下|请帮我|帮我一下|请问一下|请问|麻烦|帮忙|帮助我|能不能|能否|可以吗|我希望|我想|我要|请|帮我|帮助|可以)[，,：:\s]*/
  for(let round=0;round<4;round++) {
    const next=title.replace(prefix,'')
    if(next===title)break
    title=next
  }
  const cut=title.search(/[：:。；;\n]/)
  if(cut>=4)title=title.slice(0,cut)
  title=title.replace(/[，,。；;！!？?]+$/,'').trim()
  if(title.length>max)title=title.slice(0,max)+'…'
  return title||'新任务'
}
