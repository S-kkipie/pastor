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

test('API local: el chat con Hermes (leer, decir, parar) va por POST', async () => {
  const got = []
  const srv = startServer({ port: 0, secret: 's3', handlers: {
    chat: b => ({ messages: [], channel: b.channel }), say: b => { got.push(['say', b]); return { queued: 1 } }, stop: b => { got.push(['stop', b]); return { ok: true } },
  } })
  await new Promise(r => srv.once('listening', r))
  const call = (p, body) => fetch(`http://127.0.0.1:${srv.address().port}${p}`, { method: 'POST', headers: { 'x-agent-secret': 's3', 'content-type': 'application/json' }, body: JSON.stringify(body) })
  assert.deepEqual(await (await call('/chat', { channel: 'app' })).json(), { messages: [], channel: 'app' })
  assert.deepEqual(await (await call('/say', { channel: 'app', text: 'hola' })).json(), { queued: 1 })
  await call('/stop', { channel: 'app' })
  assert.deepEqual(got, [['say', { channel: 'app', text: 'hola' }], ['stop', { channel: 'app' }]])
  srv.close()
})
