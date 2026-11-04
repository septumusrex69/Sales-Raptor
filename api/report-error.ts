import type { VercelRequest, VercelResponse } from '@vercel/node'
import { adminClient } from './_lib/auth.js'
import { recordError } from './_lib/errorAlert.js'

/**
 * Where the browser sends a crash. See src/lib/errorReporter.ts and api/_lib/errorAlert.ts.
 *
 * Open to signed-out callers on purpose -- the login page can break too. That is safe because
 * all it can do is add a row to error_reports, every field is length-capped, and the email side
 * is deduplicated by fingerprint, so it cannot be used to spam anyone.
 */
const cap = (v: unknown, n: number) => (typeof v === 'string' && v ? v.slice(0, n) : undefined)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  const b = (typeof req.body === 'string' ? safeJson(req.body) : req.body) ?? {}
  const message = cap(b.message, 1000)
  if (!message) {
    res.status(400).json({ error: 'message is required' })
    return
  }

  const admin = adminClient()
  let userId: string | null = null
  let userEmail: string | null = null
  const auth = req.headers.authorization
  if (admin && auth?.startsWith('Bearer ')) {
    const { data } = await admin.auth.getUser(auth.slice(7))
    userId = data.user?.id ?? null
    userEmail = data.user?.email ?? null
  }

  const source = ['render', 'window', 'promise', 'manual'].includes(b.source) ? b.source : 'window'
  const { emailed } = await recordError(admin, {
    message,
    stack: cap(b.stack, 6000),
    componentStack: cap(b.componentStack, 4000),
    source,
    url: cap(b.url, 500),
    userAgent: cap(b.userAgent ?? req.headers['user-agent'], 300),
    build: cap(b.build, 100),
    userId,
    userEmail,
  })
  res.status(200).json({ ok: true, emailed })
}

function safeJson(s: string) {
  try { return JSON.parse(s) } catch { return null }
}
