import {
  ArrowUpIcon, ChevronLeftIcon, CircleCheckIcon, CircleXIcon, CornerDownLeftIcon, FolderIcon, GlobeIcon, LoaderCircleIcon,
  MonitorIcon, ServerIcon, SquareIcon, SquareTerminalIcon, TrashIcon, XIcon,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Explorer } from '@/components/pastor/explorer'
import { PetLane } from '@/components/pastor/pet/PetLane'
import type { Walker } from '@/components/pastor/pet/walker'
import { openWeb } from '@/components/pastor/webviewer'
import { Ansi, stripAnsi } from '@/lib/ansi'
import { api, store } from '@/lib/api'
import { useBackClose } from '@/lib/back'
import { ago, dur, shortPath } from '@/lib/format'
import type { Machine } from '@/lib/types'
import { cn } from '@/lib/utils'

type Run = {
  id: string; cmd: string; cwd: string; startedAt: number; endedAt: number | null; code: number | null; running: boolean
  tail?: string; chunk?: string; next?: number; truncated?: boolean
}

const QUICK = ['git status', 'git pull', 'npm run dev', 'npm test', 'npm run build', 'ls']
const spring = { type: 'spring', stiffness: 380, damping: 38 } as const

// A command on a PC, without Claude: pick the PC and folder, type, see the
// output as it comes (colours too), stop it, answer its prompts. A dev server's
// address in the output opens on the phone.
export function TerminalScreen({ open, onClose, machines, machine: initialMachine, cwd: initialCwd }: {
  open: boolean; onClose: () => void; machines: Machine[]; machine?: string; cwd?: string
}) {
  useBackClose(open, onClose)
  const names = machines.filter(m => m.online).map(m => m.name)
  const [machine, setMachine] = useState(initialMachine ?? store.get('term.machine', names[0] ?? ''))
  const [cwd, setCwd] = useState('')
  const [runs, setRuns] = useState<Run[]>([])
  const [active, setActive] = useState<Run | null>(null)
  const [out, setOut] = useState('')
  const [cmd, setCmd] = useState('')
  const [stdin, setStdin] = useState('')
  const [picking, setPicking] = useState(false)
  const [sending, setSending] = useState(false)
  const pane = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  // Clawd on the floor: types along while a command runs, celebrates a clean
  // exit, trips on a failed one, and comes to look when you type.
  const pet = useRef<Walker | null>(null)
  const ended = active && !active.running ? active.code : undefined
  // The run seen running: only its own end is celebrated (not another, finished run opened later).
  const runningId = useRef<string | null>(null)
  useEffect(() => {
    if (active?.running) { runningId.current = active.id; return }
    if (!active || ended === undefined || runningId.current !== active.id) return
    runningId.current = null
    pet.current?.react(ended === 0 ? 'done' : 'fail')
  }, [active?.id, active?.running, ended]) // eslint-disable-line react-hooks/exhaustive-deps
  const typing = () => pet.current?.react('typing')

  useEffect(() => {
    if (!open) return
    const m = initialMachine ?? (machine || names[0] || '')
    setMachine(m)
    if (initialCwd) setCwd(initialCwd)
  }, [open, initialMachine, initialCwd]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (!machine || (names.length && !names.includes(machine))) { if (names[0]) setMachine(names[0]) } }, [machine, names.join()]) // eslint-disable-line react-hooks/exhaustive-deps

  // The folder: the one asked for, the last one used on that PC, or its home.
  useEffect(() => {
    if (!open || !machine) return
    store.set('term.machine', machine)
    if (initialCwd && machine === initialMachine) return
    const saved = store.get<Record<string, string>>('term.cwd', {})[machine]
    if (saved) { setCwd(saved); return }
    api<{ home: string }>(`/api/projects?machine=${encodeURIComponent(machine)}`).then(r => setCwd(r.home), () => {})
  }, [open, machine, initialCwd, initialMachine])
  useEffect(() => {
    if (!machine || !cwd) return
    store.set('term.cwd', { ...store.get<Record<string, string>>('term.cwd', {}), [machine]: cwd })
  }, [machine, cwd])

  const loadRuns = useCallback(() => {
    if (!machine) return
    api<{ runs: Run[] }>(`/api/term?machine=${encodeURIComponent(machine)}`).then(r => setRuns(r.runs), () => setRuns([]))
  }, [machine])
  useEffect(() => { if (open) { loadRuns(); setActive(null) } }, [open, loadRuns])

  // Follow the open run's output while it runs.
  useEffect(() => {
    if (!active) return
    let alive = true, from = 0, timer: ReturnType<typeof setTimeout> | undefined
    setOut('')
    stick.current = true
    const tick = async () => {
      try {
        const r = await api<Run>(`/api/term?${new URLSearchParams({ machine, id: active.id, from: String(from) })}`)
        if (!alive) return
        if (r.chunk) setOut(o => (o + r.chunk).slice(-600_000))
        from = r.next ?? from
        setActive(a => (a && a.id === r.id ? { ...a, running: r.running, code: r.code, endedAt: r.endedAt } : a))
        if (r.running) timer = setTimeout(tick, 700)
        else loadRuns()
      } catch (e) { if (alive) toast.error((e as Error).message) }
    }
    void tick()
    return () => { alive = false; clearTimeout(timer) }
  }, [active?.id, machine]) // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const el = pane.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [out])

  const run = async (text = cmd) => {
    const c = text.trim()
    if (!c || !machine || !cwd || sending) return
    setSending(true)
    try {
      const r = await api<Run>('/api/term', { machine, op: 'run', cwd, cmd: c })
      setCmd('')
      setActive(r)
      store.set('term.history', [c, ...store.get<string[]>('term.history', []).filter(x => x !== c)].slice(0, 30))
    } catch (e) { toast.error((e as Error).message) }
    finally { setSending(false) }
  }
  const post = (op: string, extra: Record<string, unknown> = {}) => api('/api/term', { machine, op, id: active?.id, ...extra }).catch(e => toast.error((e as Error).message))

  // http://localhost:5173 and friends in the output: open them on the phone.
  const ports = [...new Set([...stripAnsi(out).matchAll(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d{4,5})/g)].map(m => Number(m[1])))].slice(0, 3)
  const preview = async (port: number) => {
    const tid = toast.loading(`Publicando el puerto ${port} en la tailnet…`)
    try {
      const r = await api<{ url: string }>('/api/preview', { machine, op: 'open', port })
      toast.dismiss(tid)
      openWeb({ url: r.url, title: `${machine} · :${port}`, kind: 'preview' })
    } catch (e) { toast.error('No se pudo abrir', { id: tid, description: (e as Error).message }) }
  }
  const history = store.get<string[]>('term.history', [])
  const chips = [...new Set([...history.slice(0, 4), ...QUICK])].slice(0, 9)

  return (
    <AnimatePresence>
      {open && (
        <motion.div key="term" initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={spring}
          className="fixed inset-0 z-50 flex flex-col bg-background pt-[env(safe-area-inset-top)]">
          <header className="flex items-center gap-1.5 border-b border-white/6 px-2 py-2">
            {active ? (
              <button type="button" onClick={() => { setActive(null); loadRuns() }} aria-label="Volver" className="grid size-10 place-items-center rounded-full active:bg-white/5"><ChevronLeftIcon className="size-5" /></button>
            ) : (
              <button type="button" onClick={onClose} aria-label="Cerrar" className="grid size-10 place-items-center rounded-full active:bg-white/5"><XIcon className="size-5" /></button>
            )}
            <span className="grid size-8 place-items-center rounded-xl bg-emerald-400/12 text-emerald-300"><SquareTerminalIcon className="size-4" /></span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold leading-tight">{active ? active.cmd : 'Terminal'}</p>
              <p className="truncate font-mono text-[11px] text-muted-foreground">{machine} · {shortPath(active?.cwd ?? cwd)}</p>
            </div>
          </header>

          {!active && names.length > 1 && (
            <div className="scrollbar-none flex shrink-0 gap-2 overflow-x-auto px-4 pt-3">
              {names.map(m => (
                <button key={m} type="button" onClick={() => setMachine(m)}
                  className={cn('relative flex h-11 shrink-0 items-center gap-2 rounded-2xl border px-4 font-mono text-[13.5px]',
                    m === machine ? 'border-emerald-400/60 text-emerald-300' : 'border-white/10 text-muted-foreground')}>
                  {m === machine && <motion.span layoutId="term-pc" className="absolute inset-0 -z-10 rounded-2xl bg-emerald-400/10" transition={spring} />}
                  {machines.find(x => x.name === m)?.local ? <ServerIcon className="size-3.5" /> : <MonitorIcon className="size-3.5" />}{m}
                </button>
              ))}
            </div>
          )}
          {!active && (
            <button type="button" onClick={() => setPicking(true)} disabled={!cwd}
              className="mx-4 mt-3 flex shrink-0 items-center gap-2.5 rounded-2xl px-3.5 py-2.5 text-left glass active:bg-white/5">
              <FolderIcon className="size-4 shrink-0 text-coral" />
              <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{cwd || 'Cargando…'}</span>
              <span className="shrink-0 text-[12px] text-muted-foreground">Cambiar</span>
            </button>
          )}

          {active ? (
            <>
              <div ref={pane} onScroll={e => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40 }}
                className="min-h-0 flex-1 overflow-auto bg-black/40 px-3 py-3">
                <pre className="whitespace-pre-wrap break-all font-mono text-[12px] leading-[1.55] text-neutral-200"><Ansi text={out} />{active.running && <span className="animate-pulse text-emerald-300">▍</span>}</pre>
              </div>
              {ports.length > 0 && (
                <div className="flex shrink-0 gap-2 overflow-x-auto border-t border-white/6 px-3 py-2">
                  {ports.map(p => (
                    <button key={p} type="button" onClick={() => void preview(p)}
                      className="flex shrink-0 items-center gap-1.5 rounded-full border border-sky-400/40 bg-sky-400/10 px-3 py-1.5 text-[12.5px] text-sky-200 active:bg-sky-400/20">
                      <GlobeIcon className="size-3.5" />Ver :{p} en el móvil
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {runs.length === 0 ? (
                <div className="mt-14 flex flex-col items-center gap-2 text-center text-muted-foreground">
                  <SquareTerminalIcon className="size-8 opacity-40" />
                  <p className="text-[13.5px]">Corre un comando en {machine || 'la PC'}, sin pasar por Claude.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {runs.map(r => (
                    <div key={r.id} className="flex items-stretch overflow-hidden rounded-2xl glass">
                      <button type="button" onClick={() => setActive(r)} className="min-w-0 flex-1 px-3.5 py-2.5 text-left active:bg-white/5">
                        <span className="flex items-center gap-2">
                          {r.running ? <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin text-emerald-300" />
                            : r.code === 0 ? <CircleCheckIcon className="size-3.5 shrink-0 text-emerald-400" /> : <CircleXIcon className="size-3.5 shrink-0 text-red-400" />}
                          <span className="truncate font-mono text-[13px]">{r.cmd}</span>
                          <span className="ml-auto shrink-0 font-mono text-[10.5px] text-muted-foreground/60">{ago(r.startedAt)}</span>
                        </span>
                        {r.tail && <span className="mt-1 block truncate font-mono text-[11px] text-muted-foreground/70">{stripAnsi(r.tail).trim().split('\n').pop()}</span>}
                      </button>
                      <button type="button" aria-label="Quitar" onClick={() => { void api('/api/term', { machine, op: 'forget', id: r.id }).then(loadRuns) }}
                        className="grid w-10 shrink-0 place-items-center text-muted-foreground/50 active:text-red-300"><TrashIcon className="size-3.5" /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="relative mx-3 h-11 shrink-0 border-t border-dashed border-white/6">
            <PetLane mood={active?.running ? 'working' : 'idle'} scale={1.9} className="absolute inset-0" onReady={w => { pet.current = w }} />
          </div>

          {active ? (
            <div className="flex shrink-0 items-center gap-2 border-t border-white/6 px-3 pb-[max(env(safe-area-inset-bottom),10px)] pt-2">
              {active.running ? (
                <>
                  <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-2xl border border-white/8 bg-white/[0.04] px-3 focus-within:border-emerald-400/50">
                    <CornerDownLeftIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    <input value={stdin} onChange={e => { setStdin(e.target.value); typing() }} placeholder="Responder al comando…"
                      onKeyDown={e => { if (e.key === 'Enter') { void post('input', { text: stdin }); setStdin('') } }}
                      autoCapitalize="off" autoCorrect="off" spellCheck={false} className="min-w-0 flex-1 bg-transparent font-mono text-[16px] outline-none sm:text-[13px]" />
                  </label>
                  <button type="button" onClick={() => { void post('kill'); toast.warning('Deteniendo…', { icon: <SquareIcon className="size-4" /> }) }}
                    className="flex h-10 shrink-0 items-center gap-1.5 rounded-2xl bg-red-500/85 px-3.5 text-[13px] font-semibold text-white">
                    <SquareIcon className="size-3.5 fill-current" />Parar
                  </button>
                </>
              ) : (
                <>
                  <span className={cn('flex items-center gap-1.5 text-[12.5px]', active.code === 0 ? 'text-emerald-400' : 'text-red-400')}>
                    {active.code === 0 ? <CircleCheckIcon className="size-4" /> : <CircleXIcon className="size-4" />}
                    {active.code === 0 ? 'Terminó bien' : `Salió con ${active.code}`}
                    {active.endedAt && <span className="text-muted-foreground"> · {dur(active.endedAt - active.startedAt)}</span>}
                  </span>
                  <button type="button" onClick={() => void run(active.cmd)} className="ml-auto rounded-2xl border border-white/10 px-3.5 py-2 text-[13px] active:bg-white/5">Repetir</button>
                </>
              )}
            </div>
          ) : (
            <div className="shrink-0 border-t border-white/6 pb-[max(env(safe-area-inset-bottom),10px)] pt-2">
              <div className="scrollbar-none flex gap-1.5 overflow-x-auto px-3 pb-2">
                {chips.map(c => (
                  <button key={c} type="button" onClick={() => setCmd(c)}
                    className="shrink-0 rounded-full border border-white/10 px-3 py-1 font-mono text-[12px] text-muted-foreground active:bg-white/5">{c}</button>
                ))}
              </div>
              <div className="flex items-center gap-2 px-3">
                <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-2xl border border-white/8 bg-white/[0.04] px-3 focus-within:border-emerald-400/50">
                  <span className="font-mono text-[14px] text-emerald-300">❯</span>
                  <input value={cmd} onChange={e => { setCmd(e.target.value); typing() }} onFocus={typing} onKeyDown={e => { if (e.key === 'Enter') void run() }}
                    placeholder="comando" autoCapitalize="off" autoCorrect="off" spellCheck={false}
                    className="min-w-0 flex-1 bg-transparent font-mono text-[16px] outline-none sm:text-[13.5px]" />
                </label>
                <button type="button" onClick={() => void run()} disabled={!cmd.trim() || !cwd || sending} aria-label="Ejecutar"
                  className="grid size-11 shrink-0 place-items-center rounded-full bg-emerald-500 text-background disabled:opacity-40">
                  {sending ? <LoaderCircleIcon className="size-4 animate-spin" /> : <ArrowUpIcon className="size-5" strokeWidth={2.5} />}
                </button>
              </div>
            </div>
          )}
          {machine && cwd && (
            <Explorer machine={machine} root={cwd} open={picking} onClose={() => setPicking(false)} pickFolder
              onPick={dir => { setCwd(dir); setPicking(false) }} />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
