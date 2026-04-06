/**
 * MCP HTTP Server for Notebook Tasks
 *
 * This server exposes decorated notebook tasks as MCP tools via HTTP,
 * allowing remote API access from OpenAI, Claude, or other clients.
 */

import { MCPServer } from './core/MCPServer.ts'
import { HttpTransport } from './transports/HttpTransport.ts'
import { findMCPDecoratedCommands } from './discovery.ts'
import { env, exit } from '#shared/sys/mod.ts'

async function main() {
  // Get configuration from environment or use defaults
  const port = parseInt(env.get('MCP_PORT') || '8080', 10)
  const hostname = env.get('MCP_HOSTNAME') || 'localhost'
  const authToken = env.get('MCP_AUTH_TOKEN') || ''

  // Create the MCP server
  const server = new MCPServer({
    serverInfo: {
      name: 'notebook-mcp-http',
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

  // Create and start HTTP transport
  const transport = new HttpTransport({
    port,
    hostname,
    cors: true,
    authToken,
  })

  // Start the server
  await server.start(transport)

  console.error(`MCP HTTP Server started on http://${hostname}:${port}`)
  if (authToken) {
    console.error(`Authentication enabled. Use Bearer token: ${authToken}`)
  }
  console.error(`Health check: http://${hostname}:${port}/health`)
  console.error(`RPC endpoint: http://${hostname}:${port}/rpc`)

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
