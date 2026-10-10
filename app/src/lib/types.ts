export type Status = 'idle' | 'busy' | 'waiting'

export type Usage = {
  model: string
  tokens: number
  window: number
  percent: number | null
  cost: number | null
  rateLimits?: { kind: string; percentUsed: number; resetsAt?: string }[]
  // What fills the window (from $.session.usage({ breakdown: 'summary' })) and when auto-compact runs.
  breakdown?: ContextRow[]
  autoCompactAt?: number | null
  perTurn?: number | null
  turn?: {
    input_tokens: number
    output_tokens: number
    cache_read_input_tokens: number
    cache_creation_input_tokens: number
  } | null
}

export type Activity = { tool: string; text: string }

export type SessionSummary = {
  // A session of the general agent (one per channel), shown inside the Agent screen.
  agent?: boolean
  id: string
  machine: string
  title: string
  // The project folder's name; `title` is the session's own (as /resume shows it).
  project?: string
  cwd: string
  status: Status
  away: boolean
  online: boolean
  pending: number
  updated: number
  lastSeen: number
  activity: Activity | null
  usage: Usage | null
  tasks?: number
  agents?: number
  workflows?: number
  messages?: number
  // Browsers it has driven (agent-browser sessions, Playwright): its live view.
  browsers?: number
  last: { kind: 'user' | 'assistant'; text: string } | null
}

export type Machine = { name: string; online: boolean; local?: boolean }

// biome-ignore lint: a tool's own structured result, per tool
export type ToolEnd = { ok: boolean; ms?: number; out?: string; res?: Record<string, any> }

// biome-ignore lint: detail is a per-tool bag the mod fills
export type Detail = Record<string, any>

export type PastorEvent = {
  seq: number
  rev: number
  t: number
  kind: 'user' | 'assistant' | 'tool' | 'info' | 'command' | 'receipt'
  text: string
  tool?: string
  id?: string
  detail?: Detail
  agent?: string
  end?: ToolEnd
  via?: string
  // A slash command's progress: queued → running (→ compacting) → done.
  phase?: 'running' | 'compacting' | 'done'
  started?: number
  note?: string
  before?: number | null
  after?: number | null
  kept?: number
  // kind 'receipt': what one main turn did, pushed by the mod at turn.complete.
  receipt?: Receipt
}

export type Live = {
  since: number
  text: string
  thinking: boolean
  thought?: string
  activity: Activity | null
}

export type Question = {
  question: string
  header: string
  multiSelect: boolean
  options: { label: string; description?: string }[]
}

export type Pending = {
  id: string
  kind: 'permission' | 'question'
  tool?: string
  summary?: string
  detail?: Detail
  reason?: string
  questions?: Question[]
  t: number
}

export type BgTask = {
  id: string
  kind: 'shell' | 'monitor'
  label: string
  command: string
  status: 'running' | 'completed' | 'failed' | 'killed'
  startedAt: number
  endedAt?: number
  tail: string
}

export type SendMode = 'queue' | 'now' | 'interrupt'

export type SessionPayload = {
  session: SessionSummary
  events: PastorEvent[]
  pending: Pending[]
  live: Live | null
  seq: number
  now?: number
  tasks?: BgTask[]
  agents?: AgentRow[]
  // Context use over the session, one point per usage report (bridge-side).
  contextHistory?: ContextPoint[]
  // true when the session is not live and its events were read back from its transcript.
  fromTranscript?: boolean
  workflows?: WorkflowRun[]
  messages?: PeerMessage[]
  // Events before the first one sent (first load and `before` pages only).
  older?: number
}

export type CommandMeta = { name: string; description: string; source: 'builtin' | 'plugin' | 'user' | 'mcp'; plugin?: string }
export type ConfigMeta = {
  key: string; label: string; description?: string; kind: 'boolean' | 'choice' | 'text' | 'number'
  value: unknown; options?: string[]; isLocked: boolean
}
export type SessionMeta = {
  model: string
  commands: CommandMeta[]
  config: ConfigMeta[]
  at?: number
  mcp: { name: string; tools: number }[]
  tools: string[]
}

export type Project = { path: string; name: string; branch: string | null; lastUsed: number; sessions: number; running: number; trusted?: boolean }
export type ProjectsPayload = { machine: string; projects: Project[]; roots: { name: string; path: string }[]; home: string }
export type FsEntry = { name: string; dir: boolean; size: number; mtime: number; git: string | null }
export type FsList = { path: string; parent: string | null; sep: string; entries: FsEntry[]; branch: string | null; trusted?: boolean }
export type FsFile = { path: string; size: number; kind: 'text' | 'image' | 'binary' | 'large'; text?: string; data?: string; truncated?: boolean }
export type FsHit = { path: string; rel: string; dir: boolean }

export type AgentRow = {
  id: string; toolUseId?: string; description: string; type: string; model?: string; prompt: string
  status: 'pending' | 'running' | 'waiting' | 'idle' | 'completed' | 'failed' | 'killed'
  startedAt: number; endedAt?: number; steps: number; tools: number; tokens: number; outTokens: number
  activity: Activity | null; text: string; answer?: string; parentId?: string
  // A dynamic workflow's agent (agent.spawn's e.workflow) or a team member (isTeammate).
  workflowRunId?: string; workflowIndex?: number
  teammate?: boolean; name?: string; teammateId?: string
}
export type AgentLog = { at: number; error?: string; messages: { role: 'user' | 'assistant'; text: string; tools: { tool: string; text: string }[] }[] }

// ---- shared contract for history, launch, uploads, context ----
export type ContextRow = { name: string; tokens: number; color?: string }
export type ContextPoint = { t: number; tokens: number; percent: number | null }
export type Receipt = {
  durationMs: number; tools: number; edits: number; errors: number; agents: number
  outputTokens: number; costUsd: number | null; aborted: boolean
}
// One past conversation of a project, from ~/.claude/projects/<encoded cwd>/<id>.jsonl.
export type ProjectSession = { id: string; title: string; firstPrompt: string; lastUsed: number; messages: number; running: boolean }
export type ProjectSessionsPayload = { machine: string; path: string; sessions: ProjectSession[] }
export type LaunchBody = {
  machine: string; cwd: string
  mode?: 'new' | 'continue' | 'resume'; sessionId?: string
  trust?: boolean                     // answer Claude Code's "trust this folder?" ahead of time
  away?: boolean                      // the session starts in away mode (default true from the phone)
  permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'  // bypass = --dangerously-skip-permissions
  name?: string                       // claude -n <name>
  worktree?: string | boolean         // claude -w [name]
  mkdir?: boolean                     // create cwd first
  clone?: string                      // git clone <url> into cwd (cwd must not exist), then launch there
}
export type UploadResult = { path: string; name: string; size: number }

// ---- wave 2: workflows, teams, messages between sessions/agents ----
export type WorkflowRun = {
  runId: string; toolUseId?: string; name: string; description?: string; phases: string[]
  status: 'running' | 'completed' | 'failed' | 'killed'; startedAt: number; endedAt?: number
  agents: number; result?: string
}
// One message over SendMessage / session.send / the team mailbox, as this session saw it.
export type PeerMessage = {
  id: string; t: number; dir: 'in' | 'out'
  from: string; to: string             // display names: session title, agent name/description, 'tú', team member…
  fromAgentId?: string; toAgentId?: string
  kind: string                         // origin kind: peer | coordinator | peer-send-message | bridge | …
  text: string
}
export type NetworkMessage = PeerMessage & { session: string; sessionTitle: string; machine: string }
export type AgentChannel = { id: string; label: string; sessionId: string | null; online: boolean; busy: boolean; lastText: string; lastAt: number | null }
export type AgentStatus = { enabled: boolean; whatsapp: { state: 'connecting' | 'connected' | 'disconnected' | 'logged_out'; me: string | null; since: number | null; qr: boolean }; channels: AgentChannel[] }
export type AgentGroup = 'sessions' | 'routines' | 'terminal' | 'files' | 'whatsapp'
export type AgentConfig = {
  enabled: boolean; allowed: string[]; sleepMinutes: number; showInPanel: boolean
  permissions: { total: boolean; groups: Record<AgentGroup, 'libre' | 'pregunta'> }
  vigilante: { needs: boolean; done: boolean; failures: boolean; routines: boolean; daily: boolean; dailyTime: string; tz: number; to: string[] }
}
export type AgentActivity = { at: number; kind: string; text: string }
