import test from 'node:test'
import assert from 'node:assert/strict'
import { startServer } from '../src/server.mjs'

test('API local: secreto obligatorio y rutas', async () => {
  const got = []
  const srv = startServer({ port: 0, secret: 's3', handlers: {
    status: () => ({ enabled: true }), getConfig: () => ({ a: 1 }), setConfig: p => { got.push(['config', p]); return { ok: true } },
    activity: () => [{ at: 1 }], qr: async () => ({ dataUrl: null }), send: b => { got.push(['send', b]); return { ok: true } },
    logActivity: e => { got.push(['act', e]); return { ok: true } }, channel: b => ({ sessionId: `S-${b.channel}` }), relink: () => ({ ok: true }),
  } })
  await new Promise(r => srv.once('listening', r))
  const base = `http://127.0.0.1:${srv.address().port}`
  const call = (p, body, secret = 's3') => fetch(base + p, { method: body ? 'POST' : 'GET', headers: { 'x-agent-secret': secret, 'content-type': 'application/json' }, body: body && JSON.stringify(body) })
  assert.equal((await call('/status', undefined, 'mal')).status, 401)
  assert.deepEqual(await (await call('/status')).json(), { enabled: true })
  assert.deepEqual(await (await call('/channel', { channel: 'app' })).json(), { sessionId: 'S-app' })
  await call('/send', { to: '51900000001', text: 'x' })
  assert.deepEqual(got.at(-1), ['send', { to: '51900000001', text: 'x' }])
  assert.equal((await call('/nada')).status, 404)
  srv.close()
})
