import type { VercelRequest, VercelResponse } from '@vercel/node'

/**
 * BuzzBox telling us what happened to a call.
 *
 * `CallSetup.webhookUrl` is documented as a field and nothing else: BuzzBox does not publish the
 * shape of what it posts here, so there is nothing yet to read "answered" or "duration" out of.
 * This endpoint exists to find out. It logs whatever arrives, and one real call through Raptor
 * will show us the payload in the Vercel runtime logs.
 *
 * It deliberately does NOT charge anything. Guessing which field means "the debtor picked up"
 * and billing Annexure B item 7 on the strength of that guess is how a firm ends up charging for
 * calls that rang out. The account page asks the collector instead; when we know the shape, the
 * charge moves here and the question goes away.
 *
 * Open to the internet, so it is gated on the same key the SMS webhooks use -- carried in the URL
 * BuzzBox is given. Always answers 200 past the gate: a provider that gets an error retries, and
 * a retry loop over a payload we are only observing helps nobody.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secret = process.env.SMS_WEBHOOK_KEY
  if (!secret) {
    res.status(500).json({ error: 'SMS_WEBHOOK_KEY is not set on this deployment.' })
    return
  }
  const key = typeof req.query.key === 'string' ? req.query.key : ''
  if (key !== secret) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }

  // Truncated, because a payload of unknown shape is a payload of unknown size, and a log line
  // is not a place to discover that.
  const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {})
  console.log('[buzzbox-webhook]', JSON.stringify({
    method: req.method,
    query: req.query,
    headers: { 'content-type': req.headers['content-type'] },
    body: body.slice(0, 4000),
  }))

  res.status(200).json({ ok: true })
}
