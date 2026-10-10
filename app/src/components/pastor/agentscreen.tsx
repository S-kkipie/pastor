import { ChevronLeftIcon, CoinsIcon, FootprintsIcon, OctagonXIcon, WrenchIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useMemo, type CSSProperties } from 'react'
import { toast } from 'sonner'

import { Conversation, ConversationContent, ConversationScrollButton } from '@/components/ai-elements/conversation'
import { api, sessionPath } from '@/lib/api'
import { useBackClose } from '@/lib/back'
import { dur, tokens } from '@/lib/format'
import { useNow } from '@/lib/hooks'
import type { AgentRow, Live, PastorEvent } from '@/lib/types'
import { cn } from '@/lib/utils'

import { Clawd } from './clawd'
import { Composer } from './composer'
import { LiveTurn, Transcript } from './transcript'

// The subagents' colour: the app's accent tokens re-pointed to violet for this
// subtree, so every coral piece (orb glow, shimmer, buttons) turns purple.
const VIOLET = {
  '--color-coral': 'oklch(0.72 0.16 300)',
  '--color-coral-soft': 'oklch(0.86 0.08 300)',
  '--primary': 'oklch(0.72 0.16 300)',
  '--ring': 'oklch(0.72 0.16 300 / 60%)',
} as CSSProperties

const LIVE = new Set(['running', 'pending', 'waiting'])
const STATUS: Record<AgentRow['status'], string> = {
  pending: 'arrancando', running: 'trabajando', waiting: 'esperando', idle: 'en espera', completed: 'terminó', failed: 'falló', killed: 'detenido',
}

// A subagent full screen, like the main session: its task, every step and
// tool with their detail, what it is writing now, and a box to write to it.
export function AgentScreen({ sid, machine, agent, events, skew, onClose }: {
  sid: string; machine: string; agent: AgentRow | null; events: PastorEvent[]; skew: number; onClose: () => void
}) {
  const now = useNow(1000)
  useBackClose(!!agent, onClose)
  const mine = useMemo(() => (agent ? events.filter(e => e.agent === agent.id).map(e => ({ ...e, agent: undefined })) : []), [agent, events])
  const live = !!agent && LIVE.has(agent.status)
  const liveTurn: Live | null = live && agent
    ? { since: agent.startedAt - skew, text: agent.text, thinking: !agent.text && !agent.activity, activity: agent.activity }
    : null
  const stop = async () => {
    if (!agent) return
    try { await api(sessionPath(sid, 'agentStop'), { id: agent.id }); toast.warning('Deteniendo el agente…', { description: agent.description, icon: <OctagonXIcon className="size-4" /> }) }
    catch (e) { toast.error((e as Error).message) }
  }
  return (
    <AnimatePresence>
      {agent && (
        <motion.div key={agent.id} initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
          transition={{ type: 'spring', stiffness: 360, damping: 36 }} style={VIOLET}
          className="fixed inset-0 z-50 flex flex-col bg-background pt-[env(safe-area-inset-top)]">
          <div className="pointer-events-none absolute -top-24 left-1/2 h-48 w-80 -translate-x-1/2 rounded-full bg-violet-500/20 blur-3xl" />
          <header className="relative z-10 flex items-center gap-2 border-b border-violet-400/15 bg-background/60 px-2 py-2 backdrop-blur-xl">
            <button type="button" onClick={onClose} aria-label="Volver" className="grid size-10 place-items-center rounded-full active:bg-white/5">
              <ChevronLeftIcon className="size-5" />
            </button>
            <Clawd mood={live ? (agent.activity ? 'working' : 'pant') : agent.status === 'completed' ? 'done' : 'idle'} size={36} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold leading-tight">{agent.name ?? agent.description}</p>
              <p className="truncate font-mono text-[11px] text-violet-300/80">
                {agent.type}{agent.model ? ` · ${agent.model.replace(/^claude-/, '')}` : ''}
              </p>
            </div>
            <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium',
              live ? 'bg-violet-500/20 text-violet-200' : agent.status === 'completed' ? 'bg-emerald-400/15 text-emerald-300' : 'bg-red-500/15 text-red-300')}>
              {STATUS[agent.status]}
            </span>
            {live && (
              <button type="button" onClick={() => void stop()} aria-label="Detener agente"
                className="grid size-9 place-items-center rounded-full border border-red-400/30 text-red-300 active:bg-red-500/10">
                <OctagonXIcon className="size-4" />
              </button>
            )}
          </header>
          <div className="scrollbar-none relative z-10 flex gap-1.5 overflow-x-auto px-3 py-1.5 font-mono text-[10.5px]">
            {[
              [null, `⏱ ${dur((agent.endedAt ?? now - skew) - agent.startedAt) || '0s'}`],
              [CoinsIcon, agent.tokens ? `${tokens(agent.tokens)} tok` : '— tok'],
              [FootprintsIcon, `${agent.steps} pasos`],
              [WrenchIcon, `${agent.tools} herramientas`],
            ].map(([Icon, label], i) => {
              const I = Icon as typeof CoinsIcon | null
              return (
                <span key={i} className="flex shrink-0 items-center gap-1.5 rounded-full border border-violet-400/20 bg-violet-500/[0.07] px-2.5 py-1 text-violet-100/90">
                  {I && <I className="size-3 text-violet-300" />}{label as string}
                </span>
              )
            })}
          </div>
          <Conversation className="min-h-0">
            <ConversationContent className="gap-3 px-4 pb-6 pt-3">
              {mine.length === 0 && !liveTurn && (
                <div className="mt-20 flex flex-col items-center gap-3 text-center text-muted-foreground">
                  <Clawd mood="sleep" size={64} />
                  <p className="max-w-64 text-sm">Esta sesión empezó a seguirlo después de que arrancara: aquí aparece lo que haga desde ahora.</p>
                </div>
              )}
              <Transcript events={mine} skew={skew} />
              <LiveTurn live={liveTurn} waiting={false} skew={skew} />
              {!live && agent.answer && !mine.some(e => e.kind === 'assistant') && (
                <div className="rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.04] p-3 text-[13.5px] whitespace-pre-wrap">{agent.answer}</div>
              )}
            </ConversationContent>
            <ConversationScrollButton className="bottom-3 border-violet-400/20 bg-background/70 backdrop-blur-md" />
          </Conversation>
          <Composer busy={false} machine={machine} canAttach={false} draftKey={`agent.${agent.id}`}
            placeholder={`Escribe a ${agent.name ?? agent.description}…`}
            onPalette={() => toast.info('Los comandos van a la sesión principal', { description: 'Aquí escribes solo a este agente' })}
            onStop={() => void stop()}
            onSend={async text => {
              await api(sessionPath(sid, 'agentMsg'), { id: agent.id, text })
              toast.success(live ? 'Mensaje enviado al agente' : 'Agente retomado con tu mensaje', { description: text.slice(0, 80) })
            }} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
