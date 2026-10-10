import { BotIcon, CoinsIcon, FilePenLineIcon, OctagonPauseIcon, TimerIcon, TriangleAlertIcon, WrenchIcon, type LucideIcon } from 'lucide-react'
import { motion } from 'motion/react'
import type { ReactNode } from 'react'

import { dur } from '@/lib/format'
import type { Receipt } from '@/lib/types'
import { cn } from '@/lib/utils'

const Part = ({ icon: Icon, children, className, label }: { icon: LucideIcon; children: ReactNode; className?: string; label: string }) => (
  <span className={cn('flex items-center gap-1', className)} title={label} aria-label={label}>
    <Icon className="size-3" strokeWidth={2.2} />{children}
  </span>
)

const cost = (usd: number) => usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`

// What one turn did, as one quiet line under it: time, tools, edits, errors,
// subagents and cost.
export function ReceiptChip({ receipt: r }: { receipt?: Receipt }) {
  if (!r) return null
  const parts: ReactNode[] = []
  const time = dur(r.durationMs) || (r.durationMs > 0 ? '<1s' : '')
  if (time) parts.push(<Part key="t" icon={TimerIcon} label="Duración">{time}</Part>)
  if (r.tools) parts.push(<Part key="w" icon={WrenchIcon} label="Herramientas">{r.tools}</Part>)
  if (r.edits) parts.push(<Part key="e" icon={FilePenLineIcon} label="Ediciones">{r.edits}</Part>)
  if (r.errors) parts.push(<Part key="x" icon={TriangleAlertIcon} label="Errores" className="text-red-400/90">{r.errors}</Part>)
  if (r.agents) parts.push(<Part key="a" icon={BotIcon} label="Subagentes" className="text-violet-300/80">{r.agents}</Part>)
  if (r.costUsd != null && r.costUsd > 0) parts.push(<Part key="c" icon={CoinsIcon} label="Coste">{cost(r.costUsd)}</Part>)
  if (r.aborted) parts.push(<Part key="i" icon={OctagonPauseIcon} label="Interrumpido" className="text-warn">interrumpido</Part>)
  if (!parts.length) return null
  return (
    <motion.div initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 520, damping: 18 }}
      className="flex justify-center">
      <div className="flex max-w-full flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 rounded-full border border-white/6 bg-white/[0.025] px-3 py-1 font-mono text-[10.5px] text-muted-foreground/70">
        {parts.map((p, i) => (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-muted-foreground/30">·</span>}
            {p}
          </span>
        ))}
      </div>
    </motion.div>
  )
}
