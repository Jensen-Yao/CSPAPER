// MCP 客户端管理（v0.10）：对标 DeepSeek Harness "everything is a plugin" 与 ZCode 的 MCP 能力。
// 用户在数据目录放 mcp.json（{ "mcpServers": { "<名字>": { "command": "...", "args": [...], "env": {...} } } }），
// 即可把任意外部 MCP 服务器的工具挂进工作台 agent（命名 mcp__<server>__<tool>）。
// 常见现成服务器：Zotero MCP、arXiv MCP、filesystem、fetch、sqlite 等（均为社区开源）。
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

export interface McpToolRef {
  server: string
  name: string // 原始工具名
  fullName: string // mcp__<server>__<name>
  description: string
  inputSchema: unknown
}

interface ServerConn {
  client: Client
  tools: McpToolRef[]
  error?: string
}

const conns = new Map<string, ServerConn>()

export function mcpConfigPath(): string {
  return path.join(app.getPath('userData'), 'mcp.json')
}

interface McpConfig {
  mcpServers: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>
}

export function readConfig(): McpConfig {
  try {
    return JSON.parse(fs.readFileSync(mcpConfigPath(), 'utf8')) as McpConfig
  } catch {
    return { mcpServers: {} }
  }
}

export function writeConfig(cfg: McpConfig): void {
  fs.mkdirSync(path.dirname(mcpConfigPath()), { recursive: true })
  fs.writeFileSync(mcpConfigPath(), JSON.stringify(cfg, null, 2))
}

export interface McpServerDef { command:string;args?:string[];env?:Record<string,string> }
export const MCP_PRESETS:Array<{name:string;description:string;command:string;args:string[];env?:Record<string,string>}> = [
  { name:'filesystem', description:'让智能体读写指定文件夹（官方 filesystem 服务器，需 Node）', command:'npx', args:['-y','@modelcontextprotocol/server-filesystem','.'] },
  { name:'fetch', description:'把网页抓取为 Markdown 交给模型（官方 fetch 服务器，需 uv）', command:'uvx', args:['mcp-server-fetch'] },
  { name:'memory', description:'跨会话的知识图谱记忆（官方 memory 服务器，需 Node）', command:'npx', args:['-y','@modelcontextprotocol/server-memory'] },
  { name:'arxiv', description:'arXiv 检索与下载（社区 arxiv-mcp-server，需 uv）', command:'uvx', args:['arxiv-mcp-server'] }
]

/** Add or replace a server definition in mcp.json (name is sanitized like the tool namespace). */
export function upsertMcpServer(name:string, def:McpServerDef):McpConfig {
  const cfg=readConfig(), key=sanitize(name)
  if(!key)throw new Error('服务器名称无效')
  cfg.mcpServers={...(cfg.mcpServers??{}),[key]:{command:def.command.trim(),...(def.args?.length?{args:def.args}:{}) , ...(def.env&&Object.keys(def.env).length?{env:def.env}:{})}}
  writeConfig(cfg)
  return cfg
}

export function removeMcpServer(name:string):boolean {
  const cfg=readConfig(), key=sanitize(name)
  if(!cfg.mcpServers?.[key])return false
  delete cfg.mcpServers[key]
  writeConfig(cfg)
  return true
}

export function readMcpServers():Array<{name:string;def:McpServerDef}> {
  return Object.entries(readConfig().mcpServers??{}).map(([name,def])=>({name,def}))
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40)
}

// 连接全部已配置服务器（工作台启动/手动刷新时调用；幂等）
export async function connectAll(): Promise<Array<{ server: string; ok: boolean; tools: number; error?: string }>> {
  return doConnectAll()
}

async function doConnectAll(): Promise<Array<{ server: string; ok: boolean; tools: number; error?: string }>> {
  const cfg = readConfig()
  const out: Array<{ server: string; ok: boolean; tools: number; error?: string }> = []
  for (const [server, def] of Object.entries(cfg.mcpServers ?? {})) {
    if (!def?.command) continue
    try {
      // 重连前先关旧连接：否则每次刷新泄漏一批常驻 stdio 子进程
      const oldConn = conns.get(server)
      if (oldConn) {
        conns.delete(server)
        await oldConn.client.close().catch(() => {})
      }
      const client = new Client({ name: 'cspaper-agent', version: '1.0.0' })
      const transport = new StdioClientTransport({
        command: def.command,
        args: def.args ?? [],
        env: { ...(def.env ?? {}) }
      })
      await client.connect(transport)
      const list = await client.listTools()
      const tools: McpToolRef[] = (list.tools ?? []).slice(0, 30).map((t) => ({
        server,
        name: t.name,
        fullName: `mcp__${sanitize(server)}__${sanitize(t.name)}`,
        description: t.description ?? '',
        inputSchema: t.inputSchema
      }))
      conns.set(server, { client, tools })
      out.push({ server, ok: true, tools: tools.length })
    } catch (e) {
      conns.delete(server)
      out.push({ server, ok: false, tools: 0, error: String(e).slice(0, 120) })
    }
  }
  return out
}

// 已连接的全部 MCP 工具
export function listMcpTools(): McpToolRef[] {
  const out: McpToolRef[] = []
  for (const [server, conn] of conns) out.push(...conn.tools.map((t) => ({ ...t, server })))
  return out
}

export function mcpConnected(): boolean {
  return conns.size > 0
}

// 调用一个 MCP 工具（60s 超时；返回拼接后的文本观察）
export async function callMcpTool(fullName: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
  const ref = listMcpTools().find((t) => t.fullName === fullName)
  if (!ref) throw new Error(`MCP 工具不存在：${fullName}`)
  const conn = conns.get(ref.server)
  if (!conn) throw new Error(`MCP 服务器 ${ref.server} 未连接`)
  signal?.throwIfAborted()
  const settled=await conn.client.callTool({name:ref.name,arguments:args},undefined,{signal,timeout:60000})
  const r=settled as { content?: Array<{ type: string; text?: string }> }
  const text = (r.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('\n')
  return text || '（MCP 工具无文本输出）'
}

export async function disconnectAll(): Promise<void> {
  for (const [, conn] of conns) {
    try {
      await conn.client.close()
    } catch {
      /* 忽略 */
    }
  }
  conns.clear()
}
