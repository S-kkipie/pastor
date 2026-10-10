// Where the agent keeps its settings and state, and how a change from the app
// is checked before it is saved.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const HOME = process.env.PASTOR_AGENT_HOME || path.join(os.homedir(), 'pastor-agent')

export function paths(home = HOME) {
  return {
    home,
    config: path.join(home, 'config.json'),
    state: path.join(home, 'state.json'),
    channels: path.join(home, 'canales'),
    uploads: path.join(home, 'uploads'),
    session: path.join(home, 'whatsapp', 'session'),
    sentLog: path.join(home, 'sent.log'),
  }
}

export const GROUPS = ['sessions', 'routines', 'terminal', 'files', 'whatsapp']

export const DEFAULTS = Object.freeze({
  enabled: true,
  hub: 'http://127.0.0.1:7878',
  token: '',
  port: 7890,
  localSecret: '',
  allowed: [],
  lidAliases: {},
  permissions: { total: true, groups: Object.fromEntries(GROUPS.map(g => [g, 'libre'])) },
  sleepMinutes: 30,
  maxLive: 3,
  showInPanel: false,
  vigilante: { needs: false, done: false, failures: false, routines: false, daily: false, dailyTime: '21:00', tz: 300, to: [] },
})

const isObj = v => v && typeof v === 'object' && !Array.isArray(v)
function merge(base, over) {
  const out = structuredClone(base)
  for (const [k, v] of Object.entries(over ?? {})) out[k] = isObj(v) && isObj(out[k]) ? merge(out[k], v) : v
  return out
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, file)
}
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

export function normalizePhone(v) {
  const d = String(v ?? '').replace(/\D/g, '')
  return d.length === 9 && d.startsWith('9') ? `51${d}` : d
}

export function loadConfig(home = HOME) {
  const file = paths(home).config
  let saved = {}
  if (fs.existsSync(file)) {
    // A damaged file must not be replaced by defaults (that would lose the hub token).
    try { saved = JSON.parse(fs.readFileSync(file, 'utf8')) ?? {} }
    catch (err) { throw new Error(`${file} está dañado (${err.message}); arréglalo o bórralo para empezar con los valores por defecto`) }
  }
  const c = merge(DEFAULTS, saved)
  if (!c.localSecret) { c.localSecret = crypto.randomBytes(16).toString('hex'); saveConfig(c, home) }
  return c
}
export function saveConfig(config, home = HOME) { writeJson(paths(home).config, config) }

const bad = msg => Object.assign(new Error(msg), { status: 400 })

// A change from the app: only known fields, each checked.
export function patchConfig(config, patch) {
  const c = merge(config, {})
  const p = patch ?? {}
  if ('enabled' in p) c.enabled = !!p.enabled
  if ('showInPanel' in p) c.showInPanel = !!p.showInPanel
  if ('allowed' in p) {
    const list = [...new Set((Array.isArray(p.allowed) ? p.allowed : []).map(normalizePhone).filter(n => n.length >= 10 && n.length <= 15))]
    if (!list.length) throw bad('Hace falta al menos un número permitido')
    c.allowed = list
  }
  if ('lidAliases' in p) {
    if (!isObj(p.lidAliases)) throw bad('lidAliases debe ser un objeto')
    const out = {}
    for (const [lid, phone] of Object.entries(p.lidAliases)) {
      const l = String(lid).replace(/\D/g, ''), n = normalizePhone(phone)
      if (!l || n.length < 10 || n.length > 15) throw bad(`Alias inválido: ${lid}`)
      out[l] = n
    }
    c.lidAliases = out
  }
  if ('sleepMinutes' in p) {
    const n = Number(p.sleepMinutes)
    if (!Number.isFinite(n) || n < 5 || n > 1440) throw bad('Minutos para dormir: entre 5 y 1440')
    c.sleepMinutes = Math.round(n)
  }
  if (isObj(p.permissions)) {
    if ('total' in p.permissions) c.permissions.total = !!p.permissions.total
    for (const [g, v] of Object.entries(p.permissions.groups ?? {})) {
      if (!GROUPS.includes(g) || !['libre', 'pregunta'].includes(v)) throw bad(`Valor de permiso inválido: ${g}=${v}`)
      c.permissions.groups[g] = v
    }
  }
  if (isObj(p.vigilante)) {
    const v = p.vigilante
    for (const k of ['needs', 'done', 'failures', 'routines', 'daily']) if (k in v) c.vigilante[k] = !!v[k]
    if ('dailyTime' in v) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v.dailyTime))) throw bad('La hora del resumen debe ser HH:MM')
      c.vigilante.dailyTime = String(v.dailyTime)
    }
    if ('tz' in v) c.vigilante.tz = Number(v.tz) || 0
    if ('to' in v) c.vigilante.to = [...new Set((Array.isArray(v.to) ? v.to : []).map(normalizePhone))].filter(n => c.allowed.includes(n))
  }
  return c
}

const EMPTY_STATE = { channels: {}, queue: [], seen: [], activity: [], lastDaily: '', inflight: {}, awaiting: {} }
export function loadState(home = HOME) { return merge(EMPTY_STATE, readJson(paths(home).state) ?? {}) }
export function saveState(state, home = HOME) { writeJson(paths(home).state, state) }
