// CSPAPER 统一图标库：16×16 细线 SVG（stroke 1.4、round cap/join、currentColor）。
// 全应用唯一的图标来源——禁止再在视图里写 emoji 或内联 SVG。
import type { ReactNode } from 'react'

type P = { size?: number; className?: string }
const svg = (children: ReactNode): ((p: P) => JSX.Element) => {
  const C = ({ size = 16, className }: P): JSX.Element => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {children}
    </svg>
  )
  return C
}

// ---------- 模式与导航 ----------
export const Zap = svg(<path d="M9 1.8 3.6 8.6h3.1L6.4 14.2 12 7.2H8.7z" />) // Work
export const Library = svg( // Paper：书架
  <>
    <path d="M2.5 2.5h4v11h-4zM9.5 2.5h4v11h-4z" />
    <path d="M2.5 5.5h4M9.5 5.5h4" />
  </>
)
export const Sidebar = svg( // 左侧栏开关
  <>
    <rect x="2" y="2.8" width="12" height="10.4" rx="1.6" />
    <path d="M6.2 2.8v10.4" />
  </>
)
export const Panel = svg( // 右侧栏开关
  <>
    <rect x="2" y="2.8" width="12" height="10.4" rx="1.6" />
    <path d="M9.8 2.8v10.4" />
  </>
)
export const Gear = svg(
  <>
    <circle cx="8" cy="8" r="2.1" />
    <path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6l1.4 1.4M11 11l1.4 1.4M12.4 3.6 11 5M5 11l-1.4 1.4" />
  </>
)

// ---------- 通用动作 ----------
export const Plus = svg(<path d="M8 3v10M3 8h10" />)
export const Search = svg(
  <>
    <circle cx="7" cy="7" r="4.4" />
    <path d="M10.4 10.4 14 14" />
  </>
)
export const X = svg(<path d="M3.8 3.8l8.4 8.4M12.2 3.8 3.8 12.2" />)
export const Check = svg(<path d="M3 8.6 6.4 12 13 4.4" />)
export const Calendar = svg(<><rect x="2.3" y="3.4" width="11.4" height="10.4" rx="1.5" /><path d="M5.2 2v2.8M10.8 2v2.8M2.5 6.5h11" /></>)
export const Copy = svg(
  <>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.4" />
    <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
  </>
)
export const Save = svg(<path d="M8 2.5v8M4.8 7.5 8 10.7l3.2-3.2M2.8 12.8h10.4" />) // 下载/导出
export const Upload = svg(<path d="M8 13.5v-8M4.8 8.5 8 5.3l3.2 3.2M2.8 2.8h10.4" />) // 上传/导入
export const Refresh = svg(
  <>
    <path d="M13.2 8a5.2 5.2 0 1 1-1.6-3.8" />
    <path d="M13.4 2.6v2.8h-2.8" />
  </>
)
export const Play = svg(<path d="M5 3.5 12.5 8 5 12.5z" />)
export const Stop = svg(<rect x="3.8" y="3.8" width="8.4" height="8.4" rx="1.4" fill="currentColor" stroke="none" />)
export const External = svg(
  <>
    <path d="M6.5 3.5h-3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-3" />
    <path d="M9.5 2.5h4v4M13.3 2.7 8 8" />
  </>
)
export const ChevronL = svg(<path d="M10 3.5 5.5 8l4.5 4.5" />)
export const ChevronR = svg(<path d="M6 3.5 10.5 8 6 12.5" />)
export const ChevronD = svg(<path d="M3.5 6 8 10.5 12.5 6" />)
export const ChevronU = svg(<path d="M3.5 10 8 5.5 12.5 10" />)
export const CaretD = svg(<path d="M4 6.5 8 10.5l4-4" />)

// ---------- 文献与学术 ----------
export const Compare = svg( // 对比表
  <>
    <rect x="2" y="2.5" width="12" height="11" rx="1.4" />
    <path d="M2 6h12M2 9.5h12M6.5 2.5v11" />
  </>
)
export const Table = svg( // 纵览表格
  <>
    <path d="M2.5 3.5h11v9h-11z" />
    <path d="M2.5 6.5h11M2.5 9.5h11M6 3.5v9" />
  </>
)
export const Notes = svg( // 笔记
  <>
    <path d="M4 2.5h8v11H4z" />
    <path d="M6 5.5h4M6 8h4M6 10.5h2.5" />
  </>
)
export const Globe = svg(
  <>
    <circle cx="8" cy="8" r="5.6" />
    <path d="M2.4 8h11.2M8 2.4c2.6 2.8 2.6 8.4 0 11.2-2.6-2.8-2.6-8.4 0-11.2z" />
  </>
)
export const Doc = svg(
  <>
    <path d="M4 2.5h5.5L13 6v7.5H4z" />
    <path d="M6 8.5h4M6 11h4" />
  </>
)
export const Pdf = svg(
  <>
    <path d="M4 2.5h5.5L13 6v7.5H4z" />
    <path d="M9.5 2.5V6H13" />
    <path d="M5.8 11.2V8.5h.9a.9.9 0 0 1 0 1.8h-.9M9 11.2V8.5h.8a1.35 1.35 0 0 1 0 2.7H9" />
  </>
)
export const Quote = svg(
  <>
    <path d="M6.5 4.5C4.5 5.2 3.5 6.7 3.5 9v2.5h4V8H5.5c0-1.3.6-2.2 2-2.8z" />
    <path d="M12.5 4.5c-2 .7-3 2.2-3 4.5v2.5h4V8h-2c0-1.3.6-2.2 2-2.8z" />
  </>
)
export const Link = svg(
  <>
    <path d="M6.5 9.5 9.5 6.5" />
    <path d="M5 7 3.6 8.4a2.6 2.6 0 0 0 3.7 3.7L8.7 10.6M11 6.4l1.4-1.4a2.6 2.6 0 0 0-3.7-3.7L7.3 3.4" />
  </>
)
export const Highlight = svg( // 高亮笔
  <>
    <path d="M9.5 2.5 13.5 6.5 8 12H4.5L3.8 11.3 9.5 5.5z" fill="none" />
    <path d="M3 13.5h10" strokeWidth="2.2" opacity="0.55" />
  </>
)
export const Comment = svg(
  <>
    <path d="M2.5 3.5h11v7h-6L4 13.5V10.5H2.5z" />
    <path d="M5.5 7h5" />
  </>
)
export const Tag = svg(
  <>
    <path d="M2.5 8.5v-6h6l5 5-6 6z" />
    <circle cx="5.5" cy="5.5" r="1" fill="currentColor" stroke="none" />
  </>
)
export const Folder = svg(<path d="M2 4a1 1 0 0 1 1-1h3l1.5 2H13a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" />)
export const Star = svg(<path d="M8 2.2l1.7 3.6 3.9.5-2.9 2.7.8 3.9L8 10.9l-3.5 2 .8-3.9L2.4 6.3l3.9-.5z" />)
export const Info = svg(
  <>
    <circle cx="8" cy="8" r="5.6" />
    <path d="M8 7.2v3.6" />
    <circle cx="8" cy="5.2" r="0.7" fill="currentColor" stroke="none" />
  </>
)
export const Warning = svg(
  <>
    <path d="M8 2.6 14.2 13H1.8z" />
    <path d="M8 6.4v3" />
    <circle cx="8" cy="11.2" r="0.7" fill="currentColor" stroke="none" />
  </>
)
export const Target = svg(
  <>
    <circle cx="8" cy="8" r="5.6" />
    <circle cx="8" cy="8" r="2.4" />
  </>
)
export const Clock = svg(
  <>
    <circle cx="8" cy="8" r="5.6" />
    <path d="M8 5v3.2l2.2 1.4" />
  </>
)
export const Grid = svg( // 插件市场
  <>
    <rect x="2.5" y="2.5" width="4.6" height="4.6" rx="1" />
    <rect x="8.9" y="2.5" width="4.6" height="4.6" rx="1" />
    <rect x="2.5" y="8.9" width="4.6" height="4.6" rx="1" />
    <rect x="8.9" y="8.9" width="4.6" height="4.6" rx="1" />
  </>
)
export const Package = svg( // 产物
  <>
    <path d="M8 1.8 14 5v6L8 14.2 2 11V5z" />
    <path d="M2 5l6 3.2L14 5M8 8.2v6" />
  </>
)
export const Graph = svg( // 知识网络
  <>
    <circle cx="4" cy="4" r="1.8" />
    <circle cx="12" cy="5.5" r="1.8" />
    <circle cx="7" cy="12" r="1.8" />
    <path d="M5.7 4.8 10.3 5.2M4.8 5.7 6.2 10.3M11.2 7 8 10.6" />
  </>
)
export const Chart = svg( // 统计
  <>
    <path d="M2.5 13.5h11" />
    <path d="M4.5 13V8M8 13V4.5M11.5 13v-6" />
  </>
)
export const Expand = svg(<path d="M2.5 8h11M5 5.2 2.2 8 5 10.8M11 5.2 13.8 8 11 10.8" />)
export const Sparkle = svg( // AI 能力统一标识
  <>
    <path d="M8 2 9.2 6.1 13.3 7.3 9.2 8.5 8 12.6 6.8 8.5 2.7 7.3 6.8 6.1z" />
    <path d="M12.4 11.2l.5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5z" />
  </>
)
export const Dot = svg(<circle cx="8" cy="8" r="4" fill="currentColor" stroke="none" />)
export const Up = svg(<path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />)
export const ArrowD = svg(<path d="M8 3v10M3.5 8.5 8 13l4.5-4.5" />)
export const Shield = svg(
  <>
    <path d="M8 1.8 13 3.6v4.2c0 3.2-2.1 5.3-5 6.4-2.9-1.1-5-3.2-5-6.4V3.6z" />
    <path d="M5.8 8l1.5 1.5L10.2 6.4" />
  </>
)
export const Mail = svg(
  <>
    <rect x="2" y="3.5" width="12" height="9" rx="1.4" />
    <path d="M2.4 4.2 8 8.6l5.6-4.4" />
  </>
)
export const Book = svg( // 阅读
  <>
    <path d="M2.5 3.2c1.8-.8 3.7-.8 5.5 0v9.6c-1.8-.8-3.7-.8-5.5 0z" />
    <path d="M13.5 3.2c-1.8-.8-3.7-.8-5.5 0v9.6c1.8-.8 3.7-.8 5.5 0z" />
  </>
)
export const Chat = svg(
  <>
    <path d="M2.5 3.5h11v7h-6L4 13.5V10.5H2.5z" />
    <path d="M5.5 7h5" />
  </>
)
