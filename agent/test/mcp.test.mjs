import test from 'node:test'
import assert from 'node:assert/strict'
import { TOOLS, makeHandlers, handleRpc } from '../mcp/tools.mjs'

function fakeHub() {
  const calls = []
  const hub = {
    calls,
    sessions: async () => ({ machines: [{ name: 'servidor', online: true, local: true }, { name: 'pc', online: true }], sessions: [
      { id: 'a', machine: 'servidor', title: 'agente', cwd: '/home/yo/pastor-agent/canales/app', online: true, status: 'idle', pending: 0, agent: true },
      { id: 'pc~b', machine: 'pc', title: 'mi-app', cwd: 'C:/w', online: true, status: 'busy', pending: 1, activity: { tool: 'Bash', text: 'npm test' } },
      { id: 'pc~c', machine: 'pc', title: 'viejo', cwd: 'C:/v', online: false, status: 'idle', pending: 0 },
    ] }),
    session: async id => ({ session: { id, title: 'mi-app', status: 'busy' }, pending: [{ id: 'p1', kind: 'permission', tool: 'Bash', summary: 'rm -rf x' }],
      events: [{ seq: 1, kind: 'user', text: 'arregla' }, { seq: 2, kind: 'tool', tool: 'Bash', text: 'npm test', end: { ok: false } }, { seq: 3, kind: 'assistant', text: 'falla un test' }] }),
    prompt: async (id, text, mode) => { calls.push(['prompt', id, text, mode]); return { ok: true } },
    decide: async (...a) => { calls.push(['decide', ...a]); return { ok: true } },
    abort: async id => { calls.push(['abort', id]) },
    close: async id => { calls.push(['close', id]) },
    get: async (p, q) => { calls.push(['get', p, q]); return { routines: [], ok: true } },
    post: async (p, b) => { calls.push(['post', p, b]); return p === '/api/browser' ? { data: 'AAAA' } : { ok: true, id: 't1', running: false, chunk: 'hola\n', code: 0 } },
    launch: async b => { calls.push(['launch', b]); return { ok: true } },
  }
  return hub
}
const local = { sent: [], acts: [], send: async b => { local.sent.push(b); return { ok: true } }, activity: async e => { local.acts.push(e) } }
const H = () => makeHandlers({ hub: fakeHub(), local, channel: 'wa-51900000002', owner: ['51900000001', '51900000002'] })

test('lista de herramientas completa', () => {
  const names = TOOLS.map(t => t.name)
  for (const n of ['hub_overview', 'projects_list', 'sessions_list', 'session_read', 'session_prompt', 'session_launch', 'session_decide', 'session_stop', 'session_close',
    'routines_list', 'routine_save', 'routine_run', 'routine_toggle', 'routine_delete', 'git_status', 'files_read', 'terminal_run', 'browser_look', 'previews_list',
    'whatsapp_send_me', 'whatsapp_send']) assert.ok(names.includes(n), n)
  for (const t of TOOLS) assert.equal(t.inputSchema.type, 'object')
})
test('hub_overview resume y oculta las sesiones del agente', async () => {
  const [c] = await H().hub_overview({})
  assert.match(c.text, /mi-app/); assert.match(c.text, /1 pendiente/); assert.doesNotMatch(c.text, /canales\/app/)
})
test('session_read muestra pasos y pendientes', async () => {
  const [c] = await H().session_read({ id: 'pc~b' })
  assert.match(c.text, /falla un test/); assert.match(c.text, /p1/); assert.match(c.text, /rm -rf x/)
})
test('session_prompt y session_decide llaman al hub y registran actividad', async () => {
  const h = fakeHub(), hs = makeHandlers({ hub: h, local, channel: 'app', owner: ['51900000001'] })
  await hs.session_prompt({ id: 'pc~b', text: 'sigue' })
  await hs.session_decide({ id: 'pc~b', pendingId: 'p1', decision: 'allow' })
  assert.deepEqual(h.calls[0], ['prompt', 'pc~b', 'sigue', 'queue'])
  assert.deepEqual(h.calls[1], ['decide', 'pc~b', 'p1', 'allow', undefined])
  assert.ok(local.acts.length >= 2)
})
test('whatsapp_send_me va al número del canal; whatsapp_send a cualquiera', async () => {
  local.sent.length = 0
  await H().whatsapp_send_me({ text: 'hola' })
  await H().whatsapp_send({ to: '+51 999 888 777', text: 'buenas' })
  assert.deepEqual(local.sent, [{ to: '51900000002', text: 'hola' }, { to: '51999888777', text: 'buenas' }])
})
test('browser_look devuelve una imagen', async () => {
  const h = fakeHub()
  h.get = async () => ({ browsers: [{ port: 9333, pages: [{ id: 'P', url: 'http://x' }] }] })
  const out = await makeHandlers({ hub: h, local, channel: 'app', owner: [] }).browser_look({ session: 'pc~b' })
  assert.deepEqual(out[0], { type: 'image', data: 'AAAA', mimeType: 'image/jpeg' })
})
test('protocolo: initialize, tools/list, tools/call, error de herramienta', async () => {
  const hs = H()
  const init = await handleRpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, hs)
  assert.equal(init.result.serverInfo.name, 'pastor-hub'); assert.equal(init.result.protocolVersion, '2025-06-18')
  assert.equal(await handleRpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, hs), null)
  const list = await handleRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, hs)
  assert.ok(list.result.tools.length >= 21)
  const bad = await handleRpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'session_read', arguments: {} } }, { session_read: async () => { throw new Error('falta id') } })
  assert.equal(bad.result.isError, true); assert.match(bad.result.content[0].text, /falta id/)
  const unknown = await handleRpc({ jsonrpc: '2.0', id: 4, method: 'nope' }, hs)
  assert.equal(unknown.error.code, -32601)
})
