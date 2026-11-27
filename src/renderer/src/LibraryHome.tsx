import AddLiteratureMenu from './AddLiteratureMenu'
import { dispatchWorkspaceAction } from './workspace-actions'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { Paper } from './types'
import { catLabel, statusMeta, withAlpha } from './LibraryPane'
import PaperDetailPanel from './PaperDetailPanel'
import OaRepairDialog from './OaRepairDialog'
import * as Icon from './Icon'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

interface Props {
  papers: Paper[]
  activeId: number | null
  onOpen: (p: Paper) => void
  onAddPapers: () => void
  onOpenRecords: () => void
  onOpenOnline?: () => void
  onOpenZotero?:()=>void
  onPapersChanged?: () => void
  /** Shared scope driven by the library tree (categories / collections / tags / recent). */
  scope?: { view: 'all' | 'recent'; category: string | null; collectionId: number | null; tag: string | null }
  onScopeChange?: (patch: Partial<{ view: 'all' | 'recent'; category: string | null; collectionId: number | null; tag: string | null }>) => void
  query?: string
  onQueryChange?: (value: string) => void
}

// 缩略图缓存（进程内）：paperId → dataURL
const thumbCache = new Map<string,string>()
const thumbnailQueue:Array<()=>Promise<void>>=[]
let thumbnailRunning=0
function queueThumbnail(job:()=>Promise<void>):void {
  thumbnailQueue.push(job)
  const next=():void=>{
    while(thumbnailRunning<2&&thumbnailQueue.length){
      thumbnailRunning++
      void thumbnailQueue.shift()!().finally(()=>{thumbnailRunning--;next()})
    }
  }
  next()
}

// 单张封面：懒加载（进入视口才渲染 PDF 第一页）
function Thumb({paper}:{paper:Paper}):JSX.Element {
  const key=paper.id+':'+paper.path+':'+(paper.file_mtime??'')
  const [src,setSrc]=useState<string|null>(thumbCache.get(key)??null)
  const ref=useRef<HTMLDivElement|null>(null)
  useEffect(()=>{
    setSrc(thumbCache.get(key)??null)
    let cancelled=false,started=false
    const start=():void=>{
      if(started||thumbCache.has(key)) return
      started=true
      queueThumbnail(async()=>{
        if(cancelled) return
        let doc:pdfjsLib.PDFDocumentProxy|undefined
        try {
          const bytes=await window.api.readPdf(paper.path)
          if(cancelled) return
          const base=window.location.href.replace(/[^/]*$/,'')
          doc=await pdfjsLib.getDocument({data:new Uint8Array(bytes),standardFontDataUrl:base+'standard_fonts/',cMapUrl:base+'cmaps/',cMapPacked:true}).promise
          const page=await doc.getPage(1),original=page.getViewport({scale:1}),vp=page.getViewport({scale:Math.min(1,420/original.width)})
          const canvas=document.createElement('canvas');canvas.width=Math.floor(vp.width);canvas.height=Math.floor(vp.height)
          await page.render({canvasContext:canvas.getContext('2d')!,viewport:vp} as any).promise
          const url=canvas.toDataURL('image/jpeg',0.68)
          if(thumbCache.size>=120) thumbCache.delete(thumbCache.keys().next().value!)
          thumbCache.set(key,url)
          if(!cancelled) setSrc(url)
        } catch { /* A missing PDF keeps a stable placeholder. */ }
        finally {if(doc) void doc.destroy()}
      })
    }
    const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))start()},{rootMargin:'180px'})
    if(ref.current)observer.observe(ref.current)
    return ()=>{cancelled=true;observer.disconnect()}
  },[key,paper.path])
  return <div className="card-thumb" ref={ref}>{src?<img src={src} alt="" loading="lazy"/>:<div className="thumb-ph"><Icon.Pdf size={22}/></div>}</div>
}

// AI 小结区块：有缓存直接展示，否则一键生成
function SummaryBlock({ paper, onDone }: { paper: Paper; onDone: (id: number, s: string) => void }): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [val, setVal] = useState(paper.summary ?? '')
  const [err, setErr] = useState('')

  const gen = async (): Promise<void> => {
    setBusy(true)
    setErr('')
    try {
      const s = await window.api.summarizePaper(paper.id)
      setVal(s)
      onDone(paper.id, s)
    } catch (e) {
      setErr(String(e).replace(/^Error: /, '').slice(0, 80))
    } finally {
      setBusy(false)
    }
  }

  if (!val) {
    // 没有小结时不占卡片空间：操作收进悬停工具条（由卡片传入触发器）
    return (
      <div className="card-sum card-sum-empty">
        {busy && <span className="sum-label"><Icon.Sparkle size={10}/> 分析中…</span>}
        {err && <span className="sum-err">{err}</span>}
      </div>
    )
  }
  return (
    <div className="card-sum">
      <span className="sum-label"><Icon.Sparkle size={10} /> AI 小结</span>
      <div className="sum-text">{val}</div>
    </div>
  )
}

// 卡片右上角阅读状态角标（v0.6 五态；'-new' 特殊渲染为小圆点）
function StatusBadge({ status }: { status: string }): JSX.Element {
  const m = statusMeta(status)
  return (
    <span className="pcard-status" style={{ color: m.color, background: withAlpha(m.color, 0.1) }} title={`阅读状态：${m.label}`}>
      {m.icon === '-new' ? <i className="sp-newdot" /> : m.icon}
    </span>
  )
}

export default function LibraryHome({ papers, activeId, onOpen, onAddPapers, onOpenRecords, onOpenOnline, onOpenZotero, onPapersChanged, scope, onScopeChange, query: outerQuery, onQueryChange }: Props): JSX.Element {
  // 标签名 → 颜色（卡片 hover 标签行用）
  const [tagColors, setTagColors] = useState<Record<string, string>>({})
  useEffect(() => {
    let on = true
    window.api
      .tagsList()
      .then((ts) => {
        if (on) setTagColors(Object.fromEntries(ts.map((t) => [t.name, t.color])))
      })
      .catch(() => {})
    return () => {
      on = false
    }
  }, [papers])

  const [query,setQuery]=useState('')
  // 搜索框与左栏共用同一个查询（App 持有），主区与侧栏不再各算各的
  const activeQuery=outerQuery??query
  const setQueryAny=(value:string):void=>{setQuery(value);onQueryChange?.(value)}
  const setQueryBoth=(value:string):void=>{setQuery(value);setQueryLimit()}
  const [filter,setFilter]=useState('all')
  const [sourceFilter,setSourceFilter]=useState<'all'|'pdf'|'record'>('all')
  const [filterOpen,setFilterOpen]=useState(false),[moreOpen,setMoreOpen]=useState(false)
  const [collectionIds,setCollectionIds]=useState<number[]|null>(null)
  useEffect(()=>{let alive=true;if(scope?.collectionId==null){setCollectionIds(null);return}void window.api.collectionsPapers(scope.collectionId).then((ids:number[])=>{if(alive)setCollectionIds(ids)}).catch(()=>{if(alive)setCollectionIds([])});return()=>{alive=false}},[scope?.collectionId])
  const setQueryLimit=():void=>setLimit(60)
  const [oaRepairOpen,setOaRepairOpen]=useState(false)
  const [oaRepairIds,setOaRepairIds]=useState<number[] | null>(null)
  const [zoteroRepairBusy,setZoteroRepairBusy]=useState(false)
  const [zoteroRepairMsg,setZoteroRepairMsg]=useState('')
  const [sort,setSort]=useState('recent')
  const [limit,setLimit]=useState(60)
  const [display,setDisplay]=useState(()=>localStorage.getItem('cspaper.library-display')||'cards')
  const arranged=useMemo(()=>{
    const needle=activeQuery.trim().toLocaleLowerCase(),recentCut=Date.now()-30*24*3600*1000
    return papers
      .filter(p=>(filter==='all'||p.status===filter)&&(sourceFilter==='all'||p.source_kind===sourceFilter)&&(!needle||[p.title,p.authors,p.year,p.venue,p.category,...(p.tags||[])].join(' ').toLocaleLowerCase().includes(needle)))
      .filter(p=>!scope?.category||p.category===scope.category)
      .filter(p=>collectionIds===null||collectionIds.includes(p.id))
      .filter(p=>!scope?.tag||(p.tags??[]).includes(scope.tag))
      .filter(p=>scope?.view!=='recent'||[p.opened_at,p.added_at].some(stamp=>stamp&&Date.now()-new Date(stamp.replace(' ','T')+'Z').getTime()<recentCut))
      .sort((a,b)=>{
        if(sort==='recent'&&(a.source_kind==='record')!==(b.source_kind==='record'))return a.source_kind==='record'?1:-1
        return sort==='title'?a.title.localeCompare(b.title,'zh'):sort==='year'?(b.year||0)-(a.year||0):String(b.added_at||'').localeCompare(a.added_at||'')
      })
  },[papers,activeQuery,filter,sourceFilter,sort,scope,collectionIds])
  const groups=useMemo(()=>{
    const visible=arranged.slice(0,limit)
    if(scope?.category||scope?.collectionId!=null||scope?.tag||scope?.view==='recent') return [['范围',visible]] as Array<[string,Paper[]]>
    if(sort!=='recent') return [['全部文献',visible]] as Array<[string,Paper[]]>
    const groups=new Map<string,Paper[]>()
    for(const paper of visible){
      const date=new Date((paper.added_at||'').replace(' ','T')+'Z')
      const month=Number.isNaN(date.getTime())?'更早':`${date.getFullYear()}年${date.getMonth()+1}月`
      const group=groups.get(month)??[];group.push(paper);groups.set(month,group)
    }
    return [...groups.entries()]
  },[arranged,limit,sort])

  const refresh = (id: number, s: string): void => {
    const p = papers.find((x) => x.id === id)
    if(p) void onPapersChanged?.()
  }

  // 单击选中 → 右侧详情栏；双击 / 「打开阅读」进入阅读器
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const selected = papers.find((p) => p.id === selectedId) ?? null
  const sourceOptions: Array<[typeof sourceFilter,string]> = [['all','全部来源'],['pdf','有原文'],['record','仅题录']]
  const repairZotero = async (): Promise<void> => {
    if(zoteroRepairBusy)return
    setZoteroRepairBusy(true);setZoteroRepairMsg('')
    try {
      const result=await window.api.zoteroRepairApply()
      setZoteroRepairMsg(`Zotero 原文修复：匹配 ${result.repaired} 篇 · 无可读原文 ${result.skipped+result.failed} 篇；已保留替换前备份。`)
      onPapersChanged?.()
    } catch(error) {
      setZoteroRepairMsg(String(error).replace(/^Error: /,'').slice(0,180))
    } finally {
      setZoteroRepairBusy(false)
    }
  }

  return (
    <div className="libhome-outer">
      <div className={`libhome library-${display}`}>
        <div className="libhome-bar">
          <div className="library-heading"><small>阅读、整理，让想法有据可循</small><h1>{scope?.category?catLabel(scope.category):scope?.collectionId!=null?'集合':scope?.tag?`标签 · ${scope.tag}`:scope?.view==='recent'?'最近':'文献库'} <span>{arranged.length} 篇</span></h1></div>
          <AddLiteratureMenu onPdf={onAddPapers} onOnline={onOpenOnline} onRecords={onOpenRecords} onZotero={onOpenZotero}/>
        </div>
                {(filterOpen||moreOpen)&&<div className="library-pop-mask" onClick={()=>{setFilterOpen(false);setMoreOpen(false)}}/>}
        {papers.length>0&&<div className="library-controls">
          <label className="library-search"><Icon.Search size={15}/><input aria-label="筛选文献库" placeholder="搜索标题、作者、标签…" value={activeQuery} onChange={e=>{setQueryAny(e.target.value);setLimit(60)}}/></label>
          {/* 范围标签：来自左栏的分类 / 集合 / 标签 / 最近，可一键清除 */}
          {(scope?.category||scope?.collectionId!=null||scope?.tag||scope?.view==='recent')&&<button className="library-scope-chip" title="清除范围筛选" onClick={()=>onScopeChange?.({view:'all',category:null,collectionId:null,tag:null})}><Icon.X size={11}/>{scope?.view==='recent'?'最近':scope?.category?catLabel(scope.category):scope?.collectionId!=null?'集合':`标签 · ${scope?.tag}`}</button>}
          <span style={{flex:1}}/>
          <select aria-label="文献排序" value={sort} onChange={e=>{setSort(e.target.value);setLimit(60)}}><option value="recent">最近添加</option><option value="year">发表年份</option><option value="title">标题顺序</option></select>
          <div className="library-display" aria-label="文献显示方式">
            <button className={display==='cards'?'on':''} aria-label="封面视图" aria-pressed={display==='cards'} onClick={()=>{setDisplay('cards');localStorage.setItem('cspaper.library-display','cards')}}><Icon.Library size={15}/></button>
            <button className={display==='list'?'on':''} aria-label="紧凑视图" aria-pressed={display==='list'} onClick={()=>{setDisplay('list');localStorage.setItem('cspaper.library-display','list')}}><Icon.Table size={15}/></button>
          </div>
          {/* 状态 + 来源筛选合并为一个弹层 */}
          <div className="library-pop">
            <button className={`btn ghost ${filter!=='all'||sourceFilter!=='all'?'on':''}`} aria-expanded={filterOpen} onClick={()=>{setFilterOpen(v=>!v);setMoreOpen(false)}}><Icon.Filter size={13}/> 筛选{(filter!=='all'||sourceFilter!=='all')?' · 1':''}</button>
            {filterOpen&&<div className="library-pop-menu">
              <div className="library-pop-title">阅读状态</div>
              {[['all','全部'],['unread','待读'],['reading','在读'],['read','已读'],['todo','稍后读']].map(([key,label])=><button key={key} className={filter===key?'on':''} aria-pressed={filter===key} onClick={()=>{setFilter(key);setLimit(60)}}>{label}<span>{key==='all'?papers.length:papers.filter(p=>p.status===key).length}</span></button>)}
              <div className="library-pop-title">来源</div>
              {sourceOptions.map(([key,label])=><button key={key} className={sourceFilter===key?'on':''} aria-pressed={sourceFilter===key} onClick={()=>{setSourceFilter(key);setLimit(60)}}>{label}<span>{key==='all'?papers.length:papers.filter(p=>p.source_kind===key).length}</span></button>)}
            </div>}
          </div>
          {/* 修复类操作收进「更多」 */}
          <div className="library-pop">
            <button className="btn ghost" aria-expanded={moreOpen} onClick={()=>{setMoreOpen(v=>!v);setFilterOpen(false)}}>更多</button>
            {moreOpen&&<div className="library-pop-menu">
              <button disabled={zoteroRepairBusy} onClick={()=>{setMoreOpen(false);void repairZotero()}}>{zoteroRepairBusy?'正在匹配 Zotero 原文…':'修复 Zotero 原文'}</button>
              <button onClick={()=>{setMoreOpen(false);setOaRepairIds(null);setOaRepairOpen(true)}}>探测开放获取原文</button>
              <button onClick={()=>{setMoreOpen(false);void window.api.rebuildIndex()}}>重建正文索引</button>
            </div>}
          </div>
          {zoteroRepairMsg&&<span className="ov-dim">{zoteroRepairMsg}</span>}
          <OaRepairDialog open={oaRepairOpen} initialPaperIds={oaRepairIds} onClose={()=>setOaRepairOpen(false)} onPapersChanged={()=>void onPapersChanged?.()} />
        </div>}
        {papers.length>0&&arranged.length===0&&<div className="library-no-results"><Icon.Search size={24}/><h2>没有匹配的文献</h2><p>试试其他关键词，或清除阅读状态与来源筛选。</p><button className="btn ghost" onClick={()=>{setQueryAny('');setFilter('all');setSourceFilter('all')}}>清除筛选</button></div>}
        {papers.length === 0 && (
          <div className="libhome-empty">
            <div className="headline">把文献放进来，三步开始</div>
            <div className="libhome-steps">
              <button className="libhome-step" onClick={onAddPapers}><span className="libhome-step-ic"><Icon.Pdf size={22}/></span><b>导入 PDF</b><span>拖入文件或整个文件夹，自动抽取正文并建索引</span></button>
              <button className="libhome-step" onClick={onOpenZotero}><span className="libhome-step-ic"><Icon.Book size={22}/></span><b>从 Zotero 迁移</b><span>分类、标签、笔记与附件一键迁入</span></button>
              <button className="libhome-step" onClick={onOpenOnline}><span className="libhome-step-ic"><Icon.Globe size={22}/></span><b>在线添加</b><span>按 DOI / arXiv / 链接检索题录并入库</span></button>
            </div>
            <div className="tip">已有文献库文件夹？<button className="libhome-link" onClick={() => void pickLibrary()}>选择文献库文件夹</button></div>
          </div>
        )}
        {groups.map(([month, list]) => (
          <div key={month}>
            <div className="libhome-month">
              {month}
              <span className="libhome-month-n">{list.length} 篇</span>
            </div>
            <div className="libhome-grid">
              {list.map((p) => (
                <div
                  key={p.id}
                  className={`pcard ${p.id === selectedId ? 'active' : ''}`}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('text/plain', `paper:${p.id}`)}
                  onClick={() => setSelectedId(p.id)}
                  onDoubleClick={() => onOpen(p)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    window.api.paperMenu(p.id, e.clientX, e.clientY)
                  }}
                  title="单击查看详情，双击进入阅读；拖到左侧分类可移动"
                >
                  <StatusBadge status={p.status} />
                  {p.source_kind==='record'&&<span className="source-badge record" title="Zotero 题录条目：尚未导入 PDF 全文">题录 · 无原文</span>}
                  <Thumb paper={p} />
                  {p.last_page != null && p.last_page > 0 && p.n_pages > 0 && p.last_page < p.n_pages && (
                    <div className="pcard-prog is-thumb" title={`读到第 ${p.last_page} 页，共 ${p.n_pages} 页`}>
                      <i style={{ width: `${Math.round((p.last_page / p.n_pages) * 100)}%` }} />
                    </div>
                  )}
                  <div className="pcard-body">
                  <button className="pcard-title" title={p.title} onClick={()=>setSelectedId(p.id)}>{p.title}</button>
                  <div className="pcard-meta">
                    {p.authors && <div className="pcard-authors">作者：{p.authors.split(/[,;，；]/)[0]} 等</div>}
                    <div className="pcard-venue">
                      {p.venue || catLabel(p.category)}
                      {p.year ? ` · ${p.year}` : ''}
                    </div>
                  </div>
                  <SummaryBlock paper={p} onDone={refresh} />
                  <div className="pcard-actions">
                    <button type="button" title="生成 AI 小结" onClick={event=>{event.stopPropagation();void window.api.summarizePaper(p.id).then(()=>onPapersChanged?.()).catch(()=>{})}}><Icon.Sparkle size={12}/></button>
                    <button type="button" className="pcard-chat" title="加入对话" onClick={event=>{event.stopPropagation();dispatchWorkspaceAction({kind:'chat',paperIds:[p.id]})}}><Icon.Chat size={12}/></button>
                    <button type="button" title="打开阅读" onClick={event=>{event.stopPropagation();onOpen(p)}}><Icon.Doc size={12}/></button>
                  </div>
                  {(p.tags?.length ?? 0) > 0 && (
                    <div className="pcard-tags">
                      {(p.tags ?? []).slice(0, 3).map((t) => (
                        <span key={t} className="tag-chip" title={t}>
                          <i className="tag-dot" style={{ background: tagColors[t] ?? 'var(--text-dim)' }} />
                          {t}
                        </span>
                      ))}
                      {(p.tags ?? []).length > 3 && (
                        <span className="tag-chip more" title={(p.tags ?? []).slice(3).join('、')}>
                          +{(p.tags ?? []).length - 3}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
        ))}
        {arranged.length>limit&&<div className="library-load-more"><span>已显示 {Math.min(limit,arranged.length)} / {arranged.length} 篇</span><button className="btn ghost" onClick={()=>setLimit(n=>n+60)}>显示更多文献</button></div>}
      </div>
      {selected && (
        <PaperDetailPanel onOpenOaRepair={(id)=>{setOaRepairIds([id]);setOaRepairOpen(true)}}
          paper={selected}
          onClose={() => setSelectedId(null)}
          onOpen={(p) => {
            setSelectedId(null)
            onOpen(p)
          }}
          onSummarized={refresh}
          onChanged={onPapersChanged}
        />
      )}
    </div>
  )
}

// 空库引导：选目录 → 保存设置 → 触发扫描 → 刷新列表（此前只 reload，
// 选中路径从未保存，用户以为选错了反复重试）
async function pickLibrary(): Promise<void> {
  const dir = await window.api.pickLibrary()
  if (!dir) return // 取消不刷新
  await window.api.saveSettings({ libraryPath: dir })
  await window.api.scanLibrary()
  location.reload()
}
