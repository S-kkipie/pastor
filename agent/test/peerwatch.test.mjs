import test from 'node:test'
import assert from 'node:assert/strict'
import { PeerWatch } from '../src/peerwatch.mjs'

test('sigue un turno abierto por <pastor-message> y no los demás', async () => {
  let events = [{ seq: 1, rev: 1, kind: 'user', text: 'hola' }, { seq: 2, rev: 2, kind: 'assistant', text: 'ok' }]
  const hub = { async session(_id, { since } = {}) { return { session: { status: 'busy' }, events: events.filter(e => e.rev > (since ?? 0)) } } }
  const resumed = []
  const relay = { following: () => false, resume: (id, after, ctx, text) => { resumed.push({ id, after, ctx, text }); return Promise.resolve() } }
  const w = new PeerWatch({ hub, relay, channels: () => [{ channel: 'wa-1', sessionId: 'S' }] })
  await w.tick() // first look: only remembers where it is
  assert.equal(resumed.length, 0)
  events = [...events, { seq: 3, rev: 3, kind: 'user', text: '<pastor-message from="pastor:laptop/7f3a2c1e" pc="laptop" session="x">\nlisto\n</pastor-message>\nEs un mensaje…' }]
  await w.tick()
  assert.equal(resumed.length, 1)
  assert.deepEqual({ id: resumed[0].id, after: resumed[0].after, ch: resumed[0].ctx.channel }, { id: 'S', after: 2, ch: 'wa-1' })
  await w.tick()
  assert.equal(resumed.length, 1) // not twice
})

test('no se mete si el relay ya sigue la sesión', async () => {
  const hub = { async session() { return { session: {}, events: [{ seq: 5, rev: 5, kind: 'user', text: '<pastor-message from="a">x</pastor-message>' }] } } }
  const resumed = []
  const relay = { following: () => true, resume: () => { resumed.push(1); return Promise.resolve() } }
  const w = new PeerWatch({ hub, relay, channels: () => [{ channel: 'wa-1', sessionId: 'S' }] })
  w.seen.set('S', 4)
  await w.tick()
  assert.equal(resumed.length, 0)
})

test('sigue el turno aunque el motor anteponga su propio texto al marcador', async () => {
  const hub = { async session() { return { session: {}, events: [{ seq: 7, rev: 7, kind: 'user', text: 'Un plugin te envió un mensaje:\n<pastor-message from="pastor:laptop/7f3a2c1e">x</pastor-message>' }] } } }
  const resumed = []
  const relay = { following: () => false, resume: (id, after) => { resumed.push({ id, after }); return Promise.resolve() } }
  const w = new PeerWatch({ hub, relay, channels: () => [{ channel: 'wa-1', sessionId: 'S' }] })
  w.seen.set('S', 6)
  await w.tick()
  assert.deepEqual(resumed, [{ id: 'S', after: 6 }])
})

test('si el hub reinicia (su contador baja), vuelve a tomar referencia y sigue el siguiente mensaje', async () => {
  let events = [{ seq: 50, rev: 50, kind: 'assistant', text: 'ok' }], updated = 50
  const hub = { async session(_id, { since } = {}) { return { session: { updated }, events: events.filter(e => e.rev > (since ?? 0)) } } }
  const resumed = []
  const relay = { following: () => false, resume: (id, after) => { resumed.push({ id, after }); return Promise.resolve() } }
  const w = new PeerWatch({ hub, relay, channels: () => [{ channel: 'wa-1', sessionId: 'S' }] })
  await w.tick()
  assert.equal(w.seen.get('S'), 50)
  // restart: the counter starts over
  events = [{ seq: 3, rev: 3, kind: 'user', text: 'historia' }]; updated = 3
  await w.tick()
  assert.equal(w.seen.has('S'), false) // forgot the old rev
  await w.tick() // re-baseline: history is not followed
  assert.equal(w.seen.get('S'), 3)
  assert.equal(resumed.length, 0)
  events = [...events, { seq: 4, rev: 4, kind: 'user', text: '<pastor-message from="pastor:laptop/7f3a2c1e">listo</pastor-message>' }]; updated = 4
  await w.tick()
  assert.deepEqual(resumed, [{ id: 'S', after: 3 }])
})

test('despierta una vez el canal cuyo agente dormido tiene un mensaje esperando', async () => {
  let session = { updated: 9, online: false, wake: true }
  const hub = { async session() { return { session, events: [] } } }
  const relay = { following: () => false, resume: () => Promise.resolve() }
  const woke = []
  const w = new PeerWatch({ hub, relay, wake: ch => { woke.push(ch) }, channels: () => [{ channel: 'wa-1', sessionId: 'S' }, { channel: 'wa-2', sessionId: 'T' }] })
  await w.tick()
  await w.tick()
  await new Promise(r => setImmediate(r))
  assert.deepEqual(woke, ['wa-1', 'wa-2']) // once each, not every tick
  // it woke up and polled: the flag clears; a later message wakes it again
  session = { updated: 10, online: true, wake: false }
  await w.tick()
  session = { updated: 11, online: false, wake: true }
  await w.tick()
  await new Promise(r => setImmediate(r))
  assert.equal(woke.filter(c => c === 'wa-1').length, 2)
})

test('no despierta una sesión en línea ni sin bandera', async () => {
  const sessions = { S: { updated: 1, online: true, wake: true }, T: { updated: 1, online: false } }
  const hub = { async session(id) { return { session: sessions[id], events: [] } } }
  const woke = []
  const w = new PeerWatch({ hub, relay: { following: () => false }, wake: ch => { woke.push(ch) }, channels: () => [{ channel: 'wa-1', sessionId: 'S' }, { channel: 'wa-2', sessionId: 'T' }] })
  await w.tick()
  await new Promise(r => setImmediate(r))
  assert.deepEqual(woke, [])
})
