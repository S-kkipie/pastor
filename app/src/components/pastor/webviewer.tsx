import { ExternalLinkIcon, GlobeIcon, LoaderCircleIcon, RotateCwIcon, SmartphoneIcon, MonitorIcon, XIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { api, auth } from '@/lib/api'
import { useBackClose } from '@/lib/back'
import { cn } from '@/lib/utils'

// One full-screen web view for the whole app: a dev server on a PC, or a local
// HTML file Claude wrote (an "artifact"), rendered as a page. Anything opens it
// with openWeb(); <WebViewerHost/> lives once in App.
type Target = { url: string; title: string; kind: 'preview' | 'file' }
const EV = 'pastor:web'
let current: Target | null = null

export function openWeb(t: Target) {
  current = t
  window.dispatchEvent(new Event(EV))
}

// A file on a PC: its bridge hands out a short-lived link to the file's folder
// (so its CSS, scripts and images load too), reachable from the phone.
export async function openHtmlFile(machine: string, file: string) {
  const name = file.split(/[\\/]/).pop() ?? file
  const tid = toast.loading('Abriendo…', { description: name })
  try {
    const r = await api<{ url: string }>('/api/view', { machine, path: file })
    toast.dismiss(tid)
    openWeb({ url: /^https?:/.test(r.url) ? r.url : `${auth.server}/${r.url}`, title: name, kind: 'file' })
  } catch (e) { toast.error('No se pudo abrir', { id: tid, description: (e as Error).message }) }
}

export const isHtml = (file?: string) => !!file && /\.html?$/i.test(file)

export function WebViewerHost() {
  const [t, setT] = useState<Target | null>(null)
  const [n, setN] = useState(0)
  const [loading, setLoading] = useState(true)
  const [desktop, setDesktop] = useState(false)
  useEffect(() => {
    const on = () => { setT(current); setN(x => x + 1); setLoading(true) }
    window.addEventListener(EV, on)
    return () => window.removeEventListener(EV, on)
  }, [])
  const close = () => setT(null)
  useBackClose(!!t, close)
  let host = ''
  try { host = t ? new URL(t.url).host : '' } catch { /* bad url */ }

  return (
    <AnimatePresence>
      {t && (
        <motion.div key="web" initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
          transition={{ type: 'spring', stiffness: 380, damping: 38 }}
          className="fixed inset-0 z-[60] flex flex-col bg-background pt-[env(safe-area-inset-top)]">
          <header className="flex items-center gap-1 border-b border-white/6 px-2 py-1.5">
            <button type="button" onClick={close} aria-label="Cerrar" className="grid size-10 place-items-center rounded-full active:bg-white/5"><XIcon className="size-5" /></button>
            <span className={cn('grid size-7 shrink-0 place-items-center rounded-lg', t.kind === 'file' ? 'bg-violet-500/15 text-violet-300' : 'bg-sky-400/15 text-sky-300')}>
              <GlobeIcon className="size-3.5" />
            </span>
            <div className="min-w-0 flex-1 px-1">
              <p className="truncate text-[14px] font-semibold leading-tight">{t.title}</p>
              <p className="truncate font-mono text-[10.5px] text-muted-foreground">{t.kind === 'file' ? 'HTML local' : host}</p>
            </div>
            {loading && <LoaderCircleIcon className="size-4 animate-spin text-muted-foreground" />}
            <button type="button" onClick={() => setDesktop(d => !d)} aria-label={desktop ? 'Vista móvil' : 'Vista escritorio'}
              className={cn('grid size-9 place-items-center rounded-full active:bg-white/5', desktop ? 'text-coral' : 'text-muted-foreground')}>
              {desktop ? <MonitorIcon className="size-4" /> : <SmartphoneIcon className="size-4" />}
            </button>
            <button type="button" onClick={() => { setLoading(true); setN(x => x + 1) }} aria-label="Recargar" className="grid size-9 place-items-center rounded-full text-muted-foreground active:bg-white/5"><RotateCwIcon className="size-4" /></button>
            <a href={t.url} target="_blank" rel="noreferrer" aria-label="Abrir en el navegador" className="grid size-9 place-items-center rounded-full text-muted-foreground active:bg-white/5"><ExternalLinkIcon className="size-4" /></a>
          </header>
          <div className="relative min-h-0 flex-1 overflow-auto bg-white">
            <iframe key={n} src={t.url} title={t.title} onLoad={() => setLoading(false)}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
              className="border-0 bg-white"
              style={desktop
                ? { width: 1280, height: `${100 / (window.innerWidth / 1280)}%`, transform: `scale(${window.innerWidth / 1280})`, transformOrigin: '0 0' }
                : { width: '100%', height: '100%' }} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
