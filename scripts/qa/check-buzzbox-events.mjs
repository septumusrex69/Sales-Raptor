/**
 * Reading BuzzBox's call webhook.
 *
 * Every fixture below is a real payload, captured verbatim from the Vercel logs of two real
 * calls placed through Raptor on 12 September 2026 -- one the debtor answered, one that rang
 * out. Nothing here is invented, because BuzzBox does not publish this payload and an invented
 * fixture would only prove that the parser agrees with my guess about it.
 *
 * Run: node --experimental-strip-types scripts/qa/check-buzzbox-events.mjs
 */
import {
  externalLegNumber, internalLegExtension, numberTail, parseCallEvent,
} from '../../src/lib/buzzboxEvents.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) pass++
  else failures.push(`${name}\n     expected ${e}\n     actual   ${a}`)
}

/* ------------------------------------------------------------------ *
 * The answered call. 08:38:12 -> 08:38:24 UTC, debtor on 0832573344.
 * Six events, in the order they arrived.
 * ------------------------------------------------------------------ */
const CALL = 'e6bea85d-dbc1-40ec-b5ab-2c145d94f6e6'
const EXT_LEG = '0513f5d5-3d48-46de-8076-5b2bcc05ee6f'
const DEBTOR_LEG = '05c475ba-b389-49a3-a4b3-f99d8f3c585c'

// 1. The collector's own extension starts ringing. destination is the EXTENSION, not the debtor.
const createInternal = {
  event: 'CHANNEL_CREATE', domain: 'novacall.sip.buzzboxcloud.com', organisationId: 2741,
  internalId: EXT_LEG, externalId: CALL,
  bbEventTimeStamp: '2026-09-12T08:38:12.250471370',
  eventAvps: [
    { att: 'state', val: 'ringing' },
    { att: 'channel-name', val: 'sofia/internal/141@41.133.90.117:60500' },
    { att: 'effect-caller-id-name' }, { att: 'caller-id-number' },
    { att: 'accountcode', val: '141' }, { att: 'internal-number' },
    { att: 'destination', val: '141' },
  ],
}
// 2. The COLLECTOR lifts their handset. Not the debtor answering anything.
const answerInternal = {
  event: 'CHANNEL_ANSWER', domain: 'novacall.sip.buzzboxcloud.com', organisationId: 2741,
  internalId: EXT_LEG, externalId: CALL,
  bbEventTimeStamp: '2026-09-12T08:38:15.151935039',
  eventAvps: [
    { att: 'state', val: 'answered' },
    { att: 'channel-name', val: 'sofia/internal/141@41.133.90.117:60500' },
  ],
}
// 3. Now the debtor's phone starts ringing. organisationId is 0 on the external leg.
const createExternal = {
  event: 'CHANNEL_CREATE', organisationId: 0,
  internalId: DEBTOR_LEG, externalId: CALL,
  bbEventTimeStamp: '2026-09-12T08:38:15.272519519',
  eventAvps: [
    { att: 'state', val: 'ringing' },
    { att: 'channel-name', val: 'sofia/external/0832573344' },
    { att: 'effect-caller-id-name' }, { att: 'caller-id-number' },
    { att: 'accountcode' }, { att: 'internal-number' },
    { att: 'destination', val: '0832573344' },
  ],
}
// 4. THE DEBTOR ANSWERS.
const answerExternal = {
  event: 'CHANNEL_ANSWER', organisationId: 0,
  internalId: DEBTOR_LEG, externalId: CALL,
  bbEventTimeStamp: '2026-09-12T08:38:20.290651477',
  eventAvps: [
    { att: 'state', val: 'answered' },
    { att: 'channel-name', val: 'sofia/external/0832573344' },
  ],
}
// 5. The two legs are joined: a conversation is happening.
const bridge = {
  event: 'CHANNEL_BRIDGE', domain: 'novacall.sip.buzzboxcloud.com', organisationId: 2741,
  internalId: EXT_LEG, externalId: CALL,
  bbEventTimeStamp: '2026-09-12T08:38:20.311199330',
  eventAvps: [
    { att: 'state', val: 'answered' },
    { att: 'channel-name', val: 'sofia/internal/141@41.133.90.117:60500' },
    { att: 'b-internal-id', val: DEBTOR_LEG },
    { att: 'b-channel-name', val: 'sofia/external/0832573344' },
    { att: 'a-channel-name', val: 'sofia/internal/141@41.133.90.117:60500' },
    { att: 'a-internal-id', val: EXT_LEG },
  ],
}
// 6. Over, normally.
const hangupComplete = {
  event: 'CHANNEL_HANGUP_COMPLETE', domain: 'novacall.sip.buzzboxcloud.com', organisationId: 2741,
  internalId: EXT_LEG, externalId: CALL,
  bbEventTimeStamp: '2026-09-12T08:38:24.200854184',
  eventAvps: [
    { att: 'state', val: 'hangup' },
    { att: 'channel-name', val: 'sofia/internal/141@41.133.90.117:60500' },
    { att: 'hangup-cause', val: 'NORMAL_CLEARING' },
  ],
}

/* ------------------------------------------------------------------ *
 * The call nobody answered. 08:40:58 -> 08:41:03, never reached an
 * external leg at all: the collector's own extension did not pick up.
 * ------------------------------------------------------------------ */
const rangOut = {
  event: 'CHANNEL_HANGUP_COMPLETE', domain: 'novacall.sip.buzzboxcloud.com', organisationId: 2741,
  internalId: '3c2e753a-f4ee-49c8-af57-c88c9b78475d',
  externalId: '428ce95a-2753-46f2-b0ee-4ba2473aa6dd',
  bbEventTimeStamp: '2026-09-12T08:41:03.258508321',
  eventAvps: [
    { att: 'state', val: 'hangup' },
    { att: 'channel-name', val: 'sofia/internal/141@41.133.90.117:60500' },
    { att: 'hangup-cause', val: 'NO_USER_RESPONSE' },
  ],
}

/* ---- the one that matters most: which events mean "the debtor answered" ---- */
check('a ringing extension is not an answer', parseCallEvent(createInternal).answered, false)
check('THE COLLECTOR lifting their own handset is not an answer',
  parseCallEvent(answerInternal).answered, false)
check('a ringing debtor is not an answer', parseCallEvent(createExternal).answered, false)
check('the debtor picking up IS an answer', parseCallEvent(answerExternal).answered, true)
check('and a bridge is an answer', parseCallEvent(bridge).answered, true)
check('a hangup is not an answer', parseCallEvent(hangupComplete).answered, false)
check('nor is one that rang out', parseCallEvent(rangOut).answered, false)

// The whole point. If this ever flips, every unanswered call starts billing R60.
check('the call nobody answered produces no answered event at all',
  [createInternal, answerInternal, rangOut].some((e) => parseCallEvent(e).answered), false)
check('the answered call produces at least one',
  [createInternal, answerInternal, createExternal, answerExternal, bridge, hangupComplete]
    .some((e) => parseCallEvent(e).answered), true)

/* ---- tying events to one call ---- */
check('every event of one call shares an externalId',
  new Set([createInternal, answerInternal, createExternal, answerExternal, bridge, hangupComplete]
    .map((e) => parseCallEvent(e).externalId)).size, 1)
check('...which is the call id', parseCallEvent(bridge).externalId, CALL)
check('the two legs have different internalIds',
  parseCallEvent(answerInternal).internalId !== parseCallEvent(answerExternal).internalId, true)
check('a different call has a different externalId',
  parseCallEvent(rangOut).externalId === CALL, false)

/* ---- finding the debtor's number ---- */
check('the debtor leg names the number', parseCallEvent(answerExternal).number, '0832573344')
check('a bridge names it on the b-leg', parseCallEvent(bridge).number, '0832573344')
check('CHANNEL_CREATE on the debtor leg names it', parseCallEvent(createExternal).number, '0832573344')
// The trap: destination on the extension's leg is the extension. Reading it as a number would
// attach the call to whichever debtor happens to have 141 in their phone number.
check('the extension leg does NOT report 141 as the debtor’s number',
  parseCallEvent(createInternal).number, null)
check('nor does a hangup on the extension leg', parseCallEvent(hangupComplete).number, null)

/* ---- finding the collector ---- */
check('the extension is read off the channel', parseCallEvent(createInternal).extension, '141')
check('...and off a bridge’s a-leg', parseCallEvent(bridge).extension, '141')
check('the debtor leg has no extension', parseCallEvent(answerExternal).extension, null)

/* ---- matching two spellings of one number ---- */
// We dial E.164 without the plus; BuzzBox reports the local form. Neither string equals the other.
check('E.164 and local forms share a tail', numberTail('27832573344'), numberTail('0832573344'))
check('...and so does the pretty form', numberTail('+27 83 257 3344'), '832573344')
check('the tail is nine digits', numberTail('0832573344'), '832573344')
check('two different numbers do not collide', numberTail('0832573344') === numberTail('0832573345'), false)
check('an extension is not a number', numberTail('141'), null)
check('nothing is not a number', numberTail(null), null)
check('an empty string is not a number', numberTail(''), null)

/* ---- when it happened ---- */
check('nanoseconds are trimmed to something Date accepts',
  parseCallEvent(bridge).at, '2026-09-12T08:38:20.311Z')
check('and the hangup is four seconds later',
  Math.round((Date.parse(parseCallEvent(hangupComplete).at) - Date.parse(parseCallEvent(bridge).at)) / 1000), 4)
check('an unparseable clock is null, never "now"',
  parseCallEvent({ event: 'X', bbEventTimeStamp: 'not a date' }).at, null)

/* ---- the end of a call ---- */
check('a hangup-complete ends the call', parseCallEvent(hangupComplete).ended, true)
check('...and carries why', parseCallEvent(hangupComplete).hangupCause, 'NORMAL_CLEARING')
check('a call that rang out says so', parseCallEvent(rangOut).hangupCause, 'NO_USER_RESPONSE')
check('a bridge does not end anything', parseCallEvent(bridge).ended, false)

/* ---- rubbish in ---- */
// This endpoint is open to the internet. Nothing it is sent may throw.
for (const junk of [null, undefined, {}, [], 'hello', 42, { eventAvps: 'not an array' },
  { event: 'CHANNEL_BRIDGE', eventAvps: [null, { att: 'state' }] }]) {
  try {
    const e = parseCallEvent(junk)
    check(`junk ${JSON.stringify(junk)} parses to something safe`,
      [typeof e.event, e.externalId, e.number].slice(0, 1), ['string'])
  } catch (err) {
    failures.push(`junk ${JSON.stringify(junk)} threw: ${err.message}`)
  }
}
check('an empty payload claims nothing was answered', parseCallEvent({}).answered, false)
check('...and names no number', parseCallEvent({}).number, null)

/* ---- the small parsers, directly ---- */
check('external leg number', externalLegNumber('sofia/external/0832573344'), '0832573344')
check('internal leg extension', internalLegExtension('sofia/internal/141@41.133.90.117:60500'), '141')
check('an internal channel is not an external one', externalLegNumber('sofia/internal/141@x'), null)
check('an external channel has no extension', internalLegExtension('sofia/external/0832573344'), null)

console.log(`\n${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  FAIL ${f}`)
process.exit(failures.length ? 1 : 0)
