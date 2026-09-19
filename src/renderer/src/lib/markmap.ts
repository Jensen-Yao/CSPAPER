/**
 * markmap 导出工具（无框架单文件）：
 * 把 markdown 文本生成为「自包含 HTML」（markmap-autoloader 从 CDN 加载渲染器，
 * 打开文件即得可交互思维导图），并触发浏览器下载。
 */

// HTML 转义：markdown 里的 <>& 不能原样进入 template 脚本，否则会破坏 HTML 结构
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// 下载文件名里的 Windows 非法字符替换为下划线
function safeFileName(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '_').trim() || 'untitled'
}

/**
 * 生成自包含 HTML 并下载为 `${title}-思维导图.html`。
 * 双击/浏览器打开后，markmap-autoloader 会读取 <script type="text/template">
 * 里的 markdown 并渲染成可折叠、可缩放的思维导图（需联网加载 CDN）。
 */
export async function saveMarkmapHtml(title: string, markdown: string): Promise<void> {
  // 先做 HTML 转义；再额外把可能残留的 `</script` 字样打散，
  // 双保险防止 markdown 内容提前闭合模板脚本标签（转义后理论上已不存在）
  const safe = escapeHtml(markdown).replace(/<\/script/gi, '<\\/script')
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  html, body { margin: 0; padding: 0; height: 100%; }
  #app { width: 100%; height: 100vh; }
</style>
<script src="https://cdn.jsdelivr.net/npm/markmap-autoloader@0.18"></script>
</head>
<body>
<div id="app">
  <div class="markmap" style="width:100%;height:100vh">
    <script type="text/template">
${safe}
    </script>
  </div>
</div>
</body>
</html>`

  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
  a.download = `${safeFileName(title)}-思维导图.html`
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
}
