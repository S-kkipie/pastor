import test from 'node:test'
import assert from 'node:assert/strict'
import { parseAddress, addressOf, resolveRef, networkRows, formatNetwork, RateLimit, checkText } from '../peers.mjs'

test('parseAddress', () => {
  assert.deepEqual(parseAddress('pastor:Laptop/7f3a2c1e'), { machine: 'laptop', ref: '7f3a2c1e' })
  assert.deepEqual(parseAddress('pastor:vps/Agente · WhatsApp'), { machine: 'vps', ref: 'Agente · WhatsApp' })
  assert.equal(parseAddress('laptop/7f3a'), null)
  assert.equal(parseAddress('pastor:laptop'), null)
  assert.equal(parseAddress('pastor:/x'), null)
})

test('addressOf usa 8 caracteres', () => {
  assert.equal(addressOf('laptop', '7f3a2c1e-aaaa-bbbb'), 'pastor:laptop/7f3a2c1e')
})

const rows = [
  { id: '7f3a2c1e-1111', title: 'pastor-app', online: true },
  { id: '7f3a9999-2222', title: 'Docs', online: true },
  { id: 'aaaa0000-3333', title: 'docs', online: true },
  { id: 'dead0000-4444', title: 'vieja', online: false },
]
test('resolveRef: id, id8, título y errores', () => {
  assert.deepEqual(resolveRef(rows, '7f3a2c1e-1111', 'laptop'), { id: '7f3a2c1e-1111' })
  assert.deepEqual(resolveRef(rows, '7f3a2c1e', 'laptop'), { id: '7f3a2c1e-1111' })
  assert.deepEqual(resolveRef(rows, 'PASTOR-APP', 'laptop'), { id: '7f3a2c1e-1111' })
  assert.match(resolveRef(rows, 'docs', 'laptop').error, /ambiguo/)
  assert.match(resolveRef(rows, '7f3a', 'laptop').error, /ambiguo/)
  const gone = resolveRef(rows, 'dead0000', 'laptop').error
  assert.match(gone, /ya no está/)
  assert.match(gone, /pastor:laptop\/7f3a2c1e/)
})

test('networkRows: quita propia, agente y cerradas; marca máquina; limita a 30', () => {
  const list = [
    { id: 'self0000-1', machine: 'vps', title: 'yo', online: true, status: 'busy' },
    { id: 'laptop~7f3a2c1e-1', machine: 'laptop', title: 'pastor-app', online: true, status: 'idle' },
    { id: 'laptop~bbbb0000-1', machine: 'laptop', title: 'cerrada', online: false, status: 'idle' },
    { id: 'agen0000-1', machine: 'vps', title: 'Agente · WhatsApp', online: true, status: 'idle', agent: true },
  ]
  const { rows: r, more } = networkRows(list, { self: 'self0000-1', selfMachine: 'vps' })
  assert.deepEqual(r, [{ address: 'pastor:laptop/7f3a2c1e', machine: 'laptop', id: '7f3a2c1e-1', title: 'pastor-app', status: 'idle' }])
  assert.equal(more, 0)
  const many = Array.from({ length: 35 }, (_, i) => ({ id: `pc~${String(i).padStart(8, '0')}`, machine: 'pc', title: `s${i}`, online: true, status: 'idle' }))
  const big = networkRows(many, { self: 'x', selfMachine: 'vps' })
  assert.equal(big.rows.length, 30)
  assert.equal(big.more, 5)
})

test('formatNetwork', () => {
  const text = formatNetwork({ rows: [{ address: 'pastor:laptop/7f3a2c1e', machine: 'laptop', id: '7f3a2c1e-1', title: 'pastor-app', status: 'idle' }], more: 2 })
  assert.match(text, /^Otras PCs \(pastor\)/)
  assert.match(text, /- pastor:laptop\/7f3a2c1e · "pastor-app" · laptop · quieta/)
  assert.match(text, /y 2 más/)
  assert.match(formatNetwork({ rows: [], more: 0 }), /ninguna sesión abierta/)
  assert.match(formatNetwork({ error: 'el hub no responde' }), /el hub no responde/)
})

test('RateLimit: 8 por ventana', () => {
  let t = 0
  const rl = new RateLimit({ now: () => t })
  for (let i = 0; i < 8; i++) assert.equal(rl.hit('a>b'), true)
  assert.equal(rl.hit('a>b'), false)
  assert.equal(rl.hit('b>a'), true)
  t = 600_001
  assert.equal(rl.hit('a>b'), true)
})

test('checkText', () => {
  assert.equal(checkText('hola'), null)
  assert.match(checkText('   '), /vacío/)
  assert.match(checkText('x'.repeat(20_001)), /20 000/)
})
