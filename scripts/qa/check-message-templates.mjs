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
/* The PDF's repertoire, so the separator bankLine joins with is held against what a notice can
   actually print rather than against what looks right in a terminal. */
import { isPrintable } from '../../src/lib/winAnsi.ts'
import {
  KINDS_FOR_SCOPE,
  MERGE_FIELDS, SMS_RAND_PER_SEGMENT, addressAs, deleteRefusal, deleteWarning, fieldsUsed,
  forecastSms, kindForChannel, longDate,
  FIELD_GROUPS, bankLine, groupedFields, maskSaId, mergeValuesFor, renderTemplate, resolveNote,
  resolveTemplate, sampleValues,
  templateProblems,
  unknownFields, usageNote,
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
  agentName: 'Stephan Bredell', agentPhone: '012 111 2222',
  agentEmail: 'stephan@bredellferreira.co.za', agentWhatsapp: '082 000 0001',
  /* DELIBERATELY THREE DIFFERENT PEOPLE. The whole point of the new fields is that they are not
     the same person, and a fixture where they were would prove nothing. */
  collector: { name: 'Rinda Ferreira', phone: '012 348 2156', email: 'rinda@bf.co.za', whatsapp: '082 000 0002' },
  liaison: { name: 'Camile Bredell', phone: '012 348 2157', email: 'camile@bf.co.za', whatsapp: '082 000 0003' },
  today: '2026-09-18', money,
  /* PASSED WHOLE, the way AccountDetail passes it: mergeValuesFor takes FirmSettings' own shape
     so that no list of the firm's fields exists in between to fall behind the ones it grew. */
  firm: {
    firmName: 'Bredell Ferreira',
    phone: '015 291 1234', email: 'info@bredellferreira.co.za',
    website: 'www.bredellferreira.co.za',
    physicalAddress: '25 Kerk Street\nPolokwane\n0699',
    postalAddress: 'PO Box 1234\nPolokwane\n0700',
    officeHours: 'Monday to Friday, 08:00 \u2013 16:30',
    trustBank: 'Standard Bank', trustBranchCode: '051001',
    trustAccountName: 'Bredell Ferreira Trust', trustAccountNumber: '01 234 5678',
    trustAccountType: 'Legal Practitioner Trust Account',
    paymentInstruction: 'Payment must be made into our trust account.',
    businessBank: 'Nedbank', businessBranchCode: '198765',
    businessAccountName: 'Bredell Ferreira', businessAccountNumber: '02 345 6789',
    signatoryName: 'J Bredell', signatoryTitle: 'Duly authorised legal representative',
  },
})
check('the debtor is addressed as they should be', values.debtor_name, 'Mr Buitendag')
/* The client's own reference is what is on the debtor's paperwork; ours is only the fallback. */
check('the reference is the client’s own', values.reference, 'GPS3/10103')
check('...falling back to ours where the client has none',
  mergeValuesFor({
    account: { ...person, clientReference: null }, balance: 1, clientName: 'x', agentName: 'y',
    agentPhone: 'z', firm: { firmName: 'f' }, today: '2026-09-18', money,
  }).reference, 'ACF10085')
check('the balance is formatted by the app’s own formatter', values.balance, 'R 48250.00')
check('a balance that is not known answers nothing rather than nought',
  mergeValuesFor({
    account: person, balance: null, clientName: 'x', agentName: 'y', agentPhone: 'z',
    firm: { firmName: 'f' }, today: '2026-09-18', money,
  }).balance, null)
check('the date is written out, never ISO', values.today, '18 September 2026')
check('longDate leaves a date it cannot read alone', longDate('not a date'), 'not a date')
/* Every field in the catalogue must be answerable, or a template can use one nothing ever fills. */
check('every collections field can be answered',
  MERGE_FIELDS.collections.filter((f) => !(f.key in values)).map((f) => f.key), [])
/*
 * The firm's own fields on the OTHER side, which nothing checked before.
 *
 * Only the firm_ ones: mergeValuesFor answers an ACCOUNT, so {{contact_name}} and {{deal_value}}
 * are filled by the sales side's own resolver and are legitimately absent here. The firm's
 * details are not -- they come from this one function whichever scope asked, and a sales template
 * offering {{firm_business_bank_account}} that renders as nothing is the exact failure the closed
 * list exists to stop.
 */
check('every firm field the sales side offers can be answered',
  MERGE_FIELDS.sales.filter((f) => f.key.startsWith('firm_') && !(f.key in values)).map((f) => f.key),
  [])

/* ---------- the firm's details, and the two accounts that must not meet ---------- */

check('the office number is the firm\u2019s, not the collector\u2019s',
  [values.firm_phone, values.agent_phone], ['015 291 1234', '012 111 2222'])
check('the address is merged on the lines it was typed on',
  values.firm_address, '25 Kerk Street\nPolokwane\n0699')
/*
 * WHERE THE FIRM SITS AND WHERE ITS POST ARRIVES ARE DIFFERENT ANSWERS. A section 129 is
 * delivered to a chosen address; a firm working from a street it does not receive post at would
 * have replies going nowhere. One "address" field would make a template author pick which
 * meaning it had, silently and differently each time.
 */
check('post goes to its own address, not the street',
  values.firm_postal_address, 'PO Box 1234\nPolokwane\n0700')
/*
 * MERGED EXACTLY AS TYPED, scheme and all -- or neither. A letterhead reads "www..." and an email
 * signature may want "https://..." so the mail client makes it a link; normalising here would
 * pick one of those for every template at once, and the wrong one silently.
 */
check('the website is merged as typed', values.firm_website, 'www.bredellferreira.co.za')

/* Free text: "telephone this office" is only useful with the hours attached, and nothing in the
   app reads this as a time -- no queue closes because this box says half past four. */
check('the office\u2019s hours are merged as written',
  values.firm_hours, 'Monday to Friday, 08:00 \u2013 16:30')
/* The en dash the firm would naturally type between two times is in Windows-1252 at 0x96; one
   that is not would refuse the build of every notice carrying this field. */
ok('every character of the hours can be printed on a notice',
  [...(values.firm_hours ?? '')].every((ch) => isPrintable(ch.codePointAt(0))))

/*
 * {{firm_bank}} STILL PRINTS WHAT IT USED TO. The firm asked for the bank and the branch code to
 * be stored apart; every notice already written says {{firm_bank}}, so the join has to happen
 * somewhere and has to happen the same way every time. A letter reading "Standard Bank - 051001"
 * on one notice and "Standard Bank, 051001" on the next looks like two accounts to a debtor.
 */
check('bank and branch code are joined the way they read on a page',
  values.firm_bank, 'Standard Bank \u00b7 051001')
check('...and are each answerable on their own',
  [values.firm_bank_name, values.firm_bank_branch], ['Standard Bank', '051001'])
/*
 * WHERE A DEBTOR PAYS, SAID ONCE. The firm: "we need to move them and motivate them to pay into
 * our trust account. It's a legal practitioner trust account." Both of these are the firm's own
 * words merged as typed -- retyped into each template instead, the same account gets described
 * four different ways and the one a debtor happens to be holding is the one that counts.
 */
check('the account type is merged in the bank\u2019s own words',
  values.firm_bank_type, 'Legal Practitioner Trust Account')
check('the standing ask is merged as the firm wrote it',
  values.payment_instruction, 'Payment must be made into our trust account.')
check('half an answer is still an answer', bankLine('Standard Bank', null), 'Standard Bank')
check('...from either half', bankLine(null, '051001'), '051001')
check('...and neither is nothing, not a stray separator', bankLine(null, null), null)
check('a blank is not a half', bankLine('   ', '  '), null)
/*
 * THE SEPARATOR IS TAKEN OUT OF bankLine'S OWN ANSWER, not typed here.
 *
 * Written as isPrintable('\u00b7') this asserted a character the check itself had chosen, and it
 * stayed green with the join changed to an arrow -- a check that passes on broken code, which
 * CLAUDE.md says is worse than none. Found by making exactly that change.
 *
 * Windows-1252 is all a PDF built on the 14 standard faces can draw, so a separator outside it
 * refuses the build of every notice carrying this field.
 */
const sep = bankLine('A', 'B').slice(1, -1)
ok(`the join is drawn with characters a PDF can print ("${sep}")`,
  [...sep].every((ch) => isPrintable(ch.codePointAt(0))))

/*
 * THE TWO ACCOUNTS ARE KEPT APART BY THE VOCABULARY, NOT BY A WARNING.
 *
 * A debtor pays into the trust account; a client pays the firm's commission into the business
 * account. templateProblems refuses a field that is not in the template's scope, so as long as
 * these lists stay disjoint a section 129 CANNOT name the business account -- it will not save.
 * Trust money in the business account is found at month end, not on the day.
 */
const keys = (scope) => MERGE_FIELDS[scope].map((f) => f.key)
const trustKeys = keys('collections').filter((k) => k.startsWith('firm_bank'))
const businessKeys = keys('sales').filter((k) => k.startsWith('firm_business_bank'))
ok(`the trust account is in the collections vocabulary (${trustKeys.length})`, trustKeys.length >= 4)
ok(`the business account is in the sales vocabulary (${businessKeys.length})`, businessKeys.length >= 4)
check('no debtor notice can name the business account',
  keys('collections').filter((k) => k.startsWith('firm_business')), [])
check('and no sales template can name the trust account',
  keys('sales').filter((k) => k.startsWith('firm_bank')), [])

/*
 * AND NEITHER IS OFFERED TO THE SALES SIDE. Both describe where a DEBTOR pays; a template to a
 * lead or a client has no business asking for either, and templateProblems refuses a field that
 * is not in the template's scope, so one that does will not save.
 */
check('neither reaches a sales template',
  keys('sales').filter((k) => k === 'payment_instruction' || k === 'firm_bank_type'), [])
ok('...and both are offered to a debtor notice',
  keys('collections').includes('payment_instruction')
  && keys('collections').includes('firm_bank_type'))

/* ---------- the three fields the firm said still needed attention ---------- */

/*
 * THE FIRM, naming them one by one: "{{debtor_reg_no}} isn't a field yet. The company SMS, email
 * and letter all use it." "{{debtor_address}} exists, but Raptor doesn't fill it yet." "And
 * {{respond_by}} exists, but Raptor doesn't fill it yet."
 */

/*
 * ONE COLUMN, TWO MEANINGS, TWO FIELDS. debtor_id_number holds an ID number on a person and a
 * registration number on a company; debtor_kind says which. So each field must answer on ONE kind
 * of debtor and stay silent on the other -- and silence is null, which leaves the placeholder
 * standing rather than printing a blank.
 */
const company = {
  ...person, debtorKind: 'company', debtorTitle: '', debtorFirstName: '',
  debtorSurname: 'Moloto Trading CC',
}
const asPerson = mergeValuesFor({
  account: person, balance: 1, clientName: 'x', agentName: 'y', agentPhone: 'z',
  firm: { firmName: 'f' }, today: '2026-09-18', money, debtorIdMasked: '8503125009087',
})
const asCompany = mergeValuesFor({
  account: company, balance: 1, clientName: 'x', agentName: 'y', agentPhone: 'z',
  firm: { firmName: 'f' }, today: '2026-09-18', money, debtorIdMasked: '2019/940923/07',
})
check('a company answers with a registration number',
  [asCompany.debtor_reg_no, asCompany.debtor_id_masked], ['2019/940923/07', null])
check('...and a person with an identity number, and no registration number',
  [asPerson.debtor_reg_no, asPerson.debtor_id_masked], [null, '850312 XXXX 08 X'])

/*
 * AND IT IS ACTUALLY MASKED. The field has been called debtor_id_masked since it was written and
 * nothing masked anything -- AccountDetail passed the whole thirteen digits through. A field
 * whose name promises a mask and prints the number is worse than one that never claimed to.
 */
check('the four digits that encode sex are covered', maskSaId('8503125009087'), '850312 XXXX 08 X')
check('...and so is the check digit', maskSaId('8503125009087').slice(-1), 'X')
/* The date of birth is deliberately left: it is what lets a debtor recognise their own number. */
ok('...while the date of birth is left, so a debtor recognises it',
  maskSaId('8503125009087').startsWith('850312'))
/*
 * ANYTHING THAT IS NOT THIRTEEN DIGITS IS RETURNED UNTOUCHED. 45 rows of the firm's own import
 * file had a telephone number in this column, and "0746 XXXX 63" would look deliberate.
 */
check('a telephone number in the ID column is not dressed up as an ID',
  maskSaId('0746013863'), '0746013863')
check('nothing stays nothing', maskSaId(''), null)

/* ---------- three people, and they are not the same person ---------- */

/*
 * THE FIRM: "fields for the user ... the user that's assigned to the account or the user that's
 * assigned to the client ... email address, telephone number, WhatsApp number."
 *
 * {{agent_*}} has always resolved to whoever is SIGNED IN, so a team leader previewing a letter
 * on somebody else's account sees their own name. That is right for "reply and you reach me" and
 * wrong for "the collector handling your account is". So the account's collector and the client's
 * liaison are their own fields, and this is what keeps the three apart: every value below comes
 * from a different person in the fixture, so any two of them wired to one source fails.
 */
check('the sender is whoever is composing',
  [values.agent_name, values.agent_phone, values.agent_email, values.agent_whatsapp],
  ['Stephan Bredell', '012 111 2222', 'stephan@bredellferreira.co.za', '082 000 0001'])
check('the collector is whoever the ACCOUNT is assigned to',
  [values.collector_name, values.collector_phone, values.collector_email, values.collector_whatsapp],
  ['Rinda Ferreira', '012 348 2156', 'rinda@bf.co.za', '082 000 0002'])
check('the liaison is whoever looks after the CLIENT',
  [values.liaison_name, values.liaison_phone, values.liaison_email, values.liaison_whatsapp],
  ['Camile Bredell', '012 348 2157', 'camile@bf.co.za', '082 000 0003'])

/*
 * NOBODY ASSIGNED IS NULL, NOT A BLANK. An unassigned account merging as an empty line would read
 * as a finished letter naming nobody; left standing, {{collector_name}} is caught before it is
 * posted. The same rule as every other unfillable field in this file.
 */
const orphan = mergeValuesFor({
  account: person, balance: 1, clientName: 'x', agentName: 'y', agentPhone: 'z',
  firm: { firmName: 'f' }, today: '2026-09-18', money,
})
check('an account nobody holds names nobody, rather than a gap',
  [orphan.collector_name, orphan.liaison_name, orphan.agent_email], [null, null, null])

/*
 * THE LIAISON IS A COLLECTIONS IDEA. It is for what the firm writes TO a client about an account;
 * a lead has no liaison because it has no client yet.
 */
check('the liaison is not offered on the sales side',
  keys('sales').filter((k) => k.startsWith('liaison_')), [])
ok('...while the sender travels with both sides',
  keys('sales').includes('agent_email') && keys('collections').includes('agent_email'))

/* ---------- the fields, in groups ---------- */

/*
 * THE FIRM: "if we can categorize it ... because now it's like all over the place." Forty chips
 * in one row, in the order the fields happened to be written in.
 *
 * THE FAILURE MODE OF A GROUPING TABLE IS SILENCE. A field the table does not mention simply
 * stops being offered -- the screen looks tidier, nobody notices, and a field written, checked
 * and exported is never used again. groupedFields puts the strays in a group called "Not yet
 * grouped" so they are visible rather than missing, and this refuses that group outright.
 */
for (const scope of ['collections', 'sales']) {
  const groups = groupedFields(scope)
  ok(`${scope} fields are offered in groups (${groups.length})`, groups.length >= 4)
  const stray = groups.find((g) => g.title === 'Not yet grouped')
  check(`...with every ${scope} field in one of them`,
    stray ? stray.fields.map((f) => f.key) : [], [])
  /* Every field exactly once: a key in two groups is a chip that inserts the same thing twice
     and a reader who cannot tell which group it really belongs to. */
  const shown = groups.flatMap((g) => g.fields.map((f) => f.key))
  check(`...and none of them twice`, shown.filter((k, i) => shown.indexOf(k) !== i), [])
  check(`...and none of them lost`, shown.length, MERGE_FIELDS[scope].length)
}
/* A group title claimed twice would render two identical headings with the row split between
   them, which reads as a bug in the data rather than in the table. */
const titles = FIELD_GROUPS.map((g) => g.title)
check('no two groups share a title', titles.filter((t, i) => titles.indexOf(t) !== i), [])
/* And the table may not name a field that does not exist -- a typo there is a key silently
   dropped from the screen, which is the same silence again from the other end. */
const known = new Set(Object.values(MERGE_FIELDS).flatMap((l) => l.map((f) => f.key)))
check('every key in the grouping table is a real field',
  FIELD_GROUPS.flatMap((g) => g.keys).filter((k) => !known.has(k)), [])

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
/*
 * Pure: no database, no clock, no network. The wording has to be testable without any of them.
 *
 * READ WITH THE COMMENTS STRIPPED, at the cost of one false alarm already paid: mergeValuesFor's
 * own comment EXPLAINS why it declines to import firmSettings.ts -- naming supabase to say what
 * it is keeping out -- and this check failed on the explanation of the rule it enforces. The same
 * trap has caught several checks in this suite: the prose and the code are not the same text.
 */
const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
ok('nothing here fetches', !/\bfetch\(|supabase/.test(code(src)))
ok('...and nothing reads a clock', !/new Date\(\)|Date\.now\(\)/.test(src))

/* ---------- throwing one away ---------- */

/*
 * THE DANGER IS SILENT, which is the only reason these rules exist at all.
 * workflow_nodes.template_id is `on delete set null`, so deleting a template a workflow step
 * sends does not fail and does not warn: the step survives saying "send an email" with nothing to
 * send, and nobody finds out until the day it runs.
 */
const usage = (over = {}) => ({ steps: 0, frozenSteps: 0, workflows: [], attachedTo: [], ...over })

check('an unused template may be deleted', deleteRefusal(usage()), null)
check('...and so may one only a draft workflow uses',
  deleteRefusal(usage({ steps: 2, workflows: ['Standard Collections'] })), null)

/*
 * ACTIVE AND ARCHIVED BOTH REFUSE, and archived is the one that is easy to get wrong. Active is
 * running against live accounts; archived means accounts ALREADY RAN on it, and what they were
 * sent is the firm's record of what it said. Deleting the wording out from under either is
 * rewriting history.
 */
ok('a template a published step sends may not be deleted',
  deleteRefusal(usage({ steps: 1, frozenSteps: 1 })) !== null)
ok('...and the refusal says where to go and look',
  (deleteRefusal(usage({ steps: 1, frozenSteps: 1, workflows: ['Standard Collections'] })) ?? '')
    .includes('Standard Collections'))
ok('...and offers retiring instead of just saying no',
  /[Rr]etire it instead/.test(deleteRefusal(usage({ steps: 1, frozenSteps: 1 })) ?? ''))
ok('...counting them where there is more than one',
  (deleteRefusal(usage({ steps: 4, frozenSteps: 3 })) ?? '').includes('3'))

/* A draft workflow losing a template is an edit, not damage — but an edit made on purpose. */
ok('a draft step is a warning, not a refusal',
  deleteRefusal(usage({ steps: 1 })) === null
  && (deleteWarning(usage({ steps: 1 }), null) ?? '').includes('draft'))
check('...and nothing to say about a template nothing uses',
  deleteWarning(usage(), null), null)
/*
 * A SEEDED ROW COMES BACK. seed_key is what makes seeding idempotent, so the migration that put
 * it there puts it back the next time the schema is replayed. Somebody deleting one should know
 * that before they are surprised by it.
 */
ok('a seeded template says it would come back',
  (deleteWarning(usage(), 'sms-first-contact') ?? '').includes('sms-first-contact'))
ok('...and one written here says nothing of the sort',
  !/come back/.test(deleteWarning(usage({ steps: 1 }), null) ?? ''))

/*
 * A LETTER SOMETHING POSTS WITH. message_templates.attachment_id is `on delete set null` — the
 * same silent shape as the workflow step — so deleting the Section 129 notice leaves its covering
 * email intact, still saying "attached is a notice issued in terms of section 129(1)(a)", with
 * nothing attached. That is a defective statutory demand that looks like a correct one.
 */
ok('deleting a letter warns about the email that posts it',
  (deleteWarning(usage({ attachedTo: ['Section 129 notice - covering email'] }), null) ?? '')
    .includes('Section 129 notice - covering email'))
ok('...and names all of them where there is more than one',
  ['Covering email', 'Second demand'].every((n) =>
    (deleteWarning(usage({ attachedTo: ['Covering email', 'Second demand'] }), null) ?? '')
      .includes(n)))
ok('...and it is a warning, not a refusal',
  deleteRefusal(usage({ attachedTo: ['Covering email'] })) === null)

/* ---------- the order the firm reads them in ---------- */

/*
 * THE FIRM'S OWN ORDER, and it is not alphabetical or arbitrary: "SMS templates, email templates,
 * letters, and then call scripts." It runs cheapest-and-first-contact to most involved, which is
 * the order an account actually escalates in, and a letter sits beside the email because the
 * email is what posts it.
 */
check('collections reads SMS, email, letters, then call scripts',
  KINDS_FOR_SCOPE.collections, ['sms', 'email', 'letter', 'call_script'])
/* No letters on the sales side: the firm posts nothing to a lead. */
check('the sales side has no letters', KINDS_FOR_SCOPE.sales, ['sms', 'email', 'call_script'])

/* ---------- the step and the words it sends ---------- */

/*
 * THE COLUMN NOTHING COULD SET. workflow_nodes.template_id has pointed at message_templates since
 * that table was written, and while the builder lived in Settings and the library lived somewhere
 * else there was no picker for it at all: a step could be created saying "send an email" with
 * nothing to send, and the builder counted those without being able to fix one.
 */
check('an email step is offered emails', kindForChannel('email'), 'email')
check('an SMS step is offered SMS wording', kindForChannel('sms'), 'sms')
check('a call step is offered call scripts', kindForChannel('call'), 'call_script')
/* Post, registered post and by hand are three ways of delivering the same written thing. */
check('post takes a letter', kindForChannel('post'), 'letter')
check('registered post takes a letter', kindForChannel('registered_post'), 'letter')
check('and so does by hand', kindForChannel('hand'), 'letter')
/*
 * WHATSAPP TAKES THE SMS WORDING, which is a judgement rather than an equivalence: it is the only
 * short-text kind there is. What must not follow is the price -- Annexure B item 1(c) prices an
 * SMS and nothing in the tariff prices a WhatsApp, so a segment cost shown against a WhatsApp
 * step would be a wrong number on screen, which is worse than no number.
 */
check('whatsapp borrows the SMS wording', kindForChannel('whatsapp'), 'sms')
check('a step with no channel is offered nothing', kindForChannel(null), null)
check('...and so is a channel nobody has written for', kindForChannel('carrier_pigeon'), null)

/* ---------- what is already sending these words ---------- */

/*
 * ASKED BEFORE AN EDIT, NOT BEFORE A DELETE. deleteWarning exists to stop damage. This answers
 * the question somebody has before they rewrite a sentence -- is anything sending this right
 * now? -- and the answer changes whether they rewrite it at all.
 */
check('a template nothing uses says nothing', usageNote(usage()), null)
ok('one a workflow sends says so, and where',
  (usageNote(usage({ steps: 2, workflows: ['Standard Collections'] })) ?? '')
    .includes('Sent by 2 steps in Standard Collections'))
ok('a letter an email posts says so too',
  (usageNote(usage({ attachedTo: ['Section 129 covering email'] })) ?? '')
    .includes('Posted with Section 129 covering email'))
/*
 * THE PART THAT CHANGES BEHAVIOUR. Editing wording a PUBLISHED workflow sends does not change
 * what already went out -- but it does change what the next account on that workflow receives,
 * with no new version and nobody approving it. A draft step carries no such warning.
 */
ok('a published step warns that the next account gets the new words',
  /next account receives/.test(usageNote(usage({ steps: 1, frozenSteps: 1 })) ?? ''))
ok('...and a draft step does not',
  !/next account/.test(usageNote(usage({ steps: 1 })) ?? ''))

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
