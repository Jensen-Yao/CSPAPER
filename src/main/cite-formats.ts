// 内置引文格式引擎（W8）：12 种常用样式的原创实现，直接消费 CSL 字段模型。
// 这些是独立实现（非 CSL 处理器），覆盖中文学术场景最常用的样式，零外部依赖、零许可证负担。
// 需要「万种 CSL 样式」时走可选引擎（csl.ts，用户触发下载外部 citeproc 组件）。
// 与 cite.ts（GB/T 7714 + BibTeX bridge 导出）互补：本文件是统一样式注册表。

export interface CiteItem {
  id?: number | string
  type?: string // article-journal / paper-conference / thesis / book ...
  title: string
  authors: string // 显示串："张三, 李四, John Smith"
  year: number | null
  venue: string
  doi?: string
  url?: string
  volume?: string
  issue?: string
  pages?: string
  publisher?: string
}

export interface StyleInfo {
  id: string
  name: string
  kind: 'builtin'
  numeric: boolean // 输出列表是否默认编号
  note?: string
}

export const BUILTIN_STYLES: StyleInfo[] = [
  { id: 'gbt7714-num', name: 'GB/T 7714-2015（顺序编码制）', kind: 'builtin', numeric: true, note: '中文论文投稿国标' },
  { id: 'gbt7714-ad', name: 'GB/T 7714-2015（著者-出版年制）', kind: 'builtin', numeric: false, note: '中文论文投稿国标' },
  { id: 'apa', name: 'APA 7th', kind: 'builtin', numeric: false },
  { id: 'mla', name: 'MLA 9th', kind: 'builtin', numeric: false },
  { id: 'chicago-ad', name: 'Chicago（著者-出版年）', kind: 'builtin', numeric: false },
  { id: 'ieee', name: 'IEEE', kind: 'builtin', numeric: true },
  { id: 'vancouver', name: 'Vancouver', kind: 'builtin', numeric: true },
  { id: 'nature', name: 'Nature', kind: 'builtin', numeric: true },
  { id: 'science', name: 'Science', kind: 'builtin', numeric: true },
  { id: 'cell', name: 'Cell', kind: 'builtin', numeric: true },
  { id: 'harvard', name: 'Harvard', kind: 'builtin', numeric: false },
  { id: 'elsevier-num', name: 'Elsevier（数字编号）', kind: 'builtin', numeric: true }
]

const hasCJK = (s: string): boolean => /[\u4e00-\u9fff]/.test(s)

export function splitAuthorNames(authors: string): string[] {
  return authors
    .split(/[,;，；]/)
    .map((s) => s.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
}

// "John Smith" → { family: 'Smith', initials: 'J.' }；中文名原样
function westernize(name: string): { family: string; initials: string; literal: string } {
  if (hasCJK(name)) return { family: name, initials: '', literal: name }
  const parts = name.split(/\s+/)
  if (parts.length < 2) return { family: name, initials: '', literal: name }
  const family = parts[parts.length - 1]
  const initials = parts
    .slice(0, -1)
    .map((p) => `${p[0].toUpperCase()}.`)
    .join(' ')
  return { family, initials, literal: name }
}

// 全名集合 → "Surname I." 序列（GB/T 7714 / Vancouver 风格）
function initialsList(authors: string, max = 3, sep = ', '): string {
  const list = splitAuthorNames(authors).map((n) => {
    const w = westernize(n)
    return w.literal === w.family ? w.family : `${w.family} ${w.initials}`
  })
  const etAl = hasCJK(authors) ? '等' : 'et al.'
  if (list.length > max) return `${list.slice(0, max).join(sep)}, ${etAl}`
  return list.join(sep)
}

// APA / Harvard 风格："Smith, J. A." 全 фамилия + 名缩写
function surnameInitials(authors: string, max = 20): string {
  const list = splitAuthorNames(authors).map((n) => {
    const w = westernize(n)
    if (w.literal === w.family) return w.family
    return `${w.family}, ${w.initials.replace(/\./g, '').split(' ').filter(Boolean).map((c) => c + '.').join(' ')}`
  })
  if (list.length === 0) return ''
  if (list.length === 1) return list[0]
  if (list.length <= max) return `${list.slice(0, -1).join(', ')}, & ${list[list.length - 1]}`
  return `${list.slice(0, max).join(', ')}, et al.`
}

// MLA 风格："Smith, John, and Alice Carter"；倒序仅第一作者
function mlaAuthors(authors: string): string {
  const names = splitAuthorNames(authors)
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]
  const w0 = westernize(names[0])
  const first = w0.literal === w0.family ? w0.family : `${w0.family}, ${w0.literal.replace(new RegExp('^' + w0.family + '\\s*'), '')}`
  if (names.length === 2) return `${first}, and ${names[1]}`
  return `${first}, et al.`
}

function chicagoAuthors(authors: string): string {
  const names = splitAuthorNames(authors)
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]
  const w0 = westernize(names[0])
  const first = w0.literal === w0.family ? w0.family : `${w0.family}, ${w0.literal.replace(new RegExp('^' + w0.family + '\\s*'), '')}`
  if (names.length <= 10) return `${first}, and ${names.slice(1).join(', ')}`
  return `${first}, et al.`
}

// Nature/Science/Cell 风格："J. Smith" 缩写名在前
function shortFirstAuthors(authors: string, ampersand = false): string {
  const list = splitAuthorNames(authors).map((n) => {
    const w = westernize(n)
    if (w.literal === w.family) return w.family
    return `${w.initials} ${w.family}`
  })
  const tail = ampersand ? ' & ' : ' and '
  if (list.length > 6) return `${list.slice(0, 6).join(', ')} ${ampersand ? '&' : 'and'} others`
  return list.join(tail)
}

const yearOf = (it: CiteItem): string => (it.year && Number.isFinite(it.year) ? String(it.year) : 'n.d.')
const venueOf = (it: CiteItem): string => it.venue || ''
const doiOr = (it: CiteItem): string => (it.doi ? `https://doi.org/${it.doi}` : it.url || '')

// CSL type → 参考文献类型标识（GB/T 7714）
function gbtType(it: CiteItem): string {
  const t = it.type ?? ''
  if (t.includes('conference') || t === 'paper-conference') return 'C'
  if (t === 'thesis') return 'D'
  if (t === 'book' || t === 'chapter') return 'M'
  if (t === 'report') return 'R'
  if (t === 'standard') return 'S'
  if (t === 'patent') return 'P'
  if (t === 'article' || t === 'preprint') return 'J/OL'
  return 'J'
}

const volIssue = (it: CiteItem): string => {
  const v = it.volume ?? ''
  const i = it.issue ?? ''
  if (v && i) return `${v}(${i})`
  if (v) return v
  if (i) return `(${i})`
  return ''
}

export function formatBuiltin(styleId: string, items: CiteItem[]): string[] {
  return items.map((it) => FORMAT_MAP[styleId](it))
}

const FORMAT_MAP: Record<string, (it: CiteItem) => string> = {
  // GB/T 7714 顺序编码制：张三, 李四, Wang X Y, 等. 标题[J]. 刊名, 2024, 15(2): 34-40.
  'gbt7714-num': (it) => {
    const a = initialsList(it.authors, 3)
    const t = `${a}. ${it.title}[${gbtType(it)}].`
    const where = venueOf(it)
    const vi = volIssue(it)
    const body = where ? `${where}, ${yearOf(it)}${vi ? `, ${vi}` : ''}${it.pages ? `: ${it.pages}` : ''}.` : `${yearOf(it)}.`
    return `${t} ${body}${doiOr(it) && gbtType(it).includes('OL') ? ` ${doiOr(it)}.` : ''}`
  },
  // GB/T 7714 著者-出版年制：张三, 李四, 2024. 标题[J]. 刊名, 15(2): 34-40.
  'gbt7714-ad': (it) => {
    const a = initialsList(it.authors, 3)
    const where = venueOf(it)
    const vi = volIssue(it)
    return `${a}, ${yearOf(it)}. ${it.title}[${gbtType(it)}]. ${where ? `${where}${vi ? `, ${vi}` : ''}${it.pages ? `: ${it.pages}` : ''}.` : ''}`
  },
  // APA 7：Smith, J. A., & Carter, B. (2024). Title. Journal, 15(2), 34–40. https://doi.org/...
  apa: (it) => {
    const where = venueOf(it)
    const vi = volIssue(it)
    const loc = `${where ? `${where}${vi ? `, ${vi}` : ''}` : ''}${it.pages ? `, ${it.pages.replace(/[-–]/, '–')}` : ''}`
    return `${surnameInitials(it.authors)} (${yearOf(it)}). ${it.title}.${loc ? ` ${loc}.` : ''}${doiOr(it) ? ` ${doiOr(it)}` : ''}`
  },
  // MLA 9：Smith, John, and Alice Carter. "Title." Journal, vol. 15, no. 2, 2024, pp. 34-40.
  mla: (it) => {
    const where = venueOf(it)
    const bits: string[] = []
    if (where) bits.push(`${where},`)
    if (it.volume) bits.push(`vol. ${it.volume},`)
    if (it.issue) bits.push(`no. ${it.issue},`)
    bits.push(`${yearOf(it)},`)
    if (it.pages) bits.push(`pp. ${it.pages}.`)
    return `${mlaAuthors(it.authors)}. "${it.title}." ${bits.join(' ')}`
  },
  // Chicago 著者-出版年：Smith, John, and Alice Carter. "Title." Journal 15, no. 2 (2024): 34-40.
  'chicago-ad': (it) => {
    const where = venueOf(it)
    const vi = volIssue(it)
    return `${chicagoAuthors(it.authors)}. "${it.title}." ${where}${vi ? ` ${vi}` : ''} (${yearOf(it)})${it.pages ? `: ${it.pages}` : ''}.${doiOr(it) ? ` ${doiOr(it)}.` : ''}`
  },
  // IEEE：J. Smith and A. B. Carter, "Title," Journal, vol. 15, no. 2, pp. 34-40, 2024.
  ieee: (it) => {
    const a = initialsList(it.authors, 6, ' and ')
    return `${a ? a + ', ' : ''}"${it.title}," ${venueOf(it)}${it.volume ? `, vol. ${it.volume}` : ''}${it.issue ? `, no. ${it.issue}` : ''}${it.pages ? `, pp. ${it.pages}` : ''}, ${yearOf(it)}.${it.doi ? ` doi: ${it.doi}.` : ''}`
  },
  // Vancouver：Smith J, Carter AB. Title. Journal. 2024;15(2):34-40.
  vancouver: (it) => {
    const a = splitAuthorNames(it.authors)
      .slice(0, 6)
      .map((n) => {
        const w = westernize(n)
        return w.literal === w.family ? w.family : `${w.family} ${w.initials.replace(/\./g, '').split(' ').filter(Boolean).join('')}`
      })
      .join(', ')
    const vi = volIssue(it)
    return `${a}. ${it.title}. ${venueOf(it)}. ${yearOf(it)}${vi ? `;${vi}` : ''}${it.pages ? `:${it.pages}` : ''}.`
  },
  // Nature：Smith, J. & Carter, A. B. Title. Journal 15, 34-40 (2024).
  nature: (it) => {
    const a = splitAuthorNames(it.authors)
      .map((n) => {
        const w = westernize(n)
        return w.literal === w.family ? w.family : `${w.initials} ${w.family}`
      })
      .join(' & ')
    return `${a}. ${it.title}. ${venueOf(it)}${it.volume ? ` ${it.volume}` : ''}${it.pages ? `, ${it.pages}` : ''} (${yearOf(it)}).`
  },
  // Science：J. Smith, A. B. Carter, Title. Journal 15, 34-40 (2024).
  science: (it) => `${shortFirstAuthors(it.authors)}, ${it.title}. ${venueOf(it)}${it.volume ? ` ${it.volume}` : ''}${it.pages ? `, ${it.pages}` : ''} (${yearOf(it)}).`,
  // Cell：Smith J. and Carter A.B., Title. Journal 15, 34-40 (2024).
  cell: (it) => `${shortFirstAuthors(it.authors, true)}, ${it.title}. ${venueOf(it)}${it.volume ? ` ${it.volume}` : ''}${it.pages ? `, ${it.pages}` : ''} (${yearOf(it)}).`,
  // Harvard：Smith, J.A. and Carter, B. (2024) 'Title', Journal, 15(2), pp. 34-40.
  harvard: (it) => {
    const a = splitAuthorNames(it.authors)
      .map((n) => {
        const w = westernize(n)
        if (w.literal === w.family) return w.family
        return `${w.family}, ${w.initials.replace(/\./g, '')}`
      })
      .join(' and ')
    const vi = volIssue(it)
    return `${a} (${yearOf(it)}) '${it.title}', ${venueOf(it)}${vi ? `, ${vi}` : ''}${it.pages ? `, pp. ${it.pages}` : ''}.`
  },
  // Elsevier 数字编号：[1] J. Smith, A.B. Carter, Title, Journal 15 (2024) 34-40.
  'elsevier-num': (it) => `${shortFirstAuthors(it.authors)}, ${it.title}, ${venueOf(it)}${it.volume ? ` ${it.volume}` : ''} (${yearOf(it)})${it.pages ? ` ${it.pages}` : ''}.`
}

export const isNumericStyle = (styleId: string): boolean => BUILTIN_STYLES.find((s) => s.id === styleId)?.numeric ?? false
