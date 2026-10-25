import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useState } from 'react'
import { CircleAlertIcon, CircleCheckIcon, InfoIcon, LoaderCircleIcon, TriangleAlertIcon } from 'lucide-react'
import { Toaster } from 'sonner'

import { WebViewerHost } from '@/components/pastor/webviewer'

import { auth, isNative } from '@/lib/api'
import { closeTopOverlay, onPopOverlay } from '@/lib/back'
import { UpdateBanner, useAlerts, useNativeShell } from '@/components/pastor/alerts'
import { PairScreen } from '@/screens/pair'
import { SessionScreen } from '@/screens/session'
import { SessionsScreen } from '@/screens/sessions'
import { App as CapApp } from '@capacitor/app'

// Two screens and a pairing gate. A session is a history entry, so the
// phone's back gesture (and Android's back button in a native shell) returns
// to the list.
export default function App() {
  const [token, setToken] = useState(auth.token)
  const [sid, setSid] = useState<string | null>(() => history.state?.sid ?? null)

  useEffect(() => {
    const onAuth = () => setToken(auth.token)
    const onPop = (e: PopStateEvent) => {
      if (onPopOverlay()) return // an overlay's own entry: it closed, the screen stays
      setSid((e.state as { sid?: string } | null)?.sid ?? null)
    }
    window.addEventListener('pastor:auth', onAuth)
    window.addEventListener('popstate', onPop)
    // Android's back button in the native app: close what is on top, then
    // leave the session, and from the dashboard send the app to the background.
    let remove: (() => void) | undefined
    if (isNative()) {
      void CapApp.addListener('backButton', () => {
        if (closeTopOverlay()) return
        if (history.state?.sid) history.back()
        else void CapApp.minimizeApp()
      }).then(h => { remove = () => void h.remove() })
    }
    return () => { window.removeEventListener('pastor:auth', onAuth); window.removeEventListener('popstate', onPop); remove?.() }
  }, [])

  const open = useCallback((id: string) => { history.pushState({ sid: id }, ''); setSid(id) }, [])
  useAlerts(!!token, sid, open)
  const { update, dismiss } = useNativeShell(token, open)
  const back = () => { if (history.state?.sid) history.back(); else setSid(null) }

  return (
    <div className="app-frame">
      <AnimatePresence mode="popLayout" initial={false}>
        {!token ? (
          <motion.div key="pair" exit={{ opacity: 0 }}><PairScreen /></motion.div>
        ) : sid ? (
          <motion.div key={`s-${sid}`} initial={{ x: '30%', opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: '30%', opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 36 }}>
            <SessionScreen id={sid} onBack={back} />
          </motion.div>
        ) : (
          <motion.div key="list" initial={{ x: '-12%', opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: '-12%', opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 36 }}>
            <SessionsScreen onOpen={open} />
          </motion.div>
        )}
      </AnimatePresence>
      <UpdateBanner update={update} onDismiss={dismiss} />
      <WebViewerHost />
      <Toaster theme="dark" position="top-center" richColors closeButton
        icons={{
          success: <CircleCheckIcon className="size-4" />, error: <CircleAlertIcon className="size-4" />, warning: <TriangleAlertIcon className="size-4" />,
          info: <InfoIcon className="size-4" />, loading: <LoaderCircleIcon className="size-4 animate-spin" />,
        }}
        toastOptions={{ className: '!rounded-2xl !backdrop-blur-xl !font-sans' }} />
    </div>
  )
}
