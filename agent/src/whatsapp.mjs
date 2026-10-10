// The agent's own WhatsApp connection: a linked device on the bot's number
// (Baileys). Reconnects by itself; when WhatsApp
// ends the link it waits with a QR for the app.
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import makeWASocket, { DisconnectReason, downloadMediaMessage, fetchLatestBaileysVersion, useMultiFileAuthState } from '@whiskeysockets/baileys'
import pino from 'pino'
import QRCode from 'qrcode'

const IMAGE = /\.(png|jpe?g|webp|gif)$/i
const MIME = { '.html': 'text/html', '.htm': 'text/html', '.pdf': 'application/pdf', '.txt': 'text/plain', '.csv': 'text/csv', '.json': 'application/json', '.zip': 'application/zip' }

export class WhatsApp extends EventEmitter {
  constructor({ sessionDir, logger = pino({ level: 'warn' }) }) {
    super()
    Object.assign(this, { sessionDir, logger })
    this.state = 'connecting'; this.me = null; this.since = null; this.qr = null
    this.sock = null; this.gen = 0; this.timer = null; this.retry = 0; this.chain = Promise.resolve()
  }

  // Every (re)start goes through here: one pending restart at a time.
  restart(ms) {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.start().catch(err => { this.logger.error?.(err); this.restart(10_000) }), ms)
  }

  async start() {
    const gen = ++this.gen
    try { this.sock?.ev.removeAllListeners('connection.update'); this.sock?.ev.removeAllListeners('messages.upsert') } catch { /* gone */ }
    fs.mkdirSync(this.sessionDir, { recursive: true })
    const { state, saveCreds } = await useMultiFileAuthState(this.sessionDir)
    let version
    try { version = (await fetchLatestBaileysVersion()).version } catch { /* use the bundled one */ }
    const sock = makeWASocket({
      ...(version ? { version } : {}), auth: state, logger: this.logger, printQRInTerminal: false,
      browser: ['Pastor Agent', 'Chrome', '120.0'], syncFullHistory: false, markOnlineOnConnect: false,
      getMessage: async () => ({ conversation: '' }), // Baileys 7 needs it to finish retries
    })
    this.sock = sock
    sock.ev.on('creds.update', () => { if (gen === this.gen) void saveCreds() })
    sock.ev.on('connection.update', u => {
      if (gen !== this.gen) return
      if (u.qr) { this.qr = u.qr; this.state = 'logged_out'; this.emit('status') }
      if (u.connection === 'open') {
        this.state = 'connected'; this.qr = null; this.retry = 0; this.since = Date.now()
        this.me = String(sock.user?.id ?? '').replace(/:.*@/, '@').replace(/@.*/, '') || null
        this.emit('status')
      }
      if (u.connection === 'close') {
        const code = u.lastDisconnect?.error?.output?.statusCode
        if (code === DisconnectReason.loggedOut) {
          // WhatsApp ended the link: start over with an empty session, which shows a QR.
          this.state = 'logged_out'; this.emit('status')
          fs.rmSync(this.sessionDir, { recursive: true, force: true })
          this.restart(2000)
          return
        }
        this.state = 'disconnected'; this.emit('status')
        const wait = Math.min(60_000, 1000 * 2 ** Math.min(6, this.retry++))
        this.restart(code === 515 ? 1000 : wait)
      }
    })
    sock.ev.on('messages.upsert', ({ messages, type }) => {
      if (type !== 'notify' || gen !== this.gen) return
      for (const m of messages) void this.resolveLid(m).then(() => this.emit('message', m))
    })
  }

  // A @lid chat without a phone alternative: ask Baileys' own LID store.
  async resolveLid(m) {
    try {
      const jid = m?.key?.remoteJid
      if (!jid?.endsWith('@lid') || m.key.remoteJidAlt) return
      const pn = await this.sock?.signalRepository?.lidMapping?.getPNForLID(jid)
      if (pn) m.key.remoteJidAlt = pn
    } catch { /* classify falls back to config aliases */ }
  }

  async qrDataUrl() { return this.qr ? QRCode.toDataURL(this.qr, { margin: 1, width: 320 }) : null }

  // Waits (up to 3 min) for the connection to be open.
  async connected(ms = 180_000) {
    const until = Date.now() + ms
    while (this.state !== 'connected') {
      if (Date.now() >= until) throw new Error('WhatsApp no está conectado')
      await new Promise(r => setTimeout(r, 1000))
    }
  }

  // One send at a time on the socket, each bounded (Baileys can hang); while
  // WhatsApp reconnects it waits, and a failed send is tried once more.
  queue(fn) {
    const once = () => {
      let timer
      return Promise.race([fn(), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('WhatsApp no respondió')), 30_000) })]).finally(() => clearTimeout(timer))
    }
    const p = this.chain.then(async () => {
      await this.connected()
      try { return await once() } catch { await this.connected(); return once() }
    })
    this.chain = p.catch(() => {})
    return p
  }
  jid(number) { return `${String(number).replace(/\D/g, '')}@s.whatsapp.net` }
  sendText(number, text) { return this.queue(() => this.sock.sendMessage(this.jid(number), { text })) }
  sendFile(number, file, caption) {
    const buf = fs.readFileSync(file)
    const name = path.basename(file)
    const msg = IMAGE.test(file) ? { image: buf, caption } : { document: buf, fileName: name, mimetype: MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream', caption }
    return this.queue(() => this.sock.sendMessage(this.jid(number), msg))
  }
  async typing(number, on) {
    let timer
    try { await Promise.race([this.sock?.sendPresenceUpdate(on ? 'composing' : 'paused', this.jid(number)), new Promise(r => { timer = setTimeout(r, 5000) })]) }
    catch { /* not important */ } finally { clearTimeout(timer) }
  }
  download(raw) { return downloadMediaMessage(raw, 'buffer', {}, { logger: this.logger, reuploadRequest: this.sock.updateMediaMessage }) }
  async relink() {
    this.gen++ // events from the old socket are stale from here on
    try { await this.sock?.logout() } catch { /* already gone */ }
    fs.rmSync(this.sessionDir, { recursive: true, force: true })
    this.state = 'logged_out'; this.emit('status')
    this.restart(1000)
  }
}
