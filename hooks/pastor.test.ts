import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

// A fake bridge beneath the plugin: process.run answers `bridge.mjs ensure`,
// http.fetch answers the /mod/* routes the way bridge/bridge.mjs does.
function fakeBridge(on: On) {
  const bridge = { away: false, inbox: [] as unknown[], pending: [] as any[], events: [] as any[], posts: {} as Record<string, any> }
  const json = (body: unknown) => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } })

  on('process.run', ($, e) => {
    const out = e.argv[0] === 'tailscale'
      ? { Self: { DNSName: 'pc.tail1234.ts.net.' }, CertDomains: ['pc.tail1234.ts.net'] }
      : { ok: true, port: 7878, secret: 's3cret', pairCode: '123456', devices: 1, publicUrl: '' }
    return { value: { exitCode: 0, stdout: JSON.stringify(out), stderr: '' } } as never
  })
  on('http.fetch', ($, e) => {
    const url = new URL(e.url)
    const body = e.init?.body ? JSON.parse(e.init.body) : {}
    bridge.posts[url.pathname] = body
    switch (url.pathname) {
      case '/mod/register': return json({ ok: true, away: bridge.away, pairCode: '123456' }) as never
      case '/mod/poll': return json({ inbox: bridge.inbox.splice(0), away: bridge.away }) as never
      case '/mod/away': bridge.away = body.away; return json({ ok: true }) as never
      case '/mod/pending': bridge.pending.push(body.item); return json({ ok: true }) as never
      case '/mod/event': bridge.events.push(body); return json({ ok: true }) as never
      case '/mod/peer-send': return json(body.to === 'pastor:laptop/7f3a2c1e' ? { ok: true } : { ok: false, reason: 'la sesión ya no está; vivas en esta PC: ninguna' }) as never
      case '/mod/network': return json({ text: 'Otras PCs (pastor) — escríbeles con SendMessage usando la dirección:\n- pastor:laptop/7f3a2c1e · "pastor-app" · laptop · quieta' }) as never
      default: return json({ ok: true }) as never
    }
  })
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.cwd', () => ({ value: 'C:/proj' }))
  on('session.start', ($, e) => ({ cwd: e.cwd }) as never)
  on('session.end', () => ({}) as never)
  on('command.register', () => ({ value: undefined }) as never)
  for (const ui of ['ui.log', 'ui.toast', 'ui.status'] as const) on(ui, () => ({ value: undefined }) as never)
  return bridge
}

const runPastor = (args: string) =>
  ({ command: 'pastor', args, origin: { kind: 'composer' }, presentation: 'inline' }) as never

describe('pastor', () => {
  test('/pastor shows the pairing code and the tailnet URL', async ($, on) => {
    mock.clock(on)
    fakeBridge(on)
    await $.session.start({ cwd: 'C:/proj', surface: null, isInteractive: true })
    const shown = await $.command.run(runPastor(''))
    expect(shown.text).toContain('123456')
    expect(shown.text).toContain('https://pc.tail1234.ts.net/')
  })

  test('at the desk, a permission ask stays in the terminal', async ($, on) => {
    mock.clock(on)
    const bridge = fakeBridge(on)
    on('tool.check', () => ({ decision: 'ask' }))
    await $.session.start({ cwd: 'C:/proj', surface: null, isInteractive: true })
    const verdict = await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf build' }, tool_use_id: 't1' } as never)
    expect(verdict.decision).toBe('ask')
    expect(bridge.pending.length).toBe(0)
  })

  test('away, the phone answers the permission ask', async ($, on) => {
    const clock = mock.clock(on)
    const bridge = fakeBridge(on)
    on('tool.check', () => ({ decision: 'ask' }))
    await $.session.start({ cwd: 'C:/proj', surface: null, isInteractive: true })
    await $.command.run(runPastor('away'))
    expect(bridge.away).toBe(true)

    const verdict = $.tool.check({ tool: 'Bash', input: { command: 'rm -rf build' }, tool_use_id: 't1' } as never)
    await clock.settle()
    expect(bridge.pending[0]?.summary).toBe('rm -rf build')

    bridge.inbox.push({ type: 'decide', id: bridge.pending[0].id, decision: 'allow' })
    await clock.advance(1000)
    expect((await verdict).decision).toBe('allow')
  })

  test('a prompt from the phone is submitted as the user', async ($, on) => {
    const clock = mock.clock(on)
    const bridge = fakeBridge(on)
    const submitted: string[] = []
    on('prompt.submit', ($, e) => { submitted.push(e.text); return { text: e.text } as never })
    await $.session.start({ cwd: 'C:/proj', surface: null, isInteractive: true })
    bridge.inbox.push({ type: 'prompt', text: 'corre los tests' })
    await clock.advance(1000)
    expect(submitted).toEqual(['corre los tests'])
  })

  test('a main turn with tools ends with a receipt after the idle event', async ($, on) => {
    const clock = mock.clock(on)
    const bridge = fakeBridge(on)
    let usd = 0.5
    on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 1000, window: 200000, percent: 1 }, rateLimits: [], cost: { usd } } }) as never)
    on('session.model', () => ({ value: 'opus' }) as never)
    on('turn.start', ($, e) => ({ turnId: e.turnId }) as never)
    on('tool.call', ($, e) => (e.tool === 'Bash' ? { result: { stdout: 'boom' }, isError: true } : { result: 'ok' }) as never)
    on('turn.complete', ($, e) => ({ text: e.answer }) as never)
    await $.session.start({ cwd: 'C:/proj', surface: null, isInteractive: true })
    await $.turn.start({ text: 'arregla el bug', turnId: 'T1' } as never)
    const toolCall = ($.tool as unknown as { call: (e: unknown) => Promise<unknown> }).call
    await toolCall({ tool: 'Edit', tool_use_id: 'a', file_path: 'x.ts', old_string: 'a', new_string: 'b' } as never)
    await toolCall({ tool: 'Bash', tool_use_id: 'b', command: 'npm test' } as never)
    usd = 0.75
    await $.turn.complete({ answer: 'listo', durationMs: 5000, isAborted: false, turnId: 'T1', reason: 'answer',
      usage: { input_tokens: 10, output_tokens: 321, model: 'opus' } } as never)
    await clock.settle()
    const kinds = bridge.events.map(b => b.kind ?? (b.final ? 'final' : b.status))
    const r = bridge.events.find(b => b.kind === 'receipt')
    expect(r?.receipt).toEqual({ durationMs: 5000, tools: 2, edits: 1, errors: 1, agents: 0, outputTokens: 321, costUsd: 0.25, aborted: false })
    expect(kinds.indexOf('receipt')).toBeGreaterThan(bridge.events.findIndex(b => b.final))
  })

  test('messages sent and received are recorded and pushed', async ($, on) => {
    const clock = mock.clock(on)
    const bridge = fakeBridge(on)
    on('agent.list', () => ({ value: [] }) as never)
    on('agent.spawn', () => ({ model: 'opus', agentId: 'ag-1' }) as never)
    on('session.send', () => ({ isDelivered: true }) as never)
    on('session.receive', ($, e) => ({ text: e.text }) as never)
    await $.session.start({ cwd: 'C:/proj', surface: null, isInteractive: true })
    await $.agent.spawn({ prompt: 'investiga', description: 'Investigador', name: 'scout' } as never)
    await $.session.send({ to: 'ag-1', text: 'revisa el bridge', origin: { kind: 'model' } } as never)
    await $.session.receive({ origin: { kind: 'peer', teammate: 'researcher', isVerified: true }, text: 'terminé' } as never)
    await $.session.receive({ origin: { kind: 'task-notification' }, text: '<task-notification><task-id>x</task-id><status>completed</status></task-notification>' } as never)
    await clock.advance(2000)
    const msgs = bridge.posts['/mod/messages']?.messages as any[]
    expect(msgs.length).toBe(2)
    expect(msgs[0]).toMatchObject({ dir: 'out', from: 'Claude', to: 'scout', toAgentId: 'ag-1', text: 'revisa el bridge' })
    expect(msgs[1]).toMatchObject({ dir: 'in', from: 'researcher', to: 'Claude', kind: 'peer', text: 'terminé' })
  })

  test('SendMessage a pastor: lo entrega el bridge, sin pasar al motor', async ($, on) => {
    mock.clock(on)
    const bridge = fakeBridge(on)
    let core = 0
    on('session.send', () => { core++; return { isDelivered: true } as never })
    await $.session.start({ cwd: 'C:/proj', surface: null, isInteractive: true })
    const ok = await $.session.send({ to: 'pastor:laptop/7f3a2c1e', text: 'corre los tests', origin: { kind: 'model' } } as never)
    expect(ok.isDelivered).toBe(true)
    expect(bridge.posts['/mod/peer-send']).toEqual({ session: 'sess-1', to: 'pastor:laptop/7f3a2c1e', text: 'corre los tests' })
    const no = await $.session.send({ to: 'pastor:laptop/deadbeef', text: 'x', origin: { kind: 'model' } } as never)
    expect(no.isDelivered).toBe(false)
    expect((no as any).reason).toContain('ya no está')
    expect(core).toBe(0)
  })

  test('ListAgents añade las otras PCs como context', async ($, on) => {
    mock.clock(on)
    fakeBridge(on)
    on('tool.call', () => ({ result: { agents: [] }, text: 'No agents', ref: 1 }) as never)
    await $.session.start({ cwd: 'C:/proj', surface: null, isInteractive: true })
    const r = await $.tool.call({ tool: 'ListAgents', input: {}, tool_use_id: 't9' } as never)
    expect((r as any).context.join('\n')).toContain('pastor:laptop/7f3a2c1e')
  })

  test('un mensaje de otra PC entra como turno con sobre, sin interrumpir', async ($, on) => {
    const clock = mock.clock(on)
    const bridge = fakeBridge(on)
    const submitted: any[] = []
    let aborted = 0
    on('prompt.submit', ($, e) => { submitted.push(e); return { text: e.text } as never })
    on('turn.abort', () => { aborted++; return { value: undefined } as never })
    await $.session.start({ cwd: 'C:/proj', surface: null, isInteractive: true })
    bridge.inbox.push({ type: 'peer', from: 'pastor:vps/91bd0e44', fromTitle: 'Agente · WhatsApp', machine: 'vps', text: 'corre los tests' })
    await clock.advance(1100)
    const text = submitted.map(s => s.text).join('\n')
    expect(text).toContain('<pastor-message from="pastor:vps/91bd0e44" pc="vps" session="Agente · WhatsApp">')
    expect(text).toContain('corre los tests')
    expect(text).toContain('SendMessage con to: "pastor:vps/91bd0e44"')
    expect(aborted).toBe(0)
  })

  test('a background workflow run is tracked from its call to its notification', async ($, on) => {
    const clock = mock.clock(on)
    const bridge = fakeBridge(on)
    on('agent.list', () => ({ value: [] }) as never)
    on('agent.spawn', () => ({ model: 'opus', agentId: 'wa-1' }) as never)
    on('session.receive', ($, e) => ({ text: e.text }) as never)
    on('tool.call', () => ({ result: { status: 'async_launched', taskId: 'wt1', runId: 'wf_abc-123', workflowName: 'fix-all', summary: 'Fix it' } }) as never)
    await $.session.start({ cwd: 'C:/proj', surface: null, isInteractive: true })
    const script = `export const meta = {
  name: 'fix-all',
  description: 'Fix everything',
  phases: [{ title: 'Implement' }, { title: 'Verify' }],
}
export default async () => {}`
    await ($.tool as any).call({ tool: 'Workflow', tool_use_id: 'tw', script })
    await $.agent.spawn({ prompt: 'p', description: 'Impl', workflow: { runId: 'wf_abc-123', agentIndex: 1 } } as never)
    await clock.advance(2000)
    expect(bridge.posts['/mod/workflows']?.runs?.[0]).toMatchObject({ runId: 'wf_abc-123', name: 'fix-all', description: 'Fix everything', phases: ['Implement', 'Verify'], status: 'running', toolUseId: 'tw', agents: 1 })
    await $.session.receive({ origin: { kind: 'task-notification' }, text: `<task-notification>
<task-id>wt1</task-id>
<status>completed</status>
<summary>done</summary>
<result>all good</result>
</task-notification>` } as never)
    await clock.advance(2000)
    const run = bridge.posts['/mod/workflows']?.runs?.[0]
    expect(run).toMatchObject({ status: 'completed', result: 'all good' })
    expect(bridge.posts['/mod/agents']?.agents?.find((a: any) => a.id === 'wa-1')).toMatchObject({ workflowRunId: 'wf_abc-123', workflowIndex: 1, status: 'completed' })
    expect(run.taskId).toBeUndefined()
  })
})
