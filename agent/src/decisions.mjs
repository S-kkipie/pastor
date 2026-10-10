// A permission or question from the agent's own session, put to the owner on
// WhatsApp as numbered options, and their reply turned back into a decision.
export function formatPending(p) {
  if (p.kind === 'permission') {
    return `🔐 Necesito permiso para usar *${p.tool ?? 'una herramienta'}*${p.summary ? `:\n${p.summary}` : ''}\n\n1 = permitir · 2 = denegar`
  }
  const qs = p.questions ?? []
  const blocks = qs.map((q, i) => {
    const opts = q.options.map((o, j) => `${j + 1}. ${o.label}${o.description ? ` — ${o.description}` : ''}`).join('\n')
    return `${qs.length > 1 ? `${i + 1}) ` : ''}❓ *${q.question}*${q.multiSelect ? ' (puedes elegir varias)' : ''}\n${opts}`
  })
  const how = qs.length > 1 ? 'Responde una línea por pregunta, con el número o tu propia respuesta.' : 'Responde con el número o escribe tu propia respuesta.'
  return `${blocks.join('\n\n')}\n\n${how} "cancelar" para no contestar.`
}

const YES = /^(1|s[ií]|ok|dale|permitir|permite|y|yes)$/i
const NO = /^(2|no|deniega|denegar|n)$/i

export function parseReply(p, text) {
  const t = String(text ?? '').trim()
  if (p.kind === 'permission') return YES.test(t) ? { decision: 'allow' } : NO.test(t) ? { decision: 'deny' } : null
  if (/^cancel(ar)?$/i.test(t)) return { decision: 'deny' }
  const qs = p.questions ?? []
  const lines = t.split('\n').map(l => l.trim()).filter(Boolean)
  if (!lines.length || (qs.length > 1 && lines.length < qs.length)) return null
  const answers = {}
  qs.forEach((q, i) => {
    const line = lines[qs.length > 1 ? i : 0]
    const nums = line.split(/[\s,]+/).filter(Boolean).map(Number)
    const valid = nums.length && nums.every(n => Number.isInteger(n) && n >= 1 && n <= q.options.length)
    const picked = valid ? (q.multiSelect ? nums : nums.slice(0, 1)).map(n => q.options[n - 1].label) : null
    answers[q.question] = picked ? picked.join(', ') : line
  })
  return { decision: 'allow', answers }
}
