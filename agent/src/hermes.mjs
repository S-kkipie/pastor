// Hermes Agent's gateway as pastor-agent sees it: the api_server platform (runs,
// their events, sessions) and the WhatsApp bridge's health.
import fs from 'node:fs'

export function parseEnv(text) {
  const out = {}
  for (const line of String(text).split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line)
    if (!m) continue
    let v = m[2].trim()
    if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v.at(-1) === v[0]) v = v.slice(1, -1)
    out[m[1]] = v
  }
  return out
}
export function readHermesEnv(file) {
  try { return parseEnv(fs.readFileSync(file, 'utf8')) } catch { return {} }
}

// Server-sent events of a run: `data: <json>` frames split by blank lines; comments are keepalives.
export class SseParser {
  constructor() { this.buf = '' }
  push(text) {
    this.buf += text
    const out = []
    let cut
    while ((cut = this.buf.indexOf('\n\n')) !== -1) {
      const frame = this.buf.slice(0, cut)
      this.buf = this.buf.slice(cut + 2)
      const data = frame.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n')
      if (!data) continue
      try { out.push(JSON.parse(data)) } catch { /* not an event of ours */ }
    }
    return out
  }
}

export const toolLabel = name => String(name).split('__').at(-1)

// Tools Hermes uses to reach the others: shown by the tools they call, or not at all.
const HIDDEN_TOOLS = new Set(['tool_describe'])
export const isHiddenTool = name => HIDDEN_TOOLS.has(name)
function callNames(call) {
  const name = call?.function?.name ?? call?.name
  if (HIDDEN_TOOLS.has(name)) return []
  if (name === 'tool_call') {
    try { return (JSON.parse(call.function.arguments).calls ?? []).map(c => toolLabel(c.name)) } catch { return [] }
  }
  return [toolLabel(name)]
}

// The gateway puts where a message came from in front of it, for the model alone.
const ORIGIN = /^Gateway message origin \(JSON data[^\n]*\n\{[^\n]*\}\n[^\n]*\n\n/

// A session's transcript as the app's chat shows it: what was said, and which tools ran in between.
export function toChatMessages(raw) {
  const out = []
  for (const m of raw ?? []) {
    const at = Math.round((m.timestamp ?? 0) * 1000)
    if (m.role === 'user' && m.content) out.push({ id: m.id, role: 'user', text: String(m.content).replace(ORIGIN, ''), at })
    if (m.role !== 'assistant') continue
    const tools = (m.tool_calls ?? []).flatMap(callNames)
    if (tools.length) out.push({ id: m.id, role: 'tools', tools, at })
    if (m.content) out.push({ id: m.id, role: 'assistant', text: m.content, at })
  }
  return out
}

export class HermesClient {
  constructor({ url, key, bridge, fetchImpl = fetch }) {
    this.url = String(url).replace(/\/+$/, '')
    this.bridge = String(bridge).replace(/\/+$/, '')
    this.key = key
    this.fetch = fetchImpl
  }
  async req(path, { method = 'GET', body, timeoutMs = 20_000, ok = [] } = {}) {
    const res = await this.fetch(this.url + path, {
      method,
      headers: { authorization: `Bearer ${this.key}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok && !ok.includes(res.status)) {
      throw Object.assign(new Error(data.error?.message || `Hermes respondió ${res.status}`), { status: res.status })
    }
    return { status: res.status, data }
  }
  // 409: it is already there.
  async ensureSession(id) { await this.req('/api/sessions', { method: 'POST', body: { id }, ok: [409] }) }
  // `instructions`: a system prompt for this turn alone (how the channel shows text).
  async startRun(sessionId, input, instructions) {
    const body = { input, session_id: sessionId, ...(instructions ? { instructions } : {}) }
    const { data } = await this.req('/v1/runs', { method: 'POST', body })
    return data.run_id
  }
  async *events(runId, signal) {
    const res = await this.fetch(`${this.url}/v1/runs/${encodeURIComponent(runId)}/events`, {
      headers: { authorization: `Bearer ${this.key}` }, signal,
    })
    if (!res.ok || !res.body) throw Object.assign(new Error(`Hermes respondió ${res.status} a los eventos del run`), { status: res.status })
    const parser = new SseParser()
    const dec = new TextDecoder()
    for await (const chunk of res.body) yield* parser.push(dec.decode(chunk, { stream: true }))
  }
  // A run that already ended (409) or is gone (404) has nothing left to stop.
  async stop(runId) { await this.req(`/v1/runs/${encodeURIComponent(runId)}/stop`, { method: 'POST', body: {}, ok: [404, 409] }) }
  async sessions({ source, limit = 20 } = {}) {
    const q = new URLSearchParams(Object.entries({ source, limit }).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]))
    return (await this.req(`/api/sessions?${q}`)).data.data ?? []
  }
  async messages(sessionId, limit = 200) {
    const { status, data } = await this.req(`/api/sessions/${encodeURIComponent(sessionId)}/messages?order=latest&limit=${limit}`, { ok: [404] })
    return status === 404 ? [] : (data.data ?? [])
  }
  async whatsapp() {
    try {
      const res = await this.fetch(`${this.bridge}/health`, { signal: AbortSignal.timeout(5000) })
      const data = await res.json()
      return { state: data.status === 'connected' ? 'connected' : 'disconnected' }
    } catch { return { state: 'disconnected' } }
  }
}
