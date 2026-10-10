import { useEffect, useRef } from 'react'

import { drawFrame, getSheet } from './pet/sheet'
import type { OrbState } from './orb'

// Clawd, the pixel pet from glowup (MIT, github.com/NovusEdge/glowup), drawn
// from its own .art sprite sheet (parsed in pet/sheet.ts).
export type ClawdMood = 'idle' | 'working' | 'juggle' | 'walk' | 'alert' | 'done' | 'sleep' | 'hop' | 'fail' | 'pant'
export const moodOf = (s: OrbState): ClawdMood =>
  s === 'waiting' ? 'alert' : s === 'tool' ? 'working' : s === 'searching' ? 'walk' : s === 'writing' ? 'juggle' : s === 'thinking' ? 'pant' : 'idle'

export function Clawd({ mood = 'idle', size = 48, className }: { mood?: ClawdMood; size?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const { anims } = getSheet()
    const anim = anims[mood] ?? anims.idle
    if (!anim?.frames.length) return
    const ctx = canvas.getContext('2d')!
    let i = 0
    let timer: ReturnType<typeof setTimeout>
    const draw = () => {
      const fr = anim.frames[i]
      drawFrame(ctx, fr)
      const next = i + 1
      if (next < anim.frames.length || anim.loop) {
        timer = setTimeout(() => { i = next % anim.frames.length; draw() }, fr.ms)
      }
    }
    draw()
    return () => clearTimeout(timer)
  }, [mood])
  return (
    <canvas ref={ref} width={24} height={12} className={className} aria-label="Clawd"
      style={{ width: size, height: size / 2, imageRendering: 'pixelated' }} />
  )
}
