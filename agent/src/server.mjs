// pastor-agent's local API: the hub's bridge (for the app) and the MCP talk to
// it on 127.0.0.1 with a shared secret.
import http from 'node:http'

const ROUTES = {
  'GET /status': 'status', 'GET /config': 'getConfig', 'POST /config': 'setConfig', 'GET /activity': 'activity', 'GET /qr': 'qr',
  'POST /send': 'send', 'POST /activity': 'logActivity', 'POST /channel': 'channel', 'POST /relink': 'relink',
  'POST /chat': 'chat', 'POST /say': 'say', 'POST /stop': 'stop',
}

export function startServer({ port, secret, handlers }) {
  const srv = http.createServer(async (req, res) => {
    const reply = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
    if (req.headers['x-agent-secret'] !== secret) return reply(401, { error: 'secreto' })
    const name = ROUTES[`${req.method} ${new URL(req.url, 'http://x').pathname}`]
    if (!name || !handlers[name]) return reply(404, { error: 'no existe' })
    let body = {}
    if (req.method === 'POST') {
      try {
        const chunks = []
        for await (const c of req) chunks.push(c)
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      } catch { return reply(400, { error: 'JSON inválido' }) }
    }
    try { reply(200, await handlers[name](body)) }
    catch (err) { reply(err.status ?? 500, { error: String(err.message ?? err) }) }
  })
  srv.listen(port, '127.0.0.1')
  return srv
}
