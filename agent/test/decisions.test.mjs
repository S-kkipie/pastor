import test from 'node:test'
import assert from 'node:assert/strict'
import { formatPending, parseReply } from '../src/decisions.mjs'

const perm = { id: 'p1', kind: 'permission', tool: 'Bash', summary: 'docker restart x' }
const q = { id: 'q1', kind: 'question', questions: [{ question: '¿Color?', header: 'Color', multiSelect: false, options: [{ label: 'Rojo' }, { label: 'Azul', description: 'frío' }] }] }
const multi = { id: 'q2', kind: 'question', questions: [{ question: '¿Qué?', header: 'x', multiSelect: true, options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }] }] }

test('formato de un permiso y de una pregunta', () => {
  assert.match(formatPending(perm), /Bash/)
  assert.match(formatPending(perm), /1 = permitir/)
  const t = formatPending(q)
  assert.match(t, /¿Color\?/); assert.match(t, /1\. Rojo/); assert.match(t, /2\. Azul — frío/)
})
test('respuestas a un permiso', () => {
  assert.deepEqual(parseReply(perm, '1'), { decision: 'allow' })
  assert.deepEqual(parseReply(perm, ' sí '), { decision: 'allow' })
  assert.deepEqual(parseReply(perm, '2'), { decision: 'deny' })
  assert.equal(parseReply(perm, 'qué hace eso?'), null)
})
test('respuestas a preguntas', () => {
  assert.deepEqual(parseReply(q, '2'), { decision: 'allow', answers: { '¿Color?': 'Azul' } })
  assert.deepEqual(parseReply(q, 'verde'), { decision: 'allow', answers: { '¿Color?': 'verde' } })
  assert.deepEqual(parseReply(multi, '1, 3'), { decision: 'allow', answers: { '¿Qué?': 'A, C' } })
  assert.deepEqual(parseReply(q, 'cancelar'), { decision: 'deny' })
})
