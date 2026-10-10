import { useEffect, useState } from 'react'

import { store } from '@/lib/api'

// This phone's pet: which one, Clawd's hat, and how lively they all are.
// "alive" walks and does things alone, "calm" only reacts, "still" draws one
// frame. The system's reduced-motion setting always means "still".
export type PetKind = 'clawd' | 'crab' | 'duck' | 'zappy' | 'rocky'
export type PetHat = '' | 'party' | 'santa' | 'nightcap' | 'pumpkin'
export type PetLevel = 'alive' | 'calm' | 'still'
export type PetPrefs = { kind: PetKind; hat: PetHat; level: PetLevel; chosenLevel: PetLevel; reduced: boolean }

export const PET_KINDS: [PetKind, string][] = [['clawd', 'Clawd'], ['crab', 'Ferris'], ['duck', 'Patito'], ['zappy', 'Zappy'], ['rocky', 'Rocky']]
export const PET_HATS: [PetHat, string][] = [['', 'Sin gorro'], ['party', '🎉 Fiesta'], ['santa', '🎅 Navidad'], ['nightcap', '🌙 Dormir'], ['pumpkin', '🎃 Calabaza']]
export const PET_LEVELS: [PetLevel, string][] = [['still', 'Quietas'], ['calm', 'Tranquilas'], ['alive', 'Con vida']]

const EVENT = 'pastor:pet'
const reducedQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null

export function petPrefs(): PetPrefs {
  const chosenLevel = store.get<PetLevel>('pet.level', 'alive')
  const reduced = !!reducedQuery?.matches
  return {
    kind: store.get<PetKind>('pet.kind', 'clawd'),
    hat: store.get<PetHat>('pet.hat', ''),
    chosenLevel, reduced, level: reduced ? 'still' : chosenLevel,
  }
}

export function setPetPref<K extends 'kind' | 'hat' | 'level'>(k: K, v: PetPrefs[K]) {
  store.set(`pet.${k}`, v)
  window.dispatchEvent(new Event(EVENT))
}

// Every walker on screen follows a change at once.
export function onPetPrefs(fn: (p: PetPrefs) => void): () => void {
  const on = () => fn(petPrefs())
  window.addEventListener(EVENT, on)
  reducedQuery?.addEventListener('change', on)
  return () => { window.removeEventListener(EVENT, on); reducedQuery?.removeEventListener('change', on) }
}

export function usePetPrefs(): PetPrefs {
  const [p, setP] = useState(petPrefs)
  useEffect(() => onPetPrefs(setP), [])
  return p
}
