import { saveMarkmapHtml } from './lib/markmap'

interface Props {
  /** 论文标题（用作导出文件名与 HTML 标题） */
  title: string
  /** 我的笔记 markdown 文本（交给 markmap 渲染） */
  markdown: string
}

/**
 * 「思维导图」小按钮：把一段 markdown（通常是当前论文的我的笔记）
 * 导出为 markmap 自包含 HTML 并下载。
 * 独立组件，不依赖宿主状态——由 PaperDetailPanel 的「我的笔记」区块按需接线：
 *   <NotesMarkmapButton title={paper.title} markdown={myNote} />
 */
export default function NotesMarkmapButton({ title, markdown }: Props): JSX.Element {
  const empty = markdown.trim() === ''
  return (
    <button
      className="cmp-mini note-mm-btn"
      disabled={empty}
      title={empty ? '还没有笔记内容，先写点笔记再生成思维导图' : '把我的笔记导出为思维导图 HTML（浏览器打开即可交互查看）'}
      onClick={() => void saveMarkmapHtml(title, markdown)}
    >
      思维导图
    </button>
  )
}
