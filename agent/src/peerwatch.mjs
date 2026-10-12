// A session of a channel can start a turn nobody on WhatsApp sent: a message
// from a session on another PC (<pastor-message>). Follow that turn too, so
// its answer reaches the channel like any other.
const MARK = '<pastor-message'

export class PeerWatch {
  constructor({ hub, relay, channels, every = 3000, timer = setInterval }) {
    Object.assign(this, { hub, relay, channels, every, timer })
    this.seen = new Map() // sessionId -> last rev looked at
    this.busy = false
  }
  start() { this.timer(() => void this.tick(), this.every) }
  async tick() {
    if (this.busy) return
    this.busy = true
    try {
      for (const { channel, sessionId } of this.channels()) {
        if (!sessionId) continue
        const since = this.seen.get(sessionId)
        let r
        try { r = await this.hub.session(sessionId, since === undefined ? {} : { since }) } catch { continue }
        const events = r?.events ?? []
        const top = Math.max(since ?? 0, ...events.map(e => e.rev ?? e.seq ?? 0))
        this.seen.set(sessionId, top)
        if (since === undefined || this.relay.following(sessionId)) continue
        // includes, not startsWith: the engine may frame a plugin-submitted prompt before the user text
        const hit = events.find(e => e.kind === 'user' && !e.agent && String(e.text ?? '').includes(MARK))
        if (hit) void this.relay.resume(sessionId, hit.seq - 1, { channel, sessionId }, hit.text).catch(() => {})
      }
    } finally { this.busy = false }
  }
}
