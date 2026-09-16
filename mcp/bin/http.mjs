#!/usr/bin/env node
// Streamable HTTP entry point: for remote clients that cannot run a local process,
// which is the only way a cloud assistant such as ChatGPT can reach an MCP server.
//
//   PORT=8787 MCP_PATH=/mcp node bin/http.mjs
//
// Every MCP session gets its own collection and graph, so concurrent users never
// share state. Point your tunnel / reverse proxy at this port and use the public
// HTTPS URL plus MCP_PATH as the connector URL.

import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createServer } from '../src/server.mjs'

const PORT = Number(process.env.PORT || process.env.MCP_PORT || 8787)
const HOST = process.env.HOST || '127.0.0.1'
const PATH = process.env.MCP_PATH || '/mcp'
const JSON_RESPONSE = process.env.MCP_JSON_RESPONSE === '1'
const ALLOW_ORIGIN = process.env.MCP_ALLOW_ORIGIN || '*'

const sessions = new Map()

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (raw.length === 0) return resolve(undefined)
      try {
        resolve(JSON.parse(raw))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function rpcError(res, status, code, message) {
  if (res.headersSent) return
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }))
}

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'))

  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, name: 'research-cat-mcp', sessions: sessions.size }))
    return
  }
  if (url.pathname !== PATH) {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found: MCP endpoint is ' + PATH + '\n')
    return
  }

  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN)
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'content-type, mcp-session-id, mcp-protocol-version, authorization, last-event-id')
  res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id')
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  try {
    if (req.method === 'POST') {
      const header = req.headers['mcp-session-id']
      const sessionId = Array.isArray(header) ? header[0] : header
      let transport = sessionId === undefined ? undefined : sessions.get(sessionId)

      if (transport === undefined) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableJsonResponse: JSON_RESPONSE,
          onsessioninitialized: (id) => {
            sessions.set(id, transport)
            process.stderr.write('research-cat-mcp: session ' + id + ' opened (' + sessions.size + ' active)\n')
          },
        })
        transport.onclose = () => {
          const id = transport.sessionId
          if (id !== undefined) {
            sessions.delete(id)
            process.stderr.write('research-cat-mcp: session ' + id + ' closed (' + sessions.size + ' active)\n')
          }
        }
        const { server } = createServer()
        await server.connect(transport)
      }

      const body = await readJsonBody(req)
      await transport.handleRequest(req, res, body)
      return
    }

    if (req.method === 'GET' || req.method === 'DELETE') {
      const header = req.headers['mcp-session-id']
      const sessionId = Array.isArray(header) ? header[0] : header
      const transport = sessionId === undefined ? undefined : sessions.get(sessionId)
      if (transport === undefined) {
        rpcError(res, 400, -32000, 'Missing or unknown mcp-session-id')
        return
      }
      await transport.handleRequest(req, res)
      return
    }

    res.writeHead(405, { 'content-type': 'text/plain' })
    res.end('method not allowed\n')
  } catch (error) {
    rpcError(res, 500, -32603, String(error && error.message ? error.message : error))
  }
})

httpServer.listen(PORT, HOST, () => {
  process.stderr.write('research-cat-mcp: HTTP listening on http://' + HOST + ':' + PORT + PATH + '\n')
})

const shutdown = () => {
  httpServer.close(() => process.exit(0))
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
