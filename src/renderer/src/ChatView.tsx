import { useEffect, useMemo, useRef, useState } from 'react'
import type { Jump } from './rich'
import { buildSuggestions } from './suggest'
import { ModelPill, ThinkingPill, ScopePill, type ChatScope } from './ChatControls'
import { isCommandInput, parseSlash, DEEP_ALIAS } from './slash'
import type { Paper, ProviderProfile, SourceRef } from './types'
import { useConversation } from './features/chat/useConversation'
import ContextPicker, { type ContextCollection } from './features/chat/ContextPicker'
import ConversationList from './features/chat/ConversationList'
import MessageList,{messageText} from './features/chat/MessageList'
import Composer from './features/chat/Composer'
import ChatWorkspace from './features/chat/ChatWorkspace'
import { WORKSPACE_ACTION, type WorkspaceAction } from './workspace-actions'
import './features/chat/chat.css'
import type { ContextRef } from '../../shared/context'
import type { Message } from '../../shared/chat'
import type { ModelBindingSnapshot } from '../../shared/models'
import type { WorkspaceChatNote, WorkspaceChatSelection, WorkspaceChatWeb } from './workspace-actions'

interface Props {
  papers: Paper[]
  paperCount: number
  cats: string[]
  catCounts: Map<string, number>
  scope: ChatScope
  onScopeChange: (s: ChatScope) => void
  models: string[]
  profiles: ProviderProfile[]
  model: string
  thinking: string
  thinkingLevels?: string[]
  onChangeModel: (m: string) => void
  onChangeThinking: (l: string) => void
  onAddThinkingLevel?: (level: string) => void | Promise<void>
  onJump: Jump
  resetKey: number
  fs: number
  onFs: (delta: number) => void
  onOpenSettings?: () => void
}

function slugOf(uri?:string):string {
  if(!uri)return ''
  try {const url=new URL(uri);return decodeURIComponent(url.pathname.replace(/^\//,''))}catch{return ''}
}

export default function ChatView({
  papers,paperCount,cats,catCounts,scope,onScopeChange,models,profiles,model,thinking,thinkingLevels,onChangeModel,onChangeThinking,onAddThinkingLevel,onJump,resetKey,fs,onFs,onOpenSettings
}:Props):JSX.Element {
  const activeProfile=profiles.find(profile=>profile.models.includes(model))
  const modelBinding=useMemo<ModelBindingSnapshot>(()=>({bindingId:`${activeProfile?.id??'profile-1'}:${model}`,profileId:activeProfile?.id??'profile-1',provider:activeProfile?.provider??'active',model:model||'default',capabilities:['text','streaming'],reasoning:thinking||'default',reasoningLevels:thinkingLevels}),[activeProfile?.id,activeProfile?.provider,model,thinking,thinkingLevels])
  const chat=useConversation(modelBinding.bindingId,modelBinding.reasoning,(workspaceId:string)=>{
    const refs:ContextRef[]=selectedPaperIds.map(paperId=>({kind:'paper',workspaceId,paperId}))
    for(const note of contextNotes)refs.push({kind:'note',workspaceId,noteId:note.noteId,paperId:note.paperId})
    for(const web of contextWeb)refs.push({kind:'web',workspaceId,url:web.url,title:web.title,snippet:web.snippet,documentVersion:web.documentVersion})
    for(const collectionId of selectedCollectionIds)refs.push({kind:'collection',workspaceId,collectionId})
    for(const selection of contextSelections)refs.push({kind:'selection',workspaceId,paperId:selection.paperId,page:selection.page,text:selection.text.slice(0,12000),documentVersion:selection.documentVersion,origin:selection.origin})
    if(!refs.length&&scope.type==='cat'&&scope.cat)return [{kind:'category',workspaceId,name:scope.cat}]
    return refs
  })
  const [input,setInput]=useState('')
  const [selectedPaperIds,setSelectedPaperIds]=useState<number[]>([])
  const [contextNotes,setContextNotes]=useState<WorkspaceChatNote[]>([])
  const [contextSelections,setContextSelections]=useState<WorkspaceChatSelection[]>([])
  const [contextWeb, setContextWeb] = useState<WorkspaceChatWeb[]>([])
  const [collections,setCollections]=useState<ContextCollection[]>([])
  const [selectedCollectionIds,setSelectedCollectionIds]=useState<number[]>([])
  useEffect(()=>{
    void window.api.collectionsList().then(setCollections).catch(()=>setCollections([]))
    const refreshCollections=():void=>{void window.api.collectionsList().then(setCollections).catch(()=>setCollections([]))}
    window.addEventListener('cspaper:collections-changed',refreshCollections)
    return ()=>window.removeEventListener('cspaper:collections-changed',refreshCollections)
  },[])
  useEffect(()=>{
    const handle=(event:Event)=>{
      const action=(event as CustomEvent<WorkspaceAction>).detail
      if(action.kind==='chat'){if(action.fresh)void chat.newConversation();setSelectedPaperIds(action.paperIds);setContextNotes(action.notes??[]);setContextSelections(action.selections??[]);setContextWeb(action.web??[]);setSelectedCollectionIds([]);if(action.prompt)setInput(action.prompt)}
    }
    window.addEventListener(WORKSPACE_ACTION,handle)
    return ()=>window.removeEventListener(WORKSPACE_ACTION,handle)
  },[chat.newConversation])
  const busy=!!chat.run&&!['cancelled','failed','partial','completed','interrupted'].includes(chat.run.status)
  const suggestions=useMemo(()=>buildSuggestions(papers,catCounts),[papers,catCounts])
  const [chatNotice,setChatNotice]=useState('')
  const flash=(message:string):void=>{setChatNotice(message);window.setTimeout(()=>setChatNotice(''),2600)}

  const {newConversation}=chat
  useEffect(()=>{if(resetKey>0)void newConversation()},[resetKey,newConversation])
  const execSlash=(raw:string):boolean=>{
    const parsed=parseSlash(raw);if(!parsed)return false
    const {name,args}=parsed
    if(name==='model') {
      const hit=models.find(item=>item.toLowerCase().includes((args||'').toLowerCase()))
      if(hit){onChangeModel(hit);flash('对话模型已切换：'+hit)}else flash(models.length?'可用模型：'+models.join('、'):'未配置模型')
      return true
    }
    if(name==='deep') {
      const level=(args||'').toLowerCase(),mapped=DEEP_ALIAS[level]
      if(!mapped){flash('用法：/deep low|mid|high（对话思考强度）');return true}
      void window.api.saveSettings({thinkingLevel:mapped as 'low'|'medium'|'high'});flash('思考强度：'+mapped);return true
    }
    if(name==='clear'||name==='new'){void chat.newConversation();flash('已开始新对话');return true}
    if(name==='goal'){void window.api.saveSettings({agentGoal:args});flash(args?'长期目标已设定：'+args.slice(0,60):'已清除长期目标');return true}
    if(name==='help'){flash('对话可用命令：/goal　/model　/deep　/clear　/help');return true}
    flash('/'+name+' 请在 Work 工作台执行');return true
  }

  const send=(raw?:string):void=>{
    const question=(raw??input).trim();if(!question||busy)return
    if(isCommandInput(question)&&execSlash(question)){setInput('');return}
    setInput('')
    void chat.send(question).catch(error=>flash(String(error)))
  }
  const sourceRefs=useMemo<SourceRef[]>(()=>chat.sources.map((source,index)=>{
    const uri=typeof source.locator.uri==='string'?source.locator.uri:undefined
    const slug=slugOf(uri)
    const citedPaper=papers.find(item=>item.slug===slug)
    const currentVersion=citedPaper?`${citedPaper.file_mtime??0}:${citedPaper.file_size??0}`:undefined
    const sourceStamp=source.documentVersion?.split(':')[0]
    return {n:index+1,slug,title:source.title,page:source.locator.page??1,snippet:source.snippet,documentVersion:source.documentVersion,currentVersion,versionChanged:!!citedPaper&&!!source.documentVersion&&sourceStamp!==String(citedPaper.file_mtime??0)}
  }),[chat.sources,papers])
  const jumpFor=(index:number):Jump=>{
    const question=chat.messages[index-1]?.role==='user'?messageText(chat.messages[index-1]):''
    return (slug,page,snippet,ctx,source)=>onJump(slug,page,snippet,[question,ctx].filter(Boolean).join('\n'),source)
  }
  const fsCtl=(
    <div className="fs-ctl" title={`对话字号（当前 ${fs}px）`}>
      <button onClick={()=>onFs(-1)} title="减小字号">A−</button>
      <button onClick={()=>onFs(1)} title="增大字号">A+</button>
    </div>
  )
  const noticeBar=chat.error?<div className="wb-notice error" style={{width:'100%',marginBottom:6}}>会话错误：{chat.error}</div>:chatNotice?<div className="wb-notice" style={{width:'100%',marginBottom:6}}>{chatNotice}</div>:null
  const inputBox=(
    <Composer value={input} onChange={setInput} onSend={()=>send()} onStop={()=>void chat.stop()} busy={busy}
      placeholder="与全库文献对话；会话自动保存，重启后继续追问" banner={noticeBar}>
      <ContextPicker papers={papers} selected={selectedPaperIds} onChange={(ids)=>{setSelectedPaperIds(ids);setContextNotes([]);setContextSelections([]);setContextWeb([])}}
        selectedCollections={selectedCollectionIds} onCollectionsChange={setSelectedCollectionIds} collections={collections}/>
      <ScopePill cats={cats} scope={scope} onChange={onScopeChange} paperCount={paperCount} catCounts={catCounts}/>
      <ModelPill models={models} model={model} onChange={onChangeModel}/>
      <ThinkingPill level={thinking} levels={thinkingLevels} onChange={onChangeThinking} onAddLevel={onAddThinkingLevel}/>
      {fsCtl}
    </Composer>
  )
  return (
    <ChatWorkspace navigation={<ConversationList conversations={chat.conversations} activeId={chat.conversation?.id} onSelect={id=>void chat.selectConversation(id)} onNew={()=>void chat.newConversation()} onRename={chat.renameConversation} onArchive={chat.archiveConversation} includeArchived={chat.includeArchived} onShowArchived={value=>void chat.showArchived(value)} hasMore={!!chat.nextCursor} onLoadMore={()=>void chat.refreshConversations(true)}/> }>
      {chat.messages.length===0&&models.length===0&&onOpenSettings?(
        <div className="chat-hero">
          <div className="chat-hero-title" style={{fontFamily:'var(--serif)',fontSize:24,fontWeight:600,letterSpacing:2}}>十分钟后你就用得上</div>
          <div className="chat-hero-steps" style={{display:'flex',gap:14,margin:'28px 0',flexWrap:'wrap'}}>
            {[['1','配一次 Key','设置 → 模型服务，粘贴 Key 即用'],['2','拖入 PDF','划词翻译、高亮和笔记立即可用'],['3','问它要答案','全文检索引用，答案带页码']].map(([n,title,desc])=>(
              <div key={n} style={{width:230,border:'1px solid var(--border)',borderRadius:12,padding:'16px 16px 14px',background:'var(--bg)'}}>
                <div style={{display:'inline-flex',width:22,height:22,borderRadius:6,background:'var(--accent)',color:'#f8f4ec',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:700,marginBottom:8}}>{n}</div>
                <div style={{fontSize:14,fontWeight:600,marginBottom:4}}>{title}</div>
                <div style={{fontSize:12,color:'var(--text-dim)',lineHeight:1.6}}>{desc}</div>
              </div>
            ))}
          </div>
          <button className="btn" onClick={onOpenSettings}>去配置模型（1 分钟）</button>
        </div>
      ):chat.messages.length===0?(
        <div className="chat-hero-wrap">
          <div className="chat-hero"><div className="big">💬</div><div className="headline">与全库文献对话</div><div className="tip">会话持久保存，回答来源可回跳原文</div></div>
          {inputBox}
          <div className="hero-suggest">{suggestions.map(item=><button key={item} onClick={()=>send(item)}>{item}</button>)}</div>
        </div>
      ):(
        <>
          <MessageList messages={chat.messages} runs={chat.runs} jumpFor={jumpFor} running={busy} status={chat.run?.status} conversationId={chat.conversation?.id} hasMore={chat.hasMore} loading={chat.loading} onLoadOlder={chat.loadOlder}/>
          <div className="chat-view-input">{inputBox}</div>
        </>
      )}
    </ChatWorkspace>
  )
}
