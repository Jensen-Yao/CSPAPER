// CSPAPER 斜杠命令框架（CLI 化）：Work 合成器与对话输入共用。
// 输入 "/" 唤起命令菜单；↑↓ 选择、Tab 补全、Enter 执行；
// 带参命令可直接内联执行（/goal 调研韧性电网）或先补全再输入参数。
export interface SlashCmd {
  name: string
  args?: string
  desc: string
  group: '任务' | '模型' | '导航'
}

export const SLASH_CMDS: SlashCmd[] = [
  { name: 'plan', args: '目标', desc: '以「执行前确认」模式发起任务：先出计划，确认后执行', group: '任务' },
  { name: 'auto', args: '目标', desc: '以「完全访问」模式发起任务：计划生成后自动执行', group: '任务' },
  { name: 'goal', args: '长期目标', desc: '设定研究长期目标：后续所有任务都会围绕该目标执行', group: '任务' },
  { name: 'tpl', args: '模板名', desc: '套用任务模板（主题调研 / 精读论文 / 多文对比 / 睡眠日报 / 深度调研）', group: '任务' },
  { name: 'new', desc: '开始新任务（清空当前选择）', group: '任务' },
  { name: 'model', args: '关键词', desc: '切换智能体模型（支持模糊匹配，如 /model glm）', group: '模型' },
  { name: 'deep', args: 'low|mid|high|max', desc: '切换执行深度（最多工具调用步数 8/16/24/48）', group: '模型' },
  { name: 'skills', desc: '打开技能面板', group: '导航' },
  { name: 'mcp', desc: '打开插件市场（MCP 服务器）', group: '导航' },
  { name: 'cron', desc: '打开自动化面板（定时任务）', group: '导航' },
  { name: 'help', desc: '显示全部命令', group: '导航' }
]

/** 输入是否处于命令模式（以 / 开头且无空格前缀内容） */
export const isCommandInput = (v: string): boolean => v.startsWith('/')

/** 按前缀过滤命令列表（"/pl" → plan） */
export const filterSlash = (v: string): SlashCmd[] => {
  const q = v.slice(1).split(/\s/)[0].toLowerCase()
  if (!q) return SLASH_CMDS
  return SLASH_CMDS.filter((c) => c.name.startsWith(q))
}

/** 解析完整命令行："/goal 调研韧性" → { name:'goal', args:'调研韧性' } */
export const parseSlash = (v: string): { name: string; args: string; cmd?: SlashCmd } | null => {
  const m = v.match(/^\/(\w+)(?:\s+([\s\S]*))?$/)
  if (!m) return null
  const name = m[1].toLowerCase()
  const cmd = SLASH_CMDS.find((c) => c.name === name)
  return cmd ? { name, args: (m[2] ?? '').trim(), cmd } : null
}

export const TPL_ALIASES: Record<string, string> = {
  调研: '主题调研', 主题: '主题调研', 综述: '主题调研',
  精读: '精读论文', 阅读: '精读论文',
  对比: '多文对比', 比较: '多文对比',
  日报: '睡眠日报', 睡眠: '睡眠日报',
  深度: '深度调研', 深读: '深度调研'
}

export const DEEP_ALIAS: Record<string, number> = { low: 8, mid: 16, high: 24, max: 48, 低: 8, 中: 16, 高: 24, 最高: 48 }
