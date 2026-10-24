// Writing on WhatsApp through Hermes's gateway (`hermes send`): the bot's number
// belongs to Hermes, so pastor-agent's own messages (the vigilante) go out this way.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

export function hermesSender({ bin, exec = (file, args) => run(file, args, { timeout: 60_000 }) }) {
  return async (number, text, file) => {
    const body = [text, file && `MEDIA:${file}`].filter(Boolean).join('\n')
    try { await exec(bin, ['send', '-q', '-t', `whatsapp:${number}`, '--', body]) }
    catch (err) { throw new Error(`hermes send falló: ${String(err.stderr || err.message).trim()}`) }
  }
}
