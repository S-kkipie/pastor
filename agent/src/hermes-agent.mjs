// pastor-agent's local API when Hermes is the agent: the app's Agente screen
// (status, settings, its chat) on top of Hermes's gateway.
import fs from 'node:fs'
import path from 'node:path'
import { normalizePhone, patchConfig } from './config.mjs'
import { readHermesEnv } from './hermes.mjs'
import { sessionOf } from './hermeschat.mjs'

const bad = msg => Object.assign(new Error(msg), { status: 400 })
const CHATS_TTL_MS = 10_000

// The phone numbers Hermes lets in; a WhatsApp LID (an alias of one of them) is no number to write to.
export function hermesAllowed(env, isLid = () => false) {
  const list = String(env.WHATSAPP_ALLOWED_USERS ?? '').split(',').map(normalizePhone).filter(n => n.length >= 10 && n.length <= 15 && !isLid(n))
  return [...new Set(list)]
}
export const lidCheck = (hermesHome, aliases = {}) => n => n in aliases || fs.existsSync(path.join(hermesHome, 'whatsapp', 'session', `lid-mapping-${n}_reverse.json`))

// The bot's own number, as its WhatsApp session knows it.
function botNumber(hermesHome) {
  try {
    const creds = JSON.parse(fs.readFileSync(path.join(hermesHome, 'whatsapp', 'session', 'creds.json'), 'utf8'))
    return String(creds.me?.id ?? '').split(/[:@]/)[0] || null
  } catch { return null }
}

export function makeHandlers({ getConfig, setConfig, state, save, client, chat, send, exec, now = Date.now }) {
  let chats = { at: -Infinity, list: [] }
  const env = () => readHermesEnv(path.join(getConfig().hermes.home, '.env'))
  const allowed = () => hermesAllowed(env(), lidCheck(getConfig().hermes.home, getConfig().lidAliases))
  const sanitized = c => ({ ...c, token: undefined, localSecret: undefined, allowed: allowed(), backend: 'hermes' })
  function logActivity(kind, text) {
    state.activity = [{ at: now(), kind, text: String(text).slice(0, 300) }, ...state.activity].slice(0, 200)
    save()
  }
  async function whatsappChats() {
    if (now() - chats.at > CHATS_TTL_MS) chats = { at: now(), list: await client.sessions({ source: 'whatsapp', limit: 5 }).catch(() => chats.list) }
    return chats.list
  }

  return {
    async status() {
      const c = getConfig()
      const [wa, list] = await Promise.all([client.whatsapp(), whatsappChats()])
      const app = state.channels.app ?? {}
      return {
        backend: 'hermes',
        enabled: c.enabled,
        whatsapp: { state: wa.state, me: botNumber(c.hermes.home), since: null, qr: false },
        channels: [
          { id: 'app', label: 'App', sessionId: null, online: true, busy: chat.busy('app'), lastText: app.lastText ?? '', lastAt: app.lastAt ?? null },
          ...list.map(s => ({
            id: `h:${s.id}`, label: `WhatsApp · ${s.title || 'chat'}`, sessionId: null, online: !s.ended_at, busy: false,
            lastText: s.preview ?? '', lastAt: s.last_active ? Math.round(s.last_active * 1000) : null,
          })),
        ],
      }
    },
    getConfig: () => sanitized(getConfig()),
    // Hermes owns the numbers, the permissions and its sessions: only "activo" and the vigilante change here.
    async setConfig(patch) {
      const c = getConfig()
      const p = {}
      for (const k of ['enabled', 'vigilante']) if (patch && k in patch) p[k] = patch[k]
      const next = patchConfig({ ...c, allowed: allowed() }, p)
      if (next.enabled !== c.enabled) await exec(c.hermes.bin, next.enabled ? ['resume'] : ['pause', '--reason', 'Apagado desde pastor'])
      setConfig(next)
      return sanitized(next)
    },
    activity: () => state.activity,
    qr: async () => ({ dataUrl: null, state: (await client.whatsapp()).state }),
    relink() { throw bad('Con Hermes, WhatsApp se vuelve a vincular en el servidor: `hermes whatsapp`') },
    channel({ channel }) {
      if (!sessionOf(channel)) throw bad('Canal desconocido')
      return { hermes: channel }
    },
    chat: ({ channel }) => chat.chat(channel),
    async say({ channel, text }) {
      const r = await chat.say(channel, text)
      state.channels.app = { lastText: String(text).slice(0, 200), lastAt: now() }
      save()
      return r
    },
    stop: ({ channel }) => chat.stop(channel),
    async send({ to, text, file }) {
      const n = normalizePhone(to)
      if (n.length < 10 || n.length > 15) throw bad('Número inválido')
      if (file && !fs.existsSync(file)) throw bad('No existe el archivo')
      await send(n, text, file)
      if (!allowed().includes(n)) logActivity('whatsapp', `Le escribió a ${n}: ${String(text ?? file).slice(0, 120)}`)
      return { ok: true }
    },
    logActivity: e => { logActivity(String(e.kind ?? 'otro'), e.text ?? ''); return { ok: true } },
  }
}
