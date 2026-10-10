import { CheckIcon, ChevronDownIcon, LoaderCircleIcon, SparklesIcon, XIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'

import { api, sessionPath } from '@/lib/api'
import { useSessionCtx } from '@/lib/ctx'
import type { PastorEvent, SessionMeta } from '@/lib/types'
import { cn } from '@/lib/utils'

// What each session's skills say about themselves, fetched once per session.
const metaCache = new Map<string, Promise<SessionMeta | null>>()
function useSkillDescription(sid: string | undefined, name: string, want: boolean) {
  const [desc, setDesc] = useState<string | null>(null)
  useEffect(() => {
    if (!want || !sid || !name) return
    if (!metaCache.has(sid)) metaCache.set(sid, api<SessionMeta>(sessionPath(sid, 'meta')).catch(() => null))
    void metaCache.get(sid)!.then(m => setDesc(m?.commands.find(c => c.name === name)?.description ?? ''))
  }, [sid, name, want])
  return desc
}

// The skill a call names (live: detail.skill; read back from an old transcript: its JSON input).
export function skillOf(ev: PastorEvent): { skill: string; args: string } {
  if (ev.detail?.skill) return { skill: String(ev.detail.skill), args: String(ev.detail.args ?? '') }
  try {
    const i = JSON.parse(ev.text)
    if (i && typeof i === 'object') return { skill: String(i.skill ?? i.command ?? ''), args: String(i.args ?? '') }
  } catch { /* "name · args" */ }
  const [skill = '', ...rest] = ev.text.split(' · ')
  return { skill, args: rest.join(' · ') }
}

// A skill Claude invoked: its name, where it comes from, what it was asked,
// whether it loaded; a tap shows what the skill is for.
export function SkillCard({ ev }: { ev: PastorEvent }) {
  const ctx = useSessionCtx()
  const [open, setOpen] = useState(false)
  const { skill, args } = skillOf(ev)
  const plugin = skill.includes(':') ? skill.split(':')[0] : ''
  const name = skill.includes(':') ? skill.split(':').slice(1).join(':') : skill
  const state = !ev.end ? 'running' : ev.end.ok ? 'ok' : 'error'
  const desc = useSkillDescription(ctx?.sid, skill, open)
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
      className={cn('relative my-1 overflow-hidden rounded-2xl border bg-gradient-to-br from-violet-500/[0.10] via-violet-500/[0.04] to-coral/[0.06]',
        state === 'error' ? 'border-red-400/30' : 'border-violet-400/25')}>
      <span className="pointer-events-none absolute -left-8 -top-10 size-24 rounded-full bg-violet-500/20 blur-2xl" />
      <button type="button" onClick={() => setOpen(o => !o)} className="relative flex w-full items-center gap-3 px-3 py-2.5 text-left">
        <span className="relative grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-400/40 to-coral/30 text-violet-50 shadow-[0_0_18px_-6px] shadow-violet-400/60">
          <SparklesIcon className={cn('size-4', state === 'running' && 'animate-pulse')} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-violet-300/90">Skill</span>
            {plugin && <span className="truncate rounded-full bg-white/[0.06] px-1.5 font-mono text-[10px] text-muted-foreground">{plugin}</span>}
          </span>
          <span className={cn('block truncate text-[14.5px] font-semibold', state === 'running' && 'text-shine')}>{name || 'skill'}</span>
          {args && <span className="block truncate text-[12px] italic text-muted-foreground">“{args}”</span>}
        </span>
        <span className={cn('flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium',
          state === 'running' ? 'bg-violet-500/15 text-violet-200' : state === 'ok' ? 'bg-emerald-400/12 text-emerald-300' : 'bg-red-500/12 text-red-300')}>
          {state === 'running' ? <><LoaderCircleIcon className="size-3 animate-spin" />cargando</>
            : state === 'ok' ? <><CheckIcon className="size-3" />cargada</> : <><XIcon className="size-3" />falló</>}
        </span>
        <ChevronDownIcon className={cn('size-4 shrink-0 opacity-40 transition-transform', open && 'rotate-180')} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="relative border-t border-violet-400/15 px-3.5 py-2.5 text-[12.5px] leading-snug">
            <p className="text-muted-foreground">{desc === null ? <span className="text-shine">Leyendo la skill…</span> : desc || 'Sin descripción.'}</p>
            {args && <p className="mt-2 rounded-xl bg-black/25 px-3 py-2 whitespace-pre-wrap">{args}</p>}
            {state === 'error' && ev.end?.out && <p className="mt-2 font-mono text-[11.5px] text-red-300">{ev.end.out}</p>}
            <p className="mt-2 font-mono text-[10.5px] text-muted-foreground/60">/{skill}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
