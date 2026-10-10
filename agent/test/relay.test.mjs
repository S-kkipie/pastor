import test from 'node:test'
import assert from 'node:assert/strict'
import { replies, Relay } from '../src/relay.mjs'

let seq = 0
const ev = (kind, text = '', extra = {}) => ({ seq: ++seq, rev: seq, t: seq, kind, text, ...extra })

test('replies: una respuesta por turno terminado', () => {
  seq = 100
  const events = [ev('user', 'hola'), ev('assistant', 'pensando…'), ev('tool', 'x', { tool: 'Bash', end: { ok: true } }), ev('assistant', 'listo'), ev('receipt')]
  const r = replies(events, 100)
  assert.equal(r.idle, true)
  assert.deepEqual(r.replies.map(x => x.text), ['listo'])
})
test('replies: un segundo mensaje sin recibo aún no está quieto', () => {
  seq = 200
  const events = [ev('user', 'a'), ev('assistant', 'A'), ev('receipt'), ev('user', 'b')]
  const r = replies(events, 200)
  assert.equal(r.idle, false)
  assert.deepEqual(r.replies.map(x => x.text), ['A'])
})
test('replies: ignora subagentes y recoge archivos escritos', () => {
  seq = 300
  const events = [ev('user', 'haz html'), ev('assistant', 'sub', { agent: 'a1' }),
    ev('tool', 'w', { tool: 'Write', detail: { file: '/home/yo/x/report.html' }, end: { ok: true } }), ev('assistant', 'hecho'), ev('receipt')]
  const r = replies(events, 300)
  assert.deepEqual(r.replies[0], { seq: r.replies[0].seq, text: 'hecho', files: ['/home/yo/x/report.html'] })
})

function fakeHub(script) {
  // script: array of { events, pending, status } returned by successive session() calls (the last one repeats)
  let i = 0, posted = []
  return {
    posted,
    async session(_id, { since } = {}) {
      const s = script[Math.min(i++, script.length - 1)]
      if (s instanceof Error) throw s
      return { session: { status: s.status ?? 'idle', ...(s.updated !== undefined ? { updated: s.updated } : {}) }, events: since ? s.events.filter(e => e.rev > since) : s.events, pending: s.pending ?? [] }
    },
    async prompt(id, text, mode) { posted.push({ id, text, mode }); return { ok: true } },
  }
}

test('Relay: dos mensajes seguidos, dos respuestas, termina quieto', async () => {
  seq = 400
  const base = [ev('info', 'conectada')]
  const u1 = ev('user', 'a'), a1 = ev('assistant', 'A'), r1 = ev('receipt'), u2 = ev('user', 'b'), a2 = ev('assistant', 'B'), r2 = ev('receipt')
  const hub = fakeHub([
    { events: base },
    { events: [...base, u1], status: 'busy' },
    { events: [...base, u1, a1, r1, u2], status: 'busy' },
    { events: [...base, u1, a1, r1, u2, a2, r2], status: 'idle' },
  ])
  const got = []
  const relay = new Relay({ hub, onReply: (_c, r) => got.push(r.text), onPending() {}, onTyping() {}, onSlow() {}, onError() {}, pollMs: 1, sleep: async () => {} })
  const first = relay.run('S', 'a', {})
  assert.equal(relay.following('S'), true) // registered before any await
  await relay.run('S', 'b', {})
  await first
  assert.deepEqual(got, ['A', 'B'])
  assert.equal(hub.posted.length, 2)
})

test('Relay: el hub se cae a mitad y vuelve', async () => {
  seq = 500
  const u = ev('user', 'x'), a = ev('assistant', 'ok'), r = ev('receipt')
  const hub = fakeHub([{ events: [] }, new Error('ECONNREFUSED'), new Error('ECONNREFUSED'), { events: [u, a, r], status: 'idle' }])
  const got = [], errs = []
  const relay = new Relay({ hub, onReply: (_c, x) => got.push(x.text), onPending() {}, onTyping() {}, onSlow() {}, onError: (_c, e) => errs.push(e), pollMs: 1, sleep: async () => {} })
  await relay.run('S', 'x', {})
  assert.deepEqual(got, ['ok'])
  assert.equal(errs.length, 0)
})

test('Relay: un pendiente nuevo se avisa una sola vez', async () => {
  seq = 600
  const u = ev('user', 'x'), a = ev('assistant', 'ya'), r = ev('receipt')
  const p = { id: 'p1', kind: 'permission', tool: 'Bash' }
  const hub = fakeHub([{ events: [] }, { events: [u], pending: [p], status: 'waiting' }, { events: [u], pending: [p], status: 'waiting' }, { events: [u, a, r], status: 'idle' }])
  const pend = []
  const relay = new Relay({ hub, onReply() {}, onPending: (_c, x) => pend.push(x.id), onTyping() {}, onSlow() {}, onError() {}, pollMs: 1, sleep: async () => {} })
  await relay.run('S', 'x', {})
  assert.deepEqual(pend, ['p1'])
})

test('Relay: turno rápido sin recibo (sin herramientas, < 2 s) — se entrega una vez y termina', async () => {
  seq = 700
  const u = ev('user', 'hola'), a = ev('assistant', '¡Hola!')
  const hub = fakeHub([{ events: [] }, { events: [u], status: 'busy' }, { events: [u, a], status: 'idle' }])
  const got = []
  const relay = new Relay({ hub, onReply: (_c, r) => got.push(r.text), onPending() {}, onTyping() {}, onSlow() {}, onError() {}, pollMs: 1, maxMs: 2000, sleep: async () => {} })
  await relay.run('S', 'hola', {})
  assert.deepEqual(got, ['¡Hola!'])
  assert.equal(relay.following('S'), false)
})

const low = (n, kind, text = '') => ({ seq: n, rev: n, t: n, kind, text })

test('Relay: el hub reinicia a mitad de turno y sus seq vuelven a empezar (tras un error)', async () => {
  seq = 800
  const base = ev('info', 'conectada')
  const u1 = ev('user', 'a'), a1 = ev('assistant', 'A'), r1 = ev('receipt'), u2 = ev('user', 'b')
  const after1 = [low(1, 'info'), low(2, 'user', 'a'), low(3, 'assistant', 'A'), low(4, 'receipt'), low(5, 'user', 'b')]
  const after2 = [...after1, low(6, 'assistant', 'B'), low(7, 'receipt')]
  const hub = fakeHub([
    { events: [base] },
    { events: [base, u1, a1, r1, u2], status: 'busy' },
    new Error('ECONNREFUSED'),
    { events: after1, status: 'busy' },
    { events: after2, status: 'idle' },
  ])
  const got = []
  const relay = new Relay({ hub, onReply: (_c, r) => got.push(r.text), onPending() {}, onTyping() {}, onSlow() {}, onError() {}, pollMs: 1, maxMs: 2000, sleep: async () => {} })
  const first = relay.run('S', 'a', {})
  await relay.run('S', 'b', {})
  await first
  assert.deepEqual(got, ['A', 'B'])
})

test('Relay: el hub reinicia entre dos consultas (sin error): se nota por updated', async () => {
  seq = 900
  const base = ev('info', 'conectada')
  const u = ev('user', '​/x hola')
  const after1 = [low(1, 'info'), low(2, 'user', '/x hola')]
  const after2 = [...after1, low(3, 'assistant', 'listo'), low(4, 'receipt')]
  const hub = fakeHub([
    { events: [base], updated: base.rev },
    { events: [base, u], status: 'busy', updated: u.rev },
    { events: after1, status: 'busy', updated: 2 },
    { events: after2, status: 'idle', updated: 4 },
  ])
  const got = []
  const relay = new Relay({ hub, onReply: (_c, r) => got.push(r.text), onPending() {}, onTyping() {}, onSlow() {}, onError() {}, pollMs: 1, maxMs: 2000, sleep: async () => {} })
  await relay.run('S', '​/x hola', {})
  assert.deepEqual(got, ['listo'])
})

test('Relay: resume sigue un turno sin volver a mandar el prompt; avisa inicio y fin', async () => {
  seq = 1000
  const u = ev('user', 'x'), a = ev('assistant', 'ok'), r = ev('receipt')
  const hub = fakeHub([{ events: [u, a, r], status: 'idle' }])
  const got = [], marks = []
  const relay = new Relay({ hub, onReply: (_c, x) => got.push(x.text), onPending() {}, onTyping() {}, onSlow() {}, onError() {}, onEnd: (id, ctx) => marks.push(['end', id, ctx.channel]), pollMs: 1, maxMs: 2000, sleep: async () => {} })
  await relay.resume('S', 1000, { channel: 'app' }, 'x')
  assert.deepEqual(got, ['ok'])
  assert.equal(hub.posted.length, 0)
  assert.deepEqual(marks, [['end', 'S', 'app']])
})

test('Relay: run avisa onStart con afterSeq y texto antes de mandar el prompt', async () => {
  seq = 1100
  const base = ev('info', 'x'), u = ev('user', 'hey'), a = ev('assistant', 'ya'), r = ev('receipt')
  const hub = fakeHub([{ events: [base] }, { events: [base, u, a, r], status: 'idle' }])
  const marks = []
  const relay = new Relay({ hub, onReply() {}, onPending() {}, onTyping() {}, onSlow() {}, onError() {},
    onStart: (id, afterSeq, text) => marks.push(['start', id, afterSeq, text, hub.posted.length]), onEnd: id => marks.push(['end', id]), pollMs: 1, maxMs: 2000, sleep: async () => {} })
  await relay.run('S', 'hey', { channel: 'app' })
  assert.deepEqual(marks, [['start', 'S', base.seq, 'hey', 0], ['end', 'S']])
})
