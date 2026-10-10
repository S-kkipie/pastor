import { BellRingIcon, CircleCheckIcon, DownloadIcon, KeyRoundIcon, MessageCircleQuestionIcon, XIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { CapApp } from '@/lib/capapp'
import { api, isNative } from '@/lib/api'
import { checkUpdate, downloadUpdate, startAlerts, takeTappedSession, type UpdateCheck } from '@/lib/native'

type Alert = { id: string; t: number; session: string; sessionTitle: string; machine: string; kind: 'done' | 'question' | 'permission'; title: string; body: string }

// The same alerts the Android service notifies, while the app is open: a
// toast for each (except the session already on screen), with "Ver".
export function useAlerts(enabled: boolean, current: string | null, open: (id: string) => void) {
  const since = useRef(0)
  const cur = useRef(current)
  cur.current = current
  useEffect(() => {
    if (!enabled) return
    let alive = true
    const tick = async () => {
      try {
        const r = await api<{ alerts: Alert[]; now: number }>(`/api/alerts?since=${since.current}`)
        if (!alive) return
        if (since.current === 0) { since.current = r.now; return } // the first look only sets the clock
        for (const a of r.alerts) {
          since.current = Math.max(since.current, a.t)
          if (a.session === cur.current || document.hidden) continue
          const Icon = a.kind === 'done' ? CircleCheckIcon : a.kind === 'question' ? MessageCircleQuestionIcon : KeyRoundIcon
          const show = a.kind === 'done' ? toast.success : toast.warning
          show(a.title, { description: `${a.body}${a.machine ? ` · ${a.machine}` : ''}`, icon: <Icon className="size-4" />,
            duration: a.kind === 'done' ? 6000 : 12000, action: { label: 'Ver', onClick: () => open(a.session) } })
          navigator.vibrate?.(a.kind === 'done' ? 40 : [30, 60, 30])
        }
      } catch { /* next tick */ }
    }
    void tick()
    const t = setInterval(tick, 6000)
    return () => { alive = false; clearInterval(t) }
  }, [enabled, open])
}

// The Android app: start the alerts service, open a tapped notification's
// session, and look for a newer APK on start, on coming back, and every 30 min.
export function useNativeShell(token: string, open: (id: string) => void) {
  const [update, setUpdate] = useState<UpdateCheck>(null)
  useEffect(() => {
    if (!isNative() || !token) return
    void startAlerts()
    const look = async () => {
      const s = await takeTappedSession()
      if (s) open(s)
      setUpdate(await checkUpdate())
    }
    void look()
    let remove: (() => void) | undefined
    void CapApp.addListener('resume', () => void look()).then(h => { remove = () => void h.remove() })
    const t = setInterval(() => void checkUpdate().then(setUpdate), 30 * 60_000)
    return () => { remove?.(); clearInterval(t) }
  }, [token, open])
  return { update, dismiss: () => setUpdate(null) }
}

export function UpdateBanner({ update, onDismiss }: { update: UpdateCheck; onDismiss: () => void }) {
  return (
    <AnimatePresence>
      {update && (
        <motion.div initial={{ y: -80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -80, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 32 }}
          className="fixed inset-x-3 top-[max(env(safe-area-inset-top),10px)] z-[70] flex items-center gap-3 rounded-2xl border border-emerald-400/30 bg-popover/95 p-3 shadow-2xl backdrop-blur-xl">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-400/15 text-emerald-300"><BellRingIcon className="size-5" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-semibold">Nueva versión de Pastor</span>
            <span className="block truncate text-[12px] text-muted-foreground">
              {update.current.name} → {update.latest.versionName}{update.latest.size ? ` · ${(update.latest.size / 1048576).toFixed(1)} MB` : ''}
            </span>
          </span>
          <button type="button" onClick={() => { downloadUpdate(); onDismiss() }}
            className="flex h-10 items-center gap-1.5 rounded-xl bg-emerald-500 px-3 text-[13px] font-semibold text-white active:scale-95">
            <DownloadIcon className="size-4" />Actualizar
          </button>
          <button type="button" onClick={onDismiss} aria-label="Luego" className="grid size-8 place-items-center rounded-full text-muted-foreground"><XIcon className="size-4" /></button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
