/**
 * dsh-research-cat — Research Cat, a citation-network explorer for the DeepSeek
 * Harness web GUI.
 *
 * Host half: the `research_cat` agent tool and the /dsh-research-cat JSON
 * routes the panel calls. One in-memory library serves both, so a paper the
 * agent adds shows up in the panel and vice versa.
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

export { resolveConfig, DEFAULT_MAILTO } from './config.js'
export { createLibrary, uniqueWorkIds, messageOf } from './graph.js'
export { registerResearchCatRoutes, ROUTE_PREFIX } from './routes.js'
export { buildAgentTool } from './tools.js'

/**
 * Mount the plugin: the panel routes, then the agent tool.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - context carrying tools + webServer.
 * @param {unknown} config - raw loader config; defaults applied through `resolveConfig`.
 * @returns {Promise<void>} resolves once mounted.
 */
export async function apply(ctx, config) {
  const resolved = resolveConfig(config)
  const library = createLibrary(resolved)

  const disposeRoutes = registerResearchCatRoutes(ctx, library)
  ctx.effect(() => () => disposeRoutes(), 'dsh-research-cat: /dsh-research-cat routes')

  if (resolved.exposeTool) {
    ctx.inject(['tools'], (scope) => {
      scope.effect(() => {
        const dispose = scope.tools.register(buildAgentTool(library))
        return () => dispose()
      }, 'dsh-research-cat: research_cat tool')
    })
  }
}
