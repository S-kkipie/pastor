import { ArchiveIcon, SparklesIcon, HistoryIcon, LoaderCircleIcon, AtSignIcon, ChevronLeftIcon, ClockIcon, LoaderIcon, PlayIcon, SquareTerminalIcon, OctagonPauseIcon, OctagonXIcon, ZapIcon, EllipsisVerticalIcon, FolderTreeIcon, GitBranchIcon, MonitorIcon, PowerIcon, SmartphoneIcon, TrashIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Conversation, ConversationContent, ConversationScrollButton } from '@/components/ai-elements/conversation'
import { AgentsButton, AgentsSheet } from '@/components/pastor/agents'
import { AgentScreen } from '@/components/pastor/agentscreen'
import { Avatar } from '@/components/pastor/avatar'
import { Composer } from '@/components/pastor/composer'
import { Explorer } from '@/components/pastor/explorer'
import { GitView } from '@/components/pastor/git'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { PlanDock } from '@/components/pastor/tools'
import { LiveTurn, orbStateOf, PendingStack, Transcript } from '@/components/pastor/transcript'
import { CommandPalette } from '@/components/pastor/palette'
import { PetLane, type PetMood } from '@/components/pastor/pet/PetLane'
import type { Walker } from '@/components/pastor/pet/walker'
import type { OrbState } from '@/components/pastor/orb'
import { MessagesButton, MessagesSheet, recentCount } from '@/components/pastor/network'
import { AlarmClockIcon, AppWindowIcon, FileCode2Icon, GlobeIcon, RadioTowerIcon } from 'lucide-react'
import { RoutinesScreen } from '@/components/pastor/routines'
import { BrowserScreen } from '@/components/pastor/browser'
import { PreviewsSheet } from '@/components/pastor/previews'
import { TerminalScreen } from '@/components/pastor/terminal'
import { isHtml, openHtmlFile } from '@/components/pastor/webviewer'
import { TasksButton, TasksSheet } from '@/components/pastor/tasks'
import { StatusBar } from '@/components/pastor/statusbar'
import { UsageRing } from '@/components/pastor/usage'
import { api, sessionPath } from '@/lib/api'
import { shortPath } from '@/lib/format'
import { planOf } from '@/lib/plan'
import { SessionContext } from '@/lib/ctx'
import { useSession } from '@/lib/hooks'
import { cn } from '@/lib/utils'

const STAGE_MOOD: Record<OrbState, PetMood> = { thinking: 'pant', tool: 'working', searching: 'working', writing: 'juggle', waiting: 'alert', idle: 'idle' }

export function SessionScreen({ id, onBack }: { id: string; onBack: () => void }) {
  const s = useSession(id)
  const [tab, setTab] = useState<'chat' | 'diff'>('chat')
  const [tasksOpen, setTasksOpen] = useState(false)
  const [tool, setTool] = useState<'term' | 'web' | 'html' | 'browser' | 'routine' | null>(null)
  const [msgsOpen, setMsgsOpen] = useState(false)
  const [palette, setPalette] = useState<null | 'commands' | 'skills' | 'settings' | 'mcp'>(null)
  const [files, setFiles] = useState(false)
  const [closing, setClosing] = useState(false)
  const [inject, setInject] = useState<{ text: string; n: number }>()
  const [agentsOpen, setAgentsOpen] = useState(false)
  const [agentFocus, setAgentFocus] = useState<string | null>(null)
  // A subagent opened full screen (from its detail's Expandir).
  const [expanded, setExpanded] = useState<string | null>(null)
  const [resuming, setResuming] = useState(false)
  const session = s.session
  // A closed conversation read back from its transcript: look, don't touch.
  const readOnly = s.fromTranscript
  const waiting = s.pending.length > 0
  const busy = !!s.live || session?.status === 'busy' || waiting
  const plan = useMemo(() => planOf(s.events), [s.events])

  useEffect(() => { if (waiting) navigator.vibrate?.([30, 40, 30]) }, [waiting, s.pending.length])

  // Clawd on the stage above the composer: it follows the turn, talks while
  // Claude thinks or writes, and reacts to what happens.
  const pet = useRef<Walker | null>(null)
  const orb = orbStateOf(s.live, waiting)
  const talk = orb === 'thinking' ? 'think' : orb === 'writing' ? 'write' : null
  // After 3 min with nothing going on (and you not typing), it lies down.
  const [dozing, setDozing] = useState(false)
  const doze = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const idle = useRef(orb === 'idle')
  idle.current = orb === 'idle'
  const armDoze = () => {
    clearTimeout(doze.current)
    if (idle.current) doze.current = setTimeout(() => setDozing(true), 180_000)
  }
  useEffect(() => { setDozing(false); armDoze(); return () => clearTimeout(doze.current) }, [orb]) // eslint-disable-line react-hooks/exhaustive-deps
  const stageMood = dozing ? 'sleep' : STAGE_MOOD[orb]
  useEffect(() => { pet.current?.talk(talk) }, [talk])
  // The turn ended: it celebrates (not when you stopped it).
  const liveOn = !!s.live
  const wasLive = useRef(false)
  const aborted = useRef(false)
  useEffect(() => {
    if (liveOn) { wasLive.current = true; aborted.current = false; return }
    if (wasLive.current && !aborted.current) pet.current?.react('done')
    wasLive.current = false
    aborted.current = false
  }, [liveOn])
  // A step that failed since the conversation was opened.
  const lastFail = useRef<number | null>(null)
  useEffect(() => {
    if (!s.events.length) return
    // Seeded with the newest event: older pages loaded later never count.
    if (lastFail.current === null) { lastFail.current = Math.max(...s.events.map(e => e.seq)); return }
    let seq = -1
    for (let i = s.events.length - 1; i >= 0; i--) {
      const e = s.events[i]!
      if (e.kind === 'tool' && e.end && !e.end.ok) { seq = e.seq; break }
    }
    if (seq > lastFail.current) { lastFail.current = seq; pet.current?.react('fail') }
  }, [s.events])
  const onTyping = () => {
    if (dozing) setDozing(false)
    armDoze()
    pet.current?.react('typing')
  }

  const toggleAway = async () => {
    if (!session) return
    const r = await s.act('away', { away: !session.away }) as { away: boolean }
    toast.info(r.away ? 'Modo fuera' : 'Modo aquí', {
      description: r.away ? 'Permisos y preguntas llegan a este móvil' : 'Se responde en el PC',
      icon: r.away ? <SmartphoneIcon className="size-4" /> : <MonitorIcon className="size-4" />,
    })
  }

  // A closed conversation picks up again on its PC (claude --resume <id>);
  // it registers under the same id, so this screen turns live by itself.
  const resume = async () => {
    if (!session || resuming) return
    setResuming(true)
    const tid = toast.loading(`Reanudando en ${session.machine}…`, { description: session.title })
    try {
      await api('/api/launch', { machine: session.machine, cwd: session.cwd, mode: 'resume', sessionId: id.slice(id.indexOf('~') + 1) })
      toast.success(`Reanudada en ${session.machine}`, { id: tid, description: 'Se conecta en unos segundos', icon: <SquareTerminalIcon className="size-4 text-coral" /> })
      s.expectLive()
    } catch (e) {
      toast.error((e as Error).message, { id: tid })
      setResuming(false)
    }
  }
  useEffect(() => { if (!readOnly) setResuming(false) }, [readOnly])

  // HTML pages Claude wrote or edited here, newest first (its "artifacts").
  const htmlFiles = useMemo(() => {
    const seen = new Map<string, number>()
    for (const e of s.events) {
      const file = (e.detail as { file?: string } | undefined)?.file
      if (e.kind === 'tool' && (e.tool === 'Write' || e.tool === 'Edit' || e.tool === 'MultiEdit') && isHtml(file) && e.end?.ok !== false) seen.set(file!, e.t)
    }
    return [...seen].sort((a, b) => b[1] - a[1]).map(([file]) => ({ file }))
  }, [s.events])

  const ctx = useMemo(() => session ? {
    sid: id, machine: session.machine, cwd: session.cwd, agents: s.agents,
    openAgent: (key: string) => { setAgentFocus(s.agents.find(a => a.toolUseId === key || a.id === key)?.id ?? null); setAgentsOpen(true) },
  } : null, [session, s.agents])

  return (
    <SessionContext.Provider value={ctx}>
    <div className="flex h-dvh flex-col pt-[env(safe-area-inset-top)]">
      <header className="relative z-10 flex items-center gap-1.5 border-b border-white/6 bg-background/60 px-2 py-2 backdrop-blur-xl">
        <button type="button" onClick={onBack} aria-label="Volver" className="grid size-10 place-items-center rounded-full active:bg-white/5">
          <ChevronLeftIcon className="size-5" />
        </button>
        <Avatar state={orbStateOf(s.live, waiting)} size={30} asleep={session ? !session.online : false} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold leading-tight">{session?.title ?? '…'}</p>
          <p className="truncate font-mono text-[11px] text-muted-foreground">
            {session ? `${session.machine} · ${session.project ?? shortPath(session.cwd)}` : ''}
            {session && !session.online && !readOnly && <span className="text-red-400"> · offline</span>}
          </p>
        </div>
        {!readOnly && <AgentsButton agents={s.agents} workflows={s.workflows} onOpen={() => { setAgentFocus(null); setAgentsOpen(true) }} />}
        {!readOnly && !!session?.browsers && (
          <button type="button" onClick={() => setTool('browser')} aria-label="Navegador en vivo"
            className="relative grid size-9 place-items-center rounded-full border border-sky-400/40 bg-sky-400/10 text-sky-300">
            <AppWindowIcon className="size-4" />
            <span className="absolute -right-0.5 -top-0.5 size-2.5 animate-pulse rounded-full bg-sky-400 ring-2 ring-background" />
          </button>
        )}
        {!readOnly && <TasksButton tasks={s.tasks} onOpen={() => setTasksOpen(true)} />}
        <MessagesButton messages={s.messages} recent={session?.messages ?? recentCount(s.messages, s.skew)} onOpen={() => setMsgsOpen(true)} />
        <UsageRing usage={session?.usage ?? null} history={s.contextHistory} />
        {session?.usage?.model && !readOnly && (
          <button type="button" onClick={() => setPalette('settings')} aria-label="Modelo y ajustes"
            className="hidden max-w-24 truncate rounded-full border border-white/10 px-2.5 py-1 font-mono text-[10.5px] text-muted-foreground min-[430px]:block">
            {session.usage.model.replace(/^claude-/, '').replace(/\[1m\]$/, '')}
          </button>
        )}
        {!readOnly && <button type="button" onClick={toggleAway} aria-label="Modo fuera"
          className={cn('grid size-9 place-items-center rounded-full border transition-colors',
            session?.away ? 'border-coral/60 bg-coral/15 text-coral' : 'border-white/10 text-muted-foreground')}>
          {session?.away ? <SmartphoneIcon className="size-4" /> : <MonitorIcon className="size-4" />}
        </button>}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="Más" className="grid size-9 place-items-center rounded-full text-muted-foreground active:bg-white/5">
              <EllipsisVerticalIcon className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-52 rounded-2xl border-white/10 bg-popover/95 backdrop-blur-2xl">
            <DropdownMenuItem onClick={() => setFiles(true)} disabled={!session?.cwd}><FolderTreeIcon />Archivos del proyecto</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTool('term')} disabled={!session?.cwd}><SquareTerminalIcon className="text-emerald-300" />Terminal en esta carpeta</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTool('web')} disabled={!session}><GlobeIcon className="text-sky-300" />Web en desarrollo</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTool('browser')} disabled={!session?.online}><AppWindowIcon className="text-sky-300" />Navegador en vivo</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTool('routine')} disabled={!session?.cwd}><AlarmClockIcon className="text-amber-300" />Programar una rutina aquí</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTool('html')} disabled={!htmlFiles.length}><FileCode2Icon className="text-violet-300" />Páginas HTML
              {htmlFiles.length > 0 && <span className="ml-auto rounded-full bg-violet-500/20 px-1.5 font-mono text-[10.5px] text-violet-200">{htmlFiles.length}</span>}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setMsgsOpen(true)}><RadioTowerIcon />Mensajes
              {s.messages.length > 0 && <span className="ml-auto rounded-full bg-violet-500/20 px-1.5 font-mono text-[10.5px] text-violet-200">{s.messages.length}</span>}
            </DropdownMenuItem>
            {!readOnly && <>
              <DropdownMenuItem onClick={() => setPalette('commands')}><span className="w-4 text-center font-mono font-bold text-coral">/</span>Comandos</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setPalette('skills')}><SparklesIcon className="text-violet-300" />Skills</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setClosing(true)}>
                {session?.online ? <><PowerIcon />Cerrar sesión</> : <><TrashIcon />Quitar de la lista</>}
              </DropdownMenuItem>
            </>}
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {!s.fromTranscript && (
        <StatusBar usage={session?.usage ?? null} history={s.contextHistory}
          plan={plan ? { done: plan.tasks.filter(t => t.status === 'completed').length, total: plan.tasks.length } : null}
          agents={s.agents.filter(a => !a.workflowRunId && (a.status === 'running' || a.status === 'pending')).length}
          workflows={s.workflows.filter(w => w.status === 'running').length}
          tasks={s.tasks.filter(t => t.status === 'running').length} />
      )}
      <div className="flex items-center justify-center gap-2 px-4 pt-1">
        <div className="relative flex rounded-full p-0.5 glass">
          {(['chat', 'diff'] as const).map(t => (
            <button key={t} type="button" onClick={() => setTab(t)}
              className={cn('relative z-10 flex items-center gap-1.5 px-4 py-1 text-[12.5px] font-medium transition-colors',
                tab === t ? 'text-foreground' : 'text-muted-foreground')}>
              {tab === t && <motion.span layoutId="tab" className="absolute inset-0 -z-10 rounded-full bg-white/10" />}
              {t === 'chat' ? 'Chat' : <><GitBranchIcon className="size-3.5" />Cambios</>}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setFiles(true)} disabled={!session?.cwd} aria-label="Archivos"
          className="flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12.5px] font-medium text-muted-foreground glass active:text-foreground">
          <FolderTreeIcon className="size-3.5" />Archivos
        </button>
      </div>

      <AnimatePresence>
        {readOnly && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex justify-center px-4 pt-2">
            <span className="flex items-center gap-1.5 rounded-full border border-violet-400/25 bg-violet-500/10 px-3 py-1 text-[11.5px] font-medium text-violet-200/90">
              <ArchiveIcon className="size-3.5" />Historial guardado · solo lectura
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {tab === 'chat' ? (
        <Conversation className="min-h-0">
          <ConversationContent className="gap-3 px-4 pb-6 pt-4">
            {s.events.length === 0 && !s.live && (
              <div className="mt-24 flex flex-col items-center gap-3 text-center text-muted-foreground">
                <Avatar state="idle" size={64} />
                <p className="text-sm">Sin actividad todavía.</p>
              </div>
            )}
            {s.older > 0 && (
              <button type="button" onClick={() => void s.loadOlder()} disabled={s.loadingOlder}
                className="mx-auto flex items-center gap-2 rounded-full px-4 py-1.5 text-[12.5px] text-muted-foreground glass active:text-foreground disabled:opacity-60">
                {s.loadingOlder ? <LoaderCircleIcon className="size-3.5 animate-spin" /> : <HistoryIcon className="size-3.5" />}
                Cargar anteriores · {s.older}
              </button>
            )}
            <Transcript events={s.events} skew={s.skew} />
            <LiveTurn live={s.live} waiting={waiting} skew={s.skew} />
            <PendingStack pending={s.pending} onDecide={async (p, body) => {
              s.dropPending(p.id)
              try { await s.act('decide', { id: p.id, ...body }) }
              catch (e) { toast.error((e as Error).message) }
            }} />
          </ConversationContent>
          <ConversationScrollButton className="bottom-3 border-white/10 bg-background/70 backdrop-blur-md" />
        </Conversation>
      ) : session ? <GitView machine={session.machine} cwd={session.cwd}
        onAsk={session.online && !readOnly ? text => { void s.act('prompt', { text }).then(() => { setTab('chat'); toast.success('Pedido a Claude', { icon: <SparklesIcon className="size-4 text-violet-300" /> }) }, e => toast.error((e as Error).message)) } : undefined} /> : null}

      {plan && <PlanDock tasks={plan.tasks} />}
      {session && (!session.online || readOnly) ? (
        <div className="px-4 pb-[max(env(safe-area-inset-bottom),14px)] pt-2">
          {readOnly ? (
            <motion.button type="button" whileTap={{ scale: 0.98 }} onClick={() => void resume()} disabled={resuming || !session.cwd}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-coral to-[oklch(0.62_0.15_35)] text-[15px] font-semibold text-background shadow-lg shadow-coral/30 disabled:opacity-60">
              {resuming ? <><LoaderIcon className="size-4 animate-spin" />Esperando a la sesión…</> : <><PlayIcon className="size-4" />Reanudar en {session.machine}</>}
            </motion.button>
          ) : (
            <p className="rounded-2xl px-4 py-3 text-center text-[13px] text-muted-foreground glass">
              Esta sesión está cerrada: nadie recibiría tus mensajes. Ábrela de nuevo desde el PC o con <b className="text-foreground">+</b>.
            </p>
          )}
        </div>
      ) : <>
        <div className="relative mx-3 h-12 shrink-0 border-t border-dashed border-white/6">
          <PetLane mood={stageMood} scale={2} className="absolute inset-0"
            onReady={w => { pet.current = w; w?.talk(talk) }} />
        </div>
        <Composer busy={busy} draftKey={id} inject={inject} onPalette={() => setPalette('commands')}
        machine={session?.machine ?? ''} canAttach={!!session?.online && !readOnly} onTyping={onTyping}
        onSend={async (text, mode) => {
          try {
            await s.act('prompt', { text, mode })
            pet.current?.react('sent')
            if (mode === 'now') toast.success('Enviado al turno en curso', { icon: <ZapIcon className="size-4" /> })
            else if (mode === 'interrupt') toast.warning('Interrumpido', { description: 'Empieza con tu mensaje', icon: <OctagonPauseIcon className="size-4" /> })
            else if (busy) toast.info('En cola', { description: 'Se envía al terminar', icon: <ClockIcon className="size-4" /> })
          } catch (e) { toast.error((e as Error).message); throw e }
        }}
        onStop={() => { aborted.current = true; void s.act('abort'); toast.warning('Interrumpido', { icon: <OctagonPauseIcon className="size-4" /> }) }} />
      </>}
      <CommandPalette id={id} open={palette !== null} initialTab={palette ?? 'commands'} onOpenChange={v => { if (!v) setPalette(null) }} />
      {session && (
        <Explorer machine={session.machine} root={session.cwd} open={files} onClose={() => setFiles(false)}
          onMention={session.online && !readOnly ? ref => { setInject(i => ({ text: ref, n: (i?.n ?? 0) + 1 })); toast.success('Mencionado en el mensaje', { description: ref, icon: <AtSignIcon className="size-4" /> }) } : undefined} />
      )}
      <Dialog open={closing} onOpenChange={setClosing}>
        <DialogContent className="rounded-3xl border-white/10 bg-popover/95 backdrop-blur-2xl">
          <DialogHeader>
            <DialogTitle>{session?.online ? '¿Cerrar esta sesión?' : '¿Quitarla de la lista?'}</DialogTitle>
            <DialogDescription>
              {session?.online
                ? `Claude Code sale en ${session.machine} como con /exit. La conversación queda guardada: puedes continuarla al abrir el proyecto.`
                : 'Solo desaparece del panel; la conversación sigue guardada en la PC.'}
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <button type="button" onClick={() => setClosing(false)} className="h-11 flex-1 rounded-2xl border border-white/10 text-[14px]">Cancelar</button>
            <button type="button" onClick={async () => {
              setClosing(false)
              try {
                const r = await s.act('close') as { forgot?: boolean }
                if (r?.forgot) { toast.success('Quitada de la lista', { icon: <TrashIcon className="size-4" /> }); onBack() }
                else toast.warning('Cerrando sesión…', { description: session?.title, icon: <PowerIcon className="size-4" /> })
              } catch (e) { toast.error((e as Error).message) }
            }} className="h-11 flex-1 rounded-2xl bg-red-500/90 text-[14px] font-semibold text-white">
              {session?.online ? 'Cerrar' : 'Quitar'}
            </button>
          </div>
        </DialogContent>
      </Dialog>
      <AgentsSheet sid={id} agents={s.agents} workflows={s.workflows} events={s.events} skew={s.skew} open={agentsOpen} onOpenChange={setAgentsOpen} focus={agentFocus} onFocus={setAgentFocus}
        onExpand={aid => { setAgentsOpen(false); setExpanded(aid) }} />
      {session && <AgentScreen sid={id} machine={session.machine} agent={s.agents.find(a => a.id === expanded) ?? null} events={s.events} skew={s.skew} onClose={() => setExpanded(null)} />}
      <MessagesSheet messages={s.messages} skew={s.skew} title={session?.title} ready={!!session} open={msgsOpen} onOpenChange={setMsgsOpen} />
      {session && <>
        <TerminalScreen open={tool === 'term'} onClose={() => setTool(null)} machines={[{ name: session.machine, online: true }]} machine={session.machine} cwd={session.cwd} />
        <RoutinesScreen open={tool === 'routine'} onClose={() => setTool(null)} machines={[{ name: session.machine, online: true }]}
          onOpenSession={() => setTool(null)} preset={tool === 'routine' ? { machine: session.machine, cwd: session.cwd } : null} />
        <BrowserScreen open={tool === 'browser'} onClose={() => setTool(null)} machine={session.machine} session={id} />
        <PreviewsSheet open={tool === 'web'} onClose={() => setTool(null)} machines={[{ name: session.machine, online: true }]} machine={session.machine} />
      </>}
      <Dialog open={tool === 'html'} onOpenChange={v => { if (!v) setTool(null) }}>
        <DialogContent className="rounded-3xl border-white/10 bg-popover/95 backdrop-blur-2xl">
          <DialogHeader>
            <DialogTitle>Páginas HTML</DialogTitle>
            <DialogDescription>Las que Claude escribió o editó en esta sesión. Se ven renderizadas.</DialogDescription>
          </DialogHeader>
          <div className="-mx-2 flex max-h-[55vh] flex-col overflow-y-auto">
            {htmlFiles.map(f => (
              <button key={f.file} type="button" onClick={() => { setTool(null); if (session) void openHtmlFile(session.machine, f.file) }}
                className="flex items-center gap-3 rounded-2xl px-3 py-2.5 text-left active:bg-white/5">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-violet-500/15 text-violet-300"><GlobeIcon className="size-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium">{f.file.split(/[\/]/).pop()}</span>
                  <span className="block truncate font-mono text-[10.5px] text-muted-foreground/70">{shortPath(f.file)}</span>
                </span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      <TasksSheet tasks={s.tasks} skew={s.skew} open={tasksOpen} onOpenChange={setTasksOpen}
        onStop={id => { void s.act('stopTask', { id }); toast.warning('Deteniendo tarea…', { icon: <OctagonXIcon className="size-4" /> }) }} />
    </div>
    </SessionContext.Provider>
  )
}
