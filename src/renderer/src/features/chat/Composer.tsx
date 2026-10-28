import type { ReactNode } from 'react'

interface Props {value:string;onChange:(value:string)=>void;onSend:()=>void;onStop?:()=>void;busy:boolean;placeholder:string;children?:ReactNode;banner?:ReactNode;textareaClassName?:string}

export default function Composer({value,onChange,onSend,onStop,busy,placeholder,children,banner,textareaClassName='hero-textarea'}:Props) {
  return <div className="hero-input chat-composer">
    {banner}
    <textarea className={textareaClassName} aria-label="对话消息" value={value} rows={2} placeholder={placeholder}
      onChange={event=>onChange(event.target.value)}
      onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();onSend()}}}/>
    <div className="hero-input-foot">{children}
      <span style={{flex:1}}/>
      {busy?<button className="send-btn" onClick={onStop}>停止</button>:<button className="send-btn" onClick={onSend} disabled={!value.trim()}>发送</button>}
    </div>
  </div>
}
