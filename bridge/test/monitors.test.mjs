import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { signHeaders, monitorBody, pickDoneWebhooks, monitoredPeers } from '../monitors.mjs'

test('signHeaders: V2 HMAC sobre "<ts>.<body>"', () => {
  const h = signHeaders('s3cr3t', '{"a":1}', 1700)
  assert.equal(h['content-type'], 'application/json')
  assert.equal(h['X-Webhook-Timestamp'], '1700')
  const want = crypto.createHmac('sha256', 's3cr3t').update('1700.{"a":1}').digest('hex')
  assert.equal(h['X-Webhook-Signature-V2'], want)
})

test('signHeaders: INSECURE_NO_AUTH no firma', () => {
  const h = signHeaders('INSECURE_NO_AUTH', '{}', 1700)
  assert.deepEqual(h, { 'content-type': 'application/json' })
})

test('monitorBody toma los campos del alert', () => {
  assert.deepEqual(
    monitorBody({ id: 'a1', t: 42, session: 'wsl~abc', sessionTitle: 'Mi tarea', machine: 'wsl', body: 'Terminó' }),
    { event_type: 'session.turn_end', session: 'wsl~abc', title: 'Mi tarea', machine: 'wsl', summary: 'Terminó', alert_id: 'a1', t: 42 },
  )
})

const alerts = [
  { id: 'd1', t: 100, kind: 'done', session: 'local1', sessionTitle: 'A', body: 'ok' },
  { id: 'q1', t: 100, kind: 'question', session: 'local1' },      // no es fin de turno
  { id: 'd2', t: 100, kind: 'done', session: 'wsl~x', body: 'y' }, // no monitoreada
  { id: 'd3', t: 100, kind: 'done', session: 'wsl~mon', body: 'z' },
  { id: 'd4', t: 10, kind: 'done', session: 'local1', body: 'viejo' }, // antes de minT
]

test('pickDoneWebhooks: solo done, monitoreadas, sin repetir, no viejas', () => {
  const monitors = new Set(['local1', 'wsl~mon'])
  const got = pickDoneWebhooks(alerts, { monitors, firedIds: new Set(), minT: 50 })
  assert.deepEqual(got.map(f => f.alert.id), ['d1', 'd3'])
  assert.equal(got[0].body.event_type, 'session.turn_end')
})

test('pickDoneWebhooks: firedIds evita el doble aviso', () => {
  const monitors = new Set(['local1', 'wsl~mon'])
  const got = pickDoneWebhooks(alerts, { monitors, firedIds: new Set(['d1']), minT: 50 })
  assert.deepEqual(got.map(f => f.alert.id), ['d3'])
})

test('monitoredPeers: solo PCs con una sesión "<peer>~" monitoreada', () => {
  assert.deepEqual(monitoredPeers(new Set(['local1', 'wsl~mon', 'otra~z']), ['wsl', 'mac']), ['wsl'])
  assert.deepEqual(monitoredPeers(new Set(['local1']), ['wsl', 'mac']), [])
})
