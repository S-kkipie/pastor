import {
  BlocksIcon, CheckIcon, CommandIcon, CpuIcon, PlayIcon, PlugIcon, RefreshCwIcon, SearchIcon, Settings2Icon, SparklesIcon,
  TerminalIcon, XIcon,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { api, sessionPath } from '@/lib/api'
import type { CommandMeta, ConfigMeta, SessionMeta } from '@/lib/types'
import { cn } from '@/lib/utils'

import { Skills } from './skills'

const EMPTY: SessionMeta = { model: '', commands: [], config: [], mcp: [], tools: [] }

// The session's commands and settings. While open it re-reads them every few
// seconds (a change made at the PC shows up here too); after a change from
// here, `confirm` waits for the session's next report and says whether it took.
export function useMeta(id: string, open: boolean) {
  const [meta, setMeta] = useState<SessionMeta>(EMPTY)
  const [loading, setLoading] = useState(false)
  const metaRef = useRef(meta)
  metaRef.current = meta
  const fetchMeta = useCallback(() => api<SessionMeta>(sessionPath(id, 'meta')), [id])
  const load = useCallback(async (refresh = false) => {
    setLoading(true)
    try {
      const before = metaRef.current.at ?? 0
      if (refresh) await api(sessionPath(id, 'refresh'), {})
      // A refresh is answered when the session sends a newer report.
      for (let i = 0; i < (refresh ? 12 : 1); i++) {
        const m = await fetchMeta()
        if (!refresh || (m.at ?? 0) > before) { setMeta(m); break }
        await new Promise(r => setTimeout(r, 500))
      }
    } catch { /* keep what we had */ } finally { setLoading(false) }
  }, [id, fetchMeta])
  useEffect(() => { if (open) void load(metaRef.current.commands.length === 0) }, [open, id, load])
  useEffect(() => {
    if (!open) return
    const t = setInterval(() => { void fetchMeta().then(m => { if ((m.at ?? 0) !== (metaRef.current.at ?? 0)) setMeta(m) }, () => {}) }, 3000)
    return () => clearInterval(t)
  }, [open, fetchMeta])
  // Shown at once, then checked against what the session reports back.
  const optimistic = useCallback((key: string, value: unknown) => {
    setMeta(m => ({ ...m, config: m.config.map(r => (r.key === key ? { ...r, value } : r)), ...(key === 'model' ? { model: String(value) } : {}) }))
  }, [])
  const confirm = useCallback(async (key: string, value: unknown, since: number): Promise<boolean | null> => {
    for (let i = 0; i < 16; i++) {
      await new Promise(r => setTimeout(r, 500))
      const m = await fetchMeta().catch(() => null)
      if (m && (m.at ?? 0) > since) {
        setMeta(m)
        const row = m.config.find(r => r.key === key)
        return row ? JSON.stringify(row.value) === JSON.stringify(value) : true
      }
    }
    return null
  }, [fetchMeta])
  return { meta, loading, reload: () => load(true), optimistic, confirm }
}

const SOURCES: Record<string, { label: string; icon: typeof CommandIcon; tint: string }> = {
  builtin: { label: 'Claude Code', icon: TerminalIcon, tint: 'text-coral bg-coral/12' },
  user: { label: 'Tus skills', icon: SparklesIcon, tint: 'text-violet-300 bg-violet-500/12' },
  plugin: { label: 'Plugins', icon: BlocksIcon, tint: 'text-sky-300 bg-sky-500/12' },
  mcp: { label: 'MCP', icon: PlugIcon, tint: 'text-emerald-300 bg-emerald-500/12' },
}

// Fuzzy enough: every word of the query in the name or description.
const matches = (c: CommandMeta, q: string) => {
  const hay = `${c.name} ${c.description}`.toLowerCase()
  return q.toLowerCase().split(/\s+/).filter(Boolean).every(w => hay.includes(w))
}

function CommandRow({ c, onPick }: { c: CommandMeta; onPick: () => void }) {
  const src = SOURCES[c.source] ?? SOURCES.builtin!
  const Icon = src.icon
  return (
    <button type="button" onClick={onPick} className="flex w-full items-start gap-3 rounded-2xl px-2.5 py-2.5 text-left active:bg-white/6">
      <span className={cn('mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl', src.tint)}><Icon className="size-4" /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-[13.5px] text-foreground">/{c.name}</span>
        <span className="line-clamp-2 text-[12px] leading-snug text-muted-foreground">{c.description}</span>
      </span>
    </button>
  )
}

function Commands({ meta, onRun }: { meta: SessionMeta; onRun: (name: string, args: string) => void }) {
  const [q, setQ] = useState('')
  const [source, setSource] = useState<string>('all')
  const [picked, setPicked] = useState<CommandMeta | null>(null)
  const [args, setArgs] = useState('')
  const argBox = useRef<HTMLInputElement>(null)
  const list = useMemo(() => meta.commands.filter(c => (source === 'all' || c.source === source) && matches(c, q)), [meta, q, source])
  const counts = useMemo(() => meta.commands.reduce<Record<string, number>>((a, c) => ({ ...a, [c.source]: (a[c.source] ?? 0) + 1 }), {}), [meta])
  useEffect(() => { if (picked) argBox.current?.focus() }, [picked])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative mb-2">
        <SearchIcon className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={`Buscar en ${meta.commands.length} comandos…`}
          className="h-11 w-full rounded-2xl border border-white/10 bg-white/[0.04] pl-10 pr-3 text-[15px] outline-none focus:border-coral/50" />
      </div>
      <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        {['all', 'builtin', 'user', 'plugin', 'mcp'].filter(k => k === 'all' || counts[k]).map(k => (
          <button key={k} type="button" onClick={() => setSource(k)}
            className={cn('shrink-0 rounded-full border px-3 py-1 text-[12.5px]', source === k ? 'border-coral bg-coral/15 text-coral' : 'border-white/10 text-muted-foreground')}>
            {k === 'all' ? 'Todos' : SOURCES[k]!.label} <span className="opacity-60">{k === 'all' ? meta.commands.length : counts[k]}</span>
          </button>
        ))}
      </div>
      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        {list.slice(0, 200).map(c => <CommandRow key={`${c.source}:${c.name}`} c={c} onPick={() => { setPicked(c); setArgs('') }} />)}
        {!list.length && <p className="py-8 text-center text-sm text-muted-foreground">Nada coincide.</p>}
      </div>
      <AnimatePresence>
        {picked && (
          <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }}
            className="mt-2 rounded-2xl border border-coral/30 bg-coral/[0.06] p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="font-mono text-[14px] font-semibold">/{picked.name}</span>
              <button type="button" onClick={() => setPicked(null)} className="ml-auto text-muted-foreground"><XIcon className="size-4" /></button>
            </div>
            <div className="flex gap-2">
              <input ref={argBox} value={args} onChange={e => setArgs(e.target.value)} placeholder="argumentos (opcional)"
                onKeyDown={e => { if (e.key === 'Enter') { onRun(picked.name, args); setPicked(null) } }}
                className="h-11 min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-3 font-mono text-[14px] outline-none focus:border-coral/50" />
              <button type="button" onClick={() => { onRun(picked.name, args); setPicked(null) }}
                className="flex h-11 items-center gap-1.5 rounded-xl bg-gradient-to-br from-coral to-[oklch(0.62_0.15_35)] px-4 font-semibold text-background">
                <PlayIcon className="size-4 fill-current" />Ejecutar
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function ConfigControl({ row, onSet }: { row: ConfigMeta; onSet: (v: unknown) => void }) {
  const [draft, setDraft] = useState(String(row.value ?? ''))
  useEffect(() => setDraft(String(row.value ?? '')), [row.value])
  if (row.kind === 'boolean') {
    const on = row.value === true
    return (
      <button type="button" disabled={row.isLocked} onClick={() => onSet(!on)} aria-pressed={on}
        className={cn('relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-40', on ? 'bg-coral' : 'bg-white/12')}>
        <motion.span layout className={cn('absolute top-1 size-5 rounded-full bg-white shadow', on ? 'right-1' : 'left-1')} />
      </button>
    )
  }
  if (row.kind === 'choice' && row.options?.length) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {row.options.map(o => (
          <button key={o} type="button" disabled={row.isLocked} onClick={() => onSet(o)}
            className={cn('flex items-center gap-1 rounded-full border px-3 py-1.5 text-[12.5px] disabled:opacity-40',
              row.value === o ? 'border-coral bg-coral/15 text-coral' : 'border-white/10 text-muted-foreground')}>
            {row.value === o && <CheckIcon className="size-3" />}{o}
          </button>
        ))}
      </div>
    )
  }
  return (
    <div className="flex gap-2">
      <input value={draft} onChange={e => setDraft(e.target.value)} disabled={row.isLocked} inputMode={row.kind === 'number' ? 'decimal' : 'text'}
        className="h-10 min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-3 font-mono text-[13px] outline-none focus:border-coral/50" />
      {draft !== String(row.value ?? '') && (
        <button type="button" onClick={() => onSet(row.kind === 'number' ? Number(draft) : draft)} className="rounded-xl bg-coral px-3 text-[13px] font-semibold text-background">Guardar</button>
      )}
    </div>
  )
}

const PINNED = ['model', 'permissionMode', 'thinking', 'outputStyle', 'autoCompact', 'verbose']

function Settings({ meta, onSet }: { meta: SessionMeta; onSet: (key: string, value: unknown) => void }) {
  const [q, setQ] = useState('')
  const rows = useMemo(() => {
    const list = meta.config.filter(r => !q || `${r.key} ${r.label} ${r.description ?? ''}`.toLowerCase().includes(q.toLowerCase()))
    return [...list].sort((a, b) => (PINNED.indexOf(a.key) + 1 || 99) - (PINNED.indexOf(b.key) + 1 || 99))
  }, [meta, q])
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative mb-2">
        <SearchIcon className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={`Buscar en ${meta.config.length} ajustes…`}
          className="h-11 w-full rounded-2xl border border-white/10 bg-white/[0.04] pl-10 pr-3 text-[15px] outline-none focus:border-coral/50" />
      </div>
      <div className="-mx-1 flex min-h-0 flex-1 flex-col [&>*]:shrink-0 gap-1 overflow-y-auto px-1">
        {rows.map(r => (
          <div key={r.key} className={cn('rounded-2xl px-3 py-3', r.key === 'model' ? 'border border-coral/25 bg-coral/[0.05]' : 'bg-white/[0.025]')}>
            <div className={cn('flex gap-3', r.kind === 'boolean' ? 'items-center' : 'flex-col')}>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-[14px] font-medium">
                  {r.key === 'model' && <CpuIcon className="size-4 text-coral" />}{r.label}
                  {r.isLocked && <span className="rounded-full border border-white/10 px-1.5 text-[10px] text-muted-foreground">bloqueado</span>}
                </p>
                {r.description && <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{r.description}</p>}
              </div>
              <ConfigControl row={r} onSet={v => onSet(r.key, v)} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Mcp({ meta, onRun }: { meta: SessionMeta; onRun: (name: string, args: string) => void }) {
  const total = meta.mcp.reduce((a, s) => a + s.tools, 0)
  return (
    <div className="-mx-1 flex min-h-0 flex-1 flex-col [&>*]:shrink-0 overflow-y-auto px-1">
      <p className="mb-2 px-1 text-[12.5px] text-muted-foreground">{meta.mcp.length} servidores conectados · {total} herramientas</p>
      <div className="grid grid-cols-2 gap-2">
        {meta.mcp.map(s => (
          <div key={s.name} className="rounded-2xl bg-white/[0.035] p-3">
            <PlugIcon className="mb-1.5 size-4 text-emerald-300" />
            <p className="truncate text-[13px] font-medium">{s.name.replace(/^claude_ai_/, '').replace(/^plugin_[a-z]+_/, '').replace(/_/g, ' ')}</p>
            <p className="text-[11.5px] text-muted-foreground">{s.tools} herramientas</p>
          </div>
        ))}
      </div>
      <button type="button" onClick={() => onRun('mcp', '')} className="mt-3 rounded-2xl border border-white/10 py-3 text-[13.5px] text-muted-foreground">
        Ejecutar /mcp en la sesión
      </button>
    </div>
  )
}

export function CommandPalette({ id, open, onOpenChange, initialTab = 'commands' }: {
  id: string; open: boolean; onOpenChange: (v: boolean) => void; initialTab?: 'commands' | 'skills' | 'settings' | 'mcp'
}) {
  const { meta, loading, reload, optimistic, confirm } = useMeta(id, open)
  const [tab, setTab] = useState(initialTab)
  useEffect(() => { if (open) setTab(initialTab) }, [open, initialTab])

  const run = async (name: string, args: string) => {
    try {
      await api(sessionPath(id, 'command'), { command: name, args })
      toast.info(`/${name}${args ? ' ' + args : ''}`, { description: 'Se ejecuta en cuanto la sesión esté libre', icon: <TerminalIcon className="size-4" /> })
      onOpenChange(false)
    } catch (e) { toast.error((e as Error).message) }
  }
  const set = async (key: string, value: unknown) => {
    const since = meta.at ?? 0
    const before = meta.config.find(r => r.key === key)?.value
    optimistic(key, value)
    const tid = toast.loading(`${key} → ${String(value)}`, { description: 'Aplicando en la sesión…' })
    try {
      await api(sessionPath(id, 'config'), { key, value })
      const ok = await confirm(key, value, since)
      if (ok) toast.success(`${key} → ${String(value)}`, { id: tid, description: 'Aplicado', icon: <CheckIcon className="size-4" /> })
      else if (ok === false) toast.warning(`${key} no cambió`, { id: tid, description: 'La sesión lo rechazó o lo controla otra configuración' })
      else toast.info(`${key} → ${String(value)}`, { id: tid, description: 'Enviado; se aplica cuando la sesión lo procese' })
    } catch (e) {
      optimistic(key, before)
      toast.error((e as Error).message, { id: tid })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}
        className="top-auto bottom-0 flex h-[88dvh] max-w-none translate-y-0 flex-col gap-3 rounded-b-none rounded-t-3xl border-white/10 bg-popover/92 p-4 pb-[max(env(safe-area-inset-bottom),16px)] backdrop-blur-2xl sm:bottom-auto sm:top-1/2 sm:h-[80dvh] sm:max-w-lg sm:-translate-y-1/2 sm:rounded-3xl">
        <div className="mx-auto h-1 w-10 rounded-full bg-white/15" />
        <div className="flex items-center gap-2">
          <DialogTitle className="text-[17px]">Sesión</DialogTitle>
          {meta.model && <span className="rounded-full border border-coral/30 bg-coral/10 px-2 py-0.5 font-mono text-[11px] text-coral">{meta.model}</span>}
          <button type="button" onClick={() => void reload()} aria-label="Actualizar" className="ml-auto grid size-9 place-items-center rounded-full text-muted-foreground active:bg-white/5">
            <RefreshCwIcon className={cn('size-4', loading && 'animate-spin')} />
          </button>
        </div>
        <div className="relative flex rounded-2xl p-1 glass">
          {([['commands', CommandIcon, 'Comandos'], ['skills', SparklesIcon, 'Skills'], ['settings', Settings2Icon, 'Ajustes'], ['mcp', PlugIcon, 'MCP']] as const).map(([k, Icon, label]) => (
            <button key={k} type="button" onClick={() => setTab(k)}
              className={cn('relative z-10 flex min-w-0 flex-1 items-center justify-center gap-1 py-2 text-[12.5px] font-medium', tab === k ? 'text-foreground' : 'text-muted-foreground')}>
              {tab === k && <motion.span layoutId="ptab" className="absolute inset-0 -z-10 rounded-xl bg-white/10" />}
              <Icon className="size-3.5" />{label}
            </button>
          ))}
        </div>
        {meta.commands.length === 0 && loading ? (
          <p className="text-shine py-10 text-center text-sm">Leyendo la sesión…</p>
        ) : tab === 'commands' ? <Commands meta={meta} onRun={run} />
          : tab === 'skills' ? <Skills meta={meta} onRun={run} />
          : tab === 'settings' ? <Settings meta={meta} onSet={set} />
          : <Mcp meta={meta} onRun={run} />}
      </DialogContent>
    </Dialog>
  )
}

// Inline suggestions while the composer text starts with "/".
export function SlashSuggestions({ id, text, onPick }: { id: string; text: string; onPick: (name: string) => void }) {
  const q = text.startsWith('/') && !text.includes(' ') ? text.slice(1) : null
  const { meta } = useMeta(id, q !== null)
  if (q === null) return null
  const list = meta.commands.filter(c => c.name.toLowerCase().startsWith(q.toLowerCase())).slice(0, 6)
  if (!list.length) return null
  return (
    <div className="mx-3 mb-2 overflow-hidden rounded-2xl border border-white/10 bg-popover/95 p-1 backdrop-blur-2xl">
      {list.map(c => <CommandRow key={`${c.source}:${c.name}`} c={c} onPick={() => onPick(c.name)} />)}
    </div>
  )
}
