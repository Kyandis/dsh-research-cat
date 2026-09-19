/**
 * The Research Cat engine: OpenAlex access, the in-memory citation graph and
 * the persistent library (collections / Recently Found / annotations).
 *
 * Two layers, deliberately split (docs/rr-parity-design.md §2.6):
 *
 * - the **library** (records, collections, memberships, Recently Found,
 *   annotations) is persisted through {@link createStore} — it survives a
 *   restart;
 * - the **graph** (nodes + links) is in memory only — after a restart the
 *   library is there and the graph is empty, exactly as before this round.
 *
 * Operations return plain data and throw on failure. The HTTP routes hand the
 * data to the panel and the agent tool formats it as text — one engine, two
 * consumers. Network access goes through the single {@link getJson} exit so
 * the URL cache, the polite-pool `mailto`, the concurrency ceiling, the
 * timeout and the single retry apply to every query.
 *
 * @module dsh-research-cat/graph
 */

import { bibtexOf } from './bibtex.js'
import {
  ANNOTATION_LIMIT,
  MEMBERSHIP_LIMIT,
  RECENT_LIMIT,
  RECORD_LIMIT,
  SEEDS_ID,
  createStore,
  emptyLibrary,
} from './store.js'

const OA = 'https://api.openalex.org'
const RECORD_SELECT = 'id,doi,title,display_name,publication_year,cited_by_count,type,primary_location,open_access,is_retracted'
const DETAIL_SELECT = 'id,doi,title,publication_year,cited_by_count,type,authorships,primary_location,abstract_inverted_index,referenced_works,related_works,open_access,is_retracted'
const EDGE_SELECT = 'id,referenced_works,related_works'
const CACHE_LIMIT = 1000
const ID_CHUNK = 50
const REQUEST_TIMEOUT_MS = 8000

/** The frozen expansion axes (spec §6.1). */
export const EXPAND_KINDS = ['references', 'citations', 'related', 'earlier', 'later', 'author']

/** The frozen filter keys (spec §6.1). */
export const FILTER_KEYS = ['yearFrom', 'yearTo', 'venue', 'isOa', 'isRetracted', 'minCitations', 'sort']

/** The frozen colour choices (spec AC-B4-4). */
export const COLOR_CHOICES = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray']

/** Note length ceiling (spec AC-B4-2). */
export const NOTE_LIMIT = 10000

/** Tag count / length ceilings (spec AC-B4-3). */
export const TAG_LIMIT = 20
export const TAG_LENGTH = 40

/** @param {unknown} value @returns {boolean} */
function hasText(value) {
  return typeof value === 'string' && value.length > 0
}

/** @param {unknown} value @returns {string | null} */
function nullIfEmpty(value) {
  return hasText(value) ? value : null
}

/** @param {unknown} error @returns {string} */
export function messageOf(error) {
  if (error !== null && error !== undefined && hasText(error.message)) return String(error.message)
  return String(error)
}

/** An argument-level failure: the route answers HTTP 400 with code `invalid`. */
function invalidError(message) {
  const error = new Error(message)
  error.code = 'invalid'
  return error
}

/** An operation-level failure: the route answers 200 with code `operation`. */
function operationError(message, retryable) {
  const error = new Error(message)
  error.code = 'operation'
  if (retryable === true) error.retryable = true
  return error
}

/** Strip the OpenAlex URL prefix: `https://openalex.org/W123` -> `W123`. */
function shortId(value) {
  if (value === null || value === undefined) return ''
  return String(value).replace(/^https?:\/\/openalex\.org\//, '')
}

/** @param {string} id @returns {boolean} */
function isWorkId(id) {
  return /^W\d+$/.test(id)
}

/** @param {string} id @returns {boolean} */
function isAuthorId(id) {
  return /^A\d+$/.test(id)
}

/** Pull a bare DOI out of a free-text query, or null. */
function doiIn(query) {
  const match = String(query).match(/10\.\d{4,9}\/[^\s"'<>]+/)
  if (match === null) return null
  return match[0].replace(/[.,;)]+$/, '')
}

/** Strip the ORCID URL prefix: `https://orcid.org/0000-...` -> `0000-...`. */
function shortOrcid(value) {
  if (!hasText(value)) return null
  return String(value).replace(/^https?:\/\/orcid\.org\//, '')
}

/** Journal / venue name from `primary_location.source.display_name`. */
function venueOf(work) {
  const location = work.primary_location
  if (location === null || typeof location !== 'object') return null
  const source = location.source
  if (source === null || typeof source !== 'object') return null
  return nullIfEmpty(source.display_name)
}

/** OpenAlex author ids from `authorships`; empty for list-shaped responses. */
function authorIdsOf(work) {
  const list = work.authorships
  if (!Array.isArray(list)) return []
  const ids = []
  for (let i = 0; i < list.length; i++) {
    const entry = list[i]
    const author = entry === null || typeof entry !== 'object' ? null : entry.author
    const id = author === null || typeof author !== 'object' ? '' : shortId(author.id)
    if (isAuthorId(id) && ids.indexOf(id) < 0) ids.push(id)
  }
  return ids
}

/** Normalise one OpenAlex work into a graph record. */
function recordOf(work) {
  const openAccess = work.open_access
  return {
    id: shortId(work.id),
    title: nullIfEmpty(work.title) || nullIfEmpty(work.display_name) || '(untitled)',
    year: typeof work.publication_year === 'number' ? work.publication_year : 0,
    citedBy: typeof work.cited_by_count === 'number' ? work.cited_by_count : 0,
    doi: nullIfEmpty(work.doi),
    venue: venueOf(work),
    kind: nullIfEmpty(work.type),
    openAccess: openAccess !== null && typeof openAccess === 'object' && openAccess.is_oa === true,
    retracted: work.is_retracted === true,
    authorIds: authorIdsOf(work),
    seed: false,
  }
}

/**
 * Rebuild the abstract. OpenAlex returns an inverted index (word -> positions),
 * not prose, so the words are placed back at their offsets.
 */
function abstractOf(work) {
  const inverted = work.abstract_inverted_index
  if (inverted === null || typeof inverted !== 'object') return ''
  const words = []
  const keys = Object.keys(inverted)
  for (let i = 0; i < keys.length; i++) {
    const positions = inverted[keys[i]]
    if (!Array.isArray(positions)) continue
    for (let p = 0; p < positions.length; p++) {
      if (typeof positions[p] === 'number') words[positions[p]] = keys[i]
    }
  }
  const text = words.filter(function (word) { return typeof word === 'string' }).join(' ')
  return text.length > 1500 ? text.slice(0, 1500) + ' ...' : text
}

/** Author display names from `authorships`. */
function authorsOf(work) {
  const list = work.authorships
  if (!Array.isArray(list)) return []
  const names = []
  for (let i = 0; i < list.length; i++) {
    const entry = list[i]
    const author = entry === null || typeof entry !== 'object' ? null : entry.author
    const name = author === null || typeof author !== 'object' ? null : nullIfEmpty(author.display_name)
    if (name !== null) names.push(name)
  }
  return names
}

/* ------------------------------------------------------------------ filters */

/** A non-negative integer filter value, or `invalid`. */
function countOf(value, field) {
  if (typeof value !== 'number' || Number.isFinite(value) !== true || Number.isInteger(value) !== true || value < 0) {
    throw invalidError(field + ' must be a non-negative integer.')
  }
  return value
}

/** A boolean filter value, or `invalid`. */
function booleanOf(value, field) {
  if (typeof value !== 'boolean') throw invalidError(field + ' must be true or false.')
  return value
}

/**
 * Validate a raw `filters` object into the canonical shape (spec AC-A4-7).
 *
 * @param {unknown} raw - the request `filters`.
 * @returns {{sort: string, yearFrom?: number, yearTo?: number, venue?: string, isOa?: boolean, isRetracted?: boolean, minCitations?: number}}
 */
export function normalizeFilters(raw) {
  if (raw === undefined || raw === null) return { sort: 'cited' }
  if (typeof raw !== 'object' || Array.isArray(raw)) throw invalidError('filters must be an object.')
  const keys = Object.keys(raw)
  for (let i = 0; i < keys.length; i++) {
    if (FILTER_KEYS.indexOf(keys[i]) < 0) {
      throw invalidError('Unknown filter "' + keys[i] + '". Allowed filters: ' + FILTER_KEYS.join(', ') + '.')
    }
  }
  const filters = { sort: 'cited' }
  if (raw.yearFrom !== undefined && raw.yearFrom !== null) filters.yearFrom = countOf(raw.yearFrom, 'yearFrom')
  if (raw.yearTo !== undefined && raw.yearTo !== null) filters.yearTo = countOf(raw.yearTo, 'yearTo')
  if (filters.yearFrom !== undefined && filters.yearTo !== undefined && filters.yearFrom > filters.yearTo) {
    throw invalidError('yearFrom (' + filters.yearFrom + ') is after yearTo (' + filters.yearTo + ').')
  }
  if (raw.venue !== undefined && raw.venue !== null) {
    if (typeof raw.venue !== 'string') throw invalidError('venue must be a string.')
    const venue = raw.venue.trim().toLowerCase()
    if (venue !== '') filters.venue = venue
  }
  if (raw.isOa !== undefined && raw.isOa !== null) filters.isOa = booleanOf(raw.isOa, 'isOa')
  if (raw.isRetracted !== undefined && raw.isRetracted !== null) filters.isRetracted = booleanOf(raw.isRetracted, 'isRetracted')
  if (raw.minCitations !== undefined && raw.minCitations !== null) filters.minCitations = countOf(raw.minCitations, 'minCitations')
  if (raw.sort !== undefined && raw.sort !== null) {
    if (raw.sort !== 'cited' && raw.sort !== 'year') throw invalidError('sort must be "cited" or "year".')
    filters.sort = raw.sort
  }
  return filters
}

/** Does one record satisfy the canonical filters? (year 0 never satisfies a bounded side.) */
function passesFilters(record, filters) {
  const bounded = filters.yearFrom !== undefined || filters.yearTo !== undefined
  if (bounded) {
    if (record.year === 0) return false
    if (filters.yearFrom !== undefined && record.year < filters.yearFrom) return false
    if (filters.yearTo !== undefined && record.year > filters.yearTo) return false
  }
  if (filters.venue !== undefined) {
    if (typeof record.venue !== 'string' || record.venue === '') return false
    if (record.venue.toLowerCase().indexOf(filters.venue) < 0) return false
  }
  if (filters.isOa !== undefined && (record.openAccess === true) !== filters.isOa) return false
  if (filters.isRetracted !== undefined && (record.retracted === true) !== filters.isRetracted) return false
  if (filters.minCitations !== undefined && record.citedBy < filters.minCitations) return false
  return true
}

/** Deterministic order: `cited` = citedBy desc, year desc, id asc; `year` = year desc, citedBy desc, id asc. */
function sortRecords(list, sort) {
  const copy = list.slice()
  copy.sort((a, b) => {
    if (sort === 'year') {
      if (b.year !== a.year) return b.year - a.year
      if (b.citedBy !== a.citedBy) return b.citedBy - a.citedBy
    } else {
      if (b.citedBy !== a.citedBy) return b.citedBy - a.citedBy
      if (b.year !== a.year) return b.year - a.year
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
  return copy
}

/**
 * The authoritative post-filter (spec §4.7): every axis runs its results
 * through this, so `found` is always the filtered count.
 *
 * @param {any[]} records - candidate records.
 * @param {unknown} rawFilters - raw `filters`.
 * @returns {any[]} the surviving records, sorted.
 */
export function applyFilters(records, rawFilters) {
  const filters = normalizeFilters(rawFilters)
  const list = Array.isArray(records) ? records : []
  const out = []
  for (let i = 0; i < list.length; i++) {
    if (passesFilters(list[i], filters)) out.push(list[i])
  }
  return sortRecords(out, filters.sort)
}

/** OpenAlex filter parts for the pushed-down dimensions. */
function filterParts(filters, extra) {
  const parts = []
  if (Array.isArray(extra)) for (let i = 0; i < extra.length; i++) parts.push(extra[i])
  if (filters.yearFrom !== undefined) parts.push('from_publication_date:' + filters.yearFrom + '-01-01')
  if (filters.yearTo !== undefined) parts.push('to_publication_date:' + filters.yearTo + '-12-31')
  if (filters.isOa !== undefined) parts.push('is_oa:' + (filters.isOa ? 'true' : 'false'))
  if (filters.isRetracted !== undefined) parts.push('is_retracted:' + (filters.isRetracted ? 'true' : 'false'))
  if (filters.minCitations !== undefined && filters.minCitations > 0) parts.push('cited_by_count:>' + (filters.minCitations - 1))
  return parts
}

/**
 * Tokenise an OpenAlex id list for a batch lookup — exported for tests.
 *
 * @param {string[]} ids - raw ids.
 * @param {number} limit - cap.
 * @returns {string[]} unique bare work ids.
 */
export function uniqueWorkIds(ids, limit) {
  const unique = []
  const seen = {}
  const cap = Number.isFinite(limit) ? limit : Number.MAX_SAFE_INTEGER
  for (let i = 0; i < ids.length && unique.length < cap; i++) {
    const id = shortId(ids[i])
    if (!isWorkId(id) || seen[id] === true) continue
    seen[id] = true
    unique.push(id)
  }
  return unique
}

/**
 * Split an id list into `openalex_id` OR-filter chunks. OpenAlex accepts at
 * most 50 ids per `openalex_id` filter, so a 100-reference expand must make two
 * requests instead of silently truncating at 50 (spec AC-A5-3).
 *
 * @param {string[]} ids - raw ids.
 * @param {number} [size] - chunk size, default 50.
 * @returns {string[][]} chunks of unique bare work ids.
 */
export function chunkIds(ids, size) {
  const width = Number.isFinite(size) && size > 0 ? Math.floor(size) : ID_CHUNK
  const unique = uniqueWorkIds(Array.isArray(ids) ? ids : [], Number.MAX_SAFE_INTEGER)
  const chunks = []
  for (let i = 0; i < unique.length; i += width) chunks.push(unique.slice(i, i + width))
  return chunks
}

/** @param {number} ms @returns {Promise<void>} */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * @typedef {object} LibraryOptions
 * @property {string} mailto - OpenAlex polite-pool contact address.
 * @property {number} searchPerPage - search page size.
 * @property {number} maxNodes - papers per graph ceiling.
 * @property {number} maxBatch - neighbours per references/related/earlier/author expand.
 * @property {number} maxCitations - citing papers per citations/later expand.
 * @property {number} maxSeeds - seeds per collection.
 * @property {number} concurrency - concurrent OpenAlex requests.
 * @property {string} storePath - library file path.
 * @property {Function} [fetchImpl] - test seam: fetch replacement.
 * @property {object} [fs] - test seam: `node:fs/promises` replacement.
 * @property {number} [retryDelayMs] - test seam: retry backoff.
 */

/**
 * Build one independent library (its own collection, graph, library document
 * and cache).
 *
 * @param {LibraryOptions} options - resolved plugin config.
 */
export function createLibrary(options) {
  const mailto = options.mailto
  const searchPerPage = options.searchPerPage
  const maxNodes = options.maxNodes
  const maxBatch = options.maxBatch
  const maxCitations = options.maxCitations
  const maxSeeds = options.maxSeeds
  const concurrency = options.concurrency
  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : (url, init) => fetch(url, init)
  const retryDelayMs = Number.isFinite(options.retryDelayMs) ? options.retryDelayMs : 500

  /** @type {Map<string, any>} */
  const nodes = new Map()
  /** @type {Map<string, any>} */
  const links = new Map()
  /** @type {Map<string, any>} */
  const catalog = new Map()
  /** @type {Map<string, any>} */
  const cache = new Map()
  /** @type {Map<string, Promise<any>>} */
  const inFlight = new Map()

  let lib = emptyLibrary()
  const store = createStore({
    storePath: options.storePath,
    fs: options.fs,
    snapshot: () => lib,
    debounceMs: options.debounceMs,
    maxWaitMs: options.maxWaitMs,
  })

  /** Mark the library dirty: the store debounces the actual write. */
  function markDirty() {
    store.save()
  }

  /* --------------------------------------------------------- concurrency */

  let activeRequests = 0
  const waiters = []

  async function acquireSlot() {
    if (activeRequests < concurrency) {
      activeRequests += 1
      return
    }
    await new Promise((resolve) => waiters.push(resolve))
    activeRequests += 1
  }

  function releaseSlot() {
    activeRequests -= 1
    const next = waiters.shift()
    if (next !== undefined) next()
  }

  async function withSlot(fn) {
    await acquireSlot()
    try {
      return await fn()
    } finally {
      releaseSlot()
    }
  }

  /* -------------------------------------------------------------- network */

  const withMailto = (url) => url + (url.indexOf('?') >= 0 ? '&' : '?') + 'mailto=' + encodeURIComponent(mailto)

  function timeoutSignal() {
    if (typeof AbortSignal === 'undefined' || typeof AbortSignal.timeout !== 'function') return undefined
    return AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  }

  async function rawJson(url) {
    let response
    try {
      response = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: timeoutSignal() })
    } catch (error) {
      throw operationError('OpenAlex is unreachable: ' + messageOf(error), true)
    }
    const text = await response.text()
    if (response.ok !== true) {
      if (response.status === 404) throw invalidError('OpenAlex has no such work or author.')
      const retryable = response.status === 429 || response.status >= 500
      throw operationError('OpenAlex answered HTTP ' + response.status + '.', retryable)
    }
    try {
      return JSON.parse(text)
    } catch {
      throw operationError('The OpenAlex reply was cut short before it could be parsed; try again.')
    }
  }

  async function requestJson(url) {
    let attempt = 0
    for (;;) {
      try {
        return await withSlot(() => rawJson(url))
      } catch (error) {
        if (attempt === 0 && error !== null && error !== undefined && error.retryable === true) {
          attempt += 1
          await sleep(retryDelayMs)
          continue
        }
        throw error
      }
    }
  }

  /** One OpenAlex GET, JSON-parsed, cached by URL and de-duplicated in flight. */
  async function getJson(url) {
    const cached = cache.get(url)
    if (cached !== undefined) return cached
    const running = inFlight.get(url)
    if (running !== undefined) return running
    const task = requestJson(url)
    inFlight.set(url, task)
    try {
      const data = await task
      if (cache.size >= CACHE_LIMIT) cache.clear()
      cache.set(url, data)
      return data
    } finally {
      inFlight.delete(url)
    }
  }

  /* -------------------------------------------------------------- queries */

  async function oaSearch(term, filters, page) {
    const params = new URLSearchParams()
    params.set('search', term)
    params.set('select', RECORD_SELECT)
    params.set('per-page', String(searchPerPage))
    params.set('page', String(page))
    params.set('sort', filters.sort === 'year' ? 'publication_year:desc' : 'cited_by_count:desc')
    const parts = filterParts(filters, [])
    if (parts.length > 0) params.set('filter', parts.join(','))
    const data = await getJson(withMailto(OA + '/works?' + params.toString()))
    const raw = Array.isArray(data.results) ? data.results.map(recordOf) : []
    const total = data.meta !== null && typeof data.meta === 'object' && typeof data.meta.count === 'number'
      ? data.meta.count
      : raw.length
    return { raw, total }
  }

  async function oaByDoi(doi) {
    const params = new URLSearchParams()
    params.set('filter', 'doi:' + doi.toLowerCase())
    params.set('select', RECORD_SELECT)
    params.set('per-page', '1')
    const data = await getJson(withMailto(OA + '/works?' + params.toString()))
    if (!Array.isArray(data.results) || data.results.length === 0) return null
    return recordOf(data.results[0])
  }

  async function oaByIds(ids, limit) {
    const unique = uniqueWorkIds(ids, Number.isFinite(limit) ? limit : Number.MAX_SAFE_INTEGER)
    if (unique.length === 0) return []
    const chunks = chunkIds(unique, ID_CHUNK)
    const results = []
    for (let c = 0; c < chunks.length; c++) {
      const params = new URLSearchParams()
      params.set('filter', 'openalex_id:' + chunks[c].join('|'))
      params.set('select', RECORD_SELECT)
      params.set('per-page', String(chunks[c].length))
      const data = await getJson(withMailto(OA + '/works?' + params.toString()))
      if (Array.isArray(data.results)) {
        for (let i = 0; i < data.results.length; i++) results.push(recordOf(data.results[i]))
      }
    }
    return results
  }

  async function oaEdgeLists(id) {
    const url = OA + '/works/' + id + '?select=' + encodeURIComponent(EDGE_SELECT)
    const data = await getJson(withMailto(url))
    return {
      references: Array.isArray(data.referenced_works) ? data.referenced_works : [],
      related: Array.isArray(data.related_works) ? data.related_works : [],
    }
  }

  async function oaCitedBy(id, limit, filters) {
    const params = new URLSearchParams()
    const parts = filterParts(filters, ['cites:' + id])
    params.set('filter', parts.join(','))
    params.set('select', RECORD_SELECT)
    params.set('sort', 'cited_by_count:desc')
    params.set('per-page', String(limit))
    const data = await getJson(withMailto(OA + '/works?' + params.toString()))
    return Array.isArray(data.results) ? data.results.map(recordOf) : []
  }

  async function oaByAuthor(authorId, limit, filters) {
    const params = new URLSearchParams()
    const parts = filterParts(filters, ['author.id:' + authorId])
    params.set('filter', parts.join(','))
    params.set('select', RECORD_SELECT)
    params.set('sort', 'cited_by_count:desc')
    params.set('per-page', String(limit))
    const data = await getJson(withMailto(OA + '/works?' + params.toString()))
    return Array.isArray(data.results) ? data.results.map(recordOf) : []
  }

  async function oaDetail(id) {
    const url = OA + '/works/' + id + '?select=' + encodeURIComponent(DETAIL_SELECT)
    const data = await getJson(withMailto(url))
    const paper = recordOf(data)
    paper.abstract = abstractOf(data)
    paper.authors = authorsOf(data)
    paper.url = 'https://openalex.org/' + paper.id
    paper.referenceCount = Array.isArray(data.referenced_works) ? data.referenced_works.length : 0
    paper.relatedCount = Array.isArray(data.related_works) ? data.related_works.length : 0
    return paper
  }

  /**
   * Resolve ORCIDs to OpenAlex author ids. Some works (for example the survey
   * W2907492528) carry `author.id: null` in `authorships` but a valid ORCID;
   * without this fallback the author axis would be dead for them. Duplicate
   * author profiles share an ORCID, so the richest profile wins and ties go to
   * the smaller id — deterministic, never random.
   */
  async function oaAuthorsByOrcid(orcids) {
    const resolved = new Map()
    const unique = []
    for (let i = 0; i < orcids.length; i++) {
      const orcid = orcids[i]
      if (orcid !== null && orcid !== undefined && unique.indexOf(orcid) < 0) unique.push(orcid)
    }
    if (unique.length === 0) return resolved
    const params = new URLSearchParams()
    params.set('filter', 'orcid:' + unique.slice(0, ID_CHUNK).join('|'))
    params.set('select', 'id,orcid,display_name,works_count')
    params.set('per-page', String(ID_CHUNK))
    const data = await getJson(withMailto(OA + '/authors?' + params.toString()))
    const results = Array.isArray(data.results) ? data.results : []
    for (let i = 0; i < results.length; i++) {
      const record = results[i]
      const orcid = shortOrcid(record.orcid)
      const authorId = shortId(record.id)
      if (orcid === null || !isAuthorId(authorId)) continue
      const works = typeof record.works_count === 'number' ? record.works_count : 0
      const current = resolved.get(orcid)
      if (current === undefined || works > current.works || (works === current.works && authorId < current.id)) {
        resolved.set(orcid, { id: authorId, name: nullIfEmpty(record.display_name), works: works })
      }
    }
    return resolved
  }

  async function oaAuthors(id) {
    const url = OA + '/works/' + id + '?select=' + encodeURIComponent('id,authorships')
    const data = await getJson(withMailto(url))
    const list = Array.isArray(data.authorships) ? data.authorships : []
    const entries = []
    for (let i = 0; i < list.length; i++) {
      const author = list[i] !== null && typeof list[i] === 'object' ? list[i].author : null
      if (author === null || typeof author !== 'object') continue
      const authorId = shortId(author.id)
      entries.push({
        id: isAuthorId(authorId) ? authorId : null,
        orcid: shortOrcid(author.orcid),
        name: nullIfEmpty(author.display_name),
      })
    }
    const pending = []
    for (let i = 0; i < entries.length; i++) {
      if (entries[i].id === null && entries[i].orcid !== null) pending.push(entries[i].orcid)
    }
    if (pending.length > 0) {
      const resolved = await oaAuthorsByOrcid(pending)
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]
        if (entry.id !== null || entry.orcid === null) continue
        const found = resolved.get(entry.orcid)
        if (found === undefined) continue
        entry.id = found.id
        if (entry.name === null) entry.name = found.name
      }
    }
    const authors = []
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      // Without an OpenAlex author id the entry cannot drive the author axis,
      // so it is not part of the /authors contract.
      if (entry.id === null) continue
      authors.push({ id: entry.id, name: entry.name === null ? entry.id : entry.name })
    }
    return authors
  }

  /* ---------------------------------------------------------------- graph */

  /** Insert or merge a node. Merging never overwrites richer existing fields. */
  function putNode(record, isSeed) {
    const existing = nodes.get(record.id)
    if (existing !== undefined) {
      if (isSeed === true) existing.seed = true
      if (existing.venue === null && record.venue !== null) existing.venue = record.venue
      if (existing.authorIds.length === 0 && record.authorIds.length > 0) existing.authorIds = record.authorIds.slice()
      if (record.openAccess === true) existing.openAccess = true
      if (record.retracted === true) existing.retracted = true
      return existing
    }
    const node = {
      id: record.id,
      title: record.title,
      year: record.year,
      citedBy: record.citedBy,
      doi: record.doi,
      venue: record.venue,
      kind: record.kind,
      openAccess: record.openAccess === true,
      retracted: record.retracted === true,
      authorIds: Array.isArray(record.authorIds) ? record.authorIds.slice() : [],
      seed: isSeed === true,
    }
    nodes.set(node.id, node)
    return node
  }

  /** Link two works. The composite key makes re-expanding idempotent. */
  function putLink(source, target, kind) {
    if (!isWorkId(source) || !isWorkId(target) || source === target) return
    links.set(source + '>' + target + '>' + kind, { source: source, target: target, kind: kind })
  }

  /** A pure graph snapshot the panel can hold. */
  function graph() {
    const nodeList = []
    nodes.forEach(function (node) {
      nodeList.push({
        id: node.id,
        title: node.title,
        year: node.year,
        citedBy: node.citedBy,
        doi: node.doi,
        venue: node.venue,
        kind: node.kind,
        openAccess: node.openAccess === true,
        retracted: node.retracted === true,
        authorIds: Array.isArray(node.authorIds) ? node.authorIds.slice() : [],
        seed: node.seed === true,
        inLibrary: lib.records[node.id] !== undefined,
      })
    })
    const linkList = []
    links.forEach(function (link) {
      linkList.push({ source: link.source, target: link.target, kind: link.kind })
    })
    return { seeds: seedIds(), nodes: nodeList, links: linkList }
  }

  /** Drop non-seed nodes that no link touches any more. */
  function pruneOrphans() {
    const touched = new Map()
    links.forEach(function (link) {
      touched.set(link.source, true)
      touched.set(link.target, true)
    })
    const doomed = []
    nodes.forEach(function (node) {
      if (node.seed !== true && touched.has(node.id) !== true) doomed.push(node.id)
    })
    for (let i = 0; i < doomed.length; i++) nodes.delete(doomed[i])
  }

  /** Graph totals, including the per-kind link split. */
  function counts() {
    const byKind = { references: 0, citations: 0, related: 0, earlier: 0, later: 0, author: 0 }
    links.forEach(function (link) {
      if (byKind[link.kind] !== undefined) byKind[link.kind] += 1
    })
    return {
      papers: nodes.size,
      links: links.size,
      seeds: seedIds().length,
      reference: byKind.references,
      citation: byKind.citations,
      related: byKind.related,
      earlier: byKind.earlier,
      later: byKind.later,
      author: byKind.author,
    }
  }

  /* -------------------------------------------------------------- library */

  function collectionById(id) {
    for (let i = 0; i < lib.collections.length; i++) {
      if (lib.collections[i].id === id) return lib.collections[i]
    }
    return undefined
  }

  /** Ids of the collection and every descendant, breadth-first. */
  function subtreeIds(id) {
    const out = [id]
    const queue = [id]
    while (queue.length > 0) {
      const current = queue.shift()
      for (let i = 0; i < lib.collections.length; i++) {
        if (lib.collections[i].parentId === current) {
          out.push(lib.collections[i].id)
          queue.push(lib.collections[i].id)
        }
      }
    }
    return out
  }

  function hasMembership(collectionId, workId) {
    for (let i = 0; i < lib.memberships.length; i++) {
      const entry = lib.memberships[i]
      if (entry.collectionId === collectionId && entry.workId === workId) return true
    }
    return false
  }

  /** Members of the system collection, newest first (the old `seeds` array). */
  function seedIds() {
    const out = []
    for (let i = 0; i < lib.memberships.length; i++) {
      if (lib.memberships[i].collectionId === SEEDS_ID) out.push(lib.memberships[i].workId)
    }
    return out
  }

  function belongsToUserCollection(workId) {
    for (let i = 0; i < lib.memberships.length; i++) {
      const entry = lib.memberships[i]
      if (entry.workId !== workId) continue
      const collection = collectionById(entry.collectionId)
      if (collection !== undefined && collection.system !== true) return true
    }
    return false
  }

  function touchRecent(workId) {
    if (!isWorkId(workId)) return
    const next = [{ workId: workId, at: new Date().toISOString() }]
    for (let i = 0; i < lib.recentlyFound.length; i++) {
      if (lib.recentlyFound[i].workId !== workId) next.push(lib.recentlyFound[i])
    }
    if (next.length > RECENT_LIMIT) next.length = RECENT_LIMIT
    lib.recentlyFound = next
  }

  function dropRecent(workId) {
    const next = []
    for (let i = 0; i < lib.recentlyFound.length; i++) {
      if (lib.recentlyFound[i].workId !== workId) next.push(lib.recentlyFound[i])
    }
    lib.recentlyFound = next
  }

  /** Spec AC-B3: entered the graph, not stored in any user collection. */
  function recentlyFoundIds() {
    const out = []
    for (let i = 0; i < lib.recentlyFound.length; i++) {
      const workId = lib.recentlyFound[i].workId
      if (belongsToUserCollection(workId)) continue
      out.push(workId)
    }
    return out
  }

  /** Direct members of one collection, in insertion order. */
  function memberIds(collectionId) {
    const out = []
    for (let i = 0; i < lib.memberships.length; i++) {
      if (lib.memberships[i].collectionId === collectionId) out.push(lib.memberships[i].workId)
    }
    return out
  }

  function collectionView(collection) {
    const ids = memberIds(collection.id)
    const deep = new Set(ids)
    const descendants = subtreeIds(collection.id)
    for (let d = 1; d < descendants.length; d++) {
      const members = memberIds(descendants[d])
      for (let m = 0; m < members.length; m++) deep.add(members[m])
    }
    return {
      id: collection.id,
      name: collection.name,
      parentId: collection.parentId,
      system: collection.system === true,
      createdAt: collection.createdAt,
      order: collection.order,
      itemCount: ids.length,
      itemCountDeep: deep.size,
      ids: ids,
    }
  }

  function collectionList() {
    const out = []
    for (let i = 0; i < lib.collections.length; i++) out.push(collectionView(lib.collections[i]))
    return out
  }

  /** The library slice every response may carry. */
  function libraryView() {
    return {
      collections: collectionList(),
      recentlyFound: recentlyFoundIds(),
      annotations: lib.annotations,
      records: lib.records,
      storePath: store.path,
      storeError: store.storeError(),
    }
  }

  /** Merge one record into the persistent metadata cache. */
  function upsertRecord(record) {
    if (record === null || record === undefined || !isWorkId(record.id)) return
    const existing = lib.records[record.id]
    if (existing === undefined && Object.keys(lib.records).length >= RECORD_LIMIT) {
      throw invalidError('The library already holds ' + RECORD_LIMIT + ' records; clear it before adding more.')
    }
    const prior = existing === undefined ? {} : existing
    const next = {
      id: record.id,
      title: hasText(record.title) && record.title !== '(untitled)' ? record.title : (hasText(prior.title) ? prior.title : (record.title || '(untitled)')),
      year: record.year > 0 ? record.year : (typeof prior.year === 'number' ? prior.year : 0),
      citedBy: typeof record.citedBy === 'number' ? Math.max(record.citedBy, typeof prior.citedBy === 'number' ? prior.citedBy : 0) : (prior.citedBy || 0),
      doi: record.doi !== null && record.doi !== undefined ? record.doi : (prior.doi !== undefined ? prior.doi : null),
      venue: record.venue !== null && record.venue !== undefined ? record.venue : (prior.venue !== undefined ? prior.venue : null),
      kind: record.kind !== null && record.kind !== undefined ? record.kind : (prior.kind !== undefined ? prior.kind : null),
      openAccess: record.openAccess === true || prior.openAccess === true,
      retracted: record.retracted === true || prior.retracted === true,
      authorIds: Array.isArray(record.authorIds) && record.authorIds.length > 0
        ? record.authorIds.slice()
        : (Array.isArray(prior.authorIds) ? prior.authorIds.slice() : []),
    }
    if (Array.isArray(record.authors) && record.authors.length > 0) next.authors = record.authors.slice()
    else if (Array.isArray(prior.authors) && prior.authors.length > 0) next.authors = prior.authors.slice()
    lib.records[record.id] = next
  }

  async function ensureRecord(id) {
    const known = catalog.get(id) || nodes.get(id) || lib.records[id]
    if (known !== undefined) return known
    const found = await oaByIds([id])
    if (found.length === 0) throw invalidError('OpenAlex has no work with id ' + id + '.')
    catalog.set(id, found[0])
    return found[0]
  }

  /* ------------------------------------------------------------ expansion */

  /** Validate a work id argument. */
  function requireWorkId(value, what) {
    const id = shortId(hasText(value) ? value : '')
    if (!isWorkId(id)) throw invalidError(what + ' needs an OpenAlex work id such as W2094864959.')
    return id
  }

  /** Collect the neighbour records for one axis; returns {records, considered, truncated, note}. */
  async function neighboursOf(work, kind, filters, authorId) {
    if (kind === 'references' || kind === 'related') {
      const edges = await oaEdgeLists(work)
      const available = kind === 'references' ? edges.references : edges.related
      const wanted = uniqueWorkIds(available, maxBatch)
      const raw = await oaByIds(wanted)
      return {
        records: applyFilters(raw, filters),
        considered: raw.length,
        truncated: available.length > wanted.length,
        note: null,
      }
    }
    if (kind === 'citations') {
      const raw = await oaCitedBy(work, maxCitations, filters)
      return {
        records: applyFilters(raw, filters),
        considered: raw.length,
        truncated: raw.length >= maxCitations,
        note: null,
      }
    }
    if (kind === 'earlier' || kind === 'later') {
      const seed = await ensureRecord(work)
      let raw = []
      let available = 0
      let truncated = false
      if (kind === 'earlier') {
        const edges = await oaEdgeLists(work)
        available = edges.references.length
        const wanted = uniqueWorkIds(edges.references, maxBatch)
        raw = await oaByIds(wanted)
        truncated = available > wanted.length
      } else {
        raw = await oaCitedBy(work, maxCitations, filters)
        truncated = raw.length >= maxCitations
      }
      if (seed.year === 0) {
        return { records: [], considered: raw.length, truncated: truncated, note: 'the paper has no publication year, so no earlier/later work can be compared' }
      }
      const bounded = []
      for (let i = 0; i < raw.length; i++) {
        const year = raw[i].year
        if (year === 0) continue
        if (kind === 'earlier' && year < seed.year) bounded.push(raw[i])
        else if (kind === 'later' && year > seed.year) bounded.push(raw[i])
      }
      return {
        records: applyFilters(bounded, filters),
        considered: bounded.length,
        truncated: truncated,
        note: bounded.length === 0 ? 'no earlier/later work at this time boundary' : null,
      }
    }
    if (kind === 'author') {
      if (!hasText(authorId)) {
        const authors = await oaAuthors(work)
        const hint = authors.length === 0
          ? 'OpenAlex lists no authors for this paper'
          : authors.map((author) => author.id + ' (' + author.name + ')').join(', ')
        throw invalidError('Expanding by author needs authorId. Available authors: ' + hint + '.')
      }
      const id = shortId(authorId)
      if (!isAuthorId(id)) throw invalidError('authorId must be an OpenAlex author id such as A5023821363.')
      const raw = await oaByAuthor(id, maxBatch, filters)
      return {
        records: applyFilters(raw, filters),
        considered: raw.length,
        truncated: raw.length >= maxBatch,
        note: raw.length === 0 ? 'OpenAlex lists no work for author ' + id : null,
      }
    }
    throw invalidError('Unknown expansion kind: ' + kind + '. Use ' + EXPAND_KINDS.join(', ') + '.')
  }

  async function expand(id, kind, opts) {
    const work = requireWorkId(id, 'Expanding a paper')
    const use = hasText(kind) ? kind : 'related'
    if (EXPAND_KINDS.indexOf(use) < 0) {
      throw invalidError('Unknown expansion kind: ' + use + '. Use ' + EXPAND_KINDS.join(', ') + '.')
    }
    if (nodes.size >= maxNodes) {
      throw operationError('The graph already holds ' + nodes.size + ' papers; clear it before expanding further.')
    }
    const filters = normalizeFilters(opts === undefined || opts === null ? undefined : opts.filters)
    const found = await neighboursOf(work, use, filters, opts === undefined || opts === null ? undefined : opts.authorId)
    let added = 0
    let limited = false
    const ids = []
    for (let i = 0; i < found.records.length; i++) {
      const record = found.records[i]
      if (record.id === work) continue
      if (!nodes.has(record.id) && nodes.size >= maxNodes) {
        // The ceiling stops the insert; never half-write past maxNodes (AC-A2-6).
        limited = true
        break
      }
      if (!nodes.has(record.id)) added += 1
      putNode(record, seedIds().indexOf(record.id) >= 0)
      upsertRecord(record)
      putLink(work, record.id, use)
      touchRecent(record.id)
      ids.push(record.id)
    }
    markDirty()
    return {
      kind: use,
      found: found.records.length,
      added: added,
      considered: found.considered,
      truncated: found.truncated === true,
      limited: limited,
      note: found.note,
      ids: ids,
      graph: graph(),
      counts: counts(),
      library: libraryView(),
    }
  }

  /**
   * Run `worker` over `items` with at most `width` in flight; the global
   * OpenAlex semaphore still caps the real requests at `concurrency`.
   */
  async function pool(items, width, worker) {
    let next = 0
    const size = Math.max(1, Math.min(width, items.length))
    const runners = []
    for (let i = 0; i < size; i++) {
      runners.push((async () => {
        for (;;) {
          const index = next
          next += 1
          if (index >= items.length) return
          await worker(items[index], index)
        }
      })())
    }
    await Promise.all(runners)
  }

  async function expandAll(opts) {
    const options = opts === undefined || opts === null ? {} : opts
    const rawKinds = options.kinds === undefined || options.kinds === null ? ['references', 'related'] : options.kinds
    if (!Array.isArray(rawKinds)) throw invalidError('kinds must be an array of expansion axes.')
    const kinds = []
    for (let i = 0; i < rawKinds.length; i++) {
      const kind = rawKinds[i]
      if (EXPAND_KINDS.indexOf(kind) < 0) throw invalidError('Unknown expansion kind: ' + String(kind) + '. Use ' + EXPAND_KINDS.join(', ') + '.')
      if (kinds.indexOf(kind) < 0) kinds.push(kind)
    }
    if (kinds.length === 0) throw invalidError('kinds must name at least one expansion axis.')
    const filters = normalizeFilters(options.filters)
    const authorId = options.authorId
    const seeds = seedIds().slice(0, maxSeeds)
    if (seeds.length === 0) throw operationError('Add at least one paper to the collection first.')

    const tasks = []
    for (let s = 0; s < seeds.length; s++) {
      for (let k = 0; k < kinds.length; k++) tasks.push({ id: seeds[s], kind: kinds[k] })
    }
    const perSeed = new Array(tasks.length)
    let added = 0
    let skipped = 0
    let truncated = false
    let warning = null

    await pool(tasks, concurrency, async (task, index) => {
      if (nodes.size >= maxNodes) {
        skipped += 1
        perSeed[index] = { id: task.id, kind: task.kind, found: 0, added: 0, error: 'the graph reached its node limit (' + maxNodes + '); clear it before expanding further' }
        if (warning === null) warning = perSeed[index].error
        return
      }
      try {
        const outcome = await expand(task.id, task.kind, { filters: filters, authorId: authorId })
        added += outcome.added
        if (outcome.truncated === true) truncated = true
        if (outcome.limited === true) {
          skipped += 1
          perSeed[index] = { id: task.id, kind: task.kind, found: outcome.found, added: outcome.added, error: 'the graph reached its node limit (' + maxNodes + '); clear it before expanding further' }
          if (warning === null) warning = perSeed[index].error
          return
        }
        perSeed[index] = { id: task.id, kind: task.kind, found: outcome.found, added: outcome.added, error: null }
      } catch (error) {
        skipped += 1
        const message = messageOf(error)
        perSeed[index] = { id: task.id, kind: task.kind, found: 0, added: 0, error: message }
        if (warning === null) warning = message
      }
    })

    markDirty()
    return {
      added: added,
      skipped: skipped,
      perSeed: perSeed,
      truncated: truncated,
      warning: warning,
      graph: graph(),
      counts: counts(),
      library: libraryView(),
    }
  }

  /* ------------------------------------------------------ library writes */

  function requireCollectionId(value, what) {
    const id = hasText(value) ? String(value) : ''
    if (id === '' || collectionById(id) === undefined) throw invalidError((what || 'This operation') + ' needs an existing collection id.')
    return id
  }

  function requireName(value) {
    if (typeof value !== 'string' || value.trim() === '') throw invalidError('A collection needs a non-empty name.')
    const name = value.trim()
    if (name.length > 120) throw invalidError('A collection name may hold at most 120 characters.')
    return name
  }

  function requireIds(value) {
    if (!Array.isArray(value)) throw invalidError('ids must be an array of OpenAlex work ids.')
    const ids = []
    for (let i = 0; i < value.length; i++) {
      if (typeof value[i] !== 'string') throw invalidError('ids must be an array of OpenAlex work ids.')
      ids.push(value[i])
    }
    return ids
  }

  function saveToCollection(collectionId, ids) {
    const saved = []
    const skipped = []
    for (let i = 0; i < ids.length; i++) {
      const id = shortId(ids[i])
      if (!isWorkId(id) || lib.records[id] === undefined) {
        skipped.push(ids[i])
        continue
      }
      if (hasMembership(collectionId, id)) {
        skipped.push(id)
        continue
      }
      if (lib.memberships.length >= MEMBERSHIP_LIMIT) throw invalidError('The library already holds ' + MEMBERSHIP_LIMIT + ' collection memberships.')
      lib.memberships.push({ collectionId: collectionId, workId: id, addedAt: new Date().toISOString() })
      saved.push(id)
      dropRecent(id)
    }
    return { saved: saved, skipped: skipped }
  }

  function removeFromCollection(collectionId, ids) {
    const removed = []
    const skipped = []
    for (let i = 0; i < ids.length; i++) {
      const id = shortId(ids[i])
      if (!isWorkId(id) || !hasMembership(collectionId, id)) {
        skipped.push(ids[i])
        continue
      }
      const next = []
      for (let m = 0; m < lib.memberships.length; m++) {
        const entry = lib.memberships[m]
        if (entry.collectionId === collectionId && entry.workId === id) continue
        next.push(entry)
      }
      lib.memberships = next
      removed.push(id)
      if (!belongsToUserCollection(id)) touchRecent(id)
    }
    return { removed: removed, skipped: skipped }
  }

  function collectionsOp(payload) {
    const body = payload === undefined || payload === null ? {} : payload
    const op = hasText(body.op) ? body.op : 'list'
    if (op === 'list') return { collections: collectionList(), library: libraryView() }
    if (op === 'create') {
      const name = requireName(body.name)
      const parentId = body.parentId === undefined || body.parentId === null || body.parentId === '' ? null : String(body.parentId)
      if (parentId !== null && collectionById(parentId) === undefined) throw invalidError('No such parent collection: ' + parentId + '.')
      lib.seq += 1
      const collection = {
        id: 'c' + lib.seq,
        name: name,
        parentId: parentId,
        system: false,
        createdAt: new Date().toISOString(),
        order: lib.collections.length,
      }
      lib.collections.push(collection)
      markDirty()
      return { collections: collectionList(), collection: collectionView(collection), library: libraryView() }
    }
    if (op === 'rename') {
      const id = requireCollectionId(body.collectionId !== undefined ? body.collectionId : body.id, 'Renaming a collection')
      const name = requireName(body.name)
      const collection = collectionById(id)
      collection.name = name
      markDirty()
      return { collections: collectionList(), collection: collectionView(collection), library: libraryView() }
    }
    if (op === 'delete') {
      const id = requireCollectionId(body.collectionId !== undefined ? body.collectionId : body.id, 'Deleting a collection')
      const collection = collectionById(id)
      if (collection.system === true) throw invalidError('The system collection cannot be deleted.')
      const doomed = subtreeIds(id)
      const doomedWork = []
      for (let i = 0; i < lib.memberships.length; i++) {
        if (doomed.indexOf(lib.memberships[i].collectionId) >= 0) doomedWork.push(lib.memberships[i].workId)
      }
      lib.collections = lib.collections.filter((entry) => doomed.indexOf(entry.id) < 0)
      lib.memberships = lib.memberships.filter((entry) => doomed.indexOf(entry.collectionId) < 0)
      for (let i = 0; i < doomedWork.length; i++) {
        if (!belongsToUserCollection(doomedWork[i])) touchRecent(doomedWork[i])
      }
      markDirty()
      return { collections: collectionList(), deleted: doomed, library: libraryView() }
    }
    if (op === 'save') {
      const id = requireCollectionId(body.collectionId !== undefined ? body.collectionId : body.id, 'Saving into a collection')
      const ids = requireIds(body.ids)
      const outcome = saveToCollection(id, ids)
      markDirty()
      return { collections: collectionList(), collection: collectionView(collectionById(id)), saved: outcome.saved, skipped: outcome.skipped, library: libraryView() }
    }
    if (op === 'remove') {
      const id = requireCollectionId(body.collectionId !== undefined ? body.collectionId : body.id, 'Removing from a collection')
      const ids = requireIds(body.ids)
      const outcome = removeFromCollection(id, ids)
      markDirty()
      return { collections: collectionList(), collection: collectionView(collectionById(id)), removed: outcome.removed, skipped: outcome.skipped, library: libraryView() }
    }
    throw invalidError('Unknown collections op: ' + op + '. Use list, create, rename, delete, save or remove.')
  }

  function recentlyFoundOp(payload) {
    const body = payload === undefined || payload === null ? {} : payload
    const op = hasText(body.op) ? body.op : 'list'
    if (op === 'list') return { recentlyFound: recentlyFoundIds(), library: libraryView() }
    if (op === 'clear') {
      lib.recentlyFound = []
      markDirty()
      return { recentlyFound: [], library: libraryView() }
    }
    if (op === 'promote') {
      const id = requireCollectionId(body.collectionId, 'Promoting Recently Found')
      const ids = requireIds(body.ids)
      const outcome = saveToCollection(id, ids)
      markDirty()
      return {
        recentlyFound: recentlyFoundIds(),
        promoted: outcome.saved,
        skipped: outcome.skipped,
        collection: collectionView(collectionById(id)),
        library: libraryView(),
      }
    }
    throw invalidError('Unknown recentlyFound op: ' + op + '. Use list, clear or promote.')
  }

  function annotate(payload) {
    const body = payload === undefined || payload === null ? {} : payload
    const id = shortId(hasText(body.id) ? body.id : '')
    if (!isWorkId(id)) throw invalidError('Annotating needs an OpenAlex work id such as W2094864959.')
    if (lib.records[id] === undefined && !nodes.has(id)) {
      throw invalidError('No work ' + id + ' is in the library; add it before annotating.')
    }
    if (Object.keys(lib.annotations).length >= ANNOTATION_LIMIT && lib.annotations[id] === undefined) {
      throw invalidError('The library already holds ' + ANNOTATION_LIMIT + ' annotations.')
    }
    const current = lib.annotations[id] || { note: '', tags: [], color: null }
    const next = {
      note: typeof current.note === 'string' ? current.note : '',
      tags: Array.isArray(current.tags) ? current.tags.slice() : [],
      color: typeof current.color === 'string' ? current.color : null,
    }
    if (Object.prototype.hasOwnProperty.call(body, 'note')) {
      if (body.note === null) next.note = ''
      else if (typeof body.note !== 'string') throw invalidError('note must be a string.')
      else if (body.note.length > NOTE_LIMIT) throw invalidError('A note may hold at most ' + NOTE_LIMIT + ' characters.')
      else next.note = body.note
    }
    if (Object.prototype.hasOwnProperty.call(body, 'tags')) {
      if (body.tags === null) next.tags = []
      else if (!Array.isArray(body.tags)) throw invalidError('tags must be an array of strings.')
      else {
        const tags = []
        for (let i = 0; i < body.tags.length; i++) {
          const tag = body.tags[i]
          if (typeof tag !== 'string') throw invalidError('tags must be an array of strings.')
          const trimmed = tag.trim()
          if (trimmed === '') continue
          if (trimmed.length > TAG_LENGTH) throw invalidError('A tag may hold at most ' + TAG_LENGTH + ' characters.')
          if (tags.indexOf(trimmed) < 0) tags.push(trimmed)
        }
        if (tags.length > TAG_LIMIT) throw invalidError('At most ' + TAG_LIMIT + ' tags per paper.')
        next.tags = tags
      }
    }
    if (Object.prototype.hasOwnProperty.call(body, 'color')) {
      if (body.color === null || body.color === '') next.color = null
      else if (typeof body.color !== 'string' || COLOR_CHOICES.indexOf(body.color) < 0) {
        throw invalidError('color must be one of ' + COLOR_CHOICES.join(', ') + ' or null.')
      } else next.color = body.color
    }
    const annotation = {
      id: id,
      note: next.note,
      tags: next.tags,
      color: next.color,
      updatedAt: new Date().toISOString(),
    }
    lib.annotations[id] = { note: annotation.note, tags: annotation.tags, color: annotation.color, updatedAt: annotation.updatedAt }
    markDirty()
    return { annotation: annotation, library: libraryView() }
  }

  function exportBibtex(payload) {
    const body = payload === undefined || payload === null ? {} : payload
    const format = body.format === undefined || body.format === null ? 'bibtex' : String(body.format)
    if (format !== 'bibtex') throw invalidError('Only BibTeX export is supported; format must be "bibtex".')
    let ids = []
    if (Array.isArray(body.ids)) {
      // An explicit list wins, even when empty: `ids: []` is "export nothing".
      ids = uniqueWorkIds(body.ids, Number.MAX_SAFE_INTEGER)
    } else if (body.collectionId !== undefined && body.collectionId !== null && body.collectionId !== '') {
      const id = requireCollectionId(body.collectionId, 'Exporting a collection')
      const descendants = subtreeIds(id)
      const seen = {}
      for (let d = 0; d < descendants.length; d++) {
        const members = memberIds(descendants[d])
        for (let m = 0; m < members.length; m++) {
          if (seen[members[m]] !== true) { seen[members[m]] = true; ids.push(members[m]) }
        }
      }
    } else {
      nodes.forEach((node) => ids.push(node.id))
    }
    const records = []
    for (let i = 0; i < ids.length; i++) {
      const record = lib.records[ids[i]]
      if (record !== undefined) records.push(record)
    }
    return { format: 'bibtex', count: records.length, bibtex: bibtexOf(records) }
  }

  /* ---------------------------------------------------------------- public */

  return {
    /** Open (or create) the library file; resolves once the library is usable. */
    async ready() {
      const opened = await store.open()
      lib = opened.data
      return { storePath: store.path, storeError: store.storeError(), repaired: opened.repaired }
    },

    /** The whole state snapshot: graph + counts + library. */
    state() {
      return { graph: graph(), counts: counts(), library: libraryView() }
    },

    /** Snapshot helper for the agent tool. */
    snapshot() {
      return { graph: graph(), counts: counts(), library: libraryView() }
    },

    /** Full-text (or DOI) search; results are also cached for later adds. */
    async search(query, filters, page) {
      const term = hasText(query) ? query.trim() : ''
      if (term.length === 0) throw invalidError('Type a title, author, topic or DOI first.')
      const usePage = page === undefined || page === null ? 1 : page
      if (typeof usePage !== 'number' || Number.isInteger(usePage) !== true || usePage < 1) {
        throw invalidError('page must be a positive integer.')
      }
      const canonical = normalizeFilters(filters)
      const doi = doiIn(term)
      if (doi !== null) {
        const resolved = await oaByDoi(doi)
        if (resolved !== null) {
          catalog.set(resolved.id, resolved)
          const results = applyFilters([resolved], canonical)
          return {
            term: term,
            results: results,
            filters: canonical,
            page: usePage,
            total: results.length,
            hasMore: false,
            considered: 1,
            graph: graph(),
            counts: counts(),
            library: libraryView(),
          }
        }
      }
      const found = await oaSearch(term, canonical, usePage)
      for (let i = 0; i < found.raw.length; i++) catalog.set(found.raw[i].id, found.raw[i])
      const results = applyFilters(found.raw, canonical)
      return {
        term: term,
        results: results,
        filters: canonical,
        page: usePage,
        total: found.total,
        hasMore: usePage * searchPerPage < found.total,
        considered: found.raw.length,
        graph: graph(),
        counts: counts(),
        library: libraryView(),
      }
    },

    /** Add one collected paper (a graph seed). */
    async addSeed(id) {
      const work = requireWorkId(id, 'Adding a paper')
      const record = await ensureRecord(work)
      const already = seedIds().indexOf(work) >= 0
      if (!already && seedIds().length >= maxSeeds) {
        throw invalidError('The collection already holds ' + maxSeeds + ' seeds; remove one before adding another.')
      }
      putNode(record, true)
      upsertRecord(record)
      if (!already) lib.memberships.unshift({ collectionId: SEEDS_ID, workId: work, addedAt: new Date().toISOString() })
      touchRecent(work)
      markDirty()
      return { record: record, graph: graph(), counts: counts(), library: libraryView() }
    },

    /** Remove one seed and everything that hangs off it alone. */
    removeSeed(id) {
      const work = shortId(hasText(id) ? id : '')
      const next = []
      for (let i = 0; i < lib.memberships.length; i++) {
        const entry = lib.memberships[i]
        if (entry.collectionId === SEEDS_ID && entry.workId === work) continue
        next.push(entry)
      }
      lib.memberships = next
      nodes.delete(work)
      const doomed = []
      links.forEach(function (link, key) {
        if (link.source === work || link.target === work) doomed.push(key)
      })
      for (let i = 0; i < doomed.length; i++) links.delete(doomed[i])
      pruneOrphans()
      markDirty()
      return { graph: graph(), counts: counts(), library: libraryView() }
    },

    /** Pull one paper's neighbours in. */
    async expand(id, kind, opts) {
      return expand(id, kind, opts)
    },

    /** Expand every seed (up to 50) by the requested axes, merging and isolating failures. */
    async expandAll(opts) {
      return expandAll(opts)
    },

    /** One paper's full record (authors, abstract, counts). */
    async details(id) {
      const work = requireWorkId(id, 'Reading a paper')
      const paper = await oaDetail(work)
      upsertRecord(paper)
      markDirty()
      return { paper: paper, library: libraryView() }
    },

    /** One paper's authors, in `authorships` order. */
    async authors(id) {
      const work = requireWorkId(id, 'Listing authors')
      return { authors: await oaAuthors(work) }
    },

    /** Collection tree operations (spec §6.1). */
    collections(payload) {
      return collectionsOp(payload)
    },

    /** Recently Found operations (spec §6.1). */
    recentlyFound(payload) {
      return recentlyFoundOp(payload)
    },

    /** Note / tag / colour annotations (spec §6.1). */
    annotate(payload) {
      return annotate(payload)
    },

    /** BibTeX export (spec §6.1). */
    export(payload) {
      return exportBibtex(payload)
    },

    /** Wipe the graph (default) or the whole library. */
    clear(scope) {
      if (scope !== undefined && scope !== null && scope !== '' && scope !== 'graph' && scope !== 'library') {
        throw invalidError('Unknown clear scope: ' + String(scope) + '. Use graph or library.')
      }
      const use = scope === 'library' ? 'library' : 'graph'
      nodes.clear()
      links.clear()
      if (use === 'library') {
        lib = emptyLibrary()
      } else {
        lib.memberships = lib.memberships.filter((entry) => entry.collectionId !== SEEDS_ID)
      }
      // A clear is destructive: write through immediately instead of waiting for
      // the debounce (design §2.4).
      store.saveNow()
      return { scope: use, graph: graph(), counts: counts(), library: libraryView() }
    },

    /** Force the library to disk now (tests and the plugin disposer use this). */
    async flush() {
      return store.flush()
    },

    /** Stop the store (flush + no further writes). */
    async close() {
      return store.close()
    },

    /** Diagnostics for tests: how many times the library hit the disk. */
    storeInfo() {
      return { storePath: store.path, storeError: store.storeError(), degraded: store.isDegraded(), writes: store.writeCount() }
    },
  }
}
