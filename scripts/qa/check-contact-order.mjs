/**
 * WHICH OF A DEBTOR'S TWO EMAIL ADDRESSES YOU SEE MUST NOT BE LUCK.
 *
 * THE DAY THIS WAS FOUND. The firm opened an account, changed its email address, saved, and a
 * COMPLETELY DIFFERENT address appeared in the box. Nothing had been lost — what they typed was
 * on the account — and nothing had gone wrong with the write. The account simply had two email
 * addresses, the panel had one slot, and the slot showed whichever row came back first.
 *
 * AND "FIRST" WAS THE PHYSICAL ORDER OF THE TABLE. The query sorted on is_primary alone; neither
 * address was primary, so they tied, and Postgres returns tied rows in whatever order they happen
 * to sit in. An UPDATE writes a new tuple at the END of the table — so the act of saving one
 * address pushed it behind the other, and the panel swapped to showing its neighbour.
 *
 * TWO THINGS FIX IT AND BOTH ARE HELD HERE:
 *   - THE ORDER IS DECIDED, primary first and then oldest, so the same row comes back every time.
 *   - EVERY ADDRESS IS DRAWN. The firm: "if a debtor has more than one email address, it should be
 *     shown. It's important. If they have, for example, a work and a personal one." 105 accounts
 *     on the book carry more than one, and each had one that could not be seen at all.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-contact-order.mjs
 */
import { readFileSync } from 'node:fs'
import { debtorSlots } from '../../src/lib/debtorSlots.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  if (Object.is(actual, expected)) { pass += 1; return }
  failures.push(`${name}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`)
}
const ok = (name, actual) => check(name, actual, true)
/* Object.is above compares identity, so two equal arrays are never equal to it. */
const same = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')

const store = read('../../src/lib/accountWorkspace.ts')
const panel = read('../../src/pages/accounts/AccountWorkspacePanels.tsx')

/* Asserted present before anything about their contents, or a deleted file passes vacuously. */
ok('the workspace reader is there to read', store.length > 1000)
ok('the debtor panel is there to read', panel.length > 1000)

/* ------------------------------------------------ the order is decided */

/*
 * PRIMARY FIRST — the one the Call button dials — AND THEN OLDEST. created_at is the tiebreak
 * because it is the only thing about a contact that never moves: the value changes, the label
 * changes, is_primary changes, and the row's place in the heap changes every time any of them do.
 */
const contactsAt = store.indexOf("from('account_contacts').select('*')")
ok('the contacts are read at all', contactsAt > 0)
const clause = store.slice(contactsAt, contactsAt + 260)
ok('...primary first', /\.order\('is_primary', \{ ascending: false \}\)/.test(clause))
ok('...and oldest after that, so nothing ties', /\.order\('created_at', \{ ascending: true \}\)/.test(clause))
/*
 * AND THE REASON IS WRITTEN DOWN WHERE THE CLAUSE IS. A second sort key looks like tidiness and
 * gets removed by somebody tidying; the sentence that stops that is the one naming what happened.
 */
ok('...with the reason it is not tidiness', /in whatever physical order they happen to sit in/.test(store))

/* ------------------------------------------------ every address is drawn */

/*
 * NOT COUNTED IN REGEXES ANY MORE. The slots used to be read out of the panel's source -- "the
 * first email is the slot, emails.slice(1) is the list" -- which held while the rule was one line
 * of JSX. The firm then asked for the second address to have a SLOT of its own ("so an email
 * address, there should be a second, an alternative email address"), and the question stopped
 * being about one list: four addresses now land in three places, and what matters is that between
 * them they account for all four and none of them twice.
 *
 * debtorSlots is where that is decided, so it is where it is checked. Nothing here says which
 * rows the panel draws; it says no row can fall between the slots and the list under them, which
 * is the failure the firm reported -- an address that could not be seen on this screen at all.
 */
const c = (id, kind, extra = {}) =>
  ({ id, kind, value: `${id}@x.co.za`, isPrimary: false, label: null, personName: null,
    personRole: null, verifiedAt: null, retiredAt: null, retiredReason: null, notes: null,
    accountId: 'a', createdAt: '2026-01-01', ...extra })

const four = [c('e1', 'email'), c('e2', 'email'), c('e3', 'email'), c('e4', 'email')]
const s4 = debtorSlots(four)
same('the first two addresses take the two slots',
  [s4.email?.id, s4.altEmail?.id], ['e1', 'e2'])
same('...and the rest are drawn under them', s4.otherEmails.map((x) => x.id), ['e3', 'e4'])
/* THE WHOLE ACCOUNT, ONCE EACH -- the assertion the regexes could not make. */
const drawn = [s4.email, s4.altEmail, ...s4.otherEmails].map((x) => x.id)
same('...so every address on the account is somewhere', drawn.sort(), ['e1', 'e2', 'e3', 'e4'])
check('...and none of them twice', drawn.length, new Set(drawn).size)
/* THE MARKED ONE LEADS WHEREVER IT SITS. Primary first is the query's order and the flag is the
   only thing on the account somebody chose, so the slot reads it rather than trusting the sort. */
check('the primary address leads even when it is not first',
  debtorSlots([c('e1', 'email'), c('e2', 'email', { isPrimary: true })]).email?.id, 'e2')

/* AND THE NUMBERS, THE SAME WAY. Three kinds, three slots, everything else under them. */
const numbers = [c('m1', 'mobile'), c('m2', 'mobile'), c('m3', 'mobile'),
  c('w1', 'work'), c('h1', 'phone')]
const sn = debtorSlots(numbers)
same('the two mobiles take the two mobile slots',
  [sn.primaryMobile?.id, sn.secondMobile?.id], ['m1', 'm2'])
check('...the work line takes its own', sn.workNumber?.id, 'w1')
/* THE HOME LINE KEEPS ITS PLACE. The firm: "I'd say a work number, because nobody has a home
   number anymore" -- and the book disagrees politely, so it is listed rather than given a slot. */
same('...and the third mobile and the home line are still drawn',
  sn.otherNumbers.map((x) => x.id).sort(), ['h1', 'm3'])
const dialled = [sn.primaryMobile, sn.secondMobile, sn.workNumber, ...sn.otherNumbers].map((x) => x.id)
check('...so every number is somewhere, once', dialled.length, new Set(dialled).size)
/* A RETIRED ROW IS NOT A SLOT'S CONTENTS. The panel hands in the live list only -- a retired
   number sitting in "Mobile (Primary)" is a collector dialling a line the firm knows is dead. */
check('a slot is empty rather than filled with something nobody should use',
  debtorSlots([]).primaryMobile, null)

/* ------------------------------------------------ and the panel draws what it is given */

ok('the panel lays the slots out with that rule', /const slots = debtorSlots\(live\)/.test(panel))
ok('...and draws what fell outside them', /slots\.otherNumbers\.map/.test(panel)
  && /slots\.otherEmails\.map/.test(panel))
ok('...under one heading, which is what the firm asked for',
  /Anything else on file/.test(panel))
/*
 * NOT ON A COMPANY. A company's addresses and numbers belong to named people and are already
 * listed under whoever they belong to — the same rule that keeps "Residential address" off a
 * company.
 */
ok('...and not on a company, whose contacts belong to people',
  /\{!isCompany && \(slots\.otherEmails\.length > 0 \|\| slots\.otherNumbers\.length > 0\) && \(/.test(panel))
/* Still one press to write to any of them: an address you can see and cannot use is half a fix. */
ok('...each of them still opens a compose', /onOpen=\{\(\) => onEmail\(c\.value\)\}/.test(panel))

/* ------------------------------------------------------------------ */

for (const f of failures) console.error(`  ✗ ${f}`)
console.log(`check-contact-order: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
