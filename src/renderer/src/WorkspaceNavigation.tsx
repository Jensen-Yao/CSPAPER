import * as Icon from './Icon'
export type WorkspaceMode = 'read' | 'chat' | 'compare' | 'overview' | 'notes' | 'web'

export default function WorkspaceNavigation({mode,libraryVisible,openCount,onNavigate,onLibrary,onResume}:{
  mode:WorkspaceMode;libraryVisible:boolean;openCount:number;onNavigate:(mode:WorkspaceMode)=>void;onLibrary:()=>void;onResume:()=>void
}):JSX.Element {
  const items:Array<{mode:WorkspaceMode;label:string;title:string;icon:JSX.Element}>=[
    {mode:'chat',label:'文献问答',title:'与文献库对话',icon:<Icon.Chat size={15}/>},
    {mode:'overview',label:'纵览',title:'纵览（文献表格 / 知识体系 / 统计）',icon:<Icon.Table size={15}/>},
    {mode:'notes',label:'笔记',title:'笔记中心',icon:<Icon.Notes size={15}/>},
    {mode:'compare',label:'对比',title:'AI 对比表格',icon:<Icon.Compare size={15}/>},
    {mode:'web',label:'学术检索',title:'文献浏览器',icon:<Icon.Globe size={15}/>}
  ]
  return <nav className="workspace-nav" aria-label="文献工作区">
    <button className={`tb-q ${mode==='read'&&libraryVisible?'on':''}`} title="文献库" aria-current={mode==='read'&&libraryVisible?'page':undefined} onClick={onLibrary}><Icon.Library size={15}/><span>文献库</span></button>
    {openCount>0&&<button className={`tb-q ${mode==='read'&&!libraryVisible?'on':''}`} title="继续阅读" aria-current={mode==='read'&&!libraryVisible?'page':undefined} onClick={onResume}><Icon.Book size={15}/><span>阅读</span><small>{openCount}</small></button>}
    <i className="workspace-nav-divider"/>
    {items.map(item=><button key={item.mode} className={`tb-q ${mode===item.mode?'on':''}`} title={item.title} aria-current={mode===item.mode?'page':undefined} onClick={()=>onNavigate(item.mode)}>{item.icon}<span>{item.label}</span></button>)}
  </nav>
}
