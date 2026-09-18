// 桌面端全功能实测：CDP 驱动真实应用，逐项验证 PASS/FAIL
import { chromium } from 'playwright-core'
import { spawn, execSync } from 'node:child_process'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
function wait(ms) { return new Promise((r) => setTimeout(r, ms)) }
const results = []
async function step(name, fn, timeoutMs = 45000) {
  const t0 = Date.now()
  try {
    await Promise.race([
      fn(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs))
    ])
    results.push(`PASS  ${name}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`)
  } catch (e) {
    results.push(`FAIL  ${name}  → ${String(e).split('\n')[0].slice(0, 120)}`)
  }
  console.log(results[results.length - 1])
}

const env = { ...process.env, CSPAPER_DATA_DIR: 'F:/tmp/cspaper-data' }
const electron = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), ['.', '--remote-debugging-port=9226'], { cwd: ROOT, env, stdio: 'ignore' })
const fileServer = spawn('python', ['-m', 'http.server', '8777', '--directory', 'F:/tmp/cspaper-sample'], { stdio: 'ignore' })

try {
  for (let i = 0; i < 40; i++) { try { const r = await fetch('http://127.0.0.1:9226/json/version'); if (r.ok) break } catch {} ; await wait(500) }
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9226')
  let page = null
  for (let i = 0; i < 30 && !page; i++) {
    const ctx = browser.contexts()[0]
    const pages = ctx ? ctx.pages() : []
    page = pages.find((p) => !p.url().startsWith('devtools')) ?? null
    if (!page) await wait(500)
  }
  await page.setViewportSize({ width: 1500, height: 940 })

  await step('T1 卡片墙渲染（6 张卡片）', async () => {
    await page.waitForSelector('.pcard', { timeout: 30000 })
    const n = await page.locator('.pcard').count()
    if (n < 6) throw new Error('卡片数 ' + n)
  })

  await step('T2 缩略图懒渲染 ≥ 4', async () => {
    for (let i = 0; i < 30; i++) {
      if ((await page.locator('.card-thumb img').count()) >= 4) return
      await wait(600)
    }
    throw new Error('缩略图不足')
  })

  await step('T3 卡片详情栏（信息/AI洞察/摘要）', async () => {
    await page.locator('.pcard').first().click()
    await page.waitForSelector('.pd-panel', { timeout: 15000 })
    await page.waitForFunction(() => (document.querySelector('.pd-scroll')?.textContent ?? '').includes('摘要'), null, { timeout: 20000 })
    if (!(await page.locator('.pd-sec').count())) throw new Error('无分节')
  })

  await step('T4 阅读器打开 + 文本层提取', async () => {
    await page.locator('.pcard').first().dblclick()
    await page.waitForSelector('canvas', { timeout: 30000 })
    await page.waitForFunction(() => (document.querySelector('.textLayer')?.textContent?.length ?? 0) > 100, null, { timeout: 30000 })
  })

  await step('T5 划词 → 浮条 → 免Key翻译出结果', async () => {
    const box = await page.locator('canvas').first().boundingBox()
    const x = box.x + box.width * 0.25, y = box.y + box.height * 0.42
    await page.mouse.move(x, y); await page.mouse.down()
    for (let i = 1; i <= 8; i++) await page.mouse.move(x + (box.width * 0.35 * i) / 8, y + i * 3)
    await page.mouse.up()
    await page.waitForSelector('.float-bar', { timeout: 8000 })
    await page.locator('.float-bar button', { hasText: '翻译' }).click()
    await page.waitForFunction(() => (document.querySelector('.dst-text')?.textContent?.length ?? 0) > 4, null, { timeout: 40000 })
  })

  await step('T6 缩略图导航', async () => {
    await page.locator('button[title="页面缩略图"]').click()
    await page.waitForFunction(() => document.querySelectorAll('.pdf-thumb').length >= 4, null, { timeout: 20000 })
  })

  await step('T7 目录导航（含无目录兜底）', async () => {
    await page.locator('button[title="目录 / 书签"]').click()
    await page.waitForSelector('.pdf-toc-item, .pdf-navi-empty', { timeout: 15000 })
  })

  await step('T8 标注标签页（已种子 1 条）', async () => {
    await page.locator('.side-tab', { hasText: '标注' }).click()
    await page.waitForFunction(() => (document.body.innerText.includes('p.1')), null, { timeout: 15000 })
  })

  await step('T9 详情标签页（嵌入式详情）', async () => {
    await page.locator('.side-tab', { hasText: '详情' }).click()
    await page.waitForSelector('.pd-embed .pd-sec', { timeout: 20000 })
  })

  await step('T10 工具栏全文翻译（真实翻译）', async () => {
    await page.locator('.ft-btn').click()
    await page.waitForFunction(() => {
      const els = [...document.querySelectorAll('.bil-dst')]
      return els.length > 0 && els.slice(0, 2).every((e) => e.textContent.trim().length > 4)
    }, null, { timeout: 60000 })
  })

  await step('T11 对比表渲染（预置要点+页码角标）', async () => {
    await page.locator('.mode-toggle button', { hasText: '对比' }).click()
    await page.waitForSelector('.cmp-table', { timeout: 15000 })
    const pts = await page.locator('.cmp-points li').count()
    const chips = await page.locator('.cmp-points .cite-chip').count()
    if (pts < 4 || chips < 2) throw new Error(`要点 ${pts} 角标 ${chips}`)
  })

  await step('T12 添加维度（内置勾选→新列；无Key生成报错提示）', async () => {
    await page.locator('.cmp-btn', { hasText: '添加维度' }).click()
    await page.waitForSelector('.dim-grid', { timeout: 10000 })
    await page.locator('.dim-card', { hasText: '研究方法' }).first().click()
    await page.locator('button.btn', { hasText: '确认添加' }).click()
    await page.waitForFunction(() => [...document.querySelectorAll('.cmp-table th')].some((t) => t.textContent === '研究方法'), null, { timeout: 8000 })
    await page.locator('.cmp-mini', { hasText: '生成' }).first().click()
    await page.waitForSelector('.cmp-err', { timeout: 20000 })
  })

  await step('T13 纵览表格（排序）', async () => {
    await page.locator('.mode-toggle button', { hasText: '纵览' }).click()
    await page.waitForSelector('.ov-table', { timeout: 15000 })
    const firstBefore = await page.locator('.ov-table tbody tr td.ov-title').first().textContent()
    await page.locator('.ov-table th', { hasText: '标题' }).click()
    await wait(400)
    const firstAfter = await page.locator('.ov-table tbody tr td.ov-title').first().textContent()
    if (firstBefore === firstAfter) throw new Error('排序无变化')
  })

  await step('T14 知识网络图谱', async () => {
    await page.locator('.ov-tab', { hasText: '知识网络' }).click()
    await page.waitForSelector('.ov-graph canvas', { timeout: 15000 })
    await wait(2500)
  })

  await step('T15 深度搜索（标题行内片段 + 正文独立命中）', async () => {
    await page.locator('.mode-toggle button', { hasText: '阅读' }).click()
    // 等后台索引完成（索引期间正文检索为空属预期；状态栏文案在刚启动时会短暂误报）
    await page.waitForFunction(async () => {
      const s = await window.api.indexStatus()
      return !s.running && s.indexed >= 6
    }, null, { timeout: 180000, polling: 2000 })
    await page.locator('.searchbox').fill('韧性')
    try {
      await page.waitForFunction(() => document.querySelectorAll('.deep-snip').length >= 1, null, { timeout: 15000 })
    } catch (e) {
      const dump = await page.evaluate(() => ({
        snips: document.querySelectorAll('.deep-snip').length,
        q: document.querySelector('.searchbox')?.value,
        side: document.querySelector('.lib-files-scroll')?.innerText?.slice(0, 150)
      }))
      throw new Error('dump: ' + JSON.stringify(dump))
    }
    await page.locator('.searchbox').fill('蒙特卡洛')
    try {
      await page.waitForFunction(() => document.body.innerText.includes('正文 / 笔记匹配'), null, { timeout: 15000 })
    } catch (e) {
      const dump = await page.evaluate(async () => ({
        sections: [...document.querySelectorAll('.lib-section')].map((x) => x.textContent),
        q: document.querySelector('.searchbox')?.value,
        api: (await window.api.deepSearch('蒙特卡洛')).length,
        status: await window.api.indexStatus()
      }))
      throw new Error('dump2: ' + JSON.stringify(dump))
    }
  })

  await step('T16 设置：服务商一键配置', async () => {
    await page.locator('button[title="设置"]').click()
    await page.locator('button.profile-add', { hasText: '从服务商库添加' }).click()
    await page.waitForSelector('.picker-grid', { timeout: 10000 })
    const cards = await page.locator('.pv-card').count()
    if (cards < 10) throw new Error('服务商卡片仅 ' + cards)
    await page.locator('.pv-card', { hasText: 'DeepSeek' }).click()
    await page.waitForFunction(() => document.body.innerText.includes('DeepSeek'), null, { timeout: 8000 })
    await page.locator('button.btn', { hasText: '保存' }).last().click()
  })

  await step('T17 Zotero 导入对话框（真实探测）', async () => {
    await page.locator('.menu-btn', { hasText: '文件' }).click()
    await page.locator('.menu-item', { hasText: '从 Zotero 导入' }).click()
    await page.waitForSelector('.modal', { timeout: 10000 })
    // 真实 Zotero 库（4 篇 PDF）应被探测到并出列表
    await page.waitForFunction(() => document.querySelectorAll('.import-queue .pcard, .import-queue').length >= 0 && (document.querySelector('.import-queue') !== null || document.body.innerText.includes('未找到')), null, { timeout: 25000 })
    const hasQueue = await page.locator('.import-queue').count()
    if (!hasQueue) throw new Error('未列出 Zotero 条目')
    await page.keyboard.press('Escape')
    await page.mouse.click(30, 500)
  })

  await step('T18 桥接 /ping', async () => {
    const r = await (await fetch('http://127.0.0.1:24517/ping')).json()
    if (!r.ok || r.name !== 'CSPAPER') throw new Error(JSON.stringify(r))
  })

  await step('T19 桥接 /papers 检索', async () => {
    const r = await (await fetch('http://127.0.0.1:24517/papers?q=' + encodeURIComponent('韧性'))).json()
    if (!r.ok || !r.papers?.length) throw new Error('无结果')
  })

  await step('T20 桥接 /cite GB/T 7714', async () => {
    const r = await (await fetch('http://127.0.0.1:24517/cite?ids=1,2')).json()
    if (!r.ok || !r.text.includes('[1]')) throw new Error(r.text?.slice(0, 60))
  })

  await step('T21 桥接 /save-paper 一键存入（本地 PDF URL 全链路）', async () => {
    const url = 'http://127.0.0.1:8777/papers/' + encodeURIComponent('韧性综述') + '/resilience-01/paper.pdf'
    const resp = await fetch('http://127.0.0.1:24517/save-paper', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pdfUrl: url, title: '桥接测试论文', category: 'inbox' })
    })
    const r = await resp.json()
    if (!r.ok) throw new Error(r.error || 'HTTP ' + resp.status)
  })
} catch (e) {
  console.log('FATAL', String(e).slice(0, 200))
} finally {
  try { execSync(`taskkill /pid ${electron.pid} /T /F`, { stdio: 'ignore' }) } catch {}
  try { execSync('taskkill /IM python.exe /FI "MEMUSAGE gt 1" 2>nul', { stdio: 'ignore' }) } catch { /* http server 交给系统 */ }
  const pass = results.filter((r) => r.startsWith('PASS')).length
  console.log('====== 结果 ======')
  console.log(results.join('\n'))
  console.log(`通过 ${pass}/${results.length}`)
}
process.exit(0)
