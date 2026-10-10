import { CoinsIcon } from 'lucide-react'
import { motion } from 'motion/react'

import { tokens } from '@/lib/format'
import type { AgentRow } from '@/lib/types'
import { cn } from '@/lib/utils'

import { isDone, isLive } from './agents'
import { Clawd } from './clawd'
import { iconOf } from './tools'

// "name@team" -> "@team".
export const teamOf = (a: AgentRow) => {
  const t = a.teammateId?.split('@')[1]
  return t ? `@${t}` : ''
}
export const memberName = (a: AgentRow) => a.name || a.teammateId?.split('@')[0] || a.description

const memberStatus = (a: AgentRow) => isLive(a) ? 'trabajando' : isDone(a) ? 'terminó' : 'en espera'

function MemberCard({ a, onOpen, i }: { a: AgentRow; onOpen: () => void; i: number }) {
  const live = isLive(a)
  const done = isDone(a)
  const ActIcon = a.activity ? iconOf(a.activity.tool) : null
  const last = (live ? a.text : a.answer || a.text) ?? ''
  return (
    <motion.button type="button" layout onClick={onOpen} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay: i * 0.04 }} whileTap={{ scale: 0.985 }}
      className={cn('relative w-full overflow-hidden rounded-2xl p-3.5 text-left glass', live && 'ring-1 ring-violet-400/30')}>
      {live && <div className="pointer-events-none absolute -right-8 -top-8 size-24 rounded-full bg-violet-500/15 blur-2xl" />}
      <div className="relative flex items-start gap-3">
        <span className="relative grid size-10 shrink-0 place-items-center rounded-xl bg-white/[0.04]">
          <Clawd mood={live ? (a.activity ? 'working' : 'pant') : done ? (a.status === 'completed' ? 'done' : 'fail') : 'sleep'} size={34} />
          <span className={cn('absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-popover',
            live ? 'animate-pulse bg-violet-400' : done ? 'bg-white/25' : 'bg-amber-300/80')} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className={cn('truncate text-[14.5px] font-semibold', live && 'text-shine')}>{memberName(a)}</span>
            {teamOf(a) && <span className="shrink-0 font-mono text-[11px] text-muted-foreground/70">{teamOf(a)}</span>}
          </span>
          <span className="flex flex-wrap items-center gap-x-2 font-mono text-[10.5px] text-muted-foreground/80">
            <span className={cn(live ? 'text-violet-300' : done ? '' : 'text-amber-200/80')}>{memberStatus(a)}</span>
            {a.type && <span>{a.type}</span>}
            {a.tokens > 0 && <span className="flex items-center gap-0.5"><CoinsIcon className="size-2.5" />{tokens(a.tokens)}</span>}
          </span>
          {live && a.activity && ActIcon && (
            <span className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[12px]">
              <ActIcon className="size-3 shrink-0 text-violet-300" /><span className="shrink-0">{a.activity.tool}</span>
              <span className="truncate font-mono text-[11px] text-muted-foreground">{a.activity.text}</span>
            </span>
          )}
          {last && <span className="mt-1 line-clamp-2 text-[12.5px] text-muted-foreground">{last.slice(-240)}</span>}
        </span>
      </div>
    </motion.button>
  )
}

export function TeamTab({ members, onFocus }: { members: AgentRow[]; onFocus: (id: string) => void }) {
  const rank = (a: AgentRow) => isLive(a) ? 0 : isDone(a) ? 2 : 1
  const ordered = [...members].sort((x, y) => rank(x) - rank(y) || memberName(x).localeCompare(memberName(y)))
  return (
    <>
      {ordered.map((a, i) => <MemberCard key={a.id} a={a} i={i} onOpen={() => onFocus(a.id)} />)}
      {!ordered.length && <p className="text-sm text-muted-foreground">Nadie en el equipo.</p>}
    </>
  )
}
