import { ArrowUpIcon, CheckIcon, ChevronLeftIcon, CircleAlertIcon, LoaderCircleIcon, SparklesIcon, SquareIcon } from 'lucide-react'
import { motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message'
import { api } from '@/lib/api'
import { useBackClose } from '@/lib/back'
import type { HermesChatState, HermesLive } from '@/lib/types'
import { cn } from '@/lib/utils'

const spring = { type: 'spring', stiffness: 380, damping: 38 } as const
const WORDS_IN = { animation: 'fadeIn', sep: 'word', duration: 300 } as const
const USER_BUBBLE = 'rounded-[20px] rounded-br-md border border-white/8 bg-gradient-to-br from-white/[0.09] to-white/[0.04] px-4 py-2.5 text-[15px] whitespace-pre-wrap [overflow-wrap:anywhere]'

function UserBubble({ text }: { text: string }) {
  return <Message from="user" className="max-w-[86%]"><MessageContent className={USER_BUBBLE}>{text}</MessageContent></Message>
}

function ToolChips({ tools }: { tools: HermesLive['tools'] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {tools.map((t, i) => (
        <span key={`${t.tool}-${i}`} className={cn('flex items-center gap-1 rounded-full border px-2.5 py-1 font-mono text-[11.5px]',
          t.error ? 'border-red-400/40 text-red-200' : 'border-white/10 text-muted-foreground')}>
          {!t.done ? <LoaderCircleIcon className="size-3 animate-spin" /> : t.error ? <CircleAlertIcon className="size-3" /> : <CheckIcon className="size-3 text-emerald-300" />}
          {t.tool}
        </span>
      ))}
    </div>
  )
}

// One of Hermes's chats, through the hub: the app's own (it writes there) or a WhatsApp one (read only).
export function HermesChat({ channel, label, onClose }: { channel: string; label: string; onClose: () => void }) {
  useBackClose(true, onClose)
  const [state, setState] = useState<HermesChatState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const scroller = useRef<HTMLElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  const load = useCallback(async () => {
    try { setState(await api<HermesChatState>('/api/agent', { op: 'chat', channel })); setError(null) }
    catch (e) { setError((e as Error).message) }
  }, [channel])
  const live = state?.live ?? null
  const working = live?.status === 'running' || (state?.queued ?? 0) > 0
  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), working ? 700 : 3000)
    return () => clearInterval(t)
  }, [load, working])
  // Stays at the bottom while the content grows (markdown lays out after React renders), unless the person scrolled up.
  useEffect(() => {
    const el = scroller.current, inner = content.current
    if (!el || !inner) return
    const onScroll = () => { stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80 }
    const ro = new ResizeObserver(() => { if (stick.current) el.scrollTop = el.scrollHeight })
    el.addEventListener('scroll', onScroll, { passive: true })
    ro.observe(inner)
    return () => { el.removeEventListener('scroll', onScroll); ro.disconnect() }
  }, [])

  const send = async () => {
    const t = text.trim()
    if (!t || sending) return
    setSending(true)
    try { await api('/api/agent', { op: 'say', channel, text: t }); setText(''); stick.current = true; void load() }
    catch (e) { toast.error((e as Error).message) }
    finally { setSending(false) }
  }
  const stop = () => void api('/api/agent', { op: 'stop', channel }).then(load, e => toast.error((e as Error).message))

  // Hermes may already have the turn's own message in the history.
  const lastUser = state?.messages.filter(m => m.role === 'user').at(-1)
  const showLiveUser = live && lastUser?.text !== live.user

  return (
    <motion.div key="hermes-chat" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={spring}
      className="fixed inset-0 z-[55] flex flex-col bg-background pt-[env(safe-area-inset-top)]">
      <header className="flex items-center gap-2 border-b border-white/6 px-2 py-2">
        <button type="button" onClick={onClose} aria-label="Volver" className="grid size-10 place-items-center rounded-full active:bg-white/5"><ChevronLeftIcon className="size-5" /></button>
        <span className="grid size-8 place-items-center rounded-xl bg-violet-500/15 text-violet-300"><SparklesIcon className="size-4" /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold leading-tight">{label}</p>
          <p className="truncate text-[11.5px] text-muted-foreground">
            {state?.readOnly ? 'Hermes · solo lectura, contesta desde WhatsApp' : working ? <span className="text-shine">Hermes está trabajando…</span> : 'Hermes'}
          </p>
        </div>
      </header>

      <main ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-4">
        <div ref={content} className="flex flex-col gap-4 [&>*]:shrink-0">
        {error && <p className="rounded-2xl border border-red-400/30 bg-red-500/10 px-3.5 py-2.5 text-[13px] text-red-100">{error}</p>}
        {state && !state.messages.length && !live && (
          <p className="mt-10 text-center text-[13px] text-muted-foreground">
            {state.readOnly ? 'Este chat aún no tiene mensajes.' : 'Escríbele a Hermes: ve y dirige tus sesiones de pastor, rutinas, terminal y archivos.'}
          </p>
        )}
        {state?.messages.map(m => m.role === 'user' ? <UserBubble key={`u${m.id}`} text={m.text ?? ''} />
          : m.role === 'tools' ? <ToolChips key={`t${m.id}`} tools={(m.tools ?? []).map(tool => ({ tool, done: true, error: false }))} />
            : (
              <Message key={`a${m.id}`} from="assistant" className="max-w-full">
                <MessageContent className="text-[15px] leading-relaxed [overflow-wrap:anywhere]"><MessageResponse>{m.text ?? ''}</MessageResponse></MessageContent>
              </Message>
            ))}
        {live && (
          <>
            {showLiveUser && <UserBubble text={live.user} />}
            {live.tools.length > 0 && <ToolChips tools={live.tools} />}
            {live.text ? (
              <div className="text-[15px] leading-relaxed">
                <MessageResponse animated={WORDS_IN} isAnimating={live.status === 'running'}>{live.text}</MessageResponse>
                {live.status === 'running' && <span className="ml-0.5 inline-block h-4 w-[3px] translate-y-0.5 animate-pulse rounded-full bg-coral" />}
              </div>
            ) : live.status === 'running' && <p className="text-shine text-[13.5px]">{live.tools.some(t => !t.done) ? 'Usando herramientas…' : 'Pensando…'}</p>}
            {live.status === 'failed' && <p className="rounded-2xl border border-red-400/30 bg-red-500/10 px-3.5 py-2.5 text-[13px] text-red-100">No pudo terminar: {live.error}</p>}
            {live.status === 'stopped' && <p className="text-center text-[11.5px] text-muted-foreground/60">Detenido</p>}
          </>
        )}
        {(state?.queued ?? 0) > 0 && <p className="text-center text-[11.5px] text-muted-foreground/70">{state?.queued} en cola</p>}
        </div>
      </main>

      {state && !state.readOnly && (
        <footer className="border-t border-white/6 px-3 pb-[max(env(safe-area-inset-bottom),12px)] pt-2">
          <div className="flex items-end gap-2 rounded-3xl px-3 py-2 glass">
            <textarea value={text} onChange={e => setText(e.target.value)} rows={Math.min(5, Math.max(1, text.split('\n').length))}
              placeholder="Escríbele a Hermes…" aria-label="Mensaje para Hermes"
              className="max-h-32 min-w-0 flex-1 resize-none bg-transparent py-1.5 text-[16px] outline-none placeholder:text-muted-foreground/60" />
            {working && !text.trim() ? (
              <button type="button" onClick={stop} aria-label="Parar" className="grid size-9 shrink-0 place-items-center rounded-full bg-white/10 active:bg-white/15"><SquareIcon className="size-3.5 fill-current" /></button>
            ) : (
              <button type="button" onClick={() => void send()} disabled={!text.trim() || sending} aria-label="Enviar"
                className="grid size-9 shrink-0 place-items-center rounded-full bg-violet-400 text-background disabled:opacity-40">
                {sending ? <LoaderCircleIcon className="size-4 animate-spin" /> : <ArrowUpIcon className="size-4" />}
              </button>
            )}
          </div>
        </footer>
      )}
    </motion.div>
  )
}
