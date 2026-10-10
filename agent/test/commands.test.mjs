import test from 'node:test'
import assert from 'node:assert/strict'
import { asPlain, parseCommand } from '../src/commands.mjs'

test('comandos', () => {
  assert.deepEqual(parseCommand('/new'), { name: 'new', arg: '' })
  assert.deepEqual(parseCommand('/resume 2'), { name: 'resume', arg: '2' })
  assert.deepEqual(parseCommand('  /STATUS  '), { name: 'status', arg: '' })
  assert.equal(parseCommand('/compact'), null)
  assert.equal(parseCommand('hola /new'), null)
})

test('asPlain: un texto con / que no es comando llega a Claude como texto', () => {
  assert.equal(asPlain('/compact ahora'), '​/compact ahora')
  assert.equal(asPlain('  /x'), '​  /x')
  assert.equal(asPlain('hola /new'), 'hola /new')
  assert.equal(asPlain(''), '')
})
