#!/usr/bin/env node
// pastor bridge: one loopback HTTP server shared by every Claude Code session
// that loads the pastor mod. Sessions talk to /mod/* with the local secret;
// paired phones (and hub bridges on other PCs) talk to /api/* with a device
// token. Expose it with `tailscale serve` (tailnet only, never funnel).
import dns from 'node:dns/promises'
import http from 'node:http'
import net from 'node:net'
import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { spawn, execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { StringDecoder } from 'node:string_decoder'

const VERSION = 43
const HERE = path.dirname(fileURLToPath(import.meta.url))
const DIR = path.join(os.homedir(), '.claude', 'pastor')
const CONF = path.join(DIR, 'config.json')
// The name this PC goes by: PASTOR_MACHINE, else the config's `machine`, else
// the hostname (WSL shares the Windows one, so it sets its own).
const MACHINE = (process.env.PASTOR_MACHINE || (() => { try { return JSON.parse(fs.readFileSync(CONF, 'utf8')).machine } catch { return '' } })() || os.hostname()).toLowerCase()
const OFFLINE_MS = 15_000
const MAX_EVENTS = 2000
const PEER_TIMEOUT_MS = 2500

function loadConf() {
  fs.mkdirSync(DIR, { recursive: true })
  let conf = {}
  try { conf = JSON.parse(fs.readFileSync(CONF, 'utf8')) } catch {}
  let dirty = false
  const fill = (k, v) => { if (conf[k] === undefined) { conf[k] = v; dirty = true } }
  fill('port', Number(process.env.PASTOR_PORT) || 7878)
  fill('secret', crypto.randomBytes(24).toString('hex'))
  fill('pairCode', newPairCode())
  fill('devices', {})
  fill('peers', {})
  fill('ntfyTopic', '')
  fill('publicUrl', '')
  fill('awayDefault', false)
  if (dirty) saveConf(conf)
  return conf
}
function saveConf(conf) {
  fs.writeFileSync(CONF, JSON.stringify(conf, null, 2), { mode: 0o600 })
}
function newPairCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
}

function local(conf, path, method = 'GET') {
  return new Promise(resolve => {
    const req = http.request({
      host: '127.0.0.1', port: conf.port, path, method, timeout: 1500, agent: false,
      headers: { 'x-pastor-secret': conf.secret },
    }, res => {
      let body = ''
      res.on('data', c => { body += c })
      res.on('end', () => { try { resolve(res.statusCode === 200 ? JSON.parse(body) : null) } catch { resolve(null) } })
    })
    req.on('timeout', () => req.destroy())
    req.on('error', () => resolve(null))
    req.end()
  })
}
const health = conf => local(conf, '/mod/health')
const sleep = ms => new Promise(r => setTimeout(r, ms))

// ---- CLI ---------------------------------------------------------------
const cmd = process.argv[2] ?? 'serve'
if (cmd === 'ensure') {
  const conf = loadConf()
  let up = await health(conf)
  if (up && up.version !== VERSION) {
    // An older bridge from before an update: replace it.
    await local(conf, '/mod/shutdown', 'POST')
    for (let i = 0; i < 20 && (await health(conf)); i++) await sleep(100)
    up = null
  }
  if (!up) {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'serve'], {
      detached: true, stdio: 'ignore', windowsHide: true,
    })
    child.unref()
    for (let i = 0; i < 40 && !(await health(conf)); i++) await sleep(150)
  }
  const fresh = loadConf()
  process.stdout.write(JSON.stringify({
    ok: !!(await health(fresh)), port: fresh.port, secret: fresh.secret, machine: MACHINE,
    pairCode: fresh.pairCode, devices: Object.keys(fresh.devices).length,
    peers: Object.keys(fresh.peers), publicUrl: fresh.publicUrl,
  }))
  process.exit(0)
}
if (cmd === 'stop') {
  await local(loadConf(), '/mod/shutdown', 'POST')
  process.exit(0)
}
if (['code', 'link', 'unlink', 'peers', 'status'].includes(cmd)) {
  // Talk to the running bridge the way the mod does, from a shell.
  const conf = loadConf()
  if (!(await health(conf))) { console.error('el bridge no está corriendo (node bridge.mjs serve, o el servicio)'); process.exit(1) }
  const post = async (route, body) => {
    const r = await fetch(`http://127.0.0.1:${conf.port}${route}`, {
      method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined,
      headers: { 'x-pastor-secret': conf.secret, 'content-type': 'application/json' },
    })
    return r.json()
  }
  const [a, b] = process.argv.slice(3)
  if (cmd === 'code') console.log(`código de emparejamiento: ${loadConf().pairCode}`)
  if (cmd === 'link') {
    if (!a || !b) { console.error('uso: bridge.mjs link http://pc.tailnet/ <código de /pastor en esa PC>'); process.exit(2) }
    const r = await post('/mod/link', { url: /^https?:\/\//.test(a) ? a : `http://${a}`, code: b })
    console.log(r.ok ? `enlazada: ${r.name}` : `error: ${r.error}`)
  }
  if (cmd === 'unlink') { const r = await post('/mod/unlink', { name: String(a ?? '').toLowerCase() }); console.log(r.ok ? 'desenlazada' : 'no existe') }
  if (cmd === 'peers' || cmd === 'status') {
    const r = await post('/mod/peers')
    console.log(`hub ${r.machine} · puerto ${conf.port} · ${Object.keys(loadConf().devices).length} dispositivo(s) · código ${loadConf().pairCode}`)
    for (const p of r.peers) console.log(`  ${p.online ? '●' : '○'} ${p.name}  ${p.url}`)
    if (!r.peers.length) console.log('  sin PCs enlazadas: bridge.mjs link <url> <código>')
  }
  process.exit(0)
}
if (cmd !== 'serve') { console.error('usage: bridge.mjs ensure|serve|stop|status|code|link <url> <código>|unlink <pc>|peers'); process.exit(2) }

// ---- server ------------------------------------------------------------
const conf = loadConf()
const sessions = new Map()
let seq = 0
let pairFails = 0, pairLockedUntil = 0

function pushEvent(s, ev) {
  const n = ++seq
  s.events.push({ ...ev, seq: n, rev: n, t: Date.now() })
  if (s.events.length > MAX_EVENTS) s.events.splice(0, s.events.length - MAX_EVENTS)
  s.updated = n
}
function patchEvent(s, id, patch) {
  const ev = s.events.find(e => e.id === id)
  if (!ev) return
  Object.assign(ev, patch, { rev: ++seq })
  s.updated = seq
}
// What a session is doing, from what it reports: a live turn or a running
// tool means busy even if the mod lost track of its turn (a reload mid-turn).
function statusOf(s) {
  if (s.pending.length) return 'waiting'
  if (s.status === 'idle' && s.live) return 'busy'
  return s.status
}
// What one poll carries: a first load gets only the last `limit` events (the
// phone's setting, 100 by default) and how many older ones exist; later polls
// what changed since; `before` (an event's seq) pages further back.
function pageEvents(all, url) {
  const q = url.searchParams
  const limit = Math.max(10, Math.min(2000, Number(q.get('limit') ?? 100) || 100))
  const before = Number(q.get('before') ?? 0) || 0
  if (before) {
    const i = all.findIndex(e => e.seq === before)
    const end = i < 0 ? 0 : i
    const start = Math.max(0, end - limit)
    return { before, events: all.slice(start, end), older: start }
  }
  const since = Number(q.get('since') ?? 0) || 0
  if (since) return { events: all.filter(e => e.rev > since) }
  const events = all.slice(-limit)
  return { events, older: all.length - events.length }
}

// A live session's real title, as /resume lists it: the name /rename gave it,
// else Claude's own title for it, else its first prompt (from its transcript).
async function refreshTitle(s) {
  const file = findTranscript(s.id, s.cwd)
  if (!file) return
  try {
    const m = await transcriptMeta(file)
    if (m.title && m.title !== 'Sin título' && m.title !== s.realTitle) { s.realTitle = m.title; s.updated = ++seq }
  } catch {}
}
function refreshTitles() {
  for (const s of sessions.values()) if (Date.now() - s.lastSeen < OFFLINE_MS) void refreshTitle(s)
}

// The general agent's own Claude sessions live under pastor-agent/canales/: hidden from pastor.
function isAgentSession(s) { return /[\\/]pastor-agent[\\/]canales[\\/]/.test(s?.cwd ?? '') }
function summary(s) {
  const last = [...s.events].reverse().find(e => (e.kind === 'assistant' || e.kind === 'user') && !e.agent)
  return {
    id: s.id, machine: MACHINE, title: s.realTitle || s.title, project: s.title, cwd: s.cwd, status: statusOf(s), away: s.away,
    agentType: s.agentType || 'claude-code',
    online: Date.now() - s.lastSeen < OFFLINE_MS, pending: s.pending.length,
    updated: s.updated, lastSeen: s.lastSeen, activity: s.live?.activity ?? null, usage: s.usage ?? null,
    tasks: (s.tasks ?? []).filter(t => t.status === 'running').length,
    agents: (s.agents ?? []).filter(a => a.status === 'running' || a.status === 'pending').length,
    workflows: (s.workflows ?? []).filter(w => w.status === 'running').length,
    browsers: browserKeys(s).size,
    routine: s.routine?.name ?? null,
    agent: isAgentSession(s),
    messages: (s.messages ?? []).filter(x => Date.now() - (x.t ?? 0) < RECENT_MSG_MS).length,
    last: last ? { kind: last.kind, text: last.text.slice(0, 160) } : null,
  }
}

// Messages between sessions/agents in the last 10 minutes count toward a row's badge.
const RECENT_MSG_MS = 10 * 60_000
const NETWORK_MAX = 300
// Every local session's messages as NetworkMessage rows (newer than since).
function localNetwork(since = 0) {
  const out = []
  for (const s of sessions.values()) {
    if (isAgentSession(s)) continue
    for (const x of s.messages ?? []) {
      if ((x.t ?? 0) > since) out.push({ ...x, session: s.id, sessionTitle: s.realTitle || s.title || '', machine: MACHINE })
    }
  }
  return out
}
// Local rows plus each peer's rows (session ids prefixed "<peer>~" like /api/sessions), newest first, capped.
function mergeNetwork(local, peers = []) {
  const all = [...local]
  for (const { name, messages } of peers) {
    for (const x of messages ?? []) all.push({ ...x, session: `${name}~${x.session}`, machine: name })
  }
  all.sort((a, b) => (b.t ?? 0) - (a.t ?? 0))
  return all.slice(0, NETWORK_MAX)
}

// ---- alerts: what the phone notifies about ----------------------------------
// A turn that really ended (Claude idle and no subagent still working; shells
// and monitors left running do not count), a question for the person, and in
// away mode a permission. The Android app's service polls /api/alerts.
const alerts = []
const ALERTS_MAX = 300
const LIVE_AGENT = new Set(['running', 'pending', 'waiting'])
function pushAlert(s, kind, title, body) {
  if (isAgentSession(s)) return
  const a = {
    id: crypto.randomBytes(6).toString('hex'), t: Date.now(), session: s.id, sessionTitle: s.realTitle || s.title || '',
    machine: MACHINE, kind, title: String(title).slice(0, 140), body: String(body ?? '').replace(/\s+/g, ' ').trim().slice(0, 400),
  }
  alerts.push(a)
  if (alerts.length > ALERTS_MAX) alerts.splice(0, alerts.length - ALERTS_MAX)
  void notify(a.title, a.body)
}
// After a turn's final event: notify once Claude is idle and no subagent works.
function checkDone(s) {
  if (!s.turnDone) return
  if (s.status !== 'idle' || s.pending.length) return
  // A subagent that never reported its end does not hold the notice back forever.
  const stale = Date.now() - (s.turnDoneAt ?? 0) > 20 * 60_000
  if (!stale && (s.agents ?? []).some(a => LIVE_AGENT.has(a.status) && !a.teammate)) return
  // A subagent that just ended hands Claude its report, which usually starts one
  // more turn: give it a moment, so the notice comes once, at the real end.
  const lastEnd = Math.max(0, ...(s.agents ?? []).filter(a => !a.teammate && a.endedAt).map(a => a.endedAt))
  if (!stale && Date.now() - lastEnd < 8_000) return
  s.turnDone = false
  const name = s.realTitle || s.title || 'Sesión'
  pushAlert(s, 'done', s.routine ? `⏰ ${s.routine.name}` : `✅ ${name}`, s.doneSummary || 'Terminó')
  routineDone(s)
}
function localAlerts(since) { return alerts.filter(a => a.t > since) }

async function notify(title, body) {
  if (!conf.ntfyTopic) return
  try {
    await fetch(`https://ntfy.sh/${encodeURIComponent(conf.ntfyTopic)}`, {
      method: 'POST', body,
      headers: { Title: encodeURIComponent(title), ...(conf.publicUrl ? { Click: conf.publicUrl } : {}) },
    })
  } catch {}
}

function send(res, status, body, type = 'application/json') {
  const data = type === 'application/json' ? JSON.stringify(body) : body
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(data)
}
function readRaw(req, max = 2_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = []
    req.on('data', c => { size += c.length; if (size > max) { reject(new Error('too big')); req.destroy() } else chunks.push(c) })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}
async function readBody(req) {
  const raw = await readRaw(req)
  return raw ? JSON.parse(raw) : {}
}
const safeEq = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b))
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}
function deviceOf(req) {
  const h = req.headers.authorization ?? ''
  const token = h.startsWith('Bearer ') ? h.slice(7) : ''
  if (!token) return null
  for (const [name, d] of Object.entries(conf.devices)) if (safeEq(d.token, token)) { deviceSeen.set(name, Date.now()); return name }
  return null
}
// When each paired device last called, for the phone's device list (memory only).
const deviceSeen = new Map()

// ---- peers: other PCs' bridges this one fans out to ---------------------
// A request to another PC's bridge. Where its tailnet name does not resolve
// here (a host without MagicDNS, like the one running Headscale), connect to
// the IP `tailscale ip` gives and still name the host, which `tailscale serve`
// routes by.
async function resolvePeerIp(hostname) {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return null
  try { await dns.lookup(hostname); return null } catch { /* no DNS for it here */ }
  return new Promise(resolve => {
    execFile('tailscale', ['ip', '-4', hostname.split('.')[0]], { timeout: 4000, windowsHide: true },
      (err, out) => resolve(err ? null : (String(out).trim().split('\n')[0] || null)))
  })
}
function rawRequest(url, { method = 'GET', headers = {}, body, ip, timeoutMs = PEER_TIMEOUT_MS } = {}) {
  const u = new URL(url)
  const mod = u.protocol === 'https:' ? https : http
  return new Promise((resolve, reject) => {
    const req = mod.request({
      host: ip || u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search, method,
      servername: u.hostname, timeout: timeoutMs, agent: false,
      headers: { ...headers, host: u.host, ...(body ? { 'content-length': Buffer.byteLength(body) } : {}) },
    }, res => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', c => { text += c })
      res.on('end', () => {
        let json; try { json = JSON.parse(text) } catch { json = { error: text.slice(0, 200) } }
        resolve({ status: res.statusCode, body: json })
      })
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}
async function peerFetch(name, pathAndQuery, init = {}) {
  const peer = conf.peers[name]
  if (!peer) throw new Error(`no peer ${name}`)
  return rawRequest(new URL(pathAndQuery, peer.url).href, {
    method: init.method, body: init.body, ip: peer.ip, timeoutMs: init.timeoutMs,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${peer.token}`, 'x-pastor-hop': '1' },
  })
}
async function linkPeer(url, code) {
  const base = new URL(url.endsWith('/') ? url : `${url}/`)
  const ip = await resolvePeerIp(base.hostname)
  const pair = await rawRequest(new URL('api/pair', base).href, {
    method: 'POST', ip, timeoutMs: 8000, headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, name: `hub-${MACHINE}` }),
  })
  if (pair.status !== 200) throw new Error(pair.body.error || `pair ${pair.status}`)
  const info = await rawRequest(new URL('api/info', base).href, {
    ip, timeoutMs: 8000, headers: { authorization: `Bearer ${pair.body.token}` },
  }).then(r => r.body, () => ({}))
  const name = String(info.machine || base.hostname.split('.')[0]).toLowerCase()
  if (name === MACHINE) throw new Error('ese bridge es esta misma PC')
  conf.peers[name] = { url: base.href, ...(ip ? { ip } : {}), token: pair.body.token, linked: new Date().toISOString() }
  saveConf(conf)
  return name
}

const WEB = path.join(HERE, 'web')
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm', '.ico': 'image/x-icon', '.apk': 'application/vnd.android.package-archive' }
function serveWeb(res, p) {
  if (!fs.existsSync(path.join(WEB, 'index.html'))) return false
  const rel = p === '/' ? 'index.html' : decodeURIComponent(p).replace(/^\/+/, '')
  const file = path.resolve(WEB, rel)
  if (!file.startsWith(WEB + path.sep)) return false
  if (fs.existsSync(file) && fs.statSync(file).isFile()) {
    const type = TYPES[path.extname(file)] ?? 'application/octet-stream'
    res.writeHead(200, { 'content-type': type, 'cache-control': rel.startsWith('assets/') ? 'public, max-age=31536000, immutable' : rel.startsWith('pets/') ? 'public, max-age=2592000' : 'no-cache' })
    res.end(fs.readFileSync(file))
    return true
  }
  if (path.extname(rel)) return false
  res.writeHead(200, { 'content-type': TYPES['.html'], 'cache-control': 'no-cache' }) // SPA route
  res.end(fs.readFileSync(path.join(WEB, 'index.html')))
  return true
}

const STATIC = {
  '/': ['app.html', 'text/html; charset=utf-8'],
  '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'],
  '/sw.js': ['sw.js', 'text/javascript'],
  '/icon.svg': ['icon.svg', 'image/svg+xml'],
  '/vendor/thinking-orbs.js': ['vendor/thinking-orbs.js', 'text/javascript'],
  // The Android app (built from app/android), when this bridge has a copy.
  '/pastor.apk': ['pastor.apk', 'application/vnd.android.package-archive'],
}

function git(cwd, args) {
  return new Promise(resolve => {
    execFile('git', args, { cwd, maxBuffer: 4_000_000, windowsHide: true }, (err, stdout) => resolve(err ? '' : stdout))
  })
}

// ---- projects and files ----------------------------------------------------
// Claude Code's own record of the folders it has run in (~/.claude.json), when
// each was last used (its transcripts folder), and what runs there now.
const encodeProject = dir => dir.replace(/[^a-zA-Z0-9]/g, '-')
function branchOf(dir) {
  try {
    const head = fs.readFileSync(path.join(dir, '.git', 'HEAD'), 'utf8').trim()
    return head.startsWith('ref: refs/heads/') ? head.slice(16) : head.slice(0, 7)
  } catch { return null }
}
async function projects() {
  let known = []
  try { known = Object.keys(JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8')).projects ?? {}) } catch {}
  const dirs = new Map()
  for (const k of known) dirs.set(path.resolve(k).toLowerCase(), path.resolve(k))
  for (const sess of sessions.values()) if (sess.cwd) dirs.set(path.resolve(sess.cwd).toLowerCase(), path.resolve(sess.cwd))
  const root = path.join(os.homedir(), '.claude', 'projects')
  const out = []
  for (const dir of dirs.values()) {
    if (!fs.existsSync(dir)) continue
    let lastUsed = 0, count = 0
    try {
      const tdir = path.join(root, encodeProject(dir))
      for (const f of fs.readdirSync(tdir)) {
        if (!f.endsWith('.jsonl')) continue
        count++
        lastUsed = Math.max(lastUsed, fs.statSync(path.join(tdir, f)).mtimeMs)
      }
    } catch {}
    const live = [...sessions.values()].filter(x => x.cwd && path.resolve(x.cwd).toLowerCase() === dir.toLowerCase() && Date.now() - x.lastSeen < OFFLINE_MS)
    if (live.length) lastUsed = Date.now()
    out.push({ path: dir, name: path.basename(dir) || dir, branch: branchOf(dir), lastUsed, sessions: count, running: live.length, trusted: isTrusted(dir) })
  }
  return out.sort((a, b) => b.lastUsed - a.lastUsed)
}
function roots() {
  const list = [{ name: '~', path: os.homedir() }]
  if (process.platform === 'win32') {
    for (const l of 'CDEFGH') if (fs.existsSync(`${l}:\\`)) list.push({ name: `${l}:`, path: `${l}:\\` })
  } else list.push({ name: '/', path: '/' })
  return list
}

// ---- transcripts: Claude Code's own record of each conversation --------------
// ~/.claude/projects/<encoded cwd>/<session id>.jsonl, one JSON object a line.
// Files run to tens of MB, so they are read a chunk at a time and cached by
// (path, mtime, size).
const TRANSCRIPTS = path.join(os.homedir(), '.claude', 'projects')
async function* readLines(file) {
  const fh = await fs.promises.open(file, 'r')
  try {
    const buf = Buffer.alloc(1 << 20), dec = new StringDecoder('utf8')
    let rest = ''
    for (;;) {
      const { bytesRead } = await fh.read(buf, 0, buf.length, null)
      if (!bytesRead) break
      const parts = (rest + dec.write(buf.subarray(0, bytesRead))).split('\n')
      rest = parts.pop()
      for (const l of parts) if (l.trim()) yield l
    }
    rest += dec.end()
    if (rest.trim()) yield rest
  } finally { await fh.close() }
}
const parseLine = l => { try { return JSON.parse(l) } catch { return null } }
const oneLine = (t, max) => t.replace(/\s+/g, ' ').trim().slice(0, max)
// What a person typed on a user line: '' for tool results and meta lines.
function userText(o) {
  if (o.isMeta) return ''
  const c = o.message?.content
  if (typeof c === 'string') return c
  if (!Array.isArray(c)) return ''
  return c.filter(b => b?.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n')
}
const isWrapper = t => t.startsWith('<')
const sessionIdOk = id => /^[\w-]{1,100}$/.test(id)

const metaCache = new Map()
async function transcriptMeta(file) {
  const st = await fs.promises.stat(file)
  const hit = metaCache.get(file)
  if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) return hit.meta
  let named = '', ai = '', summ = '', first = '', cmd = '', messages = 0, cwd = ''
  for await (const l of readLines(file)) {
    if (l.includes('"type":"custom-title"') || l.includes('"type":"ai-title"') || l.includes('"type":"summary"')) {
      const o = parseLine(l)
      if (o?.type === 'custom-title' && o.customTitle) { named = String(o.customTitle); continue }
      if (o?.type === 'ai-title' && o.aiTitle) { ai = String(o.aiTitle); continue }
      if (o?.type === 'summary' && o.summary) { summ = String(o.summary); continue }
    }
    // Keys, not contents: inside a JSON string these quotes come escaped.
    const isUser = l.includes('"type":"user"'), isAsst = !isUser && l.includes('"type":"assistant"')
    if (!isUser && !isAsst) continue
    messages++
    if ((isUser && !first) || !cwd) {
      const o = parseLine(l)
      if (!o) continue
      if (!cwd && typeof o.cwd === 'string') cwd = o.cwd
      if (isUser && !first && o.type === 'user' && !o.isSidechain) {
        const t = userText(o).trim()
        if (t && !isWrapper(t) && !t.startsWith('[Request interrupted')) first = t
        else if (!cmd) cmd = /<command-name>([^<]+)<\/command-name>/.exec(t)?.[1]?.trim() ?? ''
      }
    }
  }
  const meta = { title: oneLine(named || ai || summ || first || cmd, 80) || 'Sin título', firstPrompt: oneLine(first, 200), messages, cwd, lastUsed: st.mtimeMs }
  metaCache.set(file, { mtime: st.mtimeMs, size: st.size, meta })
  return meta
}

// Past conversations of one project, newest first.
async function projectSessions(dir) {
  const tdir = path.join(TRANSCRIPTS, encodeProject(path.resolve(dir)))
  let files = []
  try { files = (await fs.promises.readdir(tdir)).filter(f => f.endsWith('.jsonl')) } catch { return [] }
  const stats = await Promise.all(files.map(f => fs.promises.stat(path.join(tdir, f)).then(st => ({ f, mtime: st.mtimeMs }), () => null)))
  const recent = stats.filter(Boolean).sort((a, b) => b.mtime - a.mtime).slice(0, 60)
  const out = await Promise.all(recent.map(async ({ f }) => {
    const id = f.slice(0, -6)
    const meta = await transcriptMeta(path.join(tdir, f)).catch(() => null)
    if (!meta) return null
    const live = sessions.get(id)
    return { id, title: meta.title, firstPrompt: meta.firstPrompt, lastUsed: meta.lastUsed, messages: meta.messages,
      running: !!live && Date.now() - live.lastSeen < OFFLINE_MS }
  }))
  return out.filter(Boolean).sort((a, b) => b.lastUsed - a.lastUsed)
}

// The transcript of a session id in any project folder.
function findTranscript(id, cwd) {
  if (!sessionIdOk(id)) return null
  if (cwd) {
    const f = path.join(TRANSCRIPTS, encodeProject(path.resolve(cwd)), `${id}.jsonl`)
    if (fs.existsSync(f)) return f
  }
  let dirs = []
  try { dirs = fs.readdirSync(TRANSCRIPTS) } catch { return null }
  for (const d of dirs) {
    const f = path.join(TRANSCRIPTS, d, `${id}.jsonl`)
    if (fs.existsSync(f)) return f
  }
  return null
}

// A call's one-line summary and the bits the phone draws, as the mod does it.
const strOf = (v, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : '')
function toolSummary(tool, input) {
  const i = input && typeof input === 'object' ? input : {}
  const text =
    tool === 'Bash' || tool === 'PowerShell' ? strOf(i.command)
    : tool === 'Skill' ? `${strOf(i.skill ?? i.command)}${i.args ? ` · ${strOf(i.args)}` : ''}`
    : 'file_path' in i ? strOf(i.file_path)
    : 'notebook_path' in i ? strOf(i.notebook_path)
    : 'pattern' in i ? `${strOf(i.pattern)}${i.path ? `  en ${strOf(i.path)}` : ''}`
    : 'url' in i ? strOf(i.url)
    : 'query' in i ? strOf(i.query)
    : 'description' in i ? strOf(i.description)
    : 'prompt' in i ? strOf(i.prompt)
    : tool === 'TodoWrite' ? `${Array.isArray(i.todos) ? i.todos.length : 0} tareas`
    : JSON.stringify(i).slice(0, 120)
  return text.slice(0, 2000)
}
function toolDetail(tool, input) {
  const i = input && typeof input === 'object' ? input : {}
  if (tool === 'Bash' || tool === 'PowerShell') return { command: strOf(i.command, 4000), description: strOf(i.description, 300) }
  if (tool === 'Edit') return { file: strOf(i.file_path), old: strOf(i.old_string, 3000), new: strOf(i.new_string, 3000), all: !!i.replace_all }
  if (tool === 'MultiEdit') {
    const edits = Array.isArray(i.edits) ? i.edits.slice(0, 8) : []
    return { file: strOf(i.file_path), edits: edits.map(x => ({ old: strOf(x?.old_string, 1500), new: strOf(x?.new_string, 1500) })) }
  }
  if (tool === 'Write') {
    const content = strOf(i.content, 200_000)
    return { file: strOf(i.file_path), lines: content.split('\n').length, head: content.split('\n').slice(0, 40).join('\n').slice(0, 3000) }
  }
  if (tool === 'Read') return { file: strOf(i.file_path), offset: i.offset, limit: i.limit }
  if (tool === 'Grep' || tool === 'Glob') return { pattern: strOf(i.pattern), path: strOf(i.path), glob: strOf(i.glob) }
  if (tool === 'WebFetch') return { url: strOf(i.url), prompt: strOf(i.prompt, 300) }
  if (tool === 'WebSearch') return { query: strOf(i.query) }
  if (tool === 'TodoWrite') {
    const todos = Array.isArray(i.todos) ? i.todos : []
    return { todos: todos.slice(0, 30).map(t => ({ content: strOf(t?.content, 200), status: strOf(t?.status, 20) })) }
  }
  if (tool === 'Skill') return { skill: strOf(i.skill ?? i.command, 200), args: strOf(i.args, 2000) }
  if (tool === 'Agent' || tool === 'Task') return { description: strOf(i.description, 300), type: strOf(i.subagent_type, 60), prompt: strOf(i.prompt, 1500) }
  if (tool.startsWith('mcp__')) {
    const [, server, name] = tool.split('__')
    return { server, name, args: JSON.stringify(i).slice(0, 1500) }
  }
  if (typeof i.description === 'string') return { description: strOf(i.description, 300) }
  return undefined
}
function resultText(c) {
  if (typeof c === 'string') return c
  if (!Array.isArray(c)) return ''
  return c.map(b => b?.type === 'text' ? String(b.text ?? '') : b?.type === 'image' ? '[imagen]' : '').filter(Boolean).join('\n')
}

// A transcript as pastor events (main conversation only, last MAX_EVENTS),
// numbered from the global counter like pushEvent. Numbers are stable per
// file: an event keeps its seq across re-parses (the file grew, the cache
// evicted it), and only a changed one (a tool that got its result) takes a
// new rev, so a phone polling with ?since= never gets the history twice.
const eventsCache = new Map()
const eventNumbers = new Map() // file -> Map(key -> { seq, rev, sig })
async function transcriptEvents(file) {
  const st = await fs.promises.stat(file)
  const hit = eventsCache.get(file)
  if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) return hit.events
  const out = [], tools = new Map()
  for await (const l of readLines(file)) {
    if (!l.includes('"type":"user"') && !l.includes('"type":"assistant"')) continue
    const o = parseLine(l)
    if (!o || o.isSidechain || (o.type !== 'user' && o.type !== 'assistant')) continue
    const t = Date.parse(o.timestamp) || st.mtimeMs
    const c = o.message?.content
    const lk = String(o.uuid ?? `${o.timestamp ?? ''}#${out.length}`)
    if (o.type === 'user') {
      if (Array.isArray(c)) for (const b of c) {
        if (b?.type !== 'tool_result') continue
        const ev = tools.get(b.tool_use_id)
        if (ev) ev.end = { ok: !b.is_error, out: resultText(b.content).slice(0, 4000) }
      }
      if (o.isCompactSummary) { out.push({ kind: 'info', text: 'Conversación compactada', t, key: lk }); continue }
      const text = userText(o).trim()
      if (!text) continue
      if (isWrapper(text)) {
        if (/^<(task-notification|agent-message)\b/.test(text)) out.push({ kind: 'user', text: text.slice(0, 40_000), t, key: lk })
        continue
      }
      if (text.startsWith('[Request interrupted')) { out.push({ kind: 'info', text: 'Interrumpido', t, key: lk }); continue }
      out.push({ kind: 'user', text: text.slice(0, 40_000), t, key: lk })
      continue
    }
    if (!Array.isArray(c)) continue
    for (const [bi, b] of c.entries()) {
      if (b?.type === 'text' && typeof b.text === 'string' && b.text.trim()) out.push({ kind: 'assistant', text: b.text.slice(0, 40_000), t, key: `${lk}:${bi}` })
      else if (b?.type === 'tool_use') {
        const tool = String(b.name ?? '')
        const ev = { kind: 'tool', tool, id: String(b.id ?? ''), text: toolSummary(tool, b.input), detail: toolDetail(tool, b.input), t, key: b.id ? `tool:${b.id}` : `${lk}:${bi}` }
        tools.set(ev.id, ev)
        out.push(ev)
      }
    }
  }
  const prev = eventNumbers.get(file) ?? new Map(), nums = new Map()
  const events = out.slice(-MAX_EVENTS).map(({ key, ...ev }) => {
    const sig = ev.end ? `${ev.end.ok}:${ev.end.out.length}` : ''
    let n = prev.get(key) ?? nums.get(key)
    if (!n) { const k = ++seq; n = { seq: k, rev: k, sig } }
    else if (n.sig !== sig) n = { ...n, rev: ++seq, sig }
    nums.set(key, n)
    return { ...ev, seq: n.seq, rev: n.rev }
  })
  eventNumbers.delete(file); eventNumbers.set(file, nums)
  if (eventNumbers.size > 200) eventNumbers.delete(eventNumbers.keys().next().value)
  eventsCache.set(file, { mtime: st.mtimeMs, size: st.size, events })
  if (eventsCache.size > 20) eventsCache.delete(eventsCache.keys().next().value)
  return events
}
// A session that registers with no record here (the bridge restarted while it
// lived) starts from its transcript, so the phone keeps the history.
const seeding = new Map()
function seedEvents(cwd, id) {
  if (!seeding.has(id)) {
    const file = findTranscript(id, cwd)
    const p = (file ? transcriptEvents(file) : Promise.resolve([]))
      .then(evs => evs.map(e => ({ ...e, end: e.end && { ...e.end } })), () => [])
      .finally(() => seeding.delete(id))
    seeding.set(id, p)
  }
  return seeding.get(id)
}

// ---- uploads from the phone ---------------------------------------------------
const UPLOAD_MAX = 20 * 1024 * 1024
const MIME_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/heic': '.heic', 'application/pdf': '.pdf', 'text/plain': '.txt' }
function saveUpload(b) {
  const m = /^data:([^;,]*)((?:;[^;,]*)*),(.*)$/s.exec(String(b.data ?? ''))
  if (!m || !/;base64/i.test(m[2])) throw Object.assign(new Error('Archivo inválido (se espera data: URL en base64)'), { status: 400 })
  const buf = Buffer.from(m[3], 'base64')
  if (!buf.length) throw Object.assign(new Error('Archivo vacío'), { status: 400 })
  if (buf.length > UPLOAD_MAX) throw Object.assign(new Error('Archivo de más de 20 MB'), { status: 413 })
  let name = path.basename(String(b.name ?? '').replace(/\\/g, '/')).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\w.-]+/g, '_').replace(/^[._]+/, '').slice(-100)
  if (!name) name = 'archivo'
  if (!path.extname(name) && MIME_EXT[m[1].toLowerCase()]) name += MIME_EXT[m[1].toLowerCase()]
  const d = new Date()
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const dir = path.join(DIR, 'uploads', day)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${crypto.randomBytes(3).toString('hex')}-${name}`)
  fs.writeFileSync(file, buf)
  return { path: file, name, size: buf.length }
}

// ---- launching Claude Code in a terminal --------------------------------------
const shQuote = a => /^[\w./:=@%+-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`
// ---- workspace trust and away-by-default --------------------------------------
// Claude Code asks "do you trust this folder?" before any plugin loads, so the
// phone answers it ahead of time: the launcher's "Confiar en esta carpeta"
// writes the same flag the dialog does into ~/.claude.json.
const CLAUDE_JSON = path.join(os.homedir(), '.claude.json')
const trustKey = dir => path.resolve(dir).replace(/\\/g, '/')
function isTrusted(dir) {
  try {
    const projects = JSON.parse(fs.readFileSync(CLAUDE_JSON, 'utf8')).projects ?? {}
    const want = trustKey(dir).toLowerCase()
    // A trusted parent folder covers its children, as Claude Code does.
    return Object.entries(projects).some(([k, v]) => v?.hasTrustDialogAccepted &&
      (k.toLowerCase() === want || want.startsWith(k.toLowerCase().replace(/\/?$/, '/'))))
  } catch { return false }
}
function trustFolder(dir) {
  // Running sessions rewrite this file too: read, add one key, write atomically, re-check.
  for (let attempt = 0; attempt < 3; attempt++) {
    let data
    try { data = JSON.parse(fs.readFileSync(CLAUDE_JSON, 'utf8')) } catch { data = {} }
    data.projects ??= {}
    const key = trustKey(dir)
    // A new folder also keeps the MCP servers switched off everywhere else
    // (the person's plugin servers, off in every other project) switched off.
    const off = new Set(Object.values(data.projects).flatMap(p => p?.disabledMcpServers ?? []))
    const prev = data.projects[key] ?? {}
    data.projects[key] = { ...prev, hasTrustDialogAccepted: true, disabledMcpServers: [...new Set([...(prev.disabledMcpServers ?? []), ...off])] }
    const tmp = `${CLAUDE_JSON}.pastor-${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
    fs.renameSync(tmp, CLAUDE_JSON)
    if (isTrusted(dir)) return true
  }
  return false
}
// Sessions the phone opened start in away mode: nobody is at that terminal.
const awayLaunches = []
function awayOnRegister(cwd) {
  const now = Date.now()
  const key = cwd ? trustKey(cwd).toLowerCase() : ''
  const i = awayLaunches.findIndex(l => l.key === key && l.until > now)
  if (i >= 0) { awayLaunches.splice(i, 1); return true }
  while (awayLaunches.length && awayLaunches[0].until <= now) awayLaunches.shift()
  return !!conf.awayDefault
}

// The person's own Claude settings that a launched session should keep.
const KEEP_ENV = new Set(['CLAUDE_CODE_PLUGIN_DIRS', 'CLAUDE_CONFIG_DIR'])
// Whether `name` is an executable on PATH (or ~/.local/bin, where Claude Code installs itself).
const onPath = name => [...(process.env.PATH ?? '').split(path.delimiter), path.join(os.homedir(), '.local', 'bin')]
  .some(d => { try { return fs.statSync(path.join(d, name)).isFile() } catch { return false } })
// A server with no screen (a VPS hub): sessions start inside tmux instead of a terminal window.
const HEADLESS = process.platform === 'linux' && !process.env.WSL_DISTRO_NAME && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY
// This machine can start sessions itself (Claude Code installed): it is a PC on the phone, not only a hub.
const CAN_LAUNCH = process.platform === 'win32' || onPath('claude')

function claudeArgs(b) {
  const mode = b.mode ?? (b.resume ? 'continue' : 'new')
  const args = []
  if (mode === 'resume') {
    const id = String(b.sessionId ?? '')
    if (!sessionIdOk(id)) throw Object.assign(new Error('Falta la sesión a reanudar'), { status: 400 })
    args.push('--resume', id)
  } else if (mode === 'continue') args.push('--continue')
  const name = String(b.name ?? '').trim()
  if (name) args.push('-n', name.slice(0, 120))
  // How the session asks for permissions: a mode, or none at all (--dangerously-skip-permissions).
  if (b.permissionMode === 'bypassPermissions') args.push('--dangerously-skip-permissions')
  else if (['acceptEdits', 'plan', 'default'].includes(b.permissionMode)) args.push('--permission-mode', b.permissionMode)
  if (b.worktree === true) args.push('-w')
  else if (typeof b.worktree === 'string' && b.worktree.trim()) args.push('-w', b.worktree.trim().slice(0, 120))
  return args
}
// ---- GitHub, through this PC's own `gh` ---------------------------------------
// No integration of our own: the repos the person's gh can see, to clone.
const ghCache = new Map()
function gh(args, timeout = 25_000) {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { timeout, windowsHide: true, maxBuffer: 16_000_000 }, (err, out, stderr) => {
      if (err) {
        const msg = err.code === 'ENOENT' ? `gh no está instalado en ${MACHINE}` : String(stderr || err.message).trim().split('\n').slice(-2).join(' ')
        return reject(new Error(/auth login|not logged/i.test(msg) ? `gh no tiene sesión en ${MACHINE}: corre gh auth login` : msg))
      }
      resolve(out)
    })
  })
}
async function ghCached(key, ttl, fn) {
  const hit = ghCache.get(key)
  if (hit && Date.now() - hit.at < ttl) return hit.value
  const value = await fn()
  ghCache.set(key, { at: Date.now(), value })
  return value
}
const REPO_FIELDS = 'nameWithOwner,description,isPrivate,isFork,isArchived,updatedAt,primaryLanguage,stargazerCount,url'
const repoRow = r => ({
  name: r.nameWithOwner ?? r.fullName, description: r.description ?? '', private: !!(r.isPrivate ?? r.visibility === 'private'),
  fork: !!r.isFork, archived: !!r.isArchived, updatedAt: r.updatedAt ?? '',
  language: r.primaryLanguage?.name ?? r.language ?? '', stars: r.stargazerCount ?? r.stargazersCount ?? 0, url: r.url ?? '',
})
async function githubOp(q) {
  const op = q.get('op') ?? 'repos'
  if (op === 'owners') {
    return ghCached('owners', 10 * 60_000, async () => {
      const [user, orgs] = await Promise.all([
        gh(['api', 'user', '--jq', '.login']).then(s => s.trim()),
        gh(['api', 'user/orgs', '--jq', '.[].login']).then(s => s.split('\n').map(x => x.trim()).filter(Boolean)).catch(() => []),
      ])
      return { machine: MACHINE, user, orgs }
    })
  }
  if (op === 'repos') {
    const owner = String(q.get('owner') ?? '').trim()
    if (owner && !/^[\w.-]+$/.test(owner)) throw new Error('owner inválido')
    return ghCached(`repos:${owner}`, 2 * 60_000, async () => {
      const out = await gh(['repo', 'list', ...(owner ? [owner] : []), '--limit', '400', '--json', REPO_FIELDS])
      const repos = JSON.parse(out).map(repoRow).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      return { machine: MACHINE, owner, repos }
    })
  }
  if (op === 'search') {
    const text = String(q.get('q') ?? '').trim().slice(0, 200)
    if (!text) return { machine: MACHINE, repos: [] }
    const out = await gh(['search', 'repos', text, '--limit', '40', '--json', 'fullName,description,isPrivate,isFork,isArchived,updatedAt,language,stargazersCount,url'])
    return { machine: MACHINE, repos: JSON.parse(out).map(repoRow) }
  }
  throw new Error(`op ${op}`)
}

function cloneRepo(repo, dir) {
  // owner/name: gh clones it with the person's own GitHub login (private repos too).
  if (/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    return gh(['repo', 'clone', repo, dir], 180_000).then(() => null, err => String(err.message).slice(-1500) || 'gh repo clone falló')
  }
  return new Promise(resolve => {
    execFile('git', ['clone', '--', repo, dir], { timeout: 120_000, windowsHide: true, maxBuffer: 4_000_000 },
      (err, _out, stderr) => resolve(err ? (String(stderr || err.message).trim().slice(-1500) || 'git clone falló') : null))
  })
}

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'target', '.venv', 'venv', '__pycache__', '.cache', '.turbo', 'coverage'])
const IMAGE = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' }
const TEXT_MAX = 400_000, IMAGE_MAX = 4_000_000

// git's view of a folder: each entry's status letter (a folder takes its
// first changed child's), from the repo the folder sits in.
async function gitMarks(dir) {
  const top = (await git(dir, ['rev-parse', '--show-toplevel'])).trim()
  if (!top) return {}
  const out = await git(dir, ['status', '--porcelain=v1', '-uall', '--', '.'])
  const marks = {}
  for (const line of out.split('\n')) {
    if (!line.trim()) continue
    const code = line.slice(0, 2).trim()[0] ?? 'M'
    const file = path.resolve(top, line.slice(3).replace(/^.* -> /, '').replace(/^"|"$/g, ''))
    const rel = path.relative(dir, file)
    if (rel.startsWith('..')) continue
    const first = rel.split(path.sep)[0]
    if (!marks[first]) marks[first] = code === '?' ? 'U' : code
  }
  return marks
}

// ---- git, from the phone ----------------------------------------------------
// The repo a session works in: its branch, what changed (file by file, with its
// diff), recent commits; and commit, push, pull, discard a file, open a PR.
function gitRun(cwd, args, timeout = 60_000) {
  return new Promise(resolve => {
    execFile('git', ['-c', 'core.quotepath=false', ...args], { cwd, timeout, windowsHide: true, maxBuffer: 16_000_000 },
      (err, out, stderr) => resolve({ ok: !err, out: String(out), err: String(stderr || err?.message || '').trim() }))
  })
}
const gitFail = r => Object.assign(new Error(r.err.split('\n').filter(Boolean).slice(-4).join('\n') || 'git falló'), { status: 400 })
const prCache = new Map()

async function gitStatus(cwd) {
  const top = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim()
  if (!top) return { repo: false }
  const [st, num, hasHead, origin, def] = await Promise.all([
    gitRun(top, ['status', '--porcelain=v2', '--branch', '-uall', '-z']),
    gitRun(top, ['diff', 'HEAD', '--numstat', '-z']),
    gitRun(top, ['rev-parse', '--verify', '-q', 'HEAD']),
    gitRun(top, ['remote', 'get-url', 'origin']),
    gitRun(top, ['symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD']),
  ])
  const head = { branch: '', upstream: '', ahead: 0, behind: 0 }
  const files = []
  const parts = st.out.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const line = parts[i]
    if (!line) continue
    if (line.startsWith('# branch.head ')) head.branch = line.slice(14)
    else if (line.startsWith('# branch.upstream ')) head.upstream = line.slice(18)
    else if (line.startsWith('# branch.ab ')) { const [a, b] = line.slice(12).split(' '); head.ahead = +a.slice(1) || 0; head.behind = +b.slice(1) || 0 }
    else if (line.startsWith('1 ')) { const f = line.split(' '); files.push({ path: f.slice(8).join(' '), x: f[1][0], y: f[1][1] }) }
    else if (line.startsWith('2 ')) { const f = line.split(' '); files.push({ path: f.slice(9).join(' '), from: parts[++i], x: f[1][0], y: f[1][1] }) }
    else if (line.startsWith('u ')) { const f = line.split(' '); files.push({ path: f.slice(10).join(' '), x: 'U', y: 'U', conflict: true }) }
    else if (line.startsWith('? ')) files.push({ path: line.slice(2), x: '?', y: '?', untracked: true })
  }
  // +/- per file against HEAD (renames come as an empty path, then old and new).
  const counts = new Map()
  const n = num.out.split('\0')
  for (let i = 0; i < n.length; i++) {
    if (!n[i]) continue
    let [plus, minus, file] = n[i].split('\t')
    if (file === '' || file === undefined) { i++; file = n[++i] }
    counts.set(file, { plus: plus === '-' ? null : +plus, minus: minus === '-' ? null : +minus })
  }
  for (const f of files) {
    const c = counts.get(f.path)
    if (c) Object.assign(f, c)
    else if (f.untracked) {
      try {
        const st2 = fs.statSync(path.join(top, f.path))
        if (st2.size < 1_000_000) { const t = fs.readFileSync(path.join(top, f.path), 'utf8'); f.plus = t.includes('\0') ? null : t.split('\n').length - (t.endsWith('\n') ? 1 : 0); f.minus = 0 }
      } catch { /* gone */ }
    }
  }
  const log = (await gitRun(top, ['log', '-15', '--format=%h%x1f%s%x1f%an%x1f%ct%x1e'])).out
    .split('\x1e').map(x => x.trim()).filter(Boolean)
    .map((x, i) => { const [hash, subject, author, ct] = x.split('\x1f'); return { hash, subject, author, at: +ct * 1000, pushed: !head.upstream ? false : i >= head.ahead } })
  let defaultBranch = def.ok ? def.out.trim().replace(/^origin\//, '') : ''
  if (!defaultBranch) {
    for (const name of ['main', 'master']) if ((await gitRun(top, ['rev-parse', '--verify', '-q', `refs/remotes/origin/${name}`])).ok) { defaultBranch = name; break }
  }
  let pr = null
  const key = `${top}:${head.branch}`
  const hit = prCache.get(key)
  if (hit && Date.now() - hit.at < 60_000) pr = hit.pr
  else if (origin.ok && /github\.com/i.test(origin.out) && head.branch && head.branch !== defaultBranch && head.branch !== '(detached)') {
    pr = await new Promise(resolve => execFile('gh', ['pr', 'view', '--json', 'number,url,state,title,isDraft'], { cwd: top, timeout: 15_000, windowsHide: true },
      (err, out) => { try { resolve(err ? null : JSON.parse(out)) } catch { resolve(null) } }))
    prCache.set(key, { at: Date.now(), pr })
  }
  return {
    repo: true, root: top, ...head, detached: head.branch === '(detached)', hasHead: hasHead.ok, files: files.slice(0, 500), more: Math.max(0, files.length - 500),
    log, remote: origin.ok ? origin.out.trim() : '', github: origin.ok && /github\.com/i.test(origin.out), defaultBranch, pr, gh: onPath(process.platform === 'win32' ? 'gh.exe' : 'gh'),
  }
}

async function gitFileDiff(top, file) {
  const abs = path.resolve(top, file)
  if (path.relative(top, abs).startsWith('..')) throw Object.assign(new Error('Fuera del repo'), { status: 400 })
  const tracked = (await gitRun(top, ['ls-files', '--error-unmatch', '--', file])).ok
  if (!tracked) {
    // A new file: all of it, as added lines.
    let text = ''
    try { const st = fs.statSync(abs); if (st.size > 400_000) return { file, binary: false, big: true, diff: '' }; text = fs.readFileSync(abs, 'utf8') } catch { return { file, diff: '' } }
    if (text.includes('\0')) return { file, binary: true, diff: '' }
    const lines = text.replace(/\n$/, '').split('\n')
    return { file, diff: `@@ -0,0 +1,${lines.length} @@ archivo nuevo\n${lines.map(l => `+${l}`).join('\n')}` }
  }
  const hasHead = (await gitRun(top, ['rev-parse', '--verify', '-q', 'HEAD'])).ok
  const r = await gitRun(top, ['diff', '--no-color', '--no-ext-diff', ...(hasHead ? ['HEAD'] : ['--cached']), '--', file])
  const body = r.out.split('\n')
  const at = body.findIndex(l => l.startsWith('@@'))
  return { file, binary: /^Binary files/m.test(r.out), diff: at < 0 ? '' : body.slice(at).join('\n').slice(0, 400_000) }
}

async function gitAction(b) {
  const cwd = String(b.path ?? '')
  const top = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim()
  if (!top) throw Object.assign(new Error('No es un repo git'), { status: 400 })
  const op = String(b.op ?? '')
  const files = Array.isArray(b.files) ? b.files.map(String).filter(f => f && !f.startsWith('-')) : null
  if (op === 'commit') {
    const message = String(b.message ?? '').trim()
    if (!message) throw Object.assign(new Error('Falta el mensaje'), { status: 400 })
    const add = await gitRun(top, files?.length ? ['add', '-A', '--', ...files] : ['add', '-A'])
    if (!add.ok) throw gitFail(add)
    const r = await gitRun(top, ['commit', '-m', message])
    if (!r.ok) throw gitFail({ err: r.err || r.out })
    return { ok: true, out: r.out.split('\n')[0] }
  }
  if (op === 'push') {
    const up = (await gitRun(top, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])).ok
    const r = await gitRun(top, up ? ['push'] : ['push', '-u', 'origin', 'HEAD'], 120_000)
    if (!r.ok) throw gitFail(r)
    return { ok: true, out: r.err.split('\n').filter(Boolean).pop() ?? '' }
  }
  if (op === 'pull') {
    const r = await gitRun(top, ['pull', '--ff-only'], 120_000)
    if (!r.ok) throw gitFail(r)
    return { ok: true, out: r.out.trim().split('\n').pop() ?? '' }
  }
  if (op === 'fetch') {
    const r = await gitRun(top, ['fetch', '--prune'], 120_000)
    if (!r.ok) throw gitFail(r)
    return { ok: true }
  }
  if (op === 'discard') {
    const file = String(b.file ?? '')
    if (!file || file.startsWith('-') || path.relative(top, path.resolve(top, file)).startsWith('..')) throw Object.assign(new Error('Archivo inválido'), { status: 400 })
    const tracked = (await gitRun(top, ['ls-files', '--error-unmatch', '--', file])).ok
    const r = tracked
      ? await gitRun(top, ['restore', '--source=HEAD', '--staged', '--worktree', '--', file])
      : await gitRun(top, ['clean', '-f', '--', file])
    if (!r.ok) throw gitFail(r)
    return { ok: true }
  }
  if (op === 'branch') {
    const name = String(b.name ?? '').trim()
    if (!/^[\w./-]+$/.test(name) || name.startsWith('-')) throw Object.assign(new Error('Nombre de rama inválido'), { status: 400 })
    const r = await gitRun(top, ['switch', '-c', name])
    if (!r.ok) throw gitFail(r)
    return { ok: true }
  }
  if (op === 'pr') {
    const args = ['pr', 'create', ...(b.title ? ['--title', String(b.title).slice(0, 250), '--body', String(b.body ?? '').slice(0, 20_000)] : ['--fill']), ...(b.draft ? ['--draft'] : [])]
    const out = await new Promise((resolve, reject) => execFile('gh', args, { cwd: top, timeout: 90_000, windowsHide: true },
      (err, o, se) => err ? reject(Object.assign(new Error(String(se || err.message).trim().split('\n').slice(-3).join('\n')), { status: 400 })) : resolve(String(o))))
    prCache.clear()
    return { ok: true, url: out.trim().split('\n').pop() }
  }
  throw Object.assign(new Error(`op ${op}`), { status: 400 })
}

async function fsOp(q) {
  const op = q.get('op') ?? 'list'
  const target = path.resolve(q.get('path') || os.homedir())
  if (op === 'list') {
    const ents = fs.readdirSync(target, { withFileTypes: true })
    const marks = await gitMarks(target)
    const entries = ents.map(d => {
      let size = 0, mtime = 0, dir = d.isDirectory()
      try { const st = fs.statSync(path.join(target, d.name)); size = st.size; mtime = st.mtimeMs; dir = st.isDirectory() } catch {}
      return { name: d.name, dir, size, mtime, git: marks[d.name] ?? null }
    }).sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    const parent = path.dirname(target)
    return { path: target, parent: parent === target ? null : parent, sep: path.sep, entries, branch: branchOf(target), trusted: isTrusted(target) }
  }
  if (op === 'read') {
    const st = fs.statSync(target)
    if (st.isDirectory()) throw new Error('es una carpeta')
    const ext = path.extname(target).toLowerCase()
    if (IMAGE[ext]) {
      if (st.size > IMAGE_MAX) return { path: target, size: st.size, kind: 'large' }
      return { path: target, size: st.size, kind: 'image', data: `data:${IMAGE[ext]};base64,${fs.readFileSync(target).toString('base64')}` }
    }
    const fd = fs.openSync(target, 'r')
    const buf = Buffer.alloc(Math.min(st.size, TEXT_MAX))
    fs.readSync(fd, buf, 0, buf.length, 0)
    fs.closeSync(fd)
    if (buf.subarray(0, 8000).includes(0)) return { path: target, size: st.size, kind: 'binary' }
    return { path: target, size: st.size, kind: 'text', text: buf.toString('utf8'), truncated: st.size > TEXT_MAX, mtime: st.mtimeMs }
  }
  if (op === 'search') {
    // Fuzzy file finder over the project: every letter of the query, in order.
    const needle = String(q.get('q') ?? '').toLowerCase().replace(/\s+/g, '')
    if (!needle) return { results: [] }
    const hits = []
    let seen = 0
    const walk = (dir, depth) => {
      if (depth > 12 || seen > 30_000) return
      let ents = []
      try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
      for (const d of ents) {
        seen++
        if (SKIP.has(d.name)) continue
        const full = path.join(dir, d.name)
        const rel = path.relative(target, full)
        const score = fuzzy(rel.toLowerCase().replaceAll('\\', '/'), needle, d.name.toLowerCase())
        if (score > 0) hits.push({ path: full, rel: rel.replaceAll('\\', '/'), dir: d.isDirectory(), score })
        if (d.isDirectory()) walk(full, depth + 1)
      }
    }
    walk(target, 0)
    hits.sort((a, b) => b.score - a.score || a.rel.length - b.rel.length)
    return { results: hits.slice(0, 60) }
  }
  throw new Error(`op ${op}`)
}
function fuzzy(hay, needle, base) {
  let i = 0, score = 0, run = 0
  for (let j = 0; j < hay.length && i < needle.length; j++) {
    if (hay[j] === needle[i]) { i++; run++; score += run * 2 } else run = 0
  }
  if (i < needle.length) return 0
  if (base.includes(needle)) score += 40
  if (base.startsWith(needle)) score += 20
  return score
}

async function handleMod(req, res, url, p) {
  if (!safeEq(req.headers['x-pastor-secret'] ?? '', conf.secret)) return send(res, 403, { error: 'secret' })
  if (p === '/mod/health') return send(res, 200, { ok: true, version: VERSION, machine: MACHINE })
  if (p === '/mod/shutdown') { send(res, 200, { ok: true }); setTimeout(() => process.exit(0), 50); return }
  if (p === '/mod/poll') {
    const s = sessions.get(url.searchParams.get('session'))
    if (!s) return send(res, 404, { error: 'unknown session' })
    s.lastSeen = Date.now()
    // Presence, for routing asks: the session open on a phone now; a phone used lately at all.
    const phoneAt = Math.max(0, ...deviceSeen.values())
    return send(res, 200, { inbox: s.inbox.splice(0), away: s.away, watching: Date.now() - (s.watchedAt ?? 0) < 8_000, phoneAgo: phoneAt ? Date.now() - phoneAt : null })
  }
  if (p === '/mod/peers') {
    const peers = await Promise.all(Object.entries(conf.peers).map(async ([name, peer]) => {
      const ok = await peerFetch(name, 'api/info').then(r => r.status === 200, () => false)
      return { name, url: peer.url, online: ok }
    }))
    return send(res, 200, { machine: MACHINE, peers })
  }
  const b = await readBody(req)
  if (p === '/mod/link') {
    try { return send(res, 200, { ok: true, name: await linkPeer(String(b.url), String(b.code)) }) }
    catch (err) { return send(res, 400, { error: String(err.message ?? err) }) }
  }
  if (p === '/mod/unlink') {
    const had = !!conf.peers[b.name]
    delete conf.peers[b.name]; saveConf(conf)
    return send(res, had ? 200 : 404, { ok: had })
  }
  if (p === '/mod/register') {
    if (typeof b.id !== 'string' || !b.id) return send(res, 400, { error: 'id' })
    const prev = sessions.get(b.id)
    const agentType = typeof b.agentType === 'string' && b.agentType.trim() ? b.agentType.trim() : (prev?.agentType || 'claude-code')
    const s = prev ?? { id: b.id, agentType, events: [], pending: [], inbox: [], away: awayOnRegister(b.cwd), status: 'idle', updated: 0, live: null }
    Object.assign(s, { cwd: b.cwd, agentType, title: b.title || path.basename(b.cwd || '') || b.id.slice(0, 8), lastSeen: Date.now() })
    if (Number.isInteger(b.pid)) s.pid = b.pid
    // A session re-registering after a bridge restart says whether it is mid-turn.
    if (b.status === 'busy' || b.status === 'idle') { s.status = b.status; if (b.status === 'busy' && !s.live) s.live = { since: Date.now(), text: '', thinking: true, activity: null } }
    sessions.set(b.id, s)
    if (!prev) {
      pushEvent(s, { kind: 'info', text: `Sesión conectada · ${path.basename(b.cwd || '') || b.cwd}` })
      routineOnRegister(s)
      // Not known here (the bridge restarted while it lived, or it was a past
      // conversation): its history comes from the transcript, in the
      // background so events sent meanwhile are not lost. History keeps its
      // stable seq but takes a fresh rev so a phone already polling gets it.
      // Only lines written before this register: anything later the mod sends live.
      const at = Date.now()
      void seedEvents(b.cwd, b.id).then(history => {
        if (sessions.get(b.id) !== s || !history.length) return
        const have = new Set(s.events.map(e => e.seq))
        const add = history.filter(e => !have.has(e.seq) && e.t < at).map(e => ({ ...e, rev: ++seq }))
        if (!add.length) return
        // By time, not seq: history numbered just now has higher seqs than the live rows.
        s.events = [...add, ...s.events].sort((x, y) => (x.t ?? 0) - (y.t ?? 0)).slice(-MAX_EVENTS)
        s.updated = seq
      })
    }
    void refreshTitle(s)
    return send(res, 200, { ok: true, away: s.away, pairCode: conf.pairCode })
  }
  const s = sessions.get(b.session)
  if (!s) return send(res, 404, { error: 'unknown session' })
  s.lastSeen = Date.now()
  switch (p) {
    case '/mod/event': {
      if (b.status) s.status = b.status
      if (b.kind === 'tool' && !b.agent && s.status === 'idle') s.status = 'busy'
      if ((b.status === 'busy' || (b.kind === 'tool' && !b.agent)) && !s.live) s.live = { since: Date.now(), text: '', thinking: false, activity: null }
      if (b.status === 'idle') s.live = null
      if (b.kind) pushEvent(s, {
        kind: b.kind, text: String(b.text ?? '').slice(0, 40_000), tool: b.tool, id: b.id,
        detail: b.detail, agent: b.agent, ...(b.via ? { via: String(b.via).slice(0, 20) } : {}), ...(b.receipt && typeof b.receipt === 'object' ? { receipt: b.receipt } : {}),
      })
      if (b.final) { s.turnDone = true; s.turnDoneAt = Date.now(); s.doneSummary = String(b.summary ?? '').slice(0, 300) }
      // A question asked at the terminal (not in away mode, where it arrives as a pending).
      if (b.kind === 'tool' && b.tool === 'AskUserQuestion' && !b.agent && !b.detail?.answered) pushAlert(s, 'question', `❓ ${s.realTitle || s.title}`, String(b.text ?? '').slice(0, 300) || 'Claude te pregunta algo')
      checkDone(s)
      s.updated = ++seq
      return send(res, 200, { ok: true })
    }
    case '/mod/toolEnd': {
      const result = b.res && JSON.stringify(b.res).length <= 16_000 ? b.res : undefined
      patchEvent(s, b.id, { end: { ok: !!b.ok, ms: b.ms, out: String(b.out ?? '').slice(0, 4000), ...(result ? { res: result } : {}) } })
      return send(res, 200, { ok: true })
    }
    case '/mod/live': {
      // The turn as it streams: text so far in this step, thinking, activity.
      s.live = { since: s.live?.since ?? Date.now(), text: '', thinking: false, activity: null, ...s.live, ...b.live }
      if (s.status === 'idle') s.status = 'busy'
      s.updated = ++seq
      return send(res, 200, { ok: true })
    }
    case '/mod/pending': {
      s.pending.push({ ...b.item, t: Date.now() })
      s.status = 'waiting'; s.updated = ++seq
      const it = b.item
      pushAlert(s, it.kind === 'question' ? 'question' : 'permission',
        `${it.kind === 'question' ? '❓' : '🔐'} ${s.realTitle || s.title}`,
        it.kind === 'question' ? (it.questions ?? []).map(q => q.question).join(' · ') : `${it.tool}: ${it.summary ?? ''}`)
      return send(res, 200, { ok: true })
    }
    case '/mod/browser': {
      // A browser this session drives (agent-browser:<name> or playwright), remembered for its live view.
      const key = String(b.key ?? '').slice(0, 120)
      if (!/^(agent-browser:[\w.-]+|playwright)$/.test(key)) return send(res, 400, { error: 'key' })
      s.browserHints ??= new Map()
      s.browserHints.set(key, { key, url: typeof b.url === 'string' ? b.url.slice(0, 500) : s.browserHints.get(key)?.url, at: Date.now() })
      s.updated = ++seq
      return send(res, 200, { ok: true })
    }
    case '/mod/alert': pushAlert(s, String(b.kind ?? 'permission'), String(b.title ?? ''), String(b.body ?? '')); return send(res, 200, { ok: true })
    case '/mod/resolved': {
      s.pending = s.pending.filter(x => x.id !== b.id)
      if (b.note) pushEvent(s, { kind: 'info', text: b.note })
      if (!s.pending.length && s.status === 'waiting') s.status = 'busy'
      s.updated = ++seq
      return send(res, 200, { ok: true })
    }
    case '/mod/usage': {
      s.usage = b.usage
      // Context over time: one point per change, for the phone's chart.
      const tokens = Number(b.usage?.tokens)
      if (Number.isFinite(tokens)) {
        s.contextHistory ??= []
        if (s.contextHistory.at(-1)?.tokens !== tokens) {
          const percent = typeof b.usage.percent === 'number' ? b.usage.percent : null
          s.contextHistory.push({ t: Date.now(), tokens, percent })
          if (s.contextHistory.length > 200) s.contextHistory.splice(0, s.contextHistory.length - 200)
        }
      }
      s.updated = ++seq
      return send(res, 200, { ok: true })
    }
    case '/mod/patch': {
      // Progress on a row: a command's phase, a compaction's before/after.
      const allowed = ['phase', 'started', 'note', 'before', 'after', 'kept']
      const fields = Object.fromEntries(Object.entries(b.patch ?? {}).filter(([k]) => allowed.includes(k)))
      patchEvent(s, String(b.id), fields)
      return send(res, 200, { ok: true })
    }
    case '/mod/meta': s.meta = b.meta; s.metaAt = Date.now(); s.updated = ++seq; return send(res, 200, { ok: true })
    case '/mod/agents': s.agents = Array.isArray(b.agents) ? b.agents : []; s.updated = ++seq; checkDone(s); return send(res, 200, { ok: true })
    case '/mod/agentLog':
      s.agentLogs ??= {}
      // A finished agent's conversation may no longer read back: keep the last one seen.
      s.agentLogs[b.id] = b.error && s.agentLogs[b.id]?.messages.length
        ? { ...s.agentLogs[b.id], stale: true }
        : { at: Date.now(), messages: b.messages ?? [], error: b.error }
      return send(res, 200, { ok: true })
    case '/mod/workflows': s.workflows = Array.isArray(b.runs) ? b.runs.slice(-20) : []; s.updated = ++seq; return send(res, 200, { ok: true })
    case '/mod/messages': s.messages = Array.isArray(b.messages) ? b.messages.slice(-200) : []; s.updated = ++seq; return send(res, 200, { ok: true })
    case '/mod/tasks': s.tasks = Array.isArray(b.tasks) ? b.tasks : []; s.updated = ++seq; return send(res, 200, { ok: true })
    case '/mod/away': s.away = !!b.away; s.updated = ++seq; return send(res, 200, { ok: true })
    case '/mod/unregister':
      pushEvent(s, { kind: 'info', text: 'Sesión cerrada' })
      s.lastSeen = Date.now() - OFFLINE_MS - 1; s.pending = []; s.status = 'idle'; s.live = null
      return send(res, 200, { ok: true })
  }
  return send(res, 404, { error: 'no route' })
}

// A slash command: its row shows at once, the mod fills in the output.
function queueCommand(s, res, command, args) {
  if (!command) return send(res, 400, { error: 'comando vacío' })
  const id = 'cmd-' + crypto.randomBytes(5).toString('hex')
  s.inbox.push({ type: 'command', id, command, args: args.trim() })
  pushEvent(s, { kind: 'command', id, tool: command, text: `/${command}${args.trim() ? ' ' + args.trim() : ''}` })
  return send(res, 200, { ok: true, id })
}

// A request that names another PC goes to that PC's bridge, as is.
async function forwardToPeer(req, res, url, p, b, isHop, timeoutMs = 30_000) {
  const target = String(b?.machine ?? url.searchParams.get('machine') ?? MACHINE)
  if (target === MACHINE) return null
  if (isHop || !conf.peers[target]) { send(res, 404, { error: `PC ${target} no enlazada` }); return null }
  try {
    return b
      ? await peerFetch(target, p.slice(1), { method: 'POST', body: JSON.stringify(b), timeoutMs })
      : await peerFetch(target, p.slice(1) + url.search, { timeoutMs })
  } catch { return { status: 502, body: { error: `${target} no responde` } } }
}
const isRemote = (url, b) => String(b?.machine ?? url.searchParams.get('machine') ?? MACHINE) !== MACHINE
function runFile(bin, args, timeout = 10_000) {
  return new Promise(resolve => execFile(bin, args, { timeout, windowsHide: true, maxBuffer: 8_000_000 },
    (err, out, stderr) => resolve({ ok: !err, out: String(out ?? ''), err: String(stderr || err?.message || '').trim() })))
}

// ---- terminal: one-off commands on a PC, their output followed from the phone ----
const terms = new Map()
const TERM_KEEP = 1_500_000
function shellFor(cmd) {
  if (process.platform === 'win32') {
    const ps = onPath('pwsh.exe') ? 'pwsh.exe' : 'powershell.exe'
    return [ps, ['-NoLogo', '-NoProfile', '-Command', `[Console]::OutputEncoding=[Text.Encoding]::UTF8; ${cmd}`]]
  }
  return ['bash', ['-lc', cmd]]
}
function termRow(t, from) {
  const start = Math.max(from ?? 0, t.base)
  return {
    id: t.id, cmd: t.cmd, cwd: t.cwd, startedAt: t.startedAt, endedAt: t.endedAt ?? null, code: t.code ?? null, running: !t.endedAt,
    ...(from === undefined ? { tail: t.out.slice(-300) } : { chunk: t.out.slice(start - t.base), next: t.base + t.out.length, truncated: (from ?? 0) < t.base }),
  }
}
function termRun(cwd, cmd) {
  if (!cwd || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw Object.assign(new Error('Carpeta inválida'), { status: 400 })
  const [bin, argv] = shellFor(cmd)
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^CLAUDE/.test(k) || KEEP_ENV.has(k))), FORCE_COLOR: '1', CLICOLOR_FORCE: '1' }
  const child = spawn(bin, argv, { cwd, env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] })
  const t = { id: crypto.randomBytes(5).toString('hex'), cmd, cwd, startedAt: Date.now(), out: '', base: 0, child }
  const add = buf => {
    t.out += buf.toString('utf8')
    if (t.out.length > TERM_KEEP) { const cut = t.out.length - TERM_KEEP + 200_000; t.out = t.out.slice(cut); t.base += cut }
  }
  child.stdout.on('data', add); child.stderr.on('data', add)
  child.on('error', err => { add(Buffer.from(`\n${err.message}\n`)); t.endedAt ??= Date.now(); t.code ??= -1 })
  child.on('close', code => { t.endedAt = Date.now(); t.code = code ?? -1; t.child = null })
  terms.set(t.id, t)
  // Keep the last 30 runs.
  const ids = [...terms.keys()]
  for (const id of ids.slice(0, Math.max(0, ids.length - 30))) { const old = terms.get(id); if (!old.child) terms.delete(id) }
  return t
}
function termKill(t) {
  if (!t?.child?.pid) return
  if (process.platform === 'win32') execFile('taskkill', ['/pid', String(t.child.pid), '/t', '/f'], { windowsHide: true }, () => {})
  else { try { process.kill(-t.child.pid, 'SIGTERM') } catch { try { t.child.kill('SIGTERM') } catch { /* gone */ } } }
}

// ---- web previews: dev servers on this PC, opened on the phone over the tailnet ----
// `tailscale serve` publishes the server's own port on the tailnet (tailnet only)
// in front of a small local proxy that calls it as localhost, so dev servers that
// only accept their own host (Vite) answer too. Exposed ports survive restarts.
const TS_BIN = process.platform !== 'win32' && process.env.WSL_DISTRO_NAME && fs.existsSync('/mnt/c/Program Files/Tailscale/tailscale.exe')
  ? '/mnt/c/Program Files/Tailscale/tailscale.exe' : 'tailscale'
const previews = new Map() // port → { server, local }
let tsHostCache = ''
async function tsHost() {
  if (tsHostCache) return tsHostCache
  const r = await runFile(TS_BIN, ['status', '--json', '--peers=false'])
  try { tsHostCache = String(JSON.parse(r.out).Self?.DNSName ?? '').replace(/\.$/, '') } catch { /* no tailscale */ }
  return tsHostCache
}
// From WSL, `windows` asks the Windows host the same (its tools through interop).
const IS_WSL = !!process.env.WSL_DISTRO_NAME
async function listeningPorts(windows = false) {
  const rows = []
  if (process.platform === 'win32' || windows) {
    const x = windows ? '.exe' : ''
    const [v4, v6, tl] = await Promise.all([runFile('netstat' + x, ['-ano', '-p', 'TCP']), runFile('netstat' + x, ['-ano', '-p', 'TCPv6']), runFile('tasklist' + x, ['/fo', 'csv', '/nh'])])
    const names = new Map()
    for (const line of tl.out.split(/\r?\n/)) { const m = line.match(/^"([^"]+)","(\d+)"/); if (m) names.set(+m[2], m[1].replace(/\.exe$/i, '')) }
    for (const line of (v4.out + v6.out).split(/\r?\n/)) {
      const m = line.trim().match(/^TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)/)
      if (m && /^(127\.0\.0\.1|0\.0\.0\.0|\[::\]|\[::1\])$/.test(m[1])) rows.push({ port: +m[2], pid: +m[3], name: names.get(+m[3]) ?? '' })
    }
  } else {
    const r = await runFile('ss', ['-ltnpH'])
    for (const line of r.out.split('\n')) {
      const f = line.trim().split(/\s+/)
      if (f.length < 4) continue
      const local = f[3], port = +local.slice(local.lastIndexOf(':') + 1)
      if (!/^(127\.0\.0\.1|0\.0\.0\.0|\*|\[::\]|\[::1\]|::|::1)$/.test(local.slice(0, local.lastIndexOf(':')).replace(/%.*$/, ''))) continue
      const u = line.match(/users:\(\("([^"]+)",pid=(\d+)/)
      rows.push({ port, pid: u ? +u[2] : 0, name: u?.[1] ?? '' })
    }
  }
  const seen = new Map()
  for (const r of rows) if (!seen.has(r.port)) seen.set(r.port, r)
  return [...seen.values()]
}
const SYSTEM_PROC = /^(system|svchost|lsass|wininit|services|spoolsv|idle|jhi_service|mdnsresponder|tailscaled|tailscale-ipn|rpcss|searchindexer|steam|discord|spotify|code|cursor|msedge|chrome|firefox|ollama|docker.*|com\.docker.*|wslrelay|systemd.*|sshd|containerd|dockerd|caddy|cupsd|avahi.*)$/i
// What usually runs a dev server; anything else is listed apart.
const DEV_PROC = /^(node|bun|deno|python[\d.]*|py|php|ruby|java|dotnet|go|hugo|uvicorn|gunicorn|flask|astro|vite|next|nuxt|esbuild|wrangler|air|cargo|rails|puma|jekyll|zola|caddy|http-server|serve|live-server)$/i
function probeHttp(port) {
  return new Promise(resolve => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 1500, headers: { host: `localhost:${port}`, accept: 'text/html' } }, r => {
      let body = ''
      r.setEncoding('utf8')
      r.on('data', c => { if (body.length < 65_536) body += c })
      r.on('end', () => resolve({ status: r.statusCode, html: /html/i.test(String(r.headers['content-type'] ?? '')), title: (body.match(/<title[^>]*>([^<]{0,120})/i)?.[1] ?? '').trim() }))
      r.on('error', () => resolve(null))
    })
    req.on('timeout', () => { req.destroy(); resolve(null) })
    req.on('error', () => resolve(null))
  })
}
async function devServers() {
  const own = new Set([conf.port, 7878, 7879, 80, 443, ...[...previews.values()].map(x => x.local)])
  const ports = (await listeningPorts()).filter(r => r.port >= 1024 && !own.has(r.port) && !SYSTEM_PROC.test(r.name)).slice(0, 80)
  const probed = await Promise.all(ports.map(async r => ({ ...r, probe: await probeHttp(r.port) })))
  const host = await tsHost()
  return {
    machine: MACHINE, host, tailscale: !!host,
    servers: probed.filter(r => r.probe).map(r => ({
      port: r.port, pid: r.pid, process: r.name, status: r.probe.status, html: r.probe.html, title: r.probe.title,
      url: previews.has(r.port) && host ? `http://${host}:${r.port}/` : null,
      // A web page whose process we cannot see (another user's, a container): likely an app too.
      dev: DEV_PROC.test(r.name) || (!r.name && r.probe.html && r.probe.status < 400),
    })).sort((a, b) => Number(b.dev) - Number(a.dev) || Number(b.html) - Number(a.html) || a.port - b.port),
  }
}
// To the dev server every request looks like the browser on that PC: Host,
// Origin and Referer say localhost:<port> (dev servers that refuse other hosts
// or cross-origin requests accept it), and a redirect to localhost comes back
// relative so the phone follows it to the published address.
function asLocal(headers, port) {
  const h = { ...headers, host: `localhost:${port}` }
  const local = `http://localhost:${port}`
  if (h.origin) h.origin = local
  if (h.referer) h.referer = String(h.referer).replace(/^https?:\/\/[^/]+/, local)
  delete h['x-forwarded-host']; delete h['x-forwarded-for']; delete h['x-forwarded-proto']
  return h
}
function previewProxy(port) {
  const target = { host: '127.0.0.1', port }
  const toLocal = new RegExp(`^https?://(localhost|127\\.0\\.0\\.1|0\\.0\\.0\\.0|\\[::1?\\])(:${port})?(?=/|$)`, 'i')
  const server = http.createServer((req, res) => {
    const up = http.request({ ...target, method: req.method, path: req.url, headers: asLocal(req.headers, port) }, r => {
      const headers = { ...r.headers }
      if (headers.location) headers.location = String(headers.location).replace(toLocal, '') || '/'
      res.writeHead(r.statusCode ?? 502, headers); r.pipe(res)
    })
    up.on('error', () => { if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' }); res.end(`Nada escuchando en el puerto ${port}`) })
    req.pipe(up)
  })
  // WebSockets (hot reload): the upgrade passes through as raw bytes.
  server.on('upgrade', (req, socket, head) => {
    const up = net.connect(port, '127.0.0.1', () => {
      const headers = asLocal(req.headers, port)
      up.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`)
      if (head?.length) up.write(head)
      up.pipe(socket); socket.pipe(up)
    })
    up.on('error', () => socket.destroy()); socket.on('error', () => up.destroy())
  })
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server)) })
}
async function exposePreview(port) {
  port = Number(port)
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || [conf.port, 7878, 7879].includes(port)) throw Object.assign(new Error('Puerto inválido'), { status: 400 })
  const host = await tsHost()
  if (!host) throw Object.assign(new Error(`tailscale no está disponible en ${MACHINE}`), { status: 400 })
  let pv = previews.get(port)
  if (!pv) {
    const server = await previewProxy(port)
    pv = { server, local: server.address().port }
    previews.set(port, pv)
  }
  const r = await runFile(TS_BIN, ['serve', '--bg', `--http=${port}`, `http://127.0.0.1:${pv.local}`], 20_000)
  if (!r.ok) { pv.server.close(); previews.delete(port); throw Object.assign(new Error(r.err.split('\n').slice(-2).join(' ') || 'tailscale serve falló'), { status: 400 }) }
  conf.previews = [...new Set([...(conf.previews ?? []), port])]; saveConf(conf)
  return { ok: true, url: `http://${host}:${port}/` }
}
async function closePreview(port) {
  port = Number(port)
  await runFile(TS_BIN, ['serve', `--http=${port}`, 'off'], 15_000)
  previews.get(port)?.server.close()
  previews.delete(port)
  conf.previews = (conf.previews ?? []).filter(x => x !== port); saveConf(conf)
  return { ok: true }
}
// After a restart the local proxies are new: point the published ports at them again.
setTimeout(() => { for (const port of conf.previews ?? []) exposePreview(port).catch(() => {}) }, 3000)

// ---- local HTML (artifacts Claude writes), rendered on the phone ----
// A short-lived link to a file's folder, so its CSS, scripts and images load too.
const views = new Map() // token → { root, at }
const VIEW_TTL = 6 * 60 * 60_000
const VIEW_TYPES = { ...TYPES, '.htm': 'text/html; charset=utf-8', '.mjs': 'text/javascript', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.csv': 'text/plain; charset=utf-8', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.pdf': 'application/pdf', '.glb': 'model/gltf-binary' }
function makeView(file) {
  const abs = path.resolve(String(file ?? ''))
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw Object.assign(new Error('No existe ese archivo'), { status: 404 })
  for (const [k, v] of views) if (Date.now() - v.at > VIEW_TTL) views.delete(k)
  const root = path.dirname(abs)
  let token = [...views].find(([, v]) => v.root === root)?.[0]
  if (!token) { token = crypto.randomBytes(16).toString('hex'); views.set(token, { root, at: Date.now() }) }
  else views.get(token).at = Date.now()
  return { url: `view/${token}/${encodeURIComponent(path.basename(abs))}`, name: path.basename(abs) }
}
function serveView(res, p) {
  const m = p.match(/^\/view\/([0-9a-f]{32})\/(.*)$/)
  const v = m && views.get(m[1])
  if (!v || Date.now() - v.at > VIEW_TTL) return send(res, 404, 'Enlace caducado: ábrelo de nuevo desde pastor', 'text/plain; charset=utf-8')
  let rel = ''
  try { rel = decodeURIComponent(m[2] || 'index.html') } catch { return send(res, 400, 'ruta inválida', 'text/plain') }
  const abs = path.resolve(v.root, rel)
  if (path.relative(v.root, abs).startsWith('..') || path.isAbsolute(path.relative(v.root, abs))) return send(res, 403, 'fuera de la carpeta', 'text/plain')
  let st
  try { st = fs.statSync(abs) } catch { return send(res, 404, 'no encontrado', 'text/plain') }
  if (!st.isFile() || st.size > 50_000_000) return send(res, 404, 'no encontrado', 'text/plain')
  res.writeHead(200, { 'content-type': VIEW_TYPES[path.extname(abs).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store' })
  fs.createReadStream(abs).pipe(res)
}

// ---- live browsers: the Chrome an agent-browser session or the Playwright MCP
// drives, watched (and touched) from the phone over CDP ------------------------
const procCache = new Map()
async function processTable(windows = false) {
  const hit = procCache.get(windows)
  if (hit && Date.now() - hit.at < 4000) return hit.rows
  const rows = new Map()
  if (process.platform === 'win32' || windows) {
    const r = await runFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)`t$($_.ParentProcessId)`t$($_.Name)" }'], 20_000)
    for (const line of r.out.split(/\r?\n/)) { const [pid, ppid, name] = line.split('\t'); if (+pid) rows.set(+pid, { ppid: +ppid, name: String(name ?? '').replace(/\.exe$/i, '') }) }
  } else {
    const r = await runFile('ps', ['-eo', 'pid=,ppid=,comm='])
    for (const line of r.out.split('\n')) { const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/); if (m) rows.set(+m[1], { ppid: +m[2], name: m[3] }) }
  }
  procCache.set(windows, { at: Date.now(), rows })
  return rows
}
function ancestors(rows, pid) {
  const out = []
  for (let p = rows.get(pid)?.ppid, i = 0; p && i < 16 && !out.includes(p); p = rows.get(p)?.ppid, i++) out.push(p)
  return out
}
// agent-browser keeps <name>.pid (its daemon) per session in ~/.agent-browser.
let winHome = null
async function windowsHome() {
  if (winHome !== null) return winHome
  const r = await runFile('cmd.exe', ['/d', '/c', 'echo %USERPROFILE%'])
  const w = r.out.trim().split(/\r?\n/).pop()?.trim() ?? ''
  const m = w.match(/^([A-Za-z]):\\(.*)$/)
  winHome = m ? `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}` : ''
  return winHome
}
function agentBrowserDaemons(home = os.homedir()) {
  const dir = path.join(home, '.agent-browser')
  const out = new Map()
  // A session that attached to a Chrome already running (`agent-browser connect`)
  // is not its daemon's child: its <name>.target names the tab it drives.
  const targets = new Map() // page id → session name
  try {
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.pid')) {
        const pid = Number(fs.readFileSync(path.join(dir, f), 'utf8').trim())
        if (pid) out.set(pid, f.slice(0, -4))
      } else if (f.endsWith('.target')) {
        try { const t = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); if (t.targetId) targets.set(t.targetId, f.slice(0, -7)) } catch { /* partial write */ }
      }
    }
  } catch { /* not installed */ }
  out.targets = targets
  return out
}
function getJson(port, p, timeout = 1500) {
  return new Promise(resolve => {
    const req = http.get({ host: '127.0.0.1', port, path: p, timeout }, r => {
      let body = ''; r.setEncoding('utf8'); r.on('data', c => { body += c }); r.on('end', () => { try { resolve(JSON.parse(body)) } catch { resolve(null) } })
    })
    req.on('timeout', () => { req.destroy(); resolve(null) }); req.on('error', () => resolve(null))
  })
}
const BROWSER_PROC = /^(chrome|chromium|chromium-browser|msedge|headless_shell|chrome-headless-shell)$/i
async function findBrowsers() {
  const local = await findBrowsersOn(false)
  // A WSL session can drive a browser on Windows (agent-browser.cmd through cmd.exe);
  // with mirrored networking its CDP port answers here on 127.0.0.1 too.
  if (!IS_WSL) return local
  const home = await windowsHome()
  if (!home) return local
  const win = await findBrowsersOn(true, home).catch(() => [])
  return [...local, ...win.map(b => ({ ...b, host: 'windows' }))]
}
async function findBrowsersOn(windows, home) {
  const ports = (await listeningPorts(windows)).filter(r => BROWSER_PROC.test(r.name))
  if (!ports.length) return []
  const [rows, daemons] = [await processTable(windows), agentBrowserDaemons(home)]
  const bySessionPid = new Map()
  for (const s of sessions.values()) if (s.pid) bySessionPid.set(s.pid, s.id)
  const found = await Promise.all(ports.map(async r => {
    const version = await getJson(r.port, '/json/version')
    if (!version?.webSocketDebuggerUrl) return null
    const list = (await getJson(r.port, '/json/list')) ?? []
    const up = ancestors(rows, r.pid)
    const daemon = up.find(p => daemons.has(p))
    // Its daemon is an ancestor, or a live agent-browser session points at one of its tabs.
    const attached = list.map(t => daemons.targets.get(t.id)).find(n => n && [...daemons.values()].includes(n))
    const abName = daemon ? daemons.get(daemon) : attached ?? ''
    // The session whose Claude started it (Playwright MCP is its child), walking up.
    const session = up.map(p => bySessionPid.get(p)).find(Boolean) ?? null
    return {
      port: r.port, pid: r.pid, kind: abName ? 'agent-browser' : session ? 'playwright' : 'chrome', name: abName,
      session, headless: /headless/i.test(String(version['User-Agent'] ?? '')),
      pages: list.filter(t => t.type === 'page' && !/^(devtools|chrome-extension|chrome-untrusted):/.test(t.url))
        .map(t => ({ id: t.id, title: t.title, url: t.url })),
    }
  }))
  return found.filter(Boolean)
}
// The browsers a session has driven: what its mod reported, and what its own
// history shows (so a bridge restart or an older session still knows).
function browserKeys(s) {
  if (!s) return new Set()
  if (s.browserScan?.updated === s.updated) return s.browserScan.keys
  const keys = new Set(s.browserHints?.keys() ?? [])
  for (const e of s.events.slice(-400)) {
    if (e.kind !== 'tool') continue
    if (e.tool === 'Bash' || e.tool === 'PowerShell') {
      const cmd = `${e.detail?.command ?? ''} ${e.text ?? ''}`
      if (!/\bagent-browser\b/.test(cmd)) continue
      const name = cmd.match(/--session(?:=|\s+)["']?([\w.-]+)/)?.[1] ?? cmd.match(/AGENT_BROWSER_SESSION=["']?([\w.-]+)/)?.[1] ?? 'default'
      keys.add(`agent-browser:${name}`)
    } else if (/^mcp__.*playwright/i.test(e.tool ?? '')) keys.add('playwright')
  }
  s.browserScan = { updated: s.updated, keys }
  return keys
}
function browsersFor(all, s) {
  const names = new Set([...browserKeys(s)].filter(k => k.startsWith('agent-browser:')).map(k => k.slice(14)))
  return all.filter(b => (s && b.session === s.id) || (b.kind === 'agent-browser' && names.has(b.name)))
}

// A watch link: the page's screencast as MJPEG (an <img> plays it), from this
// PC straight to the phone; input goes through the API with the same token.
const watches = new Map() // token → { port, pageId, at, meta, ctl }
function cdpConnect(port, pageId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/devtools/page/${pageId}`)
    let n = 0
    const pending = new Map()
    const handlers = new Set()
    ws.addEventListener('message', ev => {
      let m; try { m = JSON.parse(String(ev.data)) } catch { return }
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } else for (const h of handlers) h(m)
    })
    ws.addEventListener('open', () => resolve({
      ws, on: h => handlers.add(h),
      send: (method, params = {}) => new Promise(r => {
        const id = ++n; pending.set(id, r)
        try { ws.send(JSON.stringify({ id, method, params })) } catch { r({ error: 'closed' }) }
        setTimeout(() => { if (pending.delete(id)) r({ error: 'timeout' }) }, 8000)
      }),
      close: () => { try { ws.close() } catch { /* gone */ } },
    }))
    ws.addEventListener('error', () => reject(new Error('No se pudo conectar con el navegador')))
    ws.addEventListener('close', () => { for (const r of pending.values()) r({ error: 'closed' }); pending.clear() })
  })
}
async function watchCtl(w) {
  if (w.ctl && w.ctl.ws.readyState === 1) return w.ctl
  w.ctl = await cdpConnect(w.port, w.pageId)
  return w.ctl
}
function serveLive(req, res, p) {
  const m = p.match(/^\/live\/([0-9a-f]{32})$/)
  const w = m && watches.get(m[1])
  if (!w) return send(res, 404, 'Enlace caducado: ábrelo de nuevo desde pastor', 'text/plain; charset=utf-8')
  w.at = Date.now()
  res.writeHead(200, { 'content-type': 'multipart/x-mixed-replace; boundary=pastorframe', 'cache-control': 'no-store', connection: 'close', 'x-accel-buffering': 'no' })
  const frame = buf => {
    if (res.writableEnded) return
    res.write(`--pastorframe\r\nContent-Type: image/jpeg\r\nContent-Length: ${buf.length}\r\n\r\n`)
    res.write(buf); res.write('\r\n')
  }
  let cdp = null, closed = false
  const stop = () => { if (closed) return; closed = true; if (cdp) { void cdp.send('Page.stopScreencast'); setTimeout(() => cdp.close(), 200) } }
  req.on('close', stop)
  cdpConnect(w.port, w.pageId).then(async c => {
    cdp = c
    if (closed) return c.close()
    c.on(m => {
      if (m.method !== 'Page.screencastFrame') return
      w.meta = m.params.metadata; w.at = Date.now()
      frame(Buffer.from(m.params.data, 'base64'))
      void c.send('Page.screencastFrameAck', { sessionId: m.params.sessionId })
    })
    c.ws.addEventListener('close', () => { if (!res.writableEnded) res.end() })
    const first = await c.send('Page.captureScreenshot', { format: 'jpeg', quality: 60 })
    if (first.result?.data) frame(Buffer.from(first.result.data, 'base64'))
    await c.send('Page.startScreencast', { format: 'jpeg', quality: 60, maxWidth: 1080, maxHeight: 2000, everyNthFrame: 1 })
  }, () => { if (!res.writableEnded) res.end() })
}
const KEYS = { Enter: [13, '\r'], Backspace: [8], Tab: [9], Escape: [27], ArrowDown: [40], ArrowUp: [38], ArrowLeft: [37], ArrowRight: [39] }
async function browserInput(w, b) {
  const c = await watchCtl(w)
  w.at = Date.now()
  let vw = w.meta?.deviceWidth, vh = w.meta?.deviceHeight
  if (!vw || !vh) {
    const r = await c.send('Runtime.evaluate', { expression: '[innerWidth, innerHeight]', returnByValue: true })
    ;[vw, vh] = r.result?.result?.value ?? [1280, 800]
  }
  const x = Math.max(0, Math.min(1, Number(b.x) || 0)) * vw, y = Math.max(0, Math.min(1, Number(b.y) || 0)) * vh
  switch (b.type) {
    case 'tap':
      await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
      await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
      await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
      return
    case 'scroll': await c.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: Number(b.dx) || 0, deltaY: Number(b.dy) || 0 }); return
    case 'text': await c.send('Input.insertText', { text: String(b.text ?? '').slice(0, 2000) }); return
    case 'key': {
      const k = KEYS[b.key]; if (!k) return
      await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: b.key, windowsVirtualKeyCode: k[0], ...(k[1] ? { text: k[1] } : {}) })
      await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: b.key, windowsVirtualKeyCode: k[0] })
      return
    }
    case 'navigate': { let u = String(b.url ?? '').trim(); if (!u) return; if (!/^[a-z]+:/i.test(u)) u = `https://${u}`; await c.send('Page.navigate', { url: u }); return }
    case 'back': await c.send('Runtime.evaluate', { expression: 'history.back()' }); return
    case 'reload': await c.send('Page.reload', {}); return
  }
}
setInterval(() => { for (const [k, w] of watches) if (Date.now() - w.at > 30 * 60_000) { w.ctl?.close(); watches.delete(k) } }, 60_000)

// ---- routines: a prompt that runs by itself on a schedule ----------------------
// Each one lives on the bridge of the PC it runs on (conf.routines), so it runs
// even with the hub down. At its time it opens a new session in its folder, the
// session gets the prompt as soon as it registers, and the phone is told when it
// is done (and the session closed, if asked).
const ROUTINE_RUNS = 12
const routineStarts = [] // { key, id, until }: a launched routine waiting for its session
const MINUTE = 60_000

// The next time a schedule fires after `from`. Daily times are the phone's clock:
// `tz` is its getTimezoneOffset() (minutes behind UTC), so 08:00 is 08:00 there.
function nextRunOf(r, from = Date.now()) {
  const sc = r.schedule ?? {}
  if (sc.kind === 'once') return sc.at > from ? sc.at : null
  if (sc.kind === 'interval') {
    const every = Math.max(15, Number(sc.minutes) || 60) * MINUTE
    const base = r.lastRun ?? r.created ?? from
    let next = base + every
    while (next <= from) next += every
    return next
  }
  if (sc.kind === 'daily') {
    const [h, m] = String(sc.time ?? '08:00').split(':').map(Number)
    const tz = Number(sc.tz) || 0
    const days = Array.isArray(sc.days) && sc.days.length ? sc.days : [0, 1, 2, 3, 4, 5, 6]
    const local = new Date(from - tz * MINUTE) // wall clock of the phone, read as UTC
    for (let d = 0; d < 8; d++) {
      const at = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + d, h || 0, m || 0) + tz * MINUTE
      if (at > from && days.includes(new Date(at - tz * MINUTE).getUTCDay())) return at
    }
  }
  return null
}
function routineView(r) {
  return { ...r, machine: MACHINE, running: (r.runs ?? []).some(x => x.status === 'running' || x.status === 'launched') }
}
function cleanRoutine(b, prev) {
  const sc = b.schedule ?? {}
  const kind = ['once', 'daily', 'interval'].includes(sc.kind) ? sc.kind : null
  if (!kind) throw Object.assign(new Error('Horario inválido'), { status: 400 })
  const schedule = kind === 'once' ? { kind, at: Number(sc.at) || 0 }
    : kind === 'interval' ? { kind, minutes: Math.max(15, Math.min(7 * 24 * 60, Number(sc.minutes) || 60)) }
    : { kind, time: /^\d{1,2}:\d{2}$/.test(String(sc.time)) ? String(sc.time) : '08:00', days: (Array.isArray(sc.days) ? sc.days : []).map(Number).filter(d => d >= 0 && d <= 6), tz: Number(sc.tz) || 0 }
  const prompt = String(b.prompt ?? '').trim().slice(0, 20_000)
  const cwd = String(b.cwd ?? '').trim()
  if (!prompt) throw Object.assign(new Error('Falta el prompt'), { status: 400 })
  if (!cwd || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw Object.assign(new Error('La carpeta no existe en esta PC'), { status: 400 })
  const r = {
    id: prev?.id ?? crypto.randomBytes(5).toString('hex'), created: prev?.created ?? Date.now(),
    name: String(b.name ?? '').trim().slice(0, 80) || prompt.split('\n')[0].slice(0, 60),
    cwd, prompt, schedule,
    permissionMode: ['default', 'acceptEdits', 'bypassPermissions', 'plan'].includes(b.permissionMode) ? b.permissionMode : 'default',
    closeWhenDone: !!b.closeWhenDone, enabled: b.enabled !== false,
    lastRun: prev?.lastRun ?? null, runs: prev?.runs ?? [],
  }
  r.nextRun = r.enabled ? nextRunOf(r) : null
  if (kind === 'once' && !r.nextRun && r.enabled) throw Object.assign(new Error('Esa hora ya pasó'), { status: 400 })
  return r
}
function saveRoutines() { saveConf(conf) }
async function runRoutine(r, why = 'schedule') {
  const run = { at: Date.now(), why, status: 'launched', session: null, note: '' }
  r.runs = [run, ...(r.runs ?? [])].slice(0, ROUTINE_RUNS)
  r.lastRun = run.at
  if (r.schedule.kind === 'once' && why === 'schedule') r.enabled = false
  r.nextRun = r.enabled ? nextRunOf(r, run.at + 1000) : null
  saveRoutines()
  try {
    routineStarts.push({ key: trustKey(r.cwd).toLowerCase(), id: r.id, until: Date.now() + 4 * MINUTE })
    await launchLocal({ cwd: r.cwd, mode: 'new', name: `⏰ ${r.name}`.slice(0, 80), permissionMode: r.permissionMode, trust: true, away: true })
  } catch (err) {
    run.status = 'error'; run.note = String(err.message ?? err).slice(0, 300)
    pushAlert({ id: '', title: r.name }, 'done', `⚠️ Rutina "${r.name}" no arrancó`, run.note)
    saveRoutines()
  }
  return run
}
// A session that just registered: is it a routine's? Then it gets the prompt.
function routineOnRegister(s) {
  const now = Date.now()
  while (routineStarts.length && routineStarts[0].until <= now) {
    const gone = routineStarts.shift()
    const r = (conf.routines ?? []).find(x => x.id === gone.id)
    const run = r?.runs?.find(x => x.status === 'launched')
    if (run) { run.status = 'error'; run.note = 'La sesión no llegó a conectarse'; saveRoutines() }
  }
  const i = routineStarts.findIndex(x => x.key === trustKey(s.cwd ?? '').toLowerCase())
  if (i < 0) return
  const [start] = routineStarts.splice(i, 1)
  const r = (conf.routines ?? []).find(x => x.id === start.id)
  if (!r) return
  const run = r.runs?.find(x => x.status === 'launched')
  if (run) { run.status = 'running'; run.session = s.id }
  s.routine = { id: r.id, name: r.name, closeWhenDone: r.closeWhenDone }
  saveRoutines()
  // A moment for the session to finish starting before its first prompt.
  setTimeout(() => {
    s.inbox.push({ type: 'prompt', text: r.prompt, mode: 'queue' })
    pushEvent(s, { kind: 'user', text: r.prompt, via: 'routine' })
  }, 3000)
}
// The routine's session finished its work: record it, and close it if asked.
function routineDone(s) {
  if (!s.routine) return
  const r = (conf.routines ?? []).find(x => x.id === s.routine.id)
  const run = r?.runs?.find(x => x.session === s.id && x.status === 'running')
  if (run) { run.status = 'done'; run.ended = Date.now(); run.note = String(s.doneSummary ?? '').slice(0, 300); saveRoutines() }
  if (s.routine.closeWhenDone) {
    s.routine.closeWhenDone = false
    setTimeout(() => s.inbox.push({ type: 'close' }), 5000)
  }
}
function tickRoutines() {
  const now = Date.now()
  for (const r of conf.routines ?? []) {
    if (!r.enabled || !r.nextRun || r.nextRun > now) continue
    // Missed by more than an hour (the PC was off): skip to the next time, say so.
    if (now - r.nextRun > 60 * MINUTE) {
      r.runs = [{ at: r.nextRun, why: 'schedule', status: 'missed', session: null, note: 'La PC estaba apagada o el bridge no corría' }, ...(r.runs ?? [])].slice(0, ROUTINE_RUNS)
      if (r.schedule.kind === 'once') r.enabled = false
      r.nextRun = r.enabled ? nextRunOf(r, now) : null
      saveRoutines()
      continue
    }
    void runRoutine(r)
  }
}
setInterval(tickRoutines, 30_000)
setTimeout(tickRoutines, 5000)

// Start a Claude Code session in a terminal window on this machine (or tmux on a
// server with no screen). Throws an Error with .status when it cannot.
async function launchLocal(b) {
  const dir = String(b.cwd ?? '').trim()
  if (!dir || !path.isAbsolute(dir)) throw Object.assign(new Error('Carpeta inválida'), { status: 400 })
  const args = claudeArgs(b)
  if (b.clone) {
    const repo = String(b.clone).trim()
    if (!repo || repo.startsWith('-')) throw Object.assign(new Error('URL de repositorio inválida'), { status: 400 })
    if (fs.existsSync(dir)) throw Object.assign(new Error('La carpeta ya existe'), { status: 400 })
    try { fs.mkdirSync(path.dirname(dir), { recursive: true }) } catch (err) { throw Object.assign(new Error(`No se pudo crear la carpeta: ${err.message}`), { status: 400 }) }
    const err = await cloneRepo(repo, dir)
    if (err) throw Object.assign(new Error(err), { status: 400 })
  } else if (b.mkdir) {
    try { fs.mkdirSync(dir, { recursive: true }) } catch (err) { throw Object.assign(new Error(`No se pudo crear la carpeta: ${err.message}`), { status: 400 }) }
  }
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw Object.assign(new Error('Carpeta no existe'), { status: 400 })
  let trusted = isTrusted(dir)
  if (!trusted && b.trust) {
    try { trusted = trustFolder(dir) } catch (err) { throw Object.assign(new Error(`No se pudo marcar la carpeta como confiable: ${err.message}`), { status: 500 }) }
  }
  if (b.away !== false) awayLaunches.push({ key: trustKey(dir).toLowerCase(), until: Date.now() + 5 * 60_000 })
  const wsl = process.env.WSL_DISTRO_NAME
  const line = ['claude', ...args].map(shQuote).join(' ')
  // wt.exe splits its command line on ';' unless escaped.
  const wt = list => list.map(a => a.replace(/;/g, '\\;'))
  const [bin, argv] = process.platform === 'win32'
    ? ['wt.exe', wt(['-d', dir, 'claude', ...args])]
    : wsl
      ? ['wt.exe', wt(['wsl.exe', '-d', wsl, '--cd', dir, '--', 'bash', '-lic', line])] // -i: nvm and friends live in .bashrc
    : process.platform === 'darwin'
      ? ['osascript', ['-e', `tell application "Terminal" to do script ${JSON.stringify(`cd ${shQuote(dir)} && ${line}`)}`, '-e', 'tell application "Terminal" to activate']]
    : HEADLESS
      // -l: ~/.local/bin and nvm on PATH; attach later with `tmux attach -t <name>`.
      ? ['tmux', ['new-session', '-d', '-s', `claude-${Date.now().toString(36)}`, '-c', dir, 'bash', '-lc', line]]
      : ['x-terminal-emulator', ['-e', 'claude', ...args]]
  // A fresh session, not a child of the one that started this bridge: without
  // the parent's CLAUDE* markers (with them it would not even save its transcript).
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^CLAUDE/.test(k) || KEEP_ENV.has(k)))
  const child = spawn(bin, argv, { cwd: dir, detached: true, stdio: 'ignore', windowsHide: false, env })
  child.on('error', () => {})
  child.unref()
  return { ok: true, cwd: dir, trusted }
}

async function handleApi(req, res, url, p) {
  if (p === '/api/pair' && req.method === 'POST') {
    if (Date.now() < pairLockedUntil) return send(res, 429, { error: 'Demasiados intentos, espera un minuto' })
    const b = await readBody(req)
    if (!safeEq(String(b.code ?? '').trim(), conf.pairCode)) {
      if (++pairFails >= 5) { pairFails = 0; pairLockedUntil = Date.now() + 60_000 }
      return send(res, 403, { error: 'Código incorrecto' })
    }
    pairFails = 0
    const name = String(b.name || 'móvil').slice(0, 40) + '-' + crypto.randomBytes(2).toString('hex')
    const token = crypto.randomBytes(32).toString('hex')
    conf.devices[name] = { token, paired: new Date().toISOString() }
    conf.pairCode = newPairCode() // single use
    saveConf(conf)
    return send(res, 200, { token, name })
  }
  // Unauthenticated: lets the app check an address is a pastor bridge before pairing.
  if (p === '/api/ping') return send(res, 200, { pastor: true, machine: MACHINE, version: VERSION })
  const device = deviceOf(req)
  if (!device) return send(res, 401, { error: 'unpaired' })
  const isHop = req.headers['x-pastor-hop'] === '1'

  if (p === '/api/info') return send(res, 200, { machine: MACHINE, version: VERSION })
  // The Android app this bridge serves (/pastor.apk) and its version, for the app's update check.
  if (p === '/api/apk') {
    try { return send(res, 200, JSON.parse(fs.readFileSync(path.join(HERE, 'pastor.apk.json'), 'utf8'))) }
    catch { return send(res, 404, { error: 'Este bridge no tiene el APK' }) }
  }

  // ---- devices and PCs, managed from the phone ----------------------------
  // GET /api/admin[?machine=] lists that bridge's paired devices, its linked PCs
  // and its pairing code; POSTs revoke a device, renew the code, link or unlink
  // a PC. Another PC's bridge answers for itself (proxied like the rest).
  if (p === '/api/admin' || p.startsWith('/api/admin/')) {
    const b = req.method === 'POST' ? await readBody(req) : {}
    const target = String(b.machine ?? url.searchParams.get('machine') ?? MACHINE)
    if (target !== MACHINE) {
      if (isHop || !conf.peers[target]) return send(res, 404, { error: `PC ${target} no enlazada` })
      try {
        const r = req.method === 'POST'
          ? await peerFetch(target, p.slice(1), { method: 'POST', body: JSON.stringify({ ...b, machine: target }), timeoutMs: 15_000 })
          : await peerFetch(target, `${p.slice(1)}?machine=${encodeURIComponent(target)}`)
        return send(res, r.status, r.body)
      } catch { return send(res, 502, { error: `${target} no responde` }) }
    }
    const action = p.slice('/api/admin'.length).replace(/^\//, '')
    if (req.method === 'POST') {
      if (action === 'revoke') {
        const name = String(b.name ?? '')
        if (!conf.devices[name]) return send(res, 404, { error: 'No existe ese dispositivo' })
        delete conf.devices[name]; deviceSeen.delete(name); saveConf(conf)
        return send(res, 200, { ok: true, self: name === device })
      }
      if (action === 'rename') {
        const name = String(b.name ?? ''), to = String(b.to ?? '').trim().slice(0, 40)
        if (!conf.devices[name] || !to) return send(res, 400, { error: 'Nombre inválido' })
        if (conf.devices[to]) return send(res, 409, { error: 'Ya existe un dispositivo con ese nombre' })
        conf.devices[to] = conf.devices[name]; delete conf.devices[name]
        if (deviceSeen.has(name)) { deviceSeen.set(to, deviceSeen.get(name)); deviceSeen.delete(name) }
        saveConf(conf)
        return send(res, 200, { ok: true })
      }
      if (action === 'code') { conf.pairCode = newPairCode(); saveConf(conf); return send(res, 200, { ok: true, pairCode: conf.pairCode }) }
      if (action === 'link') {
        try { return send(res, 200, { ok: true, name: await linkPeer(String(b.url ?? ''), String(b.code ?? '').trim()) }) }
        catch (err) { return send(res, 400, { error: String(err.message ?? err) }) }
      }
      if (action === 'unlink') {
        const had = !!conf.peers[b.name]
        delete conf.peers[b.name]; saveConf(conf)
        return send(res, had ? 200 : 404, had ? { ok: true } : { error: 'No está enlazada' })
      }
      return send(res, 404, { error: 'no action' })
    }
    const peers = await Promise.all(Object.entries(conf.peers).map(async ([name, peer]) => {
      const info = await peerFetch(name, 'api/info').then(r => (r.status === 200 ? r.body : null), () => null)
      return { name, url: peer.url, linked: peer.linked ?? null, online: !!info, version: info?.version ?? null }
    }))
    const devices = Object.entries(conf.devices).map(([name, d]) => ({
      name, paired: d.paired ?? null, lastSeen: deviceSeen.get(name) ?? null, current: name === device, hub: name.startsWith('hub-'),
    })).sort((x, y) => Number(y.current) - Number(x.current) || (y.lastSeen ?? 0) - (x.lastSeen ?? 0))
    return send(res, 200, {
      machine: MACHINE, version: VERSION, pairCode: conf.pairCode, url: conf.publicUrl || null,
      devices, peers, awayDefault: !!conf.awayDefault, sessions: sessions.size,
    })
  }

  if (p === '/api/sessions') {
    const all = url.searchParams.get('all') === '1'
    const list = [...sessions.values()].filter(s => all || !isAgentSession(s)).map(summary)
    const pureHub = !CAN_LAUNCH && sessions.size === 0 && Object.keys(conf.peers).length > 0
    const machines = pureHub ? [] : [{ name: MACHINE, online: true, local: true }]
    if (!isHop) {
      await Promise.all(Object.keys(conf.peers).map(async name => {
        try {
          const r = await peerFetch(name, 'api/sessions')
          if (r.status !== 200) throw new Error(r.body.error)
          for (const s of r.body.sessions) list.push({ ...s, id: `${name}~${s.id}`, machine: name })
          machines.push({ name, online: true })
        } catch { machines.push({ name, online: false }) }
      }))
    }
    list.sort((a, b) => (b.pending - a.pending) || (b.online - a.online) || (b.lastSeen - a.lastSeen))
    return send(res, 200, { sessions: list, machines, machine: MACHINE, hub: pureHub, device })
  }

  if (p === '/api/recent') {
    const dirs = [...new Set([...sessions.values()].map(s => s.cwd).filter(Boolean))].map(cwd => ({ machine: MACHINE, cwd }))
    if (!isHop) {
      await Promise.all(Object.keys(conf.peers).map(async name => {
        const r = await peerFetch(name, 'api/recent').catch(() => null)
        if (r?.status === 200) for (const d of r.body.dirs) dirs.push({ machine: name, cwd: d.cwd })
      }))
    }
    const peersOnly = !CAN_LAUNCH && sessions.size === 0 && Object.keys(conf.peers).length > 0
    const machines = peersOnly ? Object.keys(conf.peers) : [MACHINE, ...Object.keys(conf.peers)]
    return send(res, 200, { dirs, machine: machines[0] ?? MACHINE, machines })
  }

  // Projects and files live on one PC: a request naming another is its bridge's.
  if ((p === '/api/projects' || p === '/api/fs' || p === '/api/projects/sessions' || p === '/api/github') && url.searchParams.get('machine') && url.searchParams.get('machine') !== MACHINE) {
    const name = url.searchParams.get('machine')
    if (!conf.peers[name]) return send(res, 404, { error: `PC ${name} no enlazada` })
    try {
      const r = await peerFetch(name, p.slice(1) + url.search, { timeoutMs: 15_000 })
      return send(res, r.status, r.body)
    } catch { return send(res, 502, { error: `${name} no responde` }) }
  }
  if (p === '/api/github') {
    try { return send(res, 200, await githubOp(url.searchParams)) } catch (err) { return send(res, 400, { error: String(err?.message ?? err) }) }
  }
  if (p === '/api/projects') return send(res, 200, { machine: MACHINE, projects: (await projects()).filter(x => url.searchParams.get('all') === '1' || !isAgentSession({ cwd: x.path + '/' })), roots: roots(), home: os.homedir() })
  if (p === '/api/projects/sessions') {
    const dir = String(url.searchParams.get('path') ?? '')
    if (!dir) return send(res, 400, { error: 'Falta la carpeta' })
    return send(res, 200, { machine: MACHINE, path: dir, sessions: await projectSessions(dir) })
  }
  if (p === '/api/fs') {
    try { return send(res, 200, await fsOp(url.searchParams)) } catch (err) { return send(res, 400, { error: String(err?.message ?? err) }) }
  }
  if (p === '/api/agent') {
    // The general agent (pastor-agent) runs next to this hub; the phone reaches
    // its settings, status and QR through here.
    let ac = null
    try { ac = JSON.parse(fs.readFileSync(path.join(process.env.PASTOR_AGENT_HOME || path.join(os.homedir(), 'pastor-agent'), 'config.json'), 'utf8')) } catch { /* not installed */ }
    if (!ac?.localSecret) return send(res, 404, { error: 'El agente no está instalado en este hub' })
    const b = req.method === 'POST' ? await readBody(req) : null
    const part = b ? String(b.op ?? '') : String(url.searchParams.get('part') ?? 'status')
    if (!(b ? ['config', 'channel', 'relink'] : ['status', 'config', 'activity', 'qr']).includes(part)) return send(res, 400, { error: 'part' })
    try {
      const r = await fetch(`http://127.0.0.1:${ac.port || 7890}/${part}`, {
        method: b ? 'POST' : 'GET', headers: { 'x-agent-secret': ac.localSecret, 'content-type': 'application/json' },
        body: b ? JSON.stringify(b) : undefined, signal: AbortSignal.timeout(b?.op === 'channel' ? 150_000 : 15_000),
      })
      return send(res, r.status, await r.json().catch(() => ({})))
    } catch { return send(res, 503, { error: 'El agente no responde' }) }
  }
  if (p === '/api/routines') {
    // GET ?machine= lists that PC's routines; POST {machine, op: save|delete|run|toggle, …}.
    const b = req.method === 'POST' ? await readBody(req) : null
    if (isRemote(url, b)) {
      const r = await forwardToPeer(req, res, url, p, b, isHop, 60_000)
      return r && send(res, r.status, r.body)
    }
    conf.routines ??= []
    try {
      if (!b) return send(res, 200, { machine: MACHINE, now: Date.now(), routines: conf.routines.map(routineView) })
      const r = conf.routines.find(x => x.id === b.id)
      if (b.op === 'save') {
        const next = cleanRoutine(b.routine ?? {}, r)
        conf.routines = r ? conf.routines.map(x => (x.id === r.id ? next : x)) : [...conf.routines, next]
        saveRoutines()
        return send(res, 200, { ok: true, routine: routineView(next) })
      }
      if (!r) return send(res, 404, { error: 'Esa rutina ya no existe' })
      if (b.op === 'delete') { conf.routines = conf.routines.filter(x => x.id !== r.id); saveRoutines(); return send(res, 200, { ok: true }) }
      if (b.op === 'toggle') {
        r.enabled = !!b.enabled
        r.nextRun = r.enabled ? nextRunOf(r) : null
        if (r.enabled && r.schedule.kind === 'once' && !r.nextRun) { r.enabled = false; saveRoutines(); return send(res, 400, { error: 'Esa hora ya pasó: edítala para ponerle otra' }) }
        saveRoutines()
        return send(res, 200, { ok: true, routine: routineView(r) })
      }
      if (b.op === 'run') { const run = await runRoutine(r, 'manual'); return send(res, 200, { ok: run.status !== 'error', run, error: run.status === 'error' ? run.note : undefined }) }
      return send(res, 400, { error: 'op' })
    } catch (err) { return send(res, err.status ?? 500, { error: String(err?.message ?? err) }) }
  }
  if (p === '/api/browser') {
    // GET ?session= (that session's browsers) or ?all=1; POST {op: watch|input, …}.
    const b = req.method === 'POST' ? await readBody(req) : null
    if (isRemote(url, b)) {
      const r = await forwardToPeer(req, res, url, p, b, isHop)
      if (!r) return
      if (r.status === 200 && r.body?.url && !/^https?:/.test(r.body.url)) r.body.url = new URL(r.body.url, conf.peers[b?.machine ?? url.searchParams.get('machine')].url).href
      return send(res, r.status, r.body)
    }
    try {
      if (!b) {
        const all = await findBrowsers()
        const sid = url.searchParams.get('session')
        return send(res, 200, { machine: MACHINE, browsers: sid ? browsersFor(all, sessions.get(sid)) : all })
      }
      if (b.op === 'watch') {
        const port = Number(b.port), pageId = String(b.pageId ?? '')
        const known = (await findBrowsers()).find(x => x.port === port && x.pages.some(pg => pg.id === pageId))
        if (!known) return send(res, 404, { error: 'Ese navegador o pestaña ya no existe' })
        const token = crypto.randomBytes(16).toString('hex')
        watches.set(token, { port, pageId, at: Date.now(), meta: null, ctl: null })
        return send(res, 200, { url: `live/${token}`, token })
      }
      if (b.op === 'shot') {
        const port = Number(b.port), pageId = String(b.pageId ?? '')
        const known = (await findBrowsers()).find(x => x.port === port && x.pages.some(pg => pg.id === pageId))
        if (!known) return send(res, 404, { error: 'Ese navegador o pestaña ya no existe' })
        const c = await cdpConnect(port, pageId)
        try {
          const r = await c.send('Page.captureScreenshot', { format: 'jpeg', quality: 70 })
          if (!r.result?.data) return send(res, 502, { error: 'El navegador no dio la captura' })
          return send(res, 200, { data: r.result.data })
        } finally { c.close() }
      }
      if (b.op === 'input') {
        const w = watches.get(String(b.token ?? ''))
        if (!w) return send(res, 404, { error: 'La vista caducó: ábrela de nuevo' })
        await browserInput(w, b)
        return send(res, 200, { ok: true })
      }
      return send(res, 400, { error: 'op' })
    } catch (err) { return send(res, err.status ?? 500, { error: String(err?.message ?? err) }) }
  }
  if (p === '/api/term' || p === '/api/preview' || p === '/api/view') {
    const b = req.method === 'POST' ? await readBody(req) : null
    if (isRemote(url, b)) {
      const r = await forwardToPeer(req, res, url, p, b, isHop, p === '/api/preview' ? 40_000 : 20_000)
      if (!r) return
      // A file link from another PC is that PC's own (the phone reaches it on the tailnet).
      if (p === '/api/view' && r.status === 200 && r.body?.url && !/^https?:/.test(r.body.url)) r.body.url = new URL(r.body.url, conf.peers[b?.machine ?? url.searchParams.get('machine')].url).href
      return send(res, r.status, r.body)
    }
    try {
      if (p === '/api/view') {
        const v = makeView(b?.path ?? url.searchParams.get('path'))
        return send(res, 200, { ...v, local: true })
      }
      if (p === '/api/preview') {
        if (!b) return send(res, 200, await devServers())
        if (b.op === 'open') return send(res, 200, await exposePreview(b.port))
        if (b.op === 'close') return send(res, 200, await closePreview(b.port))
        return send(res, 400, { error: 'op' })
      }
      // /api/term
      if (!b) {
        const id = url.searchParams.get('id')
        if (!id) return send(res, 200, { machine: MACHINE, shell: shellFor('')[0], runs: [...terms.values()].reverse().map(t => termRow(t)) })
        const t = terms.get(id)
        if (!t) return send(res, 404, { error: 'Ese comando ya no existe' })
        return send(res, 200, termRow(t, Number(url.searchParams.get('from') ?? 0) || 0))
      }
      if (b.op === 'run') {
        const cmd = String(b.cmd ?? '').trim()
        if (!cmd) return send(res, 400, { error: 'Comando vacío' })
        return send(res, 200, termRow(termRun(String(b.cwd ?? os.homedir()), cmd), 0))
      }
      const t = terms.get(String(b.id ?? ''))
      if (!t) return send(res, 404, { error: 'Ese comando ya no existe' })
      if (b.op === 'kill') { termKill(t); return send(res, 200, { ok: true }) }
      if (b.op === 'input') { t.child?.stdin.write(`${String(b.text ?? '')}\n`); return send(res, 200, { ok: true }) }
      if (b.op === 'forget') { termKill(t); terms.delete(t.id); return send(res, 200, { ok: true }) }
      return send(res, 400, { error: 'op' })
    } catch (err) { return send(res, err.status ?? 500, { error: String(err?.message ?? err) }) }
  }
  if (p === '/api/git') {
    // GET ?path= (status) or ?path=&file= (that file's diff); POST {op, path, …} acts.
    const b = req.method === 'POST' ? await readBody(req) : null
    const target = String(b?.machine ?? url.searchParams.get('machine') ?? MACHINE)
    if (target !== MACHINE) {
      if (isHop || !conf.peers[target]) return send(res, 404, { error: `PC ${target} no enlazada` })
      try {
        const r = b
          ? await peerFetch(target, 'api/git', { method: 'POST', body: JSON.stringify(b), timeoutMs: 150_000 })
          : await peerFetch(target, `api/git${url.search}`, { timeoutMs: 30_000 })
        return send(res, r.status, r.body)
      } catch { return send(res, 502, { error: `${target} no responde` }) }
    }
    try {
      if (b) return send(res, 200, await gitAction(b))
      const dir = String(url.searchParams.get('path') ?? '')
      if (!dir || !fs.existsSync(dir)) return send(res, 400, { error: 'Carpeta inválida' })
      const file = url.searchParams.get('file')
      if (file) {
        const top = (await git(dir, ['rev-parse', '--show-toplevel'])).trim()
        if (!top) return send(res, 400, { error: 'No es un repo git' })
        return send(res, 200, await gitFileDiff(top, file))
      }
      return send(res, 200, await gitStatus(dir))
    } catch (err) { return send(res, err.status ?? 500, { error: String(err?.message ?? err) }) }
  }

  if (p === '/api/upload' && req.method === 'POST') {
    // A file or photo from the phone, saved on the PC that runs the session.
    const raw = await readRaw(req, 30_000_000)
    const b = raw ? JSON.parse(raw) : {}
    if (b.machine && b.machine !== MACHINE) {
      if (isHop || !conf.peers[b.machine]) return send(res, 404, { error: `PC ${b.machine} no enlazada` })
      try {
        const r = await peerFetch(b.machine, 'api/upload', { method: 'POST', body: raw, timeoutMs: 60_000 })
        return send(res, r.status, r.body)
      } catch { return send(res, 502, { error: `${b.machine} no responde` }) }
    }
    try { return send(res, 200, saveUpload(b)) } catch (err) { return send(res, err.status ?? 500, { error: String(err.message ?? err) }) }
  }

  if (p === '/api/settings') {
    const b = req.method === 'POST' ? await readBody(req) : {}
    const target = String(b.machine ?? url.searchParams.get('machine') ?? MACHINE)
    if (target !== MACHINE) {
      if (isHop || !conf.peers[target]) return send(res, 404, { error: `PC ${target} no enlazada` })
      try {
        const r = req.method === 'POST'
          ? await peerFetch(target, 'api/settings', { method: 'POST', body: JSON.stringify({ ...b, machine: target }) })
          : await peerFetch(target, `api/settings?machine=${encodeURIComponent(target)}`)
        return send(res, r.status, r.body)
      } catch { return send(res, 502, { error: `${target} no responde` }) }
    }
    if (req.method === 'POST' && typeof b.awayDefault === 'boolean') { conf.awayDefault = b.awayDefault; saveConf(conf) }
    return send(res, 200, { machine: MACHINE, awayDefault: !!conf.awayDefault })
  }

  if (p === '/api/launch' && req.method === 'POST') {
    const b = await readBody(req)
    if (b.machine && b.machine !== MACHINE) {
      if (isHop || !conf.peers[b.machine]) return send(res, 404, { error: `PC ${b.machine} no enlazada` })
      try {
        // `resume` keeps older bridges (before mode) doing the right thing for "continue".
        const body = JSON.stringify({ ...b, resume: (b.mode ?? (b.resume ? 'continue' : 'new')) === 'continue' })
        const r = await peerFetch(b.machine, 'api/launch', { method: 'POST', body, timeoutMs: b.clone ? 200_000 : 60_000 })
        return send(res, r.status, r.body)
      } catch { return send(res, 502, { error: `${b.machine} no responde` }) }
    }
    try { return send(res, 200, await launchLocal(b)) } catch (err) { return send(res, err.status ?? 500, { error: String(err.message ?? err) }) }
  }

  const m = p.match(/^\/api\/session\/([^/]+)(?:\/(\w+))?$/)
  if (p === '/api/alerts') {
    // Since a time: this PC's alerts and, from the hub, every linked PC's.
    const since = Number(url.searchParams.get('since') ?? 0) || 0
    const all = localAlerts(since)
    if (!isHop) {
      await Promise.all(Object.keys(conf.peers).map(async name => {
        const r = await peerFetch(name, `api/alerts?since=${since}`).catch(() => null)
        if (r?.status === 200) for (const a of r.body.alerts ?? []) all.push({ ...a, session: `${name}~${a.session}`, machine: name })
      }))
    }
    all.sort((x, y) => x.t - y.t)
    return send(res, 200, { alerts: all.slice(-50), now: Date.now() })
  }
  if (p === '/api/network') {
    const since = Number(url.searchParams.get('since') ?? 0) || 0
    const peers = []
    if (!isHop) {
      await Promise.all(Object.keys(conf.peers).map(async name => {
        // A peer on an older bridge has no /api/network (404): skip it.
        const r = await peerFetch(name, `api/network?since=${since}`).catch(() => null)
        if (r?.status === 200 && Array.isArray(r.body?.messages)) peers.push({ name, messages: r.body.messages })
      }))
    }
    return send(res, 200, { messages: mergeNetwork(localNetwork(since), peers) })
  }

  if (!m) return send(res, 404, { error: 'not found' })
  const sid = decodeURIComponent(m[1])
  const action = m[2]

  if (sid.includes('~')) {
    // A session on another PC: hand the request to its bridge.
    const [peer, inner] = [sid.slice(0, sid.indexOf('~')), sid.slice(sid.indexOf('~') + 1)]
    if (!conf.peers[peer]) return send(res, 404, { error: `PC ${peer} no enlazada` })
    try {
      const raw = req.method === 'POST' ? await readRaw(req) : undefined
      const r = await peerFetch(peer, `api/session/${encodeURIComponent(inner)}${action ? `/${action}` : ''}${url.search}`,
        { method: req.method, body: raw, timeoutMs: action === 'diff' ? 10_000 : PEER_TIMEOUT_MS })
      if (r.body?.session) r.body.session = { ...r.body.session, id: sid, machine: peer }
      return send(res, r.status, r.body)
    } catch (err) {
      return send(res, 502, { error: `${peer} no responde` })
    }
  }

  const s = sessions.get(sid)
  if (!s) {
    // Not live: a past conversation, read back from its transcript (read-only).
    const file = findTranscript(sid)
    if (!file) return send(res, 404, { error: 'unknown session' })
    if (req.method === 'POST') return send(res, 409, { error: 'Sesión cerrada' })
    const meta = await transcriptMeta(file)
    if (!action) {
      const page = pageEvents(await transcriptEvents(file), url)
      if (page.before) return send(res, 200, page)
      return send(res, 200, {
        session: {
          id: sid, machine: MACHINE, title: meta.title, cwd: meta.cwd, status: 'idle', online: false, away: false,
          pending: 0, updated: 0, lastSeen: meta.lastUsed, activity: null, usage: null, last: null,
        },
        events: page.events, older: page.older, pending: [], live: null, seq, now: Date.now(), tasks: [], agents: [],
        workflows: [], messages: [], fromTranscript: true,
      })
    }
    if (action === 'agent') return send(res, 200, { agent: null, log: null })
    if (action === 'meta') return send(res, 200, { commands: [], config: [], mcp: [], tools: [], model: '' })
    if (action === 'diff' && meta.cwd && fs.existsSync(meta.cwd)) {
      const [status, diff, logl] = await Promise.all([
        git(meta.cwd, ['status', '--short', '--branch']),
        git(meta.cwd, ['diff', '--no-color', 'HEAD']),
        git(meta.cwd, ['log', '-1', '--format=%h %s (%cr)']),
      ])
      return send(res, 200, { status, diff: diff.slice(0, 400_000), last: logl.trim() })
    }
    return send(res, 404, { error: 'no action' })
  }
  if (!action) {
    // Someone has this session open on a phone right now (the mod routes asks by it).
    s.watchedAt = Date.now()
    const page = pageEvents(s.events, url)
    if (page.before) return send(res, 200, page)
    return send(res, 200, {
      session: summary(s), events: page.events, older: page.older, pending: s.pending,
      live: s.live, seq, now: Date.now(), tasks: s.tasks ?? [], agents: s.agents ?? [],
      contextHistory: s.contextHistory ?? [], workflows: s.workflows ?? [], messages: s.messages ?? [],
    })
  }
  if (action === 'agent') {
    const aid = url.searchParams.get('id') ?? ''
    return send(res, 200, { agent: (s.agents ?? []).find(a => a.id === aid) ?? null, log: s.agentLogs?.[aid] ?? null })
  }
  // `at`: when the session last sent it, so the phone can wait for the one after its change.
  if (action === 'meta') return send(res, 200, { ...(s.meta ?? { commands: [], config: [], mcp: [], tools: [], model: '' }), at: s.metaAt ?? 0 })
  if (action === 'diff') {
    const [status, diff, logl] = await Promise.all([
      git(s.cwd, ['status', '--short', '--branch']),
      git(s.cwd, ['diff', '--no-color', 'HEAD']),
      git(s.cwd, ['log', '-1', '--format=%h %s (%cr)']),
    ])
    return send(res, 200, { status, diff: diff.slice(0, 400_000), last: logl.trim() })
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'POST' })
  const b = await readBody(req)
  switch (action) {
    case 'prompt': {
      const text = String(b.text ?? '').trim()
      if (!text) return send(res, 400, { error: 'vacío' })
      const slash = text.match(/^\/([\w:.-]+)\s*([\s\S]*)$/)
      if (slash) return queueCommand(s, res, slash[1], slash[2])
      s.inbox.push({ type: 'prompt', text, mode: ['now', 'interrupt'].includes(b.mode) ? b.mode : 'queue' })
      pushEvent(s, { kind: 'user', text, via: 'phone' })
      return send(res, 200, { ok: true })
    }
    case 'decide':
      if (!s.pending.some(x => x.id === b.id)) return send(res, 409, { error: 'Ya no está pendiente' })
      s.inbox.push({ type: 'decide', id: b.id, decision: b.decision, answers: b.answers, reason: b.reason })
      s.pending = s.pending.filter(x => x.id !== b.id)
      s.updated = ++seq
      return send(res, 200, { ok: true })
    case 'abort': s.inbox.push({ type: 'abort' }); return send(res, 200, { ok: true })
    case 'command': return queueCommand(s, res, String(b.command ?? '').replace(/^\//, ''), String(b.args ?? ''))
    case 'config':
      if (typeof b.key !== 'string') return send(res, 400, { error: 'key' })
      s.inbox.push({ type: 'config', key: b.key, value: b.value }); return send(res, 200, { ok: true })
    case 'refresh': s.inbox.push({ type: 'meta' }); return send(res, 200, { ok: true })
    case 'agentMsg': {
      const text = String(b.text ?? '').trim()
      if (!text || !b.id) return send(res, 400, { error: 'vacío' })
      s.inbox.push({ type: 'agentMsg', id: String(b.id), text }); return send(res, 200, { ok: true })
    }
    case 'agentStop': s.inbox.push({ type: 'agentStop', id: String(b.id) }); return send(res, 200, { ok: true })
    case 'agentLog': s.inbox.push({ type: 'agentLog', id: String(b.id) }); return send(res, 200, { ok: true })
    case 'stopTask': s.inbox.push({ type: 'stopTask', id: String(b.id) }); return send(res, 200, { ok: true })
    case 'away': s.away = !!b.away; s.updated = ++seq; return send(res, 200, { ok: true, away: s.away })
    case 'forget': sessions.delete(s.id); return send(res, 200, { ok: true })
    case 'close':
      if (Date.now() - s.lastSeen > OFFLINE_MS) { sessions.delete(s.id); return send(res, 200, { ok: true, forgot: true }) }
      s.inbox.push({ type: 'close' }); return send(res, 200, { ok: true })
  }
  return send(res, 404, { error: 'no action' })
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x')
    const p = url.pathname
    if (p.startsWith('/mod/')) return await handleMod(req, res, url, p)
    if (p.startsWith('/api/')) {
      // A native shell (Capacitor) calls from its own origin; auth is the bearer token.
      res.setHeader('access-control-allow-origin', '*')
      res.setHeader('access-control-allow-headers', 'authorization, content-type')
      res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }
    }
    if (req.method === 'GET' && p.startsWith('/view/')) return serveView(res, p)
    if (req.method === 'GET' && p.startsWith('/live/')) return serveLive(req, res, p)
    if (req.method === 'GET' && !p.startsWith('/api/') && p !== '/legacy' && serveWeb(res, p)) return
    if (req.method === 'GET' && p === '/legacy') return send(res, 200, fs.readFileSync(path.join(HERE, 'app.html')), 'text/html; charset=utf-8')
    if (req.method === 'GET' && STATIC[p]) {
      const [file, type] = STATIC[p]
      return send(res, 200, fs.readFileSync(path.join(HERE, file)), type)
    }
    if (p.startsWith('/api/')) return await handleApi(req, res, url, p)
    return send(res, 404, { error: 'not found' })
  } catch (err) {
    send(res, 500, { error: String(err?.message ?? err) })
  }
})

server.on('error', err => { console.error(err); process.exit(1) })
server.listen(conf.port, '127.0.0.1')
setInterval(refreshTitles, 30_000)
setInterval(() => { for (const s of sessions.values()) checkDone(s) }, 5_000)
