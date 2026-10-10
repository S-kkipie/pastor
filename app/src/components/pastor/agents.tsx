import {
  BotIcon, ChevronLeftIcon, Maximize2Icon, CircleCheckIcon, CircleXIcon, CoinsIcon, FootprintsIcon, OctagonXIcon, SendIcon, WrenchIcon,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { MessageResponse } from '@/components/ai-elements/message'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api, sessionPath } from '@/lib/api'
import { dur, tokens } from '@/lib/format'
import { useNow } from '@/lib/hooks'
import type { AgentLog, AgentRow, PastorEvent, WorkflowRun } from '@/lib/types'
import { cn } from '@/lib/utils'

import { Clawd } from './clawd'
import { memberName, TeamTab } from './team'
import { iconOf } from './tools'
import { WorkflowsTab } from './workflows'
import { useBackClose } from '@/lib/back'

export const isLive = (a: AgentRow) => a.status === 'running' || a.status === 'pending'
export const isDone = (a: AgentRow) => a.status === 'completed' || a.status === 'failed' || a.status === 'killed'
type Tab = 'sub' | 'wf' | 'team'
const tabOf = (a: AgentRow): Tab => a.workflowRunId ? 'wf' : a.teammate ? 'team' : 'sub'
const STATUS: Record<AgentRow['status'], string> = {
  pending: 'arrancando', running: 'trabajando', waiting: 'esperando', idle: 'en espera', completed: 'terminó', failed: 'falló', killed: 'detenido',
}

// The header button: how many agents and workflow runs are working, glowing
// violet (agents) or violet/coral (a workflow runs) while anything does.
export function AgentsButton({ agents, workflows = [], onOpen }: { agents: AgentRow[]; workflows?: WorkflowRun[]; onOpen: () => void }) {
  const liveAgents = agents.filter(isLive).length
  const liveRuns = workflows.filter(r => r.status === 'running').length
  const running = liveAgents + liveRuns
  if (!agents.length && !workflows.length) return null
  return (
    <motion.button type="button" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} onClick={onOpen}
      aria-label="Agentes"
      className={cn('relative grid size-9 place-items-center rounded-full border transition-colors',
        running ? 'border-violet-400/50 bg-violet-500/12 text-violet-300' : 'border-white/10 text-muted-foreground')}>
      {running > 0 && (
        <motion.span aria-hidden className="pointer-events-none absolute inset-0 rounded-full"
          animate={{
            boxShadow: liveRuns
              ? ['0 0 8px 0 rgb(167 139 250 / 0.45)', '0 0 14px 2px rgb(240 128 96 / 0.5)', '0 0 8px 0 rgb(167 139 250 / 0.45)']
              : ['0 0 5px 0 rgb(167 139 250 / 0.3)', '0 0 14px 2px rgb(167 139 250 / 0.55)', '0 0 5px 0 rgb(167 139 250 / 0.3)'],
          }}
          transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }} />
      )}
      <BotIcon className="relative size-4" />
      {running > 0 && (
        <motion.span key={running} initial={{ scale: 0.5 }} animate={{ scale: 1 }}
          className={cn('absolute -right-0.5 -top-0.5 grid size-4 place-items-center rounded-full text-[9.5px] font-bold text-background',
            liveRuns ? 'bg-gradient-to-br from-coral to-violet-400' : 'bg-violet-400')}>{running}</motion.span>
      )}
    </motion.button>
  )
}

function Clock({ a, skew }: { a: AgentRow; skew: number }) {
  const now = useNow(1000)
  return <>{dur((a.endedAt ?? now - skew) - a.startedAt) || '0s'}</>
}

function AgentTile({ a, skew, onOpen, i }: { a: AgentRow; skew: number; onOpen: () => void; i: number }) {
  const live = isLive(a)
  const ActIcon = a.activity ? iconOf(a.activity.tool) : null
  return (
    <motion.button type="button" layout onClick={onOpen} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay: i * 0.04 }} whileTap={{ scale: 0.985 }}
      className={cn('relative w-full overflow-hidden rounded-2xl p-3.5 text-left glass', live && 'ring-1 ring-violet-400/30')}>
      {live && <div className="pointer-events-none absolute -right-8 -top-8 size-24 rounded-full bg-violet-500/15 blur-2xl" />}
      <div className="relative flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/[0.04]">
          <Clawd mood={live ? (a.activity ? 'working' : 'pant') : a.status === 'completed' ? 'done' : a.status === 'idle' ? 'sleep' : 'idle'} size={34} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className={cn('truncate text-[14.5px] font-medium', live && 'text-shine')}>{a.description}</span>
            {a.status === 'completed' && <CircleCheckIcon className="size-3.5 shrink-0 text-emerald-400" />}
            {(a.status === 'failed' || a.status === 'killed') && <CircleXIcon className="size-3.5 shrink-0 text-red-400" />}
          </span>
          <span className="flex flex-wrap items-center gap-x-2 font-mono text-[10.5px] text-muted-foreground/80">
            <span className="text-violet-300/90">{a.type}</span>
            <span>{STATUS[a.status]}</span>
            <span className="tabular-nums"><Clock a={a} skew={skew} /></span>
            {a.tokens > 0 && <span className="flex items-center gap-0.5"><CoinsIcon className="size-2.5" />{tokens(a.tokens)}</span>}
            <span className="flex items-center gap-0.5"><FootprintsIcon className="size-2.5" />{a.steps}</span>
            <span className="flex items-center gap-0.5"><WrenchIcon className="size-2.5" />{a.tools}</span>
          </span>
          {live && a.activity && ActIcon && (
            <span className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[12px]">
              <ActIcon className="size-3 shrink-0 text-violet-300" /><span className="shrink-0">{a.activity.tool}</span>
              <span className="truncate font-mono text-[11px] text-muted-foreground">{a.activity.text}</span>
            </span>
          )}
          {(live ? a.text : a.answer) && (
            <span className="mt-1 line-clamp-2 text-[12.5px] text-muted-foreground">{(live ? a.text : a.answer ?? '').slice(-240)}</span>
          )}
        </span>
      </div>
    </motion.button>
  )
}

// One agent up close: its task, its conversation (refreshed while open), the
// answer, a box to write to it and a stop button.
function AgentDetail({ sid, a, skew, onBack, events, onExpand }: { sid: string; a: AgentRow; skew: number; onBack: () => void; events: PastorEvent[]; onExpand?: () => void }) {
  const [log, setLog] = useState<AgentLog | null>(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  const live = isLive(a)
  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        await api(sessionPath(sid, 'agentLog'), { id: a.id })
        await new Promise(r => setTimeout(r, 900))
        const r = await api<{ log: AgentLog | null }>(`${sessionPath(sid, 'agent')}?id=${encodeURIComponent(a.id)}`)
        if (alive && r.log) setLog(r.log)
      } catch { /* next tick */ }
    }
    void tick()
    const t = setInterval(tick, live ? 3000 : 8000)
    return () => { alive = false; clearInterval(t) }
  }, [sid, a.id, live])
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [log?.messages.length])

  const send = async () => {
    const v = text.trim()
    if (!v) return
    setSending(true)
    try {
      await api(sessionPath(sid, 'agentMsg'), { id: a.id, text: v })
      setText('')
      toast.success('Mensaje enviado al agente', { description: v.slice(0, 80) })
    } catch (e) { toast.error((e as Error).message) } finally { setSending(false) }
  }
  return (
    <motion.div initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onBack} aria-label="Volver" className="grid size-9 place-items-center rounded-full active:bg-white/5">
          <ChevronLeftIcon className="size-5" />
        </button>
        <Clawd mood={live ? 'working' : a.status === 'completed' ? 'done' : 'idle'} size={40} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold">{a.teammate ? memberName(a) : a.description}</span>
          <span className="block truncate font-mono text-[11px] text-muted-foreground">
            {a.type}{a.model ? ` · ${a.model.replace(/^claude-/, '')}` : ''} · {STATUS[a.status]} · <Clock a={a} skew={skew} />{a.tokens ? ` · ${tokens(a.tokens)} tok` : ''}
          </span>
        </span>
        {onExpand && (
          <button type="button" onClick={onExpand} aria-label="Pantalla completa"
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-violet-400/30 bg-violet-500/12 px-3 py-1.5 text-[12px] font-medium text-violet-200 active:scale-95">
            <Maximize2Icon className="size-3.5" />Expandir
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-white/6 bg-black/20 p-3">
        {a.prompt && (
          <details className="mb-3 rounded-xl bg-violet-500/8 px-3 py-2 text-[12.5px]">
            <summary className="cursor-pointer text-violet-200">Tarea</summary>
            <p className="mt-1.5 whitespace-pre-wrap text-muted-foreground">{a.prompt}</p>
          </details>
        )}
        {!log && <p className="text-shine text-[13px]">Leyendo su conversación…</p>}
        {log?.error && !log.messages.length && (
          // The engine no longer reads a finished agent back: what the session saw of it instead.
          <div className="flex flex-col gap-1">
            {events.map(e => {
              const Icon = iconOf(e.tool ?? '')
              return (
                <p key={e.seq} className="flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                  <Icon className="size-3 shrink-0 text-violet-300" /><span className="shrink-0 text-foreground/80">{e.tool}</span><span className="truncate">{e.text}</span>
                </p>
              )
            })}
            {!events.length && <p className="text-[12.5px] text-muted-foreground">Su conversación ya no está disponible.</p>}
          </div>
        )}
        <div className="flex flex-col gap-2.5">
          {log?.messages.filter(m => m.text.trim() || m.tools.length).map((m, i) => (
            <div key={i} className={cn('text-[13px]', m.role === 'user' && 'ml-6 rounded-xl bg-white/[0.05] px-3 py-2')}>
              {m.text && (m.role === 'assistant' ? <MessageResponse>{m.text}</MessageResponse> : <p className="line-clamp-6 whitespace-pre-wrap text-muted-foreground">{m.text}</p>)}
              {m.tools.map((t, j) => {
                const Icon = iconOf(t.tool)
                return (
                  <p key={j} className="mt-1 flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                    <Icon className="size-3 shrink-0 text-violet-300" /><span className="shrink-0 text-foreground/80">{t.tool}</span><span className="truncate">{t.text}</span>
                  </p>
                )
              })}
            </div>
          ))}
          {!live && a.answer && !log?.messages.some(m => m.role === 'assistant' && a.answer?.startsWith(m.text.slice(0, 40))) && (
            <div className="mt-1 rounded-xl border border-emerald-400/15 bg-emerald-400/[0.04] p-3 text-[13px]">
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-emerald-300/80">Respuesta</p>
              <MessageResponse>{a.answer}</MessageResponse>
            </div>
          )}
          {live && a.text && (
            <div className="text-[13px]"><MessageResponse>{a.text}</MessageResponse><span className="ml-0.5 inline-block h-3.5 w-[3px] animate-pulse rounded-full bg-violet-300" /></div>
          )}
          <div ref={end} />
        </div>
      </div>
      <div className="flex items-end gap-2">
        <textarea value={text} onChange={e => setText(e.target.value)} rows={1} placeholder={a.teammate ? `Escribe a ${memberName(a)}…` : live ? 'Escribe al agente…' : 'Retómalo con un mensaje…'}
          className="max-h-28 min-h-11 flex-1 resize-none rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-[14px] outline-none focus:border-violet-400/50" />
        <button type="button" onClick={send} disabled={!text.trim() || sending} aria-label="Enviar"
          className="grid size-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-violet-400 to-violet-600 text-white shadow-lg shadow-violet-500/25 disabled:opacity-40">
          <SendIcon className="size-4" />
        </button>
      </div>
      {live && (
        <button type="button" onClick={async () => {
          try { await api(sessionPath(sid, 'agentStop'), { id: a.id }); toast.warning('Deteniendo el agente…', { description: a.description }) }
          catch (e) { toast.error((e as Error).message) }
        }} className="flex h-10 items-center justify-center gap-2 rounded-xl border border-red-400/30 bg-red-500/10 text-[13.5px] font-medium text-red-300 active:scale-[0.98]">
          <OctagonXIcon className="size-4" />Detener agente
        </button>
      )}
    </motion.div>
  )
}

const TABS: { id: Tab; label: string }[] = [{ id: 'sub', label: 'Subagentes' }, { id: 'wf', label: 'Workflows' }, { id: 'team', label: 'Equipo' }]

// Segmented tabs with a sliding pill; only the tabs that have something.
function Segmented({ tabs, value, onChange, counts, live }: {
  tabs: typeof TABS; value: Tab; onChange: (t: Tab) => void; counts: Record<Tab, number>; live: Record<Tab, boolean>
}) {
  return (
    <div role="tablist" className="flex shrink-0 gap-1 rounded-full border border-white/8 bg-white/[0.03] p-1">
      {tabs.map(t => {
        const on = t.id === value
        return (
          <button key={t.id} type="button" role="tab" aria-selected={on} onClick={() => onChange(t.id)}
            className={cn('relative flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full text-[13px] font-medium transition-colors',
              on ? 'text-foreground' : 'text-muted-foreground')}>
            {on && <motion.span layoutId="agents-tab" className="absolute inset-0 rounded-full bg-white/[0.08] ring-1 ring-violet-400/25"
              transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
            <span className="relative truncate">{t.label}</span>
            {t.id !== 'sub' && counts[t.id] > 0 && (
              <span className={cn('relative grid h-4 min-w-4 place-items-center rounded-full px-1 text-[9.5px] font-bold tabular-nums',
                live[t.id] ? 'bg-violet-400 text-background' : 'bg-white/10 text-muted-foreground')}>{counts[t.id]}</span>
            )}
            {t.id === 'sub' && live.sub && <span className="relative size-1.5 shrink-0 animate-pulse rounded-full bg-violet-300" />}
          </button>
        )
      })}
    </div>
  )
}

export function AgentsSheet({ sid, agents, workflows = [], skew, open, onOpenChange, focus, onFocus, events, onExpand }: {
  onExpand?: (id: string) => void
  sid: string; agents: AgentRow[]; workflows?: WorkflowRun[]; skew: number; open: boolean; onOpenChange: (v: boolean) => void; events: PastorEvent[]
  focus: string | null; onFocus: (id: string | null) => void
}) {
  const [picked, setPicked] = useState<Tab | null>(null)
  // Back from an agent's detail returns to the list before closing the sheet.
  useBackClose(open && !!focus, () => onFocus(null))
  const subs = agents.filter(a => tabOf(a) === 'sub')
  const members = agents.filter(a => tabOf(a) === 'team')
  const ordered = [...subs].sort((x, y) => Number(isLive(y)) - Number(isLive(x)) || y.startedAt - x.startedAt)
  const current = focus ? agents.find(a => a.id === focus) : undefined
  const counts: Record<Tab, number> = { sub: subs.length, wf: workflows.length, team: members.length }
  const live: Record<Tab, boolean> = {
    sub: subs.some(isLive), wf: workflows.some(r => r.status === 'running'), team: members.some(isLive),
  }
  const tabs = TABS.filter(t => counts[t.id] > 0)
  // The picked tab while it has something; else the first with something running, else the first non-empty.
  const tab: Tab = (picked && counts[picked] ? picked : (tabs.find(t => live[t.id]) ?? tabs[0])?.id) ?? 'sub'
  // Back from an agent lands on the tab it belongs to (it may have been opened from the transcript).
  const back = () => { if (current) setPicked(tabOf(current)); onFocus(null) }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-auto bottom-0 flex h-[88dvh] translate-y-0 flex-col rounded-b-none rounded-t-3xl border-white/10 bg-popover/90 pb-[max(env(safe-area-inset-bottom),16px)] backdrop-blur-2xl sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2 sm:rounded-3xl">
        {!current && <DialogHeader><DialogTitle>Agentes</DialogTitle></DialogHeader>}
        {!current && tabs.length > 1 && <Segmented tabs={tabs} value={tab} onChange={setPicked} counts={counts} live={live} />}
        <AnimatePresence mode="wait">
          {current
            ? <AgentDetail key={current.id} sid={sid} a={current} skew={skew} onBack={back} events={events.filter(e => e.agent === current.id)} onExpand={onExpand ? () => onExpand(current.id) : undefined} />
            : (
              <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.16 }} className="-mx-1 flex min-h-0 flex-1 flex-col [&>*]:shrink-0 gap-2.5 overflow-y-auto px-1">
                {tab === 'wf' && <WorkflowsTab runs={workflows} agents={agents} skew={skew} onFocus={onFocus} />}
                {tab === 'team' && <TeamTab members={members} onFocus={onFocus} />}
                {tab === 'sub' && (
                  <>
                    {ordered.map((a, i) => <AgentTile key={a.id} a={a} i={i} skew={skew} onOpen={() => onFocus(a.id)} />)}
                    {!ordered.length && <p className="text-sm text-muted-foreground">Ningún agente en esta sesión.</p>}
                  </>
                )}
              </motion.div>
            )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  )
}
