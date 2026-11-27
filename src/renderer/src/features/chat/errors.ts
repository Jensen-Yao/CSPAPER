// 可读的失败原因：把供应商 / 网络 / 超时错误翻译成用户能处理的提示。
export interface RunErrorLike { code?:string; message?:string }
export function friendlyRunError(error:RunErrorLike|undefined|null):string {
  const message=String(error?.message??'').trim(),code=String(error?.code??'')
  if(code==='run_timeout'||/超过时间限制|TimeoutError/i.test(message))return '模型响应超时：可在设置里延长任务时限，或换用更快的模型后重试。'
  if(code==='approval_denied')return message||'用户拒绝执行工具'
  if(code==='retrieval_empty')return message||'未检索到可引用来源'
  if(code==='readonly')return message||'当前会话为只读模式'
  if(/\b401\b|invalid.?api.?key|unauthorized|鉴权|authentication/i.test(message))return '模型服务拒绝了请求：API Key 无效、过期或与接口地址不匹配。请到「设置 → 模型服务」检查后重试。'
  if(/\b403\b|forbidden/i.test(message))return '模型服务拒绝了访问（403）：该 Key 可能没有此模型的权限，或账号已欠费。'
  if(/\b429\b|rate.?limit|too many requests|限流/i.test(message))return '模型服务限流（429）：请求过于频繁或额度用尽，请稍后重试或更换模型。'
  if(/ECONNREFUSED|ENOTFOUND|ECONNRESET|ETIMEDOUT|fetch failed|network|证书|self.?signed|proxy|代理/i.test(message))return '无法连接模型服务：请检查网络、代理设置与 API 地址是否可达。'
  if(/binding|绑定|无效/i.test(message)&&/模型/.test(message))return '所选模型绑定无效：请到「设置 → 模型服务」重新选择模型。'
  if(!message)return '本轮运行失败，可重试或更换模型。'
  return message.replace(/^Error:\s*/,'').slice(0,220)
}
export function needsSettings(error:RunErrorLike|undefined|null):boolean {
  const message=String(error?.message??'')
  return /\b401\b|\b403\b|invalid.?api.?key|unauthorized|绑定|无效|ECONNREFUSED|ENOTFOUND|fetch failed|api.?base|apiKey/i.test(message)
}
