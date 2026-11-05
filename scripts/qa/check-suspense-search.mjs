/**
 * SEARCHING SUSPENSE (Raptor · Handover 17, S18). A search that misses the receipt somebody is holding
 * the proof of payment for says "it is not in suspense", which is the wrong answer this exists to stop.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-suspense-search.mjs
 */
import { readFileSync } from 'node:fs'
import { queryTerms, suspenseMatches, EMPTY_SUSPENSE_QUERY } from '../../src/lib/suspenseSearch.ts'

let pass = 0
const failures = []
const check = (n, a, e) => { if (Object.is(a, e)) pass += 1; else failures.push(`${n}: expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`) }
const ok = (n, a) => check(n, a, true)
const no = (n, a) => check(n, a, false)

const row = { date: '2026-10-22', amount: 6000, words: ['CAPITEC   CPK10069', 'CPK10069', null] }
const q = (text, from = null, to = null) => ({ text, from, to })

ok('nothing typed matches everything', suspenseMatches(row, EMPTY_SUSPENSE_QUERY))
ok('the amount as typed plainly', suspenseMatches(row, q('6000')))
ok('...as the firm writes it', suspenseMatches(row, q('R 6 000,00')))
ok('...as a bank app writes it', suspenseMatches(row, q('6,000.00')))
no('...and not a different amount', suspenseMatches(row, q('600')))
check('an amount with spaces is one term', queryTerms('R 6 000,00').length, 1)
ok('a word from the bank’s description, any case', suspenseMatches(row, q('capitec')))
ok('the reference', suspenseMatches(row, q('cpk10069')))
ok('every word must be there', suspenseMatches(row, q('capitec cpk10069')))
no('...so a word that is not there narrows it out', suspenseMatches(row, q('capitec absa')))
ok('a digits-only reference that is not the amount still finds the text', suspenseMatches(row, q('10069')))
ok('on the day', suspenseMatches(row, q('', '2026-10-22', '2026-10-22')))
no('before the from day', suspenseMatches(row, q('', '2026-10-23')))
no('after the to day', suspenseMatches(row, q('', null, '2026-10-21')))
ok('a timestamp is read as its day', suspenseMatches({ ...row, date: '2026-10-22T22:00:00Z' }, q('', '2026-10-22', '2026-10-22')))
ok('a reference typed without its dash', suspenseMatches({ ...row, words: ['RAP-125310'] }, q('rap125310')))

const page = readFileSync(new URL('../../src/pages/finance/UnallocatedReceipts.tsx', import.meta.url), 'utf8')
ok('all three suspense lists are searched', ['shownRows.map', 'shownSuspended.map', 'shownParked.map'].every((s) => page.includes(s)))
no('...and none still draws its unfiltered list', /\{(rows|suspended|parked)\.map\(/.test(page))
ok('an empty result says the search found nothing, not that suspense is empty', page.includes('matches the search'))

console.log(`${pass} passed, ${failures.length} failed`)
if (failures.length) { for (const f of failures) console.log(`  FAIL ${f}`); process.exit(1) }
