import {
  ArrowUpIcon, AtSignIcon, CheckIcon, ChevronLeftIcon, CopyIcon, EyeIcon, EyeOffIcon, FileCodeIcon, FileIcon,
  FileJsonIcon, FileTextIcon, FolderIcon, FolderOpenIcon, GitBranchIcon, GlobeIcon, ImageIcon, SearchIcon, XIcon,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { BundledLanguage } from 'shiki'
import { toast } from 'sonner'

import { CodeBlock } from '@/components/ai-elements/code-block'
import { MessageResponse } from '@/components/ai-elements/message'
import { api, store } from '@/lib/api'
import { ago, langOf } from '@/lib/format'
import type { FsEntry, FsFile, FsHit, FsList } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useBackClose } from '@/lib/back'
import { isHtml, openHtmlFile } from './webviewer'

const CODE = /\.(tsx?|jsx?|mjs|cjs|py|rs|go|java|kt|swift|rb|php|cs|c|h|cpp|css|scss|html|vue|svelte|sh|ps1|sql|toml|ya?ml|xml)$/i
const IMG = /\.(png|jpe?g|gif|webp|svg|ico)$/i
export function fileIcon(name: string, dir: boolean) {
  if (dir) return FolderIcon
  if (/\.json$/i.test(name)) return FileJsonIcon
  if (IMG.test(name)) return ImageIcon
  if (CODE.test(name)) return FileCodeIcon
  if (/\.(md|mdx|txt|rst)$/i.test(name)) return FileTextIcon
  return FileIcon
}
const bytes = (n: number) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB` : `${(n / 1048576).toFixed(1)} MB`
const GIT: Record<string, string> = { M: 'text-amber-300 bg-amber-300/12', A: 'text-emerald-400 bg-emerald-400/12', U: 'text-emerald-400 bg-emerald-400/12', D: 'text-red-400 bg-red-400/12', R: 'text-sky-300 bg-sky-300/12' }

const fsUrl = (machine: string, params: Record<string, string>) =>
  `/api/fs?${new URLSearchParams({ machine, ...params })}`
const join = (dir: string, name: string, sep: string) => dir.endsWith(sep) ? dir + name : dir + sep + name

// One folder per screen, a path bar to jump back, the project-wide finder on
// top; a file opens in a viewer that can drop it into the prompt as @path.
export function Explorer({ machine, root, open, onClose, pickFolder, onPick, onMention }: {
  machine: string
  root: string
  open: boolean
  onClose: () => void
  pickFolder?: boolean
  onPick?: (dir: string) => void
  onMention?: (ref: string) => void
}) {
  const [dir, setDir] = useState(root)
  useBackClose(open, onClose)
  const [list, setList] = useState<FsList | null>(null)
  const [err, setErr] = useState('')
  const [hidden, setHidden] = useState(() => store.get('fs.hidden', false))
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<FsHit[] | null>(null)
  const [file, setFile] = useState<string | null>(null)
  const bar = useRef<HTMLDivElement>(null)

  useEffect(() => { if (open) { setDir(root); setQuery(''); setFile(null) } }, [open, root])
  useEffect(() => {
    if (!open || !dir) return
    let alive = true
    setErr('')
    api<FsList>(fsUrl(machine, { op: 'list', path: dir })).then(
      l => { if (alive) { setList(l); requestAnimationFrame(() => bar.current?.scrollTo({ left: 9e9, behavior: 'smooth' })) } },
      e => { if (alive) setErr((e as Error).message) })
    return () => { alive = false }
  }, [open, dir, machine])
  useEffect(() => { store.set('fs.hidden', hidden) }, [hidden])
  useEffect(() => {
    const q = query.trim()
    if (!q) { setHits(null); return }
    const ctl = new AbortController()
    const t = setTimeout(() => {
      api<{ results: FsHit[] }>(fsUrl(machine, { op: 'search', path: root, q }), undefined, { signal: ctl.signal })
        .then(r => setHits(pickFolder ? r.results.filter(h => h.dir) : r.results), () => {})
    }, 220)
    return () => { clearTimeout(t); ctl.abort() }
  }, [query, machine, root, pickFolder])

  const entries = useMemo(() => (list?.entries ?? [])
    .filter(e => hidden || !e.name.startsWith('.'))
    .filter(e => !pickFolder || e.dir), [list, hidden, pickFolder])
  const crumbs = useMemo(() => {
    if (!list) return []
    const sep = list.sep
    const parts = list.path.split(sep).filter(Boolean)
    const abs = list.path.startsWith(sep)
    return parts.map((name, i) => ({ name, path: (abs ? sep : '') + parts.slice(0, i + 1).join(sep) + (i === 0 && /:$/.test(name) ? sep : '') }))
  }, [list])
  const rel = (p: string) => {
    const r = p.startsWith(root) ? p.slice(root.length).replace(/^[\\/]+/, '') : p
    return r.replaceAll('\\', '/')
  }
  const openEntry = (e: FsEntry) => {
    if (!list) return
    const p = join(list.path, e.name, list.sep)
    e.dir ? setDir(p) : setFile(p)
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div key="explorer" initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
          transition={{ type: 'spring', stiffness: 320, damping: 34 }}
          className="fixed inset-0 z-50 flex flex-col bg-background pt-[env(safe-area-inset-top)]">
          <header className="flex items-center gap-2 border-b border-white/6 px-2 py-2">
            <button type="button" onClick={onClose} aria-label="Cerrar" className="grid size-10 place-items-center rounded-full active:bg-white/5">
              <XIcon className="size-5" />
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold leading-tight">{pickFolder ? 'Elegir carpeta' : 'Archivos'}</p>
              <p className="flex items-center gap-1.5 truncate font-mono text-[11px] text-muted-foreground">
                {machine}{list?.branch && <><GitBranchIcon className="size-3" />{list.branch}</>}
              </p>
            </div>
            <button type="button" onClick={() => setHidden(h => !h)} aria-label="Ocultos"
              className={cn('grid size-9 place-items-center rounded-full border', hidden ? 'border-coral/50 text-coral' : 'border-white/10 text-muted-foreground')}>
              {hidden ? <EyeIcon className="size-4" /> : <EyeOffIcon className="size-4" />}
            </button>
          </header>

          <div className="flex flex-col gap-2 border-b border-white/6 px-3 py-2">
            <label className="flex items-center gap-2 rounded-2xl border border-white/8 bg-white/[0.04] px-3 focus-within:border-coral/50">
              <SearchIcon className="size-4 text-muted-foreground" />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder={pickFolder ? 'Buscar carpeta…' : 'Buscar en el proyecto…'}
                className="h-10 min-w-0 flex-1 bg-transparent text-[14px] outline-none" />
              {query && <button type="button" onClick={() => setQuery('')}><XIcon className="size-4 text-muted-foreground" /></button>}
            </label>
            {!query && (
              <div ref={bar} className="scrollbar-none flex items-center gap-1 overflow-x-auto font-mono text-[12px]">
                <button type="button" disabled={!list?.parent} onClick={() => list?.parent && setDir(list.parent)}
                  className="grid size-7 shrink-0 place-items-center rounded-lg bg-white/5 disabled:opacity-30" aria-label="Subir">
                  <ArrowUpIcon className="size-3.5" />
                </button>
                {crumbs.map((c, i) => (
                  <span key={c.path} className="flex shrink-0 items-center gap-1">
                    {i > 0 && <span className="text-muted-foreground/40">/</span>}
                    <button type="button" onClick={() => setDir(c.path)}
                      className={cn('rounded-md px-1.5 py-0.5', i === crumbs.length - 1 ? 'bg-coral/15 text-coral' : 'text-muted-foreground active:bg-white/5')}>
                      {c.name}
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <main className="min-h-0 flex-1 overflow-y-auto pb-[max(env(safe-area-inset-bottom),16px)]">
            {err && <p className="p-4 text-sm text-red-400">{err}</p>}
            {query ? (
              <div className="flex flex-col py-1">
                {hits === null && <p className="text-shine px-4 py-3 text-sm">Buscando…</p>}
                {hits?.length === 0 && <p className="px-4 py-3 text-sm text-muted-foreground">Nada coincide.</p>}
                {hits?.map(h => {
                  const Icon = fileIcon(h.rel, h.dir)
                  return (
                    <button key={h.path} type="button" onClick={() => { h.dir ? setDir(h.path) : setFile(h.path); setQuery('') }}
                      className="flex items-center gap-3 px-4 py-2.5 text-left active:bg-white/5">
                      <Icon className={cn('size-4 shrink-0', h.dir ? 'text-coral' : 'text-muted-foreground')} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px]">{h.rel.split('/').pop()}</span>
                        <span className="block truncate font-mono text-[11px] text-muted-foreground/70">{h.rel}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            ) : (
              <motion.div key={list?.path} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} className="flex flex-col py-1">
                {list && entries.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted-foreground">Carpeta vacía.</p>}
                {entries.map(e => {
                  const Icon = fileIcon(e.name, e.dir)
                  return (
                    <button key={e.name} type="button" onClick={() => openEntry(e)}
                      className="flex items-center gap-3 px-4 py-2.5 text-left active:bg-white/5">
                      <span className={cn('grid size-9 shrink-0 place-items-center rounded-xl', e.dir ? 'bg-coral/12 text-coral' : 'bg-white/[0.05] text-muted-foreground')}>
                        <Icon className="size-[18px]" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={cn('block truncate text-[14.5px]', e.name.startsWith('.') && 'text-muted-foreground')}>{e.name}</span>
                        <span className="block font-mono text-[11px] text-muted-foreground/60">
                          {e.dir ? 'carpeta' : bytes(e.size)}{e.mtime ? ` · ${ago(e.mtime)}` : ''}
                        </span>
                      </span>
                      {e.git && <span className={cn('rounded-md px-1.5 font-mono text-[11px] font-bold', GIT[e.git] ?? GIT.M)}>{e.git}</span>}
                    </button>
                  )
                })}
              </motion.div>
            )}
          </main>

          {pickFolder && list && (
            <div className="border-t border-white/6 px-4 pb-[max(env(safe-area-inset-bottom),14px)] pt-3">
              <button type="button" onClick={() => onPick?.(list.path)}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-coral to-[oklch(0.62_0.15_35)] font-semibold text-background shadow-lg shadow-coral/25">
                <FolderOpenIcon className="size-4" />Usar {crumbs.at(-1)?.name ?? 'esta carpeta'}
              </button>
            </div>
          )}

          <FileViewer machine={machine} path={file} rel={file ? rel(file) : ''} onClose={() => setFile(null)}
            onMention={onMention ? r => { onMention(r); setFile(null); onClose() } : undefined} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function FileViewer({ machine, path, rel, onClose, onMention }: {
  machine: string; path: string | null; rel: string; onClose: () => void; onMention?: (ref: string) => void
}) {
  const [f, setF] = useState<FsFile | null>(null)
  const [err, setErr] = useState('')
  const [source, setSource] = useState(false)
  useBackClose(!!path, onClose)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!path) return
    setF(null); setErr(''); setSource(false)
    api<FsFile>(fsUrl(machine, { op: 'read', path })).then(setF, e => setErr((e as Error).message))
  }, [machine, path])
  const name = path?.split(/[\\/]/).pop() ?? ''
  const md = /\.(md|mdx)$/i.test(name)
  const copy = async () => {
    try { await navigator.clipboard.writeText(path ?? ''); setCopied(true); setTimeout(() => setCopied(false), 1200) }
    catch { toast.error('No se pudo copiar') }
  }
  return (
    <AnimatePresence>
      {path && (
        <motion.div key="viewer" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
          transition={{ type: 'spring', stiffness: 340, damping: 36 }}
          className="absolute inset-0 z-10 flex flex-col bg-background pt-[env(safe-area-inset-top)]">
          <header className="flex items-center gap-2 border-b border-white/6 px-2 py-2">
            <button type="button" onClick={onClose} aria-label="Volver" className="grid size-10 place-items-center rounded-full active:bg-white/5">
              <ChevronLeftIcon className="size-5" />
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold leading-tight">{name}</p>
              <p className="truncate font-mono text-[11px] text-muted-foreground">{rel}{f ? ` · ${bytes(f.size)}` : ''}</p>
            </div>
            {md && f?.kind === 'text' && (
              <button type="button" onClick={() => setSource(s => !s)}
                className={cn('rounded-full border px-2.5 py-1 font-mono text-[11px]', source ? 'border-coral/50 text-coral' : 'border-white/10 text-muted-foreground')}>
                {source ? 'fuente' : 'vista'}
              </button>
            )}
            <button type="button" onClick={copy} aria-label="Copiar ruta" className="grid size-9 place-items-center rounded-full border border-white/10 text-muted-foreground">
              {copied ? <CheckIcon className="size-4 text-emerald-400" /> : <CopyIcon className="size-4" />}
            </button>
          </header>
          <main className="min-h-0 flex-1 overflow-auto">
            {!f && !err && <p className="text-shine p-4 text-sm">Abriendo…</p>}
            {err && <p className="p-4 text-sm text-red-400">{err}</p>}
            {f?.kind === 'image' && <img src={f.data} alt={name} className="mx-auto max-w-full p-4 [image-rendering:auto]" />}
            {(f?.kind === 'binary' || f?.kind === 'large') && (
              <p className="p-6 text-center text-sm text-muted-foreground">{f.kind === 'binary' ? 'Archivo binario: no se puede mostrar.' : 'Imagen demasiado grande para mostrarla.'}</p>
            )}
            {f?.kind === 'text' && (md && !source
              ? <div className="px-4 py-4 text-[14.5px] leading-relaxed"><MessageResponse>{f.text ?? ''}</MessageResponse></div>
              : (f.text?.length ?? 0) > 120_000
                ? <pre className="p-4 font-mono text-[11.5px] leading-relaxed">{f.text}</pre>
                : <CodeBlock code={f.text ?? ''} language={langOf(name) as BundledLanguage} showLineNumbers
                    className="rounded-none border-0 bg-transparent text-[11.5px]" />)}
            {f?.truncated && <p className="px-4 pb-4 text-center text-[12px] text-muted-foreground">Mostrando los primeros 400 KB.</p>}
          </main>
          {(onMention || (path && isHtml(path))) && (
            <div className="flex gap-2 border-t border-white/6 px-4 pb-[max(env(safe-area-inset-bottom),14px)] pt-3">
              {path && isHtml(path) && (
                <button type="button" onClick={() => void openHtmlFile(machine, path)}
                  className="flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl border border-violet-400/35 bg-violet-500/12 font-semibold text-violet-100 active:bg-violet-500/20">
                  <GlobeIcon className="size-4 text-violet-300" />Ver renderizada
                </button>
              )}
              {onMention && (
                <button type="button" onClick={() => onMention(`@${rel}`)}
                  className="flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-coral to-[oklch(0.62_0.15_35)] font-semibold text-background shadow-lg shadow-coral/25">
                  <AtSignIcon className="size-4" />Mencionar
                </button>
              )}
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
