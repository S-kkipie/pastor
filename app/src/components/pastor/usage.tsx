import { ArrowDownIcon, CoinsIcon, FlameIcon, GaugeIcon } from 'lucide-react'
import { motion } from 'motion/react'
import { useMemo, useState } from 'react'

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ago, tokens } from '@/lib/format'
import type { ContextPoint, ContextRow, Usage } from '@/lib/types'
import { cn } from '@/lib/utils'

type Limit = NonNullable<Usage['rateLimits']>[number]

// Coral, violet, emerald and friends: the categories of the window.
const PALETTE = [
  'oklch(0.68 0.13 41)', 'oklch(0.65 0.15 295)', 'oklch(0.72 0.13 160)', 'oklch(0.78 0.12 80)',
  'oklch(0.7 0.11 230)', 'oklch(0.7 0.14 350)', 'oklch(0.75 0.08 120)', 'oklch(0.62 0.04 60)',
]
const isCss = (c?: string) => !!c && /^(#|rgb|hsl|oklch|oklab|lab|lch|color\()/i.test(c)
const isFree = (r: ContextRow) => /free|libre|disponible/i.test(r.name)
const isBuffer = (r: ContextRow) => /buffer|reserv/i.test(r.name)

const LIMIT_LABEL: Record<string, string> = {
  five_hour: '5 h', '5h': '5 h', session: 'sesión', seven_day: 'semanal', weekly: 'semanal', week: 'semanal',
  seven_day_opus: 'semanal · Opus', seven_day_sonnet: 'semanal · Sonnet', seven_day_oauth_apps: 'semanal · apps',
}
export const limitLabel = (kind: string) => LIMIT_LABEL[kind] ?? kind.replace(/_/g, ' ')

export const resetTime = (at?: string): number | null => {
  if (!at) return null
  const n = Number(at)
  if (Number.isFinite(n) && n > 0) return n < 1e12 ? n * 1000 : n
  const t = Date.parse(at)
  return Number.isFinite(t) ? t : null
}
export const until = (t: number): string => {
  const m = Math.max(0, Math.round((t - Date.now()) / 60_000))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} h${m % 60 ? ` ${m % 60} min` : ''}`
  return `${Math.floor(h / 24)} d${h % 24 ? ` ${h % 24} h` : ''}`
}
const tone = (p: number) => p > 0.85 ? 'text-red-400' : p > 0.65 ? 'text-warn' : 'text-coral'
const fill = (p: number) => p > 0.85 ? 'bg-red-400' : p > 0.65 ? 'bg-warn' : 'bg-coral'

// The session's context window as a ring; a tap opens the full picture.
export function UsageRing({ usage, history = [] }: { usage: Usage | null; history?: ContextPoint[] }) {
  const [open, setOpen] = useState(false)
  if (!usage?.window || !usage.tokens) return null
  const pct = Math.min(1, usage.tokens / usage.window)
  const r = 9, c = 2 * Math.PI * r
  const color = pct > 0.85 ? 'stroke-red-400' : pct > 0.65 ? 'stroke-warn' : 'stroke-coral'
  // The tightest rate limit, as a hairline under the ring.
  const tight = [...(usage.rateLimits ?? [])].sort((a, b) => b.percentUsed - a.percentUsed)[0]
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Uso de contexto"
        className="relative grid size-9 place-items-center rounded-full active:bg-white/5">
        <svg viewBox="0 0 24 24" className="size-7 -rotate-90">
          <circle cx="12" cy="12" r={r} className="fill-none stroke-white/10" strokeWidth="2.5" />
          <circle cx="12" cy="12" r={r} className={cn('fill-none transition-all duration-700', color)} strokeWidth="2.5"
            strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} />
        </svg>
        <span className="absolute font-mono text-[8.5px] font-semibold">{Math.round(pct * 100)}</span>
        {tight && (
          <span className="absolute bottom-0 left-1/2 h-[2px] w-5 -translate-x-1/2 overflow-hidden rounded-full bg-white/10"
            title={`Límite ${limitLabel(tight.kind)}: ${Math.round(tight.percentUsed)}%`}>
            <span className={cn('block h-full rounded-full', fill(tight.percentUsed / 100))}
              style={{ width: `${Math.min(100, Math.max(4, tight.percentUsed))}%` }} />
          </span>
        )}
      </button>
      <ContextSheet usage={usage} history={history} open={open} onOpenChange={setOpen} />
    </>
  )
}

export function ContextSheet({ usage, history, open, onOpenChange }: {
  usage: Usage; history: ContextPoint[]; open: boolean; onOpenChange: (v: boolean) => void
}) {
  const used = usage.tokens, win = usage.window
  const pct = Math.min(1, used / win)
  const auto = usage.autoCompactAt && usage.autoCompactAt > 0 && usage.autoCompactAt < win ? usage.autoCompactAt : null
  const turnsLeft = auto && usage.perTurn && usage.perTurn > 0 && auto > used ? Math.max(1, Math.ceil((auto - used) / usage.perTurn)) : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-auto bottom-0 max-h-[88dvh] translate-y-0 overflow-y-auto rounded-b-none rounded-t-3xl border-white/10 bg-popover/90 pb-[max(env(safe-area-inset-bottom),20px)] backdrop-blur-2xl sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2 sm:rounded-3xl">
        <DialogHeader>
          <DialogTitle>Contexto</DialogTitle>
          <DialogDescription className="font-mono text-[11.5px]">{usage.model}</DialogDescription>
        </DialogHeader>

        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="font-mono text-[30px] font-semibold leading-none tracking-tight">
              {tokens(used)}<span className="text-[16px] font-normal text-muted-foreground"> / {tokens(win)}</span>
            </p>
            <p className="mt-1.5 text-[12px] text-muted-foreground">tokens en la ventana</p>
          </div>
          <p className={cn('font-mono text-[34px] font-semibold leading-none', tone(pct))}>
            {Math.round(pct * 100)}<span className="text-[18px]">%</span>
          </p>
        </div>

        <Breakdown usage={usage} auto={auto} />

        {(usage.perTurn || auto) && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-2xl glass px-3.5 py-2.5 text-[12.5px]">
            <FlameIcon className="size-3.5 text-coral" />
            {usage.perTurn ? <span className="font-mono">+{tokens(usage.perTurn)}/turno</span> : null}
            {usage.perTurn && auto ? <span className="text-muted-foreground/40">·</span> : null}
            {auto && (auto <= used
              ? <span className="text-warn">auto-compact inminente</span>
              : turnsLeft
                ? <span>auto-compact en <b className="font-mono">~{turnsLeft}</b> {turnsLeft === 1 ? 'turno' : 'turnos'}</span>
                : <span className="text-muted-foreground">auto-compact a {tokens(auto)}</span>)}
          </div>
        )}

        <History points={history} win={win} auto={auto} />

        {!!usage.rateLimits?.length && (
          <section className="flex flex-col gap-2.5">
            <h3 className="flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-wider text-muted-foreground">
              <GaugeIcon className="size-3.5" />Límites de uso
            </h3>
            {[...usage.rateLimits].sort((a, b) => b.percentUsed - a.percentUsed).map(l => <LimitBar key={l.kind} l={l} />)}
          </section>
        )}

        <div className="flex flex-col gap-1.5 rounded-2xl glass px-3.5 py-3 text-[12.5px]">
          {usage.turn && (
            <Row k="Último turno" v={`${tokens(usage.turn.input_tokens + usage.turn.cache_read_input_tokens + usage.turn.cache_creation_input_tokens)} in · ${tokens(usage.turn.output_tokens)} out`} />
          )}
          {usage.cost != null && (
            <div className="flex justify-between gap-3">
              <span className="flex items-center gap-1.5 text-muted-foreground"><CoinsIcon className="size-3.5" />Coste de la sesión</span>
              <span className="font-mono font-semibold">${usage.cost.toFixed(2)}</span>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// What fills the window, as one stacked bar plus a legend sorted by weight.
function Breakdown({ usage, auto }: { usage: Usage; auto: number | null }) {
  const win = usage.window
  const rows = useMemo(() => {
    const list = (usage.breakdown ?? []).filter(r => r.tokens > 0)
    let k = 0
    return list.map(r => ({ ...r, fill: isFree(r) ? 'transparent' : isCss(r.color) ? r.color! : PALETTE[k++ % PALETTE.length]! }))
  }, [usage.breakdown])
  const used = rows.filter(r => !isFree(r))
  const legend = [...used].sort((a, b) => b.tokens - a.tokens)
  const heavy = new Set(legend.filter(r => !isBuffer(r)).slice(0, 3).map(r => r.name))
  const total = rows.length ? Math.max(win, rows.reduce((s, r) => s + r.tokens, 0)) : win

  return (
    <section className="flex flex-col gap-3">
      <div className="relative">
        <div className="flex h-3.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
          {used.length ? used.map(r => (
            <motion.span key={r.name} initial={{ width: 0 }} animate={{ width: `${(r.tokens / total) * 100}%` }}
              transition={{ type: 'spring', stiffness: 160, damping: 26 }}
              className="h-full border-r border-background/40 last:border-r-0"
              style={isBuffer(r)
                ? { background: 'repeating-linear-gradient(135deg, oklch(1 0 0 / 0.14) 0 3px, transparent 3px 6px)' }
                : { background: r.fill }} />
          )) : (
            <motion.span initial={{ width: 0 }} animate={{ width: `${Math.min(100, (usage.tokens / win) * 100)}%` }}
              className="h-full bg-coral" />
          )}
        </div>
        {auto && (
          <span className="absolute -top-1 -bottom-1 border-l border-dashed border-foreground/70" style={{ left: `${(auto / total) * 100}%` }}>
            <span className="absolute -top-4 -translate-x-1/2 whitespace-nowrap font-mono text-[9.5px] text-muted-foreground">auto</span>
          </span>
        )}
      </div>
      {legend.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {legend.map(r => {
            const hot = heavy.has(r.name)
            return (
              <li key={r.name} className={cn('flex items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-[13px]', hot && 'bg-white/[0.04]')}>
                <span className="size-2.5 shrink-0 rounded-[4px]"
                  style={isBuffer(r) ? { background: 'repeating-linear-gradient(135deg, oklch(1 0 0 / 0.35) 0 2px, transparent 2px 4px)' } : { background: r.fill }} />
                <span className={cn('min-w-0 flex-1 truncate', !hot && 'text-muted-foreground')}>{r.name}</span>
                {hot && <span className="rounded-full bg-coral/12 px-1.5 py-px text-[9.5px] font-medium uppercase tracking-wide text-coral">más pesado</span>}
                <span className="font-mono text-[12px]">{tokens(r.tokens)}</span>
                <span className="w-9 text-right font-mono text-[11px] text-muted-foreground">{((r.tokens / win) * 100).toFixed(r.tokens / win < 0.1 ? 1 : 0)}%</span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

// Context over the session: climbs while working, drops at each compaction.
function History({ points, win, auto }: { points: ContextPoint[]; win: number; auto: number | null }) {
  const W = 340, H = 96, P = 4
  const g = useMemo(() => {
    if (points.length < 2) return null
    const t0 = points[0]!.t, t1 = points[points.length - 1]!.t
    const span = Math.max(1, t1 - t0)
    const top = Math.max(win, ...points.map(p => p.tokens))
    const x = (t: number) => P + ((t - t0) / span) * (W - 2 * P)
    const y = (v: number) => H - P - (v / top) * (H - 2 * P)
    // Steps, so a compaction reads as a cliff rather than a slope.
    let d = `M${x(points[0]!.t)},${y(points[0]!.tokens)}`
    const drops: { x: number; y: number }[] = []
    for (let i = 1; i < points.length; i++) {
      const p = points[i]!, q = points[i - 1]!
      d += ` L${x(p.t)},${y(q.tokens)} L${x(p.t)},${y(p.tokens)}`
      if (p.tokens < q.tokens * 0.7) drops.push({ x: x(p.t), y: y(p.tokens) })
    }
    const area = `${d} L${x(t1)},${H - P} L${x(t0)},${H - P} Z`
    return { d, area, drops, autoY: auto ? y(auto) : null, t0 }
  }, [points, win, auto])

  return (
    <section className="flex flex-col gap-2">
      <h3 className="flex items-center justify-between text-[12px] font-medium uppercase tracking-wider text-muted-foreground">
        <span>Historial</span>
        {g && g.drops.length > 0 && (
          <span className="flex items-center gap-1 normal-case tracking-normal text-violet-300/80">
            <ArrowDownIcon className="size-3" />{g.drops.length} {g.drops.length === 1 ? 'compactación' : 'compactaciones'}
          </span>
        )}
      </h3>
      {g ? (
        <div className="rounded-2xl glass p-2.5">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-24 w-full" preserveAspectRatio="none" role="img" aria-label="Uso de contexto en el tiempo">
            <defs>
              <linearGradient id="ctx-area" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--color-coral)" stopOpacity="0.35" />
                <stop offset="100%" stopColor="var(--color-coral)" stopOpacity="0" />
              </linearGradient>
            </defs>
            {g.autoY != null && (
              <line x1={P} x2={W - P} y1={g.autoY} y2={g.autoY} stroke="currentColor" className="text-foreground/45"
                strokeDasharray="4 4" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            )}
            <path d={g.area} fill="url(#ctx-area)" />
            <path d={g.d} fill="none" stroke="var(--color-coral)" strokeWidth="1.75" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            {g.drops.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="2.5" className="fill-violet-400" />)}
          </svg>
          <div className="mt-1 flex justify-between font-mono text-[10px] text-muted-foreground/70">
            <span>hace {ago(g.t0)}</span>
            {g.autoY != null && <span className="flex items-center gap-1"><span className="inline-block w-3 border-t border-dashed border-foreground/50" />auto-compact</span>}
            <span>ahora</span>
          </div>
        </div>
      ) : (
        <p className="rounded-2xl glass px-3.5 py-3 text-[12.5px] text-muted-foreground">El gráfico aparece tras un par de turnos.</p>
      )}
    </section>
  )
}

function LimitBar({ l }: { l: Limit }) {
  const p = Math.min(100, Math.max(0, l.percentUsed))
  const reset = resetTime(l.resetsAt)
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
        <span className="font-medium">{limitLabel(l.kind)}</span>
        <span className="flex items-baseline gap-2">
          {reset && reset > Date.now() && <span className="text-[11px] text-muted-foreground">se reinicia en {until(reset)}</span>}
          <span className={cn('font-mono', tone(p / 100))}>{Math.round(p)}%</span>
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
        <motion.div initial={{ width: 0 }} animate={{ width: `${p}%` }} transition={{ type: 'spring', stiffness: 160, damping: 26 }}
          className={cn('h-full rounded-full', fill(p / 100))} />
      </div>
    </div>
  )
}

const Row = ({ k, v }: { k: string; v: string }) => (
  <div className="flex justify-between gap-3"><span className="text-muted-foreground">{k}</span><span className="truncate font-mono">{v}</span></div>
)
