// The agent writing first: the hub's alerts (and PCs going offline, and a daily
// summary), each kind only when switched on, to the chosen numbers.
export function alertKind(a) {
  if (a.kind === 'question' || a.kind === 'permission') return 'needs'
  if (String(a.title).startsWith('⚠️')) return 'failures'
  if (String(a.title).startsWith('⏰')) return 'routines'
  return 'done'
}

const NEEDS_HINT = '\n\nResponde aquí: 1 = permitir · 2 = denegar (o el número de la opción).'

export class Vigilante {
  constructor({ hub, config, send, own, setAwaiting, runDaily, onDaily, now = Date.now, needsHint = NEEDS_HINT }) {
    Object.assign(this, { hub, config, send, own, setAwaiting, runDaily, onDaily, now, needsHint })
    this.running = false
    this.since = now()
    this.online = new Map()
    this.lastDaily = ''
  }
  async tick() {
    if (this.running) return
    this.running = true
    try { await this.#tick() } finally { this.running = false }
  }
  async #tick() {
    // Agent switched off: nothing at all (and no backlog of old alerts when it comes back).
    if (!this.config().enabled) { this.since = Math.max(this.since, this.now()); return }
    const v = this.config().vigilante
    const allowed = this.config().allowed
    const to = (v.to.length ? v.to : allowed.slice(0, 1)).filter(n => allowed.includes(n))
    const anyOn = v.needs || v.done || v.failures || v.routines || v.daily
    const prev = this.since
    const fresh = ((await this.hub.alerts(prev).catch(() => ({ alerts: [] }))).alerts ?? []).filter(a => a.t > prev)
    for (const a of fresh) this.since = Math.max(this.since, a.t)
    if (anyOn) {
      for (const a of fresh) {
        try {
          if (this.own().has(a.session)) continue
          const k = alertKind(a)
          if (!v[k]) continue
          const extra = k === 'needs' ? this.needsHint : ''
          for (const n of to) await this.send(n, `${a.title}${a.body ? `\n${a.body}` : ''}${extra}`)
          if (k === 'needs') {
            const d = await this.hub.session(a.session).catch(() => null)
            const p = d?.pending?.[0]
            if (p) for (const n of to) this.setAwaiting(`wa-${n}`, a.session, p)
          }
        } catch { /* one failing alert never stops the others */ }
      }
    }
    const { machines = [] } = await this.hub.sessions().catch(() => ({}))
    for (const m of machines) {
      const was = this.online.get(m.name)
      this.online.set(m.name, m.online)
      if (v.failures && was === true && !m.online) for (const n of to) await this.send(n, `🔌 ${m.name} se desconectó del hub.`)
    }
    if (v.daily) {
      const local = new Date(this.now() - v.tz * 60_000)
      const hhmm = `${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}`
      const day = local.toISOString().slice(0, 10)
      if (hhmm >= v.dailyTime && this.lastDaily !== day) {
        this.lastDaily = day
        try { await this.onDaily?.(day) } catch { /* persisting is best effort */ }
        if (to[0]) void Promise.resolve(this.runDaily(to[0], day)).catch(() => {})
      }
    }
  }
  start(ms = 15_000) { this.timer = setInterval(() => void this.tick().catch(() => {}), ms); return this }
}
