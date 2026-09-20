/**
 * The words the firm sends a debtor.
 *
 * A TEMPLATE IS THE ONE THING IN RAPTOR THAT GETS WORSE WITH SCALE. A collector who writes a
 * clumsy sentence to one debtor has written a clumsy sentence. The same sentence in a template is
 * the firm's position, in writing, to everybody in the campaign at once — and the sentence goes
 * out on a Thursday morning while the person who could have spotted it is in a meeting.
 *
 * Five ways this goes wrong quietly, all of them found by writing it wrong first:
 *
 *   - a mistyped field renders as nothing, and four hundred debtors are told "the amount of  is
 *     now due". The typo has to be caught when the template is SAVED, not when it is sent.
 *   - a blank value renders as a blank, so "Dear ," goes out looking finished. A gap must be
 *     visibly unfinished or it gets sent.
 *   - a template that fits one segment against a short name spills to two against a long one, and
 *     Annexure B item 1(c) is charged PER SEGMENT — the same words cost the second debtor double.
 *   - a company addressed as "Mr", because a company's registered name lives in the surname
 *     field and there is nowhere else for it to go.
 *   - a script chosen by fallback with nobody told, which is indistinguishable from a bug.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-message-templates.mjs
 */
import { readFileSync } from 'node:fs'
import {
  MERGE_FIELDS, SMS_RAND_PER_SEGMENT, addressAs, fieldsUsed, forecastSms, longDate,
  mergeValuesFor, renderTemplate, resolveNote, resolveTemplate, sampleValues, templateProblems,
  unknownFields,
} from '../../src/lib/messageTemplates.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)

/* ---------- the fields are a closed list ---------- */

/*
 * TWO LISTS, ONE PER SIDE, because the sides do not share a vocabulary. {{balance}} means nothing
 * on a lead and {{service_interested}} means nothing on a debtor account — and the firm's own
 * reason for there being exactly two: "a client can make a deal or a lead can make a deal", so a
 * deal is a stage of one relationship rather than a library of its own.
 */
check('there is a library for each side', Object.keys(MERGE_FIELDS).sort(), ['collections', 'sales'])
for (const scope of ['collections', 'sales']) {
  const fields = MERGE_FIELDS[scope]
  ok(`${scope} has fields to use`, fields.length >= 8)
  check(`${scope} names every field once`, fields.length, new Set(fields.map((f) => f.key)).size)
  ok(`${scope} gives every field a sample to preview with`,
    fields.every((f) => f.sample.trim() !== '' && f.label.trim() !== ''))
}
/*
 * AND THE TWO ARE GENUINELY DIFFERENT. Identical lists would mean the split is decoration — the
 * whole point is that a writer on one side is not offered fields that render as nothing there.
 */
ok('the two sides do not offer the same fields',
  MERGE_FIELDS.collections.map((f) => f.key).join() !== MERGE_FIELDS.sales.map((f) => f.key).join())
ok('...a debtor balance is not on offer to a lead',
  !MERGE_FIELDS.sales.some((f) => f.key === 'balance'))
ok('...nor a lead\u2019s service to a debtor',
  !MERGE_FIELDS.collections.some((f) => f.key === 'service_interested'))
/* The three that mean the same thing everywhere must be on both, or one side cannot sign off. */
for (const key of ['agent_name', 'agent_phone', 'firm_name', 'today']) {
  ok(`both sides can say ${key}`,
    MERGE_FIELDS.collections.some((f) => f.key === key)
      && MERGE_FIELDS.sales.some((f) => f.key === key))
}
/*
 * THE SAMPLES ARE AWKWARD ON PURPOSE. A template previewed against "Mr Dube" and "R1 000" looks
 * fine and then costs three segments on a real account. The long surname is the point of it.
 */
ok('the name sample is a long one', sampleValues().debtor_name.length >= 18)

/* ---------- a typo is caught when it is saved ---------- */

check('the fields a template uses are found in order',
  fieldsUsed('Dear {{debtor_name}}, account {{reference}} with {{client_name}}'),
  ['debtor_name', 'reference', 'client_name'])
check('...and each is reported once however often it appears',
  fieldsUsed('{{debtor_name}} {{debtor_name}}'), ['debtor_name'])
check('...across the subject and the body together',
  fieldsUsed('Account {{reference}}', 'Dear {{debtor_name}}'), ['reference', 'debtor_name'])
check('spaces inside the braces are still a field', fieldsUsed('{{ balance }}'), ['balance'])
check('a misspelling is not a field',
  unknownFields('collections', 'the amount of {{ballance}}'), ['ballance'])
check('...while the real ones are left alone',
  unknownFields('collections', '{{balance}} on {{reference}}'), [])
/*
 * AND A FIELD BORROWED FROM THE OTHER SIDE IS UNKNOWN TOO. This is the case a single flat list
 * could not see: {{balance}} is a real field, and on a sales template it is a message that goes
 * to a prospect reading "the amount of  is now due".
 */
check('a collections field on a sales template is not a field',
  unknownFields('sales', 'the amount of {{balance}}'), ['balance'])
check('...and the reverse', unknownFields('collections', '{{service_interested}}'), ['service_interested'])

const base = { scope: 'collections', kind: 'sms', name: 'First demand', subject: null, body: 'Hello' }
check('a sound template has nothing wrong with it', templateProblems(base), [])
check('an unnamed one cannot be saved',
  templateProblems({ ...base, name: '  ' }).map((p) => p.field), ['name'])
check('nor an empty one', templateProblems({ ...base, body: ' ' }).map((p) => p.field), ['body'])
/* The typo, caught here rather than on Thursday morning. */
check('nor one with a field that does not exist',
  templateProblems({ ...base, body: 'You owe {{ballance}}' }).map((p) => p.field), ['body'])
ok('...and it says which word is wrong',
  /ballance/.test(templateProblems({ ...base, body: 'You owe {{ballance}}' })[0].message))
/* A subject belongs to email and to nothing else. */
check('an email needs a subject',
  templateProblems({ ...base, kind: 'email', subject: '' }).map((p) => p.field), ['subject'])
check('an SMS must not carry one',
  templateProblems({ ...base, subject: 'Overdue' }).map((p) => p.field), ['subject'])
check('nor a call script',
  templateProblems({ ...base, kind: 'call_script', subject: 'Overdue' }).map((p) => p.field), ['subject'])
/* A typo in an email's SUBJECT is just as sendable as one in its body. */
check('a field that does not exist in the subject is caught too',
  templateProblems({
    scope: 'collections', kind: 'email', name: 'x', subject: 'Account {{referance}}', body: 'Hello',
  })
    .map((p) => p.field), ['subject'])

/* ---------- a gap must look like a gap ---------- */

check('a known value is substituted',
  renderTemplate('Dear {{debtor_name}}', { debtor_name: 'Mr Dube' }).text, 'Dear Mr Dube')
/*
 * THE PLACEHOLDER IS LEFT STANDING where there is no value. Blanking it produces "Dear ," which
 * reads as finished prose and gets sent; "Dear {{debtor_name}}," is unmistakably unfinished.
 */
check('a missing value leaves the placeholder visible',
  renderTemplate('Dear {{debtor_name}},', {}).text, 'Dear {{debtor_name}},')
check('...and is reported', renderTemplate('Dear {{debtor_name}},', {}).missing, ['debtor_name'])
check('null is missing', renderTemplate('{{balance}}', { balance: null }).missing, ['balance'])
check('so is whitespace', renderTemplate('{{balance}}', { balance: '   ' }).missing, ['balance'])
check('a zero balance is NOT missing', renderTemplate('{{balance}}', { balance: 'R 0.00' }).text, 'R 0.00')
check('nothing missing on a full render',
  renderTemplate('{{balance}}', { balance: 'R 1.00' }).missing, [])
/*
 * THE PATTERN IS BUILT FRESH RATHER THAN SHARED, and this is asserted on the SOURCE rather than
 * on behaviour on purpose — which is the opposite of the usual rule here, so it needs the reason.
 *
 * A /g RegExp carries `lastIndex` between calls, but neither caller trips over it today:
 * `String.replace` resets it and `matchAll` works on a copy. A behavioural check therefore passes
 * whether the pattern is shared or not — it was written that way first, calling renderTemplate
 * twice and asserting the second, and sharing the pattern did not break it. The guard is for the
 * day somebody swaps `matchAll` for an `.exec()` loop, at which point a shared pattern starts the
 * second template halfway through its own string.
 */
ok('the field pattern is built fresh, not shared',
  /const fieldPattern = \(\) => \//.test(
    readFileSync(new URL('../../src/lib/messageTemplates.ts', import.meta.url), 'utf8')))

/* ---------- a company is not a Mr ---------- */

const person = {
  debtorKind: 'individual', debtorTitle: 'Mr', debtorFirstName: 'Johannes',
  debtorSurname: 'Buitendag', accountNumber: 'ACF10085', clientReference: 'GPS3/10103',
  capitalOutstanding: 31900, preferredLanguage: null,
}
check('a person is addressed by title and surname', addressAs(person), 'Mr Buitendag')
check('...by surname alone where no title is held',
  addressAs({ ...person, debtorTitle: null }), 'Buitendag')
check('...and by first name where there is no surname',
  addressAs({ ...person, debtorSurname: '', debtorTitle: 'Mr' }), 'Johannes')
/*
 * A COMPANY'S REGISTERED NAME LIVES IN THE SURNAME FIELD — there is nowhere else for it to go —
 * so the title must not be reached for. "Dear Mr Moloto Trading CC" on the firm's letterhead is
 * an obvious mistake on every copy of a four-hundred-account campaign.
 */
check('a company is addressed by its name',
  addressAs({ ...person, debtorKind: 'company', debtorTitle: 'Mr', debtorFirstName: '', debtorSurname: 'Moloto Trading CC' }),
  'Moloto Trading CC')
check('a debtor with no name at all answers nothing rather than a guess',
  addressAs({ ...person, debtorFirstName: '', debtorSurname: '' }), null)

const money = (n) => `R ${n.toFixed(2)}`
const values = mergeValuesFor({
  account: person, balance: 48250, clientName: 'Gauteng Property Services',
  agentName: 'Stephan Bredell', agentPhone: '012 111 2222', firmName: 'Bredell Ferreira',
  today: '2026-09-18', money,
})
check('the debtor is addressed as they should be', values.debtor_name, 'Mr Buitendag')
/* The client's own reference is what is on the debtor's paperwork; ours is only the fallback. */
check('the reference is the client’s own', values.reference, 'GPS3/10103')
check('...falling back to ours where the client has none',
  mergeValuesFor({
    account: { ...person, clientReference: null }, balance: 1, clientName: 'x', agentName: 'y',
    agentPhone: 'z', firmName: 'f', today: '2026-09-18', money,
  }).reference, 'ACF10085')
check('the balance is formatted by the app’s own formatter', values.balance, 'R 48250.00')
check('a balance that is not known answers nothing rather than nought',
  mergeValuesFor({
    account: person, balance: null, clientName: 'x', agentName: 'y', agentPhone: 'z',
    firmName: 'f', today: '2026-09-18', money,
  }).balance, null)
check('the date is written out, never ISO', values.today, '18 September 2026')
check('longDate leaves a date it cannot read alone', longDate('not a date'), 'not a date')
/* Every field in the catalogue must be answerable, or a template can use one nothing ever fills. */
check('every collections field can be answered',
  MERGE_FIELDS.collections.filter((f) => !(f.key in values)).map((f) => f.key), [])

/* ---------- what an SMS costs ---------- */

/*
 * ANNEXURE B ITEM 1(c) IS PER SEGMENT. A template that fits 160 characters against a short name
 * and spills to 161 against a long one costs the second debtor double for the same words, and the
 * only place that is visible is here, before it is charged.
 */
const short = forecastSms('Good day {{debtor_first_name}}, please call us on {{agent_phone}}.')
check('a short message is one segment', short.segments, 1)
check('...priced at the tariff', short.cost, SMS_RAND_PER_SEGMENT)
const long = forecastSms(`Good day {{debtor_name}}, your account {{reference}} with {{client_name}} `
  + `is in arrears in the amount of {{balance}}. Please contact {{agent_name}} on {{agent_phone}} `
  + `to arrange payment.`)
ok(`a long one costs more than one (${long.segments})`, long.segments > 1)
check('...and is priced per segment', long.cost, long.segments * SMS_RAND_PER_SEGMENT)
/*
 * ONE CURLY APOSTROPHE DOUBLES THE BILL. It is not in the GSM alphabet, so the whole message goes
 * to UCS-2 where a segment holds 70 characters instead of 160 — and it arrives by pasting from
 * Word, which is how every one of these templates will be written.
 */
const straight = forecastSms("Please contact us about your client's account today, it is now overdue.")
const curly = forecastSms('Please contact us about your client’s account today, it is now overdue.')
check('a straight apostrophe stays in one segment', straight.segments, 1)
ok(`a curly one does not (${curly.segments})`, curly.segments > straight.segments)
ok('...and the template can be told which character did it', curly.offending.includes('’'))

/* ---------- which script this account gets ---------- */

const t = (id, position, language = 'en', active = true) => ({
  id, kind: 'call_script', name: id, subject: null, body: `script ${id}`, position, language, active,
})
const library = [t('broken', 'broken_arrangement'), t('broken-af', 'broken_arrangement', 'af'),
  t('general', null), t('general-af', null, 'af'), t('new', 'new'), t('off', 'tracing', 'en', false)]

check('a fixed campaign reads the script it was given',
  resolveTemplate({ templates: library, mode: { kind: 'fixed', templateId: 'new' }, position: 'broken_arrangement', language: 'en' }).template.id,
  'new')
check('...and says so plainly where that script has been switched off',
  resolveTemplate({ templates: library, mode: { kind: 'fixed', templateId: 'off' }, position: null, language: 'en' }).reason,
  'none')
check('following the account finds the script for its position',
  resolveTemplate({ templates: library, mode: { kind: 'by_position' }, position: 'broken_arrangement', language: 'en' }).template.id,
  'broken')
check('...in the debtor’s language where there is one',
  resolveTemplate({ templates: library, mode: { kind: 'by_position' }, position: 'broken_arrangement', language: 'af' }).template.id,
  'broken-af')
/*
 * FALLS BACK RATHER THAN SKIPS. "Every position must have a script or the account is passed over"
 * sounds safer and is not: it means a power hour silently skips the accounts nobody has written a
 * script for, which are exactly the unusual ones somebody should be ringing.
 */
check('a position with no script of its own gets the general one',
  resolveTemplate({ templates: library, mode: { kind: 'by_position' }, position: 'legal', language: 'en' }).template.id,
  'general')
check('...and that is reported, not hidden', resolveNote(
  resolveTemplate({ templates: library, mode: { kind: 'by_position' }, position: 'legal', language: 'en' }), 'legal'),
  'There is no script for this position yet, so this is the general one.')
check('a language with no version falls back to English at the same position',
  resolveTemplate({ templates: library, mode: { kind: 'by_position' }, position: 'new', language: 'zu' }).template.id,
  'new')
check('...and the collector is told why they are reading English', resolveNote(
  resolveTemplate({ templates: library, mode: { kind: 'by_position' }, position: 'new', language: 'zu' }), 'new'),
  'This debtor asked for another language. There is no version in it yet, so this is the English one.')
check('a switched-off script is never handed out',
  resolveTemplate({ templates: library, mode: { kind: 'by_position' }, position: 'tracing', language: 'en' }).template.id,
  'general')
check('an empty library refuses rather than pretends',
  resolveTemplate({ templates: [], mode: { kind: 'by_position' }, position: 'new', language: 'en' }).template, null)
check('...and says there is nothing to read', resolveNote(
  resolveTemplate({ templates: [], mode: { kind: 'by_position' }, position: 'new', language: 'en' }), 'new'),
  'There is no script for this account yet.')
/* And silence where the right script was found: a warning that fires when nothing is wrong is a
   warning people stop reading, and then the one that matters goes unread too. */
check('nothing is said when the right script was found', resolveNote(
  resolveTemplate({ templates: library, mode: { kind: 'by_position' }, position: 'broken_arrangement', language: 'en' }), 'broken_arrangement'),
  null)
check('...nor on a fixed campaign', resolveNote(
  resolveTemplate({ templates: library, mode: { kind: 'fixed', templateId: 'new' }, position: null, language: 'en' }), null),
  null)

/* ---------- the drafts the library ships with ---------- */

/*
 * THE WORDS, NOT THE MECHANISM. Everything above this line tests the machinery; this tests what
 * the firm actually sends, read back out of schema.sql — which is the checked-in record of what
 * is in the database, and the thing a reviewer who does not read TypeScript can open.
 *
 * Content is worth a check for the same reason it is worth a library: a sentence here goes to
 * four hundred people at once. Three of these rules are the law rather than taste.
 */
const schema = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8')
const seedBlock = schema.slice(schema.indexOf('create table if not exists public.message_templates'))
const seeded = []
const seedRow = /\('([a-z0-9-]+)', '(sms|email|call_script)', '((?:[^']|'')*)', (null|'(?:[^']|'')*'),\s*(\$b\$[\s\S]*?\$b\$|'(?:[^']|'')*'),\s*(null|'[a-z_]+'), '([a-z]{2})'\)/g
for (const m of seedBlock.matchAll(seedRow)) {
  const raw = m[5]
  seeded.push({
    key: m[1], kind: m[2], name: m[3].replace(/''/g, "'"),
    subject: m[4] === 'null' ? null : m[4].slice(1, -1).replace(/''/g, "'"),
    body: raw.startsWith('$b$') ? raw.slice(3, -3) : raw.slice(1, -1).replace(/''/g, "'"),
    position: m[6] === 'null' ? null : m[6].slice(1, -1),
    language: m[7],
  })
}
ok(`the drafts are in the checked-in schema (${seeded.length})`, seeded.length >= 18)
check('every draft is keyed once', seeded.length, new Set(seeded.map((d) => d.key)).size)
check('all three kinds are drafted',
  [...new Set(seeded.map((d) => d.kind))].sort(), ['call_script', 'email', 'sms'])

/*
 * EVERY FIELD IN EVERY DRAFT IS REAL. A typo here is not caught by the form, because these rows
 * are inserted by a migration that never goes near it.
 */
for (const d of seeded) {
  const bad = unknownFields('collections', d.body, d.subject)
  check(`${d.key} uses only fields that exist`, bad, [])
}

/* Each draft would pass the form it bypassed. */
for (const d of seeded) {
  check(`${d.key} would save through the form`,
    templateProblems({
      scope: 'collections', kind: d.kind, name: d.name, subject: d.subject, body: d.body,
    }), [])
}

/*
 * EVERY SMS FITS ONE SEGMENT AGAINST THE AWKWARD SAMPLES.
 *
 * Annexure B item 1(c) is R3.50 PER SEGMENT. A draft that spills to two costs the debtor double
 * for the same words, on every account in the campaign, and it spills on the long names — which
 * is exactly the case nobody previews. Checked against the long sample, not a tidy one.
 */
for (const d of seeded.filter((x) => x.kind === 'sms')) {
  const f = forecastSms(d.body)
  check(`${d.key} is one segment even on a long name`, f.segments, 1)
  /* And GSM-7: one curly apostrophe pasted from Word forces UCS-2, where a segment holds 70
     characters instead of 160, and doubles the bill on its own. */
  check(`...and stays in the GSM alphabet`, f.encoding, 'GSM-7')
}

/*
 * THE TRACE DRAFTS SAY NOTHING ABOUT A DEBT. This is the one content rule that is law: a traced
 * number is unverified, so the person who answers may be a neighbour or an employer, and telling
 * them somebody owes money is a disclosure the firm cannot take back.
 *
 * The SMS and the opening of the script are checked, not the whole script — the trace script's
 * NEVER block has to be able to say the word "debt" in order to forbid it, and a check that
 * banned the word outright would force the guidance to be written in euphemism.
 */
const traceSms = seeded.find((d) => d.key === 'sms-make-contact')
ok('there is a draft for a traced number', Boolean(traceSms))
/*
 * Word boundaries, not substrings. The first version of this matched "debt" anywhere and reported
 * the correct draft as broken, because {{debtor_name}} contains it — which would have pushed the
 * draft into avoiding the merge field that names the person it is asking for.
 */
const forbidden = [/\bdebts?\b/i, /\baccounts?\b/i, /\bbalances?\b/i, /\boverdue\b/i,
  /\barrears\b/i, /\bowes?d?\b/i, /\{\{client_name\}\}/, /\{\{balance\}\}/, /\{\{reference\}\}/]
for (const word of forbidden) {
  ok(`the traced-number SMS does not mention ${word.source}`, !word.test(traceSms.body))
}
/* ...and the field it DOES use is the one that names the person, which is the point of the message. */
ok('...while it does name who is wanted', traceSms.body.includes('{{debtor_name}}'))
const traceScript = seeded.find((d) => d.key === 'call-tracing')
ok('there is a script for a trace call', Boolean(traceScript))
const traceSpoken = traceScript.body.slice(0, traceScript.body.indexOf('NEVER'))
ok('the trace script has a NEVER block to slice off', traceScript.body.includes('NEVER'))
for (const word of ['{{balance}}', '{{client_name}}', '{{reference}}']) {
  ok(`the words said on a trace call do not include ${word}`,
    !traceSpoken.includes(word))
}
/* And it says so in terms, so a collector who reads only the NEVER block still gets the rule. */
ok('...and the rule is written out for the collector',
  /Never disclose that there is a debt/i.test(traceScript.body))

/*
 * EVERY CALL SCRIPT CARRIES ITS NEVER BLOCK. It is where the law lives — the Debt Collectors Act,
 * section 126B on prescribed debt, and the fact that section 129 is a demand and not litigation.
 * A script without one is a script that reads as though anything goes.
 */
for (const d of seeded.filter((x) => x.kind === 'call_script')) {
  ok(`${d.key} tells the collector what never to do`, /\nNEVER\n/.test(d.body))
  ok(`...and opens with what to say`, /^OPEN\n/.test(d.body))
}
/* Section 129 is not legal action, and the script that would be tempted to say so says it is not. */
ok('the refusal script refuses to call a section 129 notice legal action',
  /Section 129 is\s*\n?the statutory demand BEFORE court/i.test(
    seeded.find((d) => d.key === 'call-refusing').body))
/* Prescribed debt stops the call. s126B makes collecting one an offence, and an acknowledgement
   revives it, so "just get a promise" is the worst possible instinct here. */
const prescribed = seeded.filter((d) => d.kind === 'call_script' && /prescribed/i.test(d.body))
ok(`the scripts that collect money stop on a prescribed account (${prescribed.length})`,
  prescribed.length >= 4)

/*
 * AND THE DRAFTS ARE MARKED AS DRAFTS. The attorney has the final wording, exactly as
 * queryLetters.ts says, and a library that does not say so reads as settled correspondence.
 */
ok('the seed says whose the final wording is',
  /PLACEHOLDER WORDING[\s\S]{0,400}attorney has the final text/.test(seedBlock))
/*
 * RE-RUNNING THE SEED MUST NOT REVERT AN EDIT THE FIRM HAS MADE.
 *
 * COUNTED PER INSERT, and the semicolon is load-bearing. The first version of this searched the
 * block for the words "on conflict (seed_key) do nothing" and passed with every insert changed to
 * `do update set body = excluded.body` — because the DDL comment above them EXPLAINS the clause
 * in those words, and the regex was matching the explanation rather than the code. Exactly the
 * trap the house rules name: a check satisfied by the comment about the fix.
 */
const inserts = (seedBlock.match(/insert into public\.message_templates/g) ?? []).length
const guarded = (seedBlock.match(/on conflict \(seed_key\) do nothing;/g) ?? []).length
ok(`there are seed inserts to guard (${inserts})`, inserts >= 3)
check('every one of them leaves an edited row alone', guarded, inserts)
ok('...and none of them writes over the body', !/do update set/.test(seedBlock))
ok('...and the reason is written down',
  /A seed that overwrites edits is a\n-- seed that quietly reverts the attorney/.test(seedBlock))

/* ---------- fees are on accounts only ---------- */

/*
 * THE FIRM'S OWN INSTRUCTION, and this is the file where it will be forgotten: a template costs
 * nothing, but the campaign that uses it raises an Annexure B fee per send, and a campaign built
 * over leads or deals would raise fees the firm cannot bill to anybody.
 */
const src = readFileSync(new URL('../../src/lib/messageTemplates.ts', import.meta.url), 'utf8')
ok('the rule is written down where the next person will read it',
  /fees are raised on ACCOUNTS ONLY/i.test(src))
/* Pure: no database, no clock, no network. The wording has to be testable without any of them. */
ok('nothing here fetches', !/\bfetch\(|supabase/.test(src))
ok('...and nothing reads a clock', !/new Date\(\)|Date\.now\(\)/.test(src))

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
A closed list of merge fields so a typo is caught when the template is saved rather than when four
hundred copies of it are sent; a missing value that leaves the placeholder standing rather than a
gap that reads as finished prose; a company addressed by its name rather than as "Mr"; the
Annexure B segment cost of a template shown against an awkward name rather than a tidy one; and a
script that falls back rather than skipping the account, saying so every time it does.`)
