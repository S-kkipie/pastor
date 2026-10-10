// First install on the hub's machine: a device token named "agente" for the
// MCP and the relay, paired with the hub's current code.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadConfig, saveConfig } from './config.mjs'

const config = loadConfig()
if (config.token) { console.log('Ya tiene token.'); process.exit(0) }
const bridge = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'pastor', 'config.json'), 'utf8'))
const res = await fetch(`http://127.0.0.1:${bridge.port || 7878}/api/pair`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: bridge.pairCode, name: 'agente' }),
})
const r = await res.json()
if (!res.ok || !r.token) { console.error('No se pudo emparejar:', r.error ?? res.status); process.exit(1) }
config.token = r.token
config.hub = `http://127.0.0.1:${bridge.port || 7878}`
saveConfig(config)
console.log(`Emparejado como ${r.name}.`)
