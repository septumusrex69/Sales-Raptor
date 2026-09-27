/**
 * THE 24 PAYMENT ARRANGEMENT TEMPLATES, HELD AGAINST WHAT THE FIRM HANDED OVER.
 *
 * READ OUT OF THE MIGRATION, not out of the database: a check that queried staging would pass on a
 * row somebody edited in the Library and fail on a laptop with no network. The migration is the
 * record, and it is what a fresh environment is built from.
 *
 * WHAT WOULD BREAK WITHOUT THIS. The set is 24 templates in six matched pairs across two
 * audiences, and every one of the failures it guards is silent: a letter whose blocks do not parse
 * renders as nothing; an email with no subject cannot be saved at all; an SMS carrying a character
 * outside GSM-7 halves every segment and doubles what the debtor is charged under item 1(c); and a
 * merge field nobody offers -- a typo, or one written for the wrong scope -- resolves to a literal
 * {{brace}} in a statutory-adjacent notice.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-ptp-templates.mjs
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
   is how these were validated before they were written to staging. */
const sql = readFileSync(process.argv[2] ?? new URL('../../supabase/schema.sql', import.meta.url), 'utf8')

/*
 * THE ROWS, PARSED OUT OF THE MIGRATION'S OWN INSERTS. Read rather than re-listed here: a second
 * copy of 24 bodies in a check file is 24 bodies that can disagree with the ones that shipped.
 */
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
    if ((row.seed_key ?? '').includes('-ptp-')) out.push(row)
  }
  return out
}

/* A comma-splitter that knows about '' inside a quoted string. A naive split on ',' cuts every
   letter document in half at its first table. */
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

/*
 * AND THEN EVERY UPDATE THAT FOLLOWED, IN FILE ORDER.
 *
 * schema.sql IS APPEND-ONLY, SO THE LAST WRITE IS THE LIVE ONE -- the same rule CLAUDE.md states
 * for functions, and it applies to a template row for exactly the same reason. Reading only the
 * `insert` left this check asserting against wording the firm had already had changed: the
 * simulation email's opening line and the whole arrangement confirmation were both rewritten by
 * later migrations, and the check went on validating the superseded copies and passing.
 *
 * THREE SHAPES, WHICH ARE THE THREE THE FILE USES: a whole new body, a `replace` of one sentence
 * inside it, and a flag. Anything else is ignored rather than guessed at -- and the row it would
 * have changed then fails the assertions below, which is the safe direction.
 */
function applyUpdates(text, rowsByKey) {
  const re = /update public\.message_templates\s+set ([\s\S]*?)\s+where seed_key ([^;]*);/g
  let m
  while ((m = re.exec(text)) !== null) {
    const [set, where] = [m[1], m[2]]
    const keys = literalsIn(where)
    const rows = keys.map((k) => rowsByKey.get(k)).filter(Boolean)
    if (rows.length === 0) continue
    const lit = literalsIn(set)
    if (/^body\s*=\s*replace\(/.test(set) && lit.length === 2) {
      for (const r of rows) r.body = (r.body ?? '').split(lit[0]).join(lit[1])
    } else if (/^body\s*=/.test(set) && lit.length === 1) {
      for (const r of rows) r.body = lit[0]
    } else if (/^attaches_schedule\s*=/.test(set)) {
      for (const r of rows) r.attaches_schedule = /=\s*true/.test(set) ? 'true' : 'false'
    }
  }
}

/* Every single-quoted literal in a fragment of SQL, '' unescaped. The same convention splitValues
   above already knows about, and the only one these migrations use. */
function literalsIn(text) {
  const out = []
  let cur = null
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]
    if (cur === null) { if (c === "'") cur = ''; continue }
    if (c === "'" && text[i + 1] === "'") { cur += "'"; i += 1; continue }
    if (c === "'") { out.push(cur); cur = null; continue }
    cur += c
  }
  return out
}

const rows = rowsFrom(sql)
const by = new Map(rows.map((r) => [r.seed_key, r]))
applyUpdates(sql, by)

/* Asserted present before anything about their contents, or a missing migration passes vacuously. */
check('all 24 arrangement templates are in the schema', rows.length, 24)
/*
 * AND READ DEFENSIVELY PAST IT. CLAUDE.md's second trap, seen here already: indexing a row that is
 * not there throws a TypeError two lines below the check that should have REPORTED it, so a deleted
 * migration prints a stack trace and no count -- and run-all reads the count.
 */
const need = (key) => by.get(key) ?? { seed_key: key, body: '', subject: null, kind: '', audience: '' }

const EXPECTED = {
  letter: ['letter-ptp-default-individual', 'letter-ptp-default-company'],
  /*
   * SIX EMAIL PAIRS, AND THE SIXTH IS NOT PART OF THE SEQUENCE. The five above ride on the
   * arrangement's own workflow; `simulation` is the covering note for the payment simulation and
   * goes out BEFORE there is an arrangement at all -- the firm: "this is before you conclude the
   * payment arrangement." It is held to the same rules as the rest because every failure they
   * guard is the same one: an email with no subject cannot be saved, and a merge field nobody
   * offers resolves to a literal {{brace}} in front of a debtor.
   */
  email: ['confirmed', 'reminder', 'due-today', 'receipt', 'default', 'simulation']
    .flatMap((s) => [`email-ptp-${s}-individual`, `email-ptp-${s}-company`]),
  sms: ['confirmed', 'reminder', 'due-today', 'receipt', 'default']
    .flatMap((s) => [`sms-ptp-${s}-individual`, `sms-ptp-${s}-company`]),
}
for (const [kind, keys] of Object.entries(EXPECTED)) {
  for (const k of keys) ok(`${k} is there`, by.has(k))
  check(`...${keys.length} of them are ${kind}s`,
    rows.filter((r) => r.kind === kind).length, keys.length)
}

/*
 * EVERY STEP IS A PAIR, BOTH AUDIENCES. The firm writes to a person and to a company differently --
 * "Dear Mr Mokoena" against "Dear Sirs / Madams", an identity number against a registration number
 * -- and a missing half means the runner holds every arrangement on one kind of debtor.
 */
for (const r of rows) {
  ok(`${r.seed_key} says which audience it is for`,
    r.audience === (r.seed_key.endsWith('-company') ? 'company' : 'individual'))
  check(`...and is on the collections side`, r.scope, 'collections')
  ok(`...and is active`, r.active === 'true')
}

/* ---------- the rules that carry over ---------- */

/* An email needs a subject; a letter and an SMS must not have one. The database refuses otherwise,
   so this catches it before the migration is run rather than halfway through it. */
for (const r of rows) {
  if (r.kind === 'email') ok(`${r.seed_key} has a subject`, (r.subject ?? '').length > 10)
  else check(`${r.seed_key} has no subject`, r.subject, null)
}

/* ---------- the letters ---------- */

for (const key of EXPECTED.letter) {
  const doc = parseLetter(need(key).body)
  ok(`${key} parses as a letter document`, doc !== null)
  ok(`...with the notice in it`, (doc?.blocks ?? []).length > 15)
  /*
   * NO PROBLEMS THE LIBRARY WOULD REFUSE TO SEND. letterProblems is the same function the Library
   * runs, and canUseLetter is the same gate -- so a letter that passes here is one the firm can
   * actually attach, rather than one that merely parses.
   */
  const problems = letterProblems(doc, 'collections')
  ok(`...and nothing that would stop it being sent`, canUseLetter(problems))
  check(`...with no problems at all`, problems.map((p) => p.message ?? p), [])
  /* THE 48 HOURS THE LETTER PROMISES, in the letter. This is the sentence the whole hold exists to
     keep, and a letter that does not say it is a hold with no reason. */
  ok(`...promising 48 hours`, /within 48 hours of the date of this letter/.test(lettersText(doc)))
  /* AND THE PAYMENT REFERENCE IS OURS. 21% of client references are shared between accounts, so a
     payment quoting one cannot be allocated. */
  ok(`...and quoting our case number to pay with`, /PAYMENT REFERENCE[\s\S]{0,40}case_number/.test(need(key).body))
  ok(`...never the client’s reference`, !/\{\{reference\}\}/.test(need(key).body))
}

/* The individual's letter names an identity number and the company's a registration number, and
   putting either on the other kind of debtor is what those two fields exist to stop. */
ok('the individual’s letter asks for an identity number',
  /debtor_id_masked/.test(need('letter-ptp-default-individual').body))
ok('...and not a registration number',
  !/debtor_reg_no/.test(need('letter-ptp-default-individual').body))
ok('the company’s letter asks for a registration number',
  /debtor_reg_no/.test(need('letter-ptp-default-company').body))
ok('...and not an identity number',
  !/debtor_id_masked/.test(need('letter-ptp-default-company').body))

/* ---------- the attachment ---------- */

/*
 * ONLY THE TWO DEFAULT EMAILS CARRY ONE, and each points at the letter for ITS OWN AUDIENCE. Crossed
 * over, a company would receive a notice addressed to a person, with an identity number field on it.
 */
for (const r of rows) {
  const wants = r.seed_key.startsWith('email-ptp-default-')
  /* The `?? ''` is what makes this safe on a row with no attachment; the `!== null` it used to be
     ANDed with was always true, which is a dead conjunct sitting in front of the real assertion. */
  const has = /seed_key = '?letter-ptp-default/.test(r.attachment_id ?? '')
  check(`${r.seed_key} ${wants ? 'attaches its letter' : 'attaches nothing'}`, has, wants)
  if (wants) {
    ok(`...the letter for its own audience`,
      (r.attachment_id ?? '').includes(`letter-ptp-default-${r.audience}`))
  }
}

/* ---------- every merge field is one the collections side offers ---------- */

/*
 * A FIELD NOBODY OFFERS RESOLVES TO A LITERAL {{brace}} IN A NOTICE. The closed list is the whole
 * protection -- templateProblems refuses a field outside the template's scope -- and these 22 were
 * written outside Raptor, so nothing has checked them until now.
 */
const known = new Set(MERGE_FIELDS.collections.map((f) => f.key))
for (const r of rows) {
  /*
   * {{page}} AND {{pages}} ARE NOT MERGE FIELDS and are excluded here rather than added to the
   * vocabulary. They are PRINTER_FIELDS -- filled by letterPdf as it lays the sheets out, which is
   * the only place that knows how many there are -- and offering them in the library would invite
   * somebody to put a page number in an SMS. letterProblems knows this, which is why the letters
   * report no problems above while this assertion failed on them. Found by exactly that.
   */
  const unknown = unknownFields('collections', r.body, r.kind === 'email' ? r.subject : null)
    .filter((f) => !PRINTER_FIELDS.includes(f))
  check(`${r.seed_key} uses only fields the collections side offers`, unknown, [])
  /* And the printer's two appear ONLY in a letter's running foot: a page number in an email or an
     SMS is a placeholder that will never be filled. */
  if (r.kind !== 'letter') {
    ok(`...and no page numbers`, !PRINTER_FIELDS.some((f) => r.body.includes(`{{${f}}}`)))
  }
}
/* And the three the set needed are actually offered, or every one of the assertions above passes by
   agreeing that nothing is known. */
for (const f of ['ptp_amount', 'ptp_date', 'ptp_paid']) ok(`{{${f}}} is offered`, known.has(f))

/*
 * THE RECEIPT CONFIRMS WHAT WAS RECEIVED, NOT WHAT IS STILL OWED. The firm's own wording asked for
 * {{ptp_amount}} in both places -- and the payment just allocated has already moved the "earliest
 * unpaid" boundary, so that first line would have confirmed receipt of the instalment still due. On
 * an arrangement whose last instalment is the remainder that is a receipt for R2 500 against R100.
 */
for (const key of ['email-ptp-receipt-individual', 'email-ptp-receipt-company']) {
  ok(`${key} confirms what was paid`, /receipt of \{\{ptp_paid\}\}/.test(need(key).body))
  ok(`...and quotes the next instalment separately`,
    /Next payment: \{\{ptp_amount\}\} on \{\{ptp_date\}\}/.test(need(key).body))
}
/* Nothing else in the set may use it: ptp_paid is only true on a receipt. A reminder saying "you
   paid" is a reminder about a payment that has not happened. */
for (const r of rows) {
  if (r.seed_key.includes('-receipt-')) continue
  ok(`${r.seed_key} does not claim a payment was received`, !/ptp_paid/.test(r.body))
}

/* ---------- the SMSs ---------- */

/*
 * GSM-7 ONLY, AND IT IS A PRICE AND NOT A STYLE. One character outside the GSM alphabet drops the
 * whole message to UCS-2 and cuts every segment from 160 characters to 70 -- so a 135-character
 * message becomes two segments, and the debtor is charged for both under Annexure B item 1(c).
 */
for (const key of EXPECTED.sms) {
  const body = need(key).body
  check(`${key} is plain GSM-7`, smsCost(body).offending, [])
  /*
   * ONE SEGMENT WITH THE FIRM'S OWN WORST CASE MERGED IN. Measured on the template alone the fields
   * are shorter than what replaces them, which is how a one-segment template becomes a
   * two-segment message. The name is the long one from the firm's own examples.
   */
  const merged = body
    .replace(/\{\{debtor_name\}\}/g, 'Mr Van Der Westhuizen')
    .replace(/\{\{case_number\}\}/g, 'RAP-100001')
    .replace(/\{\{ptp_amount\}\}/g, 'R 2 500.00')
    .replace(/\{\{ptp_paid\}\}/g, 'R 2 500.00')
    .replace(/\{\{ptp_date\}\}/g, '5 October 2026')
    .replace(/\{\{firm_phone\}\}/g, '012 348 2156')
    .replace(/\{\{firm_name\}\}/g, 'Bredell Ferreira')
  const cost = smsCost(merged)
  check(`...and GSM-7 once merged`, cost.offending, [])
  check(`...and one segment with a long name in it (${cost.units} units)`, cost.segments, 1)
}

/* ---------- what the confirmation has to say, in the firm's own words ---------- */

/*
 * THE FIRM READ THE ONE THAT WENT OUT ON RAP-123799 AND SENT IT BACK. What they asked for is
 * asserted here rather than only written into the migration, because the next person to touch
 * these two rows will be doing it from the seed insert six thousand lines up the file.
 */
for (const key of ['email-ptp-confirmed-individual', 'email-ptp-confirmed-company']) {
  const r = need(key)
  /* THE PREMISE FIRST: the check reads the seed insert and then the updates after it, so an
     applyUpdates that quietly stopped working would leave every assertion below testing the
     superseded body -- and the old body passes most of them. */
  ok(`${key} is the rewritten body, not the seeded one`,
    /in the following way\./.test(r.body))
  /*
   * "IT SHOULD BE WEEKLY MONTHLY, LIKE THAT SHOULD BE DISCLOSED." An amount and a date describe a
   * single payment; the debtor on that email had agreed to R500 a WEEK against R13 347,31.
   */
  ok(`...and it says how often the instalment falls`, /\{\{ptp_frequency\}\}/.test(r.body))
  /* "MENTION THE FIRST PAYMENT IS DUE ON THE 4TH OF OCTOBER" -- the date is labelled as the start
     of something rather than as a due date standing on its own. */
  ok(`...and names the date as the first payment`, /First payment: /.test(r.body))
  ok(`...and still carries what is outstanding`, /\{\{balance\}\}/.test(r.body))
  /*
   * "SOMETHING SHOULD BE IN BOLD IF IT COULD POSSIBLY BE." The three figures that ARE the
   * arrangement. See emailBodyHtml for the convention and for why no asterisk reaches an inbox.
   */
  for (const field of ['ptp_amount', 'ptp_date', 'balance']) {
    ok(`...with {{${field}}} in bold`, r.body.includes(`**{{${field}}}**`))
  }
  /*
   * "WE DON'T SAY WE AGREE TO THIS ACCOUNT." The firm's objection to the opening line: the debtor
   * made an arrangement to pay, and the firm confirming an agreement "on your account" reads as
   * the firm agreeing something about the DEBT.
   */
  ok(`...and does not put the firm on one side of an agreement`,
    !/We confirm the payment arrangement agreed/.test(r.body))
  ok(`...saying instead that the arrangement was made`,
    /has|have/.test(r.body) && /made an arrangement to pay/.test(r.body))
  /*
   * AND THE HOLD IS NOT UNCONDITIONAL. "We hold the collection steps on your account unless
   * instructed otherwise by a client, or our legal department" -- the firm's words. The account is
   * somebody else's book, and a promise the firm cannot keep is one a debtor can hold it to.
   */
  ok(`...and the hold is subject to the client and the legal department`,
    /unless our client or our legal department instructs us otherwise/.test(r.body))
  /*
   * "I DON'T THINK WE NEED TO PUT ANY ATTACHMENT." And the reason beyond taste: `total_promised` is
   * null on an open-ended arrangement, so the projection the page drew -- 31 payments to 2 May
   * 2027, R15 222,32 in all -- was headed "YOUR PAYMENT ARRANGEMENT: WHAT IT WILL COST" over
   * figures nobody had agreed to.
   */
  check(`...and it carries no schedule`, r.attaches_schedule, 'false')
}

/*
 * AND "FIRST PAYMENT" IS THE CONFIRMATION'S ALONE.
 *
 * {{ptp_date}} IS THE EARLIEST INSTALMENT NOT YET PAID, which MOVES as payments come in -- and
 * that is exactly what the other four arrangement notices need. It reads as the FIRST one only
 * because the confirmation goes out at the moment the arrangement is recorded, when nothing has
 * been paid and instalments_kept is 0. On a reminder or a default the same label would name the
 * third payment as the first.
 *
 * SO THE LABEL IS BOUNDED TO THE ONE NOTICE WHERE IT IS TRUE, rather than left as a phrase
 * somebody copies into the next template that quotes a date.
 */
for (const r of rows) {
  if (r.seed_key.startsWith('email-ptp-confirmed-')) continue
  ok(`${r.seed_key} does not call the next instalment the first`, !/First payment/.test(r.body))
}

/*
 * AND NO SMS CARRIES THE BOLD MARKER. An SMS has no bold at all: it goes out as the characters in
 * the body, so `**` would reach a debtor as two asterisks -- and each one is a character counted
 * against the 160 the segment is priced on under item 1(c).
 */
for (const key of EXPECTED.sms) {
  ok(`${key} has no bold marker in it`, !need(key).body.includes('**'))
}

/* ------------------------------------------------------------------ */

for (const f of failures) console.error(`  ✗ ${f}`)
console.log(`check-ptp-templates: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
