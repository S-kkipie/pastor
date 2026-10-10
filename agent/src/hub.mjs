// The pastor hub's HTTP API, as the agent (a paired device) sees it.
export class HubClient {
  constructor({ base, token, fetchImpl = fetch }) {
    this.base = String(base).replace(/\/+$/, '')
    this.token = token
    this.fetch = fetchImpl
  }
  async req(path, body, timeoutMs = 30_000) {
    const res = await this.fetch(this.base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw Object.assign(new Error(data.error || `hub ${res.status}`), { status: res.status })
    return data
  }
  get(path, params = {}) {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)]))
    return this.req(`${path}${q.size ? `?${q}` : ''}`)
  }
  post(path, body, timeoutMs) { return this.req(path, body ?? {}, timeoutMs) }
  sessions() { return this.get('/api/sessions?all=1') }
  session(id, { since, limit } = {}) { return this.get(`/api/session/${encodeURIComponent(id)}`, { since, limit }) }
  prompt(id, text, mode = 'queue') { return this.post(`/api/session/${encodeURIComponent(id)}/prompt`, { text, mode }) }
  decide(id, pendingId, decision, answers) { return this.post(`/api/session/${encodeURIComponent(id)}/decide`, { id: pendingId, decision, answers }) }
  abort(id) { return this.post(`/api/session/${encodeURIComponent(id)}/abort`, {}) }
  close(id) { return this.post(`/api/session/${encodeURIComponent(id)}/close`, {}) }
  launch(body) { return this.post('/api/launch', body, 200_000) }
  alerts(since) { return this.get('/api/alerts', { since }) }
}
