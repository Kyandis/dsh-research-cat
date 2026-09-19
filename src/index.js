/**
 * dsh-research-cat — Research Cat, a citation-network explorer for the DeepSeek
 * Harness web GUI.
 *
 * Host half: the `research_cat` agent tool and the /dsh-research-cat JSON
 * routes the panel calls. One library serves both, so a paper the agent adds
 * shows up in the panel and vice versa.
 *
 * The library (collections, Recently Found, notes, metadata cache) is persisted
 * to `${DSH_HOME:-$HOME/.dsh}/research-cat/library.json`; the exploration graph
 * itself stays in memory, so after a restart the library is back and the graph
 * is empty.
 *
 * The browser half (`exports["./client"]`) registers the sidebar entry and the
 * centre-column panel.
 *
 * Function plugin — no default export (the Loader unwraps
 * `exports.default ?? exports`).
 *
 * @module dsh-research-cat
 */

import { resolveConfig } from './config.js'
import { createLibrary } from './graph.js'
import { registerResearchCatRoutes } from './routes.js'
import { buildAgentTool } from './tools.js'

/** Plugin name: matches the package name, the composition row id, and the client module id. */
export const name = 'dsh-research-cat'

/** Hard services: the tool registry and the web server. */
export const inject = ['tools', 'webServer']

export { resolveConfig, DEFAULT_MAILTO, DEFAULT_SEARCH_PER_PAGE, DEFAULT_MAX_SEEDS, DEFAULT_CONCURRENCY } from './config.js'
export { createLibrary, uniqueWorkIds, chunkIds, applyFilters, normalizeFilters, messageOf, EXPAND_KINDS, FILTER_KEYS, COLOR_CHOICES } from './graph.js'
export { registerResearchCatRoutes, ROUTE_PREFIX } from './routes.js'
export { buildAgentTool } from './tools.js'
export { createStore, defaultStorePath, dshHomeDir, resolveStorePath, emptyLibrary, STORE_VERSION, SEEDS_ID } from './store.js'
export { bibtexOf, bibtexTypeOf, escapeLatex, citationKeyOf } from './bibtex.js'

/**
 * Mount the plugin: load the library, then the panel routes and the agent tool.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - context carrying tools + webServer.
 * @param {unknown} config - raw loader config; defaults applied through `resolveConfig`.
 * @returns {Promise<void>} resolves once mounted.
 */
export async function apply(ctx, config) {
  const raw = typeof config === 'object' && config !== null ? config : {}
  const resolved = resolveConfig(config)
  // Test seams only: they never come from resolveConfig, so the frozen config
  // key set (spec §6.3) stays exactly nine keys.
  const library = createLibrary({
    ...resolved,
    fetchImpl: typeof raw.fetchImpl === 'function' ? raw.fetchImpl : undefined,
    fs: raw.fs !== undefined && raw.fs !== null ? raw.fs : undefined,
    retryDelayMs: typeof raw.retryDelayMs === 'number' ? raw.retryDelayMs : undefined,
  })
  await library.ready()

  const disposeRoutes = registerResearchCatRoutes(ctx, library)
  ctx.effect(() => () => disposeRoutes(), 'dsh-research-cat: /dsh-research-cat routes')
  ctx.effect(() => () => { void library.flush() }, 'dsh-research-cat: flush the library on dispose')

  if (resolved.exposeTool) {
    ctx.inject(['tools'], (scope) => {
      scope.effect(() => {
        const dispose = scope.tools.register(buildAgentTool(library))
        return () => dispose()
      }, 'dsh-research-cat: research_cat tool')
    })
  }
}
