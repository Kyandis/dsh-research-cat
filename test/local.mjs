// Local verification for dsh-research-cat before it is mounted into a profile.
//
//   node test/local.mjs
//
// 1. Loader contract: the client artifact must call window.__ModuleLoader__.load
//    exactly once, and its factory must return a plugin with name/inject/apply —
//    the same contract the shipped dsh-community-market verifier enforces.
// 2. Config: the frozen default set (docs/rr-parity-spec.md §6.3) and overrides.
// 3. Engine: createLibrary() talks to the live OpenAlex API (search, add,
//    expand, dedupe, clear) with no harness around it, plus offline stub-driven
//    quota/concurrency/failure-path checks.
// 4. Store: persistence, atomic write, corruption repair and path resolution.
// 5. Host wiring: the research_cat tool and the /dsh-research-cat routes, probed
//    over real HTTP on 127.0.0.1.
//
// SEALED (t5): DSH_HOME is pointed at a fresh os.tmpdir() directory before any
// module resolves a store path, the engine and the host half get separate
// storePaths under it, and the last check proves the real
// ~/.dsh/research-cat/library.json was neither created nor modified. The suite
// must never read or write the user's live library.
//
// Check labels are kept stable: the 38 labels this file had before t5 are all
// still present (AC-A0-1); the t5 rebaseline changed their expectations to the
// frozen spec and added AC-labelled checks around them.
import { readFileSync, existsSync, statSync, mkdtempSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs'
import { promises as nodeFs } from 'node:fs'
import { createHash } from 'node:crypto'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { createServer } from 'node:http'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

/* ------------------------------------------------------------------- seal */

const REAL_LIBRARY = join(homedir(), '.dsh', 'research-cat', 'library.json')

function fingerprint(path) {
  if (!existsSync(path)) return { exists: false, size: null, mtimeMs: null, sha256: null }
  const buffer = readFileSync(path)
  const stat = statSync(path)
  return {
    exists: true,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    sha256: createHash('sha256').update(buffer).digest('hex'),
  }
}

const realBefore = fingerprint(REAL_LIBRARY)

const tmpRoot = mkdtempSync(join(tmpdir(), 'dsh-research-cat-local-'))
const tmpHome = join(tmpRoot, 'home')
process.env.DSH_HOME = tmpHome
const engineStore = join(tmpRoot, 'engine', 'library.json')
const hostStore = join(tmpRoot, 'host', 'library.json')
const defaultTmpStore = join(tmpHome, 'research-cat', 'library.json')

let failures = 0
const seenLabels = new Set()
const gaps = []
function check(label, condition, detail) {
  seenLabels.add(label)
  if (condition) {
    console.log('  PASS ' + label)
  } else {
    failures++
    console.log('  FAIL ' + label + (detail === undefined ? '' : ' -> ' + detail))
  }
}

/**
 * A verified shortfall that is not an AC-A0-1 regression: printed loudly, never
 * counted as a pass, and listed in the summary. Used for the AC-A2-7 seed-count
 * gap (see test/AC-EVIDENCE.md finding F6).
 */
function report(label, detail) {
  gaps.push(label)
  console.log('  GAP  ' + label + (detail === undefined ? '' : ' -> ' + detail))
}

const message = (error) => (error !== null && error !== undefined && error.message !== undefined ? String(error.message) : String(error))
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/** Run one engine call and return the thrown error, or null. */
async function thrown(fn) {
  try {
    await fn()
    return null
  } catch (error) {
    return error
  }
}

/* ----------------------------------------------------------- fetch stubs */

/**
 * Synthetic OpenAlex-shaped fetch. Deterministic, offline, records every URL
 * and the maximum number of concurrent requests (AC-A2-4).
 */
function makeSyntheticFetch(options) {
  const config = options === undefined ? {} : options
  const works = config.works === undefined ? {} : config.works
  const failIds = config.failIds === undefined ? new Set() : config.failIds
  const delayMs = config.delayMs === undefined ? 0 : config.delayMs
  const log = { urls: [], requests: 0, inFlight: 0, maxInFlight: 0 }

  function project(work) {
    return {
      id: work.id,
      doi: work.doi === undefined ? null : work.doi,
      title: work.title,
      display_name: work.title,
      publication_year: work.publication_year,
      cited_by_count: work.cited_by_count,
      type: work.type,
      primary_location: work.venue === undefined || work.venue === null ? null : { source: { display_name: work.venue } },
      open_access: { is_oa: work.is_oa === true },
      is_retracted: work.is_retracted === true,
      referenced_works: work.referenced_works === undefined ? [] : work.referenced_works,
      related_works: work.related_works === undefined ? [] : work.related_works,
      authorships: work.authorships === undefined
        ? []
        : work.authorships.map((entry) => ({ author: { id: entry.id === undefined ? null : entry.id, orcid: entry.orcid === undefined ? null : entry.orcid, display_name: entry.name } })),
    }
  }

  const reply = (status, body) => ({
    ok: status >= 200 && status < 300,
    status: status,
    async text() { return JSON.stringify(body) },
  })

  function list(url) {
    const filter = url.searchParams.get('filter') === null ? '' : url.searchParams.get('filter')
    const parts = filter === '' ? [] : filter.split(',')
    const pick = (prefix) => {
      for (let i = 0; i < parts.length; i++) if (parts[i].indexOf(prefix) === 0) return parts[i].slice(prefix.length)
      return null
    }
    const idPart = pick('openalex_id:')
    const doiPart = pick('doi:')
    const citesPart = pick('cites:')
    const authorPart = pick('author.id:')
    const fromDate = pick('from_publication_date:')
    const toDate = pick('to_publication_date:')
    const isOa = pick('is_oa:')
    const isRetracted = pick('is_retracted:')
    const minCited = pick('cited_by_count:')
    const search = url.searchParams.get('search')
    const sort = url.searchParams.get('sort') === null ? '' : url.searchParams.get('sort')
    const perPage = Number(url.searchParams.get('per-page') === null ? '25' : url.searchParams.get('per-page'))
    const ids = Object.keys(works)
    let picked
    if (idPart !== null) picked = idPart.split('|')
    else if (citesPart !== null) picked = ids.filter((id) => (works[id].cites === undefined ? [] : works[id].cites).indexOf(citesPart) >= 0)
    else if (authorPart !== null) picked = ids.filter((id) => (works[id].authorIds === undefined ? [] : works[id].authorIds).indexOf(authorPart) >= 0)
    else if (doiPart !== null) picked = ids.filter((id) => String(works[id].doi === undefined ? '' : works[id].doi).toLowerCase() === doiPart.toLowerCase())
    else if (search !== null) picked = ids.filter((id) => works[id].title.toLowerCase().indexOf(search.toLowerCase()) >= 0)
    else picked = ids
    let out = picked.filter((id) => works[id] !== undefined)
    if (fromDate !== null) { const year = Number(fromDate.slice(0, 4)); out = out.filter((id) => works[id].publication_year >= year) }
    if (toDate !== null) { const year = Number(toDate.slice(0, 4)); out = out.filter((id) => works[id].publication_year <= year) }
    if (isOa !== null) out = out.filter((id) => (works[id].is_oa === true) === (isOa === 'true'))
    if (isRetracted !== null) out = out.filter((id) => (works[id].is_retracted === true) === (isRetracted === 'true'))
    if (minCited !== null) { const floor = Number(minCited.replace('>', '')); out = out.filter((id) => works[id].cited_by_count > floor) }
    if (sort === 'publication_year:desc') {
      out.sort((a, b) => works[b].publication_year - works[a].publication_year || works[b].cited_by_count - works[a].cited_by_count)
    } else {
      out.sort((a, b) => works[b].cited_by_count - works[a].cited_by_count || (a < b ? -1 : a > b ? 1 : 0))
    }
    const results = out.slice(0, perPage).map((id) => project(works[id]))
    return { results: results, meta: { count: out.length } }
  }

  async function fetchImpl(rawUrl) {
    const url = new URL(String(rawUrl))
    log.urls.push(String(rawUrl))
    log.requests += 1
    log.inFlight += 1
    if (log.inFlight > log.maxInFlight) log.maxInFlight = log.inFlight
    try {
      if (delayMs > 0) await new Promise((done) => setTimeout(done, delayMs))
      if (url.pathname.indexOf('/authors') === 0) {
        const filter = url.searchParams.get('filter') === null ? '' : url.searchParams.get('filter')
        const orcids = /orcid:([^&,]+)/.exec(filter)
        const wanted = orcids === null ? [] : orcids[1].split('|')
        const results = []
        for (let i = 0; i < wanted.length; i++) {
          const profiles = (config.orcidProfiles === undefined ? {} : config.orcidProfiles)[wanted[i]]
          if (Array.isArray(profiles)) for (let p = 0; p < profiles.length; p++) results.push(profiles[p])
        }
        return reply(200, { results: results })
      }
      if (url.pathname.indexOf('/works/') === 0) {
        const id = url.pathname.split('/')[2]
        if (failIds.has(id)) return reply(404, { error: 'not found' })
        if (works[id] === undefined) return reply(404, { error: 'not found' })
        return reply(200, project(works[id]))
      }
      return reply(200, list(url))
    } finally {
      log.inFlight -= 1
    }
  }

  return { fetchImpl: fetchImpl, log: log }
}

/** A small corpus reused by the offline engine checks. */
function corpus() {
  const works = {
    W1: { id: 'W1', title: 'Seed One', publication_year: 2000, cited_by_count: 100, type: 'journal-article', venue: 'Journal of Testing', doi: 'https://doi.org/10.1000/one', is_oa: true, referenced_works: ['W10', 'W11', 'W12', 'W13', 'W30', 'W14'], related_works: ['W20'], authorIds: ['A1'], authorships: [{ id: 'A1', name: 'Ada Lovelace' }] },
    W2: { id: 'W2', title: 'Seed Two', publication_year: 2010, cited_by_count: 50, type: 'book', referenced_works: ['W12', 'W14'], related_works: ['W20'], authorIds: ['A2'], authorships: [{ id: 'A2', name: 'Grace Hopper' }] },
    W10: { id: 'W10', title: 'Older Work', publication_year: 1990, cited_by_count: 30, type: 'journal-article', venue: 'Old Journal', is_oa: false, cites: ['W1'] },
    W11: { id: 'W11', title: 'Same Year Work', publication_year: 2000, cited_by_count: 20, type: 'book-chapter', cites: ['W1'] },
    W12: { id: 'W12', title: 'Unknown Year Work', publication_year: 0, cited_by_count: 10, type: 'dataset', cites: ['W1'] },
    W13: { id: 'W13', title: 'Nineties Work', publication_year: 1995, cited_by_count: 5, type: 'proceedings-article', is_oa: true, cites: ['W1'] },
    W14: { id: 'W14', title: 'Newer Work', publication_year: 2020, cited_by_count: 60, type: 'journal-article', venue: 'Journal of Testing', is_oa: false, cites: ['W1'] },
    W20: { id: 'W20', title: 'Related Work', publication_year: 2005, cited_by_count: 40, type: 'journal-article' },
    W30: { id: 'W30', title: 'Retracted Work', publication_year: 2015, cited_by_count: 80, type: 'journal-article', is_retracted: true, venue: 'Retracted Journal' },
    W40: { id: 'W40', title: 'Same Author Work', publication_year: 2005, cited_by_count: 70, type: 'journal-article', authorIds: ['A1'], authorships: [{ id: 'A1', name: 'Ada Lovelace' }] },
  }
  for (let i = 1; i <= 51; i++) {
    const id = 'W' + (9000 + i)
    works[id] = { id: id, title: 'Seed ' + i, publication_year: 2000 + (i % 10), cited_by_count: i, type: 'journal-article' }
  }
  return works
}

const offlineConfig = { mailto: 'dsh-research-cat@localhost', searchPerPage: 50, maxNodes: 1000, maxBatch: 100, maxCitations: 100, maxSeeds: 50, concurrency: 4 }

/* ---------------------------------------------------------------- loader */

const registrations = []
const fakeReact = {
  createElement: () => null,
  useState: () => [undefined, () => {}],
  useEffect: () => {},
  useMemo: () => undefined,
  useRef: () => ({ current: null }),
}
const sandboxWindow = {
  __ModuleLoader__: { load: (registration) => registrations.push(registration) },
}
runInNewContext(readFileSync(resolve(root, 'src/client.js'), 'utf8'), { window: sandboxWindow }, {
  filename: 'src/client.js',
})
check('client registers exactly one Loader module', registrations.length === 1, 'got ' + registrations.length)
const registration = registrations[0]
check('loader id is the package name', registration && registration.id === 'dsh-research-cat', String(registration && registration.id))

const requested = new Set()
const clientExports = registration.factory((specifier) => {
  requested.add(specifier)
  if (specifier === 'react') return fakeReact
  throw new Error('unexpected require: ' + specifier)
})
check('client only requires react from the shell', [...requested].join(',') === 'react', [...requested].join(','))
check('client exports name', clientExports.name === 'dsh-research-cat', String(clientExports.name))
check('client injects slots', Array.isArray(clientExports.inject) && clientExports.inject.includes('slots'), JSON.stringify(clientExports.inject))
check('client exports apply', typeof clientExports.apply === 'function')

/* ---------------------------------------------------------------- config */

const { resolveConfig } = await import(resolve(root, 'src/config.js'))
const defaults = resolveConfig(undefined)
check('config defaults',
  defaults.exposeTool === true &&
  defaults.mailto === 'dsh-research-cat@localhost' &&
  defaults.searchPerPage === 50 &&
  defaults.maxNodes === 1000 &&
  defaults.maxBatch === 100 &&
  defaults.maxCitations === 100 &&
  defaults.maxSeeds === 50 &&
  defaults.concurrency === 4 &&
  defaults.storePath === defaultTmpStore,
  JSON.stringify(defaults))

check('AC-A5-1 the frozen config default set is complete and resolves storePath under DSH_HOME',
  sameJson(Object.keys(defaults).sort(), ['apiKey', 'concurrency', 'exposeTool', 'mailto', 'maxBatch', 'maxCitations', 'maxNodes', 'maxSeeds', 'searchPerPage', 'storePath']) &&
  defaults.storePath === defaultTmpStore,
  JSON.stringify({ keys: Object.keys(defaults).sort(), storePath: defaults.storePath }))

const overridden = resolveConfig({ exposeTool: false, mailto: 'a@b.c', maxNodes: 12, maxBatch: 'x' })
check('config overrides + bad values fall back',
  overridden.exposeTool === false && overridden.mailto === 'a@b.c' && overridden.maxNodes === 12 &&
  overridden.maxBatch === 100 && overridden.maxCitations === 100 && overridden.maxSeeds === 50 &&
  overridden.concurrency === 4 && overridden.searchPerPage === 50,
  JSON.stringify(overridden))

check('AC-A5-6 every quota key can be overridden and the override is recorded',
  sameJson(resolveConfig({ searchPerPage: 7, maxBatch: 8, maxCitations: 9, maxNodes: 10, maxSeeds: 11, concurrency: 2 }),
    { exposeTool: true, mailto: 'dsh-research-cat@localhost', searchPerPage: 7, maxNodes: 10, maxBatch: 8, maxCitations: 9, maxSeeds: 11, concurrency: 2, storePath: defaultTmpStore }),
  JSON.stringify(resolveConfig({ searchPerPage: 7, maxBatch: 8, maxCitations: 9, maxNodes: 10, maxSeeds: 11, concurrency: 2 })))

/* -------------------------------------------------- store path resolution */

const { defaultStorePath, resolveStorePath, dshHomeDir } = await import(resolve(root, 'src/store.js'))
check('AC-B1-8 storePath level 2: DSH_HOME decides the default path (no hardcoded home)',
  dshHomeDir() === tmpHome && defaultStorePath() === defaultTmpStore && resolveStorePath(undefined) === defaultTmpStore,
  JSON.stringify({ dshHome: dshHomeDir(), def: defaultStorePath() }))
check('AC-B1-8 storePath level 1: an explicit absolute storePath wins over DSH_HOME',
  resolveStorePath('/tmp/explicit/library.json') === '/tmp/explicit/library.json',
  resolveStorePath('/tmp/explicit/library.json'))
check('AC-B1-8 storePath level 1: a relative storePath resolves against DSH_HOME',
  resolveStorePath('nested/library.json') === join(tmpHome, 'nested', 'library.json'),
  resolveStorePath('nested/library.json'))
{
  const saved = process.env.DSH_HOME
  delete process.env.DSH_HOME
  const fallback = defaultStorePath()
  process.env.DSH_HOME = saved
  check('AC-B1-8 storePath level 3: with DSH_HOME unset the default falls back to <homedir>/.dsh (pure resolution, no IO)',
    fallback === join(homedir(), '.dsh', 'research-cat', 'library.json'),
    fallback)
}

/* ---------------------------------------------------------------- engine */

const { createLibrary, uniqueWorkIds, chunkIds, normalizeFilters, applyFilters } = await import(resolve(root, 'src/graph.js'))
check('uniqueWorkIds normalises and de-duplicates',
  uniqueWorkIds(['https://openalex.org/W1', 'W1', 'W2', 'bad'], 10).join(',') === 'W1,W2')

const SEED = 'W2907492528'
const networkUrls = []
const recordingFetch = (url, init) => { networkUrls.push(String(url)); return fetch(url, init) }
const library = createLibrary({ ...defaults, storePath: engineStore, fetchImpl: recordingFetch })
await library.ready()
check('AC-B1-8 the sealed engine storePath is the explicit config path under os.tmpdir()',
  library.storeInfo().storePath === engineStore && engineStore.indexOf(tmpdir()) === 0,
  JSON.stringify(library.storeInfo()))

check('fresh state is empty', library.state().counts.papers === 0)

// Live OpenAlex block. Any outage (including a 429) must turn every network AC
// into a FAIL with the real error, never crash the suite and never pass
// silently (spec §10.4).
const LIVE_LABELS = [
  'search reaches OpenAlex', 'search returns OpenAlex matches', 'search results carry work ids',
  'AC-A5-2 search asks OpenAlex for per-page=50 and returns at most 50 rows',
  'AC-A5-7 every OpenAlex request carries the polite-pool mailto',
  'blank query is rejected', 'addSeed collects the paper', 'addSeed reports the record',
  'expand pulls references', 'expand respects the batch cap',
  "AC-A5-3 references beyond OpenAlex's 50-id filter limit are fetched in chunks (found > 50 needs >= 2 requests)",
  'AC-A5-3 the chunking helper splits 100 ids into 2 chunks and never truncates silently',
  're-expanding adds nothing (dedup)', 'expand pulls citing papers',
  'AC-A5-4 citations expand returns at most maxCitations',
  'details returns authors + abstract', 'details reconstructs the abstract', 'state snapshots nodes and links',
  "AC-A1-1 /authors returns the probe paper's OpenAlex author ids in authorships order",
  "AC-A1-1 the probe paper's authorships carry author.id === null upstream, so the ORCID fallback is the legal path",
  "AC-A1-2 the author axis links the probe paper to the author's works (kind author, source = probe id)",
  'AC-A1-3 the author axis returns works with citedBy monotonically non-increasing',
  'AC-A1-4 kind author without authorId is rejected with a usable hint (never silently picks the first author)',
  'AC-A3-1 earlier returns only nodes strictly older than the seed (edge kind earlier)',
  'AC-A3-2 later returns only nodes strictly newer than the seed (edge kind later)',
  'removeSeed drops the seed and its exclusive neighbours', 'clear empties everything', 'bad work id is rejected',
]

try {

let search
try {
  search = await library.search('graph neural networks')
  check('search returns OpenAlex matches', search.results.length > 0, String(search.results.length))
  check('search results carry work ids', /^W\d+$/.test(search.results[0].id), search.results[0].id)
} catch (error) {
  check('search reaches OpenAlex', false, message(error))
}

check('AC-A5-2 search asks OpenAlex for per-page=50 and returns at most 50 rows',
  networkUrls.some((url) => url.indexOf('per-page=50') >= 0) && search !== undefined && search.results.length <= 50,
  JSON.stringify({ searchUrls: networkUrls.filter((url) => url.indexOf('search=') >= 0), rows: search === undefined ? null : search.results.length }))
check('AC-A5-7 every OpenAlex request carries the polite-pool mailto',
  networkUrls.length > 0 && networkUrls.every((url) => url.indexOf('mailto=') >= 0),
  JSON.stringify(networkUrls.filter((url) => url.indexOf('mailto=') < 0)))

try {
  await library.search('   ')
  check('blank query is rejected', false, 'no throw')
} catch (error) {
  check('blank query is rejected', /Type a title/.test(message(error)), message(error))
}

const added = await library.addSeed(SEED)
check('addSeed collects the paper', added.counts.seeds === 1 && added.record.title.length > 0, JSON.stringify(added.counts))
check('addSeed reports the record', added.record.id === SEED, added.record.id)

const refs = await library.expand(SEED, 'references')
check('expand pulls references', refs.found > 0 && refs.added > 0, JSON.stringify(refs.counts))
check('expand respects the batch cap', refs.found <= defaults.maxBatch, String(refs.found))
check('AC-A5-3 references beyond OpenAlex\'s 50-id filter limit are fetched in chunks (found > 50 needs >= 2 requests)',
  refs.found > 50 && networkUrls.filter((url) => url.indexOf('openalex_id') >= 0).length >= 2,
  JSON.stringify({ found: refs.found, chunkRequests: networkUrls.filter((url) => url.indexOf('openalex_id') >= 0).length }))
check('AC-A5-3 the chunking helper splits 100 ids into 2 chunks and never truncates silently',
  chunkIds(Array.from({ length: 100 }, (_, i) => 'W' + (i + 1))).length === 2 &&
  chunkIds(Array.from({ length: 51 }, (_, i) => 'W' + (i + 1)))[1].length === 1)

const again = await library.expand(SEED, 'references')
check('re-expanding adds nothing (dedup)', again.added === 0 && again.counts.papers === refs.counts.papers, JSON.stringify(again.counts))

const cites = await library.expand(SEED, 'citations')
check('expand pulls citing papers', cites.found > 0 && cites.found <= defaults.maxCitations, String(cites.found))
check('AC-A5-4 citations expand returns at most maxCitations', cites.found <= defaults.maxCitations, String(cites.found))

const detail = await library.details(SEED)
check('details returns authors + abstract', Array.isArray(detail.paper.authors) && detail.paper.authors.length > 0, JSON.stringify(detail.paper.authors.slice(0, 2)))
check('details reconstructs the abstract', typeof detail.paper.abstract === 'string' && detail.paper.abstract.length > 50, String(detail.paper.abstract.length))

const state = library.state()
check('state snapshots nodes and links', state.counts.papers > 1 && state.counts.links > 1 && state.graph.seeds.includes(SEED), JSON.stringify(state.counts))

/* ------------------------------------- AC-A1: author axis (live OpenAlex) */

const seedYear = state.graph.nodes.find((node) => node.id === SEED).year

// The spec probe W2907492528 carries `author.id: null` upstream (ORCID only).
// Capture that raw fact so the ORCID fallback is documented, not assumed.
let upstreamNullIds = null
let upstreamOrcids = null
try {
  const rawResponse = await fetch('https://api.openalex.org/works/' + SEED + '?select=id,authorships&mailto=dsh-research-cat@localhost')
  const raw = await rawResponse.json()
  const authorships = Array.isArray(raw.authorships) ? raw.authorships : []
  upstreamNullIds = authorships.filter((entry) => entry.author !== null && entry.author !== undefined && entry.author.id === null).length
  upstreamOrcids = authorships.filter((entry) => entry.author !== null && entry.author !== undefined && typeof entry.author.orcid === 'string').length
} catch (error) {
  upstreamNullIds = null
  upstreamOrcids = null
}

let authors = null
try {
  authors = await library.authors(SEED)
  check('AC-A1-1 /authors returns the probe paper\'s OpenAlex author ids in authorships order',
    Array.isArray(authors.authors) && authors.authors.length > 0 && authors.authors.every((entry) => /^A\d+$/.test(entry.id)) && typeof authors.authors[0].name === 'string',
    JSON.stringify(authors.authors.slice(0, 3)))
  check('AC-A1-1 the probe paper\'s authorships carry author.id === null upstream, so the ORCID fallback is the legal path',
    upstreamNullIds === null || upstreamNullIds > 0,
    JSON.stringify({ upstreamNullIds: upstreamNullIds, upstreamOrcids: upstreamOrcids }))
} catch (error) {
  check('AC-A1-1 /authors returns the probe paper\'s OpenAlex author ids in authorships order', false, message(error))
}

let authorExpand = null
if (authors !== null && authors.authors.length > 0) {
  try {
    authorExpand = await library.expand(SEED, 'author', { authorId: authors.authors[0].id })
    const authorLinks = authorExpand.graph.links.filter((link) => link.kind === 'author' && link.source === SEED)
    check('AC-A1-2 the author axis links the probe paper to the author\'s works (kind author, source = probe id)',
      authorExpand.kind === 'author' && authorExpand.added > 0 && authorLinks.length > 0,
      JSON.stringify({ kind: authorExpand.kind, added: authorExpand.added, authorLinks: authorLinks.length }))
    const authorNodes = authorExpand.ids.map((id) => authorExpand.graph.nodes.find((node) => node.id === id)).filter(Boolean)
    let monotonic = true
    for (let i = 1; i < authorNodes.length; i++) if (authorNodes[i].citedBy > authorNodes[i - 1].citedBy) monotonic = false
    check('AC-A1-3 the author axis returns works with citedBy monotonically non-increasing',
      authorNodes.length > 0 && monotonic,
      JSON.stringify(authorNodes.slice(0, 5).map((node) => node.citedBy)))
  } catch (error) {
    check('AC-A1-2 the author axis links the probe paper to the author\'s works (kind author, source = probe id)', false, message(error))
    check('AC-A1-3 the author axis returns works with citedBy monotonically non-increasing', false, message(error))
  }
}

const noAuthorId = await thrown(() => library.expand(SEED, 'author'))
check('AC-A1-4 kind author without authorId is rejected with a usable hint (never silently picks the first author)',
  noAuthorId !== null && noAuthorId.code === 'invalid' && /authorId/.test(message(noAuthorId)) && /A\d+/.test(message(noAuthorId)),
  message(noAuthorId))

/* ------------------------------------- AC-A3: earlier / later (live) */

try {
  const earlier = await library.expand(SEED, 'earlier')
  const earlierNodes = earlier.ids.map((id) => earlier.graph.nodes.find((node) => node.id === id)).filter(Boolean)
  check('AC-A3-1 earlier returns only nodes strictly older than the seed (edge kind earlier)',
    earlier.kind === 'earlier' && earlierNodes.length > 0 && earlierNodes.every((node) => node.year > 0 && node.year < seedYear) &&
    earlier.graph.links.some((link) => link.kind === 'earlier' && link.source === SEED),
    JSON.stringify({ seedYear: seedYear, years: earlierNodes.map((node) => node.year).slice(0, 5), found: earlier.found }))
} catch (error) {
  check('AC-A3-1 earlier returns only nodes strictly older than the seed (edge kind earlier)', false, message(error))
}

try {
  const later = await library.expand(SEED, 'later')
  const laterNodes = later.ids.map((id) => later.graph.nodes.find((node) => node.id === id)).filter(Boolean)
  check('AC-A3-2 later returns only nodes strictly newer than the seed (edge kind later)',
    later.kind === 'later' && laterNodes.length > 0 && laterNodes.every((node) => node.year > seedYear) &&
    later.graph.links.some((link) => link.kind === 'later' && link.source === SEED),
    JSON.stringify({ seedYear: seedYear, years: laterNodes.map((node) => node.year).slice(0, 5), found: later.found }))
} catch (error) {
  check('AC-A3-2 later returns only nodes strictly newer than the seed (edge kind later)', false, message(error))
}

const removed = library.removeSeed(SEED)
check('removeSeed drops the seed and its exclusive neighbours', !removed.graph.seeds.includes(SEED) && removed.counts.papers < state.counts.papers, JSON.stringify(removed.counts))

const cleared = library.clear()
check('clear empties everything', cleared.counts.papers === 0 && cleared.counts.seeds === 0, JSON.stringify(cleared.counts))

try {
  await library.expand('nonsense', 'references')
  check('bad work id is rejected', false, 'no throw')
} catch (error) {
  check('bad work id is rejected', /needs an OpenAlex work id/.test(message(error)), message(error))
}

} catch (liveError) {
  console.log('  NOTE the live OpenAlex block aborted: ' + message(liveError))
  for (const label of LIVE_LABELS) {
    if (seenLabels.has(label) !== true) check(label, false, 'live OpenAlex block aborted: ' + message(liveError))
  }
}

/* ------------------------------- offline engine: quotas + failure paths */

{
  const stub = makeSyntheticFetch({ works: corpus() })
  const lib = createLibrary({ ...offlineConfig, storePath: join(tmpRoot, 'offline', 'library.json'), fetchImpl: stub.fetchImpl })
  await lib.ready()

  // AC-A2-1: 50 seeds allowed, the 51st is rejected with the ceiling in the message.
  let lastError = null
  for (let i = 1; i <= 50; i++) await lib.addSeed('W' + (9000 + i))
  lastError = await thrown(() => lib.addSeed('W9051'))
  check('AC-A2-1 addSeed accepts 50 seeds and rejects the 51st with the ceiling in the message',
    lib.state().counts.seeds === 50 && lastError !== null && lastError.code === 'invalid' && message(lastError).indexOf('50') >= 0,
    JSON.stringify({ seeds: lib.state().counts.seeds, error: message(lastError) }))
  const small = createLibrary({ ...offlineConfig, maxSeeds: 2, storePath: join(tmpRoot, 'seeds2', 'library.json'), fetchImpl: stub.fetchImpl })
  await small.ready()
  await small.addSeed('W9001')
  await small.addSeed('W9002')
  const overSeeds = await thrown(() => small.addSeed('W9003'))
  check('AC-A2-1 the seed ceiling is configurable (maxSeeds=2 rejects the third seed with the ceiling in the message)',
    overSeeds !== null && overSeeds.code === 'invalid' && message(overSeeds).indexOf('2') >= 0,
    message(overSeeds))
}

{
  // AC-A2-4: concurrency is capped at 4 even for 3 seeds x 2 axes.
  const stub = makeSyntheticFetch({ works: corpus(), delayMs: 15 })
  const lib = createLibrary({ ...offlineConfig, concurrency: 4, storePath: join(tmpRoot, 'concurrency', 'library.json'), fetchImpl: stub.fetchImpl })
  await lib.ready()
  await lib.addSeed('W1')
  await lib.addSeed('W2')
  await lib.addSeed('W10')
  const outcome = await lib.expandAll({ kinds: ['references', 'related'] })
  check('AC-A2-4 expandAll keeps at most 4 concurrent OpenAlex requests for 3 seeds x 2 axes',
    stub.log.maxInFlight <= 4 && stub.log.requests >= 6 && outcome.perSeed.length === 6,
    JSON.stringify({ maxInFlight: stub.log.maxInFlight, requests: stub.log.requests, tasks: outcome.perSeed.length }))
  check('AC-A2-5 expandAll is idempotent: the second run adds nothing and does not change counts.papers',
    await (async () => {
      const before = lib.state().counts.papers
      const second = await lib.expandAll({ kinds: ['references', 'related'] })
      return second.added === 0 && lib.state().counts.papers === before
    })())
}

{
  // AC-A2-3: one failing seed does not abort the batch.
  const stub = makeSyntheticFetch({ works: corpus(), failIds: new Set(['W2']) })
  const lib = createLibrary({ ...offlineConfig, storePath: join(tmpRoot, 'isolate', 'library.json'), fetchImpl: stub.fetchImpl })
  await lib.ready()
  await lib.addSeed('W1')
  await lib.addSeed('W2')
  const outcome = await lib.expandAll({ kinds: ['references'] })
  const errored = outcome.perSeed.filter((entry) => entry.error !== null && entry.error !== undefined)
  const succeeded = outcome.perSeed.filter((entry) => entry.error === null || entry.error === undefined)
  check('AC-A2-3 a failing seed is isolated: perSeed carries the error, the other seed still expands, skipped counts it',
    outcome.perSeed.length === 2 && errored.length === 1 && succeeded.length === 1 && succeeded[0].added > 0 && outcome.skipped === 1 && typeof outcome.warning === 'string',
    JSON.stringify(outcome.perSeed))
}

{
  // AC-A2-6 / AC-A5-5: the graph ceiling stops expansion with a readable reason.
  const stub = makeSyntheticFetch({ works: corpus() })
  const lib = createLibrary({ ...offlineConfig, maxNodes: 1, storePath: join(tmpRoot, 'quota', 'library.json'), fetchImpl: stub.fetchImpl })
  await lib.ready()
  await lib.addSeed('W1')
  const error = await thrown(() => lib.expand('W1', 'references'))
  check('AC-A5-5 expanding past maxNodes is refused with a readable "clear it" message and never half-writes',
    error !== null && error.code === 'operation' && /clear it/.test(message(error)) && lib.state().counts.papers <= 1,
    JSON.stringify({ code: error === null ? null : error.code, message: message(error), papers: lib.state().counts.papers }))
  const batch = await lib.expandAll({ kinds: ['references'] })
  check('AC-A2-6 expandAll reports skipped > 0 at the ceiling without throwing and keeps counts.papers <= maxNodes',
    batch.skipped > 0 && lib.state().counts.papers <= 1 && typeof batch.warning === 'string',
    JSON.stringify({ skipped: batch.skipped, papers: lib.state().counts.papers, warning: batch.warning }))
}

{
  // OpenAlex transport failure paths, offline and deterministic.
  const statusFetch = (status, body) => {
    const state = { calls: 0 }
    return {
      state: state,
      fetchImpl: async () => {
        state.calls += 1
        return { ok: status >= 200 && status < 300, status: status, async text() { return body } }
      },
    }
  }
  const tooMany = statusFetch(429, '{"error":"Rate limit exceeded"}')
  const lib429 = createLibrary({ ...offlineConfig, storePath: join(tmpRoot, 'http429', 'library.json'), fetchImpl: tooMany.fetchImpl, retryDelayMs: 1 })
  await lib429.ready()
  const error429 = await thrown(() => lib429.search('anything'))
  check('failure path: an OpenAlex 429 (over quota) is retried once and then surfaced as an operation error, never a crash or a silent pass',
    error429 !== null && error429.code === 'operation' && tooMany.state.calls === 2,
    JSON.stringify({ calls: tooMany.state.calls, error: message(error429) }))

  const notFound = statusFetch(404, '{"error":"not found"}')
  const lib404 = createLibrary({ ...offlineConfig, storePath: join(tmpRoot, 'http404', 'library.json'), fetchImpl: notFound.fetchImpl, retryDelayMs: 1 })
  await lib404.ready()
  const error404 = await thrown(() => lib404.search('anything'))
  check('failure path: an OpenAlex 404 is mapped to an invalid error without retrying',
    error404 !== null && error404.code === 'invalid' && notFound.state.calls === 1,
    JSON.stringify({ calls: notFound.state.calls, error: message(error404) }))

  const truncated = statusFetch(200, '{"results":')
  const libTrunc = createLibrary({ ...offlineConfig, storePath: join(tmpRoot, 'truncated', 'library.json'), fetchImpl: truncated.fetchImpl, retryDelayMs: 1 })
  await libTrunc.ready()
  const errorTrunc = await thrown(() => libTrunc.search('anything'))
  check('failure path: a truncated OpenAlex body becomes a readable operation error',
    errorTrunc !== null && errorTrunc.code === 'operation' && /cut short/.test(message(errorTrunc)),
    message(errorTrunc))
}

{
  // AC-A3-3: same-year and year===0 neighbours are excluded; an empty result is a success.
  const stub = makeSyntheticFetch({ works: corpus() })
  const lib = createLibrary({ ...offlineConfig, storePath: join(tmpRoot, 'boundary', 'library.json'), fetchImpl: stub.fetchImpl })
  await lib.ready()
  await lib.addSeed('W1') // year 2000, references 1990 / 2000 / 0 / 1995 / 2015
  const earlier = await lib.expand('W1', 'earlier')
  const years = earlier.ids.map((id) => earlier.graph.nodes.find((node) => node.id === id).year).sort((a, b) => a - b)
  check('AC-A3-3 earlier excludes the same-year and year===0 neighbours (strict comparison)',
    sameJson(years, [1990, 1995]) && earlier.found === 2,
    JSON.stringify({ years: years, found: earlier.found }))
  await lib.addSeed('W2') // year 2010, references 0 / 2020
  const empty = await lib.expand('W2', 'earlier')
  check('AC-A3-3 an empty earlier/later result returns found:0 as a success, not an error',
    empty.found === 0 && empty.added === 0 && typeof empty.note === 'string',
    JSON.stringify({ found: empty.found, note: empty.note }))
}

{
  // AC-A1-5 / AC-A4: filters apply to the author axis and to every other axis.
  const stub = makeSyntheticFetch({ works: corpus() })
  const lib = createLibrary({ ...offlineConfig, storePath: join(tmpRoot, 'filters', 'library.json'), fetchImpl: stub.fetchImpl })
  await lib.ready()
  await lib.addSeed('W1')
  const authorFiltered = await lib.expand('W1', 'author', { authorId: 'A1', filters: { yearFrom: 1995 } })
  const authorYears = authorFiltered.ids.map((id) => authorFiltered.graph.nodes.find((node) => node.id === id).year)
  check('AC-A1-5 the author axis obeys filters and the batch cap',
    authorYears.length > 0 && authorYears.every((year) => year >= 1995) && authorFiltered.found <= offlineConfig.maxBatch,
    JSON.stringify(authorYears))

  const unfiltered = await lib.expand('W1', 'references')
  const filtered = await lib.expand('W1', 'references', { filters: { minCitations: 25 } })
  check('AC-A4-6 found reports the post-filter count, never the unfiltered count',
    filtered.found < unfiltered.found && filtered.found === filtered.ids.filter((id) => lib.state().graph.nodes.find((node) => node.id === id).citedBy >= 25).length,
    JSON.stringify({ unfiltered: unfiltered.found, filtered: filtered.found }))

  const oaFiltered = await lib.expand('W1', 'references', { filters: { isOa: true } })
  check('AC-A4-4 isOa/isRetracted filter on the new boolean record fields (never null)',
    oaFiltered.ids.every((id) => lib.state().graph.nodes.find((node) => node.id === id).openAccess === true),
    JSON.stringify(oaFiltered.ids))
  const retracted = await lib.expand('W1', 'references', { filters: { isRetracted: true } })
  check('AC-A4-4 isRetracted:true returns only retracted works and the field is a real boolean',
    retracted.ids.length > 0 && retracted.ids.every((id) => lib.state().graph.nodes.find((node) => node.id === id).retracted === true),
    JSON.stringify(retracted.ids))

  const venueUpper = await lib.expand('W1', 'references', { filters: { venue: 'JOURNAL OF TESTING' } })
  const venueEmpty = await lib.expand('W1', 'references', { filters: { venue: '' } })
  check('AC-A4-3 venue matches case-insensitively by substring and venue:"" means "not provided"',
    venueUpper.found === 1 && venueEmpty.found === unfiltered.found,
    JSON.stringify({ upper: venueUpper.found, empty: venueEmpty.found, unfiltered: unfiltered.found }))

  const deterministicA = await lib.expand('W1', 'references', { filters: { sort: 'year' } })
  const deterministicB = await lib.expand('W1', 'references', { filters: { sort: 'year' } })
  check('AC-A4-8 filtering is deterministic: the same input yields the same id sequence',
    sameJson(deterministicA.ids, deterministicB.ids))

  const badFilters = [
    await thrown(() => lib.expand('W1', 'references', { filters: { nope: 1 } })),
    await thrown(() => lib.expand('W1', 'references', { filters: { isOa: 'yes' } })),
    await thrown(() => lib.expand('W1', 'references', { filters: { minCitations: -1 } })),
    await thrown(() => lib.expand('W1', 'references', { filters: { sort: 'nope' } })),
  ]
  check('AC-A4-7 unknown keys, non-booleans, negative minimums and illegal sort are all invalid errors',
    badFilters.every((error) => error !== null && error.code === 'invalid'),
    JSON.stringify(badFilters.map((error) => message(error))))
  check('AC-A4-2 yearFrom > yearTo is invalid instead of an empty success',
    await (async () => {
      const error = await thrown(() => lib.expand('W1', 'references', { filters: { yearFrom: 2020, yearTo: 2010 } }))
      return error !== null && error.code === 'invalid' && /yearFrom/.test(message(error))
    })())
  check('AC-A4-2 yearFrom/yearTo are closed intervals (boundary years included)',
    await (async () => {
      const bounded = await lib.expand('W1', 'references', { filters: { yearFrom: 1995, yearTo: 2000 } })
      const years = bounded.ids.map((id) => lib.state().graph.nodes.find((node) => node.id === id).year)
      return sameJson(years.slice().sort((a, b) => a - b), [1995, 2000]) && bounded.found === 2
    })())
  check('normalizeFilters/applyFilters are pure and shared by every axis',
    normalizeFilters(undefined).sort === 'cited' && applyFilters([{ id: 'W1', citedBy: 1, year: 2000, openAccess: true, retracted: false, venue: null }], { minCitations: 2 }).length === 0)
}

{
  // ORCID fallback determinism: the richest profile wins, ties go to the smaller id.
  const stub = makeSyntheticFetch({
    works: {
      W500: { id: 'W500', title: 'ORCID paper', publication_year: 2015, cited_by_count: 10, type: 'journal-article', authorships: [{ id: null, orcid: '0000-0001-0000-0001', name: 'Orcid Author' }, { id: null, orcid: '0000-0002-0000-0002', name: 'Tie Author' }] },
      W600: { id: 'W600', title: 'Profile work', publication_year: 2016, cited_by_count: 5, type: 'journal-article', authorIds: ['A800'] },
    },
    orcidProfiles: {
      '0000-0001-0000-0001': [
        { id: 'A900', orcid: '0000-0001-0000-0001', display_name: 'Orcid Author', works_count: 5 },
        { id: 'A800', orcid: '0000-0001-0000-0001', display_name: 'Orcid Author', works_count: 9 },
      ],
      '0000-0002-0000-0002': [
        { id: 'A700', orcid: '0000-0002-0000-0002', display_name: 'Tie Author', works_count: 7 },
        { id: 'A600', orcid: '0000-0002-0000-0002', display_name: 'Tie Author', works_count: 7 },
      ],
    },
  })
  const lib = createLibrary({ ...offlineConfig, storePath: join(tmpRoot, 'orcid', 'library.json'), fetchImpl: stub.fetchImpl })
  await lib.ready()
  const resolved = await lib.authors('W500')
  check('AC-A1-1 the ORCID fallback is deterministic: richest profile wins, ties go to the smaller author id',
    sameJson(resolved.authors.map((entry) => entry.id), ['A800', 'A600']),
    JSON.stringify(resolved.authors))
  const authorWorks = await lib.expand('W600', 'author', { authorId: 'A800' })
  check('AC-A1-2 an author-axis expand works offline through the same code path',
    authorWorks.kind === 'author' && authorWorks.found === 1,
    JSON.stringify({ kind: authorWorks.kind, found: authorWorks.found }))
}

/* ------------------------------------------------- B1: persistence store */

{
  const path = join(tmpRoot, 'persist', 'library.json')
  const stub = makeSyntheticFetch({ works: corpus() })
  const first = createLibrary({ ...offlineConfig, storePath: path, fetchImpl: stub.fetchImpl })
  await first.ready()
  await first.addSeed('W1')
  await first.addSeed('W10')
  const made = first.collections({ op: 'create', name: 'Parent' })
  first.collections({ op: 'create', name: 'Child', parentId: made.collection.id })
  first.collections({ op: 'save', collectionId: made.collection.id, ids: ['W10'] })
  first.annotate({ id: 'W1', note: 'line one\nline two', tags: ['tag', 'tag', 'other'], color: 'blue' })
  await first.flush()
  const before = first.state().library

  const second = createLibrary({ ...offlineConfig, storePath: path, fetchImpl: stub.fetchImpl })
  await second.ready()
  const after = second.state().library
  check('AC-B1-1 a restart on the same storePath restores collections, memberships, annotations and Recently Found field-for-field',
    sameJson({ collections: before.collections, recentlyFound: before.recentlyFound, annotations: before.annotations, records: before.records },
      { collections: after.collections, recentlyFound: after.recentlyFound, annotations: after.annotations, records: after.records }),
    JSON.stringify({ before: { collections: before.collections.length, recent: before.recentlyFound.length }, after: { collections: after.collections.length, recent: after.recentlyFound.length } }))
  check('AC-B1-1 the exploration graph itself is temporary: a restart has 0 papers/links while the saved collection membership survives',
    second.state().counts.papers === 0 && second.state().counts.links === 0 && second.state().counts.seeds === 2,
    JSON.stringify(second.state().counts))
  check('AC-B3-7 Recently Found survives the restart',
    after.recentlyFound.indexOf('W1') >= 0 && after.recentlyFound.indexOf('W10') < 0,
    JSON.stringify(after.recentlyFound))

  // AC-B1-2: an injected write failure must leave the previous complete file.
  const failingFs = {
    readFile: nodeFs.readFile,
    writeFile: nodeFs.writeFile,
    open: nodeFs.open,
    unlink: nodeFs.unlink,
    mkdir: nodeFs.mkdir,
    rename: async () => { throw new Error('simulated crash before rename') },
  }
  const frozen = readFileSync(path, 'utf8')
  const third = createLibrary({ ...offlineConfig, storePath: path, fs: failingFs, fetchImpl: stub.fetchImpl })
  await third.ready()
  await third.addSeed('W13')
  await third.flush()
  let onDisk = null
  try { onDisk = JSON.parse(readFileSync(path, 'utf8')) } catch (error) { onDisk = null }
  const leftovers = readdirSync(join(tmpRoot, 'persist')).filter((name) => name.indexOf('.tmp-') >= 0)
  check('AC-B1-2 an injected write failure leaves the old complete JSON on disk (never a truncated file)',
    readFileSync(path, 'utf8') === frozen && onDisk !== null,
    JSON.stringify({ parseable: onDisk !== null, sameBytes: readFileSync(path, 'utf8') === frozen }))
  check('AC-B1-2 no temporary file is left behind after a failed write', leftovers.length === 0, JSON.stringify(leftovers))
  check('AC-B1-2 the failed write is surfaced as a storeError instead of crashing',
    typeof third.storeInfo().storeError === 'string' && third.storeInfo().storeError.length > 0,
    JSON.stringify(third.storeInfo()))
}

{
  // AC-B1-3 / AC-B1-4: unknown version and corrupt files are kept as .bak.
  const cases = [
    { name: 'version', body: JSON.stringify({ version: 99, records: {} }) },
    { name: 'garbage', body: 'this is not json {{{' },
    { name: 'empty', body: '' },
    { name: 'truncated', body: '{"version":1,"records":{"W1":{"id":"W1","title":"x"' },
  ]
  const stub = makeSyntheticFetch({ works: corpus() })
  let allOk = true
  const details = []
  for (const item of cases) {
    const dir = join(tmpRoot, 'repair-' + item.name)
    const path = join(dir, 'library.json')
    mkdirSync(dir, { recursive: true })
    writeFileSync(path, item.body)
    const lib = createLibrary({ ...offlineConfig, storePath: path, fetchImpl: stub.fetchImpl })
    await lib.ready()
    const info = lib.storeInfo()
    const backups = readdirSync(dir).filter((name) => name.indexOf('.bak-') >= 0)
    const ok = typeof info.storeError === 'string' && info.storeError.length > 0 && backups.length === 1 && lib.state().counts.papers === 0 && lib.state().library.collections.length === 1
    if (!ok) allOk = false
    details.push({ case: item.name, storeError: info.storeError, backups: backups.length })
    await lib.close()
  }
  check('AC-B1-3 AC-B1-4 an unknown version or a corrupt/empty/truncated file starts from an empty library with a readable storeError and keeps a .bak',
    allOk, JSON.stringify(details))
  check('AC-B1-3 the current version constant is 1', (await import(resolve(root, 'src/store.js'))).STORE_VERSION === 1)
}

{
  // AC-B1-5: debounced writes.
  const { createStore } = await import(resolve(root, 'src/store.js'))
  const path = join(tmpRoot, 'debounce', 'library.json')
  const data = { version: 1, records: {}, collections: [], memberships: [], recentlyFound: [], annotations: {}, seq: 0, meta: {} }
  const store = createStore({ storePath: path, snapshot: () => data, debounceMs: 120, maxWaitMs: 2000 })
  for (let i = 0; i < 5; i++) store.save()
  const immediate = store.writeCount()
  await new Promise((done) => setTimeout(done, 250))
  await store.flush()
  check('AC-B1-5 five quick writes collapse into one disk write (debounced) and flush is a no-op afterwards',
    immediate === 0 && store.writeCount() === 1 && (await store.flush()) === 1,
    JSON.stringify({ immediate: immediate, after: store.writeCount() }))
  await store.close()
}

{
  // AC-B1-7: no network still boots and reads the persisted library.
  const path = join(tmpRoot, 'offline-read', 'library.json')
  const stub = makeSyntheticFetch({ works: corpus() })
  const writer = createLibrary({ ...offlineConfig, storePath: path, fetchImpl: stub.fetchImpl })
  await writer.ready()
  await writer.addSeed('W1')
  await writer.annotate({ id: 'W1', note: 'offline note' })
  await writer.flush()
  const deadFetch = () => { throw new Error('network is down') }
  const reader = createLibrary({ ...offlineConfig, storePath: path, fetchImpl: deadFetch })
  await reader.ready()
  const snapshot = reader.state()
  const networkError = await thrown(() => reader.search('anything'))
  check('AC-B1-7 without network the persisted library still loads and only network operations fail',
    snapshot.library.annotations.W1 !== undefined && snapshot.library.annotations.W1.note === 'offline note' && networkError !== null,
    JSON.stringify({ note: snapshot.library.annotations.W1 === undefined ? null : snapshot.library.annotations.W1.note, networkError: message(networkError) }))
}

{
  // AC-B1-8: an unwritable directory degrades to memory instead of failing to load.
  const stub = makeSyntheticFetch({ works: corpus() })
  const unwritableFs = {
    readFile: async () => { const error = new Error('EACCES: permission denied'); error.code = 'EACCES'; throw error },
    writeFile: async () => { const error = new Error('EACCES: permission denied'); error.code = 'EACCES'; throw error },
    open: async () => { const error = new Error('EACCES: permission denied'); error.code = 'EACCES'; throw error },
    unlink: nodeFs.unlink,
    mkdir: async () => { const error = new Error('EACCES: permission denied'); error.code = 'EACCES'; throw error },
    rename: nodeFs.rename,
  }
  const lib = createLibrary({ ...offlineConfig, storePath: join(tmpRoot, 'unwritable', 'library.json'), fs: unwritableFs, fetchImpl: stub.fetchImpl })
  const ready = await lib.ready()
  await lib.addSeed('W1')
  await lib.flush()
  check('AC-B1-8 an unwritable storePath degrades to an in-memory library with a readable storeError (the plugin still loads)',
    typeof ready.storeError === 'string' && ready.storeError.length > 0 && lib.state().counts.papers === 1,
    JSON.stringify({ storeError: ready.storeError, papers: lib.state().counts.papers }))
}

/* ------------------------------------------------------- B2/B3/B4 library */

{
  const stub = makeSyntheticFetch({ works: corpus() })
  const lib = createLibrary({ ...offlineConfig, storePath: join(tmpRoot, 'library-ops', 'library.json'), fetchImpl: stub.fetchImpl })
  await lib.ready()
  await lib.addSeed('W1')
  await lib.addSeed('W10')
  await lib.addSeed('W13')

  check('AC-B2-1 collections list returns the tree shape and the system collection',
    Array.isArray(lib.collections({ op: 'list' }).collections) &&
    lib.collections({ op: 'list' }).collections.every((entry) => typeof entry.id === 'string' && typeof entry.name === 'string' && 'parentId' in entry && typeof entry.itemCount === 'number'),
    JSON.stringify(lib.collections({ op: 'list' }).collections.map((entry) => entry.id)))

  const parent = lib.collections({ op: 'create', name: 'Parent' }).collection
  const child = lib.collections({ op: 'create', name: 'Child', parentId: parent.id }).collection
  const grandchild = lib.collections({ op: 'create', name: 'Grandchild', parentId: child.id }).collection
  const missingParent = await thrown(() => lib.collections({ op: 'create', name: 'Orphan', parentId: 'c999' }))
  check('AC-B2-2 collections nest at least three levels deep and a missing parent is refused',
    grandchild.parentId === child.id && child.parentId === parent.id && missingParent !== null && missingParent.code === 'invalid',
    JSON.stringify({ parent: parent.id, child: child.id, grandchild: grandchild.id, error: message(missingParent) }))

  const renamed = lib.collections({ op: 'rename', collectionId: parent.id, name: 'Parent' })
  check('AC-B2-3 rename keeps the tree shape and duplicate names are allowed',
    renamed.collection.name === 'Parent' && renamed.collection.parentId === null,
    JSON.stringify(renamed.collection))

  const saved = lib.collections({ op: 'save', collectionId: parent.id, ids: ['W1', 'W10', 'W999999'] })
  const savedAgain = lib.collections({ op: 'save', collectionId: child.id, ids: ['W1'] })
  const savedDeep = lib.collections({ op: 'save', collectionId: grandchild.id, ids: ['W13'] })
  check('AC-B2-6 AC-B2-7 one paper can belong to several collections and unknown ids are reported as skipped, never silently accepted',
    saved.saved.length === 2 && saved.skipped.length === 1 && savedAgain.saved.length === 1 && savedDeep.saved.length === 1 &&
    lib.collections({ op: 'list' }).collections.filter((entry) => entry.id === parent.id)[0].itemCount === 2 &&
    lib.collections({ op: 'list' }).collections.filter((entry) => entry.id === child.id)[0].itemCount === 1,
    JSON.stringify({ saved: saved, savedAgain: savedAgain }))
  const deep = lib.collections({ op: 'list' }).collections.filter((entry) => entry.id === parent.id)[0]
  check('AC-B2-8 itemCount counts direct members and itemCountDeep counts the subtree',
    deep.itemCount === 2 && deep.itemCountDeep === 3,
    JSON.stringify(deep))

  const deleted = lib.collections({ op: 'delete', collectionId: parent.id })
  check('AC-B2-4 AC-B2-5 deleting a parent cascades its subtree but never deletes the papers',
    deleted.deleted.length === 3 && lib.state().library.records.W1 !== undefined && lib.state().library.records.W10 !== undefined &&
    lib.collections({ op: 'list' }).collections.filter((entry) => entry.id === parent.id).length === 0,
    JSON.stringify({ deleted: deleted.deleted, records: Object.keys(lib.state().library.records).length }))
  check('AC-B2-4 after deleting its only user collection the paper is back in Recently Found',
    lib.state().library.recentlyFound.includes('W1') && lib.state().library.recentlyFound.includes('W10'),
    JSON.stringify(lib.state().library.recentlyFound))

  const recentFirst = lib.recentlyFound({ op: 'list' }).recentlyFound
  check('AC-B3-1 AC-B3-2 Recently Found is a de-duplicated, most-recent-first list and a fresh addSeed lands first',
    recentFirst[0] === 'W13' && new Set(recentFirst).size === recentFirst.length,
    JSON.stringify(recentFirst.slice(0, 4)))

  const target = lib.collections({ op: 'create', name: 'Target' }).collection
  lib.recentlyFound({ op: 'promote', collectionId: target.id, ids: ['W13'] })
  check('AC-B3-4 promoting into a collection removes the id from Recently Found; removing it from the last collection brings it back',
    !lib.recentlyFound({ op: 'list' }).recentlyFound.includes('W13') &&
    lib.collections({ op: 'remove', collectionId: target.id, ids: ['W13'] }).removed.length === 1 &&
    lib.recentlyFound({ op: 'list' }).recentlyFound.includes('W13'),
    JSON.stringify(lib.recentlyFound({ op: 'list' }).recentlyFound))
  const beforeClear = lib.state().library.records
  lib.recentlyFound({ op: 'clear' })
  check('AC-B3-5 clearing Recently Found keeps the library articles and collection members',
    lib.recentlyFound({ op: 'list' }).recentlyFound.length === 0 && sameJson(Object.keys(beforeClear).sort(), Object.keys(lib.state().library.records).sort()),
    JSON.stringify({ recent: lib.recentlyFound({ op: 'list' }).recentlyFound.length, records: Object.keys(lib.state().library.records).length }))

  const note = lib.annotate({ id: 'W1', note: 'first line\nsecond line', tags: ['a', 'a', 'b'], color: 'red' }).annotation
  const partial = lib.annotate({ id: 'W1', note: 'changed' }).annotation
  check('AC-B4-1 a partial annotate update leaves tags and colour untouched',
    note.note.indexOf('\n') >= 0 && partial.note === 'changed' && sameJson(partial.tags, ['a', 'b']) && partial.color === 'red',
    JSON.stringify(partial))
  const tooLong = await thrown(() => lib.annotate({ id: 'W1', note: 'x'.repeat(10001) }))
  check('AC-B4-2 a note over 10000 characters is rejected, not truncated',
    tooLong !== null && tooLong.code === 'invalid' && /10000/.test(message(tooLong)),
    message(tooLong))
  const tooMany = await thrown(() => lib.annotate({ id: 'W1', tags: Array.from({ length: 21 }, (_, i) => 't' + i) }))
  const tooLongTag = await thrown(() => lib.annotate({ id: 'W1', tags: ['y'.repeat(41)] }))
  check('AC-B4-3 tags are de-duplicated in order, capped at 20, and 41-character tags are rejected',
    sameJson(note.tags, ['a', 'b']) && tooMany !== null && tooMany.code === 'invalid' && tooLongTag !== null && tooLongTag.code === 'invalid',
    JSON.stringify({ tags: note.tags, tooMany: message(tooMany), tooLongTag: message(tooLongTag) }))
  const badColor = await thrown(() => lib.annotate({ id: 'W1', color: 'pink' }))
  const clearedColor = lib.annotate({ id: 'W1', color: null }).annotation
  check('AC-B4-4 the colour enum is fixed, an illegal colour lists the legal values, and null clears it',
    badColor !== null && badColor.code === 'invalid' && /red/.test(message(badColor)) && /gray/.test(message(badColor)) && clearedColor.color === null,
    JSON.stringify({ error: message(badColor), cleared: clearedColor.color }))
  const ghost = await thrown(() => lib.annotate({ id: 'W888888', note: 'ghost' }))
  check('AC-B4-6 annotating an unknown work id is refused (never invents a paper)',
    ghost !== null && ghost.code === 'invalid' && lib.state().library.records.W888888 === undefined,
    message(ghost))
}

/* --------------------------------------------------------- A7: BibTeX */

{
  const { bibtexOf, bibtexTypeOf, escapeLatex } = await import(resolve(root, 'src/bibtex.js'))
  const records = [
    { id: 'W1', title: 'Seed One', year: 2000, citedBy: 100, doi: 'https://doi.org/10.1000/one', venue: 'Journal of Testing', kind: 'journal-article', authors: ['Ada Lovelace', 'Alan Turing'] },
    { id: 'W2', title: 'Seed One', year: 2000, citedBy: 50, doi: null, venue: null, kind: 'book', authors: ['Ada Lovelace'] },
    { id: 'W3', title: 'Book Chapter', year: 1999, citedBy: 1, doi: null, venue: null, kind: 'book-chapter', authors: [] },
    { id: 'W4', title: 'Proceedings', year: 1998, citedBy: 1, doi: null, venue: null, kind: 'proceedings-article', authors: [] },
    { id: 'W5', title: 'Dataset', year: 1997, citedBy: 1, doi: null, venue: null, kind: 'dataset', authors: [] },
    { id: 'W6', title: 'Other', year: 1996, citedBy: 1, doi: null, venue: null, kind: 'weird-type', authors: [] },
  ]
  const text = bibtexOf(records)
  const entries = []
  const entryRe = /@(\w+)\{([^,]+),/g
  let match
  while ((match = entryRe.exec(text)) !== null) {
    const body = text.slice(match.index, text.indexOf('\n}', match.index) + 2)
    const fields = {}
    const fieldRe = /(\w+)\s*=\s*\{([^}]*)\}/g
    let field
    while ((field = fieldRe.exec(body)) !== null) fields[field[1]] = field[2]
    entries.push({ type: match[1], key: match[2], fields: fields })
  }
  check('AC-A7-2 the BibTeX output parses into the same number of entries and every entry has title + year',
    entries.length === records.length && entries.every((entry) => typeof entry.fields.title === 'string' && typeof entry.fields.year === 'string'),
    JSON.stringify(entries.map((entry) => entry.key)))
  check('AC-A7-2 parsed titles/years match the graph data',
    entries[0].fields.title === 'Seed One' && entries[0].fields.year === '2000')
  check('AC-A7-3 author is joined with " and " and never emitted empty',
    entries[0].fields.author === 'Ada Lovelace and Alan Turing' && entries[2].fields.author === undefined,
    JSON.stringify({ first: entries[0].fields.author, empty: entries[2].fields.author }))
  check('AC-A7-4 every entry carries doi or url (url always points at OpenAlex)',
    entries.every((entry) => typeof entry.fields.url === 'string' && entry.fields.url.indexOf('https://openalex.org/') === 0) && entries[0].fields.doi === 'https://doi.org/10.1000/one',
    JSON.stringify(entries.map((entry) => entry.fields.url)))
  check('AC-A7-5 citation keys are unique, deterministic and byte-identical across two exports',
    new Set(entries.map((entry) => entry.key)).size === entries.length && bibtexOf(records) === text,
    JSON.stringify(entries.map((entry) => entry.key)))
  check('AC-A7-6 the type map is the frozen one',
    bibtexTypeOf('journal-article') === 'article' && bibtexTypeOf('book') === 'book' && bibtexTypeOf('book-chapter') === 'incollection' &&
    bibtexTypeOf('proceedings-article') === 'inproceedings' && bibtexTypeOf('dataset') === 'misc' && bibtexTypeOf('weird-type') === 'misc',
    JSON.stringify([bibtexTypeOf('journal-article'), bibtexTypeOf('book'), bibtexTypeOf('book-chapter'), bibtexTypeOf('proceedings-article'), bibtexTypeOf('dataset'), bibtexTypeOf('weird-type')]))
  const escaped = escapeLatex('& % $ # _ { } ~ ^ \\ and Ünïcödé 中文')
  check('AC-A7-7 LaTeX specials are escaped and non-ASCII stays untouched',
    escaped.indexOf('\\&') >= 0 && escaped.indexOf('\\%') >= 0 && escaped.indexOf('\\$') >= 0 && escaped.indexOf('\\#') >= 0 &&
    escaped.indexOf('\\_') >= 0 && escaped.indexOf('\\{') >= 0 && escaped.indexOf('\\}') >= 0 &&
    escaped.indexOf('\\textasciitilde{}') >= 0 && escaped.indexOf('\\textasciicircum{}') >= 0 && escaped.indexOf('\\textbackslash{}') >= 0 &&
    escaped.indexOf('Ünïcödé 中文') >= 0,
    escaped)
  check('AC-A7-8 an empty export is a legal comment-only BibTeX document with count 0',
    bibtexOf([]).indexOf('%') === 0 && bibtexOf([]).indexOf('@') < 0)

  const stub = makeSyntheticFetch({ works: corpus() })
  const lib = createLibrary({ ...offlineConfig, storePath: join(tmpRoot, 'export', 'library.json'), fetchImpl: stub.fetchImpl })
  await lib.ready()
  await lib.addSeed('W1')
  const collection = lib.collections({ op: 'create', name: 'Export me' }).collection
  lib.collections({ op: 'save', collectionId: collection.id, ids: ['W1'] })
  lib.annotate({ id: 'W1', note: 'SECRET NOTE MUST NOT BE EXPORTED' })
  const all = lib.export({ format: 'bibtex' })
  const byCollection = lib.export({ format: 'bibtex', collectionId: collection.id })
  check('AC-A7-1 export returns {format, count, bibtex} for the graph and for a collection',
    all.format === 'bibtex' && all.count === 1 && byCollection.count === 1 && typeof byCollection.bibtex === 'string',
    JSON.stringify({ all: all.count, byCollection: byCollection.count }))
  check('AC-B4-9 annotations never leak into the BibTeX export',
    all.bibtex.indexOf('SECRET NOTE') < 0,
    all.bibtex.slice(0, 80))
}

/* ------------------------------------------------------------- host wiring */

const host = await import(resolve(root, 'src/index.js'))
check('host name matches the package', host.name === 'dsh-research-cat', String(host.name))
check('host injects tools + webServer',
  Array.isArray(host.inject) && host.inject.includes('tools') && host.inject.includes('webServer'),
  JSON.stringify(host.inject))

const mounted = []
const scope = {
  effect: (fn, label) => { mounted.push({ kind: 'effect', label: label, dispose: fn() }) },
  tools: { register: (def) => { mounted.push({ kind: 'tool', def: def }); return () => {} } },
}
const fakeCtx = {
  effect: (fn, label) => { mounted.push({ kind: 'effect', label: label, dispose: fn() }) },
  inject: (deps, body) => { mounted.push({ kind: 'inject', deps: deps }); body(scope) },
  webServer: {
    register: (options) => {
      mounted.push({ kind: 'route', options: options })
      return () => {}
    },
  },
}
// Sealed host half: its own storePath under os.tmpdir(), never the default home.
await host.apply(fakeCtx, { exposeTool: true, mailto: 'x@y.z', maxNodes: 400, maxBatch: 30, maxCitations: 25, storePath: hostStore })

const tool = mounted.find((entry) => entry.kind === 'tool')
check('apply registers exactly one agent tool', mounted.filter((e) => e.kind === 'tool').length === 1)
check('tool is named research_cat', tool !== undefined && tool.def.name === 'research_cat', tool && tool.def.name)
check('tool exposes the four actions',
  tool !== undefined && tool.def.parameters.properties.action.enum.join(',') === 'search,add,expand,list,collections,recent,annotate,export',
  tool && JSON.stringify(tool.def.parameters.properties.action.enum))
check('AC-A0-3 the four original actions are still the first four enum entries (additive change only)',
  tool !== undefined && tool.def.parameters.properties.action.enum.slice(0, 4).join(',') === 'search,add,expand,list',
  tool && JSON.stringify(tool.def.parameters.properties.action.enum))
check('AC-A0-3 the tool output schema is still {ok, text}',
  tool !== undefined && sameJson(Object.keys(tool.def.output.schema.properties).sort(), ['ok', 'text']) && tool.def.output.schema.additionalProperties === false,
  tool && JSON.stringify(tool.def.output.schema))
check('AC-A0-3 the kind enum keeps the three original axes first and adds the three new ones',
  tool !== undefined && tool.def.parameters.properties.kind.enum.join(',') === 'references,citations,related,earlier,later,author',
  tool && JSON.stringify(tool.def.parameters.properties.kind.enum))
check('action is a required parameter',
  tool !== undefined && tool.def.parameters.required.includes('action'),
  tool && JSON.stringify(tool.def.parameters.required))

const route = mounted.find((entry) => entry.kind === 'route')
check('apply registers one route prefix', route !== undefined && route.options.kind === 'prefix', JSON.stringify(route && route.options.kind))
check('route path is the one the panel calls', route !== undefined && route.options.path === '/dsh-research-cat', route && route.options.path)
check('route handler is callable', route !== undefined && typeof route.options.handler === 'function')
check('AC-B1-8 the host half uses the explicit storePath under os.tmpdir()',
  existsSync(join(tmpRoot, 'host')) || hostStore.indexOf(tmpdir()) === 0,
  hostStore)

const toolText = await tool.def.execute({ action: 'list' })
check('tool list action answers before anything is collected', toolText.ok === true && /empty/i.test(toolText.text), toolText.text)
// The enum is enforced by defineTool's compiled schema before execute() runs,
// so an out-of-enum action can never reach the handler's own fallback branch.
let badActionRejected = false
try {
  const bad = await tool.def.execute({ action: 'nope' })
  badActionRejected = bad.ok !== true
} catch {
  badActionRejected = true
}
check('schema rejects an action outside the enum', badActionRejected)

check('AC-A0-4 the tool list wording still reports the collection and graph totals',
  /collection|graph/i.test(toolText.text),
  toolText.text)

// exposeTool: false must skip the tool entirely.
mounted.length = 0
scope.tools.register = (def) => { mounted.push({ kind: 'tool', def: def }); return () => {} }
await host.apply(fakeCtx, { exposeTool: false, storePath: hostStore })
check('exposeTool:false registers no tool', mounted.filter((e) => e.kind === 'tool').length === 0)
check('exposeTool:false still registers the routes', mounted.filter((e) => e.kind === 'route').length === 1)

/* ------------------------------------------- real HTTP route probes (t5) */

const { registerResearchCatRoutes } = await import(resolve(root, 'src/routes.js'))

async function startRouteServer(library) {
  const captured = []
  const ctx = { webServer: { register: (options) => { captured.push(options); return () => {} } } }
  registerResearchCatRoutes(ctx, library)
  const server = createServer((req, res) => captured[0].handler(req, res))
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const port = server.address().port
  return {
    port: port,
    async probe(pathname, body, init) {
      const options = init === undefined ? {} : init
      const method = options.method === undefined ? 'POST' : options.method
      const response = await fetch('http://127.0.0.1:' + port + '/dsh-research-cat' + pathname, {
        method: method,
        headers: Object.assign({ 'content-type': 'application/json' }, options.headers === undefined ? {} : options.headers),
        body: method === 'GET' ? undefined : JSON.stringify(body === undefined ? {} : body),
      })
      const text = await response.text()
      let json = null
      try { json = JSON.parse(text) } catch { json = null }
      return { status: response.status, json: json }
    },
    close: () => new Promise((done) => server.close(done)),
  }
}

{
  const stub = makeSyntheticFetch({ works: corpus() })
  const routeLib = createLibrary({ ...offlineConfig, storePath: join(tmpRoot, 'http', 'library.json'), fetchImpl: stub.fetchImpl })
  await routeLib.ready()
  await routeLib.addSeed('W1')
  await routeLib.expand('W1', 'references')
  const routeServer = await startRouteServer(routeLib)

  const stateProbe = await routeServer.probe('/state', {})
  check('AC-A0-4 /state returns the frozen graph/counts/library envelope over real HTTP',
    stateProbe.status === 200 && stateProbe.json !== null && stateProbe.json.ok === true &&
    stateProbe.json.value.graph !== undefined && stateProbe.json.value.counts !== undefined && stateProbe.json.value.library !== undefined &&
    typeof stateProbe.json.value.library.storePath === 'string' && stateProbe.json.value.library.storePath.indexOf(tmpdir()) === 0,
    JSON.stringify({ status: stateProbe.status, storePath: stateProbe.json === null ? null : stateProbe.json.value.library.storePath }))

  const illegalId = await routeServer.probe('/expand', { id: 'nonsense', kind: 'references' })
  check('failure path: an illegal work id is HTTP 400 invalid',
    illegalId.status === 400 && illegalId.json !== null && illegalId.json.ok === false && illegalId.json.error.code === 'invalid',
    JSON.stringify(illegalId.json))

  const emptyQuery = await routeServer.probe('/search', { query: '   ' })
  check('failure path: an empty search query is HTTP 400 invalid',
    emptyQuery.status === 400 && emptyQuery.json !== null && emptyQuery.json.ok === false && emptyQuery.json.error.code === 'invalid',
    JSON.stringify(emptyQuery.json))

  const missingCollection = await routeServer.probe('/collections', { op: 'rename', collectionId: 'c404', name: 'x' })
  check('failure path: a nonexistent collection is HTTP 400 invalid',
    missingCollection.status === 400 && missingCollection.json !== null && missingCollection.json.error.code === 'invalid',
    JSON.stringify(missingCollection.json))

  const badFilter = await routeServer.probe('/expand', { id: 'W1', kind: 'references', filters: { yearFrom: 2020, yearTo: 2010 } })
  check('AC-A4-2 route probe: yearFrom > yearTo is rejected as invalid, not an empty success',
    badFilter.status === 400 && badFilter.json !== null && badFilter.json.error.code === 'invalid',
    JSON.stringify(badFilter.json))

  const badColor = await routeServer.probe('/annotate', { id: 'W1', color: 'pink' })
  check('AC-B4-4 route probe: an illegal colour lists the frozen enum',
    badColor.status === 400 && badColor.json !== null && /red/.test(badColor.json.error.message) && /gray/.test(badColor.json.error.message),
    JSON.stringify(badColor.json))

  const ghost = await routeServer.probe('/annotate', { id: 'W777777', note: 'ghost' })
  check('AC-B4-6 route probe: annotating an unknown id is invalid',
    ghost.status === 400 && ghost.json !== null && ghost.json.error.code === 'invalid',
    JSON.stringify(ghost.json))

  const exportProbe = await routeServer.probe('/export', { format: 'bibtex' })
  check('AC-A7-1 route probe: /export returns {format, count, bibtex}',
    exportProbe.status === 200 && exportProbe.json.ok === true && exportProbe.json.value.format === 'bibtex' && typeof exportProbe.json.value.bibtex === 'string',
    JSON.stringify(exportProbe.json === null ? null : { count: exportProbe.json.value.count }))

  const emptyExport = await routeServer.probe('/export', { format: 'bibtex', ids: [] })
  check('AC-A7-8 route probe: an empty export is a success with count 0',
    emptyExport.status === 200 && emptyExport.json.value.count === 0 && emptyExport.json.value.bibtex.indexOf('@') < 0,
    JSON.stringify(emptyExport.json === null ? null : { count: emptyExport.json.value.count }))

  const crossSite = await routeServer.probe('/state', {}, { headers: { origin: 'http://evil.example' } })
  check('AC-A0-6 route probe: a cross-site Origin is refused with 403 forbidden (loopback fence intact)',
    crossSite.status === 403 && crossSite.json.error.code === 'forbidden',
    JSON.stringify(crossSite.json))

  const wrongType = await routeServer.probe('/state', {}, { headers: { 'content-type': 'text/plain' } })
  check('AC-A0-6 route probe: a non-JSON content-type is refused with 415',
    wrongType.status === 415,
    JSON.stringify({ status: wrongType.status }))

  const identity = await routeServer.probe('/state', undefined, { method: 'GET' })
  check('route probe: GET /dsh-research-cat answers the identity probe',
    identity.status === 200 && identity.json.value.name === 'dsh-research-cat',
    JSON.stringify(identity.json))

  const kindProbes = []
  for (const kind of ['references', 'citations', 'related']) kindProbes.push(await routeServer.probe('/expand', { id: 'W1', kind: kind }))
  check('AC-A0-2 route probe: expand still accepts references/citations/related and returns the frozen field set',
    kindProbes.every((probe) => probe.status === 200 && probe.json.ok === true &&
      typeof probe.json.value.kind === 'string' && typeof probe.json.value.found === 'number' &&
      typeof probe.json.value.added === 'number' && probe.json.value.graph !== undefined && probe.json.value.counts !== undefined),
    JSON.stringify(kindProbes.map((probe) => (probe.json === null ? null : { kind: probe.json.value.kind, found: probe.json.value.found }))))

  const unknown = await routeServer.probe('/nope', {})
  check('the unknown-route 404 behaviour is unchanged', unknown.status === 404, String(unknown.status))

  const clearProbe = await routeServer.probe('/clear', {})
  check('AC-A0-7 route probe: /clear empties papers and seeds',
    clearProbe.status === 200 && clearProbe.json.value.counts.papers === 0 && clearProbe.json.value.counts.seeds === 0,
    JSON.stringify(clearProbe.json === null ? null : clearProbe.json.value.counts))

  await routeServer.close()
}

{
  // Over-quota failure path over real HTTP with maxNodes = 1.
  const stub = makeSyntheticFetch({ works: corpus() })
  const quotaLib = createLibrary({ ...offlineConfig, maxNodes: 1, storePath: join(tmpRoot, 'http-quota', 'library.json'), fetchImpl: stub.fetchImpl })
  await quotaLib.ready()
  await quotaLib.addSeed('W1')
  const quotaServer = await startRouteServer(quotaLib)
  const overQuota = await quotaServer.probe('/expand', { id: 'W1', kind: 'references' })
  check('failure path: expanding past maxNodes is HTTP 200 with ok:false and code operation (a result, not a crash)',
    overQuota.status === 200 && overQuota.json.ok === false && overQuota.json.error.code === 'operation' && /clear it/.test(overQuota.json.error.message),
    JSON.stringify(overQuota.json))
  await quotaServer.close()
}

/* ------------------------------------------------- C-tier exclusion + docs */

{
  const sources = ['src/graph.js', 'src/routes.js', 'src/tools.js', 'src/config.js', 'src/index.js', 'src/store.js', 'src/bibtex.js', 'src/client.js']
  // Spec §8.1 lists `share` and `login` too, but `share` is unusable as a
  // discriminator: client.js uses it as a local variable for the citation
  // share in the radius math (lines ~240/567/2000). The C-tier *feature* terms
  // are asserted here; `share` is reported separately below.
  const forbidden = ['zotero', 'oauth', 'collaborator', 'login', 'crossref', 'semanticscholar', 'quartile', 'h-index', 'readingStatus', 'csl', 'signals']
  const hits = []
  for (const file of sources) {
    const text = readFileSync(resolve(root, file), 'utf8').toLowerCase()
    for (const term of forbidden) if (text.indexOf(term.toLowerCase()) >= 0) hits.push(file + ':' + term)
  }
  check('AC-C-1 no C-tier feature term appears in the host or browser source',
    hits.length === 0, JSON.stringify(hits))

  const clientSrc = readFileSync(resolve(root, 'src/client.js'), 'utf8')
  const shareHits = [...clientSrc.matchAll(/.{0,24}share.{0,24}/gi)].map((match) => match[0].trim())
  check('AC-C-1 the only "share" occurrences are the citation-share math variable and one English comment, not a sharing feature',
    shareHits.length > 0 && shareHits.every((text) => /share\s*=|citation share|share the same|Math\.sqrt\(share|share\s*[)>]|\*\s*share|\/\s*share/.test(text)),
    JSON.stringify(shareHits))

  const routeText = readFileSync(resolve(root, 'src/routes.js'), 'utf8')
  const routes = [...routeText.matchAll(/ROUTE_PREFIX \+ '\/([a-zA-Z]+)'/g)].map((match) => match[1]).sort()
  const frozen = ['addSeed', 'annotate', 'authors', 'clear', 'collections', 'details', 'expand', 'expandAll', 'export', 'recentlyFound', 'removeSeed', 'search', 'state']
  check('AC-C-1 the route table is exactly the frozen set (no C-tier route slipped in)',
    sameJson(routes, frozen), JSON.stringify(routes))

  const design = readFileSync(resolve(root, 'docs/rr-parity-design.md'), 'utf8')
  check('AC-C-2 the design doc references spec §8 and declares the C tier as not implemented / user-decision',
    design.indexOf('第 8 节') >= 0 && /待用户决策/.test(design) && /C 档/.test(design),
    'design doc lines: ' + (design.match(/第 8 节/g) || []).length)
}

/* ------------------------------------------- panel surface (source-level) */

// Panel-step ACs cannot be driven from Node without a browser. The shipped
// browser half is asserted structurally here (the code path exists and is wired
// to the right host call); the rendered behaviour is cross-checked by
// `node lab/client-check.mjs` (91 checks, real mini-runtime render) and
// `node test/client.mjs` (38 layout checks). Items that neither can prove are
// listed as uncovered in test/AC-EVIDENCE.md.
{
  const src = readFileSync(resolve(root, 'src/client.js'), 'utf8')
  const edgeKinds = ['references', 'citations', 'related', 'earlier', 'later', 'author']
  check('AC-A0-5 the panel ships a distinct style rule for each of the six edge kinds',
    edgeKinds.every((kind) => src.indexOf('.rr-edge-' + kind + '{') >= 0),
    JSON.stringify(edgeKinds.filter((kind) => src.indexOf('.rr-edge-' + kind + '{') < 0)))
  check('AC-A0-5 every edge kind has an independent toggle and hidden kinds are filtered out of the drawn links',
    /const KIND_ORDER = \['references', 'citations', 'related', 'earlier', 'later', 'author'\]/.test(src) &&
    /KIND_ORDER\.map/.test(src) && /toggleKind\(kind\)/.test(src) && /showKinds\[link\.kind\] !== false/.test(src))
  check('AC-A1-6 the detail panel lists clickable authors that call the author axis',
    /expandAuthor\(selected, entry\.id\)/.test(src) && /Pull this author/.test(src))
  check('AC-A3-5 the detail panel offers both Earlier and Later entries',
    /expand\(selected, 'earlier'\)/.test(src) && /expand\(selected, 'later'\)/.test(src))
  check('AC-A4-9 the filter panel exposes all seven frozen filter keys and reports considered/total',
    ['yearFrom', 'yearTo', 'venue', 'isOa', 'isRetracted', 'minCitations', 'sort'].every((key) => src.indexOf(key) >= 0) &&
    /considered/.test(src) && /\.total/.test(src))
  check('AC-A6-1 Radial and Timeline toggles only switch layout state (no reload, no selection reset)',
    /onClick: function \(\) \{ setLayoutMode\('radial'\) \}/.test(src) &&
    /onClick: function \(\) \{ setLayoutMode\('timeline'\) \}/.test(src) &&
    src.indexOf('location.reload') < 0 && src.indexOf('window.location') < 0)
  check('AC-A7-9 the panel downloads a .bib file with a stable research-cat-<collection|all>-<date>.bib name',
    /'research-cat-' \+ \(collectionId \|\| 'all'\) \+ '-' \+ new Date\(\)\.toISOString\(\)\.slice\(0, 10\) \+ '\.bib'/.test(src) &&
    /anchor\.download = name/.test(src) && /application\/x-bibtex/.test(src))
  check('AC-B2-10 the collection tree offers create-subcollection, rename, two-step delete and activation',
    /title: 'New subcollection'/.test(src) && /op: 'rename'/.test(src) &&
    /Press again to delete this collection and its subcollections/.test(src) && /setActiveCollectionId/.test(src))
  check('AC-B3-8 Recently Found rows offer multi-select promote and a one-click clear',
    /'data-rr': 'recently-found'/.test(src) && /op: 'promote'/.test(src) && /op: 'clear'/.test(src) &&
    /Clear the staging area/.test(src))
  check('AC-B4-7 the detail panel has a note editor, a tag input, seven colour dots and a "No colour" button',
    /textarea/.test(src) && /tags, comma separated/.test(src) && /COLOR_CHOICES\.map/.test(src) && /'No colour'/.test(src) &&
    /annotation\.color === choice\.id/.test(src))
  const moveButton = /onClick[^\n]*\{[^\n]*op: 'move'|Move to collection|Move into a collection/.test(src)
  if (!moveButton) {
    report('AC-B2-10 gap: the collection tree offers copy-into (save) but no "move" action', 'finding F7 — see test/AC-EVIDENCE.md')
  }
}

/* --------------------------------------------------------- AC-A2-7 panel */

{
  const src = readFileSync(resolve(root, 'src/client.js'), 'utf8')
  const start = src.indexOf('function expandAll()')
  const panelExpandAll = src.slice(start, src.indexOf('function clearAll()', start))
  check('AC-A2-7 (partial) Auto-expand calls the new expandAll and surfaces skipped/failed request counts',
    /post\('expandAll'/.test(panelExpandAll) && /res\.skipped/.test(panelExpandAll) && /failed/.test(panelExpandAll),
    panelExpandAll.slice(0, 120))
  // The user-visible outcome is whatever setError/setBusy render. `perSeed.length`
  // only drives the failure loop, so a seed count would have to appear inside a
  // message to count as "displayed".
  const messages = [...panelExpandAll.matchAll(/set(?:Error|Busy)\(([^\n]*)\)/g)].map((match) => match[1])
  const displaysSeedCount = messages.some((text) => /perSeed\.length|seedCount|seeds/.test(text))
  if (!displaysSeedCount) {
    report('AC-A2-7 gap: Auto-expand never displays the number of seeds expanded (only added/failed/skipped)', 'finding F6 — see test/AC-EVIDENCE.md')
  }
}

/* --------------------------------------------------------- AC-A0-1 gate */

const ORIGINAL_LABELS = [
  'action is a required parameter', 'addSeed collects the paper', 'addSeed reports the record',
  'apply registers exactly one agent tool', 'apply registers one route prefix', 'bad work id is rejected',
  'blank query is rejected', 'clear empties everything', 'client exports apply', 'client exports name',
  'client injects slots', 'client only requires react from the shell', 'client registers exactly one Loader module',
  'config defaults', 'config overrides + bad values fall back', 'details reconstructs the abstract',
  'details returns authors + abstract', 'expand pulls citing papers', 'expand pulls references',
  'expand respects the batch cap', 'exposeTool:false registers no tool', 'exposeTool:false still registers the routes',
  'fresh state is empty', 'host injects tools + webServer', 'host name matches the package',
  'loader id is the package name', 're-expanding adds nothing (dedup)', 'removeSeed drops the seed and its exclusive neighbours',
  'route handler is callable', 'route path is the one the panel calls', 'schema rejects an action outside the enum',
  'search results carry work ids', 'search returns OpenAlex matches', 'state snapshots nodes and links',
  'tool exposes the four actions', 'tool is named research_cat', 'tool list action answers before anything is collected',
  'uniqueWorkIds normalises and de-duplicates',
]
const missingLabels = ORIGINAL_LABELS.filter((label) => seenLabels.has(label) !== true)
check('AC-A0-1 every pre-t5 check label is still present and the suite only grew',
  missingLabels.length === 0 && seenLabels.size > 38,
  JSON.stringify({ missing: missingLabels, labels: seenLabels.size }))

/* ---------------------------------------------- spec AC coverage manifest */

{
  const spec = readFileSync(resolve(root, 'docs/rr-parity-spec.md'), 'utf8')
  const specAcs = [...new Set(spec.match(/AC-[A-C]-\d+/g) || [])].sort()
  const selfText = readFileSync(resolve(root, 'test/local.mjs'), 'utf8')
  const parityText = readFileSync(resolve(root, 'test/parity.mjs'), 'utf8')
  const uncovered = specAcs.filter((id) => selfText.indexOf(id) < 0 && parityText.indexOf(id) < 0)
  check('coverage: every frozen spec AC id is referenced by test/local.mjs or test/parity.mjs',
    uncovered.length === 0,
    JSON.stringify({ specAcs: specAcs.length, uncovered: uncovered }))
}

/* ------------------------------------------------- real path stayed clean */

const realAfter = fingerprint(REAL_LIBRARY)
check('seal: the user\'s real ~/.dsh/research-cat/library.json was neither created nor modified by this run',
  realAfter.exists === realBefore.exists && realAfter.size === realBefore.size &&
  realAfter.mtimeMs === realBefore.mtimeMs && realAfter.sha256 === realBefore.sha256,
  JSON.stringify({ before: realBefore, after: realAfter, realPath: REAL_LIBRARY }))

console.log('\nsealed run: DSH_HOME=' + tmpHome + '  engineStore=' + engineStore)
console.log('real library fingerprint: ' + (realBefore.exists ? realBefore.sha256 : '(absent)'))
if (gaps.length > 0) console.log('reported gaps (not counted as passes): ' + gaps.join(' | '))
console.log(failures === 0 ? '\nlocal: all checks passed' : '\nlocal: ' + failures + ' check(s) FAILED')
process.exit(failures === 0 ? 0 : 1)
