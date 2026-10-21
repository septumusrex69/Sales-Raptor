import { writeFileSync } from 'node:fs'
import {
  t, p, h, cell, row, headerStrip, addressee, howToPay, signOff, whereItStands, paidSoFar,
} from './blocks.mjs'

const DEFAULTS = { font: '"Charter", "Bitstream Charter", Georgia, serif', size: 10.5, colour: '#1f2937', lineHeight: 1.45 }
const doc = (blocks) => ({ defaults: DEFAULTS, blocks })

/* ---------------------------------------------------------------- 1. Section 129 (individual) */

const s129 = doc([
  headerStrip(),
  ...addressee('individual'),
  h(1, 'NOTICE IN TERMS OF SECTION 129(1)(a) READ WITH SECTION 130 OF THE NATIONAL CREDIT ACT 34 OF 2005'),
  p('Dear {{debtor_name}} — we act on behalf of {{client_name}}, the creditor, and are duly '
    + 'authorised to issue this notice. This is a formal legal notice. Please read all of it.'),

  h(2, 'Your default', { numbered: true }),
  p('You are in default under your agreement with the creditor, and the full outstanding balance '
    + 'is due and payable.'),
  paidSoFar(),
  whereItStands('This notice issued'),
  { kind: 'table', borders: 'rows', widths: [40, 60], rows: [
    row('Creditor', '{{client_name}}'),
    row('Account number', '{{account_number}}'),
    row('Our case reference', '{{case_number}}'),
    row('Position as at', '{{position_as_at}}'),
    row(cell([t('Total outstanding balance', { bold: true })]), cell([t('{{balance}}', { bold: true })])),
  ] },
  p([t('Interest accrues on the overdue amount at 2% per month, the maximum rate for incidental '
    + 'credit agreements under the National Credit Act, and will not exceed the limits set by '
    + 'Section 103(5) of the Act.', { size: 9 })]),

  h(2, 'What you may do — your rights under Section 129(1)(a)', { numbered: true }),
  p('The National Credit Act entitles you to refer this agreement to any of the bodies below, so '
    + 'that the parties may resolve any dispute or agree a plan to bring the payments up to date, '
    + 'at no cost to you.'),
  { kind: 'table', borders: 'rows', widths: [34, 66], rows: [
    row(cell([t('Debt counsellor', { bold: true })]),
      'Registered with the National Credit Regulator. 0860 627 627 · www.ncr.org.za'),
    row(cell([t('Ombud with jurisdiction', { bold: true })]),
      'National Financial Ombud Scheme South Africa, credit division. 0860 800 900 · www.nfosa.co.za'),
    row(cell([t('ADR agent or consumer court', { bold: true })]),
      'An alternative dispute resolution agent accredited in terms of the Act, your province’s '
      + 'consumer court, or the National Consumer Tribunal.'),
  ] },
  p('If you intend to make such a referral you must do so within 10 (ten) business days of the '
    + 'date this notice is delivered to you.'),

  h(2, 'You may also deal with us directly', { numbered: true }),
  p('You do not have to make a referral. You may resolve this matter with us on any of the '
    + 'following bases:'),
  { kind: 'list', ordered: false, items: [
    [t('Settle the account. ', { bold: true }), t('Payment of {{balance}} settles the account in '
      + 'full. A settlement figure to your intended date of payment is available on request.')],
    [t('Propose a payment arrangement. ', { bold: true }), t('Tell us in writing what you can '
      + 'afford and when, with proof of income for the last three months and a breakdown of your '
      + 'expenses.')],
    [t('Dispute the debt. ', { bold: true }), t('If the amount is wrong, or you are not liable, '
      + 'tell us in writing with your reasons and supporting documents. We will give you a '
      + 'written finding.')],
  ] },
  p('You may also bring the agreement up to date. At any time before the creditor has cancelled '
    + 'the agreement you may reinstate it by paying all amounts that are overdue, together with '
    + 'the creditor’s permitted default charges and the reasonable costs of enforcement to '
    + 'the date of payment.'),

  h(2, 'What happens if you do not respond', { numbered: true }),
  p([t('WHAT FOLLOWS IF WE DO NOT HEAR FROM YOU', { bold: true })]),
  p('Once you have not responded within 10 (ten) business days of delivery, and have been in '
    + 'default for at least 20 (twenty) business days, the creditor may approach a court in terms '
    + 'of Section 130 to enforce the agreement. That may result in:'),
  { kind: 'table', borders: 'all', widths: [30, 70], rows: [
    row(cell([t('Credit bureau listing', { bold: true })]),
      'Your default is reported to the registered credit bureaus, where every credit provider who '
      + 'assesses you can see it.'),
    row(cell([t('Summons', { bold: true })]), 'Issued and served on you at your home or your place of work.'),
    row(cell([t('Judgment', { bold: true })]),
      'Granted against you for the full {{balance}}, plus interest, and recorded against your name.'),
    row(cell([t('Your possessions', { bold: true })]),
      'A warrant of execution allows the sheriff to attach and sell your movable or immovable property.'),
    row(cell([t('Your salary', { bold: true })]),
      'An emoluments attachment order requires your employer to deduct before you are paid.'),
    row(cell([t('Legal costs', { bold: true })]),
      'Reasonable legal and collection costs are added to what you already owe.'),
  ] },
  p('You can avoid all of this. Contact {{collector_name}} on {{collector_phone}} or '
    + '{{collector_email}} before {{respond_by}}, quoting reference {{case_number}}. We would '
    + 'rather agree something workable with you than litigate.'),

  ...howToPay(),
  ...signOff('We intend to settle this matter amicably and appreciate your cooperation in doing the same.'),
])

writeFileSync(new URL('./s129.json', import.meta.url), JSON.stringify(s129))
console.log('section 129:', s129.blocks.length, 'blocks')
