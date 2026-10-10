import { ArrowUpIcon, CameraIcon, ClockIcon, FileIcon, ImagesIcon, Loader2Icon, OctagonPauseIcon, PaperclipIcon, PencilIcon, SlashIcon, SquareIcon, TriangleAlertIcon, XIcon, ZapIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Suggestion, Suggestions } from '@/components/ai-elements/suggestion'
import { SlashSuggestions } from '@/components/pastor/palette'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { api, store } from '@/lib/api'
import type { SendMode, UploadResult } from '@/lib/types'
import { cn } from '@/lib/utils'

const DEFAULT_QUICK = ['sí', 'no', 'continúa', 'corre los tests', 'haz commit', 'explícame qué hiciste']
const MAX_UPLOAD = 20 * 1024 * 1024
const NL = '\n'

// A file picked on the phone, waiting to be sent to the session's PC.
type Attachment = {
  key: string
  file: File
  preview?: string
  state: 'idle' | 'uploading' | 'done' | 'error'
  path?: string
}

const size = (n: number) => n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`
const mention = (path: string) => /\s/.test(path) ? `@"${path}"` : `@${path}`
const readDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const r = new FileReader()
  r.onload = () => resolve(String(r.result))
  r.onerror = () => reject(r.error ?? new Error('No se pudo leer el archivo'))
  r.readAsDataURL(file)
})

// A frosted-glass composer: quick replies above, the text box, stop and send.
export function Composer({ busy, onSend, onStop, draftKey, onPalette, inject, machine, canAttach = true, placeholder, onTyping }: {
  placeholder?: string
  // The text box got focus or input (the session's pet comes to look).
  onTyping?: () => void
  busy: boolean
  // The PC the session runs on: attachments are uploaded there.
  machine: string
  canAttach?: boolean
  // Text dropped in from elsewhere (a file mentioned from the explorer); `n` makes a repeat count.
  inject?: { text: string; n: number }
  onPalette: () => void
  onSend: (text: string, mode: SendMode) => Promise<void> | void
  onStop: () => void
  draftKey: string
}) {
  const [text, setText] = useState(() => store.get(`draft.${draftKey}`, ''))
  const [quick, setQuick] = useState<string[]>(() => store.get('quick', DEFAULT_QUICK))
  const [sending, setSending] = useState(false)
  const [choosing, setChoosing] = useState<string | null>(null)
  const [files, setFiles] = useState<Attachment[]>([])
  const box = useRef<HTMLTextAreaElement>(null)
  const pickers = { camera: useRef<HTMLInputElement>(null), gallery: useRef<HTMLInputElement>(null), file: useRef<HTMLInputElement>(null) }
  const filesRef = useRef(files)
  filesRef.current = files
  useEffect(() => () => { for (const f of filesRef.current) if (f.preview) URL.revokeObjectURL(f.preview) }, [])

  const addFiles = (list: FileList | null) => {
    if (!list?.length) return
    const next: Attachment[] = []
    for (const file of Array.from(list)) {
      if (file.size > MAX_UPLOAD) {
        toast.error('Archivo demasiado grande', { description: `${file.name} pesa ${size(file.size)}; el máximo es 20 MB`, icon: <TriangleAlertIcon className="size-4" /> })
        continue
      }
      next.push({
        key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, file, state: 'idle',
        preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
      })
    }
    if (next.length) setFiles(f => [...f, ...next])
  }
  const removeFile = (key: string) => setFiles(f => f.filter(a => {
    if (a.key !== key) return true
    if (a.preview) URL.revokeObjectURL(a.preview)
    return false
  }))
  const patchFile = (key: string, patch: Partial<Attachment>) => setFiles(f => f.map(a => a.key === key ? { ...a, ...patch } : a))
  // Each file goes to the session's PC once; a failed send keeps the paths.
  const uploadAll = async (): Promise<string[]> => {
    const paths: string[] = []
    for (const a of filesRef.current) {
      if (a.path) { paths.push(a.path); continue }
      patchFile(a.key, { state: 'uploading' })
      try {
        const data = await readDataUrl(a.file)
        const r = await api<UploadResult>('/api/upload', { machine, name: a.file.name || 'archivo', data })
        patchFile(a.key, { state: 'done', path: r.path })
        paths.push(r.path)
      } catch (e) {
        patchFile(a.key, { state: 'error' })
        throw new Error(`${a.file.name}: ${(e as Error).message}`)
      }
    }
    return paths
  }
  // Only the files that went out: one picked while sending stays for the next message.
  const clearFiles = (keys: Set<string>) => setFiles(f => f.filter(a => {
    if (!keys.has(a.key)) return true
    if (a.preview) URL.revokeObjectURL(a.preview)
    return false
  }))

  useEffect(() => { store.set(`draft.${draftKey}`, text) }, [text, draftKey])
  useEffect(() => {
    if (!inject) return
    setText(t => `${t}${t && !/\s$/.test(t) ? ' ' : ''}${inject.text} `)
    setTimeout(() => box.current?.focus(), 350)
  }, [inject])
  useEffect(() => {
    const el = box.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.35)}px`
  }, [text])

  // While Claude works, a message can go into the running turn, wait for
  // it to end, or interrupt it: the choice is asked each time.
  const send = async (value = text, mode?: SendMode) => {
    const v = value.trim()
    const sentKeys = new Set(filesRef.current.map(a => a.key))
    const attached = sentKeys.size > 0
    if ((!v && !attached) || sending) return
    // A slash command runs once the session is free; no need to ask.
    if (busy && !mode && !v.startsWith('/')) { setChoosing(v); return }
    setChoosing(null)
    setSending(true)
    try {
      let out = v
      if (attached) {
        let paths: string[]
        try { paths = await uploadAll() }
        catch (e) { toast.error('No se pudo subir', { description: (e as Error).message }); return }
        const refs = paths.map(mention).join(NL)
        // A slash command must stay first; elsewhere the files lead.
        out = v.startsWith('/') ? `${v} ${paths.map(mention).join(' ')}` : v ? [refs, v].join(NL) : refs
      }
      await onSend(out, mode ?? 'queue')
      if (v === text.trim()) setText('')
      if (attached) clearFiles(sentKeys)
      navigator.vibrate?.(12)
    } finally { setSending(false) }
  }
  const editQuick = () => {
    const v = prompt('Respuestas rápidas, separadas por |', quick.join(' | '))
    if (v == null) return
    const list = v.split('|').map(s => s.trim()).filter(Boolean)
    setQuick(list); store.set('quick', list)
  }

  return (
    <div className="relative px-3 pb-[max(env(safe-area-inset-bottom),12px)] pt-2">
      <AnimatePresence>
        {choosing !== null && busy && (
          <motion.div initial={{ opacity: 0, y: 12, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            className="absolute inset-x-3 bottom-full z-20 mb-2 overflow-hidden rounded-3xl border border-white/10 bg-popover/95 p-1.5 shadow-2xl backdrop-blur-2xl">
            <p className="truncate px-3 pb-1.5 pt-2 text-[12px] text-muted-foreground">
              {choosing ? `“${choosing}”` : ''}{files.length > 0 && `${choosing ? ' + ' : ''}${files.length} ${files.length === 1 ? 'archivo' : 'archivos'}`}
            </p>
            {([
              ['now', ZapIcon, 'Enviar ahora', 'Claude lo lee en este mismo turno'],
              ['queue', ClockIcon, 'Al terminar', 'Se envía cuando acabe lo que está haciendo'],
              ['interrupt', OctagonPauseIcon, 'Interrumpir y enviar', 'Para el turno y empieza con esto'],
            ] as const).map(([mode, Icon, label, hint]) => (
              <button key={mode} type="button" onClick={() => void send(choosing, mode)}
                className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left active:bg-white/8">
                <span className={cn('grid size-9 shrink-0 place-items-center rounded-xl',
                  mode === 'now' ? 'bg-coral/15 text-coral' : mode === 'interrupt' ? 'bg-red-500/12 text-red-300' : 'bg-white/[0.06] text-foreground')}>
                  <Icon className="size-4" />
                </span>
                <span><span className="block text-[14.5px] font-medium">{label}</span><span className="block text-[12px] text-muted-foreground">{hint}</span></span>
              </button>
            ))}
            <button type="button" onClick={() => setChoosing(null)} className="w-full py-2 text-[13px] text-muted-foreground">Cancelar</button>
          </motion.div>
        )}
      </AnimatePresence>
      <SlashSuggestions id={draftKey} text={text} onPick={name => { setText(`/${name} `); box.current?.focus() }} />
      <Suggestions className="px-1 pb-2.5">
        {quick.map(q => (
          <Suggestion key={q} suggestion={q} onClick={s => void send(s)}
            className="h-8 border-white/10 bg-white/[0.04] px-3.5 text-[13px] font-normal backdrop-blur-md active:scale-95" />
        ))}
        <Suggestion suggestion="" onClick={editQuick} aria-label="Editar respuestas rápidas"
          className="h-8 border-white/10 bg-white/[0.04] px-2.5"><PencilIcon className="size-3.5" /></Suggestion>
      </Suggestions>
      <input ref={pickers.camera} type="file" accept="image/*" capture="environment" hidden
        onChange={e => { addFiles(e.target.files); e.target.value = '' }} />
      <input ref={pickers.gallery} type="file" accept="image/*" multiple hidden
        onChange={e => { addFiles(e.target.files); e.target.value = '' }} />
      <input ref={pickers.file} type="file" multiple hidden
        onChange={e => { addFiles(e.target.files); e.target.value = '' }} />
      <AnimatePresence initial={false}>
        {files.length > 0 && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden">
            <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-2.5 [scrollbar-width:none]">
              <AnimatePresence initial={false}>
                {files.map(a => <AttachmentChip key={a.key} a={a} onRemove={sending ? undefined : () => removeFile(a.key)} />)}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <div className={cn(
        'relative flex items-end gap-2 rounded-[26px] p-1.5 pl-4 glass transition-shadow',
        'focus-within:shadow-[0_0_0_1px_oklch(0.68_0.13_41/0.45),0_12px_40px_-12px_oklch(0.68_0.13_41/0.5)]',
      )}>
        <motion.button type="button" whileTap={{ scale: 0.9 }} onClick={onPalette} aria-label="Comandos y ajustes"
          className="-ml-2.5 grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground active:bg-white/8">
          <SlashIcon className="size-[18px]" strokeWidth={2.4} />
        </motion.button>
        {canAttach && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild disabled={sending}>
              <motion.button type="button" whileTap={{ scale: 0.9 }} aria-label="Adjuntar" disabled={sending}
                className={cn('-ml-3 grid size-11 shrink-0 place-items-center rounded-full active:bg-white/8 disabled:opacity-40',
                  files.length ? 'text-coral' : 'text-muted-foreground')}>
                <PaperclipIcon className="size-[18px]" strokeWidth={2.2} />
              </motion.button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" sideOffset={10}
              className="min-w-44 rounded-2xl border-white/10 bg-popover/95 backdrop-blur-2xl">
              <DropdownMenuItem onSelect={() => pickers.camera.current?.click()}><CameraIcon />Foto</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => pickers.gallery.current?.click()}><ImagesIcon />Galería</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => pickers.file.current?.click()}><FileIcon />Archivo</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <textarea ref={box} rows={1} value={text} onChange={e => { setText(e.target.value); onTyping?.() }} onFocus={onTyping}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && matchMedia('(pointer:fine)').matches) { e.preventDefault(); void send() } }}
          placeholder={placeholder ?? (busy ? 'Escribe para el siguiente turno…' : 'Pídele algo a Claude…')}
          className="max-h-[35vh] min-h-11 flex-1 resize-none bg-transparent py-2.5 text-[16px] leading-6 outline-none placeholder:text-muted-foreground/55" />
        {busy && (
          <motion.button type="button" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} whileTap={{ scale: 0.9 }}
            onClick={onStop} aria-label="Interrumpir"
            className="grid size-11 shrink-0 place-items-center rounded-full border border-white/12 bg-white/[0.06]">
            <SquareIcon className="size-3.5 fill-foreground" />
          </motion.button>
        )}
        <motion.button type="button" whileTap={{ scale: 0.9 }} onClick={() => void send()} disabled={(!text.trim() && !files.length) || sending}
          aria-label="Enviar"
          className={cn('grid size-11 shrink-0 place-items-center rounded-full transition-all',
            text.trim() || files.length ? 'bg-gradient-to-br from-coral to-[oklch(0.62_0.15_35)] text-background shadow-lg shadow-coral/30' : 'bg-white/[0.06] text-muted-foreground')}>
          {sending && files.length ? <Loader2Icon className="size-5 animate-spin" /> : <ArrowUpIcon className="size-5" strokeWidth={2.5} />}
        </motion.button>
      </div>
    </div>
  )
}

// One picked file: a thumbnail for images, an icon and size otherwise.
function AttachmentChip({ a, onRemove }: { a: Attachment; onRemove?: () => void }) {
  const busy = a.state === 'uploading'
  return (
    <motion.div layout initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.85 }}
      transition={{ type: 'spring', stiffness: 420, damping: 30 }}
      className={cn('relative flex h-14 shrink-0 items-center overflow-hidden rounded-2xl border glass',
        a.state === 'error' ? 'border-red-400/50' : a.state === 'done' ? 'border-emerald-400/30' : 'border-white/10',
        a.preview ? 'w-14' : 'max-w-48 gap-2.5 pl-2.5 pr-9')}>
      {a.preview ? (
        <img src={a.preview} alt={a.file.name} className="size-full object-cover" />
      ) : (
        <>
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/[0.06] text-muted-foreground">
            <FileIcon className="size-4" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[12.5px] font-medium">{a.file.name || 'archivo'}</span>
            <span className="block font-mono text-[10.5px] text-muted-foreground">{size(a.file.size)}</span>
          </span>
        </>
      )}
      {busy && (
        <span className="absolute inset-0 grid place-items-center bg-background/55 backdrop-blur-[2px]">
          <Loader2Icon className="size-4 animate-spin text-coral" />
        </span>
      )}
      {a.state === 'error' && (
        <span className="absolute inset-0 grid place-items-center bg-red-500/20"><TriangleAlertIcon className="size-4 text-red-300" /></span>
      )}
      {onRemove && !busy && (
        <button type="button" onClick={onRemove} aria-label={`Quitar ${a.file.name}`}
          className="group absolute right-0 top-0 grid size-9 place-items-center rounded-bl-2xl">
          {/* The tap area is the whole corner; the visible dot stays small. */}
          <span className="grid size-5 place-items-center rounded-full bg-background/80 text-foreground backdrop-blur-md transition-transform group-active:scale-90">
            <XIcon className="size-3" strokeWidth={2.6} />
          </span>
        </button>
      )}
    </motion.div>
  )
}
