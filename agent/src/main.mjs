// pastor-agent: the agent behind WhatsApp and the app's Agente screen, either
// its own Claude Code sessions or Hermes Agent (config.backend).
import { loadConfig } from './config.mjs'

await import(loadConfig().backend === 'hermes' ? './hermes-main.mjs' : './claude-main.mjs')
