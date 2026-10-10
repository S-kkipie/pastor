import {
  AlarmClockIcon, BellIcon, BotIcon, CalendarClockIcon, ClipboardListIcon, CompassIcon, ExternalLinkIcon, EyeIcon, FileCode2Icon,
  FileStackIcon, FolderGit2Icon, GlobeIcon, type LucideIcon, MapIcon, OctagonXIcon, PackageSearchIcon, PaperclipIcon,
  RadioIcon, SearchIcon, SendIcon, ShieldAlertIcon, TreesIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'

import { MessageResponse } from '@/components/ai-elements/message'
import { fileName, shortPath } from '@/lib/format'
import type { PastorEvent } from '@/lib/types'
import { cn } from '@/lib/utils'

import { ImagePreviewPath } from './tools'

// Cards for Claude Code's own tools, beyond a name and a line of JSON: what a
// search found, which page was read and how it answered, what got scheduled,
// stopped, sent or planned. A view is the row's label, one-line detail, badges
// and the body shown when the row opens.
export type View = { label: string; detail: string; badge?: ReactNode; body: ReactNode }
type Helpers = { out: ReactNode; Code: (p: { code: string; lang: string }) => ReactNode; error: boolean }

export const RICH_ICONS: Record<string, LucideIcon> = {
  WebSearch: SearchIcon, WebFetch: GlobeIcon, TaskStop: OctagonXIcon, Monitor: EyeIcon, ScheduleWakeup: AlarmClockIcon,
  CronCreate: CalendarClockIcon, CronDelete: CalendarClockIcon, CronList: CalendarClockIcon, SendMessage: SendIcon,
  SendFile: PaperclipIcon, PushNotification: BellIcon, ToolSearch: PackageSearchIcon, EnterPlanMode: MapIcon,
  ExitPlanMode: MapIcon, EnterWorktree: TreesIcon, ExitWorktree: TreesIcon, LSP: FileCode2Icon, NotebookEdit: FileCode2Icon,
  ListAgents: BotIcon, ReadMcpResourceTool: FileStackIcon, ListMcpResourcesTool: FileStackIcon, RemoteTrigger: RadioIcon,
  Artifact: CompassIcon, ReportFindings: ShieldAlertIcon, Glob: FolderGit2Icon, TaskCreate: ClipboardListIcon, TaskUpdate: ClipboardListIcon,
}

const Chip = ({ children, tone }: { children: ReactNode; tone?: 'ok' | 'bad' | 'warn' | 'accent' }) => (
  <span className={cn('rounded-full border px-1.5 font-mono text-[10.5px]',
    tone === 'ok' ? 'border-emerald-400/30 text-emerald-300' : tone === 'bad' ? 'border-red-400/30 text-red-300'
      : tone === 'warn' ? 'border-amber-300/30 text-amber-200' : tone === 'accent' ? 'border-coral/40 text-coral' : 'border-white/10 text-muted-foreground')}>
    {children}
  </span>
)
const Field = ({ k, children }: { k: string; children: ReactNode }) => (
  <p className="flex gap-2 text-[12px] leading-snug"><span className="w-20 shrink-0 text-muted-foreground/70">{k}</span><span className="min-w-0 flex-1 break-words">{children}</span></p>
)
const Quote = ({ children }: { children: ReactNode }) => (
  <p className="rounded-xl border-l-2 border-coral/40 bg-white/[0.03] px-3 py-2 text-[12.5px] italic leading-snug text-muted-foreground">{children}</p>
)
const host = (url?: string) => { try { return new URL(String(url)).hostname.replace(/^www\./, '') } catch { return String(url ?? '') } }
const secs = (n: number) => n < 60 ? `${n}s` : n < 3600 ? `${Math.round(n / 60)} min` : `${(n / 3600).toFixed(n % 3600 ? 1 : 0)} h`
const clock = (t: unknown) => { const d = new Date(typeof t === 'number' ? t : String(t)); return Number.isNaN(+d) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }

function Links({ links }: { links: { title: string; url: string }[] }) {
  return (
    <div className="flex flex-col gap-1">
      {links.map((l, i) => (
        <a key={i} href={l.url} target="_blank" rel="noreferrer"
          className="flex items-center gap-2.5 rounded-xl border border-white/6 bg-white/[0.03] px-2.5 py-2 active:bg-white/[0.07]">
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-white/[0.06] font-mono text-[10px] uppercase text-muted-foreground">{host(l.url).slice(0, 2)}</span>
          <span className="min-w-0 flex-1">
            <span className="line-clamp-2 text-[12.5px] leading-snug">{l.title}</span>
            <span className="block truncate font-mono text-[10.5px] text-muted-foreground/70">{host(l.url)}</span>
          </span>
          <ExternalLinkIcon className="size-3.5 shrink-0 text-muted-foreground/50" />
        </a>
      ))}
    </div>
  )
}

export function richView(ev: PastorEvent, { out, Code, error }: Helpers): View | null {
  const tool = ev.tool ?? ''
  const d = ev.detail ?? {}
  const r = ev.end?.res ?? {}
  switch (tool) {
    case 'WebSearch': {
      const links: { title: string; url: string }[] = r.links ?? []
      const domains: string[] = d.allowed_domains ?? []
      return {
        label: 'Buscó en la web', detail: `“${d.query ?? ev.text}”`,
        badge: <>{links.length > 0 && <Chip tone="accent">{links.length} resultados</Chip>}{r.seconds ? <Chip>{Number(r.seconds).toFixed(1)}s</Chip> : null}</>,
        body: <>
          {domains.length > 0 && <Field k="Solo en">{domains.join(', ')}</Field>}
          {links.length ? <Links links={links} /> : out}
        </>,
      }
    }
    case 'WebFetch': {
      const code = Number(r.code ?? 0)
      let path = ''
      try { const u = new URL(d.url ?? ev.text); path = u.pathname === '/' ? '' : u.pathname } catch { /* not a URL */ }
      return {
        label: 'Leyó una web', detail: `${host(d.url ?? ev.text)}${path}`,
        badge: <>{code > 0 && <Chip tone={code < 400 ? 'ok' : 'bad'}>{code}</Chip>}{r.bytes ? <Chip>{Math.round(Number(r.bytes) / 1024)} KB</Chip> : null}</>,
        body: <>
          {d.prompt && <Quote>{d.prompt}</Quote>}
          {d.url && <a href={d.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 truncate font-mono text-[11px] text-coral"><ExternalLinkIcon className="size-3 shrink-0" />{d.url}</a>}
          {ev.end?.out && !error ? <div className="max-h-72 overflow-y-auto rounded-xl bg-black/25 px-3 py-2 text-[12.5px]"><MessageResponse>{ev.end.out}</MessageResponse></div> : out}
        </>,
      }
    }
    case 'TaskStop':
      return {
        label: 'Detuvo una tarea', detail: r.command || d.task_id || d.shell_id || ev.text,
        badge: r.task_type ? <Chip tone="warn">{r.task_type}</Chip> : undefined,
        body: <>{r.command && <Code code={r.command} lang="bash" />}<Field k="Tarea">{d.task_id ?? d.shell_id}</Field>{error && out}</>,
      }
    case 'Monitor':
      return {
        label: 'Vigila', detail: d.description || d.command || ev.text,
        badge: <>{r.persistent ? <Chip tone="accent">persistente</Chip> : d.timeout_ms ? <Chip>{secs(Math.round(d.timeout_ms / 1000))}</Chip> : null}</>,
        body: <>{d.command && <Code code={d.command} lang="bash" />}{d.ws && <Field k="WebSocket">{d.ws}</Field>}{error && out}</>,
      }
    case 'ScheduleWakeup':
      if (d.stop) return { label: 'Canceló el próximo despertar', detail: d.reason ?? '', body: null }
      return {
        label: 'Se despertará', detail: `en ${secs(Number(r.clampedDelaySeconds ?? d.delaySeconds ?? 0))}${d.reason ? ` · ${d.reason}` : ''}`,
        badge: r.scheduledFor ? <Chip tone="accent">{clock(r.scheduledFor)}</Chip> : undefined,
        body: <>{d.reason && <Quote>{d.reason}</Quote>}{d.prompt && <Field k="Hará">{String(d.prompt).slice(0, 300)}</Field>}</>,
      }
    case 'CronCreate':
      return {
        label: d.recurring === false ? 'Programó una vez' : 'Programó una tarea', detail: r.humanSchedule || d.cron || ev.text,
        badge: <><Chip tone="accent">{d.recurring === false ? 'una vez' : 'se repite'}</Chip>{d.durable && <Chip>persistente</Chip>}</>,
        body: <>{d.cron && <Field k="Cron">{d.cron}</Field>}{d.prompt && <Quote>{d.prompt}</Quote>}{error && out}</>,
      }
    case 'CronDelete': return { label: 'Borró una programación', detail: d.id ?? ev.text, body: error ? out : null }
    case 'CronList': {
      const jobs: { id?: string; humanSchedule?: string; cron?: string; prompt?: string }[] = Array.isArray(r.jobs) ? r.jobs : []
      return {
        label: 'Programaciones', detail: `${jobs.length} activas`, badge: <Chip>{jobs.length}</Chip>,
        body: jobs.length ? <div className="flex flex-col gap-1">{jobs.map((j, i) => <Field key={i} k={j.humanSchedule ?? j.cron ?? '?'}>{j.prompt ?? j.id}</Field>)}</div> : out,
      }
    }
    case 'SendMessage':
      return {
        label: `Mensaje a ${d.to ?? '?'}`, detail: d.summary || String(d.message ?? '').slice(0, 120),
        badge: d.notify_when_idle ? <Chip>avisar al quedar libre</Chip> : undefined,
        body: <p className="rounded-2xl rounded-tl-md border border-violet-400/20 bg-violet-500/[0.08] px-3 py-2 text-[12.5px] whitespace-pre-wrap">{d.message}</p>,
      }
    case 'SendFile': {
      const files: string[] = (Array.isArray(d.files) ? d.files : []).map((f: unknown) => (typeof f === 'string' ? f : (f as { path?: string })?.path ?? '')).filter(Boolean)
      const sent = ev.end ? (r.success === false ? 'bad' : 'ok') : undefined
      return {
        label: `Envió ${files.length || ''} archivo${files.length === 1 ? '' : 's'}`.replace('  ', ' '), detail: d.to ? `a ${d.to}` : files.map(f => fileName(f)).join(', '),
        badge: sent ? <Chip tone={sent}>{sent === 'ok' ? 'enviado' : 'falló'}</Chip> : undefined,
        body: <>
          {d.message && <Quote>{d.message}</Quote>}
          <div className="grid grid-cols-2 gap-2">
            {files.map(f => /\.(png|jpe?g|gif|webp|svg)$/i.test(f)
              ? <div key={f} className="flex flex-col gap-1"><ImagePreviewPath file={f} compact /><span className="truncate font-mono text-[10.5px] text-muted-foreground">{fileName(f)}</span></div>
              : (
                <div key={f} className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/[0.03] px-2.5 py-2">
                  <PaperclipIcon className="size-3.5 shrink-0 text-coral" />
                  <span className="min-w-0"><span className="block truncate text-[12px]">{fileName(f)}</span><span className="block truncate font-mono text-[10px] text-muted-foreground/70">{shortPath(f)}</span></span>
                </div>
              ))}
          </div>
          {error && out}
        </>,
      }
    }
    case 'PushNotification':
      return {
        label: 'Avisó a tu móvil', detail: String(d.message ?? ev.text).slice(0, 140),
        badge: ev.end ? <Chip tone={r.pushSent || r.localSent ? 'ok' : 'warn'}>{r.pushSent ? 'push' : r.localSent ? 'local' : 'no enviado'}</Chip> : undefined,
        body: <>{d.message && <Quote>{d.message}</Quote>}{r.disabledReason && <Field k="Motivo">{r.disabledReason}</Field>}</>,
      }
    case 'ToolSearch': {
      const matches: string[] = (Array.isArray(r.matches) ? r.matches : []).map((m: unknown) => (typeof m === 'string' ? m : (m as { name?: string })?.name ?? '')).filter(Boolean)
      return {
        label: 'Cargó herramientas', detail: d.query ?? ev.text, badge: matches.length ? <Chip>{matches.length}</Chip> : undefined,
        body: matches.length
          ? <div className="flex flex-wrap gap-1">{matches.map(m => <span key={m} className="rounded-lg bg-white/[0.05] px-2 py-0.5 font-mono text-[11px]">{m.replace(/^mcp__/, '').replace(/__/g, ' · ')}</span>)}</div>
          : out,
      }
    }
    case 'EnterPlanMode': return { label: 'Entró en modo plan', detail: 'planifica antes de tocar nada', body: null }
    case 'ExitPlanMode': {
      const plan = String(r.plan ?? d.plan ?? '')
      return {
        label: 'Propuso un plan', detail: plan.split('\n').find(l => l.trim())?.replace(/^#+\s*/, '') ?? '',
        badge: r.awaitingLeaderApproval ? <Chip tone="warn">esperando</Chip> : r.planWasEdited ? <Chip>editado</Chip> : undefined,
        body: plan ? <div className="max-h-96 overflow-y-auto rounded-xl border border-coral/20 bg-coral/[0.04] px-3 py-2 text-[13px]"><MessageResponse>{plan}</MessageResponse></div> : out,
      }
    }
    case 'EnterWorktree':
      return { label: 'Abrió un worktree', detail: r.worktreeBranch || d.name || ev.text, badge: <Chip tone="accent">git</Chip>, body: <>{(r.worktreePath || d.path) && <Field k="Carpeta">{shortPath(r.worktreePath || d.path)}</Field>}{error && out}</> }
    case 'ExitWorktree':
      return {
        label: 'Salió del worktree', detail: `${d.action === 'remove' ? 'lo borró' : 'lo conservó'}${r.worktreeBranch ? ` · ${r.worktreeBranch}` : ''}`,
        body: <>{r.discardedCommits ? <Field k="Commits">{r.discardedCommits} descartados</Field> : null}{r.message && <Field k="">{r.message}</Field>}</>,
      }
    case 'LSP':
      return {
        label: `LSP · ${d.operation ?? ''}`, detail: d.filePath ? `${fileName(d.filePath)}${d.line ? `:${d.line}` : ''}` : d.query ?? ev.text,
        badge: r.resultCount != null ? <Chip>{r.resultCount}</Chip> : undefined, body: out,
      }
    case 'NotebookEdit':
      return {
        label: d.edit_mode === 'insert' ? 'Añadió una celda' : d.edit_mode === 'delete' ? 'Borró una celda' : 'Editó una celda',
        detail: fileName(d.notebook_path), badge: d.cell_type ? <Chip>{d.cell_type}</Chip> : undefined,
        body: <>{d.new_source && <Code code={d.new_source} lang={d.cell_type === 'markdown' ? 'markdown' : 'python'} />}{error && out}</>,
      }
    case 'ListAgents': return { label: 'Consultó los agentes', detail: d.q ?? '', body: out }
    case 'ReadMcpResourceTool': return { label: 'Leyó un recurso MCP', detail: `${d.server ?? ''} · ${d.uri ?? ''}`, body: out }
    case 'ListMcpResourcesTool': return { label: 'Recursos MCP', detail: d.server ?? 'todos', body: out }
    case 'RemoteTrigger': return { label: `Trigger · ${d.action ?? ''}`, detail: d.trigger_id ?? d.session_id ?? '', body: out }
    case 'Artifact':
      return {
        label: `Artifact · ${d.action ?? 'publish'}`, detail: d.title || r.title || d.url || d.file_path || ev.text,
        body: <>{(r.url || d.url) && <a href={r.url || d.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 truncate font-mono text-[11px] text-coral"><ExternalLinkIcon className="size-3 shrink-0" />{r.url || d.url}</a>}{error && out}</>,
      }
    case 'ReportFindings': {
      const findings: { file?: string; short_summary?: string; summary?: string }[] = Array.isArray(d.findings) ? d.findings : []
      return {
        label: `Reportó ${findings.length} hallazgos`, detail: d.level ?? '', badge: <Chip tone={findings.length ? 'warn' : 'ok'}>{findings.length}</Chip>,
        body: <div className="flex flex-col gap-1.5">{findings.map((f, i) => <Field key={i} k={fileName(f.file)}>{f.short_summary ?? f.summary}</Field>)}</div>,
      }
    }
    case 'Glob': {
      const files: string[] = Array.isArray(r.filenames) ? r.filenames : []
      return {
        label: 'Buscó archivos', detail: `${d.pattern ?? ev.text}${d.path ? `  en ${shortPath(d.path)}` : ''}`,
        badge: r.numFiles != null ? <Chip>{r.numFiles}{r.truncated ? '+' : ''}</Chip> : undefined,
        body: files.length ? <div className="flex max-h-60 flex-col gap-0.5 overflow-y-auto font-mono text-[11px] text-muted-foreground">{files.map(f => <span key={f} className="truncate">{shortPath(f)}</span>)}</div> : out,
      }
    }
  }
  return null
}

// Any other built-in tool: its input as labelled fields, never raw JSON.
export function genericView(ev: PastorEvent, { out }: Helpers): View | null {
  const tool = ev.tool ?? ''
  if (tool.startsWith('mcp__')) return null
  const d = ev.detail
  if (!d || typeof d !== 'object') return null
  const entries = Object.entries(d).filter(([, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length)).slice(0, 8)
  const first = entries.find(([, v]) => typeof v === 'string')
  return {
    label: tool.replace(/([a-z])([A-Z])/g, '$1 $2'), detail: first ? String(first[1]).slice(0, 140) : '',
    body: <>
      <div className="flex flex-col gap-1">
        {entries.map(([k, v]) => <Field key={k} k={k}>{typeof v === 'string' ? v.slice(0, 600) : JSON.stringify(v).slice(0, 300)}</Field>)}
      </div>
      {out}
    </>,
  }
}

