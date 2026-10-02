/**
 * THE ACKNOWLEDGEMENT OF DEBT, HELD AGAINST THE FIRM'S OWN SPECIMENS.
 *
 * THE FIRM supplied BF-Acknowledgement-of-Debt-Individuals and -Companies and asked for them "as an
 * email template". They are not emails: each is a NINE-PAGE AGREEMENT and the email is the covering
 * note that attaches it -- so each produces two rows, which is the shape the section 129 has.
 *
 * WHAT THIS FILE IS REALLY FOR: a document somebody SIGNS. Every other letter in this library is a
 * demand, and the worst a broken one does is read badly. This one waives defences and annexes a
 * consent to judgment, so a merge field that silently resolves to nothing is a figure the debtor
 * never saw in a clause that says they checked it.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-aod.mjs
 */
import { readFileSync } from 'node:fs'
import { MERGE_FIELDS } from '../../src/lib/messageTemplates.ts'
import { aod, covering } from '../letters/aod.mjs'
import { BY_HAND_SEED_KEYS } from '../../src/lib/byHand.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

const letters = JSON.parse(read('scripts/letters/letters.json'))
const texts = Object.fromEntries(
  ['individual', 'company'].map((k) => [k, JSON.stringify(aod(k))]),
)

/* ---------------------------------------------------------------------------------------------
 * EVERY FIELD IT USES EXISTS
 * ------------------------------------------------------------------------------------------- */

/*
 * THE ASSERTION THAT MATTERS MOST ON THIS DOCUMENT. A brace nobody resolves prints as "{{balance}}"
 * in a clause the debtor has just confirmed they checked -- and renderTemplate holds a message
 * whose fields are unresolved, so the real failure is a notice that silently will not send.
 */
const known = new Set(MERGE_FIELDS.collections.map((f) => f.key))
for (const kind of ['individual', 'company']) {
  const used = [...new Set((texts[kind] + covering(kind)).match(/\{\{([a-z_0-9]+)\}\}/g) ?? [])]
    .map((x) => x.slice(2, -2))
  const unknown = used.filter((k) => !known.has(k))
  check(`every field the ${kind} version uses is a real one`, unknown, [])
  ok(`...and it uses a good many of them`, used.length > 20)
}

/* ---------------------------------------------------------------------------------------------
 * ITEM 6 SHOWS ITS WORKING
 * ------------------------------------------------------------------------------------------- */

/*
 * THE CLAUSE ABOVE IT HAS THE DEBTOR CONFIRM THEY HAVE CHECKED THE CAPITAL AMOUNT. A figure they
 * cannot see is one they cannot have checked, and that is the clause an attorney attacks first. So
 * all five lines of the sum are printed, not just the total.
 */
for (const line of ['balance_handover', 'interest_accrued', 'fees_total', 'paid_to_date', 'balance']) {
  ok(`the capital calculation shows ${line}`, texts.individual.includes(`{{${line}}}`))
}
ok('...and the clause that relies on it is there',
  /it has checked the statement of account and agrees the Capital Amount is correct/.test(texts.individual))

/* AND THE VAT IS NAMED AS PART OF THE FEES, never added to them: vat is a COMPONENT of fees --
   BalanceBreakdown says so -- and summing them would overstate what somebody signs for. */
ok('VAT is shown as contained in the fees, not added to them',
  /including VAT of \{\{fees_vat\}\}/.test(texts.individual))

/* ---------------------------------------------------------------------------------------------
 * TWO ANNEXURE Bs IS A DRAFTING ERROR
 * ------------------------------------------------------------------------------------------- */

/*
 * THE SPECIMEN CALLS THE CONSENT TO JUDGMENT "ANNEXURE B", and the same document names Annexure B
 * twice more -- in item 7 and in Part B -- meaning the Debt Collectors Act tariff. One agreement
 * with two different Annexure Bs is a thing to be read out in court. The consent is Annexure A.
 */
ok('the consent to judgment is Annexure A', /ANNEXURE A — CONSENT TO JUDGMENT/.test(texts.individual))
ok('...and Annexure B still means the tariff',
  /Annexure B to the Debt Collectors Act 114 of 1998/.test(texts.individual))
ok('...and nothing calls the consent Annexure B',
  !/Annexure B \(consent/.test(texts.individual) && !/consent to judgment in Annexure B/.test(texts.individual))

/* ---------------------------------------------------------------------------------------------
 * THE PERSON AND THE COMPANY DIFFER WHERE THEY SHOULD
 * ------------------------------------------------------------------------------------------- */

ok('a person is identified by identity number', texts.individual.includes('Identity number: {{debtor_id_masked}}'))
ok('...and a company by registration number', texts.company.includes('Registration number: {{debtor_reg_no}}'))
ok('...and neither carries the other', !texts.individual.includes('debtor_reg_no'))
/*
 * BOTH IDENTIFIERS ARE OPTIONAL FIELDS, which matters here more than anywhere: 97% of the live book
 * has no identity number, and a document that held for want of one could not be sent to almost
 * anybody. The line leaves with the field -- see MergeField.optional and documentWithoutOptional.
 */
const optional = new Set(MERGE_FIELDS.collections.filter((f) => f.optional).map((f) => f.key))
ok('the identity number is an optional field', optional.has('debtor_id_masked'))
ok('...and so is the registration number', optional.has('debtor_reg_no'))
/* AND IT IS ON A LINE OF ITS OWN inside the item-3 cell, so what leaves is the identifier and not
   the debtor's name or address beside it. */
ok('...on its own sentence, so its removal takes nothing with it',
  /\{\{debtor_name\}\}\. Identity number: \{\{debtor_id_masked\}\}\. Domicilium:/.test(texts.individual))

/* A COMPANY SIGNS THROUGH SOMEBODY. A signature block reading "The Debtor — Acme (Pty) Ltd" is a
   company signing its own name, which is not a thing that happens. */
ok('a company signs through a person', /duly authorised/.test(texts.company))

/* ---------------------------------------------------------------------------------------------
 * AND WHAT THE COVERING EMAIL MUST SAY
 * ------------------------------------------------------------------------------------------- */

for (const kind of ['individual', 'company']) {
  const e = covering(kind)
  /* WHAT IT DOES AND WHAT IT DOES NOT DO, both, because the asymmetry is the whole point of
     sending it: signing holds collection, and it does not reduce what is owed. */
  ok(`the ${kind} covering email says what signing holds`,
    /no further collection step is taken/i.test(e))
  ok(`...and what it does not do`, /does not reduce the amount owing/i.test(e))
  /* AND THAT THEY MAY TAKE ADVICE. It annexes a consent to judgment; a covering note that hurried
     somebody past that is the one sentence this email could not survive being asked about. */
  ok(`...and that they may take advice first`, /independent legal advice/i.test(e))
  ok(`...and names the consent they are signing`, /consent to judgment/i.test(e))
  /* AND IT QUOTES THE ARRANGEMENT, so the debtor can check the attachment matches what was agreed
     on the telephone before they sign it. */
  ok(`...and quotes the arrangement`, e.includes('{{ptp_amount}}') && e.includes('{{ptp_date}}'))
}

/* ---------------------------------------------------------------------------------------------
 * AND THE BUILD IS THE SOURCE OF TRUTH
 * ------------------------------------------------------------------------------------------- */

/* letters.json is what the seeding script carries across, so it has to BE what aod.mjs produces --
   a stale letters.json would seed a document nobody has reviewed. */
for (const kind of ['individual', 'company']) {
  check(`letters.json holds the built ${kind} document`,
    JSON.stringify(letters[`letter-aod-${kind}`]), texts[kind])
}

/* ---------------------------------------------------------------------------------------------
 * AND WHAT GETS IT INTO A DATABASE
 *
 * Raptor reads its templates from `message_templates`, so a letter that is perfect in letters.json
 * and absent from the table is a letter nobody can send. The seeding is therefore part of the
 * deliverable rather than an afterthought, and it has already gone wrong once in the way that
 * matters: a chunked insert over a connection that could read and not write left ONE row holding
 * the first 5 604 characters of a nine-page agreement -- a template that merges, draws, attaches
 * and ends mid-sentence.
 *
 * TWO ROUTES EXIST because of that, and seed-aod.sql is GENERATED from the same `rows` the REST
 * path posts. A hand-maintained copy is the drift this whole section is here to refuse: the SQL in
 * the repository must be the SQL the generator writes today, or pasting it loads a document nobody
 * has reviewed.
 * ------------------------------------------------------------------------------------------- */

const sql = read('scripts/letters/seed-aod.sql')

/*
 * THE DOCUMENTS THEMSELVES, VERBATIM. This is the assertion that catches a stale file after
 * somebody edits the firm's wording in aod.mjs -- and the one that would have caught the
 * truncation, because half a document is not a substring match for the whole of one.
 */
for (const kind of ['individual', 'company']) {
  ok(`seed-aod.sql carries the whole ${kind} agreement`, sql.includes(texts[kind]))
  ok(`...and its covering email`, sql.includes(covering(kind)))
}

/*
 * AND THE LETTER ROWS SAY `document`.
 *
 * THE ONE THAT WAS ACTUALLY WRONG. A letter's body is letterDocument JSON and `format` is how
 * everything in the browser knows that: AttachLetter lists only letters whose format says
 * document, the Library parses on it, the editor opens the page editor on it. The first draft of
 * the seeder wrote 'text', copied from the twelve notices already in the database -- which carry
 * 'text' as well, so the Attach control in a compose box lists NOTHING. It survived because the
 * workflow runner parses the body whatever the column says: the automatic path does not read the
 * value and the path a person uses does.
 */
const asDocument = sql.match(
  /\$q\$letter\$q\$, \$q\$Acknowledgement of debt \((?:individual|company)\)\$q\$, null, \$q\$document\$q\$/g,
)
check('both letters are seeded as documents', asDocument?.length ?? 0, 2)
/* AND THE EMAILS AS TEXT, which is the other half of the same column: an email holding letter JSON
   would be drawn into an inbox as its own markup. */
const asText = sql.match(
  /\$q\$email\$q\$, \$q\$Acknowledgement of debt — covering email \((?:individual|company)\)\$q\$, \$q\$[^$]+\$q\$, \$q\$text\$q\$/g,
)
check('...and both covering emails as text', asText?.length ?? 0, 2)
/* AND THE CORRECTION FOR THE TWELVE ALREADY THERE rides with it, narrowed to a letter whose body
   really is a document -- a letter somebody typed as plain words must be left alone. */
ok('...and the notices already seeded as text are corrected',
  /set format = 'document'[\s\S]*?where kind = 'letter' and format = 'text' and body like '\{"defaults":%'/
    .test(sql))

/*
 * AND THE KEYS ARE THE KEYS THE COMPOSE BOX IS WRITTEN AGAINST.
 *
 * BY_HAND_SEED_KEYS decides what a collector may pick by hand, and it names these two. A seeder
 * that wrote a different key would give the firm two templates they can read in the Library and
 * cannot choose -- which is a failure with no error message anywhere.
 */
for (const kind of ['individual', 'company']) {
  ok(`the ${kind} covering email is seeded under the key the picker names`,
    BY_HAND_SEED_KEYS.includes(`email-aod-${kind}`) && sql.includes(`$q$email-aod-${kind}$q$`))
  /* AND THE AGREEMENT IS ATTACHED TO IT, for the same audience on both sides. A covering note
     written to a person that posts the company agreement hands a pensioner a document to be
     signed by a duly authorised representative. */
  ok(`...and posts the ${kind} agreement`,
    sql.includes(`e.seed_key = 'email-aod-${kind}' and l.seed_key = 'letter-aod-${kind}'`))
}

/* OUT BEFORE IN, or a second run duplicates and a half-written row from the first survives. The
   presence of each is asserted before their order, because indexOf returns -1 and an order-only
   assertion passes vacuously the day somebody deletes the delete. */
const del = sql.indexOf('delete from public.message_templates')
const ins = sql.indexOf('insert into public.message_templates')
ok('it deletes before it inserts', del !== -1 && ins !== -1 && del < ins)
/* ONE TRANSACTION, so a paste that fails half way leaves the table as it was rather than holding
   half an agreement -- which is the exact state this script was written after. */
ok('...inside one transaction', /^begin;$/m.test(sql) && /^commit;$/m.test(sql))

console.log(`\ncheck-aod: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
