import { useEffect, useRef } from 'react'

import { isNative } from './api'

// The phone's back button closes what is on top (an image, a viewer, a sheet,
// an agent's detail) before it leaves a session, and never quits the app from
// the dashboard. Every open overlay registers here, newest last.
//
// Native (Capacitor): the App plugin's backButton pops the stack.
// Browser / PWA: each overlay pushes a history entry; going back pops it.
type Entry = { id: number; close: () => void }
const stack: Entry[] = []
let nextId = 1
let skipPop = 0

export function useBackClose(open: boolean, close: () => void) {
  const closeRef = useRef(close)
  closeRef.current = close
  useEffect(() => {
    if (!open) return
    const id = nextId++
    stack.push({ id, close: () => closeRef.current() })
    if (!isNative()) history.pushState({ ...(history.state ?? {}), overlay: id }, '')
    return () => {
      const i = stack.findIndex(e => e.id === id)
      if (i >= 0) stack.splice(i, 1)
      // Closed from the UI (not by going back): drop its history entry quietly.
      if (!isNative() && history.state?.overlay === id) { skipPop++; history.back() }
    }
  }, [open])
}

// Browser back: the entry that was popped belonged to the top overlay, close it.
// Returns true when the pop was an overlay's (the app's own handler ignores it).
export function onPopOverlay(): boolean {
  if (skipPop > 0) { skipPop--; return true }
  const top = stack[stack.length - 1]
  if (top && history.state?.overlay !== top.id) { top.close(); return true }
  return false
}

// Native back: close the top overlay; else the caller goes back a screen.
export function closeTopOverlay(): boolean {
  const top = stack[stack.length - 1]
  if (!top) return false
  top.close()
  return true
}
