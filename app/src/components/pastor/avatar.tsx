import { useEffect, useState } from 'react'

import { store } from '@/lib/api'

import { Clawd, type ClawdMood, moodOf } from './clawd'
import { Orb, type OrbState } from './orb'

// Who stands for Claude: the thinking orb or Clawd. The choice is the
// phone's own, flipped by tapping the avatar on the dashboard.
export type AvatarKind = 'clawd' | 'orb'
const EVENT = 'pastor:avatar'

export function useAvatarKind(): [AvatarKind, (k: AvatarKind) => void] {
  const [kind, setKind] = useState<AvatarKind>(() => store.get('avatar', 'clawd'))
  useEffect(() => {
    const on = () => setKind(store.get('avatar', 'clawd'))
    window.addEventListener(EVENT, on)
    return () => window.removeEventListener(EVENT, on)
  }, [])
  return [kind, k => { store.set('avatar', k); window.dispatchEvent(new Event(EVENT)) }]
}

export function Avatar({ state, size, asleep, mood }: { state: OrbState; size: number; asleep?: boolean; mood?: ClawdMood }) {
  const [kind] = useAvatarKind()
  if (kind === 'orb') return <Orb state={state} size={size} />
  return (
    <span className="grid place-items-center" style={{ width: size, height: size }}>
      <Clawd mood={mood ?? (asleep ? 'sleep' : moodOf(state))} size={size * 1.15} />
    </span>
  )
}
