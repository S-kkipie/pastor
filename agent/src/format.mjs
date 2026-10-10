// Claude writes Markdown; WhatsApp has its own small set of marks.
export function toWhatsApp(md) {
  const parts = String(md ?? '').split(/(```[\s\S]*?```)/g)
  return parts.map((part, i) => {
    if (i % 2 === 1) return part.replace(/^```[^\n]*\n/, '```\n')
    const lines = part.split('\n')
    const out = []
    for (let j = 0; j < lines.length; j++) {
      const line = lines[j]
      if (/^\s*\|.*\|\s*$/.test(line)) {
        const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())
        const isSep = l => /^\s*\|?\s*:?-{2,}/.test(l)
        const header = !isSep(line) && isSep(lines[j + 1] ?? '')
        if (isSep(line)) continue
        out.push(header ? `*${cells(line).join(' · ')}*` : `• ${cells(line).join(' · ')}`)
        continue
      }
      out.push(line
        .replace(/^#{1,6}\s+(.+)$/, '\u0001$1\u0001')
        .replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_, a, b) => `\u0001${a ?? b}\u0001`)
        .replace(/~~(.+?)~~/g, '~$1~')
        .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '$1 ($2)')
        .replace(/^(\s*)[-*]\s+/, '$1• ')
        .replace(/\u0001/g, '*'))
    }
    return out.join('\n')
  }).join('')
}

// WhatsApp messages stay readable under ~4 000 characters: cut at paragraphs,
// then lines, then anywhere.
export function splitMessage(text, max = 4000) {
  const t = String(text ?? '').trim()
  if (!t) return []
  const out = []
  let cur = ''
  const push = piece => {
    if (!cur) cur = piece
    else if (cur.length + 2 + piece.length <= max) cur += `\n\n${piece}`
    else { out.push(cur); cur = piece }
  }
  for (const para of t.split(/\n{2,}/)) {
    if (para.length <= max) { push(para); continue }
    for (const line of para.split('\n')) {
      if (line.length <= max) { push(line); continue }
      for (let i = 0; i < line.length; i += max) push(line.slice(i, i + max))
    }
  }
  if (cur) out.push(cur)
  return out
}
