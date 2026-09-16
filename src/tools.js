/**
 * The agent-visible `research_cat` tool.
 *
 * Same four actions as the dynamic-plugin version (search / add / expand /
 * list) and the same text output, so an agent that learned the tool keeps
 * working. Formatting lives here; the engine returns data.
 *
 * @module dsh-research-cat/tools
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { messageOf } from './graph.js'

/** Output contract of the tool. */
const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', required: true },
    text: { type: 'string', required: true },
  },
}

/** One result line per paper: title -- year / venue / citations / id. */
function describePapers(list) {
  const lines = []
  for (let i = 0; i < list.length; i++) {
    const paper = list[i]
    const bits = []
    if (paper.year > 0) bits.push(String(paper.year))
    if (paper.venue !== null) bits.push(paper.venue)
    bits.push(paper.citedBy + ' citations')
    bits.push('id ' + paper.id)
    lines.push((i + 1) + '. ' + paper.title + ' -- ' + bits.join(' / '))
  }
  return lines.join('\n')
}

/** The collection listing plus graph totals. */
function describeCollection(snapshot) {
  const { graph, counts } = snapshot
  if (graph.seeds.length === 0) return 'The collection is empty.'
  const lines = []
  for (let i = 0; i < graph.seeds.length; i++) {
    const id = graph.seeds[i]
    const node = graph.nodes.find((candidate) => candidate.id === id)
    lines.push((i + 1) + '. ' + (node === undefined
      ? id
      : node.title + ' (' + node.year + ') -- ' + node.citedBy + ' citations -- id ' + node.id))
  }
  return 'Collection (' + graph.seeds.length + ' seed(s); graph: ' + counts.papers + ' papers, ' + counts.links +
    ' links -- ' + counts.reference + ' reference / ' + counts.citation + ' citation / ' + counts.related + ' similar):\n' +
    lines.join('\n')
}

/**
 * Build the tool definition bound to one library.
 *
 * @param {ReturnType<import('./graph.js').createLibrary>} library - the engine.
 * @returns {import('@deepseek-ai/dsh-tools').ToolDefinition} the tool.
 */
export function buildAgentTool(library) {
  return defineTool({
    name: 'research_cat',
    description: 'Explore a literature graph in the Research Cat panel. Search OpenAlex for papers, add them to the shared collection, expand a paper into its references / citing papers / similar work, or list the current collection. This tool and the Research Cat panel share one in-memory library, so papers added here appear in the panel and vice versa. Paper ids are OpenAlex work ids such as W2094864959.',
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: ['search', 'add', 'expand', 'list'],
        description: 'search = find papers by title, author, topic or DOI; add = put one paper into the collection; expand = pull one paper neighbours into the graph; list = show the current collection.',
      },
      query: { type: 'string', description: 'Search text for action "search": a title, author, topic, or a DOI.' },
      id: { type: 'string', description: 'OpenAlex work id for action "add" or "expand", for example W2094864959.' },
      kind: {
        type: 'string',
        enum: ['references', 'citations', 'related'],
        description: 'Which neighbours action "expand" pulls: the paper references, the papers citing it, or similar work.',
      },
    },
    output: {
      schema: RESULT_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: value !== null && value !== undefined && typeof value.text === 'string' && value.text !== ''
          ? value.text
          : 'research_cat produced no output.',
      }],
    },
    async execute(args) {
      const input = typeof args === 'object' && args !== null ? args : {}
      const action = typeof input.action === 'string' ? input.action : ''
      try {
        if (action === 'search') {
          const found = await library.search(typeof input.query === 'string' ? input.query : '')
          if (found.results.length === 0) return { ok: true, text: 'No OpenAlex work matched "' + found.term + '".' }
          return { ok: true, text: 'OpenAlex matches for "' + found.term + '":\n' + describePapers(found.results) }
        }
        if (action === 'add') {
          const added = await library.addSeed(typeof input.id === 'string' ? input.id : '')
          return {
            ok: true,
            text: 'Added "' + added.record.title + '" (' + added.record.id + ') to the collection, ' +
              'which now holds ' + added.counts.seeds + ' paper(s); the graph holds ' + added.counts.papers +
              ' node(s) and ' + added.counts.links + ' link(s).',
          }
        }
        if (action === 'expand') {
          const outcome = await library.expand(
            typeof input.id === 'string' ? input.id : '',
            typeof input.kind === 'string' ? input.kind : 'related',
          )
          return {
            ok: true,
            text: 'Expanded ' + input.id + ' by ' + outcome.kind + ': ' + outcome.found + ' neighbour(s) found, ' +
              outcome.added + ' new node(s) added. The graph now holds ' + outcome.counts.papers + ' node(s).',
          }
        }
        if (action === 'list') {
          return { ok: true, text: describeCollection(library.snapshot()) }
        }
        return { ok: false, text: 'Unknown action "' + action + '". Use search, add, expand, or list.' }
      } catch (error) {
        return { ok: false, text: 'research_cat failed: ' + messageOf(error) }
      }
    },
  })
}
