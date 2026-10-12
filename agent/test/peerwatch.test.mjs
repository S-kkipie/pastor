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
