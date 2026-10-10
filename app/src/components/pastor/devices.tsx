import {
  BellIcon, CheckIcon, CopyIcon, DownloadIcon, HistoryIcon, LinkIcon, LoaderCircleIcon, LogOutIcon, MonitorIcon, PawPrintIcon, PencilIcon, RefreshCwIcon,
  ServerIcon, SmartphoneIcon, SparkleIcon, TrashIcon, UnlinkIcon, XIcon,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import QRCode from 'qrcode'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { api, auth, isNative, store } from '@/lib/api'
import { PastorNotify, startAlerts } from '@/lib/native'
import { ago } from '@/lib/format'
import { HISTORY_LIMITS } from '@/lib/hooks'
import { cn } from '@/lib/utils'

import { Clawd } from './clawd'
import { useAvatarKind } from './avatar'
import { PetLane } from './pet/PetLane'
import { PET_HATS, PET_KINDS, PET_LEVELS, setPetPref, usePetPrefs } from './pet/settings'
import { useBackClose } from '@/lib/back'

type Device = { name: string; paired: string | null; lastSeen: number | null; current: boolean; hub: boolean }
type Peer = { name: string; url: string; linked: string | null; online: boolean; version: number | null }
type Admin = {
  machine: string; version: number; pairCode: string; url: string | null
  devices: Device[]; peers: Peer[]; awayDefault: boolean; sessions: number
}

const spring = { type: 'spring', stiffness: 380, damping: 34 } as const

function Section({ title, icon: Icon, right, children }: { title: string; icon: typeof MonitorIcon; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2 px-1">
        <Icon className="size-3.5 text-coral" />
        <span className="text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</span>
        <span className="ml-auto">{right}</span>
      </div>
      {children}
    </section>
  )
}

// A QR the new phone scans: this page's address with the code, so pairing is
// one tap (the pair screen reads ?pair=).
function PairQr({ url, code }: { url: string; code: string }) {
  const [svg, setSvg] = useState('')
  useEffect(() => {
    QRCode.toString(`${url.replace(/\/+$/, '')}/?pair=${code}`, { type: 'svg', margin: 1, color: { dark: '#1b1214', light: '#fff4ec' } })
      .then(setSvg, () => setSvg(''))
  }, [url, code])
  if (!svg) return null
  return <div className="size-36 shrink-0 overflow-hidden rounded-2xl bg-[#fff4ec] p-1.5" dangerouslySetInnerHTML={{ __html: svg }} />
}

// The Android app's notifications with the app closed: on/off, and the
// battery list where Android can be told to let it run.
function NativeAlerts() {
  const [st, setSt] = useState<{ active: boolean; granted?: boolean } | null>(null)
  useEffect(() => { void PastorNotify.status().then(setSt, () => setSt(null)) }, [])
  const flip = async () => {
    try {
      const r = st?.active ? await PastorNotify.stop() : await startAlerts()
      setSt(r ?? (await PastorNotify.status()))
      if (r && !r.active && !st?.active) toast.warning('Permite las notificaciones de Pastor en Android', { icon: <BellIcon className="size-4" /> })
    } catch (e) { toast.error((e as Error).message) }
  }
  return (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={() => void flip()}
        className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2.5 text-left active:bg-white/5">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-coral/12 text-coral"><BellIcon className="size-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-medium">Avisos con la app cerrada</span>
          <span className="block text-[11.5px] leading-snug text-muted-foreground">Cuando Claude termina (subagentes incluidos), pregunta algo o pide un permiso</span>
        </span>
        <span className={cn('relative h-6 w-10 shrink-0 rounded-full transition-colors', st?.active ? 'bg-coral' : 'bg-white/12')}>
          <span className={cn('absolute top-0.5 size-5 rounded-full bg-white shadow transition-all', st?.active ? 'right-0.5' : 'left-0.5')} />
        </span>
      </button>
      <button type="button" onClick={() => void PastorNotify.batterySettings()} className="px-1 text-left text-[11.5px] text-muted-foreground underline-offset-2 active:underline">
        ¿No llegan con el teléfono en reposo? Quita a Pastor de la optimización de batería →
      </button>
    </div>
  )
}

// This phone's pet: a preview to pet or fling, which pet, Clawd's hat, and
// how lively they all are.
function PetSection() {
  const p = usePetPrefs()
  const chip = (on: boolean) => cn('rounded-full border px-3 py-1.5 text-[12.5px] transition-colors',
    on ? 'border-coral/60 bg-coral/15 text-coral' : 'border-white/10 text-muted-foreground')
  return (
    <Section title="Tu mascota" icon={PawPrintIcon}>
      <div className="flex flex-col gap-3 rounded-2xl p-3.5 glass">
        <div className="relative h-28 rounded-2xl bg-white/[0.03]">
          <p className="pt-2 text-center text-[11.5px] text-muted-foreground/70">
            {p.level !== 'still' ? 'Tócala o lánzala' : p.reduced ? 'Quieta: el sistema pide reducir el movimiento' : 'Quieta'}
          </p>
          <PetLane mood="idle" scale={2.6} className="absolute inset-x-3 bottom-2 h-16" />
        </div>
        <div>
          <p className="mb-2 text-[13px] font-medium">Mascota</p>
          <div className="flex flex-wrap gap-1.5">
            {PET_KINDS.map(([k, label]) => (
              <button key={k} type="button" onClick={() => setPetPref('kind', k)} className={chip(p.kind === k)}>{label}</button>
            ))}
          </div>
        </div>
        {p.kind === 'clawd' && (
          <div>
            <p className="mb-2 text-[13px] font-medium">Disfraz</p>
            <div className="flex flex-wrap gap-1.5">
              {PET_HATS.map(([h, label]) => (
                <button key={h || 'none'} type="button" onClick={() => setPetPref('hat', h)} className={chip(p.hat === h)}>{label}</button>
              ))}
            </div>
          </div>
        )}
        <div>
          <p className="mb-2 text-[13px] font-medium">Animaciones</p>
          <div className="flex rounded-full p-0.5 glass">
            {PET_LEVELS.map(([l, label]) => (
              <button key={l} type="button" onClick={() => setPetPref('level', l)}
                className={cn('flex-1 rounded-full py-1.5 text-[12.5px] transition-colors', p.chosenLevel === l ? 'bg-coral/15 text-coral' : 'text-muted-foreground')}>
                {label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground/70">"Con vida": caminan y hacen cosas solas. "Tranquilas": solo reaccionan. "Quietas": sin movimiento.</p>
        </div>
      </div>
    </Section>
  )
}

// Paired phones, linked PCs, the pairing code and this phone's preferences.
export function DevicesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [machines, setMachines] = useState<string[]>([])
  const [machine, setMachine] = useState('')
  useBackClose(open, onClose)
  const [hub, setHub] = useState('')
  const [a, setA] = useState<Admin | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkCode, setLinkCode] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [confirm, setConfirm] = useState<string | null>(null)
  const [limit, setLimit] = useState<number>(() => store.get('historyLimit', 100))
  const [avatar, setAvatar] = useAvatarKind()

  useEffect(() => {
    if (!open) return
    api<{ machine: string }>('/api/info').then(d => { setHub(d.machine); setMachine(m => m || d.machine) }, () => {})
    api<{ machines: string[] }>('/api/recent').then(d => setMachines(d.machines), () => {})
  }, [open])
  const load = useCallback(() => {
    if (!machine) return
    setErr('')
    api<Admin>(`/api/admin?machine=${encodeURIComponent(machine)}`).then(setA, e => { setA(null); setErr((e as Error).message) })
  }, [machine])
  useEffect(() => { if (open) load() }, [open, load])
  useEffect(() => { store.set('historyLimit', limit) }, [limit])

  const post = async (key: string, path: string, body: Record<string, unknown>) => {
    setBusy(key)
    try { const r = await api<Record<string, unknown>>(path, { machine, ...body }); load(); return r }
    catch (e) { toast.error((e as Error).message); return null }
    finally { setBusy(null) }
  }
  const revoke = async (d: Device) => {
    setConfirm(null)
    const r = await post(`rv:${d.name}`, '/api/admin/revoke', { name: d.name })
    if (!r) return
    toast.success(`${d.name} desemparejado`, { icon: <TrashIcon className="size-4" /> })
    if (r.self && machine === hub) auth.token = ''
  }
  const rename = async (d: Device) => {
    const to = newName.trim()
    setRenaming(null)
    if (!to || to === d.name) return
    if (await post(`rn:${d.name}`, '/api/admin/rename', { name: d.name, to })) toast.success('Nombre cambiado', { description: to, icon: <PencilIcon className="size-4" /> })
  }
  const link = async () => {
    const r = await post('link', '/api/admin/link', { url: /^https?:\/\//.test(linkUrl.trim()) ? linkUrl.trim() : `http://${linkUrl.trim()}`, code: linkCode })
    if (r) { toast.success(`PC enlazada: ${r.name}`, { icon: <LinkIcon className="size-4" /> }); setLinkUrl(''); setLinkCode('') }
  }
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast.success('Copiado', { icon: <CopyIcon className="size-4" /> }) } catch { toast.error('No se pudo copiar') }
  }
  const pageUrl = machine === hub ? auth.server || location.origin : a?.url || ''
  const field = 'flex items-center gap-2 rounded-2xl border border-white/8 bg-white/[0.04] px-3 focus-within:border-coral/50'
  const allMachines = [...new Set([hub, ...machines].filter(Boolean))]

  return (
    <AnimatePresence>
      {open && (
        <motion.div key="devices" initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={spring}
          className="fixed inset-0 z-50 flex flex-col bg-background pt-[env(safe-area-inset-top)]">
          <header className="flex items-center gap-2 border-b border-white/6 px-2 py-2">
            <button type="button" onClick={onClose} aria-label="Cerrar" className="grid size-10 place-items-center rounded-full active:bg-white/5"><XIcon className="size-5" /></button>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold leading-tight">Dispositivos y PCs</p>
              <p className="truncate font-mono text-[11px] text-muted-foreground">{a ? `${a.machine} · bridge v${a.version} · ${a.sessions} sesiones` : 'Cargando…'}</p>
            </div>
            <button type="button" onClick={load} aria-label="Recargar" className="grid size-9 place-items-center rounded-full text-muted-foreground active:bg-white/5"><RefreshCwIcon className="size-4" /></button>
          </header>

          {allMachines.length > 1 && (
            <div className="scrollbar-none flex shrink-0 gap-2 overflow-x-auto px-4 py-2.5">
              {allMachines.map(m => (
                <button key={m} type="button" onClick={() => { setA(null); setMachine(m) }}
                  className={cn('relative flex h-11 shrink-0 items-center gap-2 rounded-2xl border px-4 font-mono text-[13.5px]',
                    m === machine ? 'border-coral/70 text-coral' : 'border-white/10 text-muted-foreground')}>
                  {m === machine && <motion.span layoutId="dev-pc" className="absolute inset-0 -z-10 rounded-2xl bg-coral/15" transition={spring} />}
                  {m === hub ? <ServerIcon className="size-3.5" /> : <MonitorIcon className="size-3.5" />}{m}
                </button>
              ))}
            </div>
          )}

          <main className="flex min-h-0 flex-1 flex-col [&>*]:shrink-0 gap-6 overflow-y-auto px-4 pb-[max(env(safe-area-inset-bottom),24px)] pt-3">
            {err && <p className="rounded-2xl bg-red-500/10 p-3 text-[13px] text-red-300">{err}</p>}
            {!a && !err && <p className="text-shine text-sm">Leyendo {machine}…</p>}

            {a && (
              <Section title="Emparejar un teléfono" icon={SmartphoneIcon}
                right={<button type="button" onClick={() => void post('code', '/api/admin/code', {}).then(r => r && toast.info('Código nuevo', { icon: <RefreshCwIcon className="size-4" /> }))}
                  className="flex items-center gap-1 text-[11.5px] text-muted-foreground active:text-foreground">
                  {busy === 'code' ? <LoaderCircleIcon className="size-3 animate-spin" /> : <RefreshCwIcon className="size-3" />}renovar
                </button>}>
                <div className="flex items-center gap-4 rounded-3xl p-4 glass">
                  {pageUrl && <PairQr url={pageUrl} code={a.pairCode} />}
                  <div className="min-w-0 flex-1">
                    <button type="button" onClick={() => void copy(a.pairCode)} className="font-mono text-[30px] font-semibold tracking-[0.18em] text-coral">{a.pairCode}</button>
                    <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
                      {pageUrl ? 'Escanéalo con el otro teléfono, o abre la app y escribe el código.' : 'Escribe este código en la app del otro teléfono.'} Sirve una sola vez.
                    </p>
                    {pageUrl && <p className="mt-1.5 truncate font-mono text-[10.5px] text-muted-foreground/60">{pageUrl}</p>}
                  </div>
                </div>
              </Section>
            )}

            {a && (
              <Section title={`Dispositivos · ${a.devices.length}`} icon={SmartphoneIcon}>
                <div className="overflow-hidden rounded-2xl glass">
                  {a.devices.map(d => (
                    <div key={d.name} className="flex items-center gap-3 border-b border-white/5 px-3.5 py-3 last:border-0">
                      <span className={cn('grid size-9 shrink-0 place-items-center rounded-xl', d.current ? 'bg-coral/15 text-coral' : 'bg-white/[0.05] text-muted-foreground')}>
                        {d.hub ? <ServerIcon className="size-4" /> : <SmartphoneIcon className="size-4" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        {renaming === d.name ? (
                          <input value={newName} onChange={e => setNewName(e.target.value)} autoFocus onBlur={() => void rename(d)}
                            onKeyDown={e => { if (e.key === 'Enter') void rename(d); if (e.key === 'Escape') setRenaming(null) }}
                            className="w-full rounded-lg border border-coral/40 bg-transparent px-2 py-0.5 text-[14px] outline-none" />
                        ) : (
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-[14px] font-medium">{d.name}</span>
                            {d.current && <span className="shrink-0 rounded-full bg-coral/15 px-1.5 text-[10px] text-coral">este</span>}
                            {d.hub && <span className="shrink-0 rounded-full border border-white/10 px-1.5 text-[10px] text-muted-foreground">hub</span>}
                          </span>
                        )}
                        <span className="block font-mono text-[10.5px] text-muted-foreground/70">
                          {d.lastSeen ? (Date.now() - d.lastSeen < 15_000 ? 'activo ahora' : `visto hace ${ago(d.lastSeen)}`) : 'sin actividad desde que arrancó el bridge'}
                          {d.paired ? ` · emparejado ${new Date(d.paired).toLocaleDateString()}` : ''}
                        </span>
                      </span>
                      {!d.hub && renaming !== d.name && (
                        <button type="button" onClick={() => { setRenaming(d.name); setNewName(d.name) }} aria-label="Renombrar"
                          className="grid size-8 place-items-center rounded-full text-muted-foreground active:bg-white/5"><PencilIcon className="size-3.5" /></button>
                      )}
                      {confirm === d.name ? (
                        <button type="button" onClick={() => void revoke(d)}
                          className="shrink-0 rounded-full bg-red-500/90 px-3 py-1 text-[12px] font-semibold text-white">
                          {busy === `rv:${d.name}` ? <LoaderCircleIcon className="size-3.5 animate-spin" /> : d.current ? 'Salir' : 'Quitar'}
                        </button>
                      ) : (
                        <button type="button" onClick={() => setConfirm(d.name)} aria-label="Desemparejar"
                          className="grid size-8 place-items-center rounded-full text-red-300/80 active:bg-red-500/10">
                          {d.current ? <LogOutIcon className="size-3.5" /> : <TrashIcon className="size-3.5" />}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <p className="px-1 text-[11px] text-muted-foreground/60">
                  Los marcados "hub" son otros bridges que se conectan a {a.machine}. Si quitas uno, esa PC deja de verse desde allí.
                </p>
              </Section>
            )}

            {a && machine === hub && (
              <Section title={`PCs enlazadas · ${a.peers.length}`} icon={MonitorIcon}>
                {a.peers.length > 0 && (
                  <div className="overflow-hidden rounded-2xl glass">
                    {a.peers.map(pc => (
                      <div key={pc.name} className="flex items-center gap-3 border-b border-white/5 px-3.5 py-3 last:border-0">
                        <span className="relative grid size-9 shrink-0 place-items-center rounded-xl bg-white/[0.05]">
                          <MonitorIcon className="size-4 text-muted-foreground" />
                          <span className={cn('absolute -right-0.5 -top-0.5 size-2.5 rounded-full ring-2 ring-background', pc.online ? 'bg-emerald-400' : 'bg-white/25')} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-mono text-[13.5px]">{pc.name}</span>
                          <span className="block truncate font-mono text-[10.5px] text-muted-foreground/70">
                            {pc.online ? `en línea · v${pc.version}` : 'sin conexión'} · {pc.url}
                          </span>
                        </span>
                        {confirm === `pc:${pc.name}` ? (
                          <button type="button" onClick={() => { setConfirm(null); void post(`ul:${pc.name}`, '/api/admin/unlink', { name: pc.name }).then(r => r && toast.success(`${pc.name} desenlazada`, { icon: <UnlinkIcon className="size-4" /> })) }}
                            className="shrink-0 rounded-full bg-red-500/90 px-3 py-1 text-[12px] font-semibold text-white">Desenlazar</button>
                        ) : (
                          <button type="button" onClick={() => setConfirm(`pc:${pc.name}`)} aria-label="Desenlazar"
                            className="grid size-8 place-items-center rounded-full text-red-300/80 active:bg-red-500/10"><UnlinkIcon className="size-3.5" /></button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex flex-col gap-2 rounded-2xl p-3 glass">
                  <p className="text-[12.5px] text-muted-foreground">Enlazar otra PC: en esa PC abre Claude Code y escribe <code className="rounded bg-white/8 px-1 font-mono text-[11.5px] text-foreground">/pastor</code> para ver su URL y su código.</p>
                  <label className={field}>
                    <LinkIcon className="size-4 shrink-0 text-muted-foreground" />
                    <input value={linkUrl} onChange={e => setLinkUrl(e.target.value)} placeholder="http://pc.tailnet/" inputMode="url"
                      spellCheck={false} autoCapitalize="off" autoCorrect="off" className="h-10 min-w-0 flex-1 bg-transparent font-mono text-[16px] outline-none sm:text-[13px]" />
                  </label>
                  <div className="flex gap-2">
                    <input value={linkCode} onChange={e => setLinkCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="Código" inputMode="numeric"
                      className="h-10 w-32 rounded-2xl border border-white/8 bg-white/[0.04] px-3 text-center font-mono text-[16px] tracking-widest outline-none focus:border-coral/50" />
                    <button type="button" disabled={!linkUrl.trim() || linkCode.length !== 6 || busy === 'link'} onClick={() => void link()}
                      className="flex h-10 flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-coral to-[oklch(0.62_0.15_35)] text-[14px] font-semibold text-background disabled:opacity-40">
                      {busy === 'link' ? <LoaderCircleIcon className="size-4 animate-spin" /> : <LinkIcon className="size-4" />}Enlazar
                    </button>
                  </div>
                </div>
              </Section>
            )}

            <Section title="Este teléfono" icon={SparkleIcon}>
              <div className="flex flex-col gap-3 rounded-2xl p-3.5 glass">
                {isNative() && <NativeAlerts />}
                {!isNative() && (
                  <a href={`${auth.server}/pastor.apk`} download="pastor.apk"
                    className="flex items-center gap-3 rounded-2xl border border-emerald-400/25 bg-emerald-400/[0.06] px-3 py-2.5 active:bg-emerald-400/10">
                    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-emerald-400/15 text-emerald-300"><DownloadIcon className="size-4" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px] font-medium">Instalar la app de Android</span>
                      <span className="block text-[11.5px] text-muted-foreground">Descarga pastor.apk desde este bridge e instálala (permite "orígenes desconocidos")</span>
                    </span>
                  </a>
                )}
                <div>
                  <p className="mb-2 flex items-center gap-1.5 text-[13px] font-medium"><HistoryIcon className="size-3.5 text-coral" />Historial al abrir una sesión</p>
                  <div className="flex gap-1.5">
                    {HISTORY_LIMITS.map(n => (
                      <button key={n} type="button" onClick={() => setLimit(n)}
                        className={cn('flex-1 rounded-xl border py-1.5 font-mono text-[12.5px] transition-colors',
                          limit === n ? 'border-coral/60 bg-coral/15 text-coral' : 'border-white/10 text-muted-foreground')}>
                        {limit === n && <CheckIcon className="mr-0.5 inline size-3" />}{n}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[11px] text-muted-foreground/70">Mensajes y herramientas que llegan al abrir; el resto con "Cargar anteriores".</p>
                </div>
                <div>
                  <p className="mb-2 text-[13px] font-medium">Avatar</p>
                  <div className="flex gap-2">
                    {(['clawd', 'orb'] as const).map(k => (
                      <button key={k} type="button" onClick={() => setAvatar(k)}
                        className={cn('flex flex-1 items-center justify-center gap-2 rounded-xl border py-2 text-[13px]',
                          avatar === k ? 'border-coral/60 bg-coral/15 text-coral' : 'border-white/10 text-muted-foreground')}>
                        {k === 'clawd' ? <><Clawd mood="idle" size={28} />Clawd</> : <><SparkleIcon className="size-4" />Orbe</>}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </Section>

            <PetSection />
          </main>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
