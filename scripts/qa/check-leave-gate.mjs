/**
 * THE QUESTION AT THE DOOR OF AN ACCOUNT (S10, 22 Oct).
 *
 * The firm: leaving your own worked account for any screen asks for the next diary date -- and
 * refuses while it is today; a future date asks keep or move. Anybody else's account never stops
 * anybody, and diarising it offers "my diary or theirs" and tells the owner.
 *
 * Holds the rule (leavingAsk, every branch) and the wiring: a data router so a navigation can be
 * stopped at all, the page stopping only a change of PATH, one page life per account, the box
 * refusing today when a date is owed, the owner told.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-leave-gate.mjs
 */
import { readFileSync } from 'node:fs'
import { leavingAsk } from '../../src/lib/leavingAccount.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, v) => check(name, v, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '')

const today = '2026-10-22'
const base = { worked: true, mine: true, closed: false, inDiaryRun: false, entry: { dueOn: today, bookedThisVisit: false }, today }
check('their own worked account, due today: must give a later day', leavingAsk(base), 'must')
check('...due in the past: must', leavingAsk({ ...base, entry: { dueOn: '2026-10-20', bookedThisVisit: false } }), 'must')
check('...no date at all: must', leavingAsk({ ...base, entry: null }), 'must')
check('...a future date: keep or move', leavingAsk({ ...base, entry: { dueOn: '2026-10-30', bookedThisVisit: false } }), 'confirm')
check('...a future date booked this visit: nothing more to ask', leavingAsk({ ...base, entry: { dueOn: '2026-10-30', bookedThisVisit: true } }), 'none')
check('...today, even if booked this visit: still must', leavingAsk({ ...base, entry: { dueOn: today, bookedThisVisit: true } }), 'must')
check('only looked: nothing', leavingAsk({ ...base, worked: false }), 'none')
check('somebody else\'s account: never forced', leavingAsk({ ...base, mine: false }), 'none')
check('closed: nothing', leavingAsk({ ...base, closed: true }), 'none')
check('a diary run books its own next date: nothing', leavingAsk({ ...base, inDiaryRun: true }), 'none')

const main = strip(read('src/main.tsx'))
ok('a data router, or nothing can be stopped', /createBrowserRouter\(\[\{ path: '\*', element: <App \/>(, errorElement: <RouteError \/>)? \}\]\)/.test(main) && /<RouterProvider router=\{router\} \/>/.test(main) && !/<BrowserRouter>/.test(main))

const page = strip(read('src/pages/accounts/AccountDetail.tsx'))
ok('one page life per account', /return <AccountPage key=\{id\} \/>/.test(page))
ok('the page stops only a change of path, and only when there is a question',
  /useBlocker\(\(\{ currentLocation, nextLocation \}\) =>\s*ask !== 'none' && ownDate !== undefined && currentLocation\.pathname !== nextLocation\.pathname\)/.test(page))
ok('mine means on my desk', /mine: !!account && account\.assignedTo === currentUser\?\.id/.test(page))
ok('the diary run is told apart', /inDiaryRun: params\.get\('diary'\) !== null/.test(page))
ok('the gate\'s box insists on a later day when one is owed', /requireFuture=\{gateDiarising && ask === 'must'\}/.test(page))
ok('the box is told whose account it is', /accountHolder=\{account\.assignedTo/.test(page))

const box = strip(read('src/components/diary/DiariseModal.tsx'))
ok('the box refuses today when a later day is owed', /const tooSoon = !!requireFuture && mode === 'day' && dueOn <= today/.test(box) && /disabled=\{busy \|\| \(mode === 'today' && !remindAt\) \|\| tooSoon\}/.test(box))
ok('...and offers no reminder instead', /\{!requireFuture && \(/.test(box))
ok('somebody else\'s account: my diary or theirs', /const ownerId = someoneElses && forHolder \? accountHolder\.id/.test(box) && /data-testid="diarise-whose"/.test(box))
ok('...and the owner is told', /if \(someoneElses && accountHolder\)[\s\S]{0,200}rpc\('notify_user'[\s\S]{0,120}p_type: 'diary\.covered'/.test(box))

if (failures.length) {
  console.error(`check-leave-gate: ${failures.length} failed, ${pass} passed\n  ${failures.join('\n  ')}`)
  process.exit(1)
}
console.log(`check-leave-gate: ${pass} passed, 0 failed`)
