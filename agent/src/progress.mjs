// What the agent is doing, as one WhatsApp message edited in place while it
// works: the last few tool calls, each with its state, and a clock.
const SHOW = 6
const SKIP = new Set(['TodoWrite'])
const NAMES = { Read: 'Leer', Write: 'Escribir', Edit: 'Editar', MultiEdit: 'Editar', Grep: 'Buscar', Glob: 'Buscar archivos', WebSearch: 'Buscar en la web', WebFetch: 'Abrir web', Agent: 'Subagente', Task: 'Subagente', AskUserQuestion: 'Pregunta' }

const base = f => String(f).split(/[\\/]/).filter(Boolean).at(-1) ?? String(f)
const oneLine = (t, n = 60) => { const s = String(t ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s }

export function toolName(tool) {
  const t = String(tool ?? '')
  const mcp = t.match(/^mcp__(.+?)__(.+)$/)
  if (mcp) return `${mcp[1] === 'pastor-hub' ? 'pastor' : mcp[1]} · ${mcp[2].replace(/_/g, ' ')}`
  return NAMES[t] ?? t
}

export function stepLabel(e) {
  const d = e.detail ?? {}
  if (d.description) return oneLine(d.description)
  if (d.file) return base(d.file)
  return oneLine(String(e.text ?? '').split('\n')[0])
}

// The session's own tool calls after afterSeq, oldest first.
export function toolSteps(events, afterSeq) {
  return events
    .filter(e => e.kind === 'tool' && !e.agent && e.seq > afterSeq && !SKIP.has(e.tool))
    .sort((a, b) => a.seq - b.seq)
    .map(e => ({ seq: e.seq, tool: e.tool, label: stepLabel(e), state: !e.end ? 'run' : e.end.ok === false ? 'err' : 'ok' }))
}

const clock = ms => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }
const MARK = { run: '⏳', ok: '✓', err: '✗' }

export function formatProgress(steps, { ms = 0, done = false } = {}) {
  const errs = steps.filter(s => s.state === 'err').length
  const n = `${steps.length} ${steps.length === 1 ? 'paso' : 'pasos'}`
  const head = !done ? `⚙️ Trabajando… · ${clock(ms)}`
    : `${errs ? '⚠️' : '✓'} Listo · ${n}${errs ? ` (${errs} con error)` : ''} · ${clock(ms)}`
  const shown = steps.slice(-SHOW)
  const lines = shown.map(s => `${done && s.state === 'run' ? '·' : MARK[s.state]} ${toolName(s.tool)}${s.label ? ` · ${s.label}` : ''}`)
  if (steps.length > shown.length) lines.unshift(`… ${steps.length - shown.length} antes`)
  return [head, ...lines].join('\n')
}

// One progress message per stretch of work: sent with the first tool, edited
// (at most every gapMs) as steps come, closed when a reply goes out or the turn
// ends. WhatsApp only edits for 15 minutes: past that a new message follows.
export class Progress {
  constructor({ send, edit, now = Date.now, gapMs = 3000, maxAgeMs = 14 * 60_000, timer = setTimeout, clear = clearTimeout }) {
    Object.assign(this, { send, edit, now, gapMs, maxAgeMs, timer, clear })
    this.from = 0       // steps before this index belong to closed messages
    this.msg = null     // { key, sentAt, text }
    this.steps = []
    this.startedAt = null
    this.lastEdit = 0
    this.pending = null
    this.chain = Promise.resolve()
  }

  run(fn) { this.chain = this.chain.then(fn).catch(() => {}); return this.chain }

  update(steps) {
    this.steps = steps
    if (steps.length <= this.from) return
    this.startedAt ??= this.now()
    const wait = this.lastEdit + this.gapMs - this.now()
    if (this.msg && wait > 0) { this.pending ??= this.timer(() => { this.pending = null; void this.flush(false) }, wait); return }
    return this.flush(false)
  }

  flush(done) {
    return this.run(async () => {
      const mine = this.steps.slice(this.from)
      if (!mine.length) return
      const text = formatProgress(mine, { ms: this.now() - (this.startedAt ?? this.now()), done })
      if (this.msg?.text === text) return
      this.lastEdit = this.now()
      if (this.msg && this.now() - this.msg.sentAt < this.maxAgeMs) {
        try { await this.edit(this.msg.key, text); this.msg.text = text; return } catch { /* too old or gone: send a new one */ }
      }
      const key = await this.send(text)
      this.msg = { key, sentAt: this.now(), text }
    })
  }

  // A reply is going out: this message is finished, later steps get their own.
  async close() {
    if (this.pending) { this.clear(this.pending); this.pending = null }
    if (this.steps.length > this.from) await this.flush(true)
    else await this.chain
    this.from = this.steps.length
    this.msg = null
    this.startedAt = null
  }
}
