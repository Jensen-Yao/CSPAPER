// 笔记模板（W3，对标 Zotcard 卡片笔记）：一键插入「我的笔记」
export interface NoteTemplate {
  id: string
  name: string
  desc: string
  content: string
}

const today = (): string => new Date().toLocaleDateString('zh-CN')

export const NOTE_TEMPLATES: NoteTemplate[] = [
  {
    id: 'reading-card',
    name: '文献阅读卡',
    desc: '研究问题/方法/结论/创新/局限/启发 六格结构化精读卡',
    content: `## 文献阅读卡（${today()}）

### 研究问题
-

### 方法
-

### 核心结论
-

### 创新点
-

### 局限性
-

### 对我的启发
-
`
  },
  {
    id: 'blank',
    name: '空白笔记',
    desc: '自由记录',
    content: `## 笔记（${today()}）

`
  },
  {
    id: 'compare-card',
    name: '对比综述卡',
    desc: '多篇文献对比记录框架',
    content: `## 对比综述（${today()}）

### 对比维度
| 文献 | 方法 | 数据 | 结论 |
| --- | --- | --- | --- |
|  |  |  |  |

### 共同发现
-

### 分歧点
-

### 研究空白
-
`
  },
  {
    id: 'formula-card',
    name: '方法/公式卡',
    desc: '记录关键公式、模型结构、参数设置',
    content: `## 方法卡（${today()}）

### 模型/公式
\`\`\`

\`\`\`

### 参数与设置
-

### 适用条件与注意
-
`
  }
]
