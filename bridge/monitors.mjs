// "Monitores": the hub tells Hermes when a MONITORED session finishes its turn,
// by POSTing a signed webhook to Hermes's own webhook route. Opt-in per session
// (pastor already notifies the phone about every session, so this is the narrow,
// Hermes-only channel). Pure helpers here; the bridge wires the HTTP and the timer.
import crypto from 'node:crypto'

// Hermes's generic V2 webhook signature: hex HMAC-SHA256 of "<timestamp>.<body>",
// with the timestamp sent too so Hermes can reject replays. The sentinel
// "INSECURE_NO_AUTH" skips signing (Hermes only accepts it on a loopback bind,
// for a quick local test).
export function signHeaders(secret, body, nowSec = Math.floor(Date.now() / 1000)) {
  const headers = { 'content-type': 'application/json' }
  if (secret && secret !== 'INSECURE_NO_AUTH') {
    headers['X-Webhook-Timestamp'] = String(nowSec)
    headers['X-Webhook-Signature-V2'] = crypto.createHmac('sha256', secret).update(`${nowSec}.${body}`).digest('hex')
  }
  return headers
}

// The webhook payload for one finished turn. `event_type` lets a Hermes route
// filter with `--events session.turn_end` and read fields as `{session.title}`.
export function monitorBody(a) {
  return {
    event_type: 'session.turn_end',
    session: a.session,
    title: a.sessionTitle || '',
    machine: a.machine || '',
    summary: a.body || '',
    alert_id: a.id,
    t: a.t,
  }
}

// Which "turn ended" alerts should fire a webhook now: a monitored session, not
// fired before, and no older than `minT` (so a hub restart does not replay a
// backlog of done-alerts). `alerts` are the hub's own alert rows.
export function pickDoneWebhooks(alerts, { monitors, firedIds, minT = 0 }) {
  const out = []
  for (const a of alerts) {
    if (a.kind !== 'done') continue
    if (a.t < minT) continue
    if (!monitors.has(a.session)) continue
    if (firedIds.has(a.id)) continue
    out.push({ alert: a, body: monitorBody(a) })
  }
  return out
}

// Peers that actually hold a monitored session (ids read "<peer>~<id>"), so the
// scan only pulls alerts from PCs that have one — nothing when all monitors are
// hub-local or there are none.
export function monitoredPeers(monitors, peerNames) {
  const want = new Set()
  for (const id of monitors) { const i = id.indexOf('~'); if (i > 0) want.add(id.slice(0, i)) }
  return peerNames.filter(n => want.has(n))
}
