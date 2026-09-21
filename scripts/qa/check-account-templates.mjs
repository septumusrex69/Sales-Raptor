/**
 * THE LIBRARY, REACHED FROM INSIDE AN ACCOUNT.
 *
 * At the firm's instruction: "everything that we have in the library, to be in the account as
 * well as an option." Before this, one of the four kinds could be reached from an account — a
 * letter, through Attach a letter. The SMS and email wording the firm had written, approved and
 * priced sat on a screen nobody visits while collecting, and the call scripts were unreachable
 * from the one place a call is made.
 *
 * THE FAULTS THIS GUARDS, none of which announce themselves:
 *
 *   - A TEMPLATE PREVIEWED AGAINST SAMPLES AND SENT AGAINST NOTHING. The library previews with
 *     sampleValues() because it has no debtor in front of it. Merging with those on an account
 *     would post Mr Van Der Westhuizen's name and R 48,250.00 to somebody else — a fabricated
 *     figure in a demand, which is the worst thing in this file.
 *   - A COVERING EMAIL THAT ENCLOSES NOTHING. message_templates.attachment_id is what makes
 *     "please find the enclosed notice" true. Picking such a template without bringing its letter
 *     sends a message whose first sentence is a lie.
 *   - TWO IDEAS OF WHAT THE BALANCE IS. The SMS box, the email box and the letter all merge now,
 *     and resolved separately they would drift — a debtor told one figure by SMS and another in
 *     the notice posted the same day.
 *   - A RETIRED TEMPLATE OFFERED AS CURRENT. The library keeps retired wording so somebody can
 *     answer "what did we used to send?"; offering it to send is a different thing entirely.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-account-templates.mjs
 */
import { readFileSync } from 'node:fs'
import { missingFieldsNote, renderTemplate } from '../../src/lib/messageTemplates.ts'
import { smsCost } from '../../src/lib/smsSegments.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)

const read = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), 'utf8')

/**
 * The same file with its comments taken out.
 *
 * FOR THE ABSENCE ASSERTIONS ONLY, and it is needed. This file explains in prose why the picker
 * must never merge against `sampleValues()` -- and the first cut of the assertion below read that
 * very sentence and reported the fault it was written to prevent. check-silent-triggers records
 * the same trap in its own words: prose explaining an absence must not be able to satisfy it.
 */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const picker = read('components/library/UseTemplate.tsx')
const compose = read('components/ComposeEmailModal.tsx')
const sms = read('pages/accounts/SmsModal.tsx')
const script = read('pages/accounts/CallScriptModal.tsx')
const account = read('pages/accounts/AccountDetail.tsx')

/* ------------------------------------------------------------------ the warning */

/*
 * A WARNING THAT FIRES WHEN NOTHING IS WRONG IS WORSE THAN NO WARNING, because people stop
 * reading it -- CLAUDE.md, and the reason this is the first thing asserted. The note has to be
 * silent on the ordinary case or it is silent on the day it matters.
 */
check('nothing is said when every field was filled', missingFieldsNote([]), null)
ok('...and the field is NAMED when one was not',
  (missingFieldsNote(['respond_by']) ?? '').includes('{{respond_by}}'))
ok('...in the braces the writer will see in the box',
  (missingFieldsNote(['firm_bank']) ?? '').includes('{{firm_bank}}'))
/* Singular and plural, because "will send with the braces in it" about three fields reads as a
   sentence somebody did not finish. */
ok('...and it reads as English for one field',
  /braces in it\./.test(missingFieldsNote(['respond_by']) ?? ''))
ok('...and for several', /braces in them\./.test(missingFieldsNote(['a', 'b']) ?? ''))

/*
 * THE PLACEHOLDER IS LEFT STANDING, which is what the note is describing. renderTemplate's own
 * contract, re-asserted here because this warning is a lie if it ever stops being true: it says
 * the message will send with the braces in it, so the braces have to still be there.
 */
const r = renderTemplate('Pay {{balance}} into {{firm_bank}}.', { balance: 'R 1,00' })
check('an unfillable field survives into the words', r.text, 'Pay R 1,00 into {{firm_bank}}.')
check('...and is reported by name', r.missing, ['firm_bank'])

/* ------------------------------------------------------------------ what is offered */

/*
 * MERGED AGAINST THE ACCOUNT, NEVER AGAINST SAMPLES. sampleValues() anywhere in the picker would
 * put a made-up balance into a real demand.
 */
ok('the picker merges against the values it is given', /renderTemplate\(row\.body, values\)/.test(picker))
check('...and never against the library’s samples',
  [picker, sms, script].some((f) => /sampleValues/.test(code(f))), false)

/* Retired wording is kept by the library and not offered to send. */
ok('only live templates are offered', /\.filter\(\(r\) => r\.kind === kind && r\.active\)/.test(picker))

/*
 * ONE RESOLUTION FOR ALL THREE. The account page computes the merge values once and hands the
 * same object to the SMS box, the email box and the letter. Computed twice they drift, and the
 * drift is a debtor told one balance by SMS and another in the notice posted the same day.
 */
ok('the account resolves its merge values once', /const letterContext = useMemo\(/.test(account))
check('...and mergeValuesFor is called exactly once on the page',
  (account.match(/mergeValuesFor\(\{/g) ?? []).length, 1)
for (const [what, re] of [
  ['the letter', /letterContext=\{letterContext\}/],
  ['the SMS box', /values=\{letterContext\.values\}/],
  ['the call script', /<CallScriptModal values=\{letterContext\.values\}/],
]) {
  ok(`...and ${what} is given that one`, re.test(account))
}

/* ------------------------------------------------------------------ the covering email */

/*
 * THE HALF THAT MATTERS. An email template carrying attachment_id claims an enclosure; picking it
 * has to make the claim true. The library already marks these on its own list -- that link stops
 * meaning anything the moment it is used and nothing comes with it.
 */
/* The drawn PDF has to be ATTACHED, not merely drawn. Break-testing found the first cut of this
   satisfied by a call whose result was thrown away -- which draws the letter, charges the wait,
   and sends the covering email with nothing on it. */
ok('picking an email template brings the letter it posts',
  /picked\.template\.attachmentId/.test(compose)
  && /addAttachment\(await buildLetterAttachment\(\{/.test(compose))
ok('...looked up as its own template, because attachment_id is an id',
  /\.find\(\(r\) => r\.id === picked\.template\.attachmentId\)/.test(compose))
ok('...and says so when that letter is gone from the library',
  /no longer in the library/.test(compose))
/*
 * AND THE WORDS SURVIVE A LETTER THAT WILL NOT DRAW. The subject and body are set BEFORE the
 * attachment is attempted, so an error over the PDF does not also throw away the wording -- the
 * writer can attach it by hand.
 */
/*
 * ONE PLACE THE BODY IS SET, and it is before the draw.
 *
 * COUNTED BEFORE IT IS ORDERED, for the reason CLAUDE.md gives twice over: indexOf finds the
 * FIRST occurrence, so duplicating the setter into an early-return branch satisfies an
 * order-only assertion while the real path still throws the wording away. Break-testing this
 * line is what found it.
 */
check('the words are set in exactly one place', (compose.match(/setBody\(picked\.body\)/g) ?? []).length, 1)
ok('...and that place is before the letter is drawn',
  compose.indexOf('setBody(picked.body)') < compose.indexOf('setAttaching(picked.template.id)'))

/*
 * ONE SIZE GATE. A letter can now arrive two ways -- chosen by hand, or brought by the template
 * that carries it -- and a second path that forgot the ceiling is a 413 from Vercel arriving as
 * "Could not reach the server" after the wait.
 */
check('every attachment goes through one size gate',
  (compose.match(/> MAX_ATTACHMENT_BYTES/g) ?? []).length, 2)
ok('...and both letter paths use it',
  /onAttached=\{addAttachment\}/.test(compose) && /addAttachment\(await buildLetterAttachment/.test(compose))

/* ------------------------------------------------------------------ what charges and what does not */

/*
 * READING A SCRIPT IS NOT A CHARGEABLE ACTION. Annexure B prices actions -- an email, an SMS, a
 * consultation -- and reading is not one of them. Asserted because every other button in that
 * action row DOES charge, so a fee written into this one would look like it belonged.
 */
check('opening a call script raises no fee',
  /raiseCharge|recordSent|chargeFor|annexureB/.test(code(script)), false)
ok('...and the screen says so', /charges nothing/i.test(script))

/*
 * AND THE SMS STILL PRICES ITSELF. Item 1(c) is per SEGMENT, so a template that runs to 161
 * characters costs twice what the firm thinks it does -- which is the whole reason the cost line
 * is live while you type, and the reason a template dropped into that box must not bypass it.
 */
ok('the SMS box still prices what is in it', /const cost = smsCost\(text\)/.test(sms))
ok('...including wording that arrived from a template',
  /onPick=\{\(p\) => \{ setText\(p\.body\); setMissing\(p\.missing\) \}\}/.test(sms))

/* ------------------------------------------------------------------ what an SMS costs */

/*
 * THE APP'S OWN FORMATTING MUST NOT COST THE FIRM DOUBLE.
 *
 * en-ZA groups thousands with a NON-BREAKING space (CLAUDE.md), so formatMoney emits U+00A0 and a
 * merged {{balance}} carries one. That character is not in the GSM alphabet: ONE of them drops
 * the whole message to UCS-2 and cuts every segment from 160 characters to 70. Measured on the
 * real message the e2e sends -- 94 characters -- that is one segment at R3.50 with an ordinary
 * space and TWO at R7.00 with the non-breaking one. Annexure B item 1(c) is priced per SEGMENT,
 * so every templated SMS carrying a balance was charged twice.
 *
 * Caught by LOOKING AT the screenshot the e2e takes, which is the only reason this is here.
 *
 * ONLY THE MERGED VALUES ARE TOUCHED, never what a collector typed: the box deliberately WARNS
 * about a curly apostrophe rather than silently rewriting somebody's words, and that stays true.
 */
ok('the SMS box strips the app\u2019s own non-breaking spaces out of merged values',
  /\.replace\(\/\\u00a0\/g, ' '\)/.test(code(sms)))
ok('...and the picker is given those, not the raw ones',
  /<UseTemplate scope="collections" kind="sms" values=\{smsValues\}/.test(sms))
/* The writer's own text is NOT rewritten -- the warning is still the mechanism for that. */
ok('...while what the collector typed is left alone',
  /const cost = smsCost\(text\)/.test(code(sms)))

const NBSP = '\u00a0'
check('a non-breaking space is what makes the difference',
  [smsCost(`R${NBSP}180,000.00`).encoding, smsCost('R 180,000.00').encoding],
  ['UCS-2', 'GSM-7'])

/* ---------- the two fields that were filled by nothing ---------- */

/*
 * THE FIRM, naming them: "{{debtor_address}} exists, but Raptor doesn't fill it yet ... and
 * {{respond_by}} exists, but Raptor doesn't fill it yet. The s129 letters use it."
 *
 * Both were written, checked and exported with nothing in the app passing a value, so every
 * notice using one printed the placeholder. check-message-templates proves mergeValuesFor can
 * answer them; only the PAGE can prove something passes them, which is what this reads.
 */
ok('the account passes a debtor address to the merge',
  /debtorAddress: addressOf\(/.test(account))
ok('...taken from the account\u2019s own contacts rather than typed',
  /addressOf\(workspace\?\.contacts/.test(account))
/* A retired address is one somebody established the debtor has left. Posting a statutory demand
   to it is worse than posting none, because it looks served. */
ok('...and never a retired one',
  /kind === 'address' && !c\.retiredAt/.test(account))
ok('...preferring the one marked primary', /live\.find\(\(c\) => c\.isPrimary\)/.test(account))

/*
 * TEN WORKING DAYS, NOT TEN CALENDAR DAYS. addWorkingDays knows the public holidays -- Easter
 * included, and the Monday a holiday moves to when it falls on a Sunday. A demand giving a debtor
 * less time than the Act does is a demand that can be set aside.
 */
ok('the account works out the date to respond by', /respondBy: addWorkingDays\(/.test(account))
ok('...counting ten of them', /addWorkingDays\(dayKey\(new Date\(\)\), 10\)/.test(account))
ok('...from the working-days library rather than by hand',
  /from '\.\.\/\.\.\/lib\/workingDays'/.test(account))

/* The merge is a memo; a dependency left off means a letter naming last week's address. */
ok('the contacts are in the merge\u2019s dependencies', /workspace\?\.contacts,/.test(account))


if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
The firm's wording, reachable from the account it is about. Merged against the debtor in front of
you and never against the library's samples; one resolution shared by the SMS box, the email box
and the letter, so they cannot disagree about the balance; a covering email that brings the letter
it claims to enclose; and a call script that charges nothing, said on the screen.`)
