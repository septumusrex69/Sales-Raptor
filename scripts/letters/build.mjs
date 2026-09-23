import { writeFileSync, readFileSync } from 'node:fs'
import {
  t, p, h, cell, row, headerStrip, addressee, howToPay, signOff, whereItStands, paidSoFar,
} from './blocks.mjs'

const DEFAULTS = { font: '"Charter", "Bitstream Charter", Georgia, serif', size: 10.5, colour: '#1f2937', lineHeight: 1.45 }
const doc = (blocks) => ({ defaults: DEFAULTS, blocks })

/** The account's own figures, on every notice. `middle` is what the third timeline row says. */
const standing = (interest) => ([
  paidSoFar(),
  { kind: 'table', borders: 'rows', widths: [40, 60], rows: [
    row('Creditor', '{{client_name}}'),
    row('Account number', '{{account_number}}'),
    row('Our case reference', '{{case_number}}'),
    row('Position as at', '{{position_as_at}}'),
    row(cell([t('Total outstanding balance', { bold: true })]), cell([t('{{balance}}', { bold: true })])),
  ] },
  p([t(interest, { size: 9 })]),
])

const INTEREST_NCA = 'Interest accrues on the overdue amount at 2% per month, the maximum rate for '
  + 'incidental credit agreements under the National Credit Act, and will not exceed the limits '
  + 'set by Section 103(5) of the Act.'
const INTEREST_GROWS = 'Interest accrues on the overdue amount at 2% per month until the account '
  + 'is paid in full, so the amount owing grows every month this remains unresolved.'

const out = {}

/* ------------------------------------------------- letter of demand (company), day 1 */
out['letter-demand-company'] = doc([
  headerStrip(), ...addressee('company'),
  h(1, 'LETTER OF DEMAND — FINAL NOTICE BEFORE LIQUIDATION PROCEEDINGS, AND NOTICE OF THE '
    + 'PERSONAL LIABILITY OF DIRECTORS AND SURETIES'),
  p('Dear Sirs / Madams — we act on behalf of {{client_name}}, the creditor, and are duly '
    + 'authorised to issue this demand. It is addressed to the company and to each of its '
    + 'directors. This is a formal legal demand. Please read all of it.'),
  h(2, 'The debt', { numbered: true }),
  p('The company is indebted to the creditor as set out below, and the amount is due and payable in full.'),
  whereItStands('This notice issued'),
  ...standing('Interest accrues on the overdue amount at 2% per month, as provided for in the '
    + 'agreement, until the account is paid in full.'),
  h(2, 'Demand', { numbered: true }),
  p('We demand payment of {{balance}} by {{respond_by}}. A company that keeps incurring debts it '
    + 'has no reasonable prospect of paying may be carrying on business recklessly, which Section '
    + '22 of the Companies Act 71 of 2008 prohibits. The directors should consider the company’s '
    + 'position with that in mind.'),
  h(2, 'How the company may deal with us', { numbered: true }),
  { kind: 'list', ordered: false, items: [
    [t('Settle the account. ', { bold: true }), t('Payment of {{balance}} settles the account in '
      + 'full. A settlement figure to the intended date of payment is available on request.')],
    [t('Propose a payment arrangement. ', { bold: true }), t('Send it in writing with amounts and '
      + 'dates, together with the company’s latest management accounts or bank statements. '
      + 'Nothing is agreed until we confirm it in writing.')],
    [t('Dispute the debt. ', { bold: true }), t('If there is any dispute regarding this matter, '
      + 'tell us in writing with the grounds and supporting documents. We will investigate and '
      + 'give a written finding.')],
  ] },
  p([t('Sureties. ', { bold: true }), t('Where any person has signed as surety and co-principal '
    + 'debtor for the company’s obligations, this demand is also directed at that person, and '
    + 'the creditor may proceed against every surety personally.')]),
  p('Where the National Credit Act applies to the agreement, this is also a notice in terms of '
    + 'Section 129(1)(a) of that Act, and the company may refer the agreement to an ADR agent, an '
    + 'ombud with jurisdiction or a consumer court within 10 (ten) business days of delivery.'),
  h(2, 'What happens if the company does not respond', { numbered: true }),
  p([t('WHAT FOLLOWS IF WE DO NOT HEAR FROM THE COMPANY', { bold: true })]),
  p('If the company has not paid by {{respond_by}}, our client’s attorneys will be instructed '
    + 'to take the following steps:'),
  { kind: 'table', borders: 'all', widths: [30, 70], rows: [
    row(cell([t('Credit bureau listing', { bold: true })]),
      'Reported to the registered credit bureaus against the company’s registration number, '
      + 'where suppliers and lenders who assess the company can see it.'),
    row(cell([t('Statutory demand', { bold: true })]),
      'Our client’s attorneys serve a demand on the company in terms of Section 345 of the '
      + 'Companies Act 61 of 1973. If it is not paid within three weeks, the company is deemed '
      + 'unable to pay its debts.'),
    row(cell([t('Liquidation', { bold: true })]),
      'An application is brought in the High Court for the company to be wound up. Control of the '
      + 'company and its assets passes from the directors to a liquidator.'),
    row(cell([t('Directors held liable', { bold: true })]),
      'An application is brought under Section 424 of that Act for an order declaring every '
      + 'director who allowed the company to trade recklessly personally liable for its debts.'),
    row(cell([t('Sureties sued', { bold: true })]),
      'Every person who signed as surety is sued in their personal capacity, and their personal '
      + 'assets may be attached and sold.'),
    row(cell([t('Legal costs', { bold: true })]),
      'Reasonable legal and collection costs are claimed and added to what is owed.'),
  ] },
  p('The company can still avoid this. Pay, or contact {{collector_name}} on {{collector_phone}} '
    + 'or {{collector_email}} with a written proposal, before {{respond_by}}, quoting reference '
    + '{{case_number}}.'),
  ...howToPay(),
  ...signOff('We would prefer to resolve this matter without an application to court, and '
    + 'appreciate the company’s cooperation in doing so.'),
])

/* ------------------------------------------------- final notice, day 12 */
const finalNotice = (who) => doc([
  headerStrip(), ...addressee(who),
  h(1, 'FINAL NOTICE BEFORE CREDIT BUREAU LISTING AND LEGAL ACTION'),
  p(who === 'individual'
    ? 'Dear {{debtor_name}} — we act on behalf of {{client_name}}, the creditor. We sent you a '
      + 'notice in terms of Section 129(1)(a) of the National Credit Act, and a reminder. The '
      + 'period for responding has ended, and we have received no payment, no payment arrangement '
      + 'and no dispute from you.'
    : 'Dear Sirs / Madams — we act on behalf of {{client_name}}, the creditor. We sent the company '
      + 'a letter of demand, and a reminder. The date for payment has passed, and we have received '
      + 'no payment, no written proposal and no dispute from the company.'),
  h(2, 'Where the account stands', { numbered: true }),
  whereItStands('This notice issued'),
  ...standing(INTEREST_GROWS),
  h(2, 'What happens in 20 business days', { numbered: true }),
  p([t('UNLESS THE ACCOUNT IS PAID OR AN ARRANGEMENT IS AGREED', { bold: true })]),
  p('If we have not heard ' + (who === 'individual' ? 'from you' : 'from the company')
    + ' by {{respond_by}}, 20 business days from the date of this notice, the following will follow.'),
  { kind: 'table', borders: 'all', widths: [30, 70], rows: who === 'individual' ? [
    row(cell([t('Credit bureau listing', { bold: true })]),
      'Your default is reported to the registered credit bureaus and appears on your credit '
      + 'profile, where every credit provider who assesses you can see it.'),
    row(cell([t('Legal action', { bold: true })]),
      'One of our attorneys proceeds with legal action against you to enforce the agreement.'),
    row(cell([t('Summons and judgment', { bold: true })]),
      'Summons is issued and served on you, and judgment may be granted against you for the full '
      + '{{balance}}, plus interest.'),
    row(cell([t('Enforcement', { bold: true })]),
      'A warrant of execution allows the sheriff to attach and sell your movable or immovable '
      + 'property, or an attachment order is granted against your salary.'),
    row(cell([t('Legal costs', { bold: true })]),
      'Reasonable legal and collection costs are added to what you already owe.'),
  ] : [
    row(cell([t('Credit bureau listing', { bold: true })]),
      'The company’s default is reported to the registered credit bureaus against its '
      + 'registration number, where suppliers, lenders and landlords who assess it can see it.'),
    row(cell([t('Statutory demand', { bold: true })]),
      'Our attorneys serve a demand in terms of Section 345 of the Companies Act 61 of 1973. If '
      + 'it is not met within three weeks, the company is deemed unable to pay its debts.'),
    row(cell([t('Liquidation', { bold: true })]),
      'An application is brought in the High Court to wind the company up, and control of its '
      + 'assets passes to a liquidator.'),
    row(cell([t('Directors held liable', { bold: true })]),
      'An order is sought declaring every director who allowed the company to trade recklessly '
      + 'personally liable for its debts.'),
    row(cell([t('Sureties sued', { bold: true })]),
      'Every person who signed as surety is sued in their personal capacity.'),
    row(cell([t('Legal costs', { bold: true })]),
      'Reasonable legal and collection costs are added to what is owed.'),
  ] },
  h(2, 'What this means', { numbered: true }),
  { kind: 'list', ordered: false, items: who === 'individual' ? [
    [t('The amount you owe grows. ', { bold: true }), t('Once the matter is in court, the legal '
      + 'costs, the sheriff’s fees and the interest are added to the {{balance}} you owe '
      + 'today. What you end up paying is substantially more than the amount in this notice.')],
    [t('A judgment goes onto your name. ', { bold: true }), t('It is granted for the full balance '
      + 'plus those costs, and it stays on record and can be enforced for many years.')],
    [t('The listing follows you. ', { bold: true }), t('It appears on your credit profile, where '
      + 'every credit provider who assesses you can see it, and it makes it harder to get a loan, '
      + 'a credit account, a vehicle or a home loan.')],
    [t('Paying later does not erase the listing. ', { bold: true }), t('The record is updated to '
      + 'show the account was settled, but it remains on your profile for the period the credit '
      + 'bureau rules allow.')],
  ] : [
    [t('What is owed grows. ', { bold: true }), t('Once the matter is in court, the legal costs '
      + 'and the interest are added to the {{balance}} owing today.')],
    [t('The listing follows the company. ', { bold: true }), t('It affects the company’s '
      + 'ability to obtain credit terms, finance and leases.')],
    [t('The directors are exposed personally. ', { bold: true }), t('An order under Section 424 '
      + 'makes a director who allowed reckless trading liable for the company’s debts.')],
    [t('Every surety is exposed personally. ', { bold: true }), t('Their own assets may be '
      + 'attached and sold.')],
  ] },
  h(2, 'How to stop this', { numbered: true }),
  { kind: 'list', ordered: false, items: [
    [t('Pay in full. ', { bold: true }), t('Payment of {{balance}} settles the account and stops '
      + 'every step above.')],
    [t('Arrange payment. ', { bold: true }), t('Contact {{collector_name}} and agree an amount and '
      + 'date. Once confirmed in writing, the listing and the handover are put on hold for as long '
      + 'as it is kept to.')],
    [t('Dispute the debt. ', { bold: true }), t('If there is any dispute regarding this matter '
      + 'that has not yet been raised with us, tell us in writing now, with the reasons.')],
  ] },
  ...howToPay(),
  ...signOff('This is the last step before the file leaves our office. We would still rather '
    + 'agree something workable.'),
])
out['letter-final-notice-individual'] = finalNotice('individual')
out['letter-final-notice-company'] = finalNotice('company')

/* ------------------------------------------------- listing notice, day 39 */
const listing = (who) => doc([
  headerStrip(), ...addressee(who),
  h(1, who === 'individual'
    ? 'NOTICE OF CREDIT BUREAU LISTING, AND OF THE PREPARATION OF YOUR FILE FOR LEGAL ACTION'
    : 'NOTICE OF CREDIT BUREAU LISTING, AND OF THE PREPARATION OF THE FILE FOR LEGAL ACTION'),
  p((who === 'individual' ? 'Dear {{debtor_name}}' : 'Dear Sirs / Madams')
    + ' — we act on behalf of {{client_name}}, the creditor. Our final notice gave '
    + (who === 'individual' ? 'you' : 'the company')
    + ' 20 business days to pay the account or agree an arrangement. That period has ended without '
    + 'a payment, an arrangement or a dispute, and the default has now been reported to the credit '
    + 'bureaus.'),
  h(2, 'The listing', { numbered: true }),
  p([t('THE DEFAULT HAS BEEN REPORTED TO THE CREDIT BUREAUS', { bold: true })]),
  p('This is the record of what was submitted, and the reference to quote if it is queried with a bureau.'),
  { kind: 'table', borders: 'rows', widths: [36, 64], rows: [
    row(cell([t('DATE LISTED', { bold: true })]), '{{listing_date}}'),
    row(cell([t('BUREAUS', { bold: true })]), '{{bureaus_listed}}'),
    row(cell([t(who === 'individual' ? 'IDENTITY NUMBER' : 'REGISTRATION NUMBER', { bold: true })]),
      who === 'individual' ? '{{debtor_id_masked}}' : '{{debtor_reg_no}}'),
    row(cell([t('AMOUNT LISTED', { bold: true })]), '{{balance}}'),
    row(cell([t('LISTING REFERENCE', { bold: true })]), '{{listing_reference}}'),
  ] },
  p(who === 'individual'
    ? 'The listing appears on your credit profile, where every credit provider who assesses you '
      + 'can see it. It remains there for the period the credit bureau rules allow. If you believe '
      + 'it is wrong, you may dispute it with us or directly with the bureau, quoting the listing '
      + 'reference above. A bureau must investigate a disputed record.'
    : 'The listing appears against the company’s registration number, where suppliers, lenders '
      + 'and landlords who assess it can see it. If the company believes it is wrong, it may '
      + 'dispute it with us or directly with the bureau, quoting the listing reference above. A '
      + 'bureau must investigate a disputed record.'),
  h(2, 'The file is being prepared for legal action', { numbered: true }),
  p(who === 'individual'
    ? 'Your file is now being prepared for one of our attorneys to proceed against you to enforce '
      + 'the agreement. Once summons is issued, the legal costs and the sheriff’s fees are '
      + 'added to the {{balance}} you owe today, a judgment may be granted against your name, and '
      + 'it may be enforced by attachment of your property or of your salary.'
    : 'The file is now being prepared for one of our attorneys to proceed against the company, '
      + 'beginning with a demand in terms of Section 345 of the Companies Act, followed by an '
      + 'application to wind the company up, an application to hold directors who allowed reckless '
      + 'trading personally liable, and action against every surety personally.'),
  h(2, 'It is still cheaper to settle now', { numbered: true }),
  { kind: 'list', ordered: false, items: [
    [t('Pay in full. ', { bold: true }), t('Payment of {{balance}} settles the account and stops '
      + 'the legal steps. The record at the bureaus is then updated to show the account as settled.')],
    [t('Arrange payment. ', { bold: true }), t('Speak to {{collector_name}} and agree an amount and '
      + 'date. Once confirmed in writing, the file is held for as long as it is kept to.')],
    [t('Dispute it. ', { bold: true }), t('If there is any dispute regarding this matter, tell us '
      + 'in writing with the reasons, and we will investigate and give a written finding.')],
  ] },
  p([t('Settling does not remove the listing, but it does stop the costs growing and shows every '
    + 'future credit provider that the account was paid.', { size: 9 })]),
  ...howToPay(),
  ...signOff('Even at this stage we would rather agree something workable than litigate.'),
])
out['letter-listing-individual'] = listing('individual')
out['letter-listing-company'] = listing('company')

/* ------------------------------------------------- intended summons, day 49 */
const summons = (who) => doc([
  headerStrip(), ...addressee(who),
  h(1, who === 'individual'
    ? 'NOTICE OF INTENDED SUMMONS — YOUR FILE HAS BEEN HANDED TO OUR ATTORNEYS'
    : 'NOTICE OF INTENDED LEGAL PROCEEDINGS — THE FILE HAS BEEN HANDED TO OUR ATTORNEYS'),
  p((who === 'individual' ? 'Dear {{debtor_name}}' : 'Dear Sirs / Madams')
    + ' — we act on behalf of {{client_name}}, the creditor. Every step short of court has now '
    + 'been taken, and the file has been handed to one of our attorneys with instructions to '
    + (who === 'individual' ? 'issue summons.' : 'proceed against the company, its directors and its sureties.')),
  h(2, 'Where this matter stands', { numbered: true }),
  ...standing(INTEREST_GROWS),
  { kind: 'table', borders: 'rows', widths: [36, 64], rows: [
    row(cell([t('LISTED WITH THE BUREAUS', { bold: true })]), '{{listing_date}}'),
    row(cell([t('LISTING REFERENCE', { bold: true })]), '{{listing_reference}}'),
  ] },
  h(2, 'What the attorneys are instructed to do', { numbered: true }),
  { kind: 'table', borders: 'all', widths: [30, 70], rows: who === 'individual' ? [
    row(cell([t('Summons', { bold: true })]),
      'Issued and served on you by the sheriff at your home or your place of work.'),
    row(cell([t('Judgment', { bold: true })]),
      'May be granted for the full {{balance}}, plus interest, and recorded against your name.'),
    row(cell([t('Your possessions', { bold: true })]),
      'A warrant of execution allows the sheriff to attach and sell your movable or immovable property.'),
    row(cell([t('Your salary', { bold: true })]),
      'An emoluments attachment order requires your employer to deduct before you are paid.'),
    row(cell([t('Legal costs', { bold: true })]),
      'The attorney’s fees, the sheriff’s fees and the court costs are added to what you '
      + 'owe, and they are recoverable from you.'),
  ] : [
    row(cell([t('Statutory demand', { bold: true })]),
      'Served in terms of Section 345 of the Companies Act 61 of 1973. If it is not met within '
      + 'three weeks, the company is deemed unable to pay its debts.'),
    row(cell([t('Liquidation', { bold: true })]),
      'An application to the High Court to wind the company up. Control of its assets passes to a '
      + 'liquidator.'),
    row(cell([t('Directors held liable', { bold: true })]),
      'An order under Section 424 declaring every director who allowed reckless trading personally '
      + 'liable for the company’s debts.'),
    row(cell([t('Sureties sued', { bold: true })]),
      'Every surety is sued in their personal capacity and their personal assets may be attached.'),
    row(cell([t('Legal costs', { bold: true })]),
      'Added to what is owed and recoverable from the company.'),
  ] },
  h(2, 'There is still a short window', { numbered: true }),
  p(who === 'individual'
    ? 'If you pay {{balance}} into our trust account before summons is issued, the matter ends '
      + 'there, without court costs. If you cannot pay it all at once, call {{collector_name}} '
      + 'today on {{collector_phone}} and say what you can do. An arrangement confirmed in writing '
      + 'holds the file, but only if it is agreed before summons is issued.'
    : 'Payment of {{balance}} into our trust account, before the attorneys act, ends the matter '
      + 'without legal costs. Otherwise send {{collector_name}} a written proposal today on '
      + '{{collector_email}}, with amounts, dates and the company’s latest management '
      + 'accounts. An arrangement confirmed in writing holds the file, but only if it is agreed '
      + 'before proceedings begin.'),
  ...howToPay(),
  ...signOff('Even now we would rather resolve this than litigate.'),
])
out['letter-summons-individual'] = summons('individual')
out['letter-summons-company'] = summons('company')

/* The section 129 was built and verified first. */
out['letter-s129-individual'] = JSON.parse(readFileSync(new URL('./s129.json', import.meta.url), 'utf8'))

writeFileSync(new URL('./letters.json', import.meta.url), JSON.stringify(out, null, 1))
for (const [k, v] of Object.entries(out)) console.log(k.padEnd(34), v.blocks.length, 'blocks')
