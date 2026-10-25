// The agent's hands on the whole hub: one tool per thing it may do, each a
// thin call to the hub's API (or to pastor-agent's local API for WhatsApp).
import { normalizePhone } from '../src/config.mjs'

const S = (props, required = []) => ({ type: 'object', properties: props, required })
const str = d => ({ type: 'string', description: d })
const MACHINE = str('Nombre de la PC (como sale en hub_overview). Vacío = el hub')

export const TOOLS = [
  { name: 'hub_overview', description: 'PCs, sesiones vivas con su estado y pendientes, en todas las PCs.', inputSchema: S({}) },
  { name: 'projects_list', description: 'Proyectos (carpetas) de una PC con sus sesiones recientes.', inputSchema: S({ machine: MACHINE }) },
  { name: 'sessions_list', description: 'Sesiones de todas las PCs. online=false incluye cerradas.', inputSchema: S({ machine: MACHINE, online: { type: 'boolean' }, query: str('filtra por título o carpeta') }) },
  { name: 'session_read', description: 'Últimos pasos de una sesión y sus pendientes (permisos/preguntas con su id).', inputSchema: S({ id: str('id de sesión tal como lo da sessions_list'), last: { type: 'number' } }, ['id']) },
  { name: 'session_prompt', description: 'Mandar un mensaje a una sesión. mode: queue (por defecto), now o interrupt.', inputSchema: S({ id: str('id'), text: str('mensaje'), mode: { type: 'string', enum: ['queue', 'now', 'interrupt'] } }, ['id', 'text']) },
  { name: 'session_launch', description: 'Abrir una sesión de Claude Code en una PC y carpeta, opcionalmente con un primer prompt.', inputSchema: S({ machine: MACHINE, cwd: str('carpeta absoluta'), prompt: str('primer mensaje'), permissionMode: { type: 'string', enum: ['default', 'acceptEdits', 'bypassPermissions', 'plan'] } }, ['cwd']) },
  { name: 'session_decide', description: 'Aprobar/denegar un permiso o contestar una pregunta pendiente de una sesión. answers: {pregunta: respuesta}.', inputSchema: S({ id: str('id de sesión'), pendingId: str('id del pendiente'), decision: { type: 'string', enum: ['allow', 'deny'] }, answers: { type: 'object' } }, ['id', 'pendingId', 'decision']) },
  { name: 'session_stop', description: 'Interrumpir lo que hace una sesión.', inputSchema: S({ id: str('id') }, ['id']) },
  { name: 'session_close', description: 'Cerrar una sesión.', inputSchema: S({ id: str('id') }, ['id']) },
  { name: 'routines_list', description: 'Rutinas programadas de una PC con sus últimas ejecuciones.', inputSchema: S({ machine: MACHINE }) },
  { name: 'routine_save', description: 'Crear o editar una rutina. routine = {id?, name, cwd, prompt, schedule:{kind:"daily",time:"HH:MM",days:[0-6],tz:300}|{kind:"interval",minutes}|{kind:"once",at:epochMs}, permissionMode, closeWhenDone, enabled}', inputSchema: S({ machine: MACHINE, routine: { type: 'object' } }, ['routine']) },
  { name: 'routine_run', description: 'Ejecutar una rutina ahora.', inputSchema: S({ machine: MACHINE, id: str('id') }, ['id']) },
  { name: 'routine_toggle', description: 'Activar o pausar una rutina.', inputSchema: S({ machine: MACHINE, id: str('id'), enabled: { type: 'boolean' } }, ['id', 'enabled']) },
  { name: 'routine_delete', description: 'Borrar una rutina.', inputSchema: S({ machine: MACHINE, id: str('id') }, ['id']) },
  { name: 'git_status', description: 'Estado git de una carpeta (rama, cambios, commits).', inputSchema: S({ machine: MACHINE, path: str('carpeta') }, ['path']) },
  { name: 'files_read', description: 'Leer un archivo de texto de una PC.', inputSchema: S({ machine: MACHINE, path: str('ruta absoluta') }, ['path']) },
  { name: 'terminal_run', description: 'Correr un comando en una PC y esperar su salida (hasta waitSeconds).', inputSchema: S({ machine: MACHINE, cwd: str('carpeta'), cmd: str('comando'), waitSeconds: { type: 'number' } }, ['cwd', 'cmd']) },
  { name: 'browser_look', description: 'Captura del navegador (agent-browser o Playwright) que usa una sesión.', inputSchema: S({ session: str('id de sesión') }, ['session']) },
  { name: 'previews_list', description: 'Servidores web de desarrollo corriendo en una PC.', inputSchema: S({ machine: MACHINE }) },
  { name: 'whatsapp_send_me', description: 'Mandarle a tu dueño un mensaje o archivo por WhatsApp (a este canal, o al primer número si es la app).', inputSchema: S({ text: str('texto'), file: str('ruta de un archivo en el VPS') }) },
  { name: 'whatsapp_send', description: 'Escribir por WhatsApp a cualquier número desde el número del bot.', inputSchema: S({ to: str('número con código de país'), text: str('texto'), file: str('ruta de un archivo en el VPS') }, ['to']) },
  { name: 'monitor_add', description: 'Vigilar una sesión: cuando termine su turno recibes un aviso. Es opt-in, solo las sesiones que agregues; el resto no avisa por aquí (de eso ya se encarga la app con sus notificaciones).', inputSchema: S({ id: str('id de sesión tal como lo da sessions_list'), note: str('para qué la vigilas (opcional)') }, ['id']) },
  { name: 'monitor_remove', description: 'Dejar de vigilar una sesión.', inputSchema: S({ id: str('id de sesión') }, ['id']) },
  { name: 'monitors_list', description: 'Sesiones que estás vigilando para avisos de fin de turno.', inputSchema: S({}) },
]

const text = t => [{ type: 'text', text: String(t) }]
const need = (v, name) => { if (v === undefined || v === null || v === '') throw new Error(`Falta ${name}`); return v }
const machineOf = id => (String(id).includes('~') ? String(id).split('~')[0] : undefined)
const localId = id => String(id).split('~').pop()
const AGENT_DIR = /[\\/]pastor-agent[\\/]canales[\\/]/
const ansi = s => String(s).replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')
const line = s => `• ${s.title} — ${s.machine} · ${s.status}${s.pending ? ` · ${s.pending} pendiente${s.pending > 1 ? 's' : ''}` : ''}${s.activity ? ` · ${s.activity.tool}: ${s.activity.text}` : ''}  [id ${s.id}]`

export function makeHandlers({ hub, local, channel, owner }) {
  const act = (kind, t) => local.activity({ at: Date.now(), kind, text: t }).catch?.(() => {})
  const me = channel?.startsWith('wa-') ? channel.slice(3) : owner[0]
  return {
    async hub_overview() {
      const { sessions, machines } = await hub.sessions()
      const live = sessions.filter(s => s.online && !s.agent && !AGENT_DIR.test(s.cwd ?? ''))
      const pcs = machines.map(m => `${m.name}: ${m.online ? 'en línea' : 'desconectada'}`).join(' · ')
      return text(`PCs: ${pcs}\n\n${live.length ? live.map(line).join('\n') : 'No hay sesiones vivas.'}`)
    },
    async projects_list({ machine }) {
      const r = await hub.get('/api/projects', { machine })
      return text((r.projects ?? []).slice(0, 40).map(p => `• ${p.path}${p.running ? ` (${p.running} viva${p.running > 1 ? 's' : ''})` : ''}`).join('\n') || 'Sin proyectos.')
    },
    async sessions_list({ machine, online = true, query }) {
      const { sessions } = await hub.sessions()
      const q = String(query ?? '').toLowerCase()
      const list = sessions.filter(s => (!online || s.online) && (!machine || s.machine === machine) && !AGENT_DIR.test(s.cwd ?? '')
        && (!q || `${s.title} ${s.cwd}`.toLowerCase().includes(q)))
      return text(list.length ? list.map(line).join('\n') : 'Ninguna.')
    },
    async session_read({ id, last = 15 }) {
      const d = await hub.session(need(id, 'id'), { limit: 200 })
      const steps = (d.events ?? []).filter(e => !e.agent && ['user', 'assistant', 'tool'].includes(e.kind)).slice(-Math.min(60, last))
        .map(e => e.kind === 'tool' ? `  ⚙ ${e.tool}: ${String(e.text).slice(0, 160)}${e.end ? (e.end.ok ? ' ✓' : ' ✗') : ' …'}` : `${e.kind === 'user' ? '› ' : ''}${String(e.text).slice(0, 1200)}`)
      const pend = (d.pending ?? []).map(p => p.kind === 'permission' ? `PENDIENTE ${p.id}: permiso para ${p.tool} — ${p.summary ?? ''}` : `PENDIENTE ${p.id}: preguntas — ${(p.questions ?? []).map(q => `${q.question} [${q.options.map(o => o.label).join(' / ')}]`).join(' | ')}`)
      return text(`${d.session?.title ?? id} · ${d.session?.status ?? ''}\n${steps.join('\n')}${pend.length ? `\n\n${pend.join('\n')}` : ''}`)
    },
    async session_prompt({ id, text: t, mode = 'queue' }) {
      await hub.prompt(need(id, 'id'), need(t, 'text'), mode)
      await act('prompt', `A ${id}: ${String(t).slice(0, 120)}`)
      return text('Enviado.')
    },
    async session_launch({ machine, cwd, prompt, permissionMode }) {
      const before = new Set((await hub.sessions()).sessions.map(s => s.id))
      await hub.launch({ machine, cwd: need(cwd, 'cwd'), mode: 'new', trust: true, away: true, ...(permissionMode ? { permissionMode } : {}) })
      await act('launch', `Abrió una sesión en ${machine ?? 'el hub'}: ${cwd}`)
      if (!prompt) return text('Sesión abriéndose.')
      for (let i = 0; i < 45; i++) {
        await new Promise(r => setTimeout(r, 2000))
        const s = (await hub.sessions()).sessions.find(x => x.online && !before.has(x.id) && (!machine || x.machine === machine))
        if (s) { await hub.prompt(s.id, prompt, 'queue'); return text(`Sesión ${s.id} abierta y con el prompt.`) }
      }
      return text('Se lanzó, pero no se conectó en 90 s; el prompt no se envió.')
    },
    async session_decide({ id, pendingId, decision, answers }) {
      await hub.decide(need(id, 'id'), need(pendingId, 'pendingId'), need(decision, 'decision'), answers)
      await act('decide', `${decision === 'allow' ? 'Aprobó' : 'Denegó'} ${pendingId} en ${id}`)
      return text('Hecho.')
    },
    async session_stop({ id }) { await hub.abort(need(id, 'id')); await act('stop', `Interrumpió ${id}`); return text('Interrumpida.') },
    async session_close({ id }) { await hub.close(need(id, 'id')); await act('close', `Cerró ${id}`); return text('Cerrándose.') },
    async routines_list({ machine }) {
      const r = await hub.get('/api/routines', { machine })
      return text((r.routines ?? []).map(x => `• ${x.name} [${x.id}] — ${x.enabled ? 'activa' : 'pausada'} · ${JSON.stringify(x.schedule)} · ${x.cwd}${x.runs?.[0] ? ` · última: ${x.runs[0].status}` : ''}`).join('\n') || 'Sin rutinas.')
    },
    async routine_save({ machine, routine }) { const r = await hub.post('/api/routines', { machine, op: 'save', id: routine?.id, routine: need(routine, 'routine') }); await act('routine', `Guardó la rutina ${routine.name ?? ''}`); return text(`Guardada: ${r.routine?.id ?? ''}`) },
    async routine_run({ machine, id }) { await hub.post('/api/routines', { machine, op: 'run', id: need(id, 'id') }); await act('routine', `Lanzó la rutina ${id}`); return text('En marcha.') },
    async routine_toggle({ machine, id, enabled }) { await hub.post('/api/routines', { machine, op: 'toggle', id: need(id, 'id'), enabled: !!enabled }); return text(enabled ? 'Activada.' : 'Pausada.') },
    async routine_delete({ machine, id }) { await hub.post('/api/routines', { machine, op: 'delete', id: need(id, 'id') }); await act('routine', `Borró la rutina ${id}`); return text('Borrada.') },
    async git_status({ machine, path }) {
      const r = await hub.get('/api/git', { machine, path: need(path, 'path') })
      if (!r.repo) return text('No es un repo git.')
      return text(`Rama ${r.branch} (${r.upstream || 'sin remoto'}) ↑${r.ahead ?? 0} ↓${r.behind ?? 0}\n${(r.files ?? []).map(f => `${f.untracked ? 'N' : f.x !== '.' ? f.x : f.y} ${f.path}`).join('\n') || 'Sin cambios.'}\n\n${(r.log ?? []).slice(0, 5).map(c => `${c.hash} ${c.subject}`).join('\n')}`)
    },
    async files_read({ machine, path }) {
      const r = await hub.get('/api/fs', { machine, op: 'read', path: need(path, 'path') })
      return text(r.kind === 'text' ? r.text.slice(0, 60_000) : `Archivo ${r.kind} (${r.size} bytes): no se muestra como texto.`)
    },
    async terminal_run({ machine, cwd, cmd, waitSeconds = 30 }) {
      const run = await hub.post('/api/term', { machine, op: 'run', cwd: need(cwd, 'cwd'), cmd: need(cmd, 'cmd') })
      await act('terminal', `${machine ?? 'hub'}: ${cmd}`)
      let out = run.chunk ?? '', next = run.next ?? out.length, r = run
      const until = Date.now() + Math.min(300, waitSeconds) * 1000
      while (r.running && Date.now() < until) {
        await new Promise(res => setTimeout(res, 1000))
        r = await hub.get('/api/term', { machine, id: run.id, from: next })
        out += r.chunk ?? ''; next = r.next ?? next
      }
      const tail = ansi(out).slice(-8000)
      return text(`${r.running ? '(sigue corriendo)' : `(salió con ${r.code})`}\n${tail}`)
    },
    async browser_look({ session }) {
      const machine = machineOf(need(session, 'session'))
      const r = await hub.get('/api/browser', { machine, session: localId(session) })
      const b = (r.browsers ?? [])[0]
      const page = b?.pages.find(p => !/^(about:|chrome:)/.test(p.url)) ?? b?.pages[0]
      if (!page) return text('Esa sesión no tiene un navegador abierto.')
      const shot = await hub.post('/api/browser', { machine, op: 'shot', port: b.port, pageId: page.id })
      return [{ type: 'image', data: shot.data, mimeType: 'image/jpeg' }, { type: 'text', text: `${page.title ?? ''} — ${page.url}` }]
    },
    async previews_list({ machine }) {
      const r = await hub.get('/api/preview', { machine })
      return text((r.servers ?? []).filter(s => s.dev).map(s => `• :${s.port} ${s.title || ''} (${s.process})${s.url ? ` → ${s.url}` : ''}`).join('\n') || 'Ninguno.')
    },
    async whatsapp_send_me({ text: t, file }) {
      if (!t && !file) throw new Error('Falta text o file')
      await local.send({ to: me, ...(t ? { text: t } : {}), ...(file ? { file } : {}) })
      return text('Enviado.')
    },
    async whatsapp_send({ to, text: t, file }) {
      const n = normalizePhone(need(to, 'to'))
      if (n.length < 10) throw new Error('Número inválido')
      await local.send({ to: n, ...(t ? { text: t } : {}), ...(file ? { file } : {}) })
      return text(`Enviado a ${n}.`)
    },
    async monitor_add({ id, note }) {
      const r = await hub.post('/api/monitors', { op: 'add', id: need(id, 'id'), note })
      await act('monitor', `Vigila ${id}`)
      const warn = r.hook ? '' : '\n\n⚠ El webhook de Hermes aún no está configurado en el hub, así que el aviso no saldrá hasta hacerlo (ver README: «Monitores»).'
      return text(`Vigilando ${id}. Te aviso cuando termine un turno.${warn}`)
    },
    async monitor_remove({ id }) {
      await hub.post('/api/monitors', { op: 'remove', id: need(id, 'id') })
      await act('monitor', `Ya no vigila ${id}`)
      return text(`Dejé de vigilar ${id}.`)
    },
    async monitors_list() {
      const r = await hub.get('/api/monitors')
      const list = r.monitors ?? []
      const warn = r.hook ? '' : '\n\n⚠ Webhook de Hermes sin configurar en el hub (ver README: «Monitores»).'
      return text((list.length ? list.map(m => `• ${m.id}${m.note ? ` — ${m.note}` : ''}`).join('\n') : 'No vigilas ninguna sesión.') + warn)
    },
  }
}

export async function handleRpc(msg, handlers) {
  const { id, method, params } = msg ?? {}
  if (id === undefined || id === null) return null // a notification
  const ok = result => ({ jsonrpc: '2.0', id, result })
  if (method === 'initialize') return ok({ protocolVersion: params?.protocolVersion ?? '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'pastor-hub', version: '1.0.0' } })
  if (method === 'ping') return ok({})
  if (method === 'tools/list') return ok({ tools: TOOLS })
  if (method === 'tools/call') {
    const fn = handlers[params?.name]
    if (!fn) return ok({ content: text(`Herramienta desconocida: ${params?.name}`), isError: true })
    try { return ok({ content: await fn(params.arguments ?? {}) }) }
    catch (err) { return ok({ content: text(`Error: ${err.message ?? err}`), isError: true }) }
  }
  return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } }
}
