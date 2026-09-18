// 题录文本解析（纯函数，无依赖）：RIS / EndNote(.enw) / CNKI 自定义格式
// 从 records.ts 抽出，便于单独测试

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

const yearIn = (s?: string): number | null => parseInt(s?.match(/(19|20)\d{2}/)?.[0] ?? '', 10) || null

// ---------- RIS ----------
function parseRis(text: string): RecordEntry[] {
  const out: RecordEntry[] = []
  let cur: RecordEntry | null = null
  let lastTag = ''
  const end = (): void => {
    if (cur?.title) out.push(cur)
    cur = null
  }
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(/^([A-Z][A-Z0-9])  - ?(.*)$/)
    if (m) {
      const tag = m[1]
      const val = m[2].trim()
      if (tag === 'TY') {
        end()
        cur = { title: '', authors: '', year: null, venue: '' }
      } else if (cur) {
        lastTag = tag
        if (tag === 'TI' || tag === 'T1') cur.title = val
        else if (tag === 'AU' || tag === 'A1') cur.authors = cur.authors ? `${cur.authors}, ${val}` : val
        else if (tag === 'JO' || tag === 'JF' || tag === 'T2' || tag === 'JA') cur.venue ||= val
        else if (tag === 'PY' || tag === 'Y1') cur.year ||= yearIn(val)
        else if (tag === 'DO') cur.doi ||= val
        else if (tag === 'AB' || tag === 'N2') cur.abstract = val
      }
    } else if (cur && raw.startsWith('  ') && lastTag) {
      // 续行：拼到上一个字段的值后面（主要是摘要）
      if (lastTag === 'AB' || lastTag === 'N2') cur.abstract = `${cur.abstract ?? ''} ${raw.trim()}`.trim()
    }
  }
  end()
  return out
}

// ---------- EndNote .enw（CNKI「EndNote」导出）----------
function parseEnw(text: string): RecordEntry[] {
  const out: RecordEntry[] = []
  let cur: RecordEntry | null = null
  const end = (): void => {
    if (cur?.title) out.push(cur)
    cur = null
  }
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(/^%(\w)\s+(.*)$/)
    if (!m) continue
    const tag = m[1]
    const val = m[2].trim()
    if (tag === '0') {
      end()
      cur = { title: '', authors: '', year: null, venue: '' }
    } else if (cur) {
      if (tag === 'T') cur.title ||= val
      else if (tag === 'A') cur.authors = cur.authors ? `${cur.authors}, ${val}` : val
      else if (tag === 'J' || tag === 'B') cur.venue ||= val
      else if (tag === 'D') cur.year ||= yearIn(val)
      else if (tag === 'R') cur.doi ||= val
      else if (tag === 'X') cur.abstract = `${cur.abstract ?? ''} ${val}`.trim()
    }
  }
  end()
  return out
}

// ---------- 通用中文块（CNKI「自定义/文献格式」等）：空行分块、键: 值 ----------
function parseGeneric(text: string): RecordEntry[] {
  const keyMap: Array<[RegExp, keyof RecordEntry]> = [
    [/^(题名|标题|title)$/i, 'title'],
    [/^(作者|author)$/i, 'authors'],
    [/^(年|年份|year|date)$/i, 'year'],
    [/^(来源|期刊|刊名|文献来源|source|journal)$/i, 'venue'],
    [/^doi$/i, 'doi'],
    [/^(摘要|abstract)$/i, 'abstract']
  ]
  const out: RecordEntry[] = []
  for (const block of text.split(/\n\s*\n/)) {
    const rec: RecordEntry = { title: '', authors: '', year: null, venue: '' }
    for (const line of block.split(/\r?\n/)) {
      const m = line.match(/^\s*([^:：]{1,12})[:：]\s*(.+)$/)
      if (!m) continue
      const key = m[1].trim()
      const val = m[2].trim()
      for (const [re, field] of keyMap) {
        if (re.test(key)) {
          if (field === 'year') rec.year ||= yearIn(val)
          else if (field === 'authors') rec.authors = rec.authors ? `${rec.authors}; ${val}` : val
          else if (field === 'title') rec.title ||= val
          else if (field === 'venue') rec.venue ||= val
          else if (field === 'doi') rec.doi ||= val
          else if (field === 'abstract') rec.abstract = `${rec.abstract ?? ''} ${val}`.trim()
          break
        }
      }
    }
    if (rec.title) out.push(rec)
  }
  return out
}

export function parseRecords(text: string): RecordEntry[] {
  if (/^TY {1,2}- /m.test(text)) return parseRis(text)
  if (/%\w\s/.test(text) && /%0 /.test(text)) return parseEnw(text)
  const generic = parseGeneric(text)
  if (generic.length > 0) return generic
  return parseRis(text) // 兜底再试一次宽松 RIS
}

