import { BotIcon, BrainIcon, CheckIcon, SparklesIcon, SquareTerminalIcon, ChevronDownIcon, LaptopIcon, ShieldAlertIcon, SmartphoneIcon, XIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { BundledLanguage } from 'shiki'

import { CodeBlock } from '@/components/ai-elements/code-block'
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message'
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning'
import { Button } from '@/components/ui/button'
import { dur, editDiff, langOf, shortPath, tokens } from '@/lib/format'
import { PLAN_TOOLS, planOf } from '@/lib/plan'
import { useSessionCtx } from '@/lib/ctx'
import { useNow } from '@/lib/hooks'
import type { Live, PastorEvent, Pending, SessionSummary } from '@/lib/types'
import { cn } from '@/lib/utils'

import { Avatar } from './avatar'
import { ReceiptChip } from './receipt'
import type { OrbState } from './orb'
import { AgentGroup } from './agentgroup'
import { SkillCard } from './skillcard'
import { AgentCard, iconOf, PlanCard, ToolCard, ToolGroup } from './tools'

const isAgent = (e: PastorEvent) => e.tool === 'Agent' || e.tool === 'Task'

// Events become blocks: messages, single tool rows, groups of consecutive
// calls, the plan, and subagents with their own calls beneath them.
export function Transcript({ events, skew }: { events: PastorEvent[]; skew: number }) {
  const ctx = useSessionCtx()
  const agentByCall = useMemo(() => new Map((ctx?.agents ?? []).filter(a => a.toolUseId).map(a => [a.toolUseId!, a.id])), [ctx?.agents])
  const blocks = useMemo(() => {
    const main = events.filter(e => !e.agent)
    const agentRows = main.filter(e => e.kind === 'tool' && isAgent(e))
    // A subagent's own calls, by its id (its Agent call's tool_use_id → agentId);
    // by order only when the session sent no agent list (an older mod).
    const agentIds = [...new Set(events.filter(e => e.agent).map(e => e.agent!))]
    const kidsOf = new Map(agentRows.map((row, i) => {
      const id = agentByCall.size ? agentByCall.get(row.id ?? '') : agentIds[i]
      return [row.seq, id ? events.filter(e => e.agent === id) : []]
    }))
    // Subagents launched together (3 or more in a row) share one compact card.
    let agentRun: PastorEvent[] = []
    const flushAgents = () => {
      if (agentRun.length >= 3) out.push({ key: `ag${agentRun[0]!.seq}`, node: <AgentGroup list={agentRun} /> })
      else for (const a of agentRun) out.push({ key: `a${a.seq}`, node: <AgentCard ev={a} kids={kidsOf.get(a.seq) ?? []} skew={skew} /> })
      agentRun = []
    }
    // The plan is drawn once, where it last changed.
    const plan = planOf(events)
    const out: { key: string; node: ReactNode }[] = []
    let run: PastorEvent[] = []
    const flush = () => {
      if (run.length >= 2) out.push({ key: `g${run[0]!.seq}`, node: <ToolGroup list={run} skew={skew} /> })
      else for (const e of run) out.push({ key: `t${e.seq}`, node: <ToolCard ev={e} skew={skew} /> })
      run = []
    }
    for (const ev of main) {
      if (ev.kind === 'tool') {
        if (!isAgent(ev)) flushAgents()
        if (PLAN_TOOLS.has(ev.tool ?? '')) {
          if (plan && ev.seq === plan.lastSeq) { flush(); out.push({ key: 'plan', node: <PlanCard tasks={plan.tasks} /> }) }
          continue
        }
        if (isAgent(ev)) { flush(); agentRun.push(ev); continue }
        // A skill invoked is its own card, never folded into a group of calls.
        if (ev.tool === 'Skill') { flush(); out.push({ key: `s${ev.seq}`, node: <SkillCard ev={ev} /> }); continue }
        if (ev.end && !ev.end.ok) { flush(); out.push({ key: `t${ev.seq}`, node: <ToolCard ev={ev} skew={skew} /> }); continue }
        run.push(ev)
        continue
      }
      flush()
      flushAgents()
      if (ev.kind === 'command') { out.push({ key: `c${ev.seq}`, node: <CommandCard ev={ev} skew={skew} /> }); continue }
      if (ev.kind === 'receipt') { out.push({ key: `r${ev.seq}`, node: <ReceiptChip receipt={ev.receipt} /> }); continue }
      // A skill's own instructions, injected when it loads: one folded line, not a wall of text.
      if (ev.kind === 'user' && /^Base directory for this skill:/.test(ev.text)) {
        const skill = ev.text.match(/^Base directory for this skill: .*[\\/]([^\\/\n]+)\s*$/m)?.[1] ?? 'skill'
        out.push({ key: `k${ev.seq}`, node: (
          <details className="mx-auto w-full max-w-[92%] rounded-2xl border border-violet-400/20 bg-violet-500/[0.05] px-3 py-2 text-[12px]">
            <summary className="flex cursor-pointer items-center gap-2 text-violet-200"><SparklesIcon className="size-3.5" />Instrucciones de la skill <span className="font-mono text-violet-300/80">{skill}</span></summary>
            <p className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap text-muted-foreground">{ev.text.slice(0, 20000)}</p>
          </details>
        ) })
        continue
      }
      if (ev.kind === 'user' && /^\s*<(task-notification|agent-message)\b/.test(ev.text)) {
        out.push({ key: `n${ev.seq}`, node: <NoticeChip text={ev.text} /> })
        continue
      }
      if (ev.kind === 'user') {
        out.push({
          key: `u${ev.seq}`, node: (
            <Message from="user" className="max-w-[86%]">
              <MessageContent className="rounded-[20px] rounded-br-md border border-white/8 bg-gradient-to-br from-white/[0.09] to-white/[0.04] px-4 py-2.5 text-[15px] whitespace-pre-wrap">
                {ev.text}
              </MessageContent>
              {ev.via === 'phone' && <span className="ml-auto flex items-center gap-1 text-[10.5px] text-muted-foreground/60"><SmartphoneIcon className="size-3" />desde el móvil</span>}
            </Message>
          ),
        })
      } else if (ev.kind === 'assistant') {
        out.push({
          key: `m${ev.seq}`, node: (
            <Message from="assistant" className="max-w-full">
              <MessageContent className="text-[15px] leading-relaxed">
                <MessageResponse>{ev.text}</MessageResponse>
              </MessageContent>
            </Message>
          ),
        })
      } else {
        out.push({ key: `i${ev.seq}`, node: <p className="text-center text-[11.5px] text-muted-foreground/60">{ev.text}</p> })
      }
    }
    flush()
    flushAgents()
    return out
  }, [events, skew, agentByCall])

  // A message of yours that arrives after the conversation loaded rises in
  // from the composer (for a moment after it first shows, across re-renders).
  const born = useRef<Map<string, number> | null>(null)
  const newest = useRef(0)
  useEffect(() => {
    if (!blocks.length) return
    const first = !born.current
    const map = born.current ??= new Map()
    const top = newest.current
    for (const b of blocks) {
      const seq = Number(b.key.match(/\d+/)?.[0] ?? 0)
      // Older pages loaded on demand ("Cargar anteriores") stay put.
      if (!map.has(b.key)) map.set(b.key, first || seq <= top ? 0 : Date.now())
      if (seq > newest.current) newest.current = seq
    }
  }, [blocks])
  const rising = (key: string) => {
    if (!key.startsWith('u') || !born.current) return false
    const t = born.current.get(key)
    return t === undefined ? Number(key.slice(1)) > newest.current : Date.now() - t < 700
  }

  // Off-screen blocks skip layout and paint: long histories stay smooth on a phone.
  return <>{blocks.map(b => <div key={b.key} className={rising(b.key) ? 'msg-fly' : undefined} style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 96px' }}>{b.node}</div>)}</>
}

// What the engine hands the model between turns, a background task's end or
// a subagent's report, as one line instead of its raw envelope.
function NoticeChip({ text }: { text: string }) {
  const ctx = useSessionCtx()
  const agent = text.match(/<agent-message from="([^"]+)"/)?.[1]
  const tag = (name: string) => text.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1]?.trim()
  const status = tag('status')
  const label = agent ? 'Un subagente entregó su informe' : `Tarea en segundo plano${status ? ` · ${status}` : ''}`
  const detail = agent ? '' : (tag('summary') ?? '')
  const Icon = agent ? BotIcon : SquareTerminalIcon
  return (
    <motion.button type="button" initial={{ opacity: 0 }} animate={{ opacity: 1 }} disabled={!agent || !ctx}
      onClick={() => agent && ctx?.openAgent(agent)}
      className={cn('mx-auto flex max-w-[92%] items-center gap-2 rounded-full border px-3 py-1.5 text-[12px]',
        agent ? 'border-violet-400/25 bg-violet-500/10 text-violet-200' : 'border-white/8 bg-white/[0.03] text-muted-foreground')}>
      <Icon className="size-3.5 shrink-0" />
      <span className="shrink-0">{label}</span>
      {detail && <span className="truncate text-muted-foreground/70">{detail}</span>}
    </motion.button>
  )
}

// A slash command as it goes: queued until the session is free, running with
// its clock, a compaction's steps, then the output (or what it freed).
function CommandCard({ ev, skew }: { ev: PastorEvent; skew: number }) {
  const now = useNow(ev.end || !ev.phase ? 60_000 : 1000)
  const done = !!ev.end || ev.phase === 'done'
  const compact = ev.phase === 'compacting' || ev.before != null
  const elapsed = ev.end?.ms ?? (ev.started ? now - skew - ev.started : 0)
  const status = !ev.phase && !ev.end ? 'en cola…' : !done ? (ev.phase === 'compacting' ? 'compactando' : 'ejecutando') : ''
  const steps = compact ? [
    ['Iniciado', true],
    [ev.note ?? 'Resumiendo la conversación', ev.phase === 'done' || !!ev.end],
    [ev.before != null && ev.after != null ? `${tokens(ev.before)} → ${tokens(ev.after)} tokens · ${ev.kept ?? '?'} mensajes` : 'Contexto nuevo', ev.before != null],
  ] as const : null
  const saved = ev.before && ev.after != null ? Math.max(0, Math.round((1 - ev.after / ev.before) * 100)) : null
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="ml-auto w-full max-w-[92%] overflow-hidden rounded-2xl glass">
      <div className="flex items-center gap-2 px-3.5 py-2.5">
        <span className="grid size-6 place-items-center rounded-lg bg-coral/15 font-mono text-[13px] font-bold text-coral">/</span>
        <code className="min-w-0 flex-1 truncate font-mono text-[13px]">{ev.text.replace(/^\//, '')}</code>
        {ev.via === 'pc' && <LaptopIcon className="size-3.5 text-muted-foreground/60" />}
        {status && <span className="text-shine text-[11.5px]">{status}</span>}
        {(ev.phase || ev.end) && elapsed >= 1000 && <span className="font-mono text-[10.5px] tabular-nums text-muted-foreground/70">{dur(elapsed)}</span>}
        {ev.end && (ev.end.ok ? <CheckIcon className="size-4 text-emerald-400" /> : <XIcon className="size-4 text-red-400" />)}
      </div>
      {!done && ev.phase && (
        <div className="relative h-0.5 overflow-hidden bg-white/5">
          <motion.div className="absolute inset-y-0 w-1/3 rounded-full bg-gradient-to-r from-transparent via-coral to-transparent"
            animate={{ x: ['-100%', '300%'] }} transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }} />
        </div>
      )}
      {steps && (
        <ol className="flex flex-col gap-1.5 border-t border-white/6 px-3.5 py-2.5 text-[12.5px]">
          {steps.map(([label, ok], i) => {
            const active = !ok && (i === 0 || steps[i - 1][1])
            return (
              <li key={i} className="flex items-center gap-2">
                <span className={cn('grid size-4 place-items-center rounded-full border',
                  ok ? 'border-emerald-400/60 bg-emerald-400/15' : active ? 'border-coral' : 'border-white/15')}>
                  {ok ? <CheckIcon className="size-2.5 text-emerald-400" /> : active && <span className="size-1.5 animate-pulse rounded-full bg-coral" />}
                </span>
                <span className={cn('min-w-0 flex-1 truncate', ok ? 'text-foreground' : active ? 'text-shine' : 'text-muted-foreground/50')}>{label}</span>
              </li>
            )
          })}
          {saved != null && (
            <li className="mt-1 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/8">
                <motion.div className="h-full rounded-full bg-gradient-to-r from-coral to-emerald-400" initial={{ width: '100%' }}
                  animate={{ width: `${100 - saved}%` }} transition={{ duration: 1.1, ease: 'easeOut' }} />
              </div>
              <span className="font-mono text-[11px] text-emerald-400">−{saved}%</span>
            </li>
          )}
        </ol>
      )}
      {ev.end?.out && (!compact || !ev.end.ok) && (
        <div className="max-h-80 overflow-y-auto border-t border-white/6 px-3.5 py-2.5 text-[13px]">
          <MessageResponse>{ev.end.out}</MessageResponse>
        </div>
      )}
    </motion.div>
  )
}

export function orbStateOf(live: Live | null, waiting: boolean): OrbState {
  if (waiting) return 'waiting'
  if (!live) return 'idle'
  if (live.activity) return /Grep|Glob|Search|Read|Fetch/.test(live.activity.tool) ? 'searching' : 'tool'
  if (live.text) return 'writing'
  return 'thinking'
}

// Streamed words fade in one by one; only the new ones animate.
const WORDS_IN = { animation: 'fadeIn', sep: 'word', duration: 300 } as const

// The turn as it happens: the orb, what Claude is doing, its thinking and
// the text it is writing.
export function LiveTurn({ live, waiting, skew }: { live: Live | null; waiting: boolean; skew: number }) {
  const now = useNow(1000)
  const on = !!live || waiting
  const state = orbStateOf(live, waiting)
  const elapsed = live ? dur(now - skew - live.since) || '0s' : ''
  const ActIcon = live?.activity ? iconOf(live.activity.tool) : null
  return (
    <AnimatePresence>
      {on && (
        <motion.div key="live" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}
          className="flex items-start gap-3 pt-1">
          <div className="relative">
            <div className="absolute inset-0 -z-10 rounded-full bg-coral/25 blur-xl" />
            <Avatar state={state} size={46} />
          </div>
          <div className="min-w-0 flex-1 pt-1">
            <div className="flex items-center gap-2 text-[14px] font-medium">
              {waiting
                ? <span className="text-warn">Esperando tu respuesta</span>
                : live?.activity
                  ? <span className="flex min-w-0 items-center gap-1.5">
                      {ActIcon && <ActIcon className="size-3.5 shrink-0 text-coral" />}
                      <span className="text-shine shrink-0">{live.activity.tool}</span>
                      <span className="truncate font-mono text-[11.5px] font-normal text-muted-foreground">{live.activity.text}</span>
                    </span>
                  : <span className="text-shine">{live?.text ? 'Escribiendo…' : 'Pensando…'}</span>}
              <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/70">{elapsed}</span>
            </div>
            {live?.thought && !live.text && !waiting && (
              <Reasoning isStreaming className="mt-2" defaultOpen>
                <ReasoningTrigger className="text-[12.5px]" getThinkingMessage={() => <span>Razonamiento</span>} />
                <ReasoningContent className="mt-1.5 line-clamp-4 border-l border-coral/30 pl-3 text-[12.5px] italic text-muted-foreground/80">
                  {live.thought}
                </ReasoningContent>
              </Reasoning>
            )}
            {live?.text && (
              <div className="mt-1.5 text-[15px] leading-relaxed">
                <MessageResponse animated={WORDS_IN} isAnimating>{live.text}</MessageResponse>
                <span className="ml-0.5 inline-block h-4 w-[3px] translate-y-0.5 animate-pulse rounded-full bg-coral" />
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function PermissionBody({ p }: { p: Pending }) {
  const d = p.detail ?? {}
  if (p.tool === 'Edit' || p.tool === 'MultiEdit') {
    const edits: { old?: string; new?: string }[] = d.edits ?? [{ old: d.old, new: d.new }]
    return <CodeBlock code={edits.map(e => editDiff(e.old, e.new).text).join('\n⋯\n')} language="diff"
      className="max-h-64 overflow-auto rounded-xl border-white/8 bg-black/40 text-[12px]" />
  }
  if (p.tool === 'Write' && d.head) {
    return <CodeBlock code={d.head} language={langOf(d.file) as BundledLanguage}
      className="max-h-64 overflow-auto rounded-xl border-white/8 bg-black/40 text-[12px]" />
  }
  if (p.tool === 'Workflow' && d.name) {
    // The terminal's "Run a dynamic workflow?": what it is, its phases, what each agent is asked.
    return (
      <div className="flex flex-col gap-2.5 rounded-2xl border border-violet-400/20 bg-violet-500/[0.06] p-3">
        <div>
          <p className="text-[14.5px] font-semibold text-violet-100">{d.name}</p>
          {d.description && <p className="text-[12.5px] leading-snug text-muted-foreground">{d.description}</p>}
        </div>
        {d.phases?.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {(d.phases as string[]).map((ph, i) => (
              <span key={i} className="rounded-full bg-violet-400/12 px-2 py-0.5 text-[11px] text-violet-200">{i + 1}. {ph}</span>
            ))}
          </div>
        )}
        {d.agents?.length > 0 && (
          <ul className="flex flex-col gap-1">
            {(d.agents as string[]).map((a, i) => (
              <li key={i} className="flex gap-2 text-[12px] leading-snug text-muted-foreground">
                <BotIcon className="mt-0.5 size-3.5 shrink-0 text-violet-300" /><span className="line-clamp-2">{a}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-muted-foreground/70">Lanza varios subagentes en paralelo: puede gastar muchos tokens. {d.lines} líneas de script.</p>
        {d.script && (
          <details className="text-[11px]">
            <summary className="cursor-pointer text-muted-foreground">Ver script</summary>
            <CodeBlock code={d.script} language="javascript" className="mt-1.5 max-h-64 overflow-auto rounded-xl border-white/8 bg-black/40 text-[11px]" />
          </details>
        )}
      </div>
    )
  }
  const code = d.command ?? p.summary ?? ''
  return <CodeBlock code={code} language={(p.tool === 'Bash' ? 'bash' : p.tool === 'PowerShell' ? 'powershell' : 'text') as BundledLanguage}
    className="max-h-64 overflow-auto rounded-xl border-white/8 bg-black/40 text-[12px]" />
}

// Claude asks for a permission: a card that glows until it is answered.
export function PermissionCard({ p, onDecide }: { p: Pending; onDecide: (d: 'allow' | 'deny') => void }) {
  const Icon = iconOf(p.tool)
  const d = p.detail ?? {}
  return (
    <motion.div layout initial={{ opacity: 0, y: 16, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }} transition={{ type: 'spring', stiffness: 380, damping: 30 }}
      className="relative overflow-hidden rounded-3xl glass p-4 ring-1 ring-warn/35">
      <div className="pointer-events-none absolute -top-16 left-1/2 h-32 w-64 -translate-x-1/2 rounded-full bg-warn/20 blur-3xl" />
      <div className="relative mb-3 flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-2xl bg-warn/15 ring-1 ring-warn/30">
          <ShieldAlertIcon className="size-5 text-warn" />
        </span>
        <div className="min-w-0">
          <p className="text-[15px] font-semibold">Claude quiere usar {p.tool}</p>
          <p className="flex items-center gap-1 truncate text-[12px] text-muted-foreground">
            <Icon className="size-3" />{d.description || (d.file ? shortPath(d.file) : 'necesita tu permiso')}
          </p>
        </div>
      </div>
      <div className="relative"><PermissionBody p={p} /></div>
      {p.reason && <p className="relative mt-2 text-[12px] text-muted-foreground">{p.reason}</p>}
      <div className="relative mt-4 grid grid-cols-2 gap-2.5">
        <Button variant="outline" size="lg" className="h-12 rounded-2xl border-white/10 bg-white/[0.03] text-[15px]" onClick={() => onDecide('deny')}>
          <XIcon className="size-4" />Denegar
        </Button>
        <Button size="lg" className="h-12 rounded-2xl bg-gradient-to-br from-coral to-[oklch(0.62_0.15_35)] text-[15px] font-semibold shadow-lg shadow-coral/25"
          onClick={() => onDecide('allow')}>
          <CheckIcon className="size-4" />Permitir
        </Button>
      </div>
    </motion.div>
  )
}

export function QuestionCard({ p, onAnswer, onCancel }: {
  p: Pending; onAnswer: (answers: Record<string, string>) => void; onCancel: () => void
}) {
  const qs = p.questions ?? []
  const [picked, setPicked] = useState<Record<number, string[]>>({})
  const [other, setOther] = useState<Record<number, string>>({})
  const submit = (next = picked) => {
    const answers: Record<string, string> = {}
    qs.forEach((q, i) => {
      const list = [...(next[i] ?? []), ...(other[i]?.trim() ? [other[i]!.trim()] : [])]
      if (list.length) answers[q.question] = list.join(', ')
    })
    if (Object.keys(answers).length) onAnswer(answers)
  }
  const pick = (qi: number, label: string, multi: boolean) => {
    const cur = picked[qi] ?? []
    const list = multi ? (cur.includes(label) ? cur.filter(l => l !== label) : [...cur, label]) : [label]
    const next = { ...picked, [qi]: list }
    setPicked(next)
    if (!multi && qs.length === 1) submit(next)
  }
  return (
    <motion.div layout initial={{ opacity: 0, y: 16, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }} transition={{ type: 'spring', stiffness: 380, damping: 30 }}
      className="relative overflow-hidden rounded-3xl glass p-4 ring-1 ring-coral/35">
      <div className="pointer-events-none absolute -top-16 left-1/2 h-32 w-64 -translate-x-1/2 rounded-full bg-coral/20 blur-3xl" />
      {qs.map((q, qi) => (
        <div key={qi} className="relative mb-4">
          <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wider text-coral">{q.header}</p>
          <p className="mb-3 text-[15.5px] font-semibold leading-snug">{q.question}</p>
          <div className="flex flex-col gap-2">
            {q.options.map(o => {
              const on = (picked[qi] ?? []).includes(o.label)
              return (
                <motion.button key={o.label} type="button" whileTap={{ scale: 0.98 }} onClick={() => pick(qi, o.label, q.multiSelect)}
                  className={cn('flex items-start gap-3 rounded-2xl border px-3.5 py-3 text-left transition-colors',
                    on ? 'border-coral/60 bg-coral/12' : 'border-white/8 bg-white/[0.03]')}>
                  <span className={cn('mt-0.5 grid size-5 shrink-0 place-items-center border transition-colors',
                    q.multiSelect ? 'rounded-md' : 'rounded-full', on ? 'border-coral bg-coral' : 'border-white/25')}>
                    {on && <CheckIcon className="size-3 text-background" strokeWidth={3} />}
                  </span>
                  <span>
                    <span className="block text-[14.5px] font-medium">{o.label}</span>
                    {o.description && <span className="mt-0.5 block text-[12.5px] leading-snug text-muted-foreground">{o.description}</span>}
                  </span>
                </motion.button>
              )
            })}
            <input value={other[qi] ?? ''} onChange={e => setOther({ ...other, [qi]: e.target.value })} placeholder="Otra respuesta…"
              className="rounded-2xl border border-white/8 bg-white/[0.03] px-3.5 py-3 text-[15px] outline-none placeholder:text-muted-foreground/60 focus:border-coral/50" />
          </div>
        </div>
      ))}
      <div className="relative grid grid-cols-2 gap-2.5">
        <Button variant="outline" size="lg" className="h-12 rounded-2xl border-white/10 bg-white/[0.03]" onClick={onCancel}>Cancelar</Button>
        <Button size="lg" className="h-12 rounded-2xl bg-gradient-to-br from-coral to-[oklch(0.62_0.15_35)] font-semibold shadow-lg shadow-coral/25" onClick={() => submit()}>
          Responder
        </Button>
      </div>
    </motion.div>
  )
}

export function PendingStack({ pending, onDecide }: {
  pending: Pending[]
  onDecide: (p: Pending, body: { decision: 'allow' | 'deny'; answers?: Record<string, string> }) => void
}) {
  return (
    <AnimatePresence mode="popLayout">
      {pending.map(p => p.kind === 'question'
        ? <QuestionCard key={p.id} p={p} onAnswer={answers => onDecide(p, { decision: 'allow', answers })} onCancel={() => onDecide(p, { decision: 'deny' })} />
        : <PermissionCard key={p.id} p={p} onDecide={d => onDecide(p, { decision: d })} />)}
    </AnimatePresence>
  )
}

export { BrainIcon, ChevronDownIcon }
