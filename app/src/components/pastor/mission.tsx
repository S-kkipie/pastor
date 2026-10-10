import { ArrowUpIcon, BotIcon, ChevronRightIcon, LayoutGridIcon, LoaderCircleIcon, OctagonPauseIcon, SquareTerminalIcon, WorkflowIcon, XIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Avatar } from '@/components/pastor/avatar'
import { LIVE, PET_MOOD, backgroundOf, liveOf } from '@/components/pastor/live'
import { PetLane } from '@/components/pastor/pet/PetLane'
import { api, sessionPath } from '@/lib/api'
import { useBackClose } from '@/lib/back'
import { shortPath } from '@/lib/format'
import { useOrder } from '@/lib/pins'
import { stripMd } from '@/lib/plan'
import type { Pending, PastorEvent, SessionSummary } from '@/lib/types'
import { cn } from '@/lib/utils'

const spring = { type: 'spring', stiffness: 380, damping: 38 } as const

// Every live session on every PC on one screen, each one live: what it is
// doing, its last few steps, what it is waiting for; a message or a stop
// without opening it.
export function MissionControl({ open, onClose, sessions, onOpen }: {
  open: boolean; onClose: () => void; sessions: SessionSummary[]; onOpen: (id: string) => void
}) {
  useBackClose(open, onClose)
  const live = sessions.filter(s => s.online)
  const order = useOrder('sessions', sessions.map(s => s.id))
  const sorted = order.sort(live, s => s.id)
  const count = (k: string) => live.filter(s => liveOf(s) === k).length

  return (
    <AnimatePresence>
      {open && (
        <motion.div key="mission" initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={spring}
          className="fixed inset-0 z-50 flex flex-col bg-background pt-[env(safe-area-inset-top)]">
          <header className="flex items-center gap-2 border-b border-white/6 px-2 py-2">
            <button type="button" onClick={onClose} aria-label="Cerrar" className="grid size-10 place-items-center rounded-full active:bg-white/5"><XIcon className="size-5" /></button>
            <span className="grid size-8 place-items-center rounded-xl bg-coral/12 text-coral"><LayoutGridIcon className="size-4" /></span>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold leading-tight">Mission control</p>
              <p className="truncate text-[11.5px] text-muted-foreground">
                {live.length} en vivo{count('working') ? ` · ${count('working')} trabajando` : ''}{count('needs') ? ` · ${count('needs')} te necesitan` : ''}{count('background') ? ` · ${count('background')} esperando` : ''}
              </p>
            </div>
          </header>
          <main className="min-h-0 flex-1 overflow-y-auto px-3 pb-[max(env(safe-area-inset-bottom),20px)] pt-3">
            {sorted.length === 0 ? (
              <div className="mt-24 flex flex-col items-center gap-3 text-center text-muted-foreground">
                <Avatar state="idle" size={64} asleep />
                <p className="text-sm">No hay sesiones en vivo.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {sorted.map(s => <Tile key={s.id} s={s} onOpen={() => { onClose(); onOpen(s.id) }} />)}
              </div>
            )}
          </main>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// One session, followed on its own: the last few steps of its main thread.
function Tile({ s, onOpen }: { s: SessionSummary; onOpen: () => void }) {
  const [events, setEvents] = useState<PastorEvent[]>([])
  const [pending, setPending] = useState<Pending[]>([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const live = liveOf(s)
  const look = LIVE[live]
  const LiveIcon = look.icon
  const busy = live === 'working'
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      try {
        const d = await api<{ events: PastorEvent[]; pending: Pending[] }>(`${sessionPath(s.id)}?limit=24`)
        if (!alive.current) return
        setEvents(d.events.filter(e => !e.agent && (e.kind === 'user' || e.kind === 'assistant' || e.kind === 'tool')).slice(-4))
        setPending(d.pending ?? [])
      } catch { /* the next tick tries again */ }
      if (alive.current) timer = setTimeout(tick, busy ? 2500 : 6000)
    }
    void tick()
    return () => { alive.current = false; clearTimeout(timer) }
  }, [s.id, busy])

  const send = async () => {
    const t = text.trim()
    if (!t) return
    setSending(true)
    try {
      await api(sessionPath(s.id, 'prompt'), { text: t })
      setText('')
      toast.success(busy ? 'En cola' : 'Enviado', { description: s.title })
    } catch (e) { toast.error((e as Error).message) }
    finally { setSending(false) }
  }

  return (
    <div className={cn('relative overflow-hidden rounded-3xl glass', live === 'needs' && 'ring-1 ring-warn/45', live === 'resting' && 'opacity-80')}>
      <span className={cn('absolute inset-y-3 left-0 w-1 rounded-r-full', look.rail, (live === 'working' || live === 'needs') && 'animate-pulse')} />
      <button type="button" onClick={onOpen} className="flex w-full items-center gap-2.5 px-4 pb-1.5 pt-3 text-left active:bg-white/[0.03]">
        <Avatar state={live === 'needs' ? 'waiting' : busy ? (s.activity ? 'tool' : 'thinking') : 'idle'} size={26} asleep={live === 'resting'} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14.5px] font-semibold">{s.title}</span>
          <span className="block truncate font-mono text-[10.5px] text-muted-foreground/70">{s.machine} · {shortPath(s.cwd)}</span>
        </span>
        <span className={cn('flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold', look.chip)}>
          <LiveIcon className="size-3" />{look.label}
        </span>
        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground/50" />
      </button>

      <div className="flex flex-col gap-1 px-4 pb-2">
        {events.map(e => <Step key={e.seq} e={e} />)}
        {busy && <p className="text-shine truncate text-[12px]">{s.activity ? `${s.activity.tool} · ${s.activity.text}` : 'Pensando…'}</p>}
        {live === 'background' && <p className="truncate text-[12px] text-sky-200/80">Esperando {backgroundOf(s)}</p>}
        {(!!s.agents || !!s.tasks || !!s.workflows) && (
          <div className="flex gap-1.5 pt-0.5">
            {!!s.agents && <span className="flex items-center gap-1 rounded-full bg-violet-500/15 px-1.5 font-mono text-[10px] text-violet-300"><BotIcon className="size-3" />{s.agents}</span>}
            {!!s.tasks && <span className="flex items-center gap-1 rounded-full bg-sky-400/12 px-1.5 font-mono text-[10px] text-sky-300"><SquareTerminalIcon className="size-3" />{s.tasks}</span>}
            {!!s.workflows && <span className="flex items-center gap-1 rounded-full bg-violet-500/15 px-1.5 font-mono text-[10px] text-violet-300"><WorkflowIcon className="size-3" />{s.workflows}</span>}
          </div>
        )}
      </div>

      {pending.length > 0 && (
        <button type="button" onClick={onOpen} className="mx-3 mb-2 flex w-[calc(100%-1.5rem)] items-center gap-2 rounded-2xl border border-warn/35 bg-warn/10 px-3 py-2 text-left text-[12.5px] text-warn active:bg-warn/20">
          <span className="min-w-0 flex-1 truncate">{pending[0]!.kind === 'question' ? `Pregunta: ${pending[0]!.questions?.[0]?.question ?? ''}` : `Permiso: ${pending[0]!.summary ?? pending[0]!.tool ?? ''}`}</span>
          <span className="shrink-0 font-semibold">Responder ›</span>
        </button>
      )}

      <PetLane mood={PET_MOOD[live]} className="relative mx-4 h-8" />
      <div className="flex items-center gap-1.5 border-t border-white/5 px-2.5 py-2">
        <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void send() }}
          placeholder={busy ? 'Encolar un mensaje…' : 'Mensaje rápido…'}
          className="h-9 min-w-0 flex-1 rounded-xl bg-white/[0.04] px-3 text-[16px] outline-none focus:bg-white/[0.07] sm:text-[13px]" />
        {busy && (
          <button type="button" aria-label="Interrumpir" onClick={() => { void api(sessionPath(s.id, 'abort'), {}).catch(() => {}); toast.warning('Interrumpido', { description: s.title, icon: <OctagonPauseIcon className="size-4" /> }) }}
            className="grid size-9 shrink-0 place-items-center rounded-xl border border-red-400/30 text-red-300 active:bg-red-500/10"><OctagonPauseIcon className="size-4" /></button>
        )}
        <button type="button" aria-label="Enviar" onClick={() => void send()} disabled={!text.trim() || sending}
          className="grid size-9 shrink-0 place-items-center rounded-xl bg-coral text-background disabled:opacity-35">
          {sending ? <LoaderCircleIcon className="size-4 animate-spin" /> : <ArrowUpIcon className="size-4" strokeWidth={2.5} />}
        </button>
      </div>
    </div>
  )
}

function Step({ e }: { e: PastorEvent }) {
  if (e.kind === 'tool') {
    const failed = e.end && !e.end.ok
    return (
      <p className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted-foreground">
        <span className={cn('size-1.5 shrink-0 rounded-full', !e.end ? 'animate-pulse bg-coral' : failed ? 'bg-red-400' : 'bg-emerald-400/70')} />
        <span className="shrink-0 font-medium text-foreground/80">{e.tool}</span>
        <span className="truncate font-mono text-[11px]">{/^(Read|Write|Edit|MultiEdit|NotebookEdit)$/.test(e.tool ?? '') ? shortPath(e.text) : e.text}</span>
      </p>
    )
  }
  if (e.kind === 'user') return <p className="truncate text-[12.5px] text-coral/90">› {stripMd(e.text)}</p>
  return <p className="line-clamp-2 text-[12.5px] leading-snug text-foreground/90">{stripMd(e.text)}</p>
}
