/**
 * The Research Cat library store: one JSON file under the DSH home directory,
 * written atomically and read back with repair/degradation.
 *
 * Design (docs/rr-parity-design.md §2):
 * - default path `${DSH_HOME:-$HOME/.dsh}/research-cat/library.json` — the home
 *   is never hardcoded, so a deployment with a custom DSH_HOME lands correctly;
 * - plain `node:fs` only: no dependency, no build step, no native module;
 * - atomic write = temp file + fsync + rename, so a crash leaves either the old
 *   complete file or the new complete file, never a truncated one;
 * - a corrupt file, an empty file or a version we do not know is kept as
 *   `library.json.bak-<stamp>` and the process starts from an empty library
 *   with a readable `storeError` (the plugin must still load);
 * - writes are debounced (300 ms, max wait 2 s) and serialised on one promise
 *   chain; `flush()` forces the current snapshot to disk.
 *
 * Everything here is injectable (`fs`, timings) so tests can drive corruption,
 * unwritable directories and write counts without touching a real home.
 *
 * @module dsh-research-cat/store
 */

import { promises as nodeFs } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { homedir } from 'node:os'

/** Schema version written by this build. */
export const STORE_VERSION = 1

/** Directory under the DSH home. */
export const STORE_DIR = 'research-cat'

/** File name inside {@link STORE_DIR}. */
export const STORE_FILE = 'library.json'

/** Id of the always-present system collection that backs the old `seeds` array. */
export const SEEDS_ID = 'seeds'

/** Recently Found ceiling (spec AC-B3-6). */
export const RECENT_LIMIT = 500

/** Metadata cache ceiling (design §2.8). */
export const RECORD_LIMIT = 20000

/** Membership ceiling (design §2.8). */
export const MEMBERSHIP_LIMIT = 40000

/** Annotation ceiling (design §2.8). */
export const ANNOTATION_LIMIT = 20000

/** @param {unknown} error @returns {string} */
function messageOf(error) {
  if (error !== null && error !== undefined && typeof error.message === 'string' && error.message !== '') return String(error.message)
  return String(error)
}

/** @param {unknown} value @returns {boolean} */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && Array.isArray(value) === false
}

/** @param {unknown} value @returns {boolean} */
function isWorkId(value) {
  return typeof value === 'string' && /^W\d+$/.test(value)
}

/** The DSH home directory: `DSH_HOME` when set, else `<homedir>/.dsh`. */
export function dshHomeDir() {
  const fromEnv = typeof process !== 'undefined' && process.env !== undefined && typeof process.env.DSH_HOME === 'string'
    ? process.env.DSH_HOME.trim()
    : ''
  if (fromEnv !== '') return fromEnv
  return join(homedir(), '.dsh')
}

/** The default library file path (never a hardcoded home). */
export function defaultStorePath() {
  return join(dshHomeDir(), STORE_DIR, STORE_FILE)
}

/**
 * Resolve the configured `storePath`: an explicit path wins (relative paths are
 * resolved against the DSH home), otherwise the default.
 *
 * @param {unknown} raw - the raw config value.
 * @returns {string} an absolute or home-relative path.
 */
export function resolveStorePath(raw) {
  if (typeof raw === 'string' && raw.trim() !== '') {
    const value = raw.trim()
    return isAbsolute(value) ? value : join(dshHomeDir(), value)
  }
  return defaultStorePath()
}

/** A brand-new, valid library document (always containing the system collection). */
export function emptyLibrary() {
  return {
    version: STORE_VERSION,
    savedAt: null,
    records: {},
    collections: [{
      id: SEEDS_ID,
      name: 'Collection',
      parentId: null,
      system: true,
      createdAt: new Date().toISOString(),
      order: 0,
    }],
    memberships: [],
    recentlyFound: [],
    annotations: {},
    seq: 0,
    meta: { writes: 0 },
  }
}

/** @param {unknown} value @param {string} fallback @returns {string} */
function textOr(value, fallback) {
  return typeof value === 'string' && value !== '' ? value : fallback
}

/** @param {unknown} value @param {number} fallback @returns {number} */
function intOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback
}

/** Normalise one persisted record; null when it cannot be trusted. */
function normalizeRecord(id, value) {
  if (!isWorkId(id) || !isPlainObject(value)) return null
  const authorIds = Array.isArray(value.authorIds)
    ? value.authorIds.filter((entry) => typeof entry === 'string' && /^A\d+$/.test(entry))
    : []
  const authors = Array.isArray(value.authors)
    ? value.authors.filter((entry) => typeof entry === 'string' && entry !== '')
    : []
  const record = {
    id: id,
    title: textOr(value.title, '(untitled)'),
    year: intOr(value.year, 0),
    citedBy: intOr(value.citedBy, 0),
    doi: textOr(value.doi, null),
    venue: textOr(value.venue, null),
    kind: textOr(value.kind, null),
    openAccess: value.openAccess === true,
    retracted: value.retracted === true,
    authorIds: authorIds,
  }
  if (authors.length > 0) record.authors = authors
  return record
}

/**
 * Repair a parsed document into a valid library.
 *
 * @param {unknown} input - parsed JSON.
 * @returns {{ data: any, repairs: string[] }} the repaired library and notes.
 */
export function normalizeLibrary(input) {
  const repairs = []
  const data = emptyLibrary()
  if (!isPlainObject(input)) return { data, repairs: ['document is not an object'] }
  if (typeof input.savedAt === 'string') data.savedAt = input.savedAt
  if (typeof input.meta === 'object' && input.meta !== null) data.meta = input.meta

  if (isPlainObject(input.records)) {
    const keys = Object.keys(input.records)
    for (let i = 0; i < keys.length; i++) {
      const record = normalizeRecord(keys[i], input.records[keys[i]])
      if (record === null) repairs.push('dropped a malformed record')
      else data.records[keys[i]] = record
    }
  } else if (input.records !== undefined) {
    repairs.push('records was not an object')
  }

  const rawCollections = Array.isArray(input.collections) ? input.collections : []
  const byId = new Map()
  byId.set(SEEDS_ID, data.collections[0])
  for (let i = 0; i < rawCollections.length; i++) {
    const entry = rawCollections[i]
    if (!isPlainObject(entry)) { repairs.push('dropped a malformed collection'); continue }
    const id = textOr(entry.id, '')
    if (id === '') continue
    if (id === SEEDS_ID) {
      // The system collection always exists; keep the persisted name/creation
      // time (it may have been renamed) but never its parent or system flag.
      const system = data.collections[0]
      system.name = textOr(entry.name, system.name)
      system.createdAt = textOr(entry.createdAt, system.createdAt)
      continue
    }
    if (byId.has(id)) continue
    const collection = {
      id: id,
      name: textOr(entry.name, id),
      parentId: typeof entry.parentId === 'string' && entry.parentId !== '' ? entry.parentId : null,
      system: entry.system === true,
      createdAt: textOr(entry.createdAt, new Date().toISOString()),
      order: intOr(entry.order, data.collections.length),
    }
    byId.set(id, collection)
    data.collections.push(collection)
  }

  // Drop unknown parents and break parent cycles.
  for (let i = 0; i < data.collections.length; i++) {
    const collection = data.collections[i]
    if (collection.system === true) { collection.parentId = null; continue }
    let parent = collection.parentId
    const seen = new Set([collection.id])
    while (parent !== null) {
      if (seen.has(parent)) { collection.parentId = null; repairs.push('broke a collection cycle'); break }
      seen.add(parent)
      const next = byId.get(parent)
      if (next === undefined) { collection.parentId = null; repairs.push('dropped an unknown parentId'); break }
      parent = next.parentId
    }
  }

  let maxSeq = 0
  for (let i = 0; i < data.collections.length; i++) {
    const match = /^c(\d+)$/.exec(data.collections[i].id)
    if (match !== null) maxSeq = Math.max(maxSeq, Number(match[1]))
  }
  data.seq = Number.isInteger(input.seq) && input.seq >= maxSeq ? input.seq : maxSeq

  const rawMemberships = Array.isArray(input.memberships) ? input.memberships : []
  const memberKeys = new Set()
  for (let i = 0; i < rawMemberships.length; i++) {
    const entry = rawMemberships[i]
    if (!isPlainObject(entry)) { repairs.push('dropped a malformed membership'); continue }
    const collectionId = textOr(entry.collectionId, '')
    const workId = textOr(entry.workId, '')
    if (byId.has(collectionId) !== true || isWorkId(workId) !== true || data.records[workId] === undefined) {
      repairs.push('dropped a dangling membership')
      continue
    }
    const key = collectionId + '|' + workId
    if (memberKeys.has(key)) { repairs.push('dropped a duplicate membership'); continue }
    memberKeys.add(key)
    data.memberships.push({ collectionId: collectionId, workId: workId, addedAt: textOr(entry.addedAt, new Date().toISOString()) })
  }

  const rawRecent = Array.isArray(input.recentlyFound) ? input.recentlyFound : []
  const recentSeen = new Set()
  for (let i = 0; i < rawRecent.length; i++) {
    const entry = rawRecent[i]
    const workId = isPlainObject(entry) ? textOr(entry.workId, '') : textOr(entry, '')
    if (isWorkId(workId) !== true || data.records[workId] === undefined || recentSeen.has(workId)) {
      repairs.push('dropped a dangling Recently Found entry')
      continue
    }
    recentSeen.add(workId)
    data.recentlyFound.push({ workId: workId, at: isPlainObject(entry) ? textOr(entry.at, new Date().toISOString()) : new Date().toISOString() })
  }

  if (isPlainObject(input.annotations)) {
    const keys = Object.keys(input.annotations)
    for (let i = 0; i < keys.length; i++) {
      const workId = keys[i]
      const entry = input.annotations[workId]
      if (isWorkId(workId) !== true || data.records[workId] === undefined || !isPlainObject(entry)) {
        repairs.push('dropped a dangling annotation')
        continue
      }
      data.annotations[workId] = {
        note: typeof entry.note === 'string' ? entry.note : '',
        tags: Array.isArray(entry.tags) ? entry.tags.filter((tag) => typeof tag === 'string' && tag !== '') : [],
        color: typeof entry.color === 'string' ? entry.color : null,
        updatedAt: textOr(entry.updatedAt, new Date().toISOString()),
      }
    }
  } else if (input.annotations !== undefined) {
    repairs.push('annotations was not an object')
  }

  return { data, repairs }
}

/**
 * Create the store for one library.
 *
 * @param {object} options
 * @param {string} options.storePath - resolved library file path.
 * @param {() => any} options.snapshot - current library document provider.
 * @param {object} [options.fs] - `node:fs/promises`-shaped implementation (test seam).
 * @param {number} [options.debounceMs] - write debounce.
 * @param {number} [options.maxWaitMs] - maximum delay before a write happens.
 */
export function createStore(options) {
  const fs = options.fs !== undefined && options.fs !== null ? options.fs : nodeFs
  const path = options.storePath
  const snapshot = options.snapshot
  const debounceMs = Number.isFinite(options.debounceMs) ? options.debounceMs : 300
  const maxWaitMs = Number.isFinite(options.maxWaitMs) ? options.maxWaitMs : 2000

  let degraded = false
  let lastError = null
  let writes = 0
  let pending = false
  let dirty = false
  let debounceTimer = null
  let maxTimer = null
  let chain = Promise.resolve()

  function clearTimers() {
    if (debounceTimer !== null) { clearTimeout(debounceTimer); debounceTimer = null }
    if (maxTimer !== null) { clearTimeout(maxTimer); maxTimer = null }
  }

  async function writeAtomic(data) {
    const text = JSON.stringify(data, null, 2)
    await fs.mkdir(dirname(path), { recursive: true })
    const tmp = path + '.tmp-' + process.pid + '-' + Math.random().toString(36).slice(2, 8)
    let handle = null
    try {
      if (typeof fs.open === 'function') {
        handle = await fs.open(tmp, 'w', 0o600)
        await handle.writeFile(text, 'utf8')
        if (typeof handle.sync === 'function') await handle.sync()
        await handle.close()
        handle = null
      } else {
        await fs.writeFile(tmp, text, { encoding: 'utf8', mode: 0o600 })
      }
      await fs.rename(tmp, path)
      writes += 1
      data.meta = isPlainObject(data.meta) ? data.meta : {}
      data.meta.writes = writes
      data.savedAt = new Date().toISOString()
    } catch (error) {
      if (handle !== null) { try { await handle.close() } catch { /* already failing */ } }
      try { await fs.unlink(tmp) } catch { /* nothing to clean */ }
      throw error
    }
  }

  async function doWrite() {
    if (degraded) return
    try {
      await writeAtomic(snapshot())
      dirty = false
      lastError = null
    } catch (error) {
      lastError = 'could not write ' + path + ': ' + messageOf(error)
    }
  }

  function enqueue() {
    chain = chain.then(doWrite, doWrite)
    return chain
  }

  function fire() {
    clearTimers()
    if (pending !== true) return
    pending = false
    void enqueue()
  }

  /** Mark the library dirty; the write is debounced and serialised. */
  function save() {
    if (degraded) return
    dirty = true
    pending = true
    if (debounceTimer === null) debounceTimer = setTimeout(fire, debounceMs)
    if (maxTimer === null) maxTimer = setTimeout(fire, maxWaitMs)
  }

  /** Queue a write immediately, skipping the debounce (clear / destructive ops). */
  function saveNow() {
    if (degraded) return
    dirty = true
    pending = false
    clearTimers()
    void enqueue()
  }

  /** Force the current snapshot to disk now (a no-op when nothing changed). */
  async function flush() {
    clearTimers()
    pending = false
    if (dirty) await enqueue()
    else await chain
    return writes
  }

  /** Keep a broken file around instead of overwriting it. */
  async function backup(reason) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const target = path + '.bak-' + stamp
    try {
      await fs.rename(path, target)
    } catch (error) {
      try {
        const text = await fs.readFile(path, 'utf8')
        await fs.writeFile(target, text, { encoding: 'utf8', mode: 0o600 })
      } catch {
        /* best effort: the file stays where it was */
      }
      lastError = 'kept the unusable library as ' + target + ' (' + reason + ': ' + messageOf(error) + ')'
      return
    }
    lastError = 'kept the unusable library as ' + target + ' (' + reason + ')'
  }

  /**
   * Read the library from disk, repairing or backing up as designed.
   *
   * @returns {Promise<{ data: any, storeError: string | null, repaired: boolean }>}
   */
  async function open() {
    let text
    try {
      text = await fs.readFile(path, 'utf8')
    } catch (error) {
      const code = error !== null && error !== undefined ? error.code : undefined
      if (code === 'ENOENT') return { data: emptyLibrary(), storeError: null, repaired: false }
      degraded = true
      lastError = 'could not read ' + path + ': ' + messageOf(error) + '; running from memory only'
      return { data: emptyLibrary(), storeError: lastError, repaired: false }
    }
    if (typeof text !== 'string' || text.trim() === '') {
      await backup('the file was empty')
      return { data: emptyLibrary(), storeError: lastError, repaired: true }
    }
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch (error) {
      await backup('the file was not valid JSON')
      return { data: emptyLibrary(), storeError: lastError, repaired: true }
    }
    const version = isPlainObject(parsed) ? parsed.version : undefined
    if (typeof version !== 'number' || Number.isInteger(version) !== true) {
      await backup('the file has no version field')
      return { data: emptyLibrary(), storeError: lastError, repaired: true }
    }
    if (version > STORE_VERSION) {
      await backup('version ' + version + ' is newer than this build understands (' + STORE_VERSION + ')')
      return { data: emptyLibrary(), storeError: lastError, repaired: true }
    }
    const { data, repairs } = normalizeLibrary(parsed)
    if (repairs.length > 0) {
      lastError = 'repaired the library file (' + repairs.length + '): ' + repairs.slice(0, 3).join('; ')
      dirty = true
      void enqueue()
      return { data, storeError: lastError, repaired: true }
    }
    return { data, storeError: null, repaired: false }
  }

  /** Flush and stop accepting writes. */
  async function close() {
    await flush()
    degraded = true
  }

  return {
    path: path,
    open: open,
    save: save,
    saveNow: saveNow,
    flush: flush,
    close: close,
    storeError() { return lastError },
    isDegraded() { return degraded },
    writeCount() { return writes },
  }
}
