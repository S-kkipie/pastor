import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DEFAULTS, loadConfig, saveConfig, patchConfig, loadState, saveState, normalizePhone, paths } from '../src/config.mjs'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pa-'))

test('defaults: permiso total, vigilante apagado, números del dueño', () => {
  assert.equal(DEFAULTS.permissions.total, true)
  assert.deepEqual(DEFAULTS.allowed, [])
  for (const k of ['needs', 'done', 'failures', 'routines', 'daily']) assert.equal(DEFAULTS.vigilante[k], false)
})

test('loadConfig crea el secreto local y lo guarda', () => {
  const h = tmp()
  const c = loadConfig(h)
  assert.match(c.localSecret, /^[0-9a-f]{32}$/)
  assert.equal(loadConfig(h).localSecret, c.localSecret)
  assert.equal(JSON.parse(fs.readFileSync(paths(h).config, 'utf8')).localSecret, c.localSecret)
})

test('loadConfig mezcla lo guardado con los defaults', () => {
  const h = tmp()
  fs.writeFileSync(paths(h).config, JSON.stringify({ token: 't', vigilante: { done: true } }))
  const c = loadConfig(h)
  assert.equal(c.token, 't')
  assert.equal(c.vigilante.done, true)
  assert.equal(c.vigilante.needs, false)
  assert.equal(c.port, 7890)
})

test('normalizePhone', () => {
  assert.equal(normalizePhone('+51 900 000 001'), '51900000001')
  assert.equal(normalizePhone('900000001'), '51900000001')
  assert.equal(normalizePhone('51900000002'), '51900000002')
})

test('patchConfig valida y normaliza', () => {
  const c = patchConfig(DEFAULTS, { allowed: ['900 000 001'], permissions: { total: false, groups: { terminal: 'pregunta' } }, sleepMinutes: 10 })
  assert.deepEqual(c.allowed, ['51900000001'])
  assert.equal(c.permissions.total, false)
  assert.equal(c.permissions.groups.terminal, 'pregunta')
  assert.equal(c.permissions.groups.files, 'libre')
  assert.equal(c.sleepMinutes, 10)
  assert.throws(() => patchConfig(DEFAULTS, { permissions: { groups: { terminal: 'quizás' } } }), /permiso/)
  assert.throws(() => patchConfig(DEFAULTS, { allowed: [] }), /número/)
  assert.throws(() => patchConfig(DEFAULTS, { vigilante: { dailyTime: '25:99' } }), /hora/)
})

test('estado: guardar y cargar', () => {
  const h = tmp()
  const s = loadState(h)
  assert.deepEqual(s.channels, {})
  s.channels.app = { current: 'x', history: [], lastActive: 1, lastText: '', lastAt: null }
  saveState(s, h)
  assert.equal(loadState(h).channels.app.current, 'x')
})

test('lidAliases se normaliza y valida', async () => {
  const { DEFAULTS, patchConfig } = await import('../src/config.mjs')
  assert.deepEqual(patchConfig(DEFAULTS, { lidAliases: { '149@lid': '900000002' } }).lidAliases, { 149: '51900000002' })
  assert.throws(() => patchConfig(DEFAULTS, { lidAliases: { 1: 'x' } }))
})

test('loadConfig: un config.json dañado no se reemplaza por los defaults', () => {
  const h = tmp()
  fs.writeFileSync(paths(h).config, '{"token": "secreto", roto')
  assert.throws(() => loadConfig(h), /config\.json/)
  assert.equal(fs.readFileSync(paths(h).config, 'utf8'), '{"token": "secreto", roto')
})
