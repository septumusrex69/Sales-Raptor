import type { VercelRequest, VercelResponse } from '@vercel/node'
import { adminClient, requireCaller } from '../auth.js'
import { BuzzBoxError, initiateCall, normaliseDialNumber } from '../buzzbox.js'
import { connectedSession } from './session.js'

/**
 * Click to dial. BuzzBox rings the caller's own extension first; when they pick up it
 * dials `to` and bridges the two. The CRM Activity for the call is written by the browser
 * once this returns ok — the same path as a manually logged call, so it threads onto the
 * lead / client / contact exactly like one.
 *
 * Body: { to: string, reference?: string }. `reference` is passed through to BuzzBox so the
 * call shows up in its own records tagged with the CRM record it was placed from.
 */
/**
 * Where BuzzBox should post what happened to the call.
 *
 * It has to come back to the deployment that placed it, and that is the whole point. This used
 * to prefer VERCEL_PROJECT_PRODUCTION_URL, which is the LIVE hostname on every deployment
 * including preview ones -- so a call placed on staging reported its answer to production, which
 * then looked for the account in the live database and could not find it. Harmless while the
 * webhook only logged; a silently lost fee once it started charging.
 *
 * So: the branch URL first. VERCEL_BRANCH_URL is stable for the life of a branch, which a
 * webhook arriving seconds later needs and a redeploy must not break. On production that
 * resolves to the Main branch alias, which is an alias of the live site. VERCEL_URL is the
 * per-deployment hostname and the last resort, since it dies with its deployment.
 * BUZZBOX_WEBHOOK_BASE overrides everything, for a custom domain.
 */
function callbackUrl(): string | undefined {
  const key = process.env.SMS_WEBHOOK_KEY
  const host = process.env.BUZZBOX_WEBHOOK_BASE
    ?? process.env.VERCEL_BRANCH_URL
    ?? process.env.VERCEL_PROJECT_PRODUCTION_URL
    ?? process.env.VERCEL_URL
  if (!key || !host) return undefined
  const base = host.startsWith('http') ? host.replace(/\/+$/, '') : `https://${host}`
  return `${base}/api/buzzbox/webhook?key=${encodeURIComponent(key)}`
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  const admin = adminClient()
  if (!admin) {
    res.status(500).json({ error: 'Server is missing Supabase configuration.' })
    return
  }
  const caller = await requireCaller(req, admin)
  if (!caller) {
    res.status(401).json({ error: 'Invalid or expired session.' })
    return
  }

  const { to, reference } = (req.body ?? {}) as { to?: string; reference?: string }
  if (!to?.trim()) {
    res.status(400).json({ error: 'A number to dial is required.' })
    return
  }
  const dialTo = normaliseDialNumber(to)
  if (!dialTo) {
    res.status(400).json({ error: `"${to}" doesn't look like a phone number.` })
    return
  }

  const { data: profile } = await admin.from('profiles').select('buzzbox_extension').eq('id', caller.id).maybeSingle()
  const from = profile?.buzzbox_extension?.trim()
  if (!from) {
    res.status(400).json({ error: 'Pick your BuzzBox extension under Settings → Integrations before dialling.' })
    return
  }

  try {
    const session = await connectedSession(admin)
    if (!session) {
      res.status(400).json({ error: 'BuzzBox is not connected. An administrator can connect it under Settings → Integrations.' })
      return
    }
    await initiateCall(session.jwt, session.connection.organisationId, {
      from,
      to: dialTo,
      reference: reference?.slice(0, 120) || undefined,
      /*
       * Ask BuzzBox to tell us how the call went.
       *
       * Nothing reads the answer yet -- the payload is undocumented, so /api/buzzbox/webhook only
       * logs what arrives. Sending the URL now is what makes a real call teach us the shape; the
       * alternative is asking every collector after every call forever.
       *
       * Omitted rather than guessed when the deployment does not know its own public URL or has
       * no webhook key: a webhookUrl pointing at the wrong host is worse than none.
       */
      webhookUrl: callbackUrl(),
    })
    res.status(200).json({ ok: true, from, to: dialTo })
  } catch (err) {
    if (err instanceof BuzzBoxError) {
      res.status(502).json({ error: err.message })
      return
    }
    res.status(502).json({ error: 'Could not reach BuzzBox. Please try again.' })
  }
}
