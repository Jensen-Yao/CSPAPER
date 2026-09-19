import { contextBridge, ipcRenderer, webUtils } from 'electron'

const api = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch: unknown) => ipcRenderer.invoke('settings:save', patch),
  pickLibrary: () => ipcRenderer.invoke('library:pick'),
  scanLibrary: (libPath?: string) => ipcRenderer.invoke('library:scan', libPath),
  listPapers: () => ipcRenderer.invoke('papers:list'),
  listCategories: () => ipcRenderer.invoke('categories:list'),
  setStatus: (id: number, status: string) => ipcRenderer.invoke('papers:status', id, status),
  readPdf: (p: string) => ipcRenderer.invoke('pdf:read', p),
  indexStatus: () => ipcRenderer.invoke('index:status'),
  rebuildIndex: () => ipcRenderer.invoke('index:rebuild'),
  startIndex: () => ipcRenderer.send('index:start'),
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  pickImport: () => ipcRenderer.invoke('papers:pick-import'),
  importPapers: (items: Array<{ path: string; category?: string }>) => ipcRenderer.invoke('papers:import', items),
  previewImport: (paths: string[]) => ipcRenderer.invoke('papers:preview-import', paths),
  // Zotero 文献库导入
  zoteroDetect: () => ipcRenderer.invoke('zotero:detect'),
  zoteroPickDir: () => ipcRenderer.invoke('zotero:pick-dir'),
  zoteroPreview: (dataDir?: string) => ipcRenderer.invoke('zotero:preview', dataDir),
  zoteroImport: (items: Array<{ key: string; category?: string }>) => ipcRenderer.invoke('zotero:import', items),
  onZoteroProgress: (cb: (p: { done: number; total: number; current: string }) => void) => {
    const h = (_e: unknown, p: { done: number; total: number; current: string }) => cb(p)
    ipcRenderer.on('zotero:progress', h)
    return () => ipcRenderer.removeListener('zotero:progress', h)
  },
  onZoteroFile: (cb: (o: unknown) => void) => {
    const h = (_e: unknown, o: unknown) => cb(o)
    ipcRenderer.on('zotero:file', h)
    return () => ipcRenderer.removeListener('zotero:file', h)
  },
  // 题录文件导入（RIS / EndNote / CNKI 导出）
  recordsPickParse: () => ipcRenderer.invoke('records:pick-parse'),
  recordsImport: (entries: unknown[], category: string) => ipcRenderer.invoke('records:import', entries, category),
  onRecordsProgress: (cb: (p: { done: number; total: number; current: string }) => void) => {
    const h = (_e: unknown, p: { done: number; total: number; current: string }) => cb(p)
    ipcRenderer.on('records:progress', h)
    return () => ipcRenderer.removeListener('records:progress', h)
  },
  onRecordsFile: (cb: (o: unknown) => void) => {
    const h = (_e: unknown, o: unknown) => cb(o)
    ipcRenderer.on('records:file', h)
    return () => ipcRenderer.removeListener('records:file', h)
  },
  // 移动端数据互导
  exportMobilePack: () => ipcRenderer.invoke('mobile:export-pack'),
  mergeMobileNotes: () => ipcRenderer.invoke('mobile:merge-notes'),
  onMobileProgress: (cb: (p: { done: number; total: number; current: string }) => void) => {
    const h = (_e: unknown, p: { done: number; total: number; current: string }) => cb(p)
    ipcRenderer.on('mobile:progress', h)
    return () => ipcRenderer.removeListener('mobile:progress', h)
  },
  onAppNotice: (cb: (p: { title: string; detail: string }) => void) => {
    const h = (_e: unknown, p: { title: string; detail: string }) => cb(p)
    ipcRenderer.on('app:notice', h)
    return () => ipcRenderer.removeListener('app:notice', h)
  },
  // 深度搜索（正文 + 笔记）
  deepSearch: (q: string) => ipcRenderer.invoke('search:deep', q),
  // AI 文献卡片小结 / AI 对比表格
  summarizePaper: (id: number) => ipcRenderer.invoke('papers:summarize', id),
  compareList: () => ipcRenderer.invoke('compare:list'),
  compareCreate: (title?: string) => ipcRenderer.invoke('compare:create', title),
  compareDelete: (id: number) => ipcRenderer.invoke('compare:delete', id),
  compareSave: (id: number, data: unknown) => ipcRenderer.invoke('compare:save', id, data),
  compareGenerate: (paperId: number, dimensions: string[]) => ipcRenderer.invoke('compare:generate', paperId, dimensions),
  compareExport: (id: number, format: 'md' | 'csv') => ipcRenderer.invoke('compare:export', id, format),
  paperDetail: (id: number) => ipcRenderer.invoke('papers:detail', id),
  myNotesGet: (id: number) => ipcRenderer.invoke('notes:mine-get', id),
  myNotesSave: (id: number, text: string) => ipcRenderer.invoke('notes:mine-save', id, text),
  graphData: (category?: string) => ipcRenderer.invoke('graph:data', category),
  appStatus: () => ipcRenderer.invoke('app:status'),
  dataOpen: () => ipcRenderer.invoke('data:open'),
  dataChangeDir: () => ipcRenderer.invoke('data:change-dir'),
  onPreviewFile: (cb: (p: unknown) => void) => {
    const h = (_e: unknown, p: unknown) => cb(p)
    ipcRenderer.on('preview:file', h)
    return () => ipcRenderer.removeListener('preview:file', h)
  },
  onPreviewProgress: (cb: (p: { done: number; total: number; current: string }) => void) => {
    const h = (_e: unknown, p: { done: number; total: number; current: string }) => cb(p)
    ipcRenderer.on('preview:progress', h)
    return () => ipcRenderer.removeListener('preview:progress', h)
  },
  addHighlight: (paperId: number, page: number, rects: Array<{ x: number; y: number; w: number; h: number }>, text: string, color?: string) =>
    ipcRenderer.invoke('highlights:add', paperId, page, rects, text, color),
  listHighlights: (paperId: number) => ipcRenderer.invoke('highlights:list', paperId),
  deleteHighlight: (id: number) => ipcRenderer.invoke('highlights:delete', id),
  paperMenu: (id: number, x: number, y: number) => ipcRenderer.send('papers:menu', id, x, y),
  categoryMenu: (cat: string, x: number, y: number) => ipcRenderer.send('category:menu', cat, x, y),
  blankMenu: (x: number, y: number) => ipcRenderer.send('library:blank-menu', x, y),
  renameCategory: (from: string, to: string) => ipcRenderer.invoke('category:rename', from, to),
  renamePaper: (id: number, title: string) => ipcRenderer.invoke('papers:rename', id, title),
  movePaper: (id: number, category: string) => ipcRenderer.invoke('papers:move', id, category),
  createCategory: (name: string) => ipcRenderer.invoke('category:create', name),
  deleteCategory: (name: string) => ipcRenderer.invoke('category:delete', name),
  markOpened: (id: number) => ipcRenderer.send('papers:opened', id),
  pickImportFolder: () => ipcRenderer.invoke('papers:pick-import-folder'),
  onCategoryRenameRequest: (cb: (cat: string) => void) => {
    const h = (_e: unknown, cat: string) => cb(cat)
    ipcRenderer.on('category:rename-request', h)
    return () => ipcRenderer.removeListener('category:rename-request', h)
  },
  onPapersRenameRequest: (cb: (p: { id: number; title: string }) => void) => {
    const h = (_e: unknown, p: { id: number; title: string }) => cb(p)
    ipcRenderer.on('papers:rename-request', h)
    return () => ipcRenderer.removeListener('papers:rename-request', h)
  },
  onCategoryCreateRequest: (cb: () => void) => {
    const h = (): void => cb()
    ipcRenderer.on('category:create-request', h)
    return () => ipcRenderer.removeListener('category:create-request', h)
  },
  onMoveNewRequest: (cb: (p: { id: number; title: string }) => void) => {
    const h = (_e: unknown, p: { id: number; title: string }) => cb(p)
    ipcRenderer.on('papers:move-new-request', h)
    return () => ipcRenderer.removeListener('papers:move-new-request', h)
  },
  onPapersChanged: (cb: () => void) => {
    const h = (): void => cb()
    ipcRenderer.on('papers:changed', h)
    return () => ipcRenderer.removeListener('papers:changed', h)
  },
  onImportRequest: (cb: () => void) => {
    const h = (): void => cb()
    ipcRenderer.on('app:import-request', h)
    return () => ipcRenderer.removeListener('app:import-request', h)
  },
  onImportFile: (cb: (o: unknown) => void) => {
    const h = (_e: unknown, o: unknown) => cb(o)
    ipcRenderer.on('import:file', h)
    return () => ipcRenderer.removeListener('import:file', h)
  },
  testLLM: (over?: { apiBase?: string; apiKey?: string; model?: string; provider?: string }) => ipcRenderer.invoke('llm:test', over),
  testEmbed: () => ipcRenderer.invoke('embed:test'),

  // 流式对话：返回 stop 不需要（请求即发即忘，以 reqId 收尾）
  stream: (args: Record<string, unknown>, handlers: { onDelta: (t: string) => void; onEnd: () => void; onSources?: (s: unknown[]) => void }) => {
    const reqId = Date.now() + Math.floor(Math.random() * 1e6)
    const deltaCh = `llm:delta:${reqId}`
    const endCh = `llm:end:${reqId}`
    const srcCh = `llm:sources:${reqId}`
    const onDelta = (_e: unknown, t: string) => handlers.onDelta(t)
    const onEnd = () => {
      cleanup()
      handlers.onEnd()
    }
    const onSources = (_e: unknown, s: unknown[]) => handlers.onSources?.(s)
    function cleanup(): void {
      ipcRenderer.removeListener(deltaCh, onDelta)
      ipcRenderer.removeListener(endCh, onEnd)
      ipcRenderer.removeListener(srcCh, onSources)
    }
    ipcRenderer.on(deltaCh, onDelta)
    ipcRenderer.on(endCh, onEnd)
    ipcRenderer.on(srcCh, onSources)
    ipcRenderer.send('llm:stream', { reqId, ...args })
  },

  onIndexProgress: (cb: (p: unknown) => void) => {
    const h = (_e: unknown, p: unknown) => cb(p)
    ipcRenderer.on('index:progress', h)
    return () => ipcRenderer.removeListener('index:progress', h)
  },
  onImportProgress: (cb: (p: unknown) => void) => {
    const h = (_e: unknown, p: unknown) => cb(p)
    ipcRenderer.on('import:progress', h)
    return () => ipcRenderer.removeListener('import:progress', h)
  },
  openExternal: (url: string) => ipcRenderer.send('open-external', url),
  syncTheme: (theme: string) => ipcRenderer.send('ui:theme', theme),

  // ---------- 标签系统（W1） ----------
  tagsList: () => ipcRenderer.invoke('tags:list'),
  tagsCreate: (name: string, color?: string) => ipcRenderer.invoke('tags:create', name, color),
  tagsRename: (id: number, name: string) => ipcRenderer.invoke('tags:rename', id, name),
  tagsDelete: (id: number) => ipcRenderer.invoke('tags:delete', id),
  tagsSetColor: (id: number, color: string) => ipcRenderer.invoke('tags:set-color', id, color),
  paperTagAdd: (id: number, name: string, color?: string) => ipcRenderer.invoke('papers:tag-add', id, name, color),
  paperTagRemove: (id: number, tagId: number) => ipcRenderer.invoke('papers:tag-remove', id, tagId),
  papersTagsOf: (id: number) => ipcRenderer.invoke('papers:tags-of', id),

  // ---------- 阅读进度与时长（W2/W7） ----------
  paperLastPage: (id: number, page: number) => ipcRenderer.send('papers:lastpage', id, page),
  paperReadTime: (id: number, seconds: number) => ipcRenderer.send('papers:readtime', id, seconds),

  // ---------- Translators 抓取脚本（W13） ----------
  translatorsList: () => ipcRenderer.invoke('translators:list'),
  translatorsMatch: (url: string) => ipcRenderer.invoke('translators:match', url),
  translatorsTranslate: (url: string) => ipcRenderer.invoke('translators:translate', url),
  translatorsSearch: (q: string) => ipcRenderer.invoke('translators:search', q),
  translatorsImport: (payload: unknown) => ipcRenderer.invoke('translators:import', payload),
  translatorsSetDisabled: (ids: string[]) => ipcRenderer.invoke('translators:set-disabled', ids),
  translatorsReload: () => ipcRenderer.invoke('translators:reload'),
  translatorsOpenDir: () => ipcRenderer.invoke('translators:open-dir'),
  translatorsDetectInput: (text: string) => ipcRenderer.invoke('translators:detect-input', text),

  // ---------- CSL 引文（W8） ----------
  cslStyles: () => ipcRenderer.invoke('csl:styles'),
  cslFormat: (ids: number[], styleId: string) => ipcRenderer.invoke('csl:format', ids, styleId),
  cslDownloadStyle: (id: string) => ipcRenderer.invoke('csl:download-style', id),
  cslRemoveStyle: (id: string) => ipcRenderer.invoke('csl:remove-style', id),
  cslCatalogSearch: (q: string) => ipcRenderer.invoke('csl:catalog-search', q),
  cslEngineStatus: () => ipcRenderer.invoke('csl:engine-status'),
  cslEngineDownload: () => ipcRenderer.invoke('csl:engine-download'),
  cslImportStyle: () => ipcRenderer.invoke('csl:import-style'),
  cslOpenDir: () => ipcRenderer.invoke('csl:open-dir'),

  // ---------- 参考文献 / 被引 / 统计（W4/W6/W7） ----------
  refsList: (id: number) => ipcRenderer.invoke('refs:list', id),
  refsImport: (paperId: number, index: number, category?: string) => ipcRenderer.invoke('refs:import', paperId, index, category),
  citedUpdate: (ids: number[]) => ipcRenderer.invoke('cited:update', ids),
  statsOverview: () => ipcRenderer.invoke('stats:overview'),
  venuesLookup: (name: string) => ipcRenderer.invoke('venues:lookup', name),
  venuesImportCsv: () => ipcRenderer.invoke('venues:import-csv'),

  // ---------- 知识体系 + 统计扩展（v0.7） ----------
  graphKeywords: (category?: string) => ipcRenderer.invoke('graph:keywords', category),
  graphAuthors: (category?: string) => ipcRenderer.invoke('graph:authors', category),
  graphTopics: (category?: string) => ipcRenderer.invoke('graph:topics', category),
  statsExtra: () => ipcRenderer.invoke('stats:extra'),

  // ---------- 内置浏览器 + 一键安装（v0.7） ----------
  webSavePage: (url: string, category?: string) => ipcRenderer.invoke('web:save-page', url, category),
  extOpenFolder: () => ipcRenderer.invoke('ext:open-folder'),
  extInstallGuide: (browser: 'chrome' | 'edge') => ipcRenderer.invoke('ext:install-guide', browser),
  wordSideload: () => ipcRenderer.invoke('word:sideload'),
  wpsOpenCite: () => ipcRenderer.invoke('wps:open-cite')
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
