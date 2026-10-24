import { ActivityIcon, BotIcon, ChevronLeftIcon, LoaderCircleIcon, MessageCircleIcon, QrCodeIcon, Settings2Icon, ShieldCheckIcon, SmartphoneIcon, SparklesIcon, XIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { api } from '@/lib/api'
import { useBackClose } from '@/lib/back'
import { ago } from '@/lib/format'
import type { AgentActivity, AgentChannel, AgentConfig, AgentGroup, AgentStatus } from '@/lib/types'
import { cn } from '@/lib/utils'

import { HermesChat } from './hermeschat'
import { PetLane } from './pet/PetLane'
import type { Walker } from './pet/walker'

const spring = { type: 'spring', stiffness: 380, damping: 38 } as const
const GROUPS: [AgentGroup, string][] = [['sessions', 'Parar y cerrar sesiones'], ['routines', 'Borrar rutinas'], ['terminal', 'Terminal y Bash'], ['files', 'Escribir archivos'], ['whatsapp', 'WhatsApp a otras personas']]
const WATCH: [keyof AgentConfig['vigilante'], string][] = [['needs', 'Te necesita'], ['done', 'Terminó'], ['failures', 'Fallos'], ['routines', 'Rutinas'], ['daily', 'Resumen diario']]
const WA: Record<AgentStatus['whatsapp']['state'], [string, string]> = {
  connected: ['Conectado', 'bg-emerald-400'], connecting: ['Conectando…', 'bg-sky-400 animate-pulse'], disconnected: ['Reconectando…', 'bg-amber-400 animate-pulse'], logged_out: ['Sin vincular', 'bg-amber-400'],
}

export function useAgentStatus(active = true) {
  const [status, setStatus] = useState<AgentStatus | null>(null)
  const [config, setConfig] = useState<AgentConfig | null>(null)
  const [missing, setMissing] = useState(false)
  const refresh = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([api<AgentStatus>('/api/agent?part=status'), api<AgentConfig>('/api/agent?part=config')])
      setStatus(s); setConfig(c); setMissing(false)
    } catch { setMissing(true) }
  }, [])
  useEffect(() => {
    if (!active) return
    void refresh()
    const t = setInterval(() => void refresh(), 10_000)
    return () => clearInterval(t)
  }, [active, refresh])
  return { status, config, missing, refresh, setConfig }
}

export function AgentScreen({ open, onClose, onOpenSession }: { open: boolean; onClose: () => void; onOpenSession: (id: string) => void }) {
  useBackClose(open, onClose)
  const { status, config, missing, refresh, setConfig } = useAgentStatus(open)
  const [tab, setTab] = useState<'chats' | 'activity'>('chats')
  const [settings, setSettings] = useState(false)
  const [activity, setActivity] = useState<AgentActivity[]>([])
  const [opening, setOpening] = useState<string | null>(null)
  const [chat, setChat] = useState<AgentChannel | null>(null)
  const hermes = status?.backend === 'hermes'

  useEffect(() => { if (open && tab === 'activity') api<AgentActivity[]>('/api/agent?part=activity').then(setActivity, () => {}) }, [open, tab])

  const openChannel = async ({ id, sessionId }: AgentChannel) => {
    if (sessionId) { onClose(); onOpenSession(sessionId); return }
    // Hermes's chats are not sessions of the hub: they open in their own view.
    if (hermes) { setChat(status.channels.find(c => c.id === id) ?? null); return }
    setOpening(id)
    try { const r = await api<{ sessionId: string }>('/api/agent', { op: 'channel', channel: id }); onClose(); onOpenSession(r.sessionId) }
    catch (e) { toast.error((e as Error).message) }
    finally { setOpening(null) }
  }
  const save = async (patch: Partial<AgentConfig> | Record<string, unknown>) => {
    try { setConfig(await api<AgentConfig>('/api/agent', { op: 'config', ...patch })); void refresh() }
    catch (e) { toast.error((e as Error).message) }
  }
  const wa = status ? WA[status.whatsapp.state] : null

  return (
    <AnimatePresence>
      {open && (
        <motion.div key="agent" initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={spring}
          className="fixed inset-0 z-50 flex flex-col bg-background pt-[env(safe-area-inset-top)]">
          <header className="flex items-center gap-2 border-b border-white/6 px-2 py-2">
            <button type="button" onClick={onClose} aria-label="Cerrar" className="grid size-10 place-items-center rounded-full active:bg-white/5"><XIcon className="size-5" /></button>
            <span className="grid size-8 place-items-center rounded-xl bg-violet-500/15 text-violet-300"><SparklesIcon className="size-4" /></span>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold leading-tight">{hermes ? 'Hermes' : 'Agente'}</p>
              <p className="flex items-center gap-1.5 truncate text-[11.5px] text-muted-foreground">
                {wa && <span className={cn('size-1.5 rounded-full', wa[1])} />}
                {missing ? 'No está instalado en este hub' : !status ? 'Cargando…' : `${status.enabled ? 'Activo' : 'Apagado'} · WhatsApp ${wa?.[0].toLowerCase()}`}
              </p>
            </div>
            <button type="button" onClick={() => setSettings(true)} disabled={!config} aria-label="Ajustes del agente" className="grid size-10 place-items-center rounded-full text-muted-foreground active:bg-white/5"><Settings2Icon className="size-4" /></button>
          </header>
          <div className="px-4 pt-3">
            <div className="relative flex rounded-full p-0.5 glass">
              {(['chats', 'activity'] as const).map(t => (
                <button key={t} type="button" onClick={() => setTab(t)} className={cn('relative z-10 flex flex-1 items-center justify-center gap-1.5 py-1.5 text-[12.5px] font-medium', tab === t ? 'text-foreground' : 'text-muted-foreground')}>
                  {tab === t && <motion.span layoutId="agent-tab" className="absolute inset-0 -z-10 rounded-full bg-white/10" transition={spring} />}
                  {t === 'chats' ? <><MessageCircleIcon className="size-3.5" />Chats</> : <><ActivityIcon className="size-3.5" />Actividad</>}
                </button>
              ))}
            </div>
          </div>
          <main className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-4 pb-[max(env(safe-area-inset-bottom),24px)] pt-3 [&>*]:shrink-0">
            {status?.whatsapp.state === 'logged_out' && (
              <button type="button" onClick={() => setSettings(true)} className="flex items-center gap-3 rounded-2xl border border-amber-400/40 bg-amber-400/10 px-3.5 py-3 text-left text-[13px] text-amber-100">
                <QrCodeIcon className="size-5 shrink-0" /><span>WhatsApp no está vinculado. Toca para escanear el QR.</span>
              </button>
            )}
            {tab === 'chats' && status?.channels.map(c => (
              <ChannelCard key={c.id} c={c} opening={opening === c.id} onOpen={() => void openChannel(c)} />
            ))}
            {tab === 'activity' && (activity.length ? (
              <div className="overflow-hidden rounded-2xl glass">
                {activity.map((a, i) => (
                  <div key={`${a.at}-${i}`} className="flex gap-3 border-b border-white/5 px-3.5 py-2.5 last:border-0">
                    <span className="min-w-0 flex-1 text-[13px]">{a.text}</span>
                    <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground/60">{ago(a.at)}</span>
                  </div>
                ))}
              </div>
            ) : <p className="mt-10 text-center text-[13px] text-muted-foreground">Todavía no hizo nada por su cuenta.</p>)}
          </main>
          <AnimatePresence>{settings && config && status && <AgentSettings config={config} status={status} onSave={save} onClose={() => setSettings(false)} />}</AnimatePresence>
          <AnimatePresence>{chat && <HermesChat channel={chat.id} label={chat.label} onClose={() => { setChat(null); void refresh() }} />}</AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// One conversation of the agent, with its own Clawd: it works while the
// channel is busy and, when a message lands, rides the card and reads it.
function ChannelCard({ c, opening, onOpen }: { c: AgentChannel; opening: boolean; onOpen: () => void }) {
  const pet = useRef<Walker | null>(null)
  const seen = useRef(c.lastAt)
  useEffect(() => {
    if (c.lastAt && c.lastAt !== seen.current) pet.current?.react('mail')
    seen.current = c.lastAt
  }, [c.lastAt])
  return (
    <button type="button" onClick={onOpen}
      className="relative flex items-center gap-3 overflow-hidden rounded-3xl p-3.5 pb-11 text-left glass active:bg-white/[0.03]">
      <span className={cn('absolute inset-y-3 left-0 w-1 rounded-r-full', c.busy ? 'animate-pulse bg-coral' : c.online ? 'bg-emerald-400/70' : 'bg-white/15')} />
      <span className={cn('grid size-11 shrink-0 place-items-center rounded-2xl', c.id === 'app' ? 'bg-violet-500/15 text-violet-300' : 'bg-emerald-400/12 text-emerald-300')}>
        {c.id === 'app' ? <BotIcon className="size-5" /> : <SmartphoneIcon className="size-5" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2"><span className="truncate text-[15px] font-semibold">{c.label}</span>
          {c.lastAt && <span className="ml-auto shrink-0 font-mono text-[10.5px] text-muted-foreground/60">{ago(c.lastAt)}</span>}</span>
        <span className={cn('block truncate text-[12.5px]', c.busy ? 'text-shine' : 'text-muted-foreground')}>
          {c.busy ? 'Trabajando…' : c.lastText || (c.id === 'app' ? 'Escríbele desde aquí' : 'Sin mensajes todavía')}
        </span>
      </span>
      {opening && <LoaderCircleIcon className="size-4 animate-spin text-muted-foreground" />}
      <PetLane mood={c.busy ? 'working' : c.lastAt ? 'idle' : 'sleep'} hat={c.id === 'app' ? 'party' : undefined}
        className="absolute bottom-1.5 left-4 right-4 h-8" onReady={w => { pet.current = w }} />
    </button>
  )
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className={cn('relative h-6 w-11 shrink-0 rounded-full transition-colors', on ? 'bg-violet-400' : 'bg-white/15')}>
      <motion.span layout transition={spring} className={cn('absolute top-0.5 size-5 rounded-full bg-white shadow', on ? 'right-0.5' : 'left-0.5')} />
    </button>
  )
}

function AgentSettings({ config, status, onSave, onClose }: { config: AgentConfig; status: AgentStatus; onSave: (p: Record<string, unknown>) => Promise<void>; onClose: () => void }) {
  useBackClose(true, onClose)
  const [custom, setCustom] = useState(!config.permissions.total)
  const [qr, setQr] = useState<string | null>(null)
  const [numbers, setNumbers] = useState(config.allowed.join(', '))
  const [confirmRelink, setConfirmRelink] = useState(false)
  useEffect(() => {
    if (status.whatsapp.state !== 'logged_out') { setQr(null); return }
    const load = () => api<{ dataUrl: string | null }>('/api/agent?part=qr').then(r => setQr(r.dataUrl), () => {})
    void load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [status.whatsapp.state])
  const card = 'overflow-hidden rounded-3xl glass'
  const row = 'flex items-center gap-3 border-t border-white/5 px-3.5 py-3 first:border-0'
  const head = 'px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'
  const v = config.vigilante
  const hermes = status.backend === 'hermes'

  return (
    <motion.div key="agent-settings" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={spring}
      className="fixed inset-0 z-[55] flex flex-col bg-background pt-[env(safe-area-inset-top)]">
      <header className="flex items-center gap-2 border-b border-white/6 px-2 py-2">
        <button type="button" onClick={onClose} aria-label="Volver" className="grid size-10 place-items-center rounded-full active:bg-white/5"><ChevronLeftIcon className="size-5" /></button>
        <p className="flex-1 text-[15px] font-semibold">{hermes ? 'Ajustes de Hermes' : 'Ajustes del agente'}</p>
      </header>
      <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-[max(env(safe-area-inset-bottom),24px)] pt-4 [&>*]:shrink-0">
        <div className={card}>
          <div className={row}><span className="min-w-0 flex-1"><span className="block text-[15px] font-semibold">Activo</span><span className="block text-[11.5px] text-muted-foreground">{hermes ? 'Hermes responde WhatsApp y la app (hermes pause / resume)' : 'Escucha WhatsApp y la app'}</span></span>
            <Switch on={config.enabled} label="Activo" onChange={on => void onSave({ enabled: on })} /></div>
        </div>

        {!hermes && <section><p className={head}>Permisos</p><div className={card}>
          <div className={row}><ShieldCheckIcon className="size-4 shrink-0 text-violet-300" /><span className="min-w-0 flex-1"><span className="block text-[14px]">Permiso total</span><span className="block text-[11.5px] text-muted-foreground">Hace todo sin preguntar</span></span>
            <Switch on={config.permissions.total} label="Permiso total" onChange={on => { setCustom(!on); void onSave({ permissions: { total: on } }) }} /></div>
          {custom && GROUPS.map(([g, label]) => (
            <div key={g} className={row}><span className="min-w-0 flex-1 text-[13.5px]">{label}</span>
              <div className="flex rounded-full p-0.5 glass">
                {(['libre', 'pregunta'] as const).map(val => (
                  <button key={val} type="button" onClick={() => void onSave({ permissions: { groups: { [g]: val } } })}
                    className={cn('rounded-full px-2.5 py-1 text-[11.5px]', config.permissions.groups[g] === val ? 'bg-white/10 text-foreground' : 'text-muted-foreground')}>{val}</button>
                ))}
              </div></div>
          ))}
        </div></section>}

        <section><p className={head}>Vigilante · te escribe solo</p><div className={cn(card, 'p-3.5')}>
          <div className="flex flex-wrap gap-1.5">
            {WATCH.map(([k, label]) => (
              <button key={k} type="button" onClick={() => void onSave({ vigilante: { [k]: !v[k] } })}
                className={cn('rounded-full border px-3 py-1.5 text-[12.5px]', v[k] ? 'border-violet-400/60 bg-violet-500/15 text-violet-100' : 'border-white/10 text-muted-foreground')}>{label}</button>
            ))}
          </div>
          {v.daily && <input type="time" defaultValue={v.dailyTime} onBlur={e => void onSave({ vigilante: { dailyTime: e.target.value, tz: new Date().getTimezoneOffset() } })}
            className="mt-3 w-full rounded-2xl border border-white/8 bg-white/[0.04] px-3 py-2 font-mono text-[16px] outline-none" />}
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[12px] text-muted-foreground">Enviar a:
            {config.allowed.map(n => (
              <button key={n} type="button" onClick={() => void onSave({ vigilante: { to: v.to.includes(n) ? v.to.filter(x => x !== n) : [...v.to, n] } })}
                className={cn('rounded-full border px-2.5 py-1 font-mono text-[11.5px]', v.to.includes(n) ? 'border-violet-400/60 text-violet-100' : 'border-white/10')}>{n.slice(2)}</button>
            ))}
          </div>
        </div></section>

        <section><p className={head}>WhatsApp</p><div className={card}>
          <div className={row}><span className={cn('size-2 shrink-0 rounded-full', WA[status.whatsapp.state][1])} /><span className="min-w-0 flex-1"><span className="block font-mono text-[13.5px]">+{status.whatsapp.me ?? '51907698977'}</span>
            <span className="block text-[11.5px] text-muted-foreground">{WA[status.whatsapp.state][0]}{status.whatsapp.since ? ` · desde ${ago(status.whatsapp.since)}` : ''}</span></span></div>
          {qr && <div className="grid place-items-center border-t border-white/5 bg-white p-4"><img src={qr} alt="QR para vincular WhatsApp" className="size-56" /></div>}
          {qr && <p className="border-t border-white/5 px-3.5 py-2.5 text-[11.5px] text-muted-foreground">En el teléfono del bot: WhatsApp → Dispositivos vinculados → Vincular un dispositivo.</p>}
          {hermes ? (
            <div className={row}><span className="min-w-0 flex-1"><span className="block text-[13.5px]">Pueden escribirle (solo DMs)</span>
              <span className="mt-1 block font-mono text-[12.5px]">{config.allowed.join(', ') || '—'}</span>
              <span className="mt-1 block text-[11.5px] text-muted-foreground">Los define Hermes: WHATSAPP_ALLOWED_USERS en ~/.hermes/.env. Para volver a vincular: hermes whatsapp.</span></span></div>
          ) : <>
          <div className={row}><span className="min-w-0 flex-1"><span className="block text-[13.5px]">Pueden escribirle (solo DMs)</span>
            <input value={numbers} onChange={e => setNumbers(e.target.value)} onBlur={() => void onSave({ allowed: numbers.split(/[,\s]+/).filter(Boolean) })}
              className="mt-1 w-full bg-transparent font-mono text-[16px] outline-none sm:text-[12.5px]" /></span></div>
          {confirmRelink ? (
            <div className={row}>
              <button type="button" onClick={() => { setConfirmRelink(false); void api('/api/agent', { op: 'relink' }).then(() => toast.info('Esperando el QR…'), e => toast.error((e as Error).message)) }}
                className="flex-1 rounded-full bg-red-500/90 px-3 py-1.5 text-left text-[12.5px] font-semibold text-white">Confirmar: se cierra la sesión de WhatsApp del bot</button>
              <button type="button" onClick={() => setConfirmRelink(false)} aria-label="Cancelar" className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground active:bg-white/5"><XIcon className="size-3.5" /></button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmRelink(true)} className={cn(row, 'w-full text-left text-[13.5px] text-amber-200')}>
              <QrCodeIcon className="size-4" />Volver a vincular</button>
          )}
          </>}
        </div></section>

        {!hermes && <section><p className={head}>Sesiones</p><div className={card}>
          <div className={row}><span className="min-w-0 flex-1 text-[13.5px]">Dormir tras inactividad</span>
            <select defaultValue={config.sleepMinutes} onChange={e => void onSave({ sleepMinutes: Number(e.target.value) })} className="rounded-xl bg-white/[0.06] px-2 py-1 font-mono text-[13px]">
              {[10, 30, 60, 180].map(m => <option key={m} value={m}>{m} min</option>)}
            </select></div>
          <div className={row}><span className="min-w-0 flex-1 text-[13.5px]">Mostrar sus sesiones en mi panel</span>
            <Switch on={config.showInPanel} label="Mostrar en el panel" onChange={on => void onSave({ showInPanel: on })} /></div>
        </div></section>}
      </main>
    </motion.div>
  )
}
