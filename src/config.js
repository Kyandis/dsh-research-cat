/**
 * Plugin configuration: the raw `cordis.patch.yml` config block, resolved with
 * defaults.
 *
 * @module dsh-research-cat/config
 */

/** Default OpenAlex polite-pool contact address. */
export const DEFAULT_MAILTO = 'dsh-research-cat@localhost'

/** Hard ceiling on papers in one graph. */
export const DEFAULT_MAX_NODES = 400

/** Neighbours pulled per expand call (references / related). */
export const DEFAULT_MAX_BATCH = 30

/** Most-cited citing papers pulled per citations expand. */
export const DEFAULT_MAX_CITATIONS = 25

/**
 * @typedef {object} Config
 * @property {boolean} exposeTool - register the research_cat agent tool.
 * @property {string} mailto - OpenAlex polite-pool contact address.
 * @property {number} maxNodes - papers per graph ceiling.
 * @property {number} maxBatch - neighbours per references/related expand.
 * @property {number} maxCitations - citing papers per citations expand.
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
    maxNodes: positiveInt(source.maxNodes, DEFAULT_MAX_NODES),
    maxBatch: positiveInt(source.maxBatch, DEFAULT_MAX_BATCH),
    maxCitations: positiveInt(source.maxCitations, DEFAULT_MAX_CITATIONS),
  }
}

/** A finite positive integer, or the fallback. */
function positiveInt(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}
