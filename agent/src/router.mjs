// One Claude Code session per channel (each WhatsApp number, and the app), in
// its own folder on the VPS, opened and resumed through the hub like any other.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { paths } from './config.mjs'

const TEMPLATE = fileURLToPath(new URL('../templates/CLAUDE.md', import.meta.url))
const STYLE_WA = 'Por WhatsApp: mensajes cortos, sin tablas ni títulos largos; usa *negrita* con asteriscos simples y listas con •.'
const STYLE_APP = 'Desde la app de pastor: puedes usar Markdown normal (tablas, títulos, código).'

export const channelOf = number => `wa-${number}`
export function labelOf(ch) {
  if (ch === 'app') return 'App'
  const n = ch.replace(/^wa-/, '')
  return `WhatsApp · ${n.startsWith('51') && n.length === 11 ? `${n.slice(2, 5)} ${n.slice(5, 8)} ${n.slice(8)}` : n}`
}

const GROUP_TOOLS = {
  sessions: ['mcp__pastor-hub__session_stop', 'mcp__pastor-hub__session_close'],
  routines: ['mcp__pastor-hub__routine_delete'],
  terminal: ['mcp__pastor-hub__terminal_run', 'Bash'],
  files: ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'],
  whatsapp: ['mcp__pastor-hub__whatsapp_send'],
}
export function settingsFor(config) {
  const allow = ['mcp__pastor-hub', 'Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch', 'TodoWrite', 'Task', 'Agent']
  const ask = []
  for (const [g, tools] of Object.entries(GROUP_TOOLS)) {
    const asks = !config.permissions.total && config.permissions.groups[g] === 'pregunta'
    ;(asks ? ask : allow).push(...tools)
  }
  // The channel's own mode: the person's default (set from the app's settings) never applies here.
  const defaultMode = config.permissions.total ? 'bypassPermissions' : 'default'
  return { enableAllProjectMcpServers: true, permissions: { defaultMode, allow, ask } }
}
export function mcpFor({ home, channel, node, mcpPath }) {
  return { mcpServers: { 'pastor-hub': { type: 'stdio', command: node, args: [mcpPath], env: { PASTOR_AGENT_HOME: home, PASTOR_AGENT_CHANNEL: channel } } } }
}

const pause = ms => new Promise(r => setTimeout(r, ms))
const sameDir = (a, b) => path.resolve(String(a ?? '')).replace(/[\\/]+$/, '') === path.resolve(String(b ?? '')).replace(/[\\/]+$/, '')

export class Router {
  constructor({ hub, config, state, saveState, home, mcpPath, node = process.execPath, now = Date.now, sleep = pause, waitMs = 120_000, resumeWaitMs = 20_000, notify = () => {} }) {
    Object.assign(this, { hub, config, state, saveState, home, mcpPath, node, now, sleep, waitMs, resumeWaitMs, notify })
  }
  dir(ch) { return path.join(paths(this.home).channels, ch) }
  st(ch) { return (this.state.channels[ch] ??= { current: null, history: [], lastActive: 0, lastText: '', lastAt: null }) }

  prepare(ch) {
    const dir = this.dir(ch)
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true })
    fs.mkdirSync(path.join(dir, 'salidas'), { recursive: true })
    const md = fs.readFileSync(TEMPLATE, 'utf8').replace('{{LABEL}}', labelOf(ch)).replace('{{STYLE}}', ch === 'app' ? STYLE_APP : STYLE_WA)
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), md)
    fs.writeFileSync(path.join(dir, '.mcp.json'), JSON.stringify(mcpFor({ home: this.home, channel: ch, node: this.node, mcpPath: this.mcpPath }), null, 2))
    fs.writeFileSync(path.join(dir, '.claude', 'settings.local.json'), JSON.stringify(settingsFor(this.config()), null, 2))
    return dir
  }

  async liveMap() {
    const { sessions } = await this.hub.sessions()
    return new Map(sessions.filter(s => s.online).map(s => [s.id, s]))
  }

  launchBody(ch, extra) {
    return { cwd: this.dir(ch), name: `Agente · ${labelOf(ch)}`, permissionMode: this.config().permissions.total ? 'bypassPermissions' : 'default', trust: true, away: true, ...extra }
  }

  async waitFor(pred, ms = this.waitMs) {
    const until = this.now() + ms
    do {
      const { sessions } = await this.hub.sessions()
      const hit = sessions.find(s => s.online && pred(s))
      if (hit) return hit.id
      await this.sleep(2000)
    } while (this.now() < until)
    throw Object.assign(new Error('La sesión del agente no se conectó a tiempo'), { code: 'TIMEOUT' })
  }

  setCurrent(ch, id) {
    const st = this.st(ch)
    st.current = id
    st.history = [{ id, at: this.now() }, ...st.history.filter(h => h.id !== id)].slice(0, 20)
    this.saveState()
    return id
  }

  async ensure(ch) {
    const st = this.st(ch)
    if (st.current && (await this.liveMap()).has(st.current)) return st.current
    const dir = this.prepare(ch)
    await this.makeRoom(ch)
    if (st.current) {
      const id = st.current
      // Unless we put it to sleep ourselves, it may just be re-registering
      // (a hub restart): give it a moment before resuming.
      if (!st.asleep) try { return await this.waitFor(s => s.id === id, this.resumeWaitMs) } catch (err) { if (err.code !== 'TIMEOUT') throw err }
      st.asleep = false
      await this.hub.launch(this.launchBody(ch, { mode: 'resume', sessionId: id }))
      try { await this.waitFor(s => s.id === id); return id }
      catch (err) {
        if (err.code !== 'TIMEOUT') throw err
        // Once: a fresh conversation instead of the one that would not come back.
        st.current = null
        this.saveState()
        const fresh = await this.ensure(ch)
        await this.notify(ch, 'Empecé una conversación nueva porque no pude retomar la anterior')
        return fresh
      }
    }
    // A session launched earlier that registered after we stopped waiting: adopt it.
    const others = new Set([...Object.entries(this.state.channels).filter(([c]) => c !== ch).map(([, s]) => s.current), ...st.history.map(h => h.id)].filter(Boolean))
    const { sessions } = await this.hub.sessions()
    const late = sessions.find(s => s.online && !others.has(s.id) && sameDir(s.cwd, dir))
    if (late) return this.setCurrent(ch, late.id)
    const before = new Set(sessions.map(s => s.id))
    await this.hub.launch(this.launchBody(ch, { mode: 'new' }))
    return this.setCurrent(ch, await this.waitFor(s => !before.has(s.id) && sameDir(s.cwd, dir)))
  }

  async newSession(ch) {
    const st = this.st(ch)
    if (st.current && (await this.liveMap()).has(st.current)) await this.hub.close(st.current).catch(() => {})
    st.current = null
    this.saveState()
    return this.ensure(ch)
  }

  async list(ch) {
    const r = await this.hub.get('/api/projects/sessions', { path: this.dir(ch) }).catch(() => ({ sessions: [] }))
    const titles = new Map((r.sessions ?? []).map(s => [s.id, s.title]))
    return this.st(ch).history.map(h => ({ id: h.id, at: h.at, title: titles.get(h.id) || 'Sin título' }))
  }

  async resume(ch, n) {
    const item = (await this.list(ch))[n - 1]
    if (!item) throw new Error(`No hay conversación ${n}. Usa /sessions para ver la lista.`)
    const st = this.st(ch)
    if (st.current && st.current !== item.id && (await this.liveMap()).has(st.current)) await this.hub.close(st.current).catch(() => {})
    st.current = item.id
    st.asleep = true
    this.saveState()
    return this.ensure(ch)
  }

  touch(ch) { this.st(ch).lastActive = this.now(); this.saveState() }

  // No more than maxLive agent sessions running: the least recently used sleeps first.
  async makeRoom(keep) {
    const live = await this.liveMap()
    const running = Object.entries(this.state.channels).filter(([c, s]) => c !== keep && s.current && live.has(s.current))
    const max = Math.max(1, this.config().maxLive) - 1
    running.sort((a, b) => a[1].lastActive - b[1].lastActive)
    for (const [, s] of running.slice(0, Math.max(0, running.length - max))) { s.asleep = true; await this.hub.close(s.current).catch(() => {}) }
  }

  async sleepIdle() {
    const live = await this.liveMap()
    const limit = this.config().sleepMinutes * 60_000
    for (const s of Object.values(this.state.channels)) {
      if (s.current && live.has(s.current) && live.get(s.current).status === 'idle' && this.now() - s.lastActive > limit) {
        s.asleep = true; this.saveState()
        await this.hub.close(s.current).catch(() => {})
      }
    }
  }

  // New permission rules: rewrite every channel's settings; running sessions
  // close and resume with them on the next message.
  async applyPermissions() {
    const live = await this.liveMap()
    for (const [ch, s] of Object.entries(this.state.channels)) {
      this.prepare(ch)
      if (s.current && live.has(s.current)) { s.asleep = true; await this.hub.close(s.current).catch(() => {}) }
    }
    this.saveState()
  }
}
