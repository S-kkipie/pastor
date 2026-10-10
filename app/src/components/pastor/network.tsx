import {
  ArrowDownLeftIcon, ArrowUpRightIcon, ChevronDownIcon, MessagesSquareIcon, MonitorIcon, RadioTowerIcon, XIcon,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { MessageResponse } from '@/components/ai-elements/message'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ago } from '@/lib/format'
import { netKey, useMessageNotices, useNow } from '@/lib/hooks'
import type { NetworkMessage, PeerMessage } from '@/lib/types'
import { cn } from '@/lib/utils'

import { Clawd } from './clawd'

const TEN_MIN = 10 * 60_000

// What an origin kind reads as.
const KIND: Record<string, string> = {
  peer: 'peer', coordinator: 'coordinador', 'peer-send-message': 'otra sesión', bridge: 'pastor', team: 'equipo', mailbox: 'equipo',
  teammate: 'equipo', 'task-notification': 'aviso', 'scheduled-trigger': 'programado', 'projects-relay': 'proyectos', 'slack-ping': 'slack',
  agent: 'agente', send: 'otra sesión', unclassified: 'otro',
}
export const kindLabel = (k: string) => KIND[k] ?? k

export const recentCount = (messages: { t: number }[], skew = 0) => {
  const now = Date.now() - skew
  return messages.filter(m => now - m.t < TEN_MIN).length
}

function KindChip({ kind, className }: { kind: string; className?: string }) {
  return (
    <span className={cn('shrink-0 rounded-full border border-white/10 px-1.5 font-mono text-[9.5px] leading-4 text-muted-foreground', className)}>
      {kindLabel(kind)}
    </span>
  )
}

// ---------- per session ----------

// The header button: shows only while the session has messages; the badge
// counts the last ten minutes. On a narrow phone it shows only while there
// are recent ones (Mensajes is also in the ⋯ menu), so the title keeps room.
export function MessagesButton({ messages, recent, onOpen }: { messages: PeerMessage[]; recent?: number; onOpen: () => void }) {
  if (!messages.length) return null
  const n = recent ?? recentCount(messages)
  return (
    <motion.button type="button" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} onClick={onOpen}
      aria-label="Mensajes"
      className={cn('relative size-9 shrink-0 place-items-center rounded-full border transition-colors', n ? 'grid' : 'hidden min-[430px]:grid',
        n ? 'border-violet-400/50 bg-violet-500/12 text-violet-300' : 'border-white/10 text-muted-foreground')}>
      <RadioTowerIcon className="size-4" />
      {n > 0 && (
        <span className="absolute -right-0.5 -top-0.5 grid size-4 place-items-center rounded-full bg-violet-400 text-[9.5px] font-bold text-background">{n > 9 ? '9+' : n}</span>
      )}
    </motion.button>
  )
}

function Bubble({ m, skew, i }: { m: PeerMessage; skew: number; i: number }) {
  const [open, setOpen] = useState(false)
  const out = m.dir === 'out'
  const long = m.text.length > 280 || m.text.split('\n').length > 6
  return (
    <motion.div layout initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: Math.min(i, 8) * 0.03, type: 'spring', stiffness: 380, damping: 32 }}
      className={cn('flex max-w-[88%] flex-col gap-1', out ? 'items-end self-end' : 'items-start self-start')}>
      <span className={cn('flex max-w-full items-center gap-1.5 px-1 text-[11px]', out && 'flex-row-reverse')}>
        {out ? <ArrowUpRightIcon className="size-3 shrink-0 text-coral" /> : <ArrowDownLeftIcon className="size-3 shrink-0 text-violet-300" />}
        <span className="min-w-0 truncate"><b className="font-medium text-foreground/90">{m.from}</b><span className="text-muted-foreground"> → {m.to}</span></span>
        <KindChip kind={m.kind} />
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground/60">{ago(m.t + skew)}</span>
      </span>
      <div className={cn('min-w-0 max-w-full rounded-2xl px-3.5 py-2.5 text-[13px] [overflow-wrap:anywhere]',
        out ? 'rounded-tr-md border border-coral/25 bg-coral/12' : 'rounded-tl-md border border-violet-400/25 bg-violet-500/12')}>
        <div className={cn('relative', !open && long && 'max-h-36 overflow-hidden')}>
          <MessageResponse className="[overflow-wrap:anywhere]">{m.text}</MessageResponse>
          {!open && long && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-popover/90 to-transparent" />}
        </div>
        {long && (
          <button type="button" onClick={() => setOpen(v => !v)}
            className={cn('mt-1 flex items-center gap-1 text-[11.5px] font-medium', out ? 'text-coral' : 'text-violet-300')}>
            <ChevronDownIcon className={cn('size-3.5 transition-transform', open && 'rotate-180')} />{open ? 'Menos' : 'Ver todo'}
          </button>
        )}
      </div>
    </motion.div>
  )
}

// A chat-like timeline of what this session sent and received. Also toasts
// each new incoming message while the session screen is open.
export function MessagesSheet({ messages, skew, open, onOpenChange, title, ready = true }: {
  messages: PeerMessage[]; skew: number; open: boolean; onOpenChange: (v: boolean) => void; title?: string
  // false until the session's first payload arrived (its list is not "seen" before).
  ready?: boolean
}) {
  useNow(15_000)
  useMessageNotices(ready ? messages : null, { onView: () => onOpenChange(true) })
  const ordered = useMemo(() => [...messages].sort((a, b) => a.t - b.t), [messages])
  const inN = messages.filter(m => m.dir === 'in').length
  // Newest at the bottom: open there, and follow new ones while the reader is near it.
  const scroller = useRef<HTMLDivElement>(null)
  const end = useRef<HTMLDivElement>(null)
  const nearEnd = useRef(true)
  useEffect(() => {
    if (!open) return
    nearEnd.current = true
    const t = requestAnimationFrame(() => end.current?.scrollIntoView({ block: 'end' }))
    return () => cancelAnimationFrame(t)
  }, [open])
  useEffect(() => {
    if (open && nearEnd.current) end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [open, ordered.length])
  const onScroll = () => {
    const el = scroller.current
    if (el) nearEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-auto bottom-0 flex h-[88dvh] translate-y-0 flex-col rounded-b-none rounded-t-3xl border-white/10 bg-popover/90 pb-[max(env(safe-area-inset-bottom),16px)] backdrop-blur-2xl sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2 sm:rounded-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><RadioTowerIcon className="size-4 text-violet-300" />Mensajes</DialogTitle>
          <DialogDescription className="text-[12px]">
            {title ? `${title} · ` : ''}{inN} recibidos · {messages.length - inN} enviados
          </DialogDescription>
        </DialogHeader>
        <div ref={scroller} onScroll={onScroll} className="-mx-1 flex min-h-0 flex-1 flex-col [&>*]:shrink-0 gap-3 overflow-y-auto overflow-x-hidden px-1 pb-2">
          {ordered.map((m, i) => <Bubble key={m.id} m={m} skew={skew} i={ordered.length - 1 - i} />)}
          <div ref={end} aria-hidden className="h-px shrink-0" />
          {!ordered.length && (
            <div className="mt-16 flex flex-col items-center gap-2 text-center text-muted-foreground">
              <Clawd mood="sleep" size={56} />
              <p className="text-sm">Sin mensajes con otras sesiones o agentes.</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ---------- the network ----------

// Same message seen from both ends (out at the sender, in at the receiver):
// keep the sender's copy.
function dedupe(list: NetworkMessage[]): NetworkMessage[] {
  const outs = list.filter(m => m.dir === 'out')
  return list.filter(m => m.dir === 'out' || !outs.some(o => o.text === m.text && Math.abs(o.t - m.t) < 10_000))
}

type Node = { key: string; label: string; machine?: string; session?: string }
type Edge = { a: string; b: string; at: number }

// Who talked to whom: sessions as nodes, plus the other ends that are not a
// known session (agents, teammates, 'tú').
function graphOf(list: NetworkMessage[]) {
  const nodes = new Map<string, Node>()
  const byTitle = new Map<string, string>()
  for (const m of list) {
    if (!nodes.has(m.session)) nodes.set(m.session, { key: m.session, label: m.sessionTitle, machine: m.machine, session: m.session })
    byTitle.set(m.sessionTitle.toLowerCase(), m.session)
  }
  const other = (name: string) => {
    const hit = byTitle.get(name.toLowerCase())
    if (hit) return hit
    const k = `n:${name}`
    if (!nodes.has(k)) nodes.set(k, { key: k, label: name })
    return k
  }
  const edges = new Map<string, Edge>()
  for (const m of list) {
    const a = m.dir === 'out' ? m.session : other(m.from)
    const b = m.dir === 'out' ? other(m.to) : m.session
    if (a === b) continue
    const k = `${a}>${b}`
    const e = edges.get(k)
    if (!e || e.at < m.t) edges.set(k, { a, b, at: m.t })
  }
  // Busiest first, capped so the strip stays readable.
  const weight = new Map<string, number>()
  for (const e of edges.values()) { weight.set(e.a, (weight.get(e.a) ?? 0) + 1); weight.set(e.b, (weight.get(e.b) ?? 0) + 1) }
  const keep = [...nodes.values()].sort((x, y) => (Number(!!y.session) - Number(!!x.session)) || (weight.get(y.key) ?? 0) - (weight.get(x.key) ?? 0)).slice(0, 8)
  const kept = new Set(keep.map(n => n.key))
  return { nodes: keep, edges: [...edges.values()].filter(e => kept.has(e.a) && kept.has(e.b)) }
}

function GraphStrip({ list, now, onOpen }: { list: NetworkMessage[]; now: number; onOpen: (session: string) => void }) {
  const { nodes, edges } = useMemo(() => graphOf(list), [list])
  if (!nodes.length) return null
  // Nodes on an ellipse (or a line when there are two).
  const pos = new Map(nodes.map((n, i) => {
    if (nodes.length === 1) return [n.key, { x: 50, y: 45 }]
    if (nodes.length === 2) return [n.key, { x: i ? 78 : 22, y: 45 }]
    const a = -Math.PI / 2 + (i / nodes.length) * Math.PI * 2
    return [n.key, { x: 50 + Math.cos(a) * 38, y: 46 + Math.sin(a) * 32 }]
  }))
  const hot = (e: Edge) => now - e.at < 60_000
  const active = new Set(edges.filter(hot).flatMap(e => [e.a, e.b]))
  return (
    <div className="relative h-44 shrink-0 overflow-hidden rounded-2xl border border-white/6 bg-black/20">
      <div className="pointer-events-none absolute left-1/2 top-1/2 size-40 -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-500/10 blur-3xl" />
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full">
        {edges.map(e => {
          const p = pos.get(e.a)!, q = pos.get(e.b)!
          const on = hot(e)
          return on ? (
            <motion.line key={`${e.a}>${e.b}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} vectorEffect="non-scaling-stroke"
              stroke="oklch(0.75 0.15 295)" strokeWidth={2} strokeLinecap="round"
              initial={{ strokeOpacity: 0.3 }} animate={{ strokeOpacity: [0.3, 0.95, 0.3] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }} />
          ) : (
            <line key={`${e.a}>${e.b}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} vectorEffect="non-scaling-stroke"
              stroke="white" strokeOpacity={0.1} strokeWidth={1} strokeDasharray="3 4" />
          )
        })}
      </svg>
      {/* A spark travelling from sender to receiver on each live line. */}
      {edges.filter(hot).map(e => {
        const p = pos.get(e.a)!, q = pos.get(e.b)!
        return (
          <motion.span key={`dot:${e.a}>${e.b}`} className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-200 shadow-[0_0_10px_3px] shadow-violet-400/70"
            initial={{ left: `${p.x}%`, top: `${p.y}%`, opacity: 0 }}
            animate={{ left: [`${p.x}%`, `${q.x}%`], top: [`${p.y}%`, `${q.y}%`], opacity: [0, 1, 0] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut', repeatDelay: 0.3 }} />
        )
      })}
      {nodes.map((n, i) => {
        const p = pos.get(n.key)!
        const on = active.has(n.key)
        return (
          <motion.button key={n.key} type="button" disabled={!n.session} onClick={() => n.session && onOpen(n.session)}
            initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: i * 0.05, type: 'spring', stiffness: 380, damping: 26 }}
            className="absolute flex w-20 -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-0.5"
            style={{ left: `${p.x}%`, top: `${p.y}%` }}>
            <span className={cn('relative grid size-9 place-items-center rounded-full border backdrop-blur-md',
              n.session ? 'border-white/12 bg-white/[0.06]' : 'border-violet-400/25 bg-violet-500/15',
              on && 'border-violet-300/70 shadow-[0_0_14px] shadow-violet-500/40')}>
              {on && <motion.span className="absolute inset-0 rounded-full border border-violet-300/60"
                animate={{ scale: [1, 1.6], opacity: [0.7, 0] }} transition={{ duration: 1.4, repeat: Infinity, ease: 'easeOut' }} />}
              {n.session
                ? <Clawd mood={on ? 'working' : 'idle'} size={28} />
                : <span className="text-[13px] font-semibold uppercase text-violet-200">{n.label.trim().charAt(0) || '?'}</span>}
            </span>
            <span className="max-w-full truncate rounded-full bg-black/40 px-1.5 text-[9.5px] leading-4 text-foreground/85">{n.label}</span>
          </motion.button>
        )
      })}
    </div>
  )
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={cn('flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors',
        on ? 'border-violet-400/50 bg-violet-500/15 text-violet-200' : 'border-white/10 text-muted-foreground active:bg-white/5')}>
      {children}
    </button>
  )
}

function NetRow({ m, onOpen, multi }: { m: NetworkMessage; onOpen: () => void; multi: boolean }) {
  const out = m.dir === 'out'
  const text = m.text.replace(/\s+/g, ' ').trim()
  return (
    <motion.button type="button" layout onClick={onOpen}
      initial={{ opacity: 0, y: -10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 380, damping: 32 }} whileTap={{ scale: 0.985 }}
      className="relative flex w-full gap-3 rounded-2xl p-3 text-left glass">
      <span className={cn('mt-0.5 grid size-7 shrink-0 place-items-center rounded-full',
        out ? 'bg-coral/15 text-coral' : 'bg-violet-500/15 text-violet-300')}>
        {out ? <ArrowUpRightIcon className="size-3.5" /> : <ArrowDownLeftIcon className="size-3.5" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5 text-[13px]">
          <span className="min-w-0 truncate">
            {out
              ? <><b className="font-semibold">{m.sessionTitle}</b>{multi && <span className="font-mono text-[10.5px] text-coral/80"> ({m.machine})</span>}<span className="text-muted-foreground"> → {m.to}</span></>
              : <><span className="text-muted-foreground">{m.from} → </span><b className="font-semibold">{m.sessionTitle}</b>{multi && <span className="font-mono text-[10.5px] text-coral/80"> ({m.machine})</span>}</>}
          </span>
          <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground/60">{ago(m.t)}</span>
        </span>
        <span className="mt-0.5 flex items-center gap-1.5">
          <KindChip kind={m.kind} />
        </span>
        <span className="mt-1 line-clamp-3 block break-words text-[12.5px] text-muted-foreground">{text}</span>
      </span>
    </motion.button>
  )
}

// The dashboard's header button: lights up while something moved recently.
export function NetworkButton({ messages, onOpen }: { messages: NetworkMessage[]; onOpen: () => void }) {
  // The clock drives it too: the same list ages out of the last ten minutes.
  const now = useNow(30_000)
  const n = useMemo(() => recentCount(dedupe(messages)), [messages, now]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <motion.button type="button" whileTap={{ scale: 0.92 }} onClick={onOpen} aria-label="Red"
      className={cn('relative grid size-11 place-items-center rounded-full border glass transition-colors',
        n ? 'border-violet-400/50 text-violet-300' : 'border-white/10 text-muted-foreground')}>
      <RadioTowerIcon className="size-5" />
      {n > 0 && (
        <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-violet-400 px-1 text-[9.5px] font-bold text-background">{n > 99 ? '99+' : n}</span>
      )}
    </motion.button>
  )
}

// Every message across all sessions and PCs: who talked to whom, as a graph
// strip and a live timeline, filterable by PC and session.
export function NetworkSheet({ messages, open, onOpenChange, onOpen, unsupported, error }: {
  messages: NetworkMessage[]; open: boolean; onOpenChange: (v: boolean) => void; onOpen: (session: string) => void
  unsupported?: boolean; error?: string
}) {
  const now = useNow(5000)
  const [machine, setMachine] = useState<string | null>(null)
  const [session, setSession] = useState<string | null>(null)
  const all = useMemo(() => dedupe(messages), [messages])
  const machines = useMemo(() => [...new Set(all.map(m => m.machine))], [all])
  const sessions = useMemo(() => {
    const seen = new Map<string, { id: string; title: string; machine: string; n: number }>()
    for (const m of all) {
      const s = seen.get(m.session) ?? { id: m.session, title: m.sessionTitle, machine: m.machine, n: 0 }
      s.n++
      seen.set(m.session, s)
    }
    return [...seen.values()].filter(s => !machine || s.machine === machine).sort((a, b) => b.n - a.n)
  }, [all, machine])
  const list = all.filter(m => (!machine || m.machine === machine) && (!session || m.session === session))
  const multi = machines.length > 1
  const go = (sid: string) => { onOpenChange(false); onOpen(sid) }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}
        className="inset-0 top-0 left-0 flex h-dvh w-full max-w-none translate-x-0 translate-y-0 flex-col gap-3 rounded-none border-0 ring-0 bg-background/95 px-4 pb-[max(env(safe-area-inset-bottom),16px)] pt-[max(env(safe-area-inset-top),16px)] backdrop-blur-2xl sm:max-w-none">
        <DialogHeader className="flex-row items-center gap-3 text-left">
          <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-violet-500/15 text-violet-300"><RadioTowerIcon className="size-5" /></span>
          <span className="min-w-0 flex-1">
            <DialogTitle className="text-[20px]">Red</DialogTitle>
            <DialogDescription className="text-[12px]">
              {unsupported ? 'El bridge no tiene la red todavía: actualízalo.'
                : error ? <span className="text-red-400">{error}</span>
                : `${all.length} mensajes · ${sessions.length} sesiones${multi ? ` · ${machines.length} PCs` : ''}`}
            </DialogDescription>
          </span>
          <button type="button" onClick={() => onOpenChange(false)} aria-label="Cerrar" className="grid size-10 place-items-center rounded-full glass active:bg-white/5">
            <XIcon className="size-4" />
          </button>
        </DialogHeader>

        <GraphStrip list={list} now={now} onOpen={go} />

        {(multi || sessions.length > 1) && (
          <div className="-mx-4 flex flex-col gap-1.5">
            {multi && (
              <div className="flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]">
                <Chip on={!machine} onClick={() => { setMachine(null); setSession(null) }}>Todas las PCs</Chip>
                {machines.map(mc => (
                  <Chip key={mc} on={machine === mc} onClick={() => { setMachine(machine === mc ? null : mc); setSession(null) }}>
                    <MonitorIcon className="size-3" /><span className="font-mono lowercase">{mc}</span>
                  </Chip>
                ))}
              </div>
            )}
            {sessions.length > 1 && (
              <div className="flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]">
                <Chip on={!session} onClick={() => setSession(null)}>Todas</Chip>
                {sessions.map(s => (
                  <Chip key={s.id} on={session === s.id} onClick={() => setSession(session === s.id ? null : s.id)}>
                    <span className="max-w-36 truncate">{s.title}</span><span className="font-mono text-[10px] opacity-60">{s.n}</span>
                  </Chip>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="-mx-1 flex min-h-0 flex-1 flex-col [&>*]:shrink-0 gap-2 overflow-y-auto px-1">
          <AnimatePresence initial={false}>
            {list.map(m => <NetRow key={netKey(m)} m={m} multi={multi} onOpen={() => go(m.session)} />)}
          </AnimatePresence>
          {!list.length && !unsupported && (
            <div className="mt-16 flex flex-col items-center gap-2 text-center text-muted-foreground">
              <MessagesSquareIcon className="size-8 opacity-40" />
              <p className="text-sm">Ningún mensaje entre sesiones o agentes todavía.</p>
              <p className="max-w-64 text-[12px] text-muted-foreground/70">Cuando una sesión le escriba a otra, a un agente o a su equipo, aparece aquí.</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
