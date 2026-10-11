import test from 'node:test'
import assert from 'node:assert/strict'
import { Progress, formatProgress, toolName, toolSteps } from '../src/progress.mjs'

const tool = (seq, tool, extra = {}) => ({ seq, kind: 'tool', tool, text: 'ffprobe -v error x.mp4', ...extra })

test('toolSteps: solo las herramientas propias del turno, con su estado', () => {
  const ev = [
    tool(3, 'Bash', { detail: { description: 'Medir el video' }, end: { ok: true } }),
    tool(1, 'Bash'),
    tool(4, 'Write', { detail: { file: '/home/x/salidas/cover.mp4' }, end: { ok: false } }),
    tool(5, 'Read', { agent: 'a1' }),
    tool(6, 'TodoWrite'),
    tool(7, 'mcp__pastor-hub__sessions_list'),
    { seq: 8, kind: 'assistant', text: 'hola' },
  ]
  const s = toolSteps(ev, 2)
  assert.deepEqual(s.map(x => [x.seq, x.state, x.label]), [[3, 'ok', 'Medir el video'], [4, 'err', 'cover.mp4'], [7, 'run', 'ffprobe -v error x.mp4']])
  assert.equal(toolName('mcp__pastor-hub__sessions_list'), 'pastor · sessions list')
  assert.equal(toolName('Read'), 'Leer')
})

test('formatProgress: reloj, últimas 6 y cierre', () => {
  const steps = Array.from({ length: 8 }, (_, i) => ({ seq: i, tool: 'Bash', label: `paso ${i}`, state: i === 7 ? 'run' : 'ok' }))
  const live = formatProgress(steps, { ms: 80_000 })
  assert.match(live, /^⚙️ Trabajando… · 1:20/)
  assert.match(live, /… 2 antes/)
  assert.match(live, /⏳ Bash · paso 7$/)
  assert.ok(!live.includes('paso 1\n'))
  steps[3].state = 'err'
  const done = formatProgress(steps, { ms: 130_000, done: true })
  assert.match(done, /^⚠️ Listo · 8 pasos \(1 con error\) · 2:10/)
  assert.ok(!done.includes('⏳'))
})

function fake() {
  let t = 0
  const log = []
  const timers = []
  const p = new Progress({
    now: () => t,
    send: async text => { log.push(['send', text]); return `k${log.length}` },
    edit: async (key, text) => { log.push(['edit', key, text]) },
    timer: (fn, ms) => { timers.push(fn); return timers.length },
    clear: () => {},
  })
  return { p, log, timers, tick: ms => { t += ms } }
}
const step = (seq, state = 'run') => ({ seq, tool: 'Bash', label: `s${seq}`, state })

test('Progress: un mensaje que se edita, con pausa entre ediciones', async () => {
  const { p, log, timers, tick } = fake()
  await p.update([step(1)])
  assert.equal(log.length, 1); assert.equal(log[0][0], 'send')
  tick(1000); await p.update([step(1, 'ok'), step(2)])
  assert.equal(log.length, 1, 'muy pronto: espera')
  assert.equal(timers.length, 1)
  tick(2500); timers[0](); await p.chain
  assert.equal(log.at(-1)[0], 'edit'); assert.equal(log.at(-1)[1], 'k1')
  await p.close()
  assert.match(log.at(-1)[2], /^✓ Listo · 2 pasos/)
})

test('Progress: tras una respuesta, los pasos nuevos van en otro mensaje', async () => {
  const { p, log, tick } = fake()
  await p.update([step(1, 'ok')])
  await p.close()
  const sends = () => log.filter(x => x[0] === 'send').length
  assert.equal(sends(), 1)
  tick(5000); await p.update([step(1, 'ok'), step(2)])
  assert.equal(sends(), 2)
  assert.match(log.at(-1)[1], /s2/); assert.ok(!log.at(-1)[1].includes('s1'))
})

test('Progress: si editar falla, manda uno nuevo', async () => {
  const { p, log, tick } = fake()
  p.edit = async () => { throw new Error('viejo') }
  await p.update([step(1)])
  tick(5000); await p.update([step(1, 'ok'), step(2)])
  assert.equal(log.filter(x => x[0] === 'send').length, 2)
})
