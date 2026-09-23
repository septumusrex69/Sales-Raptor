import type { VercelRequest, VercelResponse } from '@vercel/node'
import attachment from '../_lib/email/attachment.js'
import connect from '../_lib/email/connect.js'
import disconnect from '../_lib/email/disconnect.js'
import send from '../_lib/email/send.js'
import status from '../_lib/email/status.js'
import sync from '../_lib/email/sync.js'
import syncAll from '../_lib/email/sync-all.js'

/**
 * One serverless function for every /api/email/* route.
 *
 * Vercel's Hobby plan caps a deployment at twelve functions, and these seven files were seven of
 * them -- leaving exactly nothing spare, so the workflow runner had nowhere to live. Collapsed
 * the way api/buzzbox and api/sms already are, they are one, and the URLs the browser calls do
 * not move: a dynamic route serves /api/email/send, /api/email/sync and the rest exactly as
 * seven files did. The handlers themselves now sit under api/_lib/email/, which Vercel never
 * deploys as functions.
 *
 * THE CRON IN vercel.json STILL POINTS AT /api/email/sync-all AND STILL WORKS, which is the one
 * thing to check before touching this file: the hyphen is part of the action, so the key below
 * is 'sync-all' and not 'syncAll'. Renamed on the import side only, because a hyphen is not a
 * JavaScript identifier.
 */
const ROUTES: Record<string, (req: VercelRequest, res: VercelResponse) => Promise<void>> = {
  attachment,
  connect,
  disconnect,
  send,
  status,
  sync,
  'sync-all': syncAll,
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = typeof req.query.action === 'string' ? req.query.action : ''
  /* hasOwnProperty rather than a bare lookup: `?action=constructor` would otherwise find
     something on Object.prototype and call it with a request and a response. */
  const route = Object.prototype.hasOwnProperty.call(ROUTES, action) ? ROUTES[action] : undefined
  if (!route) {
    res.status(404).json({ error: `Unknown email route: ${action || '(none)'}` })
    return
  }
  await route(req, res)
}
