import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Router, settingsFor, mcpFor, channelOf, labelOf } from '../src/router.mjs'
import { DEFAULTS, patchConfig } from '../src/config.mjs'

const home = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rt-'))
function hub() {
  const h = { list: [], launched: [], closed: [] }
  h.sessions = async () => ({ sessions: h.list })
  h.launch = async b => { h.launched.push(b); const id = b.mode === 'resume' ? b.sessionId : `new${h.launched.length}`; h.list.push({ id, cwd: b.cwd, online: true, status: 'idle', title: 't' }); return { ok: true } }
  h.close = async id => { h.closed.push(id); h.list = h.list.filter(s => s.id !== id) }
  h.get = async () => ({ sessions: h.list.map(s => ({ id: s.id, title: s.title, at: 1 })) })
  return h
}
const mk = (h, dir, cfg = DEFAULTS) => {
  const state = { channels: {}, queue: [], seen: [], activity: [], lastDaily: '' }
  return { r: new Router({ hub: h, config: () => cfg, state, saveState() {}, home: dir, mcpPath: '/x/mcp.mjs', node: '/usr/bin/node', sleep: async () => {}, waitMs: 50, resumeWaitMs: 20 }), state }
}

test('nombres de canal', () => {
  assert.equal(channelOf('51900000001'), 'wa-51900000001')
  assert.equal(labelOf('wa-51900000001'), 'WhatsApp · 900 000 001')
  assert.equal(labelOf('app'), 'App')
})
test('permisos: total permite todo; "pregunta" pone sus herramientas en ask', () => {
  const s = settingsFor(DEFAULTS)
  assert.equal(s.enableAllProjectMcpServers, true)
  assert.deepEqual(s.permissions.ask, [])
  const c = patchConfig(DEFAULTS, { permissions: { total: false, groups: { terminal: 'pregunta', whatsapp: 'pregunta' } } })
  const t = settingsFor(c)
  assert.ok(t.permissions.ask.includes('Bash'))
  assert.ok(t.permissions.ask.includes('mcp__pastor-hub__terminal_run'))
  assert.ok(t.permissions.ask.includes('mcp__pastor-hub__whatsapp_send'))
  assert.ok(!t.permissions.ask.includes('mcp__pastor-hub__whatsapp_send_me'))
})
test('mcpFor lleva el canal y la carpeta del agente', () => {
  const m = mcpFor({ home: '/h', channel: 'app', node: '/n', mcpPath: '/m.mjs' })
  assert.deepEqual(m.mcpServers['pastor-hub'], { type: 'stdio', command: '/n', args: ['/m.mjs'], env: { PASTOR_AGENT_HOME: '/h', PASTOR_AGENT_CHANNEL: 'app' } })
})
test('ensure abre una sesión nueva y la recuerda; después la reutiliza', async () => {
  const h = hub(), d = home(), { r, state } = mk(h, d)
  const id = await r.ensure('app')
  assert.equal(id, 'new1')
  assert.equal(h.launched[0].permissionMode, 'bypassPermissions')
  assert.equal(h.launched[0].trust, true)
  assert.ok(fs.existsSync(path.join(d, 'canales', 'app', 'CLAUDE.md')))
  assert.ok(fs.existsSync(path.join(d, 'canales', 'app', '.mcp.json')))
  assert.equal(state.channels.app.current, 'new1')
  assert.equal(await r.ensure('app'), 'new1')
  assert.equal(h.launched.length, 1)
})
test('ensure retoma la sesión dormida', async () => {
  const h = hub(), d = home(), { r, state } = mk(h, d)
  state.channels.app = { current: 'old', history: [{ id: 'old', at: 1 }], lastActive: 0, lastText: '', lastAt: null }
  assert.equal(await r.ensure('app'), 'old')
  assert.equal(h.launched[0].mode, 'resume')
  assert.equal(h.launched[0].sessionId, 'old')
})
test('newSession cierra la actual y abre otra', async () => {
  const h = hub(), d = home(), { r, state } = mk(h, d)
  await r.ensure('app')
  const id = await r.newSession('app')
  assert.deepEqual(h.closed, ['new1'])
  assert.equal(id, 'new2')
  assert.deepEqual(state.channels.app.history.map(x => x.id), ['new2', 'new1'])
})
test('sleepIdle cierra sesiones inactivas', async () => {
  const h = hub(), d = home(), { r, state } = mk(h, d)
  await r.ensure('app')
  state.channels.app.lastActive = Date.now() - 31 * 60_000
  await r.sleepIdle()
  assert.deepEqual(h.closed, ['new1'])
  assert.equal(state.channels.app.current, 'new1')
})
test('ensure falla si la sesión no se registra a tiempo', async () => {
  const h = hub(); h.launch = async () => ({ ok: true })
  const { r } = mk(h, home())
  await assert.rejects(r.ensure('app'), /no se conectó/)
})

test('ensure adopta una sesión que se registró tarde en la carpeta del canal', async () => {
  const h = hub(), d = home(), { r, state } = mk(h, d)
  h.list.push({ id: 'late', cwd: path.join(d, 'canales', 'app'), online: true, status: 'idle' })
  assert.equal(await r.ensure('app'), 'late')
  assert.equal(h.launched.length, 0)
  assert.equal(state.channels.app.current, 'late')
  assert.deepEqual(state.channels.app.history.map(x => x.id), ['late'])
})
test('ensure no adopta la sesión actual de otro canal', async () => {
  const h = hub(), d = home(), { r, state } = mk(h, d)
  h.list.push({ id: 'other', cwd: path.join(d, 'canales', 'app'), online: true, status: 'idle' })
  state.channels['wa-1'] = { current: 'other', history: [], lastActive: 0, lastText: '', lastAt: null }
  assert.equal(await r.ensure('app'), 'new1')
  assert.equal(h.launched.length, 1)
})
test('antes de retomar, espera a que la sesión vuelva sola', async () => {
  const h = hub(), d = home()
  let calls = 0
  h.sessions = async () => ({ sessions: ++calls >= 3 ? [{ id: 'old', cwd: path.join(d, 'canales', 'app'), online: true, status: 'idle' }] : [] })
  const state = { channels: { app: { current: 'old', history: [{ id: 'old', at: 1 }], lastActive: 0, lastText: '', lastAt: null } }, queue: [], seen: [], activity: [], lastDaily: '' }
  const r = new Router({ hub: h, config: () => DEFAULTS, state, saveState() {}, home: d, mcpPath: '/x', node: '/n', sleep: async () => {}, waitMs: 50, resumeWaitMs: 5000 })
  assert.equal(await r.ensure('app'), 'old')
  assert.equal(h.launched.length, 0)
})
test('si retomar no funciona, abre una nueva una vez y avisa', async () => {
  const h = hub(), d = home(), notes = []
  const launch = h.launch
  h.launch = async b => (b.mode === 'resume' ? (h.launched.push(b), { ok: true }) : launch(b))
  const state = { channels: { app: { current: 'old', history: [{ id: 'old', at: 1 }], lastActive: 0, lastText: '', lastAt: null } }, queue: [], seen: [], activity: [], lastDaily: '' }
  const r = new Router({ hub: h, config: () => DEFAULTS, state, saveState() {}, home: d, mcpPath: '/x', node: '/n', sleep: async () => {}, waitMs: 30, resumeWaitMs: 10, notify: (ch, t) => notes.push([ch, t]) })
  const id = await r.ensure('app')
  assert.notEqual(id, 'old')
  assert.equal(state.channels.app.current, id)
  assert.deepEqual(h.launched.map(b => b.mode), ['resume', 'new'])
  assert.deepEqual(notes, [['app', 'Empecé una conversación nueva porque no pude retomar la anterior']])
})
