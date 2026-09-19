/**
 * The /dsh-research-cat/* JSON route family the panel talks to.
 *
 * This is the same bridge dsh-drawio / dsh-ssh / dsh-aionui-panel use: plain
 * same-origin `fetch`, one JSON envelope per call — no package-private RPC.
 *
 * Every route is behind a loopback fence. The panel only reads public OpenAlex
 * data and the local library, never workspace files, but a LAN-exposed DSH must
 * not let an unpaired device drive outbound requests either.
 *
 * Envelope (unchanged from the previous round):
 * `{ok:true, value}` on success, `{ok:false, error:{code, message}}` on failure,
 * with `code` one of `invalid` (bad arguments, HTTP 400), `operation`
 * (business/network failure, HTTP 200), `forbidden` (fence).
 *
 * @module dsh-research-cat/routes
 */

import { messageOf } from './graph.js'

/** The route prefix the browser half calls. */
export const ROUTE_PREFIX = '/dsh-research-cat'

/** Loopback trust fence (mirrors dsh-drawio / dsh-ssh / dsh-aionui-panel). */
function isLoopbackRequest(request) {
  const address = request.socket.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  const host = request.headers.host
  if (typeof host !== 'string') return false
  let hostUrl
  try {
    hostUrl = new URL('http://' + host)
  } catch {
    return false
  }
  if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]') return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

const badRequest = (res, message) => send(res, 400, { ok: false, error: { code: 'invalid', message } })

/** Read a bounded JSON body; null when unparseable or oversized. */
async function readJsonBody(req) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    const buffer = chunk
    chunks.push(buffer)
    total += buffer.length
    if (total > 1 << 20) return null
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text === '') return {}
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * @typedef {object} RouteDispatch
 * @property {(payload: any) => Promise<unknown> | unknown} run - the operation.
 */

/**
 * Register the routes.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - context carrying webServer.
 * @param {ReturnType<import('./graph.js').createLibrary>} library - the engine.
 * @returns {() => void} the route disposer.
 */
export function registerResearchCatRoutes(ctx, library) {
  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   */
  const handler = async (req, res) => {
    if (!isLoopbackRequest(req)) {
      send(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden: loopback-only' } })
      return
    }
    if (req.method === 'GET') {
      // A tiny identity probe, handy when wiring the panel up.
      send(res, 200, { ok: true, value: { name: 'dsh-research-cat', route: ROUTE_PREFIX } })
      return
    }
    if (req.method !== 'POST') {
      res.writeHead(405)
      res.end()
      return
    }
    // Require an explicit JSON content-type: cross-site simple requests cannot
    // set it, so this also blocks form-based CSRF.
    const contentType = req.headers['content-type'] ?? ''
    if (!contentType.toLowerCase().startsWith('application/json')) {
      send(res, 415, { ok: false, error: { code: 'invalid', message: 'expected application/json' } })
      return
    }
    const pathname = new URL(req.url ?? '/', 'http://x').pathname
    const payload = await readJsonBody(req)
    if (payload === null) {
      badRequest(res, 'malformed request')
      return
    }

    const str = (key) => (typeof payload[key] === 'string' && payload[key] !== '' ? payload[key] : undefined)
    const required = (key, what) => {
      const value = str(key)
      if (value === undefined) {
        badRequest(res, what)
        return undefined
      }
      return value
    }

    try {
      switch (pathname) {
        case ROUTE_PREFIX + '/state':
          send(res, 200, { ok: true, value: library.state() })
          return
        case ROUTE_PREFIX + '/search': {
          const query = required('query', 'search needs a query')
          if (query === undefined) return
          send(res, 200, { ok: true, value: await library.search(query, payload.filters, payload.page) })
          return
        }
        case ROUTE_PREFIX + '/addSeed': {
          const id = required('id', 'addSeed needs an id')
          if (id === undefined) return
          send(res, 200, { ok: true, value: await library.addSeed(id) })
          return
        }
        case ROUTE_PREFIX + '/removeSeed': {
          const id = required('id', 'removeSeed needs an id')
          if (id === undefined) return
          send(res, 200, { ok: true, value: library.removeSeed(id) })
          return
        }
        case ROUTE_PREFIX + '/expand': {
          const id = required('id', 'expand needs an id')
          if (id === undefined) return
          send(res, 200, {
            ok: true,
            value: await library.expand(id, str('kind'), { authorId: str('authorId'), filters: payload.filters }),
          })
          return
        }
        case ROUTE_PREFIX + '/expandAll':
          send(res, 200, {
            ok: true,
            value: await library.expandAll({ kinds: payload.kinds, filters: payload.filters, authorId: str('authorId') }),
          })
          return
        case ROUTE_PREFIX + '/details': {
          const id = required('id', 'details needs an id')
          if (id === undefined) return
          send(res, 200, { ok: true, value: await library.details(id) })
          return
        }
        case ROUTE_PREFIX + '/authors': {
          const id = required('id', 'authors needs an id')
          if (id === undefined) return
          send(res, 200, { ok: true, value: await library.authors(id) })
          return
        }
        case ROUTE_PREFIX + '/collections':
          send(res, 200, { ok: true, value: library.collections(payload) })
          return
        case ROUTE_PREFIX + '/recentlyFound':
          send(res, 200, { ok: true, value: library.recentlyFound(payload) })
          return
        case ROUTE_PREFIX + '/annotate': {
          const id = required('id', 'annotate needs an id')
          if (id === undefined) return
          send(res, 200, { ok: true, value: library.annotate(payload) })
          return
        }
        case ROUTE_PREFIX + '/export':
          send(res, 200, { ok: true, value: library.export(payload) })
          return
        case ROUTE_PREFIX + '/clear':
          send(res, 200, { ok: true, value: library.clear(payload.scope) })
          return
        default:
          res.writeHead(404)
          res.end()
      }
    } catch (error) {
      // Operation failures are results, not crashes: the panel shows the message.
      const code = error !== null && error !== undefined && error.code === 'invalid' ? 'invalid' : 'operation'
      send(res, code === 'invalid' ? 400 : 200, { ok: false, error: { code: code, message: messageOf(error) } })
    }
  }

  const dispose = ctx.webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler })
  return () => dispose()
}
