import type { ReactNode } from 'react'

// Terminal output with its colours: SGR escapes (bold, dim, the 16 colours,
// 256 and RGB) become spans; every other escape (cursor moves, clears) is dropped
// and a bare carriage return keeps the last rewrite of a line (progress bars).
const BASE = ['#3b3b3b', '#f87171', '#4ade80', '#facc15', '#60a5fa', '#c084fc', '#22d3ee', '#e5e5e5']
const BRIGHT = ['#737373', '#fca5a5', '#86efac', '#fde047', '#93c5fd', '#d8b4fe', '#67e8f9', '#ffffff']

function c256(n: number): string {
  if (n < 8) return BASE[n]!
  if (n < 16) return BRIGHT[n - 8]!
  if (n >= 232) { const v = 8 + (n - 232) * 10; return `rgb(${v},${v},${v})` }
  const i = n - 16, r = Math.floor(i / 36), g = Math.floor(i / 6) % 6, b = i % 6
  const s = (x: number) => (x ? 55 + x * 40 : 0)
  return `rgb(${s(r)},${s(g)},${s(b)})`
}

type Style = { fg?: string; bg?: string; bold?: boolean; dim?: boolean; italic?: boolean; under?: boolean }

export function cleanLines(text: string): string {
  return text.replace(/\r\n/g, '\n').split('\n').map(l => { const i = l.lastIndexOf('\r'); return i >= 0 ? l.slice(i + 1) : l }).join('\n')
}

export function Ansi({ text }: { text: string }) {
  const out: ReactNode[] = []
  let st: Style = {}
  // biome-ignore lint/suspicious/noControlCharactersInRegex: escapes are the point
  const re = /\x1b\[([0-9;?]*)([A-Za-z])|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Z0-9]|\x1b[=>]/g
  const src = cleanLines(text)
  let last = 0, k = 0, m: RegExpExecArray | null
  const push = (s: string) => {
    if (!s) return
    const has = st.fg || st.bg || st.bold || st.dim || st.italic || st.under
    out.push(has ? (
      <span key={k++} style={{ color: st.fg, background: st.bg, fontWeight: st.bold ? 600 : undefined, opacity: st.dim ? 0.6 : undefined,
        fontStyle: st.italic ? 'italic' : undefined, textDecoration: st.under ? 'underline' : undefined }}>{s}</span>
    ) : s)
  }
  while ((m = re.exec(src))) {
    push(src.slice(last, m.index))
    last = re.lastIndex
    if (m[2] !== 'm') continue
    const codes = (m[1] || '0').split(';').map(Number)
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i]!
      if (c === 0) st = {}
      else if (c === 1) st = { ...st, bold: true }
      else if (c === 2) st = { ...st, dim: true }
      else if (c === 3) st = { ...st, italic: true }
      else if (c === 4) st = { ...st, under: true }
      else if (c === 22) st = { ...st, bold: false, dim: false }
      else if (c === 23) st = { ...st, italic: false }
      else if (c === 24) st = { ...st, under: false }
      else if (c >= 30 && c <= 37) st = { ...st, fg: BASE[c - 30] }
      else if (c >= 90 && c <= 97) st = { ...st, fg: BRIGHT[c - 90] }
      else if (c >= 40 && c <= 47) st = { ...st, bg: BASE[c - 40] }
      else if (c >= 100 && c <= 107) st = { ...st, bg: BRIGHT[c - 100] }
      else if (c === 39) st = { ...st, fg: undefined }
      else if (c === 49) st = { ...st, bg: undefined }
      else if ((c === 38 || c === 48) && codes[i + 1] === 5) { const col = c256(codes[i + 2] ?? 0); st = c === 38 ? { ...st, fg: col } : { ...st, bg: col }; i += 2 }
      else if ((c === 38 || c === 48) && codes[i + 1] === 2) { const col = `rgb(${codes[i + 2] ?? 0},${codes[i + 3] ?? 0},${codes[i + 4] ?? 0})`; st = c === 38 ? { ...st, fg: col } : { ...st, bg: col }; i += 4 }
    }
  }
  push(src.slice(last))
  return <>{out}</>
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: escapes are the point
export const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
