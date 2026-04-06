/**
 * Tests for the refactored MCP Server
 */

import { assert, test } from '#test'
import { MCPServer } from '../core/MCPServer.ts'
import { MockTransport } from './mocks/MockTransport.ts'
import {
  MockComplexCommand,
  MockDateCommand,
  MockEchoCommand,
  MockErrorCommand,
  MockNonMCPCommand,
} from './mocks/MockCommand.ts'

test('MCPServer - initialization', () => {
  const server = new MCPServer({
    serverInfo: {
      name: 'test-server',
      version: '1.0.0',
    },
  })

  assert({
    given: 'a new MCP server',
    should: 'not be running initially',
    actual: server.isRunning(),
    expected: false,
  })
})

test('MCPServer - task registration', () => {
  const server = new MCPServer()

  server.registerCommand(MockEchoCommand)

  const registry = server.getRegistry()

  assert({
    given: 'a registered task',
    should: 'be in the registry',
    actual: registry.has('mock_echo'),
    expected: true,
  })
})

test('MCPServer - multiple task registration', () => {
  const server = new MCPServer()

  server.registerCommands([MockEchoCommand, MockErrorCommand, MockComplexCommand])

  const registry = server.getRegistry()

  assert({
    given: 'multiple registered tasks',
    should: 'all be in the registry',
    actual: registry.size(),
    expected: 3,
  })
})

test('MCPServer - non-MCP task rejection', () => {
  const server = new MCPServer()

  let errorThrown = false
  try {
    server.registerCommand(MockNonMCPCommand)
  } catch {
    errorThrown = true
  }

  assert({
    given: 'a task without @MCPTool decorator',
    should: 'throw an error when registering',
    actual: errorThrown,
    expected: true,
  })
})

test('MCPServer - initialize protocol', async () => {
  const server = MCPServer.createForTesting([MockEchoCommand])
  const transport = new MockTransport()

  await server.start(transport)

  // Send initialize request
  await transport.simulateIncomingMessage(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: {
          name: 'test-client',
          version: '1.0.0',
        },
      },
    }),
  )

  // Check response
  const response = JSON.parse(transport.getLastSentMessage()!)

  assert({
    given: 'an initialize request',
    should: 'respond with server info',
    actual: response.result.serverInfo.name,
    expected: 'test-mcp',
  })

  assert({
    given: 'an initialize request',
    should: 'include protocol version',
    actual: response.result.protocolVersion,
    expected: '2025-06-18',
  })

  await server.stop()
})

test('MCPServer - list tools', async () => {
  const server = MCPServer.createForTesting([MockEchoCommand, MockComplexCommand])
  const transport = new MockTransport()

  await server.start(transport)

  // Initialize first
  await transport.simulateIncomingMessage(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {},
    }),
  )

  // Clear messages
  transport.clearMessages()

  // Request tool list
  await transport.simulateIncomingMessage(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    }),
  )

  const response = JSON.parse(transport.getLastSentMessage()!)

  assert({
    given: 'a tools/list request',
    should: 'return all registered tools',
    actual: response.result.tools.length,
    expected: 2,
  })

  assert({
    given: 'a tools/list request',
    should: 'include tool names',
    actual: response.result.tools[0].name,
    expected: 'mock_echo',
  })

  assert({
    given: 'a tools/list request',
    should: 'include tool descriptions',
    actual: response.result.tools[0].description,
    expected: 'Mock task that echoes input',
  })

  await server.stop()
})

test('MCPServer - execute tool', async () => {
  const server = MCPServer.createForTesting([MockEchoCommand])
  const transport = new MockTransport()

  await server.start(transport)

  // Initialize
  await transport.simulateIncomingMessage(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {},
    }),
  )

  transport.clearMessages()

  // Call tool
  await transport.simulateIncomingMessage(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'mock_echo',
        arguments: {
          message: 'Hello World',
          uppercase: true,
        },
      },
    }),
  )

  const response = JSON.parse(transport.getLastSentMessage()!)
  const result = JSON.parse(response.result.content[0].text)

  assert({
    given: 'a tool call with uppercase flag',
    should: 'execute successfully',
    actual: result.status,
    expected: 'success',
  })

  assert({
    given: 'a tool call with uppercase flag',
    should: 'return uppercase message',
    actual: result.data.echoed,
    expected: 'HELLO WORLD',
  })

  await server.stop()
})

test('MCPServer - handle tool errors', async () => {
  const server = MCPServer.createForTesting([MockErrorCommand])
  const transport = new MockTransport()

  await server.start(transport)

  // Initialize
  await transport.simulateIncomingMessage(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {},
    }),
  )

  transport.clearMessages()

  // Call tool that fails
  await transport.simulateIncomingMessage(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'mock_error',
        arguments: {
          type: 'fail',
        },
      },
    }),
  )

  const response = JSON.parse(transport.getLastSentMessage()!)
  const result = JSON.parse(response.result.content[0].text)

  assert({
    given: 'a tool that returns failure',
    should: 'have fail status',
    actual: result.status,
    expected: 'fail',
  })

  assert({
    given: 'a tool that returns failure',
    should: 'include failure message',
    actual: result.message,
    expected: 'This is a failure',
  })

  await server.stop()
})

test('MCPServer - validate required arguments', async () => {
  const server = MCPServer.createForTesting([MockEchoCommand])
  const transport = new MockTransport()

  await server.start(transport)

  // Initialize
  await transport.simulateIncomingMessage(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {},
    }),
  )

  transport.clearMessages()

  // Call tool without required argument
  await transport.simulateIncomingMessage(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'mock_echo',
        arguments: {}, // Missing required 'message'
      },
    }),
  )

  const response = JSON.parse(transport.getLastSentMessage()!)

  assert({
    given: 'a tool call missing required arguments',
    should: 'return an error',
    actual: response.error !== undefined,
    expected: true,
  })

  assert({
    given: 'a tool call missing required arguments',
    should: 'have invalid arguments error code',
    actual: response.error?.code,
    expected: -32602,
  })

  await server.stop()
})

test('MCPServer - handle unknown tools', async () => {
  const server = MCPServer.createForTesting([MockEchoCommand])
  const transport = new MockTransport()

  await server.start(transport)

  // Initialize
  await transport.simulateIncomingMessage(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {},
    }),
  )

  transport.clearMessages()

  // Call unknown tool
  await transport.simulateIncomingMessage(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'unknown_tool',
        arguments: {},
      },
    }),
  )

  const response = JSON.parse(transport.getLastSentMessage()!)

  assert({
    given: 'a call to unknown tool',
    should: 'return an error',
    actual: response.error !== undefined,
    expected: true,
  })

  assert({
    given: 'a call to unknown tool',
    should: 'include error message',
    actual: response.error?.message.includes('Unknown tool'),
    expected: true,
  })

  await server.stop()
})

test('MCPServer - handle notifications', async () => {
  const server = MCPServer.createForTesting([MockEchoCommand])
  const transport = new MockTransport()

  await server.start(transport)

  // Initialize
  await transport.simulateIncomingMessage(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {},
    }),
  )

  const messageCountBefore = transport.getSentMessages().length

  // Send notification (no id)
  await transport.simulateIncomingMessage(
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    }),
  )

  const messageCountAfter = transport.getSentMessages().length

  assert({
    given: 'a notification message',
    should: 'not send a response',
    actual: messageCountAfter,
    expected: messageCountBefore, // No new messages
  })

  await server.stop()
})

test('MCPServer - structuredContent in tool response', async () => {
  const server = MCPServer.createForTesting([MockEchoCommand])
  const transport = new MockTransport()

  await server.start(transport)

  // Initialize
  await transport.simulateIncomingMessage(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {},
    }),
  )

  transport.clearMessages()

  // Call tool
  await transport.simulateIncomingMessage(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'mock_echo',
        arguments: {
          message: 'Test',
        },
      },
    }),
  )

  const response = JSON.parse(transport.getLastSentMessage()!)

  assert({
    given: 'a tool call response',
    should: 'include structuredContent field',
    actual: response.result.structuredContent !== undefined,
    expected: true,
  })

  assert({
    given: 'structuredContent field',
    should: 'contain the full result object',
    actual: response.result.structuredContent.status,
    expected: 'success',
  })

  assert({
    given: 'structuredContent field',
    should: 'contain the data field',
    actual: response.result.structuredContent.data.echoed,
    expected: 'Test',
  })

  await server.stop()
})

test('MCPServer - date task schemas include format hints and examples', async () => {
  const server = MCPServer.createForTesting([MockDateCommand])
  const transport = new MockTransport()

  await server.start(transport)

  // Initialize
  await transport.simulateIncomingMessage(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {},
    }),
  )

  transport.clearMessages()

  // Request tool list
  await transport.simulateIncomingMessage(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    }),
  )

  const response = JSON.parse(transport.getLastSentMessage()!)
  const tool = response.result.tools[0]
  const props = tool.inputSchema.properties

  assert({
    given: 'a date task in tools/list',
    should: 'have tool name mock_date',
    actual: tool.name,
    expected: 'mock_date',
  })

  assert({
    given: 'a plainDate param',
    should: 'have format: date',
    actual: props.date.format,
    expected: 'date',
  })

  assert({
    given: 'a plainDate param',
    should: 'include examples',
    actual: Array.isArray(props.date.examples),
    expected: true,
  })

  assert({
    given: 'a plainDateTime param',
    should: 'include examples with time format',
    actual: props.when.examples?.[0]?.includes(' '),
    expected: true,
  })

  assert({
    given: 'a hidden param',
    should: 'not appear in the schema',
    actual: props.hidden,
    expected: undefined,
  })

  await server.stop()
})

test('MCPServer - bearer token authentication with HTTP transport', async () => {
  const server = MCPServer.createForTesting([MockEchoCommand])

  // Use HTTP transport with bearer token
  const { HttpTransport } = await import('../transports/HttpTransport.ts')
  const transport = new HttpTransport({
    port: 8088,
    hostname: 'localhost',
    authToken: 'test-mcp-token-123',
  })

  await server.start(transport)

  // Test without bearer token - should be rejected
  const response1 = await fetch('http://localhost:8088/rpc', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {},
    }),
  })

  await response1.text()

  assert({
    given: 'a request without bearer token',
    should: 'return 401 Unauthorized',
    actual: response1.status,
    expected: 401,
  })

  // Test with correct bearer token - should work
  const response2 = await fetch('http://localhost:8088/rpc', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-mcp-token-123',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {},
    }),
  })

  const data = await response2.json()

  assert({
    given: 'a request with correct bearer token',
    should: 'return 200 OK',
    actual: response2.status,
    expected: 200,
  })

  assert({
    given: 'a request with correct bearer token',
    should: 'return protocol version',
    actual: data.result.protocolVersion,
    expected: '2025-06-18',
  })

  await server.stop()
})

test('MCPServer - bearer token on tools/call endpoint', async () => {
  const server = MCPServer.createForTesting([MockEchoCommand])

  const { HttpTransport } = await import('../transports/HttpTransport.ts')
  const transport = new HttpTransport({
    port: 8089,
    hostname: 'localhost',
    authToken: 'tool-bearer-token',
  })

  await server.start(transport)

  // Initialize first (with auth)
  const initResponse = await fetch('http://localhost:8089/rpc', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer tool-bearer-token',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {},
    }),
  })
  await initResponse.json() // Consume the response

  // Test tools/call without auth - should fail
  const response1 = await fetch('http://localhost:8089/rpc', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'mock_echo',
        arguments: {
          message: 'test',
        },
      },
    }),
  })

  await response1.text()

  assert({
    given: 'a tools/call request without bearer token',
    should: 'return 401 Unauthorized',
    actual: response1.status,
    expected: 401,
  })

  // Test tools/call with auth - should work
  const response2 = await fetch('http://localhost:8089/rpc', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer tool-bearer-token',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'mock_echo',
        arguments: {
          message: 'test',
        },
      },
    }),
  })

  const data = await response2.json()

  assert({
    given: 'a tools/call request with correct bearer token',
    should: 'return 200 OK',
    actual: response2.status,
    expected: 200,
  })

  assert({
    given: 'a tools/call request with correct bearer token',
    should: 'execute the tool and return result',
    actual: data.result.structuredContent.data.echoed,
    expected: 'test',
  })

  await server.stop()
})
