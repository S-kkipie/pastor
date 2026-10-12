import type { EngineInterface, Register } from 'claude-code'

// pastor: control Claude Code from your phone, Collie-style but native.
// The mod starts (or joins) one shared loopback bridge (bridge/bridge.mjs),
// mirrors this session into it (the model's text and thinking as they stream,
// each tool call with its input and result), and polls it for what the phone
// sent: prompts, interrupts, and, in "away" mode, permission and question
// answers.

type Bridge = {
  port: number; secret: string; pairCode: string; devices: number
  publicUrl: string; machine: string; peers: string[]
}
type Decision = { decision: 'allow' | 'deny'; answers?: Record<string, string>; reason?: string }
type InboxItem =
  | { type: 'prompt'; text: string; mode?: 'queue' | 'now' | 'interrupt' }
  | { type: 'stopTask'; id: string }
  | { type: 'command'; id: string; command: string; args?: string }
  | { type: 'config'; key: string; value: unknown }
  | { type: 'meta' }
  | { type: 'close' }
  | { type: 'agentMsg'; id: string; text: string }
  | { type: 'agentStop'; id: string }
  | { type: 'peer'; from: string; fromTitle?: string; machine?: string; text: string }
  | { type: 'agentLog'; id: string }
  | { type: 'abort' }
  | ({ type: 'decide'; id: string } & Decision)
type Live = { text?: string; thinking?: boolean; thought?: string; activity?: { tool: string; text: string } | null }

const POLL_MS = 1000
const LIVE_MS = 250
const PHONE_WAIT_MS = 30 * 60_000
const NEVER_ASK = new Set(['AskUserQuestion', 'ExitPlanMode'])

let bridge: Bridge | undefined
let sessionId = ''
let away = false
let turnId: string | undefined
let polling = false
let lastStepText = ''
// The slash command running now, whoever started it: its row on the phone
// carries the progress (and a compaction's before/after) as it goes.
let runningCmd: { id: string; command: string; startedAt: number } | undefined
const phoneTexts: string[] = []
const midTurn: string[] = []
const waiters = new Map<string, { resolve: (d: Decision | undefined) => void; hybrid?: boolean }>()
// Where the person is, for routing asks without any setting: the session open
// on a phone right now, a phone used lately, the last thing typed at the terminal.
let watching = false
let phoneAgo: number | null = null
let typedAt = Date.now()
const AUTO_PHONE_WAIT_MS = 2 * 60_000
const IDLE_AT_PC_MS = 10 * 60_000

async function ensureBridge($: EngineInterface): Promise<Bridge | undefined> {
  const script = `${$.plugin.root}/bridge/bridge.mjs`
  try {
    const ran = await $.process.run(['node', script, 'ensure'], { timeoutMs: 20_000 })
    const out = JSON.parse(ran.stdout) as Bridge & { ok: boolean }
    if (!out.ok) throw new Error(ran.stderr || 'bridge did not start')
    return out
  } catch (err) {
    $.ui.log(`pastor: no pude arrancar el bridge: ${String(err)}`, { to: 'debug' })
    return undefined
  }
}

// A message from a session on another PC, as the model reads it: who sent it
// and how to answer, never mistaken for the person's own words.
function peerEnvelope(m: { from: string; fromTitle?: string; machine?: string; text: string }): string {
  // Neither the attributes nor the body can close the envelope early and forge what follows it.
  const q = (s: string) => String(s ?? '').replace(/[\r\n]+/g, ' ').replace(/["<>]/g, '').slice(0, 200)
  const body = String(m.text ?? '').replace(/<\/pastor-message/gi, '</pastor-message_')
  return `<pastor-message from="${q(m.from)}" pc="${q(m.machine ?? '')}" session="${q(m.fromTitle ?? '')}">
${body}
</pastor-message>
`
    + `Es un mensaje de otra sesión de Claude Code (otra PC), no de tu usuario. Si hace falta responder, usa SendMessage con to: "${q(m.from)}".`
}

async function call($: EngineInterface, path: string, body?: unknown): Promise<any> {
  if (!bridge) return undefined
  try {
    const res = await $.http.fetch(`http://127.0.0.1:${bridge.port}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'x-pastor-secret': bridge.secret, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (res.status === 404 && path.startsWith('/mod/poll')) await announce($)
    return JSON.parse(res.text)
  } catch {
    return undefined
  }
}

const event = ($: EngineInterface, body: Record<string, unknown>) =>
  void call($, '/mod/event', { session: sessionId, ...body })
const patch = ($: EngineInterface, id: string, fields: Record<string, unknown>) =>
  void call($, '/mod/patch', { session: sessionId, id, patch: fields })
const live = ($: EngineInterface, patch: Live) =>
  void call($, '/mod/live', { session: sessionId, live: patch })

async function announce($: EngineInterface) {
  // The project's root, not wherever a Bash `cd` left the working directory.
  const cwd = await $.session.root().catch(() => '') || await $.session.cwd()
  const title = cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd
  const r = await call($, '/mod/register', { id: sessionId, cwd, title, status: turnId ? 'busy' : 'idle', pid: await claudePid($) })
  if (r?.ok) {
    away = !!r.away
    if (bridge) bridge.pairCode = r.pairCode
    // A bridge that just restarted knows nothing else about us: usage and meta now, not at the next turn.
    void reportUsage($)
    void sendMeta($)
  }
}

// This Claude Code's own process id: a browser it started (Playwright MCP) is
// found on the PC by walking up from the browser to it. Asked once.
let pidOnce: Promise<number | undefined> | undefined
function claudePid($: EngineInterface): Promise<number | undefined> {
  pidOnce ??= $.process.run(['node', '-e', 'console.log(process.ppid)'])
    .then(r => Number(String(r.stdout).trim()) || undefined, () => undefined)
  return pidOnce
}

// A browser this session drives: an agent-browser session by name (its CLI
// through Bash), or the Playwright MCP's. The bridge finds it and streams it.
const browsersSeen = new Set<string>()
function noteBrowser($: EngineInterface, tool: string, input: Record<string, unknown>) {
  let key = ''
  if ((tool === 'Bash' || tool === 'PowerShell') && /\bagent-browser\b/.test(String(input.command ?? ''))) {
    const cmd = String(input.command)
    const name = cmd.match(/--session(?:=|\s+)["']?([\w.-]+)/)?.[1] ?? cmd.match(/AGENT_BROWSER_SESSION=["']?([\w.-]+)/)?.[1] ?? 'default'
    key = `agent-browser:${name}`
  } else if (/^mcp__.*playwright/i.test(tool)) key = 'playwright'
  if (!key) return
  const url = typeof input.url === 'string' ? input.url : undefined
  if (browsersSeen.has(key) && !url) return
  browsersSeen.add(key)
  void call($, '/mod/browser', { session: sessionId, key, url })
}

function showStatus($: EngineInterface) {
  $.ui.status(bridge ? (away ? 'pastor: 📱 fuera' : undefined) : 'pastor: bridge caído')
}

// Files the phone attached: uploaded to ~/.claude/pastor/uploads and named in
// the text as @path or @"path". A plugin's prompt gets no @-expansion, so say
// it outright and let the model open them.
const UPLOAD_MENTION = /@"([^"]*[\\/]pastor[\\/]uploads[\\/][^"]+)"|@(\S*[\\/]pastor[\\/]uploads[\\/]\S+)/g
function attachments(text: string): string[] {
  return [...text.matchAll(UPLOAD_MENTION)].map(m => m[1] ?? m[2]).filter((p): p is string => !!p)
}
function withAttachments(text: string): string {
  const files = attachments(text)
  if (!files.length) return text
  return `${text}\n\n${attachNote(files)}`
}
const attachNote = (files: string[]) =>
  `The user attached these files from their phone; open each one with the Read tool (images included): ${files.map(f => `"${f}"`).join(', ')}`

async function poll($: EngineInterface) {
  if (polling) return
  polling = true
  try {
    const r = await call($, `/mod/poll?session=${encodeURIComponent(sessionId)}`)
    if (!r?.inbox) return
    watching = !!r.watching
    phoneAgo = typeof r.phoneAgo === 'number' ? r.phoneAgo : null
    if (!!r.away !== away) {
      away = !!r.away
      showStatus($)
      // Back at the desk: anything still waiting on the phone falls back here.
      if (!away) for (const [id, w] of waiters) if (!w.hybrid) { waiters.delete(id); w.resolve(undefined) }
    }
    for (const item of r.inbox as InboxItem[]) {
      if (item.type === 'prompt') {
        $.ui.toast(`📱 ${item.text.slice(0, 80)}`)
        if (item.mode === 'now' && turnId) {
          // Into the running turn: read by the model right after the next
          // tool result, as a message typed mid-turn is.
          midTurn.push(item.text)
        } else {
          if (item.mode === 'interrupt' && turnId) void $.turn.abort({ turnId })
          const text = withAttachments(item.text)
          phoneTexts.push(text)
          void $.prompt.submit({ text, asUser: true })
        }
      } else if (item.type === 'peer') {
        $.ui.toast(`📨 ${item.machine ?? ''} · ${item.text.slice(0, 70)}`)
        recordMessage({ dir: 'in', from: `${item.fromTitle || item.from} (${item.machine ?? '?'})`, to: 'Claude', kind: 'pastor', text: item.text })
        void $.prompt.submit({ text: peerEnvelope(item) })
      } else if (item.type === 'command') {
        void runCommand($, item)
      } else if (item.type === 'config') {
        void setConfig($, item.key, item.value)
      } else if (item.type === 'meta') {
        void sendMeta($)
      } else if (item.type === 'agentMsg') {
        void messageAgent($, item.id, item.text)
      } else if (item.type === 'agentStop') {
        void $.tool.call({ tool: 'TaskStop', task_id: item.id } as never).then(
          () => endAgent(item.id, 'killed'),
          err => event($, { kind: 'info', text: `No se pudo detener el agente: ${String((err as Error)?.message ?? err)}` }))
      } else if (item.type === 'agentLog') {
        void sendAgentLog($, item.id)
      } else if (item.type === 'close') {
        event($, { kind: 'info', text: '📱 Cerrando la sesión desde el móvil' })
        void closeSession($)
      } else if (item.type === 'stopTask') {
        void $.tool.call({ tool: 'TaskStop', task_id: item.id } as never)
          .then(() => finishTask($, item.id, 'killed'), () => finishTask($, item.id, 'killed'))
      } else if (item.type === 'abort') {
        if (turnId) void $.turn.abort({ turnId })
      } else if (item.type === 'decide') {
        const w = waiters.get(item.id)
        if (w) { waiters.delete(item.id); w.resolve(item) }
      }
    }
  } finally {
    polling = false
  }
}

// Put a question to the phone and wait for its answer; undefined means
// "answer it at the terminal instead" (away turned off, or nobody answered).
function askPhone($: EngineInterface, item: Record<string, unknown> & { id: string },
  opts: { waitMs?: number; hybrid?: boolean; quiet?: boolean } = {}): Promise<Decision | undefined> {
  let settledHere = false
  return new Promise(resolve => {
    waiters.set(item.id, { resolve, hybrid: opts.hybrid })
    void call($, '/mod/pending', { session: sessionId, item })
    if (!opts.quiet) $.ui.toast('pastor: esperando respuesta en el móvil…')
    $.clock.after(opts.waitMs ?? PHONE_WAIT_MS, () => {
      if (waiters.delete(item.id)) resolve(undefined)
    })
  }).then(d => {
    const decided = d as Decision | undefined
    if (!settledHere) void call($, '/mod/resolved', {
      session: sessionId, id: item.id,
      note: decided || opts.hybrid ? undefined : 'Sin respuesta del móvil: se responde en el PC',
    })
    return decided
  })
}

// The terminal answered first: the phone's copy goes away.
function withdrawPhone($: EngineInterface, id: string, note?: string) {
  const w = waiters.get(id)
  if (!w) return
  waiters.delete(id)
  w.resolve(undefined)
  void call($, '/mod/resolved', { session: sessionId, id, note })
}

async function tailnet($: EngineInterface): Promise<{ dns: string; https: boolean }> {
  const st = await $.process.run(['tailscale', 'status', '--json']).catch(() => undefined)
  try {
    const j = JSON.parse(st?.stdout ?? '{}')
    const dns = String(j.Self?.DNSName ?? '').replace(/\.$/, '')
    return { dns, https: Array.isArray(j.CertDomains) && j.CertDomains.length > 0 }
  } catch {
    return { dns: '', https: false }
  }
}

const str = (v: unknown, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : '')

function summarize(tool: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>
  const text =
    tool === 'Bash' || tool === 'PowerShell' ? str(i.command)
    : tool === 'Skill' ? `${str(i.skill ?? i.command)}${i.args ? ` · ${str(i.args)}` : ''}`
    : 'file_path' in i ? str(i.file_path)
    : 'notebook_path' in i ? str(i.notebook_path)
    : 'pattern' in i ? `${str(i.pattern)}${i.path ? `  en ${str(i.path)}` : ''}`
    : 'url' in i ? str(i.url)
    : 'query' in i ? str(i.query)
    : 'description' in i ? str(i.description)
    : 'prompt' in i ? str(i.prompt)
    : tool === 'AskUserQuestion' ? ((i.questions as { question?: string }[] | undefined) ?? []).map(q => q.question ?? '').join(' · ')
    : tool === 'TodoWrite' ? `${(i.todos as unknown[] | undefined)?.length ?? 0} tareas`
    : JSON.stringify(i)
  return text.slice(0, 2000)
}

// What the phone draws for a call, per tool; kept small.
function detail(tool: string, input: unknown): Record<string, unknown> | undefined {
  const i = (input ?? {}) as Record<string, unknown>
  if (tool === 'Bash' || tool === 'PowerShell') return { command: str(i.command, 4000), description: str(i.description, 300) }
  if (tool === 'Edit') return { file: str(i.file_path), old: str(i.old_string, 3000), new: str(i.new_string, 3000), all: !!i.replace_all }
  if (tool === 'MultiEdit') {
    const edits = Array.isArray(i.edits) ? i.edits.slice(0, 8) : []
    return { file: str(i.file_path), edits: edits.map(x => ({ old: str((x as any)?.old_string, 1500), new: str((x as any)?.new_string, 1500) })) }
  }
  if (tool === 'Write') {
    const content = str(i.content, 200_000)
    return { file: str(i.file_path), lines: content.split('\n').length, head: content.split('\n').slice(0, 40).join('\n').slice(0, 3000) }
  }
  if (tool === 'Read') return { file: str(i.file_path), offset: i.offset, limit: i.limit }
  if (tool === 'Grep' || tool === 'Glob') return { pattern: str(i.pattern), path: str(i.path), glob: str(i.glob) }
  if (tool === 'WebFetch') return { url: str(i.url), prompt: str(i.prompt, 300) }
  if (tool === 'WebSearch') return { query: str(i.query) }
  if (tool === 'TodoWrite') {
    const todos = Array.isArray(i.todos) ? i.todos : []
    return { todos: todos.slice(0, 30).map(t => ({ content: str((t as any)?.content, 200), status: str((t as any)?.status, 20) })) }
  }
  if (tool === 'TaskCreate') return { subject: str(i.subject, 300), description: str(i.description, 600), activeForm: str(i.activeForm, 200) }
  if (tool === 'TaskUpdate') return { taskId: str(i.taskId, 40), status: str(i.status, 20), subject: str(i.subject, 300), activeForm: str(i.activeForm, 200) }
  if (tool === 'Skill') return { skill: str(i.skill ?? i.command, 200), args: str(i.args, 2000) }
  if (tool === 'Workflow') {
    // The phone's approval card: what the run is, its phases and what each agent() is asked.
    const meta = workflowMeta(i)
    const script = str(i.script, 200_000)
    const agents = [...script.matchAll(/\bagent\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g)].map(m => m[2]!.slice(0, 240)).slice(0, 12)
    return { name: meta.name, description: meta.description, phases: meta.phases, agents, lines: script.split('\n').length, script: script.slice(0, 6000) }
  }
  if (tool === 'Agent' || tool === 'Task') return { description: str(i.description, 300), type: str(i.subagent_type, 60), prompt: str(i.prompt, 1500) }
  if (tool.startsWith('mcp__')) {
    const [, server, name] = tool.split('__')
    return { server, name, args: JSON.stringify(i).slice(0, 1500) }
  }
  // Any other built-in tool: its input as given, trimmed, so the phone can draw it.
  if (!tool.startsWith('mcp__')) {
    // The call's own arguments, without the event's bookkeeping around them.
    const { tool: _t, tool_use_id: _id, agentId: _a, origin: _o, ...args } = i
    return trimmed(args) as Record<string, unknown>
  }
  return undefined
}

// A JSON-safe, bounded copy: strings cut, lists shortened, nesting capped.
function trimmed(v: unknown, depth = 0): unknown {
  if (typeof v === 'string') return v.length > 2000 ? `${v.slice(0, 2000)}…` : v
  if (typeof v !== 'object' || v === null) return v
  if (depth > 3) return '…'
  if (Array.isArray(v)) return v.slice(0, 30).map(x => trimmed(x, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(v).slice(0, 40)) out[k] = trimmed(x, depth + 1)
  return out
}

// What a built-in tool returned, small and structured, for its card on the
// phone (links a search found, files a glob matched, a cron's schedule…).
function resultOf(tool: string, ran: { deny?: string; result?: unknown }): unknown {
  if (ran.deny || tool.startsWith('mcp__')) return undefined
  const r = ran.result as any
  if (!r || typeof r !== 'object') return undefined
  if (tool === 'WebSearch') {
    const links: { title: string; url: string }[] = []
    for (const block of Array.isArray(r.results) ? r.results : []) {
      for (const c of Array.isArray(block?.content) ? block.content : []) if (c?.url) links.push({ title: String(c.title ?? c.url).slice(0, 200), url: String(c.url) })
    }
    return { links: links.slice(0, 12), seconds: r.durationSeconds, searches: r.searchCount }
  }
  if (tool === 'Read' || tool === 'Write' || tool === 'Edit' || tool === 'Bash' || tool === 'PowerShell') return undefined // drawn from their input and text
  const s = JSON.stringify(trimmed(r))
  return s.length > 12_000 ? undefined : JSON.parse(s)
}

// A short excerpt of what a call returned, for the phone.
function excerpt(ran: { deny?: string; result?: unknown }): string {
  if (ran.deny) return ran.deny
  const r = ran.result as any
  if (typeof r === 'string') return r.slice(0, 1500)
  if (r && typeof r === 'object') {
    if (typeof r.stdout === 'string' || typeof r.stderr === 'string') {
      return `${r.stdout ?? ''}${r.stderr ? `\n${r.stderr}` : ''}`.trim().slice(-1500)
    }
    for (const k of ['content', 'output', 'text', 'result', 'message']) {
      if (typeof r[k] === 'string') return r[k].slice(0, 1500)
    }
    if (typeof r.file?.content === 'string') return `${r.file.numLines ?? ''} líneas`
    if (Array.isArray(r.filenames)) return `${r.filenames.length} archivos\n${r.filenames.slice(0, 15).join('\n')}`
  }
  return JSON.stringify(r ?? '').slice(0, 600)
}

// Context, cost and model for the phone's usage meter, with what fills the
// window (the cheap, locally estimated /context summary), where auto-compact
// runs and how much the context grows per main turn.
const turnTokens: number[] = []
async function reportUsage($: EngineInterface, turn?: Record<string, unknown>, turnEnd = false) {
  try {
    const model = $.session.model()
    model.catch(() => {})
    let u: Awaited<ReturnType<EngineInterface['session']['usage']>>
    let rich = true
    try { u = await $.session.usage({ breakdown: 'summary' }) } catch { u = await $.session.usage(); rich = false }
    const tokens = u.context.tokens ?? 0
    if (turnEnd && u.context.tokens !== undefined) {
      // A compaction (or /clear) shrinks the window: growth counts from there.
      if (tokens < (turnTokens[turnTokens.length - 1] ?? 0)) turnTokens.length = 0
      turnTokens.push(tokens)
      if (turnTokens.length > 6) turnTokens.shift()
    }
    const perTurn = turnTokens.length >= 2
      ? Math.round(((turnTokens[turnTokens.length - 1] ?? 0) - (turnTokens[0] ?? 0)) / (turnTokens.length - 1))
      : null
    const b = rich ? u.context.breakdown : undefined
    const extra = b ? {
      breakdown: b.categories
        .filter(c => c.tokens > 0 && c.kind !== 'deferred')
        .map(c => ({ name: c.name, tokens: c.tokens, ...(c.color ? { color: c.color } : {}) })),
      autoCompactAt: b.isAutoCompactEnabled && typeof b.autoCompactThreshold === 'number' ? b.autoCompactThreshold : null,
    } : {}
    void call($, '/mod/usage', {
      session: sessionId,
      usage: {
        model: await model, tokens, window: u.context.window, percent: u.context.percent ?? null,
        cost: u.cost?.usd ?? null, rateLimits: u.rateLimits, turn: turn ?? null,
        ...extra, perTurn,
      },
    })
  } catch {}
}

// The receipt of the main turn running now: what it did, what it cost.
type TurnTally = {
  startedAt: number; tools: number; edits: number; errors: number; agents: number
  outputTokens: number; costAtStart: Promise<number | null>
}
const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])
let tally: TurnTally | undefined
const costNow = ($: EngineInterface): Promise<number | null> =>
  $.session.usage().then(u => u.cost?.usd ?? null, () => null)

async function sendReceipt($: EngineInterface, t: TurnTally, e: { durationMs?: number; isAborted: boolean; usage?: { output_tokens?: number } }) {
  const durationMs = typeof e.durationMs === 'number' && e.durationMs > 0 ? e.durationMs : Date.now() - t.startedAt
  if (t.tools === 0 && durationMs < 2000) return
  const [before, after] = await Promise.all([t.costAtStart, costNow($)])
  const receipt = {
    durationMs, tools: t.tools, edits: t.edits, errors: t.errors, agents: t.agents,
    outputTokens: e.usage?.output_tokens ?? t.outputTokens,
    costUsd: before !== null && after !== null ? Math.max(0, after - before) : null,
    aborted: e.isAborted,
  }
  event($, { kind: 'receipt', receipt })
}

const newId = () => (typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`)

// Background shells and monitors: found in a call's result, their output
// file followed while they run, closed by their task notification.
type BgTask = {
  id: string; kind: 'shell' | 'monitor'; label: string; command: string; path: string
  status: 'running' | 'completed' | 'failed' | 'killed'; startedAt: number; endedAt?: number
  tail: string; size: number
}
const tasks = new Map<string, BgTask>()
let tasksDirty = false
let tasksDir = ''

// Claude Code writes a task's output to <temp>/claude/<project>/<session>/tasks/<id>.output,
// <project> being the start directory with every non-alphanumeric as '-'.
async function findTasksDir($: EngineInterface): Promise<string> {
  if (tasksDir) return tasksDir
  const project = (await $.session.root().catch(() => $.session.cwd())).replace(/[^a-zA-Z0-9]/g, '-')
  const bases = new Set<string>()
  const temps = [await $.env.get('TEMP'), await $.env.get('TMP'), await $.env.get('TMPDIR')]
  for (const b of temps) if (b) bases.add(`${b.replace(/[\\/]+$/, '')}/claude`)
  bases.add('/tmp/claude')
  const uid = await $.process.run(['id', '-u']).then(r => r.stdout.trim(), () => '')
  if (uid) bases.add(`/tmp/claude-${uid}`)
  for (const base of bases) {
    const dir = `${base}/${project}/${sessionId}/tasks`
    if (await $.fs.exists(dir).catch(() => false)) return (tasksDir = dir)
  }
  return ''
}

async function outputPathFor($: EngineInterface, text: string, id: string): Promise<string> {
  const m = text.match(/(\S+[\\/]tasks[\\/][^\s"']+\.output)/)
  if (m?.[1]) return m[1]
  const dir = await findTasksDir($)
  return dir ? `${dir}/${id}.output` : ''
}

function trackTask($: EngineInterface, t: Omit<BgTask, 'status' | 'startedAt' | 'tail' | 'size' | 'path'>, text: string) {
  const task: BgTask = { ...t, path: '', status: 'running', startedAt: Date.now(), tail: '', size: -1 }
  tasks.set(t.id, task)
  tasksDirty = true
  void outputPathFor($, text, t.id).then(p => { task.path = p; return refreshTask($, task) }).then(() => pushTasks($))
}

// /exit with background work still running stops at a terminal dialog ("Background
// work is running") nobody at the phone can answer: stop that work first.
async function closeSession($: EngineInterface) {
  const live = [
    ...[...tasks.values()].filter(t => t.status === 'running').map(t => t.id),
    ...[...agents.values()].filter(a => a.status === 'running' || a.status === 'pending').map(a => a.id),
  ]
  if (live.length) event($, { kind: 'info', text: `Deteniendo ${live.length} ${live.length === 1 ? 'tarea' : 'tareas'} en segundo plano…` })
  await Promise.all(live.map(id => $.tool.call({ tool: 'TaskStop', task_id: id } as never).catch(() => undefined)))
  if (live.length) await new Promise(r => $.clock.after(1500, () => r(undefined)))
  if (turnId) await $.turn.abort({ turnId }).catch(() => undefined)
  await $.command.run({ command: 'exit', args: '' } as never)
    .catch(err => event($, { kind: 'info', text: `No se pudo cerrar: ${String((err as Error)?.message ?? err)}` }))
}

function finishTask($: EngineInterface, id: string, status: BgTask['status']) {
  const t = tasks.get(id)
  if (!t || t.status !== 'running') return
  t.status = status; t.endedAt = Date.now(); tasksDirty = true
  void refreshTask($, t).then(() => pushTasks($))
}

async function refreshTask($: EngineInterface, t: BgTask) {
  if (!t.path) t.path = await outputPathFor($, "", t.id)
  if (!t.path) return
  try {
    const st = await $.fs.stat(t.path)
    if (st.size === t.size) return
    t.size = st.size
    const text = await $.fs.read(t.path)
    t.tail = (typeof text === 'string' ? text : '').slice(-6000)
    tasksDirty = true
  } catch { /* not written yet */ }
}

async function pushTasks($: EngineInterface) {
  if (!tasksDirty) return
  tasksDirty = false
  const list = [...tasks.values()].slice(-20).map(({ size, ...t }) => t)
  await call($, '/mod/tasks', { session: sessionId, tasks: list })
}

async function pollTasks($: EngineInterface) {
  for (const t of tasks.values()) if (t.status === 'running') await refreshTask($, t)
  await pushTasks($)
  await syncAgents($)
  await pushRuns($)
  await pushMessages($)
}

// Subagents: what each was asked, what it is doing (its tool, the text it is
// writing), its tokens and clock; the phone reads one's transcript, writes
// to it (SendMessage's own delivery) and stops it.
type AgentRow = {
  id: string; toolUseId?: string; description: string; type: string; model?: string; prompt: string
  status: 'pending' | 'running' | 'waiting' | 'idle' | 'completed' | 'failed' | 'killed'
  startedAt: number; endedAt?: number; steps: number; tools: number; tokens: number; outTokens: number
  activity: { tool: string; text: string } | null; text: string; answer?: string; parentId?: string
  workflowRunId?: string; workflowIndex?: number
  teammate?: boolean; name?: string; teammateId?: string
}
const agents = new Map<string, AgentRow>()
let agentsDirty = false
let agentsSyncedAt = 0

function agentRow(id: string): AgentRow {
  let a = agents.get(id)
  if (!a) {
    a = { id, description: 'Subagente', type: 'agent', prompt: '', status: 'running', startedAt: Date.now(), steps: 0, tools: 0, tokens: 0, outTokens: 0, activity: null, text: '' }
    agents.set(id, a)
  }
  agentsDirty = true
  return a
}
function endAgent(id: string, status: AgentRow['status'], answer?: string) {
  const a = agents.get(id)
  if (!a) return
  a.status = status
  a.endedAt ??= Date.now()
  a.activity = null
  if (answer !== undefined) a.answer = answer.slice(0, 20_000)
  agentsDirty = true
}
// What /mod/agents gets: every live row and teammate, the last 40 other
// subagents, and the last 60 rows of each of the last 20 runs (a run can
// spawn dozens; it must not evict everything else).
function agentsToPush(): AgentRow[] {
  const all = [...agents.values()]
  const keep = new Set<AgentRow>()
  const live = (a: AgentRow) => a.status === 'running' || a.status === 'pending' || a.status === 'idle'
  for (const a of all) if (live(a) || a.teammate) keep.add(a)
  for (const a of all.filter(a => !a.workflowRunId && !a.teammate).slice(-40)) keep.add(a)
  const recentRuns = new Set([...runs.keys()].slice(-20))
  const byRun = new Map<string, AgentRow[]>()
  for (const a of all) if (a.workflowRunId && recentRuns.has(a.workflowRunId)) byRun.set(a.workflowRunId, [...(byRun.get(a.workflowRunId) ?? []), a])
  for (const rows of byRun.values()) for (const a of rows.slice(-60)) keep.add(a)
  return all.filter(a => keep.has(a))
}
async function syncAgents($: EngineInterface) {
  // The engine's own list: statuses it knows better (idle, waiting, failed), and agents no spawn announced.
  const anyRunning = [...agents.values()].some(a => a.status === 'running' || a.status === 'pending')
  if (anyRunning || Date.now() - agentsSyncedAt > 10_000) {
    agentsSyncedAt = Date.now()
    try {
      for (const info of await $.agent.list()) {
        const a = agents.get(info.id) ?? agentRow(info.id)
        if (a.description === 'Subagente' && info.description) a.description = info.description
        if (a.type === 'agent' && info.type) a.type = info.type
        if (info.parentId) a.parentId = info.parentId
        if (info.teammateId && a.teammateId !== info.teammateId) { a.teammateId = info.teammateId; a.teammate = true; agentsDirty = true }
        if (info.name && a.name !== info.name) { a.name = info.name; agentsDirty = true }
        // A finished subagent may report 'idle'; a teammate waiting for mail is idle, not done.
        if (info.status !== a.status && (a.teammate || !(a.status === 'completed' && info.status === 'idle'))) {
          if (['completed', 'failed', 'killed'].includes(info.status)) endAgent(info.id, info.status)
          else {
            a.status = info.status
            if (info.status === 'running' || info.status === 'pending') { a.endedAt = undefined; a.answer = undefined }
            agentsDirty = true
          }
        }
      }
    } catch {}
  }
  if (!agentsDirty) return
  agentsDirty = false
  await call($, '/mod/agents', { session: sessionId, agents: agentsToPush() })
}
async function messageAgent($: EngineInterface, id: string, text: string) {
  try {
    // Recorded here (from the phone, 'tú'); the session.send hook skips it if it sees it.
    phoneSends.add(text)
    recordMessage({ dir: 'out', from: 'tú', to: agentName(id), toAgentId: id, kind: 'phone', text })
    event($, { kind: 'user', text, agent: id, via: 'phone' })
    try { await $.session.send({ to: { agentId: id }, text } as never) } finally { phoneSends.delete(text) }
    const a = agents.get(id)
    if (a && ['completed', 'idle', 'failed', 'killed'].includes(a.status)) { a.status = 'running'; a.endedAt = undefined; a.answer = undefined; agentsDirty = true }
    event($, { kind: 'info', text: `📱 → ${a?.description ?? 'agente'}: ${text.slice(0, 200)}` })
  } catch (err) {
    event($, { kind: 'info', text: `No se pudo escribir al agente: ${String((err as Error)?.message ?? err)}` })
  }
}
async function sendAgentLog($: EngineInterface, id: string) {
  try {
    const msgs = await $.session.messages({ agentId: id })
    if (!Array.isArray(msgs)) throw new Error(msgs.deny)
    await call($, '/mod/agentLog', {
      session: sessionId, id,
      messages: msgs.slice(-80).map(m => ({
        role: m.role, text: m.text.slice(0, 6000),
        tools: m.toolUses.map(t => ({ tool: t.tool, text: summarize(t.tool, t.input as never).slice(0, 200) })),
      })),
    })
  } catch (err) {
    await call($, '/mod/agentLog', { session: sessionId, id, error: String((err as Error)?.message ?? err) })
  }
}

// `<task-notification>` text: which task, and how it ended. A workflow's
// names its run by task id (the Workflow call's taskId) or tool-use id.
function onTaskNotice($: EngineInterface, text: string) {
  const tag = (block: string, name: string) => block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1]?.trim()
  for (const block of text.split('<task-notification>').slice(1)) {
    const id = tag(block, 'task-id')
    const raw = tag(block, 'status')
    if (!raw) continue
    const status = raw === 'completed' ? 'completed' : raw === 'killed' || raw === 'stopped' ? 'killed' : 'failed'
    if (id) finishTask($, id, status)
    // By task id or tool-use id; the run id quoted in the text only when the
    // notice names no task (any task's output may mention a run id).
    const toolUse = tag(block, 'tool-use-id')
    const list = [...runs.values()]
    const run = list.find(r => (id && r.taskId === id) || (toolUse && r.toolUseId === toolUse))
      ?? (!id && !toolUse ? list.find(r => block.includes(r.runId)) : undefined)
    if (run) {
      // <result> may be cut off (no closing tag) in a long notification.
      const result = tag(block, 'result') ?? block.match(/<result>([\s\S]*)/)?.[1] ?? tag(block, 'summary')
      finishRun(run, status, result)
    }
  }
}

// Dynamic workflows (the Workflow tool): one run per call, its agents filed
// under it by agent.spawn's e.workflow, closed by its task notification (a
// background run) or when its call returned and its agents all ended.
type Run = {
  runId: string; toolUseId?: string; name: string; description?: string; phases: string[]
  status: 'running' | 'completed' | 'failed' | 'killed'; startedAt: number; endedAt?: number
  agents: number; result?: string
  taskId?: string; background?: boolean; returned?: boolean
}
type WfMeta = { name: string; description?: string; phases: string[] }
const runs = new Map<string, Run>()
const wfCalls = new Map<string, WfMeta>() // Workflow tool_use_id -> meta, until its run id is known
let runsDirty = false

const quoted = (src: string, key: string) =>
  src.match(new RegExp(`\\b${key}\\s*:\\s*(['"\`])((?:\\\\.|(?!\\1)[\\s\\S])*?)\\1`))?.[2]?.replace(/\\(.)/g, '$1')

function workflowMeta(input: Record<string, unknown>): WfMeta {
  const script = str(input.script, 200_000)
  const block = script.match(/export\s+const\s+meta\s*=\s*\{[\s\S]*?\n\}/)?.[0] ?? script.slice(0, 4000)
  const phasesSrc = block.match(/\bphases\s*:\s*\[([\s\S]*?)\]/)?.[1] ?? ''
  const phases = [...phasesSrc.matchAll(/\btitle\s*:\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g)].map(m => m[2]!.slice(0, 120)).slice(0, 20)
  const path = str(input.scriptPath, 1000)
  const name = (script ? quoted(block, 'name') : undefined) || str(input.name, 200)
    || path.split(/[\\/]/).pop()?.replace(/(-wf_[\w-]+)?\.[jt]s$/, '') || 'Workflow'
  const description = script ? quoted(block, 'description') : undefined
  return { name: name.slice(0, 200), description: description?.slice(0, 1000), phases }
}

function runFor(runId: string, toolUseId?: string): Run {
  let run = runs.get(runId)
  if (!run) {
    const meta = (toolUseId && wfCalls.get(toolUseId)) || { name: 'Workflow', phases: [] }
    run = { runId, toolUseId: toolUseId || undefined, ...meta, status: 'running', startedAt: Date.now(), agents: 0 }
    runs.set(runId, run)
    while (runs.size > 40) runs.delete(runs.keys().next().value!)
  }
  runsDirty = true
  return run
}

function finishRun(run: Run, status: Run['status'], result?: string) {
  if (run.status !== 'running') return
  run.status = status
  run.endedAt = Date.now()
  if (result) run.result = result.slice(0, 2000)
  // Its agents have no $.agent.list() row to close them: close the stragglers.
  for (const a of agents.values()) {
    if (a.workflowRunId === run.runId && (a.status === 'running' || a.status === 'pending')) endAgent(a.id, status)
  }
  runsDirty = true
}

// The Workflow call returned: a background launch answers
// { status: 'async_launched', taskId, runId, workflowName, summary } at once;
// a foreground one returns when the run is over.
function onWorkflowReturn(toolUseId: string, ran: { deny?: string; isError?: boolean; result?: unknown }) {
  const meta = wfCalls.get(toolUseId)
  const r = (ran.result && typeof ran.result === 'object' ? ran.result : {}) as Record<string, unknown>
  const text = typeof ran.result === 'string' ? ran.result : excerpt(ran)
  const runId = str(r.runId, 200) || text.match(/\bRun ID:\s*(wf_[\w-]+)/)?.[1] || text.match(/\b(wf_[\w-]+)/)?.[1]
  // No run id in the result (its shape is not typed): the run agent.spawn
  // filed under this call's tool_use_id, if any.
  const known = runId ? undefined : [...runs.values()].find(x => x.toolUseId === toolUseId)
  if (!runId && !known) { wfCalls.delete(toolUseId); return }
  const run = known ?? runFor(runId!, toolUseId) // takes the call's meta when the run is new
  wfCalls.delete(toolUseId)
  if (meta && run.name === 'Workflow') Object.assign(run, meta)
  run.toolUseId ||= toolUseId
  if (typeof r.workflowName === 'string' && (run.name === 'Workflow' || !run.name)) run.name = r.workflowName.slice(0, 200)
  if (!run.description && typeof r.summary === 'string') run.description = r.summary.slice(0, 1000)
  run.taskId = str(r.taskId, 100) || text.match(/\bTask ID:\s*(\S+)/)?.[1] || run.taskId
  run.background = r.status === 'async_launched' || /launched in background/i.test(text)
  run.returned = true
  if (!run.background) {
    const failed = ran.deny !== undefined || ran.isError === true
    if (failed || r.status === 'failed' || r.status === 'killed') finishRun(run, r.status === 'killed' ? 'killed' : 'failed', text)
    else run.result = text.slice(0, 2000)
  }
  runsDirty = true
}

// A foreground run whose call returned closes once its last agent ends.
function settleRuns() {
  for (const run of runs.values()) {
    if (run.status !== 'running' || !run.returned || run.background) continue
    const live = [...agents.values()].some(a => a.workflowRunId === run.runId && !a.endedAt)
    if (!live) finishRun(run, 'completed')
  }
}

async function pushRuns($: EngineInterface) {
  settleRuns()
  if (!runsDirty) return
  runsDirty = false
  const list = [...runs.values()].slice(-20).map(({ taskId, background, returned, ...r }) => r)
  await call($, '/mod/workflows', { session: sessionId, runs: list })
}

// Messages between this session's loops and other sessions or team members.
type PeerMessage = {
  id: string; t: number; dir: 'in' | 'out'; from: string; to: string
  fromAgentId?: string; toAgentId?: string; kind: string; text: string
}
const messages: PeerMessage[] = []
const phoneSends = new Set<string>()
let messagesDirty = false

const agentOf = (id: string) => agents.get(id) ?? [...agents.values()].find(x => x.teammateId === id || x.name === id)
function agentName(id: string | undefined): string {
  if (id === undefined) return 'Claude'
  const a = agentOf(id)
  return a ? (a.name || a.description) : id
}

function recordMessage(m: Omit<PeerMessage, 'id' | 't'>) {
  messages.push({ id: newId(), t: Date.now(), ...m, text: m.text.slice(0, 4000) })
  if (messages.length > 200) messages.splice(0, messages.length - 200)
  messagesDirty = true
}

// The sender a cross-session or teammate envelope names, and its body.
function unwrap(text: string): { from?: string; text: string } {
  const m = text.match(/^\s*<([\w-]*(?:message|msg)[\w-]*)\b([^>]*)>([\s\S]*?)<\/\1>\s*$/)
  if (!m) return { text }
  const from = m[2]!.match(/\b(?:from|teammate_id|sender|name)="([^"]+)"/)?.[1]
  return { from, text: m[3]!.trim() }
}

async function pushMessages($: EngineInterface) {
  if (!messagesDirty) return
  messagesDirty = false
  await call($, '/mod/messages', { session: sessionId, messages: messages.slice(-200) })
}

// What the phone's command palette and settings show: this session's own
// commands (built-in, the person's commands and skills, plugins, MCP), the
// /config rows, the connected MCP servers and the model.
async function sendMeta($: EngineInterface) {
  try {
    const [commands, config, tools, model] = await Promise.all([
      $.command.list(), $.config.list().catch(() => []), $.tool.list().catch(() => []), $.session.model().catch(() => ''),
    ])
    const servers = new Map<string, number>()
    for (const t of tools) {
      if (!t.name.startsWith('mcp__')) continue
      const server = t.name.split('__')[1] ?? '?'
      if (server.startsWith('claude_ai')) continue // claude.ai connectors: not shown (the person only wants local MCP servers)
      servers.set(server, (servers.get(server) ?? 0) + 1)
    }
    await call($, '/mod/meta', {
      session: sessionId,
      meta: {
        model,
        commands: commands.map(c => ({ name: c.name, description: c.description.slice(0, 300), source: c.source, plugin: c.plugin })),
        config: config.map(r => ({
          key: r.key, label: r.label, description: r.description?.slice(0, 300), kind: r.kind,
          value: r.value, options: r.options, isLocked: r.isLocked,
        })),
        mcp: [...servers].map(([name, count]) => ({ name, tools: count })).sort((a, b) => a.name.localeCompare(b.name)),
        tools: tools.filter(t => !t.name.startsWith('mcp__')).map(t => t.name),
      },
    })
  } catch (err) {
    $.ui.log(`pastor: meta failed: ${String(err)}`, { to: 'debug' })
  }
}

// A slash command from the phone, run as if typed: queued until the session
// is idle; its output goes back to the command's row.
async function runCommand($: EngineInterface, item: { id: string; command: string; args?: string }) {
  const startedAt = Date.now()
  // The engine skips this plugin's own hooks for its $.command.run, so the
  // phone's row is driven from here.
  runningCmd = { id: item.id, command: item.command, startedAt }
  patch($, item.id, { phase: 'running', started: startedAt })
  live($, { activity: { tool: `/${item.command}`, text: 'ejecutando…' } })
  try {
    const r = await $.command.run({ command: item.command, args: item.args ?? '' } as never)
    const out = r.text?.trim() || (r.context?.length ? '(el comando dejó instrucciones al modelo)' : item.command === 'compact' ? '' : '(sin salida de texto: en la terminal abre un panel)')
    void call($, '/mod/toolEnd', { session: sessionId, id: item.id, ok: true, ms: Date.now() - startedAt, out })
  } catch (err) {
    void call($, '/mod/toolEnd', { session: sessionId, id: item.id, ok: false, ms: Date.now() - startedAt, out: String((err as Error)?.message ?? err) })
  } finally {
    runningCmd = undefined
    if (turnId) live($, { activity: null })
    else event($, { status: 'idle' })
  }
  void sendMeta($)
  void reportUsage($)
}

async function setConfig($: EngineInterface, key: string, value: unknown) {
  try {
    const r = await $.config.set({ key, value } as never) as { deny?: string }
    event($, { kind: 'info', text: r.deny ? `No se pudo cambiar ${key}: ${r.deny}` : `Ajuste ${key} → ${JSON.stringify(value)}` })
  } catch (err) {
    event($, { kind: 'info', text: `No se pudo cambiar ${key}: ${String((err as Error)?.message ?? err)}` })
  }
  void sendMeta($)
  void reportUsage($)
}

// The session id the engine now runs under; when it changed (a /clear or a
// /resume), the phone follows: the old row closes, the new one registers
// and the bridge reads the new conversation's history.
async function adoptSessionId($: EngineInterface) {
  const now = await $.session.id().catch(() => '')
  if (!now || now === sessionId) return
  const old = sessionId
  sessionId = now
  turnId = undefined
  if (old) await call($, '/mod/unregister', { session: old })
  await announce($)
  $.ui.log(`pastor: sesión ${old.slice(0, 8)} → ${now.slice(0, 8)}`, { to: 'debug' })
}

const HELP = '/pastor · away · here · serve · stop · link <url> <código> · unlink <pc> · peers'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'pastor',
      description: 'Control remoto desde el móvil: emparejar, away/here, serve, enlazar otras PCs',
      argumentHint: '[away|here|serve|stop|link <url> <código>|unlink <pc>|peers]',
    })
    sessionId = await $.session.id()
    bridge = await ensureBridge($)
    if (bridge) {
      await announce($)
      $.clock.every(POLL_MS, () => void poll($))
      $.clock.every(2000, () => { void adoptSessionId($); void pollTasks($) })
      void reportUsage($)
      void sendMeta($)
    }
    showStatus($)
    return started
  })

  // Every slash command, typed at the PC or sent from the phone: a row that
  // goes queued → running → done, and the orb lit while it runs.
  on('command.run', async ($, e, next) => {
    if (e.command === 'pastor' || e.command === 'exit' || runningCmd) return next(e)
    const id = `cmd-${newId()}`
    const startedAt = Date.now()
    runningCmd = { id, command: e.command, startedAt }
    event($, { kind: 'command', id, tool: e.command, text: `/${e.command}${e.args.trim() ? ` ${e.args.trim()}` : ''}`, via: 'pc' })
    patch($, id, { phase: 'running', started: startedAt })
    live($, { activity: { tool: `/${e.command}`, text: 'ejecutando…' } })
    try {
      const r = await next(e)
      const out = r.text?.trim() || (r.context?.length ? '(el comando dejó instrucciones al modelo)' : '')
      void call($, '/mod/toolEnd', { session: sessionId, id, ok: true, ms: Date.now() - startedAt, out })
      return r
    } catch (err) {
      void call($, '/mod/toolEnd', { session: sessionId, id, ok: false, ms: Date.now() - startedAt, out: String((err as Error)?.message ?? err) })
      throw err
    } finally {
      runningCmd = undefined
      if (turnId) live($, { activity: null })
      else event($, { status: 'idle' })
    }
  })

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (r.deny !== undefined) return r
    const run = e.workflow?.runId ? runFor(e.workflow.runId, e.tool_use_id) : undefined
    if (run) run.agents++
    const id = r.agentId ?? r.teammateId
    if (id) {
      const a = agentRow(id)
      Object.assign(a, { toolUseId: e.tool_use_id, description: e.description || a.description, type: e.subagentType || a.type,
        model: r.model, prompt: e.prompt.slice(0, 4000), status: 'running', startedAt: Date.now() })
      if (e.isTeammate || r.teammateId) {
        a.teammate = true
        a.teammateId = r.teammateId
        a.name = e.name ?? r.teammateId ?? a.name
      } else if (e.name) a.name = e.name
      if (run) { a.workflowRunId = run.runId; a.workflowIndex = e.workflow!.agentIndex }
      // Its own conversation on the phone starts with the task it was given.
      event($, { kind: 'user', text: e.prompt.slice(0, 20_000), agent: id, via: 'parent' })
      void syncAgents($)
    }
    return r
  })

  // A compaction, from /compact or the engine's own threshold: what it is
  // summarizing while it runs, and the context before and after.
  on('session.compact', async ($, e, next) => {
    if (e.agentId !== undefined || e.trigger === 'precompute') return next(e)
    const n = e.messages.length
    const note = `Resumiendo ${n} mensajes${e.instructions ? ` · «${e.instructions.slice(0, 60)}»` : ''}`
    const row = runningCmd?.id
    // No turn and no command: Claude Code's idle compaction, which runs by
    // itself a few minutes after a long conversation (200k+) goes quiet.
    const idle = !turnId && !row
    if (row) patch($, row, { phase: 'compacting', note })
    live($, { activity: { tool: idle ? 'Compactando en reposo' : e.trigger === 'auto' ? 'Auto-compact' : '/compact', text: note } })
    let r: Awaited<ReturnType<typeof next>>
    try { r = await next(e) } finally { if (idle) live($, { activity: null }) }
    if (r.skip !== undefined) {
      if (row) patch($, row, { note: `Omitido: ${r.skip}` })
      return r
    }
    const delta = { before: r.tokensBefore ?? null, after: r.tokensAfter ?? null, kept: r.messages.length }
    const sizes = delta.before && delta.after ? `: ${Math.round(delta.before / 1000)}k → ${Math.round(delta.after / 1000)}k tokens` : ''
    if (row) patch($, row, { phase: 'done', note: `Resumidos ${n} mensajes`, ...delta })
    else if (idle) event($, { kind: 'info', text: `Contexto compactado en reposo${sizes}. Claude Code lo hace solo cuando una conversación larga queda unos minutos sin uso; se apaga con "idleCompaction": false en settings.json` })
    else event($, { kind: 'info', text: `Contexto compactado automáticamente${sizes}` })
    void reportUsage($)
    return r
  })

  on('session.end', async ($, e, next) => {
    for (const [id, w] of waiters) { waiters.delete(id); w.resolve(undefined) }
    await call($, '/mod/unregister', { session: sessionId })
    const r = await next(e)
    // /clear and /resume keep the process under another id with no session.start:
    // follow it, or the phone keeps a dead id whose transcript is not this one.
    if (e.reason === 'clear' || e.reason === 'resume') $.clock.after(300, () => void adoptSessionId($))
    return r
  })

  on('command.run', { command: 'pastor' }, async ($, e) => {
    const [sub = '', ...rest] = e.args.trim().split(/\s+/)
    const arg = sub.toLowerCase()
    if (!bridge) bridge = await ensureBridge($)
    if (!bridge) return { text: 'el bridge no arrancó (¿está `node` en el PATH?). Mira `claude --debug`.' }
    if (['away', 'fuera', 'here', 'aqui', 'aquí'].includes(arg)) {
      away = arg === 'away' || arg === 'fuera'
      await call($, '/mod/away', { session: sessionId, away })
      showStatus($)
      return { text: away
        ? 'modo fuera. Permisos y preguntas de esta sesión se responden desde el móvil.'
        : 'modo aquí. Todo se responde en esta terminal.' }
    }
    if (arg === 'stop') {
      await $.process.run(['node', `${$.plugin.root}/bridge/bridge.mjs`, 'stop'])
      bridge = undefined
      showStatus($)
      return { text: 'bridge detenido (se vuelve a arrancar con /pastor).' }
    }
    if (arg === 'serve') {
      // Tailscale's own control plane issues HTTPS certs; Headscale and the
      // like do not (`serve` then fails with 501), so fall back to plain HTTP
      // inside the tailnet, which WireGuard already encrypts.
      const net = await tailnet($)
      const run = (argv: string[]) => $.process.run(argv, { timeoutMs: 30_000 })
        .catch(err => ({ exitCode: 1, stdout: '', stderr: String(err) }))
      let served = net.https ? await run(['tailscale', 'serve', '--bg', String(bridge.port)]) : undefined
      if (!served || served.exitCode !== 0) {
        served = await run(['tailscale', 'serve', '--bg', '--http=80', `http://127.0.0.1:${bridge.port}`])
      }
      return { text: served.exitCode === 0
        ? `publicado en tu tailnet (no en internet).\n${served.stdout.trim()}`
        : `tailscale serve falló:\n${served.stderr.trim() || served.stdout.trim()}` }
    }
    if (arg === 'link') {
      const [url, code] = rest
      if (!url || !code) return { text: 'uso: /pastor link http://otra-pc.tu-tailnet/ <código de /pastor en esa PC>' }
      const r = await call($, '/mod/link', { url: /^https?:\/\//.test(url) ? url : `http://${url}`, code })
      return { text: r?.ok
        ? `enlazada: ${r.name}. Sus sesiones ya salen en el móvil de esta PC.`
        : `no pude enlazar: ${r?.error ?? 'el bridge no respondió'}` }
    }
    if (arg === 'unlink') {
      const r = await call($, '/mod/unlink', { name: (rest[0] ?? '').toLowerCase() })
      return { text: r?.ok ? `desenlazada: ${rest[0]}` : `no hay ninguna PC enlazada llamada ${rest[0] ?? '(vacío)'}` }
    }
    if (arg === 'peers') {
      const r = await call($, '/mod/peers')
      const list = (r?.peers ?? []) as { name: string; url: string; online: boolean }[]
      return { text: list.length
        ? `esta PC: ${r.machine}\n${list.map(p => `${p.online ? '●' : '○'} ${p.name}  ${p.url}`).join('\n')}`
        : `esta PC (${r?.machine ?? '?'}) no tiene otras enlazadas. Usa /pastor link <url> <código>.` }
    }
    if (arg && arg !== 'status') return { text: HELP }
    await announce($)
    let url = bridge.publicUrl
    if (!url) {
      const net = await tailnet($)
      if (net.dns) url = `${net.https ? 'https' : 'http'}://${net.dns}/`
    }
    const peers = (await call($, '/mod/peers'))?.peers as { name: string }[] | undefined
    return {
      text: [
        `${bridge.machine} · bridge en http://127.0.0.1:${bridge.port} · ${bridge.devices} dispositivo(s)`,
        url ? `Abre en el móvil: ${url}  (si no carga, corre /pastor serve una vez)` : 'Sin Tailscale: publica el bridge con el túnel que uses.',
        `Código de emparejamiento: ${bridge.pairCode}`,
        `Modo: ${away ? 'fuera (📱 responde permisos)' : 'aquí'}`,
        peers?.length ? `PCs enlazadas: ${peers.map(p => p.name).join(', ')}` : '',
        HELP,
      ].filter(Boolean).join('\n'),
    }
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'composer') typedAt = Date.now()
    if (e.origin.kind === 'task-notification') onTaskNotice($, e.text)
    return next(e)
  })
  on('session.receive', async ($, e, next) => {
    if (e.text.includes('<task-notification>')) onTaskNotice($, e.text)
    else {
      try {
        const o = e.origin
        if (o.kind === 'peer' || o.kind === 'coordinator' || o.kind === 'peer-send-message') {
          const { from, text } = unwrap(e.text)
          // A message between two loops of this session was already recorded at its session.send.
          const echo = messages.some(m => m.dir === 'out' && Date.now() - m.t < 15_000
            && (m.text === text || (m.text.length > 20 && text.includes(m.text.slice(0, 200)))))
          if (!echo) {
            recordMessage({
              dir: 'in',
              from: 'teammate' in o ? o.teammate : o.kind === 'coordinator' ? 'Claude' : from ? agentName(from) : 'otra sesión',
              to: agentName(e.agentId), toAgentId: e.agentId, kind: o.kind, text,
            })
          }
        }
      } catch {}
    }
    return next(e)
  })

  // Outgoing: SendMessage (any loop) or a plugin's $.session.send.
  on('session.send', async ($, e, next) => {
    try {
      if (!(e.origin.kind === 'plugin' && phoneSends.has(e.text))) {
        recordMessage({
          dir: 'out', from: agentName(e.agentId), fromAgentId: e.agentId, to: agentName(e.to),
          toAgentId: agentOf(e.to)?.id, kind: e.origin.kind, text: e.text,
        })
      }
    } catch {}
    if (e.to.toLowerCase().startsWith('pastor:')) {
      const r = await call($, '/mod/peer-send', { session: sessionId, to: e.to, text: e.text })
      return r?.ok ? { isDelivered: true } : { isDelivered: false, reason: r?.reason ?? 'el bridge de pastor no responde' }
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    turnId = e.turnId
    tally = { startedAt: Date.now(), tools: 0, edits: 0, errors: 0, agents: 0, outputTokens: 0, costAtStart: costNow($) }
    if (e.text.includes('<task-notification>')) onTaskNotice($, e.text)
    lastStepText = ''
    const fromPhone = phoneTexts.indexOf(e.text)
    if (fromPhone >= 0) {
      phoneTexts.splice(fromPhone, 1)
      event($, { status: 'busy' })
    } else {
      event($, { kind: 'user', text: e.text, status: 'busy' })
    }
    return next(e)
  })

  // The model's output as it streams: thinking, text, the tool it is writing.
  on('turn.step', async function* ($, e, next) {
    const stream = next(e)
    if (e.agentId !== undefined) {
      const a = agentRow(e.agentId)
      if (a.status !== 'running') { a.status = 'running'; a.endedAt = undefined }
      a.text = ''
      let said = ''
      while (true) {
        const r = await stream.next()
        if (r.done) {
          a.steps++
          if (said.trim()) event($, { kind: 'assistant', text: said.trim().slice(0, 40_000), agent: e.agentId })
          const u = r.value?.usage
          if (u) { a.tokens = u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + u.output_tokens; a.outTokens += u.output_tokens }
          agentsDirty = true
          return r.value
        }
        if (r.value.kind === 'text') { said += r.value.text; a.text = (a.text + r.value.text).slice(-3000); agentsDirty = true }
        else if (r.value.kind === 'tool') { a.activity = { tool: r.value.name, text: 'preparando…' }; agentsDirty = true }
        yield r.value
      }
    }
    turnId = e.turnId // recovers the turn after a reload mid-turn
    let text = ''
    let thought = ''
    let sentAt = 0
    let dirty = false
    const flush = (patch: Live = {}) => {
      sentAt = Date.now()
      dirty = false
      live($, { text, thinking: text === '', thought: thought.slice(-280), ...patch })
    }
    live($, { text: '', thinking: true, thought: '', activity: null })
    while (true) {
      const r = await stream.next()
      if (r.done) {
        if (tally && r.value?.usage) tally.outputTokens += r.value.usage.output_tokens ?? 0
        if (text.trim()) {
          lastStepText = text.trim()
          event($, { kind: 'assistant', text: lastStepText })
        }
        live($, { text: '', thinking: true, thought: '' })
        return r.value
      }
      const c = r.value
      if (c.kind === 'text') { text += c.text; dirty = true }
      else if (c.kind === 'thinking') { thought += c.text; dirty = true }
      else if (c.kind === 'tool') flush({ activity: { tool: c.name, text: 'preparando…' } })
      if (dirty && Date.now() - sentAt > LIVE_MS) flush()
      yield c
    }
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined) {
      const a = agents.get(e.agentId)
      // A teammate's turn ending leaves it waiting for mail, not done.
      if (a?.teammate && !e.isAborted) {
        a.status = 'idle'; a.activity = null; a.answer = e.answer.slice(0, 20_000); a.endedAt ??= Date.now(); agentsDirty = true
      } else if (a) endAgent(e.agentId, e.isAborted ? 'killed' : 'completed', e.answer)
      void syncAgents($)
    }
    if (e.agentId === undefined) {
      turnId = undefined
      const answer = e.isAborted ? (e.answer || '(interrumpido)')
        : e.reason === 'error' && !e.answer.trim() ? '⚠️ No pude responder: Claude devolvió un error (sesión vencida, límite de uso o fallo de la API). Revísalo en la terminal.'
          : e.answer
      const isNew = answer.trim() !== '' && answer.trim() !== lastStepText
      event($, { ...(isNew ? { kind: 'assistant', text: answer } : {}), status: 'idle', final: true, summary: answer.slice(0, 300) })
      void reportUsage($, e.usage, true)
      const t = tally
      tally = undefined
      if (t) void sendReceipt($, t, e)
      // "Now" messages no tool result carried: they become the next prompt.
      for (const t of midTurn.splice(0)) { const text = withAttachments(t); phoneTexts.push(text); void $.prompt.submit({ text, asUser: true }) }
    }
    return done
  })

  // Mirror tool calls with their input and result; in away mode the phone
  // answers AskUserQuestion.
  // ListAgents lists this machine; pastor adds the live sessions of the other PCs.
  on('tool.call', { tool: 'ListAgents' }, async ($, e, next) => {
    const r = await next(e)
    if (r.deny !== undefined || r.isError) return r
    const net = await call($, `/mod/network?session=${encodeURIComponent(sessionId)}`)
    const text = typeof net?.text === 'string' ? net.text : 'Otras PCs (pastor): el bridge de pastor no responde.'
    return { ...r, context: [...(r.context ?? []), text] }
  })

  on('tool.call', async ($, e, next) => {
    if (e.tool === 'AskUserQuestion' && e.agentId === undefined) {
      // Asked in both places at once: the terminal's own dialog and the phone.
      // Whichever answers first wins; settling here closes the other.
      const questions = e.questions
      const qid = newId()
      const phone = askPhone($, { id: qid, kind: 'question', questions }, { hybrid: true, quiet: true })
      const pc = next(e)
      const first = await Promise.race([
        pc.then(r => ({ from: 'pc' as const, r }), err => ({ from: 'pc' as const, err })),
        phone.then(d => ({ from: 'phone' as const, d })),
      ])
      if (first.from === 'pc') {
        withdrawPhone($, qid)
        if ('err' in first) throw first.err
        const answers = (first.r as { result?: { answers?: Record<string, string> } }).result?.answers
        if (answers) event($, { kind: 'tool', tool: 'AskUserQuestion', text: Object.values(answers).join(' · '), id: e.tool_use_id, detail: { answered: true, at: 'pc' } })
        return first.r
      }
      const d = first.d
      if (!d) return pc
      if (d?.decision === 'allow' && d.answers) {
        event($, { kind: 'tool', tool: 'AskUserQuestion', text: Object.values(d.answers).join(' · '), id: e.tool_use_id, detail: { answered: true } })
        return { result: { questions, answers: d.answers } }
      }
      if (d?.decision === 'deny') return { deny: 'El usuario canceló la pregunta desde el móvil.' }
      return pc
    }
    const id = e.tool_use_id
    const startedAt = Date.now()
    try { noteBrowser($, e.tool, e as unknown as Record<string, unknown>) } catch { /* never in the way */ }
    event($, { kind: 'tool', tool: e.tool, text: summarize(e.tool, e), id, detail: detail(e.tool, e), agent: e.agentId })
    if (e.agentId === undefined) live($, { activity: { tool: e.tool, text: summarize(e.tool, e).slice(0, 120) } })
    else { const a = agentRow(e.agentId); a.tools++; a.activity = { tool: e.tool, text: summarize(e.tool, e).slice(0, 120) } }
    const isWorkflow = (e.tool as string) === 'Workflow'
    if (isWorkflow) wfCalls.set(id, workflowMeta(e as unknown as Record<string, unknown>))
    const ran = await next(e)
    if (isWorkflow) { try { onWorkflowReturn(id, ran) } catch {} }
    if (e.agentId === undefined && tally) {
      tally.tools++
      if (EDIT_TOOLS.has(e.tool)) tally.edits++
      if (e.tool === 'Agent' || (e.tool as string) === 'Task') tally.agents++
      if (ran.deny !== undefined || ran.isError === true) tally.errors++
    }
    if (e.agentId !== undefined && agents.has(e.agentId)) { agents.get(e.agentId)!.activity = null; agentsDirty = true }
    void call($, '/mod/toolEnd', {
      session: sessionId, id, ms: Date.now() - startedAt,
      ok: ran.deny === undefined && ran.isError !== true, out: excerpt(ran), res: resultOf(e.tool, ran),
    })
    if (e.agentId === undefined) live($, { activity: null })
    const r = (ran as { result?: Record<string, unknown> }).result
    if (r && typeof r === 'object') {
      const out = `${String(r.stdout ?? '')}\n${String(r.stderr ?? '')}\n${excerpt(ran)}`
      const i = (e as unknown as Record<string, unknown>)
      if ((e.tool === 'Bash' || e.tool === 'PowerShell') && typeof r.backgroundTaskId === 'string') {
        trackTask($, { id: r.backgroundTaskId, kind: 'shell', label: str(i.description, 200) || str(i.command, 200),
          command: str(i.command, 2000) }, out)
      } else if (e.tool === 'Monitor' && typeof r.taskId === 'string') {
        trackTask($, { id: r.taskId, kind: 'monitor', label: str(i.description, 200) || 'Monitor',
          command: str(i.command, 2000) }, out)
      } else if (e.tool === 'TaskStop') {
        const id = str(i.task_id ?? i.shell_id, 100)
        if (id) finishTask($, id, 'killed')
        const run = [...runs.values()].find(x => x.taskId === id || x.runId === id)
        if (run) finishRun(run, 'killed')
      }
    }
    if (e.agentId === undefined && midTurn.length && ran.deny === undefined) {
      const said = midTurn.splice(0)
      event($, { kind: 'info', text: `📱 Entregado a Claude en este turno` })
      return {
        ...ran,
        context: [...(ran.context ?? []), ...said.map(t =>
          `The user sent this message from their phone while you were working; read it now and take it into account: "${t}"${
            attachments(t).length ? `. ${attachNote(attachments(t))}` : ''}`)],
      }
    }
    return ran
  }).catch(($, e, next) => next(e))

  // In away mode, a call that would open the permission dialog asks the phone.
  // A permission the engine would ask for: the engine's dialog cannot be answered
  // from elsewhere once open, so it goes where the person is. The phone when
  // away mode is on, when the session is open on the phone right now, or when
  // nobody has typed at the terminal for a while and the phone was used lately;
  // there it waits (2 min unless away) and then falls back to the terminal.
  // Otherwise the terminal asks, and the phone is told it is waiting there.
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if (verdict.decision !== 'ask' || e.tool_use_id === undefined || NEVER_ASK.has(e.tool)) return verdict
    const idleAtPc = Date.now() - typedAt > IDLE_AT_PC_MS && phoneAgo !== null && phoneAgo < 30 * 60_000
    if (!away && !watching && !idleAtPc) {
      void call($, '/mod/alert', { session: sessionId, kind: 'permission', title: `🔐 Permiso en el PC`, body: `${e.tool}: ${summarize(e.tool, e.input).slice(0, 200)}` })
      return verdict
    }
    const d = await askPhone($, {
      id: newId(), kind: 'permission', tool: e.tool,
      summary: summarize(e.tool, e.input), detail: detail(e.tool, e.input), reason: verdict.reason,
    }, away ? {} : { waitMs: AUTO_PHONE_WAIT_MS })
    if (!d) return verdict
    event($, { kind: 'info', text: `${d.decision === 'allow' ? '✓ permitido' : '✗ denegado'} desde el móvil: ${e.tool}` })
    return d.decision === 'allow'
      ? { decision: 'allow', reason: 'Permitido desde el móvil (pastor)' }
      : { decision: 'deny', reason: d.reason || 'Denegado desde el móvil (pastor)' }
  }).catch(($, e, next) => next(e))
}
