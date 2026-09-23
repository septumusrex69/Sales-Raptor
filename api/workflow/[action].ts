import type { VercelRequest, VercelResponse } from '@vercel/node'
import run from '../_lib/workflow/run.js'

/**
 * One serverless function for every /api/workflow/* route.
 *
 * A dispatcher for one route today, which is not over-engineering: the next two are already
 * known -- releasing a held step from the account screen, and starting a run when a collector
 * issues a section 129 -- and Vercel's Hobby plan counts FILES, not routes. Adding them here
 * costs nothing; adding them as files costs a twelfth of the deployment each.
 */
const ROUTES: Record<string, (req: VercelRequest, res: VercelResponse) => Promise<void>> = { run }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = typeof req.query.action === 'string' ? req.query.action : ''
  /* hasOwnProperty rather than a bare lookup: `?action=constructor` would otherwise find
     something on Object.prototype and call it with a request and a response. */
  const route = Object.prototype.hasOwnProperty.call(ROUTES, action) ? ROUTES[action] : undefined
  if (!route) {
    res.status(404).json({ error: `Unknown workflow route: ${action || '(none)'}` })
    return
  }
  await route(req, res)
}
