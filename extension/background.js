// CSPAPER Connector 后台：右键菜单「保存到 CSPAPER」+ 通知反馈
// 与桌面端本地桥接服务（127.0.0.1:24517）通信，PDF 由桌面端下载与入库
const DEFAULT_PORT = 24517

async function getPort() {
  const s = await chrome.storage.local.get('port')
  return parseInt(s.port, 10) || DEFAULT_PORT
}

function bridgeUrl(path, port) {
  return `http://127.0.0.1:${port}${path}`
}

async function notify(title, message) {
  try {
    await chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title,
      message
    })
  } catch {
    /* 通知失败静默 */
  }
}

// arXiv 阅读页 → PDF 直链；.pdf 链接原样
function resolvePdfUrl(url) {
  const u = url.trim()
  const arxiv = u.match(/arxiv\.org\/(?:abs|pdf)\/([^\s?#]+?)(?:\.pdf)?(?:[?#].*)?$/i)
  if (arxiv) return `https://arxiv.org/pdf/${arxiv[1]}.pdf`
  return /\.pdf(\?|#|$)/i.test(u) ? u : ''
}

async function savePaper(payload) {
  const port = await getPort()
  try {
    const resp = await fetch(bridgeUrl('/save-paper', port), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    const data = await resp.json().catch(() => ({ ok, error: `HTTP ${resp.status}` }))
    return data
  } catch {
    return { ok, error: '连不上 CSPAPER 桌面端：请确认它正在运行（端口 ' + port + '）' }
  }
}

// 右键菜单：普通页面 / 链接（PDF 直链优先）
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'cspaper-save-page',
      title: '保存此页面文献到 CSPAPER',
      contexts: ['page']
    })
    chrome.contextMenus.create({
      id: 'cspaper-save-link',
      title: '把链接 PDF 保存到 CSPAPER',
      contexts: ['link']
    })
  })
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'cspaper-save-link' && info.srcUrl) {
    void savePaper({ pdfUrl: info.srcUrl, title: '', source: tab?.url ?? '' }).then((r) =>
      notify(r.ok ? '已保存到 CSPAPER' : '保存失败', r.ok ? `PDF 已入库（未分类）` : r.error ?? '')
    )
  } else if (info.menuItemId === 'cspaper-save-page' && tab) {
    void savePaper({ pdfUrl: resolvePdfUrl(tab.url ?? ''), title: tab.title ?? '', source: tab.url ?? '' }).then((r) =>
      notify(r.ok ? '已保存到 CSPAPER' : '保存失败', r.ok ? `正在下载 PDF 并入库…` : r.error ?? '')
    )
  }
})
