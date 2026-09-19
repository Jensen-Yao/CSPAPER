export interface Paper {
  id: number
  slug: string
  title: string
  authors: string
  year: number | null
  venue: string
  category: string
  path: string
  status: string
  n_pages: number
  indexed: number
  added_at: string
  opened_at?: string | null
  summary?: string
  // v0.6.0 扩展
  doi?: string | null
  item_type?: string | null
  last_page?: number
  read_seconds?: number
  cited_by?: number | null
  jcr?: string | null
  tags?: string[]
}

// 阅读状态五态（W2，对标 Reading List）
export const STATUS_META: Record<string, { label: string; icon: string; color: string }> = {
  todo: { label: '稍后读', icon: '🕓', color: '#b08d57' },
  unread: { label: '待读', icon: '-new', color: '#98a2ab' },
  reading: { label: '在读', icon: '📖', color: '#6b7fa3' },
  read: { label: '已读', icon: '✅', color: '#7a9e7e' },
  paused: { label: '暂不读', icon: '⏸', color: '#a37f9e' }
}
export const STATUS_KEYS = ['todo', 'unread', 'reading', 'read', 'paused']

// 多服务商配置（设置页可维护多套，对话界面切换模型时自动激活所属配置）
export interface ProviderProfile {
  provider: string
  apiBase: string
  apiKey: string
  models: string[]
}

export interface Settings {
  libraryPath: string
  apiBase: string
  apiKey: string
  model: string
  models?: string[]
  thinkingLevel?: 'default' | 'off' | 'low' | 'medium' | 'high'
  provider: string
  embedProvider: 'local' | 'zhipu' | 'ollama'
  ollamaUrl: string
  ollamaEmbedModel: string
  translateTarget: string
  theme: 'system' | 'light' | 'dark'
  setupDone?: boolean
  profiles?: ProviderProfile[]
  renameTemplate?: string
  closeToTray?: boolean
  disabledTranslators?: string[]
}

// 标签（W1）
export interface TagRow {
  id: number
  name: string
  color: string
  count: number
}

// 抓取脚本信息（W13）
export interface ScriptInfo {
  id: string
  name: string
  type: 'web' | 'search'
  matches: string[]
  source: 'builtin' | 'user'
  disabled: boolean
  file: string
  note?: string
}

// 引文样式（W8）
export interface StyleInfo {
  id: string
  name: string
  kind: 'builtin' | 'csl'
  numeric: boolean
  note?: string
  engineRequired?: boolean
}

export interface HighlightRect {
  x: number
  y: number
  w: number
  h: number
}

export interface Highlight {
  id: number
  page: number
  rects: HighlightRect[]
  text: string
  color?: string
}

export interface ImportOutcome {
  file: string
  path?: string
  ok: boolean
  slug?: string
  title?: string
  category?: string
  classified?: boolean
  skipped?: boolean
  error?: string
}

// 导入预检（逐篇 AI 识别，不落盘）：弹窗队列每行的推荐分类来源
export interface ImportPreviewItem {
  file: string
  path: string
  ok: boolean
  category?: string
  title?: string
  error?: string
}

// Zotero 库条目预览（导入弹窗队列行）
export interface ZoteroPaper {
  key: string
  itemType: string
  title: string
  authors: string
  year: number | null
  venue: string
  collections: string[]
  pdf: string
}

export interface ZoteroPreviewResult {
  dataDir: string
  items: ZoteroPaper[]
  error?: string
}

export interface ZoteroOutcome {
  key: string
  title: string
  ok: boolean
  category?: string
  skipped?: boolean
  error?: string
}

// 题录文件（RIS/EndNote/CNKI 导出）解析出的条目
export interface RecordEntry {
  title: string
  authors: string
  year: number | null
  venue: string
  doi?: string
  abstract?: string
}

export interface RecordOutcome {
  title: string
  ok: boolean
  slug?: string
  error?: string
}

export interface MobilePackResult {
  papers: number
  highlights: number
  bytes: number
}

export interface MobileMergeResult {
  mergedHighlights: number
  mergedStatus: number
  mergedSummaries: number
  skipped: number
}

// AI 对比表格
export interface CompareCell {
  t: string
  p: number | null
}

export interface CompareData {
  paperIds: number[]
  dimensions: string[]
  fields?: string[]
  cells: Record<string, Record<string, CompareCell[]>>
}

export interface CompareTable {
  id: number
  title: string
  data: CompareData
  created_at: string
}

// 卡片详情栏（信息 / 摘要 / 笔记 / 附件）
export interface PaperDetail {
  id: number
  slug: string
  title: string
  authors: string
  year: number | null
  venue: string
  category: string
  status: string
  added_at: string
  summary: string | null
  abstract: string
  files: string[]
  notesCount: number
  myNotes: string
}

// 深度搜索命中（正文 / 划词笔记）
export interface DeepHit {
  id: number
  slug: string
  title: string
  snippet: string
  page: number | null
  from: 'content' | 'note'
}

export interface SourceRef {
  n: number
  slug: string
  title: string
  page: number
  // 命中块原文（截断），引用跳转用它定位到页内真实段落
  snippet?: string
}

export interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
  sources?: SourceRef[]
}

// 统计仪表盘（W7）
export interface StatsOverview {
  totalPapers: number
  totalReadSeconds: number
  readingPapers: number
  topRead: Array<{ id: number; title: string; seconds: number }>
  monthly: Array<{ ym: string; added: number; readSeconds: number }>
  categories: Array<{ name: string; count: number }>
  statuses: Array<{ status: string; count: number }>
  words: Array<{ w: string; n: number }>
}

declare global {
  interface Window {
    api: {
      getSettings: () => Promise<Settings>
      saveSettings: (patch: Partial<Settings>) => Promise<Settings>
      pickLibrary: () => Promise<string | null>
      scanLibrary: (libPath?: string) => Promise<{ added: number; updated: number; total: number; indexing: boolean }>
      listPapers: () => Promise<Paper[]>
      listCategories: () => Promise<string[]>
      setStatus: (id: number, status: string) => Promise<void>
      readPdf: (p: string) => Promise<ArrayBuffer>
      indexStatus: () => Promise<{ papers: number; indexed: number; chunks: number; running: boolean }>
      rebuildIndex: () => Promise<boolean>
      startIndex: () => void
      pathForFile: (file: File) => string
      pickImport: () => Promise<string[]>
      importPapers: (items: Array<{ path: string; category?: string }>) => Promise<{ outcomes: ImportOutcome[]; scan: { added: number; updated: number; total: number } }>
      previewImport: (paths: string[]) => Promise<ImportPreviewItem[]>
      zoteroDetect: () => Promise<{ dataDir: string | null; candidates: string[] }>
      zoteroPickDir: () => Promise<string | null>
      zoteroPreview: (dataDir?: string) => Promise<ZoteroPreviewResult>
      zoteroImport: (items: Array<{ key: string; category?: string }>) => Promise<ZoteroOutcome[]>
      onZoteroProgress: (cb: (p: { done: number; total: number; current: string }) => void) => () => void
      onZoteroFile: (cb: (o: ZoteroOutcome) => void) => () => void
      recordsPickParse: () => Promise<{ file: string; entries: RecordEntry[] } | null>
      recordsImport: (entries: RecordEntry[], category: string) => Promise<RecordOutcome[]>
      onRecordsProgress: (cb: (p: { done: number; total: number; current: string }) => void) => () => void
      onRecordsFile: (cb: (o: RecordOutcome) => void) => () => void
      exportMobilePack: () => Promise<MobilePackResult | null>
      mergeMobileNotes: () => Promise<MobileMergeResult | null>
      onMobileProgress: (cb: (p: { done: number; total: number; current: string }) => void) => () => void
      onAppNotice: (cb: (p: { title: string; detail: string }) => void) => () => void
      deepSearch: (q: string) => Promise<DeepHit[]>
      summarizePaper: (id: number) => Promise<string>
      compareList: () => Promise<CompareTable[]>
      compareCreate: (title?: string) => Promise<CompareTable>
      compareDelete: (id: number) => Promise<boolean>
      compareSave: (id: number, data: CompareData) => Promise<CompareData>
      compareGenerate: (paperId: number, dimensions: string[]) => Promise<Record<string, CompareCell[]>>
      compareExport: (id: number, format: 'md' | 'csv') => Promise<void>
      paperDetail: (id: number) => Promise<PaperDetail | null>
      myNotesGet: (id: number) => Promise<string>
      myNotesSave: (id: number, text: string) => Promise<boolean>
      graphData: () => Promise<{ nodes: Array<{ id: number; title: string; category: string; year: number | null; degree: number }>; edges: Array<{ a: number; b: number; w: number }> }>
      appStatus: () => Promise<{ bridge: { running: boolean; port: number; version: string }; papers: number; categories: number; version: string; dataDir: string }>
      dataOpen: () => Promise<boolean | string>
      dataChangeDir: () => Promise<string | null>
      onPreviewFile: (cb: (p: ImportPreviewItem) => void) => () => void
      onPreviewProgress: (cb: (p: { done: number; total: number; current: string }) => void) => () => void
      addHighlight: (paperId: number, page: number, rects: HighlightRect[], text: string, color?: string) => Promise<number>
      listHighlights: (paperId: number) => Promise<Highlight[]>
      deleteHighlight: (id: number) => Promise<boolean>
      paperMenu: (id: number, x: number, y: number) => void
      categoryMenu: (cat: string, x: number, y: number) => void
      blankMenu: (x: number, y: number) => void
      renameCategory: (from: string, to: string) => Promise<{ renamed: string; scan: { added: number; updated: number; total: number } }>
      renamePaper: (id: number, title: string) => Promise<{ title: string }>
      movePaper: (id: number, category: string) => Promise<{ ok: boolean; category?: string; path?: string; moved?: boolean }>
      createCategory: (name: string) => Promise<{ name: string; dir: string }>
      deleteCategory: (name: string) => Promise<boolean>
      markOpened: (id: number) => void
      pickImportFolder: () => Promise<string | null>
      onCategoryRenameRequest: (cb: (cat: string) => void) => () => void
      onPapersRenameRequest: (cb: (p: { id: number; title: string }) => void) => () => void
      onCategoryCreateRequest: (cb: () => void) => () => void
      onMoveNewRequest: (cb: (p: { id: number; title: string }) => void) => () => void
      onPapersChanged: (cb: () => void) => () => void
      onImportRequest: (cb: () => void) => () => void
      onImportFile: (cb: (o: ImportOutcome) => void) => () => void
      testLLM: (over?: { apiBase?: string; apiKey?: string; model?: string; provider?: string }) => Promise<{ ok: boolean; model?: string; latencyMs?: number; balance?: { amount: string; currency: string } | null; quota?: string; error?: string }>
      testEmbed: () => Promise<{ ok: boolean; dim?: number; error?: string }>
      stream: (
        args: Record<string, unknown>,
        handlers: { onDelta: (t: string) => void; onEnd: () => void; onSources?: (s: SourceRef[]) => void }
      ) => void
      onIndexProgress: (cb: (p: { done: number; total: number; phase: string; current?: string }) => void) => () => void
      onImportProgress: (cb: (p: { done: number; total: number; current: string }) => void) => () => void
      openExternal: (url: string) => void
      syncTheme: (theme: string) => void
      // ---------- 标签系统（W1） ----------
      tagsList: () => Promise<TagRow[]>
      tagsCreate: (name: string, color?: string) => Promise<TagRow>
      tagsRename: (id: number, name: string) => Promise<void>
      tagsDelete: (id: number) => Promise<boolean>
      tagsSetColor: (id: number, color: string) => Promise<boolean>
      paperTagAdd: (id: number, name: string, color?: string) => Promise<TagRow>
      paperTagRemove: (id: number, tagId: number) => Promise<boolean>
      papersTagsOf: (id: number) => Promise<Array<{ id: number; name: string; color: string }>>
      // ---------- 阅读进度与时长（W2/W7） ----------
      paperLastPage: (id: number, page: number) => void
      paperReadTime: (id: number, seconds: number) => void
      // ---------- Translators（W13） ----------
      translatorsList: () => Promise<{ scripts: ScriptInfo[]; userDir: string }>
      translatorsMatch: (url: string) => Promise<{ id: string; name: string } | null>
      translatorsTranslate: (url: string) => Promise<{ ok: boolean; translator?: string; csl?: Record<string, unknown>; pdfPath?: string; error?: string }>
      translatorsSearch: (q: string) => Promise<Array<Record<string, unknown> & { translator?: string }>>
      translatorsImport: (payload: { csl: Record<string, unknown>; pdfPath?: string; category?: string; origin?: string }) => Promise<{ ok: boolean; slug?: string; error?: string }>
      translatorsSetDisabled: (ids: string[]) => Promise<boolean>
      translatorsReload: () => Promise<number>
      translatorsOpenDir: () => Promise<boolean>
      translatorsDetectInput: (text: string) => Promise<{ kind: string; doi?: string; id?: string; url?: string; q?: string }>
      // ---------- CSL 引文（W8） ----------
      cslStyles: () => Promise<StyleInfo[]>
      cslFormat: (ids: number[], styleId: string) => Promise<{ ok: boolean; items?: string[]; error?: string; style?: string }>
      cslDownloadStyle: (id: string) => Promise<{ ok: boolean; error?: string }>
      cslRemoveStyle: (id: string) => Promise<boolean>
      cslCatalogSearch: (q: string) => Promise<string[]>
      cslEngineStatus: () => Promise<{ downloaded: boolean; size?: number }>
      cslEngineDownload: () => Promise<{ ok: boolean; error?: string }>
      cslImportStyle: () => Promise<{ ok: boolean; id?: string; error?: string } | null>
      cslOpenDir: () => Promise<boolean>
      // ---------- 参考文献 / 被引 / 统计（W4/W6/W7） ----------
      refsList: (id: number) => Promise<{ ok: boolean; refs?: Array<{ title: string; authors?: string; year?: number | null; venue?: string; doi?: string; raw?: string }>; error?: string; cached?: boolean }>
      refsImport: (paperId: number, index: number, category?: string) => Promise<{ ok: boolean; slug?: string; error?: string }>
      citedUpdate: (ids: number[]) => Promise<{ updated: number; errors: number }>
      statsOverview: () => Promise<StatsOverview>
      venuesLookup: (name: string) => Promise<{ name?: string; if_val?: number; zone?: string } | null>
      venuesImportCsv: () => Promise<{ imported: number } | null>
    }
  }
}

export {}
