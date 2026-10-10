import { BlocksIcon, HistoryIcon, PlayIcon, SearchIcon, SparklesIcon, StarIcon, XIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { store } from '@/lib/api'
import type { CommandMeta, SessionMeta } from '@/lib/types'
import { cn } from '@/lib/utils'

// Skills: the person's own (source "user") and the ones plugins bring
// ("plugin:skill"). Cards grouped by where they come from, favourites and the
// last used on top, and a sheet to read one whole and run it with arguments.
const isSkill = (c: CommandMeta) => c.source === 'user' || c.source === 'plugin'
const groupOf = (c: CommandMeta) => (c.source === 'user' ? 'Tus skills' : c.plugin || c.name.split(':')[0] || 'Plugins')
const shortName = (c: CommandMeta) => c.name.includes(':') ? c.name.split(':').slice(1).join(':') : c.name
// A stable hue per group, so each plugin keeps its colour.
const hueOf = (g: string) => (g === 'Tus skills' ? 300 : [...g].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) % 360, 7))

const FAV = 'skills.fav', RECENT = 'skills.recent'

function SkillCard({ c, fav, onPick }: { c: CommandMeta; fav: boolean; onPick: () => void }) {
  const hue = hueOf(groupOf(c))
  return (
    <motion.button type="button" onClick={onPick} whileTap={{ scale: 0.97 }} layout
      className="relative flex min-h-[104px] flex-col gap-1.5 overflow-hidden rounded-2xl border border-white/8 bg-white/[0.03] p-3 text-left">
      <span className="pointer-events-none absolute -right-6 -top-6 size-20 rounded-full blur-2xl" style={{ background: `oklch(0.6 0.15 ${hue} / 0.18)` }} />
      <span className="relative flex items-center gap-2">
        <span className="grid size-7 shrink-0 place-items-center rounded-lg" style={{ background: `oklch(0.6 0.15 ${hue} / 0.2)`, color: `oklch(0.85 0.1 ${hue})` }}>
          <SparklesIcon className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{shortName(c)}</span>
        {fav && <StarIcon className="size-3.5 shrink-0 fill-amber-300 text-amber-300" />}
      </span>
      <span className="relative line-clamp-3 text-[11.5px] leading-snug text-muted-foreground">{c.description || 'Sin descripción'}</span>
    </motion.button>
  )
}

export function Skills({ meta, onRun }: { meta: SessionMeta; onRun: (name: string, args: string) => void }) {
  const [q, setQ] = useState('')
  const [group, setGroup] = useState('all')
  const [picked, setPicked] = useState<CommandMeta | null>(null)
  const [args, setArgs] = useState('')
  const [fav, setFav] = useState<string[]>(() => store.get(FAV, []))
  const [recent, setRecent] = useState<string[]>(() => store.get(RECENT, []))
  const argBox = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { store.set(FAV, fav) }, [fav])
  useEffect(() => { if (picked) setTimeout(() => argBox.current?.focus(), 250) }, [picked])

  const skills = useMemo(() => meta.commands.filter(isSkill), [meta])
  const groups = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of skills) m.set(groupOf(c), (m.get(groupOf(c)) ?? 0) + 1)
    return [...m].sort((a, b) => (a[0] === 'Tus skills' ? -1 : b[0] === 'Tus skills' ? 1 : b[1] - a[1]))
  }, [skills])
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const shown = useMemo(() => skills.filter(c => (group === 'all' || groupOf(c) === group)
    && words.every(w => `${c.name} ${c.description}`.toLowerCase().includes(w))), [skills, group, q])
  const byName = (names: string[]) => names.map(n => skills.find(c => c.name === n)).filter((c): c is CommandMeta => !!c)
  const favs = byName(fav), recents = byName(recent).filter(c => !fav.includes(c.name))
  const run = (c: CommandMeta) => {
    onRun(c.name, args.trim())
    const next = [c.name, ...recent.filter(n => n !== c.name)].slice(0, 6)
    setRecent(next); store.set(RECENT, next)
    setPicked(null)
  }
  const pick = (c: CommandMeta) => { setPicked(c); setArgs('') }
  const plain = !q && group === 'all'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative mb-2">
        <SearchIcon className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={`Buscar en ${skills.length} skills…`}
          className="h-11 w-full rounded-2xl border border-white/10 bg-white/[0.04] pl-10 pr-3 text-[15px] outline-none focus:border-violet-400/50" />
      </div>
      <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        {[['all', skills.length] as const, ...groups].map(([g, n]) => (
          <button key={g} type="button" onClick={() => setGroup(g)}
            className={cn('flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12.5px]',
              group === g ? 'border-violet-400/70 bg-violet-500/15 text-violet-200' : 'border-white/10 text-muted-foreground')}>
            {g === 'all' ? 'Todas' : g === 'Tus skills' ? <><SparklesIcon className="size-3" />Tus skills</> : <><BlocksIcon className="size-3" />{g}</>}
            <span className="opacity-60">{n}</span>
          </button>
        ))}
      </div>
      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {plain && favs.length > 0 && (
          <>
            <p className="mb-1.5 flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-amber-300/80"><StarIcon className="size-3" />Favoritas</p>
            <div className="mb-3 grid grid-cols-2 gap-2">{favs.map(c => <SkillCard key={`f:${c.name}`} c={c} fav onPick={() => pick(c)} />)}</div>
          </>
        )}
        {plain && recents.length > 0 && (
          <>
            <p className="mb-1.5 flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"><HistoryIcon className="size-3" />Recientes</p>
            <div className="mb-3 grid grid-cols-2 gap-2">{recents.map(c => <SkillCard key={`r:${c.name}`} c={c} fav={false} onPick={() => pick(c)} />)}</div>
          </>
        )}
        {plain && (favs.length > 0 || recents.length > 0) && <p className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Todas</p>}
        <div className="grid grid-cols-2 gap-2">
          {shown.slice(0, 240).map(c => <SkillCard key={c.name} c={c} fav={fav.includes(c.name)} onPick={() => pick(c)} />)}
        </div>
        {!shown.length && <p className="py-8 text-center text-sm text-muted-foreground">{skills.length ? 'Ninguna skill coincide.' : 'Esta sesión no tiene skills.'}</p>}
      </div>
      <AnimatePresence>
        {picked && (
          <motion.div initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            className="mt-2 rounded-3xl border border-violet-400/30 bg-violet-500/[0.08] p-3.5 shadow-2xl shadow-violet-500/10">
            <div className="mb-1.5 flex items-start gap-2">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-violet-500/20 text-violet-200"><SparklesIcon className="size-4" /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold">{shortName(picked)}</span>
                <span className="block truncate font-mono text-[11px] text-violet-300/80">/{picked.name} · {groupOf(picked)}</span>
              </span>
              <button type="button" aria-label="Favorita" onClick={() => setFav(f => f.includes(picked.name) ? f.filter(n => n !== picked.name) : [picked.name, ...f])}
                className="grid size-9 place-items-center rounded-full active:bg-white/5">
                <StarIcon className={cn('size-4', fav.includes(picked.name) ? 'fill-amber-300 text-amber-300' : 'text-muted-foreground')} />
              </button>
              <button type="button" aria-label="Cerrar" onClick={() => setPicked(null)} className="grid size-9 place-items-center rounded-full text-muted-foreground active:bg-white/5">
                <XIcon className="size-4" />
              </button>
            </div>
            <p className="mb-2.5 max-h-28 overflow-y-auto text-[12.5px] leading-snug text-muted-foreground">{picked.description || 'Sin descripción'}</p>
            <textarea ref={argBox} value={args} onChange={e => setArgs(e.target.value)} rows={2} placeholder="Qué quieres que haga (opcional)…"
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); run(picked) } }}
              className="mb-2 w-full resize-none rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-[15px] outline-none focus:border-violet-400/50" />
            <button type="button" onClick={() => run(picked)}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-violet-400 to-violet-600 font-semibold text-white shadow-lg shadow-violet-500/25 active:scale-[0.98]">
              <PlayIcon className="size-4 fill-current" />Usar skill
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
