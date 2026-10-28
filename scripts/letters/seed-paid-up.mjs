/**
 * PUT THE PAID-UP CONFIRMATION INTO A DATABASE (S15, Raptor · Handover 14).
 *
 * Two letters (a person, a company) from letters.json, and the two covering emails that already
 * existed pointed at them. Stephan, 28 Oct: a paid-up account gets a letter, by email, never an SMS.
 * The covering emails said "the paid-up confirmation is attached" while nothing was -- there was no
 * letter to attach -- and they were signed {{collector_name}}, which a closed account no longer has
 * (closing takes it off the collector's desk), so a workflow sending one would hold on a blank field.
 * They are now signed by the firm's signatory, like every letter, and say "paid up" rather than "paid
 * in full", because a balance under R50 waived by Ready to close gets the same letter.
 *
 * WHY A SCRIPT AND NOT A MIGRATION: the reason seed-aod.mjs gives -- a letter is kilobytes of JSON, and
 * schema.sql is for schema. Idempotent: the letters are deleted by seed_key and inserted again, in one
 * transaction, and the emails are updated by seed_key.
 *
 *   node scripts/letters/seed-paid-up.mjs > /tmp/seed-paid-up.sql   # then run it on the database
 *
 * VERIFY afterwards: `select seed_key, md5(body) from message_templates where seed_key like
 * 'letter-paid-up-%'` against the md5 this prints to stderr.
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const letters = JSON.parse(readFileSync(new URL('./letters.json', import.meta.url), 'utf8'))
const q = (s) => `'${String(s).replace(/'/g, "''")}'`

const LETTERS = [
  { seed_key: 'letter-paid-up-individual', name: 'Paid-up confirmation (individual)', audience: 'individual' },
  { seed_key: 'letter-paid-up-company', name: 'Paid-up confirmation (company)', audience: 'company' },
]

const covering = (who) => [
  who === 'individual' ? 'Dear {{debtor_name}}' : 'To the directors of {{debtor_name}}',
  '',
  'Case reference: {{case_number}}',
  '',
  ...(who === 'company' ? ['Registration number: {{debtor_reg_no}}', ''] : []),
  (who === 'individual' ? 'Your account' : 'The account') + ' with {{client_name}} has been paid up and our file is closed. The paid-up confirmation is attached.',
  '',
  who === 'individual'
    ? 'Keep the attached letter. It is your proof that nothing further is owing on this account, now or in years from now.'
    : 'Keep the attached letter. It is the company\'s proof that nothing further is owing on this account.',
  '',
  'Nothing further is payable and no further step will be taken on this account.',
  '',
  'If a default was reported to the credit bureaus on this account, the record is corrected to show that the account was paid up. Allow 20 business days for the bureaus to reflect it.',
  '',
  'Thank you for settling the account.',
  '',
  'Yours faithfully',
  '{{signatory_name}}',
  '{{firm_name}}',
  'Duly authorised agent of {{client_name}}',
].join('\n')

const out = ['begin;']
out.push(`delete from public.message_templates where seed_key in (${LETTERS.map((l) => q(l.seed_key)).join(', ')});`)
for (const l of LETTERS) {
  const body = JSON.stringify(letters[l.seed_key])
  if (!letters[l.seed_key]) throw new Error(`${l.seed_key} is not in letters.json -- run build.mjs first`)
  console.error(`${l.seed_key} md5 ${createHash('md5').update(body).digest('hex')}`)
  out.push(`insert into public.message_templates (kind, name, subject, body, language, active, seed_key, scope, format, audience, attaches_schedule)
values ('letter', ${q(l.name)}, null, ${q(body)}, 'en', true, ${q(l.seed_key)}, 'collections', 'document', ${q(l.audience)}, false);`)
}
for (const who of ['individual', 'company']) {
  out.push(`update public.message_templates
   set body = ${q(covering(who))},
       attachment_id = (select id from public.message_templates where seed_key = ${q(`letter-paid-up-${who}`)})
 where seed_key = ${q(`email-paid-up-${who}`)};`)
}
out.push('commit;')
console.log(out.join('\n'))
