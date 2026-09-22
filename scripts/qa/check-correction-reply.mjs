/**
 * Reading the client's answer back out of their reply.
 *
 * THE FIRM asked for a column the client fills in. That got them somewhere to write; this is the
 * other half — taking what they wrote and putting it against the right field on the right
 * account, instead of somebody reading a reply and retyping it into forty columns.
 *
 * WHAT MAKES THIS HARD IS NOT THE TABLE, IT IS WHAT A MAIL CLIENT DOES TO IT. What comes back is
 * our own markup after Outlook, Gmail or Apple Mail has re-serialised it: cells wrapped in <div>
 * and <p>, attributes rewritten, `&nbsp;` everywhere, the whole thing nested inside blockquotes
 * and layout tables, and the original quoted underneath the answered copy. So the fixtures below
 * are not our markup — they are our markup after somebody's mail client has had it, and each one
 * is a shape that has actually been seen in mail.
 *
 * AND NOTHING IS APPLIED. This reads, matches and checks; the firm's standing instruction is that
 * corrections are "made case by case, never a migration that sweeps".
 */
import { readFileSync } from 'node:fs'
import {
  keyForLabel, parseCorrectionReply, problemWithAnswer,
} from '../../src/lib/correctionReply.ts'
import { ANSWER_COLUMN, correctionEmail } from '../../src/lib/importCorrections.ts'
import { HANDOVER_COLUMNS } from '../../src/lib/handoverSheet.ts'

let pass = 0
const failures = []
/*
 * READ DEFENSIVELY. Written as `at(fromGmail, 0).key`, the first failing fixture threw a TypeError
 * two lines below the check that should have reported it -- so nothing was reported at all and
 * the run died. CLAUDE.md names this exact trap and this file walked straight into it.
 */
const at = (rows, i) => (Array.isArray(rows) && rows[i]) || {}
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass += 1; return }
  failures.push(`${label}\n    expected ${e}\n    got      ${a}`)
}
const ok = (label, actual) => check(label, actual, true)

/** Our own table, as it goes out — the shape everything below is a mangling of. */
const ours = (rows) => `
<table><thead><tr>
  <th>Your reference</th><th>Debtor</th><th>Field</th>
  <th>What your sheet says</th><th>What we need</th><th>${ANSWER_COLUMN}</th>
</tr></thead><tbody>${rows}</tbody></table>`

const row = (ref, debtor, field, given, need, answer) =>
  `<tr><td>${ref}</td><td>${debtor}</td><td>${field}</td><td>${given}</td><td>${need}</td>`
  + `<td>${answer}</td></tr>`

/* ---------- the plain case ---------- */

const one = parseCorrectionReply(ours(row(
  'BF-204', 'Molefe', 'Email address', '(nothing)', 'No email address.',
  'kagiso.molefe@example.co.za')))
check('one answer comes back', one.length, 1)
check('...against the client’s own reference', at(one, 0).reference, 'BF-204')
check('...for the right field', at(one, 0).key, 'email_1')
check('...with what they typed', at(one, 0).answer, 'kagiso.molefe@example.co.za')
check('...and what it replaces', at(one, 0).given, '(nothing)')
check('...and nothing wrong with it', at(one, 0).problem, null)

/*
 * AN EMPTY BOX IS NOT AN ANSWER, and ours goes out holding a non-breaking space -- put there so
 * Outlook does not collapse the box to a sliver. Read naively, every unanswered row would come
 * back as an answer of " " and overwrite a good value with a space.
 */
check('an untouched box is not an answer',
  parseCorrectionReply(ours(row('BF-1', 'X', 'Email address', '(nothing)', 'y', '&nbsp;'))).length, 0)
check('...nor a genuinely empty one',
  parseCorrectionReply(ours(row('BF-1', 'X', 'Email address', '(nothing)', 'y', ''))).length, 0)
check('...nor one a client left spaces in',
  parseCorrectionReply(ours(row('BF-1', 'X', 'Email address', '(nothing)', 'y', '&nbsp; &nbsp;'))).length, 0)

/* ---------- what a mail client does to it ---------- */

/*
 * OUTLOOK wraps the quoted message in a layout table of its own and puts every cell's text inside
 * a <p class=MsoNormal>. Read by position, the outer table's single cell is column one and every
 * answer is lost; read by heading, the inner table is found wherever it is.
 */
const outlook = `
<div><table class="MsoNormalTable"><tr><td>
  <p class=MsoNormal>From: Bredell Ferreira</p>
  ${ours(row(
    '<p class=MsoNormal><span style="font-size:10.0pt">BF-204</span></p>',
    '<p class=MsoNormal>Molefe</p>',
    '<p class=MsoNormal>Email&nbsp;address</p>',
    '<p class=MsoNormal>(nothing)</p>',
    '<p class=MsoNormal>No email address.</p>',
    '<p class=MsoNormal><span lang=EN-ZA>kagiso.molefe@example.co.za</span></p>'))}
</td></tr></table></div>`
const fromOutlook = parseCorrectionReply(outlook)
check('a table nested in Outlook’s layout table is still found', fromOutlook.length, 1)
check('...with the answer out of its <p> and <span>',
  at(fromOutlook, 0).answer, 'kagiso.molefe@example.co.za')
/* The heading arrived with a non-breaking space in it, which must not stop the field matching. */
check('...and the heading matched through an &nbsp;', at(fromOutlook, 0).key, 'email_1')

/*
 * GMAIL quotes inside a blockquote and drops closing tags on <tr> and <td>. Both are legal HTML
 * and both are what a naive parser runs together into one enormous cell.
 */
const gmail = `
<div dir="ltr">Here you go.</div>
<blockquote class="gmail_quote"><div><table><tr>
  <th>Your reference<th>Debtor<th>Field<th>What your sheet says<th>What we need<th>${ANSWER_COLUMN}
<tr><td>BF-301<td>Bezuidenhout<td>Surname, or the business name<td>(nothing)
  <td>No surname.<td>Bezuidenhout
</table></div></blockquote>`
const fromGmail = parseCorrectionReply(gmail)
check('a reply with no closing tags still reads', fromGmail.length, 1)
check('...to the right field', at(fromGmail, 0).key, 'name')
check('...with the answer whole', at(fromGmail, 0).answer, 'Bezuidenhout')

/*
 * A CELL BROKEN ACROSS <div>s. Apple Mail does this to anything somebody typed a newline into,
 * and without a space between them "14 Protea" and "Street" become "14 ProteaStreet".
 */
const split = parseCorrectionReply(ours(row(
  'BF-9', 'Louw', 'Street address 1', '(nothing)', 'No address.',
  '<div>14 Protea</div><div>Street</div>')))
check('a cell split across lines keeps its words apart', at(split, 0).answer, '14 Protea Street')

/* A style attribute holding a '>' must not end the tag early -- re-serialised mail is full of
   them, and the oldest parser bug there is is `/<[^>]+>/`. */
const tricky = parseCorrectionReply(ours(
  `<tr><td style="font:>10pt">BF-7</td><td>X</td><td>Email address</td><td>(nothing)</td>`
  + `<td>y</td><td>a@b.co.za</td></tr>`))
check('a > inside an attribute does not break the row', tricky.length, 1)
check('...and the reference is still read', at(tricky, 0).reference, 'BF-7')

/* ---------- the quoted original underneath ---------- */

/*
 * THE FIRST OCCURRENCE WINS. A reply carries the answered copy and, underneath, the original
 * quoted -- and in every client the firm uses the newest is at the top. Answered twice for one
 * field, the top one is what they meant.
 */
const twice = parseCorrectionReply(
  ours(row('BF-204', 'Molefe', 'Email address', '(nothing)', 'y', 'new@example.co.za'))
  + ours(row('BF-204', 'Molefe', 'Email address', '(nothing)', 'y', 'old@example.co.za')))
check('a field answered twice is one answer', twice.length, 1)
check('...the newest, which is the one at the top', at(twice, 0).answer, 'new@example.co.za')
/* Two fields on one account are two answers, not a collision. */
const twoFields = parseCorrectionReply(ours(
  row('BF-204', 'Molefe', 'Email address', '(nothing)', 'y', 'a@b.co.za')
  + row('BF-204', 'Molefe', 'Cell number 1', '(nothing)', 'y', '0821234567')))
check('two fields on one account are two answers', twoFields.length, 2)
/* And the same field on two accounts likewise. */
const twoAccounts = parseCorrectionReply(ours(
  row('BF-1', 'A', 'Email address', '(nothing)', 'y', 'a@b.co.za')
  + row('BF-2', 'B', 'Email address', '(nothing)', 'y', 'c@d.co.za')))
check('the same field on two accounts is two answers', twoAccounts.length, 2)

/* ---------- tables that are not ours ---------- */

/*
 * FOUND BY ITS HEADINGS, NEVER BY POSITION. A reply carries other tables -- a signature block is
 * one, and so is Outlook's layout table -- and reading "the last cell of every row" out of a
 * signature would file somebody's phone number as an answer.
 */
const signature = `
<table><tr><td>Camille Bredell</td><td>Finance</td><td>012 348 2156</td></tr></table>
${ours(row('BF-5', 'Zwane', 'Date of default', '(nothing)', 'y', '18/03/2026'))}`
const past = parseCorrectionReply(signature)
check('a signature table is not read as answers', past.length, 1)
check('...only ours is', at(past, 0).key, 'default_date')
/*
 * AN OLDER EMAIL'S TABLE HAS NO BOX TO FILL IN. Before the firm asked for one, this table went
 * out with five columns ending in "What we need" -- and a client replying to one of those, or
 * quoting it under a newer reply, must not have our own sentence read back as their answer.
 * The answer column has to be PRESENT for a table to be one of these at all.
 */
const oldTable = parseCorrectionReply(`
<table><tr>
  <th>Your reference</th><th>Debtor</th><th>Field</th>
  <th>What your sheet says</th><th>What we need</th>
</tr><tr>
  <td>BF-204</td><td>Molefe</td><td>Email address</td><td>(nothing)</td><td>No email address.</td>
</tr></table>`)
check('a table with no box to fill in yields nothing', oldTable, [])

check('no table at all gives nothing', parseCorrectionReply('<p>Yes that is fine, thanks.</p>'), [])
check('...and neither does an empty string', parseCorrectionReply(''), [])

/*
 * A COLUMN THE CLIENT DRAGGED. The headings are read for their positions rather than assumed, so
 * a table whose columns were re-ordered still reads -- and a client who drags one is not
 * somebody whose answers should silently go to the wrong field.
 */
const reordered = parseCorrectionReply(`
<table><tr>
  <th>${ANSWER_COLUMN}</th><th>Field</th><th>Your reference</th>
  <th>What your sheet says</th><th>Debtor</th><th>What we need</th>
</tr><tr>
  <td>0821234567</td><td>Cell number 1</td><td>BF-8</td><td>(nothing)</td><td>Ndlovu</td><td>y</td>
</tr></table>`)
check('a re-ordered table still reads', reordered.length, 1)
check('...the right reference', at(reordered, 0).reference, 'BF-8')
check('...and the right field', at(reordered, 0).key, 'cell_1')
/* AND THE ANSWER ITSELF. Without this the three above passed with the answer read off the LAST
   column by position -- which here is "What we need", so our own sentence came back as the
   client's answer and every assertion still held. */
check('...and the answer, not whatever is in the last column',
  at(reordered, 0).answer, '0821234567')

/* ---------- which column an answer is for ---------- */

check('a heading maps to its key', keyForLabel('Handover amount'), 'capital')
check('...ignoring case and spacing', keyForLabel('  handover   AMOUNT '), 'capital')
/* The labels the sheet used to carry, because a client may be answering a table sent a year ago. */
check('...and an old name for the same column', keyForLabel('Capital on Default'), 'capital')
check('a heading nobody knows maps to nothing', keyForLabel('Favourite colour'), null)
/* Reported rather than dropped: an answer against a column we cannot place is still an answer
   somebody has to deal with, and silently losing it is the failure that looks like success. */
const unknown = parseCorrectionReply(ours(row('BF-1', 'X', 'Favourite colour', '', 'y', 'blue')))
check('an answer for an unknown column is still reported', unknown.length, 1)
check('...with no key', at(unknown, 0).key, null)
check('...but the heading kept, so it can be shown', at(unknown, 0).fieldLabel, 'Favourite colour')

/* ---------- the answer is checked, not trusted ---------- */

/*
 * THE COMMONEST REPLY TO "this is not an ID number" IS ANOTHER THING THAT IS NOT AN ID NUMBER.
 * Caught here it is a sentence on a screen; caught later it is a statutory demand addressed to a
 * stranger. The same rules the import used, so the two cannot disagree.
 */
check('a bad ID number is refused again', !!problemWithAnswer('id_number', '0823456789'), true)
check('...naming the length', /thirteen digits/i.test(problemWithAnswer('id_number', '0823456789')), true)
check('a thirteen-digit non-ID says so differently',
  /transposed/.test(problemWithAnswer('id_number', '8503125009098')), true)
check('a real ID passes', problemWithAnswer('id_number', '8503125009089'), null)
check('a bad email is refused', !!problemWithAnswer('email_1', 'kagiso.molefe.example.co.za'), true)
check('a good email passes', problemWithAnswer('email_1', 'a@b.co.za'), null)
check('a date that is not a date is refused', !!problemWithAnswer('default_date', 'when they could'), true)
check('a day-first date passes', problemWithAnswer('default_date', '18/03/2026'), null)
/* 31 February is a typo in the cell, not a misread of the order. */
check('a day that does not exist is refused', !!problemWithAnswer('default_date', '31/02/2026'), true)
check('an amount that is not a number is refused', !!problemWithAnswer('capital', 'to be advised'), true)
check('nought is refused', !!problemWithAnswer('capital', '0'), true)
check('an amount passes', problemWithAnswer('capital', '4200'), null)
/* The one Excel causes rather than a person -- and a client retyping into a spreadsheet can do
   it again in their answer. */
check('a number missing its leading zero is named as that',
  /leading zero/.test(problemWithAnswer('cell_1', '821234567')), true)
check('a dialable number passes', problemWithAnswer('cell_1', '082 123 4567'), null)
check('...as does +27', problemWithAnswer('cell_1', '+27821234567'), null)
/* A column with no rule of its own must not invent one. */
check('a free-text column accepts what it is given',
  problemWithAnswer('employer', 'Shoprite Checkers'), null)
/* And the problem rides on the parsed answer, not only on the helper. */
const wrong = parseCorrectionReply(ours(row(
  'BF-201', 'Maree', 'ID number', '0823456789', 'Not an ID number.', '0823456789')))
check('a reply that repeats the mistake is flagged on the row', !!at(wrong, 0).problem, true)

/* ---------- it reads OUR email, not a mock of it ---------- */

/*
 * THE FIXTURES ABOVE ARE HAND-WRITTEN, which is how a parser ends up matching a table nobody
 * sends. So the real email is generated and parsed: if the column is renamed, re-ordered or
 * dropped on that side, this fails here rather than on a client's reply.
 */
const real = correctionEmail({
  clientName: 'Bredell Ferreira', contactName: 'Camille', filename: 'f.xlsx', today: '2026-09-22',
  broughtIn: 1,
  toConfirm: [{
    reference: 'BF-201', name: 'Maree', note: null,
    values: { id_number: '0823456789' },
    problems: [{ key: 'id_number', level: 'warn', message: 'Not an ID number.' }],
  }],
  notBroughtIn: [],
  labelFor: (k) => HANDOVER_COLUMNS.find((c) => c.key === k)?.label ?? k,
})
/* Unanswered, our own email yields nothing -- the boxes are empty. Presence before absence: the
   line under it proves the table IS found, so this is not passing because nothing matched. */
check('our own email, unanswered, has no answers in it',
  parseCorrectionReply(real.bodyHtml).length, 0)
/* Now answer it the way a client would: type into the empty cell. */
const answered = real.bodyHtml.replace(
  /(<td style="padding:6px 10px;border:1px solid #9aa6b8[^>]*>)&nbsp;(<\/td>)/,
  '$18503125009089$2')
const fromReal = parseCorrectionReply(answered)
check('a filled-in box in the real email is read', fromReal.length, 1)
check('...against the right field', at(fromReal, 0).key, 'id_number')
check('...and the answer is checked', at(fromReal, 0).problem, null)

/* ---------- what may be written, and what may not ---------- */

/*
 * A HANDOVER AMOUNT AND A DATE OF DEFAULT ARE NOT DETAILS ABOUT A DEBTOR, they are the ledger's
 * opening figures. in duplum is measured from the capital, prescription runs from the date, both
 * are stamped at handover and never recalculated, and remittances have been passed against them.
 * Writing one from a screen that read an email would rewrite an account's whole arithmetic on a
 * client's say-so -- which is the firm's own rule: corrections are "made case by case".
 */
const apply = readFileSync('src/lib/applyReply.ts', 'utf8')
for (const key of ['capital', 'default_date', 'last_payment_date']) {
  ok(`${key} cannot be written from a reply`, new RegExp(`${key}:`).test(apply.slice(
    apply.indexOf('LEDGER_FIELDS'), apply.indexOf('const IDENTITY'))))
}
/* The refusal SAYS WHY. "Not allowed" sends somebody looking for a permission; naming in duplum
   tells them it is the ledger and that the change is a deliberate act elsewhere. */
ok('...and the refusal names what it would break', /in duplum is measured/.test(apply))
/*
 * PRESENCE BEFORE ORDER. Written as `indexOf(guard) < indexOf(write)` alone, this passed with the
 * guard DELETED -- indexOf returns -1 and -1 is less than everything. CLAUDE.md names this exact
 * trap and this file walked into it; the guard has to be there before its position means
 * anything.
 */
ok('the ledger guard exists at all', apply.includes('LEDGER_FIELDS[input.key]'))
ok('...and refuses rather than falling through', /if \(ledger\) return \{ done: false/.test(apply))
ok('...and is checked before anything is written',
  apply.includes('saveDebtorIdentity(input.accountId')
  && apply.indexOf('LEDGER_FIELDS[input.key]') < apply.indexOf('saveDebtorIdentity(input.accountId'))
/* The details that ARE a debtor's own go on. */
for (const key of ['id_number', 'name', 'first_name', 'title', 'initials', 'second_name']) {
  ok(`${key} is written as an identity field`, new RegExp(`${key}:`).test(apply.slice(
    apply.indexOf('const IDENTITY'), apply.indexOf('const CONTACTS'))))
}
for (const key of ['cell_1', 'cell_2', 'email_1', 'work_phone', 'employer']) {
  ok(`${key} is written as a contact`, new RegExp(`${key}:`).test(apply.slice(
    apply.indexOf('const CONTACTS'), apply.indexOf('export type ApplyOutcome'))))
}
/*
 * A RETIRED NUMBER STAYS RETIRED. It was retired for a reason, and quietly reviving it because
 * the client corrected a different one would put a dead number back on a collector's desk.
 */
/* NAMED ON THE LOOKUP ITSELF. `/!c\.retiredAt/` alone matched a second, unrelated use further
   down, so deleting it from the line that finds the row to replace changed nothing. */
ok('a retired contact is never the one replaced',
  /const existing = input\.contacts\.find\(\(c\) => !c\.retiredAt/.test(apply))
/* And a column with nowhere to live is SAID rather than swallowed -- most of the sheet's forty
   still have nowhere on an account to go. */
ok('an answer with nowhere to go says so', /nowhere on the account to put this/.test(apply))
/* The two halves stay apart: the parser writes nothing and the writer reads nothing. */
ok('the writer does not parse', !/parseCorrectionReply/.test(apply))

/* ---------- and it is wired to the ticket ---------- */

const panel = readFileSync('src/components/queries/ReplyAnswers.tsx', 'utf8')
ok('the reply is read off the clipboard as markup', /getData\('text\/html'\)/.test(panel))
/* A table pasted as plain text loses which cell was which, and the whole answer is in the last
   column -- so the rich flavour is the one carrying the information. */
ok('...rather than as plain text', !/getData\('text\/plain'\)/.test(panel))
/* ONE AT A TIME. An "apply all" over a client's typing is exactly the sweep the firm forbade. */
ok('each answer is written on its own', /apply\(i, a\)/.test(panel))
ok('...and nothing is written on arrival', !/useEffect/.test(panel))
/* A row that opened no account has nowhere to write to, and says so rather than failing. */
ok('an answer for an account that was never opened says so',
  /No account was opened for this one/.test(panel))
const detail = readFileSync('src/pages/queries/QueryDetail.tsx', 'utf8')
ok('the ticket carries the panel', /<ReplyAnswers/.test(detail))
/* Matched on the client's OWN reference, which is what the table carries and what the client
   quotes -- our reference is ours and never appears in the column they filled in. */
ok('...matching the client\u2019s reference to the account it opened',
  /clientReference/.test(detail))
/* A closed query stops offering it: the answers are already on, and a paste box on a finished
   query invites somebody to write a month-old correction over a newer one. */
ok('...only while the query is open', /q\.status !== 'closed' && data\.batch/.test(detail))

/* The parser reads the heading the email writes. One constant, not two spellings. */
const parser = readFileSync('src/lib/correctionReply.ts', 'utf8')
ok('the heading is taken from the email rather than retyped',
  /ANSWER_COLUMN/.test(parser) && !/'Fill this in'/.test(parser))
/* Nothing here writes. The firm: corrections are "made case by case, never a migration". */
ok('nothing in the parser writes anything',
  !/supabase/.test(parser) && !/\.update\(|\.insert\(/.test(parser))

if (failures.length > 0) {
  console.log(`${pass} passed, ${failures.length} failed\n`)
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
What a client types into the last column comes back as an answer against a named field on a named
account, out of markup Outlook, Gmail and Apple Mail have each had their way with -- found by its
headings rather than by position, deduplicated against the quoted original underneath, and checked
against the same rules the import used so a repeat of the same mistake is caught before it is
written. Nothing is applied: a person accepts it.`)
