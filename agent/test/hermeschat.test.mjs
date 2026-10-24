import test from 'node:test'
import assert from 'node:assert/strict'
import { HermesChat } from '../src/hermeschat.mjs'

// A run's events, fed by the test one at a time.
function feed() {
  const items = []
  let wake = null
  return {
    push(ev) { items.push(ev); wake?.(); wake = null },
    async *[Symbol.asyncIterator]() {
      for (;;) {
        while (items.length) {
          const ev = items.shift()
          if (ev === 'end') return
          yield ev
        }
        await new Promise(r => { wake = r })
      }
    },
  }
}

function fakeClient() {
  const runs = []
  const history = []
  return {
    runs, history, stopped: [], sessions: [],
    async ensureSession(id) { this.sessions.push(id) },
    async startRun(sessionId, input, instructions) { const f = feed(); runs.push({ id: `run_${runs.length + 1}`, sessionId, input, instructions, f }); return `run_${runs.length}` },
    events(runId) { return runs.find(r => r.id === runId).f },
    async stop(runId) { this.stopped.push(runId) },
    async messages() { return history },
  }
}
const tick = () => new Promise(r => setTimeout(r, 0))

test('un turno a la vez por canal; el turno vivo junta texto y herramientas', async () => {
  const c = fakeClient()
  const chat = new HermesChat({ client: c })
  await chat.say('app', 'primero')
  await chat.say('app', 'segundo')
  await tick()
  assert.equal(c.runs.length, 1)
  assert.deepEqual(c.sessions, ['pastor-app'])
  assert.equal(c.runs[0].input, 'primero')
  assert.match(c.runs[0].instructions, /Markdown/)
  c.runs[0].f.push({ event: 'tool.started', tool: 'mcp__pastor_hub__hub_overview', preview: null })
  c.runs[0].f.push({ event: 'tool.completed', tool: 'mcp__pastor_hub__hub_overview', error: false })
  c.runs[0].f.push({ event: 'message.delta', delta: 'Ho' })
  c.runs[0].f.push({ event: 'message.delta', delta: 'la' })
  await tick()
  let st = await chat.chat('app')
  assert.equal(st.live.user, 'primero')
  assert.equal(st.live.text, 'Hola')
  assert.deepEqual(st.live.tools, [{ tool: 'hub_overview', done: true, error: false }])
  assert.equal(st.queued, 1)
  c.history.push({ id: 1, role: 'user', content: 'primero', timestamp: 1 }, { id: 2, role: 'assistant', content: 'Hola', timestamp: 2 })
  c.runs[0].f.push({ event: 'run.completed', output: 'Hola' })
  c.runs[0].f.push('end')
  await tick(); await tick()
  assert.equal(c.runs.length, 2)
  assert.equal(c.runs[1].input, 'segundo')
  st = await chat.chat('app')
  assert.equal(st.live.user, 'segundo')
  assert.deepEqual(st.messages.map(m => m.text), ['primero', 'Hola'])
})

test('un run que falla deja el error a la vista hasta el siguiente mensaje', async () => {
  const c = fakeClient()
  const chat = new HermesChat({ client: c })
  await chat.say('app', 'hola')
  await tick()
  c.runs[0].f.push({ event: 'run.failed', error: 'content_policy_blocked' })
  c.runs[0].f.push('end')
  await tick(); await tick()
  let st = await chat.chat('app')
  assert.equal(st.live.status, 'failed')
  assert.equal(st.live.error, 'content_policy_blocked')
  await chat.say('app', 'otra vez')
  await tick()
  st = await chat.chat('app')
  assert.equal(st.live.status, 'running')
  assert.equal(st.live.error, undefined)
})

test('un stream que se corta sin fin de run cuenta como fallo', async () => {
  const c = fakeClient()
  const chat = new HermesChat({ client: c })
  await chat.say('app', 'hola')
  await tick()
  c.runs[0].f.push('end')
  await tick(); await tick()
  assert.equal((await chat.chat('app')).live.status, 'failed')
})

test('parar: detiene el run en curso y vacía la cola', async () => {
  const c = fakeClient()
  const chat = new HermesChat({ client: c })
  await chat.say('app', 'largo')
  await chat.say('app', 'después')
  await tick()
  await chat.stop('app')
  assert.deepEqual(c.stopped, ['run_1'])
  c.runs[0].f.push({ event: 'run.cancelled' })
  c.runs[0].f.push('end')
  await tick(); await tick()
  assert.equal(c.runs.length, 1)
  assert.equal((await chat.chat('app')).queued, 0)
})

test('los chats de WhatsApp se leen pero no se escriben desde la app', async () => {
  const c = fakeClient()
  c.history.push({ id: 7, role: 'user', content: 'desde el móvil', timestamp: 3 })
  const chat = new HermesChat({ client: c })
  await assert.rejects(chat.say('h:20261024_wa', 'x'), err => err.status === 400)
  const st = await chat.chat('h:20261024_wa')
  assert.equal(st.readOnly, true)
  assert.deepEqual(st.messages.map(m => m.text), ['desde el móvil'])
})
