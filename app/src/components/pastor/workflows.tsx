import {
  ChevronDownIcon, CircleCheckIcon, CircleDashedIcon, CircleXIcon, CoinsIcon, LoaderIcon, OctagonXIcon, PauseCircleIcon, WorkflowIcon,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'

import { MessageResponse } from '@/components/ai-elements/message'
import { dur, tokens } from '@/lib/format'
import { useNow } from '@/lib/hooks'
import type { AgentRow, WorkflowRun } from '@/lib/types'
import { cn } from '@/lib/utils'

import { isDone, isLive } from './agents'
import { Clawd } from './clawd'
import { iconOf } from './tools'

const RUN_STATUS: Record<WorkflowRun['status'], string> = { running: 'corriendo', completed: 'terminó', failed: 'falló', killed: 'detenido' }

function RunClock({ r, skew }: { r: WorkflowRun; skew: number }) {
  const now = useNow(1000)
  return <>{dur((r.endedAt ?? now - skew) - r.startedAt) || '0s'}</>
}

function StatusIcon({ a }: { a: AgentRow }) {
  if (a.status === 'running') return <LoaderIcon className="size-3.5 shrink-0 animate-spin text-violet-300" />
  if (a.status === 'pending') return <CircleDashedIcon className="size-3.5 shrink-0 animate-pulse text-violet-300/70" />
  if (a.status === 'completed') return <CircleCheckIcon className="size-3.5 shrink-0 text-emerald-400" />
  if (a.status === 'killed') return <OctagonXIcon className="size-3.5 shrink-0 text-red-400" />
  if (a.status === 'failed') return <CircleXIcon className="size-3.5 shrink-0 text-red-400" />
  return <PauseCircleIcon className="size-3.5 shrink-0 text-muted-foreground" />
}

// One agent of a run, compact: index, what it does, how it is, what it is doing now.
function RunAgentRow({ a, onOpen }: { a: AgentRow; onOpen: () => void }) {
  const live = isLive(a)
  const ActIcon = a.activity ? iconOf(a.activity.tool) : null
  return (
    <motion.button type="button" layout onClick={onOpen} whileTap={{ scale: 0.985 }}
      className={cn('flex w-full min-w-0 items-center gap-2.5 rounded-xl px-2.5 py-2 text-left active:bg-white/[0.05]', live && 'bg-violet-500/[0.06]')}>
      <span className="w-5 shrink-0 text-right font-mono text-[10.5px] tabular-nums text-muted-foreground/70">{a.workflowIndex ?? '·'}</span>
      <StatusIcon a={a} />
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate text-[13px]', live ? 'text-foreground' : 'text-foreground/80')}>{a.description}</span>
        {live && a.activity && ActIcon && (
          <span className="flex min-w-0 items-center gap-1 font-mono text-[10.5px] text-muted-foreground">
            <ActIcon className="size-2.5 shrink-0 text-violet-300" /><span className="shrink-0 text-foreground/70">{a.activity.tool}</span>
            <span className="truncate">{a.activity.text}</span>
          </span>
        )}
      </span>
      {a.tokens > 0 && (
        <span className="flex shrink-0 items-center gap-0.5 font-mono text-[10px] tabular-nums text-muted-foreground/80">
          <CoinsIcon className="size-2.5" />{tokens(a.tokens)}
        </span>
      )}
    </motion.button>
  )
}

function RunCard({ r, agents, skew, onFocus, i }: { r: WorkflowRun; agents: AgentRow[]; skew: number; onFocus: (id: string) => void; i: number }) {
  const [showResult, setShowResult] = useState(false)
  const running = r.status === 'running'
  const members = agents.filter(a => a.workflowRunId === r.runId)
    .sort((x, y) => (x.workflowIndex ?? 1e9) - (y.workflowIndex ?? 1e9) || x.startedAt - y.startedAt)
  const done = members.filter(isDone).length
  const total = Math.max(r.agents, members.length)
  const pct = total ? Math.round((done / total) * 100) : r.status === 'completed' ? 100 : 0
  const mood = running ? 'juggle' : r.status === 'completed' ? 'done' : 'fail'
  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
      className={cn('relative overflow-hidden rounded-2xl p-3.5 glass', running && 'ring-1 ring-violet-400/30')}>
      {running && <div className="pointer-events-none absolute -left-10 -top-10 size-28 rounded-full bg-coral/12 blur-2xl" />}
      {running && <div className="pointer-events-none absolute -right-8 -top-8 size-24 rounded-full bg-violet-500/15 blur-2xl" />}
      <div className="relative flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/[0.04]">
          <Clawd mood={mood} size={34} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <WorkflowIcon className="size-3.5 shrink-0 text-violet-300" />
            <span className={cn('truncate text-[14.5px] font-medium', running && 'text-shine')}>{r.name}</span>
          </span>
          {r.description && <span className="mt-0.5 line-clamp-2 block text-[12.5px] text-muted-foreground">{r.description}</span>}
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10.5px] text-muted-foreground/80">
            <span className={cn('rounded-full px-1.5 py-px font-sans text-[10.5px] font-medium',
              running ? 'bg-violet-500/15 text-violet-200'
                : r.status === 'completed' ? 'bg-emerald-400/12 text-emerald-300' : 'bg-red-500/12 text-red-300')}>
              {RUN_STATUS[r.status]}
            </span>
            <span className="tabular-nums"><RunClock r={r} skew={skew} /></span>
            <span className="tabular-nums">{done}/{total} agentes</span>
          </span>
        </span>
      </div>

      {r.phases.length > 0 && (
        <div className="relative mt-2.5 flex flex-wrap gap-1">
          {r.phases.map((p, j) => {
            const current = running && j === r.phases.length - 1
            return (
              <span key={`${p}-${j}`} className={cn('rounded-full border px-2 py-0.5 text-[10.5px]',
                current ? 'border-violet-400/40 bg-violet-500/12 text-violet-200' : 'border-white/8 bg-white/[0.03] text-muted-foreground')}>
                {current && <span className="mr-1 inline-block size-1.5 animate-pulse rounded-full bg-violet-300 align-middle" />}{p}
              </span>
            )
          })}
        </div>
      )}

      <div className="relative mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
        <motion.div className={cn('h-full rounded-full', r.status === 'failed' || r.status === 'killed'
          ? 'bg-red-400/70' : 'bg-gradient-to-r from-coral to-violet-400')}
          initial={false} animate={{ width: `${pct}%` }} transition={{ type: 'spring', stiffness: 120, damping: 20 }} />
      </div>

      {members.length > 0 && (
        <div className="relative -mx-1 mt-2 flex flex-col">
          {members.map(a => <RunAgentRow key={a.id} a={a} onOpen={() => onFocus(a.id)} />)}
        </div>
      )}

      {!running && r.result && (
        <div className="relative mt-2 rounded-xl border border-emerald-400/15 bg-emerald-400/[0.04]">
          <button type="button" onClick={() => setShowResult(!showResult)}
            className="flex w-full items-center justify-between px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-emerald-300/80">
            Resultado
            <ChevronDownIcon className={cn('size-3.5 transition-transform', showResult && 'rotate-180')} />
          </button>
          <AnimatePresence initial={false}>
            {showResult && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden">
                <div className="px-3 pb-3 text-[13px]"><MessageResponse>{r.result}</MessageResponse></div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </motion.div>
  )
}

export function WorkflowsTab({ runs, agents, skew, onFocus }: { runs: WorkflowRun[]; agents: AgentRow[]; skew: number; onFocus: (id: string) => void }) {
  const ordered = [...runs].sort((x, y) => y.startedAt - x.startedAt)
  return (
    <>
      {ordered.map((r, i) => <RunCard key={r.runId} r={r} i={i} agents={agents} skew={skew} onFocus={onFocus} />)}
      {!ordered.length && <p className="text-sm text-muted-foreground">Ningún workflow en esta sesión.</p>}
    </>
  )
}
