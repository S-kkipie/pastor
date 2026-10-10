// Sends a prompt to a session and follows it until it is quiet again: each
// finished turn (a receipt event) becomes one reply; a new pending permission
// or question is handed over once.
const OUT_FILE = /\.(html?|png|jpe?g|webp|gif|pdf)$/i

const writtenFiles = turn => [...new Set(turn.filter(e => e.kind === 'tool' && e.tool === 'Write' && e.end?.ok && OUT_FILE.test(e.detail?.file ?? '')).map(e => e.detail.file))]
const ownEvents = (events, afterSeq) => events.filter(e => e.seq > afterSeq && !e.agent).sort((a, b) => a.seq - b.seq)

export function replies(events, afterSeq) {
  const ev = ownEvents(events, afterSeq)
  const out = []
  let start = 0
  for (let i = 0; i < ev.length; i++) {
    if (ev[i].kind !== 'receipt') continue
    const turn = ev.slice(start, i)
    const said = turn.filter(e => e.kind === 'assistant' && String(e.text ?? '').trim())
    out.push({ seq: ev[i].seq, text: said.at(-1)?.text ?? '', files: writtenFiles(turn) })
    start = i + 1
  }
  const lastUser = ev.filter(e => e.kind === 'user').at(-1)
  const lastReceipt = ev.filter(e => e.kind === 'receipt').at(-1)
  const idle = !!lastReceipt && (!lastUser || lastReceipt.seq > lastUser.seq)
  return { replies: out, idle }
}

// A quick turn (no tools, under 2 s) gets no receipt from the mod: its reply is
// the last assistant text after the last user message.
export function lastAnswer(events, afterSeq) {
  const ev = ownEvents(events, afterSeq)
  const u = ev.findLastIndex(e => e.kind === 'user')
  if (u < 0) return null
  const turn = ev.slice(u + 1)
  const said = turn.filter(e => e.kind === 'assistant' && String(e.text ?? '').trim()).at(-1)
  return said ? { seq: said.seq, text: said.text, files: writtenFiles(turn) } : null
}

const plain = t => String(t ?? '').replace(/​/g, '').trim()
const pause = ms => new Promise(r => setTimeout(r, ms))

export class Relay {
  constructor({ hub, onReply, onPending, onTyping, onSlow, onError, onStart, onEnd, pollMs = 1500, slowMs = 60_000, maxMs = 30 * 60_000, sleep = pause }) {
    Object.assign(this, { hub, onReply, onPending, onTyping, onSlow, onError, onStart, onEnd, pollMs, slowMs, maxMs, sleep })
    this.followers = new Map() // sessionId → Promise
    this.texts = new Map()     // sessionId → prompts sent while following (to find our turn again)
  }
  following(id) { return this.followers.has(id) }

  // The follower is registered before any await, so a second message that
  // arrives a moment later joins it instead of starting another one.
  async run(sessionId, text, ctx) {
    const existing = this.followers.get(sessionId)
    if (existing) { await this.hub.prompt(sessionId, text, 'queue'); this.texts.get(sessionId)?.push(text); return existing }
    let open, fail
    const gate = new Promise((res, rej) => { open = res; fail = rej })
    const p = this.track(sessionId, ctx, text, gate)
    try {
      const d = await this.hub.session(sessionId, { limit: 10 })
      const afterSeq = Math.max(0, ...(d.events ?? []).map(e => e.seq))
      try { this.onStart?.(sessionId, afterSeq, text, ctx) } catch (err) { this.onError?.(ctx, err) }
      await this.hub.prompt(sessionId, text, 'queue')
      open(afterSeq)
    } catch (err) { fail(err) }
    return p
  }

  // Follow a turn already sent (pastor-agent restarted mid-turn): nothing is posted.
  resume(sessionId, afterSeq, ctx, text) {
    return this.followers.get(sessionId) ?? this.track(sessionId, ctx, text, Promise.resolve(afterSeq))
  }

  track(sessionId, ctx, text, gate) {
    this.texts.set(sessionId, [text])
    const p = gate.then(afterSeq => this.follow(sessionId, afterSeq, ctx)).finally(() => {
      this.followers.delete(sessionId); this.texts.delete(sessionId)
      try { this.onEnd?.(sessionId, ctx) } catch (err) { this.onError?.(ctx, err) }
    })
    this.followers.set(sessionId, p)
    return p
  }

  async follow(sessionId, afterSeq, ctx) {
    const started = Date.now()
    const byseq = new Map()
    const delivered = new Set()
    // maxRev: the highest seq/rev seen. The hub numbers events in memory, so
    // after it restarts they start low again: then we reload and find our turn.
    let since = 0, sent = afterSeq, slow = false, sawUser = false, quiet = 0, maxRev = afterSeq, lost = false, lostPolls = 0, resets = 0
    const told = new Set()
    const deliver = async reply => {
      sent = Math.max(sent, reply.seq)
      if (resets && delivered.has(reply.text)) return // already sent before the hub restarted
      delivered.add(reply.text)
      await this.safe(ctx, () => this.onReply(ctx, reply))
    }
    while (Date.now() - started < this.maxMs) {
      await this.sleep(this.pollMs)
      let d
      try { d = await this.hub.session(sessionId, since ? { since } : { limit: 300 }) }
      catch { since = 0; continue } // the hub restarting: try again with a full reload
      const got = d.events ?? []
      const top = Math.max(-1, Number(d.session?.updated ?? -1), ...got.map(e => Math.max(e.seq, e.rev ?? 0)))
      if (top >= 0 && top < maxRev) { byseq.clear(); since = 0; maxRev = 0; lost = true; lostPolls = 0; resets++ }
      for (const e of got) { byseq.set(e.seq, e); since = Math.max(since, e.rev ?? 0) }
      maxRev = Math.max(maxRev, top)
      const events = [...byseq.values()]
      for (const p of d.pending ?? []) if (!told.has(p.id)) { told.add(p.id); await this.safe(ctx, () => this.onPending(ctx, p)) }
      const busy = d.session?.status === 'busy' || (d.pending ?? []).length > 0
      await this.safe(ctx, () => this.onTyping(ctx, busy))
      if (lost) {
        // Our turn starts just before our first prompt, as the restarted hub numbers it.
        const want = plain(this.texts.get(sessionId)?.[0])
        const u = events.filter(e => e.kind === 'user' && !e.agent && plain(e.text) === want).sort((a, b) => a.seq - b.seq).at(-1)
        if (u) { afterSeq = u.seq - 1; sent = afterSeq; lost = false; sawUser = true }
        else if (++lostPolls > 20) { afterSeq = Math.max(0, ...events.map(e => e.seq)); sent = afterSeq; lost = false }
        else continue
      }
      const r = replies(events, afterSeq)
      if (events.some(e => e.seq > afterSeq && e.kind === 'user')) sawUser = true
      for (const reply of r.replies) if (reply.seq > sent) await deliver(reply)
      if (!slow && Date.now() - started > this.slowMs && busy) { slow = true; await this.safe(ctx, () => this.onSlow(ctx)) }
      if (sawUser && r.idle && !busy) { await this.safe(ctx, () => this.onTyping(ctx, false)); return }
      // No receipt (a quick turn): quiet on two polls in a row with an answer not yet sent.
      quiet = sawUser && !busy ? quiet + 1 : 0
      if (quiet >= 2) {
        const last = lastAnswer(events, afterSeq)
        if (last && last.seq > sent) { await deliver(last); await this.safe(ctx, () => this.onTyping(ctx, false)); return }
      }
    }
    await this.safe(ctx, () => this.onReply(ctx, { seq: sent, text: '⌛ Esto me está tomando mucho. Lo sigues viendo en pastor.', files: [] }))
  }

  // A failing callback (WhatsApp down, say) never stops the follower.
  async safe(ctx, fn) { try { await fn() } catch (err) { try { this.onError?.(ctx, err) } catch { /* ignore */ } } }
}
