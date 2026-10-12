// Messages between sessions on different PCs: addresses, who is reachable,
// and a brake so two sessions cannot keep answering each other forever.
const PREFIX = 'pastor:'
const MAX_ROWS = 30
const MAX_TEXT = 20_000
const STATUS = { idle: 'quieta', busy: 'trabajando', waiting: 'esperando permiso' }

export function parseAddress(to) {
  const s = String(to ?? '').trim()
  if (!s.toLowerCase().startsWith(PREFIX)) return null
  const rest = s.slice(PREFIX.length)
  const i = rest.indexOf('/')
  if (i <= 0 || i === rest.length - 1) return null
  return { machine: rest.slice(0, i).toLowerCase(), ref: rest.slice(i + 1).trim() }
}

export const addressOf = (machine, id) => `${PREFIX}${machine}/${String(id).slice(0, 8)}`

// rows: { id, title, online, agent }. A WhatsApp-agent session (agent) still
// takes a reply by id while it sleeps (the agent wakes it), but is never
// offered in the "vivas" list: a reply must not land on another channel.
export function resolveRef(rows, ref, machine) {
  const live = rows.filter(r => r.online)
  const reach = rows.filter(r => r.online || r.agent)
  const exact = reach.find(r => r.id === ref)
  if (exact) return { id: exact.id }
  const byId = reach.filter(r => r.id.startsWith(ref))
  if (ref.length >= 8 && byId.length === 1) return { id: byId[0].id }
  const byTitle = live.filter(r => String(r.title ?? '').toLowerCase() === ref.toLowerCase())
  if (byTitle.length === 1) return { id: byTitle[0].id }
  if (byId.length > 1 || byTitle.length > 1 || (byId.length && ref.length < 8)) return { error: 'ambiguo: usa el id de 8 letras' }
  const names = live.filter(r => !r.agent).slice(0, 10).map(r => addressOf(machine, r.id))
  return { error: `la sesión ya no está; vivas en esta PC: ${names.length ? names.join(', ') : 'ninguna'}` }
}

export function networkRows(list, { self, selfMachine }) {
  const all = []
  for (const s of list ?? []) {
    if (!s.online || s.agent) continue
    const machine = String(s.machine ?? selfMachine).toLowerCase()
    const id = String(s.id).includes('~') ? String(s.id).slice(String(s.id).indexOf('~') + 1) : String(s.id)
    if (machine === selfMachine && id === self) continue
    all.push({ address: addressOf(machine, id), machine, id, title: s.title || 'Sin título', status: s.status ?? 'idle' })
  }
  all.sort((a, b) => a.machine.localeCompare(b.machine) || a.title.localeCompare(b.title))
  return { rows: all.slice(0, MAX_ROWS), more: Math.max(0, all.length - MAX_ROWS) }
}

export function formatNetwork({ rows = [], more = 0, error } = {}) {
  const head = 'Otras PCs (pastor) — escríbeles con SendMessage usando la dirección:'
  if (error) return `Otras PCs (pastor): ${error}.`
  if (!rows.length) return 'Otras PCs (pastor): ninguna sesión abierta en otras PCs.'
  const lines = rows.map(r => `- ${r.address} · "${r.title}" · ${r.machine} · ${STATUS[r.status] ?? r.status}`)
  if (more) lines.push(`… y ${more} más`)
  return [head, ...lines].join('\n')
}

export class RateLimit {
  constructor({ max = 8, windowMs = 600_000, now = Date.now } = {}) {
    Object.assign(this, { max, windowMs, now })
    this.hits = new Map()
  }
  hit(key) {
    const t = this.now()
    const list = (this.hits.get(key) ?? []).filter(x => t - x < this.windowMs)
    if (list.length >= this.max) { this.hits.set(key, list); return false }
    list.push(t)
    this.hits.set(key, list)
    return true
  }
}

export function checkText(text) {
  const s = String(text ?? '')
  if (!s.trim()) return 'mensaje vacío'
  if (s.length > MAX_TEXT) return 'mensaje demasiado largo (máximo 20 000 caracteres)'
  return null
}
