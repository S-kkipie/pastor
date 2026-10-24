// The app's chat with Hermes: one turn at a time per channel, the turn in flight
// kept here for the app's polling, the history read back from Hermes.
import { isHiddenTool, toChatMessages, toolLabel } from './hermes.mjs'

const APP_SESSION = 'pastor-app'
const APP_STYLE = 'Este mensaje llega desde la app de pastor, no desde WhatsApp: usa Markdown normal (listas con -, títulos, tablas, bloques de código).'
const HISTORY_TTL_MS = 4000
const bad = msg => Object.assign(new Error(msg), { status: 400 })
const lastId = raw => raw.reduce((max, m) => Math.max(max, m.id ?? 0), 0)

// 'app' writes to its own Hermes session; 'h:<id>' is one of Hermes's own chats (WhatsApp), read only.
export function sessionOf(channel) {
  if (channel === 'app') return APP_SESSION
  if (typeof channel === 'string' && channel.startsWith('h:') && channel.length > 2) return channel.slice(2)
  return null
}

export class HermesChat {
  constructor({ client, now = Date.now, onTurnEnd = () => {} }) {
    Object.assign(this, { client, now, onTurnEnd })
    this.channels = new Map()
  }
  st(channel) {
    const sessionId = sessionOf(channel)
    if (!sessionId) throw bad('Canal desconocido')
    if (!this.channels.has(channel)) this.channels.set(channel, { sessionId, live: null, queue: [], running: false, history: null, ready: false })
    return this.channels.get(channel)
  }
  busy(channel) { return this.channels.get(channel)?.running ?? false }

  async say(channel, text) {
    const st = this.st(channel)
    if (channel !== 'app') throw bad('Ese chat es de WhatsApp: contéstale desde WhatsApp')
    const t = String(text ?? '').trim()
    if (!t) throw bad('Mensaje vacío')
    st.queue.push(t)
    if (!st.running) void this.#drain(st)
    return { queued: st.queue.length }
  }

  async #drain(st) {
    st.running = true
    try { while (st.queue.length) await this.#turn(st, st.queue.shift()) }
    finally { st.running = false }
  }

  async #turn(st, text) {
    const live = { user: text, text: '', tools: [], status: 'running', error: undefined, startedAt: this.now(), afterId: 0 }
    st.live = live
    try {
      if (!st.ready) { await this.client.ensureSession(st.sessionId); st.ready = true }
      // What the history already had, so the turn's own messages can be told apart when they land.
      live.afterId = lastId(await this.client.messages(st.sessionId, 1))
      live.runId = await this.client.startRun(st.sessionId, text, APP_STYLE)
      if (live.stopRequested) await this.client.stop(live.runId)
      for await (const ev of this.client.events(live.runId)) this.#apply(live, ev)
      if (live.status === 'running') Object.assign(live, { status: 'failed', error: 'Hermes cortó la respuesta' })
    } catch (err) {
      Object.assign(live, { status: 'failed', error: String(err.message ?? err) })
    }
    st.history = null
    try { this.onTurnEnd(live) } catch { /* the log is best effort */ }
  }

  #apply(live, ev) {
    switch (ev.event) {
      case 'message.delta': live.text += ev.delta ?? ''; break
      case 'tool.started': if (!isHiddenTool(ev.tool)) live.tools.push({ tool: toolLabel(ev.tool), done: false, error: false }); break
      case 'tool.completed': {
        const t = live.tools.find(x => !x.done && x.tool === toolLabel(ev.tool))
        if (t) Object.assign(t, { done: true, error: !!ev.error })
        break
      }
      case 'run.completed': live.status = 'done'; if (!live.text && ev.output) live.text = ev.output; break
      case 'run.failed': Object.assign(live, { status: 'failed', error: ev.error || 'Hermes falló' }); break
      case 'run.cancelled': case 'run.interrupted': live.status = 'stopped'; break
    }
  }

  async stop(channel) {
    const st = this.st(channel)
    st.queue.length = 0
    const live = st.live
    if (!live || live.status !== 'running') return { ok: true }
    live.stopRequested = true
    if (live.runId) await this.client.stop(live.runId)
    return { ok: true }
  }

  async chat(channel) {
    const st = this.st(channel)
    if (!st.history || this.now() - st.history.at > HISTORY_TTL_MS) {
      st.history = { at: this.now(), messages: toChatMessages(await this.client.messages(st.sessionId)) }
    }
    const live = st.live
    // A finished turn shows from the history once Hermes has it there.
    if (live && (live.status === 'done' || live.status === 'stopped') && st.history.messages.some(m => m.id > live.afterId)) st.live = null
    const l = st.live
    return {
      messages: st.history.messages,
      live: l && { user: l.user, text: l.text, tools: l.tools, status: l.status, error: l.error, startedAt: l.startedAt },
      queued: st.queue.length,
      readOnly: channel !== 'app',
    }
  }
}
