import type { VercelRequest, VercelResponse } from '@vercel/node'
import advance from '../_lib/workflow/advance.js'
import clock from '../_lib/workflow/clock.js'
import release from '../_lib/workflow/release.js'
import run from '../_lib/workflow/run.js'
import start from '../_lib/workflow/start.js'

/**
 * One serverless function for every /api/workflow/* route.
 *
 * Four routes and the same one function, which is the point: Vercel's Hobby plan counts FILES,
 * not routes. `run` is the morning cron and answers to a cron secret; `release`, `start` and
 * `advance` are a person pressing a button and answer to their session. Adding `start` -- the
 * collector issuing a section 129 -- cost nothing here, where as its own file it would have cost a
 * twelfth of the deployment, and `advance` (the test clock) cost nothing for the same reason.
 */
const ROUTES: Record<string, (req: VercelRequest, res: VercelResponse) => Promise<void>> = {
  /* `clock` is the staging clock's jump (prompt 10) -- staging only, Administrator only. Here for
     the reason `advance` is: a route in this file costs nothing, a file costs a twelfth. */
  run, release, start, advance, clock,
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
