// End-to-end smoke test over Streamable HTTP: this is the transport a cloud
// assistant such as ChatGPT must use, since it cannot run a local process.
//
// It also proves the per-session state design: two independent sessions must not
// see each other's collection.
import { spawn } from 'node:child_process'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const serverPath = resolve(here, '../bin/http.mjs')
const PORT = Number(process.env.SMOKE_PORT || 8799)
const BASE = 'http://127.0.0.1:' + PORT

let failures = 0
function check(label, condition, detail) {
  if (condition) {
    console.log('  PASS ' + label)
  } else {
    failures++
    console.log('  FAIL ' + label + (detail === undefined ? '' : ' -> ' + detail))
  }
}

const child = spawn(process.execPath, [serverPath], {
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
  stdio: ['ignore', 'ignore', 'pipe'],
})
let serverLog = ''
child.stderr.on('data', (chunk) => { serverLog += chunk.toString() })

async function waitForHealth() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(BASE + '/health')
      if (res.ok) return await res.json()
    } catch (error) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('HTTP server never became healthy. stderr:\n' + serverLog)
}

const text = (result) => (result.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n')

try {
  const health = await waitForHealth()
  check('health endpoint answers', health.ok === true && health.name === 'research-cat-mcp', JSON.stringify(health))

  const clientA = new Client({ name: 'smoke-http-a', version: '1.0.0' })
  await clientA.connect(new StreamableHTTPClientTransport(new URL(BASE + '/mcp')))
  console.log('session A connected over streamable HTTP')

  const tools = await clientA.listTools()
  check('six tools exposed over HTTP', tools.tools.length === 6, String(tools.tools.length))

  const search = await clientA.callTool({ name: 'search_papers', arguments: { query: '10.1109/5.726791' } })
  check('DOI search resolves a work', /OpenAlex matches for|Added/.test(text(search)) || /10\.1109/.test(text(search)), text(search).slice(0, 140))

  const add = await clientA.callTool({ name: 'add_paper', arguments: { id: 'W2907492528' } })
  check('session A collects a paper', /Added "/.test(text(add)), text(add))
  const listA = await clientA.callTool({ name: 'list_collection', arguments: {} })
  check('session A sees its own collection', /Collection \(1 seed/.test(text(listA)), text(listA).slice(0, 120))

  // A second, independent session must start empty.
  const clientB = new Client({ name: 'smoke-http-b', version: '1.0.0' })
  await clientB.connect(new StreamableHTTPClientTransport(new URL(BASE + '/mcp')))
  console.log('session B connected over streamable HTTP')
  const listB = await clientB.callTool({ name: 'list_collection', arguments: {} })
  check('session B is isolated (empty)', /empty/i.test(text(listB)), text(listB))
  const addB = await clientB.callTool({ name: 'add_paper', arguments: { id: 'W2116341502' } })
  check('session B collects its own paper', /Added "/.test(text(addB)), text(addB))
  const listA2 = await clientA.callTool({ name: 'list_collection', arguments: {} })
  check('session A still sees exactly one seed', /Collection \(1 seed/.test(text(listA2)), text(listA2).slice(0, 120))

  check('unknown path is 404', (await fetch(BASE + '/nope')).status === 404)
  check('GET without a session id is refused', (await fetch(BASE + '/mcp')).status === 400)

  await clientA.close()
  await clientB.close()
} finally {
  child.kill('SIGTERM')
}

console.log(failures === 0 ? '\nhttp smoke: all checks passed' : '\nhttp smoke: ' + failures + ' check(s) FAILED')
process.exit(failures === 0 ? 0 : 1)
