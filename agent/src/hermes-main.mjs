// pastor-agent with Hermes: the app's Agente screen and the vigilante on top of
// Hermes Agent's gateway, which owns the WhatsApp number.
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { loadConfig, loadState, saveConfig, saveState } from './config.mjs'
import { HermesClient, readHermesEnv } from './hermes.mjs'
import { hermesAllowed, lidCheck, makeHandlers } from './hermes-agent.mjs'
import { hermesSender } from './hermes-send.mjs'
import { HermesChat } from './hermeschat.mjs'
import { HubClient } from './hub.mjs'
import { startServer } from './server.mjs'
import { Vigilante } from './vigilante.mjs'

process.on('unhandledRejection', err => console.error('unhandledRejection', err))
const run = promisify(execFile)
let config = loadConfig()
const state = loadState()
const save = () => saveState(state)
const env = readHermesEnv(path.join(config.hermes.home, '.env'))
if (!env.API_SERVER_KEY) console.error(`pastor-agent: falta API_SERVER_KEY en ${config.hermes.home}/.env (el api_server de Hermes)`)
// The vigilante writes to numbers Hermes lets in.
const allowed = hermesAllowed(env, lidCheck(config.hermes.home, config.lidAliases))
if (allowed.length) config = { ...config, allowed }

const client = new HermesClient({ url: config.hermes.url, key: env.API_SERVER_KEY ?? '', bridge: config.hermes.bridge })
const send = hermesSender({ bin: config.hermes.bin })
const hub = new HubClient({ base: config.hub, token: config.token })
const chat = new HermesChat({
  client,
  onTurnEnd: live => { state.channels.app = { lastText: String(live.text || live.error || '').slice(0, 200), lastAt: Date.now() }; save() },
})

// The daily summary: a Hermes turn of its own, sent to the owner.
async function runDaily(number) {
  await client.ensureSession('pastor-daily')
  const runId = await client.startRun('pastor-daily', 'Haz mi resumen diario: qué se hizo hoy en todas mis PCs (usa hub_overview, sessions_list y routines_list de pastor-hub), qué quedó pendiente y qué necesita mi atención. Corto, para WhatsApp.')
  let output = ''
  for await (const ev of client.events(runId)) if (ev.event === 'run.completed') output = ev.output ?? ''
  if (output) await send(number, output)
}

const vigilante = new Vigilante({
  hub, config: () => config, send,
  own: () => new Set(), setAwaiting() {}, runDaily,
  onDaily: day => { state.lastDaily = day; save() },
  needsHint: '\n\nDime qué hago (por ejemplo «permite» o «deniega»).',
})
vigilante.lastDaily = state.lastDaily
vigilante.start()

startServer({
  port: config.port, secret: config.localSecret,
  handlers: makeHandlers({
    getConfig: () => config, setConfig: c => { config = c; saveConfig(config) }, state, save, client, chat, send,
    exec: (file, args) => run(file, args, { timeout: 30_000 }),
  }),
})
console.log(`pastor-agent (Hermes) en 127.0.0.1:${config.port}`)
