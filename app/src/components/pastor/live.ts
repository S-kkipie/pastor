import { BellRingIcon, HourglassIcon, MoonIcon, SparkleIcon } from 'lucide-react'

import type { SessionSummary } from '@/lib/types'

import type { PetMood } from './pet/walker'

// What a live session is doing, at a glance: working, waiting for you, only
// waiting on its own background work (subagents, shells, workflows), or done.
export type Live = 'needs' | 'working' | 'background' | 'resting'
export const liveOf = (s: SessionSummary): Live =>
  s.pending > 0 || s.status === 'waiting' ? 'needs'
    : s.status === 'busy' ? 'working'
      : (s.agents || s.tasks || s.workflows) ? 'background' : 'resting'
export const LIVE: Record<Live, { label: string; icon: typeof SparkleIcon; rail: string; chip: string }> = {
  needs: { label: 'Te necesita', icon: BellRingIcon, rail: 'bg-warn', chip: 'bg-warn/15 text-warn' },
  working: { label: 'Trabajando', icon: SparkleIcon, rail: 'bg-coral', chip: 'bg-coral/15 text-coral' },
  background: { label: 'Esperando', icon: HourglassIcon, rail: 'bg-sky-400', chip: 'bg-sky-400/15 text-sky-300' },
  resting: { label: 'En reposo', icon: MoonIcon, rail: 'bg-white/15', chip: 'bg-white/[0.06] text-muted-foreground' },
}
// What the session's own pet does meanwhile.
export const PET_MOOD: Record<Live, PetMood> = { needs: 'alert', working: 'working', background: 'juggle', resting: 'sleep' }
const plural =(n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
export const backgroundOf = (s: SessionSummary) => [
  s.agents ? plural(s.agents, 'subagente', 'subagentes') : '',
  s.tasks ? plural(s.tasks, 'shell', 'shells') : '',
  s.workflows ? plural(s.workflows, 'workflow', 'workflows') : '',
].filter(Boolean).join(' · ')
