import { useEffect, useRef } from 'react'
import { MODE_FRAMES, resolvePreset } from 'thinking-orbs/engine'

import { cn } from '@/lib/utils'

// thinking-orbs' engine (MIT, Jakub Antalik) drawn in Claude coral: the
// engine gives each frame's dots with a depth (`white`), this paints them.

export type OrbState = 'idle' | 'thinking' | 'writing' | 'tool' | 'waiting' | 'searching'

const STATES: Record<OrbState, { preset: string; speed: number; opacity: number }> = {
  idle: { preset: 'breathing', speed: 0.25, opacity: 0.45 },
  thinking: { preset: 'breathing', speed: 1, opacity: 1 },
  writing: { preset: 'composing', speed: 1.25, opacity: 1 },
  tool: { preset: 'working', speed: 1.5, opacity: 1 },
  searching: { preset: 'searching', speed: 1.3, opacity: 1 },
  waiting: { preset: 'listening', speed: 0.7, opacity: 1 },
}
const CORAL = [217, 119, 87]
const PEACH = [255, 214, 196]
const AMBER = [224, 176, 79]

type Frame = { dots: { x: number; y: number; r: number; white: number; a?: number }[]; lines: { x1: number; y1: number; x2: number; y2: number; w: number; a?: number }[] }
type Preset = { mode: string; speed: number; opts: unknown }
const frames = MODE_FRAMES as unknown as Record<string, (size: number, t: number, opts: unknown) => Frame>
const preset = resolvePreset as unknown as (state: string, size: number) => Preset

export function Orb({ state = 'idle', size = 44, className }: { state?: OrbState; size?: number; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const engine = useRef<{ set: (s: OrbState) => void; stop: () => void } | null>(null)

  useEffect(() => {
    const cv = canvas.current
    if (!cv) return
    const base = size > 32 ? 64 : 20
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const ctx = cv.getContext('2d')
    if (!ctx) return
    cv.width = cv.height = Math.round(size * dpr)
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    let cur = preset('breathing', base)
    let tint = CORAL
    let speed = 0, target = 0, t = 0.6, last = 0, raf = 0, fade = 1, visible = true

    const draw = () => {
      const k = (size / base) * dpr
      ctx.setTransform(k, 0, 0, k, 0, 0)
      ctx.clearRect(0, 0, base, base)
      const { dots, lines } = frames[cur.mode]!(base, t, cur.opts)
      for (const l of lines) {
        ctx.strokeStyle = `rgba(${tint},${(l.a ?? 1) * fade})`
        ctx.lineWidth = l.w
        ctx.beginPath(); ctx.moveTo(l.x1, l.y1); ctx.lineTo(l.x2, l.y2); ctx.stroke()
      }
      for (const d of dots) {
        const near = 1 - Math.min(1, Math.max(0, d.white))
        const c = tint.map((v, i) => Math.round(v + (PEACH[i]! - v) * near * 0.6))
        ctx.fillStyle = `rgba(${c},${(d.a ?? 1) * (0.35 + 0.65 * near) * fade})`
        ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2); ctx.fill()
      }
    }
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000); last = now
      speed += (target - speed) * Math.min(1, dt * 4)
      fade = Math.min(1, fade + dt * 3)
      t += dt * speed * cur.speed * 0.5
      draw()
      raf = !document.hidden && visible && cv.isConnected ? requestAnimationFrame(loop) : 0
    }
    const kick = () => { if (!raf && !reduce && visible) { last = performance.now(); raf = requestAnimationFrame(loop) } }
    const onVis = () => { if (!document.hidden) kick() }
    document.addEventListener('visibilitychange', onVis)
    const io = new IntersectionObserver(([entry]) => { visible = !!entry?.isIntersecting; if (visible) kick() })
    io.observe(cv)

    engine.current = {
      set(s) {
        const st = STATES[s]
        const next = preset(st.preset, base)
        if (next.mode !== cur.mode) { cur = next; fade = 0 }
        tint = s === 'waiting' ? AMBER : CORAL
        target = st.speed
        cv.style.opacity = String(st.opacity)
        if (reduce) draw(); else kick()
      },
      stop() { cancelAnimationFrame(raf); raf = 0 },
    }
    engine.current.set(state)
    return () => { engine.current?.stop(); io.disconnect(); document.removeEventListener('visibilitychange', onVis) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size])

  useEffect(() => { engine.current?.set(state) }, [state])

  return (
    <canvas
      ref={canvas}
      aria-hidden
      className={cn('shrink-0 transition-opacity duration-500', className)}
      style={{ width: size, height: size }}
    />
  )
}
