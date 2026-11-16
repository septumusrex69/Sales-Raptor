/**
 * A PAYOVER RUN'S BLOCKERS EACH LINK TO THE PLACE THAT PUTS THEM RIGHT (Raptor H19, 16 Nov).
 *
 * The run page offered one link, "Work through the exceptions", under every blocker. A run held by a
 * receipt waiting for approval sent Stephan to To sort, which never lists one, and he found nothing
 * there. src/lib/runBlockers.ts now names a place per kind; this holds that list to the kinds
 * payover_run_blockers can actually return (the LAST definition in schema.sql), in both directions,
 * and the run page to using it rather than a fixed link.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-run-blocker-links.mjs
 */
import { readFileSync } from 'node:fs'
import { blockerAction, blockerActions } from '../../src/lib/runBlockers.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, v) => check(name, v, true)

const sql = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8')
const at = sql.toLowerCase().lastIndexOf('create or replace function public.payover_run_blockers(')
ok('payover_run_blockers is in schema.sql', at >= 0)
const m = /\bas\s+\$(\w*)\$([\s\S]*?)\$\1\$/i.exec(sql.slice(Math.max(at, 0)))
const body = m?.[2] ?? ''
const kinds = [...new Set([...body.matchAll(/select\s+'([a-z_]+)'\s*,/g)].map((x) => x[1]))].sort()
ok('the reader finds the blocker kinds (sanity)', kinds.length >= 4)

// Both directions: every kind the database returns has a place, and no place is kept for a kind it cannot return.
check('every blocker kind has a link', kinds.filter((k) => !blockerAction(k, 'c1')), [])
const known = ['awaiting_approval', 'excess_credit', 'needs_rate', 'no_client_code']
check('...and no link is kept for a kind the database cannot return', known.filter((k) => !kinds.includes(k)), [])

// The case that was wrong, and the one that was right.
check('a receipt waiting for approval goes to Payments in, NOT To sort', blockerAction('awaiting_approval', 'c1')?.to, '/trust/payments')
check('an undecided credit goes to To sort', blockerAction('excess_credit', 'c1')?.to, '/trust/exceptions')
check('a missing rate or code goes to that client', [blockerAction('needs_rate', 'c9')?.to, blockerAction('no_client_code', 'c9')?.to],
  ['/companies/c9', '/companies/c9'])
check('an unknown kind offers nothing rather than a wrong page', blockerAction('something_new', 'c1'), null)
check('two blockers that share a place give one link', blockerActions(['needs_rate', 'no_client_code', 'awaiting_approval'], 'c1').map((a) => a.to),
  ['/companies/c1', '/trust/payments'])

// The page uses the list, and the fixed link is gone.
const page = readFileSync(new URL('../../src/pages/finance/RunDetail.tsx', import.meta.url), 'utf8')
ok('the run page draws blockerActions', /blockerActions\(blockers\.map/.test(page))
ok('...and no longer sends every blocker to To sort', !/Work through the exceptions/.test(page))

if (failures.length) {
  console.error(`check-run-blocker-links: ${failures.length} failed, ${pass} passed\n  ${failures.join('\n  ')}`)
  process.exit(1)
}
console.log(`check-run-blocker-links: ${pass} passed, 0 failed`)
