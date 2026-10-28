import { z } from 'zod'
import { callMcpTool, listMcpTools, type McpToolRef } from '../mcp'
import type { ToolResult } from '../../shared/tools'
import type { ToolRegistry, ToolContext } from './registry'

export function registerMcpToolList(
  registry: ToolRegistry,
  tools: McpToolRef[],
  invoke: (fullName: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<string>
): void {
  for (const ref of tools) {
    registry.register({
      definition: {
        name: ref.fullName,
        version: 1,
        title: `MCP ${ref.server}/${ref.name}`,
        description: ref.description || ref.name,
        risk: 'external_effect',
        defaultPermission: 'auto',
        inputSchema: (ref.inputSchema ?? { type: 'object', properties: {} }) as Record<string, unknown>,
        canCancel: true,
        timeoutMs: 60000
      },
      schema: z.record(z.string(), z.unknown()),
      execute: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
        const text = await invoke(ref.fullName, args, ctx.signal)
        return {
          status: 'success',
          data: { text },
          summary: text.slice(0, 300),
          sources: [],
          artifacts: [],
          changes: [{ entity: 'external', entityId: ref.fullName, action: 'update', after: { server: ref.server, tool: ref.name }, reversible: false }],
          durationMs: 0
        }
      }
    })
  }
}

export function registerMcpTools(registry: ToolRegistry): void {
  registerMcpToolList(registry, listMcpTools(), (fullName, args, signal) => callMcpTool(fullName, args, signal))
}
