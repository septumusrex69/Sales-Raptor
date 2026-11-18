/**
 * PUT THE CLIENT'S ANSWER TO A SETTLEMENT OFFER INTO A DATABASE (S22 · Raptor H20, 18 Nov).
 *
 * Stephan: "once it's been approved, an email goes out to the debtor ... your settlement has been accepted, or your
 * settlement has been rejected, or a counter offer was made." Six letters from letters.json (accepted, countered,
 * declined; a person and a company) and six covering emails, each email attaching its letter. The three one-step
 * workflows (migration h20_settlement_rounds) point at the emails by seed_key, so run this BEFORE that migration on
 * a new database, or the workflow nodes are created with no template and hold.
 *
 * Signed by the firm's signatory, never {{collector_name}}: the answer comes from the client through the liaison,
 * and an unallocated account has no collector to sign it. Never charged (step.ts), so the emails say nothing
 * about fees.
 *
 * WHY A SCRIPT AND NOT A MIGRATION: seed-paid-up.mjs's reason -- a letter is kilobytes of JSON. Idempotent: deleted
 * by seed_key and inserted again, in one transaction, emails after letters so each finds its attachment.
 *
 *   node scripts/letters/seed-settlement-answers.mjs > /tmp/seed.sql   # then run it on the database
 *
 * VERIFY: `select seed_key, md5(body) from message_templates where seed_key like 'letter-settlement-%ed-%'` against
 * the md5s this prints to stderr.
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const letters = JSON.parse(readFileSync(new URL('./letters.json', import.meta.url), 'utf8'))
const q = (s) => `'${String(s).replace(/'/g, "''")}'`

const ANSWERS = {
  accepted: {
    name: 'Settlement accepted',
    subject: 'Your settlement offer has been accepted -- {{case_number}}',
    lines: (who) => [
      `${who === 'individual' ? 'Your' : 'The company’s'} offer to settle this account has been accepted by {{client_name}}.`,
      '',
      'Accepted in full and final settlement: {{settlement_amount}}',
      'To be paid in full by: {{settlement_expiry}}',
      '',
      'Pay it in one payment into our trust account, using {{case_number}} as the reference. The banking details are in the attached letter. When the payment is received, the rest of the balance is written off and the account is closed.',
      '',
      'If the full amount is not received by {{settlement_expiry}}, the offer lapses and the full balance is owing again.',
    ],
  },
  countered: {
    name: 'Settlement counter-offer',
    subject: 'A counter-offer to settle your account -- {{case_number}}',
    lines: (who) => [
      `{{client_name}} could not accept the amount ${who === 'individual' ? 'you' : 'the company'} offered, but will accept the amount below in full and final settlement of this account.`,
      '',
      'The creditor will accept: {{settlement_amount}}',
      'To be paid in full by: {{settlement_expiry}}',
      '',
      'There is nothing to sign: paying the full amount into our trust account by that date, using {{case_number}} as the reference, accepts this offer. The banking details are in the attached letter.',
      '',
      'If the full amount is not received by {{settlement_expiry}}, the offer lapses and the full balance is owing again.',
    ],
  },
  declined: {
    name: 'Settlement not accepted',
    subject: 'Your settlement offer -- {{case_number}}',
    lines: (who) => [
      `We put ${who === 'individual' ? 'your' : 'the company’s'} offer to settle this account to {{client_name}}, and it has not been accepted.`,
      '',
      'Outstanding today: {{balance}}',
      '',
      `${who === 'individual' ? 'You' : 'The company'} may still pay the balance, propose a payment arrangement in writing, or make a new offer. The attached letter sets out how to pay.`,
    ],
  },
}

const covering = (who, answer) => [
  who === 'individual' ? 'Dear {{debtor_name}}' : 'To the directors of {{debtor_name}}',
  '',
  'Case reference: {{case_number}}',
  '',
  ...ANSWERS[answer].lines(who),
  '',
  'Yours faithfully',
  '{{signatory_name}}',
  '{{firm_name}}',
  'Duly authorised agent of {{client_name}}',
].join('\n')

const keys = []
const out = ['begin;']
for (const answer of Object.keys(ANSWERS)) {
  for (const who of ['individual', 'company']) keys.push(`letter-settlement-${answer}-${who}`, `email-settlement-${answer}-${who}`)
}
out.push(`delete from public.message_templates where seed_key in (${keys.map(q).join(', ')});`)
for (const [answer, a] of Object.entries(ANSWERS)) {
  for (const who of ['individual', 'company']) {
    const key = `letter-settlement-${answer}-${who}`
    if (!letters[key]) throw new Error(`${key} is not in letters.json -- run build.mjs first`)
    const body = JSON.stringify(letters[key])
    console.error(`${key} md5 ${createHash('md5').update(body).digest('hex')}`)
    out.push(`insert into public.message_templates (kind, name, subject, body, language, active, seed_key, scope, format, audience, attaches_schedule)
values ('letter', ${q(`${a.name} (${who})`)}, null, ${q(body)}, 'en', true, ${q(key)}, 'collections', 'document', ${q(who)}, false);`)
  }
}
for (const [answer, a] of Object.entries(ANSWERS)) {
  for (const who of ['individual', 'company']) {
    out.push(`insert into public.message_templates (kind, name, subject, body, language, active, seed_key, scope, audience, attachment_id)
values ('email', ${q(`${a.name} email (${who})`)}, ${q(a.subject)}, ${q(covering(who, answer))}, 'en', true, ${q(`email-settlement-${answer}-${who}`)}, 'collections', ${q(who)},
  (select id from public.message_templates where seed_key = ${q(`letter-settlement-${answer}-${who}`)}));`)
  }
}
out.push('commit;')
console.log(out.join('\n'))
