// CSS 体系卡口：解析构建产物，断言色相/圆角/字号/!important/重复选择器不回潮
import fs from 'node:fs'
import path from 'node:path'
const cssDir = path.join(process.cwd(), 'out/renderer/assets')
const file = fs.readdirSync(cssDir).find((f) => f.endsWith('.css'))
const css = fs.readFileSync(path.join(cssDir, file), 'utf8')
const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
const FAIL = []
const check = (name, val, limit) => {
  const ok = val <= limit
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${val} (≤${limit})`)
  if (!ok) FAIL.push(name)
}
// 强调色相（金/锈红/旧红/品红/玫红 残留）
const legacyAccent = (clean.match(/176,\s*141,\s*87|176,\s*101,\s*74|#b0654a|#b4443c|224,\s*85,\s*124|166,\s*9,\s*61/g) ?? []).length
check('legacy-accent-colors', legacyAccent, 0)
// 圆角档位
const radii = new Set((clean.match(/border-radius:\s*([^;]+);/g) ?? []).map((m) => m.replace(/border-radius:\s*|;/g, '').trim()))
check('radius-tiers', radii.size, 18)
// 字号档位
const fonts = new Set((clean.match(/font-size:\s*([^;]+);/g) ?? []).map((m) => m.replace(/font-size:\s*|;/g, '').trim()).filter((value) => !value.includes('}') && value !== 'inherit' && value !== '1px'))
check('font-tiers', fonts.size, 14)
// !important
check('important-count', (clean.match(/!important/g) ?? []).length, 8)
// 半像素字号
check('half-px-fonts', (clean.match(/font-size:\s*([0-9]+)\.5px/g) ?? []).length, 0)
// transition: all
check('transition-all', (clean.match(/transition:\s*all\b/g) ?? []).length, 0)
console.log(FAIL.length === 0 ? 'CSS-GATE-PASS' : 'CSS-GATE-FAIL: ' + FAIL.join(' | '))
process.exit(FAIL.length === 0 ? 0 : 1)
