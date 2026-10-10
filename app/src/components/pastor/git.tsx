import {
  ArrowDownIcon, ArrowUpIcon, CheckIcon, ChevronDownIcon, CloudIcon, ExternalLinkIcon, GitBranchIcon, GitCommitHorizontalIcon,
  GitPullRequestIcon, LoaderCircleIcon, RefreshCwIcon, SparklesIcon, TriangleAlertIcon, Undo2Icon,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'

import { CodeBlock } from '@/components/ai-elements/code-block'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api } from '@/lib/api'
import { ago } from '@/lib/format'
import { cn } from '@/lib/utils'

type GitFile = { path: string; from?: string; x: string; y: string; plus?: number | null; minus?: number | null; untracked?: boolean; conflict?: boolean }
type GitCommit = { hash: string; subject: string; author: string; at: number; pushed: boolean }
type GitStatus = {
  repo: boolean; root?: string; branch?: string; upstream?: string; ahead?: number; behind?: number; detached?: boolean; hasHead?: boolean
  files?: GitFile[]; more?: number; log?: GitCommit[]; remote?: string; github?: boolean; defaultBranch?: string; gh?: boolean
  pr?: { number: number; url: string; state: string; title: string; isDraft: boolean } | null
}

// One letter per file, from git's two columns (index, worktree).
function letterOf(f: GitFile) {
  if (f.conflict) return 'U'
  if (f.untracked) return 'N'
  const c = f.x !== '.' ? f.x : f.y
  return c === 'R' ? 'R' : c === 'A' ? 'A' : c === 'D' ? 'D' : 'M'
}
const LETTER: Record<string, string> = {
  M: 'text-amber-300 bg-amber-300/12', A: 'text-emerald-400 bg-emerald-400/12', N: 'text-emerald-400 bg-emerald-400/12',
  D: 'text-red-400 bg-red-400/12', R: 'text-sky-300 bg-sky-300/12', U: 'text-red-300 bg-red-500/20',
}
const LETTER_TIP: Record<string, string> = { M: 'modificado', A: 'añadido', N: 'nuevo', D: 'borrado', R: 'renombrado', U: 'conflicto' }

// The session's repo, the way a person checks it from the phone: branch and
// sync state, what changed (each file's diff on tap), recent commits; commit,
// push, pull, discard a file, open a PR (through the PC's gh).
export function GitView({ machine, cwd, onAsk }: { machine: string; cwd: string; onAsk?: (text: string) => void }) {
  const [st, setSt] = useState<GitStatus | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [discard, setDiscard] = useState<GitFile | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const alive = useRef(true)

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setRefreshing(true)
    try {
      const r = await api<GitStatus>(`/api/git?${new URLSearchParams({ machine, path: cwd })}`)
      if (alive.current) { setSt(r); setErr('') }
    } catch (e) { if (alive.current) setErr((e as Error).message) }
    finally { if (alive.current) setRefreshing(false) }
  }, [machine, cwd])
  useEffect(() => {
    alive.current = true
    void load()
    const t = setInterval(() => { if (document.visibilityState === 'visible') void load(true) }, 8000)
    return () => { alive.current = false; clearInterval(t) }
  }, [load])

  const act = async (op: string, body: Record<string, unknown> = {}, ok?: (r: { out?: string; url?: string }) => void) => {
    setBusy(op)
    const tid = toast.loading(OP_LABEL[op] ?? op)
    try {
      const r = await api<{ out?: string; url?: string }>('/api/git', { machine, path: cwd, op, ...body })
      toast.success(OP_DONE[op] ?? 'Hecho', { id: tid, description: r.out || r.url, icon: <CheckIcon className="size-4" /> })
      ok?.(r)
      await load(true)
    } catch (e) {
      toast.error(OP_FAIL[op] ?? 'git falló', { id: tid, description: (e as Error).message, duration: 9000 })
    } finally { setBusy(null) }
  }

  if (err && !st) return <Shell><p className="rounded-2xl bg-red-500/10 p-3 text-[13px] text-red-300">{err}</p></Shell>
  if (!st) return <Shell><p className="text-shine text-sm">Leyendo el repo…</p></Shell>
  if (!st.repo) return (
    <Shell>
      <div className="mt-16 flex flex-col items-center gap-2 text-center text-muted-foreground">
        <GitBranchIcon className="size-8 opacity-50" />
        <p className="text-sm">Esta carpeta no es un repo git.</p>
      </div>
    </Shell>
  )

  const files = st.files ?? []
  const plus = files.reduce((a, f) => a + (f.plus ?? 0), 0), minus = files.reduce((a, f) => a + (f.minus ?? 0), 0)
  const canPr = st.github && st.gh && !st.detached && st.branch && st.branch !== st.defaultBranch && !st.pr

  return (
    <Shell>
      {/* branch and sync */}
      <div className="rounded-3xl p-3.5 glass">
        <div className="flex items-center gap-2">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-coral/12 text-coral"><GitBranchIcon className="size-4" /></span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-[14px] font-semibold">{st.detached ? 'HEAD separado' : st.branch}</p>
            <p className="truncate font-mono text-[11px] text-muted-foreground/70">
              {st.upstream ? `↔ ${st.upstream}` : st.remote ? 'sin rama remota todavía' : 'sin remoto'}
            </p>
          </div>
          <button type="button" onClick={() => void load()} aria-label="Recargar" className="grid size-9 place-items-center rounded-full text-muted-foreground active:bg-white/5">
            <RefreshCwIcon className={cn('size-4', refreshing && 'animate-spin')} />
          </button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <SyncButton icon={ArrowDownIcon} label="Pull" count={st.behind ?? 0} busy={busy === 'pull'} disabled={!st.upstream || !!busy}
            onClick={() => void act('pull')} />
          <SyncButton icon={ArrowUpIcon} label={st.upstream ? 'Push' : 'Publicar rama'} count={st.ahead ?? 0} busy={busy === 'push'}
            disabled={!st.remote || !!busy || (!!st.upstream && !st.ahead)} accent={!!st.ahead || (!st.upstream && !!st.remote)}
            onClick={() => void act('push')} />
        </div>
        {st.pr && (
          <a href={st.pr.url} target="_blank" rel="noreferrer"
            className="mt-2 flex items-center gap-2 rounded-2xl border border-violet-400/25 bg-violet-500/10 px-3 py-2 text-[13px] text-violet-100 active:bg-violet-500/20">
            <GitPullRequestIcon className="size-4 shrink-0 text-violet-300" />
            <span className="min-w-0 flex-1 truncate">#{st.pr.number} {st.pr.title}</span>
            <span className="shrink-0 rounded-full bg-violet-400/15 px-1.5 text-[10.5px] uppercase">{st.pr.isDraft ? 'borrador' : st.pr.state.toLowerCase()}</span>
            <ExternalLinkIcon className="size-3.5 shrink-0 opacity-60" />
          </a>
        )}
        {canPr && (
          <button type="button" disabled={!!busy || !st.upstream} onClick={() => void act('pr', {}, r => { if (r.url) window.open(r.url, '_blank') })}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 py-2 text-[13px] text-muted-foreground active:bg-white/5 disabled:opacity-50">
            {busy === 'pr' ? <LoaderCircleIcon className="size-4 animate-spin" /> : <GitPullRequestIcon className="size-4" />}
            {st.upstream ? `Abrir PR hacia ${st.defaultBranch || 'la rama principal'}` : 'Publica la rama para abrir un PR'}
          </button>
        )}
      </div>

      {/* changes */}
      <div>
        <div className="mb-2 flex items-center gap-2 px-1">
          <span className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Cambios</span>
          <span className="font-mono text-[11px] text-muted-foreground/70">{files.length}{st.more ? `+${st.more}` : ''}</span>
          {files.length > 0 && <span className="ml-auto font-mono text-[11px]"><span className="text-emerald-400">+{plus}</span> <span className="text-red-400">−{minus}</span></span>}
        </div>
        {files.length === 0 ? (
          <p className="rounded-2xl px-4 py-5 text-center text-[13px] text-muted-foreground glass">Todo commiteado. Nada pendiente.</p>
        ) : (
          <div className="overflow-hidden rounded-2xl glass">
            {files.map(f => (
              <FileRow key={f.path} f={f} open={open === f.path} machine={machine} cwd={cwd}
                onToggle={() => setOpen(o => (o === f.path ? null : f.path))} onDiscard={() => setDiscard(f)} />
            ))}
          </div>
        )}
      </div>

      {/* commit */}
      {files.length > 0 && (
        <div className="flex flex-col gap-2 rounded-3xl p-3 glass">
          <textarea value={message} onChange={e => setMessage(e.target.value)} rows={2} placeholder="Mensaje del commit"
            className="w-full resize-none rounded-2xl border border-white/8 bg-white/[0.04] px-3 py-2 text-[16px] outline-none focus:border-coral/50 sm:text-[14px]" />
          <div className="flex gap-2">
            <button type="button" disabled={!message.trim() || !!busy}
              onClick={() => void act('commit', { message: message.trim() }, () => setMessage(''))}
              className="flex h-10 flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-coral to-[oklch(0.62_0.15_35)] text-[14px] font-semibold text-background disabled:opacity-50">
              {busy === 'commit' ? <LoaderCircleIcon className="size-4 animate-spin" /> : <GitCommitHorizontalIcon className="size-4" />}
              Commit de todo
            </button>
            {onAsk && (
              <button type="button" disabled={!!busy}
                onClick={() => onAsk('Revisa los cambios sin commitear (git status y git diff) y haz commit con un mensaje claro en el estilo de los commits anteriores. No hagas push.')}
                className="flex h-10 items-center gap-1.5 rounded-2xl border border-violet-400/30 bg-violet-500/10 px-3 text-[13px] text-violet-100 active:bg-violet-500/20">
                <SparklesIcon className="size-4 text-violet-300" />Que lo haga Claude
              </button>
            )}
          </div>
        </div>
      )}

      {/* history */}
      {(st.log?.length ?? 0) > 0 && (
        <div>
          <p className="mb-2 px-1 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Commits</p>
          <div className="overflow-hidden rounded-2xl glass">
            {st.log!.map(c => (
              <div key={c.hash} className="flex items-center gap-3 border-b border-white/5 px-3.5 py-2.5 last:border-0">
                <span title={c.pushed ? 'En el remoto' : 'Solo local'}
                  className={cn('size-2 shrink-0 rounded-full', c.pushed ? 'bg-emerald-400/70' : 'bg-coral ring-2 ring-coral/25')} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px]">{c.subject}</span>
                  <span className="block truncate font-mono text-[10.5px] text-muted-foreground/70">{c.hash} · {c.author} · {ago(c.at)}</span>
                </span>
                {!c.pushed && st.upstream && <CloudIcon className="size-3.5 shrink-0 text-coral/70" aria-label="Sin subir" />}
              </div>
            ))}
          </div>
        </div>
      )}

      <Dialog open={!!discard} onOpenChange={v => { if (!v) setDiscard(null) }}>
        <DialogContent className="rounded-3xl border-white/10 bg-popover/95 backdrop-blur-2xl">
          <DialogHeader>
            <DialogTitle>¿Descartar los cambios?</DialogTitle>
            <DialogDescription>
              <span className="font-mono text-foreground">{discard?.path}</span>{' '}
              {discard?.untracked ? 'es un archivo nuevo: se borra del disco.' : 'vuelve a como está en el último commit.'} No se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-row gap-2">
            <button type="button" onClick={() => setDiscard(null)} className="h-10 flex-1 rounded-2xl border border-white/10 text-[14px]">Cancelar</button>
            <button type="button" onClick={() => { const f = discard; setDiscard(null); if (f) void act('discard', { file: f.path }) }}
              className="h-10 flex-1 rounded-2xl bg-red-500/90 text-[14px] font-semibold text-white">Descartar</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Shell>
  )
}

const OP_LABEL: Record<string, string> = { pull: 'Trayendo cambios…', push: 'Subiendo…', commit: 'Haciendo commit…', discard: 'Descartando…', pr: 'Abriendo PR…' }
const OP_DONE: Record<string, string> = { pull: 'Actualizado', push: 'Subido', commit: 'Commit hecho', discard: 'Cambios descartados', pr: 'PR abierto' }
const OP_FAIL: Record<string, string> = { pull: 'No se pudo hacer pull', push: 'No se pudo subir', commit: 'No se pudo hacer commit', discard: 'No se pudo descartar', pr: 'No se pudo abrir el PR' }

function Shell({ children }: { children: ReactNode }) {
  return <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-3"><div className="flex flex-col gap-4">{children}</div></div>
}

function SyncButton({ icon: Icon, label, count, busy, disabled, accent, onClick }: {
  icon: typeof ArrowUpIcon; label: string; count: number; busy: boolean; disabled: boolean; accent?: boolean; onClick: () => void
}) {
  return (
    <button type="button" disabled={disabled} onClick={onClick}
      className={cn('flex h-10 items-center justify-center gap-1.5 rounded-2xl border text-[13px] font-medium transition-colors disabled:opacity-40',
        accent ? 'border-coral/50 bg-coral/12 text-coral' : 'border-white/10 text-muted-foreground active:bg-white/5')}>
      {busy ? <LoaderCircleIcon className="size-4 animate-spin" /> : <Icon className="size-4" />}
      {label}{count > 0 && <span className="rounded-full bg-current/15 px-1.5 font-mono text-[11px]">{count}</span>}
    </button>
  )
}

function FileRow({ f, open, machine, cwd, onToggle, onDiscard }: {
  f: GitFile; open: boolean; machine: string; cwd: string; onToggle: () => void; onDiscard: () => void
}) {
  const [d, setD] = useState<{ diff: string; binary?: boolean; big?: boolean } | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    if (!open) return
    setD(null); setErr('')
    api<{ diff: string; binary?: boolean; big?: boolean }>(`/api/git?${new URLSearchParams({ machine, path: cwd, file: f.path })}`).then(setD, e => setErr((e as Error).message))
  }, [open, machine, cwd, f.path, f.plus, f.minus])
  const letter = letterOf(f)
  const slash = f.path.lastIndexOf('/')
  const dir = slash >= 0 ? f.path.slice(0, slash + 1) : '', name = f.path.slice(slash + 1)
  return (
    <div className="border-b border-white/5 last:border-0">
      <div className="flex items-center">
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2.5 text-left active:bg-white/5">
          <span title={LETTER_TIP[letter]} className={cn('grid size-5 shrink-0 place-items-center rounded-md font-mono text-[10.5px] font-bold', LETTER[letter])}>{letter}</span>
          <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">
            <span className="text-muted-foreground/60">{dir}</span><span className="text-foreground">{name}</span>
          </span>
          {f.plus == null && !f.untracked ? <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground/60">bin</span> : (
            <span className="shrink-0 font-mono text-[11px]">
              {!!f.plus && <span className="text-emerald-400">+{f.plus}</span>}{' '}{!!f.minus && <span className="text-red-400">−{f.minus}</span>}
            </span>
          )}
          <ChevronDownIcon className={cn('size-3.5 shrink-0 text-muted-foreground/50 transition-transform', open && 'rotate-180')} />
        </button>
        <button type="button" onClick={onDiscard} aria-label="Descartar cambios" className="grid size-10 shrink-0 place-items-center text-muted-foreground/50 active:text-red-300">
          <Undo2Icon className="size-3.5" />
        </button>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 36 }} className="overflow-hidden border-t border-white/5">
            {f.conflict && <p className="flex items-center gap-1.5 px-3 pt-2 text-[12px] text-red-300"><TriangleAlertIcon className="size-3.5" />Conflicto de merge sin resolver</p>}
            {f.from && <p className="px-3 pt-2 font-mono text-[11px] text-sky-300/80">antes: {f.from}</p>}
            {err ? <p className="p-3 text-[12px] text-red-300">{err}</p>
              : !d ? <p className="text-shine p-3 text-[12px]">Leyendo diff…</p>
              : d.binary ? <p className="p-3 text-[12px] text-muted-foreground">Archivo binario.</p>
              : d.big ? <p className="p-3 text-[12px] text-muted-foreground">Demasiado grande para mostrarlo.</p>
              : !d.diff ? <p className="p-3 text-[12px] text-muted-foreground">Sin diferencias de texto.</p>
              : <CodeBlock code={d.diff} language="diff" className="max-h-[60vh] overflow-auto rounded-none border-0 bg-transparent text-[11.5px]" />}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
