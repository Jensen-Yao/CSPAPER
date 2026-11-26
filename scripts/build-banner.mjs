// 渲染 README 横幅与社交分享图（og:image）。需要先运行 scripts/build-site-fonts.py。
// 用法：node scripts/build-banner.mjs
import { chromium } from 'playwright-core'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const pageUrl = pathToFileURL(path.join(root, 'scripts/banner/banner.html')).href
const browser = await chromium.launch({ channel: 'msedge', headless: true })
for (const [scale, name] of [[2, 'readme-banner.png'], [1, 'og-banner.png']]) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: scale })
  const page = await context.newPage()
  await page.goto(pageUrl)
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(root, 'docs/assets', name) })
  console.log('banner', name, scale + 'x')
  await context.close()
}
await browser.close()
