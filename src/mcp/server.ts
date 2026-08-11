/**
 * MCP Server for Notebook Tasks - Refactored Version
 *
 * This server exposes decorated notebook tasks as MCP tools,
 * allowing Claude to execute tasks like meeting:new directly.
 */

import { env, exit } from '#shared/sys/mod.ts'
import { MCPServer } from './core/MCPServer.ts'
import { findMCPDecoratedCommands } from './discovery.ts'
import { StdioTransport } from './transports/StdioTransport.ts'

export async function main() {
  // Create the MCP server
  const server = new MCPServer({
    serverInfo: {
      name: 'notebook-mcp',
      version: '1.0.0',
    },
    capabilities: {
      tools: {},
    },
    env: {
      EDITOR: env.get('EDITOR') || 'code',
    },
  })

  // Discover and register tasks
  console.error('Discovering MCP-enabled tasks...')

  const decoratedTaskPaths = await findMCPDecoratedCommands()
  console.error(`Found ${decoratedTaskPaths.length} files with @MCPTool decorator`)

  // Import and register each decorated task
  for (const fullPath of decoratedTaskPaths) {
    try {
      const module = await import(`file://${fullPath}`)

      if (module.default) {
        try {
          server.registerCommand(module.default)
          const CommandClass = module.default as any
          const commandDesc = CommandClass.description
          if (commandDesc) {
            console.error(`Registered MCP tool: ${commandDesc.name}`)
          }
        } catch (err) {
          console.error(`Failed to register task from ${fullPath}:`, (err as Error).message)
        }
      }
    } catch (err) {
      console.error(`Failed to load task from ${fullPath}:`, (err as Error).message)
    }
  }

  const registry = server.getRegistry()
  console.error(`Registered ${registry.size()} MCP-enabled tasks`)

  // Create and start stdio transport
  const transport = new StdioTransport()

  console.error('MCP Server started on stdio transport')

  // Start the server
  await server.start(transport)

  // Keep the process alive
  await new Promise(() => {})
}

// Start the server if this is the main module
if (import.meta.main) {
  main().catch((error) => {
    console.error('Fatal error:', error)
    exit(1)
  })
}
