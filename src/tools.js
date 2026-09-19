/**
 * The agent-visible `research_cat` tool.
 *
 * Same four original actions (search / add / expand / list) with the same text
 * contract, plus four new ones (collections / recent / annotate / export). The
 * `RESULT_SCHEMA` (`{ok, text}`) and the original wording are frozen by
 * docs/rr-parity-spec.md §6.2 / AC-A0-3, so the new arguments are additive and
 * the old calls keep their exact behaviour.
 *
 * @module dsh-research-cat/tools
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { COLOR_CHOICES, messageOf } from './graph.js'

/** Output contract of the tool. */
const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', required: true },
    text: { type: 'string', required: true },
  },
}

/** BibTeX text is truncated in the tool view past this many characters. */
const EXPORT_TEXT_LIMIT = 8000

/**
 * Truncate a BibTeX document on an entry boundary so the tool view never hands
 * back a half entry (spec AC-A7-10).
 */
function truncateBibtex(text, limit) {
  if (text.length <= limit) return text
  const head = text.slice(0, limit)
  const boundary = head.lastIndexOf('\n}')
  const cut = boundary > 0 ? boundary + 2 : head.length
  return head.slice(0, cut) + '\n... (truncated; use the panel export for the complete file)'
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

/** Indented collection tree, newest child last. */
function describeCollections(collections) {
  if (collections.length === 0) return 'No collection yet.'
  const byParent = new Map()
  for (let i = 0; i < collections.length; i++) {
    const parent = collections[i].parentId === null ? '' : collections[i].parentId
    if (byParent.has(parent) !== true) byParent.set(parent, [])
    byParent.get(parent).push(collections[i])
  }
  const lines = []
  const walk = (parentId, depth) => {
    const children = byParent.get(parentId) === undefined ? [] : byParent.get(parentId)
    for (let i = 0; i < children.length; i++) {
      const collection = children[i]
      lines.push('  '.repeat(depth) + '- ' + collection.name + ' [' + collection.id + ']' +
        (collection.system === true ? ' (system)' : '') +
        ' -- ' + collection.itemCount + ' item(s), ' + collection.itemCountDeep + ' in subtree')
      walk(collection.id, depth + 1)
    }
  }
  walk('', 0)
  return 'Collections (' + collections.length + '):\n' + lines.join('\n')
}

/** One line per Recently Found entry. */
function describeRecent(ids, records) {
  if (ids.length === 0) return 'Recently Found is empty.'
  const lines = []
  for (let i = 0; i < ids.length; i++) {
    const record = records[ids[i]]
    if (record === undefined) {
      lines.push((i + 1) + '. ' + ids[i])
      continue
    }
    lines.push((i + 1) + '. ' + record.title + ' (' + record.year + ') -- ' + record.citedBy + ' citations -- id ' + record.id)
  }
  return 'Recently Found (' + ids.length + '):\n' + lines.join('\n')
}

/** Note excerpt + tags + colour for one annotation. */
function describeAnnotation(annotation) {
  const note = annotation.note === '' ? '(empty)' : JSON.stringify(annotation.note.length > 120 ? annotation.note.slice(0, 120) + '...' : annotation.note)
  const tags = annotation.tags.length === 0 ? '(none)' : annotation.tags.join(', ')
  return 'Annotation for ' + annotation.id + ': note ' + note + '; tags ' + tags + '; color ' +
    (annotation.color === null ? '(none)' : annotation.color) + '.'
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
    description: 'Explore a literature graph in the Research Cat panel. Search OpenAlex for papers, add them to the collection, expand a paper into its references / citing papers / similar work / earlier work / later work / one author\'s work, organise the library into collections, keep notes, tags and colours, or export BibTeX. This tool and the Research Cat panel use one library, so papers added here appear in the panel and vice versa. Paper ids are OpenAlex work ids such as W2094864959; author ids look like A5023821363.',
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: ['search', 'add', 'expand', 'list', 'collections', 'recent', 'annotate', 'export'],
        description: 'search = find papers by title, author, topic or DOI; add = put one paper into the collection; expand = pull one paper neighbours into the graph; list = show the current collection; collections = list/create/rename/delete collections and save/remove papers; recent = Recently Found list/clear/promote; annotate = read or write a note, tags and colour; export = BibTeX.',
      },
      query: { type: 'string', description: 'Search text for action "search": a title, author, topic, or a DOI.' },
      id: { type: 'string', description: 'OpenAlex work id for action "add", "expand", "annotate" or "export", for example W2094864959.' },
      kind: {
        type: 'string',
        enum: ['references', 'citations', 'related', 'earlier', 'later', 'author'],
        description: 'Which neighbours action "expand" pulls: references, citing papers, similar work, earlier work, later work, or the work of one author (needs authorId).',
      },
      authorId: { type: 'string', description: 'OpenAlex author id (A...) for action "expand" with kind "author".' },
      filters: {
        type: 'object',
        additionalProperties: true,
        description: 'Optional result filters: yearFrom, yearTo, venue, isOa, isRetracted, minCitations, sort ("cited" or "year").',
      },
      op: { type: 'string', description: 'Sub-operation for action "collections" (list/create/rename/delete/save/remove) or "recent" (list/clear/promote).' },
      name: { type: 'string', description: 'Collection name for action "collections" with op create or rename.' },
      parentId: { type: 'string', description: 'Parent collection id for action "collections" with op create.' },
      collectionId: { type: 'string', description: 'Target collection id for action "collections" (save/remove), "recent" (promote) or "export".' },
      ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Work ids for action "collections" with op save/remove, "recent" with op promote, or "export".',
      },
      note: { type: 'string', description: 'Note text for action "annotate"; an empty string clears it.' },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Tags for action "annotate" (at most 20 tags of 40 characters).',
      },
      color: {
        type: 'string',
        enum: [...COLOR_CHOICES, 'none'],
        description: 'Colour label for action "annotate"; "none" clears it.',
      },
      format: { type: 'string', enum: ['bibtex'], description: 'Export format for action "export"; only "bibtex" is supported.' },
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
          const found = await library.search(typeof input.query === 'string' ? input.query : '', input.filters, input.page)
          if (found.results.length === 0) return { ok: true, text: 'No OpenAlex work matched "' + found.term + '".' }
          const base = 'OpenAlex matches for "' + found.term + '":\n' + describePapers(found.results)
          if (found.considered !== found.results.length) {
            return { ok: true, text: base + '\n(' + found.results.length + ' of ' + found.considered + ' candidates passed the filters.)' }
          }
          return { ok: true, text: base }
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
            { authorId: typeof input.authorId === 'string' ? input.authorId : undefined, filters: input.filters },
          )
          let text = 'Expanded ' + input.id + ' by ' + outcome.kind + ': ' + outcome.found + ' neighbour(s) found, ' +
            outcome.added + ' new node(s) added. The graph now holds ' + outcome.counts.papers + ' node(s).'
          if (outcome.note !== null && outcome.note !== undefined) text += ' ' + outcome.note + '.'
          return { ok: true, text: text }
        }
        if (action === 'list') {
          return { ok: true, text: describeCollection(library.snapshot()) }
        }
        if (action === 'collections') {
          const outcome = library.collections({
            op: typeof input.op === 'string' ? input.op : 'list',
            id: typeof input.id === 'string' ? input.id : undefined,
            name: typeof input.name === 'string' ? input.name : undefined,
            parentId: typeof input.parentId === 'string' ? input.parentId : undefined,
            collectionId: typeof input.collectionId === 'string' ? input.collectionId : undefined,
            ids: input.ids,
          })
          if (outcome.collection !== undefined && outcome.collections !== undefined && typeof input.op === 'string' && input.op !== 'list') {
            const extra = outcome.saved !== undefined
              ? ' Saved ' + outcome.saved.length + ', skipped ' + outcome.skipped.length + '.'
              : outcome.removed !== undefined
                ? ' Removed ' + outcome.removed.length + ', skipped ' + outcome.skipped.length + '.'
                : ''
            return { ok: true, text: describeCollections(outcome.collections) + '\nTarget: ' + outcome.collection.name + ' [' + outcome.collection.id + ']' + extra }
          }
          return { ok: true, text: describeCollections(outcome.collections) }
        }
        if (action === 'recent') {
          const outcome = library.recentlyFound({
            op: typeof input.op === 'string' ? input.op : 'list',
            ids: input.ids,
            collectionId: typeof input.collectionId === 'string' ? input.collectionId : undefined,
          })
          const records = library.snapshot().library.records
          const base = describeRecent(outcome.recentlyFound, records)
          if (outcome.promoted !== undefined) {
            return { ok: true, text: base + '\nPromoted ' + outcome.promoted.length + ' paper(s), skipped ' + outcome.skipped.length + '.' }
          }
          return { ok: true, text: base }
        }
        if (action === 'annotate') {
          const patch = { id: typeof input.id === 'string' ? input.id : '' }
          if (typeof input.note === 'string') patch.note = input.note
          if (Array.isArray(input.tags)) patch.tags = input.tags
          if (typeof input.color === 'string') patch.color = input.color === 'none' ? null : input.color
          const outcome = library.annotate(patch)
          return { ok: true, text: describeAnnotation(outcome.annotation) }
        }
        if (action === 'export') {
          const outcome = library.export({
            format: typeof input.format === 'string' ? input.format : 'bibtex',
            ids: input.ids,
            collectionId: typeof input.collectionId === 'string' ? input.collectionId : undefined,
          })
          const head = 'BibTeX export: ' + outcome.count + ' entr' + (outcome.count === 1 ? 'y' : 'ies') + '.\n'
          return { ok: true, text: head + truncateBibtex(outcome.bibtex, EXPORT_TEXT_LIMIT) }
        }
        return { ok: false, text: 'Unknown action "' + action + '". Use search, add, expand, list, collections, recent, annotate, or export.' }
      } catch (error) {
        return { ok: false, text: 'research_cat failed: ' + messageOf(error) }
      }
    },
  })
}
