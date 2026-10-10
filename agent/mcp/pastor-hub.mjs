#!/usr/bin/env node
// pastor-hub MCP server (stdio, newline-delimited JSON-RPC) for the agent's sessions.
import readline from 'node:readline'
import { loadConfig } from '../src/config.mjs'
import { HubClient } from '../src/hub.mjs'
import { handleRpc, makeHandlers } from './tools.mjs'

const config = loadConfig()
const hub = new HubClient({ base: config.hub, token: config.token })
const localCall = async (path, body) => {
  const res = await fetch(`http://127.0.0.1:${config.port}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-agent-secret': config.localSecret }, body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `agente ${res.status}`)
  return data
}
const handlers = makeHandlers({
  hub,
  local: { send: b => localCall('/send', b), activity: e => localCall('/activity', e) },
  channel: process.env.PASTOR_AGENT_CHANNEL ?? 'app',
  owner: config.allowed,
})

const rl = readline.createInterface({ input: process.stdin })
rl.on('line', async line => {
  if (!line.trim()) return
  let msg
  try { msg = JSON.parse(line) } catch { return }
  const reply = await handleRpc(msg, handlers)
  if (reply) process.stdout.write(`${JSON.stringify(reply)}\n`)
})
