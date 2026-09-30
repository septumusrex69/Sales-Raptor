/**
 * THE FINANCE SECTION IS ADMINISTRATOR ONLY, AND THAT HAS TO BE TRUE IN THE DATABASE.
 *
 * THE FIRM: "The Finance section is Administrator only. Sales representatives never see the
 * payment split." `payover.ts` states the guarantee in its own header and says exactly why the
 * browser cannot be where it lives: "a route guard in the browser is a courtesy, not a boundary."
 *
 * WHAT THIS EXISTS BECAUSE OF. An audit found NINE of the fifteen finance RPCs were
 * `security definer` with no role check of any kind, and every one of the fifteen had EXECUTE
 * granted to `anon` -- the UNAUTHENTICATED PostgREST role, which is Supabase's default on the
 * public schema. `preview_allocation` returns the payment split. The three state transitions
 * authorise and record paying a client. `reallocate_account` DELETES payment_allocations rows.
 *
 * AND THE SUITE READ AS THOUGH IT WERE COVERED. check-payover-runs asserts the row-level security
 * POLICIES on the payover tables restrict reads to an Administrator -- which is true, and which a
 * definer function bypasses entirely, because definer runs as the owner and policies do not
 * apply. Removing the guard from a function that had one left all 11 091 checks green. THAT IS
 * THE SHAPE TO WATCH FOR ELSEWHERE: a check on one enforcement layer reading as a guarantee about
 * the feature.
 *
 * THE LIST COMES FROM payover.ts's OWN `.rpc(...)` CALLS, not from a list written here. A finance
 * function added tomorrow is covered the moment the browser calls it, which is the only moment it
 * can be reached -- a hand-kept list in a check file is a list that goes stale silently, and this
 * finding is what that looks like.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-finance-is-administrator-only.mjs
 */
import { readFileSync } from 'node:fs'
import { ROLE_CAPABILITIES } from '../../src/lib/capabilities.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

const sql = read('supabase/schema.sql')
const payover = read('src/lib/payover.ts')

/* ---------------- what the Finance screens actually call ---------------- */

/*
 * EVERY RPC NAME payover.ts ASKS FOR. Read from the source rather than listed here, so the check
 * cannot fall behind the thing it guards. Comments are stripped first: this file explains what it
 * calls at length, and a grep cannot tell the explanation from the call.
 */
const code = payover.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const called = [...new Set([...code.matchAll(/\.rpc\(\s*'([a-z0-9_]+)'/g)].map((m) => m[1]))].sort()

ok('the Finance library calls some RPCs at all', called.length >= 10)
/* A SANITY FLOOR. If a refactor moved these calls behind a helper, `called` would go empty and
   every assertion below would pass over nothing -- the vacuous-pass trap, which is how a check
   survives the deletion of what it guards. */
ok('...enough of them that the list is really being read', called.length >= 14)

/* ---------------- each one is Administrator-only, in the database ---------------- */

/*
 * schema.sql IS APPEND-ONLY, SO THE LAST DEFINITION IS THE LIVE ONE. Nine of these appear twice:
 * once as originally written without a guard, and once with it. Reading with indexOf would assert
 * against the very definition this check exists because of.
 */
function liveBody(name) {
  /*
   * EITHER SPELLING. Most of these are `create or replace`, but a function whose OUT parameters
   * changed cannot be replaced -- Postgres refuses, because the parameters are part of the return
   * type -- so it is dropped and created plainly. `payover_run_payments` is one, and a check that
   * only knew the common spelling reported it missing rather than unguarded.
   */
  const at = Math.max(
    sql.lastIndexOf(`create or replace function public.${name}(`),
    sql.lastIndexOf(`create function public.${name}(`),
  )
  if (at < 0) return null
  const end = sql.indexOf('$$;', at)
  return end < 0 ? null : sql.slice(at, end + 3)
}

for (const fn of called) {
  const body = liveBody(fn)
  ok(`${fn} is defined in the schema`, body !== null)
  if (!body) continue

  /*
   * TWO SHAPES OF GUARD, BOTH ACCEPTED, because the codebase legitimately has both: a plpgsql
   * function RAISES, and a `sql` function that returns a set filters with a where clause. What is
   * not accepted is neither.
   */
  const raises = /is distinct from 'Administrator'/.test(body)
  const filters = /current_user_role\(\) = 'Administrator'/.test(body)
  /*
   * A THIRD SHAPE: DELEGATING TO A NAMED GUARD. `approve_payment` asks `may_approve_payment()`
   * rather than repeating the role test, which is better than inlining it -- one place decides
   * who may approve.
   *
   * THE DELEGATE IS VERIFIED, NOT TRUSTED BY NAME. Accepting any function call here would let
   * `if not some_helper()` pass while some_helper returned true for everybody; the chain only
   * counts if the thing at the end of it actually tests for Administrator. Held below.
   */
  /* Two forms of the same delegation, because the codebase legitimately has both: a plpgsql
     function REFUSES, and a `sql` function returning a set FILTERS -- the same split as the
     inline guards above. */
  const delegates = /if not public\.may_approve_payment\(\) then/.test(body)
    || /where public\.may_approve_payment\(\)/.test(body)
  /*
   * A FOURTH SHAPE, AND IT IS WHY THIS FILE CHANGED AT ALL: asking for a CAPABILITY. The firm
   * wanted Swordfish's model -- "you can choose, for example, for a user to have a management
   * template, but you can add them more functionality" -- and a hand-written role name is exactly
   * what a grant can never reach, so `reverse_payment` now asks `has_capability('payment.reverse')`
   * instead of comparing to 'Administrator'.
   *
   * VERIFIED THE SAME WAY THE DELEGATE IS, AND FOR THE SAME REASON. Accepting any has_capability()
   * call would let a function guard itself with a capability every role has. So the capability it
   * names must be one NO template but an Administrator's carries -- which is the same promise the
   * old grep made, checked where it is now actually decided.
   */
  const asked = /public\.has_capability\('([a-z_]+\.[a-z_]+)'\)/.exec(body)?.[1] ?? null
  const asksForAnAdministratorsCapability = !!asked && Object.entries(ROLE_CAPABILITIES)
    .filter(([, caps]) => caps.includes(asked)).map(([r]) => r).join() === 'Administrator'
  ok(`...and refuses anybody who is not an Administrator`,
    raises || filters || delegates || asksForAnAdministratorsCapability)

  /*
   * `is distinct from`, NEVER a bare `<>`. current_user_role() reads a row from profiles by
   * auth.uid(), so an unauthenticated caller gets NULL -- and `null <> 'Administrator'` evaluates
   * to NULL, which is not true, so an `if` written that way does not fire and the caller with NO
   * IDENTITY AT ALL is the one it lets through. This is the single most reversible line in the
   * whole guard and it fails open.
   */
  ok(`...comparing in a way that a null role cannot slip through`,
    !/current_user_role\(\)\s*<>\s*'Administrator'/.test(body))

  /*
   * AND NOBODY UNAUTHENTICATED REACHES IT AT ALL. Supabase grants EXECUTE on public-schema
   * functions to anon by default, so the revoke is not tidiness -- it is the difference between a
   * finance function that refuses a stranger and one a stranger cannot call.
   */
  ok(`...and anon cannot execute it`,
    new RegExp(`'${fn}\\(`).test(sql) && /revoke execute on function public\.%s from public, anon/.test(sql))
}

/*
 * AND THE GUARD IT DELEGATES TO REALLY IS THE ADMINISTRATOR TEST. This is the end of the chain:
 * every function that says `if not may_approve_payment()` is only as good as this one line, and
 * widening it would quietly widen all of them at once.
 */
const approveGuard = liveBody('may_approve_payment')
ok('the approval guard exists', approveGuard !== null)
/*
 * THE END OF THE CHAIN MOVED, AND THE ASSERTION MOVED WITH IT RATHER THAN BEING DROPPED.
 *
 * This read `current_user_role() = 'Administrator'` literally. It now asks for a capability --
 * the firm wanted Swordfish's shape, "you can add them more functionality", and a hand-written
 * role name is the one thing a grant can never reach.
 *
 * WHAT THE OLD LINE WAS PROTECTING IS UNCHANGED and is now asserted in the place that actually
 * decides it: approving a payment must be in NO role's template except an Administrator's. That
 * is a stronger test than the old one, because it also catches somebody quietly adding
 * payment.approve to the Liaison template -- which the old grep could never have seen.
 */
ok('...and it asks for a capability', /has_capability\('payment\.approve'\)/.test(approveGuard ?? ''))
ok('...with no role name left beside it', !/current_user_role\(\)/.test(approveGuard ?? ''))
check('...and no template but an Administrator\u2019s carries it',
  Object.entries(ROLE_CAPABILITIES)
    .filter(([, caps]) => caps.includes('payment.approve')).map(([r]) => r),
  ['Administrator'])
/*
 * AND IT STILL FAILS CLOSED ON NOBODY. The old note here was about `is distinct from` rather than
 * a bare `<>`, because current_user_role() is NULL for an unauthenticated caller and `null <> x`
 * is NULL, which is not true but is also not a refusal. has_capability answers through an
 * `exists` over profiles keyed on auth.uid(), so no session means no row means false.
 */
ok('...answering false when nobody is signed in',
  /exists \(\s*select 1 from public\.profiles p/.test(liveBody('has_capability') ?? ''))
ok('...keyed on the caller', /p\.id = auth\.uid\(\)/.test(liveBody('has_capability') ?? ''))

/* ---------------- the revoke really is applied over the whole list ---------------- */

const revokeAt = sql.lastIndexOf("revoke execute on function public.%s from public, anon")
ok('the revoke is applied by the loop', revokeAt > 0)
const revokeBlock = revokeAt > 0 ? sql.slice(sql.lastIndexOf('foreach fn in array array[', revokeAt), revokeAt) : ''
for (const fn of called) {
  ok(`${fn} is in the revoke list`, new RegExp(`'${fn}\\(`).test(revokeBlock))
}

/* ---------------- and the guarantee is still written down ---------------- */

/* THE SOURCE CLAIMS IT IN PROSE. If somebody removes the claim they should be made to remove the
   check with it, rather than leaving a file that promises something nothing enforces. */
ok('the Finance library still claims to be Administrator only',
  /Administrator only/i.test(payover))
ok('...and still says why the browser is not where it lives',
  /courtesy, not a boundary/i.test(payover))

console.log(`\ncheck-finance-is-administrator-only: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
