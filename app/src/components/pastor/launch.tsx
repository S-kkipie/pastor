import {
  ChevronLeftIcon, ChevronRightIcon, CompassIcon, FolderIcon, FolderOpenIcon, FolderPlusIcon, GitBranchIcon, GitForkIcon,
  HistoryIcon, LoaderIcon, MessageSquareIcon, MonitorIcon, PinIcon, PinOffIcon, PlayIcon, PlusIcon, ScrollTextIcon,
  BuildingIcon, GlobeIcon, LinkIcon, LockIcon, SearchIcon, ShieldCheckIcon, ShieldIcon, ShieldOffIcon, SmartphoneIcon, SquareTerminalIcon, TagIcon, TreesIcon, UserIcon, XIcon,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'

import { Explorer } from '@/components/pastor/explorer'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api, store } from '@/lib/api'
import { ago, shortPath } from '@/lib/format'
import { projectPin, useLongPress, usePins } from '@/lib/pins'
import type { FsList, LaunchBody, Project, ProjectSession, ProjectSessionsPayload, ProjectsPayload } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useBackClose } from '@/lib/back'

type Pick = { path: string; name: string; branch: string | null; running?: number; trusted?: boolean }
type PermMode = NonNullable<LaunchBody['permissionMode']>
type Opts = { trust: boolean; away: boolean; permissionMode?: PermMode }
const PERM_MODES: { key: PermMode; label: string; hint: string }[] = [
  { key: 'default', label: 'Normal', hint: 'Pide permiso para cada herramienta' },
  { key: 'acceptEdits', label: 'Ediciones', hint: 'Acepta las ediciones de archivos sin preguntar' },
  { key: 'plan', label: 'Plan', hint: 'Solo planifica: no edita ni ejecuta hasta que apruebes' },
  { key: 'bypassPermissions', label: 'Sin permisos', hint: '--dangerously-skip-permissions: ejecuta todo sin preguntar' },
]
type Step = { kind: 'list' } | { kind: 'project'; p: Pick } | { kind: 'mkdir' } | { kind: 'clone' }

const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p
const sepOf = (p: string) => (/^[a-z]:/i.test(p) || (p.includes('\\') && !p.startsWith('/')) ? '\\' : '/')
const joinPath = (dir: string, name: string) => {
  const sep = sepOf(dir)
  return dir.endsWith(sep) || dir.endsWith('/') ? dir + name : dir + sep + name
}
const repoName = (url: string) => url.trim().replace(/[#?].*$/, '').replace(/\/+$/, '').replace(/\.git$/i, '').split(/[/:]/).filter(Boolean).pop() ?? ''
const primary = 'flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-coral to-[oklch(0.62_0.15_35)] font-semibold text-background shadow-lg shadow-coral/25 disabled:opacity-50'
const field = 'flex items-center gap-2 rounded-2xl border border-white/8 bg-white/[0.04] px-3 focus-within:border-coral/50'
const spring = { type: 'spring', stiffness: 380, damping: 34 } as const

// The launcher: PC → project → that project's view (new session, continue the
// last one, resume or read any past conversation). New folders and clones too.
export function LaunchSheet({ open, onOpenChange, onOpenSession }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onOpenSession: (id: string) => void
}) {
  const [machines, setMachines] = useState<string[]>([])
  const [machine, setMachine] = useState(() => store.get('launch.machine', ''))
  const [hub, setHub] = useState('')
  const [data, setData] = useState<ProjectsPayload | null>(null)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [step, setStep] = useState<Step>({ kind: 'list' })
  const [dir, setDirection] = useState(1)
  const [browse, setBrowse] = useState<null | 'project' | 'clone'>(null)
  const [cloneParent, setCloneParent] = useState('')
  const [busy, setBusy] = useState(false)
  // Which launch is running ('new', 'continue' or a session id): its control shows the spinner.
  const [pending, setPending] = useState<string | null>(null)
  const pins = usePins('projects')
  // Nobody is at the PC's terminal when the phone opens a session: its dialogs come here.
  const [opts, setOpts] = useState<Opts>(() => store.get('launch.opts', { trust: true, away: true }))
  useEffect(() => { store.set('launch.opts', opts) }, [opts])

  useEffect(() => {
    if (!open) return
    setQ(''); setStep({ kind: 'list' })
    api<{ machines: string[]; machine: string }>('/api/recent').then(d => {
      setMachines(d.machines)
      setMachine(m => d.machines.includes(m) ? m : d.machine)
    }, () => {})
    api<{ machine: string }>('/api/info').then(d => setHub(d.machine), () => {})
  }, [open])
  useEffect(() => {
    if (!open || !machine) return
    store.set('launch.machine', machine)
    setData(null); setErr(''); setStep({ kind: 'list' })
    api<ProjectsPayload>(`/api/projects?machine=${encodeURIComponent(machine)}`).then(setData, e => setErr((e as Error).message))
  }, [open, machine])
  // Where repos were last cloned on this PC, else its home.
  useEffect(() => { if (data?.home) setCloneParent(store.get(`clone.parent.${machine}`, '') || data.home) }, [data?.home, machine])

  const shown = useMemo(() => {
    const n = q.trim().toLowerCase()
    return (data?.projects ?? [])
      .filter(p => !n || p.name.toLowerCase().includes(n) || p.path.toLowerCase().includes(n))
      .map((p, i) => ({ p, i, pinned: pins.has(projectPin(machine, p.path)) }))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.i - b.i)
  }, [data, q, pins, machine])

  const go = (s: Step, d = 1) => { setDirection(d); setStep(s) }
  const back = () => go({ kind: 'list' }, -1)
  // Back inside the launcher returns to the project list first.
  useBackClose(open && step.kind !== 'list', back)
  // A live session's id as the dashboard knows it (peers' ids carry their PC).
  const liveId = (id: string) => (!hub || machine === hub ? id : `${machine}~${id}`)
  const openSession = (id: string) => { onOpenChange(false); onOpenSession(liveId(id)) }

  const launch = async (body: LaunchBody, done: string, loading?: string, key = 'new') => {
    setBusy(true); setPending(key)
    const tid = loading ? toast.loading(loading, { description: body.cwd }) : undefined
    try {
      await api('/api/launch', { ...body, trust: opts.trust, away: opts.away, permissionMode: opts.permissionMode ?? 'default' })
      onOpenChange(false)
      toast.success(done, { id: tid, description: body.cwd, icon: <SquareTerminalIcon className="size-4 text-coral" /> })
    } catch (e) {
      toast.error((e as Error).message, { id: tid })
    } finally { setBusy(false); setPending(null) }
  }

  const title = step.kind === 'project' ? step.p.name : step.kind === 'mkdir' ? 'Nueva carpeta' : step.kind === 'clone' ? 'Clonar repo' : 'Nueva sesión'

  return (
    <>
      <Dialog open={open && !browse} onOpenChange={onOpenChange}>
        <DialogContent className="top-auto bottom-0 flex h-[min(88dvh,780px)] translate-y-0 flex-col gap-3 overflow-hidden rounded-b-none rounded-t-3xl border-white/10 bg-popover/90 pb-[max(env(safe-area-inset-bottom),20px)] backdrop-blur-2xl sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2 sm:rounded-3xl">
          <DialogHeader className="flex-row items-center gap-2 pr-8">
            <AnimatePresence initial={false}>
              {step.kind !== 'list' && (
                <motion.button key="back" type="button" onClick={back} aria-label="Volver"
                  initial={{ opacity: 0, width: 0 }} animate={{ opacity: 1, width: 32 }} exit={{ opacity: 0, width: 0 }}
                  className="-ml-1 grid size-8 shrink-0 place-items-center rounded-full active:bg-white/5">
                  <ChevronLeftIcon className="size-5" />
                </motion.button>
              )}
            </AnimatePresence>
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate text-[16px] font-semibold">{title}</DialogTitle>
              <DialogDescription className="truncate font-mono text-[11px] text-muted-foreground">
                {machine || 'PC'}{step.kind === 'project' && ` · ${shortPath(step.p.path)}`}
              </DialogDescription>
            </div>
          </DialogHeader>

          {step.kind === 'list' && machines.length > 1 && (
            <div className="scrollbar-none -mx-1 flex shrink-0 gap-2 overflow-x-auto px-1">
              {machines.map(m => (
                <motion.button key={m} type="button" onClick={() => setMachine(m)} whileTap={{ scale: 0.95 }}
                  className={cn('relative flex h-11 shrink-0 items-center gap-2 rounded-2xl border px-4 font-mono text-[13.5px] transition-colors',
                    m === machine ? 'border-coral/70 text-coral' : 'border-white/10 text-muted-foreground')}>
                  {m === machine && <motion.span layoutId="launch-pc" className="absolute inset-0 -z-10 rounded-2xl bg-coral/15" transition={spring} />}
                  <MonitorIcon className="size-4" />{m}
                </motion.button>
              ))}
            </div>
          )}

          <div className="relative -mx-1 min-h-0 flex-1">
            <AnimatePresence initial={false} custom={dir}>
              <motion.div key={step.kind === 'project' ? `p:${step.p.path}` : step.kind}
                custom={dir}
                initial={{ opacity: 0, x: dir * 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: dir * -40 }}
                transition={spring}
                className="absolute inset-0 flex flex-col [&>*]:shrink-0 gap-3 overflow-y-auto px-1 pb-2">
                {step.kind === 'list' && (
                  <ProjectList machine={machine} data={data} err={err} q={q} setQ={setQ} shown={shown}
                    onPick={p => go({ kind: 'project', p })}
                    onTogglePin={p => {
                      const on = pins.toggle(projectPin(machine, p.path))
                      toast.success(on ? 'Proyecto fijado' : 'Proyecto desfijado', { description: p.name, icon: on ? <PinIcon className="size-4 text-coral" /> : <PinOffIcon className="size-4" /> })
                    }}
                    onBrowse={() => setBrowse('project')}
                    onMkdir={() => go({ kind: 'mkdir' })}
                    onClone={() => go({ kind: 'clone' })} />
                )}
                {step.kind === 'project' && (
                  <ProjectView machine={machine} p={step.p} busy={busy} pending={pending} opts={opts} setOpts={setOpts}
                    onLaunch={(body, done, loading, key) => void launch({ machine, cwd: step.p.path, ...body }, done, loading, key)}
                    onOpen={openSession}
                    onHistory={id => openSession(id)} />
                )}
                {step.kind === 'mkdir' && (
                  <MkdirView home={data?.home ?? ''} roots={data?.roots ?? []} busy={busy} options={<LaunchOptions trusted={false} opts={opts} setOpts={setOpts} />}
                    onCreate={cwd => void launch({ machine, cwd, mkdir: true, mode: 'new' }, `Carpeta creada · abriendo Claude Code en ${machine}`)} />
                )}
                {step.kind === 'clone' && (
                  <CloneView machine={machine} parent={cloneParent} busy={busy} onBrowse={() => setBrowse('clone')} options={<LaunchOptions trusted={false} opts={opts} setOpts={setOpts} />}
                    onClone={(repo, cwd) => void launch({ machine, cwd, clone: repo, mode: 'new' }, `Repo clonado · abriendo Claude Code en ${machine}`, `Clonando ${repoName(repo)}…`)} />
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </DialogContent>
      </Dialog>
      <Explorer machine={machine} root={browse === 'clone' ? cloneParent || data?.home || '' : data?.home ?? ''} open={!!browse} pickFolder
        onClose={() => setBrowse(null)}
        onPick={d => {
          if (browse === 'clone') { setCloneParent(d); store.set(`clone.parent.${machine}`, d) }
          else {
            const known = data?.projects.find(p => p.path === d)
            go({ kind: 'project', p: known ?? { path: d, name: baseName(d), branch: null } })
          }
          setBrowse(null)
        }} />
    </>
  )
}

function SectionLabel({ icon: Icon, children, right }: { icon: typeof FolderIcon; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mt-1 flex items-center gap-2 px-1">
      <Icon className="size-3.5 text-coral" />
      <span className="text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</span>
      {right && <span className="ml-auto font-mono text-[11px] text-muted-foreground/60">{right}</span>}
    </div>
  )
}

function ProjectList({ machine, data, err, q, setQ, shown, onPick, onTogglePin, onBrowse, onMkdir, onClone }: {
  machine: string; data: ProjectsPayload | null; err: string; q: string; setQ: (v: string) => void
  shown: { p: Project; pinned: boolean }[]
  onPick: (p: Pick) => void; onTogglePin: (p: Project) => void
  onBrowse: () => void; onMkdir: () => void; onClone: () => void
}) {
  return (
    <>
      <label className={cn(field, 'shrink-0')}>
        <SearchIcon className="size-4 text-muted-foreground" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar proyecto…" className="h-10 min-w-0 flex-1 bg-transparent text-[16px] outline-none sm:text-[14px]" />
        {q && <button type="button" onClick={() => setQ('')} aria-label="Limpiar"><XIcon className="size-4 text-muted-foreground" /></button>}
      </label>
      <div className="grid shrink-0 grid-cols-3 gap-2">
        {([
          [CompassIcon, 'Explorar', onBrowse],
          [FolderPlusIcon, 'Nueva carpeta', onMkdir],
          [GitForkIcon, 'Clonar repo', onClone],
        ] as const).map(([Icon, label, fn]) => (
          <motion.button key={label} type="button" onClick={fn} disabled={!data} whileTap={{ scale: 0.95 }}
            className="flex flex-col items-center gap-1.5 rounded-2xl border border-white/8 bg-white/[0.03] px-2 py-3 text-[12px] text-muted-foreground active:bg-white/5 disabled:opacity-40">
            <span className="grid size-8 place-items-center rounded-xl bg-coral/12 text-coral"><Icon className="size-4" /></span>
            {label}…
          </motion.button>
        ))}
      </div>
      {!data && !err && <p className="text-shine px-1 py-2 text-sm">Leyendo proyectos de {machine}…</p>}
      {err && <p className="px-1 py-2 text-sm text-red-400">{err}</p>}
      {data && <SectionLabel icon={FolderIcon} right={`${shown.length}`}>Proyectos recientes</SectionLabel>}
      <motion.div layout className="flex flex-col gap-1.5">
        {shown.map(({ p, pinned }, i) => (
          <ProjectRow key={p.path} p={p} i={i} pinned={pinned} onPick={() => onPick(p)} onTogglePin={() => onTogglePin(p)} />
        ))}
        {data && shown.length === 0 && <p className="py-3 text-center text-sm text-muted-foreground">Ningún proyecto coincide.</p>}
      </motion.div>
      {data && shown.length > 0 && <p className="px-1 pt-1 text-center text-[11px] text-muted-foreground/50">Mantén pulsado un proyecto para fijarlo arriba</p>}
    </>
  )
}

function ProjectRow({ p, i, pinned, onPick, onTogglePin }: { p: Project; i: number; pinned: boolean; onPick: () => void; onTogglePin: () => void }) {
  const press = useLongPress(onTogglePin, onPick)
  return (
    <motion.button type="button" layout {...press}
      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 12) * 0.025, ...spring }}
      whileTap={{ scale: 0.985 }}
      className={cn('flex select-none items-center gap-3 rounded-2xl border px-3 py-2.5 text-left [-webkit-touch-callout:none]',
        pinned ? 'border-coral/30 bg-coral/[0.06]' : 'border-white/6 bg-white/[0.03]')}>
      <span className={cn('grid size-9 shrink-0 place-items-center rounded-xl', pinned ? 'bg-coral/20 text-coral' : 'bg-white/[0.05] text-muted-foreground')}>
        {pinned ? <PinIcon className="size-4" /> : <FolderIcon className="size-4" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[14.5px] font-medium">{p.name}</span>
          {p.running > 0 && <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-400/12 px-1.5 text-[10.5px] text-emerald-400"><span className="size-1.5 rounded-full bg-emerald-400" />{p.running}</span>}
        </span>
        <span className="flex items-center gap-1.5 truncate font-mono text-[11px] text-muted-foreground/70">
          {p.branch && <><GitBranchIcon className="size-3 shrink-0" /><span className="max-w-24 truncate">{p.branch}</span><span>·</span></>}
          <span className="truncate">{shortPath(p.path)}</span>
        </span>
      </span>
      <span className="shrink-0 text-right font-mono text-[10.5px] text-muted-foreground/60">
        {p.lastUsed ? ago(p.lastUsed) : ''}{p.sessions ? <span className="block">{p.sessions} conv.</span> : null}
      </span>
      <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground/40" />
    </motion.button>
  )
}

// What would otherwise wait for someone at the PC: the folder-trust dialog
// (before Claude Code loads anything) and every permission or workflow ask.
function LaunchOptions({ trusted, opts, setOpts }: { trusted: boolean | null; opts: Opts; setOpts: (o: Opts) => void }) {
  const row = 'flex items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2.5 text-left active:bg-white/5'
  const mode = opts.permissionMode ?? 'default'
  const danger = mode === 'bypassPermissions'
  return (
    <div className="flex flex-col gap-2">
      <div className={cn('rounded-2xl border px-3 py-2.5', danger ? 'border-red-400/40 bg-red-500/[0.07]' : 'border-white/8 bg-white/[0.03]')}>
        <p className="mb-2 flex items-center gap-1.5 text-[13.5px] font-medium">
          {danger ? <ShieldOffIcon className="size-4 text-red-400" /> : <ShieldIcon className="size-4 text-coral" />}Permisos
        </p>
        <div className="grid grid-cols-4 gap-1">
          {PERM_MODES.map(m => (
            <button key={m.key} type="button" onClick={() => setOpts({ ...opts, permissionMode: m.key })}
              className={cn('rounded-xl border px-1 py-1.5 text-[11.5px] leading-tight transition-colors',
                mode === m.key
                  ? (m.key === 'bypassPermissions' ? 'border-red-400/70 bg-red-500/20 text-red-200' : 'border-coral/60 bg-coral/15 text-coral')
                  : 'border-white/10 text-muted-foreground')}>
              {m.label}
            </button>
          ))}
        </div>
        <p className={cn('mt-1.5 text-[11.5px] leading-snug', danger ? 'text-red-300' : 'text-muted-foreground')}>
          {PERM_MODES.find(m => m.key === mode)?.hint}{danger ? '. Úsalo solo en carpetas en las que confíes.' : ''}
        </p>
      </div>
      <button type="button" onClick={() => setOpts({ ...opts, away: !opts.away })} className={row}>
        <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-coral/12 text-coral"><SmartphoneIcon className="size-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-medium">Responder desde el móvil</span>
          <span className="block text-[11.5px] leading-snug text-muted-foreground">Permisos, preguntas y workflows llegan aquí (modo fuera)</span>
        </span>
        <Toggle on={opts.away} />
      </button>
      {trusted === false && (
        <button type="button" onClick={() => setOpts({ ...opts, trust: !opts.trust })} className={row}>
          <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-emerald-400/12 text-emerald-300"><ShieldCheckIcon className="size-4" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13.5px] font-medium">Confiar en esta carpeta</span>
            <span className="block text-[11.5px] leading-snug text-muted-foreground">Claude Code pregunta en la PC si confías en una carpeta nueva; esto lo responde desde aquí</span>
          </span>
          <Toggle on={opts.trust} />
        </button>
      )}
    </div>
  )
}

function Toggle({ on }: { on: boolean }) {
  return (
    <span className={cn('relative h-6 w-10 shrink-0 rounded-full transition-colors', on ? 'bg-coral' : 'bg-white/12')}>
      <motion.span layout transition={spring} className={cn('absolute top-0.5 size-5 rounded-full bg-white shadow', on ? 'right-0.5' : 'left-0.5')} />
    </span>
  )
}

// One project: start fresh, pick up the last conversation, or any earlier one.
function ProjectView({ machine, p, busy, pending, onLaunch, onOpen, onHistory, opts, setOpts }: {
  machine: string; p: Pick; busy: boolean; pending: string | null; opts: Opts; setOpts: (o: Opts) => void
  onLaunch: (body: Omit<LaunchBody, 'machine' | 'cwd'>, done: string, loading?: string, key?: string) => void
  onOpen: (id: string) => void
  onHistory: (id: string) => void
}) {
  const [list, setList] = useState<ProjectSession[] | null>(null)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [name, setName] = useState('')
  const [wt, setWt] = useState(false)
  const [wtName, setWtName] = useState('')
  const [offer, setOffer] = useState<string | null>(null)
  const [trusted, setTrusted] = useState<boolean | null>(p.trusted ?? null)
  useEffect(() => {
    if (p.trusted !== undefined) return
    // Picked from the explorer: ask that PC whether the folder is trusted yet.
    api<FsList>(`/api/fs?${new URLSearchParams({ machine, op: 'list', path: p.path })}`).then(l => setTrusted(l.trusted ?? null), () => {})
  }, [machine, p.path, p.trusted])

  useEffect(() => {
    let alive = true
    setList(null); setErr('')
    api<ProjectSessionsPayload>(`/api/projects/sessions?${new URLSearchParams({ machine, path: p.path })}`)
      .then(d => { if (alive) setList(d.sessions) }, e => { if (alive) setErr((e as Error).message) })
    return () => { alive = false }
  }, [machine, p.path])

  const shown = useMemo(() => {
    const n = q.trim().toLowerCase()
    return (list ?? []).filter(s => !n || s.title.toLowerCase().includes(n) || s.firstPrompt.toLowerCase().includes(n))
  }, [list, q])
  const last = list?.[0]

  const start = () => {
    const body: Omit<LaunchBody, 'machine' | 'cwd'> = { mode: 'new' }
    if (name.trim()) body.name = name.trim()
    if (wt) body.worktree = wtName.trim() || true
    onLaunch(body, `Abriendo Claude Code en ${machine}${wt ? ' · worktree nuevo' : ''}…`, undefined, 'new')
  }
  const tap = (s: ProjectSession) => {
    if (s.running) { setOffer(o => o === s.id ? null : s.id); return }
    onLaunch({ mode: 'resume', sessionId: s.id }, `«${s.title}» reanudada en ${machine}`, `Reanudando «${s.title}»…`, s.id)
  }

  return (
    <>
      <div className="relative shrink-0 overflow-hidden rounded-3xl p-4 glass">
        <div className="pointer-events-none absolute -right-10 -top-12 size-36 rounded-full bg-coral/15 blur-2xl" />
        <div className="relative flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-coral/15 text-coral"><FolderOpenIcon className="size-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[17px] font-semibold">{p.name}</p>
            <p className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
              {p.branch && <><GitBranchIcon className="size-3 shrink-0" /><span className="max-w-32 truncate">{p.branch}</span></>}
              {list && <span className="ml-auto shrink-0">{list.length} conv.</span>}
            </p>
            <p className="mt-1 break-all font-mono text-[11px] leading-snug text-muted-foreground/60">{p.path}</p>
          </div>
        </div>
        <div className="relative mt-4 flex flex-col gap-2.5">
          <label className={field}>
            <TagIcon className="size-4 text-muted-foreground" />
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Nombre (opcional)"
              className="h-10 min-w-0 flex-1 bg-transparent text-[16px] outline-none sm:text-[14px]" />
          </label>
          <button type="button" onClick={() => setWt(w => !w)} className="flex items-center gap-3 rounded-2xl px-1 text-left">
            <Toggle on={wt} />
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-[14px]"><TreesIcon className="size-3.5" />En un worktree nuevo</span>
              <span className="block font-mono text-[11px] text-muted-foreground">claude -w{wtName.trim() ? ` ${wtName.trim()}` : ''}</span>
            </span>
          </button>
          <AnimatePresence initial={false}>
            {wt && (
              <motion.label initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className={cn(field, 'overflow-hidden')}>
                <GitBranchIcon className="size-4 text-muted-foreground" />
                <input value={wtName} onChange={e => setWtName(e.target.value)} placeholder="Nombre del worktree (opcional)"
                  className="h-10 min-w-0 flex-1 bg-transparent text-[16px] outline-none sm:text-[14px]" />
              </motion.label>
            )}
          </AnimatePresence>
          <LaunchOptions trusted={trusted} opts={opts} setOpts={setOpts} />
          <motion.button type="button" disabled={busy} onClick={start} whileTap={{ scale: 0.98 }} className={primary}>
            {pending === 'new' ? <LoaderIcon className="size-4 animate-spin" /> : <PlusIcon className="size-4" strokeWidth={2.5} />}Nueva sesión
          </motion.button>
          {last && (
            <motion.button type="button" disabled={busy} whileTap={{ scale: 0.98 }}
              onClick={() => last.running
                // Already open: the only sensible thing is to look at it here.
                ? onOpen(last.id)
                : onLaunch({ mode: 'continue' }, `Última conversación reanudada en ${machine}`, `Continuando «${last.title}»…`, 'continue')}
              className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-left disabled:opacity-50">
              {pending === 'continue' ? <LoaderIcon className="size-4 shrink-0 animate-spin text-coral" />
                : last.running ? <SmartphoneIcon className="size-4 shrink-0 text-emerald-400" /> : <HistoryIcon className="size-4 shrink-0 text-coral" />}
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-medium">{last.running ? 'Abrir la última · ya está abierta' : 'Continuar la última'}</span>
                <span className="block truncate text-[11.5px] text-muted-foreground">{last.title}</span>
              </span>
              <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground/60">{ago(last.lastUsed)}</span>
            </motion.button>
          )}
        </div>
      </div>

      <SectionLabel icon={MessageSquareIcon} right={list ? `${shown.length}` : undefined}>Sesiones recientes</SectionLabel>
      {(list?.length ?? 0) > 4 && (
        <label className={cn(field, 'shrink-0')}>
          <SearchIcon className="size-4 text-muted-foreground" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar sesión…" className="h-10 min-w-0 flex-1 bg-transparent text-[16px] outline-none sm:text-[14px]" />
          {q && <button type="button" onClick={() => setQ('')} aria-label="Limpiar"><XIcon className="size-4 text-muted-foreground" /></button>}
        </label>
      )}
      {!list && !err && <p className="text-shine px-1 text-sm">Leyendo conversaciones…</p>}
      {err && <p className="px-1 text-sm text-red-400">{err}</p>}
      {list?.length === 0 && <p className="px-1 py-2 text-center text-sm text-muted-foreground">Aún no hay conversaciones en esta carpeta.</p>}
      {list && list.length > 0 && shown.length === 0 && <p className="px-1 py-2 text-center text-sm text-muted-foreground">Ninguna sesión coincide.</p>}
      <div className="flex flex-col gap-1.5">
        {shown.map((s, i) => (
          <motion.div key={s.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 12) * 0.02, ...spring }}
            className={cn('overflow-hidden rounded-2xl border', s.running ? 'border-emerald-400/25 bg-emerald-400/[0.04]' : 'border-white/6 bg-white/[0.03]')}>
            <div className="flex items-stretch">
              <button type="button" disabled={busy} onClick={() => tap(s)} className="flex min-w-0 flex-1 items-start gap-3 px-3 py-2.5 text-left active:bg-white/5 disabled:opacity-60">
                <span className={cn('mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg', s.running ? 'bg-emerald-400/15 text-emerald-400' : 'bg-white/[0.05] text-muted-foreground')}>
                  {pending === s.id ? <LoaderIcon className="size-3.5 animate-spin text-coral" />
                    : s.running ? <span className="size-2 animate-pulse rounded-full bg-emerald-400" /> : <PlayIcon className="size-3.5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="line-clamp-1 text-[14px] font-medium">{s.title || 'Sin título'}</span>
                    {s.running && <span className="shrink-0 rounded-full bg-emerald-400/15 px-1.5 text-[10.5px] font-medium text-emerald-400">abierta</span>}
                  </span>
                  {s.firstPrompt && s.firstPrompt !== s.title && <span className="line-clamp-1 text-[11.5px] text-muted-foreground/70">{s.firstPrompt}</span>}
                  <span className="mt-0.5 block font-mono text-[10.5px] text-muted-foreground/60">{ago(s.lastUsed)} · {s.messages} mensajes</span>
                </span>
              </button>
              <button type="button" onClick={() => onHistory(s.id)} aria-label="Ver historial"
                className="flex w-14 shrink-0 flex-col items-center justify-center gap-0.5 border-l border-white/5 text-[9.5px] text-muted-foreground active:bg-white/5">
                <ScrollTextIcon className="size-4" />historial
              </button>
            </div>
            <AnimatePresence initial={false}>
              {offer === s.id && s.running && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                  <div className="flex items-center gap-2 border-t border-white/5 px-3 py-2.5">
                    <span className="flex-1 text-[12px] text-muted-foreground">Ya está abierta en {machine}.</span>
                    <motion.button type="button" whileTap={{ scale: 0.95 }} onClick={() => onOpen(s.id)}
                      className="flex items-center gap-1.5 rounded-full bg-emerald-400/15 px-3 py-1.5 text-[12.5px] font-medium text-emerald-300">
                      <SmartphoneIcon className="size-3.5" />Abrir en el móvil
                    </motion.button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        ))}
      </div>
    </>
  )
}

function MkdirView({ home, roots, busy, onCreate, options }: { home: string; roots: { name: string; path: string }[]; busy: boolean; onCreate: (cwd: string) => void; options: ReactNode }) {
  const withSep = (p: string) => (p.endsWith('/') || p.endsWith('\\') ? p : p + sepOf(p))
  const [path, setPath] = useState(() => (home ? withSep(home) : ''))
  const name = baseName(path.trim())
  const ok = !!path.trim() && !/[\\/]$/.test(path.trim())
  return (
    <>
      <p className="px-1 text-[13px] leading-snug text-muted-foreground">Crea la carpeta en la PC y abre Claude Code dentro.</p>
      {roots.length > 0 && (
        <div className="scrollbar-none -mx-1 flex shrink-0 gap-2 overflow-x-auto px-1">
          {roots.map(r => (
            <button key={r.path} type="button" onClick={() => setPath(withSep(r.path))}
              className="flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 px-3 py-1 font-mono text-[12px] text-muted-foreground active:bg-white/5">
              <FolderIcon className="size-3.5 text-coral" />{r.name}
            </button>
          ))}
        </div>
      )}
      <label className={field}>
        <FolderPlusIcon className="size-4 shrink-0 text-coral" />
        <input value={path} onChange={e => setPath(e.target.value)} autoFocus spellCheck={false} autoCapitalize="off" autoCorrect="off"
          className="h-11 min-w-0 flex-1 bg-transparent font-mono text-[16px] outline-none sm:text-[13px]" />
      </label>
      {ok && <p className="px-1 font-mono text-[11.5px] text-muted-foreground">Nueva carpeta: <span className="text-coral">{name}</span></p>}
      {options}
      <motion.button type="button" disabled={busy || !ok} onClick={() => onCreate(path.trim())} whileTap={{ scale: 0.98 }} className={cn(primary, 'mt-1')}>
        {busy ? <LoaderIcon className="size-4 animate-spin" /> : <FolderPlusIcon className="size-4" />}Crear y abrir
      </motion.button>
    </>
  )
}

// GitHub's mark (lucide no longer ships brand icons).
const GithubIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 16 16" fill="currentColor" className={className} aria-hidden="true">
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
  </svg>
)

type GhRepo = { name: string; description: string; private: boolean; fork: boolean; archived: boolean; updatedAt: string; language: string; stars: number; url: string }

// Clone from GitHub through the PC's own gh: its repos and its organisations'
// (or a search across GitHub), then where it goes, chosen by exploring.
function CloneView({ machine, parent, busy, onBrowse, onClone, options }: {
  machine: string; parent: string; busy: boolean; onBrowse: () => void; onClone: (repo: string, cwd: string) => void; options: ReactNode
}) {
  const [owners, setOwners] = useState<{ user: string; orgs: string[] } | null>(null)
  const [owner, setOwner] = useState('')
  const [repos, setRepos] = useState<GhRepo[] | null>(null)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [global, setGlobal] = useState(false)
  const [picked, setPicked] = useState<GhRepo | null>(null)
  const [name, setName] = useState('')
  const [manual, setManual] = useState(false)
  const [url, setUrl] = useState('')

  useEffect(() => {
    setOwners(null); setErr('')
    api<{ user: string; orgs: string[] }>(`/api/github?${new URLSearchParams({ machine, op: 'owners' })}`)
      .then(o => { setOwners(o); setOwner(o.user) }, e => setErr((e as Error).message))
  }, [machine])
  useEffect(() => {
    if (global || !owner) return
    let alive = true
    setRepos(null)
    api<{ repos: GhRepo[] }>(`/api/github?${new URLSearchParams({ machine, op: 'repos', owner })}`)
      .then(r => { if (alive) setRepos(r.repos) }, e => { if (alive) setErr((e as Error).message) })
    return () => { alive = false }
  }, [machine, owner, global])
  useEffect(() => {
    if (!global) return
    const text = q.trim()
    if (text.length < 2) { setRepos([]); return }
    const ctl = new AbortController()
    const t = setTimeout(() => {
      setRepos(null)
      api<{ repos: GhRepo[] }>(`/api/github?${new URLSearchParams({ machine, op: 'search', q: text })}`, undefined, { signal: ctl.signal })
        .then(r => setRepos(r.repos), e => { if ((e as Error).name !== 'AbortError') setErr((e as Error).message) })
    }, 400)
    return () => { clearTimeout(t); ctl.abort() }
  }, [global, q, machine])

  const shown = useMemo(() => {
    if (global) return repos ?? []
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    return (repos ?? []).filter(r => words.every(w => `${r.name} ${r.description} ${r.language}`.toLowerCase().includes(w)))
  }, [repos, q, global])
  const pick = (r: GhRepo) => { setPicked(r); setName(r.name.split('/')[1] ?? r.name) }
  const source = picked ? picked.name : url.trim()
  const target = parent && name.trim() ? joinPath(parent, name.trim()) : ''
  const chip = (on: boolean) => cn('flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12.5px] transition-colors',
    on ? 'border-coral/70 bg-coral/15 text-coral' : 'border-white/10 text-muted-foreground')

  // Step two: the repo is chosen; where does it go?
  if (picked || manual) {
    return (
      <>
        {picked ? (
          <div className="flex items-start gap-3 rounded-2xl p-3 glass">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/[0.06]"><GithubIcon className="size-5" /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-semibold">{picked.name.split('/')[1]}</span>
              <span className="block truncate font-mono text-[11px] text-muted-foreground">{picked.name}{picked.private ? ' · privado' : ''}</span>
              {picked.description && <span className="mt-1 line-clamp-2 block text-[12px] text-muted-foreground">{picked.description}</span>}
            </span>
            <button type="button" onClick={() => setPicked(null)} aria-label="Elegir otro" className="grid size-8 place-items-center rounded-full text-muted-foreground active:bg-white/5"><XIcon className="size-4" /></button>
          </div>
        ) : (
          <label className={field}>
            <GitForkIcon className="size-4 shrink-0 text-coral" />
            <input value={url} onChange={e => { setUrl(e.target.value); setName(repoName(e.target.value)) }} placeholder="https://github.com/usuario/repo.git" autoFocus
              spellCheck={false} autoCapitalize="off" autoCorrect="off" inputMode="url"
              className="h-11 min-w-0 flex-1 bg-transparent font-mono text-[16px] outline-none sm:text-[13px]" />
          </label>
        )}
        <SectionLabel icon={FolderIcon}>Se clona dentro de</SectionLabel>
        <button type="button" onClick={onBrowse}
          className="flex items-center gap-3 rounded-2xl border border-coral/25 bg-coral/[0.05] px-3 py-3 text-left active:bg-coral/10">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-coral/15 text-coral"><CompassIcon className="size-4" /></span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-medium">{parent ? baseName(parent) : 'Elegir carpeta…'}</span>
            <span className="block truncate font-mono text-[11px] text-muted-foreground">{parent ? shortPath(parent) : 'Explora las carpetas de la PC'}</span>
          </span>
          <span className="shrink-0 text-[12px] text-coral">Cambiar</span>
        </button>
        <label className={field}>
          <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Nombre de la carpeta"
            spellCheck={false} autoCapitalize="off" autoCorrect="off"
            className="h-10 min-w-0 flex-1 bg-transparent font-mono text-[16px] outline-none sm:text-[13px]" />
        </label>
        {target && <p className="break-all px-1 font-mono text-[11px] text-muted-foreground/70">→ {target}</p>}
        {options}
        <motion.button type="button" disabled={busy || !source || !target} onClick={() => onClone(source, target)} whileTap={{ scale: 0.98 }} className={primary}>
          {busy ? <><LoaderIcon className="size-4 animate-spin" />Clonando…</> : <><GitForkIcon className="size-4" />Clonar y abrir</>}
        </motion.button>
        {manual && !picked && <button type="button" onClick={() => setManual(false)} className="text-[12.5px] text-muted-foreground">← Ver repos de GitHub</button>}
      </>
    )
  }

  // Step one: which repo.
  return (
    <>
      <label className={field}>
        <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={global ? 'Buscar en todo GitHub…' : 'Buscar repo…'}
          spellCheck={false} autoCapitalize="off" autoCorrect="off"
          className="h-11 min-w-0 flex-1 bg-transparent text-[16px] outline-none sm:text-[14px]" />
      </label>
      {owners && (
        <div className="scrollbar-none -mx-1 flex shrink-0 gap-1.5 overflow-x-auto px-1">
          {[owners.user, ...owners.orgs].map(o => (
            <button key={o} type="button" onClick={() => { setGlobal(false); setOwner(o) }} className={chip(!global && owner === o)}>
              {o === owners.user ? <UserIcon className="size-3.5" /> : <BuildingIcon className="size-3.5" />}{o}
            </button>
          ))}
          <button type="button" onClick={() => setGlobal(true)} className={chip(global)}><GlobeIcon className="size-3.5" />Todo GitHub</button>
        </div>
      )}
      {err && <p className="rounded-2xl bg-red-500/10 px-3 py-2 text-[12.5px] text-red-300">{err}</p>}
      {!err && (!owners || repos === null) && <p className="text-shine px-1 text-[13px]">{owners ? 'Leyendo repos…' : `Preguntando a gh en ${machine}…`}</p>}
      <div className="flex flex-col gap-1.5">
        {shown.slice(0, 150).map((r, i) => (
          <motion.button key={r.name} type="button" onClick={() => pick(r)}
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 10) * 0.02 }}
            className="flex shrink-0 items-start gap-3 rounded-2xl border border-white/6 bg-white/[0.03] px-3 py-2.5 text-left active:bg-white/[0.06]">
            <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl bg-white/[0.05] text-muted-foreground">
              {r.private ? <LockIcon className="size-3.5" /> : <GithubIcon className="size-3.5" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-[14px] font-medium">{global || r.name.split('/')[0] !== owner ? r.name : r.name.split('/')[1]}</span>
                {r.fork && <span className="shrink-0 rounded-full border border-white/10 px-1.5 text-[10px] text-muted-foreground">fork</span>}
                {r.archived && <span className="shrink-0 rounded-full border border-white/10 px-1.5 text-[10px] text-muted-foreground">archivado</span>}
              </span>
              {r.description && <span className="line-clamp-1 block text-[11.5px] text-muted-foreground">{r.description}</span>}
              <span className="flex items-center gap-2 font-mono text-[10.5px] text-muted-foreground/70">
                {r.language && <span>{r.language}</span>}
                {r.stars > 0 && <span>★ {r.stars}</span>}
                {r.updatedAt && <span>{ago(Date.parse(r.updatedAt))}</span>}
              </span>
            </span>
          </motion.button>
        ))}
        {repos && shown.length === 0 && <p className="py-4 text-center text-[13px] text-muted-foreground">{global && q.trim().length < 2 ? 'Escribe para buscar en GitHub.' : 'Ningún repo coincide.'}</p>}
      </div>
      <button type="button" onClick={() => setManual(true)} className="flex shrink-0 items-center gap-2 rounded-2xl border border-dashed border-white/12 px-3 py-2.5 text-left text-[13px] text-muted-foreground active:bg-white/5">
        <LinkIcon className="size-4 text-coral" />Otro repo: pegar una URL
      </button>
    </>
  )
}
