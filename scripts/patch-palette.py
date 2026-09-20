# -*- coding: utf-8 -*-
# StatsView 配色系统补丁：PALETTES 注册表 + 组件 palKey 状态 + 硬编码色替换
import re

p = 'src/renderer/src/StatsView.tsx'
s = open(p, encoding='utf-8').read()

old_consts = """const PALETTE = ['#b08d57', '#7a9e7e', '#b0654a', '#6b7fa3', '#a37f9e', '#8a8f6a', '#7e9aa3', '#c4a882', '#a3675e', '#9e8f6b']
// 频次梯度色板（暖墨家族，深 → 浅）：气泡图按名次取色
const RAMP = ['#5f4526', '#8a6a3f', '#b08d57', '#cfae74', '#e6d7b8']
const HEAT_LIGHT = ['rgba(60,50,35,0.07)', '#e3d4b2', '#d3b276', '#b08d57', '#7c5f33']
const HEAT_DARK = ['rgba(255,255,255,0.05)', '#4a3f2b', '#6d5a3a', '#96784a', '#c9a86a']"""

new_consts = """// ---------- 配色风格（可选，词云与全部图表共用） ----------
interface StatPalette {
  name: string
  tree: string[]
  ramp: string[]
  accent: string
  cloudHi: string
  cloudSecond: string
  heatLight: string[]
  heatDark: string[]
}
const PALETTES: Record<string, StatPalette> = {
  warm: {
    name: '暖墨',
    tree: ['#b08d57', '#7a9e7e', '#b0654a', '#6b7fa3', '#a37f9e', '#8a8f6a', '#7e9aa3', '#c4a882', '#a3675e', '#9e8f6b'],
    ramp: ['#5f4526', '#8a6a3f', '#b08d57', '#cfae74', '#e6d7b8'],
    accent: '#b0654a',
    cloudHi: '#b0654a',
    cloudSecond: '#8a6a3e',
    heatLight: ['rgba(60,50,35,0.07)', '#e3d4b2', '#d3b276', '#b08d57', '#7c5f33'],
    heatDark: ['rgba(255,255,255,0.05)', '#4a3f2b', '#6d5a3a', '#96784a', '#c9a86a']
  },
  ink: {
    name: '墨蓝',
    tree: ['#31456e', '#4a6b9e', '#6b86b8', '#8ba3c9', '#37597a', '#5d7a94', '#7e99b3', '#49678a', '#6f89a8', '#93a9c4'],
    ramp: ['#24365c', '#3d567f', '#5a77a3', '#8aa3c4', '#c3d2e4'],
    accent: '#3d567f',
    cloudHi: '#31456e',
    cloudSecond: '#4a6b9e',
    heatLight: ['rgba(30,42,70,0.07)', '#c6d3e6', '#9db3d1', '#6b86b8', '#31456e'],
    heatDark: ['rgba(255,255,255,0.05)', '#2c3a55', '#41537a', '#5a77a3', '#8aa3c4']
  },
  celadon: {
    name: '青瓷',
    tree: ['#2e6b5e', '#43857a', '#5da091', '#82b8a9', '#4a7a5f', '#6f9a80', '#93b9a1', '#3e6e6a', '#5c9a8a', '#7fb098'],
    ramp: ['#1f4f43', '#33685a', '#4f8474', '#7aa694', '#b3cdc1'],
    accent: '#33685a',
    cloudHi: '#2e6b5e',
    cloudSecond: '#43857a',
    heatLight: ['rgba(25,60,50,0.07)', '#c2ddd2', '#93c1b0', '#5da091', '#2e6b5e'],
    heatDark: ['rgba(255,255,255,0.05)', '#24443c', '#33685a', '#4f8474', '#7aa694']
  },
  crimson: {
    name: '绛红',
    tree: ['#8a2f36', '#a84a4f', '#c26b6b', '#d99590', '#7a3a52', '#a05a6e', '#c08a94', '#8a4a4a', '#b06a5e', '#d4a09a'],
    ramp: ['#5c1f26', '#8a2f36', '#b05c5c', '#d3948c', '#eec4bc'],
    accent: '#a84a4f',
    cloudHi: '#8a2f36',
    cloudSecond: '#a84a4f',
    heatLight: ['rgba(90,30,35,0.07)', '#eccfd0', '#d9a3a3', '#c26b6b', '#8a2f36'],
    heatDark: ['rgba(255,255,255,0.05)', '#4a2428', '#6e343a', '#a84a4f', '#c26b6b']
  },
  violet: {
    name: '紫藤',
    tree: ['#5b3a72', '#74528f', '#8f6ba8', '#ab8ac0', '#6a4a8a', '#8a6a9e', '#a98aba', '#75558a', '#9a7ab0', '#b8a0cc'],
    ramp: ['#3f2755', '#5b3a72', '#7d5c96', '#a288b8', '#cbb5d6'],
    accent: '#74528f',
    cloudHi: '#5b3a72',
    cloudSecond: '#74528f',
    heatLight: ['rgba(60,35,90,0.07)', '#d8cbe6', '#b49ac9', '#8f6ba8', '#5b3a72'],
    heatDark: ['rgba(255,255,255,0.05)', '#35244a', '#4c3666', '#74528f', '#8f6ba8']
  }
}"""

assert old_consts in s, 'consts not found'
s = s.replace(old_consts, new_consts)

# rampColor 接受 ramp 参数
s = s.replace(
    """function rampColor(t: number): string {
  const x = clamp(t, 0, 1) * (RAMP.length - 1)
  const i = Math.min(RAMP.length - 2, Math.floor(x))
  const f = x - i
  const a = hexRgb(RAMP[i])
  const b = hexRgb(RAMP[i + 1])""",
    """function rampColor(t: number, ramp: string[]): string {
  const x = clamp(t, 0, 1) * (ramp.length - 1)
  const i = Math.min(ramp.length - 2, Math.floor(x))
  const f = x - i
  const a = hexRgb(ramp[i])
  const b = hexRgb(ramp[i + 1])""")

# cloudColor 接受色板
old_cc = """function cloudColor(rank: number, total: number, dark: boolean): string {
  if (rank === 0) return dark ? '#e8c489' : '#b0654a' // 榜首锈红
  if (rank === 1) return dark ? '#d8b98a' : '#8a6a3e'
  if (rank === 2) return dark ? '#c9ad83' : '#6b7fa3'
  const f = total <= 4 ? 0.5 : Math.min(1, rank / (total - 1))
  const a = dark ? [214, 186, 140] : [178, 152, 108]
  const b = dark ? [148, 140, 130] : [152, 144, 134]
  const mix = (x: number, y: number): number => Math.round(x + (y - x) * f)
  return `rgb(${mix(a[0], b[0])},${mix(a[1], b[1])},${mix(a[2], b[2])})`
}"""
new_cc = """function mixLight(hex: string, f: number): string {
  const [r, g, b] = hexRgb(hex)
  const m = (v: number): number => Math.round(v + (255 - v) * f)
  return `rgb(${m(r)},${m(g)},${m(b)})`
}
function cloudColor(rank: number, total: number, dark: boolean, pal: StatPalette): string {
  if (rank === 0) return dark ? mixLight(pal.cloudHi, 0.35) : pal.cloudHi
  if (rank === 1) return dark ? mixLight(pal.cloudSecond, 0.28) : pal.cloudSecond
  if (rank === 2) return dark ? mixLight(pal.accent, 0.2) : pal.accent
  const f = total <= 4 ? 0.5 : Math.min(1, rank / (total - 1))
  const a = dark ? hexRgb(mixLight(pal.cloudSecond, 0.3)) : hexRgb(pal.ramp[2])
  const b = dark ? [150, 142, 132] : hexRgb(pal.ramp[4])
  const mix = (x: number, y: number): number => Math.round(x + (y - x) * f)
  return `rgb(${mix(a[0], b[0])},${mix(a[1], b[1])},${mix(a[2], b[2])})`
}"""
assert old_cc in s, 'cloudColor not found'
s = s.replace(old_cc, new_cc)

# layoutCloud 加 pal 参数并把 cloudColor 调用带上
s = s.replace(
    "function layoutCloud(g: CanvasRenderingContext2D, words: Array<{ w: string; n: number }>, W: number, H: number, dark: boolean): CloudWord[] {",
    "function layoutCloud(g: CanvasRenderingContext2D, words: Array<{ w: string; n: number }>, W: number, H: number, dark: boolean, pal: StatPalette): CloudWord[] {")
s = s.replace("color: cloudColor(i, words.length, dark)", "color: cloudColor(i, words.length, dark, pal)")

# 组件状态 palKey（插在 view state 之后）
anchor = "const [view, setView] = useState<ViewKey>('cloud')"
assert anchor in s
s = s.replace(anchor, anchor + """
  const [palKey, setPalKey] = useState<string>(() => localStorage.getItem('st2.palette') ?? 'warm')
  const pal = PALETTES[palKey] ?? PALETTES.warm
  const pickPal = (k: string): void => {
    setPalKey(k)
    try {
      localStorage.setItem('st2.palette', k)
    } catch {
      /* 忽略 */
    }
  }""")

# 重绘依赖加 palKey
s = s.replace("""  }, [view, ov, ex])""", """  }, [view, ov, ex, palKey])""")

# 组件内硬编码替换
s = s.replace("const col = PALETTE[rc.item.i % PALETTE.length]", "const col = pal.tree[rc.item.i % pal.tree.length]")
s = s.replace("const col = PALETTE[si % PALETTE.length]", "const col = pal.tree[si % pal.tree.length]")
s = s.replace("g.fillStyle = PALETTE[si % PALETTE.length]", "g.fillStyle = pal.tree[si % pal.tree.length]")
s = s.replace("g.fillStyle = hov ? PALETTE[2] : PALETTE[i % PALETTE.length]", "g.fillStyle = hov ? pal.accent : pal.tree[i % pal.tree.length]")
s = s.replace("g.fillStyle = PALETTE[2]", "g.fillStyle = pal.accent")
s = s.replace("g.strokeStyle = '#b0654a'", "g.strokeStyle = pal.accent")
s = s.replace("{ num: ov ? String(ov.totalPapers) : '—', label: '文献总数', color: PALETTE[0] }", "{ num: ov ? String(ov.totalPapers) : '—', label: '文献总数', color: pal.tree[0] }")
s = s.replace("{ num: ov ? fmtHours(ov.totalReadSeconds) : '—', label: '累计阅读时长', color: PALETTE[2] }", "{ num: ov ? fmtHours(ov.totalReadSeconds) : '—', label: '累计阅读时长', color: pal.accent }")
s = s.replace("{ num: ov ? String(ov.readingPapers) : '—', label: ov ? `在读 · 占 ${readPct}%` : '在读', color: PALETTE[1] }", "{ num: ov ? String(ov.readingPapers) : '—', label: ov ? `在读 · 占 ${readPct}%` : '在读', color: pal.tree[1] }")
s = s.replace("{ num: ov ? String(ov.statuses.find((s) => s.status === 'read')?.count ?? 0) : '—', label: '已读完', color: PALETTE[3] }", "{ num: ov ? String(ov.statuses.find((s) => s.status === 'read')?.count ?? 0) : '—', label: '已读完', color: pal.tree[3] }")

# HEAT 引用（drawHeat 内，可能叫 HEAT_LIGHT/HEAT_DARK）
s = s.replace("HEAT_LIGHT", "pal.heatLight").replace("HEAT_DARK", "pal.heatDark")

# rampColor( 调用点带 ramp —— 只有无参形式存在，统一补 pal.ramp
s = re.sub(r"rampColor\(([^\)]+)\)", lambda m: "rampColor(%s, pal.ramp)" % m.group(1) if 'pal.ramp' not in m.group(1) and 'function' not in m.group(1) else m.group(0), s)
# 函数定义本身恢复（防止上面 regex 改到定义行参数）
s = s.replace("function rampColor(t: number, ramp: string[], pal.ramp: string[]): string {", "function rampColor(t: number, ramp: string[]): string {")

# 词云布局调用点带 pal
s = s.replace("cloudCache = { key, placed: layoutCloud(g, words, W, H, dark) }",
              "cloudCache = { key, placed: layoutCloud(g, words, W, H, dark, pal) }")
# 词云缓存 key 加色板
s = s.replace("const key = `${W}x${H}:${words.length}:${words[0].w}`",
              "const key = `${palKey}:${W}x${H}:${words.length}:${words[0].w}`")

# 渲染：配色选择 chips（放在视图 chips 之后同一行）
old_head = """          <div className="st2-chips">
            {VIEWS.map((v) => (
              <button key={v.key} className={`st2-chip ${view === v.key ? 'on' : ''}`} onClick={() => setView(v.key)}>
                {v.label}
              </button>
            ))}
          </div>"""
new_head = """          <div className="st2-chips">
            {VIEWS.map((v) => (
              <button key={v.key} className={`st2-chip ${view === v.key ? 'on' : ''}`} onClick={() => setView(v.key)}>
                {v.label}
              </button>
            ))}
            <span className="st2-pal-sep" />
            {PAL_KEYS.map((k) => (
              <button
                key={k}
                className={`st2-pal ${palKey === k ? 'on' : ''}`}
                title={`配色风格：${PALETTES[k].name}`}
                onClick={() => pickPal(k)}
              >
                <i style={{ background: PALETTES[k].accent }} />
                {PALETTES[k].name}
              </button>
            ))}
          </div>"""
assert old_head in s, 'head not found'
s = s.replace(old_head, new_head)

open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('palette patch applied')
