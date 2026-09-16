#!/usr/bin/env node
// stdio entry point: for local MCP clients such as Codex CLI, Claude Code and Cursor.
//
// stdout carries the JSON-RPC protocol and must stay clean, so every diagnostic
// goes to stderr.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createServer } from '../src/server.mjs'

const { server } = createServer()
const transport = new StdioServerTransport()
await server.connect(transport)

process.stderr.write('research-cat-mcp: ready on stdio\n')

const shutdown = async () => {
  try {
    await server.close()
  } catch (error) {
    process.stderr.write('research-cat-mcp: shutdown error ' + String(error && error.message || error) + '\n')
  }
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
