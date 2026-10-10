import { ActivityIcon, CircleCheckIcon, CircleXIcon, OctagonXIcon, SquareTerminalIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { dur } from '@/lib/format'
import { useNow } from '@/lib/hooks'
import type { BgTask } from '@/lib/types'
import { cn } from '@/lib/utils'

// The header button: how many shells and monitors run in the background.
export function TasksButton({ tasks, onOpen }: { tasks: BgTask[]; onOpen: () => void }) {
  const running = tasks.filter(t => t.status === 'running').length
  if (!tasks.length) return null
  return (
    <motion.button type="button" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} onClick={onOpen}
      aria-label="Tareas en segundo plano"
      className={cn('relative grid size-9 place-items-center rounded-full border transition-colors',
        running ? 'border-coral/50 bg-coral/10 text-coral' : 'border-white/10 text-muted-foreground')}>
      <SquareTerminalIcon className="size-4" />
      {running > 0 && (
        <span className="absolute -right-0.5 -top-0.5 grid size-4 place-items-center rounded-full bg-coral text-[9.5px] font-bold text-background">
          {running}
        </span>
      )}
    </motion.button>
  )
}

function TaskOutput({ text, live }: { text: string; live: boolean }) {
  const box = useRef<HTMLPreElement>(null)
  useEffect(() => { const el = box.current; if (el) el.scrollTop = el.scrollHeight }, [text])
  return (
    <pre ref={box} className="max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-xl border border-white/8 bg-black/50 p-3 font-mono text-[11px] leading-relaxed text-emerald-100/80">
      {text || <span className="text-muted-foreground">sin salida todavía…</span>}
      {live && <span className="ml-0.5 inline-block h-3 w-1.5 translate-y-0.5 animate-pulse bg-emerald-300/70" />}
    </pre>
  )
}

function TaskCard({ t, skew, onStop }: { t: BgTask; skew: number; onStop: () => void }) {
  const now = useNow(1000)
  const [open, setOpen] = useState(t.status === 'running')
  const running = t.status === 'running'
  const Icon = t.kind === 'monitor' ? ActivityIcon : SquareTerminalIcon
  const Status = t.status === 'completed' ? CircleCheckIcon : t.status === 'running' ? null : t.status === 'killed' ? OctagonXIcon : CircleXIcon
  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className={cn('overflow-hidden rounded-2xl glass', running && 'ring-1 ring-coral/25')}>
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 px-3.5 py-3 text-left">
        <span className={cn('relative grid size-9 shrink-0 place-items-center rounded-xl', running ? 'bg-coral/15' : 'bg-white/[0.05]')}>
          <Icon className={cn('size-4', running ? 'text-coral' : 'text-muted-foreground')} />
          {running && <span className="absolute -right-0.5 -top-0.5 size-2.5 animate-pulse rounded-full bg-coral" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn('block truncate text-[14px] font-medium', running && 'text-shine')}>{t.label}</span>
          <span className="block truncate font-mono text-[11px] text-muted-foreground/80">
            {t.kind === 'monitor' ? 'monitor' : 'shell'} · {running ? dur(now - skew - t.startedAt) || '0s' : `${t.status === 'completed' ? 'terminó' : t.status === 'killed' ? 'detenido' : 'falló'} · ${dur((t.endedAt ?? now) - t.startedAt) || '<1s'}`}
          </span>
        </span>
        {Status && <Status className={cn('size-4 shrink-0', t.status === 'completed' ? 'text-emerald-400' : 'text-red-400')} />}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="flex flex-col gap-2 px-3.5 pb-3.5">
            {t.command && <code className="block truncate font-mono text-[11px] text-muted-foreground">$ {t.command}</code>}
            <TaskOutput text={t.tail} live={running} />
            {running && (
              <button type="button" onClick={onStop}
                className="flex h-10 items-center justify-center gap-2 rounded-xl border border-red-400/30 bg-red-500/10 text-[13.5px] font-medium text-red-300 active:scale-[0.98]">
                <OctagonXIcon className="size-4" />Detener
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

export function TasksSheet({ tasks, skew, open, onOpenChange, onStop }: {
  tasks: BgTask[]; skew: number; open: boolean; onOpenChange: (v: boolean) => void; onStop: (id: string) => void
}) {
  const ordered = [...tasks].sort((a, b) => (a.status === 'running' ? 0 : 1) - (b.status === 'running' ? 0 : 1) || b.startedAt - a.startedAt)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-auto bottom-0 max-h-[85dvh] translate-y-0 overflow-y-auto rounded-b-none rounded-t-3xl border-white/10 bg-popover/90 pb-[max(env(safe-area-inset-bottom),20px)] backdrop-blur-2xl sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2 sm:rounded-3xl">
        <DialogHeader><DialogTitle>En segundo plano</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-2.5">
          {ordered.map(t => <TaskCard key={t.id} t={t} skew={skew} onStop={() => onStop(t.id)} />)}
          {!ordered.length && <p className="text-sm text-muted-foreground">Nada corriendo.</p>}
        </div>
      </DialogContent>
    </Dialog>
  )
}
