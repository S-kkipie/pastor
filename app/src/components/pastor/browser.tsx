import {
  AppWindowIcon, ArrowLeftIcon, CornerDownLeftIcon, DeleteIcon, EyeIcon, HandIcon, KeyboardIcon, LoaderCircleIcon, RotateCwIcon, SendIcon, XIcon,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { toast } from 'sonner'

import { api, auth } from '@/lib/api'
import { useBackClose } from '@/lib/back'
import { cn } from '@/lib/utils'

type Page = { id: string; title: string; url: string }
type Browser = { port: number; pid: number; kind: 'agent-browser' | 'playwright' | 'chrome'; name: string; session: string | null; headless: boolean; pages: Page[] }
const spring = { type: 'spring', stiffness: 380, damping: 38 } as const
const KIND: Record<Browser['kind'], string> = { 'agent-browser': 'agent-browser', playwright: 'Playwright', chrome: 'Chrome' }

// The browser a session drives (agent-browser or the Playwright MCP), live: its
// screen streams as video from the PC; "Controlar" turns taps, swipes and the
// keyboard into input on the page (a login, a captcha, a nudge for Claude).
export function BrowserScreen({ open, onClose, machine, session }: { open: boolean; onClose: () => void; machine: string; session: string }) {
  useBackClose(open, onClose)
  const [browsers, setBrowsers] = useState<Browser[] | null>(null)
  const [err, setErr] = useState('')
  const [sel, setSel] = useState<{ port: number; page: string } | null>(null)
  const [live, setLive] = useState<{ url: string; token: string } | null>(null)
  const [control, setControl] = useState(false)
  const [keys, setKeys] = useState(false)
  const [text, setText] = useState('')
  const [addr, setAddr] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [n, setN] = useState(0)
  const img = useRef<HTMLImageElement>(null)
  const local = session.slice(session.indexOf('~') + 1)

  const load = useCallback(async () => {
    try {
      const r = await api<{ browsers: Browser[] }>(`/api/browser?${new URLSearchParams({ machine, session: local })}`)
      setBrowsers(r.browsers); setErr('')
      return r.browsers
    } catch (e) { setErr((e as Error).message); return [] }
  }, [machine, local])

  // First open: the page most likely in use (not blank) of the first browser.
  useEffect(() => {
    if (!open) { setLive(null); setSel(null); setControl(false); setKeys(false); return }
    void load().then(list => {
      for (const b of list) {
        const pg = b.pages.find(x => x.url !== 'about:blank' && !x.url.startsWith('chrome://')) ?? b.pages[0]
        if (pg) { setSel({ port: b.port, page: pg.id }); return }
      }
    })
    const t = setInterval(() => void load(), 5000)
    return () => clearInterval(t)
  }, [open, load])

  useEffect(() => {
    if (!sel) return
    let alive = true
    setLoaded(false); setLive(null)
    api<{ url: string; token: string }>('/api/browser', { machine, op: 'watch', port: sel.port, pageId: sel.page })
      .then(r => { if (alive) setLive({ token: r.token, url: /^https?:/.test(r.url) ? r.url : `${auth.server}/${r.url}` }) },
        e => toast.error('No se pudo abrir el navegador', { description: (e as Error).message }))
    return () => { alive = false }
  }, [sel, machine, n])

  const page = browsers?.flatMap(b => b.pages.map(p => ({ ...p, b }))).find(p => p.b.port === sel?.port && p.id === sel?.page)
  useEffect(() => { if (page) setAddr(page.url) }, [page?.url]) // eslint-disable-line react-hooks/exhaustive-deps

  const input = useCallback((body: Record<string, unknown>) => {
    if (!live) return
    void api('/api/browser', { machine, op: 'input', token: live.token, ...body }).catch(e => toast.error((e as Error).message))
  }, [live, machine])

  // Where on the page a touch lands, with the image letterboxed in its box.
  const at = (ev: { clientX: number; clientY: number }) => {
    const el = img.current
    if (!el || !el.naturalWidth) return null
    const r = el.getBoundingClientRect()
    const scale = Math.min(r.width / el.naturalWidth, r.height / el.naturalHeight)
    const w = el.naturalWidth * scale, h = el.naturalHeight * scale
    const x = (ev.clientX - r.left - (r.width - w) / 2) / w, y = (ev.clientY - r.top - (r.height - h) / 2) / h
    return x < 0 || x > 1 || y < 0 || y > 1 ? null : { x, y }
  }
  const drag = useRef<{ x: number; y: number; lastY: number; moved: boolean; acc: number; timer?: ReturnType<typeof setTimeout> } | null>(null)
  const down = (e: ReactPointerEvent) => {
    if (!control) return
    drag.current = { x: e.clientX, y: e.clientY, lastY: e.clientY, moved: false, acc: 0 }
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }
  const move = (e: ReactPointerEvent) => {
    const d = drag.current
    if (!d) return
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10) d.moved = true
    if (!d.moved) return
    d.acc += (d.lastY - e.clientY) * 2.2
    d.lastY = e.clientY
    if (!d.timer) d.timer = setTimeout(() => {
      const p = at({ clientX: d.x, clientY: d.y }) ?? { x: 0.5, y: 0.5 }
      if (d.acc) input({ type: 'scroll', ...p, dy: Math.round(d.acc) })
      d.acc = 0; d.timer = undefined
    }, 70)
  }
  const up = (e: ReactPointerEvent) => {
    const d = drag.current
    drag.current = null
    if (!d || d.moved) return
    const p = at(e)
    if (p) { input({ type: 'tap', ...p }); try { navigator.vibrate?.(8) } catch { /* unsupported */ } }
  }

  const browserCount = browsers?.length ?? 0
  return (
    <AnimatePresence>
      {open && (
        <motion.div key="browser" initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={spring}
          className="fixed inset-0 z-50 flex flex-col bg-background pt-[env(safe-area-inset-top)]">
          <header className="flex items-center gap-1.5 border-b border-white/6 px-2 py-2">
            <button type="button" onClick={onClose} aria-label="Cerrar" className="grid size-10 place-items-center rounded-full active:bg-white/5"><XIcon className="size-5" /></button>
            <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-sky-400/12 text-sky-300"><AppWindowIcon className="size-4" /></span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold leading-tight">{page?.title || 'Navegador'}</p>
              <p className="truncate font-mono text-[11px] text-muted-foreground">
                {page ? `${KIND[page.b.kind]}${page.b.name ? ` · ${page.b.name}` : ''}${page.b.headless ? ' · sin ventana' : ''}` : machine}
              </p>
            </div>
            <button type="button" onClick={() => setControl(c => !c)}
              className={cn('flex h-9 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium transition-colors',
                control ? 'border-coral/60 bg-coral/15 text-coral' : 'border-white/10 text-muted-foreground')}>
              {control ? <HandIcon className="size-3.5" /> : <EyeIcon className="size-3.5" />}{control ? 'Controlando' : 'Solo ver'}
            </button>
          </header>

          {/* tabs of every browser this session drives */}
          {browserCount > 0 && (
            <div className="scrollbar-none flex shrink-0 gap-1.5 overflow-x-auto px-3 py-2">
              {browsers!.flatMap(b => b.pages.map(pg => (
                <button key={`${b.port}:${pg.id}`} type="button" onClick={() => setSel({ port: b.port, page: pg.id })}
                  className={cn('flex max-w-56 shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-[12px]',
                    sel?.port === b.port && sel.page === pg.id ? 'border-sky-400/60 bg-sky-400/12 text-sky-100' : 'border-white/10 text-muted-foreground')}>
                  <span className="truncate">{pg.title || pg.url || 'Pestaña'}</span>
                </button>
              )))}
            </div>
          )}

          {control && (
            <div className="flex shrink-0 items-center gap-1.5 px-3 pb-2">
              <button type="button" aria-label="Atrás" onClick={() => input({ type: 'back' })} className="grid size-9 shrink-0 place-items-center rounded-full border border-white/10 text-muted-foreground active:bg-white/5"><ArrowLeftIcon className="size-4" /></button>
              <button type="button" aria-label="Recargar" onClick={() => input({ type: 'reload' })} className="grid size-9 shrink-0 place-items-center rounded-full border border-white/10 text-muted-foreground active:bg-white/5"><RotateCwIcon className="size-4" /></button>
              <input value={addr} onChange={e => setAddr(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') input({ type: 'navigate', url: addr }) }}
                inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false}
                className="h-9 min-w-0 flex-1 rounded-full border border-white/8 bg-white/[0.04] px-3 font-mono text-[16px] outline-none focus:border-sky-400/50 sm:text-[12px]" />
              <button type="button" aria-label="Teclado" onClick={() => setKeys(k => !k)}
                className={cn('grid size-9 shrink-0 place-items-center rounded-full border', keys ? 'border-coral/60 text-coral' : 'border-white/10 text-muted-foreground')}><KeyboardIcon className="size-4" /></button>
            </div>
          )}

          <div className={cn('relative min-h-0 flex-1 bg-black/60', control && 'ring-2 ring-inset ring-coral/40')}>
            {err && <p className="m-4 rounded-2xl bg-red-500/10 p-3 text-[13px] text-red-300">{err}</p>}
            {browsers && browserCount === 0 && !err && (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center text-muted-foreground">
                <AppWindowIcon className="size-8 opacity-40" />
                <p className="text-[13.5px]">Esta sesión no tiene un navegador abierto ahora.</p>
                <p className="text-[12px] text-muted-foreground/70">Aparece cuando Claude usa agent-browser o Playwright.</p>
              </div>
            )}
            {live && (
              <img ref={img} key={live.url} src={live.url} alt="Navegador en vivo" draggable={false}
                onLoad={() => setLoaded(true)} onError={() => setTimeout(() => setN(x => x + 1), 1500)}
                onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = null }}
                className={cn('size-full select-none object-contain', control ? 'touch-none' : '')} />
            )}
            {live && !loaded && <LoaderCircleIcon className="absolute left-1/2 top-1/2 size-6 -translate-x-1/2 -translate-y-1/2 animate-spin text-muted-foreground" />}
          </div>

          {control && keys && (
            <div className="flex shrink-0 items-center gap-1.5 border-t border-white/6 px-3 pb-[max(env(safe-area-inset-bottom),10px)] pt-2">
              <input value={text} onChange={e => setText(e.target.value)} autoFocus placeholder="Escribir en la página…"
                onKeyDown={e => { if (e.key === 'Enter') { if (text) input({ type: 'text', text }); setText(''); input({ type: 'key', key: 'Enter' }) } }}
                className="h-10 min-w-0 flex-1 rounded-2xl border border-white/8 bg-white/[0.04] px-3 text-[16px] outline-none focus:border-coral/50 sm:text-[13px]" />
              <button type="button" aria-label="Borrar" onClick={() => input({ type: 'key', key: 'Backspace' })} className="grid size-10 shrink-0 place-items-center rounded-2xl border border-white/10 text-muted-foreground active:bg-white/5"><DeleteIcon className="size-4" /></button>
              <button type="button" aria-label="Enter" onClick={() => input({ type: 'key', key: 'Enter' })} className="grid size-10 shrink-0 place-items-center rounded-2xl border border-white/10 text-muted-foreground active:bg-white/5"><CornerDownLeftIcon className="size-4" /></button>
              <button type="button" aria-label="Escribir" disabled={!text} onClick={() => { input({ type: 'text', text }); setText('') }}
                className="grid size-10 shrink-0 place-items-center rounded-2xl bg-coral text-background disabled:opacity-40"><SendIcon className="size-4" /></button>
            </div>
          )}
          {!control && <p className="shrink-0 px-4 pb-[max(env(safe-area-inset-bottom),10px)] pt-2 text-center text-[11.5px] text-muted-foreground/70">En vivo · toca "Solo ver" para tomar el control</p>}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
