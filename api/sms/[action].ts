import type { VercelRequest, VercelResponse } from '@vercel/node'
import send from '../_lib/sms/send.js'
import dlr from '../_lib/sms/dlr.js'
import mo from '../_lib/sms/mo.js'

/**
 * Every SMS route, behind one function.
 *
 * Vercel's Hobby plan caps a deployment at twelve serverless functions and the email, user and
 * BuzzBox routes already use eleven. Sending, delivery reports and inbound replies are three
 * endpoints the provider needs to see at three different URLs, so they share a function and
 * dispatch on the path — exactly as api/buzzbox/[action].ts already does.
 *
 *   POST /api/sms/send   from the app, with a signed-in session
 *   GET|POST /api/sms/dlr   from Connect Mobile, when a message is delivered or fails
 *   GET|POST /api/sms/mo    from Connect Mobile, when a debtor replies
 */
const ROUTES: Record<string, (req: VercelRequest, res: VercelResponse) => Promise<void>> = {
  send, dlr, mo,
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = String(req.query.action ?? '')
  const route = ROUTES[action]
  if (!route) {
    res.status(404).json({ error: `Unknown SMS action "${action}".` })
    return
  }
  await route(req, res)
}
