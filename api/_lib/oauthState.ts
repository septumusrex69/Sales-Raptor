import crypto from 'node:crypto'

const STATE_TTL_MS = 10 * 60 * 1000

function getSecret(): string {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!secret) throw new Error('Server is missing Supabase configuration.')
  return secret
}

/**
 * Signs {userId, returnOrigin} into an opaque, tamper-proof state string for
 * the OAuth round trip through Microsoft — avoids needing a database table
 * just to remember which user/site initiated the connect flow. Reuses the
 * Supabase service_role key as the HMAC secret since it's already a
 * high-entropy value that only ever lives server-side.
 */
export function signOAuthState(userId: string, returnOrigin: string): string {
  const payload = JSON.stringify({ userId, returnOrigin, exp: Date.now() + STATE_TTL_MS })
  const encoded = Buffer.from(payload, 'utf8').toString('base64url')
  const sig = crypto.createHmac('sha256', getSecret()).update(encoded).digest('base64url')
  return `${encoded}.${sig}`
}

export function verifyOAuthState(state: string): { userId: string; returnOrigin: string } | null {
  const [encoded, sig] = state.split('.')
  if (!encoded || !sig) return null
  const expectedSig = crypto.createHmac('sha256', getSecret()).update(encoded).digest('base64url')
  const sigBuf = Buffer.from(sig)
  const expectedBuf = Buffer.from(expectedSig)
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as { userId: string; returnOrigin: string; exp: number }
    if (Date.now() > payload.exp) return null
    return { userId: payload.userId, returnOrigin: payload.returnOrigin }
  } catch {
    return null
  }
}

export function currentOrigin(req: { headers: { host?: string; 'x-forwarded-proto'?: string | string[] } }): string {
  const protoHeader = req.headers['x-forwarded-proto']
  const proto = Array.isArray(protoHeader) ? protoHeader[0] : (protoHeader ?? 'https')
  return `${proto}://${req.headers.host}`
}
