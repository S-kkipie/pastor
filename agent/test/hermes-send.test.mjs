import test from 'node:test'
import assert from 'node:assert/strict'
import { hermesSender } from '../src/hermes-send.mjs'

test('hermesSender: un mensaje por número con hermes send, sin shell', async () => {
  const calls = []
  const send = hermesSender({ bin: '/home/opc/.local/bin/hermes', exec: async (file, args) => { calls.push([file, args]); return { stdout: '' } } })
  await send('51900000001', 'hola; rm -rf /')
  assert.deepEqual(calls, [['/home/opc/.local/bin/hermes', ['send', '-q', '-t', 'whatsapp:51900000001', '--', 'hola; rm -rf /']]])
})

test('hermesSender: un archivo va como MEDIA:<ruta>', async () => {
  const calls = []
  const send = hermesSender({ bin: 'hermes', exec: async (file, args) => { calls.push(args) } })
  await send('51900000001', 'mira', '/home/opc/hermes-salidas/r.html')
  assert.deepEqual(calls[0].at(-1), 'mira\nMEDIA:/home/opc/hermes-salidas/r.html')
})

test('hermesSender: el fallo de hermes send sube con su salida', async () => {
  const send = hermesSender({ bin: 'hermes', exec: async () => { throw Object.assign(new Error('exit 1'), { stderr: 'bridge not running' }) } })
  await assert.rejects(send('51900000001', 'x'), /bridge not running/)
})
