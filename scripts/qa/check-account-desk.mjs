/**
 * THE BAND NAMES WHO HOLDS THE ACCOUNT, AND IS THE WAY TO CHANGE IT.
 *
 * The firm, pointing at the top right of an account: "if I'm an administrator and I want to
 * reassign an account, I can click there and say reassign and diarise ... allocate and refer."
 *
 * TWO THINGS WERE WRONG AND ONLY ONE OF THEM WAS MISSING.
 *
 * The name was the wrong name. It read `swordfishAssignedTo` -- the free-text name off the
 * legacy book -- and not `assignedTo`, the clerk the account is on in Raptor. On the staging book
 * that is 20 302 accounts with a real clerk reading "Unassigned", and 670 more where the band
 * named a DIFFERENT person from the one holding the file. Allocating, the diary, the workflow and
 * every desk list turn on `assigned_to`; the one line a person actually looks at did not.
 *
 * WHAT THIS GUARDS:
 *
 *   - THE BAND READS THE COLUMN THE REST OF THE SYSTEM USES. Not the Swordfish name, ever.
 *   - IT IS THE SAME ASSIGN-AND-REFER SCREEN. A third allocation form would be the third place
 *     the rule "allocating always diarises" has to be remembered.
 *   - ONE PERMISSION, NOT TWO. Who may hand out was a bare array inside AccountsList; the account
 *     screen needed the same answer, and a permission written twice is enforced once.
 *   - AND THE PRE-LEGAL TEAM LEADER IS IN IT. canReassign is the sales test and leaves them out --
 *     they are precisely the person who shares the collections floor's work out.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-account-desk.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { canHandOutAccounts, canReassign } from '../../src/lib/permissions.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '')

/**
 * Source with the comments taken out.
 *
 * The comment explaining this necessarily QUOTES the field it replaced -- "it read
 * swordfishAssignedTo" is in the very block that stopped reading it -- so a search over raw
 * source reports the explanation as the offence. check-day-unit hit this first.
 */
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const detail = read('src/pages/accounts/AccountDetail.tsx')
const list = read('src/pages/accounts/AccountsList.tsx')
const book = read('src/lib/accountBook.ts')

ok('the account screen is readable at all', detail.length > 0)
ok('the accounts list is readable at all', list.length > 0)

/* ------------------------------------------------ one permission, run rather than read */

check('an administrator may hand out', canHandOutAccounts({ role: 'Administrator' }), true)
/*
 * THE ONE canReassign LEAVES OUT, and the reason this function had to exist. Asserted against
 * canReassign directly so the two cannot quietly converge and make this test vacuous.
 */
check('a pre-legal team leader may hand out', canHandOutAccounts({ role: 'Pre-legal Team Leader' }), true)
check('...which is exactly what canReassign refuses', canReassign({ role: 'Pre-legal Team Leader' }), false)
check('a collector may not hand out', canHandOutAccounts({ role: 'Pre-legal Agent' }), false)
check('nobody signed in may not hand out', canHandOutAccounts(undefined), false)

/* Written once. The array this replaced lived in AccountsList and the account screen could not
   see it, which is how the list would offer a team leader the action and the account screen
   would not -- for the same action on the same account. */
ok('the accounts list asks the shared test', /canHandOutAccounts\(currentUser\)/.test(list))
ok('...and no longer keeps its own list of roles', !/CAN_SEE_OTHER_DESKS/.test(list))
ok('the account screen asks the same one', /canHandOutAccounts\(currentUser\)/.test(detail))

/* ------------------------------------------------ the band names the right person */

/*
 * THE COLUMN THE REST OF THE SYSTEM TURNS ON. Asserted as the rule -- the Swordfish name appears
 * nowhere on the screen -- rather than by checking one line, because the failure mode was a line
 * that looked entirely reasonable.
 */
ok('the band never shows the legacy Swordfish name', !/swordfishAssignedTo/.test(code(detail)))
ok('...it resolves the clerk the account is actually on', /users\.find\(\(u\) => u\.id === account\.assignedTo\)/.test(detail))
/*
 * AND SAYS SOMETHING WHEN THE CLERK IS GONE. A profile that no longer exists must not read as
 * "Unassigned" -- the account IS on somebody's desk, and a leader looking for accounts to
 * redistribute would never see it.
 */
ok('...and an account held by somebody no longer here does not read as unassigned',
  /Someone no longer here/.test(detail))
ok('...while genuinely nobody still reads as Unassigned', /'Unassigned'/.test(detail))
/* The field is still mapped off the row -- it is what was imported, and imported history is
   frozen. It simply is not what the band asks. */
ok('the imported name is still carried on the account', /swordfishAssignedTo: r\.swordfish_assigned_to/.test(book))

/* ------------------------------------------------ and it is the control */

const heroAt = detail.indexOf('Pre-legal agent</p>')
ok('the band is where this check thinks it is', heroAt > 0)
const band = detail.slice(heroAt, heroAt + 1200)
ok('the name itself opens the screen', /onClick=\{\(\) => setHandOut\(true\)\}/.test(band))
/* Only for somebody entitled to do it. A disabled-looking button that refuses on click is worse
   than no button: it reads as a fault in the app rather than as a permission. */
ok('...and only for somebody who may hand out', /mayHandOut \?/.test(band))
ok('...with the plain name shown to everybody else', /<p className="text-sm font-semibold text-white">\{assignedName/.test(band))

ok('the account screen opens the shared screen', /<HandOutModal/.test(detail))
ok('...imported rather than copied', /import \{ HandOutModal \} from '\.\/HandOutModal'/.test(detail))
ok('...on exactly this account', /kind: 'ids', ids: \[account\.id\]/.test(detail))
/*
 * AND THE SCREEN IS THE ONLY THING THAT ALLOCATES. An account screen that wrote assigned_to
 * itself would be a way to put somebody on a desk with nobody booked to ring it.
 */
ok('the account screen never writes an allocation itself', !/assigned_to:/.test(code(detail)))
/*
 * RE-READ AFTERWARDS. The diary entry, the position and half the band are derived from the
 * allocation, so patching the row in place would leave the screen disagreeing with the book.
 */
ok('the account is re-read once it has been handed out',
  /setHandOut\(false\)[\s\S]{0,400}?await reload\(\)/.test(detail))

/* ---------------- one refresh, everything on the account ---------------- */

/*
 * THE FIRM: "the stuff comes once you refresh. It shouldn't be like that. It should load
 * immediately and be available immediately. Otherwise you're missing things."
 *
 * `reload` is the callback every action panel on the account is given -- the promise, the
 * escalation, the payment, the note, the documents. It refetched the account, the ledgers, the
 * workspace, the documents, the queries, the emails, the standing and the traces, and NOT the runs.
 *
 * WHICH IS THE ONE THING THOSE ACTIONS MOVE. Recording a promise starts the arrangement sequence
 * and pauses the section 129. Escalating a dispute pauses it. A payment can end it. So a collector
 * took an action, watched the panel above it update, and the Workflow tab went on showing what was
 * true a minute ago -- including the dot on the tab, which counts what is waiting on a person.
 *
 * ASSERTED ON THE CALL AND ON THE DEPENDENCY, because a useCallback that closes over a stale
 * loadRuns refetches nothing and the compiler says nothing about it.
 */
ok('a reload of the account brings its workflows with it', /loadRuns\(\),/.test(detail))
ok('...and the callback is rebuilt when it changes', /\}, \[account, loadRuns\]\)/.test(detail))

/*
 * AND IT GOES THE OTHER WAY TOO, WHICH WAS THE HALF LEFT STANDING.
 *
 * THE FIRM, ON THE SAME COMPLAINT A SECOND TIME: "when I started the workflow for the section 129,
 * the charges didn't go... it didn't show it immediately." The charges HAD gone -- R25 under item
 * 1(a) and R3.50 under item 1(c), both on the account within five seconds of the press. What had
 * not happened is that the panel refreshed the RUNS and nothing else, so the transactions list,
 * the balance, the settlement figure, the emails tab and the timeline all went on describing an
 * account to which no demand had been issued.
 *
 * A WORKFLOW ACTION IS NOT A WORKFLOW-ONLY ACTION. Starting a sequence or releasing a held step
 * sends an email, sends an SMS, raises two Annexure B fees, files a Sent copy and writes a note.
 * Six panels move and one was being told.
 *
 * SO BOTH DIRECTIONS GO THROUGH `reload`, which is the only arrangement where they cannot drift
 * apart again -- fixing one end and leaving the other is exactly what happened here.
 */
ok('...and a workflow action refreshes the whole account', /onChanged={reload}/.test(detail))
ok('...not only its own runs', !/onChanged={loadRuns}/.test(detail))

/* ------------------------------------------------ */

for (const f of failures) console.error(`  ✗ ${f}`)
console.log(`check-account-desk: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
