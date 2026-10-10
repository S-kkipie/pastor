import test from 'node:test'
import assert from 'node:assert/strict'
import { alertKind, Vigilante } from '../src/vigilante.mjs'
import { DEFAULTS, patchConfig } from '../src/config.mjs'

test('alertKind', () => {
  assert.equal(alertKind({ kind: 'question', title: '❓ x' }), 'needs')
  assert.equal(alertKind({ kind: 'permission', title: '🔐 x' }), 'needs')
  assert.equal(alertKind({ kind: 'done', title: '⏰ Resumen' }), 'routines')
  assert.equal(alertKind({ kind: 'done', title: '⚠️ Rutina "x" no arrancó' }), 'failures')
  assert.equal(alertKind({ kind: 'done', title: '✅ mi-app' }), 'done')
})

const BASE = patchConfig(DEFAULTS, { allowed: ['51900000001', '51900000002'], vigilante: { to: ['51900000001'] } })

function hub(alerts, machines = [{ name: 'pc', online: true }]) {
  return { alerts: async () => ({ alerts }), sessions: async () => ({ sessions: [], machines }), session: async () => ({ pending: [{ id: 'p9', kind: 'permission', tool: 'Bash' }] }) }
}

test('apagado no manda nada; encendido manda solo lo activado y no lo propio', async () => {
  const sent = []
  const alerts = [{ t: 10, session: 'pc~a', kind: 'done', title: '✅ A', body: 'listo' }, { t: 11, session: 'own', kind: 'done', title: '✅ B', body: '' }, { t: 12, session: 'pc~c', kind: 'question', title: '❓ C', body: '¿?' }]
  const off = new Vigilante({ hub: hub(alerts), config: () => DEFAULTS, send: async (n, t) => sent.push([n, t]), own: () => new Set(['own']), setAwaiting() {}, runDaily() {}, now: () => 1000 })
  await off.tick(); assert.equal(sent.length, 0)
  const awaiting = []
  const cfg = patchConfig(BASE, { vigilante: { done: true, needs: true, to: ['51900000001'] } })
  const on = new Vigilante({ hub: hub(alerts), config: () => cfg, send: async (n, t) => sent.push([n, t]), own: () => new Set(['own']), setAwaiting: (...a) => awaiting.push(a), runDaily() {}, now: () => 1000 })
  on.since = 0
  await on.tick()
  assert.deepEqual(sent.map(s => s[0]), ['51900000001', '51900000001'])
  assert.match(sent[0][1], /✅ A/); assert.match(sent[1][1], /❓ C/)
  assert.deepEqual(awaiting[0].slice(0, 2), ['wa-51900000001', 'pc~c'])
  sent.length = 0; await on.tick(); assert.equal(sent.length, 0) // no repite
})

test('agente apagado: el vigilante no hace nada; un aviso que falla no frena los demás', async () => {
  const alerts = [{ t: 10, session: 'x~a', kind: 'done', title: '✅ A', body: '' }, { t: 11, session: 'x~b', kind: 'done', title: '✅ B', body: '' }]
  const sent = []
  const off = { ...patchConfig(BASE, { vigilante: { done: true } }), enabled: false }
  const v = new Vigilante({ hub: hub(alerts), config: () => off, send: async (n, t) => sent.push(t), own: () => new Set(), setAwaiting() {}, runDaily() {}, now: () => 1000 })
  v.since = 0
  await v.tick()
  assert.equal(sent.length, 0)
  const on = patchConfig(BASE, { vigilante: { done: true } })
  const w = new Vigilante({ hub: hub(alerts), config: () => on, send: async (n, t) => { if (/A/.test(t)) throw new Error('wa'); sent.push(t) }, own: () => new Set(), setAwaiting() {}, runDaily() {}, now: () => 1000 })
  w.since = 0
  await w.tick()
  assert.deepEqual(sent, ['✅ B'])
})

test('PC que se desconecta avisa si "fallos" está activo', async () => {
  const sent = []
  const cfg = patchConfig(BASE, { vigilante: { failures: true } })
  const machines = [{ name: 'pc', online: true }]
  const h = hub([], machines)
  const v = new Vigilante({ hub: h, config: () => cfg, send: async (n, t) => sent.push(t), own: () => new Set(), setAwaiting() {}, runDaily() {}, now: () => 1 })
  await v.tick()
  machines[0].online = false
  await v.tick()
  assert.match(sent[0], /pc se desconectó/)
})

test('resumen diario: persiste el día local y no se repite tras reiniciar', async () => {
  const cfg = patchConfig(BASE, { vigilante: { daily: true, dailyTime: '21:00', tz: 300, to: ['51900000001'] } })
  // 03:00 UTC del 11 = 22:00 del día 10 en tz 300
  let t = Date.UTC(2026, 9, 11, 3, 0)
  const mk = (lastDaily, ran, saved) => {
    const v = new Vigilante({ hub: hub([]), config: () => cfg, send: async () => {}, own: () => new Set(), setAwaiting() {}, runDaily: n => ran.push(n), onDaily: d => saved.push(d), now: () => t })
    v.lastDaily = lastDaily
    return v
  }
  const ran = [], saved = []
  await mk('', ran, saved).tick()
  assert.equal(ran.length, 1); assert.deepEqual(saved, ['2026-10-10'])
  const ran2 = []
  await mk('2026-10-10', ran2, []).tick()
  assert.equal(ran2.length, 0)
  t += 24 * 3600_000
  await mk('2026-10-10', ran2, []).tick()
  assert.equal(ran2.length, 1)
})
