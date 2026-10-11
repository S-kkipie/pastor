// pastor-agent: WhatsApp ⇄ the agent's Claude Code sessions, through the hub.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { HELP, asPlain, parseCommand } from './commands.mjs'
import { loadConfig, loadState, patchConfig, paths, saveConfig, saveState } from './config.mjs'
import { formatPending, parseReply } from './decisions.mjs'
import { classify, promptFor } from './filter.mjs'
import { splitMessage, toWhatsApp } from './format.mjs'
import { HubClient } from './hub.mjs'
import { Progress } from './progress.mjs'
import { Relay } from './relay.mjs'
import { Router, channelOf, labelOf } from './router.mjs'
import { startServer } from './server.mjs'
import { Vigilante } from './vigilante.mjs'
import { WhatsApp } from './whatsapp.mjs'

process.on('unhandledRejection', err => console.error('unhandledRejection', err))
const P = paths()
let config = loadConfig()
const state = loadState()
const save = () => saveState(state)
const hub = new HubClient({ base: config.hub, token: config.token })
const wa = new WhatsApp({ sessionDir: P.session })
const router = new Router({ hub, config: () => config, state, saveState: save, home: P.home, mcpPath: fileURLToPath(new URL('../mcp/pastor-hub.mjs', import.meta.url)), notify: (ch, t) => say(ch, t) })
// channel → { sessionId, pending }, kept in state.json so a restart still takes the answer.
const awaiting = {
  get: ch => state.awaiting[ch],
  set(ch, sessionId, pending) { state.awaiting[ch] = { sessionId, pending }; save() },
  delete(ch) { delete state.awaiting[ch]; save() },
}
const chains = new Map()   // channel → Promise (one message at a time per channel)
const numberOf = ch => (ch.startsWith('wa-') ? ch.slice(3) : null)

// Everything that may open a channel's session goes through its chain, in order.
function enqueue(ch, fn) {
  const next = (chains.get(ch) ?? Promise.resolve()).then(fn)
  chains.set(ch, next.catch(err => console.error('chain', ch, err)))
  return next
}

function logActivity(kind, text) {
  state.activity = [{ at: Date.now(), kind, text: String(text).slice(0, 300) }, ...state.activity].slice(0, 200)
  save()
}
async function say(ch, text) {
  const n = numberOf(ch)
  if (!n || !String(text ?? '').trim()) return
  for (const part of splitMessage(toWhatsApp(text))) await wa.sendText(n, part)
  state.channels[ch] && Object.assign(state.channels[ch], { lastText: String(text).slice(0, 200), lastAt: Date.now() })
  save()
}

const typingState = new Map() // channel → last typing state sent
// channel → the message showing the tool calls of the turn in progress.
const progress = new Map()
function progressOf(ch) {
  const n = numberOf(ch)
  if (!n) return null
  if (!progress.has(ch)) progress.set(ch, new Progress({ send: t => wa.sendText(n, t).then(m => m?.key), edit: (key, t) => wa.editText(n, key, t) }))
  return progress.get(ch)
}
const closeProgress = ch => progress.get(ch)?.close()
const relay = new Relay({
  hub,
  onProgress: async (ctx, steps) => { await progressOf(ctx.channel)?.update(steps) },
  onReply: async (ctx, r) => {
    await closeProgress(ctx.channel)
    await say(ctx.channel, r.text)
    // Only what the agent wrote in its own salidas/ folder goes out as a file.
    const out = path.resolve(router.dir(ctx.channel), 'salidas') + path.sep
    for (const f of r.files) if (path.resolve(f).startsWith(out) && fs.existsSync(f) && numberOf(ctx.channel)) await wa.sendFile(numberOf(ctx.channel), f).catch(() => {})
  },
  onPending: async (ctx, p) => { await closeProgress(ctx.channel); awaiting.set(ctx.channel, ctx.sessionId, p); await say(ctx.channel, formatPending(p)) },
  onTyping: async (ctx, on) => { const n = numberOf(ctx.channel); if (!n || typingState.get(ctx.channel) === !!on) return; typingState.set(ctx.channel, !!on); await wa.typing(n, on) },
  onSlow: async ctx => { if (!progress.get(ctx.channel)?.msg) await say(ctx.channel, '⏳ En eso…') },
  onError: (_ctx, err) => console.error('relay', err),
  // A turn in flight is on disk until it ends, so a restart picks it up again.
  onStart: (sessionId, afterSeq, text, ctx) => { state.inflight[sessionId] = { channel: ctx.channel, afterSeq, text }; save() },
  onEnd: (sessionId, ctx) => {
    delete state.inflight[sessionId]; save()
    const p = progress.get(ctx.channel)
    if (p) { progress.delete(ctx.channel); void p.close() }
  },
})
for (const [sessionId, f] of Object.entries(state.inflight)) {
  void relay.resume(sessionId, f.afterSeq, { channel: f.channel, sessionId }, f.text).catch(err => console.error('resume', err))
}

// A message that could not reach the session: one retry, then a warning.
function failed(item) {
  if ((item.tries ?? 1) >= 2) return say(item.channel, '⚠️ No pude abrir mi sesión; vuelve a escribirme en un rato.')
  state.queue.push(item); save()
  return say(item.channel, '⚠️ No pude abrir mi sesión. Reintento en un minuto.')
}
async function deliver(item) {
  let sessionId
  try { sessionId = await router.ensure(item.channel) } catch { return failed(item) }
  try { await relay.run(sessionId, item.text, { channel: item.channel, sessionId }) } catch { return failed(item) }
}

async function command(ch, cmd) {
  const st = router.st(ch)
  if (cmd.name === 'help') return say(ch, HELP)
  if (cmd.name === 'status') {
    const live = await router.liveMap().catch(() => new Map())
    const s = st.current && live.get(st.current)
    return say(ch, `🤖 Agente ${config.enabled ? 'activo' : 'apagado'} · WhatsApp ${wa.state}\nConversación: ${s ? `${s.title} (${s.status})` : st.current ? 'dormida' : 'ninguna'}`)
  }
  if (cmd.name === 'stop') { if (st.current) await hub.abort(st.current).catch(() => {}); return say(ch, '⏹ Interrumpido.') }
  if (cmd.name === 'new') { await say(ch, '🆕 Abriendo una conversación nueva…'); await router.newSession(ch); return say(ch, 'Lista. ¿Qué necesitas?') }
  if (cmd.name === 'sessions') {
    const list = await router.list(ch)
    return say(ch, list.length ? `*Tus conversaciones*\n${list.map((x, i) => `${i + 1}. ${x.title}${x.id === st.current ? ' ← actual' : ''}`).join('\n')}\n\nUsa /resume N` : 'Aún no hay conversaciones.')
  }
  if (cmd.name === 'resume') {
    const n = Number(cmd.arg)
    if (!Number.isInteger(n) || n < 1) return say(ch, 'Usa /resume N (mira /sessions).')
    await router.resume(ch, n)
    return say(ch, '↩️ Retomada.')
  }
}

async function inbound(m) {
  const ch = channelOf(m.from)
  router.st(ch)
  if (!config.enabled) { if (/^\/status\b/i.test(m.text)) await say(ch, '🤖 Estoy apagado. Enciéndeme desde pastor.'); return }
  const cmd = parseCommand(m.text)
  if (cmd) { try { await command(ch, cmd) } catch (err) { await say(ch, `⚠️ ${err.message}`) } return }
  const wait = awaiting.get(ch)
  if (wait && !m.media) {
    // The question may have been answered elsewhere (the app): only a still-pending one takes this message.
    let timer
    const d0 = await Promise.race([hub.session(wait.sessionId).catch(() => null), new Promise(r => { timer = setTimeout(() => r(null), 5000) })])
    clearTimeout(timer)
    const stale = d0 && !(d0.pending ?? []).some(p => p.id === wait.pending.id)
    if (stale) awaiting.delete(ch)
    else {
      const d = parseReply(wait.pending, m.text)
      if (d) {
        awaiting.delete(ch)
        try { await hub.decide(wait.sessionId, wait.pending.id, d.decision, d.answers); await say(ch, d.decision === 'allow' ? '✓' : '✗ Denegado'); return }
        catch { /* resolved meanwhile: treat it as a normal message */ }
      }
    }
  }
  if (m.media === 'audio') return say(ch, '🎙️ Aún no entiendo notas de voz. Escríbeme, porfa.')
  let saved = null
  if (m.media) {
    try {
      const day = new Date().toISOString().slice(0, 10)
      const dir = path.join(P.uploads, day)
      fs.mkdirSync(dir, { recursive: true })
      const ext = m.fileName ? path.extname(m.fileName) : m.media === 'image' ? '.jpg' : m.media === 'video' ? '.mp4' : m.media === 'sticker' ? '.webp' : ''
      saved = path.join(dir, `${String(m.id).replace(/[^\w-]/g, '')}${ext}`)
      fs.writeFileSync(saved, await wa.download(m.raw))
    } catch { saved = null }
    if (!saved && !String(m.text ?? '').trim()) return say(ch, 'No pude descargar el archivo, ¿me lo reenvías?')
  }
  const raw = promptFor(m, saved)
  if (!raw) return
  const text = asPlain(raw)
  router.touch(ch)
  router.st(ch).lastText = raw.slice(0, 200); router.st(ch).lastAt = Date.now(); save()
  await deliver({ channel: ch, text, at: Date.now(), tries: 1 })
}

wa.on('message', raw => {
  const m = classify(raw, config.allowed, P.session, config.lidAliases)
  if (!m) {
    const k = raw?.key ?? {}
    if (raw?.message && !k.fromMe && !/@(g\.us|broadcast|newsletter)$/.test(String(k.remoteJid ?? ''))) console.log(`ignored dm from ${k.remoteJid} alt ${k.remoteJidAlt ?? '-'}`)
    return
  }
  if (!m.id || state.seen.includes(m.id)) return
  state.seen = [m.id, ...state.seen].slice(0, 500); save()
  const ch = channelOf(m.from)
  // A message that arrives while the session works goes straight in (queued by the hub); others wait their turn.
  if (router.st(ch).current && relay.following(router.st(ch).current)) chains.set(ch, inbound(m).catch(err => console.error('inbound', err)))
  else enqueue(ch, () => inbound(m)).catch(() => {})
})

// Retry what could not be delivered, put idle sessions to sleep.
let retrying = false
setInterval(async () => {
  if (config.enabled && !retrying && state.queue.length) {
    retrying = true
    const q = state.queue.splice(0); save()
    try { await Promise.allSettled(q.map(item => enqueue(item.channel, () => deliver({ ...item, tries: (item.tries ?? 1) + 1 })))) }
    finally { retrying = false }
  }
  await router.sleepIdle().catch(() => {})
}, 60_000)

const vigilante = new Vigilante({
  hub, config: () => config,
  send: (n, t) => say(channelOf(n), t),
  own: () => new Set(Object.values(state.channels).map(c => c.current).filter(Boolean)),
  setAwaiting: (ch, sessionId, pending) => awaiting.set(ch, sessionId, pending),
  runDaily: n => enqueue(channelOf(n), async () => {
    const ch = channelOf(n)
    const id = await router.ensure(ch)
    await relay.run(id, 'Haz mi resumen diario: qué se hizo hoy en todas mis PCs (usa hub_overview, sessions_list y routines_list), qué quedó pendiente y qué necesita mi atención. Corto, para WhatsApp.', { channel: ch, sessionId: id })
  }),
  onDaily: day => { state.lastDaily = day; save() },
})
vigilante.lastDaily = state.lastDaily
vigilante.start()

startServer({
  port: config.port, secret: config.localSecret,
  handlers: {
    async status() {
      const live = await router.liveMap().catch(() => new Map())
      const chans = [...config.allowed.map(channelOf), 'app'].map(id => {
        const st = state.channels[id] ?? {}
        const s = st.current ? live.get(st.current) : null
        return { id, label: labelOf(id), sessionId: st.current ?? null, online: !!s, busy: s?.status === 'busy', lastText: st.lastText ?? '', lastAt: st.lastAt ?? null }
      })
      return { enabled: config.enabled, whatsapp: { state: wa.state, me: wa.me, since: wa.since, qr: !!wa.qr }, channels: chans }
    },
    getConfig: () => ({ ...config, token: undefined, localSecret: undefined }),
    async setConfig(patch) {
      const before = JSON.stringify(config.permissions)
      config = patchConfig(config, patch); saveConfig(config)
      if (JSON.stringify(config.permissions) !== before) await router.applyPermissions().catch(() => {})
      return { ...config, token: undefined, localSecret: undefined }
    },
    activity: () => state.activity,
    qr: async () => ({ dataUrl: await wa.qrDataUrl(), state: wa.state }),
    async send({ to, text, file }) {
      const n = String(to ?? '').replace(/\D/g, '')
      if (n.length < 10) throw Object.assign(new Error('Número inválido'), { status: 400 })
      if (file && !fs.existsSync(file)) throw Object.assign(new Error('No existe el archivo'), { status: 400 })
      if (text) for (const part of splitMessage(toWhatsApp(text))) await wa.sendText(n, part)
      if (file) await wa.sendFile(n, file)
      fs.appendFileSync(P.sentLog, `${new Date().toISOString()}\t${n}\t${String(text ?? '').replace(/\s+/g, ' ').slice(0, 200)}\t${file ?? ''}\n`)
      if (!config.allowed.includes(n)) logActivity('whatsapp', `Le escribió a ${n}: ${String(text ?? file).slice(0, 120)}`)
      return { ok: true }
    },
    logActivity: e => { logActivity(String(e.kind ?? 'otro'), e.text ?? ''); return { ok: true } },
    async channel({ channel }) {
      if (channel !== 'app' && !config.allowed.map(channelOf).includes(channel)) throw Object.assign(new Error('Canal desconocido'), { status: 400 })
      const cur = router.st(channel).current
      if (cur && relay.following(cur)) return { sessionId: cur } // live and working: no need to wait its turn
      return { sessionId: await enqueue(channel, () => router.ensure(channel)) }
    },
    async relink() { await wa.relink(); return { ok: true } },
  },
})

wa.restart(0) // the guarded path: a failing first start retries
console.log(`pastor-agent en 127.0.0.1:${config.port}`)
