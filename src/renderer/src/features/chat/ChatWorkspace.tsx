import type { ReactNode } from 'react'
import './chat.css'

/** Layout shared by full chat, the reading sidebar and the task conversation. */
export default function ChatWorkspace({layout='full',navigation,children}:{layout?:'full'|'sidebar'|'task';navigation?:ReactNode;children:ReactNode}) {
  return <section className={`chat-workspace chat-workspace-${layout}`} aria-label={layout==='sidebar'?'阅读助手':layout==='task'?'任务对话':'文献对话'}>
    {navigation}<div className="chat-workspace-main">{children}</div>
  </section>
}
