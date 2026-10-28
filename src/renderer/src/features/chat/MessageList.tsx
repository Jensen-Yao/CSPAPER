import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { Message, RunStatus } from '../../../../shared/chat'
import type { RunDetails } from '../../../../shared/chat-api'
import type { SourceRef } from '../../types'
import type { Jump } from '../../rich'
import MessageItem,{messageText} from './MessageItem'

interface Props { messages:Message[];sources?:SourceRef[];runs?:Record<string,RunDetails>;jumpFor:(index:number)=>Jump;running?:boolean;status?:RunStatus;className?:string;empty?:ReactNode;conversationId?:string;hasMore?:boolean;loading?:boolean;onLoadOlder?:()=>Promise<void> }
const labels:Partial<Record<RunStatus,string>>={queued:'排队中',preparing:'正在准备上下文',generating:'正在生成回答',executing_tools:'正在执行工具',awaiting_approval:'等待确认'}

export default function MessageList({messages,sources,runs,jumpFor,running,status,className='chat-log',empty,conversationId,hasMore,loading,onLoadOlder}:Props) {
  const parentRef=useRef<HTMLDivElement>(null)
  const atBottom=useRef(true),previous=useRef({id:conversationId,count:messages.length,first:messages[0]?.id})
  const [visible,setVisible]=useState(false),[unread,setUnread]=useState(0)
  const useVirtual=messages.length>30
  const virtualizer=useVirtualizer({count:messages.length,getScrollElement:()=>parentRef.current,estimateSize:index=>Math.min(600,80+messageText(messages[index]).length/2),getItemKey:index=>messages[index].id,overscan:5,enabled:useVirtual&&visible})
  useEffect(()=>{const element=parentRef.current;if(!element)return;const observer=new ResizeObserver(()=>setVisible(element.clientHeight>0));observer.observe(element);return ()=>observer.disconnect()},[])
  const scrollEnd=()=>{
    const element=parentRef.current;if(!element)return
    if(useVirtual)virtualizer.scrollToIndex(messages.length-1,{align:'end'})
    else element.scrollTop=element.scrollHeight
    atBottom.current=true;setUnread(0)
  }
  useLayoutEffect(()=>{
    const old=previous.current,changed=old.id!==conversationId,prepended=old.first&&old.first!==messages[0]?.id&&old.count<messages.length
    if(changed){atBottom.current=true;setUnread(0)}
    if(visible&&!prepended&&(atBottom.current||changed)) {
      const frame=requestAnimationFrame(scrollEnd)
      previous.current={id:conversationId,count:messages.length,first:messages[0]?.id}
      return ()=>cancelAnimationFrame(frame)
    }
    if(!atBottom.current&&!prepended&&messages.length>old.count)setUnread(value=>value+messages.length-old.count)
    previous.current={id:conversationId,count:messages.length,first:messages[0]?.id}
  },[messages,conversationId,visible])
  const loadOlder=async()=>{
    const element=parentRef.current;if(!element||!onLoadOlder)return
    const height=element.scrollHeight,top=element.scrollTop
    await onLoadOlder()
    requestAnimationFrame(()=>{element.scrollTop=top+element.scrollHeight-height})
  }
  const items=useVirtual?virtualizer.getVirtualItems():messages.map((message,index)=>({key:message.id,index,start:0}))
  return <div className="chat-message-region">
    <div className={className+' chat-message-scroll'} ref={parentRef} onScroll={()=>{const el=parentRef.current;if(el){atBottom.current=el.scrollHeight-el.scrollTop-el.clientHeight<96;if(atBottom.current)setUnread(0)}}}>
      {hasMore&&<button type="button" className="chat-history-load" disabled={loading} onClick={()=>void loadOlder()}>{loading?'正在加载…':'加载更早的消息'}</button>}
      {messages.length===0&&empty}
      <div className="chat-message-items" style={useVirtual?{height:`${virtualizer.getTotalSize()}px`,position:'relative',width:'100%'}:undefined}>
        {items.map(item=><div key={item.key} data-index={item.index} ref={useVirtual?virtualizer.measureElement:undefined} style={useVirtual?{position:'absolute',top:0,left:0,width:'100%',transform:`translateY(${item.start}px)`}:undefined}>
          <MessageItem message={messages[item.index]} sources={sources} details={messages[item.index].runId?runs?.[messages[item.index].runId!]:undefined} runs={runs} jump={jumpFor(item.index)}/>
        </div>)}
      </div>
      {running&&<div className="chat-run-status" role="status">{status?labels[status]??'正在处理':'正在处理'}…</div>}
      {status==='failed'&&<div className="chat-message-error">本轮运行失败，可重试或更换模型。</div>}
    </div>
    {unread>0&&<button type="button" className="chat-new-messages" onClick={scrollEnd}>{unread} 条新消息 ↓</button>}
  </div>
}
export {messageText}
