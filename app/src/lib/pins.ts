import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent, PointerEvent } from 'react'

import { store } from './api'

// Pinned sessions (ids, as the dashboard names them) and projects ("machine:path"),
// kept on the phone. Every usePins() of a kind stays in step through one event.
export type PinKind = 'sessions' | 'projects'
const EV = 'pastor:pins'

export const projectPin = (machine: string, path: string) => `${machine}:${path}`

export function usePins(kind: PinKind) {
  const key = `pins.${kind}`
  const [list, setList] = useState<string[]>(() => store.get<string[]>(key, []))
  useEffect(() => {
    const sync = () => setList(store.get<string[]>(key, []))
    window.addEventListener(EV, sync)
    window.addEventListener('storage', sync)
    return () => { window.removeEventListener(EV, sync); window.removeEventListener('storage', sync) }
  }, [key])
  const set = useMemo(() => new Set(list), [list])
  const has = useCallback((id: string) => set.has(id), [set])
  // Returns true when the item is now pinned.
  const toggle = useCallback((id: string) => {
    const cur = store.get<string[]>(key, [])
    const on = !cur.includes(id)
    store.set(key, on ? [id, ...cur] : cur.filter(x => x !== id))
    window.dispatchEvent(new Event(EV))
    return on
  }, [key])
  return { pins: list, has, toggle }
}

// Long-press (450ms, a short buzz) runs onLong; a plain tap runs onTap. A press
// that turned into a long-press or a scroll never fires the tap.
export function useLongPress(onLong: () => void, onTap?: () => void, ms = 450) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const fired = useRef(false)
  const origin = useRef<{ x: number; y: number } | null>(null)
  const longRef = useRef(onLong)
  const tapRef = useRef(onTap)
  useLayoutEffect(() => { longRef.current = onLong; tapRef.current = onTap })
  useEffect(() => () => clearTimeout(timer.current), [])
  const cancel = () => { clearTimeout(timer.current); origin.current = null }
  return {
    onPointerDown: (e: PointerEvent) => {
      if (e.button !== 0) return
      fired.current = false
      origin.current = { x: e.clientX, y: e.clientY }
      clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        fired.current = true
        origin.current = null
        try { navigator.vibrate?.(15) } catch { /* unsupported */ }
        longRef.current()
      }, ms)
    },
    onPointerMove: (e: PointerEvent) => {
      const o = origin.current
      if (o && Math.hypot(e.clientX - o.x, e.clientY - o.y) > 10) cancel()
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onContextMenu: (e: MouseEvent) => e.preventDefault(),
    onClick: (e: MouseEvent) => {
      if (fired.current) { e.preventDefault(); e.stopPropagation(); fired.current = false; return }
      tapRef.current?.()
    },
  }
}

// A hand-made order for a list (dragged on the phone), kept on the phone. Ids
// it has not seen go last, once, and then stay where they are, so nothing jumps
// around when its activity changes.
export function useOrder(key: string, ids: string[]) {
  const k = `order.${key}`
  const [order, setOrder] = useState<string[]>(() => store.get<string[]>(k, []))
  const sig = ids.join('\n')
  const merged = useMemo(() => {
    const known = new Set(order)
    return [...order, ...ids.filter(id => !known.has(id))]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, sig])
  useEffect(() => {
    if (merged.length !== order.length) { setOrder(merged); store.set(k, merged.slice(0, 600)) }
  }, [merged, order.length, k])
  const rank = useMemo(() => new Map(merged.map((id, i) => [id, i])), [merged])
  const sort = useCallback(<T,>(list: T[], id: (x: T) => string) =>
    [...list].sort((a, b) => (rank.get(id(a)) ?? -1) - (rank.get(id(b)) ?? -1)), [rank])
  // A dragged subset in its new order takes the same slots in the whole order.
  const move = useCallback((subset: string[]) => {
    const inSub = new Set(subset)
    let i = 0
    const next = merged.map(id => (inSub.has(id) ? subset[i++] : id))
    setOrder(next)
    store.set(k, next.slice(0, 600))
  }, [merged, k])
  return { sort, move }
}
