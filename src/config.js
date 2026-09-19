/**
 * Plugin configuration: the raw `cordis.patch.yml` config block, resolved with
 * defaults.
 *
 * The nine keys below are the frozen contract (docs/rr-parity-spec.md §6.3):
 * `exposeTool`, `mailto`, `searchPerPage`, `maxBatch`, `maxCitations`,
 * `maxNodes`, `maxSeeds`, `concurrency`, `storePath`. Test seams such as
 * `fetchImpl` are read by `src/index.js` directly and never appear here.
 *
 * @module dsh-research-cat/config
 */

import { resolveStorePath } from './store.js'

/** Default OpenAlex polite-pool contact address. */
export const DEFAULT_MAILTO = 'dsh-research-cat@localhost'

/** Search page size (spec AC-A5-1). */
export const DEFAULT_SEARCH_PER_PAGE = 50

/** Hard ceiling on papers in one graph. */
export const DEFAULT_MAX_NODES = 1000

/** Neighbours pulled per references / related / earlier / author expand. */
export const DEFAULT_MAX_BATCH = 100

/** Most-cited citing papers pulled per citations / later expand. */
export const DEFAULT_MAX_CITATIONS = 100

/** Seed ceiling — the Research Rabbit free tier allows 50. */
export const DEFAULT_MAX_SEEDS = 50

/** OpenAlex concurrency ceiling. */
export const DEFAULT_CONCURRENCY = 4

/**
 * @typedef {object} Config
 * @property {boolean} exposeTool - register the research_cat agent tool.
 * @property {string} mailto - OpenAlex polite-pool contact address.
 * @property {number} searchPerPage - search results per page.
 * @property {number} maxNodes - papers per graph ceiling.
 * @property {number} maxBatch - neighbours per references/related/earlier/author expand.
 * @property {number} maxCitations - citing papers per citations/later expand.
 * @property {number} maxSeeds - seeds per collection.
 * @property {number} concurrency - concurrent OpenAlex requests.
 * @property {string} storePath - library file path.
 */

/**
 * Resolve a raw loader config block into a full {@link Config}.
 *
 * @param {unknown} raw - the config the composition row supplied.
 * @returns {Config} the resolved config.
 */
export function resolveConfig(raw) {
  const source = typeof raw === 'object' && raw !== null ? raw : {}
  return {
    exposeTool: source.exposeTool !== false,
    mailto: typeof source.mailto === 'string' && source.mailto !== '' ? source.mailto : DEFAULT_MAILTO,
    searchPerPage: positiveInt(source.searchPerPage, DEFAULT_SEARCH_PER_PAGE),
    maxNodes: positiveInt(source.maxNodes, DEFAULT_MAX_NODES),
    maxBatch: positiveInt(source.maxBatch, DEFAULT_MAX_BATCH),
    maxCitations: positiveInt(source.maxCitations, DEFAULT_MAX_CITATIONS),
    maxSeeds: positiveInt(source.maxSeeds, DEFAULT_MAX_SEEDS),
    concurrency: positiveInt(source.concurrency, DEFAULT_CONCURRENCY),
    storePath: resolveStorePath(source.storePath),
  }
}

/** A finite positive integer, or the fallback. */
function positiveInt(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}
