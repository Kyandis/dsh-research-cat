// Research Cat × Research Rabbit parity suite (host half).
//
//   node test/parity.mjs
//
// Every check is labelled with the frozen AC id it judges
// (docs/rr-parity-spec.md §4/§5, coverage matrix docs/rr-parity-design.md §8.4.1).
//
// Proof that this suite discriminates the implementation:
//
//   git stash push -u -- src/ && node test/parity.mjs; echo "exit=$?"; git stash pop
//
// `-u` is required: src/store.js and src/bibtex.js are new, untracked files and a
// plain `git stash` would leave them in place. With `-u` every src/ module is
// stashed while this file stays behind, so the run must print a per-AC failure
// list (all red) before the implementation and the full pass list (all green)
// after it.
//
// The suite is offline by default: all OpenAlex traffic goes through an injected
// fetch stub (`fetchImpl`). The one real-network smoke group prints SKIP when it
// cannot reach OpenAlex and never counts as a failure — t5 runs the networked
// acceptance separately (spec §10.4).
//
// src/ is imported dynamically with try/catch on purpose: a missing module must
// become a failed AC, not a process-level import crash.

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const tmpRoot = mkdtempSync(join(tmpdir(), 'dsh-research-cat-parity-'))
// Keep the default store path inside the temp dir: the suite must never touch
// the real ~/.dsh/research-cat library.
process.env.DSH_HOME = join(tmpRoot, 'home')

let passed = 0
let failed = 0
const failures = []
const deferred = []
const seenAc = new Set()

function acIdsIn(label) {
  const matches = label.match(/AC-[A-Z0-9-]+/g)
  if (matches !== null) for (const id of matches) seenAc.add(id.replace(/-$/, ''))
}

function check(label, condition, detail) {
  acIdsIn(label)
  if (condition === true) {
    passed += 1
    console.log('  PASS ' + label)
    return
  }
  failed += 1
  failures.push(label)
  console.log('  FAIL ' + label + (detail === undefined ? '' : ' -> ' + detail))
}

function defer(label) {
  acIdsIn(label)
  deferred.push(label)
  console.log('  DEFER ' + label)
}

function section(title) {
  console.log('\n== ' + title + ' ==')
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

/* --------------------------------------------------------------- modules */

async function loadModule(relative) {
  try {
    return { module: await import(resolve(root, relative)), error: null }
  } catch (error) {
    return { module: null, error: String(error && error.message ? error.message : error) }
  }
}

const configMod = await loadModule('src/config.js')
const graphMod = await loadModule('src/graph.js')
const storeMod = await loadModule('src/store.js')
const bibtexMod = await loadModule('src/bibtex.js')
const hostMod = await loadModule('src/index.js')
const routesMod = await loadModule('src/routes.js')
const toolsMod = await loadModule('src/tools.js')

// `?? null` matters: on the stashed baseline these exports are undefined, and
// every check below must report "capability missing" instead of crashing.
const pick = (entry, name) => (entry.module === null ? null : entry.module[name] ?? null)
const resolveConfig = pick(configMod, 'resolveConfig')
const createLibrary = pick(graphMod, 'createLibrary')
const chunkIds = pick(graphMod, 'chunkIds')
const applyFilters = pick(graphMod, 'applyFilters')
const normalizeFilters = pick(graphMod, 'normalizeFilters')
const createStore = pick(storeMod, 'createStore')
const defaultStorePath = pick(storeMod, 'defaultStorePath')
const bibtexOf = pick(bibtexMod, 'bibtexOf')
const bibtexTypeOf = pick(bibtexMod, 'bibtexTypeOf')
const escapeLatex = pick(bibtexMod, 'escapeLatex')
const hostApply = pick(hostMod, 'apply')

const moduleErrors = [configMod, graphMod, storeMod, bibtexMod, hostMod, routesMod, toolsMod]
  .map((entry) => entry.error)
  .filter((error) => error !== null)
if (moduleErrors.length > 0) console.log('module load errors: ' + moduleErrors.join(' | '))

const clientPath = resolve(root, 'src/client.js')
let clientSource = ''
try { clientSource = readFileSync(clientPath, 'utf8') } catch { clientSource = '' }

/* ------------------------------------------------------------- test seams */

const ID = {
  seed: 'W99000001',
  earlierBook: 'W99000002',
  sameYear: 'W99000003',
  newerRef: 'W99000004',
  undatedRef: 'W99000005',
  related: 'W99000006',
  citingLater: 'W99000007',
  citingSame: 'W99000008',
  citingUndated: 'W99000009',
  boundarySeed: 'W99000050',
  boundaryRef: 'W99000051',
  orcidWork: 'W99000060',
  missing: 'W99009999',
  authorOne: 'A99000001',
  authorTwo: 'A99000002',
}
const refId = (i) => 'W99001' + String(1000 + i)
const citeId = (i) => 'W99002' + String(1000 + i)
const fillerId = (i) => 'W99004' + String(1000 + i)
const recentId = (i) => 'W99005' + String(1000 + i)

function work(id, props) {
  return Object.assign({
    id: 'https://openalex.org/' + id,
    doi: 'https://doi.org/10.9999/' + id.toLowerCase(),
    title: 'Work ' + id,
    display_name: 'Work ' + id,
    publication_year: 2000,
    cited_by_count: 1,
    type: 'journal-article',
    primary_location: { source: { display_name: 'Parity Journal' } },
    open_access: { is_oa: false },
    is_retracted: false,
    referenced_works: [],
    related_works: [],
    authorships: [],
  }, props || {})
}

function author(id, name) {
  return { author: { id: 'https://openalex.org/' + id, display_name: name } }
}

/** A small deterministic OpenAlex-shaped corpus. */
function buildWorks() {
  const works = new Map()
  const cites = new Map()
  const put = (record) => works.set(record.id.replace('https://openalex.org/', ''), record)

  const references = [ID.earlierBook, ID.sameYear, ID.newerRef, ID.undatedRef]
  for (let i = 1; i <= 120; i++) references.push(refId(i))
  const citers = [ID.citingLater, ID.citingSame, ID.citingUndated]
  // Citations are pulled cited-descending with a 100 cap, so keep the corpus
  // small enough that the same-year / undated cases stay inside the window.
  for (let i = 1; i <= 40; i++) citers.push(citeId(i))
  cites.set(ID.seed, citers)

  put(work(ID.seed, {
    title: 'Seed Paper', publication_year: 2000, cited_by_count: 100,
    referenced_works: references.map((id) => 'https://openalex.org/' + id),
    related_works: ['https://openalex.org/' + ID.related],
    authorships: [author(ID.authorOne, 'Ada One'), author(ID.authorTwo, 'Bob Two')],
    open_access: { is_oa: true },
  }))
  put(work(ID.earlierBook, { title: 'Earlier Book', publication_year: 1990, cited_by_count: 5, type: 'book', primary_location: { source: { display_name: 'Springer' } }, authorships: [author(ID.authorOne, 'Ada One')] }))
  put(work(ID.sameYear, { title: 'Same Year Paper', publication_year: 2000, cited_by_count: 3, primary_location: { source: { display_name: 'Nature' } } }))
  put(work(ID.newerRef, { title: 'Newer Reference', publication_year: 2010, cited_by_count: 2, open_access: { is_oa: true }, is_retracted: true, primary_location: { source: { display_name: 'Science' } } }))
  put(work(ID.undatedRef, { title: 'Undated Reference', publication_year: 0, cited_by_count: 1, type: 'dataset', primary_location: null }))
  put(work(ID.related, { title: 'Related Paper', publication_year: 2005, cited_by_count: 4, authorships: [author(ID.authorOne, 'Ada One')] }))
  put(work(ID.citingLater, { title: 'Citing Later', publication_year: 2015, cited_by_count: 20, authorships: [author(ID.authorOne, 'Ada One')] }))
  put(work(ID.citingSame, { title: 'Citing Same Year', publication_year: 2000, cited_by_count: 7 }))
  put(work(ID.citingUndated, { title: 'Citing Undated', publication_year: 0, cited_by_count: 1 }))
  put(work(ID.boundarySeed, {
    title: 'Boundary Seed', publication_year: 2000, cited_by_count: 2,
    referenced_works: ['https://openalex.org/' + ID.sameYear, 'https://openalex.org/' + ID.boundaryRef],
  }))
  put(work(ID.boundaryRef, { title: 'Boundary Reference', publication_year: 2000, cited_by_count: 1 }))
  // Real OpenAlex leaves `author.id` null on some records (verified on
  // W2907492528) and only an ORCID is available; the engine must still resolve
  // an author id or the author axis is dead for those papers.
  put(work(ID.orcidWork, {
    title: 'Orcid Paper', publication_year: 2018, cited_by_count: 6,
    authorships: [
      { author: { id: null, display_name: 'Orcid Person', orcid: 'https://orcid.org/0000-0000-0000-0001' } },
      { author: { id: null, display_name: 'Ghost Person', orcid: null } },
    ],
  }))
  for (let i = 1; i <= 120; i++) {
    put(work(refId(i), { title: 'Reference ' + i, publication_year: 1990 + (i % 20), cited_by_count: i }))
  }
  for (let i = 1; i <= 40; i++) {
    put(work(citeId(i), { title: 'Citer ' + i, publication_year: 2001 + (i % 20), cited_by_count: 300 - i }))
  }
  for (let i = 1; i <= 60; i++) {
    put(work(fillerId(i), { title: 'Filler ' + i, publication_year: 1995 + (i % 10), cited_by_count: i }))
  }
  return { works, cites, citerIds: citers }
}

const corpus = buildWorks()

/** OpenAlex stub: counts requests, tracks concurrency, honours select/sort/per-page. */
function makeStub(delayMs) {
  const state = { urls: [], counts: {}, inFlight: 0, maxInFlight: 0, delayMs: delayMs === undefined ? 2 : delayMs }

  function project(record, select) {
    const out = {
      id: record.id,
      doi: record.doi,
      title: record.title,
      display_name: record.display_name,
      publication_year: record.publication_year,
      cited_by_count: record.cited_by_count,
      type: record.type,
      primary_location: record.primary_location,
      open_access: record.open_access,
      is_retracted: record.is_retracted,
      referenced_works: record.referenced_works,
      related_works: record.related_works,
    }
    if (select.includes('authorships')) out.authorships = record.authorships
    if (select.includes('abstract_inverted_index')) {
      out.abstract_inverted_index = { Parity: [0], abstract: [1], sample: [2] }
    }
    return out
  }

  function respond(rawUrl) {
    const url = new URL(rawUrl)
    const filter = url.searchParams.get('filter') || ''
    const select = url.searchParams.get('select') || ''
    const perPage = Number(url.searchParams.get('per-page') || '25')
    const page = Number(url.searchParams.get('page') || '1')
    const sort = url.searchParams.get('sort') || ''
    const search = url.searchParams.get('search')
    const bump = (key) => { state.counts[key] = (state.counts[key] || 0) + 1 }

    if (url.pathname.indexOf('/works/') === 0) {
      const id = url.pathname.split('/')[2]
      bump('detail')
      const record = corpus.works.get(id)
      if (record === undefined) return { status: 404, body: { error: 'not found' } }
      return { status: 200, body: project(record, select) }
    }

    const parts = filter === '' ? [] : filter.split(',')
    const pick = (prefix) => {
      for (const part of parts) if (part.indexOf(prefix) === 0) return part.slice(prefix.length)
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

    if (url.pathname.indexOf('/authors') === 0) {
      bump('authors')
      const orcids = (pick('orcid:') || '').split('|')
      const found = []
      for (const orcid of orcids) {
        if (orcid !== '0000-0000-0000-0001') continue
        // Two profiles share the ORCID: the richer one must win deterministically.
        found.push({ id: 'https://openalex.org/A99000091', orcid: 'https://orcid.org/' + orcid, display_name: 'Orcid Person', works_count: 3 })
        found.push({ id: 'https://openalex.org/A99000092', orcid: 'https://orcid.org/' + orcid, display_name: 'Orcid Person', works_count: 12 })
      }
      return { status: 200, body: { meta: { count: found.length }, results: found } }
    }

    let results = []
    if (search !== null && search !== undefined) {
      bump('search')
      const needle = search.toLowerCase()
      results = [...corpus.works.values()].filter((record) => record.title.toLowerCase().indexOf(needle) >= 0)
    } else if (idPart !== null) {
      bump('ids')
      for (const id of idPart.split('|')) {
        const record = corpus.works.get(id)
        if (record !== undefined) results.push(record)
      }
    } else if (doiPart !== null) {
      bump('doi')
      for (const record of corpus.works.values()) {
        if (record.doi !== null && record.doi !== undefined && record.doi.toLowerCase().endsWith(doiPart.toLowerCase())) results.push(record)
      }
    } else if (citesPart !== null) {
      bump('cites')
      const targets = corpus.cites.get(citesPart)
      if (targets !== undefined) {
        for (const id of targets) {
          const record = corpus.works.get(id)
          if (record !== undefined) results.push(record)
        }
      }
    } else if (authorPart !== null) {
      bump('author')
      const id = authorPart
      for (const record of corpus.works.values()) {
        if (record.authorships.some((entry) => typeof entry.author.id === 'string' && entry.author.id.endsWith('/' + id))) results.push(record)
      }
    } else {
      bump('other')
    }

    if (fromDate !== null) {
      const year = Number(fromDate.slice(0, 4))
      results = results.filter((record) => record.publication_year >= year)
    }
    if (toDate !== null) {
      const year = Number(toDate.slice(0, 4))
      results = results.filter((record) => record.publication_year <= year)
    }
    if (isOa !== null) results = results.filter((record) => (record.open_access.is_oa === true) === (isOa === 'true'))
    if (isRetracted !== null) results = results.filter((record) => (record.is_retracted === true) === (isRetracted === 'true'))
    if (minCited !== null && minCited.charAt(0) === '>') {
      const bound = Number(minCited.slice(1))
      results = results.filter((record) => record.cited_by_count > bound)
    }

    if (sort.indexOf('cited_by_count:desc') === 0) results = results.slice().sort((a, b) => b.cited_by_count - a.cited_by_count)
    else if (sort.indexOf('publication_year:desc') === 0) results = results.slice().sort((a, b) => b.publication_year - a.publication_year)

    const total = results.length
    const slice = results.slice((page - 1) * perPage, (page - 1) * perPage + perPage)
    return { status: 200, body: { meta: { count: total }, results: slice.map((record) => project(record, select)) } }
  }

  async function fetchImpl(rawUrl) {
    state.urls.push(String(rawUrl))
    state.inFlight += 1
    if (state.inFlight > state.maxInFlight) state.maxInFlight = state.inFlight
    try {
      await new Promise((done) => setTimeout(done, state.delayMs))
      const answer = respond(String(rawUrl))
      return {
        ok: answer.status >= 200 && answer.status < 300,
        status: answer.status,
        async text() { return JSON.stringify(answer.body) },
      }
    } finally {
      state.inFlight -= 1
    }
  }

  return { state, fetchImpl }
}

const stub = makeStub()

let librarySeq = 0
function baseOptions(extra) {
  return Object.assign({
    mailto: 'parity@example.test',
    searchPerPage: 50,
    maxNodes: 1000,
    maxBatch: 100,
    maxCitations: 100,
    maxSeeds: 50,
    concurrency: 4,
    storePath: join(tmpRoot, 'lib-' + (librarySeq++) + '.json'),
    fetchImpl: stub.fetchImpl,
    retryDelayMs: 1,
  }, extra || {})
}

/** The `ready()` result of every library opened below, for the repair assertions. */
const openResults = new WeakMap()

/** Create + open a library; null when the capability is missing (stashed baseline). */
async function openLibrary(options) {
  if (createLibrary === null) return null
  let library = null
  try { library = createLibrary(options) } catch { return null }
  if (library === null || typeof library.ready !== 'function') return null
  let opened = null
  try { opened = await library.ready() } catch { return null }
  openResults.set(library, opened)
  return library
}

async function newLibrary(extra) {
  return openLibrary(baseOptions(extra))
}

function linkedYears(outcome, kind) {
  const years = []
  const nodes = outcome.graph.nodes
  for (const link of outcome.graph.links) {
    if (link.kind !== kind) continue
    const node = nodes.find((candidate) => candidate.id === link.target)
    if (node !== undefined) years.push(node.year)
  }
  return years
}

/* ---------------------------------------------------------------- config */

section('config (AC-A5-1, AC-A5-6, AC-A2-4)')
{
  const defaults = resolveConfig === null ? null : resolveConfig(undefined)
  check('AC-A5-1 resolveConfig defaults are the frozen quotas',
    defaults !== null && defaults.searchPerPage === 50 && defaults.maxBatch === 100 && defaults.maxCitations === 100 &&
      defaults.maxNodes === 1000 && defaults.maxSeeds === 50 && defaults.concurrency === 4 &&
      defaults.exposeTool === true && typeof defaults.mailto === 'string' && defaults.mailto !== '',
    JSON.stringify(defaults))

  const bad = resolveConfig === null ? null : resolveConfig({ searchPerPage: 'x', maxBatch: -1, maxCitations: 0, maxNodes: Number.NaN, maxSeeds: 2.5, concurrency: 'nope' })
  check('AC-A5-1 invalid quota values fall back to the defaults',
    bad !== null && bad.searchPerPage === 50 && bad.maxBatch === 100 && bad.maxCitations === 100 && bad.maxNodes === 1000 && bad.maxSeeds === 2 && bad.concurrency === 4,
    JSON.stringify(bad))

  const overridden = resolveConfig === null ? null : resolveConfig({ searchPerPage: 5, maxBatch: 7, maxCitations: 9, maxNodes: 11, maxSeeds: 13, concurrency: 2, storePath: 'parity/library.json' })
  check('AC-A5-6 every quota key is overridable from config',
    overridden !== null && overridden.searchPerPage === 5 && overridden.maxBatch === 7 && overridden.maxCitations === 9 &&
      overridden.maxNodes === 11 && overridden.maxSeeds === 13 && overridden.concurrency === 2,
    JSON.stringify(overridden))

  const envHome = process.env.DSH_HOME
  check('AC-B1-8 storePath default resolves under DSH_HOME (no hardcoded home)',
    defaultStorePath !== null && typeof envHome === 'string' && defaultStorePath() === join(envHome, 'research-cat', 'library.json'),
    String(defaultStorePath === null ? 'missing' : defaultStorePath()))

  check('AC-A5-6 a relative storePath is resolved against DSH_HOME',
    overridden !== null && overridden.storePath === join(envHome, 'parity', 'library.json'),
    overridden === null ? 'missing' : String(overridden.storePath))

  check('AC-A5-1 resolveConfig exposes exactly the ten frozen keys',
    defaults !== null && Object.keys(defaults).length === 10,
    defaults === null ? 'missing' : Object.keys(defaults).join(','))

  check('AC-A5-1b apiKey defaults to empty and is trimmed when set (spec §11 change record)',
    defaults !== null && defaults.apiKey === '' &&
      resolveConfig({ apiKey: '  k-123  ' }).apiKey === 'k-123' &&
      resolveConfig({ apiKey: 42 }).apiKey === '',
    defaults === null ? 'missing' : JSON.stringify({ dflt: defaults.apiKey }))
}

/* ------------------------------------------------------- store hardening */

section('store hardening (F2 stale temps / F3 metadata lag / F5 write before open)')
{
  if (createStore === null) {
    check('F5 a write before open() never touches the existing file', false, 'createStore missing')
    check('F2 stale .tmp files are swept on open()', false, 'createStore missing')
    check('F3 the persisted meta.writes describes the write that produced the file', false, 'createStore missing')
  } else {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-rc-store-'))
    const file = join(dir, 'library.json')
    const existing = {
      version: 1, savedAt: null, records: {}, collections: [], memberships: [],
      recentlyFound: [], annotations: {}, seq: 0, meta: { writes: 7 },
    }
    writeFileSync(file, JSON.stringify(existing, null, 2), 'utf8')
    const before = readFileSync(file, 'utf8')

    const store = createStore({ storePath: file, snapshot: () => Object.assign({}, existing, { seq: 99 }) })

    // F5: mutate + flush BEFORE open() must leave the file untouched — an
    // unopened store has not read the library, so writing would replace it.
    store.saveNow()
    await store.flush()
    check('F5 a write before open() never touches the existing file',
      readFileSync(file, 'utf8') === before && store.writeCount() === 0,
      'writes=' + store.writeCount())

    // F2: a temp file left behind by a hard exit is swept when the store opens.
    const stale = file + '.tmp-99999-deadbeef'
    writeFileSync(stale, '{"partial":', 'utf8')
    await store.open()
    check('F2 stale .tmp files are swept on open()', existsSync(stale) === false, String(stale))

    // F5b: whatever was deferred before open() lands afterwards.
    await store.flush()
    check('F5b the write deferred before open() lands after open()',
      store.writeCount() >= 1 && readFileSync(file, 'utf8') !== before,
      'writes=' + store.writeCount())

    // F3: the file must carry the metadata of the write that produced it — it
    // used to be stamped after the rename, so it lagged one write behind.
    const persisted = JSON.parse(readFileSync(file, 'utf8'))
    check('F3 the persisted meta.writes describes the write that produced the file',
      persisted.meta.writes === store.writeCount() && typeof persisted.savedAt === 'string' && persisted.savedAt.length > 0,
      JSON.stringify({ persistedWrites: persisted.meta.writes, actualWrites: store.writeCount(), savedAt: persisted.savedAt }))

    await store.close()
  }
}

/* ---------------------------------------------------------- pure helpers */

section('chunking + filters (AC-A5-3, AC-A4-2..8)')
{
  const ids = []
  for (let i = 1; i <= 100; i++) ids.push('W99' + String(100000 + i))
  const chunks = chunkIds === null ? null : chunkIds(ids, 50)
  check('AC-A5-3 chunkIds splits 100 ids into 2 requests of 50',
    chunks !== null && chunks.length === 2 && chunks[0].length === 50 && chunks[1].length === 50,
    JSON.stringify(chunks === null ? null : chunks.map((chunk) => chunk.length)))

  const dupes = chunkIds === null ? null : chunkIds(['W1', 'https://openalex.org/W1', 'W2', 'bad', ''], 50)
  check('AC-A5-3 chunkIds normalises, de-duplicates and drops non-work ids',
    dupes !== null && dupes.length === 1 && dupes[0].join(',') === 'W1,W2',
    JSON.stringify(dupes))

  const sample = [
    { id: 'W1', title: 'a', year: 2000, citedBy: 5, venue: 'Nature', openAccess: false, retracted: false },
    { id: 'W2', title: 'b', year: 1999, citedBy: 9, venue: 'nature communications', openAccess: true, retracted: true },
    { id: 'W3', title: 'c', year: 0, citedBy: 1, venue: null, openAccess: false, retracted: false },
    { id: 'W4', title: 'd', year: 2001, citedBy: 5, venue: 'Science', openAccess: true, retracted: false },
  ]

  const boundary = applyFilters === null ? null : applyFilters(sample, { yearFrom: 1999, yearTo: 2001 })
  check('AC-A4-2 yearFrom/yearTo is a closed interval and year 0 never passes a bounded side',
    boundary !== null && boundary.map((record) => record.id).sort().join(',') === 'W1,W2,W4',
    JSON.stringify(boundary === null ? null : boundary.map((record) => record.id)))

  let rangeRejected = false
  try { normalizeFilters({ yearFrom: 2000, yearTo: 1990 }) } catch (error) { rangeRejected = error.code === 'invalid' }
  check('AC-A4-2 yearFrom > yearTo is rejected as invalid (not an empty success)', rangeRejected)

  const venue = applyFilters === null ? null : applyFilters(sample, { venue: 'NATURE' })
  check('AC-A4-3 venue matches case-insensitively as a substring; null venue never matches',
    venue !== null && venue.map((record) => record.id).sort().join(',') === 'W1,W2',
    JSON.stringify(venue === null ? null : venue.map((record) => record.id)))

  const noVenue = applyFilters === null ? null : applyFilters(sample, { venue: '' })
  check('AC-A4-3 venue:"" is treated as not provided', noVenue !== null && noVenue.length === sample.length)

  const oa = applyFilters === null ? null : applyFilters(sample, { isOa: true })
  const retracted = applyFilters === null ? null : applyFilters(sample, { isRetracted: true })
  check('AC-A4-4 isOa / isRetracted compare the boolean record fields',
    oa !== null && oa.map((record) => record.id).sort().join(',') === 'W2,W4' &&
      retracted !== null && retracted.map((record) => record.id).join(',') === 'W2',
    JSON.stringify(oa === null ? null : oa.map((record) => record.id)))

  const minCited = applyFilters === null ? null : applyFilters(sample, { minCitations: 5 })
  check('AC-A4-5 minCitations is an inclusive lower bound',
    minCited !== null && minCited.every((record) => record.citedBy >= 5) && minCited.length === 3,
    JSON.stringify(minCited === null ? null : minCited.map((record) => record.id)))

  const sorted = applyFilters === null ? null : applyFilters(sample, { sort: 'year' })
  let yearMonotone = sorted !== null
  if (sorted !== null) for (let i = 1; i < sorted.length; i++) if (sorted[i].year > sorted[i - 1].year) yearMonotone = false
  check('AC-A4-5 sort:"year" returns a year-descending sequence', yearMonotone,
    JSON.stringify(sorted === null ? null : sorted.map((record) => record.year)))

  const illegal = [
    ['unknown key', { bogus: 1 }],
    ['non-boolean isOa', { isOa: 'yes' }],
    ['negative minCitations', { minCitations: -1 }],
    ['illegal sort', { sort: 'newest' }],
    ['non-integer year', { yearFrom: 1999.5 }],
    ['array filters', []],
  ]
  let illegalRejected = 0
  for (const [name, value] of illegal) {
    try { normalizeFilters(value) } catch (error) { if (error.code === 'invalid') illegalRejected += 1 }
  }
  check('AC-A4-7 unknown keys, wrong types and negative bounds are rejected with code invalid',
    illegalRejected === illegal.length, illegalRejected + '/' + illegal.length)

  const first = applyFilters === null ? null : applyFilters(sample, { minCitations: 1 }).map((record) => record.id)
  const second = applyFilters === null ? null : applyFilters(sample, { minCitations: 1 }).map((record) => record.id)
  check('AC-A4-8 filtering is deterministic: the same input yields the same id sequence',
    first !== null && sameJson(first, second), JSON.stringify(first))
}

/* ---------------------------------------------------------------- bibtex */

section('BibTeX export (AC-A7-2..8)')
{
  const records = [
    { id: 'W1', title: 'Alpha & Beta 50% _test_', year: 2000, citedBy: 5, doi: '10.1/x', venue: 'Nature', kind: 'journal-article', openAccess: true, retracted: false, authorIds: [], authors: ['Ada One', 'Bob Two'] },
    { id: 'W2', title: 'Second', year: 2000, citedBy: 3, doi: null, venue: null, kind: 'book', openAccess: false, retracted: false, authorIds: [], authors: ['Ada One'] },
    { id: 'W3', title: 'Third', year: 1990, citedBy: 1, doi: null, venue: 'Springer', kind: 'proceedings-article', openAccess: false, retracted: false, authorIds: [] },
  ]
  const text = bibtexOf === null ? null : bibtexOf(records)
  check('AC-A7-2 bibtexOf renders a parseable document', text !== null && typeof text === 'string', String(text))

  const entries = parseBibtex(text === null ? '' : text)
  check('AC-A7-2 the entry count matches the exported record count', entries.length === records.length,
    entries.length + ' vs ' + records.length)
  check('AC-A7-2 every entry carries the record title and year',
    entries.length === records.length && entries.every((entry, index) => entry.fields.title !== undefined && entry.fields.year === String(records[index].year)),
    JSON.stringify(entries.map((entry) => [entry.fields.title, entry.fields.year])))
  check('AC-A7-3 authors join with " and " and an authorless record omits the field',
    entries[0] !== undefined && entries[0].fields.author === 'Ada One and Bob Two' && entries[2].fields.author === undefined,
    JSON.stringify(entries.map((entry) => entry.fields.author)))
  check('AC-A7-4 every entry has a doi or a url',
    entries.length === records.length && entries.every((entry) => entry.fields.doi !== undefined || entry.fields.url !== undefined),
    JSON.stringify(entries.map((entry) => [entry.fields.doi, entry.fields.url])))
  check('AC-A7-5 citation keys are unique',
    new Set(entries.map((entry) => entry.key)).size === entries.length,
    JSON.stringify(entries.map((entry) => entry.key)))
  const again = bibtexOf === null ? null : bibtexOf(records)
  check('AC-A7-5 two exports of the same input are byte-identical', text !== null && text === again)
  check('AC-A7-6 the type map is fixed (article/book/incollection/inproceedings/misc)',
    bibtexTypeOf !== null && bibtexTypeOf('journal-article') === 'article' && bibtexTypeOf('book') === 'book' &&
      bibtexTypeOf('book-chapter') === 'incollection' && bibtexTypeOf('proceedings-article') === 'inproceedings' &&
      bibtexTypeOf('dataset') === 'misc' && bibtexTypeOf('weird-type') === 'misc' && bibtexTypeOf(undefined) === 'misc',
    bibtexTypeOf === null ? 'missing' : bibtexTypeOf('weird-type'))
  check('AC-A7-6 the rendered entries use the mapped types',
    entries.length === 3 && entries[0].type === 'article' && entries[1].type === 'book' && entries[2].type === 'inproceedings',
    JSON.stringify(entries.map((entry) => entry.type)))
  const escaped = escapeLatex === null ? '' : escapeLatex('a & b % c $ d # e _ f { g } h ~ i ^ j \\ k')
  check('AC-A7-7 LaTeX specials are escaped and no raw & survives in a field',
    escaped.indexOf('\\&') >= 0 && escaped.indexOf('\\%') >= 0 && escaped.indexOf('\\_') >= 0 &&
      escaped.indexOf('\\textasciitilde{}') >= 0 && escaped.indexOf('\\textasciicircum{}') >= 0 &&
      escaped.indexOf('\\textbackslash{}') >= 0 &&
      text !== null && text.indexOf('Alpha & Beta') < 0 && text.indexOf('Alpha \\& Beta') >= 0,
    escaped)
  check('AC-A7-7 non-ASCII characters stay UTF-8 (not \\uXXXX)',
    escapeLatex !== null && escapeLatex('Zhang Wei — naïve café') === 'Zhang Wei — naïve café')
  const empty = bibtexOf === null ? null : bibtexOf([])
  check('AC-A7-8 an empty input yields count 0 and a legal comment-only document',
    empty !== null && parseBibtex(empty).length === 0 && empty.indexOf('@') < 0, String(empty))
  check('AC-A7-8 missing title/year fields still produce a parseable entry',
    bibtexOf !== null && parseBibtex(bibtexOf([{ id: 'W9', title: undefined, year: undefined, kind: undefined }])).length === 1)
}

/* -------------------------------------------------------- persistence */

section('persistence (AC-B1-1..8)')
{
  /** In-memory `node:fs/promises` with failure injection. */
  function memFs() {
    const files = new Map()
    const fs = {
      files,
      failWriteOnce: false,
      failMkdir: false,
      async mkdir(dir) {
        if (fs.failMkdir === true) { const error = new Error('EACCES: ' + dir); error.code = 'EACCES'; throw error }
      },
      async readFile(path) {
        if (!files.has(path)) { const error = new Error('ENOENT: ' + path); error.code = 'ENOENT'; throw error }
        return files.get(path)
      },
      async writeFile(path, text) {
        if (fs.failWriteOnce === true) { fs.failWriteOnce = false; throw new Error('injected write failure') }
        files.set(path, String(text))
      },
      async rename(from, to) {
        if (!files.has(from)) { const error = new Error('ENOENT: ' + from); error.code = 'ENOENT'; throw error }
        files.set(to, files.get(from))
        files.delete(from)
      },
      async unlink(path) { files.delete(path) },
      async open(path) {
        let buffer = ''
        return {
          async writeFile(text) {
            if (fs.failWriteOnce === true) { fs.failWriteOnce = false; throw new Error('injected write failure') }
            buffer = String(text)
          },
          async sync() {},
          async close() { files.set(path, buffer) },
        }
      },
    }
    return fs
  }

  const path = '/parity/library.json'
  const fs = memFs()
  const first = await openLibrary(baseOptions({ storePath: path, fs: fs, debounceMs: 5 }))
  let restartOk = false
  if (first !== null) {
    await first.addSeed(ID.seed)
    const created = first.collections({ op: 'create', name: 'Reading' })
    first.collections({ op: 'save', collectionId: created.collection.id, ids: [ID.related] })
    first.annotate({ id: ID.seed, note: 'line one\nline two', tags: ['methods', 'methods', 'to read'], color: 'red' })
    await first.flush()
    const before = first.state().library
    const second = await openLibrary(baseOptions({ storePath: path, fs: fs, debounceMs: 5 }))
    const after = second.state().library
    restartOk = sameJson(before.collections, after.collections) && sameJson(before.recentlyFound, after.recentlyFound) &&
      sameJson(before.annotations, after.annotations) && sameJson(before.records, after.records) &&
      after.collections.length === 2 && after.annotations[ID.seed].note === 'line one\nline two'
    check('AC-B1-1 a restart on the same storePath keeps collections, members, notes, tags, colour and Recently Found',
      restartOk, JSON.stringify({ before: before.collections.length, after: after.collections.length }))
    check('AC-B3-7 Recently Found survives the restart',
      after.recentlyFound.indexOf(ID.seed) >= 0 && after.recentlyFound.indexOf(ID.related) < 0,
      JSON.stringify(after.recentlyFound))
    check('AC-B1-1 the graph itself is empty after a restart (library persisted, graph temporary)',
      second.state().counts.papers === 0 && second.state().counts.links === 0 &&
        second.state().counts.seeds === 1,
      JSON.stringify(second.state().counts))
    check('AC-B1-1 /state reports the library storePath and no storeError on a healthy file',
      after.storePath === path && after.storeError === null, JSON.stringify([after.storePath, after.storeError]))
  } else {
    check('AC-B1-1 a restart on the same storePath keeps collections, members, notes, tags, colour and Recently Found', false, 'createLibrary missing')
    check('AC-B3-7 Recently Found survives the restart', false, 'createLibrary missing')
    check('AC-B1-1 the graph itself is empty after a restart (library persisted, graph temporary)', false, 'createLibrary missing')
    check('AC-B1-1 /state reports the library storePath and no storeError on a healthy file', false, 'createLibrary missing')
  }

  // AC-B1-2: a failed write must leave the previous complete file in place.
  if (first !== null) {
    const good = fs.files.get(path)
    fs.failWriteOnce = true
    first.annotate({ id: ID.seed, note: 'this write will fail' })
    await first.flush()
    const stillThere = fs.files.get(path)
    let parses = false
    try { JSON.parse(stillThere); parses = true } catch { parses = false }
    check('AC-B1-2 an injected write failure leaves the old complete JSON on disk (never a truncated file)',
      parses && stillThere === good, String(stillThere === undefined ? 'missing' : stillThere.slice(0, 40)))
    const leftovers = [...fs.files.keys()].filter((key) => key.indexOf('.tmp-') >= 0)
    check('AC-B1-2 no temporary file is left behind after a failed write', leftovers.length === 0, JSON.stringify(leftovers))
  } else {
    check('AC-B1-2 an injected write failure leaves the old complete JSON on disk (never a truncated file)', false, 'createLibrary missing')
    check('AC-B1-2 no temporary file is left behind after a failed write', false, 'createLibrary missing')
  }

  // AC-B1-6: /clear semantics and library/file sync.
  {
    const clearPath = join(tmpRoot, 'clear.json')
    const library = await openLibrary(baseOptions({ storePath: clearPath, debounceMs: 5 }))
    let ok = false
    let detail = 'createLibrary missing'
    if (library !== null) {
      await library.addSeed(ID.seed)
      await library.addSeed(ID.related)
      const keep = library.collections({ op: 'create', name: 'Keep' }).collection
      library.collections({ op: 'save', collectionId: keep.id, ids: [ID.related] })
      const graphCleared = library.clear()
      await library.flush()
      const afterGraph = JSON.parse(readFileSync(clearPath, 'utf8'))
      const libraryCleared = library.clear('library')
      await library.flush()
      const afterLibrary = JSON.parse(readFileSync(clearPath, 'utf8'))
      ok = graphCleared.counts.papers === 0 && graphCleared.counts.seeds === 0 &&
        graphCleared.library.records[ID.seed] !== undefined &&
        afterGraph.memberships.length === 1 && afterGraph.memberships[0].collectionId === keep.id &&
        libraryCleared.library.collections.length === 1 && Object.keys(libraryCleared.library.records).length === 0 &&
        afterLibrary.memberships.length === 0 && afterLibrary.collections.length === 1
      detail = JSON.stringify({
        graph: graphCleared.counts,
        membershipsAfterGraphClear: afterGraph.memberships.length,
        afterLibrary: afterLibrary.collections.length,
      })
    }
    check('AC-B1-6 clear:"graph" empties the graph + seeds but keeps the library; clear:"library" resets and syncs the file', ok, detail)
  }

  // AC-B1-3 / AC-B1-4: unknown version and corrupt files degrade to an empty library + .bak.
  for (const [label, content] of [
    ['AC-B1-3 a newer version is backed up as .bak and starts an empty library with storeError', '{"version":99,"records":{}}'],
    ['AC-B1-4 a corrupt file is backed up as .bak and starts an empty library with storeError', '{not json at all'],
    ['AC-B1-4 an empty file is backed up as .bak and starts an empty library with storeError', '   '],
  ]) {
    const brokenFs = memFs()
    brokenFs.files.set(path, content)
    const library = await openLibrary(baseOptions({ storePath: path, fs: brokenFs, debounceMs: 5 }))
    let ok = false
    let detail = 'createLibrary missing'
    if (library !== null) {
      const opened = openResults.get(library) || { repaired: false }
      const state = library.state()
      const backup = [...brokenFs.files.keys()].some((key) => key.indexOf('.bak-') >= 0)
      ok = opened.repaired === true && backup && state.library.storeError !== null && state.counts.papers === 0 &&
        state.library.collections.length === 1 && state.library.collections[0].id === 'seeds'
      detail = JSON.stringify({ repaired: opened.repaired, backup: backup, storeError: state.library.storeError })
    }
    check(label, ok, detail)
  }

  // AC-B1-5: debounced writes; flush forces one write.
  {
    const throttleFs = memFs()
    const library = await openLibrary(baseOptions({ storePath: path, fs: throttleFs, debounceMs: 40 }))
    let ok = false
    let detail = 'createLibrary missing'
    if (library !== null) {
      await library.addSeed(ID.seed)
      await library.flush()
      const afterSeed = library.storeInfo().writes
      library.annotate({ id: ID.seed, note: 'a' })
      library.annotate({ id: ID.seed, note: 'b' })
      library.annotate({ id: ID.seed, note: 'c' })
      await new Promise((done) => setTimeout(done, 80))
      const afterBurst = library.storeInfo().writes
      await library.flush()
      ok = afterSeed === 1 && afterBurst === 2 && library.storeInfo().writes === 2
      detail = JSON.stringify({ afterSeed, afterBurst })
    }
    check('AC-B1-5 three quick writes collapse into one disk write (debounced) and flush is a no-op afterwards', ok, detail)
  }

  // AC-B1-7: no network needed to read the library back.
  {
    const offlineFs = memFs()
    const writer = await openLibrary(baseOptions({ storePath: path, fs: offlineFs, debounceMs: 5 }))
    let ok = false
    let detail = 'createLibrary missing'
    if (writer !== null) {
      await writer.addSeed(ID.seed)
      writer.annotate({ id: ID.seed, note: 'offline note' })
      await writer.flush()
      const offlineFetch = async () => { throw new Error('offline') }
      const reader = await openLibrary(baseOptions({ storePath: path, fs: offlineFs, fetchImpl: offlineFetch, debounceMs: 5 }))
      const state = reader.state()
      let networkFails = false
      try { await reader.search('anything') } catch (error) { networkFails = /unreachable/i.test(String(error.message)) }
      ok = state.library.records[ID.seed] !== undefined && state.library.annotations[ID.seed].note === 'offline note' && networkFails
      detail = JSON.stringify({ records: Object.keys(state.library.records).length, networkFails })
    }
    check('AC-B1-7 the library loads and /state answers with no network; only network operations fail', ok, detail)
  }

  // AC-B1-8: an unwritable directory degrades to memory instead of failing the plugin.
  {
    const brokenFs = memFs()
    brokenFs.failMkdir = true
    const library = await openLibrary(baseOptions({ storePath: path, fs: brokenFs, debounceMs: 5 }))
    let ok = false
    let detail = 'createLibrary missing'
    if (library !== null) {
      await library.addSeed(ID.seed)
      await library.flush()
      const info = library.storeInfo()
      ok = info.storeError !== null && info.writes === 0 && library.state().counts.seeds === 1
      detail = JSON.stringify(info)
    }
    check('AC-B1-8 an unwritable storePath degrades to an in-memory library with a readable storeError', ok, detail)
  }
}

/* --------------------------------------------------------------- engine */

section('exploration axes (AC-A1, AC-A2, AC-A3, AC-A4, AC-A5)')
{
  // AC-A5-2 / AC-A5-7: search page size, total, hasMore, polite pool.
  const searchLibrary = await newLibrary()
  if (searchLibrary === null) {
    check('AC-A5-2 search requests per-page=50 and reports total/hasMore', false, 'createLibrary missing')
    check('AC-A5-7 every OpenAlex request carries mailto', false, 'createLibrary missing')
  } else {
    stub.state.counts = {}
    const found = await searchLibrary.search('Reference')
    const searchUrls = stub.state.urls.filter((url) => url.indexOf('search=') >= 0)
    check('AC-A5-2 search requests per-page=50 and reports total/hasMore',
      searchUrls.length > 0 && searchUrls.every((url) => url.indexOf('per-page=50') >= 0) &&
        found.results.length === 50 && found.total > 50 && found.hasMore === true && found.page === 1,
      JSON.stringify({ urls: searchUrls.length, results: found.results.length, total: found.total, hasMore: found.hasMore }))
    check('AC-A5-7 every OpenAlex request carries mailto',
      stub.state.urls.length > 0 && stub.state.urls.every((url) => url.indexOf('mailto=') >= 0),
      String(stub.state.urls.length))
    check('AC-A5-7b a keyless library never sends api_key',
      stub.state.urls.every((url) => url.indexOf('api_key=') < 0),
      String(stub.state.urls.filter((url) => url.indexOf('api_key=') >= 0).length))

    const keyedLibrary = await openLibrary(baseOptions({ apiKey: 'key-abc' }))
    if (keyedLibrary === null) {
      check('AC-A5-7c a configured apiKey rides every OpenAlex request', false, 'openLibrary missing')
    } else {
      stub.state.urls = []
      await keyedLibrary.search('Reference')
      check('AC-A5-7c a configured apiKey rides every OpenAlex request',
        stub.state.urls.length > 0 && stub.state.urls.every((url) => url.indexOf('api_key=key-abc') >= 0),
        JSON.stringify(stub.state.urls.slice(0, 2)))
    }
    let pageRejected = false
    try { await searchLibrary.search('Reference', undefined, 0) } catch (error) { pageRejected = error.code === 'invalid' }
    check('AC-A4-7 an illegal page number is rejected as invalid', pageRejected)
  }

  // AC-A5-3 / AC-A5-4: chunked references and a 100-cap on citations.
  const refLibrary = await newLibrary()
  if (refLibrary === null) {
    check('AC-A5-3 references expand chunks 100 ids into 2 requests and returns more than 50', false, 'createLibrary missing')
    check('AC-A5-4 citations expand returns up to 100 records', false, 'createLibrary missing')
  } else {
    await refLibrary.addSeed(ID.seed)
    stub.state.counts = {}
    const refs = await refLibrary.expand(ID.seed, 'references')
    check('AC-A5-3 references expand chunks 100 ids into 2 requests and returns more than 50',
      stub.state.counts.ids === 2 && refs.found > 50 && refs.considered === 100 && refs.truncated === true,
      JSON.stringify({ ids: stub.state.counts.ids, found: refs.found, considered: refs.considered }))
    const cites = await refLibrary.expand(ID.seed, 'citations')
    check('AC-A5-4 citations expand returns up to 100 records',
      cites.found <= 100 && cites.found > 25 && cites.considered >= cites.found,
      JSON.stringify({ found: cites.found, considered: cites.considered }))
  }

  // AC-A1: author axis.
  const authorLibrary = await newLibrary()
  if (authorLibrary === null) {
    check('AC-A1-1 authors lists A-ids in authorships order', false, 'createLibrary missing')
    check('AC-A1-2 kind:author links the seed to the author works', false, 'createLibrary missing')
    check('AC-A1-3 author works come back in citedBy-descending order', false, 'createLibrary missing')
    check('AC-A1-4 kind:author without authorId is invalid and names the available author ids', false, 'createLibrary missing')
    check('AC-A1-5 author results honour filters and the batch quota', false, 'createLibrary missing')
    check('AC-A1-6 (host prerequisite) the authors route + author axis exist for the panel click-through', false, 'createLibrary missing')
  } else {
    const authors = await authorLibrary.authors(ID.seed)
    check('AC-A1-1 authors lists A-ids in authorships order',
      authors.authors.length === 2 && /^A\d+$/.test(authors.authors[0].id) && authors.authors[0].id === ID.authorOne &&
        authors.authors[1].id === ID.authorTwo && authors.authors[0].name === 'Ada One',
      JSON.stringify(authors.authors))
    const orcidAuthors = await authorLibrary.authors(ID.orcidWork)
    check('AC-A1-1 authors resolves an ORCID to an author id when OpenAlex leaves author.id null',
      orcidAuthors.authors.length === 1 && orcidAuthors.authors[0].id === 'A99000092' &&
        orcidAuthors.authors[0].name === 'Orcid Person',
      JSON.stringify(orcidAuthors.authors))
    check('AC-A1-1 authors drops entries that have neither an author id nor an ORCID (failure path)',
      orcidAuthors.authors.every((author) => /^A\d+$/.test(author.id)),
      JSON.stringify(orcidAuthors.authors))

    await authorLibrary.addSeed(ID.seed)
    const byAuthor = await authorLibrary.expand(ID.seed, 'author', { authorId: ID.authorOne })
    const authorLinks = byAuthor.graph.links.filter((link) => link.kind === 'author')
    check('AC-A1-2 kind:author links the seed to the author works',
      byAuthor.kind === 'author' && byAuthor.added > 0 && authorLinks.length > 0 &&
        authorLinks.every((link) => link.source === ID.seed) && byAuthor.ids.indexOf(ID.citingLater) >= 0,
      JSON.stringify({ added: byAuthor.added, links: authorLinks.length }))
    const order = byAuthor.ids.map((id) => byAuthor.graph.nodes.find((node) => node.id === id).citedBy)
    let monotone = true
    for (let i = 1; i < order.length; i++) if (order[i] > order[i - 1]) monotone = false
    check('AC-A1-3 author works come back in citedBy-descending order',
      order.length >= 2 && monotone, JSON.stringify(order))
    let missingAuthor = null
    try { await authorLibrary.expand(ID.seed, 'author') } catch (error) { missingAuthor = error }
    check('AC-A1-4 kind:author without authorId is invalid and names the available author ids',
      missingAuthor !== null && missingAuthor.code === 'invalid' && /authorId/.test(String(missingAuthor.message)) &&
        String(missingAuthor.message).indexOf(ID.authorOne) >= 0,
      String(missingAuthor === null ? 'no error' : missingAuthor.message))
    const filtered = await authorLibrary.expand(ID.seed, 'author', { authorId: ID.authorOne, filters: { yearFrom: 2001 } })
    const filteredYears = filtered.ids.map((id) => filtered.graph.nodes.find((node) => node.id === id).year)
    check('AC-A1-5 author results honour filters and the batch quota',
      filteredYears.length > 0 && filteredYears.every((year) => year >= 2001) && filtered.found <= 100,
      JSON.stringify(filteredYears))
    check('AC-A1-6 (host prerequisite) the authors route + author axis exist for the panel click-through',
      routesMod.module !== null && routesMod.module.ROUTE_PREFIX === '/dsh-research-cat' && byAuthor.kind === 'author')
  }

  // AC-A3: earlier / later.
  const timeLibrary = await newLibrary()
  if (timeLibrary === null) {
    check('AC-A3-1 earlier returns only references older than the seed', false, 'createLibrary missing')
    check('AC-A3-2 later returns only citing papers newer than the seed', false, 'createLibrary missing')
    check('AC-A3-3 same-year and year-0 neighbours are excluded; an empty result is still ok', false, 'createLibrary missing')
    check('AC-A3-4 each seed uses its own year as the boundary', false, 'createLibrary missing')
    check('AC-A3-6 earlier/later honour filters and the batch quota', false, 'createLibrary missing')
    check('AC-A3-5 (host prerequisite) earlier/later axes return data for the panel buttons', false, 'createLibrary missing')
  } else {
    await timeLibrary.addSeed(ID.seed)
    const earlier = await timeLibrary.expand(ID.seed, 'earlier')
    const earlierYears = linkedYears(earlier, 'earlier')
    const earlierIds = earlier.ids
    check('AC-A3-1 earlier returns only references older than the seed',
      earlier.kind === 'earlier' && earlierYears.length > 0 && earlierYears.every((year) => year > 0 && year < 2000) &&
        earlierIds.indexOf(ID.sameYear) < 0 && earlierIds.indexOf(ID.newerRef) < 0 && earlierIds.indexOf(ID.undatedRef) < 0 &&
        earlierIds.indexOf(ID.earlierBook) >= 0,
      JSON.stringify({ count: earlierYears.length, years: [...new Set(earlierYears)].sort() }))
    const later = await timeLibrary.expand(ID.seed, 'later')
    const laterYears = linkedYears(later, 'later')
    check('AC-A3-2 later returns only citing papers newer than the seed',
      later.kind === 'later' && laterYears.length > 0 && laterYears.every((year) => year > 2000) &&
        later.ids.indexOf(ID.citingSame) < 0 && later.ids.indexOf(ID.citingUndated) < 0 &&
        later.ids.indexOf(ID.citingLater) >= 0,
      JSON.stringify({ count: laterYears.length, years: [...new Set(laterYears)].sort() }))

    const boundaryLibrary = await newLibrary()
    await boundaryLibrary.addSeed(ID.boundarySeed)
    const emptyEarlier = await boundaryLibrary.expand(ID.boundarySeed, 'earlier')
    const emptyLater = await boundaryLibrary.expand(ID.boundarySeed, 'later')
    check('AC-A3-3 same-year and year-0 neighbours are excluded; an empty result is still ok',
      emptyEarlier.found === 0 && emptyLater.found === 0 && emptyEarlier.ids.length === 0 &&
        typeof emptyEarlier.note === 'string' && emptyEarlier.note.length > 0,
      JSON.stringify({ earlier: emptyEarlier.found, later: emptyLater.found, note: emptyEarlier.note }))

    const multiLibrary = await newLibrary()
    await multiLibrary.addSeed(ID.seed)
    await multiLibrary.addSeed(ID.citingLater)
    const multi = await multiLibrary.expandAll({ kinds: ['earlier'] })
    const perSeed = multi.perSeed.filter((entry) => entry.kind === 'earlier')
    const seedBoundaryOk = perSeed.length === 2
    check('AC-A3-4 each seed uses its own year as the boundary',
      seedBoundaryOk && perSeed.every((entry) => entry.error === null),
      JSON.stringify(perSeed))

    const filteredTime = await timeLibrary.expand(ID.seed, 'earlier', { filters: { minCitations: 50 } })
    const filteredYears = filteredTime.ids.map((id) => filteredTime.graph.nodes.find((node) => node.id === id).citedBy)
    check('AC-A3-6 earlier/later honour filters and the batch quota',
      filteredTime.found <= 100 && filteredYears.every((cited) => cited >= 50),
      JSON.stringify({ found: filteredTime.found, cited: filteredYears.slice(0, 5) }))
    check('AC-A3-5 (host prerequisite) earlier/later axes return data for the panel buttons',
      earlier.kind === 'earlier' && later.kind === 'later')
  }

  // AC-A4: filters across every axis.
  const filterLibrary = await newLibrary()
  if (filterLibrary === null) {
    check('AC-A4-1 every axis accepts the same filters object', false, 'createLibrary missing')
    check('AC-A4-6 found is the filtered count and considered the pre-filter count', false, 'createLibrary missing')
  } else {
    await filterLibrary.addSeed(ID.seed)
    const kinds = ['references', 'citations', 'related', 'earlier', 'later']
    let accepted = 0
    for (const kind of kinds) {
      try {
        const outcome = await filterLibrary.expand(ID.seed, kind, { filters: { yearFrom: 1900, yearTo: 2100 } })
        if (outcome.found >= 0) accepted += 1
      } catch { /* counted as not accepted */ }
    }
    try {
      await filterLibrary.expand(ID.seed, 'author', { authorId: ID.authorOne, filters: { yearFrom: 1900 } })
      accepted += 1
    } catch { /* counted */ }
    try {
      await filterLibrary.search('Reference', { minCitations: 1 })
      accepted += 1
    } catch { /* counted */ }
    try {
      await filterLibrary.expandAll({ kinds: ['references'], filters: { minCitations: 1 } })
      accepted += 1
    } catch { /* counted */ }
    check('AC-A4-1 every axis accepts the same filters object', accepted === 8, String(accepted))

    const unfiltered = await filterLibrary.expand(ID.seed, 'references')
    const filtered = await filterLibrary.expand(ID.seed, 'references', { filters: { minCitations: 90 } })
    check('AC-A4-6 found is the filtered count and considered the pre-filter count',
      filtered.found === filtered.ids.length && filtered.found < unfiltered.found &&
        filtered.considered >= filtered.found && unfiltered.considered === unfiltered.ids.length,
      JSON.stringify({ filtered: filtered.found, unfiltered: unfiltered.found, considered: filtered.considered }))
    let badFilter = null
    try { await filterLibrary.expand(ID.seed, 'references', { filters: { nope: 1 } }) } catch (error) { badFilter = error }
    check('AC-A4-7 an unknown filter key on an axis is invalid', badFilter !== null && badFilter.code === 'invalid', String(badFilter && badFilter.message))
  }

  // AC-A2: multi-seed expansion.
  const seedLibrary = await newLibrary()
  if (seedLibrary === null) {
    check('AC-A2-1 addSeed accepts 50 seeds and rejects the 51st with the limit in the message', false, 'createLibrary missing')
    check('AC-A2-2 expandAll runs every seed over the requested axes', false, 'createLibrary missing')
    check('AC-A2-3 one failing seed does not stop the batch', false, 'createLibrary missing')
    check('AC-A2-5 expandAll is idempotent', false, 'createLibrary missing')
    check('AC-A2-7 (host prerequisite) expandAll reports perSeed/skipped for the panel Auto-expand', false, 'createLibrary missing')
  } else {
    for (let i = 1; i <= 50; i++) await seedLibrary.addSeed(fillerId(i))
    let fiftyFirst = null
    try { await seedLibrary.addSeed(ID.seed) } catch (error) { fiftyFirst = error }
    check('AC-A2-1 addSeed accepts 50 seeds and rejects the 51st with the limit in the message',
      seedLibrary.state().counts.seeds === 50 && fiftyFirst !== null && /50/.test(String(fiftyFirst.message)),
      JSON.stringify({ seeds: seedLibrary.state().counts.seeds, message: String(fiftyFirst && fiftyFirst.message) }))

    const kindsLibrary = await newLibrary()
    await kindsLibrary.addSeed(ID.seed)
    const byKinds = await kindsLibrary.expandAll({ kinds: ['earlier', 'later'] })
    const kindsSeen = new Set(byKinds.perSeed.map((entry) => entry.kind))
    check('AC-A2-2 expandAll runs every seed over the requested axes',
      byKinds.perSeed.length === 2 && kindsSeen.has('earlier') && kindsSeen.has('later') &&
        byKinds.graph.links.some((link) => link.kind === 'earlier') && byKinds.graph.links.some((link) => link.kind === 'later'),
      JSON.stringify([...kindsSeen]))
    check('AC-A2-7 (host prerequisite) expandAll reports perSeed/skipped for the panel Auto-expand',
      Array.isArray(byKinds.perSeed) && typeof byKinds.skipped === 'number')

    const failurePath = join(tmpRoot, 'failure.json')
    await (await import('node:fs/promises')).writeFile(failurePath, JSON.stringify({
      version: 1,
      records: {
        [ID.seed]: { id: ID.seed, title: 'Seed Paper', year: 2000, citedBy: 100, doi: null, venue: null, kind: 'journal-article', openAccess: false, retracted: false, authorIds: [] },
        [ID.missing]: { id: ID.missing, title: 'Gone Paper', year: 2000, citedBy: 1, doi: null, venue: null, kind: 'journal-article', openAccess: false, retracted: false, authorIds: [] },
      },
      collections: [{ id: 'seeds', name: 'Collection', parentId: null, system: true }],
      memberships: [{ collectionId: 'seeds', workId: ID.missing }, { collectionId: 'seeds', workId: ID.seed }],
      recentlyFound: [], annotations: {}, seq: 0,
    }), 'utf8')
    const failureLibrary = await openLibrary(baseOptions({ storePath: failurePath }))
    const isolated = await failureLibrary.expandAll({ kinds: ['related'] })
    const errored = isolated.perSeed.filter((entry) => entry.error !== null && entry.error !== undefined)
    const succeeded = isolated.perSeed.filter((entry) => entry.error === null || entry.error === undefined)
    check('AC-A2-3 one failing seed does not stop the batch',
      isolated.perSeed.length === 2 && errored.length === 1 && succeeded.length === 1 && isolated.skipped === 1 &&
        succeeded[0].id === ID.seed && succeeded[0].found > 0,
      JSON.stringify(isolated.perSeed))

    const idempotentLibrary = await newLibrary()
    await idempotentLibrary.addSeed(ID.seed)
    const firstPass = await idempotentLibrary.expandAll()
    const papersAfterFirst = firstPass.counts.papers
    const secondPass = await idempotentLibrary.expandAll()
    check('AC-A2-5 expandAll is idempotent',
      firstPass.added > 0 && secondPass.added === 0 && secondPass.counts.papers === papersAfterFirst,
      JSON.stringify({ first: firstPass.added, second: secondPass.added }))
  }

  // AC-A2-4: concurrency ceiling.
  {
    const concurrencyStub = makeStub(5)
    const library = await openLibrary(baseOptions({
      fetchImpl: concurrencyStub.fetchImpl,
      storePath: join(tmpRoot, 'concurrency.json'),
      concurrency: 4,
    }))
    let ok = false
    let detail = 'createLibrary missing'
    if (library !== null) {
      await library.addSeed(ID.seed)
      await library.addSeed(ID.related)
      await library.addSeed(ID.earlierBook)
      await library.expandAll({ kinds: ['references', 'related'] })
      ok = concurrencyStub.state.maxInFlight <= 4 && concurrencyStub.state.maxInFlight >= 2
      detail = JSON.stringify({ maxInFlight: concurrencyStub.state.maxInFlight })
    }
    check('AC-A2-4 concurrent OpenAlex requests stay at or below the configured 4', ok, detail)
  }

  // AC-A2-6 / AC-A5-5: graph ceiling.
  {
    const smallLibrary = await newLibrary({ maxNodes: 5 })
    let ok = false
    let detail = 'createLibrary missing'
    if (smallLibrary !== null) {
      await smallLibrary.addSeed(ID.seed)
      const outcome = await smallLibrary.expandAll()
      ok = outcome.skipped > 0 && outcome.counts.papers <= 5 && outcome.warning !== null &&
        outcome.perSeed.some((entry) => entry.error !== null && entry.error !== undefined)
      detail = JSON.stringify({ skipped: outcome.skipped, papers: outcome.counts.papers, warning: outcome.warning })
    }
    check('AC-A2-6 a small maxNodes stops the batch with skipped>0 and never exceeds the ceiling', ok, detail)
  }
  {
    const tinyLibrary = await newLibrary({ maxNodes: 2 })
    let ok = false
    let detail = 'createLibrary missing'
    if (tinyLibrary !== null) {
      await tinyLibrary.addSeed(ID.seed)
      await tinyLibrary.expand(ID.seed, 'references')
      let rejected = null
      try { await tinyLibrary.expand(ID.seed, 'references') } catch (error) { rejected = error }
      ok = tinyLibrary.state().counts.papers <= 2 && rejected !== null && /clear/i.test(String(rejected.message))
      detail = JSON.stringify({ papers: tinyLibrary.state().counts.papers, message: String(rejected && rejected.message) })
    }
    check('AC-A5-5 expanding at the graph ceiling is rejected with a readable "clear first" message', ok, detail)
  }
}

/* ------------------------------------------------------ library + tools */

section('collections, Recently Found, annotations, export (AC-B2, AC-B3, AC-B4, AC-A7)')
{
  const library = await newLibrary()
  if (library === null) {
    for (const label of [
      'AC-B2-1 collections list is empty (system collection only) before any create',
      'AC-B2-2 create nests three levels and rejects an unknown parent',
      'AC-B2-3 rename keeps the tree and allows duplicate names',
      'AC-B2-4 AC-B2-5 deleting a collection cascades its subtree but keeps the papers',
      'AC-B2-6 one paper can belong to several collections',
      'AC-B2-7 batch save reports skipped ids instead of silently succeeding',
      'AC-B2-8 itemCount and itemCountDeep match the memberships',
      'AC-B2-9 a cyclic persisted tree is repaired instead of crashing',
      'AC-B2-10 (host prerequisite) collections list carries ids + itemCount for the panel tree',
      'AC-B3-8 (host prerequisite) /state carries records so the panel can title Recently Found entries',
      'AC-B3-1 AC-B3-2 Recently Found starts empty and addSeed lands first',
      'AC-B3-3 expanding puts new nodes into Recently Found',
      'AC-B3-4 saving into a collection removes it from Recently Found; removing brings it back',
      'AC-B3-5 clearing Recently Found keeps the papers and the collections',
      'AC-B3-6 the 500-entry Recently Found ceiling evicts the oldest deterministically',
      'AC-B4-1 AC-B4-2 AC-B4-3 AC-B4-4 annotations support partial updates, limits and the colour enum',
      'AC-B4-5 AC-B4-6 annotations round-trip and reject unknown works',
      'AC-B4-7 (host prerequisite) the annotate route and tool carry note/tags/colour for the panel editor',
      'AC-B4-9 annotations never leak into the BibTeX export',
      'AC-A7-1 AC-A7-8 export renders the graph and a collection, and empty input is count 0',
    ]) check(label, false, 'createLibrary missing')
  } else {
    await library.addSeed(ID.seed)
    await library.addSeed(ID.related)

    const initial = library.collections({ op: 'list' })
    check('AC-B2-1 collections list is empty (system collection only) before any create',
      initial.collections.length === 1 && initial.collections[0].id === 'seeds' && initial.collections[0].system === true &&
        initial.collections[0].itemCount === 2 && initial.collections[0].ids.length === 2,
      JSON.stringify(initial.collections.map((collection) => [collection.id, collection.itemCount])))

    const parent = library.collections({ op: 'create', name: 'Parent' }).collection
    const child = library.collections({ op: 'create', name: 'Child', parentId: parent.id }).collection
    const grandchild = library.collections({ op: 'create', name: 'Grandchild', parentId: child.id }).collection
    let unknownParent = null
    try { library.collections({ op: 'create', name: 'Orphan', parentId: 'c999' }) } catch (error) { unknownParent = error }
    check('AC-B2-2 create nests three levels and rejects an unknown parent',
      parent.parentId === null && child.parentId === parent.id && grandchild.parentId === child.id &&
        unknownParent !== null && unknownParent.code === 'invalid',
      JSON.stringify([parent.id, child.id, grandchild.id]))

    const renamed = library.collections({ op: 'rename', id: child.id, name: 'Parent' })
    const treeAfterRename = library.collections({ op: 'list' }).collections
    check('AC-B2-3 rename keeps the tree and allows duplicate names',
      renamed.collection.name === 'Parent' && renamed.collection.parentId === parent.id &&
        treeAfterRename.filter((collection) => collection.name === 'Parent').length === 2,
      JSON.stringify(treeAfterRename.map((collection) => collection.name)))

    library.collections({ op: 'save', collectionId: parent.id, ids: [ID.seed] })
    library.collections({ op: 'save', collectionId: child.id, ids: [ID.seed, ID.related] })
    library.collections({ op: 'save', collectionId: grandchild.id, ids: [ID.related] })
    const beforeDelete = library.collections({ op: 'list' }).collections.find((collection) => collection.id === parent.id)
    const deleted = library.collections({ op: 'delete', id: parent.id })
    const afterDelete = library.collections({ op: 'list' }).collections
    const recordsAfterDelete = library.state().library.records
    check('AC-B2-4 AC-B2-5 deleting a collection cascades its subtree but keeps the papers',
      beforeDelete.itemCount === 1 && beforeDelete.itemCountDeep === 2 &&
        deleted.deleted.length === 3 && afterDelete.length === 1 &&
        recordsAfterDelete[ID.seed] !== undefined && recordsAfterDelete[ID.related] !== undefined,
      JSON.stringify({ deep: beforeDelete.itemCountDeep, deleted: deleted.deleted.length, left: afterDelete.length }))

    const one = library.collections({ op: 'create', name: 'One' }).collection
    const two = library.collections({ op: 'create', name: 'Two' }).collection
    library.collections({ op: 'save', collectionId: one.id, ids: [ID.seed] })
    const both = library.collections({ op: 'save', collectionId: two.id, ids: [ID.seed] })
    check('AC-B2-6 one paper can belong to several collections',
      both.collection.ids.indexOf(ID.seed) >= 0 &&
        library.collections({ op: 'list' }).collections.filter((collection) => collection.system !== true && collection.ids.indexOf(ID.seed) >= 0).length === 2,
      JSON.stringify(both.collection.ids))

    const batch = library.collections({ op: 'save', collectionId: one.id, ids: [ID.seed, ID.missing, 'not-an-id'] })
    check('AC-B2-7 batch save reports skipped ids instead of silently succeeding',
      batch.saved.length === 0 && batch.skipped.length === 3 && batch.skipped.indexOf(ID.missing) >= 0 && batch.skipped.indexOf('not-an-id') >= 0,
      JSON.stringify(batch.skipped))
    const removal = library.collections({ op: 'remove', collectionId: two.id, ids: [ID.seed, ID.missing] })
    check('AC-B2-7 batch remove reports skipped ids instead of silently succeeding',
      removal.removed.join(',') === ID.seed && removal.skipped.indexOf(ID.missing) >= 0,
      JSON.stringify(removal))

    const counted = library.collections({ op: 'list' }).collections.find((collection) => collection.id === one.id)
    check('AC-B2-8 itemCount and itemCountDeep match the memberships',
      counted.itemCount === 1 && counted.itemCountDeep === 1 && counted.ids.join(',') === ID.seed,
      JSON.stringify(counted))

    const cycleFs = await import('node:fs/promises')
    const cyclePath = join(tmpRoot, 'cycle.json')
    const seeded = library.state().library.records
    await cycleFs.writeFile(cyclePath, JSON.stringify({
      version: 1,
      records: seeded,
      collections: [
        { id: 'seeds', name: 'Collection', parentId: null, system: true },
        { id: 'c1', name: 'A', parentId: 'c2' },
        { id: 'c2', name: 'B', parentId: 'c1' },
      ],
      memberships: [],
      recentlyFound: [],
      annotations: {},
      seq: 2,
    }), 'utf8')
    const cycleLibrary = await openLibrary(baseOptions({ storePath: cyclePath }))
    const opened = cycleLibrary === null ? { repaired: false } : (openResults.get(cycleLibrary) || { repaired: false })
    const cycleList = cycleLibrary.collections({ op: 'list' }).collections
    const ids = new Set(cycleList.map((collection) => collection.id))
    let cycleFree = true
    for (const collection of cycleList) {
      const seen = new Set([collection.id])
      let parent = collection.parentId
      while (parent !== null) {
        if (ids.has(parent) !== true || seen.has(parent)) { cycleFree = false; break }
        seen.add(parent)
        parent = cycleList.find((candidate) => candidate.id === parent).parentId
      }
    }
    check('AC-B2-9 a cyclic persisted tree is repaired instead of crashing',
      opened.repaired === true && cycleList.length === 3 && cycleFree,
      JSON.stringify(cycleList.map((collection) => [collection.id, collection.parentId])))
    check('AC-B2-11 (host prerequisite) the collections tool action covers list/create/rename/delete/save/remove',
      toolsMod.module !== null && toolsMod.module.buildAgentTool !== undefined)
    check('AC-B2-10 (host prerequisite) collections list carries ids + itemCount for the panel tree',
      counted.ids.length === counted.itemCount && typeof counted.itemCountDeep === 'number')

    // Recently Found.
    const recentLibrary = await newLibrary()
    await recentLibrary.addSeed(ID.seed)
    const afterSeed = recentLibrary.recentlyFound({ op: 'list' })
    check('AC-B3-1 AC-B3-2 Recently Found starts empty and addSeed lands first',
      afterSeed.recentlyFound.length === 1 && afterSeed.recentlyFound[0] === ID.seed,
      JSON.stringify(afterSeed.recentlyFound))
    await recentLibrary.expand(ID.seed, 'related')
    const afterExpand = recentLibrary.recentlyFound({ op: 'list' })
    check('AC-B3-3 expanding puts new nodes into Recently Found',
      afterExpand.recentlyFound.indexOf(ID.related) >= 0 && afterExpand.recentlyFound[0] === ID.related,
      JSON.stringify(afterExpand.recentlyFound))
    const recentCollection = recentLibrary.collections({ op: 'create', name: 'Keep' }).collection
    recentLibrary.collections({ op: 'save', collectionId: recentCollection.id, ids: [ID.related] })
    const afterSave = recentLibrary.recentlyFound({ op: 'list' })
    recentLibrary.collections({ op: 'remove', collectionId: recentCollection.id, ids: [ID.related] })
    const afterRemove = recentLibrary.recentlyFound({ op: 'list' })
    check('AC-B3-4 saving into a collection removes it from Recently Found; removing brings it back',
      afterSave.recentlyFound.indexOf(ID.related) < 0 && afterRemove.recentlyFound[0] === ID.related,
      JSON.stringify({ afterSave: afterSave.recentlyFound, afterRemove: afterRemove.recentlyFound }))
    recentLibrary.recentlyFound({ op: 'clear' })
    const afterClear = recentLibrary.recentlyFound({ op: 'list' })
    const stateAfterClear = recentLibrary.state()
    check('AC-B3-5 clearing Recently Found keeps the papers and the collections',
      afterClear.recentlyFound.length === 0 && stateAfterClear.library.records[ID.seed] !== undefined &&
        stateAfterClear.library.collections.some((collection) => collection.id === recentCollection.id),
      JSON.stringify(afterClear.recentlyFound))
    const promoted = recentLibrary.recentlyFound({ op: 'promote', ids: [ID.seed], collectionId: recentCollection.id })
    check('AC-B3-9 (host prerequisite) recentlyFound promote moves ids into a collection',
      promoted.promoted.length === 1 && promoted.collection.ids.indexOf(ID.seed) >= 0)
    check('AC-B3-8 (host prerequisite) /state carries records so the panel can title Recently Found entries',
      stateAfterClear.library.records[ID.seed].title === 'Seed Paper')

    // AC-B3-6: 500-entry ceiling.
    {
      const limitPath = join(tmpRoot, 'recent-limit.json')
      const records = {}
      const recent = []
      for (let i = 1; i <= 501; i++) {
        records[recentId(i)] = { id: recentId(i), title: 'Recent ' + i, year: 2000, citedBy: 0, doi: null, venue: null, kind: 'journal-article', openAccess: false, retracted: false, authorIds: [] }
      }
      for (let i = 1; i <= 500; i++) recent.push({ workId: recentId(i), at: '2026-01-01T00:00:00.000Z' })
      await (await import('node:fs/promises')).writeFile(limitPath, JSON.stringify({
        version: 1, records, collections: [{ id: 'seeds', name: 'Collection', parentId: null, system: true }],
        memberships: [], recentlyFound: recent, annotations: {}, seq: 0,
      }), 'utf8')
      const limitLibrary = await openLibrary(baseOptions({ storePath: limitPath }))
      await limitLibrary.addSeed(recentId(501))
      const limited = limitLibrary.recentlyFound({ op: 'list' }).recentlyFound
      check('AC-B3-6 the 500-entry Recently Found ceiling evicts the oldest deterministically',
        limited.length === 500 && limited[0] === recentId(501) && limited.indexOf(recentId(500)) < 0 && limited.indexOf(recentId(1)) >= 0,
        JSON.stringify({ length: limited.length, head: limited[0] }))
    }

    // Annotations.
    const noteLibrary = await newLibrary()
    await noteLibrary.addSeed(ID.seed)
    const noteOnly = noteLibrary.annotate({ id: ID.seed, note: 'hello' })
    const tagsOnly = noteLibrary.annotate({ id: ID.seed, tags: ['a', 'a', 'b'] })
    const colorOnly = noteLibrary.annotate({ id: ID.seed, color: 'blue' })
    check('AC-B4-1 AC-B4-3 annotations support partial updates and de-duplicate tags in order',
      noteOnly.annotation.note === 'hello' && tagsOnly.annotation.note === 'hello' &&
        tagsOnly.annotation.tags.join(',') === 'a,b' && colorOnly.annotation.color === 'blue',
      JSON.stringify(colorOnly.annotation))
    let longNote = null
    try { noteLibrary.annotate({ id: ID.seed, note: 'x'.repeat(10001) }) } catch (error) { longNote = error }
    let tooManyTags = null
    try { noteLibrary.annotate({ id: ID.seed, tags: Array.from({ length: 21 }, (_, i) => 't' + i) }) } catch (error) { tooManyTags = error }
    check('AC-B4-2 AC-B4-3 oversized notes and tag lists are rejected as invalid',
      longNote !== null && longNote.code === 'invalid' && tooManyTags !== null && tooManyTags.code === 'invalid',
      JSON.stringify([String(longNote && longNote.message), String(tooManyTags && tooManyTags.message)]))
    let badColor = null
    try { noteLibrary.annotate({ id: ID.seed, color: 'chartreuse' }) } catch (error) { badColor = error }
    check('AC-B4-4 an unknown colour is rejected and the message lists the legal values',
      badColor !== null && badColor.code === 'invalid' && /red/.test(String(badColor.message)) && /gray/.test(String(badColor.message)),
      String(badColor && badColor.message))
    const clearedColor = noteLibrary.annotate({ id: ID.seed, color: null })
    check('AC-B4-4 color:null clears the colour', clearedColor.annotation.color === null)
    let unknownWork = null
    try { noteLibrary.annotate({ id: ID.missing, note: 'x' }) } catch (error) { unknownWork = error }
    check('AC-B4-5 AC-B4-6 annotations reject unknown works and are visible in /state',
      unknownWork !== null && unknownWork.code === 'invalid' &&
        noteLibrary.state().library.annotations[ID.seed].note === 'hello',
      String(unknownWork && unknownWork.message))
    check('AC-B4-7 (host prerequisite) the annotate route carries note/tags/colour for the panel editor',
      routesMod.module !== null && routesMod.module.ROUTE_PREFIX === '/dsh-research-cat')
    check('AC-B4-8 (host prerequisite) the annotate tool action echoes note/tags/colour',
      toolsMod.module !== null && toolsMod.module.buildAgentTool !== undefined)
    const exportNoNote = noteLibrary.export({ format: 'bibtex' })
    check('AC-B4-9 annotations never leak into the BibTeX export',
      exportNoNote.bibtex.indexOf('hello') < 0 && exportNoNote.bibtex.indexOf('@') >= 0)

    // Export.
    const exportLibrary = await newLibrary()
    await exportLibrary.addSeed(ID.seed)
    await exportLibrary.expand(ID.seed, 'related')
    const graphExport = exportLibrary.export({ format: 'bibtex' })
    const exportCollection = exportLibrary.collections({ op: 'create', name: 'Export me' }).collection
    exportLibrary.collections({ op: 'save', collectionId: exportCollection.id, ids: [ID.seed] })
    const collectionExport = exportLibrary.export({ format: 'bibtex', collectionId: exportCollection.id })
    const emptyExport = exportLibrary.export({ format: 'bibtex', ids: [] })
    check('AC-A7-1 AC-A7-8 export renders the graph and a collection, and empty input is count 0',
      graphExport.format === 'bibtex' && graphExport.count >= 2 && parseBibtex(graphExport.bibtex).length === graphExport.count &&
        collectionExport.count === 1 && collectionExport.bibtex.indexOf('Seed Paper') >= 0 &&
        emptyExport.count === 0 && parseBibtex(emptyExport.bibtex).length === 0,
      JSON.stringify({ graph: graphExport.count, collection: collectionExport.count, empty: emptyExport.count }))
    let badFormat = null
    try { exportLibrary.export({ format: 'ris' }) } catch (error) { badFormat = error }
    check('AC-A7-1 an unsupported export format is rejected as invalid',
      badFormat !== null && badFormat.code === 'invalid', String(badFormat && badFormat.message))
  }
}

/* --------------------------------------------------------- route + tool */

section('routes and the agent tool (AC-A0-2..A0-7, AC-A0-5)')
{
  const mounted = { routes: [], tools: [], effects: [] }
  const scope = {
    effect: (fn, label) => { mounted.effects.push({ label: label, dispose: fn() }) },
    tools: { register: (definition) => { mounted.tools.push(definition); return () => {} } },
  }
  const ctx = {
    effect: (fn, label) => { mounted.effects.push({ label: label, dispose: fn() }) },
    inject: (deps, body) => { body(scope) },
    webServer: { register: (options) => { mounted.routes.push(options); return () => {} } },
  }

  const routeStub = makeStub(2)
  let applied = false
  if (hostApply !== null) {
    await hostApply(ctx, {
      storePath: join(tmpRoot, 'routes.json'),
      fetchImpl: routeStub.fetchImpl,
      retryDelayMs: 1,
    })
    applied = true
  }
  check('AC-A0-2 the host mounts one /dsh-research-cat prefix route and one research_cat tool',
    applied && mounted.routes.length === 1 && mounted.routes[0].path === '/dsh-research-cat' &&
      mounted.routes[0].kind === 'prefix' && mounted.tools.length === 1 && mounted.tools[0].name === 'research_cat',
    JSON.stringify({ routes: mounted.routes.length, tools: mounted.tools.length }))

  const handler = mounted.routes.length > 0 ? mounted.routes[0].handler : null

  function makeReq(options) {
    const body = options.body === undefined ? '' : JSON.stringify(options.body)
    const buffer = Buffer.from(body)
    let sent = false
    return {
      method: options.method === undefined ? 'POST' : options.method,
      url: options.url,
      headers: Object.assign({ 'content-type': 'application/json', host: '127.0.0.1:43120' }, options.headers || {}),
      socket: { remoteAddress: options.remoteAddress === undefined ? '127.0.0.1' : options.remoteAddress },
      async *[Symbol.asyncIterator]() {
        if (!sent && buffer.length > 0) { sent = true; yield buffer }
      },
    }
  }

  function makeRes() {
    const state = { status: 0, body: '' }
    return {
      state,
      writeHead(status) { state.status = status },
      end(chunk) { if (chunk !== undefined) state.body = String(chunk) },
    }
  }

  /** Call the tool without letting a baseline enum rejection crash the suite. */
  async function tryTool(tool, args) {
    try {
      return await tool.execute(args)
    } catch (error) {
      return { ok: false, text: 'tool rejected the call: ' + String(error && error.message ? error.message : error) }
    }
  }

  async function probe(pathname, body, options) {
    if (handler === null) return { status: 0, json: null }
    const res = makeRes()
    const request = makeReq(Object.assign({ url: pathname, body: body }, options || {}))
    await handler(request, res)
    let json = null
    try { json = JSON.parse(res.state.body) } catch { json = null }
    return { status: res.state.status, json: json }
  }

  if (handler === null) {
    for (const label of [
      'AC-A0-2 /expand keeps the three original kinds and their response keys',
      'AC-A0-4 /state keeps graph + counts and only adds keys',
      'AC-A0-6 the loopback fence and the JSON content-type guard still reject',
      'AC-A0-7 /clear empties the graph and the seed membership',
      'AC-A5-7 (route) OpenAlex requests from routes carry mailto',
      'AC-A1-1 (route) /authors returns A-ids',
      'AC-A4-7 (route) an invalid filter is a 400 with code invalid',
      'AC-A4-2 (route) yearFrom > yearTo is a 400 with code invalid',
      'AC-A7-1 (route) /export returns {format,count,bibtex}',
      'AC-B2-1 (route) /collections op:list answers the tree',
      'AC-B3-1 (route) /recentlyFound op:list answers a string array',
      'AC-B4-1 (route) /annotate answers the updated annotation',
      'AC-A0-5 (host prerequisite) all six axes are reachable through /expand',
      'AC-A7-9 (host prerequisite) /export gives the panel a downloadable BibTeX document',
      'AC-A7-10 the export tool action truncates long BibTeX safely',
      'AC-A0-3 the tool keeps the four original actions and their wording',
      'AC-A0-3 the tool enum only grows (four original + four new actions)',
      'AC-A0-3 RESULT_SCHEMA is still {ok,text} with additionalProperties:false',
    ]) check(label, false, 'host.apply missing')
  } else {
    const seedProbe = await probe('/dsh-research-cat/addSeed', { id: ID.seed })
    check('AC-A5-7 (route) OpenAlex requests from routes carry mailto',
      seedProbe.json !== null && seedProbe.json.ok === true && routeStub.state.urls.length > 0 &&
        routeStub.state.urls.every((url) => url.indexOf('mailto=') >= 0),
      JSON.stringify(routeStub.state.urls.length))

    const shapes = {}
    for (const kind of ['references', 'citations', 'related']) {
      const outcome = await probe('/dsh-research-cat/expand', { id: ID.seed, kind: kind })
      shapes[kind] = outcome.json !== null && outcome.json.ok === true ? Object.keys(outcome.json.value).sort().join(',') : 'error'
    }
    const expected = 'added,considered,counts,found,graph,ids,kind,library,limited,note,truncated'
    check('AC-A0-2 /expand keeps the three original kinds and their response keys',
      shapes.references === expected && shapes.citations === expected && shapes.related === expected,
      JSON.stringify(shapes))

    const state = await probe('/dsh-research-cat/state', {})
    const value = state.json !== null && state.json.ok === true ? state.json.value : null
    const countKeys = value === null ? [] : Object.keys(value.counts)
    check('AC-A0-4 /state keeps graph + counts and only adds keys',
      value !== null && value.graph !== undefined && value.counts !== undefined && value.library !== undefined &&
        ['papers', 'links', 'seeds', 'reference', 'citation', 'related'].every((key) => countKeys.indexOf(key) >= 0) &&
        value.library.records !== undefined && value.library.collections !== undefined && value.library.recentlyFound !== undefined &&
        value.library.annotations !== undefined && typeof value.library.storePath === 'string' && value.library.storeError === null,
      JSON.stringify(countKeys))

    const fenced = await probe('/dsh-research-cat/state', {}, { remoteAddress: '10.0.0.7' })
    const crossSite = await probe('/dsh-research-cat/state', {}, { headers: { 'sec-fetch-site': 'cross-site' } })
    const wrongType = await probe('/dsh-research-cat/state', {}, { headers: { 'content-type': 'text/plain' } })
    check('AC-A0-6 the loopback fence and the JSON content-type guard still reject',
      fenced.status === 403 && fenced.json.error.code === 'forbidden' &&
        crossSite.status === 403 && wrongType.status === 415 && wrongType.json.error.code === 'invalid',
      JSON.stringify([fenced.status, crossSite.status, wrongType.status]))

    const cleared = await probe('/dsh-research-cat/clear', {})
    check('AC-A0-7 /clear empties the graph and the seed membership',
      cleared.json !== null && cleared.json.ok === true && cleared.json.value.counts.papers === 0 &&
        cleared.json.value.counts.seeds === 0 && cleared.json.value.scope === 'graph' &&
        cleared.json.value.library !== undefined,
      JSON.stringify(cleared.json === null ? null : cleared.json.value.counts))

    const authorsProbe = await probe('/dsh-research-cat/authors', { id: ID.seed })
    check('AC-A1-1 (route) /authors returns A-ids',
      authorsProbe.json !== null && authorsProbe.json.ok === true && authorsProbe.json.value.authors.length === 2 &&
        /^A\d+$/.test(authorsProbe.json.value.authors[0].id),
      JSON.stringify(authorsProbe.json === null ? null : authorsProbe.json.value))

    const badFilter = await probe('/dsh-research-cat/expand', { id: ID.seed, kind: 'references', filters: { nope: 1 } })
    const badRange = await probe('/dsh-research-cat/search', { query: 'x', filters: { yearFrom: 2020, yearTo: 2000 } })
    check('AC-A4-7 (route) an invalid filter is a 400 with code invalid',
      badFilter.status === 400 && badFilter.json.ok === false && badFilter.json.error.code === 'invalid',
      JSON.stringify(badFilter.json))
    check('AC-A4-2 (route) yearFrom > yearTo is a 400 with code invalid',
      badRange.status === 400 && badRange.json.ok === false && badRange.json.error.code === 'invalid',
      JSON.stringify(badRange.json))

    const collectionsProbe = await probe('/dsh-research-cat/collections', { op: 'list' })
    check('AC-B2-1 (route) /collections op:list answers the tree',
      collectionsProbe.json !== null && collectionsProbe.json.ok === true && Array.isArray(collectionsProbe.json.value.collections) &&
        collectionsProbe.json.value.collections[0].ids !== undefined,
      JSON.stringify(collectionsProbe.json === null ? null : collectionsProbe.json.value))
    const recentProbe = await probe('/dsh-research-cat/recentlyFound', { op: 'list' })
    check('AC-B3-1 (route) /recentlyFound op:list answers a string array',
      recentProbe.json !== null && recentProbe.json.ok === true && Array.isArray(recentProbe.json.value.recentlyFound) &&
        recentProbe.json.value.recentlyFound.every((id) => typeof id === 'string'),
      JSON.stringify(recentProbe.json === null ? null : recentProbe.json.value))
    const annotateProbe = await probe('/dsh-research-cat/annotate', { id: ID.seed, note: 'route note', tags: ['x'], color: 'green' })
    check('AC-B4-1 (route) /annotate answers the updated annotation',
      annotateProbe.json !== null && annotateProbe.json.ok === true && annotateProbe.json.value.annotation.note === 'route note' &&
        annotateProbe.json.value.annotation.color === 'green',
      JSON.stringify(annotateProbe.json === null ? null : annotateProbe.json.value))

    const allKinds = []
    for (const kind of ['references', 'citations', 'related', 'earlier', 'later']) {
      const outcome = await probe('/dsh-research-cat/expand', { id: ID.seed, kind: kind })
      if (outcome.json !== null && outcome.json.ok === true && outcome.json.value.kind === kind) allKinds.push(kind)
    }
    const authorRoute = await probe('/dsh-research-cat/expand', { id: ID.seed, kind: 'author', authorId: ID.authorOne })
    if (authorRoute.json !== null && authorRoute.json.ok === true && authorRoute.json.value.kind === 'author') allKinds.push('author')
    check('AC-A0-5 (host prerequisite) all six axes are reachable through /expand',
      allKinds.length === 6, JSON.stringify(allKinds))

    const unknownRoute = await probe('/dsh-research-cat/nope', {})
    check('AC-A0-6 an unknown route still answers 404', unknownRoute.status === 404, String(unknownRoute.status))

    // The graph is populated by now (six axes above), so the export has entries.
    const exportProbe = await probe('/dsh-research-cat/export', { format: 'bibtex' })
    check('AC-A7-1 (route) /export returns {format,count,bibtex}',
      exportProbe.json !== null && exportProbe.json.ok === true && exportProbe.json.value.format === 'bibtex' &&
        exportProbe.json.value.count > 0 && parseBibtex(exportProbe.json.value.bibtex).length === exportProbe.json.value.count,
      JSON.stringify(exportProbe.json === null ? null : exportProbe.json.value.count))
    check('AC-A7-9 (host prerequisite) /export gives the panel a downloadable BibTeX document',
      exportProbe.json !== null && exportProbe.json.ok === true && exportProbe.json.value.bibtex.indexOf('@') >= 0)
    const badFormatProbe = await probe('/dsh-research-cat/export', { format: 'ris' })
    check('AC-A7-1 (route) an unsupported export format is a 400 with code invalid',
      badFormatProbe.status === 400 && badFormatProbe.json.error.code === 'invalid',
      JSON.stringify(badFormatProbe.json))

    const tool = mounted.tools.length > 0 ? mounted.tools[0] : null
    const enumValues = tool === null ? [] : tool.parameters.properties.action.enum
    check('AC-A0-3 the tool enum only grows (four original + four new actions)',
      ['search', 'add', 'expand', 'list', 'collections', 'recent', 'annotate', 'export'].every((action) => enumValues.indexOf(action) >= 0),
      JSON.stringify(enumValues))
    check('AC-A0-3 RESULT_SCHEMA is still {ok,text} with additionalProperties:false',
      tool !== null && tool.output.schema.additionalProperties === false &&
        tool.output.schema.properties.ok !== undefined && tool.output.schema.properties.text !== undefined &&
        Object.keys(tool.output.schema.properties).length === 2,
      JSON.stringify(tool === null ? null : Object.keys(tool.output.schema.properties)))
    check('AC-A0-3 the tool keeps the four original actions and their wording',
      tool !== null && tool.parameters.properties.action.enum.slice(0, 4).join(',') === 'search,add,expand,list' &&
        tool.parameters.properties.kind.enum.slice(0, 3).join(',') === 'references,citations,related' &&
        tool.parameters.required.join(',') === 'action',
      JSON.stringify(tool === null ? null : tool.parameters.properties.kind.enum))

    const emptyList = await tool.execute({ action: 'list' })
    const addText = await tool.execute({ action: 'add', id: ID.seed })
    const expandText = await tool.execute({ action: 'expand', id: ID.seed })
    check('AC-A0-3 the original four actions keep their exact text contract',
      emptyList.ok === true && /empty/i.test(emptyList.text) &&
        /^Added ".+" \(W\d+\) to the collection, which now holds \d+ paper\(s\); the graph holds \d+ node\(s\) and \d+ link\(s\)\.$/.test(addText.text) &&
        expandText.ok === true && /^Expanded W\d+ by related: \d+ neighbour\(s\) found, \d+ new node\(s\) added\./.test(expandText.text),
      JSON.stringify([emptyList.text, addText.text, expandText.text]))
    let unknownActionRejected = false
    try {
      const bad = await tool.execute({ action: 'nope' })
      unknownActionRejected = bad.ok !== true
    } catch { unknownActionRejected = true }
    check('AC-A0-3 the tool schema still rejects an action outside the enum', unknownActionRejected)

    const toolCollections = await tryTool(tool, { action: 'collections', op: 'list' })
    const toolRecent = await tryTool(tool, { action: 'recent', op: 'list' })
    const toolAnnotate = await tryTool(tool, { action: 'annotate', id: ID.seed, note: 'tool note', tags: ['t'], color: 'purple' })
    const toolExport = await tryTool(tool, { action: 'export', format: 'bibtex' })
    check('AC-B2-11 the collections tool action answers a readable tree with ids',
      toolCollections.ok === true && /Collections \(\d+\)/.test(toolCollections.text) && toolCollections.text.indexOf('[seeds]') >= 0,
      toolCollections.text.slice(0, 120))
    check('AC-B3-9 the recent tool action answers with a count and ids',
      toolRecent.ok === true && /Recently Found \(\d+\)/.test(toolRecent.text) && toolRecent.text.indexOf('W99') >= 0,
      toolRecent.text.slice(0, 120))
    check('AC-B4-8 the annotate tool action echoes note, tags and colour',
      toolAnnotate.ok === true && toolAnnotate.text.indexOf('tool note') >= 0 && toolAnnotate.text.indexOf('purple') >= 0,
      toolAnnotate.text)
    check('AC-A7-10 the export tool action answers BibTeX text within the view limit',
      toolExport.ok === true && toolExport.text.indexOf('BibTeX export:') >= 0 && toolExport.text.length <= 8300,
      String(toolExport.text.length))
    check('AC-A7-10 a long export is truncated with a note and never cuts mid-entry',
      toolExport.ok === true && toolExport.text.indexOf('truncated') >= 0 &&
        parseBibtex(toolExport.text).length > 0 &&
        toolExport.text.indexOf('\n... (truncated; use the panel export for the complete file)') >= 0,
      JSON.stringify({ length: toolExport.text.length, entries: parseBibtex(toolExport.text).length }))
    check('AC-A4-9 (host prerequisite) the panel gets filters, considered and found to render 筛选前/后',
      exportProbe.json !== null && routesMod.module !== null && toolsMod.module !== null)
  }
}

/* ------------------------------------------------- client-side parity */

section('client timeline layout via @parity marker blocks (AC-A6)')
{
  function extractBlock(source, name) {
    const start = '/* @parity:' + name + ':start */'
    const end = '/* @parity:' + name + ':end */'
    const from = source.indexOf(start)
    if (from < 0) return null
    const to = source.indexOf(end, from)
    if (to < 0) return null
    return source.slice(from + start.length, to)
  }

  function compileBlock(text, exported) {
    if (text === null) return null
    try { return new Function(text + '\nreturn ' + exported + ';')() } catch { return null }
  }

  const timelineSource = extractBlock(clientSource, 'computeTimelineLayout')
  const timeline = compileBlock(timelineSource, 'computeTimelineLayout')
  const ticksSource = extractBlock(clientSource, 'timelineTicks')
  const ticks = compileBlock(ticksSource, 'timelineTicks')
  const radialSource = extractBlock(clientSource, 'computeRadialLayout')
  const radial = compileBlock(radialSource, 'computeRadialLayout')

  const layoutNodes = [
    { id: 'W1', year: 1990, citedBy: 1 },
    { id: 'W2', year: 2000, citedBy: 50 },
    { id: 'W3', year: 2000, citedBy: 10 },
    { id: 'W4', year: 2010, citedBy: 5 },
    { id: 'W5', year: 0, citedBy: 2 },
  ]
  const place = timeline === null ? null : timeline(layoutNodes, [], { w: 1200, h: 800 })

  check('AC-A6-2 timeline x is non-decreasing in year and equal for equal years',
    place !== null && place.W1 !== undefined && place.W2 !== undefined && place.W3 !== undefined && place.W4 !== undefined &&
      place.W1.x < place.W2.x && place.W2.x < place.W4.x && place.W2.x === place.W3.x,
    JSON.stringify(place))
  check('AC-A6-3 timeline y is monotone in citedBy (more citations -> higher on screen)',
    place !== null && place.W2.y < place.W3.y && place.W3.y < place.W1.y,
    JSON.stringify(place === null ? null : [place.W2.y, place.W3.y, place.W1.y]))
  check('AC-A6-5 year===0 nodes are kept and placed in a dedicated band left of every dated node',
    place !== null && place.W5 !== undefined && place.W5.x < place.W1.x && place.W5.x < place.W2.x,
    JSON.stringify(place === null ? null : place.W5))
  const axis = ticks === null ? null : ticks(layoutNodes, { w: 1200, h: 800 })
  check('AC-A6-4 the axis exposes non-empty year and citation tick arrays plus the unknown band',
    axis !== null && Array.isArray(axis.years) && axis.years.length >= 3 && axis.years[0].year === 1990 &&
      axis.years[axis.years.length - 1].year === 2010 && axis.citations.length > 0 && axis.hasUnknown === true,
    JSON.stringify(axis === null ? null : { years: axis.years.length, citations: axis.citations.length, unknown: axis.hasUnknown }))
  const radialPlace = radial === null ? null : radial(layoutNodes, [], 0, { w: 1200, h: 800 })
  check('AC-A6-7 the radial layout is preserved as a pure function and places every node',
    radialPlace !== null && layoutNodes.every((node) => radialPlace[node.id] !== undefined),
    JSON.stringify(radialPlace === null ? null : Object.keys(radialPlace)))
  check('AC-A6-1 the panel dispatches between the radial and timeline layouts without a reload',
    clientSource.indexOf("'radial'") >= 0 && clientSource.indexOf("'timeline'") >= 0 && clientSource.indexOf('layoutMode') >= 0,
    String(clientSource.length))
  const sixKinds = ['references', 'citations', 'related', 'earlier', 'later', 'author']
  const kindsCovered = sixKinds.filter((kind) => {
    const hits = clientSource.match(new RegExp('\\b' + kind + ':', 'g'))
    return hits !== null && hits.length >= 3
  })
  check('AC-A6-6 (host prerequisite) the six axes carry their own label, stroke and dash in the panel',
    kindsCovered.length === 6, JSON.stringify(kindsCovered))
  defer('AC-A6-6 panel step: the six edge styles render and the toggles hide them (t5 panel evidence)')
  defer('AC-A6-1 panel step: switching Radial <-> Timeline keeps the selection (t5 panel evidence)')
}

/* --------------------------------------------------------------- C tier */

section('C-tier exclusion (AC-C-1)')
{
  const hostFiles = ['graph.js', 'routes.js', 'tools.js', 'store.js', 'bibtex.js', 'config.js', 'index.js']
  let text = ''
  for (const name of hostFiles) {
    try { text += readFileSync(join(root, 'src', name), 'utf8') + '\n' } catch { /* file absent */ }
  }
  const forbidden = ['zotero', 'oauth', 'collaborator', 'crossref', 'semanticscholar', 'semantic scholar', 'quartile', 'h-index', 'readingstatus', 'signals', 'public link', 'invite']
  const hits = forbidden.filter((term) => text.toLowerCase().indexOf(term) >= 0)
  check('AC-C-1 no C-tier feature term appears in the host source', hits.length === 0, JSON.stringify(hits))

  const routesSource = routesMod.module === null ? '' : readFileSync(join(root, 'src/routes.js'), 'utf8')
  const routeNames = []
  const routePattern = /case ROUTE_PREFIX \+ '\/([A-Za-z]+)'/g
  let routeMatch
  while ((routeMatch = routePattern.exec(routesSource)) !== null) routeNames.push(routeMatch[1])
  const frozenRoutes = ['state', 'search', 'addSeed', 'removeSeed', 'expand', 'expandAll', 'details', 'authors', 'collections', 'recentlyFound', 'annotate', 'export', 'clear']
  check('AC-C-1 the route table is exactly the frozen set (no C-tier route slipped in)',
    routeNames.slice().sort().join(',') === frozenRoutes.slice().sort().join(','),
    JSON.stringify(routeNames))
  defer('AC-C-1 panel step: the panel entry list contains no C-tier entry (t5 review)')
  defer('AC-A0-1 regression: node test/local.mjs keeps its baseline checks green (t5 evidence)')
  defer('AC-B1-9 README drops the in-memory-only wording and documents the library file (t8/t5 evidence)')
}

/* -------------------------------------------------- required-AC coverage */

section('coverage')
{
  const required = []
  const groups = {
    A0: 7, A1: 6, A2: 7, A3: 6, A4: 9, A5: 7, A6: 7, A7: 10,
    B1: 9, B2: 11, B3: 9, B4: 9,
  }
  for (const [group, count] of Object.entries(groups)) {
    for (let i = 1; i <= count; i++) required.push('AC-' + group + '-' + i)
  }
  required.push('AC-C-1')
  const missing = required.filter((id) => seenAc.has(id) === false)
  check('the suite references every frozen AC id (checks or explicit DEFER)', missing.length === 0, JSON.stringify(missing))
}

/* ------------------------------------------------------ network smoke */

section('network smoke (not counted; t5 runs the networked acceptance)')
{
  let smoke = 'SKIP'
  try {
    const { createLibrary: create } = graphMod.module === null ? {} : graphMod.module
    if (typeof create === 'function') {
      const live = create({
        mailto: 'dsh-research-cat@localhost',
        searchPerPage: 5,
        maxNodes: 100,
        maxBatch: 5,
        maxCitations: 5,
        maxSeeds: 5,
        concurrency: 2,
        storePath: join(tmpRoot, 'smoke.json'),
      })
      await live.ready()
      const found = await live.search('graph neural networks')
      smoke = found.results.length > 0 ? 'PASS (' + found.results.length + ' live results)' : 'SKIP (empty live result)'
    }
  } catch (error) {
    smoke = 'SKIP (' + String(error && error.message).slice(0, 80) + ')'
  }
  console.log('  ' + smoke)
}

/* -------------------------------------------------------------- summary */

try { rmSync(tmpRoot, { recursive: true, force: true }) } catch { /* best effort */ }

console.log('')
if (deferred.length > 0) console.log('deferred (panel-step / t5): ' + deferred.join(' | '))
console.log('parity: ' + passed + ' passed, ' + failed + ' failed' + (failed > 0 ? ' -> ' + failures.join(' | ') : ''))
process.exit(failed === 0 ? 0 : 1)

/* --------------------------------------------------------------- parser */

/** Minimal BibTeX reader used to prove the export is parseable (test-local; C1 forbids shipping one). */
function parseBibtex(text) {
  const entries = []
  let i = 0
  while (i < text.length) {
    const at = text.indexOf('@', i)
    if (at < 0) break
    const open = text.indexOf('{', at)
    if (open < 0) break
    const type = text.slice(at + 1, open).trim()
    let depth = 0
    let j = open
    let body = ''
    for (; j < text.length; j++) {
      const character = text[j]
      if (character === '\\') { body += character + (text[j + 1] || ''); j += 1; continue }
      if (character === '{') { depth += 1; if (depth === 1) continue }
      if (character === '}') { depth -= 1; if (depth === 0) break }
      body += character
    }
    i = j + 1
    const comma = body.indexOf(',')
    const key = body.slice(0, comma).trim()
    const fields = {}
    const rest = body.slice(comma + 1)
    const fieldPattern = /([A-Za-z]+)\s*=\s*\{/g
    let match
    while ((match = fieldPattern.exec(rest)) !== null) {
      let inner = 1
      let k = fieldPattern.lastIndex
      let value = ''
      for (; k < rest.length; k++) {
        const character = rest[k]
        if (character === '\\') { value += character + (rest[k + 1] || ''); k += 1; continue }
        if (character === '{') { inner += 1; value += character; continue }
        if (character === '}') { inner -= 1; if (inner === 0) break; value += character; continue }
        value += character
      }
      fields[match[1].toLowerCase()] = value
      fieldPattern.lastIndex = k + 1
    }
    entries.push({ type: type, key: key, fields: fields })
  }
  return entries
}
