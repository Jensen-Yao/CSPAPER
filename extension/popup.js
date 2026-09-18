// CSPAPER Connector 弹窗：识别当前页（arXiv / 带 citation_* 元数据的期刊页 / CNKI / PDF 直链）→ 补全题录 → 保存
const DEFAULT_PORT = 24517
let PDF_URL = ''
let PAGE_URL = ''

const $ = (id) => document.getElementById(id)

async function getPort() {
  const s = await chrome.storage.local.get('port')
  return parseInt(s.port, 10) || DEFAULT_PORT
}

function resolvePdfUrl(url) {
  const u = (url || '').trim()
  const arxiv = u.match(/arxiv\.org\/(?:abs|pdf)\/([^\s?#]+?)(?:\.pdf)?(?:[?#].*)?$/i)
  if (arxiv) return `https://arxiv.org/pdf/${arxiv[1]}.pdf`
  return /\.pdf(\?|#|$)/i.test(u) ? u : ''
}

// 在页面里提取 citation_* 元数据（arXiv、Nature/Elsevier/Springer、CNKI kcms2 等大多带）
function extractMetaInPage() {
  const meta = (n) => document.querySelector(`meta[name="${n}"]`)?.content || ''
  const authors = [...document.querySelectorAll('meta[name="citation_author"], meta[name="dc.Creator"], meta[name="author"]')]
    .map((m) => m.content.trim())
    .filter(Boolean)
  let year = meta('citation_publication_date') || meta('citation_date') || meta('dc.Date')
  year = (year.match(/(19|20)\d{2}/) || [''])[0]
  return {
    title: meta('citation_title') || meta('dc.Title') || document.title.replace(/(-|–\s*)?(arXiv|Nature|ScienceDirect|中国知网).*$/, '').trim(),
    authors: authors.join(', '),
    venue: meta('citation_journal_title') || meta('citation_conference_title') || meta('dc.Publisher') || '',
    year,
    doi: meta('citation_doi') || meta('dc.DOI') || ''
  }
}

async function detect() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.url) return $('detected').textContent = '无法读取当前页面'
  PAGE_URL = tab.url
  PDF_URL = resolvePdfUrl(PAGE_URL)

  let meta = { title: tab.title ?? '', authors: '', venue: '', year: '', doi: '' }
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractMetaInPage })
    if (r?.result) meta = { ...meta, ...r.result, title: r.result.title || meta.title }
  } catch {
    /* 受限页面（商店/登录页）读不到，用 tab.title 兜底 */
  }

  $('title').value = meta.title || ''
  $('authors').value = meta.authors || ''
  $('venue').value = meta.venue || ''
  $('year').value = meta.year || ''
  const kind = PAGE_URL.includes('arxiv.org')
    ? 'arXiv 页面'
    : /cnki\.(net|com)/i.test(PAGE_URL)
      ? 'CNKI 页面'
      : /\.pdf(\?|#|$)/i.test(PAGE_URL)
        ? 'PDF 直链'
        : '普通网页'
  $('detected').textContent = `识别为：${kind}`
  $('pdfrow').innerHTML = PDF_URL
    ? '<span class="pdfyes">● 已找到 PDF 下载地址，保存后自动下载入库</span>'
    : '<span class="pdfno">● 此页面没有可直接下载的 PDF：请从数据库下载 PDF 后拖入 CSPAPER（题录可先复制）</span>'
  $('save').disabled = false
}

async function checkBridge() {
  const port = await getPort()
  $('port').value = String(port)
  try {
    const r = await fetch(`http://127.0.0.1:${port}/ping`)
    const data = await r.json()
    $('status').textContent = '已连接'
    $('status').className = 'status on'
    $('status').title = `CSPAPER ${data.version} · 库内 ${data.papers} 篇`
    return true
  } catch {
    $('status').textContent = '桌面端未运行'
    $('status').className = 'status off'
    $('save').disabled = true
    return false
  }
}

$('port').addEventListener('change', async (e) => {
  await chrome.storage.local.set({ port: parseInt(e.target.value, 10) || DEFAULT_PORT })
  await checkBridge()
})

$('save').addEventListener('click', async () => {
  $('save').disabled = true
  $('msg').className = 'msg'
  $('msg').textContent = '正在保存…'
  const port = await getPort()
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/save-paper`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pdfUrl: PDF_URL,
        title: $('title').value.trim(),
        authors: $('authors').value.trim(),
        venue: $('venue').value.trim(),
        year: parseInt($('year').value, 10) || null,
        source: PAGE_URL
      })
    })
    const data = await resp.json().catch(() => ({ ok: false, error: `HTTP ${resp.status}` }))
    if (data.ok) {
      $('msg').className = 'msg ok'
      $('msg').textContent = '✓ 已保存：PDF 正在后台下载入库，切回 CSPAPER 即可看到'
    } else {
      $('msg').className = 'msg err'
      $('msg').textContent = data.error || '保存失败'
    }
  } catch {
    $('msg').className = 'msg err'
    $('msg').textContent = '连不上 CSPAPER 桌面端，请确认它正在运行'
  }
  $('save').disabled = false
})

void (async () => {
  const ok = await checkBridge()
  if (ok) await detect()
  else $('detected').textContent = '启动 CSPAPER 桌面端后重新打开本插件'
})()
