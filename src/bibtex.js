/**
 * BibTeX rendering for the Research Cat library.
 *
 * Pure functions only — no IO, no dependency. The parser lives in the tests
 * (`test/parity.mjs`): importing BibTeX is C1 in the frozen spec and must not
 * ship a route, tool action or parser in `src/`.
 *
 * Fixed contract (spec A7):
 * - type map: journal-article→@article, book→@book, book-chapter→@incollection,
 *   proceedings-article→@inproceedings, dataset→@misc, anything else→@misc;
 * - every entry carries `title` and `year`;
 * - `author` is joined with ` and ` and omitted entirely when unknown;
 * - every entry carries `doi` when known and always `url`;
 * - citation keys are unique and deterministic for a given input;
 * - LaTeX specials are escaped, non-ASCII stays as-is.
 *
 * @module dsh-research-cat/bibtex
 */

/** OpenAlex type -> BibTeX entry type. */
const TYPE_MAP = {
  'journal-article': 'article',
  book: 'book',
  'book-chapter': 'incollection',
  'proceedings-article': 'inproceedings',
  dataset: 'misc',
}

/** Where the venue name goes, per BibTeX entry type. */
const VENUE_FIELD = {
  article: 'journal',
  inproceedings: 'booktitle',
  incollection: 'publisher',
  book: 'publisher',
}

/** Escape LaTeX specials in one field value; UTF-8 passes through untouched. */
export function escapeLatex(value) {
  if (value === null || value === undefined) return ''
  return String(value).replace(/[\\&%$#_{}~^]/g, (character) => {
    if (character === '\\') return '\\textbackslash{}'
    if (character === '~') return '\\textasciitilde{}'
    if (character === '^') return '\\textasciicircum{}'
    return '\\' + character
  })
}

/** @param {unknown} kind @returns {string} the BibTeX entry type. */
export function bibtexTypeOf(kind) {
  if (typeof kind !== 'string') return 'misc'
  const mapped = TYPE_MAP[kind]
  return mapped === undefined ? 'misc' : mapped
}

/** Last name of the first author, ASCII-folded, or `anon`. */
function firstAuthorToken(record) {
  const authors = Array.isArray(record.authors) ? record.authors : []
  if (authors.length === 0) return 'anon'
  const name = String(authors[0]).trim()
  if (name === '') return 'anon'
  const parts = name.split(/\s+/)
  const last = parts[parts.length - 1]
  const token = last.toLowerCase().replace(/[^a-z0-9]/g, '')
  return token === '' ? 'anon' : token
}

/**
 * Citation key for one record. `smith2020` when unambiguous; colliding
 * author/year pairs get the work id appended so the key stays unique and
 * deterministic (spec AC-A7-5).
 *
 * @param {any} record - one library record.
 * @param {Set<string>} used - keys already emitted in this document.
 * @returns {string} the citation key.
 */
export function citationKeyOf(record, used) {
  const year = typeof record.year === 'number' && record.year > 0 ? String(record.year) : 'nd'
  const base = firstAuthorToken(record) + year
  const taken = used !== undefined && used !== null ? used : new Set()
  if (taken.has(base) !== true) { taken.add(base); return base }
  const unique = base + String(record.id)
  taken.add(unique)
  return unique
}

/** One record -> one BibTeX entry. */
export function bibtexEntryOf(record, used) {
  const type = bibtexTypeOf(record.kind)
  const key = citationKeyOf(record, used)
  const lines = ['@' + type + '{' + key + ',']
  lines.push('  title = {' + escapeLatex(record.title) + '},')
  const authors = Array.isArray(record.authors) ? record.authors.filter((name) => typeof name === 'string' && name !== '') : []
  if (authors.length > 0) lines.push('  author = {' + authors.map(escapeLatex).join(' and ') + '},')
  lines.push('  year = {' + (typeof record.year === 'number' && record.year > 0 ? String(record.year) : '') + '},')
  const venue = typeof record.venue === 'string' && record.venue !== '' ? record.venue : null
  const venueField = VENUE_FIELD[type]
  if (venue !== null && venueField !== undefined) lines.push('  ' + venueField + ' = {' + escapeLatex(venue) + '},')
  if (typeof record.doi === 'string' && record.doi !== '') lines.push('  doi = {' + escapeLatex(record.doi) + '},')
  lines.push('  url = {https://openalex.org/' + record.id + '},')
  lines.push('}')
  return lines.join('\n')
}

/**
 * Render an ordered list of records as one BibTeX document.
 *
 * @param {any[]} records - ordered library records.
 * @returns {string} the BibTeX text (a comment-only document when empty).
 */
export function bibtexOf(records) {
  const list = Array.isArray(records) ? records : []
  const used = new Set()
  const entries = []
  for (let i = 0; i < list.length; i++) {
    if (list[i] === null || list[i] === undefined) continue
    entries.push(bibtexEntryOf(list[i], used))
  }
  const header = '% dsh-research-cat BibTeX export (' + entries.length + ' entr' + (entries.length === 1 ? 'y' : 'ies') + ')'
  return entries.length === 0 ? header + '\n' : header + '\n\n' + entries.join('\n\n') + '\n'
}
