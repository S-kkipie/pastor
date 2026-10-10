import { ChevronDownIcon, GlobeIcon, LoaderCircleIcon, MonitorIcon, RefreshCwIcon, ServerIcon, UnplugIcon, XIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import { openWeb } from '@/components/pastor/webviewer'
import { api, store } from '@/lib/api'
import { useBackClose } from '@/lib/back'
import type { Machine } from '@/lib/types'
import { cn } from '@/lib/utils'

type Server = { port: number; pid: number; process: string; status: number; html: boolean; title: string; url: string | null; dev: boolean }
type Scan = { machine: string; host: string; tailscale: boolean; servers: Server[] }
const spring = { type: 'spring', stiffness: 380, damping: 38 } as const

// What is serving web on a PC right now (dev servers first), opened on the
// phone: the bridge publishes that port on the tailnet and the page loads here.
export function PreviewsSheet({ open, onClose, machines, machine: initial }: {
  open: boolean; onClose: () => void; machines: Machine[]; machine?: string
}) {
  useBackClose(open, onClose)
  const names = machines.filter(m => m.online).map(m => m.name)
  const [machine, setMachine] = useState(initial ?? store.get('preview.machine', names[0] ?? ''))
  const [scan, setScan] = useState<Scan | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState<number | null>(null)
  const [others, setOthers] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => { if (open && initial) setMachine(initial) }, [open, initial])
  // The PC list arrives after the first render: settle on one as soon as it does.
  useEffect(() => { if (!machine || (names.length && !names.includes(machine))) { if (names[0]) setMachine(names[0]) } }, [machine, names.join()]) // eslint-disable-line react-hooks/exhaustive-deps
  const load = useCallback(() => {
    if (!machine) return
    setLoading(true); setErr('')
    api<Scan>(`/api/preview?machine=${encodeURIComponent(machine)}`)
      .then(r => { setScan(r); store.set('preview.machine', machine) }, e => { setScan(null); setErr((e as Error).message) })
      .finally(() => setLoading(false))
  }, [machine])
  useEffect(() => { if (open) load() }, [open, load])

  const view = async (s: Server) => {
    setBusy(s.port)
    try {
      const r = s.url ? { url: s.url } : await api<{ url: string }>('/api/preview', { machine, op: 'open', port: s.port })
      openWeb({ url: r.url, title: s.title || `${machine} · :${s.port}`, kind: 'preview' })
      load()
    } catch (e) { toast.error('No se pudo abrir', { description: (e as Error).message }) }
    finally { setBusy(null) }
  }
  const unpublish = async (s: Server) => {
    try { await api('/api/preview', { machine, op: 'close', port: s.port }); toast.success(`:${s.port} ya no se publica`, { icon: <UnplugIcon className="size-4" /> }); load() }
    catch (e) { toast.error((e as Error).message) }
  }

  const dev = scan?.servers.filter(s => s.dev) ?? [], rest = scan?.servers.filter(s => !s.dev) ?? []
  const row = (s: Server) => (
    <div key={s.port} className="flex items-center gap-3 border-b border-white/5 px-3.5 py-3 last:border-0">
      <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl font-mono text-[11.5px] font-semibold', s.url ? 'bg-sky-400/15 text-sky-200' : 'bg-white/[0.05] text-muted-foreground')}>
        {s.port}
      </span>
      <button type="button" onClick={() => void view(s)} className="min-w-0 flex-1 text-left">
        <span className="block truncate text-[14px] font-medium">{s.title || (s.html ? 'Página sin título' : `HTTP ${s.status}`)}</span>
        <span className="block truncate font-mono text-[11px] text-muted-foreground/70">{s.process || '¿?'}{s.pid ? ` · pid ${s.pid}` : ''}{s.url ? ' · publicado' : ''}</span>
      </button>
      {s.url && (
        <button type="button" onClick={() => void unpublish(s)} aria-label="Dejar de publicar" className="grid size-9 place-items-center rounded-full text-muted-foreground/60 active:text-foreground">
          <UnplugIcon className="size-4" />
        </button>
      )}
      <button type="button" onClick={() => void view(s)} disabled={busy !== null}
        className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-sky-500/90 px-3.5 text-[13px] font-semibold text-background disabled:opacity-60">
        {busy === s.port ? <LoaderCircleIcon className="size-3.5 animate-spin" /> : <GlobeIcon className="size-3.5" />}Ver
      </button>
    </div>
  )

  return (
    <AnimatePresence>
      {open && (
        <motion.div key="previews" initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={spring}
          className="fixed inset-0 z-50 flex flex-col bg-background pt-[env(safe-area-inset-top)]">
          <header className="flex items-center gap-2 border-b border-white/6 px-2 py-2">
            <button type="button" onClick={onClose} aria-label="Cerrar" className="grid size-10 place-items-center rounded-full active:bg-white/5"><XIcon className="size-5" /></button>
            <span className="grid size-8 place-items-center rounded-xl bg-sky-400/12 text-sky-300"><GlobeIcon className="size-4" /></span>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold leading-tight">Web en desarrollo</p>
              <p className="truncate font-mono text-[11px] text-muted-foreground">{scan?.host ? `${machine} · ${scan.host}` : machine}</p>
            </div>
            <button type="button" onClick={load} aria-label="Buscar de nuevo" className="grid size-9 place-items-center rounded-full text-muted-foreground active:bg-white/5">
              <RefreshCwIcon className={cn('size-4', loading && 'animate-spin')} />
            </button>
          </header>
          {names.length > 1 && (
            <div className="scrollbar-none flex shrink-0 gap-2 overflow-x-auto px-4 pt-3">
              {names.map(m => (
                <button key={m} type="button" onClick={() => setMachine(m)}
                  className={cn('relative flex h-11 shrink-0 items-center gap-2 rounded-2xl border px-4 font-mono text-[13.5px]',
                    m === machine ? 'border-sky-400/60 text-sky-200' : 'border-white/10 text-muted-foreground')}>
                  {m === machine && <motion.span layoutId="pv-pc" className="absolute inset-0 -z-10 rounded-2xl bg-sky-400/10" transition={spring} />}
                  {machines.find(x => x.name === m)?.local ? <ServerIcon className="size-3.5" /> : <MonitorIcon className="size-3.5" />}{m}
                </button>
              ))}
            </div>
          )}
          <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-[max(env(safe-area-inset-bottom),24px)] pt-3 [&>*]:shrink-0">
            {err && <p className="rounded-2xl bg-red-500/10 p-3 text-[13px] text-red-300">{err}</p>}
            {!scan && !err && <p className="text-shine text-sm">Buscando servidores en {machine}…</p>}
            {scan && !scan.tailscale && <p className="rounded-2xl bg-warn/10 p-3 text-[13px] text-warn">Tailscale no está disponible en {machine}: no se pueden publicar sus puertos.</p>}
            {scan && dev.length === 0 && (
              <div className="mt-10 flex flex-col items-center gap-2 text-center text-muted-foreground">
                <GlobeIcon className="size-8 opacity-40" />
                <p className="text-[13.5px]">No hay ningún servidor de desarrollo corriendo en {machine}.</p>
                <p className="max-w-72 text-[12px] text-muted-foreground/70">Arráncalo desde la Terminal (por ejemplo <code className="font-mono">npm run dev</code>) o pídeselo a Claude.</p>
              </div>
            )}
            {dev.length > 0 && <div className="overflow-hidden rounded-2xl glass">{dev.map(row)}</div>}
            {rest.length > 0 && (
              <div>
                <button type="button" onClick={() => setOthers(o => !o)} className="mb-2 flex w-full items-center gap-2 px-1 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Otros programas <span className="font-mono text-[11px] font-normal">{rest.length}</span>
                  <ChevronDownIcon className={cn('ml-auto size-3.5 transition-transform', others && 'rotate-180')} />
                </button>
                {others && <div className="overflow-hidden rounded-2xl glass">{rest.map(row)}</div>}
              </div>
            )}
            {scan && <p className="px-1 text-[11px] text-muted-foreground/60">Se publica solo dentro de tu tailnet. Lo que abres sigue publicado hasta que lo desconectas.</p>}
          </main>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
