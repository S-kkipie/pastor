// Talks to a pastor bridge. Served by the bridge (the PWA), the bridge is the
// page's own origin; in a native shell (Capacitor) it is the URL the person
// typed when pairing.

const KEY = 'pastor.'

function read(k: string): string {
  try {
    const v = localStorage.getItem(KEY + k) ?? ''
    // The first app stored values JSON-encoded ("…"); keep those working.
    if (v.startsWith('"')) { try { return String(JSON.parse(v)) } catch { /* plain */ } }
    return v
  } catch { return '' }
}
function write(k: string, v: string) {
  try { v ? localStorage.setItem(KEY + k, v) : localStorage.removeItem(KEY + k) } catch { /* private mode */ }
}

export const isNative = (): boolean =>
  location.protocol === 'capacitor:' || !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
    .Capacitor?.isNativePlatform?.()

export const auth = {
  get token() { return read('token') },
  set token(v: string) { write('token', v); window.dispatchEvent(new Event('pastor:auth')) },
  get server() { return read('server') || (isNative() ? '' : location.origin) },
  set server(v: string) { write('server', v.replace(/\/+$/, '')) },
}

export class ApiError extends Error {
  readonly status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}

export async function api<T = unknown>(path: string, body?: unknown, init?: { signal?: AbortSignal }): Promise<T> {
  const res = await fetch(`${auth.server}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'content-type': 'application/json',
      ...(auth.token ? { authorization: `Bearer ${auth.token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: init?.signal,
  })
  if (res.status === 401 && path !== '/api/pair') { auth.token = ''; throw new ApiError('unpaired', 401) }
  // Anything but JSON is not the bridge answering (a wrong address, the app's own page, a proxy's error page).
  if (!(res.headers.get('content-type') ?? '').includes('json')) {
    throw new ApiError(`${auth.server || location.origin} no respondió como un bridge de pastor (HTTP ${res.status})`, res.status)
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError((data as { error?: string }).error || res.statusText, res.status)
  return data as T
}

// What the person typed as the bridge's address: scheme added, path dropped.
// A pairing link (…/?pair=123456, the QR's) also yields its code.
export function parseServer(input: string): { server: string; code?: string } | null {
  let v = input.trim()
  if (!v) return null
  if (!/^https?:\/\//i.test(v)) v = `http://${v}`
  try {
    const u = new URL(v)
    const code = u.searchParams.get('pair') ?? undefined
    return { server: u.origin, code: code && /^\d{6}$/.test(code) ? code : undefined }
  } catch { return null }
}

export const sessionPath = (id: string, action?: string) =>
  `/api/session/${encodeURIComponent(id)}${action ? `/${action}` : ''}`

export const store = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(KEY + k); return v == null ? d : JSON.parse(v) as T } catch { return d } },
  set(k: string, v: unknown) { try { localStorage.setItem(KEY + k, JSON.stringify(v)) } catch { /* private mode */ } },
}
