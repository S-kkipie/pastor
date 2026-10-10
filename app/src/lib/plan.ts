import type { PastorEvent } from './types'

export type PlanTask = { id: string; content: string; active?: string; status: 'pending' | 'in_progress' | 'completed' }

export const PLAN_TOOLS = new Set(['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet'])

// The session's plan as it stands: the latest TodoWrite list, or the tasks
// TaskCreate made with every TaskUpdate applied, in order.
export function planOf(events: PastorEvent[]): { tasks: PlanTask[]; lastSeq: number } | null {
  const main = events.filter(e => !e.agent && e.kind === 'tool' && PLAN_TOOLS.has(e.tool ?? ''))
  if (!main.length) return null
  const tasks = new Map<string, PlanTask>()
  let lastSeq = 0
  let fromTodo: PlanTask[] | null = null
  for (const e of main) {
    const d = e.detail ?? {}
    if (e.tool === 'TodoWrite') {
      fromTodo = (d.todos ?? []).map((t: { content: string; status: PlanTask['status'] }, i: number) =>
        ({ id: String(i), content: t.content, status: t.status }))
      lastSeq = e.seq
    } else if (e.tool === 'TaskCreate') {
      let id = String(tasks.size + 1)
      try { id = String(JSON.parse(e.end?.out ?? '{}').task?.id ?? id) } catch { /* not JSON yet */ }
      tasks.set(id, { id, content: d.subject ?? e.text, active: d.activeForm, status: 'pending' })
      lastSeq = e.seq
    } else if (e.tool === 'TaskUpdate') {
      const t = tasks.get(String(d.taskId))
      if (t) {
        if (d.status === 'deleted') tasks.delete(t.id)
        else Object.assign(t, d.status ? { status: d.status } : {}, d.subject ? { content: d.subject } : {}, d.activeForm ? { active: d.activeForm } : {})
      }
      lastSeq = e.seq
    }
  }
  const list = tasks.size ? [...tasks.values()] : fromTodo
  return list?.length ? { tasks: list, lastSeq } : null
}

export const stripMd = (s: string): string =>
  s.replace(/```[\s\S]*?```/g, ' ').replace(/[*_`#>]+/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\s+/g, ' ').trim()
