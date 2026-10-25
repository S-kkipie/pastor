export const dur = (ms?: number | null): string => {
  if (ms == null || ms < 1000) return ''
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`
}

export const ago = (t: number): string => {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000))
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`
}

export const shortPath = (p?: string): string => {
  const parts = String(p ?? '').split(/[\\/]/).filter(Boolean)
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : String(p ?? '')
}

export const fileName = (p?: string): string => String(p ?? '').split(/[\\/]/).filter(Boolean).pop() ?? ''

// The short id for a session (the conversation uuid's head, machine prefix dropped):
// it tells apart two sessions that happen to share a title (same folder, say).
export const shortId = (id: string): string => (id.split('~').pop() ?? id).slice(0, 8)

export const tokens = (n?: number | null): string =>
  n == null ? '–' : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)

const EXT: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx', mjs: 'javascript', cjs: 'javascript', json: 'json',
  py: 'python', rs: 'rust', go: 'go', java: 'java', kt: 'kotlin', swift: 'swift', rb: 'ruby', php: 'php', cs: 'csharp',
  c: 'c', h: 'c', cpp: 'cpp', css: 'css', scss: 'scss', html: 'html', md: 'markdown', yml: 'yaml', yaml: 'yaml',
  toml: 'toml', sh: 'bash', ps1: 'powershell', sql: 'sql', vue: 'vue', svelte: 'svelte', xml: 'xml',
}
export const langOf = (file?: string): string => EXT[fileName(file).split('.').pop()?.toLowerCase() ?? ''] ?? 'text'

// A unified diff of one edit, trimmed to what changed plus two lines around.
export function editDiff(oldS = '', newS = ''): { text: string; plus: number; minus: number } {
  const a = oldS.split('\n'), b = newS.split('\n')
  let p = 0
  while (p < a.length && p < b.length && a[p] === b[p]) p++
  let s = 0
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++
  const del = a.slice(p, a.length - s), add = b.slice(p, b.length - s)
  const lines = [
    ...a.slice(Math.max(0, p - 2), p).map(l => ` ${l}`),
    ...del.map(l => `-${l}`),
    ...add.map(l => `+${l}`),
    ...b.slice(b.length - s, b.length - s + 2).map(l => ` ${l}`),
  ]
  return { text: lines.join('\n'), plus: add.length, minus: del.length }
}
