import { RadioTowerIcon } from 'lucide-react'
import { createElement, useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { api, ApiError, sessionPath, store } from './api'
import type {
  AgentRow, BgTask, ContextPoint, Live, Machine, NetworkMessage, PastorEvent, Pending, PeerMessage, SessionPayload, SessionSummary, WorkflowRun,
} from './types'

// Re-run `tick` every `ms` while the page is visible; a tick returns the next
// interval, so a live turn can poll faster than an idle one.
function usePoll(tick: () => Promise<number | void>, ms: number, deps: unknown[], kick?: { current: () => void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    let alive = true
    const run = async () => {
      clearTimeout(timer.current)
      if (!alive) return
      let next = ms
      try { next = (await tick()) || ms } catch { /* keep polling */ }
      if (alive && !document.hidden) timer.current = setTimeout(run, next)
    }
    const onVisible = () => { if (!document.hidden) void run() }
    if (kick) kick.current = () => { if (alive) void run() }
    document.addEventListener('visibilitychange', onVisible)
    void run()
    return () => { alive = false; clearTimeout(timer.current); document.removeEventListener('visibilitychange', onVisible) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

export function useNow(ms = 1000): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t) }, [ms])
  return now
}

export function useSessions() {
  const [state, setState] = useState<{ sessions: SessionSummary[]; machines: Machine[]; error?: string; loaded: boolean }>(
    { sessions: [], machines: [], loaded: false })
  usePoll(async () => {
    try {
      const d = await api<{ sessions: SessionSummary[]; machines: Machine[] }>('/api/sessions')
      setState({ sessions: d.sessions, machines: d.machines, loaded: true })
      return d.sessions.some(s => s.online && s.status !== 'idle') ? 1200 : 2500
    } catch (e) {
      setState(s => ({ ...s, error: (e as Error).message, loaded: true }))
    }
  }, 2500, [])
  return state
}

export type SessionState = {
  session: SessionSummary | null
  events: PastorEvent[]
  pending: Pending[]
  live: Live | null
  skew: number
  tasks: BgTask[]
  agents: AgentRow[]
  // Context use over time (one point per usage report) and whether this is a
  // closed session read back from its transcript (read-only).
  contextHistory: ContextPoint[]
  fromTranscript: boolean
  workflows: WorkflowRun[]
  messages: PeerMessage[]
  error?: string
}

const sameHistory = (a: ContextPoint[], b?: ContextPoint[]) =>
  !!b && a.length === b.length && a[a.length - 1]?.t === b[b.length - 1]?.t
// Lists of rows with ids: keep the old array (and its renders) while nothing changed.
const sameIds = (a: { id: string }[], b: { id: string }[]) =>
  a.length === b.length && a[0]?.id === b[0]?.id && a[a.length - 1]?.id === b[b.length - 1]?.id
const sameRuns = (a: WorkflowRun[], b: WorkflowRun[]) =>
  a.length === b.length && a.every((r, i) => r.runId === b[i].runId && r.status === b[i].status && r.agents === b[i].agents && r.phases.length === b[i].phases.length)

// How many events a session's first load brings (tool calls included): the phone's setting.
export const HISTORY_LIMITS = [50, 100, 200, 500] as const
export const historyLimit = (): number => store.get('historyLimit', 100)

export function useSession(id: string) {
  const [state, setState] = useState<SessionState>({ session: null, events: [], pending: [], live: null, skew: 0, tasks: [], agents: [], contextHistory: [], fromTranscript: false, workflows: [], messages: [] })
  const since = useRef(0)
  const bySeq = useRef(new Map<number, number>())
  const events = useRef<PastorEvent[]>([])
  const kick = useRef<() => void>(() => {})
  // Until when a closed conversation is expected to come back live (resumed on the PC).
  const expectLiveUntil = useRef(0)

  // How many events precede the loaded ones; "Cargar anteriores" pages them in.
  const [olderCount, setOlderCount] = useState(0)
  const older = useRef(0)
  const setOlder = (n: number) => { older.current = n; setOlderCount(n) }
  const [loadingOlder, setLoadingOlder] = useState(false)

  useEffect(() => { since.current = 0; bySeq.current = new Map(); events.current = []; setOlder(0) }, [id])

  usePoll(async () => {
    const first = since.current === 0
    const d = await api<SessionPayload>(`${sessionPath(id)}?since=${since.current}${first ? `&limit=${historyLimit()}` : ''}`)
    if (first) setOlder(d.older ?? 0)
    let changed = false, unordered = false
    const oldest = events.current[0]
    for (const ev of d.events) {
      const i = bySeq.current.get(ev.seq)
      // A patched row from before what was loaded: it belongs to an unloaded page.
      if (i === undefined && !first && oldest && (ev.t ?? 0) < (oldest.t ?? 0) && older.current > 0) continue
      if (i === undefined) {
        const last = events.current[events.current.length - 1]
        if (last && (ev.t ?? 0) < (last.t ?? 0)) unordered = true
        bySeq.current.set(ev.seq, events.current.length); events.current.push(ev)
      }
      else events.current[i] = ev
      changed = true
    }
    // History seeded from a transcript arrives after the first live rows: keep time order.
    if (unordered) {
      events.current.sort((a, b) => (a.t ?? 0) - (b.t ?? 0))
      bySeq.current = new Map(events.current.map((e, i) => [e.seq, i]))
    }
    since.current = d.seq
    setState(s => ({
      session: d.session,
      events: changed ? [...events.current] : s.events,
      pending: JSON.stringify(s.pending.map(p => p.id)) === JSON.stringify(d.pending.map(p => p.id)) ? s.pending : d.pending,
      live: d.live,
      skew: d.now ? Date.now() - d.now : 0,
      tasks: d.tasks ?? [],
      agents: d.agents ?? [],
      contextHistory: sameHistory(s.contextHistory, d.contextHistory) ? s.contextHistory : (d.contextHistory ?? []),
      fromTranscript: !!d.fromTranscript,
      workflows: sameRuns(s.workflows, d.workflows ?? []) ? s.workflows : (d.workflows ?? []),
      messages: sameIds(s.messages, d.messages ?? []) ? s.messages : (d.messages ?? []),
    }))
    // A saved transcript does not change: no need to ask often.
    if (d.fromTranscript) return Date.now() < expectLiveUntil.current ? 1500 : 15000
    return d.live || (d.agents ?? []).some(a => a.status === 'running') ? 400 : (d.tasks ?? []).some(t => t.status === 'running') ? 900 : 1300
  }, 1300, [id], kick)

  const act = useCallback(async (action: string, body: unknown = {}) => {
    const r = await api(sessionPath(id, action), body)
    kick.current()
    return r
  }, [id])

  const dropPending = useCallback((pid: string) => {
    setState(s => ({ ...s, pending: s.pending.filter(p => p.id !== pid) }))
  }, [])

  // A resumed conversation registers under the same id: ask often for a while.
  const expectLive = useCallback(() => { expectLiveUntil.current = Date.now() + 90_000; kick.current() }, [])

  const loadOlder = useCallback(async () => {
    const oldest = events.current[0]
    if (!oldest || loadingOlder) return
    setLoadingOlder(true)
    try {
      const d = await api<{ events: PastorEvent[]; older: number }>(`${sessionPath(id)}?before=${oldest.seq}&limit=${historyLimit()}`)
      const fresh = d.events.filter(e => !bySeq.current.has(e.seq))
      events.current = [...fresh, ...events.current]
      bySeq.current = new Map(events.current.map((e, i) => [e.seq, i]))
      setOlder(d.older ?? 0)
      setState(s => ({ ...s, events: [...events.current] }))
    } finally { setLoadingOlder(false) }
  }, [id, loadingOlder])

  return { ...state, act, dropPending, expectLive, older: olderCount, loadOlder, loadingOlder }
}

// ---- messages between sessions and agents ----

// Toasts each NEW incoming message of a list it is fed (ids seen, the first
// list taken as already read). `key` makes an id unique across sessions.
export function useMessageNotices<M extends PeerMessage>(
  list: M[] | null, opts: { key?: (m: M) => string; onView?: (m: M) => void; enabled?: boolean; multi?: boolean } = {},
) {
  const seen = useRef<Set<string> | null>(null)
  const optsRef = useRef(opts)
  optsRef.current = opts
  useEffect(() => {
    if (!list) return
    const { key = (m: M) => m.id, onView, enabled = true, multi = false } = optsRef.current
    if (!seen.current) { seen.current = new Set(list.map(key)); return }
    const fresh = list.filter(m => !seen.current!.has(key(m)))
    for (const m of fresh) seen.current.add(key(m))
    if (!enabled) return
    const incoming = fresh.filter(m => m.dir === 'in').sort((a, b) => a.t - b.t).slice(-3)
    for (const m of incoming) {
      const text = m.text.replace(/\s+/g, ' ').trim()
      // A network notice names the session (and PC) that got it: 'to' is just 'Claude'.
      const net = 'sessionTitle' in m ? (m as unknown as NetworkMessage) : null
      const body = text.length > 80 ? `${text.slice(0, 79)}…` : text
      toast.info(`${m.from} → ${net?.sessionTitle || m.to}`, {
        description: net && multi ? `${net.machine} · ${body}` : body,
        icon: createElement(RadioTowerIcon, { className: 'size-4' }),
        action: onView ? { label: 'Ver', onClick: () => onView(m) } : undefined,
      })
    }
    if (incoming.length) navigator.vibrate?.(20)
  }, [list])
}

export const netKey = (m: NetworkMessage) => `${m.session}:${m.id}`

// Every session's messages across this bridge and its peers, newest first.
// Polled every 3 s; also raises a toast for each new incoming one.
export function useNetwork(opts: { onOpen?: (session: string) => void; notify?: boolean } = {}) {
  // ok: the last fetch succeeded (only then is the list fed to the notices,
  // so a failed first fetch is not taken as "nothing seen yet").
  const [state, setState] = useState<{ messages: NetworkMessage[]; loaded: boolean; ok: boolean; error?: string; unsupported?: boolean }>(
    { messages: [], loaded: false, ok: false })
  usePoll(async () => {
    try {
      const d = await api<{ messages: NetworkMessage[] }>('/api/network')
      const list = d.messages ?? []
      setState(s => ({
        messages: s.ok && s.messages.length === list.length && s.messages.every((m, i) => netKey(m) === netKey(list[i])) ? s.messages : list,
        loaded: true, ok: true,
      }))
    } catch (e) {
      // An old bridge without /api/network: ask rarely.
      if (e instanceof ApiError && e.status === 404) { setState(s => ({ ...s, loaded: true, ok: false, unsupported: true })); return 30_000 }
      setState(s => ({ ...s, loaded: true, ok: false, error: (e as Error).message }))
    }
  }, 3000, [])
  const onOpen = opts.onOpen
  useMessageNotices(state.ok ? state.messages : null, {
    key: netKey, enabled: opts.notify !== false, multi: new Set(state.messages.map(m => m.machine)).size > 1,
    onView: onOpen ? m => onOpen(m.session) : undefined,
  })
  return state
}
