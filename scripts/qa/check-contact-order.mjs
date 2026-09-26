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

let pass = 0
const failures = []
function check(name, actual, expected) {
  if (Object.is(actual, expected)) { pass += 1; return }
  failures.push(`${name}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`)
}
const ok = (name, actual) => check(name, actual, true)
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
 * THE SLOT SHOWS ONE AND THE REST ARE DRAWN UNDER IT, which is exactly how the numbers already
 * worked — "Mobile (Primary)", "Alternative Number", then "Other numbers". An email had the first
 * of those and neither of the others.
 */
ok('every email on the account is collected', /const emails = live\.filter\(\(c\) => c\.kind === 'email'\)/.test(panel))
ok('...the slot shows the first', /const email = emails\[0\]/.test(panel))
ok('...and the rest are drawn', /emails\.length > 1 &&/.test(panel)
  && /Other email addresses/.test(panel))
ok('...all of them, not a second one only', /emails\.slice\(1\)\.map/.test(panel))
/*
 * NOT ON A COMPANY. A company's addresses belong to named people and are already listed under
 * whoever they belong to — the same rule that keeps "Residential address" off a company, and the
 * same rule the numbers below already follow.
 */
ok('...and not on a company, whose addresses belong to people',
  /\{!isCompany && emails\.length > 1 && \(/.test(panel))
/* Still one press to write to any of them: an address you can see and cannot use is half a fix. */
ok('...each of them still opens a compose', /onOpen=\{\(\) => onEmail\(c\.value\)\}/.test(panel))

/* ------------------------------------------------ and the numbers still work the way they did */

/* The pattern this follows. Asserted so that "email got its own list" cannot quietly become
   "email got its own list and the numbers lost theirs". */
ok('numbers beyond the two slots are still drawn', /phones\.length > 2 &&/.test(panel)
  && /Other numbers/.test(panel))

/* ------------------------------------------------------------------ */

for (const f of failures) console.error(`  ✗ ${f}`)
console.log(`check-contact-order: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
