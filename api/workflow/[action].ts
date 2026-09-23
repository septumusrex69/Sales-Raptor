import type { VercelRequest, VercelResponse } from '@vercel/node'
import release from '../_lib/workflow/release.js'
import run from '../_lib/workflow/run.js'

/**
 * One serverless function for every /api/workflow/* route.
 *
 * Two routes and the same one function, which is the point: Vercel's Hobby plan counts FILES,
 * not routes. `run` is the morning cron and answers to a cron secret; `release` is a person
 * pressing a button and answers to their session. The next one -- starting a run when a collector
 * issues a section 129 -- costs nothing here and a twelfth of the deployment as its own file.
 */
const ROUTES: Record<string, (req: VercelRequest, res: VercelResponse) => Promise<void>> = {
  run, release,
}

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
