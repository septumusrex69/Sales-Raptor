/**
 * A MANDATE CAN BE RECORDED AFTER THE CLIENT IS CREATED — AND IT COSTS A DEBTOR NOTHING.
 *
 * THE FIRM, stopped on the import screen: "now it tells me I can't upload this handover sheet
 * because there's no contract signed. However, there was no option where I can upload a contract
 * ... And it still gives you this error if it's not been uploaded. But then there should be a
 * function inside the client section where it says upload a mandate."
 *
 * TWO FAULTS, AND THE SECOND ONE IS THE ONE WORTH A CHECK.
 *
 * The first was an ordinary gap: `companies.mandate_signed_at` could only be set on the form that
 * creates the client, and the client page rendered it as `{company.mandateSignedAt && <Field/>}`
 * — visible only once it was already there. A refusal that says "add the date it was signed on
 * the client first" named something that could not be done.
 *
 * The second is a money rule, and it is why this file exists rather than an e2e assertion that a
 * date input is on the page. The obvious way to take a client's mandate is to reuse
 * `accountWorkspace.uploadDocument`, which already has the bucket, the signed URLs and the
 * deletion rule. That function also raises Annexure B item 3 — perusal of documents, once a day —
 * against the ACCOUNT it is handed. CLAUDE.md states the rule as law: fees are charged on
 * ACCOUNTS ONLY, never on leads or deals, and the sales side raises nothing. A client's own
 * mandate billed to a debtor is a charge that would not survive being asked about, and it would
 * be invisible: the fee lands on an account nobody was looking at.
 *
 * So the client's paperwork has its own library with no charging in it at all, and this holds it
 * that way.
 *
 * READ BACK AS TEXT, NOT IMPORTED. clientDocuments.ts pulls in the Supabase client, which does
 * not resolve from here -- the same reason firmSettings.ts is read as text by its own check. So
 * the kinds are parsed out of the source. That is weaker than importing them and it is the only
 * option; everything else in this file is about source and schema anyway.
 *
 * Run: node scripts/qa/check-client-mandate.mjs
 */
import { readFileSync } from 'node:fs'
import { DEFAULT_INTEREST_RATE_ANNUAL } from '../../src/lib/newDebtor.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

/* Comments are stripped before anything is searched: half the assertions below are about what is
   ABSENT, and every one of these files explains in prose exactly what it does not do. */
const stripped = (p) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^[ \t]*\/\/.*$/gm, ' ')

const lib = read('src/lib/clientDocuments.ts')

/* The kinds, out of the source. Asserted non-empty first, or every "does not offer" below would
   pass vacuously on a list this failed to find -- which is exactly the shape of check that passes
   on broken code. */
const kindsBlock = (lib.match(/export const CLIENT_DOCUMENT_KINDS = \[([\s\S]*?)\] as const/) ?? [])[1]
const CLIENT_DOCUMENT_KINDS = (kindsBlock ?? '')
  .split(',').map((t) => t.trim()).filter(Boolean)
  .map((t) => (/^'(.*)'$/.test(t) ? t.slice(1, -1) : t))
const MANDATE_KIND = ((lib.match(/export const MANDATE_KIND = '([^']+)'/) ?? [])[1]) ?? null
const libCode = stripped('src/lib/clientDocuments.ts')
const card = stripped('src/components/companies/MandateCard.tsx')
const detail = stripped('src/pages/companies/CompanyDetail.tsx')
const importCard = stripped('src/components/settings/HandoverImportCard.tsx')
const schema = read('supabase/schema.sql')

ok('the library is readable at all', lib.length > 2000)

/* ---------------- no fee, anywhere near a client's paperwork ---------------- */

/*
 * THE ASSERTION THIS FILE EXISTS FOR, and it is written as an absence on purpose. Every one of
 * these names is a route to a debtor's bill; a client's mandate must reach none of them.
 */
for (const forbidden of ['chargePerusal', 'accountCharges', 'PERUSAL_ITEM_ID', 'annexureB', 'account_charges']) {
  ok(`the client document library never touches ${forbidden}`, !libCode.includes(forbidden))
  ok(`...and neither does the mandate card`, !card.includes(forbidden))
}
/* AND IT IS NOT THE ACCOUNT LIBRARY WEARING A DIFFERENT HAT. An import of accountWorkspace would
   bring uploadDocument -- and its charge -- back within one keystroke. */
ok('the client document library does not import the account one',
  !libCode.includes('accountWorkspace'))
ok('...nor does the mandate card', !card.includes('accountWorkspace'))

/* A SEPARATE BUCKET, which is the other half: a signed mandate carries the firm's commercial
   terms with that client, and every collector on the floor can read the account bucket. */
ok('the client bucket is its own', /const BUCKET = 'client-documents'/.test(libCode))
ok('...and is not the account bucket', !libCode.includes("'account-documents'"))

/* ---------------- the table is really there, and locked down ---------------- */

ok('client_documents exists in the schema',
  /create table if not exists public\.client_documents/.test(schema))
/* PRIVATE, or a client's signed mandate sits behind a guessable public URL. */
ok('...on a private bucket',
  /values \('client-documents', 'client-documents', false\)/.test(schema))
ok('...with row level security on',
  /alter table public\.client_documents enable row level security/.test(schema))
/* NOBODY QUIETLY REMOVES THE MANDATE. It is the authority the firm is collecting on, and by the
   time it is gone the handover it let through is already open. Both halves: the row AND the file,
   because deleting one and leaving the other is a list that lies either way. */
ok('deleting a row is managers only',
  /create policy "client_documents_delete"[\s\S]{0,300}?current_user_role\(\) in \('Administrator', 'Sales Manager', 'Liaison Manager'\)/
    .test(schema))
ok('...and so is deleting the file',
  /create policy "client_documents_remove" on storage\.objects[\s\S]{0,300}?current_user_role\(\) in \('Administrator', 'Sales Manager', 'Liaison Manager'\)/
    .test(schema))
/* THE ROW GOES WITH THE CLIENT. A client deleted leaving its mandate behind is a private bucket
   filling with paperwork nothing points at. */
ok('a document belongs to a client and dies with it',
  /company_id uuid not null references public\.companies \(id\) on delete cascade/.test(schema))

/* ---------------- the kinds ---------------- */

check('the mandate is the kind with a rule behind it', MANDATE_KIND, 'Mandate')
ok('the kinds were actually found', CLIENT_DOCUMENT_KINDS.length >= 3)
/* FIRST ON THE LIST, because it is what the list is for -- and because the upload box opens on
   whatever is first, so a mandate filed as "Other" is a mandate the card cannot see. The entry is
   the MANDATE_KIND identifier rather than a repeated string literal, which is the point. */
check('...and it is first on the list', CLIENT_DOCUMENT_KINDS[0], 'MANDATE_KIND')
/* SHORT, because a long list gets ignored and everything lands under whatever is first. */
ok('the list is short enough to read', CLIENT_DOCUMENT_KINDS.length <= 8)
/* AND NOT A DEBTOR'S KINDS. 'Identity document' and 'Proof of payment' belong to an account; a
   client's drawer offering them is how a debtor's ID copy ends up outside the account bucket. */
for (const wrong of ['Identity document', 'Proof of payment', 'Trace', 'Court document']) {
  ok(`...and does not offer ${wrong}`, !CLIENT_DOCUMENT_KINDS.includes(wrong))
}

/* ---------------- the date can be set after the client exists ---------------- */

/*
 * THE ORIGINAL BLOCKER, asserted as the thing that replaced it. The old line was
 * `{company.mandateSignedAt && <Field label="Mandate Signed" .../>}` -- present only when there
 * was nothing to do, absent exactly when somebody needed it.
 */
ok('the client page no longer hides the mandate when it is missing',
  !/company\.mandateSignedAt && <Field/.test(detail))
ok('...and renders the card instead', /<MandateCard/.test(detail))
/* ONE CALLBACK CARRYING THE WHOLE PATCH. It was `onSetSignedAt` alone; adding the mandate's
   interest rate as a second callback made one Save press send two PATCHes at the same row, which
   the browser check counts and refused. */
ok('...which writes the mandate through the store',
  /onSave=\{\(patch\) => updateCompany\(company\.id, patch\)\}/.test(detail))
/* WHO MAY, mirroring the companies RLS update policy rather than inventing a second rule: offer
   a button the database will refuse and it appears to work and quietly does nothing. */
ok('...only to somebody the database would allow',
  /canEdit=\{canEditOwned\(currentUser, company\.accountOwnerId\)\}/.test(detail))

/* AND THE CARD ACTUALLY TAKES A DATE AND A FILE. */
ok('the card has a date input', /type="date"/.test(card))
ok('...and a file input', /type="file"/.test(card))
ok('...and says what the button does', /Upload a mandate/.test(card))
ok('...and uploads through the client library', /uploadClientDocument\(/.test(card))

/*
 * NOON, NOT MIDNIGHT. `new Date('2026-09-30')` is midnight UTC; read back west of Greenwich that
 * is the 29th, and a mandate dated a day early is a date the client did not sign on.
 */
ok('the date is stamped at midday so no timezone moves it',
  /T12:00:00/.test(card))

/* ---------------- and the refusal points at the fix ---------------- */

/*
 * THE SENTENCE THE FIRM WAS LOOKING AT. It still refuses -- the firm's rule is that a client needs
 * a mandate before a handover can be imported, and that is a refusal rather than a warning
 * because collecting on an unmandated book is work the firm cannot lawfully charge for. What it
 * could not do was tell anybody where to go.
 */
/* Through needsMandate since prompt 10 -- a Swordfish client is exempt; check-mandate-rule. */
ok('the import still refuses without a mandate',
  /const noMandate = needsMandate\(client\)/.test(importCard))
ok('...and the refusal still stops the import rather than warning about it',
  /if \(!plan \|\| !sheet \|\| !companyId \|\| noMandate\) return/.test(importCard))
ok('...and now links to the client it is talking about',
  /to=\{`\/companies\/\$\{client\?\.id\}`\}/.test(importCard))

/*
 * THE GATE IS THE DATE, NOT THE DOCUMENT, and that is a decision worth pinning so nobody
 * "completes" it later. The date is the firm declaring they hold a mandate; a gate on the upload
 * would stop a handover the morning the signed copy comes back and the scanner is busy -- a
 * refusal the firm never asked for. The missing document is said on the client's own card, where
 * it is context rather than an alarm.
 */
ok('the import does not also demand the file be uploaded',
  !/client_documents|uploadClientDocument|fetchClientDocuments/.test(importCard))
ok('...while the card does say when the paper is missing',
  /signed && !hasMandateDoc/.test(card))

/* ---------------- and the add form says where "later" is ---------------- */

/*
 * THE FIRM OFFERED THE ALTERNATIVE THEMSELVES: "maybe tell you can upload a contract for a client
 * when you sign up the client ... Or you can say, for example, like upload later." The form still
 * does not insist on a date -- a form that will not save without one is a form people fill in
 * with a made-up date -- so what it owes is the whereabouts of later.
 */
const modal = stripped('src/components/companies/AddClientModal.tsx')
ok('the add form still lets a client be saved with no mandate date',
  !/mandateSignedAt[\s\S]{0,200}required/.test(modal))
/* \s+ rather than a space: JSX wraps, and the sentence straddles two lines in the source. */
ok('...and says it can be added on the client afterwards',
  /added\s+on\s+the\s+client\s+afterwards/.test(modal))

/* ---------------- one warning, not two ---------------- */

/*
 * THE COMMISSION CARD SITS DIRECTLY ABOVE THE MANDATE CARD and used to carry its own "No mandate
 * on record" line. Two of them an inch apart is a warning people stop reading, and only one of
 * the two can do anything about it.
 */
const commission = stripped('src/components/companies/CommissionCard.tsx')
ok('the commission card no longer repeats the mandate warning',
  !/No mandate on record/.test(commission))
ok('...and the mandate card is where it is said', /no handover can be imported/.test(card))

/* ---------------------------------------------------------------------------------------------
 * THE RATE THE MANDATE ALLOWS, WHICH NOTHING COULD RECORD.
 *
 * THE FIRM, reading a repayment simulation on an account handed over that morning: "it says that
 * interest is not running. Why is interest not running? It should be running."
 *
 * IT WAS NOT RUNNING BECAUSE NO ACCOUNT HAD A RATE, and no account had a rate because the handover
 * sheet stopped asking for one on the firm's own instruction -- "the rate is in the agreement the
 * firm already holds" -- while nothing in Raptor held that agreement. All eight of the firm's first
 * live accounts opened at 0%, and the calculator reported it correctly and inexplicably.
 *
 * SO THE RATE LIVES ON THE MANDATE, which is the piece of paper the firm named.
 * ------------------------------------------------------------------------------------------- */

/* `schema` is read once at the top of this file. */
ok('the client carries the rate its mandate allows',
  /add column if not exists default_interest_rate_annual/.test(schema))
/* AND IT IS SAID WHICH DIRECTION OF MONEY THIS IS. `companies` already carries commission_rate --
   what the FIRM charges the CLIENT -- and the two sitting on one table under similar names is
   exactly the confusion CLAUDE.md spends a section on. */
ok('...and the column says it is not the commission rate',
  /default_interest_rate_annual[\s\S]{0,1400}commission_rate, which is what the FIRM charges/
    .test(schema))

ok('the mandate card offers it', /Interest the mandate allows/.test(card))
ok('...and writes it through the store', /defaultInterestRateAnnual: pct/.test(card))
/*
 * ONE PRESS, ONE WRITE. The rate started as its own callback beside the date's, which meant two
 * PATCHes at the same row from one Save -- two audit rows for one edit, and a window where the
 * second could fail after the first had landed. The browser check counts the writes; this holds
 * the shape that keeps it at one.
 */
ok('...in the same patch as the date',
  /onSave\(\{[\s\S]{0,260}mandateSignedAt:[\s\S]{0,260}defaultInterestRateAnnual/.test(card))
/* SAVED WITH THE DATE, not behind a second button: they are two readings of one piece of paper,
   and two Save buttons on one card is two things to forget. */
ok('...with the same Save as the date', /onSave\(\{[\s\S]{0,300}setEditing\(false\)/.test(card))
/*
 * AN UNREADABLE BOX IS LEFT ALONE RATHER THAN WRITTEN AS NOUGHT, and this is the assertion worth
 * the most. Nought is a REAL rate meaning "no interest is ever charged on this client's book", so
 * somebody who typed "24%" badly and got a silent zero would have taken interest off a whole book
 * without being told.
 */
/* AND AN UNREADABLE BOX OMITS THE KEY ENTIRELY rather than sending undefined, which would take a
   perfectly good stored rate off record because somebody mistyped. */
ok('an unreadable rate is not written as nought',
  /const rateOk = typed === ''/.test(card)
  && /\.\.\.\(rateOk \? \{ defaultInterestRateAnnual: pct \} : \{\}\)/.test(card))
ok('...and the field says so rather than failing quietly',
  /is not a rate between 0 and 100/.test(card))
/* AND A RATE OVER 100 IS REFUSED: 2400 typed for 24% is the slip that charges a debtor a hundred
   times the interest, and it reads like a number rather than like a mistake. */
ok('...and a rate over 100 is refused too', /<= 100/.test(card))

/*
 * THE ABSENCE IS WHAT THE CARD IS REALLY FOR. A mandate on record with no rate against it opens
 * every account at 0% -- nothing accrues, every settlement quote is just the balance -- and the
 * first anybody knows is a collector asking why a simulation shows no interest.
 */
/*
 * AND AN EMPTY RATE SAYS WHAT WILL HAPPEN INSTEAD OF WARNING.
 *
 * THE FIRM, having been asked: "all debt clients are by default loaded on 24% interest. If we
 * change it, we want to change it. We will reduce it if we want."
 *
 * So an empty box is the ordinary case now, not a fault — the amber it used to wear was for a
 * client whose accounts ran NO interest at all, which is a state that no longer occurs. What it
 * must still do is SAY the number, because a client card that is silent about the rate every one of
 * its accounts will open at is a card that invites somebody to assume nought.
 */
ok('a mandate with no rate says what will happen', /Nothing recorded/.test(card))
ok('...naming the standing rate rather than a sentence about it',
  /DEFAULT_INTEREST_RATE_ANNUAL\}% a year/.test(card))
ok('...and that it is the one to reduce', /Record a lower rate above/.test(card))
/* AND IT DOES NOT CLAIM TO FIX THE BOOK. Changing a client's rate must not read as changing what
   is already on the book: accounts keep the rate they were opened with, which is the firm's own
   rule that imported figures stay as imported. */
/* MATCHED ON ONE WHOLE CLAUSE rather than across the "+" that joins the two string literals:
   `stripped` removes comments, not source concatenation, so a pattern spanning the join fails on
   correct code -- which it did. */
ok('...and the field does not promise to change accounts already open',
  /keep the rate they were opened with/.test(card))

/* ---------------- and it reaches an account ---------------- */

/*
 * A COLUMN NOBODY READS IS A COLUMN THAT DOES NOTHING. The import is where the rate has to land --
 * `toDebtorInput` wrote the literal '0' on every row, which is the line the firm actually met.
 */
const imp = stripped('src/lib/handoverImport.ts')
ok('the import takes the client s rate', /clientInterestRateAnnual: number \| null/.test(imp))
ok('...and writes it onto the account',
  /interestRateAnnual: String\(clientInterestRateAnnual \?\? DEFAULT_INTEREST_RATE_ANNUAL\)/.test(imp))
/*
 * AND THE FIRM'S STANDING RATE WHERE THE CLIENT HAS NONE, which reverses what this asserted two
 * commits ago. It held the import to 0%, on the argument that an account at nought is one somebody
 * notices while one at a guessed 24% is one nobody does. That argument was about GUESSING; 24% is
 * the firm's own standing rate, said in as many words, and a default somebody decided is a
 * different thing from a default somebody inferred.
 */
check('...at the firm s standing rate where the client has none', DEFAULT_INTEREST_RATE_ANNUAL, 24)
/*
 * AND A CLIENT RECORDED AT NOUGHT STAYS AT NOUGHT. A mandate that charges no interest is a real
 * mandate — `?? ` rather than `|| ` is the whole of what keeps a deliberate zero from falling
 * through to the firm's default, and the two read alike.
 */
ok('...while a client deliberately on 0% is left there',
  /clientInterestRateAnnual \?\? DEFAULT_INTEREST_RATE_ANNUAL/.test(imp)
  && !/clientInterestRateAnnual \|\| DEFAULT_INTEREST_RATE_ANNUAL/.test(imp))
/* ONE PLACE HOLDS IT. Three entry points were giving three answers — the by-hand form 24, the
   Swordfish import 24, the handover sheet 0 — which is how they came to disagree at all. */
ok('the by-hand form reads the same constant',
  /interestRateAnnual: String\(DEFAULT_INTEREST_RATE_ANNUAL\)/.test(stripped('src/components/companies/AddDebtorModal.tsx')))

const draft = stripped('src/lib/handoverDraft.ts')
/*
 * READ OUT OF THE **SELECT**, not out of the file. A bare search for the column name passed while
 * the select had been narrowed back to `select('code')` -- because the name also appears a few
 * lines below, where the fetched row is read. The failure that hides behind that is the whole bug
 * returning silently: an unselected column is `undefined`, `clientRate` falls to null, and every
 * account opens at 0% again with nothing anywhere saying so. Found by breaking it.
 */
ok('the batch reads the rate off the client',
  /\.from\('companies'\)[\s\S]{0,120}select\('[^']*default_interest_rate_annual/.test(draft))
/* AND THE ROW IS ACTUALLY READ BACK, which is the other half and the one the loose pattern was
   accidentally testing. Both, named apart, so neither can stand in for the other. */
ok('...and reads it off the row that comes back',
  /\?\.default_interest_rate_annual/.test(draft))
ok('...and hands it to every row', /toDebtorInput\(row\.values, row\.planned\?\.defaultDate \?\? null, clientRate\)/.test(draft))
/*
 * `Number(null)` IS NOUGHT, NOT NaN, which is the trap this walked into first: a client with no
 * rate came through as an explicit 0% rather than as "nobody has said". The account opens the same
 * either way; what differs is whether anything downstream can tell the two apart.
 */
ok('...reading a null column as "nobody has said", not as nought',
  /rawRate === null \|\| rawRate === undefined/.test(draft))

/* AND THE ACCOUNT SAYS WHY, where a collector meets it. The sentence the firm read said only THAT
   no interest was running, which reads as a fault in the arithmetic -- and they read it as one. */
const calc = stripped('src/components/collections/RepaymentCalculator.tsx')
ok('the simulation says why no interest is running', /This account is at 0% a year/.test(calc))
ok('...and where the rate comes from', /the client\u2019s mandate/.test(calc))

console.log(`\ncheck-client-mandate: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
