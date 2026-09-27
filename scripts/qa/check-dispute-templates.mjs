/**
 * THE 33 DISPUTE TEMPLATES, HELD AGAINST WHAT THE FIRM HANDED OVER.
 *
 * READ OUT OF THE MIGRATION, not out of the database, for the reason check-ptp-templates gives: a
 * check that queried staging would pass on a row somebody edited in the Library and fail on a laptop
 * with no network. The migration is the record and it is what a fresh environment is built from.
 *
 * WHAT WOULD BREAK WITHOUT THIS, and only the last of the four is new to this set:
 *
 *   - a letter whose blocks do not parse renders as nothing;
 *   - an email with no subject cannot be saved at all;
 *   - an SMS carrying one character outside GSM-7 halves every segment and doubles what the debtor
 *     is charged under Annexure B item 1(c);
 *   - AND {{dispute_summary}} IS THE ONE FIELD IN THE COLLECTIONS VOCABULARY THAT IS NOT WRITTEN FOR
 *     THE DEBTOR TO READ. It is the collector's own note about what is alleged, and it belongs in
 *     the three internal notifications and nowhere else. A debtor reading the firm's working note on
 *     their own dispute is how a file ends up quoted back at the firm, so the assertion that it
 *     appears in exactly three templates is the point of this file rather than a detail of it.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-dispute-templates.mjs
 */
import { readFileSync } from 'node:fs'
import { parseLetter, letterProblems, canUseLetter, lettersText, PRINTER_FIELDS } from '../../src/lib/letterDocument.ts'
import { unknownFields, MERGE_FIELDS } from '../../src/lib/messageTemplates.ts'
import { smsCost } from '../../src/lib/smsSegments.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
/* schema.sql is the record. An argument points the same logic at a migration not yet applied, which
   is how these 33 were validated before they were written to staging. */
const sql = readFileSync(process.argv[2] ?? new URL('../../supabase/schema.sql', import.meta.url), 'utf8')

/* The same two readers check-ptp-templates uses: the inserts are the record, and a comma-splitter
   that knows about '' inside a quoted string, because a naive split cuts every letter document in
   half at its first table. */
function splitValues(text) {
  const out = []
  let cur = ''
  let inStr = false
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]
    if (inStr) {
      if (c === "'" && text[i + 1] === "'") { cur += "'"; i += 1; continue }
      if (c === "'") { inStr = false; continue }
      cur += c
      continue
    }
    if (c === "'") { inStr = true; continue }
    if (c === ',') { out.push(cur.trim()); cur = ''; continue }
    cur += c
  }
  out.push(cur.trim())
  return out.map((v) => (v === 'null' ? null : v))
}

function rowsFrom(text) {
  const out = []
  const re = /insert into public\.message_templates \(([^)]*)\)\s*\nvalues \(([\s\S]*?)\)\s*\non conflict \(seed_key\)/g
  let m
  while ((m = re.exec(text)) !== null) {
    const cols = m[1].split(',').map((c) => c.trim())
    const vals = splitValues(m[2])
    if (vals.length !== cols.length) continue
    const row = {}
    cols.forEach((c, i) => { row[c] = vals[i] })
    /*
     * MATCHED ON 'dispute-' AND NOT ON 'dispute', which is the difference between this set and the
     * call script the library has carried since the first seed -- `call-disputed`, whose wording is
     * about a debtor who says the account is wrong on the telephone. Included, every assertion below
     * about audiences and pairs would report a failure on a row that has nothing to do with this
     * migration.
     */
    if ((row.seed_key ?? '').includes('dispute-')) out.push(row)
  }
  return out
}

const rows = rowsFrom(sql)
const by = new Map(rows.map((r) => [r.seed_key, r]))

/* Asserted present before anything about their contents, or a missing migration passes vacuously. */
check('all 33 dispute templates are in the schema', rows.length, 33)
/* AND READ DEFENSIVELY PAST IT: indexing a row that is not there throws a TypeError two lines below
   the check that should have REPORTED it, so a deleted migration prints a stack trace and no count
   -- and run-all reads the count, so it reports the file as having asserted nothing. */
const need = (key) => by.get(key) ?? { seed_key: key, body: '', subject: null, kind: '', audience: '' }

/* The seven steps, in the order the workflow walks them: stage A's four, stage B's one, stage C's
   two. Each is a pair, one template for a person and one for a company. */
const STEPS = ['writing', 'reminder', 'final-reminder', 'undisputed', 'acknowledged', 'upheld', 'not-upheld']
const INTERNAL = ['email-internal-dispute-referral', 'email-internal-dispute-followup',
  'email-internal-dispute-escalation']
const EXPECTED = {
  letter: ['letter-dispute-undisputed-individual', 'letter-dispute-undisputed-company'],
  email: [...STEPS.flatMap((s) => [`email-dispute-${s}-individual`, `email-dispute-${s}-company`]), ...INTERNAL],
  sms: STEPS.flatMap((s) => [`sms-dispute-${s}-individual`, `sms-dispute-${s}-company`]),
}
for (const [kind, keys] of Object.entries(EXPECTED)) {
  for (const k of keys) ok(`${k} is there`, by.has(k))
  check(`...${keys.length} of them are ${kind}s`,
    rows.filter((r) => r.kind === kind).length, keys.length)
}

/*
 * EVERY STEP IS A PAIR, BOTH AUDIENCES -- the firm writes to a person and to a company differently,
 * "Dear Mr Mokoena" against "Dear Sirs / Madams", an identity number against a registration number
 * -- AND THE THREE INTERNAL NOTIFICATIONS HAVE NO AUDIENCE AT ALL. They are about the FILE rather
 * than about the debtor and the same note goes to the liaison whichever kind of debtor it is, so
 * audience is null there. Given one it would be a lie on the row and would make the liaison's
 * referral pickable by only half the book.
 */
for (const r of rows) {
  const expected = INTERNAL.includes(r.seed_key)
    ? null
    : (r.seed_key.endsWith('-company') ? 'company' : 'individual')
  check(`${r.seed_key} says which audience it is for`, r.audience, expected)
  check(`...and is on the collections side`, r.scope, 'collections')
  ok(`...and is active`, r.active === 'true')
}

/* An email needs a subject; a letter and an SMS must not have one. The database refuses otherwise,
   so this catches it before the migration is run rather than halfway through it. */
for (const r of rows) {
  if (r.kind === 'email') ok(`${r.seed_key} has a subject`, (r.subject ?? '').length > 10)
  else check(`${r.seed_key} has no subject`, r.subject, null)
}

/* ---------- the collector's own note, and the three templates it may appear in ---------- */

/*
 * THE ASSERTION THIS FILE EXISTS FOR. {{dispute_summary}} is free text the collector writes about
 * what the debtor alleges, in the firm's words rather than the debtor's, and the firm's own
 * instruction is that it "appears only in the internal notifications, never in a message to the
 * debtor".
 *
 * BOTH DIRECTIONS, because each catches a different mistake: a fourth template quoting it is a
 * leak, and an internal notification that has LOST it is a referral that tells the liaison nothing.
 * Counted first so that a set with none of them cannot pass the per-row assertion by agreeing that
 * no row has it.
 */
const carries = rows.filter((r) => r.body.includes('{{dispute_summary}}')).map((r) => r.seed_key).sort()
check('the collector’s note is in exactly the three internal notifications', carries, [...INTERNAL].sort())
for (const r of rows) {
  if (INTERNAL.includes(r.seed_key)) continue
  ok(`${r.seed_key} does not repeat the collector’s note to the debtor`,
    !r.body.includes('{{dispute_summary}}') && !(r.subject ?? '').includes('{{dispute_summary}}'))
}
/* And it is offered at all, or every assertion above passes by agreeing that nothing is known. */
const known = new Set(MERGE_FIELDS.collections.map((f) => f.key))
for (const f of ['dispute_days_left', 'dispute_alleged_date', 'dispute_received_date', 'dispute_summary']) {
  ok(`{{${f}}} is offered`, known.has(f))
}

/*
 * THE WINDOW IS QUOTED WHILE IT IS STILL RUNNING AND NOT AFTERWARDS. {{dispute_days_left}} belongs
 * on the two messages that ask for the dispute and on nothing else: the last-day message says
 * "tomorrow", the deemed-undisputed message says the window has closed, and an acknowledgement or a
 * finding has no window left to count. "You have 0 business days" is the failure on the other side.
 */
const counts = rows.filter((r) => r.body.includes('{{dispute_days_left}}')).map((r) => r.seed_key).sort()
check('the days left are quoted on the two messages that ask for the dispute', counts,
  ['writing', 'reminder'].flatMap((s) => [`email-dispute-${s}-individual`, `email-dispute-${s}-company`]).sort())

/* ---------- what each stage tells the debtor, which is the part the firm will be held to ---------- */

/*
 * AN ALLEGATION SUSPENDS NOTHING AND A WRITTEN DISPUTE SUSPENDS EVERYTHING. That is the whole of
 * stage A against stage B, and it is the sentence a debtor will quote back: the collections workflow
 * keeps running on an allegation, and the period in the section 129 keeps running with it.
 */
for (const a of ['individual', 'company']) {
  ok(`the stage A email to ${a === 'company' ? 'a company' : 'a person'} says an allegation suspends nothing`,
    /does not, on its own, suspend anything/.test(need(`email-dispute-writing-${a}`).body))
  ok(`...and that it is the writing that suspends it`,
    /suspended only once we have/.test(need(`email-dispute-writing-${a}`).body))
  ok(`the acknowledgement to ${a === 'company' ? 'a company' : 'a person'} says collection is suspended`,
    /Collection on this account is suspended/.test(need(`email-dispute-acknowledged-${a}`).body))
}

/*
 * NOTHING IN THIS WORKFLOW CLOSES AN ACCOUNT. The firm: "Do not hard-wire upheld = close." An upheld
 * finding leaves the account SUSPENDED and waiting on the creditor's instruction -- a withdrawal is
 * its own stage and is still to be built -- so the upheld email must say the suspension REMAINS and
 * must not tell a debtor the matter is closed or written off.
 */
for (const a of ['individual', 'company']) {
  const body = need(`email-dispute-upheld-${a}`).body
  ok(`the upheld finding to a ${a} leaves collection suspended`,
    /remains suspended/.test(body))
  ok(`...and awaits the creditor’s instruction`, /await their instruction/.test(body))
  ok(`...and never tells them the account is closed`,
    !/\b(closed|written off|withdrawn)\b/i.test(body))
}

/* ---------- the letters ---------- */

for (const key of EXPECTED.letter) {
  const doc = parseLetter(need(key).body)
  ok(`${key} parses as a letter document`, doc !== null)
  ok(`...with the notice in it`, (doc?.blocks ?? []).length > 15)
  /* NO PROBLEMS THE LIBRARY WOULD REFUSE TO SEND. letterProblems is the same function the Library
     runs and canUseLetter is the same gate, so a letter that passes here is one the firm can
     actually attach rather than one that merely parses. */
  const problems = letterProblems(doc, 'collections')
  ok(`...and nothing that would stop it being sent`, canUseLetter(problems))
  check(`...with no problems at all`, problems.map((p) => p.message ?? p), [])
  const text = lettersText(doc ?? { blocks: [] })
  /*
   * THE DATE THE WINDOW CLOSED, QUOTED AS ONE FIELD IN THREE PLACES. The firm's PDF writes it out
   * each time -- "DUE BY", "Because nothing was received by", "the time to raise it was before" --
   * and a notice that gives two different closing dates is a notice a debtor can argue with. There
   * are three in the prose and the box, so anything less means one of them was typed as a date.
   */
  const respondBys = (need(key).body.match(/\{\{respond_by\}\}/g) ?? []).length
  ok(`...quoting the same closing date throughout (${respondBys})`, respondBys >= 3)
  ok(`...and the day the dispute was alleged`, /\{\{dispute_alleged_date\}\}/.test(need(key).body))
  /* IT SAYS WHAT WAS RECEIVED, AND "Nothing" IS A LITERAL. This notice exists only on the branch
     where nothing arrived; a field there could only ever resolve to one word. */
  ok(`...and that nothing came back`, /Nothing, as at the date of this letter/.test(text))
  /* THE DOOR STAYS OPEN. The firm's own section: a dispute sent late is still investigated, and
     what it cannot do is undo steps already taken. */
  ok(`...and that a late dispute is still investigated`, /whatever stage the account has reached/.test(text))
  /* AND THE PAYMENT REFERENCE IS OURS. 21% of client references are shared between accounts, so a
     payment quoting one cannot be allocated to any of them. */
  ok(`...quoting our case number to pay with`, /PAYMENT REFERENCE[\s\S]{0,40}case_number/.test(need(key).body))
}

/* The individual's notice names an identity number and the company's a registration number, and
   putting either on the other kind of debtor is what those two fields exist to stop. */
ok('the individual’s notice asks for an identity number',
  /debtor_id_masked/.test(need('letter-dispute-undisputed-individual').body))
ok('...and not a registration number',
  !/debtor_reg_no/.test(need('letter-dispute-undisputed-individual').body))
ok('the company’s notice asks for a registration number',
  /debtor_reg_no/.test(need('letter-dispute-undisputed-company').body))
ok('...and not an identity number',
  !/debtor_id_masked/.test(need('letter-dispute-undisputed-company').body))

/* ---------- the attachment ---------- */

/*
 * ONLY THE TWO DEEMED-UNDISPUTED EMAILS CARRY ONE, and each points at the notice for ITS OWN
 * AUDIENCE. Crossed over, a company would receive a notice addressed to a person with an identity
 * number on it. The outcome emails carry nothing on purpose: the firm's instruction is that they
 * state the finding and no more, and the reasons are the collector's to give outside this workflow.
 */
for (const r of rows) {
  if (r.kind !== 'email') continue
  const wants = r.seed_key.startsWith('email-dispute-undisputed-')
  const has = /seed_key = '?letter-dispute-undisputed/.test(r.attachment_id ?? '')
  check(`${r.seed_key} ${wants ? 'attaches its notice' : 'attaches nothing'}`, has, wants)
  if (wants) {
    ok(`...the notice for its own audience`,
      (r.attachment_id ?? '').includes(`letter-dispute-undisputed-${r.audience}`))
  }
}

/* ---------- every merge field is one the collections side offers ---------- */

/*
 * A FIELD NOBODY OFFERS RESOLVES TO A LITERAL {{brace}} IN A NOTICE. The closed list is the whole
 * protection -- templateProblems refuses a field outside the template's scope -- and these 33 were
 * written outside Raptor, so nothing checked them until they were parsed here.
 */
for (const r of rows) {
  /* {{page}} and {{pages}} are PRINTER_FIELDS, filled by letterPdf as it lays the sheets out, and
     excluded here rather than added to the vocabulary: offering them in the library would invite
     somebody to put a page number in an SMS. */
  const unknown = unknownFields('collections', r.body, r.kind === 'email' ? r.subject : null)
    .filter((f) => !PRINTER_FIELDS.includes(f))
  check(`${r.seed_key} uses only fields the collections side offers`, unknown, [])
  if (r.kind !== 'letter') {
    ok(`...and no page numbers`, !PRINTER_FIELDS.some((f) => r.body.includes(`{{${f}}}`)))
  }
  /*
   * AND OURS IS THE REFERENCE THE DEBTOR IS TOLD TO QUOTE. The firm handed this set over quoting
   * {{reference}}, the client's own filing, which is used on more than one account 5 013 times over
   * -- so 21% of the book cannot be identified by it, and a payment quoting one cannot be allocated.
   * The swap was free because RAP-100001 and GPS3/10103 are the same width, which is what keeps the
   * measured SMS counts below honest.
   */
  ok(`${r.seed_key} quotes our case number, not the client’s reference`,
    !/\{\{reference\}\}/.test(`${r.body}${r.subject ?? ''}`))
}

/* ---------- the SMSs ---------- */

/*
 * GSM-7 ONLY, AND IT IS A PRICE AND NOT A STYLE. One character outside the GSM alphabet drops the
 * whole message to UCS-2 and cuts every segment from 160 characters to 70 -- so a 135-character
 * message becomes two, and the debtor is charged for both under Annexure B item 1(c).
 */
for (const key of EXPECTED.sms) {
  const body = need(key).body
  check(`${key} is plain GSM-7`, smsCost(body).offending, [])
  /*
   * ONE SEGMENT WITH THE FIRM'S OWN WORST CASE MERGED IN. Measured on the template alone the fields
   * are shorter than what replaces them, which is how a one-segment template becomes a two-segment
   * message. The name and the email address are the long ones from the firm's own examples, and the
   * longest of these is 145 characters -- fifteen from the boundary.
   */
  const merged = body
    .replace(/\{\{debtor_name\}\}/g, 'Mr Van Der Westhuizen')
    .replace(/\{\{case_number\}\}/g, 'RAP-100001')
    .replace(/\{\{collector_email\}\}/g, 'rinda@bredellferreira.co.za')
    .replace(/\{\{respond_by\}\}/g, '5 October 2026')
    .replace(/\{\{firm_phone\}\}/g, '012 348 2156')
  /* Nothing may be left standing, or the count below is for a message shorter than the one sent. */
  ok(`...and the worst case covers every field in it`, !/\{\{/.test(merged))
  const cost = smsCost(merged)
  check(`...and GSM-7 once merged`, cost.offending, [])
  check(`...and one segment with a long name in it (${cost.units} units)`, cost.segments, 1)
}

/* ------------------------------------------------------------------ */

for (const f of failures) console.error(`  ✗ ${f}`)
console.log(`check-dispute-templates: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
