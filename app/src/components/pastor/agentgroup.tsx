import { BotIcon, ChevronDownIcon, CircleCheckIcon, CircleXIcon, CoinsIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'

import { useSessionCtx } from '@/lib/ctx'
import { tokens } from '@/lib/format'
import type { AgentRow, PastorEvent } from '@/lib/types'
import { cn } from '@/lib/utils'

import { iconOf } from './tools'

// A subagent launched in the background answers its Agent call at once with
// this; its real state is its AgentRow.
export const isAsyncLaunch = (ev: PastorEvent) => /"isAsync"\s*:\s*true|async_launched/.test(ev.end?.out ?? '')

const LIVE = new Set(['running', 'pending', 'waiting'])
type Phase = 'running' | 'done' | 'failed' | 'queued'

export function phaseOf(ev: PastorEvent, row?: AgentRow): Phase {
  if (row) return LIVE.has(row.status) ? 'running' : row.status === 'completed' || row.status === 'idle' ? 'done' : 'failed'
  if (!ev.end) return 'running'
  if (isAsyncLaunch(ev)) return 'queued'
  return ev.end.ok ? 'done' : 'failed'
}

function Dot({ phase }: { phase: Phase }) {
  if (phase === 'done') return <CircleCheckIcon className="size-3.5 shrink-0 text-emerald-400" />
  if (phase === 'failed') return <CircleXIcon className="size-3.5 shrink-0 text-red-400" />
  return <span className={cn('size-2 shrink-0 rounded-full', phase === 'running' ? 'animate-pulse bg-violet-300' : 'bg-white/25')} />
}

// Several subagents launched together: one card, one line each, live.
export function AgentGroup({ list }: { list: PastorEvent[] }) {
  const ctx = useSessionCtx()
  const [all, setAll] = useState(false)
  const [open, setOpen] = useState(true)
  const rows = list.map(ev => {
    const row = ctx?.agents.find(a => a.toolUseId === ev.id)
    return { ev, row, phase: phaseOf(ev, row) }
  })
  const running = rows.filter(r => r.phase === 'running' || r.phase === 'queued').length
  const done = rows.filter(r => r.phase === 'done').length
  const failed = rows.filter(r => r.phase === 'failed').length
  const total = rows.reduce((a, r) => a + (r.row?.tokens ?? 0), 0)
  const shown = all ? rows : rows.slice(0, 5)
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
      className={cn('my-1.5 overflow-hidden rounded-2xl glass', running > 0 && 'ring-1 ring-violet-400/25')}>
      <button type="button" onClick={() => setOpen(o => !o)} className="flex w-full items-center gap-3 px-3.5 py-3 text-left">
        <span className="relative grid size-8 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-500/30 to-coral/20">
          <BotIcon className="size-4 text-violet-200" />
          {running > 0 && <span className="absolute -right-0.5 -top-0.5 size-2.5 animate-pulse rounded-full bg-violet-300" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn('block truncate text-[14px] font-medium', running > 0 && 'text-shine')}>{list.length} subagentes</span>
          <span className="block truncate font-mono text-[11px] text-muted-foreground">
            {running > 0 && <span className="text-violet-300">{running} trabajando · </span>}
            {done} terminados{failed ? <span className="text-red-400"> · {failed} fallidos</span> : ''}{total ? ` · ${tokens(total)} tok` : ''}
          </span>
        </span>
        <ChevronDownIcon className={cn('size-4 shrink-0 opacity-50 transition-transform', !open && '-rotate-90')} />
      </button>
      <div className="mx-3.5 mb-2.5 flex h-1 overflow-hidden rounded-full bg-white/8">
        <motion.div className="h-full bg-emerald-400" initial={false} animate={{ width: `${(done / list.length) * 100}%` }} />
        <motion.div className="h-full bg-red-400" initial={false} animate={{ width: `${(failed / list.length) * 100}%` }} />
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="border-t border-white/6">
            {shown.map(({ ev, row, phase }) => {
              const act = phase === 'running' ? row?.activity : null
              const ActIcon = act ? iconOf(act.tool) : null
              return (
                <button key={ev.seq} type="button" disabled={!ctx || !ev.id} onClick={() => ev.id && ctx?.openAgent(ev.id)}
                  className="flex w-full min-w-0 items-center gap-2.5 border-b border-white/5 px-3.5 py-2 text-left last:border-0 active:bg-white/5">
                  <Dot phase={phase} />
                  <span className="min-w-0 flex-1">
                    <span className={cn('block truncate text-[13px]', phase === 'running' && 'text-shine')}>{ev.detail?.description || row?.description || 'Subagente'}</span>
                    <span className="flex min-w-0 items-center gap-1.5 font-mono text-[10.5px] text-muted-foreground/80">
                      <span className="shrink-0 text-violet-300/80">{ev.detail?.type || row?.type || 'agent'}</span>
                      {act && ActIcon ? <><ActIcon className="size-2.5 shrink-0" /><span className="truncate">{act.tool} {act.text}</span></>
                        : phase === 'queued' ? <span>en segundo plano</span> : null}
                    </span>
                  </span>
                  {!!row?.tokens && <span className="flex shrink-0 items-center gap-0.5 font-mono text-[10px] text-muted-foreground/70"><CoinsIcon className="size-2.5" />{tokens(row.tokens)}</span>}
                </button>
              )
            })}
            {rows.length > 5 && (
              <button type="button" onClick={() => setAll(a => !a)} className="w-full py-2 text-[12px] text-violet-300 active:bg-white/5">
                {all ? 'Ver menos' : `Ver los ${rows.length}`}
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
