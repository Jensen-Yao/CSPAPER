// 引文助手页面：桥接服务内嵌的 Web UI（http://127.0.0.1:24517/cite-ui）
// 浏览器打开 → 搜索文献库 → 勾选 → 生成 GB/T 7714 参考文献列表 → 复制进 Word / WPS。
// 这是 Word/WPS 插件的通用兜底：任何编辑器都能用，无需安装加载项。
export const CITE_UI_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>CSPAPER 引文助手 — GB/T 7714</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Microsoft YaHei", system-ui, sans-serif; background: #f6f4f1; color: #24242a; }
  .wrap { max-width: 860px; margin: 0 auto; padding: 34px 20px 60px; }
  header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 6px; }
  h1 { font-size: 21px; margin: 0; }
  header span { color: #98122e; font-size: 12.5px; letter-spacing: 3px; font-weight: 600; }
  .sub { color: #8a857d; font-size: 13px; margin-bottom: 22px; }
  .search { display: flex; gap: 8px; margin-bottom: 16px; }
  .search input { flex: 1; border: 1px solid #ddd8d2; border-radius: 10px; padding: 11px 14px; font-size: 14px; background: #fff; }
  .list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 22px; }
  .row { display: flex; align-items: center; gap: 10px; background: #fff; border: 1px solid #e8e5e2; border-radius: 10px; padding: 10px 14px; cursor: pointer; }
  .row:hover { border-color: #c9c3bb; }
  .row.on { border-color: #1558c0; box-shadow: 0 0 0 1px #1558c0; }
  .row input { accent-color: #1558c0; }
  .row .t { flex: 1; font-size: 13.5px; }
  .row .m { color: #8a857d; font-size: 12px; }
  .actions { display: flex; gap: 10px; align-items: center; }
  button { border: 0; border-radius: 10px; padding: 11px 20px; font-size: 14px; font-weight: 600; cursor: pointer; }
  .primary { background: #1558c0; color: #fff; }
  .ghost { background: #fff; border: 1px solid #ddd8d2 !important; color: #24242a; }
  .count { color: #8a857d; font-size: 13px; margin-left: auto; }
  pre { margin-top: 20px; background: #fff; border: 1px solid #e8e5e2; border-radius: 12px; padding: 20px 22px;
        font-size: 13.5px; line-height: 2; white-space: pre-wrap; font-family: "Microsoft YaHei", sans-serif; min-height: 60px; }
  .copied { color: #1c7a2e; font-size: 13px; display: none; }
</style>
</head>
<body>
<div class="wrap">
  <header><h1>引文助手</h1><span id="stylecount">万种样式</span></header>
  <div class="sub">搜索本机 CSPAPER 文献库 → 勾选 → 选样式 → 生成参考文献列表 → 复制粘贴进 Word / WPS。内置 12 种常用样式，更多样式在 CSPAPER 设置 → 引文样式 里下载（官方 CSL 库共 10000+）。</div>
  <div class="search"><input id="q" placeholder="搜索标题 / 作者 / 期刊…（回车搜索，直接点搜索显示最近阅读）"><button class="ghost" id="go">搜索</button></div>
  <div class="list" id="list"></div>
  <div class="actions">
    <select id="style" style="border:1px solid #ddd8d2;border-radius:10px;padding:10px 12px;font-size:13.5px;background:#fff;color:#24242a;max-width:280px">
      <option value="gbt7714-num">GB/T 7714-2015（顺序编码制）</option>
      <option value="gbt7714-ad">GB/T 7714-2015（著者-出版年制）</option>
      <option value="apa">APA 7th</option>
      <option value="ieee">IEEE</option>
    </select>
    <button class="primary" id="gen">生成参考文献列表</button>
    <button class="ghost" id="copy">复制</button>
    <span class="copied" id="copied">✓ 已复制，去 Word / WPS 里粘贴即可</span>
    <span class="count" id="count">已选 0 篇</span>
  </div>
  <pre id="out">（生成的参考文献会显示在这里）</pre>
</div>
<script>
const q = document.getElementById('q'), list = document.getElementById('list'),
      out = document.getElementById('out'), count = document.getElementById('count'),
      copied = document.getElementById('copied');
const picked = new Map();

function render(rows) {
  list.innerHTML = '';
  for (const r of rows) {
    const row = document.createElement('div');
    row.className = 'row' + (picked.has(r.id) ? ' on' : '');
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = picked.has(r.id);
    cb.onchange = () => { picked.has(r.id) ? picked.delete(r.id) : picked.set(r.id, r); row.classList.toggle('on'); count.textContent = '已选 ' + picked.size + ' 篇'; };
    const t = document.createElement('span');
    t.className = 't'; t.textContent = r.title;
    const m = document.createElement('span');
    m.className = 'm'; m.textContent = [r.authors.split(',')[0], r.year].filter(Boolean).join(' · ');
    row.append(cb, t, m); list.append(row);
  }
  if (!rows.length) list.innerHTML = '<div class="row"><span class="m">没有匹配的文献</span></div>';
}

async function search() {
  const r = await fetch('/papers?q=' + encodeURIComponent(q.value.trim()));
  const data = await r.json();
  render(data.papers || []);
}
document.getElementById('go').onclick = search;
q.addEventListener('keydown', e => { if (e.key === 'Enter') search(); });
search();

// 样式下拉：从桥接服务拉取全部可用样式（内置 12 种 + 已装 CSL 样式，万种可选）
async function fillStyles() {
  const sel = document.getElementById('style');
  if (!sel) return;
  try {
    const r = await fetch('/styles');
    const data = await r.json();
    if (data.ok && data.styles?.length) {
      sel.innerHTML = '';
      for (const s of data.styles) {
        const o = document.createElement('option');
        o.value = s.id; o.textContent = s.name;
        sel.append(o);
      }
    }
  } catch (e) { /* 保底用静态选项 */ }
}
fillStyles();

document.getElementById('gen').onclick = async () => {
  copied.style.display = 'none';
  const ids = [...picked.keys()].join(',');
  if (!ids) { out.textContent = '（先勾选文献再生成）'; return; }
  const style = document.getElementById('style')?.value || 'gbt7714-num';
  const r = await fetch('/cite?ids=' + ids + '&style=' + encodeURIComponent(style));
  const data = await r.json();
  out.textContent = data.ok ? data.text : ('生成失败：' + (data.error || '未知错误'));
};
document.getElementById('copy').onclick = async () => {
  await navigator.clipboard.writeText(out.textContent);
  copied.style.display = 'inline';
  setTimeout(() => copied.style.display = 'none', 2500);
};
</script>
</body>
</html>`

// Word 加载项任务窗格：由桥接服务托管（/word-taskpane），与 /papers、/cite 同源，免跨域配置。
// Word 里「插入 → 获取加载项 → 上传我的加载项」选择 word-addon/manifest.xml 即可使用。
export const WORD_TASKPANE_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<script src="https://appsforoffice.microsoft.com/lib/1/hosted/office.js"></script>
<style>
  body { margin: 0; font-family: "Microsoft YaHei", system-ui, sans-serif; color: #24242a; background: #faf9f7; }
  .wrap { padding: 14px; }
  h1 { font-size: 15px; margin: 0 0 2px; }
  .sub { color: #8a857d; font-size: 11.5px; margin-bottom: 12px; }
  .search { display: flex; gap: 6px; margin-bottom: 10px; }
  .search input { flex: 1; border: 1px solid #ddd8d2; border-radius: 8px; padding: 8px 10px; font-size: 12.5px; }
  .search button { border: 0; border-radius: 8px; background: #1558c0; color: #fff; padding: 0 14px; font-size: 12.5px; cursor: pointer; }
  .list { display: flex; flex-direction: column; gap: 5px; margin-bottom: 12px; max-height: 300px; overflow: auto; }
  .row { display: flex; gap: 8px; align-items: center; background: #fff; border: 1px solid #e8e5e2; border-radius: 8px; padding: 7px 9px; font-size: 12px; }
  .row input { accent-color: #1558c0; }
  .row .t { flex: 1; line-height: 1.4; }
  .row .m { color: #8a857d; font-size: 11px; white-space: nowrap; }
  button.act { border: 0; border-radius: 8px; padding: 9px 12px; font-size: 12.5px; font-weight: 600; cursor: pointer; width: 100%; margin-bottom: 6px; }
  .primary { background: #1558c0; color: #fff; }
  .ghost { background: #fff; border: 1px solid #ddd8d2; color: #24242a; }
  #msg { font-size: 11.5px; color: #1c7a2e; min-height: 15px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>CSPAPER 引文</h1>
  <div class="sub">搜索文献库，在光标处插入引用</div>
  <div class="search"><input id="q" placeholder="标题 / 作者 / 期刊"><button id="go">搜索</button></div>
  <div class="list" id="list"></div>
  <select id="style" style="border:1px solid #ddd8d2;border-radius:8px;padding:8px 10px;font-size:12.5px;background:#fff;color:#24242a;width:100%;margin-bottom:6px">
    <option value="gbt7714-num">GB/T 7714-2015（顺序编码制）</option>
    <option value="gbt7714-ad">GB/T 7714-2015（著者-出版年制）</option>
    <option value="apa">APA 7th</option>
    <option value="ieee">IEEE</option>
  </select>
  <button class="act primary" id="insCite">在光标处插入引用 [n]</button>
  <button class="act ghost" id="insRef">文末插入参考文献列表</button>
  <div id="msg"></div>
</div>
<script>
const q = document.getElementById('q'), list = document.getElementById('list'), msg = document.getElementById('msg');
const picked = new Map();
async function search() {
  const r = await fetch('/papers?q=' + encodeURIComponent(q.value.trim()));
  const data = await r.json();
  list.innerHTML = '';
  for (const p of data.papers || []) {
    const row = document.createElement('div'); row.className = 'row';
    const cb = document.createElement('input'); cb.type = 'checkbox';
    cb.onchange = () => { cb.checked ? picked.set(p.id, p) : picked.delete(p.id); };
    const t = document.createElement('span'); t.className = 't'; t.textContent = p.title;
    const m = document.createElement('span'); m.className = 'm'; m.textContent = [p.year, (p.authors||'').split(',')[0]].filter(Boolean).join(' · ');
    row.append(cb, t, m); list.append(row);
  }
}
document.getElementById('go').onclick = search;
q.addEventListener('keydown', e => { if (e.key === 'Enter') search(); });

// 样式下拉：动态拉取全部可用样式（内置 + 已装 CSL）
(async function fillStyles() {
  const sel = document.getElementById('style');
  if (!sel) return;
  try {
    const r = await fetch('/styles');
    const data = await r.json();
    if (data.ok && data.styles?.length) {
      sel.innerHTML = '';
      for (const s of data.styles) {
        const o = document.createElement('option');
        o.value = s.id; o.textContent = s.name;
        sel.append(o);
      }
    }
  } catch (e) { /* 静态选项保底 */ }
})();

async function citeText() {
  const ids = [...picked.keys()].join(',');
  if (!ids) { msg.style.color = '#a12c2c'; msg.textContent = '先勾选文献'; return null; }
  const style = document.getElementById('style')?.value || 'gbt7714-num';
  const r = await fetch('/cite?ids=' + ids + '&style=' + encodeURIComponent(style));
  const data = await r.json();
  if (!data.ok) { msg.style.color = '#a12c2c'; msg.textContent = data.error || '生成失败'; return null; }
  return data.text;
}
document.getElementById('insCite').onclick = async () => {
  const ids = [...picked.keys()];
  if (!ids.length) { msg.style.color = '#a12c2c'; msg.textContent = '先勾选一篇文献'; return; }
  const text = await citeText();
  if (!text) return;
  const first = text.split('\\n')[0];
  const num = (first.match(/^\\[(\\d+)\\]/) || [])[1] || '1';
  await Word.run(async ctx => {
    ctx.document.getSelection().insertText('[' + num + ']', Word.InsertLocation.replace);
    await ctx.sync();
  });
  msg.style.color = '#1c7a2e'; msg.textContent = '✓ 已插入 [' + num + ']，记得在文末附参考文献列表';
};
document.getElementById('insRef').onclick = async () => {
  const text = await citeText();
  if (!text) return;
  await Word.run(async ctx => {
    const body = ctx.document.body;
    body.insertParagraph('参考文献', Word.InsertLocation.end).styleBuiltIn = 'Heading1';
    for (const line of text.split('\\n')) {
      body.insertParagraph(line, Word.InsertLocation.end);
    }
    await ctx.sync();
  });
  msg.style.color = '#1c7a2e'; msg.textContent = '✓ 参考文献列表已插入文末';
};
Office.onReady(() => search());
</script>
</body>
</html>`

