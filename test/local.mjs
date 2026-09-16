// Local verification for dsh-research-cat before it is mounted into a profile.
//
//   node test/local.mjs
//
// 1. Loader contract: the client artifact must call window.__ModuleLoader__.load
//    exactly once, and its factory must return a plugin with name/inject/apply —
//    the same contract the shipped dsh-community-market verifier enforces.
// 2. Engine: createLibrary() talks to the live OpenAlex API (search, add,
//    expand, dedup, clear) with no harness around it.
// 3. Config: defaults and overrides.
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

let failures = 0
function check(label, condition, detail) {
  if (condition) {
    console.log('  PASS ' + label)
  } else {
    failures++
    console.log('  FAIL ' + label + (detail === undefined ? '' : ' -> ' + detail))
  }
}

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
check('config defaults', defaults.exposeTool === true && defaults.maxNodes === 400 && defaults.maxBatch === 30 && defaults.maxCitations === 25, JSON.stringify(defaults))
const overridden = resolveConfig({ exposeTool: false, mailto: 'a@b.c', maxNodes: 12, maxBatch: 'x' })
check('config overrides + bad values fall back',
  overridden.exposeTool === false && overridden.mailto === 'a@b.c' && overridden.maxNodes === 12 && overridden.maxBatch === 30,
  JSON.stringify(overridden))

/* ---------------------------------------------------------------- engine */

const { createLibrary, uniqueWorkIds } = await import(resolve(root, 'src/graph.js'))
check('uniqueWorkIds normalises and de-duplicates',
  uniqueWorkIds(['https://openalex.org/W1', 'W1', 'W2', 'bad'], 10).join(',') === 'W1,W2')

const library = createLibrary(defaults)
const SEED = 'W2907492528'
check('fresh state is empty', library.state().counts.papers === 0)

let search
try {
  search = await library.search('graph neural networks')
  check('search returns OpenAlex matches', search.results.length > 0, String(search.results.length))
  check('search results carry work ids', /^W\d+$/.test(search.results[0].id), search.results[0].id)
} catch (error) {
  check('search reaches OpenAlex', false, String(error && error.message))
}

try {
  await library.search('   ')
  check('blank query is rejected', false, 'no throw')
} catch (error) {
  check('blank query is rejected', /Type a title/.test(String(error.message)), String(error.message))
}

const added = await library.addSeed(SEED)
check('addSeed collects the paper', added.counts.seeds === 1 && added.record.title.length > 0, JSON.stringify(added.counts))
check('addSeed reports the record', added.record.id === SEED, added.record.id)

const refs = await library.expand(SEED, 'references')
check('expand pulls references', refs.found > 0 && refs.added > 0, JSON.stringify(refs.counts))
check('expand respects the batch cap', refs.found <= defaults.maxBatch, String(refs.found))

const again = await library.expand(SEED, 'references')
check('re-expanding adds nothing (dedup)', again.added === 0 && again.counts.papers === refs.counts.papers, JSON.stringify(again.counts))

const cites = await library.expand(SEED, 'citations')
check('expand pulls citing papers', cites.found > 0 && cites.found <= defaults.maxCitations, String(cites.found))

const detail = await library.details(SEED)
check('details returns authors + abstract', Array.isArray(detail.paper.authors) && detail.paper.authors.length > 0, JSON.stringify(detail.paper.authors.slice(0, 2)))
check('details reconstructs the abstract', typeof detail.paper.abstract === 'string' && detail.paper.abstract.length > 50, String(detail.paper.abstract.length))

const state = library.state()
check('state snapshots nodes and links', state.counts.papers > 1 && state.counts.links > 1 && state.graph.seeds.includes(SEED), JSON.stringify(state.counts))

const removed = library.removeSeed(SEED)
check('removeSeed drops the seed and its exclusive neighbours', !removed.graph.seeds.includes(SEED) && removed.counts.papers < state.counts.papers, JSON.stringify(removed.counts))

const cleared = library.clear()
check('clear empties everything', cleared.counts.papers === 0 && cleared.counts.seeds === 0, JSON.stringify(cleared.counts))

try {
  await library.expand('nonsense', 'references')
  check('bad work id is rejected', false, 'no throw')
} catch (error) {
  check('bad work id is rejected', /needs an OpenAlex work id/.test(String(error.message)), String(error.message))
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
await host.apply(fakeCtx, { exposeTool: true, mailto: 'x@y.z', maxNodes: 400, maxBatch: 30, maxCitations: 25 })

const tool = mounted.find((entry) => entry.kind === 'tool')
check('apply registers exactly one agent tool', mounted.filter((e) => e.kind === 'tool').length === 1)
check('tool is named research_cat', tool !== undefined && tool.def.name === 'research_cat', tool && tool.def.name)
check('tool exposes the four actions',
  tool !== undefined && tool.def.parameters.properties.action.enum.join(',') === 'search,add,expand,list',
  tool && JSON.stringify(tool.def.parameters.properties.action.enum))
check('action is a required parameter',
  tool !== undefined && tool.def.parameters.required.includes('action'),
  tool && JSON.stringify(tool.def.parameters.required))

const route = mounted.find((entry) => entry.kind === 'route')
check('apply registers one route prefix', route !== undefined && route.options.kind === 'prefix', JSON.stringify(route && route.options.kind))
check('route path is the one the panel calls', route !== undefined && route.options.path === '/dsh-research-cat', route && route.options.path)
check('route handler is callable', route !== undefined && typeof route.options.handler === 'function')

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

// exposeTool: false must skip the tool entirely.
mounted.length = 0
scope.tools.register = (def) => { mounted.push({ kind: 'tool', def: def }); return () => {} }
await host.apply(fakeCtx, { exposeTool: false })
check('exposeTool:false registers no tool', mounted.filter((e) => e.kind === 'tool').length === 0)
check('exposeTool:false still registers the routes', mounted.filter((e) => e.kind === 'route').length === 1)

console.log(failures === 0 ? '\nlocal: all checks passed' : '\nlocal: ' + failures + ' check(s) FAILED')
process.exit(failures === 0 ? 0 : 1)
