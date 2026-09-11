/**
 * Connect Mobile's HTTP SMS API.
 *
 * One call, documented by the firm's own sample:
 *
 *   GET https://sms.connect-mobile.co.za/submit/single/?api_token=…&da=27761363038&ud=hello&id=01
 *
 *   da  destination, international format, no plus
 *   ud  the message, URL-encoded
 *   id  our own identifier, which comes back on the delivery report
 *
 * Chosen over SMPP because Raptor runs on serverless functions that live for seconds: an SMPP bind
 * is a long-lived TCP session with keepalives and would need a machine of its own doing nothing
 * else. HTTP costs nothing to hold and the delivery reports arrive as webhooks, which is the same
 * shape the rest of the app already uses.
 *
 * The token is read from the environment and never leaves the server. It travels in a query
 * string because that is the API the provider published — worth knowing, because query strings
 * end up in access logs in a way headers do not.
 */

export const CONNECT_MOBILE_URL =
  (process.env.CONNECT_MOBILE_URL ?? 'https://sms.connect-mobile.co.za/submit/single/').replace(/\/*$/, '/')

export class SmsError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'SmsError'
    this.status = status
  }
}

/**
 * A South African number as the network wants it: international, digits only, no plus.
 *
 * Deliberately strict about length. A mistyped nine-digit number is not worth sending to a
 * stranger's handset, and a debtor's number typed into a free-text field is exactly where that
 * happens.
 */
export function toMsisdn(raw: string, defaultCountry = '27'): string | null {
  const digits = raw.replace(/[^\d+]/g, '')
  let n = digits.startsWith('+') ? digits.slice(1) : digits
  if (n.startsWith('00')) n = n.slice(2)
  // 0821234567 -> 27821234567
  if (n.startsWith('0') && n.length === 10) n = defaultCountry + n.slice(1)
  if (!/^\d{10,15}$/.test(n)) return null
  // A local number that never got a country code would be 9 digits here; refuse rather than guess.
  if (n.startsWith('0')) return null
  return n
}

export interface SendResult {
  /** Whatever the provider said, kept verbatim for the first real send. */
  raw: string
  /** The provider's own id for the message, where it gives one. */
  providerId: string | null
}

/**
 * Hand one message to Connect Mobile.
 *
 * `reference` is ours and comes back on the delivery report, which is how a DLR finds the row it
 * belongs to. The response body is returned untouched rather than parsed into a shape we guessed
 * at: the documentation is not reachable from here, so the first real send is what teaches us what
 * comes back.
 */
export async function sendSms(input: {
  to: string
  text: string
  reference: string
  token?: string
}): Promise<SendResult> {
  /*
   * Trimmed, because a pasted secret almost never arrives clean.
   *
   * Copying a token out of a vault or an email brings a trailing newline or a leading space with
   * it more often than not, and neither is visible in the box you paste into. The provider then
   * rejects a token that looks perfectly correct to the person who set it.
   */
  const token = (input.token ?? process.env.CONNECT_MOBILE_API_TOKEN ?? '').trim()
  if (!token) {
    /*
     * Says what to DO, not just what is missing.
     *
     * The first time this fired, the variable had in fact been set — a few minutes after the
     * deployment was built. A Vercel deployment carries the environment it was built with, so a
     * variable added afterwards reaches the next build and not this one. That is the answer
     * almost every time this message appears, and the message is where somebody will look.
     */
    throw new SmsError(500,
      'Connect Mobile is not configured on this deployment. Add CONNECT_MOBILE_API_TOKEN in '
      + 'Vercel — tick Production AND Preview — and then redeploy, because a deployment keeps the '
      + 'settings it was built with.')
  }
  const msisdn = toMsisdn(input.to)
  if (!msisdn) throw new SmsError(400, `"${input.to}" is not a number an SMS can be sent to.`)
  if (!input.text.trim()) throw new SmsError(400, 'An SMS needs a message.')

  const url = new URL(CONNECT_MOBILE_URL)
  url.searchParams.set('api_token', token)
  url.searchParams.set('da', msisdn)
  url.searchParams.set('ud', input.text)
  url.searchParams.set('id', input.reference)

  let res: Response
  try {
    res = await fetch(url, { method: 'GET' })
  } catch {
    throw new SmsError(502, 'Could not reach Connect Mobile.')
  }
  const raw = (await res.text()).trim()
  if (!res.ok) {
    // Never echo the URL back: it carries the token.
    throw new SmsError(res.status === 401 || res.status === 403 ? 400 : 502,
      `Connect Mobile refused the message (HTTP ${res.status}). ${raw.slice(0, 200)}`)
  }
  return { raw: raw.slice(0, 2000), providerId: providerIdFrom(raw) }
}

/**
 * Pull a provider message id out of the response.
 *
 * Written to be forgiving because the exact response format is not documented to us yet: JSON with
 * an id field, or a bare identifier on one line, are both understood, and anything else simply
 * yields null — the message still sent, and `raw` keeps whatever came back for whoever wires this
 * up properly once a real response has been seen.
 */
export function providerIdFrom(raw: string): string | null {
  try {
    const body = JSON.parse(raw) as Record<string, unknown>
    for (const key of ['id', 'message_id', 'messageId', 'reference', 'msgid']) {
      const v = body[key]
      if (typeof v === 'string' && v) return v
      if (typeof v === 'number') return String(v)
    }
  } catch {
    // Not JSON. Fall through to the plain-text reading.
  }
  const line = raw.split(/\r?\n/)[0]?.trim() ?? ''
  return /^[A-Za-z0-9._:-]{4,64}$/.test(line) ? line : null
}
