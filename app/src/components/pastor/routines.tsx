import {
  AlarmClockIcon, CalendarClockIcon, ChevronLeftIcon, CircleAlertIcon, CircleCheckIcon, FolderIcon, LoaderCircleIcon, MonitorIcon, PencilIcon,
  PlayIcon, PlusIcon, RepeatIcon, ServerIcon, TrashIcon, XIcon,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Explorer } from '@/components/pastor/explorer'
import { PetLane } from '@/components/pastor/pet/PetLane'
import type { Walker } from '@/components/pastor/pet/walker'
import { api, store } from '@/lib/api'
import { useBackClose } from '@/lib/back'
import { ago, shortPath } from '@/lib/format'
import type { Machine } from '@/lib/types'
import { cn } from '@/lib/utils'

type Schedule =
  | { kind: 'once'; at: number }
  | { kind: 'daily'; time: string; days: number[]; tz: number }
  | { kind: 'interval'; minutes: number }
type Run = { at: number; why: string; status: 'launched' | 'running' | 'done' | 'error' | 'missed'; session: string | null; note: string; ended?: number }
type Routine = {
  id: string; name: string; cwd: string; prompt: string; schedule: Schedule; permissionMode: string; closeWhenDone: boolean
  enabled: boolean; nextRun: number | null; lastRun: number | null; runs: Run[]; machine: string; running: boolean; created: number
}
type Draft = Omit<Routine, 'id' | 'nextRun' | 'lastRun' | 'runs' | 'running' | 'created'> & { id?: string }

const spring = { type: 'spring', stiffness: 380, damping: 38 } as const
const DAYS: [number, string][] = [[1, 'L'], [2, 'M'], [3, 'X'], [4, 'J'], [5, 'V'], [6, 'S'], [0, 'D']]
const PERMS: [string, string][] = [['default', 'Preguntar'], ['acceptEdits', 'Editar sin preguntar'], ['bypassPermissions', 'Sin permisos']]
const INTERVALS: [number, string][] = [[30, '30 min'], [60, '1 h'], [120, '2 h'], [360, '6 h'], [720, '12 h']]

function scheduleText(s: Schedule) {
  if (s.kind === 'once') return `Una vez · ${new Date(s.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`
  if (s.kind === 'interval') return `Cada ${s.minutes % 60 === 0 ? `${s.minutes / 60} h` : `${s.minutes} min`}`
  const days = s.days.length === 0 || s.days.length === 7 ? 'todos los días'
    : s.days.length === 5 && [1, 2, 3, 4, 5].every(d => s.days.includes(d)) ? 'de lunes a viernes'
    : DAYS.filter(([d]) => s.days.includes(d)).map(([, l]) => l).join(' ')
  return `${s.time} · ${days}`
}
const until = (t: number) => {
  const m = Math.round((t - Date.now()) / 60_000)
  if (m < 1) return 'ahora'
  if (m < 60) return `en ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `en ${h} h ${m % 60 ? `${m % 60} min` : ''}`.trim()
  return new Date(t).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })
}
const RUN: Record<Run['status'], [string, string]> = {
  launched: ['Abriendo…', 'text-sky-300'], running: ['Trabajando', 'text-coral'], done: ['Hecha', 'text-emerald-400'],
  error: ['Falló', 'text-red-400'], missed: ['Se la saltó', 'text-muted-foreground'],
}

// Prompts that run by themselves: at their time a new session opens in their
// folder on their PC and gets the prompt; the phone hears when it is done.
export function RoutinesScreen({ open, onClose, machines, onOpenSession, preset }: {
  open: boolean; onClose: () => void; machines: Machine[]; onOpenSession: (id: string) => void
  preset?: { machine: string; cwd: string } | null
}) {
  useBackClose(open, onClose)
  const names = machines.filter(m => m.online).map(m => m.name)
  const [lists, setLists] = useState<Record<string, Routine[] | { error: string }>>({})
  const [edit, setEdit] = useState<Draft | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const out: Record<string, Routine[] | { error: string }> = {}
    await Promise.all(names.map(async m => {
      try { out[m] = (await api<{ routines: Routine[] }>(`/api/routines?machine=${encodeURIComponent(m)}`)).routines }
      catch (e) { out[m] = { error: (e as Error).message } }
    }))
    setLists(out)
  }, [names.join()]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return
    void load()
    const t = setInterval(() => void load(), 10_000)
    return () => clearInterval(t)
  }, [open, load])
  useEffect(() => { if (open && preset) setEdit(blank(preset.machine, preset.cwd)) }, [open, preset?.machine, preset?.cwd]) // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (r: Routine, op: string, extra: Record<string, unknown> = {}) => {
    setBusy(`${op}:${r.id}`)
    try {
      await api('/api/routines', { machine: r.machine, op, id: r.id, ...extra })
      if (op === 'run') toast.success('Rutina en marcha', { description: r.name, icon: <PlayIcon className="size-4" /> })
      if (op === 'delete') toast.success('Rutina borrada', { description: r.name, icon: <TrashIcon className="size-4" /> })
      await load()
    } catch (e) { toast.error((e as Error).message) }
    finally { setBusy(null) }
  }

  const all = Object.values(lists).filter(Array.isArray).flat() as Routine[]
  return (
    <AnimatePresence>
      {open && (
        <motion.div key="routines" initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={spring}
          className="fixed inset-0 z-50 flex flex-col bg-background pt-[env(safe-area-inset-top)]">
          <header className="flex items-center gap-2 border-b border-white/6 px-2 py-2">
            <button type="button" onClick={onClose} aria-label="Cerrar" className="grid size-10 place-items-center rounded-full active:bg-white/5"><XIcon className="size-5" /></button>
            <span className="grid size-8 place-items-center rounded-xl bg-amber-400/12 text-amber-300"><AlarmClockIcon className="size-4" /></span>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold leading-tight">Rutinas</p>
              <p className="truncate text-[11.5px] text-muted-foreground">{all.length ? `${all.filter(r => r.enabled).length} activas de ${all.length}` : 'Prompts que corren solos a su hora'}</p>
            </div>
            <motion.button type="button" whileTap={{ scale: 0.92 }} onClick={() => setEdit(blank(names[0] ?? '', ''))} aria-label="Nueva rutina"
              className="grid size-10 place-items-center rounded-full bg-gradient-to-br from-coral to-[oklch(0.62_0.15_35)] text-background">
              <PlusIcon className="size-5" strokeWidth={2.5} />
            </motion.button>
          </header>
          <main className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-[max(env(safe-area-inset-bottom),24px)] pt-3 [&>*]:shrink-0">
            {names.map(m => {
              const list = lists[m]
              return (
                <section key={m}>
                  <p className="mb-2 flex items-center gap-1.5 px-1 font-mono text-[12px] text-muted-foreground">
                    {machines.find(x => x.name === m)?.local ? <ServerIcon className="size-3.5" /> : <MonitorIcon className="size-3.5" />}{m}
                  </p>
                  {!list ? <p className="text-shine px-1 text-[13px]">Cargando…</p>
                    : 'error' in list ? <p className="rounded-2xl bg-red-500/10 p-3 text-[12.5px] text-red-300">{list.error}</p>
                    : list.length === 0 ? <p className="px-1 text-[12.5px] text-muted-foreground/60">Ninguna en esta PC.</p>
                    : (
                      <div className="flex flex-col gap-2.5">
                        {list.map(r => (
                          <RoutineCard key={r.id} r={r} busy={busy} onToggle={on => void act(r, 'toggle', { enabled: on })}
                            onRun={() => void act(r, 'run')} onDelete={() => void act(r, 'delete')}
                            onEdit={() => setEdit({ ...r })} onOpenSession={id => { onClose(); onOpenSession(r.machine === (machines.find(x => x.local)?.name ?? '') ? id : `${r.machine}~${id}`) }} />
                        ))}
                      </div>
                    )}
                </section>
              )
            })}
            <p className="px-1 text-[11px] leading-relaxed text-muted-foreground/60">
              Cada rutina vive en su PC y corre aunque el móvil o el hub estén apagados. Si la PC estaba apagada a su hora, la salta y lo anota.
            </p>
          </main>
          <AnimatePresence>
            {edit && <Editor draft={edit} names={names} machines={machines} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void load() }} />}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function blank(machine: string, cwd: string): Draft {
  return {
    machine, cwd, name: '', prompt: '', permissionMode: 'default', closeWhenDone: true, enabled: true,
    schedule: { kind: 'daily', time: '08:00', days: [1, 2, 3, 4, 5], tz: new Date().getTimezoneOffset() },
  }
}

function RoutineCard({ r, busy, onToggle, onRun, onDelete, onEdit, onOpenSession }: {
  r: Routine; busy: string | null; onToggle: (on: boolean) => void; onRun: () => void; onDelete: () => void; onEdit: () => void; onOpenSession: (id: string) => void
}) {
  const [confirm, setConfirm] = useState(false)
  const last = r.runs[0]
  // Its Clawd sleeps between runs, works during one, and celebrates (or
  // trips) when the last run ends.
  const pet = useRef<Walker | null>(null)
  const runKey = last ? `${last.at}:${last.status}` : ''
  const seenRun = useRef(runKey)
  useEffect(() => {
    if (runKey === seenRun.current) return
    seenRun.current = runKey
    if (last?.status === 'done') pet.current?.react('done')
    else if (last?.status === 'error') pet.current?.react('fail')
  }, [runKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const Icon = r.schedule.kind === 'interval' ? RepeatIcon : r.schedule.kind === 'once' ? CalendarClockIcon : AlarmClockIcon
  return (
    <div className={cn('overflow-hidden rounded-3xl glass', !r.enabled && 'opacity-60')}>
      <div className="flex items-start gap-3 p-3.5">
        <span className={cn('grid size-10 shrink-0 place-items-center rounded-2xl', r.running ? 'bg-coral/15 text-coral' : 'bg-amber-400/12 text-amber-300')}>
          {r.running ? <LoaderCircleIcon className="size-4 animate-spin" /> : <Icon className="size-4" />}
        </span>
        <button type="button" onClick={onEdit} className="min-w-0 flex-1 text-left">
          <span className="block truncate text-[15px] font-semibold">{r.name}</span>
          <span className="block truncate text-[12.5px] text-amber-200/90">{scheduleText(r.schedule)}</span>
          <span className="block truncate font-mono text-[10.5px] text-muted-foreground/70">{shortPath(r.cwd)}</span>
        </button>
        <button type="button" role="switch" aria-checked={r.enabled} aria-label={r.enabled ? 'Pausar' : 'Activar'} onClick={() => onToggle(!r.enabled)}
          className={cn('relative mt-1 h-6 w-11 shrink-0 rounded-full transition-colors', r.enabled ? 'bg-amber-400' : 'bg-white/15')}>
          <motion.span layout transition={spring} className={cn('absolute top-0.5 size-5 rounded-full bg-white shadow', r.enabled ? 'right-0.5' : 'left-0.5')} />
        </button>
      </div>
      <p className="line-clamp-2 px-3.5 text-[12.5px] leading-snug text-muted-foreground">{r.prompt}</p>
      <PetLane mood={r.running ? 'working' : 'sleep'} className="relative mx-3.5 mt-1 h-8" onReady={w => { pet.current = w }} />
      <div className="mt-2 flex items-center gap-2 border-t border-white/5 px-3.5 py-2 text-[11.5px]">
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {r.enabled && r.nextRun ? <>Próxima: <b className="font-medium text-foreground">{until(r.nextRun)}</b></> : r.enabled ? 'Sin próxima' : 'Pausada'}
          {last && (
            <> · <button type="button" disabled={!last.session} onClick={() => last.session && onOpenSession(last.session)} className={cn('font-medium', RUN[last.status][1])}>
              {RUN[last.status][0]} {ago(last.at)}
            </button></>
          )}
        </span>
        <button type="button" onClick={onRun} disabled={busy === `run:${r.id}`} aria-label="Ejecutar ahora"
          className="flex h-8 items-center gap-1 rounded-full border border-white/10 px-2.5 text-[12px] active:bg-white/5">
          {busy === `run:${r.id}` ? <LoaderCircleIcon className="size-3.5 animate-spin" /> : <PlayIcon className="size-3.5" />}Ahora
        </button>
        <button type="button" onClick={onEdit} aria-label="Editar" className="grid size-8 place-items-center rounded-full text-muted-foreground active:bg-white/5"><PencilIcon className="size-3.5" /></button>
        {confirm ? (
          <button type="button" onClick={onDelete} className="rounded-full bg-red-500/90 px-2.5 py-1 text-[12px] font-semibold text-white">Borrar</button>
        ) : (
          <button type="button" onClick={() => setConfirm(true)} aria-label="Borrar" className="grid size-8 place-items-center rounded-full text-red-300/70 active:bg-red-500/10"><TrashIcon className="size-3.5" /></button>
        )}
      </div>
      {last?.status === 'error' && last.note && (
        <p className="flex items-start gap-1.5 border-t border-white/5 px-3.5 py-2 text-[11.5px] text-red-300"><CircleAlertIcon className="mt-px size-3.5 shrink-0" />{last.note}</p>
      )}
      {last?.status === 'done' && last.note && (
        <p className="flex items-start gap-1.5 border-t border-white/5 px-3.5 py-2 text-[11.5px] text-muted-foreground"><CircleCheckIcon className="mt-px size-3.5 shrink-0 text-emerald-400" /><span className="line-clamp-2">{last.note}</span></p>
      )}
    </div>
  )
}

function Editor({ draft, names, machines, onClose, onSaved }: { draft: Draft; names: string[]; machines: Machine[]; onClose: () => void; onSaved: () => void }) {
  useBackClose(true, onClose)
  const [d, setD] = useState<Draft>(draft)
  const [picking, setPicking] = useState(false)
  const [home, setHome] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (patch: Partial<Draft>) => setD(x => ({ ...x, ...patch }))
  const sc = d.schedule

  useEffect(() => {
    if (!d.machine) return
    api<{ home: string }>(`/api/projects?machine=${encodeURIComponent(d.machine)}`).then(r => setHome(r.home), () => {})
  }, [d.machine])
  useEffect(() => { if (!d.machine && names[0]) set({ machine: names[0] }) }, [names.join()]) // eslint-disable-line react-hooks/exhaustive-deps

  const kind = (k: Schedule['kind']) => set({
    schedule: k === 'once' ? { kind: k, at: Date.now() + 60 * 60_000 }
      : k === 'interval' ? { kind: k, minutes: 60 }
      : { kind: k, time: '08:00', days: [1, 2, 3, 4, 5], tz: new Date().getTimezoneOffset() },
  })
  const localValue = (t: number) => { const x = new Date(t - new Date(t).getTimezoneOffset() * 60_000); return x.toISOString().slice(0, 16) }

  const save = async () => {
    setSaving(true)
    try {
      const schedule = sc.kind === 'daily' ? { ...sc, tz: new Date().getTimezoneOffset() } : sc
      await api('/api/routines', { machine: d.machine, op: 'save', id: d.id, routine: { ...d, schedule } })
      toast.success(d.id ? 'Rutina guardada' : 'Rutina creada', { description: d.name || d.prompt.slice(0, 60), icon: <AlarmClockIcon className="size-4" /> })
      store.set('routine.last', { machine: d.machine, cwd: d.cwd })
      onSaved()
    } catch (e) { toast.error((e as Error).message) }
    finally { setSaving(false) }
  }
  const field = 'w-full rounded-2xl border border-white/8 bg-white/[0.04] px-3 py-2.5 text-[16px] outline-none focus:border-amber-400/50 sm:text-[14px]'
  const chip = (on: boolean) => cn('rounded-full border px-3 py-1.5 text-[12.5px] transition-colors', on ? 'border-amber-400/60 bg-amber-400/12 text-amber-100' : 'border-white/10 text-muted-foreground')

  return (
    <motion.div key="editor" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={spring}
      className="fixed inset-0 z-[55] flex flex-col bg-background pt-[env(safe-area-inset-top)]">
      <header className="flex items-center gap-2 border-b border-white/6 px-2 py-2">
        <button type="button" onClick={onClose} aria-label="Volver" className="grid size-10 place-items-center rounded-full active:bg-white/5"><ChevronLeftIcon className="size-5" /></button>
        <p className="flex-1 text-[15px] font-semibold">{d.id ? 'Editar rutina' : 'Nueva rutina'}</p>
      </header>
      <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-6 pt-4 [&>*]:shrink-0">
        {!d.id && names.length > 1 && (
          <div className="scrollbar-none flex gap-2 overflow-x-auto">
            {names.map(m => (
              <button key={m} type="button" onClick={() => set({ machine: m, cwd: '' })}
                className={cn('flex h-11 shrink-0 items-center gap-2 rounded-2xl border px-4 font-mono text-[13.5px]',
                  m === d.machine ? 'border-amber-400/60 bg-amber-400/10 text-amber-100' : 'border-white/10 text-muted-foreground')}>
                {machines.find(x => x.name === m)?.local ? <ServerIcon className="size-3.5" /> : <MonitorIcon className="size-3.5" />}{m}
              </button>
            ))}
          </div>
        )}
        <button type="button" onClick={() => setPicking(true)} disabled={!d.id && !home}
          className="flex items-center gap-2.5 rounded-2xl px-3.5 py-3 text-left glass active:bg-white/5">
          <FolderIcon className="size-4 shrink-0 text-coral" />
          <span className={cn('min-w-0 flex-1 truncate font-mono text-[12.5px]', !d.cwd && 'text-muted-foreground')}>{d.cwd || 'Elige la carpeta del proyecto'}</span>
          <span className="shrink-0 text-[12px] text-muted-foreground">{d.cwd ? 'Cambiar' : 'Explorar'}</span>
        </button>
        <input value={d.name} onChange={e => set({ name: e.target.value })} placeholder="Nombre (opcional)" className={field} />
        <textarea value={d.prompt} onChange={e => set({ prompt: e.target.value })} rows={5}
          placeholder="Qué debe hacer Claude. Ej.: revisa los PR abiertos y resume los que necesitan mi atención." className={cn(field, 'resize-none leading-relaxed')} />

        <div className="flex flex-col gap-2.5 rounded-3xl p-3.5 glass">
          <div className="flex gap-1.5">
            {([['daily', 'Días y hora'], ['interval', 'Cada cierto tiempo'], ['once', 'Una vez']] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => kind(k)} className={cn(chip(sc.kind === k), 'flex-1 px-2')}>{l}</button>
            ))}
          </div>
          {sc.kind === 'daily' && (
            <>
              <input type="time" value={sc.time} onChange={e => set({ schedule: { ...sc, time: e.target.value } })} className={cn(field, 'font-mono text-[20px]')} />
              <div className="flex justify-between gap-1">
                {DAYS.map(([n, l]) => (
                  <button key={n} type="button" onClick={() => set({ schedule: { ...sc, days: sc.days.includes(n) ? sc.days.filter(x => x !== n) : [...sc.days, n] } })}
                    className={cn('grid size-10 place-items-center rounded-full border text-[13px] font-semibold',
                      sc.days.includes(n) ? 'border-amber-400/60 bg-amber-400/15 text-amber-100' : 'border-white/10 text-muted-foreground')}>{l}</button>
                ))}
              </div>
            </>
          )}
          {sc.kind === 'interval' && (
            <div className="flex flex-wrap gap-1.5">
              {INTERVALS.map(([m, l]) => <button key={m} type="button" onClick={() => set({ schedule: { kind: 'interval', minutes: m } })} className={chip(sc.minutes === m)}>{l}</button>)}
            </div>
          )}
          {sc.kind === 'once' && (
            <input type="datetime-local" value={localValue(sc.at)} onChange={e => set({ schedule: { kind: 'once', at: new Date(e.target.value).getTime() } })} className={cn(field, 'font-mono')} />
          )}
        </div>

        <div className="flex flex-col gap-2">
          <p className="px-1 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Permisos</p>
          <div className="flex flex-wrap gap-1.5">
            {PERMS.map(([k, l]) => <button key={k} type="button" onClick={() => set({ permissionMode: k })} className={chip(d.permissionMode === k)}>{l}</button>)}
          </div>
          <p className="px-1 text-[11.5px] text-muted-foreground/70">
            {d.permissionMode === 'default' ? 'Cada permiso te llega al móvil y la rutina espera tu respuesta.' : d.permissionMode === 'acceptEdits' ? 'Edita archivos sin preguntar; lo demás te llega al móvil.' : 'Hace todo sin preguntar. Úsalo solo con prompts en los que confíes.'}
          </p>
        </div>
        <label className="flex items-center gap-3 rounded-2xl px-3.5 py-3 glass">
          <span className="min-w-0 flex-1">
            <span className="block text-[14px]">Cerrar la sesión al terminar</span>
            <span className="block text-[11.5px] text-muted-foreground/70">Para que no se acumulen ventanas. Su historial queda guardado.</span>
          </span>
          <input type="checkbox" checked={d.closeWhenDone} onChange={e => set({ closeWhenDone: e.target.checked })} className="size-5 accent-amber-400" />
        </label>
      </main>
      <div className="border-t border-white/6 px-4 pb-[max(env(safe-area-inset-bottom),14px)] pt-3">
        <button type="button" onClick={() => void save()} disabled={saving || !d.prompt.trim() || !d.cwd || !d.machine || (sc.kind === 'daily' && !sc.days.length)}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-amber-300 to-amber-500 text-[15px] font-semibold text-background disabled:opacity-50">
          {saving ? <LoaderCircleIcon className="size-4 animate-spin" /> : <AlarmClockIcon className="size-4" />}{d.id ? 'Guardar' : 'Crear rutina'}
        </button>
      </div>
      {d.machine && (d.cwd || home) && (
        <Explorer machine={d.machine} root={d.cwd || home} open={picking} onClose={() => setPicking(false)} pickFolder
          onPick={dir => { set({ cwd: dir }); setPicking(false) }} />
      )}
    </motion.div>
  )
}
