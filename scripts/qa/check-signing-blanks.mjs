/**
 * A DOCUMENT SOMEBODY SIGNS, ON THE FIRM'S PAPER, WITH BLANKS THEY CAN FILL AND SOME THEY CANNOT.
 *
 * TWO INSTRUCTIONS, ONE SCREEN.
 *
 * THE FIRM, looking at an acknowledgement of debt on the signing page: "if I click on the link, it
 * opens the thing to sign, but it looks crappy, it doesn't look good. It's not on a letterhead,
 * it's all the letters are all over the place, like it's just not nice."
 *
 * AND: "you currently pull the data from the PTP. But there's a scenario where no PTP exists. So
 * when you send it, it should use the PTP data. Or it should ask, use the PTP data or leave it
 * blank. So then you will put a small line where the person can fill in whatever it is that they
 * need to fill in based on an arrangement that they would like to make... if there's any missing
 * documentation, make provisions for that being filled in by the individual completing the
 * document."
 *
 * THEIR OWN AoD IS THE EVIDENCE FOR BOTH. Item 3 of it went out reading "Lubuschangne.
 * Registration number: . Domicilium: {{debtor_address}}" -- a field with nothing behind it and a
 * field only the DEBTOR can answer, on an instrument the firm would sue on, set in the browser's
 * default type at the full width of an iPad.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-signing-blanks.mjs
 */
import { readFileSync } from 'node:fs'
import {
  blankFor, blanksFor, FILLABLE, isFillable, missingBlanks, offerLine, withFilled,
} from '../../src/lib/signingBlanks.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (f) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')

/* ---------------------------------------------------------------------------------------------
 * THE MONEY IS PRINTED, NOT ASKED FOR
 * ------------------------------------------------------------------------------------------- */

/*
 * THE RULE IS NOT "whatever Raptor could not answer", and this is the assertion that keeps it from
 * becoming that. An acknowledgement of debt whose amount the debtor typed in is not an
 * acknowledgement of anything -- it is an offer on the firm's letterhead that the firm would later
 * have to argue it never made.
 */
for (const key of ['balance', 'capital', 'fees', 'interest', 'settlement', 'to_settle',
  'case_number', 'reference', 'firm_bank', 'commission']) {
  ok(`the debtor may not fill in {{${key}}}`, !isFillable(key))
}
/* AND THE LIST IS SHORT ENOUGH TO READ. A closed list that grows past a dozen is a list nobody
   checks, which is how a balance ends up on it. */
ok('the fillable list is a closed handful', FILLABLE.length > 0 && FILLABLE.length <= 10)
ok('...and nothing on it is a money field',
  !FILLABLE.some((b) => /balance|capital|interest|fee|settle|commission/i.test(b.key)))

/* WHAT IS ON IT: their own particulars, and the terms they are offering. */
for (const key of ['debtor_address', 'debtor_id_masked', 'debtor_reg_no', 'debtor_employer',
  'ptp_amount', 'ptp_frequency', 'ptp_date']) {
  ok(`the debtor may fill in {{${key}}}`, isFillable(key))
}

/*
 * THE TERMS ARE REQUIRED AND THE REST IS NOT. An AoD with no instalment in it acknowledges a debt
 * and promises nothing, which is not the document the firm is sending; but a debtor who will not
 * name their employer should still be able to sign, because refusing would cost the firm the
 * instrument over a field it was never going to sue on.
 */
check('the arrangement must be completed',
  ['ptp_amount', 'ptp_frequency', 'ptp_date'].map((k) => blankFor(k)?.required), [true, true, true])
check('...and the employer need not be', blankFor('debtor_employer')?.required, false)
check('...nor an identity number, which 97% of the book has not got',
  blankFor('debtor_id_masked')?.required, false)
/* THE ADDRESS IS REQUIRED: it is the domicilium, which is where everything after this is served. */
check('the address is required, because it is the domicilium',
  blankFor('debtor_address')?.required, true)

/* ---------------------------------------------------------------------------------------------
 * WHAT THE SENDER MAY ASK FOR
 * ------------------------------------------------------------------------------------------- */

check('a field the firm may not ask about is dropped',
  blanksFor(['balance', 'debtor_address']).map((b) => b.key), ['debtor_address'])
check('...and asking twice asks once',
  blanksFor(['debtor_address', 'debtor_address']).map((b) => b.key), ['debtor_address'])
/* IN THE DOCUMENT'S OWN ORDER, not the order somebody ticked them: a form that asks for the first
   payment date above the street address reads as a form somebody assembled in a hurry. */
check('the blanks come out in the order the documents read',
  blanksFor(['ptp_date', 'debtor_address', 'ptp_amount']).map((b) => b.key),
  ['debtor_address', 'ptp_amount', 'ptp_date'])

/* ---------------------------------------------------------------------------------------------
 * AND WHAT THE SIGNER TYPED
 * ------------------------------------------------------------------------------------------- */

const terms = blanksFor(['ptp_amount', 'ptp_frequency', 'ptp_date'])
check('nothing typed is everything still missing',
  missingBlanks(terms, {}).map((b) => b.key), ['ptp_amount', 'ptp_frequency', 'ptp_date'])
check('...and spaces are not an answer', missingBlanks(terms, { ptp_amount: '   ' }).length, 3)
check('...while a real answer settles one',
  missingBlanks(terms, { ptp_amount: 'R500', ptp_frequency: 'monthly', ptp_date: '2026-11-01' }),
  [])

/*
 * THE SIGNER'S ANSWER WINS ONLY WHERE THERE WAS A BLANK, which is the lock that keeps a balance a
 * balance. A stray key in what comes back from the page cannot overwrite a value the firm printed.
 */
check('an answer fills its own blank',
  withFilled({ balance: 'R 1 134,40' }, terms, { ptp_amount: 'R500' }).ptp_amount, 'R500')
check('...and cannot touch a figure the firm printed',
  withFilled({ balance: 'R 1 134,40' }, terms, { balance: 'R1,00' }).balance, 'R 1 134,40')
check('...nor can an empty answer erase what was there',
  withFilled({ ptp_amount: 'R2 500' }, terms, { ptp_amount: '  ' }).ptp_amount, 'R2 500')

/*
 * AND THE OFFER IS RAISED FOR A PERSON, NOT WRITTEN ONTO THE BOOK. The firm chose this: a debtor
 * could type ten rand a month, and an arrangement nobody read is one the firm is holding itself to.
 */
const offered = offerLine(terms, { ptp_amount: 'R500', ptp_frequency: 'monthly', ptp_date: '1 November 2026' })
ok('what the debtor offered is said in one line', !!offered && offered.includes('R500'))
ok('...and it asks a person to decide', !!offered && /Accept it or telephone/.test(offered))
check('...and says nothing where they were given the terms', offerLine([], { ptp_amount: 'R500' }), null)
check('...or where they filled nothing in', offerLine(terms, {}), null)

/* ---------------------------------------------------------------------------------------------
 * THE DOCUMENT KEEPS ITS BRACES FOR THE FIELDS THE SIGNER WILL ANSWER
 * ------------------------------------------------------------------------------------------- */

/*
 * ANSWERED WITH THEMSELVES, which needs no new merge rule: `debtor_address` gets the value
 * `{{debtor_address}}`, so the field is non-empty (its block survives the optional-line thinning)
 * and renderTemplate substitutes the placeholder for the placeholder. The braces reach the frozen
 * body intact and the signing page merges the signer's own answer over them.
 *
 * WITHOUT THIS the block would be thinned away -- documentWithoutOptional removes a paragraph that
 * is nothing but an unanswerable optional field -- and the line the debtor is meant to complete
 * would not be on the document at all.
 */
const doc = read('src/lib/letterDocument.ts')
ok('a field left for the signer survives the merge',
  /for \(const key of leaveOpen\) answered\[key\] = `\{\{\$\{key\}\}\}`/.test(doc))
ok('...and the thinning sees it as answered, so its line stays',
  /const thinned = documentWithoutOptional\(doc, values\)/.test(doc)
  && doc.indexOf('for (const key of leaveOpen)') < doc.indexOf('const thinned = documentWithoutOptional'))

/* ---------------------------------------------------------------------------------------------
 * THE PAPER
 * ------------------------------------------------------------------------------------------- */

const page = read('src/pages/sign/SignPage.tsx')
ok('the signing page draws the firm’s own sheet', /letterCss\(\{ \.\.\.blankLetter\(\), blocks: request\.body \}, page\)/.test(page))
ok('...at the sheet’s own width', /width: `\$\{page\.widthMm\}mm`/.test(page))
/* THE LETTERHEAD ON EVERY PAGE, not once at the top -- which is what a printer does and what the
   firm circled on a two-page notice when it did not. */
ok('...with the letterhead repeating down it', /backgroundRepeat: page\.backgroundUrl \? 'repeat-y'/.test(page))
/* AND PLAIN A4 WHERE A REQUEST CARRIES NO SHEET: every link sent before the column existed. The
   right width and the right margins is not the firm's paper, but it is a document. */
ok('...and plain A4 where the request predates the sheet',
  /const page = request\?\.pageSetup \?\? A4_LETTERHEAD/.test(page))

const panel = read('src/pages/accounts/SigningPanel.tsx')
ok('the sender freezes the sheet onto the request', /pageSetup: sheet,/.test(panel))
ok('...fetched from the firm’s letterheads', /setSheet\(defaultOf\(all\)\?\.page \?\? A4_LETTERHEAD\)/.test(panel))

/* TWO PRESSES, BECAUSE THEY ARE TWO DIFFERENT DOCUMENTS. One states the arrangement the firm
   already has; the other asks the debtor for one. A tick somebody leaves as they found it is how
   the wrong one goes out. */
ok('the firm can send it with the arrangement filled in', /void send\(t, false\)/.test(panel))
ok('...or left blank for the debtor', /void send\(t, true\)/.test(panel))
ok('...and the words say which is which',
  /left blank, for the debtor to fill in/.test(panel))
/* ANYTHING RAPTOR HAS NO ANSWER FOR GOES TO THE DEBTOR EITHER WAY -- their address, their identity
   number. Those are theirs, and a blank is better than braces. */
ok('an unanswerable field is offered to the debtor whichever way it is sent',
  /const unanswered = FILLABLE\s*\n\s*\.filter\(\(b\) => !\(values\[b\.key\] \?\? ''\)\.trim\(\)\)/.test(panel))

/* ---------------------------------------------------------------------------------------------
 * AND THE DATABASE CHECKS THE BLANKS TOO
 * ------------------------------------------------------------------------------------------- */

/*
 * THE PAGE IS REACHABLE BY ANYBODY HOLDING THE LINK and its checks are the browser's. This is the
 * instrument the firm would sue on; "the terms were left empty" is not a thing to find out later.
 */
const sql = read('supabase/schema.sql')
const at = sql.lastIndexOf('create or replace function public.signing_sign(')
ok('the signing function is in the schema', at > 0)
const fn = at > 0 ? sql.slice(at, sql.indexOf('$$;', at) + 3) : ''
ok('...and it refuses a required blank left empty', /raise exception 'Fill in: %'/.test(fn))
ok('...reading them off the row rather than trusting the caller',
  /select blanks into v_blanks from public\.signing_requests where token = p_token/.test(fn))
ok('...and it stores what was typed', /filled = coalesce\(p_filled, '\{\}'::jsonb\)/.test(fn))

/* THE SIGNER'S SIDE READS ONE jsonb, which is why the sheet and the blanks could be added at all:
   signing_open returned a row of columns and a function's return type cannot be replaced. */
ok('the document is opened as one jsonb', /rpc\('signing_document', \{ p_token: token \}\)/.test(read('src/lib/signing.ts')))

/* ---------------------------------------------------------------------------------------------
 * AND THE DATE CAME OFF THE ROW
 * ------------------------------------------------------------------------------------------- */

/* THE FIRM: "this AOD says signed at. Maybe we can remove that. It just gives you the option to
   sign." WHO signed is what the row is read for; WHEN is on the document itself. */
ok('a signed row says who, not when', /return `Signed\$\{r\.signedName \? ` by \$\{r\.signedName\}` : ''\}`/.test(panel))
ok('...and the date is gone from it', !/signedAt \? ` · \$\{formatDate\(r\.signedAt\)\}`/.test(panel))

console.log(`\ncheck-signing-blanks: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
