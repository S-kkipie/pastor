import {
  BanIcon, BotIcon, ChevronRightIcon, FilePenLineIcon, FilePlus2Icon, FileTextIcon, GlobeIcon, ListTodoIcon,
  type LucideIcon, MessageCircleQuestionIcon, PlugIcon, SearchIcon, SparklesIcon, TerminalIcon, TriangleAlertIcon,
  WrenchIcon, LayersIcon, CheckIcon, CircleCheckIcon, CircleDashedIcon, LoaderCircleIcon,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { BundledLanguage } from 'shiki'

import { CodeBlock, CodeBlockCopyButton } from '@/components/ai-elements/code-block'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Progress } from '@/components/ui/progress'
import { api } from '@/lib/api'
import { useSessionCtx } from '@/lib/ctx'

import { isAsyncLaunch } from './agentgroup'
import { isHtml, openHtmlFile } from './webviewer'
import { genericView, RICH_ICONS, richView } from './toolviews'
import { dur, editDiff, fileName, langOf, shortPath, tokens } from '@/lib/format'
import { useNow } from '@/lib/hooks'
import type { PlanTask } from '@/lib/plan'
import type { Detail, FsFile, PastorEvent } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useBackClose } from '@/lib/back'

type ToolState = 'running' | 'ok' | 'error' | 'denied'

const stateOf = (ev: PastorEvent): ToolState =>
  !ev.end ? 'running' : ev.end.ok ? 'ok' : /deneg|denied|rechaz|reject/i.test(ev.end.out ?? '') ? 'denied' : 'error'

const ICONS: Record<string, LucideIcon> = {
  Bash: TerminalIcon, PowerShell: TerminalIcon, Read: FileTextIcon, Edit: FilePenLineIcon, MultiEdit: FilePenLineIcon,
  NotebookEdit: FilePenLineIcon, Write: FilePlus2Icon, Grep: SearchIcon, Glob: SearchIcon, WebFetch: GlobeIcon,
  WebSearch: GlobeIcon, TodoWrite: ListTodoIcon, Agent: BotIcon, Task: BotIcon, AskUserQuestion: MessageCircleQuestionIcon,
  Skill: SparklesIcon, ToolSearch: SearchIcon,
}
export const iconOf = (tool = ''): LucideIcon => tool.startsWith('mcp__') ? PlugIcon : ICONS[tool] ?? RICH_ICONS[tool] ?? WrenchIcon

function Code({ code, lang, className }: { code: string; lang: string; className?: string }) {
  return (
    <CodeBlock code={code} language={lang as BundledLanguage}
      className={cn('max-h-72 overflow-auto rounded-xl border-white/8 bg-black/35 text-[12px] [&_pre]:!bg-transparent', className)}>
      <CodeBlockCopyButton className="size-7 opacity-70" />
    </CodeBlock>
  )
}

function Output({ text, error }: { text?: string; error?: boolean }) {
  const [all, setAll] = useState(false)
  if (!text) return null
  const long = text.split('\n').length > 8
  return (
    <div className="relative">
      <pre className={cn(
        'overflow-x-auto rounded-xl border border-white/8 bg-black/35 px-3 py-2.5 font-mono text-[11.5px] leading-relaxed',
        error ? 'text-red-300' : 'text-muted-foreground', !all && 'max-h-40 overflow-y-hidden',
      )}>{text}</pre>
      {long && !all && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 rounded-b-xl bg-gradient-to-t from-black/60" />}
      {long && (
        <button type="button" onClick={() => setAll(!all)}
          className="relative mt-1.5 rounded-full border border-white/10 px-2.5 py-0.5 text-[11px] text-muted-foreground">
          {all ? 'Ver menos' : 'Ver todo'}
        </button>
      )}
    </div>
  )
}

const IMAGE = /\.(png|jpe?g|gif|webp|svg|ico)$/i

// A Read of an image: the picture itself, fetched from the session's PC when
// the row opens; tap for full screen.
// A page Claude wrote or edited (an HTML "artifact"): rendered on the phone.
function OpenHtmlButton({ file }: { file: string }) {
  const ctx = useSessionCtx()
  if (!ctx) return null
  return (
    <button type="button" onClick={e => { e.stopPropagation(); void openHtmlFile(ctx.machine, file) }}
      className="mb-2 flex w-full items-center justify-center gap-2 rounded-xl border border-violet-400/30 bg-violet-500/10 py-2 text-[13px] font-medium text-violet-100 active:bg-violet-500/20">
      <GlobeIcon className="size-4 text-violet-300" />Ver la página renderizada
    </button>
  )
}

export function ImagePreviewPath({ file, compact }: { file: string; compact?: boolean }) {
  const ctx = useSessionCtx()
  const [f, setF] = useState<FsFile | null>(null)
  const [err, setErr] = useState('')
  const [full, setFull] = useState(false)
  useBackClose(full, () => setFull(false))
  useEffect(() => {
    if (!ctx) return
    const abs = /^([a-z]:[\\/]|\/)/i.test(file) ? file : `${ctx.cwd}/${file}`
    api<FsFile>(`/api/fs?${new URLSearchParams({ machine: ctx.machine, op: 'read', path: abs })}`).then(setF, e => setErr((e as Error).message))
  }, [ctx, file])
  if (err) return <p className="text-[12px] text-red-400">{err}</p>
  if (!f) return <div className="h-40 w-full animate-pulse rounded-xl bg-white/[0.05]" />
  if (f.kind !== 'image') return <p className="text-[12px] text-muted-foreground">No se puede previsualizar ({f.kind}).</p>
  return (
    <>
      <motion.button type="button" onClick={() => setFull(true)} initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
        className="overflow-hidden rounded-xl border border-white/8 bg-[repeating-conic-gradient(#ffffff08_0_25%,transparent_0_50%)] bg-[length:16px_16px]">
        <img src={f.data} alt={fileName(file)} className={cn('w-full object-contain', compact ? 'max-h-32' : 'max-h-72')} />
      </motion.button>
      <AnimatePresence>
        {full && (
          <motion.button type="button" onClick={() => setFull(false)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] grid place-items-center bg-black/90 p-3 backdrop-blur-md">
            <motion.img src={f.data} alt={fileName(file)} initial={{ scale: 0.9 }} animate={{ scale: 1 }} className="max-h-full max-w-full object-contain" />
            <span className="absolute bottom-[max(env(safe-area-inset-bottom),16px)] rounded-full bg-white/10 px-3 py-1 font-mono text-[11px] text-white/80">{fileName(file)}</span>
          </motion.button>
        )}
      </AnimatePresence>
    </>
  )
}

const Kv = ({ children }: { children: ReactNode }) =>
  <p className="font-mono text-[11.5px] leading-relaxed text-muted-foreground break-words">{children}</p>

// What a call shows: its label, a one-line detail, badges, and the body
// revealed when opened.
function view(ev: PastorEvent): { label: string; detail: string; badge?: ReactNode; body: ReactNode } {
  const d: Detail = ev.detail ?? {}
  const tool = ev.tool ?? '?'
  const state = stateOf(ev)
  const out = <Output text={ev.end?.out} error={state === 'error'} />
  const errOnly = state === 'error' ? out : null
  if (tool.startsWith('mcp__')) {
    const [, server, name] = tool.split('__')
    return { label: d.name ?? name ?? tool, detail: `· ${d.server ?? server}`, body: <>{d.args && <Kv>{d.args}</Kv>}{out}</> }
  }
  // Claude Code's own tools with a card of their own (toolviews.tsx).
  const rich = richView(ev, { out, Code, error: state === 'error' })
  if (rich) return rich
  switch (tool) {
    case 'Bash': case 'PowerShell':
      return {
        label: d.description || (tool === 'Bash' ? 'Comando' : 'PowerShell'),
        detail: d.command ?? ev.text,
        body: <><Code code={d.command ?? ev.text} lang={tool === 'Bash' ? 'bash' : 'powershell'} />{out}</>,
      }
    case 'Read': {
      const lines = ev.end?.out?.match(/^(\d+) líneas$/)?.[1]
      return {
        label: 'Leer', detail: shortPath(d.file ?? ev.text),
        badge: <>{d.offset != null && <Chip>L{d.offset}{d.limit ? `–${Number(d.offset) + Number(d.limit)}` : ''}</Chip>}{lines && <Chip>{lines} líneas</Chip>}{IMAGE.test(d.file ?? '') && <Chip>imagen</Chip>}</>,
        body: IMAGE.test(d.file ?? '') && state !== 'error' ? <ImagePreviewPath file={d.file} /> : errOnly,
      }
    }
    case 'Edit': case 'MultiEdit': {
      const edits: { old?: string; new?: string }[] = d.edits ?? [{ old: d.old, new: d.new }]
      const diffs = edits.map(e => editDiff(e.old, e.new))
      const plus = diffs.reduce((a, x) => a + x.plus, 0), minus = diffs.reduce((a, x) => a + x.minus, 0)
      return {
        label: 'Editar', detail: shortPath(d.file ?? ev.text),
        badge: <><span className="text-emerald-400">+{plus}</span><span className="text-red-400">−{minus}</span>{edits.length > 1 && <Chip>×{edits.length}</Chip>}</>,
        body: <>{isHtml(d.file) && state !== 'error' && <OpenHtmlButton file={d.file} />}<Code code={diffs.map(x => x.text).join('\n⋯\n')} lang="diff" />{errOnly}</>,
      }
    }
    case 'Write':
      return {
        label: 'Escribir', detail: shortPath(d.file ?? ev.text),
        badge: d.lines ? <span className="text-emerald-400">+{d.lines}</span> : undefined,
        body: <>{isHtml(d.file) && state !== 'error' && <OpenHtmlButton file={d.file} />}{d.head && <Code code={d.head} lang={langOf(d.file)} />}{errOnly}</>,
      }
    case 'Grep': case 'Glob': {
      const n = ev.end?.out?.match(/^(\d+) archivos/)?.[1]
      return {
        label: tool === 'Grep' ? 'Buscar' : 'Archivos', detail: `${d.pattern ?? ev.text}${d.path ? `  en ${shortPath(d.path)}` : ''}`,
        badge: n ? <Chip>{n}</Chip> : undefined, body: out,
      }
    }
    case 'WebFetch': {
      let detail = ev.text
      try { const u = new URL(d.url ?? ev.text); detail = u.hostname + u.pathname } catch { /* not a URL */ }
      return { label: 'Web', detail, body: <>{d.prompt && <Kv>{d.prompt}</Kv>}{out}</> }
    }
    case 'WebSearch': return { label: 'Buscar en web', detail: `“${d.query ?? ev.text}”`, body: out }
    case 'AskUserQuestion': return { label: 'Pregunta', detail: ev.text, body: null }
    case 'Skill': return {
      label: d.skill ? `Skill · ${String(d.skill).split(':').pop()}` : 'Skill', detail: d.args || (d.skill ? '' : ev.text),
      badge: d.skill?.includes(':') ? <Chip>{String(d.skill).split(':')[0]}</Chip> : undefined,
      body: <>{d.args && <Kv>{d.args}</Kv>}{out}</>,
    }
    default: return genericView(ev, { out, Code, error: state === 'error' }) ?? { label: tool, detail: ev.text, body: out }
  }
}

const Chip = ({ children }: { children: ReactNode }) =>
  <span className="rounded-full border border-white/10 px-1.5 font-mono text-[10.5px] text-muted-foreground">{children}</span>

function Elapsed({ from, skew }: { from: number; skew: number }) {
  const now = useNow(1000)
  return <span className="tabular-nums">{dur(now - skew - from) || '0s'}</span>
}

// A step's ✓: it pops when the step ends while you watch; from history it is just there.
function DoneTick({ pop }: { pop: boolean }) {
  return (
    <motion.span initial={pop ? { scale: 0.3, opacity: 0 } : false} animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 600, damping: 14 }}
      className="grid size-3.5 place-items-center rounded-full bg-emerald-400/15 text-emerald-400">
      <CheckIcon className="size-2.5" strokeWidth={3} />
    </motion.span>
  )
}

function StatusMark({ state }: { state: ToolState }) {
  const sawRunning = useRef(state === 'running')
  if (state === 'running') { sawRunning.current = true; return <LoaderCircleIcon className="size-3.5 animate-spin text-coral" /> }
  if (state === 'error') return <TriangleAlertIcon className="size-3.5 text-red-400" />
  if (state === 'denied') return <BanIcon className="size-3.5 text-muted-foreground" />
  return <DoneTick pop={sawRunning.current} />
}

export function ToolCard({ ev, skew, children, nested }: { ev: PastorEvent; skew: number; children?: ReactNode; nested?: boolean }) {
  const state = stateOf(ev)
  const v = view(ev)
  const Icon = iconOf(ev.tool)
  const [open, setOpen] = useState(state === 'error')
  const hasBody = !!v.body || !!children
  return (
    <motion.div initial={nested ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
      <Collapsible open={open} onOpenChange={setOpen} disabled={!hasBody}>
        <CollapsibleTrigger className={cn(
          'group flex min-h-11 w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors active:bg-white/5',
          state === 'error' && 'bg-red-500/5 ring-1 ring-red-500/20',
        )}>
          <span className={cn(
            'grid size-7 shrink-0 place-items-center rounded-lg border border-white/8 bg-white/[0.04]',
            state === 'running' && 'border-coral/40 bg-coral/10 shadow-[0_0_16px_-4px] shadow-coral/60',
          )}>
            <Icon className={cn('size-3.5', state === 'running' ? 'text-coral' : state === 'error' ? 'text-red-400' : 'text-muted-foreground')} />
          </span>
          <span className={cn('shrink-0 text-[13.5px] font-medium', state === 'running' ? 'text-shine' : 'text-foreground/90',
            state === 'denied' && 'line-through text-muted-foreground')}>{v.label}</span>
          <code className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-muted-foreground/80">{v.detail}</code>
          <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10.5px] text-muted-foreground/70">
            {v.badge}
            {state === 'running' ? <Elapsed from={ev.t} skew={skew} /> : dur(ev.end?.ms)}
            <StatusMark state={state} />
            {hasBody && <ChevronRightIcon className="size-3.5 opacity-50 transition-transform group-data-[state=open]:rotate-90" />}
          </span>
        </CollapsibleTrigger>
        {hasBody && (
          <CollapsibleContent className="data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-1">
            <div className="ml-[42px] flex flex-col gap-2 pb-2.5 pt-1">{v.body}{children}</div>
          </CollapsibleContent>
        )}
      </Collapsible>
      {!nested && <HtmlPages events={[ev]} />}
    </motion.div>
  )
}

// Pages Claude wrote or edited in these steps, one tap away from being seen
// rendered (they would otherwise hide inside a folded step).
function HtmlPages({ events }: { events: PastorEvent[] }) {
  const ctx = useSessionCtx()
  const files = [...new Set(events.filter(e => (e.tool === 'Write' || e.tool === 'Edit' || e.tool === 'MultiEdit') && e.end?.ok && isHtml(e.detail?.file)).map(e => String(e.detail!.file)))]
  if (!ctx || !files.length) return null
  return (
    <div className="ml-[42px] mt-1 flex flex-wrap gap-1.5">
      {files.map(f => (
        <button key={f} type="button" onClick={() => void openHtmlFile(ctx.machine, f)}
          className="flex max-w-full items-center gap-1.5 rounded-full border border-violet-400/35 bg-violet-500/12 px-3 py-1.5 text-[12.5px] text-violet-100 active:bg-violet-500/25">
          <GlobeIcon className="size-3.5 shrink-0 text-violet-300" /><span className="truncate">Ver {fileName(f)}</span>
        </button>
      ))}
    </div>
  )
}

const VERB: Record<string, string> = {
  Bash: 'comando', PowerShell: 'comando', Read: 'lectura', Edit: 'edición', MultiEdit: 'edición', Write: 'archivo nuevo',
  Grep: 'búsqueda', Glob: 'búsqueda', WebFetch: 'página', WebSearch: 'búsqueda web', Skill: 'skill', ToolSearch: 'carga',
  CronCreate: 'programación', CronDelete: 'programación', CronList: 'programación', Monitor: 'monitor', TaskStop: 'detención',
  ScheduleWakeup: 'despertar', SendMessage: 'mensaje', SendFile: 'envío', PushNotification: 'aviso', LSP: 'consulta LSP',
  NotebookEdit: 'celda', EnterWorktree: 'worktree', ExitWorktree: 'worktree', ListAgents: 'consulta', Artifact: 'artifact',
}
// Spanish plurals of those words, adjectives too ("archivos nuevos"); names
// ("web", "LSP") stay as they are.
const pluralWord = (w: string) => (w === 'web' || w === w.toUpperCase() ? w
  : /[aeiouáéó]$/.test(w) ? `${w}s` : w.endsWith('ón') ? `${w.slice(0, -2)}ones` : `${w}es`)
const plural = (v: string) => v.split(' ').map(pluralWord).join(' ')
const EXPLORE = new Set(['Read', 'Grep', 'Glob', 'ToolSearch', 'WebSearch', 'WebFetch', 'LS'])

export function ToolGroup({ list, skew }: { list: PastorEvent[]; skew: number }) {
  const running = list.some(e => !e.end)
  const sawRunning = useRef(running)
  if (running) sawRunning.current = true
  const [open, setOpen] = useState(false)
  const counts = new Map<string, number>()
  let plus = 0, minus = 0
  for (const e of list) {
    const verb = VERB[e.tool ?? ''] ?? (e.tool?.startsWith('mcp__') ? 'mcp' : e.tool ?? '?')
    counts.set(verb, (counts.get(verb) ?? 0) + 1)
    if (e.tool === 'Edit' || e.tool === 'MultiEdit') {
      const edits: { old?: string; new?: string }[] = e.detail?.edits ?? [{ old: e.detail?.old, new: e.detail?.new }]
      for (const x of edits) { const r = editDiff(x.old, x.new); plus += r.plus; minus += r.minus }
    }
  }
  const allExplore = list.every(e => EXPLORE.has(e.tool ?? ''))
  const allBash = list.every(e => e.tool === 'Bash' || e.tool === 'PowerShell')
  const label = allBash ? `${running ? 'Ejecutando' : 'Ejecutó'} ${list.length} comandos`
    : allExplore ? (running ? 'Explorando…' : 'Exploró el código') : (running ? 'Trabajando…' : `${list.length} pasos`)
  const sum = [...counts].map(([v, n]) => `${n} ${n > 1 && !v.endsWith('s') ? plural(v) : v}`).join(' · ')
  const ms = list.reduce((a, e) => a + (e.end?.ms ?? 0), 0)
  const current = list.find(e => !e.end)
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="group flex min-h-11 w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left active:bg-white/5">
          <span className={cn('grid size-7 shrink-0 place-items-center rounded-lg border border-white/8 bg-white/[0.04]',
            running && 'border-coral/40 bg-coral/10')}>
            <LayersIcon className={cn('size-3.5', running ? 'text-coral' : 'text-muted-foreground')} />
          </span>
          <span className={cn('shrink-0 text-[13.5px] font-medium', running ? 'text-shine' : 'text-foreground/90')}>{label}</span>
          <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted-foreground/80">
            {running && current ? `${current.tool} · ${current.text}` : sum}
          </span>
          <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10.5px] text-muted-foreground/70">
            {(plus > 0 || minus > 0) && <><span className="text-emerald-400">+{plus}</span><span className="text-red-400">−{minus}</span></>}
            {running ? <LoaderCircleIcon className="size-3.5 animate-spin text-coral" /> : <>{dur(ms)}<DoneTick pop={sawRunning.current} /></>}
            <ChevronRightIcon className="size-3.5 opacity-50 transition-transform group-data-[state=open]:rotate-90" />
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent className="data-[state=open]:animate-in data-[state=open]:fade-in-0">
          <div className="ml-[22px] border-l border-white/8 pl-2.5">
            {list.map(e => <ToolCard key={e.seq} ev={e} skew={skew} nested />)}
          </div>
        </CollapsibleContent>
      </Collapsible>
      {!running && <HtmlPages events={list} />}
    </motion.div>
  )
}

export function AgentCard({ ev, kids, skew }: { ev: PastorEvent; kids: PastorEvent[]; skew: number }) {
  const d = ev.detail ?? {}
  const ctx = useSessionCtx()
  // Background subagents answer their call at once: their real state is their agent row.
  const row = ctx?.agents.find(a => a.toolUseId === ev.id)
  const bg = isAsyncLaunch(ev)
  const live = row ? ['running', 'pending', 'waiting'].includes(row.status) : !ev.end
  const state: ToolState = row ? (live ? 'running' : row.status === 'failed' || row.status === 'killed' ? 'error' : 'ok') : stateOf(ev)
  const [open, setOpen] = useState(live && !bg)
  const tail = kids.slice(-3)
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
      className={cn('my-1.5 overflow-hidden rounded-2xl glass', state === 'running' && 'ring-1 ring-coral/25')}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="group flex w-full items-center gap-3 px-3.5 py-3 text-left">
          <span className="relative grid size-8 place-items-center rounded-xl bg-gradient-to-br from-coral/30 to-violet-500/20">
            <BotIcon className="size-4 text-coral-soft" />
            {state === 'running' && <span className="absolute -right-0.5 -top-0.5 size-2.5 animate-pulse rounded-full bg-coral" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className={cn('block truncate text-[14px] font-medium', state === 'running' && 'text-shine')}>{d.description || 'Subagente'}</span>
            <span className="block text-[11.5px] text-muted-foreground">
              {d.type || 'agent'}{bg ? ' · en segundo plano' : ''} · {row?.tools ?? kids.length} herramientas{row?.tokens ? ` · ${tokens(row.tokens)} tok` : ''}{!live && !bg && ev.end?.ms ? ` · ${dur(ev.end.ms)}` : ''}
            </span>
          </span>
          <StatusMark state={state} />
          <ChevronRightIcon className="size-4 opacity-50 transition-transform group-data-[state=open]:rotate-90" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t border-white/6 px-2 pb-2 pt-1">
            {kids.length > 3 && <p className="px-2 py-1 text-[11.5px] text-muted-foreground">+{kids.length - 3} anteriores</p>}
            {tail.map(k => <ToolCard key={k.seq} ev={k} skew={skew} nested />)}
            {kids.length === 0 && state === 'running' && <p className="px-2 py-2 text-[12.5px] text-shine">Arrancando…</p>}
            {!bg && ev.end?.out && state !== 'running' && <div className="px-2 pt-1"><Output text={ev.end.out} error={state === 'error'} /></div>}
            {row?.answer && !live && <p className="mx-2 mt-1 line-clamp-4 text-[12.5px] text-muted-foreground">{row.answer}</p>}
            {ctx && ev.id && (
              <button type="button" onClick={() => ctx.openAgent(ev.id!)}
                className="mx-2 mt-2 flex h-9 w-[calc(100%-1rem)] items-center justify-center gap-2 rounded-xl border border-violet-400/25 bg-violet-500/10 text-[12.5px] font-medium text-violet-200 active:scale-[0.98]">
                <BotIcon className="size-3.5" />Ver conversación y escribirle
              </button>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </motion.div>
  )
}

export function PlanCard({ tasks }: { tasks: PlanTask[] }) {
  const done = tasks.filter(t => t.status === 'completed').length
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0
  return (
    <motion.div layout initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="my-2 rounded-2xl glass p-3.5">
      <div className="mb-2.5 flex items-center gap-2">
        <ListTodoIcon className="size-4 text-coral" />
        <span className="text-[13.5px] font-semibold">Plan</span>
        <span className="ml-auto font-mono text-[11.5px] text-muted-foreground">{done}/{tasks.length}</span>
      </div>
      <Progress value={pct} className="mb-3 h-1 bg-white/8 [&>div]:bg-gradient-to-r [&>div]:from-coral [&>div]:to-coral-soft" />
      <ul className="flex flex-col gap-1.5">
        {tasks.map(t => (
          <motion.li layout key={t.id} className={cn('flex items-start gap-2.5 text-[13.5px] leading-snug',
            t.status === 'completed' && 'text-muted-foreground/60 line-through',
            t.status === 'in_progress' && 'font-medium text-foreground',
            t.status === 'pending' && 'text-muted-foreground')}>
            <TaskMark status={t.status} />
            <span className={cn(t.status === 'in_progress' && 'text-shine')}>{t.status === 'in_progress' && t.active ? t.active : t.content}</span>
          </motion.li>
        ))}
      </ul>
    </motion.div>
  )
}

function TaskMark({ status, small }: { status: PlanTask['status']; small?: boolean }) {
  const size = small ? 'mt-px size-3.5' : 'mt-0.5 size-4'
  if (status === 'completed') return <CircleCheckIcon className={cn(size, 'shrink-0 text-emerald-400/80')} />
  if (status === 'in_progress') return <LoaderCircleIcon className={cn(size, 'shrink-0 animate-spin text-coral')} />
  return <CircleDashedIcon className={cn(size, 'shrink-0 opacity-50')} />
}

// The plan pinned above the composer while work remains: progress and the
// task in hand; a tap opens the whole list.
export function PlanDock({ tasks }: { tasks: PlanTask[] }) {
  const [open, setOpen] = useState(false)
  const done = tasks.filter(t => t.status === 'completed').length
  const current = tasks.find(t => t.status === 'in_progress') ?? tasks.find(t => t.status === 'pending')
  if (done === tasks.length) return null
  const C = 56.5
  return (
    <div className="px-3">
      <motion.button type="button" layout onClick={() => setOpen(!open)} className="w-full overflow-hidden rounded-2xl px-3.5 py-2.5 text-left glass">
        <div className="flex items-center gap-2.5">
          <svg viewBox="0 0 24 24" className="size-6 shrink-0 -rotate-90">
            <circle cx="12" cy="12" r="9" className="fill-none stroke-white/10" strokeWidth="2.5" />
            <circle cx="12" cy="12" r="9" className="fill-none stroke-coral transition-all duration-700" strokeWidth="2.5" strokeLinecap="round"
              strokeDasharray={C} strokeDashoffset={C * (1 - done / tasks.length)} />
          </svg>
          <span className="min-w-0 flex-1 truncate text-[13px]">
            <span className="text-muted-foreground">{done}/{tasks.length} · </span>
            <span className={cn(current?.status === 'in_progress' && 'text-shine')}>
              {current?.status === 'in_progress' && current.active ? current.active : current?.content}
            </span>
          </span>
          <ChevronRightIcon className={cn('size-4 opacity-50 transition-transform', open && '-rotate-90')} />
        </div>
        {open && (
          <ul className="mt-2.5 flex flex-col gap-1.5 border-t border-white/6 pt-2.5">
            {tasks.map(t => (
              <li key={t.id} className={cn('flex items-start gap-2 text-[12.5px]',
                t.status === 'completed' ? 'text-muted-foreground/60 line-through' : t.status === 'in_progress' ? 'text-foreground' : 'text-muted-foreground')}>
                <TaskMark status={t.status} small />{t.content}
              </li>
            ))}
          </ul>
        )}
      </motion.button>
    </div>
  )
}

export { fileName }
