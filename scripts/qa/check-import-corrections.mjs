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
import {
  ESCALATION_KINDS, ESCALATION_KIND_ORDER, clientSection, escalationChargeable,
} from '../../src/lib/disputeCategories.ts'

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

const REJECTED = {
  reference: 'BF-302',
  name: 'Swanepoel',
  problems: [{ key: 'capital', level: 'refuse', message: 'No handover amount.' }],
  values: { capital: null, name: 'Swanepoel' },
  note: null,
}

const mail = correctionEmail({
  clientName: 'Bredell Ferreira',
  filename: 'handover 3 (refusals).xlsx',
  today: '2026-09-22',
  broughtIn: 4,
  toConfirm: [ROW, { ...ROW, reference: 'BF-205', name: 'Coetzee', note: null,
    problems: [{ key: 'email_1', level: 'warn', message: 'No email address — a section 129 is sent by email.' }] }],
  notBroughtIn: [REJECTED],
  labelFor,
})

/*
 * THE ONES THAT DID NOT COME IN WERE MISSING ENTIRELY, and they are the half that matters most.
 *
 * THE FIRM: "there were more ones that I didn't accept that should have been on this email."
 * The email was built from the accounts that WERE opened, so a handover where eight rows were
 * rejected told the client about none of them — the accounts they most need to fix and re-send
 * were the ones we said nothing about.
 */
ok('an account that did not come in is on the email', /BF-302/.test(mail.bodyHtml))
ok('...under a heading that says to send it again', /send these again/i.test(mail.bodyHtml))
ok('...saying nothing is being done on it', /nothing is being done on them yet/i.test(mail.bodyHtml))
ok('...and its reason', /No handover amount/.test(mail.bodyHtml))
/* The two groups need different things from the client, so they are not run together. */
ok('the ones that came in are under their own heading', /Brought in, but please confirm/.test(mail.bodyHtml))
ok('...and are said to be already being worked', /open and being worked/i.test(mail.bodyHtml))

/*
 * THE SUBJECT SAYS WHICH OF THE TWO. The one that needs a resend is what the email is worth
 * opening for, and "1 account need correcting" — which is what went out — said neither.
 */
ok('the subject names the client', /Bredell Ferreira/.test(mail.subject))
ok('...how many need sending again', /1 not brought in/.test(mail.subject))
ok('...and how many need confirming', /2 to confirm/.test(mail.subject))
check('...and it counts both groups', mail.accounts, 3)

/*
 * ONE ACCOUNT, NOT "1 ACCOUNT NEED". The email that went to the firm read "there were one
 * account where the information ... could not be used" and "1 account need correcting". A client
 * reads that.
 */
const one = correctionEmail({
  clientName: 'X', filename: 'f.xlsx', today: '2026-09-22', labelFor,
  broughtIn: 1, toConfirm: [ROW], notBroughtIn: [],
})
ok('one of a thing is singular', /1 account needs something confirmed/.test(one.bodyHtml))
ok('...and never "accounts need" for one', !/1 accounts/.test(one.bodyHtml))
const two = correctionEmail({
  clientName: 'X', filename: 'f.xlsx', today: '2026-09-22', labelFor,
  broughtIn: 2, toConfirm: [ROW, REJECTED], notBroughtIn: [],
})
ok('several of a thing is plural', /2 accounts need something confirmed/.test(two.bodyHtml))

/* THE SUMMARY FIRST. Somebody forwarding this should be able to answer "so where are we?"
   without counting rows in a table. */
ok('the email opens with what happened', /accounts are open and being worked/.test(mail.bodyHtml))
ok('...and how many had nothing wrong at all', /2 of them with nothing outstanding/.test(mail.bodyHtml))

/* A HANDOVER WHERE EVERYTHING PROBLEMATIC WAS REJECTED still has to be sent: it is the only way
   the client hears, because a rejected row opens no account and so can carry no query. */
const onlyRejects = correctionEmail({
  clientName: 'X', filename: 'f.xlsx', today: '2026-09-22', labelFor,
  broughtIn: 3, toConfirm: [], notBroughtIn: [REJECTED],
})
ok('a handover with only rejections still says so', /BF-302/.test(onlyRejects.bodyHtml))
ok('...and does not draw an empty "please confirm" table',
  !/Brought in, but please confirm/.test(onlyRejects.bodyHtml))
ok('...while still saying what did come in', /3 accounts are open/.test(onlyRejects.bodyHtml))

ok('the table shows the client’s own reference', /BF-201/.test(mail.bodyHtml))
ok('...the debtor', /Maree/.test(mail.bodyHtml))
ok('...which field it is about', /ID number/.test(mail.bodyHtml))
ok('...what the sheet actually said', /0823456789/.test(mail.bodyHtml))
ok('...and what we need', /is not an ID number/.test(mail.bodyHtml))
ok('the file is named', /handover 3 \(refusals\)\.xlsx/.test(mail.bodyHtml))

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
ok('...and asks the client to confirm', /let us know whether/i.test(mail.bodyHtml))
ok('...and nothing in it is addressed to us', !/liaison|internal|Raptor/i.test(mail.bodyHtml))

/* A client's own data goes into HTML, so it is escaped. A debtor called "Smith & Co <Pty>" must
   not close the table. */
const nasty = correctionEmail({
  clientName: 'A & B', filename: 'x.xlsx', today: '2026-09-22', labelFor,
  broughtIn: 1, notBroughtIn: [],
  toConfirm: [{ ...ROW, name: 'Smith & Co <Pty>', values: { id_number: '<script>x</script>' },
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

/*
 * AND THE EMAIL IS SENT WHEN THE ONLY THING WRONG IS WHAT WAS THROWN OUT. Gated on the accounts
 * that were opened with problems, a handover whose bad rows were all rejected sent nothing — and
 * those rows carry no query either, because they opened no account to hang one on.
 */
ok('rows that did not come in are gathered too', /notBroughtIn/.test(draft))
ok('...from the excluded and the refused', /excluded \|\| r\.planned\?\.refused/.test(draft))
ok('...and either group is enough to send the email',
  /corrections\.length > 0 \|\| notBroughtIn\.length > 0/.test(draft))

/* ---------- 5. a query is not a dispute, and the client page says so ---------- */

/*
 * THE FIRM: "there's a difference between a client dispute, a client query, and a debtor's
 * dispute. Queries are for clients and disputes are for debtors. Now there should be two
 * different sections on the client portal about which ones are their open disputes and which ones
 * are their open queries. This would fall under a query, for example, the import that's not
 * completed."
 *
 * The client page had ONE list headed "Disputes on this client's book" holding everything
 * escalated to a liaison -- so an import correction, which is the firm asking the CLIENT to check
 * their own data, was shown to them as a DEBTOR disputing the debt. Two different things wearing
 * one word, on the screen a liaison reads before they phone the client.
 */
check('an import correction is a query', clientSection('import'), 'query')
check('a debtor’s objection is a dispute', clientSection('dispute'), 'dispute')
/* An agent asking a team leader what to do is the firm supervising its own staff. */
check('asking for help is neither, and the client never sees it', clientSection('help'), null)
/* Everything raised before the kind column existed reads as a dispute, which is what it was. */
check('an old row with no kind reads as a dispute', clientSection(null), 'dispute')

const clientPage = readFileSync(new URL('../../src/pages/companies/CompanyDetail.tsx',
  import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
ok('the client page shows queries', /section="query"/.test(clientPage))
ok('...and disputes, separately', /section="dispute"/.test(clientPage))

const panel = readFileSync(new URL('../../src/pages/companies/ClientQueries.tsx',
  import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
/* PRESENCE BEFORE ABSENCE: a file with no filter at all satisfies "does not show everything". */
ok('the panel filters by which section it is', /clientSection\(q\.kind\) === section/.test(panel))
ok('...and takes its heading from the section rather than hard-coding one',
  /title=\{words\.title\}/.test(panel))
ok('...so neither list is headed "Disputes" unconditionally',
  !/title="Disputes on this client's book"/.test(panel))

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
