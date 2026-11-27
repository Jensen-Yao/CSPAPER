// Work 面板共享的类型与工具函数（从 WorkbenchView 拆出）
export type SkillChoice = { name: string; description: string; source: 'builtin' | 'user' }
export interface AutoRow { id: number; name: string; goal: string; interval_minutes: number; enabled: number; last_run_at: string | null; last_result: string | null }
export const AUTOS: Array<{ label: string; minutes: number }> = [
  { label: '每天', minutes: 1440 },
  { label: '每 6 小时', minutes: 360 },
  { label: '每 30 分钟', minutes: 30 }
]
// ZCode 式相对时间：刚刚 / N 分钟前 / N 小时前 / 昨天 / N 天前 / 日期
export function relTime(createdAt: string): string {
  const d = new Date(createdAt.includes('T') ? createdAt : createdAt.replace(' ', 'T') + 'Z').getTime()
  if (Number.isNaN(d)) return ''
  const diff = Date.now() - d
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 172_800_000) return '昨天'
  if (diff < 2_592_000_000) return `${Math.floor(diff / 86_400_000)} 天前`
  return new Date(d).toISOString().slice(0, 10)
}
