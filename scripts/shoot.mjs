// 真机截图驱动：启动应用（临时数据目录）→ CDP 连接 → 驱动 UI → 输出 docs/screenshots/*.png
// 用法: node scripts/shoot.mjs   （需先构建 out/，并已运行 seed.cjs）
import { chromium } from 'playwright-core'
import { spawn, execSync } from 'node:child_process'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const SHOTS = path.join(ROOT, 'docs', 'screenshots')
fs.mkdirSync(SHOTS, { recursive: true })
import fs from 'node:fs'

function wait(ms) { return new Promise((r) => setTimeout(r, ms)) }

async function main() {
  const env = { ...process.env, CSPAPER_DATA_DIR: 'F:/tmp/cspaper-data' }
  const electronBin = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
  const electron = spawn(electronBin, ['.', '--remote-debugging-port=9222'], {
    cwd: ROOT, env, stdio: 'ignore', windowsHide: false
  })
  console.log('electron pid', electron.pid)

  let page = null
  try {
    // 等 CDP 端口就绪
    for (let i = 0; i < 40; i++) {
      try {
        const res = await fetch('http://127.0.0.1:9222/json/version')
        if (res.ok) break
      } catch { /* not ready */ }
      await wait(500)
    }
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
    for (let i = 0; i < 30 && !page; i++) {
      const ctx = browser.contexts()[0]
      const pages = ctx ? ctx.pages() : []
      page = pages.find((p) => !p.url().startsWith('devtools')) ?? null
      if (!page) await wait(500)
    }
    if (!page) throw new Error('未找到应用窗口页面')
    await page.setViewportSize({ width: 1500, height: 940 })
    await page.waitForSelector('.pcard', { timeout: 30000 })
    // 等缩略图懒渲染（前几张）
    for (let i = 0; i < 30; i++) {
      const n = await page.locator('.card-thumb img').count()
      if (n >= 4) break
      await wait(600)
    }
    await wait(800)
    await page.screenshot({ path: path.join(SHOTS, 'home.png') })
    console.log('✓ home.png')

    // 详情栏：单击卡片
    await page.locator('.pcard').first().click()
    await page.waitForSelector('.pd-panel', { timeout: 15000 })
    await page.waitForFunction(() => document.querySelector('.pd-scroll')?.textContent?.includes('摘要'), null, { timeout: 20000 }).catch(() => {})
    await wait(600)
    await page.screenshot({ path: path.join(SHOTS, 'detail.png') })
    console.log('✓ detail.png')

    // 阅读视图：双击卡片打开
    await page.locator('.pcard').first().dblclick()
    await page.waitForSelector('canvas', { timeout: 30000 })
    // 等文本层提取完成（全文翻译按钮依赖 pageContext）
    await page.waitForFunction(() => (document.querySelector('.textLayer')?.textContent?.length ?? 0) > 100, null, { timeout: 30000 })
    await wait(1500)
    await page.screenshot({ path: path.join(SHOTS, 'reader.png') })
    console.log('✓ reader.png')

    // 全文翻译（英文文献，真实 EN→中 免费通道翻译）
    await page.locator('.paper-item', { hasText: 'Network approach' }).first().click()
    await page.waitForFunction(() => (document.querySelector('.textLayer')?.textContent?.length ?? 0) > 100, null, { timeout: 30000 })
    await wait(1200)
    await page.locator('.side-tab', { hasText: '全文' }).click()
    await wait(400)
    await page.locator('button', { hasText: '翻译本页' }).first().click()
    // 等翻译块产出
    await page.waitForFunction(() => {
      const els = [...document.querySelectorAll('.bil-dst')]
      return els.length > 0 && els.slice(0, 2).every((e) => e.textContent.trim().length > 4)
    }, { timeout: 60000 })
    await wait(1500)
    await page.screenshot({ path: path.join(SHOTS, 'fulltext.png') })
    console.log('✓ fulltext.png')

    // 纵览：表格 + 知识网络
    await page.locator('.mode-toggle button', { hasText: '纵览' }).click()
    await page.waitForSelector('.ov-table', { timeout: 15000 })
    await wait(500)
    await page.locator('.ov-tab', { hasText: '知识网络' }).click()
    await wait(3500)
    await page.screenshot({ path: path.join(SHOTS, 'graph.png') })
    console.log('✓ graph.png')

    // 对比表格
    await page.locator('.mode-toggle button', { hasText: '对比' }).click()
    await page.waitForSelector('.cmp-table', { timeout: 15000 })
    await wait(700)
    await page.screenshot({ path: path.join(SHOTS, 'compare.png') })
    console.log('✓ compare.png')

    // 服务商选择器
    await page.locator('button[title="设置"]').click()
    await page.waitForSelector('.profile-add', { timeout: 10000 })
    await page.locator('button.profile-add', { hasText: '从服务商库添加' }).click()
    await page.waitForSelector('.picker-grid', { timeout: 10000 })
    await wait(600)
    await page.screenshot({ path: path.join(SHOTS, 'providers.png') })
    console.log('✓ providers.png')
  } catch (e) {
    console.error('SHOT FAIL:', e)
    process.exitCode = 1
  } finally {
    try { execSync(`taskkill /pid ${electron.pid} /T /F`, { stdio: 'ignore' }) } catch { /* exited */ }
  }
}

main()
