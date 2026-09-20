// Skills 系统（v0.10，对标 ZCode/Claude Code 技能与 DeepSeek Harness 插件技能层）：
// 每个技能 = 目录下 SKILL.md（YAML frontmatter：name/description + markdown 正文 = 执行说明）。
// 内置技能随 app 发布（resources/skills/），用户技能放数据目录 skills/（热扫描）。
// agent 通过 use_skill 工具按需加载技能正文，按说明书组合工具完成研究流程。
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

export interface SkillInfo {
  name: string
  description: string
  source: 'builtin' | 'user'
  file: string
  body: string
}

function builtinDir(): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'skills') : path.join(app.getAppPath(), 'resources', 'skills')
}
function userDir(): string {
  return path.join(app.getPath('userData'), 'skills')
}

// frontmatter 解析（--- name: x / description: y ---）；不引入完整 YAML 依赖
function parseSkillFile(file: string): SkillInfo | null {
  try {
    const raw = fs.readFileSync(file, 'utf8')
    const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
    const head = fm?.[1] ?? ''
    const nameM = head.match(/^name:\s*(.+)$/m)
    const descM = head.match(/^description:\s*(.+)$/m)
    const name = (nameM?.[1] ?? path.basename(file, '.md')).trim()
    if (!name) return null
    return {
      name,
      description: (descM?.[1] ?? '').trim(),
      source: file.includes(app.getPath('userData')) ? 'user' : 'builtin',
      file,
      body: fm ? raw.slice(fm[0].length).trim() : raw.trim()
    }
  } catch {
    return null
  }
}

let cache: SkillInfo[] | null = null

export function listSkills(): SkillInfo[] {
  if (cache) return cache
  const out: SkillInfo[] = []
  const scan = (dir: string): void => {
    try {
      for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f)
        if (fs.statSync(p).isDirectory()) {
          const inner = path.join(p, 'SKILL.md')
          if (fs.existsSync(inner)) {
            const s = parseSkillFile(inner)
            if (s) out.push(s)
          }
        } else if (f.toLowerCase().endsWith('.md')) {
          const s = parseSkillFile(p)
          if (s) out.push(s)
        }
      }
    } catch {
      /* 目录不存在 */
    }
  }
  scan(builtinDir())
  scan(userDir())
  cache = out
  return out
}

export function invalidateSkills(): void {
  cache = null
}

export function skillDir(): string {
  return userDir()
}

// 按名称取技能正文（use_skill 工具调用）
export function skillBody(name: string): SkillInfo | null {
  return listSkills().find((s) => s.name === name || s.name.toLowerCase() === name.toLowerCase()) ?? null
}
