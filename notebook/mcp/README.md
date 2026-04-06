# MCP Integration for Notebook Tasks

This directory contains the MCP (Model Context Protocol) server that exposes notebook tasks as tools for Claude.

## How It Works

1. **Decorator-based opt-in**: Tasks are exposed to MCP by adding the `@MCPTool()` decorator
2. **Automatic discovery**: The server scans all tasks and registers decorated ones
3. **Schema generation**: Tool schemas are automatically generated from `TaskDescription`
4. **Name mapping**: Task names like `meeting:new` become MCP tools like `meeting_new`

## Setup

### 1. Decorate Tasks

Add the `@MCPTool()` decorator to any task you want to expose:

```typescript
import { MCPTool } from '#/mcp/decorators.ts'

@MCPTool()
export default class MeetingNewTask extends Task {
  // ... existing task code
}
```

### 2. Configure Claude Desktop

Add to your Claude Desktop settings (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "notebook": {
      "command": "/path/to/notebook/mcp/server.ts",
      "args": [],
      "env": {
        "NB_DIR": "~/Sky",
        "NB_CODE_DIR": "~/path/to/sky"
      }
    }
  }
}
```

Or use the `nb` command:

```json
{
  "mcpServers": {
    "notebook": {
      "command": "nb",
      "args": ["mcp:start"],
      "env": {
        "NB_DIR": "~/Sky",
        "NB_CODE_DIR": "~/path/to/sky"
      }
    }
  }
}
```

### 3. Test the Server

Run the server manually to see registered tools:

```bash
nb mcp:start
```

## Currently Exposed Tasks

- `meeting:new` - Create a new meeting note

## Architecture

- `decorators.ts` - Simple decorator for marking tasks
- `adapter.ts` - Converts between TaskDescription and MCP schemas
- `server.ts` - MCP server implementation
- `start.ts` - Launch task for the server

## Security Considerations

- The server runs locally via stdio transport
- No network exposure by default
- Tasks execute with full filesystem access
- Future: ngrok integration for temporary remote access

## Adding New Tasks

1. Add `@MCPTool()` to the task class
2. Restart Claude Desktop to reload MCP servers
3. The task will appear as a tool in Claude

## Limitations

- Only tasks using the `Task` class can be decorated
- Complex task arguments may need manual schema adjustments
- Async iterators for progress not yet supported