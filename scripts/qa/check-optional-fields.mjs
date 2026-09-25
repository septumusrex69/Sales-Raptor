/**
 * A FIELD MOST ACCOUNTS CANNOT ANSWER MUST NOT HOLD EVERY NOTICE THE FIRM SENDS.
 *
 * THE DAY THIS WAS FOUND. The firm started a handover workflow and both steps held on day 0: the
 * email because the account had no identity number, and the SMS because the email before it had
 * not gone. The account was not unusual — 19 668 of the 19 912 live accounts have no identity
 * number, 97% of the book — and all 32 collections templates quote it. So the guard that exists
 * to stop a notice going out with "{{debtor_id_masked}}" in it would have stopped nearly every
 * notice the firm sends.
 *
 * THE FIRM'S ANSWER: "we should account for people that don't have ID numbers... in all of the
 * writings", and one set of wording rather than two — a second "no ID" copy of each of the 32
 * templates is 64 templates to keep in step, and CLAUDE.md is a list of what happens when one
 * thing is written twice.
 *
 * SO AN UNFILLED OPTIONAL FIELD IS REMOVED, AND WHAT IT TAKES WITH IT IS THE POINT. An email
 * carries it on a label line of its own and the line goes; an SMS carries it inside the sentence
 * and only the clause goes, because dropping the line there would drop the whole message. Both
 * shapes are in the firm's own templates today, so both are checked against the real wording.
 *
 * AND THEN IT HAPPENED AGAIN WITH THE PHONE NUMBER. Not one of the fifty live profiles carries
 * one, and fifteen templates quote {{collector_phone}}, so the next two notices held on that
 * instead. The firm: "if someone doesn't have a phone number entered, it should be on their
 * dashboard as a warning... but then what it should do is it should give the company's default
 * details as contact." Two different answers, and which one a field gets depends on ONE fact —
 * whether the notice still carries a number when that line goes. The collector's line drops,
 * because all fifteen of those templates print the firm's number underneath it. The sender's
 * line does not, because none of the eight templates that quote {{agent_phone}} carry the firm's
 * number at all; it falls back to the firm's own instead. Both ends are held below.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-optional-fields.mjs
 */
import { readFileSync } from 'node:fs'
import { MERGE_FIELDS, isOptionalField, mergeValuesFor, renderTemplate } from '../../src/lib/messageTemplates.ts'
import { documentWithoutOptional, letterToHtml } from '../../src/lib/letterDocument.ts'
import { smsCost } from '../../src/lib/smsSegments.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  if (Object.is(actual, expected)) { pass += 1; return }
  failures.push(`${name}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`)
}
const ok = (name, actual) => check(name, actual, true)

/* ---------- which fields are optional ---------- */

/*
 * THE TWO THAT ARE THE SAME COLUMN. debtor_accounts.debtor_id_number holds an identity number on
 * a person and a registration number on a company, so both readings of it are equally empty.
 */
ok('the debtor’s identity number is optional', isOptionalField('debtor_id_masked'))
ok('...and a company’s registration number with it', isOptionalField('debtor_reg_no'))

/*
 * AND THE SECOND THING NOBODY HAS: A PHONE NUMBER. Not one of the fifty live profiles carries
 * one, so {{collector_phone}} held exactly as many notices as the identity number did. The firm:
 * "if someone doesn't have a phone number entered... it should give the company's default details
 * as contact."
 *
 * WHICH IS ONLY SAFE BECAUSE OF WHAT IS ON THE LINE BELOW IT — all fifteen templates that quote
 * the collector's direct line also quote {{firm_phone}}, so dropping the line always leaves the
 * debtor a number to ring. The templates are rows in the database and no check here can read
 * them; what CAN be held is the other end of that sentence, below: {{firm_phone}} must never
 * itself become optional, or the fallback goes with the thing it was the fallback for.
 */
ok('the collector’s direct line is optional', isOptionalField('collector_phone'))

/*
 * A WHATSAPP NUMBER IS AN EXTRA CHANNEL AND NEVER THE ONLY ONE, on any of the three people a
 * notice can name, so its line may go wherever it appears.
 */
for (const key of ['collector_whatsapp', 'agent_whatsapp', 'liaison_whatsapp']) {
  ok(`${key} may drop out`, isOptionalField(key))
}

/*
 * AND ALMOST NOTHING ELSE IS, which is the half that keeps this honest. Optional is not "nice to
 * have" — it is "this may be printed without, and the notice is still the notice". A balance, a
 * case number or a respond-by date quietly dropping out of a section 129 is a defective demand,
 * so the list is held to exactly what the firm asked for.
 */
const optional = Object.values(MERGE_FIELDS)
  .flatMap((list) => list.filter((f) => f.optional).map((f) => f.key))
check('nothing else has been quietly marked optional',
  [...new Set(optional)].sort().join(', '),
  'agent_whatsapp, collector_phone, collector_whatsapp, debtor_id_masked, debtor_reg_no, liaison_whatsapp')
for (const key of ['balance', 'case_number', 'respond_by', 'debtor_name', 'firm_name']) {
  check(`${key} still holds the notice`, isOptionalField(key), false)
}

/*
 * THE TWO NUMBERS THAT MAY NOT DROP, each for its own reason and both worth naming.
 *
 * {{firm_phone}} is what is LEFT when the collector's direct line goes. Marked optional it would
 * go too, and a section 129 would be posted with no telephone number on it at all — the exact
 * failure the change above is meant to prevent, arrived at from the other side.
 *
 * {{agent_phone}} is the only number on the eight templates that quote it: not one of them also
 * carries the firm's. So it holds, and mergeValuesFor gives it the firm's number where the person
 * signed in has none, which is the firm's own instruction — the contact falls back, it does not
 * vanish.
 */
for (const key of ['firm_phone', 'agent_phone', 'liaison_phone', 'collector_email', 'agent_email']) {
  check(`${key} is not optional`, isOptionalField(key), false)
}

/*
 * AND THE FALLBACK ITSELF, run rather than described. Whoever is signed in has no number on any
 * of the fifty live profiles, so this is the ordinary case and not the edge one.
 */
const ACCOUNT = {
  caseNumber: 'RAP-100735',
  debtorKind: 'individual',
  debtorTitle: null,
  debtorFirstName: 'ryno',
  debtorSurname: 'buitendag',
  accountNumber: 'Abc1111',
  clientReference: 'dens',
  capitalOutstanding: 6030.79,
  preferredLanguage: 'en',
}
/* The whole shape, formatter included: half of it dies inside the function rather than reporting
   anything useful here. */
const MERGE_INPUT = {
  account: ACCOUNT, balance: null, clientName: 'Tjobecom', agentName: 'Stephan', agentPhone: null,
  today: '2026-09-23', money: (n) => `R ${n}`,
  firm: { firmName: 'Bredell Ferreira', phone: '010 594 5065' },
}
const noNumber = mergeValuesFor(MERGE_INPUT)
check('a sender with no number is given the firm’s', noNumber.agent_phone, '010 594 5065')
/* Their own number when they have one, or the fallback is a rewrite rather than a fallback. */
const ownNumber = mergeValuesFor({ ...MERGE_INPUT, agentPhone: '012 111 2222' })
check('...and their own where they have one', ownNumber.agent_phone, '012 111 2222')
/*
 * NULL WHERE THE FIRM HAS NO NUMBER EITHER. An unresolved {{agent_phone}} on the page gets
 * noticed; an empty line under somebody's name reads as finished and gets posted.
 */
const neither = mergeValuesFor({ ...MERGE_INPUT, firm: { firmName: 'Bredell Ferreira' } })
check('...and nothing invented where the firm has none', neither.agent_phone, null)
/* The collector's line is NOT given the firm's number: it is dropped instead, and printing the
   firm's number twice on one notice reads as two different numbers to somebody skimming. */
check('the collector’s line is dropped rather than doubled', noNumber.collector_phone, null)

/* ---------- an email: the whole line goes ---------- */

/* The firm's own handover wording, to the line. */
const EMAIL = [
  'Dear {{debtor_name}}',
  '',
  'Case reference: {{case_number}}',
  'Your reference with {{client_name}}: {{reference}}',
  'Identity number: {{debtor_id_masked}}',
  '',
  'Your matter has been handed over to {{firm_name}} for further legal administration.',
].join('\n')

const KNOWN = {
  debtor_name: 'Strand Van der see',
  case_number: 'RAP-123786',
  client_name: 'Endeavour',
  reference: 'BF-TEST-015',
  firm_name: 'Bredell Ferreira',
  firm_phone: '010 594 5065',
}

const noId = renderTemplate(EMAIL, KNOWN)
check('an email with no identity number holds nothing up', noId.missing.length, 0)
ok('...the label line is gone with the field', !noId.text.includes('Identity number'))
/* AND NOT BLANKED IN PLACE: "Identity number:" with nothing after it is a fact the firm does not
   have, printed as though somebody forgot to type it. */
ok('...not left as a label with a gap after it', !/Identity number:\s*$/m.test(noId.text))
/* The lines around it are untouched — removing one line of a block is not removing the block. */
ok('...the case reference survives', noId.text.includes('Case reference: RAP-123786'))
ok('...and the client’s reference', noId.text.includes('Your reference with Endeavour: BF-TEST-015'))
ok('...and the body under it', noId.text.includes('handed over to Bredell Ferreira'))
/*
 * IN AN EMAIL A BLANK LINE IS A PARAGRAPH — see emailBodyHtml, which splits on them. A line taken
 * out of the middle of a block must not leave two, or the notice gains a paragraph break the firm
 * did not write.
 */
ok('...and no extra paragraph break is left behind', !/\n\n\n/.test(noId.text))
/*
 * THE SHAPE THAT ACTUALLY PRODUCES ONE, which the wording above does not: a field alone in a
 * paragraph of its own. Taking its line out leaves the blank line above it AND the one below,
 * and in an email two blank lines is a paragraph break the firm did not write. Found by breaking
 * the collapse and watching the assertion above stay green — the trap CLAUDE.md names.
 */
const ownParagraph = renderTemplate(
  'Dear {{debtor_name}}\n\nIdentity number: {{debtor_id_masked}}\n\nYour matter has been handed over.',
  KNOWN,
)
check('a field alone in a paragraph takes the paragraph with it', ownParagraph.missing.length, 0)
ok('...and leaves ONE blank line, not two', !/\n\n\n/.test(ownParagraph.text))
check('...so the notice reads as two paragraphs',
  ownParagraph.text, 'Dear Strand Van der see\n\nYour matter has been handed over.')

const withId = renderTemplate(EMAIL, { ...KNOWN, debtor_id_masked: '850312XXXX08X' })
ok('an account that HAS one still prints it', withId.text.includes('Identity number: 850312XXXX08X'))
check('...and holds nothing up either', withId.missing.length, 0)

/* ---------- an SMS: only the clause goes ---------- */

/*
 * THE SHAPE THAT WOULD HAVE BROKEN A LINE-DROP. The firm's handover SMS is one line, so removing
 * the line containing the field removes the message — which would be sent as nothing, and charged
 * to the debtor per segment under item 1(c).
 */
const SMS = '{{debtor_name}}, {{debtor_id_masked}}. We emailed you about legal matter '
  + '{{case_number}} and will call within 24 hours. {{firm_phone}}, {{firm_name}}'

const smsNoId = renderTemplate(SMS, KNOWN)
check('an SMS with no identity number holds nothing up', smsNoId.missing.length, 0)
ok('...the message survives', smsNoId.text.length > 60)
ok('...it still opens with the debtor’s name', smsNoId.text.startsWith('Strand Van der see.'))
/* The comma that held the field in goes with it. "Strand Van der see, . We emailed" is what a
   naive removal produces, and it is what a debtor would have read. */
ok('...with no orphaned punctuation', !/,\s*\./.test(smsNoId.text))
ok('...and no double space', !/ {2}/.test(smsNoId.text))
ok('...and the rest of the sentence intact',
  smsNoId.text.includes('We emailed you about legal matter RAP-123786'))

const smsWithId = renderTemplate(SMS, { ...KNOWN, debtor_id_masked: '850312XXXX08X' })
ok('an account that HAS one still quotes it in the SMS',
  smsWithId.text.startsWith('Strand Van der see, 850312XXXX08X.'))

/*
 * AND THE MESSAGE IS MEASURED AFTER THE REMOVAL, not before.
 *
 * An SMS is priced per segment on the words that actually go, so a clause cut out after the count
 * would be a quote the debtor is charged against and never reads. Asserted as a real difference
 * rather than as equality: the shorter message must cost no more than the longer one, and here
 * it is 15 characters shorter — which on a longer name is the difference between one segment and
 * two, R3.50 against R7.00 under item 1(c).
 */
ok('the merged text is shorter without it', smsNoId.text.length < smsWithId.text.length)
ok('...and never costs more segments',
  smsCost(smsNoId.text).segments <= smsCost(smsWithId.text).segments)

/* ---------- what it must NOT do ---------- */

/*
 * A TEMPLATE THAT IS NOTHING BUT THE OPTIONAL FIELD. Removing it would leave an empty message —
 * sent, charged, and saying nothing. It holds instead, which is the outcome that gets somebody to
 * look at the template.
 */
const empty = renderTemplate('{{debtor_id_masked}}', KNOWN)
check('a template that is only the optional field still holds', empty.missing.join(), 'debtor_id_masked')
ok('...with the braces standing, so it is unmistakably unfinished',
  empty.text.includes('{{debtor_id_masked}}'))

/* A field that is NOT optional is untouched by any of this. */
const other = renderTemplate('Dear {{debtor_name}}\nListing reference: {{listing_reference}}', KNOWN)
check('a field that is not optional still holds the notice', other.missing.join(), 'listing_reference')
ok('...and its line is still there with the braces in it',
  other.text.includes('Listing reference: {{listing_reference}}'))

/* Two optional fields in one template, only one of them fillable — the company case, where the
   registration number is known and the identity number is not. */
const both = renderTemplate(
  'Identity number: {{debtor_id_masked}}\nRegistration number: {{debtor_reg_no}}\nEnds.',
  { ...KNOWN, debtor_reg_no: '2019/940923/07' },
)
check('one optional field can go while the other prints', both.missing.length, 0)
ok('...the empty one is gone', !both.text.includes('Identity number'))
ok('...the filled one stays', both.text.includes('Registration number: 2019/940923/07'))
ok('...and the line after them is untouched', both.text.includes('Ends.'))

/* ---------- a notice: the paragraph goes ---------- */

/*
 * THE SHAPE ALL FOUR OF THE FIRM'S LETTERS USE. Under the debtor's name, the section 129, the
 * final notice, the listing notice and the intended summons each carry a paragraph of their own
 * reading "Identity number: {{debtor_id_masked}}".
 *
 * A LETTER IS RENDERED SPAN BY SPAN, so that paragraph IS the span — and the message rule, which
 * refuses to empty what it is given, would leave the braces standing on a statutory demand. This
 * is the case that made documentWithoutOptional necessary; without it the fix covered the email
 * and the SMS and left every notice the firm posts still holding.
 */
const NOTICE = {
  defaults: { font: 'Charter', size: 10.5, colour: '#1f2937', lineHeight: 1.45 },
  blocks: [
    { kind: 'table', borders: 'none', widths: [28, 72], rows: [
      [{ spans: [{ text: 'OUR REFERENCE', bold: true }] }, { spans: [{ text: '{{case_number}}' }] }],
    ] },
    { kind: 'paragraph', spans: [{ text: '{{debtor_name}}', bold: true }] },
    { kind: 'paragraph', spans: [{ text: 'Identity number: {{debtor_id_masked}}' }] },
    { kind: 'heading', level: 1, spans: [{ text: 'NOTICE IN TERMS OF SECTION 129' }] },
    { kind: 'paragraph', spans: [{ text: 'The amount of {{balance}} is overdue.' }] },
  ],
}
const NOTICE_VALUES = { ...KNOWN, balance: 'R 12 500,00', today: '25 September 2026' }

const thinned = documentWithoutOptional(NOTICE, NOTICE_VALUES)
check('the paragraph that was only the identity number is gone',
  thinned.blocks.length, NOTICE.blocks.length - 1)
ok('...and it is that paragraph, not another',
  !JSON.stringify(thinned.blocks).includes('Identity number'))
ok('...the debtor\u2019s name above it survives',
  JSON.stringify(thinned.blocks).includes('{{debtor_name}}'))
ok('...and the notice\u2019s own title under it',
  JSON.stringify(thinned.blocks).includes('NOTICE IN TERMS OF SECTION 129'))

/* Nothing at all happens on an account that HAS one. */
const kept = documentWithoutOptional(NOTICE, { ...NOTICE_VALUES, debtor_id_masked: '850312XXXX08X' })
check('a notice for an account with an identity number keeps every block',
  kept.blocks.length, NOTICE.blocks.length)

/*
 * AND IT IS NOT A TIDY-UP PASS. A blank paragraph the author typed as spacing is left exactly
 * where it is — a notice that quietly loses its author's spacing is a notice they did not write.
 */
const spaced = documentWithoutOptional(
  { ...NOTICE, blocks: [{ kind: 'paragraph', spans: [{ text: '' }] }, ...NOTICE.blocks] },
  NOTICE_VALUES,
)
/* Read defensively. Indexing straight into blocks[0].spans[0] throws a TypeError two lines below
   the check that should have reported it, which is the trap CLAUDE.md names by name — and is
   exactly what happened when this line was break-tested. */
const firstBlock = spaced.blocks[0]
check('a blank paragraph somebody typed is left alone', firstBlock?.kind, 'paragraph')
check('...still blank', firstBlock?.spans?.[0]?.text, '')

/*
 * AND THE RENDERED NOTICE CARRIES NEITHER THE BRACES NOR AN EMPTY LABEL. Asserted on the HTML the
 * screen draws rather than on the block list, because letterToHtml is where the removal is
 * actually wired in — a function that works and is not called is the failure this layer exists
 * for.
 */
const html = letterToHtml(NOTICE, { filled: true, values: NOTICE_VALUES })
ok('the notice is drawn with no braces left in it', !html.includes('{{'))
ok('...and no label with nothing after it', !/Identity number:\s*</.test(html))
ok('...while the rest of the notice is there', html.includes('NOTICE IN TERMS OF SECTION 129'))
/* The EDITING view is untouched: unfilled is where the firm writes the wording, and every field
   must stand there or they cannot see what they are editing. */
const editing = letterToHtml(NOTICE, { filled: false, values: NOTICE_VALUES })
ok('the editing view still shows the field', editing.includes('{{debtor_id_masked}}'))

/* BOTH RENDERERS RUN IT. The PDF is the only page-accurate view and it is the one the debtor
   gets; a removal the screen does and the paper does not is two different notices. */
const layout = readFileSync(new URL('../../src/lib/letterLayout.ts', import.meta.url), 'utf8')
ok('the PDF drops the same blocks', /documentWithoutOptional\(doc, values\)/.test(layout))
/* Before the page breaks are planned, or a block removed afterwards moves every break after it. */
const cutAt = layout.indexOf('documentWithoutOptional(doc, values)')
const planAt = layout.indexOf('const pages: PlannedPage[]')
ok('...and there is a page plan to order it against', planAt > 0)
ok('...before the pages are planned, not after', cutAt > 0 && cutAt < planAt)

/* ---------- the workflow no longer holds on it ---------- */

/*
 * THE WHOLE REASON THIS EXISTS. Asserted on the send planner rather than only on the renderer:
 * the hold is raised there, from `unfilled`, and a renderer that quietly did the right thing
 * under a planner that still counted the field would fix nothing.
 */
const send = readFileSync(new URL('../../src/lib/workflowSend.ts', import.meta.url), 'utf8')
ok('the send plan still holds on a field nothing can fill',
  /if \(unfilled\.length > 0\) \{/.test(send))
ok('...and reads that list from renderTemplate rather than counting fields itself',
  /\.\.\.\(merged\?\.missing \?\? \[\]\)/.test(send))

/*
 * AND THE EDITOR SAYS WHICH FIELDS THOSE ARE. Somebody writing a statutory notice has to know
 * which of the chips they are inserting can hold a whole workflow and which will quietly leave.
 */
const editor = readFileSync(new URL('../../src/pages/library/TemplateEditor.tsx', import.meta.url), 'utf8')
ok('the editor marks the optional fields', /f\.optional && <span/.test(editor))
ok('...and says what the mark means', /the line\s*\n?\s*it sits on is left out/.test(editor))

/* ------------------------------------------------------------------ */

for (const f of failures) console.error(`  ✗ ${f}`)
console.log(`check-optional-fields: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
