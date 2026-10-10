import { createContext, useContext } from 'react'

// What deep parts of a session screen need from it: where its files live (a
// Read of an image previews from that PC) and how to open a subagent.
import type { AgentRow } from './types'

export type SessionCtx = { sid: string; machine: string; cwd: string; openAgent: (toolUseId: string) => void; agents: AgentRow[] }
export const SessionContext = createContext<SessionCtx | null>(null)
export const useSessionCtx = () => useContext(SessionContext)
