// End-to-end smoke test over stdio: spawns the real server, talks MCP to it and
// exercises every tool against the live OpenAlex API.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const serverPath = resolve(here, '../bin/stdio.mjs')

let failures = 0
function check(label, condition, detail) {
  if (condition) {
    console.log('  PASS ' + label)
  } else {
    failures++
    console.log('  FAIL ' + label + (detail === undefined ? '' : ' -> ' + detail))
  }
}

const transport = new StdioClientTransport({ command: process.execPath, args: [serverPath] })
const client = new Client({ name: 'research-cat-smoke', version: '1.0.0' })
await client.connect(transport)
console.log('connected over stdio')

const text = (result) => (result.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n')

const tools = await client.listTools()
const names = tools.tools.map((t) => t.name).sort()
check('six tools exposed', names.length === 6, names.join(','))
check('tool names', names.join(',') === 'add_paper,clear_collection,expand_paper,list_collection,paper_details,search_papers', names.join(','))
check('search_papers has an input schema', JSON.stringify(tools.tools.find((t) => t.name === 'search_papers').inputSchema).includes('query'))
check('instructions are advertised', typeof client.getInstructions() === 'string' && client.getInstructions().length > 0)

const empty = await client.callTool({ name: 'list_collection', arguments: {} })
check('fresh collection is empty', /empty/i.test(text(empty)), text(empty))

const search = await client.callTool({ name: 'search_papers', arguments: { query: 'graph neural networks' } })
check('search returns OpenAlex matches', /OpenAlex matches for/.test(text(search)), text(search).slice(0, 120))
check('search results carry work ids', /id W\d+/.test(text(search)))

const badSearch = await client.callTool({ name: 'search_papers', arguments: { query: '   ' } })
check('blank query is rejected', badSearch.isError === true, text(badSearch))

const add = await client.callTool({ name: 'add_paper', arguments: { id: 'W2907492528' } })
check('add_paper collects the paper', /Added "/.test(text(add)), text(add))

const addBad = await client.callTool({ name: 'add_paper', arguments: { id: 'nope' } })
check('bad work id is rejected', addBad.isError === true, text(addBad))

const expand = await client.callTool({ name: 'expand_paper', arguments: { id: 'W2907492528', kind: 'references' } })
check('expand_paper pulls references', /neighbour\(s\) found/.test(text(expand)) && /new node\(s\) added/.test(text(expand)), text(expand))

const again = await client.callTool({ name: 'expand_paper', arguments: { id: 'W2907492528', kind: 'references' } })
check('re-expanding adds nothing (dedup holds)', /0 new node\(s\) added/.test(text(again)), text(again))

const details = await client.callTool({ name: 'paper_details', arguments: { id: 'W2907492528' } })
const detailText = text(details)
check('paper_details returns the record', /citations/.test(detailText) && /openalex: https:\/\/openalex\.org\/W2907492528/.test(detailText), detailText.slice(0, 160))

const listed = await client.callTool({ name: 'list_collection', arguments: {} })
check('list_collection reports the graph', /Collection \(1 seed/.test(text(listed)) && /reference/.test(text(listed)), text(listed).slice(0, 160))

const cleared = await client.callTool({ name: 'clear_collection', arguments: {} })
check('clear_collection empties the graph', /Cleared/.test(text(cleared)), text(cleared))
const afterClear = await client.callTool({ name: 'list_collection', arguments: {} })
check('collection is empty again', /empty/i.test(text(afterClear)), text(afterClear))

await client.close()
console.log(failures === 0 ? '\nstdio smoke: all checks passed' : '\nstdio smoke: ' + failures + ' check(s) FAILED')
process.exit(failures === 0 ? 0 : 1)
