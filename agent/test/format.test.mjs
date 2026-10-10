import test from 'node:test'
import assert from 'node:assert/strict'
import { toWhatsApp, splitMessage } from '../src/format.mjs'

test('negritas, títulos, tachado, enlaces y viñetas', () => {
  assert.equal(toWhatsApp('## Estado\n**listo** y ~~viejo~~'), '*Estado*\n*listo* y ~viejo~')
  assert.equal(toWhatsApp('ver [docs](https://x.y)'), 'ver docs (https://x.y)')
  assert.equal(toWhatsApp('- uno\n* dos'), '• uno\n• dos')
})
test('tablas a listas', () => {
  const out = toWhatsApp('| PC | Estado |\n|---|---|\n| wsl | ok |\n| win | caído |')
  assert.equal(out, '*PC · Estado*\n• wsl · ok\n• win · caído')
})
test('el código se respeta', () => {
  assert.equal(toWhatsApp('```js\nconst **a** = 1\n```'), '```\nconst **a** = 1\n```')
})
test('trocear por párrafos sin pasar el límite', () => {
  const parts = splitMessage(`${'a'.repeat(30)}\n\n${'b'.repeat(30)}\n\n${'c'.repeat(30)}`, 70)
  assert.deepEqual(parts, [`${'a'.repeat(30)}\n\n${'b'.repeat(30)}`, 'c'.repeat(30)])
  for (const p of splitMessage('x'.repeat(9000))) assert.ok(p.length <= 4000)
  assert.deepEqual(splitMessage(''), [])
})
