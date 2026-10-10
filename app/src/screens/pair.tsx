import { motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'

import { Orb } from '@/components/pastor/orb'
import { api, auth, isNative, parseServer } from '@/lib/api'
import { cn } from '@/lib/utils'

// Pairing: six digits from `/pastor`, and in a native shell the bridge's URL.
export function PairScreen() {
  const [digits, setDigits] = useState<string[]>(Array(6).fill(''))
  const [server, setServer] = useState(auth.server)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const boxes = useRef<(HTMLInputElement | null)[]>([])
  const needsServer = isNative() || !!new URLSearchParams(location.search).get('server')

  const [status, setStatus] = useState('')
  const submit = async (code = digits.join('')) => {
    if (code.length !== 6 || busy) return
    setBusy(true); setError('')
    try {
      if (needsServer) {
        const parsed = parseServer(server)
        if (!parsed) throw new Error('Escribe la dirección del bridge, por ejemplo http://mi-hub.mi-tailnet')
        auth.server = parsed.server
        setServer(parsed.server)
        setStatus(`Conectando con ${parsed.server}…`)
        // Is there a pastor bridge at that address at all?
        const ping = await api<{ pastor?: boolean; machine?: string }>('/api/ping').catch(e => {
          throw new Error(e instanceof TypeError ? `No se pudo conectar con ${parsed.server}. ¿Estás en la tailnet (Tailscale activo)?` : (e as Error).message)
        })
        if (!ping.pastor) throw new Error(`${parsed.server} no es un bridge de pastor`)
        setStatus(`Emparejando con ${ping.machine}…`)
      }
      const ua = navigator.userAgent
      const name = isNative() ? 'app' : /iPhone|iPad/.test(ua) ? 'iphone' : /Android/.test(ua) ? 'android' : 'navegador'
      const { token } = await api<{ token?: string }>('/api/pair', { code, name })
      if (!token) throw new Error('El bridge no devolvió un token')
      navigator.vibrate?.([10, 30, 10])
      auth.token = token
    } catch (e) {
      setError((e as Error).message)
      setDigits(Array(6).fill(''))
      boxes.current[0]?.focus()
      navigator.vibrate?.(120)
    } finally { setBusy(false); setStatus('') }
  }
  // Scanned from another phone's QR (Dispositivos y PCs): ?pair=123456 pairs at once.
  useEffect(() => {
    const code = new URLSearchParams(location.search).get('pair') ?? ''
    if (!/^\d{6}$/.test(code)) return
    history.replaceState(history.state, '', location.pathname)
    setDigits(code.split(''))
    void submit(code)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const type = (i: number, v: string) => {
    const clean = v.replace(/\D/g, '')
    if (clean.length > 1) { // pasted code
      const next = clean.slice(0, 6).split('').concat(Array(6).fill('')).slice(0, 6)
      setDigits(next); boxes.current[Math.min(5, clean.length)]?.focus()
      if (clean.length >= 6) void submit(clean.slice(0, 6))
      return
    }
    const next = [...digits]; next[i] = clean
    setDigits(next)
    if (clean && i < 5) boxes.current[i + 1]?.focus()
    if (next.every(Boolean)) void submit(next.join(''))
  }

  return (
    <div className="flex h-dvh flex-col items-center justify-center px-6 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
      <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        className="relative mb-6">
        <div className="absolute inset-0 -z-10 rounded-full bg-coral/30 blur-3xl" />
        <Orb state={busy ? 'tool' : 'thinking'} size={112} />
      </motion.div>
      <h1 className="text-[28px] font-semibold tracking-tight">Pastor</h1>
      <p className="mt-1.5 max-w-72 text-center text-[14px] text-muted-foreground">
        Escribe <code className="rounded-md bg-white/8 px-1.5 py-0.5 font-mono text-[12.5px] text-foreground">/pastor</code> en Claude Code y pon aquí el código.
      </p>
      {needsServer && (
        <input value={server} placeholder="http://mi-hub.mi-tailnet" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false}
          onChange={e => {
            // A pasted pairing link fills in the code too.
            const parsed = /[?&]pair=\d{6}/.test(e.target.value) ? parseServer(e.target.value) : null
            if (parsed?.code) { setServer(parsed.server); setDigits(parsed.code.split('')); void submit(parsed.code) }
            else setServer(e.target.value)
          }}
          className="mt-6 w-full max-w-80 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-center font-mono text-[14px] outline-none focus:border-coral/50" />
      )}
      <motion.div className="mt-6 flex gap-2" animate={error ? { x: [0, -10, 10, -6, 6, 0] } : {}} transition={{ duration: 0.4 }}>
        {digits.map((d, i) => (
          <input key={i} ref={el => { boxes.current[i] = el }} value={d} inputMode="numeric" autoComplete={i === 0 ? 'one-time-code' : 'off'}
            maxLength={i === 0 ? 6 : 1} autoFocus={i === 0 && !needsServer}
            onChange={e => type(i, e.target.value)}
            onKeyDown={e => { if (e.key === 'Backspace' && !d && i > 0) boxes.current[i - 1]?.focus() }}
            className={cn('size-12 rounded-2xl border bg-white/[0.04] text-center font-mono text-[22px] font-semibold outline-none transition-all',
              'focus:border-coral focus:shadow-[0_0_0_4px_oklch(0.68_0.13_41/0.18)]', d ? 'border-coral/50' : 'border-white/10')} />
        ))}
      </motion.div>
      <p className={cn('mt-4 min-h-5 max-w-80 text-center text-[13px]', error ? 'text-red-400' : 'text-shine')}>{error || status}</p>
      {needsServer && <p className="mt-2 max-w-80 text-center text-[11.5px] text-muted-foreground/70">Pega aquí el enlace de emparejamiento (⚙ → Emparejar en otro teléfono) y se rellena solo.</p>}
    </div>
  )
}
