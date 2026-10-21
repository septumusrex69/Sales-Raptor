/**
 * The firm's eight typeset specimens, rebuilt as Raptor letter documents.
 *
 * THE PDFs ARE THE ARTWORK, NOT THE CONTENT. Each one is already filled in with one debtor's
 * details -- "Mr T Mokoena", "GPS3/10103", "R 48 215.60" -- so turning them into templates means
 * putting a merge field back wherever a value was typeset in. Every substitution below is
 * declared once, in SUBS, so the same sample value cannot become two different fields in two
 * letters.
 *
 * THE SHARED BLOCKS ARE SHARED. The header strip, the banking details, the signature and the
 * delivery note are identical across all eight; written once here, a change to the firm's trust
 * account is one edit rather than eight.
 */
import { writeFileSync } from 'node:fs'

const t = (text, over = {}) => ({ text, ...over })
const p = (text, over = {}) => ({ kind: 'paragraph', spans: Array.isArray(text) ? text : [t(text)], ...over })
const h = (level, text, over = {}) => ({ kind: 'heading', level, spans: [t(text)], ...over })
const cell = (text, over = {}) => ({ spans: Array.isArray(text) ? text : [t(text)], ...over })
const row = (...cells) => cells.map((c) => (typeof c === 'string' ? cell(c) : c))

/** The date/reference strip. Borderless, at the head of every notice. */
const headerStrip = (delivery = 'By email, with notification by SMS') => ({
  kind: 'table', borders: 'none', widths: [28, 72],
  rows: [
    row(cell([t('DATE', { bold: true })]), '{{today}}'),
    row(cell([t('OUR REFERENCE', { bold: true })]), '{{case_number}}'),
    row(cell([t('ACCOUNT', { bold: true })]), '{{account_number}}'),
    row(cell([t('DELIVERY', { bold: true })]), delivery),
  ],
})

/** Who it is to. A person carries an ID; a company carries a registration number. */
const addressee = (who) => (who === 'individual'
  ? [p([t('{{debtor_name}}', { bold: true })]), p('Identity number: {{debtor_id_masked}}')]
  /* "The Directors" above the name, as the specimen has it: a demand on a company is addressed
     to the people who must act on it, not to the entity that cannot read. */
  : [p('The Directors'), p([t('{{debtor_name}}', { bold: true })]),
     p('Registration number: {{debtor_reg_no}}')])

/** How to pay. Identical on all eight, and the one place the trust account is written. */
const howToPay = () => ([
  h(2, 'How to pay'),
  p([t('PAYMENT MUST BE MADE INTO OUR LEGAL PRACTITIONER TRUST ACCOUNT', { bold: true })]),
  p('A payment into our trust account is verified on the day it reaches us. Do not pay any other account.'),
  { kind: 'table', borders: 'rows', widths: [34, 66],
    rows: [
      row(cell([t('BANK', { bold: true })]), '{{firm_bank_name}}'),
      row(cell([t('ACCOUNT NAME', { bold: true })]), '{{firm_bank_holder}}'),
      row(cell([t('BRANCH CODE', { bold: true })]), '{{firm_bank_branch}}'),
      row(cell([t('ACCOUNT NUMBER', { bold: true })]), '{{firm_bank_account}}'),
      row(cell([t('PAYMENT REFERENCE', { bold: true })]), '{{case_number}}'),
      row(cell([t('PROOF OF PAYMENT', { bold: true })]), 'Email it to {{firm_email}} on the day you pay'),
      row(cell([t('QUESTIONS', { bold: true })]),
        'Speak to {{collector_name}}, who handles this account, on {{firm_phone}}'),
    ] },
])

/** Yours faithfully, and who is behind it. Kept with what follows so it is never orphaned. */
const signOff = (closing) => ([
  p(closing),
  p([t('Yours faithfully')], { keepWithNext: true }),
  { kind: 'signature', spans: [
    t('{{signatory_name}}\n{{signatory_title}}\nfor and on behalf of {{firm_name}}\n'
      + 'duly authorised agent of {{client_name}}'),
  ] },
  p([t('Note on delivery. Sent by email, with notification by SMS. Proof of sending is retained '
    + 'on our file.', { size: 8.5 })]),
])

/** Where the account stands: the three dates the notices show as a timeline. */
const whereItStands = (middle) => ({
  kind: 'table', borders: 'all', widths: [40, 60],
  headerRow: true,
  rows: [
    row(cell([t('WHERE THIS ACCOUNT STANDS', { bold: true })]), ''),
    row('Account handed to us', '{{handover_date}}'),
    row(middle, '{{today}}'),
    row('You must respond by', '{{respond_by}}'),
  ],
})

/** What has been paid against what is still owed. Zero is a real answer and prints as R 0.00. */
const paidSoFar = () => ({
  kind: 'table', borders: 'all', widths: [50, 50],
  headerRow: true,
  rows: [
    row(cell([t('WHAT HAS BEEN PAID SINCE THIS ACCOUNT WAS HANDED TO US', { bold: true })]), ''),
    row('Paid since handover', '{{paid_to_date}}'),
    row(cell([t('Still outstanding and due in full', { bold: true })]),
      cell([t('{{balance}}', { bold: true })])),
  ],
})

export { t, p, h, cell, row, headerStrip, addressee, howToPay, signOff, whereItStands, paidSoFar }
writeFileSync('builders.ok', 'ok')
