/**
 * Reading what BuzzBox says about a call.
 *
 * BuzzBox documents `CallSetup.webhookUrl` as a field and nothing else -- the payload's shape is
 * not published anywhere. Everything here was read off real events captured from real calls
 * through Raptor on 12 September 2026, and the test fixtures in
 * scripts/qa/check-buzzbox-events.mjs are those exact payloads rather than invented ones. If
 * BuzzBox changes the shape, those tests are what will say so.
 *
 * What arrives is FreeSWITCH channel events, one per leg per transition:
 *
 *   {"event":"CHANNEL_BRIDGE","organisationId":2741,
 *    "internalId":"0513f5d5-…",            <- this LEG
 *    "externalId":"e6bea85d-…",            <- this CALL, shared by both legs
 *    "eventAvps":[{"att":"state","val":"answered"},
 *                 {"att":"b-channel-name","val":"sofia/external/0832573344"}]}
 *
 * A click-to-dial call is two legs. BuzzBox rings the collector's extension first
 * (sofia/internal/141@…) and, once they lift it, dials the debtor (sofia/external/0832573344).
 * That matters for reading "answered": CHANNEL_ANSWER fires on the INTERNAL leg when the
 * collector picks up their own handset, which is not the debtor answering anything. The two
 * events that actually mean a conversation are CHANNEL_BRIDGE, where the legs are joined, and
 * CHANNEL_ANSWER on the external leg.
 */

/** One attribute-value pair out of `eventAvps`. */
interface Avp { att?: string; val?: string }

export interface CallEvent {
  /** FreeSWITCH's event name, e.g. CHANNEL_BRIDGE. Empty if the payload had none. */
  event: string
  /** The call's id, shared by both legs. This is what ties events to one another. */
  externalId: string | null
  /** This leg's own id. Different for the extension leg and the debtor leg. */
  internalId: string | null
  /** The debtor's number, where this event names it. Digits as BuzzBox wrote them. */
  number: string | null
  /** The collector's extension, where this event names it. */
  extension: string | null
  /** The debtor picked up and the two sides are talking. */
  answered: boolean
  /** The call is over. */
  ended: boolean
  /** FreeSWITCH's reason, e.g. NORMAL_CLEARING or NO_USER_RESPONSE. */
  hangupCause: string | null
  /** When BuzzBox says it happened. Null when unparseable, never guessed as "now". */
  at: string | null
}

const avpsOf = (payload: unknown): Avp[] => {
  const list = (payload as { eventAvps?: unknown })?.eventAvps
  return Array.isArray(list) ? (list as Avp[]) : []
}

const avp = (avps: Avp[], att: string): string | null => {
  const hit = avps.find((a) => a?.att === att && typeof a.val === 'string' && a.val !== '')
  return hit?.val ?? null
}

/** `sofia/external/0832573344` -> `0832573344`. Anything else -> null. */
export function externalLegNumber(channelName: string | null): string | null {
  if (!channelName) return null
  const m = /^sofia\/external\/(\+?\d+)/.exec(channelName)
  return m ? m[1] : null
}

/** `sofia/internal/141@41.133.90.117:60500` -> `141`. Anything else -> null. */
export function internalLegExtension(channelName: string | null): string | null {
  if (!channelName) return null
  const m = /^sofia\/internal\/(\d+)@/.exec(channelName)
  return m ? m[1] : null
}

/**
 * The last nine digits of a phone number, which is how two spellings of one number are matched.
 *
 * We dial E.164 without the plus (27832573344) and BuzzBox reports the local form (0832573344),
 * so comparing the strings finds nothing. Nine digits is the South African subscriber number
 * without its leading zero or country code -- short enough that every spelling agrees on it,
 * long enough that two different debtors will not collide.
 *
 * Returns null rather than a short string for anything that cannot be a phone number, so a
 * match is never attempted on a fragment.
 */
export function numberTail(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/\D/g, '')
  return digits.length >= 9 ? digits.slice(-9) : null
}

/**
 * Read one webhook payload.
 *
 * Never throws: this runs behind an endpoint open to the internet, and a payload we cannot read
 * is a thing to record and move past rather than a 500 that makes BuzzBox retry it forever.
 */
export function parseCallEvent(payload: unknown): CallEvent {
  const body = (payload ?? {}) as Record<string, unknown>
  const event = typeof body.event === 'string' ? body.event : ''
  const avps = avpsOf(body)

  const channelName = avp(avps, 'channel-name')
  const bChannelName = avp(avps, 'b-channel-name')

  /*
   * Which leg named the debtor's number.
   *
   * On a bridge, this leg is the extension and `b-channel-name` is the debtor. On the debtor's
   * own leg, `channel-name` is the debtor. `destination` carries it too on CHANNEL_CREATE, but
   * on the extension's leg destination is the extension itself (141), so it is read last and
   * only when it looks like a phone number rather than an extension.
   */
  const destination = avp(avps, 'destination')
  const number = externalLegNumber(bChannelName)
    ?? externalLegNumber(channelName)
    ?? (numberTail(destination) ? destination : null)

  const extension = internalLegExtension(channelName)
    ?? internalLegExtension(avp(avps, 'a-channel-name'))
    ?? avp(avps, 'accountcode')

  /*
   * Answered means the debtor is on the line, not that a phone somewhere was lifted.
   *
   * CHANNEL_BRIDGE is definitive: FreeSWITCH only bridges two legs that are both up. A
   * CHANNEL_ANSWER counts only on the debtor's leg -- on the extension's leg it is the collector
   * answering their own handset, which happens on every call including the ones nobody picks up.
   */
  const answeredLeg = externalLegNumber(channelName) !== null
  const answered = event === 'CHANNEL_BRIDGE' || (event === 'CHANNEL_ANSWER' && answeredLeg)

  return {
    event,
    externalId: typeof body.externalId === 'string' && body.externalId ? body.externalId : null,
    internalId: typeof body.internalId === 'string' && body.internalId ? body.internalId : null,
    number,
    extension,
    answered,
    ended: event === 'CHANNEL_HANGUP_COMPLETE',
    hangupCause: avp(avps, 'hangup-cause'),
    at: timestampOf(body),
  }
}

/**
 * BuzzBox sends two clocks and neither carries a zone: `bbEventTimeStamp` from its own service
 * and `fsEventTimeStamp` from FreeSWITCH, both like "2026-09-12T08:41:03.261529680". They were
 * within 40ms of each other on every captured event. Read as UTC, which is what the observed
 * values are -- the 08:38 call was placed at 10:38 South African time.
 */
function timestampOf(body: Record<string, unknown>): string | null {
  const raw = typeof body.bbEventTimeStamp === 'string' ? body.bbEventTimeStamp
    : typeof body.fsEventTimeStamp === 'string' ? body.fsEventTimeStamp
      : null
  if (!raw) return null
  // Nanoseconds; JS Date takes milliseconds and rejects the rest.
  const trimmed = raw.replace(/(\.\d{3})\d+$/, '$1')
  const d = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(trimmed) ? trimmed : `${trimmed}Z`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
