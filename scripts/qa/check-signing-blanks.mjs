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
  amountOf, blankFor, blanksFor, FILLABLE, FREQUENCIES, isFillable, missingBlanks, offerLine,
  withFilled,
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
/*
 * AND THE LIST IS SHORT ENOUGH TO READ. A closed list that grows past a dozen is a list nobody
 * checks, which is how a balance ends up on it.
 *
 * TWELVE RATHER THAN TEN, because the firm added four ways of reaching the debtor -- "like your
 * work number, home, your cell phone number, work number, and email address, just kind of to
 * confirm that stuff". The ceiling is a reading limit and not a principle; the principle is the
 * assertion under it, which is that nothing on this list is a figure.
 */
ok('the fillable list is a closed handful', FILLABLE.length > 0 && FILLABLE.length <= 12)
ok('...and nothing on it is a money field',
  !FILLABLE.some((b) => /balance|capital|interest|fee|settle|commission/i.test(b.key)))

/* WHAT IS ON IT: their own particulars, and the terms they are offering. */
for (const key of ['debtor_address', 'debtor_id_masked', 'debtor_reg_no', 'debtor_employer',
  'debtor_mobile', 'debtor_work_phone', 'debtor_home_phone', 'debtor_email',
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
 * A COMPANY IS ASKED COMPANY THINGS AND A PERSON PERSON THINGS
 * ------------------------------------------------------------------------------------------- */

/*
 * THE FIRM: "why would you ask for the employer and for the company at the same time? If you're
 * speaking to a company, you're speaking to a company. If you're speaking to an individual, you're
 * speaking to an individual. So please get that right."
 *
 * A company has no employer and a person has no registration number. Asking both is how a form
 * reads as something nobody looked at -- and their own AoD did exactly that.
 */
const everything = ['debtor_address', 'debtor_id_masked', 'debtor_reg_no', 'debtor_employer']
check('a company is asked for its registration number and not an employer',
  blanksFor(everything, 'company').map((b) => b.key), ['debtor_address', 'debtor_reg_no'])
check('...and a person for an employer and not a registration number',
  blanksFor(everything, 'individual').map((b) => b.key),
  ['debtor_address', 'debtor_id_masked', 'debtor_employer'])
/* AND AN IDENTITY NUMBER IS A PERSON'S. A company registration number in the ID field is the
   confusion Raptor already has a whole rule about elsewhere. */
check('an identity number is never asked of a company',
  blanksFor(['debtor_id_masked'], 'company'), [])
/* THE TERMS ARE ASKED OF BOTH, because an arrangement is an arrangement. */
check('both are asked for the arrangement',
  blanksFor(['ptp_amount'], 'company').length, blanksFor(['ptp_amount'], 'individual').length)

/* ---------------------------------------------------------------------------------------------
 * AN AMOUNT IS A NUMBER AND A FREQUENCY IS A CHOICE
 * ------------------------------------------------------------------------------------------- */

/*
 * THE FIRM: "a figure for how much is going to be paid should be a figure, not just type it in
 * there, because there could be typos. There is an R -- some people can put R for rand and others
 * could not. That might influence the way that the payment is captured."
 *
 * Four strings for one number is the problem: "R500", "500", "R 500.00", "r500,00". The one that
 * reaches an arrangement decides what the firm thinks it was promised.
 */
check('a plain number is an amount', amountOf('500'), 500)
check('...and so is one somebody typed a rand sign onto', amountOf('R500'), 500)
check('...and a pasted en-ZA figure, spaces and all', amountOf('R 1 500,00'), 1500)
/* A COMMA IS A DECIMAL POINT HERE. Read as a thousands separator, R1,50 a month becomes R150. */
check('...a comma is a decimal point, not a thousands mark', amountOf('1,50'), 1.5)
check('...and a full stop still works', amountOf('1500.50'), 1500.5)
check('words are not an amount', amountOf('five hundred'), null)
check('...nor is nothing', amountOf(''), null)
check('...nor nought', amountOf('0'), null)
check('...nor a negative', amountOf('-5'), null)
/* AND AN AMOUNT THAT IS NOT A NUMBER IS NOT AN ANSWER: "about five hundred" would otherwise reach
   a collector as though it were an instalment. */
const amountOnly = blanksFor(['ptp_amount'])
check('an unreadable amount is still missing', missingBlanks(amountOnly, { ptp_amount: 'about 500' }).length, 1)
check('...and a readable one is not', missingBlanks(amountOnly, { ptp_amount: 'R500' }).length, 0)

/*
 * A FREQUENCY IS PICKED, NOT SPELLED. THE FIRM: "rather give the option, for example, monthly,
 * weekly, or bi-weekly, or other, and then you can type in other."
 */
check('the frequency is a choice', blankFor('ptp_frequency')?.kind, 'choice')
ok('...with the firm’s own options on it',
  ['Monthly', 'Fortnightly', 'Weekly'].every((f) => FREQUENCIES.includes(f)))
/* "OTHER" IS LAST AND IT IS THE ESCAPE. Without it the choice is three options and a refusal. */
check('...and Other is the last of them', FREQUENCIES[FREQUENCIES.length - 1], 'Other')

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
 * THE MEASURE OF THE PAGE, WITHOUT THE PAPER
 * ------------------------------------------------------------------------------------------- */

/*
 * THREE ROUNDS OF THE FIRM LOOKING AT THIS, and it has landed back in the middle.
 *
 * "It's not on a letterhead, the letters are all over the place" -- the page drew the blocks with
 * no sheet at all. Then, with the letterhead on: "I'm not sure if it's necessary to show the entire
 * letterhead and the division of the pages to the person when they are signing online." So it came
 * off entirely. Now: "maybe it doesn't have to be on the letterhead when you don't have to see the
 * letterhead everywhere. It can just be on the top of that little thing that you've created."
 *
 * WHICH IS WHAT letterCss ALREADY DRAWS, and that is the assertion worth making. Its `.ltr-page`
 * background is `no-repeat`, so on ONE continuous unpaginated sheet the letterhead prints once at
 * the head of the document. What the firm objected to the second time was the letterhead REPEATING
 * across the middle of item 3 -- which a repeat-y rule would do, and which nothing here has.
 */
const page = read('src/pages/sign/SignPage.tsx')
const css = read('src/lib/letterDocument.ts')
ok('the signing page keeps the sheet’s measure', /letterCss\(\{ \.\.\.blankLetter\(\), blocks: request\.body \}, page\)/.test(page))
ok('...at the sheet’s own width', /width: `\$\{page\.widthMm\}mm`/.test(page))
/* AND THE PAPER IS ON IT, which reversed. Asserted as the absence of the strip rather than as the
   presence of a background, because the background is letterCss's and not this page's. */
ok('...with the letterhead kept rather than stripped off',
  !/backgroundUrl: null/.test(page))
ok('...drawn once at the top and not repeated down the page',
  /background-repeat: no-repeat;/.test(css))
ok('...nor a page division drawn across it', !/repeat-y/.test(page))
/* ONE CONTINUOUS SHEET: letterCss's own page height would otherwise pad a one-paragraph mandate
   out to a full A4 and push the signing controls below the fold. */
ok('...and it is one continuous document', /minHeight: 0/.test(page))
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
 * A SIGNED DOCUMENT FILES ITSELF
 * ------------------------------------------------------------------------------------------- */

/*
 * THE FIRM: "when it's signed and saved, I can't see the document that's signed or saved anywhere.
 * It doesn't go anywhere. So it should go to signed, it should go under documents."
 *
 * IT COULD NOT, AND THE REASON IS WHO IS HOLDING THE PEN. The signer is anonymous -- the token is
 * the whole authority -- and the anon role has no rights on the storage bucket or on
 * account_documents. A browser that could write a document row onto an account would be a browser
 * that could write anything onto any account. So the DATABASE files it, as the only actor in the
 * exchange entitled to.
 */
const trigger = sql.lastIndexOf('create or replace function public.signing_file_signed()')
ok('the database files a signed document', trigger > 0)
const filing = trigger > 0 ? sql.slice(trigger, sql.indexOf('$$;', trigger) + 3) : ''
ok('...onto the account it belongs to', /insert into public\.account_documents/.test(filing))
/* ONLY ON THE CROSSING, not on every update: a later edit to the row must not file it twice. */
ok('...only when it becomes signed',
  /new\.state = 'signed' and coalesce\(old\.state, ''\) <> 'signed'/.test(filing))
ok('...and never twice', /do nothing/.test(filing))
ok('the trigger is created behind a catalogue guard',
  /if not exists \(select 1 from pg_trigger where tgname = 'signing_requests_file_signed'\)/.test(sql))

/*
 * AND THE FIRST OPEN DRAWS THE PDF AND KEEPS IT.
 *
 * THE FIRM: "it saves now, but it saves like the online version. It doesn't save a PDF. It should
 * save a PDF and send a PDF to the debtor and save it on the document." The row the trigger files
 * points at the REQUEST -- it has to, because the anon signer could never upload a file -- and
 * opening it used to hand a collector the signing PAGE for that token. A web page is not an
 * instrument: it cannot be posted to an attorney or attached to a summons.
 *
 * SO THE FIRST AUTHENTICATED OPEN DRAWS IT AND REPOINTS THE ROW, and from then on it is an
 * ordinary file. Once, and only once: the policy that permits that update requires the path to
 * still be the placeholder, so the bytes a court would be shown are written once and frozen.
 */
const store = read('src/lib/accountWorkspace.ts')
ok('a signed document is drawn as a PDF the first time it is opened',
  /const token = tokenOfPlaceholder\(doc\.storagePath\)/.test(store)
  && /fileSignedCopy\(\{/.test(store))
ok('...before storage is asked for a file that is not there yet',
  store.indexOf('tokenOfPlaceholder(doc.storagePath)') < store.indexOf('const url = await documentUrl'))
/* AND IT FALLS BACK TO THE PAGE RATHER THAN FAILING. A request that will not draw is still a
   request somebody can read, and "could not open that document" on an agreement that plainly
   exists is the worse answer. */
ok('...and a copy that will not draw still opens as the page it was signed on',
  /url: signingPath\(token\),/.test(store))
/* THE PERUSAL FEE IS RAISED EITHER WAY: item 6 is for reading a document on the account, and where
   it is kept is not the debtor's business. */
const opens = (store.match(/charge: await chargePerusal\(/g) ?? [])
check('both ways out of openDocument raise the perusal fee', opens.length, 2)

/*
 * AND THE UPDATE THAT REPOINTS THE ROW IS THE ONLY ONE THIS TABLE ALLOWS.
 *
 * account_documents has no general update policy, deliberately: nobody working an account may
 * quietly rewrite the letter of demand that proves it was sent. The one exception is narrow, and
 * its `using` clause is what makes it narrow -- a row that already holds a real path is frozen
 * again, so a filed signed agreement cannot be repointed at a different file afterwards.
 */
ok('the one update policy is scoped to a signed document still holding its placeholder',
  /create policy "account_documents_file_signed"[\s\S]{0,400}?using \(signing_request_id is not null and storage_path like 'signing\/%'\)/
    .test(sql))
ok('...and there is no general update policy beside it',
  !/create policy "account_documents_update" on public\.account_documents/.test(sql))

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
