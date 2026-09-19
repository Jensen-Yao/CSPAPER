import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { Tab } from './App'
import type { Highlight } from './types'
import { locateSnippet, locateByKeywords, flashHit } from './locate'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

const HL_BG: Record<string, string> = {
  yellow: 'rgba(255, 210, 0, 0.45)',
  green: 'rgba(70, 200, 130, 0.35)',
  red: 'rgba(235, 80, 80, 0.30)'
}

export interface ViewerHandle {
  scrollToPage: (n: number) => void
  highlightSelection: (color?: string) => Promise<void>
  zoomBy: (delta: number) => void
  zoomReset: () => void
  removeHighlightLocal: (hid: number) => void
}

interface Props {
  tabs: Tab[]
  activeId: number | null
  onActivate: (id: number) => void
  onCloseTab: (id: number) => void
  pendingJump: { slug: string; page: number; snippet?: string; probe?: string } | null
  onJumped: () => void
  onPageContext: (text: string) => void
  // 当前页码变化（全文翻译的页码指示用）
  onPageChange?: (n: number) => void
  // 工具栏「全文翻译」按钮：打开侧栏全文对照
  onOpenFulltext?: () => void
  onSelect: (text: string, x: number, y: number) => void
  onDeleteHighlight: (id: number) => void
  // 面板常驻但 chat 模式下隐藏：隐藏时全局缩放快捷键不生效（让位给引用面板）
  visible: boolean
  // 恢复上次阅读位置（W2）：文档加载完成后跳到该页（>1 才生效，仅本次加载生效一次；
  // 引用跳转 pendingJump 优先）。协调者传 paper.last_page；会话内 tab 来回切换时
  // 优先用本会话的最新阅读页
  initialPage?: number
  // PDF 内查找（W11）：数值变化（父组件 +1）即打开查找条并聚焦（如绑定 Ctrl+F）
  findSignal?: number
}

interface PageTextMap {
  [num: number]: string
}

// 全文档查找的一次命中（offset/length 相对该页纯文本）
interface FindHit {
  page: number
  offset: number
  length: number
}

const PdfViewer = forwardRef<ViewerHandle, Props>(function PdfViewer(
  { tabs, activeId, onActivate, onCloseTab, pendingJump, onJumped, onPageContext, onPageChange, onOpenFulltext, onSelect, onDeleteHighlight, visible, initialPage, findSignal },
  ref
): JSX.Element {
  const active = tabs.find((t) => t.paper.id === activeId) ?? null
  const [doc, setDoc] = useState<any>(null)
  const [pageDims, setPageDims] = useState<Array<{ w: number; h: number }>>([])
  const [error, setError] = useState('')
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const pageRefs = useRef(new Map<number, HTMLDivElement>())
  const textCache = useRef<PageTextMap>({})
  const baseVwRef = useRef(0)
  const curPageRef = useRef(1)
  const [hls, setHls] = useState<Highlight[]>([])
  const [zoom, setZoom] = useState(1)
  const [baseScale, setBaseScale] = useState(1)
  const [curPage, setCurPage] = useState(1)
  const [numPages, setNumPages] = useState(0)
  // 侧边导航：页面缩略图 / 文档目录
  const [navi, setNavi] = useState<'none' | 'thumbs' | 'toc'>('none')
  const [outline, setOutline] = useState<Array<{ title: string; page: number; depth: number }>>([])
  // ===== 阅读进度（W2）=====
  // 会话内每篇论文的最新阅读页（tab 来回切换时恢复位置用，优先于 initialPage）
  const reportedPageRef = useRef(new Map<number, number>())
  const lastPageTimerRef = useRef<number | null>(null)
  const lastPagePendingRef = useRef<{ id: number; page: number } | null>(null)
  // 当前已加载 doc 归属的 paper id（切 tab 的过渡期里 curPage 还是上一篇的，
  // 用它挡住上报/心跳，避免把旧页码记到新论文头上）
  const docPaperIdRef = useRef<number | null>(null)
  // ===== PDF 内查找（W11）=====
  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [findHits, setFindHits] = useState<FindHit[]>([])
  const [findIdx, setFindIdx] = useState(0)
  const findInputRef = useRef<HTMLInputElement | null>(null)
  // 每页纯文本缓存（打开查找时惰性逐页构建；tab 切换/文档关闭时清空）
  const findTextRef = useRef(new Map<number, string>())
  const findBuildRef = useRef<{ doc: any; promise: Promise<void> } | null>(null)
  // 当前页 textLayer 重建完成计数（首次渲染/缩放后）：触发查找高亮补涂
  const [layerTick, setLayerTick] = useState(0)

  const handleLayerReady = useCallback((n: number) => {
    if (n === curPageRef.current) setLayerTick((v) => v + 1)
  }, [])

  // 挂载滚动容器：Ctrl+滚轮缩放；不再在 resize 时重缩放/回跳（保持阅读位置）
  const attachScrollEl = useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      setZoom((z) => Math.max(0.4, Math.min(3, z - e.deltaY * 0.0018)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
  }, [])

  // Cmd/Ctrl + -/=/0 缩放（仅阅读模式可见时生效；chat 模式下同一组快捷键归引用面板）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!visible) return
      if (!(e.ctrlKey || e.metaKey)) return
      if (e.key === '=' || e.key === '+') {
        e.preventDefault()
        setZoom((z) => Math.min(3, z + 0.15))
      } else if (e.key === '-') {
        e.preventDefault()
        setZoom((z) => Math.max(0.4, z - 0.15))
      } else if (e.key === '0') {
        e.preventDefault()
        setZoom(1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible])

  useEffect(() => {
    setDoc(null)
    setPageDims([])
    setNumPages(0)
    setError('')
    setHls([])
    setOutline([])
    textCache.current = {}
    // 查找缓存/状态随文档重置
    findTextRef.current = new Map()
    findBuildRef.current = null
    setFindOpen(false)
    setFindQuery('')
    setFindHits([])
    setFindIdx(0)
    if (!active) return
    let cancelled = false
    void (async () => {
      try {
        const buf = await window.api.readPdf(active.paper.path)
        void window.api
          .listHighlights(active.paper.id)
          .then((hs) => {
            if (!cancelled) setHls(hs)
          })
          .catch(() => {})
        // 兼容 dev(http) 与打包(file://) 两种环境的静态资源基路径
        const assetBase = window.location.href.replace(/[^/]*$/, '')
        const d = await pdfjsLib.getDocument({
          data: new Uint8Array(buf),
          standardFontDataUrl: `${assetBase}standard_fonts/`,
          cMapUrl: `${assetBase}cmaps/`,
          cMapPacked: true
        }).promise
        if (cancelled) {
          void d.destroy()
          return
        }
        // 预取每页尺寸：未渲染页也能占出真实高度，页码跳转/滚动条才准确
        const metas: Array<{ w: number; h: number }> = []
        for (let n = 1; n <= d.numPages; n++) {
          const pg = await d.getPage(n)
          const vp = pg.getViewport({ scale: 1 })
          metas.push({ w: vp.width, h: vp.height })
        }
        if (cancelled) {
          void d.destroy()
          return
        }
        setPageDims(metas)
        baseVwRef.current = metas[0]?.w ?? 612
        const w = scrollRef.current?.clientWidth ?? 800
        setBaseScale(Math.max(0.5, Math.min(2.2, (w - 56) / baseVwRef.current)))
        docPaperIdRef.current = active.paper.id
        setDoc(d)
        setNumPages(d.numPages)
        setCurPage(1)
        scrollRef.current?.scrollTo({ top: 0 })
        curPageRef.current = 1
        // 恢复上次阅读位置（W2）：会话内最新阅读页 > initialPage（协调者传 paper.last_page）
        // > 库内 last_page。仅本次文档加载生效一次；引用跳转（pendingJump）优先。
        // initialPage 每次渲染可能都是新引用，故意不加入依赖（本 effect 只按 paper.id 重跑）。
        const restored = reportedPageRef.current.get(active.paper.id) ?? initialPage ?? active.paper.last_page ?? 1
        const restorePage = Math.max(1, Math.min(d.numPages, Math.floor(restored)))
        if (!pendingJump && restorePage > 1) {
          window.setTimeout(() => {
            if (cancelled) return
            // 等 PageView 提交后再按页高锚定滚动（只滚 .viewer-scroll 自身）
            const el = pageRefs.current.get(restorePage)
            const sc = scrollRef.current
            if (el && sc) {
              const top = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop
              sc.scrollTo({ top: Math.max(0, top - 30), behavior: 'auto' })
            }
            setCurPage(restorePage)
            curPageRef.current = restorePage
            onPageContext(textCache.current[restorePage] ?? '')
            onPageChange?.(restorePage)
          }, 320)
        }
        // 文档目录（书签）
        void buildOutline(d).then((o) => {
          if (!cancelled) setOutline(o)
        })
      } catch (e) {
        setError(String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [active?.paper.id])

  // 阅读进度上报（W2）：页码变化时节流 2s 调 paperLastPage（2s 窗口内只保留最新页码）
  useEffect(() => {
    if (!active || !doc || curPage < 1 || docPaperIdRef.current !== active.paper.id) return
    const id = active.paper.id
    reportedPageRef.current.set(id, curPage)
    lastPagePendingRef.current = { id, page: curPage }
    if (lastPageTimerRef.current != null) return
    lastPageTimerRef.current = window.setTimeout(() => {
      lastPageTimerRef.current = null
      const p = lastPagePendingRef.current
      lastPagePendingRef.current = null
      if (p) {
        try { window.api.paperLastPage(p.id, p.page) } catch { /* 忽略 */ }
      }
    }, 2000)
  }, [curPage, active?.paper.id, doc])

  // 组件卸载：把还没落库的页码立即补发，避免丢进度
  useEffect(() => {
    return () => {
      if (lastPageTimerRef.current != null) window.clearTimeout(lastPageTimerRef.current)
      lastPageTimerRef.current = null
      const p = lastPagePendingRef.current
      lastPagePendingRef.current = null
      if (p) {
        try { window.api.paperLastPage(p.id, p.page) } catch { /* 忽略 */ }
      }
    }
  }, [])

  // 阅读时长心跳（W2）：文档打开且阅读器在前台（活跃 tab + read 模式）时每 30s 计 30s
  useEffect(() => {
    if (!active || !doc || !visible || docPaperIdRef.current !== active.paper.id) return
    const pid = active.paper.id
    const t = window.setInterval(() => {
      try { window.api.paperReadTime(pid, 30) } catch { /* 忽略 */ }
    }, 30000)
    return () => window.clearInterval(t)
  }, [active?.paper.id, doc, visible])

  const scale = baseScale * zoom

  // 只滚动 .viewer-scroll 自身：scrollIntoView 会连带滚动 overflow:hidden 的祖先
  // （.shell/.workspace），把标题栏顶出窗口外。长距离跳页用瞬时滚动（平滑滚动
  // 在懒渲染内容变化时会被 Chromium 静默取消）
  const scrollToPage = useCallback(
    (n: number) => {
      const sc = scrollRef.current
      const el = pageRefs.current.get(n)
      if (!sc || !el) return
      const top = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop
      const dist = Math.abs(top - sc.scrollTop)
      sc.scrollTo({ top, behavior: dist > sc.clientHeight * 2 ? 'auto' : 'smooth' })
      // 跳页立即同步页码指示（窗口被遮挡时 scroll 事件不会触发）
      setCurPage(n)
      curPageRef.current = n
      onPageContext(textCache.current[n] ?? '')
      onPageChange?.(n)
    },
    [onPageContext]
  )

  const goToPage = useCallback(
    (n: number) => {
      if (!numPages) return
      scrollToPage(Math.max(1, Math.min(numPages, n)))
    },
    [numPages, scrollToPage]
  )

  // 把当前选区保存为持久化高亮
  const highlightSelection = useCallback(async (color = 'yellow') => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !active) return
    const range = sel.getRangeAt(0)
    let node: Node | null = range.startContainer
    let wrap: HTMLElement | null = null
    while (node) {
      if (node instanceof HTMLElement && node.classList.contains('page-wrap')) {
        wrap = node
        break
      }
      node = node.parentNode
    }
    if (!wrap) return
    let pageNum = 0
    for (const [n, el] of pageRefs.current.entries()) if (el === wrap) pageNum = n
    if (!pageNum) return
    const wrapRect = wrap.getBoundingClientRect()
    const rects = [...range.getClientRects()]
      .filter((r) => r.width > 1 && r.height > 1)
      .map((r) => ({
        x: (r.left - wrapRect.left) / wrapRect.width,
        y: (r.top - wrapRect.top) / wrapRect.height,
        w: r.width / wrapRect.width,
        h: r.height / wrapRect.height
      }))
    if (rects.length === 0) return
    const text = sel.toString()
    const id = await window.api.addHighlight(active.paper.id, pageNum, rects, text, color)
    setHls((hs) => [...hs, { id, page: pageNum, rects, text, color }])
    sel.removeAllRanges()
  }, [active])

  useImperativeHandle(ref, () => ({
    scrollToPage,
    highlightSelection,
    zoomBy(delta: number) {
      setZoom((z) => Math.max(0.4, Math.min(3, z + delta)))
    },
    zoomReset() {
      setZoom(1)
    },
    removeHighlightLocal(hid: number) {
      setHls((hs) => hs.filter((h) => h.id !== hid))
    }
  }))

  // 引用跳转：snippet 精确定位到页内被引段落（多行高亮带渐隐）→ 无 snippet /
  // 未命中时用「问题 + 回答上下文」关键词定位（可能落到相邻页），否则停在该页顶部
  useEffect(() => {
    if (doc && pendingJump && active && pendingJump.slug === active.paper.slug) {
      let cancelled = false
      const t = setTimeout(() => {
        const pg = Math.max(1, Math.min(numPages || pendingJump.page, pendingJump.page))
        const sc = scrollRef.current
        if (!sc) return
        void (async () => {
          let hitPage = pg
          let el = pageRefs.current.get(hitPage)
          let hit = pendingJump.snippet ? await locateSnippet(doc, pg, pendingJump.snippet).catch(() => null) : null
          if (!hit && pendingJump.probe) {
            const kh = await locateByKeywords(doc, pg, pendingJump.probe).catch(() => null)
            if (kh) {
              hit = kh.hit
              hitPage = kh.page
              el = pageRefs.current.get(hitPage) ?? el
            }
          }
          if (cancelled) return
          if (!el) return
          const scTop = sc.getBoundingClientRect().top
          const elTop = el.getBoundingClientRect().top - scTop + sc.scrollTop
          const focus = hit ? elTop + hit.top * el.offsetHeight - sc.clientHeight * 0.3 : elTop
          sc.scrollTo({ top: Math.max(0, focus), behavior: 'auto' })
          setCurPage(hitPage)
          curPageRef.current = hitPage
          onPageContext(textCache.current[hitPage] ?? '')
          onPageChange?.(hitPage)
          if (hit) flashHit(el, hit)
          onJumped()
        })()
      }, 350)
      return () => {
        cancelled = true
        clearTimeout(t)
      }
    }
  }, [doc, pendingJump, active, numPages, onPageContext, onJumped])

  const onScroll = useCallback(() => {
    const sc = scrollRef.current
    if (!sc) return
    // 用视口相对位置判定当前页（offsetTop 受 offsetParent 影响，不可靠）
    const scTop = sc.getBoundingClientRect().top
    for (let n = 1; n <= numPages; n++) {
      const el = pageRefs.current.get(n)
      if (el && el.getBoundingClientRect().bottom > scTop + 80) {
        setCurPage(n)
        curPageRef.current = n
        onPageContext(textCache.current[n] ?? '')
        onPageChange?.(n)
        return
      }
    }
  }, [numPages, onPageContext, onPageChange])

  // ===== PDF 内查找（W11）=====
  // 清掉所有查找高亮（拆 mark 还原文本节点，normalize 合并相邻文本节点）
  const clearFindMarks = useCallback(() => {
    const sc = scrollRef.current
    if (!sc) return
    sc.querySelectorAll('mark.pdf-find-hit').forEach((m) => {
      const parent = m.parentNode
      if (!parent) return
      while (m.firstChild) parent.insertBefore(m.firstChild, m)
      parent.removeChild(m)
    })
    sc.normalize()
  }, [])

  // 惰性逐页构建全文档纯文本索引。disableNormalization 与 textLayer 的取法一致，
  // 尽量让索引文本与 DOM 文本对齐（高亮匹配更可靠）。以局部 map 捕获，文档切换后
  // 旧的构建循环不会污染新文档的缓存。
  const ensureFindText = useCallback((d: any): Promise<void> => {
    if (!d) return Promise.resolve()
    const building = findBuildRef.current
    if (building && building.doc === d) return building.promise
    const map = new Map<number, string>()
    findTextRef.current = map
    const promise = (async () => {
      for (let n = 1; n <= d.numPages; n++) {
        if (map.has(n)) continue
        try {
          const pg = await d.getPage(n)
          const tc = await pg.getTextContent({ disableNormalization: true })
          map.set(
            n,
            (tc.items as Array<{ str: string; hasEOL?: boolean }>)
              .map((it) => it.str + (it.hasEOL ? '\n' : ''))
              .join('')
          )
        } catch {
          map.set(n, map.get(n) ?? '')
        }
      }
    })()
    findBuildRef.current = { doc: d, promise }
    return promise
  }, [])

  // 用当前缓存对全文档做大小写不敏感 indexOf 匹配
  const computeFindHits = useCallback(
    (q: string): FindHit[] => {
      const ql = q.toLowerCase()
      if (!ql) return []
      const hits: FindHit[] = []
      for (let n = 1; n <= numPages; n++) {
        const t = findTextRef.current.get(n)
        if (!t) continue
        const low = t.toLowerCase()
        let from = 0
        for (;;) {
          const i = low.indexOf(ql, from)
          if (i < 0) break
          hits.push({ page: n, offset: i, length: ql.length })
          from = i + ql.length
        }
      }
      return hits
    },
    [numPages]
  )

  // 查询变化：先用已缓存文本即时出结果，索引建完后再全量重算（命中列表是全文档的，与当前页解耦）
  useEffect(() => {
    if (!findOpen || !doc) return
    setFindHits(computeFindHits(findQuery))
    setFindIdx(0)
    if (!findQuery.trim()) {
      clearFindMarks()
      return
    }
    let cancelled = false
    void ensureFindText(doc).then(() => {
      if (cancelled) return
      setFindHits(computeFindHits(findQuery))
    })
    return () => {
      cancelled = true
    }
  }, [findQuery, findOpen, doc, computeFindHits, ensureFindText, clearFindMarks])

  // findSignal 变化（父组件 +1）→ 打开查找条并聚焦/全选
  useEffect(() => {
    if (!findSignal || !doc) return
    setFindOpen(true)
    requestAnimationFrame(() => {
      findInputRef.current?.focus()
      findInputRef.current?.select()
    })
  }, [findSignal, doc])

  // Esc 在任意位置关闭查找条
  useEffect(() => {
    if (!findOpen) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setFindOpen(false)
        setFindQuery('')
        setFindHits([])
        setFindIdx(0)
        clearFindMarks()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [findOpen, clearFindMarks])

  const closeFind = useCallback(() => {
    setFindOpen(false)
    setFindQuery('')
    setFindHits([])
    setFindIdx(0)
    clearFindMarks()
  }, [clearFindMarks])

  const stepFind = useCallback(
    (dir: 1 | -1) => {
      if (!findHits.length) return
      setFindIdx((i) => (i + dir + findHits.length) % findHits.length)
    },
    [findHits.length]
  )

  // 在指定页 textLayer 内把全部匹配包上 <mark class="pdf-find-hit">，返回「当前命中」的 mark。
  // 跨文本节点/跨行的匹配尽力分段包裹；结构对不上时返回 null（静默放弃高亮，计数与跳页不受影响）。
  const applyFindHighlight = useCallback(
    (page: number, query: string, activeOrdinal: number): HTMLElement | null => {
      const wrap = pageRefs.current.get(page)
      const layer = wrap?.querySelector(':scope > .textLayer')
      if (!(layer instanceof HTMLElement)) return null
      clearFindMarks()
      const ql = query.toLowerCase()
      if (!ql) return null
      // 收集该页 textLayer 的全部文本节点拼成整串，用于定位匹配区间
      const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT)
      const nodes: Text[] = []
      const starts: number[] = []
      let total = ''
      for (let wn = walker.nextNode(); wn; wn = walker.nextNode()) {
        const t = wn as Text
        if (!t.nodeValue) continue
        starts.push(total.length)
        nodes.push(t)
        total += t.nodeValue
      }
      const low = total.toLowerCase()
      const ranges: Array<[number, number]> = []
      let from = 0
      for (;;) {
        const i = low.indexOf(ql, from)
        if (i < 0) break
        ranges.push([i, i + ql.length])
        from = i + ql.length
      }
      if (!ranges.length) return null
      const activeIdx = Math.min(Math.max(0, activeOrdinal), ranges.length - 1)
      // live：随拆分动态增长的候选文本节点（start 为整串内的绝对偏移）
      const live: Array<{ node: Text; start: number }> = nodes.map((node, i) => ({ node, start: starts[i] ?? 0 }))
      let activeMark: HTMLElement | null = null
      for (let ri = 0; ri < ranges.length; ri++) {
        const rStart = ranges[ri][0]
        const rEnd = ranges[ri][1]
        let j = 0
        while (j < live.length) {
          const cur = live[j]
          if (cur.start + (cur.node.nodeValue?.length ?? 0) > rStart) break
          j++
        }
        let lastMark: HTMLElement | null = null
        while (j < live.length) {
          const cur = live[j]
          const ns = cur.start
          if (ns >= rEnd) break
          let target: Text = cur.node
          let ls = Math.max(0, rStart - ns)
          let le = Math.min(cur.node.nodeValue?.length ?? 0, rEnd - ns)
          if (ls > 0) {
            target = target.splitText(ls)
            le -= ls
          }
          if (le < (target.nodeValue?.length ?? 0)) target.splitText(le)
          const mark = document.createElement('mark')
          mark.className = 'pdf-find-hit'
          target.parentNode?.insertBefore(mark, target)
          mark.appendChild(target)
          lastMark = mark
          // 本节点被拆出的剩余部分重新登记，同一节点内的后续匹配也能命中
          const rest = mark.nextSibling
          if (rest instanceof Text && rest.nodeValue) live.splice(j + 1, 0, { node: rest, start: rEnd })
          j++
        }
        if (ri === activeIdx && lastMark) activeMark = lastMark
      }
      return activeMark ?? (layer.querySelector('mark.pdf-find-hit') as HTMLElement | null)
    },
    [clearFindMarks]
  )

  // 当前命中：跳页（复用 goToPage）+ 包高亮 + 滚到命中处（只滚 .viewer-scroll）。
  // 页面懒渲染未就绪时轮询重试；layerTick（当前页文本层重建完成，含缩放后）触发重涂。
  const curHit = findOpen && findQuery.trim() && findHits.length > 0 ? findHits[Math.min(findIdx, findHits.length - 1)] : null
  const curHitKey = curHit ? `${curHit.page}:${curHit.offset}` : ''
  useEffect(() => {
    if (!curHit || !findQuery.trim()) return
    const target = curHit.page
    // 当前命中在该页内的序号（DOM 内第几个匹配，尽力对齐）
    let ordinal = 0
    for (let i = 0; i < Math.min(findIdx, findHits.length); i++) {
      if (findHits[i]?.page === target) ordinal++
    }
    if (curPageRef.current !== target) goToPage(target)
    let cancelled = false
    let timer: number | undefined
    let attempts = 0
    const run = (): void => {
      if (cancelled) return
      attempts++
      const mark = applyFindHighlight(target, findQuery, ordinal)
      if (mark) {
        const sc = scrollRef.current
        if (sc) {
          const top = mark.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop
          sc.scrollTo({ top: Math.max(0, top - sc.clientHeight * 0.35), behavior: 'smooth' })
        }
        return
      }
      if (attempts < 10) timer = window.setTimeout(run, 250)
    }
    timer = window.setTimeout(run, 60)
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
    // findIdx/findHits/curHit 均由 curHitKey 覆盖，闭合值始终取自最新渲染
  }, [curHitKey, findQuery, layerTick, goToPage, applyFindHighlight])

  // 缩放后把当前页锚回视野（页面宽度按比例变化，阅读位置不丢）
  useEffect(() => {
    const t = setTimeout(() => {
      const sc = scrollRef.current
      const el = pageRefs.current.get(curPageRef.current)
      if (!sc || !el) return
      const top = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop
      if (el.getBoundingClientRect().bottom < sc.getBoundingClientRect().top + 60 || top > sc.scrollTop + sc.clientHeight) {
        sc.scrollTo({ top: Math.max(0, top - 30), behavior: 'auto' })
      }
    }, 120)
    return () => clearTimeout(t)
  }, [scale])

  // 面板拖宽/收窄后自动重排：跟随容器宽度重算适配缩放（保留手动缩放倍率）
  useEffect(() => {
    const sc = scrollRef.current
    if (!sc || !doc) return
    let prevW = sc.clientWidth
    const ro = new ResizeObserver(() => {
      const w = sc.clientWidth
      if (w > 150 && baseVwRef.current && Math.abs(w - prevW) > 2) {
        prevW = w
        setBaseScale(Math.max(0.5, Math.min(2.2, (w - 56) / baseVwRef.current)))
      }
    })
    ro.observe(sc)
    return () => ro.disconnect()
  }, [doc])

  const onMouseUp = useCallback(
    (e: React.MouseEvent) => {
      const sel = window.getSelection()
      const text = sel?.toString().trim() ?? ''
      if (!sel || text.length < 2) return
      const range = sel.getRangeAt(0)
      const rect = range.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) return
      onSelect(text, rect.left + rect.width / 2 - 90, rect.bottom + 6)
    },
    [onSelect]
  )

  if (!active) {
    return (
      <div className="pdf-pane">
        <div className="empty-viewer">
          <div className="big">📄</div>
          <div className="headline">从左侧选择一篇论文开始阅读</div>
          <div className="tip">
            选中文字即可 <span className="kbd">翻译</span> <span className="kbd">解释</span> <span className="kbd">追问</span>；右侧面板支持当前论文与全库 RAG 问答，回答自带页码引用。
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="pdf-pane">
      <div className="tabbar">
        {tabs.map((t) => (
          <div
            key={t.paper.id}
            className={`tab ${t.paper.id === activeId ? 'active' : ''}`}
            onClick={() => onActivate(t.paper.id)}
            title={t.paper.title}
          >
            <span className="tab-title">{t.paper.title}</span>
            <span
              className="x"
              title="关闭"
              onClick={(e) => {
                e.stopPropagation()
                onCloseTab(t.paper.id)
              }}
            >
              ✕
            </span>
          </div>
        ))}
      </div>
      <div className="viewer-toolbar">
        <div className="seg" title="侧边导航">
          <button className={navi === 'thumbs' ? 'on' : ''} onClick={() => setNavi((n) => (n === 'thumbs' ? 'none' : 'thumbs'))} title="页面缩略图">
            ▦
          </button>
          <button className={navi === 'toc' ? 'on' : ''} onClick={() => setNavi((n) => (n === 'toc' ? 'none' : 'toc'))} title="目录 / 书签">
            ☰
          </button>
        </div>
        <span className="slug" title={active.paper.title}>
          <b>{active.paper.title}</b>
        </span>
        <span style={{ flex: 1 }} />
        <div className="seg" title="页面导航">
          <button onClick={() => goToPage(1)} disabled={curPage <= 1} title="首页">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 17l-5-5 5-5M18 17l-5-5 5-5" /></svg>
          </button>
          <button onClick={() => goToPage(curPage - 1)} disabled={curPage <= 1} title="上一页">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <span className="page-ind">
            {curPage} / {numPages || '…'}
          </span>
          <button onClick={() => goToPage(curPage + 1)} disabled={!numPages || curPage >= numPages} title="下一页">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
          </button>
          <button onClick={() => goToPage(numPages)} disabled={!numPages || curPage >= numPages} title="末页">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 7l5 5-5 5M6 7l5 5-5 5" /></svg>
          </button>
        </div>
        <div className="seg" title="缩放">
          <button onClick={() => setZoom((z) => Math.max(0.4, z - 0.15))}>−</button>
          <button onClick={() => setZoom(1)} title="适应宽度">{Math.round(scale * 100)}%</button>
          <button onClick={() => setZoom((z) => Math.min(3, z + 0.15))}>+</button>
        </div>
        <button className="ft-btn" title="全文翻译：当前页逐段中英对照（免 Key 可用）" onClick={() => onOpenFulltext?.()}>
          译 全文翻译
        </button>
      </div>
      {findOpen && (
        <div className="pdf-findbar">
          <input
            ref={findInputRef}
            className="pdf-findbar-input"
            type="text"
            placeholder="在文档中查找…"
            spellCheck={false}
            value={findQuery}
            onChange={(e) => setFindQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                stepFind(e.shiftKey ? -1 : 1)
              }
            }}
          />
          <span className="pdf-findbar-count">
            {!findQuery.trim() ? '' : findHits.length > 0 ? `${Math.min(findIdx + 1, findHits.length)} / ${findHits.length}` : '无结果'}
          </span>
          <button className="pdf-findbar-btn" title="上一个（Shift+Enter）" disabled={!findHits.length} onClick={() => stepFind(-1)}>
            ↑
          </button>
          <button className="pdf-findbar-btn" title="下一个（Enter）" disabled={!findHits.length} onClick={() => stepFind(1)}>
            ↓
          </button>
          <button className="pdf-findbar-btn" title="关闭（Esc）" onClick={closeFind}>
            ✕
          </button>
        </div>
      )}
      <div className="pdf-main">
        {navi !== 'none' && (
          <div className="pdf-navi">
            {navi === 'thumbs' ? (
              Array.from({ length: numPages }, (_, i) => <ThumbPage key={i + 1} doc={doc} num={i + 1} cur={curPage} onJump={goToPage} />)
            ) : outline.length > 0 ? (
              outline.map((o, i) => (
                <button
                  key={i}
                  className={`pdf-toc-item ${o.page === curPage ? 'on' : ''}`}
                  style={{ paddingLeft: 10 + o.depth * 12 }}
                  disabled={!o.page}
                  title={o.title}
                  onClick={() => o.page && goToPage(o.page)}
                >
                  <span className="ellipsis">{o.title}</span>
                  {o.page ? <span className="pdf-toc-p">{o.page}</span> : null}
                </button>
              ))
            ) : (
              <div className="pdf-navi-empty">本文档没有目录信息</div>
            )}
          </div>
        )}
        <div className="viewer-scroll" ref={attachScrollEl} onMouseUp={onMouseUp} onScroll={onScroll}>
        {error && <div className="empty-viewer">PDF 打开失败：{error}</div>}
        {doc &&
          Array.from({ length: numPages }, (_, i) => (
            <PageView
              key={`${active.paper.id}-${i + 1}`}
              doc={doc}
              num={i + 1}
              scale={scale}
              dim={pageDims[i]}
              hls={hls.filter((h) => h.page === i + 1)}
              onDeleteHl={onDeleteHighlight}
              registerRef={(el) => {
                if (el) pageRefs.current.set(i + 1, el)
                else pageRefs.current.delete(i + 1)
              }}
              onPageText={(n, txt) => {
                textCache.current[n] = txt
                if (n === curPage) onPageContext(txt)
              }}
              onLayerReady={handleLayerReady}
            />
          ))}
        </div>
      </div>
    </div>
  )
})

// 解析文档目录（书签）为平铺列表（带层级），dest 解析为页码
async function buildOutline(d: any): Promise<Array<{ title: string; page: number; depth: number }>> {
  try {
    const ol = await d.getOutline()
    if (!ol?.length) return []
    const out: Array<{ title: string; page: number; depth: number }> = []
    const walk = async (items: any[], depth: number): Promise<void> => {
      for (const it of items) {
        let page = 0
        try {
          const dest = typeof it.dest === 'string' ? await d.getDestination(it.dest) : it.dest
          if (dest?.length) page = (await d.getPageIndex(dest[0])) + 1
        } catch {
          page = 0
        }
        out.push({ title: it.title || '(无标题)', page, depth })
        if (it.items?.length && depth < 2) await walk(it.items, depth + 1)
      }
    }
    await walk(ol, 0)
    return out
  } catch {
    return []
  }
}

// 页面缩略图（懒渲染）
function ThumbPage({ doc, num, cur, onJump }: { doc: any; num: number; cur: number; onJump: (n: number) => void }): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [visible, setVisible] = useState(num <= 4)
  const done = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver((entries) => entries.forEach((en) => en.isIntersecting && setVisible(true)), {
      root: el.closest('.pdf-navi'),
      rootMargin: '300px 0px'
    })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!visible || done.current || !doc) return
    done.current = true
    void (async () => {
      try {
        const page = await doc.getPage(num)
        const base = page.getViewport({ scale: 1 })
        const vp = page.getViewport({ scale: 120 / base.width })
        const cv = canvasRef.current!
        const dpr = 2
        cv.width = Math.floor(vp.width * dpr)
        cv.height = Math.floor(vp.height * dpr)
        cv.style.width = '120px'
        cv.style.height = `${Math.floor((vp.height / vp.width) * 120)}px`
        await page.render({ canvasContext: cv.getContext('2d')!, viewport: vp, transform: [dpr, 0, 0, dpr, 0, 0] } as any).promise
      } catch {
        /* 缩略图失败静默 */
      }
    })()
  }, [visible, doc, num])

  return (
    <div ref={ref} className={`pdf-thumb ${cur === num ? 'on' : ''}`} onClick={() => onJump(num)} title={`第 ${num} 页`}>
      <canvas ref={canvasRef} />
      <span>{num}</span>
    </div>
  )
}

interface PageViewProps {
  doc: any
  num: number
  scale: number
  dim?: { w: number; h: number }
  hls: Highlight[]
  onDeleteHl: (id: number) => void
  registerRef: (el: HTMLDivElement | null) => void
  onPageText: (n: number, text: string) => void
  // 该页 textLayer 渲染完成（首次/缩放重建后）
  onLayerReady?: (n: number) => void
}

function PageView({ doc, num, scale, dim, hls, onDeleteHl, registerRef, onPageText, onLayerReady }: PageViewProps): JSX.Element {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const taskRef = useRef<any>(null)
  const [visible, setVisible] = useState(num <= 2)
  const renderedFor = useRef(0)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => entries.forEach((en) => en.isIntersecting && setVisible(true)),
      { root: el.closest('.viewer-scroll'), rootMargin: '600px 0px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!visible || !doc || renderedFor.current === scale) return
    let cancelled = false
    const prevTask = taskRef.current
    if (prevTask) {
      try { prevTask.cancel() } catch { /* already done */ }
    }
    void (async () => {
      try {
      const page = await doc.getPage(num)
      if (cancelled) return
      const viewport = page.getViewport({ scale })
      const canvas = canvasRef.current!
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.floor(viewport.width * dpr)
      canvas.height = Math.floor(viewport.height * dpr)
      canvas.style.width = `${Math.floor(viewport.width)}px`
      canvas.style.height = `${Math.floor(viewport.height)}px`
      const ctx = canvas.getContext('2d')!
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      const renderTask = page.render({
        canvas,
        canvasContext: ctx,
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined
      } as any)
      taskRef.current = renderTask
      await renderTask.promise
      if (cancelled) return
      // 先提取文本（全文翻译/上下文依赖它），再渲染选择层——两步解耦，
      // 选择层出问题不影响文本功能
      try {
        const tc = await page.getTextContent()
        const txt = (tc.items as Array<{ str: string; hasEOL?: boolean }>)
          .map((it) => it.str + (it.hasEOL ? '\n' : ''))
          .join('')
          .replace(/[ \t]+\n/g, '\n')
        renderedFor.current = scale
        onPageText(num, txt)
      } catch (e) {
        if (!String(e).toLowerCase().includes('cancel')) console.error(`[page ${num}] text extract failed:`, e)
      }
      if (cancelled) return
      // 选择层（划词的关键）
      try {
        const container = textRef.current!
        container.innerHTML = ''
        container.style.setProperty('--scale-factor', String(viewport.scale))
        const tl = new (pdfjsLib as any).TextLayer({
          textContentSource: page.streamTextContent({ includeMarkedContent: false, disableNormalization: true }),
          container,
          viewport
        })
        await tl.render()
        onLayerReady?.(num)
      } catch (e) {
        if (!String(e).toLowerCase().includes('cancel')) console.error(`[page ${num}] text layer failed:`, e)
      }
      } catch (e) {
        if (!String(e).toLowerCase().includes('cancel')) {
          console.error(`[page ${num}] render failed:`, e)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [visible, doc, scale, num])

  // 卸载时取消进行中的渲染任务
  useEffect(() => {
    return () => {
      try { taskRef.current?.cancel() } catch { /* noop */ }
    }
  }, [])

  return (
    <div
      className="page-wrap"
      ref={(el) => { registerRef(el); (wrapRef as any).current = el }}
      style={dim ? { width: Math.floor(dim.w * scale), height: Math.floor(dim.h * scale) } : undefined}
    >
      <canvas ref={canvasRef} style={dim ? { width: Math.floor(dim.w * scale), height: Math.floor(dim.h * scale) } : undefined} />
      <div className="textLayer" ref={textRef} />
      {/* 高亮层置于文本层之上：点击高亮即删除 */}
      <div className="hl-layer" data-n={hls.length}>
        {hls.map((h) => (
          <div
            key={h.id}
            className="hl-group"
            title={`${h.text.slice(0, 80)}\n（点击删除高亮）`}
            onClick={(e) => {
              e.stopPropagation()
              onDeleteHl(h.id)
            }}
          >
            {h.rects.map((r, i) => (
              <div
                key={i}
                className="hl"
                style={{
                  left: `${r.x * 100}%`,
                  top: `${r.y * 100}%`,
                  width: `${r.w * 100}%`,
                  height: `${r.h * 100}%`,
                  background: HL_BG[h.color ?? 'yellow']
                }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

export default PdfViewer
