import type { VercelRequest, VercelResponse } from '@vercel/node'
import attachment from '../_lib/email/attachment.js'
import ticket from '../_lib/email/ticket.js'
import connect from '../_lib/email/connect.js'
import disconnect from '../_lib/email/disconnect.js'
import send from '../_lib/email/send.js'
import signedCopy from '../_lib/email/signedCopy.js'
import status from '../_lib/email/status.js'
import sync from '../_lib/email/sync.js'
import syncAll from '../_lib/email/sync-all.js'
import welcome from '../_lib/email/welcome.js'
import assignLiaison from '../_lib/email/assignLiaison.js'
import loginCode from '../_lib/email/loginCode.js'
import marketing from '../_lib/email/marketing.js'
import unsubscribe from '../_lib/email/unsubscribe.js'
import resendWebhook from '../_lib/email/resendWebhook.js'
import optIn from '../_lib/email/optIn.js'

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
  ticket,
  disconnect,
  send,
  status,
  sync,
  'sync-all': syncAll,
  /* ANONYMOUS, and the token is the authority -- see signedCopy for why nothing else it is
     sent is trusted. */
  'signed-copy': signedCopy,
  /* The welcome email, sent when the liaison presses Send on the client's Welcome card (23 Oct;
     it used to go by itself on assignment, S8). */
  welcome,
  /* Give a new client its liaison: hers, two tasks, her notice, the notes. SENDS NOTHING (23 Oct). */
  'assign-liaison': assignLiaison,
  /* An Administrator's code on a new device (S10). Here because it is an email the server sends,
     and api/ has no function to spare. */
  'login-code': loginCode,
  /* NEWS & CAMPAIGNS (S10): the sender, for somebody holding marketing.send. */
  marketing,
  /* ANONYMOUS, like signed-copy: the signed token in the link is the authority. The unsubscribe
     link in every newsletter and the List-Unsubscribe one-click header both land here. */
  unsubscribe,
  /* ANONYMOUS, and Resend's signature (RESEND_WEBHOOK_SECRET) is the authority: bounces and
     complaints on a newsletter. */
  'resend-webhook': resendWebhook,
  /* ANONYMOUS, like unsubscribe: "Yes, keep me informed" in an introduction email (S10, 22 Oct).
     The signed token names the send; pressing it records the lead's consent. */
  'opt-in': optIn,
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
