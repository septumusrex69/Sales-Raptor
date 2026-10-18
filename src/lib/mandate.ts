/**
 * THE DEBT COLLECTION AGREEMENT (THE MANDATE), DRAWN BY RAPTOR AND SIGNED ONLINE (S8, 18 Oct).
 *
 * The firm: "when a lead has been added and ... the mandate needs to be sent ... it should happen from
 * the system ... with the commission percentage that should be filled in before we send the mandate
 * ... a sliding scale ... we can have a standard sliding scale ... but we should be able to change some
 * of the parameters ... it should be in our new letterhead ... individual or a company ... the form
 * that they need to fill in ... and the function should also be there to click and to sign."
 *
 * THE WORDING IS THE FIRM'S OWN TWO MANDATES (Individual / Companies, S25 with the scale and M25 flat),
 * with exactly the changes they agreed on 18 Oct and nothing else:
 *   - "Hereafter referred to as" (the PDFs read "Hereafter to as", with an empty name in the quotes);
 *   - clause 2: commission is on the CAPITAL COLLECTED, and the scale says what it applies to -- one
 *     rate per account, by the capital handed over on that account, the boundary rand in the lower
 *     band (the PDF's "R0 < R100,000 / R100,001 < R500,000" left a gap and said neither);
 *   - clause 4: paid "on or before the 15th" (the firm pays on the 11th; the 15th "buys time");
 *   - clause 8: a debtor who pays the client directly -- the client tells us and the commission stays
 *     due (Raptor already settles it off the next payover).
 * Settlements, termination and POPIA clauses were offered and declined ("If they don't want to hand
 * over, they don't hand over").
 *
 * BUILT IN CODE, NOT IN THE LIBRARY, for now: the sales side of the Library has no letters yet, and a
 * signed agreement's words should not be one stray edit away from changing. Pure, so a check can hold
 * the wording and the scale.
 */
import type { Block, LetterDocument, Span, TableCell } from './letterDocument.ts'
import { CHARTER_STACK } from './charter.ts'
import type { Blank } from './signingBlanks.ts'

export type MandateParty = 'individual' | 'company'

/** A band of the scale: the rate, a FRACTION, up to and including `upTo` rand; null is "and above". */
export interface MandateBand { upTo: number | null; rate: number }

export type MandateCommission = { kind: 'rate'; rate: number } | { kind: 'scale'; bands: MandateBand[] }

export interface MandateTerms {
  party: MandateParty
  /** The client's name as the firm has it; the signer confirms or corrects it on the form. */
  clientName: string
  commission: MandateCommission
}

/** THE FIRM'S STANDARD SLIDING SCALE (their S25 mandate): 25 / 20 / 15 / 10 at R100 000, R500 000, R1 000 000. */
export const STANDARD_SCALE: MandateBand[] = [
  { upTo: 100_000, rate: 0.25 },
  { upTo: 500_000, rate: 0.2 },
  { upTo: 1_000_000, rate: 0.15 },
  { upTo: null, rate: 0.1 },
]

/** The flat rate the firm's M25 mandate carries. */
export const STANDARD_RATE = 0.25

/**
 * WHAT IS WRONG WITH A SCALE, IN WORDS; empty when it can go out. Bands rise, every rate is a real
 * percentage, and the last band is "and above" -- or a debtor with a bigger account has no rate.
 */
export function scaleProblems(bands: MandateBand[]): string[] {
  const out: string[] = []
  if (bands.length < 2) out.push('A sliding scale needs at least two bands.')
  bands.forEach((b, i) => {
    if (!(b.rate > 0 && b.rate <= 1)) out.push(`Band ${i + 1} needs a rate between 0% and 100%.`)
    if (i < bands.length - 1) {
      if (b.upTo === null || !(b.upTo > 0)) out.push(`Band ${i + 1} needs an upper amount.`)
      else if (i > 0 && bands[i - 1].upTo !== null && b.upTo <= (bands[i - 1].upTo as number)) out.push(`Band ${i + 1} must start above band ${i}.`)
    }
  })
  if (bands.length && bands[bands.length - 1].upTo !== null) out.push('The last band must be "and above".')
  return out
}

export function commissionProblems(c: MandateCommission): string[] {
  if (c.kind === 'rate') return c.rate > 0 && c.rate <= 1 ? [] : ['The commission needs a rate between 0% and 100%.']
  return scaleProblems(c.bands)
}

/** 'R100 000' -- the firm's figures, with a non-breaking space so a PDF never breaks inside one. */
export function randWhole(v: number): string {
  return `R${Math.round(v).toLocaleString('en-ZA').replace(/[\s,]/g, ' ')}`
}
const randCents = (v: number): string => `R${Math.floor(v).toLocaleString('en-ZA').replace(/[\s,]/g, ' ')}.${String(Math.round((v - Math.floor(v)) * 100)).padStart(2, '0')}`
export const pct = (rate: number): string => `${Math.round(rate * 10000) / 100}%`

/**
 * EACH BAND IN WORDS, SO THERE IS NO GAP AND NO DOUBT ABOUT A BOUNDARY: "Up to and including R100 000",
 * "R100 000.01 to R500 000", "Above R1 000 000".
 */
export function bandLabels(bands: MandateBand[]): string[] {
  return bands.map((b, i) => {
    const from = i === 0 ? null : bands[i - 1].upTo
    if (b.upTo === null) return from === null ? 'Any amount' : `Above ${randWhole(from)}`
    if (from === null) return `Up to and including ${randWhole(b.upTo)}`
    return `${randCents(from + 0.01)} to ${randWhole(b.upTo)}`
  })
}

/** The commission as one line, for the email and the client record: "25%" or "Sliding scale 25% to 10%". */
export function commissionLine(c: MandateCommission): string {
  if (c.kind === 'rate') return pct(c.rate)
  const rates = c.bands.map((b) => b.rate)
  return `Sliding scale ${pct(Math.max(...rates))} to ${pct(Math.min(...rates))}`
}

/* ------------------------------------------------------------------ what the client fills in */

/**
 * THE FORM ON THE THIRD PAGE OF THE FIRM'S MANDATE, AS BOXES ON THE SIGNING PAGE: who they are (ID for
 * an individual, registration number for a company), how to reach them, where the money goes, and two
 * people to speak to. The signatory's name and designation sit with the signature.
 */
export function mandateBlanks(party: MandateParty): Blank[] {
  const b = (key: string, label: string, required = false, kind: Blank['kind'] = 'text'): Blank => ({ key, label, kind, required })
  return [
    b('mandate_client_name', party === 'company' ? 'Company name' : 'Your full name', true),
    party === 'company'
      ? b('mandate_reg_no', 'Company registration number', true)
      : b('mandate_id_no', 'Your ID number', true),
    b('mandate_vat_no', 'VAT number (if registered)'),
    b('mandate_tel', 'Telephone', true),
    b('mandate_email', 'Email address', true),
    b('mandate_address', 'Physical address', true, 'lines'),
    b('mandate_bank_name', 'Bank', true),
    b('mandate_bank_holder', 'Account holder name', true),
    b('mandate_bank_account', 'Account number', true),
    b('mandate_bank_branch', 'Branch code'),
    b('mandate_contact_one_name', 'Contact person 1: name', true),
    b('mandate_contact_one_tel', 'Contact person 1: telephone (cell or direct line)', true),
    b('mandate_contact_one_email', 'Contact person 1: email', true),
    b('mandate_contact_two_name', 'Contact person 2: name'),
    b('mandate_contact_two_tel', 'Contact person 2: telephone (cell or direct line)'),
    b('mandate_contact_two_email', 'Contact person 2: email'),
    b('mandate_signatory_name', 'Name of the person signing', true),
    b('mandate_signatory_designation', party === 'company' ? 'Designation (e.g. Director)' : 'Designation (optional)', party === 'company'),
  ]
}

/* ------------------------------------------------------------------ the document */

const t = (text: string, extra: Partial<Span> = {}): Span => ({ text, ...extra })
const p = (spans: Span[] | string, extra: Partial<Extract<Block, { kind: 'paragraph' }>> = {}): Block =>
  ({ kind: 'paragraph', spans: typeof spans === 'string' ? [t(spans)] : spans, align: 'justify', ...extra })
const centre = (spans: Span[] | string, extra: Partial<Extract<Block, { kind: 'paragraph' }>> = {}): Block =>
  ({ kind: 'paragraph', spans: typeof spans === 'string' ? [t(spans)] : spans, align: 'center', ...extra })
const cell = (text: string, extra: Partial<Span> = {}, align?: TableCell['align']): TableCell => ({ spans: [t(text, extra)], ...(align ? { align } : {}) })

/** THE AGREEMENT, as a letter document on the firm's letterhead, with the signer's answers as {{blanks}}. */
export function mandateDocument(terms: MandateTerms): LetterDocument {
  const c = terms.commission
  const clause2: Block[] = c.kind === 'rate'
    ? [p(`Our services are offered on a contingency basis: No collection, no fee. We are entitled to retain a contingency fee (commission) of ${pct(c.rate)} of the capital collected, on every handed-over amount or debt, as agreed between you and us, for all successful collections. Commission is exclusive of VAT.`)]
    : [
        p('Our services are offered on a contingency basis: No collection, no fee. We are entitled to retain a contingency fee (commission) of the capital collected, at the rate set out below, for all successful collections. The rate is fixed once for each account, by the capital handed over on that account. Commission is exclusive of VAT.'),
        {
          kind: 'table', headerRow: true, borders: 'rows', keepTogether: true, widths: [10, 60, 30], spacing: { before: 4, after: 6 },
          rows: [
            [cell('No', { bold: true }), cell('Capital handed over on the account', { bold: true }), cell('Commission', { bold: true }, 'right')],
            ...bandLabels(c.bands).map((label, i) => [cell(String(i + 1)), cell(label), cell(pct(c.bands[i].rate), {}, 'right')]),
          ],
        },
      ]

  const n = (no: number, body: Block[]): Block[] => {
    const [first, ...rest] = body
    const f = first as Extract<Block, { kind: 'paragraph' }>
    return [{ ...f, spans: [t(`${no}.  `, { bold: true }), ...f.spans] }, ...rest]
  }

  const blocks: Block[] = [
    centre([t('DEBT COLLECTION AGREEMENT', { bold: true, size: 14 })], { spacing: { after: 2 } }),
    centre('entered into between:', { spacing: { after: 6 } }),
    centre([t('The Debt Collector:', { bold: true })]),
    centre([t('Bredell Ferreira (Pty) Ltd', { bold: true })]),
    centre([t('(hereafter referred to as "the debt collector", "we", "our", "us")', { italic: true })], { spacing: { after: 6 } }),
    centre([t('AND', { bold: true })], { spacing: { after: 6 } }),
    centre([t(terms.party === 'company' ? 'The Client (Company):' : 'The Client (Individual):', { bold: true })]),
    centre([t('{{mandate_client_name}}', { bold: true })]),
    centre([t('(hereafter referred to as "the client", "you", "your")', { italic: true })], { spacing: { after: 8 } }),
    p([t('Terms and conditions:', { bold: true })], { spacing: { after: 4 } }),
    ...n(1, [p('We undertake to collect all debts handed over to us that are owed to you by your debtors. You hereby cede such debts to us for collection purposes only, including all associated rights of action and interest.')]),
    ...n(2, clause2),
    ...n(3, [p('We reserve the right to recover from the debtor(s) all fees & expenses and interest incurred. Any payments received will be allocated equally to: (a) the capital amount handed over, and (b) any fees & expenses and interest.')]),
    ...n(4, [p('We deposit outstanding debts and/or any amounts collected on your behalf into a compulsory and audited trust account governed by the Council for Debt Collectors. We will electronically transfer money due to you for debts we collected for the previous month, up until the 10th of every month, into your bank account on or before the 15th of the next month. If the 15th falls on a weekend or a public holiday, we will pay you on or before the next business day.')]),
    ...n(5, [p('We will provide you with a monthly detailed reconciliation and progress report, including all payments received and the balances of your debtors.')]),
    ...n(6, [p('Debts handed over for collection may not be withdrawn without the prior written consent of the debt collector. In the event of a withdrawal, the client shall remain liable for all collection commission, fees, legal costs and expenses incurred in respect of such account.')]),
    ...n(7, [p('You agree to cease all communication with handed-over debtors and allow us to manage all communication, as it may create confusion for the debtor if there are multiple channels of communication for the collection of a single debt. You also agree not to assign the same debt to any other third party while our mandate remains active. Any breach of these terms will result in the withdrawal of our services, and the withdrawal fees set out in clause 6 will become payable.')]),
    ...n(8, [p('Should a debtor contact you after handover, you agree to refer them directly to us. Should a debtor pay you directly after handover, you agree to inform us in writing within 7 (seven) days of receiving the payment. Our commission on that payment remains due to us and may be set off against the next amount we pay over to you.')]),
    ...n(9, [p('You grant us full authority to act on your behalf in relation to each handed-over debtor or debt. We may take all necessary legal steps in terms of applicable laws and at our sole discretion. We may engage the services of any third party to help us in the collection of any debts.')]),
    ...n(10, [p('We and you hereby agree to the terms and conditions of this debt collection agreement and that it will be effective from the date of signature hereof.')]),
    { kind: 'spacer', mm: 4 },
    {
      kind: 'table', borders: 'none', keepTogether: true, widths: [50, 50],
      rows: [
        /* No date line: the signature's own stamp says who signed and when (signedMark). */
        [cell('Name: {{mandate_signatory_name}}'), cell('Designation: {{mandate_signatory_designation}}')],
      ],
    },
    { kind: 'signature', signer: 'debtor', spans: [t('Signature, for and on behalf of the client')], spacing: { before: 4 } },
    { kind: 'pagebreak' },
    centre([t(terms.party === 'company' ? 'COMPANY INFORMATION' : 'INDIVIDUAL INFORMATION', { bold: true })], { spacing: { after: 4 } }),
    {
      kind: 'table', borders: 'rows', widths: [38, 62], keepTogether: true,
      rows: [
        [cell(terms.party === 'company' ? 'Company name' : 'Full name', { bold: true }), cell('{{mandate_client_name}}')],
        terms.party === 'company'
          ? [cell('Registration number', { bold: true }), cell('{{mandate_reg_no}}')]
          : [cell('ID number', { bold: true }), cell('{{mandate_id_no}}')],
        [cell('VAT number', { bold: true }), cell('{{mandate_vat_no}}')],
        [cell('Telephone', { bold: true }), cell('{{mandate_tel}}')],
        [cell('Email', { bold: true }), cell('{{mandate_email}}')],
        [cell('Physical address', { bold: true }), cell('{{mandate_address}}')],
      ],
    },
    centre([t('BANKING DETAILS', { bold: true })], { spacing: { before: 8, after: 4 } }),
    {
      kind: 'table', borders: 'rows', widths: [38, 62], keepTogether: true,
      rows: [
        [cell('Bank', { bold: true }), cell('{{mandate_bank_name}}')],
        [cell('Account holder name', { bold: true }), cell('{{mandate_bank_holder}}')],
        [cell('Account number', { bold: true }), cell('{{mandate_bank_account}}')],
        [cell('Branch code', { bold: true }), cell('{{mandate_bank_branch}}')],
      ],
    },
    centre([t('CONTACT PERSONS', { bold: true })], { spacing: { before: 8, after: 4 } }),
    {
      kind: 'table', borders: 'rows', widths: [10, 30, 60], keepTogether: true,
      rows: [
        [cell('1', { bold: true }), cell('Name'), cell('{{mandate_contact_one_name}}')],
        [cell(''), cell('Tel (cell or direct)'), cell('{{mandate_contact_one_tel}}')],
        [cell(''), cell('Email'), cell('{{mandate_contact_one_email}}')],
        [cell('2', { bold: true }), cell('Name'), cell('{{mandate_contact_two_name}}')],
        [cell(''), cell('Tel (cell or direct)'), cell('{{mandate_contact_two_tel}}')],
        [cell(''), cell('Email'), cell('{{mandate_contact_two_email}}')],
      ],
    },
  ]
  return { defaults: { font: CHARTER_STACK, size: 9.5, colour: '#1f2937', lineHeight: 1.4 }, blocks }
}
