/**
 * THE PAYMENT ARRANGEMENT A DEBTOR CONFIRMS AND ACCEPTS (S9, 19 Oct).
 *
 * THE FIRM: "once a promise has been made and it's been captured on the system ... it gives him an
 * easy way to sign it ... they should just click here to confirm and accept." And of what it is:
 * "it's not going to be an acknowledgement of debt. It's a signed document in terms of 4B."
 *
 * SO IT SAYS WHAT WAS AGREED AND NOTHING MORE: who, which account (our case number, as every notice
 * leads with), the balance on the day, the instalment, how often, the first payment, and what
 * accepting means. No acknowledgement-of-debt wording, no section 57 or 58 -- an undertaking under
 * those is a different document with its own fee (item 4(a)), and the firm chose this one.
 *
 * BUILT FROM THE SAME MERGE VALUES THE EMAIL IS, so the page the debtor accepts and the email that
 * brought them to it cannot quote two figures. The words of acceptance are appended by the
 * database when they accept (signing_accept), so the filed copy carries who and when.
 *
 * PURE, and `.js` specifiers: the workflow step on the server builds it.
 */
import type { Block, Span } from './letterDocument.js'

export const ARRANGEMENT_TITLE = 'Payment arrangement'

/**
 * WHAT ACCEPTING IT COSTS: item 4(b), "original documents signed by the debtor", R250 (the firm,
 * 19 Oct: "it's a signed document in terms of 4B ... Document signed. 250"). Raised once, when it is
 * accepted, by the signed-copy route.
 */
export const DOCUMENT_SIGNED_ITEM = '4b'
export const DOCUMENT_SIGNED_ACTION = 'document_signed'

/** The merge values it reads, as accountMergeValues formats them. A missing one is left out. */
export interface ArrangementValues {
  today?: string | null
  debtor_name?: string | null
  case_number?: string | null
  client_name?: string | null
  balance?: string | null
  ptp_amount?: string | null
  ptp_frequency?: string | null
  ptp_date?: string | null
  firm_name?: string | null
}

const p = (spans: Span[], after = 3): Block => ({ kind: 'paragraph', spans, spacing: { after } })
const t = (text: string, bold = false): Span => (bold ? { text, bold } : { text })

/**
 * The document, or null where the arrangement cannot be stated -- no instalment or no first date is
 * an arrangement nobody can accept, and a page with blanks in it is not one to charge R250 for.
 */
export function arrangementDocument(v: ArrangementValues): Block[] | null {
  if (!v.ptp_amount || !v.ptp_date) return null
  const firm = v.firm_name || 'Bredell Ferreira'
  const row = (label: string, value: string | null | undefined) =>
    value ? [{ spans: [t(label)] }, { spans: [t(value, true)] }] : null
  const rows = [
    row('Account', v.case_number),
    row('On behalf of', v.client_name),
    row('Balance outstanding', v.balance),
    row('Instalment', v.ptp_amount),
    row('How often', v.ptp_frequency),
    row('First payment', v.ptp_date),
  ].filter((r): r is NonNullable<typeof r> => !!r)
  return [
    { kind: 'heading', level: 1, spans: [t(ARRANGEMENT_TITLE)] },
    ...(v.today ? [p([t(v.today)])] : []),
    ...(v.debtor_name ? [p([t(v.debtor_name, true)])] : []),
    p([t(`Thank you for making this payment arrangement with ${firm}. These are the terms we agreed:`)], 4),
    { kind: 'table', rows, widths: [40, 60], borders: 'rows', keepTogether: true, spacing: { after: 5 } },
    p([t('By confirming and accepting this arrangement you agree to pay the instalment above on time, '
      + 'every time, until the balance is paid. If a payment is missed the arrangement lapses and the '
      + 'full balance becomes payable.')]),
    p([t('Interest and the fees allowed by law continue to apply to the balance until it is paid. '
      + 'Accepting this arrangement is recorded on your account as a signed document.')]),
  ]
}
