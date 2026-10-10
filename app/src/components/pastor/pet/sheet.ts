import art from '@/assets/clawd.art?raw'

// Clawd's sprite sheet, from glowup (MIT, github.com/NovusEdge/glowup): a
// palette, animations and transitions of 24×12 frames, and outfits (hats)
// anchored to the frame's head (or hand) point.
export type Point = { x: number; y: number }
export type Frame = { ms: number; rows: string[]; head?: Point; hand?: Point }
export type Anim = { loop: boolean; frames: Frame[] }
export type Outfit = { rows: string[]; ax: number; ay: number; hand: boolean }
export type Sheet = { palette: Record<string, string>; anims: Record<string, Anim>; outfits: Record<string, Outfit> }

const point = (s?: string): Point | undefined => {
  const m = s?.match(/^(-?\d+),(-?\d+)$/)
  return m ? { x: Number(m[1]), y: Number(m[2]) } : undefined
}

export function parse(text: string): Sheet {
  const palette: Record<string, string> = {}
  const anims: Record<string, Anim> = {}
  const outfits: Record<string, Outfit> = {}
  const named: Record<string, string[]> = {}
  const copies: [Frame, string][] = []
  let section: 'palette' | 'skip' | null = null
  let anim: Anim | null = null
  let frame: Frame | null = null
  let outfit: Outfit | null = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd()
    if (line === 'palette') { section = 'palette'; continue }
    if (line === 'end' || line === 'shiny') { section = line === 'shiny' ? 'skip' : null; outfit = null; continue }
    if (section === 'palette') {
      const m = line.match(/^(\S)\s+(#[0-9a-f]{6})$/i)
      if (m) palette[m[1]] = m[2]
      continue
    }
    if (section === 'skip') continue
    const a = line.match(/^(anim|trans)\s+(\S+)\s+(loop|once|from=\S+)/)
    if (a) { anim = { loop: a[3] === 'loop', frames: [] }; anims[a[2]] = anim; frame = null; outfit = null; continue }
    const o = line.match(/^outfit\s+(\S+)\s+anchor=(-?\d+),(-?\d+)(.*)$/)
    if (o) { outfit = { rows: [], ax: Number(o[2]), ay: Number(o[3]), hand: /slot=hand/.test(o[4]) }; outfits[o[1]] = outfit; anim = null; frame = null; continue }
    if (outfit && /^[.A-Za-z]+$/.test(line)) { outfit.rows.push(line); continue }
    if (!anim) continue
    const f = line.match(/^frame\s+(\d+)(.*)$/)
    if (f) {
      const attr = (k: string) => f[2].match(new RegExp(`\\b${k}=(\\S+)`))?.[1]
      frame = { ms: Number(f[1]), rows: [], head: point(attr('head')), hand: point(attr('hand')) }
      anim.frames.push(frame)
      const name = attr('name'), copy = attr('copy')
      if (name) named[name] = frame.rows
      if (copy) copies.push([frame, copy])
      continue
    }
    if (frame && /^[.A-Za-z]{24}$/.test(line)) frame.rows.push(line)
  }
  for (const [fr, name] of copies) if (!fr.rows.length && named[name]) fr.rows = named[name]
  for (const an of Object.values(anims)) an.frames = an.frames.filter(fr => fr.rows.length)
  return { palette, anims, outfits }
}

let sheet: Sheet | null = null
export const getSheet = () => (sheet ??= parse(art))

// The canvas a frame is drawn on: 24 wide, the frame's 12 rows plus `top`
// rows of headroom for a hat.
export function drawFrame(ctx: CanvasRenderingContext2D, fr: Frame, { top = 0, hat }: { top?: number; hat?: string | null } = {}) {
  const { palette, outfits } = getSheet()
  const paint = (rows: string[], dx: number, dy: number) => rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = palette[row[x]]
      if (row[x] !== '.' && c) { ctx.fillStyle = c; ctx.fillRect(x + dx, y + dy, 1, 1) }
    }
  })
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  paint(fr.rows, 0, top)
  const o = hat ? outfits[hat] : undefined
  if (!o) return
  // The outfit's anchor pixel lands on the frame's head (or hand) point.
  const at = (o.hand ? fr.hand : null) ?? (o.hand ? { x: 20, y: 6 } : fr.head ?? { x: 12, y: 2 })
  paint(o.rows, at.x - o.ax, at.y + top - o.ay)
}
