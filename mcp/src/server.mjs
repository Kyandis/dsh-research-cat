import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { createLibrary } from './core.mjs'

const INSTRUCTIONS = [
  'Research Cat explores the literature around a topic using the OpenAlex public API (no key required).',
  'Typical flow:',
  '1. search_papers with a topic, author, title or DOI. Results list OpenAlex work ids such as W2094864959.',
  '2. add_paper for the papers worth keeping. They form the collection (the seeds of the graph).',
  '3. expand_paper on a paper to pull its references, the papers citing it, or OpenAlex "similar work".',
  '4. list_collection to see the collection and graph totals; paper_details for authors and the abstract.',
  'The collection and graph live in memory for this session only: they are never written to disk and are lost when the session ends. expand_paper pulls at most 30 references or similar works, and the 25 most cited citing papers; a graph holds at most 400 papers.',
].join('\n')

export function createServer() {
  const library = createLibrary()
  const server = new McpServer(
    { name: 'research-cat', version: '1.0.0' },
    { instructions: INSTRUCTIONS },
  )

  // The DSH plugin returns { ok, text }; map that onto an MCP tool result.
  const reply = (result) => ({
    content: [{ type: 'text', text: result.text }],
    isError: result.ok === false,
  })

  server.registerTool('search_papers', {
    title: 'Search papers',
    description: 'Search OpenAlex by title, author, topic or DOI. Returns up to 20 matches with year, venue, citation count and the OpenAlex work id needed by the other tools.',
    inputSchema: {
      query: z.string().describe('A title, author name, topic, or a DOI such as 10.1109/5.726791.'),
    },
  }, async ({ query }) => reply(await library.search(query)))

  server.registerTool('add_paper', {
    title: 'Add a paper to the collection',
    description: 'Add one OpenAlex work id to the collection. Collected papers become the seeds of the citation graph.',
    inputSchema: {
      id: z.string().describe('OpenAlex work id, for example W2094864959.'),
    },
  }, async ({ id }) => reply(await library.add(id)))

  server.registerTool('expand_paper', {
    title: 'Expand a paper into its neighbours',
    description: 'Pull a paper neighbours into the graph: the works it references, the works citing it, or the work OpenAlex considers similar. At most 30 references / similar works, and the 25 most cited citing papers.',
    inputSchema: {
      id: z.string().describe('OpenAlex work id, for example W2094864959.'),
      kind: z.enum(['references', 'citations', 'related']).optional()
        .describe('references = the works this paper cites; citations = the works citing it; related = OpenAlex similar work. Defaults to related.'),
    },
  }, async ({ id, kind }) => reply(await library.expand(id, kind)))

  server.registerTool('paper_details', {
    title: 'Read one paper',
    description: 'Full record for one paper: title, authors, venue, year, citation count, DOI, OpenAlex link and the abstract (rebuilt from the OpenAlex inverted index when available).',
    inputSchema: {
      id: z.string().describe('OpenAlex work id, for example W2094864959.'),
    },
  }, async ({ id }) => reply(await library.details(id)))

  server.registerTool('list_collection', {
    title: 'List the collection',
    description: 'List the collected papers plus the size of the graph and its reference / citation / similar link counts.',
    inputSchema: {},
  }, async () => reply(await library.list()))

  server.registerTool('clear_collection', {
    title: 'Clear the collection and graph',
    description: 'Drop every collected paper and the whole graph for this session.',
    inputSchema: {},
  }, async () => reply(await library.clear()))

  return { server, library }
}
