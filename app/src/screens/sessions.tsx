import {
  AlarmClockIcon, BotIcon, ClockIcon, GlobeIcon, GripVerticalIcon, LayoutGridIcon, Settings2Icon, FolderIcon, MonitorIcon, PinIcon, PinOffIcon, PlusIcon, RadioTowerIcon, SmartphoneIcon, SparkleIcon, SparklesIcon, SquareTerminalIcon, WorkflowIcon, XIcon,
} from 'lucide-react'
import { AnimatePresence, Reorder, motion, useDragControls } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'

import { Avatar, useAvatarKind } from '@/components/pastor/avatar'
import { AgentScreen, useAgentStatus } from '@/components/pastor/agent'
import { DevicesSheet } from '@/components/pastor/devices'
import { LaunchSheet } from '@/components/pastor/launch'
import { LIVE, PET_MOOD, backgroundOf, liveOf } from '@/components/pastor/live'
import { PetLane, PetsCovered } from '@/components/pastor/pet/PetLane'
import type { Walker } from '@/components/pastor/pet/walker'
import { LimitsStrip } from '@/components/pastor/statusbar'
import { MissionControl } from '@/components/pastor/mission'
import { PreviewsSheet } from '@/components/pastor/previews'
import { RoutinesScreen } from '@/components/pastor/routines'
import { TerminalScreen } from '@/components/pastor/terminal'
import { NetworkButton, NetworkSheet } from '@/components/pastor/network'
import type { OrbState } from '@/components/pastor/orb'
import { api, sessionPath, store } from '@/lib/api'
import { ago, shortPath } from '@/lib/format'
import { stripMd } from '@/lib/plan'
import { useNetwork, useSessions } from '@/lib/hooks'
import { useLongPress, useOrder, usePins } from '@/lib/pins'
import type { Machine, SessionSummary } from '@/lib/types'
import { cn } from '@/lib/utils'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

type GroupBy = 'machine' | 'project' | 'recent'
const GROUPINGS: [GroupBy, string, typeof MonitorIcon][] = [
  ['machine', 'PC', MonitorIcon], ['project', 'Proyecto', FolderIcon], ['recent', 'Reciente', ClockIcon],
]

const orbOf = (s: SessionSummary): OrbState =>
  !s.online ? 'idle' : s.status === 'waiting' || s.pending ? 'waiting' : s.status === 'busy' ? (s.activity ? 'tool' : 'thinking') : 'idle'
const projectKey = (cwd: string) => cwd.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()
const baseName = (cwd: string) => cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd

// Long-press pins a session to the top of the dashboard (or unpins it).
function useSessionPins() {
  const { has, toggle } = usePins('sessions')
  const flip = (s: SessionSummary) => {
    const on = toggle(s.id)
    toast.success(on ? 'Sesión fijada' : 'Sesión desfijada', {
      description: s.title, icon: on ? <PinIcon className="size-4 text-coral" /> : <PinOffIcon className="size-4" />,
    })
  }
  return { has, flip }
}

function SessionCard({ s, onOpen, i, showMachine, pinned, onPin }: {
  s: SessionSummary; onOpen: () => void; i: number; showMachine?: boolean; pinned?: boolean; onPin?: () => void
}) {
  const live = liveOf(s)
  const look = LIVE[live]
  const LiveIcon = look.icon
  const pct = s.usage?.window ? Math.min(100, Math.round((s.usage.tokens / s.usage.window) * 100)) : null
  const press = useLongPress(() => onPin?.(), onOpen)
  return (
    <motion.button type="button" {...press}
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }}
      transition={{ delay: Math.min(i, 8) * 0.04, type: 'spring', stiffness: 300, damping: 28 }}
      whileTap={{ scale: 0.985 }}
      className={cn('relative w-full select-none overflow-hidden rounded-3xl pb-11 pl-5 pr-10 pt-4 text-left glass [-webkit-touch-callout:none]',
        live === 'needs' && 'ring-1 ring-warn/45', live === 'resting' && 'opacity-70')}>
      <span className={cn('absolute inset-y-3 left-0 w-1 rounded-r-full', look.rail, (live === 'working' || live === 'needs') && 'animate-pulse')} />
      {live === 'working' && <div className="pointer-events-none absolute -left-10 -top-10 size-32 rounded-full bg-coral/15 blur-2xl" />}
      <div className="relative flex items-start gap-3.5">
        <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-white/[0.04]">
          <Avatar state={orbOf(s)} size={34} asleep={live === 'resting'} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[16px] font-semibold">{s.title}</span>
            {pinned && <PinIcon className="size-3.5 shrink-0 text-coral" />}
            {s.away && <SmartphoneIcon className="size-3.5 shrink-0 text-coral" />}
            {!!s.messages && <span className="flex shrink-0 items-center gap-1 rounded-full bg-violet-500/10 px-1.5 font-mono text-[10.5px] text-violet-200/90"><RadioTowerIcon className="size-3" />{s.messages}</span>}
          </div>
          <p className="truncate font-mono text-[11px] text-muted-foreground/70">
            {showMachine && <span className="text-coral/80">{s.machine} · </span>}{shortPath(s.cwd)}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className={cn('flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', look.chip)}>
              <LiveIcon className="size-3" />{look.label}{live === 'needs' && s.pending > 1 ? ` · ${s.pending}` : ''}
            </span>
            {!!s.agents && <span className="flex items-center gap-1 rounded-full bg-violet-500/15 px-1.5 py-0.5 font-mono text-[10.5px] text-violet-300"><BotIcon className="size-3" />{s.agents}</span>}
            {!!s.tasks && <span className="flex items-center gap-1 rounded-full bg-sky-400/12 px-1.5 py-0.5 font-mono text-[10.5px] text-sky-300"><SquareTerminalIcon className="size-3" />{s.tasks}</span>}
            {!!s.workflows && <span className="flex items-center gap-1 rounded-full bg-violet-500/15 px-1.5 py-0.5 font-mono text-[10.5px] text-violet-300"><WorkflowIcon className="size-3" />{s.workflows}</span>}
          </div>
          <div className="mt-1.5 text-[13.5px] leading-snug">
            {live === 'needs' ? <span className="text-warn">Necesita tu respuesta</span>
              : live === 'working' ? <span className="text-shine line-clamp-2 break-all">{s.activity ? `${s.activity.tool} · ${s.activity.text}` : 'Pensando…'}</span>
              : live === 'background' ? <span className="line-clamp-2 text-sky-200/80">Turno terminado · esperando {backgroundOf(s)}</span>
              : s.last ? <span className="line-clamp-2 text-muted-foreground">{s.last.kind === 'user' ? '› ' : ''}{stripMd(s.last.text)}</span>
              : <span className="text-muted-foreground/60">Lista</span>}
          </div>
          {pct != null && (
            <div className="mt-2.5 flex items-center gap-2">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/8">
                <div className={cn('h-full rounded-full', pct > 85 ? 'bg-red-400' : pct > 65 ? 'bg-warn' : 'bg-gradient-to-r from-coral to-coral-soft')}
                  style={{ width: `${pct}%` }} />
              </div>
              <span className="font-mono text-[10px] text-muted-foreground/70">{pct}% · {s.usage?.model?.replace(/^claude-/, '')}</span>
            </div>
          )}
        </div>
      </div>
      <PetLane mood={PET_MOOD[live]} className="absolute bottom-1.5 left-4 right-10 h-8" />
    </motion.button>
  )
}

// Live sessions in the order the person set by dragging the grip; activity
// never moves a card, only its rail and state chip change.
type Order = ReturnType<typeof useOrder>
function LiveList({ list, order, showMachine, pins, onOpen }: {
  list: SessionSummary[]; order: Order; showMachine?: boolean; pins: ReturnType<typeof useSessionPins>; onOpen: (id: string) => void
}) {
  const sorted = order.sort(list, s => s.id)
  if (!sorted.length) return null
  return (
    <Reorder.Group as="div" axis="y" values={sorted.map(s => s.id)} onReorder={order.move} className="flex flex-col gap-2.5">
      <AnimatePresence initial={false}>
        {sorted.map((s, i) => (
          <LiveItem key={s.id} id={s.id}>
            <SessionCard s={s} i={i} showMachine={showMachine} pinned={pins.has(s.id)} onPin={() => pins.flip(s)} onOpen={() => onOpen(s.id)} />
          </LiveItem>
        ))}
      </AnimatePresence>
    </Reorder.Group>
  )
}

function LiveItem({ id, children }: { id: string; children: ReactNode }) {
  const controls = useDragControls()
  return (
    <Reorder.Item as="div" value={id} dragListener={false} dragControls={controls} className="relative rounded-3xl"
      whileDrag={{ scale: 1.02, zIndex: 20, boxShadow: '0 18px 40px -12px rgba(0,0,0,0.6)' }}>
      {children}
      <div aria-label="Arrastrar para ordenar" role="button" tabIndex={-1}
        onPointerDown={e => { e.preventDefault(); try { navigator.vibrate?.(8) } catch { /* unsupported */ } controls.start(e) }}
        className="absolute inset-y-0 right-0 grid w-10 cursor-grab touch-none place-items-center text-muted-foreground/40 active:text-foreground">
        <GripVerticalIcon className="size-4" />
      </div>
    </Reorder.Item>
  )
}

// Closed sessions: one compact row each, removable.
function ClosedList({ list, onOpen, showMachine, limit = 8, pins }: {
  list: SessionSummary[]; onOpen: (id: string) => void; showMachine?: boolean; limit?: number; pins: ReturnType<typeof useSessionPins>
}) {
  const [gone, setGone] = useState<Set<string>>(new Set())
  const rows = list.filter(s => !gone.has(s.id)).slice(0, limit)
  if (!rows.length) return null
  const forget = async (id: string) => {
    setGone(g => new Set(g).add(id))
    try { await api(sessionPath(id, 'forget'), {}) } catch (e) { toast.error((e as Error).message) }
  }
  return (
    <div className="overflow-hidden rounded-2xl glass">
      <AnimatePresence initial={false}>
        {rows.map(s => (
          <ClosedRow key={s.id} s={s} showMachine={showMachine} pinned={pins.has(s.id)}
            onOpen={() => onOpen(s.id)} onPin={() => pins.flip(s)} onForget={() => void forget(s.id)} />
        ))}
      </AnimatePresence>
    </div>
  )
}

function ClosedRow({ s, showMachine, pinned, onOpen, onPin, onForget }: {
  s: SessionSummary; showMachine?: boolean; pinned: boolean; onOpen: () => void; onPin: () => void; onForget: () => void
}) {
  const press = useLongPress(onPin, onOpen)
  return (
    <motion.div layout exit={{ opacity: 0, height: 0 }} className="flex items-center border-b border-white/5 last:border-0">
      <button type="button" {...press} className="flex min-w-0 flex-1 select-none items-center gap-3 px-3.5 py-2.5 text-left active:bg-white/5 [-webkit-touch-callout:none]">
        {pinned ? <PinIcon className="size-3 shrink-0 text-coral" /> : <span className="size-1.5 shrink-0 rounded-full bg-white/20" />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px]">{s.title}{showMachine && <span className="font-mono text-[11px] text-muted-foreground/60"> · {s.machine}</span>}</span>
          <span className="block truncate text-[11.5px] text-muted-foreground/70">{s.last ? stripMd(s.last.text) : shortPath(s.cwd)}</span>
        </span>
        <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground/60">{ago(s.lastSeen)}</span>
      </button>
      <button type="button" onClick={onForget} aria-label="Quitar" className="grid size-10 shrink-0 place-items-center text-muted-foreground/50 active:text-foreground">
        <XIcon className="size-3.5" />
      </button>
    </motion.div>
  )
}

// Per PC: new sessions there start in away mode, so their dialogs (permissions,
// questions, workflows) come to the phone instead of waiting at the terminal.
function AwayDefault({ machine }: { machine: string }) {
  const [on, setOn] = useState<boolean | null>(null)
  useEffect(() => {
    api<{ awayDefault: boolean }>(`/api/settings?machine=${encodeURIComponent(machine)}`).then(r => setOn(r.awayDefault), () => setOn(null))
  }, [machine])
  if (on === null) return null
  const flip = async () => {
    try {
      const r = await api<{ awayDefault: boolean }>('/api/settings', { machine, awayDefault: !on })
      setOn(r.awayDefault)
      toast.info(r.awayDefault ? `${machine}: modo fuera por defecto` : `${machine}: modo aquí por defecto`, {
        description: r.awayDefault ? 'Las sesiones nuevas responden permisos y workflows desde el móvil' : 'Las sesiones nuevas responden en la PC',
        icon: r.awayDefault ? <SmartphoneIcon className="size-4" /> : <MonitorIcon className="size-4" />,
      })
    } catch (e) { toast.error((e as Error).message) }
  }
  return (
    <button type="button" onClick={flip} aria-label="Modo fuera por defecto"
      className={cn('flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] transition-colors',
        on ? 'border-coral/50 bg-coral/12 text-coral' : 'border-white/10 text-muted-foreground')}>
      {on ? <SmartphoneIcon className="size-3" /> : <MonitorIcon className="size-3" />}{on ? 'fuera' : 'aquí'}
    </button>
  )
}

type Group = { key: string; title: string; icon: typeof MonitorIcon; meta?: string; online?: boolean; hub?: boolean; list: SessionSummary[] }

function groupSessions(by: GroupBy, sessions: SessionSummary[], machines: Machine[], groupOrder: Order): Group[] {
  if (by === 'recent') return [{ key: 'recent', title: '', icon: ClockIcon, list: [...sessions].sort((a, b) => b.lastSeen - a.lastSeen) }]
  if (by === 'machine') {
    if (machines.length <= 1) return [{ key: 'all', title: '', icon: MonitorIcon, list: sessions }]
    return machines.map(m => {
      const list = sessions.filter(s => s.machine === m.name)
      return { key: m.name, title: m.name, icon: MonitorIcon, online: m.online, hub: m.local,
        meta: m.online ? `${list.filter(s => s.online).length} activas` : 'sin conexión', list }
    })
  }
  const groups = new Map<string, Group>()
  for (const s of sessions) {
    const key = `${s.machine}:${projectKey(s.cwd)}`
    if (!groups.has(key)) groups.set(key, { key, title: baseName(s.cwd), icon: FolderIcon, meta: s.machine, list: [] })
    groups.get(key)!.list.push(s)
  }
  // Projects keep their place too: a new one goes last.
  return groupOrder.sort([...groups.values()], g => g.key)
}

export function SessionsScreen({ onOpen }: { onOpen: (id: string) => void }) {
  const { sessions, machines, loaded, error } = useSessions()
  const [launch, setLaunch] = useState(false)
  const [netOpen, setNetOpen] = useState(false)
  const [devOpen, setDevOpen] = useState(false)
  const [tool, setTool] = useState<'mission' | 'term' | 'web' | 'routines' | 'agent' | null>(null)
  const net = useNetwork({ onOpen })
  const [avatar, setAvatar] = useAvatarKind()
  const [by, setBy] = useState<GroupBy>(() => store.get('groupBy', 'machine'))
  useEffect(() => { store.set('groupBy', by) }, [by])
  const multi = machines.length > 1
  const pins = useSessionPins()
  const agent = useAgentStatus()
  // The general agent's sessions live inside its own screen unless asked otherwise.
  const shown = agent.config?.showInPanel ? sessions : sessions.filter(s => !s.agent)
  const liveNow = shown.filter(s => s.online)
  const active = liveNow.filter(s => liveOf(s) === 'working').length
  const background = liveNow.filter(s => liveOf(s) === 'background').length
  const online = liveNow.length
  const waiting = shown.reduce((a, s) => a + s.pending, 0)
  const order = useOrder('sessions', shown.map(s => s.id))
  const projectKeys = useMemo(() => [...new Set(shown.map(s => `${s.machine}:${projectKey(s.cwd)}`))], [shown])
  const groupOrder = useOrder('projects', projectKeys)
  const pinned = shown.filter(s => pins.has(s.id))
  const rest = shown.filter(s => !pins.has(s.id))
  const pinnedLive = pinned.filter(s => s.online), pinnedClosed = pinned.filter(s => !s.online)
  const groups = groupSessions(by, rest, machines, groupOrder)
  const showMachine = multi && by !== 'machine'
  // Pastor's own Clawd on the floor: pants while the hub is unreachable and
  // celebrates when it answers again.
  const floor = useRef<Walker | null>(null)
  const offline = !!error
  const wasOffline = useRef(false)
  useEffect(() => {
    if (offline) wasOffline.current = true
    else if (wasOffline.current) { wasOffline.current = false; floor.current?.react('done') }
  }, [offline])
  // Once the agent answered, its pet stays (a failed poll must not unmount it).
  const agentSeen = useRef(false)
  if (agent.status) agentSeen.current = true
  const agentHere = agentSeen.current
  const agentBusy = !!agent.status?.channels.some(c => c.busy)
  // Full-screen sheets cover the dashboard without unmounting it: its pets rest.
  const covered = tool !== null || devOpen || launch || netOpen

  return (
    <div className="flex h-dvh flex-col pt-[env(safe-area-inset-top)]">
      <header className="flex items-center gap-3 px-5 pb-2 pt-5">
        <button type="button" aria-label="Cambiar avatar" onClick={() => {
          const next = avatar === 'clawd' ? 'orb' : 'clawd'
          setAvatar(next)
          toast(next === 'clawd' ? 'Clawd al mando' : 'Orbe pensante', { icon: next === 'clawd' ? <BotIcon className="size-4 text-coral" /> : <SparkleIcon className="size-4 text-coral" /> })
        }}>
          <Avatar state={waiting ? 'waiting' : active ? 'thinking' : 'idle'} size={40} mood={waiting ? 'alert' : active ? 'working' : online ? 'idle' : 'sleep'} />
        </button>
        <div className="flex-1">
          <h1 className="text-[24px] font-semibold tracking-tight">Pastor</h1>
          <p className="text-[12.5px] text-muted-foreground">
            {!loaded ? 'Conectando…' : error ? <span className="text-red-400">{error}</span>
              : `${online} ${online === 1 ? 'sesión' : 'sesiones'}${active ? ` · ${active} trabajando` : ''}${background ? ` · ${background} en 2º plano` : ''}${waiting ? ` · ${waiting} te esperan` : ''}`}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="Más opciones"
              className="grid size-10 place-items-center rounded-full border border-white/10 text-muted-foreground active:bg-white/5">
              <Settings2Icon className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-52 rounded-2xl border-white/10 bg-popover/95 backdrop-blur-2xl">
            <DropdownMenuItem onClick={() => setDevOpen(true)}><Settings2Icon />Dispositivos y PCs</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setTool('mission')}><LayoutGridIcon className="text-coral" />Mission control</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTool('web')}><GlobeIcon className="text-sky-300" />Web en desarrollo</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <NetworkButton messages={net.messages} onOpen={() => setNetOpen(true)} />
        <motion.button type="button" whileTap={{ scale: 0.92 }} onClick={() => setLaunch(true)} aria-label="Nueva sesión"
          className="grid size-11 place-items-center rounded-full bg-gradient-to-br from-coral to-[oklch(0.62_0.15_35)] text-background shadow-lg shadow-coral/30">
          <PlusIcon className="size-5" strokeWidth={2.5} />
        </motion.button>
      </header>
      <LimitsStrip usage={[...sessions].filter(x => x.online && x.usage?.rateLimits?.length).sort((x, y) => y.lastSeen - x.lastSeen)[0]?.usage ?? null} />
      <div className="flex gap-2 px-4 pb-2">
        {([
          ['term', 'Terminal', SquareTerminalIcon, 'text-emerald-300'],
          ['routines', 'Rutinas', AlarmClockIcon, 'text-amber-300'],
          ['agent', 'Agente', SparklesIcon, 'text-violet-300'],
        ] as const).filter(([key]) => key !== 'agent' || !agent.missing).map(([key, label, Icon, color]) => (
          <motion.button key={key} type="button" whileTap={{ scale: 0.96 }} onClick={() => setTool(key)}
            className="flex h-10 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-2xl text-[13px] font-medium glass active:bg-white/5">
            <Icon className={cn('size-4 shrink-0', color)} /><span className="truncate">{label}</span>
            {key === 'agent' && agent.status && <span className={cn('size-1.5 rounded-full', agent.status.whatsapp.state === 'connected' ? 'bg-emerald-400' : 'bg-amber-400')} />}
          </motion.button>
        ))}
      </div>
      <div className="px-4 pb-2">
        <div className="relative flex rounded-full p-0.5 glass">
          {GROUPINGS.map(([key, label, Icon]) => (
            <button key={key} type="button" onClick={() => setBy(key)}
              className={cn('relative z-10 flex flex-1 items-center justify-center gap-1.5 py-1.5 text-[12.5px] font-medium transition-colors',
                by === key ? 'text-foreground' : 'text-muted-foreground')}>
              {by === key && <motion.span layoutId="groupby" className="absolute inset-0 -z-10 rounded-full bg-white/10" transition={{ type: 'spring', stiffness: 400, damping: 34 }} />}
              <Icon className="size-3.5" />{label}
            </button>
          ))}
        </div>
      </div>
      <PetsCovered.Provider value={covered}>
      <motion.main layoutScroll className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {loaded && shown.length === 0 && !multi && (
          <div className="mt-[18vh] flex flex-col items-center gap-3 text-center">
            <p className="font-medium">No hay sesiones</p>
            <p className="max-w-64 text-sm text-muted-foreground">Abre Claude Code con el mod pastor, o crea una con el botón +.</p>
            <PetLane mood="idle" scale={2.2} className="relative mt-1 h-14 w-60" />
          </div>
        )}
        <AnimatePresence initial={false}>
          {pinned.length > 0 && (
            <motion.section key="pinned" layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} className="mb-4">
              <div className="mb-2 mt-3 flex items-center gap-2 px-1">
                <PinIcon className="size-3.5 text-coral" />
                <span className="text-[12px] font-semibold uppercase tracking-wider text-coral">Fijadas</span>
                <span className="ml-auto font-mono text-[11px] text-muted-foreground/70">{pinned.length}</span>
              </div>
              <div className="flex flex-col gap-2.5">
                <LiveList list={pinnedLive} order={order} showMachine={multi} pins={pins} onOpen={onOpen} />
                {pinnedClosed.length > 0 && <ClosedList list={pinnedClosed} onOpen={onOpen} showMachine={multi} limit={30} pins={pins} />}
              </div>
            </motion.section>
          )}
        </AnimatePresence>
        <AnimatePresence mode="popLayout">
          {groups.map(g => {
            const live = g.list.filter(s => s.online), closed = g.list.filter(s => !s.online)
            const Icon = g.icon
            return (
              <motion.section key={`${by}:${g.key}`} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mb-4">
                {g.title && (
                  <div className="mb-2 mt-3 flex items-center gap-2 px-1">
                    <Icon className={cn('size-3.5', g.online === false ? 'text-muted-foreground/50' : by === 'machine' ? 'text-emerald-400' : 'text-coral')} />
                    <span className={cn('truncate text-[12.5px] font-semibold', by === 'machine' ? 'font-mono lowercase text-muted-foreground' : 'text-foreground')}>{g.title}</span>
                    {g.hub && <span className="rounded-full border border-white/10 px-1.5 text-[10px] text-muted-foreground">hub</span>}
                    <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground/70">{g.meta}</span>
                    {by === 'machine' && g.online !== false && <AwayDefault machine={g.key} />}
                  </div>
                )}
                <div className="flex flex-col gap-2.5">
                  <LiveList list={live} order={order} showMachine={showMachine && by !== 'project'} pins={pins} onOpen={onOpen} />
                  {closed.length > 0 && (
                    <div className={cn(live.length > 0 && 'mt-1')}>
                      {(by !== 'project' || live.length > 0) && (
                        <p className="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">
                          {by === 'recent' ? 'Cerradas' : 'Recientes'}
                        </p>
                      )}
                      <ClosedList list={closed} onOpen={onOpen} showMachine={showMachine} limit={by === 'recent' ? 30 : by === 'project' ? 4 : 8} pins={pins} />
                    </div>
                  )}
                  {by === 'machine' && g.title && g.list.length === 0 && <p className="px-1 text-[12.5px] text-muted-foreground/60">Sin sesiones.</p>}
                </div>
              </motion.section>
            )
          })}
        </AnimatePresence>
      </motion.main>
      <div className="relative mx-4 mb-[max(env(safe-area-inset-bottom),6px)] h-11 shrink-0 border-t border-dashed border-white/6">
        <PetLane group="dash" scale={1.9} mood={offline ? 'pant' : waiting ? 'alert' : 'idle'} className="absolute inset-0"
          onReady={w => { floor.current = w }} />
        {agentHere && (
          <PetLane group="dash" scale={1.9} hat="party" className="absolute inset-0"
            mood={agentBusy ? 'working' : 'idle'} />
        )}
      </div>
      </PetsCovered.Provider>
      <LaunchSheet open={launch} onOpenChange={setLaunch} onOpenSession={onOpen} />
      <DevicesSheet open={devOpen} onClose={() => setDevOpen(false)} />
      <MissionControl open={tool === 'mission'} onClose={() => setTool(null)} sessions={sessions} onOpen={onOpen} />
      <TerminalScreen open={tool === 'term'} onClose={() => setTool(null)} machines={machines} />
      <PreviewsSheet open={tool === 'web'} onClose={() => setTool(null)} machines={machines} />
      <RoutinesScreen open={tool === 'routines'} onClose={() => setTool(null)} machines={machines} onOpenSession={onOpen} />
      <AgentScreen open={tool === 'agent'} onClose={() => setTool(null)} onOpenSession={onOpen} />
      <NetworkSheet messages={net.messages} unsupported={net.unsupported} error={net.error} open={netOpen} onOpenChange={setNetOpen} onOpen={onOpen} />
    </div>
  )
}
