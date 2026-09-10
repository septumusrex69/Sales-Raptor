import type { VercelRequest, VercelResponse } from '@vercel/node'
import call from '../_lib/buzzbox/call.js'
import connect from '../_lib/buzzbox/connect.js'
import disconnect from '../_lib/buzzbox/disconnect.js'
import extensions from '../_lib/buzzbox/extensions.js'
import status from '../_lib/buzzbox/status.js'

/**
 * One serverless function for every /api/buzzbox/* route.
 *
 * Vercel's Hobby plan caps a deployment at 12 functions and the email + user routes already
 * use 10, so five BuzzBox files would have pushed the deploy over (it did: the first preview
 * failed with exceeded_serverless_functions_per_deployment). A dynamic route keeps the URLs
 * the browser calls — /api/buzzbox/status, /api/buzzbox/call, ... — while counting as one.
 * The handlers themselves live under api/_lib/buzzbox/, which Vercel never deploys as functions.
 */
const ROUTES: Record<string, (req: VercelRequest, res: VercelResponse) => Promise<void>> = {
  call,
  connect,
  disconnect,
  extensions,
  status,
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = typeof req.query.action === 'string' ? req.query.action : ''
  const route = Object.prototype.hasOwnProperty.call(ROUTES, action) ? ROUTES[action] : undefined
  if (!route) {
    res.status(404).json({ error: `Unknown BuzzBox route: ${action || '(none)'}` })
    return
  }
  await route(req, res)
}
