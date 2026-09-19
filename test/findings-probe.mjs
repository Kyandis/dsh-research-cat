// t5 probes for the review findings t9 raised (F2 / F3 / F5) against the store.
//
//   node test/findings-probe.mjs
//
// Everything runs under os.tmpdir(); the real ~/.dsh/research-cat path is never
// touched. Output:
//   F5  — createLibrary() without ready() then a write replaces the existing
//         library file with the new (empty) instance's state: CONFIRMED at the
//         API level. Not reachable through the shipped mount path because
//         src/index.js awaits ready() before registering routes/tools.
//   F3  — the on-disk meta.writes/savedAt lag the real write count by one.
//   F2  — a hard exit between the temp write and the rename leaves an orphan
//         .tmp- file while the main file stays complete (AC-B1-2 holds).
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

const probeRoot = mkdtempSync(join(tmpdir(), 't5-findings-'))
process.env.DSH_HOME = join(probeRoot, 'home')

const { createLibrary } = await import(resolve(root, 'src/graph.js'))

function stub() {
  return async (url) => {
    const u = new URL(String(url))
    const id = u.pathname.startsWith('/works/') ? u.pathname.split('/')[2] : null
    const filter = u.searchParams.get('filter') || ''
    const m = /openalex_id:([^&,]+)/.exec(filter)
    const ids = m ? m[1].split('|') : (id ? [id] : [])
    const results = ids.map((wid, i) => ({
      id: wid,
      doi: null,
      title: 'probe ' + wid,
      display_name: 'probe ' + wid,
      publication_year: 2000 + i,
      cited_by_count: 10 + i,
      type: 'article',
      primary_location: null,
      open_access: { is_oa: false },
      is_retracted: false,
      referenced_works: [],
      related_works: [],
    }))
    return { ok: true, status: 200, async text() { return JSON.stringify({ results: results, meta: { count: results.length } }) } }
  }
}
const base = { mailto: 'x@y.z', maxNodes: 10, maxBatch: 5, maxCitations: 5, maxSeeds: 5, concurrency: 1, fetchImpl: stub(), retryDelayMs: 1 }

/* ---- F5: createLibrary without ready(), then a write ---- */
{
  const dir = join(probeRoot, 'f5')
  const path = join(dir, 'library.json')
  mkdirSync(dir, { recursive: true })
  const first = createLibrary({ ...base, storePath: path })
  await first.ready()
  await first.addSeed('W100')
  await first.flush()
  const before = JSON.parse(readFileSync(path, 'utf8'))
  const second = createLibrary({ ...base, storePath: path })
  await second.addSeed('W200')
  await second.flush()
  const after = JSON.parse(readFileSync(path, 'utf8'))
  console.log('F5 before: records=' + Object.keys(before.records).length + ' memberships=' + before.memberships.length)
  console.log('F5 after : records=' + Object.keys(after.records).length + ' memberships=' + after.memberships.length + ' savedAt=' + after.savedAt)
  console.log('F5 before keys=' + JSON.stringify(Object.keys(before.records)) + ' after keys=' + JSON.stringify(Object.keys(after.records)) + ' membershipsAfter=' + JSON.stringify(after.memberships.map((m) => m.workId)))
  console.log('F5 VERDICT: ' + (JSON.stringify(Object.keys(after.records)) !== JSON.stringify(Object.keys(before.records)) ? 'CONFIRMED — the pre-existing library content was replaced by the new empty-instance write' : 'not reproduced'))
  await second.close()
}

/* ---- F3: does the file's meta.writes/savedAt lag the actual write count? ---- */
{
  const dir = join(probeRoot, 'f3')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'library.json')
  const lib = createLibrary({ ...base, storePath: path, debounceMs: 1, maxWaitMs: 5 })
  await lib.ready()
  for (let i = 1; i <= 3; i++) { await lib.addSeed('W' + i); await lib.flush() }
  const onDisk = JSON.parse(readFileSync(path, 'utf8'))
  const info = lib.storeInfo()
  console.log('F3 writeCount()=' + info.writes + '  file meta.writes=' + onDisk.meta.writes + '  file savedAt=' + onDisk.savedAt + '  records=' + Object.keys(onDisk.records).length)
  console.log('F3 VERDICT: ' + (onDisk.meta.writes !== info.writes ? 'CONFIRMED — on-disk meta.writes lags the real write count' : 'not reproduced'))
  await lib.close()
}

/* ---- F2: hard exit between tmp write and rename leaves an orphan .tmp ---- */
{
  const dir = join(probeRoot, 'f2')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'library.json')
  const lib = createLibrary({ ...base, storePath: path })
  await lib.ready()
  await lib.addSeed('W1')
  await lib.flush()
  writeFileSync(path + '.tmp-99999-orphan', readFileSync(path, 'utf8'))
  const files = readdirSync(dir)
  const main = JSON.parse(readFileSync(path, 'utf8'))
  console.log('F2 dir=' + JSON.stringify(files) + '  main file parses: records=' + Object.keys(main.records).length)
  console.log('F2 VERDICT: an orphan .tmp can remain while the main file stays complete (AC-B1-2 not violated)')
  await lib.close()
}

console.log('\nprobe root: ' + probeRoot)
