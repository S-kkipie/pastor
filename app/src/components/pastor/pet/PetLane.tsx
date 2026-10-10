import { createContext, useContext, useEffect, useRef, type CSSProperties } from 'react'

import { cn } from '@/lib/utils'

import { onPetPrefs, petPrefs, type PetHat } from './settings'
import { Walker, type PetMood } from './walker'

export type { PetMood } from './walker'

// True under a full-screen overlay: every lane inside rests.
export const PetsCovered = createContext(false)

// A strip where one pet lives. The strip itself lets every touch through;
// only the pet takes them. The pet rests (no timers) while off screen.
export function PetLane({ mood, group, scale = 1.6, hat, className, style, onReady, paused: pausedProp = false }: {
  mood: PetMood; group?: string; scale?: number; hat?: PetHat; className?: string; style?: CSSProperties
  // Covered by something the observer cannot see (a full-screen overlay): rest.
  paused?: boolean
  onReady?: (w: Walker | null) => void
}) {
  const paused = useContext(PetsCovered) || pausedProp
  const ref = useRef<HTMLDivElement>(null)
  const walker = useRef<Walker | null>(null)
  const props = useRef({ mood, hat, onReady, paused })
  props.current = { mood, hat, onReady, paused }

  useEffect(() => {
    const lane = ref.current
    if (!lane) return
    const p = petPrefs()
    const w = new Walker(lane, { mood: props.current.mood, group: group ?? null, scale, kind: p.kind, hat: props.current.hat ?? p.hat, level: p.level })
    walker.current = w
    if (props.current.paused) w.pause('cover')
    props.current.onReady?.(w)
    const off = onPetPrefs(next => {
      w.setLevel(next.level)
      if (next.kind !== w.kind) w.setKind(next.kind)
      w.setHat(props.current.hat ?? next.hat)
    })
    const io = new IntersectionObserver(entries => {
      const e = entries[entries.length - 1]
      if (e?.isIntersecting) w.resume('view'); else w.pause('view')
    })
    io.observe(lane)
    return () => {
      off(); io.disconnect(); w.destroy()
      walker.current = null
      props.current.onReady?.(null)
    }
  }, [group, scale])

  useEffect(() => { walker.current?.setMood(mood) }, [mood])
  useEffect(() => { if (paused) walker.current?.pause('cover'); else walker.current?.resume('cover') }, [paused])
  useEffect(() => { walker.current?.setHat(hat ?? petPrefs().hat) }, [hat])

  return <div ref={ref} aria-hidden className={cn('pet-lane', className)} style={style} />
}
