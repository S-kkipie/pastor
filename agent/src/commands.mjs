// Commands handled by pastor-agent itself, without waking Claude.
export const HELP = [
  '*Comandos*',
  '/new — empezar una conversación nueva',
  '/sessions — ver las últimas conversaciones',
  '/resume N — volver a la conversación N',
  '/stop — interrumpir lo que estoy haciendo',
  '/status — cómo estoy',
].join('\n')

export function parseCommand(text) {
  const m = String(text ?? '').trim().match(/^\/(new|sessions|resume|stop|status|help)\b\s*(.*)$/is)
  return m ? { name: m[1].toLowerCase(), arg: m[2].trim() } : null
}

// Text that starts with "/" but is not one of ours would run as a Claude Code
// slash command: a zero-width space in front makes it plain text.
export function asPlain(text) {
  const t = String(text ?? '')
  return /^\s*\//.test(t) ? `​${t}` : t
}
