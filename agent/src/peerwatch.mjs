// A session of a channel can start a turn nobody on WhatsApp sent: a message
// from a session on another PC (<pastor-message>). Follow that turn too, so
// its answer reaches the channel like any other.
const MARK = '<pastor-message'

export class PeerWatch {
  // wake(channel): a message waits for the channel's session while it sleeps
  // (the hub flags it `wake`): resume it so the message gets delivered.
  constructor({ hub, relay, channels, wake = null, every = 3000, timer = setInterval }) {
    Object.assign(this, { hub, relay, channels, wake, every, timer })
    this.seen = new Map() // sessionId -> last rev looked at
    this.woken = new Set() // sessionIds woken while their `wake` flag is still up
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
        this.checkWake(channel, sessionId, r?.session)
        const events = r?.events ?? []
        // The hub numbers events in memory: after it restarts its counter is
        // below ours. Start over from where it is now (like the relay does).
        const top = Math.max(-1, Number(r?.session?.updated ?? -1), ...events.map(e => e.rev ?? e.seq ?? 0))
        if (since !== undefined && top >= 0 && top < since) { this.seen.delete(sessionId); continue }
        this.seen.set(sessionId, Math.max(since ?? 0, top))
        if (since === undefined || this.relay.following(sessionId)) continue
        // includes, not startsWith: the engine may frame a plugin-submitted prompt before the user text
        const hit = events.find(e => e.kind === 'user' && !e.agent && String(e.text ?? '').includes(MARK))
        if (hit) void this.relay.resume(sessionId, hit.seq - 1, { channel, sessionId }, hit.text).catch(() => {})
      }
    } finally { this.busy = false }
  }
  checkWake(channel, sessionId, s) {
    if (!s?.wake) { this.woken.delete(sessionId); return }
    if (s.online !== false || !this.wake || this.woken.has(sessionId)) return
    this.woken.add(sessionId)
    void Promise.resolve().then(() => this.wake(channel)).catch(() => {})
  }
}
