// 对比表维度体系：
//  - 基础字段（BASE_FIELDS）：直接从文献元数据提取，无需 AI
//  - AI 分析维度（AI_DIMENSION_PRESETS）：AI 读原文提取要点（附页码出处）
//  - 自定义维度：用户命名，同样由 AI 生成
export interface BaseField {
  id: string
  desc: string
  get: (p: { title: string; authors: string; year: number | null; venue: string; category: string }) => string
}

export const BASE_FIELDS: BaseField[] = [
  { id: '标题', desc: '文献的完整标题', get: (p) => p.title },
  { id: '作者', desc: '文献的全部作者列表', get: (p) => p.authors || '—' },
  { id: '期刊名称', desc: '发表的期刊或会议名称', get: (p) => p.venue || '—' },
  { id: '发表年份', desc: '文献发表的年份', get: (p) => (p.year != null ? String(p.year) : '—') },
  { id: '分类', desc: '文献库中的分类', get: (p) => p.category || '—' }
]

export interface DimensionPreset {
  name: string
  desc: string
}

export const AI_DIMENSION_PRESETS: DimensionPreset[] = [
  { name: '研究背景', desc: '研究的背景、动机和意义' },
  { name: '研究问题', desc: '研究要解决的核心问题' },
  { name: '研究方法', desc: '采用的研究方法和技术路线' },
  { name: '研究成果', desc: '研究的主要成果和发现' },
  { name: '创新点', desc: '研究的创新之处和突破点' },
  { name: '应用价值', desc: '研究的实际应用价值' },
  { name: '局限性', desc: '研究的不足和局限性' }
]
