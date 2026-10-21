/**
 * THIS BROWSER'S DEVICE ID, for the Administrator's sign-in code (see loginCode.ts).
 *
 * 32 random bytes, kept in localStorage. The database stores only its sha256; this is the one
 * place the id itself lives, which is what makes it worth something.
 *
 * STORAGE CAN BE UNAVAILABLE -- a private window, cleared site data, a locked-down iPad -- and
 * every touch of it is wrapped. When it cannot be kept, an id is still made for this page's life:
 * the code screen then works, and the cost is being asked again on the next visit, which is the
 * honest answer for a browser that forgets everything.
 */
const KEY = 'raptor.device-id'
let memory: string | null = null

function fresh(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function deviceId(): string {
  try {
    const kept = window.localStorage.getItem(KEY)
    if (kept && /^[0-9a-f]{64}$/.test(kept)) return kept
  } catch { /* storage unavailable: fall through to memory */ }
  if (!memory) memory = fresh()
  try { window.localStorage.setItem(KEY, memory) } catch { /* kept in memory only */ }
  return memory
}
