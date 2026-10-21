/**
 * Reading a delivery report and a reply from Connect Mobile.
 *
 * WHY THIS EXISTS. The callback readers were built before the provider would tell us their field
 * names, so they look under every spelling a provider plausibly uses. That was the right call and
 * it still very nearly failed: on 14 September 2026 Jacques at Connect Mobile confirmed the
 * identifier comes back as `userid` — one word — and the list had `user_id` with an underscore
 * and not the other. Every real delivery report would have matched nothing, no message would have
 * moved off "sent", and the only symptom would have been an absence.
 *
 * So the shapes below are not invented. They are built from what Connect Mobile stated:
 *
 *   submit   .../submit/single/?api_token=xxx&da=27835550344&ud=Hello+World&id=01
 *   DLR      the same id comes back in `userid`, with a delivery status
 *   MO       look for `userid`, and `ud` is the customer's reply
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-sms-callbacks.mjs
 */
import {
  params, pick, deliveryStatus,
  REFERENCE_KEYS, MSISDN_KEYS, TEXT_KEYS, STATUS_KEYS,
} from '../../api/_lib/sms/inbound.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) pass += 1
  else failures.push(`${name}\n     got      ${a}\n     expected ${e}`)
}
const ok = (name, cond) => { if (cond) pass += 1; else failures.push(name) }

/** A Vercel-shaped request from a query string, which is how Connect Mobile calls a GET endpoint. */
const get = (qs) => ({ query: Object.fromEntries(new URLSearchParams(qs)), body: undefined })
const post = (body) => ({ query: {}, body })

/* ---------- 1. the spelling that nearly broke it ---------- */

const dlr = get('userid=bfm1abcd2efg&status=DELIVRD&da=27835550344&ts=2026-09-14T09:31:00')
check('a delivery report is read at all', pick(params(dlr), REFERENCE_KEYS), 'bfm1abcd2efg')
check('and its status is understood', deliveryStatus(pick(params(dlr), STATUS_KEYS)), 'delivered')

const mo = get('userid=bfm1abcd2efg&sa=27835550344&ud=Please+stop+calling+me')
check('a reply carries our reference', pick(params(mo), REFERENCE_KEYS), 'bfm1abcd2efg')
check('a reply carries the number', pick(params(mo), MSISDN_KEYS), '27835550344')
check('a reply carries the words', pick(params(mo), TEXT_KEYS), 'Please stop calling me')

// The guard on the guard: `userid` must be in the list, not merely happen to be found. If a
// future tidy-up removes it, this says so in words rather than through a mysterious mismatch.
ok("'userid' is a reference key — Connect Mobile's own spelling", REFERENCE_KEYS.includes('userid'))
ok("'ud' is a text key — Connect Mobile's own spelling", TEXT_KEYS.includes('ud'))
ok("'da' is a number key — Connect Mobile's own spelling", MSISDN_KEYS.includes('da'))

/* ---------- 2. it still reads the spellings we guessed ---------- */

check('plain id still works', pick(params(get('id=abc&status=DELIVRD')), REFERENCE_KEYS), 'abc')
check('user_id still works', pick(params(get('user_id=abc')), REFERENCE_KEYS), 'abc')
check('reference still works', pick(params(get('reference=abc')), REFERENCE_KEYS), 'abc')

// Case must not matter: a provider that sends UserID is the same provider.
check('UserID is read', pick(params(get('UserID=abc')), REFERENCE_KEYS), 'abc')
check('USERID is read', pick(params(get('USERID=abc')), REFERENCE_KEYS), 'abc')
check('UD is read', pick(params(get('UD=hello')), TEXT_KEYS), 'hello')

/* ---------- 3. either transport ---------- */

check('a form POST is read', pick(params(post('userid=abc&ud=hi')), REFERENCE_KEYS), 'abc')
check('a JSON POST is read', pick(params(post('{"userid":"abc","ud":"hi"}')), REFERENCE_KEYS), 'abc')
check('an object body is read', pick(params(post({ userid: 'abc' })), REFERENCE_KEYS), 'abc')
// A provider may send both; the query string is added first and the body must not blank it.
check('a numeric value survives', pick(params(post({ userid: 12345 })), REFERENCE_KEYS), '12345')

/* ---------- 4. nothing is invented from nothing ---------- */

check('an empty callback matches nothing', pick(params(get('')), REFERENCE_KEYS), null)
check('an empty value is not a reference', pick(params(get('userid=')), REFERENCE_KEYS), null)
check('an unknown field is ignored', pick(params(get('whatever=abc')), REFERENCE_KEYS), null)

/*
 * An unrecognised status leaves the message where it was.
 *
 * Deliberate and worth protecting: telling a collector a message failed when it did not is worse
 * than telling them nothing, because they will send it again and charge the debtor twice.
 */
check('an unknown status changes nothing', deliveryStatus('WHO KNOWS'), null)
check('a missing status changes nothing', deliveryStatus(null), null)

/* ---------- report ---------- */

if (failures.length) {
  console.error(`FAIL — ${failures.length} of ${pass + failures.length} checks\n`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
/*
 * THE LINE run-all.mjs READS. A file that prints no count is counted as ZERO in the
 * headline and is indistinguishable from a healthy one -- a review of this suite found 20
 * files silent that way, about 800 assertion sites reported as nothing.
 */
console.log(`${pass} passed, 0 failed`)
console.log(`PASS — ${pass} checks: a Connect Mobile delivery report and reply are read from the`)
console.log("       field names they actually use ('userid', 'ud', 'da'), on GET or POST.")
