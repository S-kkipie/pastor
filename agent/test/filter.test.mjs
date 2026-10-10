import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { classify, promptFor } from '../src/filter.mjs'

const allowed = ['51900000001', '51900000002']
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-'))
const msg = (key, message) => ({ key: { id: 'M1', fromMe: false, ...key }, message })

test('DM de texto de un número permitido', () => {
  const m = classify(msg({ remoteJid: '51900000001@s.whatsapp.net' }, { conversation: 'hola' }), allowed, dir)
  assert.equal(m.from, '51900000001'); assert.equal(m.text, 'hola'); assert.equal(m.media, null)
})
test('grupos, estados, propios y desconocidos se ignoran', () => {
  assert.equal(classify(msg({ remoteJid: '123@g.us', participant: '51900000001@s.whatsapp.net' }, { conversation: 'x' }), allowed, dir), null)
  assert.equal(classify(msg({ remoteJid: 'status@broadcast' }, { conversation: 'x' }), allowed, dir), null)
  assert.equal(classify(msg({ remoteJid: '51900000001@s.whatsapp.net', fromMe: true }, { conversation: 'x' }), allowed, dir), null)
  assert.equal(classify(msg({ remoteJid: '51111111111@s.whatsapp.net' }, { conversation: 'x' }), allowed, dir), null)
  assert.equal(classify(msg({ remoteJid: '51900000001@s.whatsapp.net' }, null), allowed, dir), null)
})
test('primer contacto por LID con el teléfono en remoteJidAlt', () => {
  const m = classify(msg({ remoteJid: '99887766@lid', remoteJidAlt: '51900000002@s.whatsapp.net' }, { conversation: 'hey' }), allowed, dir)
  assert.equal(m.from, '51900000002'); assert.equal(m.chat, '99887766@lid')
})
test('LID resuelto por archivo de mapeo', () => {
  fs.writeFileSync(path.join(dir, 'lid-mapping-55555_reverse.json'), JSON.stringify('51900000001'))
  const m = classify(msg({ remoteJid: '55555@lid' }, { conversation: 'x' }), allowed, dir)
  assert.equal(m.from, '51900000001')
})
test('texto de respuestas, pies de foto y mensajes temporales', () => {
  const j = '51900000001@s.whatsapp.net'
  assert.equal(classify(msg({ remoteJid: j }, { extendedTextMessage: { text: 'citado' } }), allowed, dir).text, 'citado')
  const img = classify(msg({ remoteJid: j }, { imageMessage: { caption: 'mira' } }), allowed, dir)
  assert.equal(img.media, 'image'); assert.equal(img.text, 'mira')
  assert.equal(classify(msg({ remoteJid: j }, { ephemeralMessage: { message: { conversation: 'efímero' } } }), allowed, dir).text, 'efímero')
  assert.equal(classify(msg({ remoteJid: j }, { audioMessage: { ptt: true } }), allowed, dir).media, 'audio')
  const doc = classify(msg({ remoteJid: j }, { documentMessage: { fileName: 'a.pdf' } }), allowed, dir)
  assert.equal(doc.media, 'document'); assert.equal(doc.fileName, 'a.pdf')
})
test('promptFor: foto sin texto lleva la ruta', () => {
  const m = { text: '', media: 'image', fileName: null }
  const p = promptFor(m, '/home/yo/pastor-agent/uploads/x.jpg')
  assert.match(p, /\/home\/yo\/pastor-agent\/uploads\/x\.jpg/)
  assert.match(p, /imagen/)
  assert.equal(promptFor({ text: 'hola', media: null }, null), 'hola')
})

test('LID sin alternativa: se resuelve con lidAliases', () => {
  const raw = msg({ remoteJid: '10000000000001@lid' }, { conversation: 'hola' })
  assert.equal(classify(raw, allowed, dir), null)
  assert.equal(classify(raw, allowed, dir, { 10000000000001: '51900000002' }).from, '51900000002')
  assert.equal(classify(raw, allowed, dir, { 999: '51900000002' }), null)
})
