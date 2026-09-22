/**
 * What the client is told when a handover is accepted with something wrong on it.
 *
 * THE FIRM: "after this has been imported, if it was accepted with mistakes it should create a
 * client query -- now we are going to distinguish between a debtor dispute and a client query --
 * so it'll go on the client's account that there is an import correction needed on a specific
 * file, and all of the problems would be listed on there, and that would be flagged at the client
 * liaison. Also an email will be created and sent to the client liaison with the problems ... it
 * will show the client reference number and what is needed, what is the problem with that ... so
 * the client liaison can easily forward that to the client."
 *
 * THE ONE THAT WOULD COST REAL MONEY is at the bottom: an import correction must never charge the
 * debtor. A dispute raises Annexure B item 3 because the DEBTOR's objection caused the work; a
 * client's sheet being wrong is their typing, and billing a debtor for it would not survive being
 * asked about by the Council.
 */
import { readFileSync } from 'node:fs'
import {
  correctionDescription, correctionEmail, givenFor,
} from '../../src/lib/importCorrections.ts'
import { ESCALATION_KINDS, ESCALATION_KIND_ORDER, escalationChargeable } from '../../src/lib/disputeCategories.ts'

let pass = 0
const failures = []
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass += 1; return }
  failures.push(`${label}\n    expected ${e}\n    got      ${a}`)
}
const ok = (label, actual) => check(label, actual, true)

const labelFor = (k) => ({ id_number: 'ID number', email_1: 'Email address' }[k] ?? k)

const ROW = {
  reference: 'BF-201',
  name: 'Maree',
  problems: [{ key: 'id_number', level: 'warn', message: '"0823456789" is not an ID number. Left empty rather than guessed at.' }],
  values: { id_number: '0823456789', email_1: null, name: 'Maree' },
  note: 'Confirm the ID with the client before any section 129.',
}

/* ---------- 1. an import correction is NEVER charged to the debtor ---------- */

/*
 * THE RULE THAT COSTS MONEY IF IT IS WRONG. CLAUDE.md: fees are charged on accounts only, and a
 * debtor pays Annexure B item 3 because THEY raised a dispute. A handover sheet with a telephone
 * number in the ID column is the client's typing.
 */
check('an import correction may not raise a fee', escalationChargeable('import'), false)
check('...while a debtor’s dispute still does', escalationChargeable('dispute'), true)
check('...and asking for help never did', escalationChargeable('help'), false)
ok('the kind is declared unchargeable at source', ESCALATION_KINDS.import.chargeable === false)

/*
 * AND IT IS NOT IN THE ESCALATE MENU. An agent looking at an account cannot decide that the
 * client's handover sheet was wrong -- the import already knows, and knows which cell. Offering
 * it would also offer a way to raise one on an account no handover ever touched.
 */
ok('the Escalate menu does not offer it', !ESCALATION_KIND_ORDER.includes('import'))
ok('...but the three a person picks are all still there',
  ['dispute', 'help', 'litigation'].every((k) => ESCALATION_KIND_ORDER.includes(k)))
/* A category says why the DEBTOR objects, so it means nothing here — and the database refuses
   one on any kind but a dispute. */
check('it is not classified like a dispute', ESCALATION_KINDS.import.needsCategory, false)
check('it goes to the liaison, who is the one who may ask a client', ESCALATION_KINDS.import.goesTo, 'liaison')

/* ---------- 2. the query on the account ---------- */

const desc = correctionDescription(ROW)
ok('the note somebody typed leads', desc.startsWith('Confirm the ID with the client'))
ok('...and the problem is listed under it', /is not an ID number/.test(desc))
const noNote = correctionDescription({ ...ROW, note: null })
ok('with nothing typed it still says what is outstanding',
  /for the client to confirm/.test(noNote) && /is not an ID number/.test(noNote))

/* ---------- 3. the email to the liaison ---------- */

const mail = correctionEmail({
  clientName: 'Bredell Ferreira',
  filename: 'handover 2 (warnings).xlsx',
  today: '2026-09-22',
  rows: [ROW, { ...ROW, reference: 'BF-205', name: 'Coetzee', note: null,
    problems: [{ key: 'email_1', level: 'warn', message: 'No email address — a section 129 is sent by email.' }] }],
  labelFor,
})

ok('the subject names the client', /Bredell Ferreira/.test(mail.subject))
ok('...and how many accounts it is about', /2 accounts/.test(mail.subject))
check('...and counts them', mail.accounts, 2)

/* THE FIRM'S OWN THREE COLUMNS, plus the field — without which "0823456789 is not an ID number"
   sends the reader hunting for which column that was. */
ok('the table shows the client’s own reference', /BF-201/.test(mail.bodyHtml))
ok('...the debtor', /Maree/.test(mail.bodyHtml))
ok('...which field it is about', /ID number/.test(mail.bodyHtml))
ok('...what the sheet actually said', /0823456789/.test(mail.bodyHtml))
ok('...and what we need', /is not an ID number/.test(mail.bodyHtml))
ok('the file is named', /handover 2 \(warnings\)\.xlsx/.test(mail.bodyHtml))

/*
 * AN EMPTY BOX IS WRITTEN AS SOMETHING. A blank cell in a table of problems reads as "we forgot
 * to fill this in", which is the opposite of the point: the emptiness IS the problem.
 */
check('a field the sheet left empty says so', givenFor(ROW, 'email_1'), '(nothing)')
check('...and a problem about no one field says nothing about a box', givenFor(ROW, null), '—')
ok('the empty one reaches the table', /\(nothing\)/.test(mail.bodyHtml))

/*
 * WRITTEN TO BE FORWARDED, at the firm's instruction: "so the client liaison can easily forward
 * that to the client." So it carries nothing internal — a liaison who has to rewrite it before
 * sending it on is a liaison who will not send it on.
 */
ok('it says the accounts are already being worked', /nothing is waiting on this/i.test(mail.bodyHtml))
ok('...and asks the client to confirm', /let us know whether the details are correct/i.test(mail.bodyHtml))
ok('...and nothing in it is addressed to us', !/liaison|internal|Raptor/i.test(mail.bodyHtml))

/* A client's own data goes into HTML, so it is escaped. A debtor called "Smith & Co <Pty>" must
   not close the table. */
const nasty = correctionEmail({
  clientName: 'A & B', filename: 'x.xlsx', today: '2026-09-22', labelFor,
  rows: [{ ...ROW, name: 'Smith & Co <Pty>', values: { id_number: '<script>x</script>' },
    problems: [{ key: 'id_number', level: 'warn', message: 'bad' }] }],
})
ok('a debtor’s name is escaped', /Smith &amp; Co &lt;Pty&gt;/.test(nasty.bodyHtml))
ok('...and so is what their sheet said', !/<script>/.test(nasty.bodyHtml))

/* ---------- 4. it is raised from the approval, on the right terms ---------- */

const draft = readFileSync(new URL('../../src/lib/handoverDraft.ts', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

ok('the approval raises the query', /raiseQuery\(/.test(draft))
ok("...as an import correction, not a debtor's dispute", /kind: 'import'/.test(draft))
/* THE LINE THAT PROTECTS THE DEBTOR. escalationChargeable already refuses, and this refuses
   again at the call site: two locks on the one thing here that takes money off somebody. */
ok('...and never charges for it', /charge: false/.test(draft))
ok('...with the liaison', /stage: 'liaison'/.test(draft))
ok('...owned by whoever looks after the client', /account_owner_id/.test(draft))

ok('the email goes to the liaison', /sendCorrectionEmail\(/.test(draft))
/*
 * NOT THROUGH sendAccountEmail. That path charges Annexure B item 1 against the account, and this
 * message is to a colleague about a client's typing — it is not correspondence with a debtor.
 */
ok('...not through the path that charges the debtor for an email',
  !/sendAccountEmail/.test(draft))
/* And none of it may cost the import its accounts. */
ok('a query that fails is reported, not thrown', /correctionProblems/.test(draft))
ok('...and a client with no liaison is said out loud', /No client liaison/.test(draft))

/* ---------------------------------------------------------------- report */

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
A handover accepted with something wrong on it raises a query per account, with the liaison,
owned by whoever looks after the client -- and one email the liaison can forward without
rewriting. None of it charges the debtor: a dispute is the debtor's objection, and a handover
sheet with a telephone number in the ID column is the client's typing.`)
