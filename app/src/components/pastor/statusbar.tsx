import { BotIcon, CoinsIcon, HeartIcon, ListChecksIcon, SquareTerminalIcon, TimerIcon, WorkflowIcon } from 'lucide-react'
import { motion } from 'motion/react'
import { useState, type ReactNode } from 'react'

import { tokens } from '@/lib/format'
import { useNow } from '@/lib/hooks'
import type { ContextPoint, Usage } from '@/lib/types'
import { cn } from '@/lib/utils'

import { ContextSheet, limitLabel, resetTime, until } from './usage'

// glowup's status line for the phone: context as hearts (each 20% of the
// window left), the 5-hour and weekly limits with when they reset, cost,
// turns until auto-compact, and what runs in the background. A tap opens the
// full context sheet.
const tint = (used: number) => used > 0.85 ? 'text-red-400' : used > 0.65 ? 'text-warn' : 'text-coral'
const bar = (used: number) => used > 0.85 ? 'bg-red-400' : used > 0.65 ? 'bg-warn' : 'bg-coral'

function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('flex shrink-0 items-center gap-1.5 rounded-full border border-white/8 bg-white/[0.035] px-2.5 py-1', className)}>{children}</span>
}

export function Hearts({ left, size = 11 }: { left: number; size?: number }) {
  // Five hearts, each 20% of what is left; a partly used one shows half full.
  return (
    <span className="flex items-center gap-[2px]">
      {Array.from({ length: 5 }, (_, i) => {
        const v = Math.max(0, Math.min(1, left * 5 - i))
        return (
          <span key={i} className="relative" style={{ width: size, height: size }}>
            <HeartIcon className="absolute inset-0 text-white/15" style={{ width: size, height: size }} />
            <span className="absolute inset-0 overflow-hidden" style={{ width: `${v * 100}%` }}>
              <HeartIcon className={cn('fill-current', tint(1 - left))} style={{ width: size, height: size }} />
            </span>
          </span>
        )
      })}
    </span>
  )
}

function Limit({ kind, used, resetsAt }: { kind: string; used: number; resetsAt?: string }) {
  useNow(30_000)
  const t = resetTime(resetsAt)
  return (
    <Chip>
      <span className="text-muted-foreground">{limitLabel(kind)}</span>
      <span className="h-1.5 w-9 overflow-hidden rounded-full bg-white/10">
        <motion.span className={cn('block h-full rounded-full', bar(used))} initial={false} animate={{ width: `${Math.round(used * 100)}%` }} />
      </span>
      <span className={tint(used)}>{Math.round(used * 100)}%</span>
      {t && <span className="text-muted-foreground/60">↻ {until(t)}</span>}
    </Chip>
  )
}

export function StatusBar({ usage, history, plan, agents, workflows, tasks }: {
  usage: Usage | null; history: ContextPoint[]; plan?: { done: number; total: number } | null
  agents: number; workflows: number; tasks: number
}) {
  const [open, setOpen] = useState(false)
  if (!usage?.window) return null
  const used = Math.min(1, usage.tokens / usage.window)
  const turnsLeft = usage.autoCompactAt && usage.perTurn && usage.perTurn > 0
    ? Math.max(0, Math.floor((usage.autoCompactAt - usage.tokens) / usage.perTurn)) : null
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Contexto y límites"
        className="scrollbar-none flex w-full gap-1.5 overflow-x-auto px-3 py-1.5 font-mono text-[10.5px]">
        <Chip>
          <Hearts left={1 - used} />
          <span className={tint(used)}>{Math.round(used * 100)}%</span>
          <span className="text-muted-foreground/60">{tokens(usage.tokens)}/{tokens(usage.window)}</span>
        </Chip>
        {turnsLeft != null && <Chip><TimerIcon className="size-3 text-muted-foreground" /><span className="text-muted-foreground">compact ~{turnsLeft} turnos</span></Chip>}
        {(usage.rateLimits ?? []).map(l => <Limit key={l.kind} kind={l.kind} used={Math.min(1, l.percentUsed / 100)} resetsAt={l.resetsAt} />)}
        {usage.cost != null && <Chip><CoinsIcon className="size-3 text-amber-300/80" /><span>${usage.cost.toFixed(2)}</span></Chip>}
        {plan && plan.total > 0 && <Chip><ListChecksIcon className="size-3 text-emerald-400" /><span>{plan.done}/{plan.total}</span></Chip>}
        {agents > 0 && <Chip className="border-violet-400/30 text-violet-300"><BotIcon className="size-3" />{agents}</Chip>}
        {workflows > 0 && <Chip className="border-violet-400/30 text-violet-300"><WorkflowIcon className="size-3" />{workflows}</Chip>}
        {tasks > 0 && <Chip className="border-coral/30 text-coral"><SquareTerminalIcon className="size-3" />{tasks}</Chip>}
      </button>
      <ContextSheet usage={usage} history={history} open={open} onOpenChange={setOpen} />
    </>
  )
}

// The account's limits on the dashboard: the freshest report from any live session.
export function LimitsStrip({ usage }: { usage: Usage | null }) {
  if (!usage?.rateLimits?.length) return null
  return (
    <div className="scrollbar-none flex gap-1.5 overflow-x-auto px-4 pb-2 font-mono text-[10.5px]">
      {usage.rateLimits.map(l => <Limit key={l.kind} kind={l.kind} used={Math.min(1, l.percentUsed / 100)} resetsAt={l.resetsAt} />)}
      {usage.cost != null && <Chip><CoinsIcon className="size-3 text-amber-300/80" /><span className="text-muted-foreground">sesión</span><span>${usage.cost.toFixed(2)}</span></Chip>}
    </div>
  )
}
