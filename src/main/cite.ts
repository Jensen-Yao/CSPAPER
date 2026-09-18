// 引文格式化：GB/T 7714-2015（中文论文写作国标）与 BibTeX
// 元数据只有 标题/作者/年份/期刊，能生成核心字段完整的引用；文献类型按期刊[J]/会议[C]/其他[J]兜底
export interface CiteRecord {
  id?: number
  title: string
  authors: string
  year: number | null
  venue: string
  itemType?: string // journalArticle | conferencePaper | thesis | book | ...
}

function splitAuthors(authors: string): string[] {
  return authors
    .split(/[,;，；]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

const hasCJK = (s: string): boolean => /[\u4e00-\u9fff]/.test(s)

// 西方作者 "Given Surname" → "Surname G"；中文名原样
function gbtAuthor(name: string): string {
  if (hasCJK(name)) return name
  const parts = name.split(/\s+/)
  if (parts.length < 2) return name
  const surname = parts[parts.length - 1]
  const initials = parts
    .slice(0, -1)
    .map((p) => `${p[0].toUpperCase()}.`)
    .join(' ')
  return `${surname} ${initials}`
}

function fmtAuthors(authors: string): string {
  const list = splitAuthors(authors).map(gbtAuthor)
  if (list.length === 0) return ''
  const cjk = hasCJK(authors)
  if (list.length > 3) return `${list.slice(0, 3).join(', ')}, ${cjk ? '等' : 'et al'}.`
  return `${list.join(', ')}.`
}

// GB/T 7714-2015 顺序编码制：[1] 作者. 题名[J]. 刊名, 年份.
export function gbt7714(rec: CiteRecord, index: number): string {
  const type = rec.itemType === 'conferencePaper' ? '[C]' : rec.itemType === 'thesis' ? '[D]' : rec.itemType === 'book' ? '[M]' : '[J]'
  const authors = fmtAuthors(rec.authors)
  const head = `[${index}] ${authors}${authors ? ' ' : ''}`.replace(/\.$/, '')
  const venue = rec.venue ? `${rec.venue}, ` : ''
  return `${head}${authors ? '. ' : ''}${rec.title}${type}. ${venue}${rec.year ?? ''}.`.replace(/\s+\./g, '.')
}

export function bibtexKey(rec: CiteRecord): string {
  const first = splitAuthors(rec.authors)[0] ?? 'unknown'
  const surname = hasCJK(first) ? first : first.split(/\s+/).pop() ?? 'unknown'
  const slugWord = rec.title.match(/[\p{L}\p{N}]+/gu)?.[0] ?? 'paper'
  return `${surname.toLowerCase()}${rec.year ?? ''}${slugWord.toLowerCase()}`
}

export function bibtex(rec: CiteRecord): string {
  const cjk = hasCJK(rec.title)
  const type = rec.itemType === 'book' ? 'book' : rec.itemType === 'thesis' ? 'phdthesis' : rec.itemType === 'conferencePaper' ? 'inproceedings' : 'article'
  const fields = [
    `  title = {${rec.title}}`,
    rec.authors ? `  author = {${rec.authors}}` : '',
    `  journal = {${rec.venue || ''}}`,
    rec.year ? `  year = {${rec.year}}` : ''
  ].filter(Boolean)
  return `@${type}{${bibtexKey(rec)},\n${fields.join(',\n')}${cjk ? '' : ''}\n}`
}
