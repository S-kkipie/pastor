// Which WhatsApp messages reach the agent: DMs from the owner's numbers only.
import fs from 'node:fs'
import path from 'node:path'

const normalizeJid = v => String(v ?? '').trim().replace(/:.*@/, '@')
const userOf = v => normalizeJid(v).replace(/@.*/, '').replace(/^\+/, '')

// A LID and its phone number point at each other in Baileys' mapping files.
function aliases(id, sessionDir) {
  const seen = new Set()
  const queue = [userOf(id)]
  while (queue.length) {
    const cur = queue.shift()
    if (!cur || seen.has(cur)) continue
    seen.add(cur)
    for (const suffix of ['', '_reverse']) {
      try {
        const mapped = userOf(JSON.parse(fs.readFileSync(path.join(sessionDir, `lid-mapping-${cur}${suffix}.json`), 'utf8')))
        if (mapped && !seen.has(mapped)) queue.push(mapped)
      } catch { /* no mapping */ }
    }
  }
  return seen
}

function unwrap(message) {
  let m = message
  for (let i = 0; i < 4 && m; i++) {
    const inner = m.ephemeralMessage?.message ?? m.viewOnceMessage?.message ?? m.viewOnceMessageV2?.message ?? m.documentWithCaptionMessage?.message
    if (!inner) break
    m = inner
  }
  return m
}

export function classify(msg, allowed, sessionDir, lidAliases = {}) {
  const key = msg?.key ?? {}
  const chat = String(key.remoteJid ?? '')
  if (!msg?.message || key.fromMe) return null
  if (/@(g\.us|broadcast|newsletter)$/.test(chat)) return null
  const allow = new Set(allowed)
  let from = null
  for (const id of [chat, key.remoteJidAlt]) {
    if (!id) continue
    const mapped = lidAliases[userOf(id)]
    for (const a of [...aliases(id, sessionDir), ...(mapped ? [String(mapped)] : [])]) if (allow.has(a)) { from = a; break }
    if (from) break
  }
  if (!from) return null
  const m = unwrap(msg.message)
  const media = m.imageMessage ? 'image' : m.documentMessage ? 'document' : m.audioMessage ? 'audio'
    : m.videoMessage ? 'video' : m.stickerMessage ? 'sticker' : null
  const text = m.conversation ?? m.extendedTextMessage?.text ?? m.imageMessage?.caption ?? m.documentMessage?.caption ?? m.videoMessage?.caption ?? ''
  return { id: String(key.id ?? ''), from, chat, text: String(text).trim(), media, fileName: m.documentMessage?.fileName ?? null, raw: msg }
}

const KIND = { image: 'una imagen', document: 'un archivo', video: 'un video', sticker: 'un sticker' }
// What the session receives for one inbound message (a file goes as its path on the VPS).
export function promptFor(m, savedPath) {
  if (!savedPath) return m.text
  const what = KIND[m.media] ?? 'un archivo'
  const head = m.text || `Te mandé ${what}.`
  return `${head}\n\n[Adjunto: ${what}${m.fileName ? ` (${m.fileName})` : ''} guardado en ${savedPath} — léelo con Read si lo necesitas]`
}
