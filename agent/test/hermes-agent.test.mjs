import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DEFAULTS } from '../src/config.mjs'
import { hermesAllowed, makeHandlers } from '../src/hermes-agent.mjs'

function hermesHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-'))
  fs.mkdirSync(path.join(dir, 'whatsapp', 'session'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.env'), 'API_SERVER_KEY=k\nWHATSAPP_ALLOWED_USERS=51900000001,51900000002,14925732818991\n')
  fs.writeFileSync(path.join(dir, 'whatsapp', 'session', 'creds.json'), JSON.stringify({ me: { id: '51907698977:1@s.whatsapp.net' } }))
  fs.writeFileSync(path.join(dir, 'whatsapp', 'session', 'lid-mapping-14925732818991_reverse.json'), '"51900000002"')
  return dir
}

function setup() {
  let config = { ...structuredClone(DEFAULTS), backend: 'hermes', hermes: { ...DEFAULTS.hermes, home: hermesHome(), bin: '/x/hermes' }, token: 't', localSecret: 's' }
  const state = { channels: {}, activity: [] }
  const execs = []
  const sent = []
  const client = {
    whatsapp: async () => ({ state: 'connected' }),
    sessions: async () => [{ id: '20261024_wa1', title: 'Pendientes de hoy', preview: '¿qué hay?', last_active: 100, ended_at: null }],
  }
  const chat = { busy: () => false, say: async () => ({ queued: 1 }), chat: async ch => ({ channel: ch }), stop: async () => ({ ok: true }) }
  const h = makeHandlers({
    getConfig: () => config, setConfig: c => { config = c }, state, save() {}, client, chat,
    send: async (...a) => sent.push(a), exec: async (...a) => execs.push(a), now: () => 5000,
  })
  return { h, state, execs, sent, config: () => config }
}

test('hermesAllowed: los números del .env de Hermes, sin los ids LID', () => {
  assert.deepEqual(hermesAllowed({ WHATSAPP_ALLOWED_USERS: '51900000001, 965160971,abc,14925732818991' }, n => n === '14925732818991'), ['51900000001', '51965160971'])
  assert.deepEqual(hermesAllowed({}), [])
})

test('status: canal de la app más los chats de WhatsApp de Hermes, y el número del bot', async () => {
  const { h } = setup()
  const s = await h.status()
  assert.equal(s.backend, 'hermes')
  assert.deepEqual(s.whatsapp, { state: 'connected', me: '51907698977', since: null, qr: false })
  assert.deepEqual(s.channels.map(c => [c.id, c.label, c.lastAt]), [['app', 'App', null], ['h:20261024_wa1', 'WhatsApp · Pendientes de hoy', 100_000]])
})

test('config: sin secretos, los números vienen de Hermes y solo se cambian "activo" y el vigilante', async () => {
  const { h, execs, config } = setup()
  const c = h.getConfig()
  assert.equal(c.token, undefined); assert.equal(c.localSecret, undefined)
  assert.deepEqual(c.allowed, ['51900000001', '51900000002'])
  await h.setConfig({ sleepMinutes: 10, vigilante: { needs: true, to: ['51900000002', '51999999999'] } })
  assert.equal(config().sleepMinutes, DEFAULTS.sleepMinutes)
  assert.deepEqual(config().vigilante.to, ['51900000002'])
  assert.equal(execs.length, 0)
  await h.setConfig({ enabled: false })
  await h.setConfig({ enabled: true })
  assert.deepEqual(execs, [['/x/hermes', ['pause', '--reason', 'Apagado desde pastor']], ['/x/hermes', ['resume']]])
})

test('canales: solo la app y los chats de Hermes; re-vincular se hace en el servidor', async () => {
  const { h } = setup()
  assert.deepEqual(h.channel({ channel: 'app' }), { hermes: 'app' })
  assert.deepEqual(h.channel({ channel: 'h:20261024_wa1' }), { hermes: 'h:20261024_wa1' })
  assert.throws(() => h.channel({ channel: 'wa-51900000001' }), err => err.status === 400)
  assert.throws(() => h.relink(), /hermes whatsapp/)
})

test('decir en la app recuerda el último mensaje del canal', async () => {
  const { h, state } = setup()
  assert.deepEqual(await h.say({ channel: 'app', text: 'hola' }), { queued: 1 })
  assert.deepEqual(state.channels.app, { lastText: 'hola', lastAt: 5000 })
})

test('send (WhatsApp a cualquier número) sale por hermes send y queda en la actividad si no es del dueño', async () => {
  const { h, sent, state } = setup()
  await h.send({ to: '+51 911 111 111', text: 'hola' })
  assert.deepEqual(sent, [['51911111111', 'hola', undefined]])
  assert.match(state.activity[0].text, /51911111111/)
  await assert.rejects(h.send({ to: '123', text: 'x' }), err => err.status === 400)
})
