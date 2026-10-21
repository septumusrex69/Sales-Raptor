import type { VercelRequest } from '@vercel/node'

/**
 * Reading a webhook from Connect Mobile.
 *
 * Their documentation is not reachable from this environment, so rather than guess one field name
 * and be wrong, these look under every name a provider plausibly uses and keep the whole payload
 * either way. The first real delivery report is what settles it; until then nothing is silently
 * dropped, and `provider_raw` has the evidence.
 *
 * CONNECT MOBILE HAVE NOW TOLD US, and the answer was not one of the spellings we had. Jacques
 * confirmed on 14 September 2026: the identifier we send as `id` on submit comes back on both a
 * delivery report and a reply as `userid` — one word, no underscore. We accepted `user_id` and
 * would have matched nothing: every real DLR would have answered `matched: false` and no message
 * would ever have moved off "sent". Their exact spellings now lead each list.
 */

/** Query string and body together, because a provider may use either and some use both. */
export function params(req: VercelRequest): Record<string, string> {
  const out: Record<string, string> = {}
  const add = (o: unknown) => {
    if (!o || typeof o !== 'object') return
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (typeof v === 'string' || typeof v === 'number') out[k.toLowerCase()] = String(v)
    }
  }
  add(req.query)
  if (typeof req.body === 'string') {
    try { add(JSON.parse(req.body)) } catch { add(Object.fromEntries(new URLSearchParams(req.body))) }
  } else add(req.body)
  return out
}

export function pick(p: Record<string, string>, keys: string[]): string | null {
  for (const k of keys) {
    const v = p[k.toLowerCase()]
    if (v !== undefined && v !== '') return v
  }
  return null
}

/**
 * Our own identifier, sent as `id` on submit and echoed back. The only reliable way to find the row.
 *
 * `userid` is Connect Mobile's own spelling, confirmed by them, and it goes first. The rest stay
 * as fallbacks: costing nothing, they cover a provider changing its mind or a second provider
 * later, and a webhook that silently matches nothing is close to undetectable in production.
 */
export const REFERENCE_KEYS = [
  'userid', 'id', 'reference', 'ref', 'client_id', 'clientid', 'user_id', 'msgid', 'message_id',
]
export const MSISDN_KEYS = ['da', 'msisdn', 'sa', 'from', 'source', 'sender', 'number', 'origin']
/** `ud` is Connect Mobile's, on both a submit and a reply: the message text itself. */
export const TEXT_KEYS = ['ud', 'text', 'message', 'body', 'content', 'msg']
export const STATUS_KEYS = ['status', 'dlr', 'state', 'delivery_status', 'stat']

/**
 * What a provider's status word means for us.
 *
 * Deliberately generous about spelling, and deliberately conservative about the default: anything
 * unrecognised is left as it was rather than being called a failure, because telling a collector a
 * message failed when it did not is how somebody sends it twice.
 */
export function deliveryStatus(raw: string | null): 'delivered' | 'failed' | null {
  if (!raw) return null
  const s = raw.trim().toLowerCase()
  if (/^(delivrd|delivered|success|ok|2|dlvrd)$/.test(s)) return 'delivered'
  if (/^(undeliv|undelivered|failed|rejectd|rejected|expired|deleted|unknown|error|[3-8])$/.test(s)) return 'failed'
  return null
}
