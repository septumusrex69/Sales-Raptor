/**
 * THE REMITTANCE ADVICE AS A MODEL, BEFORE ANYTHING DRAWS IT.
 *
 * Separated from the PDF for the reason letterDocument is separated from letterPdf: everything
 * interesting here is a DECISION -- which lines appear, what a status is allowed to say, what the
 * three headline figures are -- and none of it is testable through a renderer. The drawing code
 * takes this and puts it on a page; the tests take this and check the arithmetic.
 *
 * IT IS A TAX INVOICE, so the header is not decoration. BF's name, address and VAT number, the
 * client's name and VAT number where we have one, the invoice number, the issue date and the VAT
 * amount all have to be on it, and `problems` says so out loud when one is missing rather than
 * printing a blank where a statutory field belongs.
 *
 * FOUR FIXES OVER THE REPORT IT REPLACES, each of them a thing the firm found in a FileFish
 * payover and had to explain to a client:
 *   - A line with R0.00 capital received is not printed at all. There were rows for payments that
 *     never reached capital, which read as "we collected nothing for you" beside a real payment.
 *   - "Paid in full" appears only where the capital outstanding is nought. FileFish printed it
 *     beside R5 635.80 still owing, because it was reading a stored status.
 *   - A payment RECEIVED before the period started carries a note saying it was captured after the
 *     previous cut-off. FileFish showed 27 December and 9 January payments in the 11 January run
 *     with no explanation, which reads like a mistake and is not one.
 *   - A reversal is a negative line and says what it is, rather than silently reducing a total.
 */
import type { RunPayment } from './payover'

export interface RemittanceFirm {
  name: string
  address: string | null
  phone: string | null
  email: string | null
  vatNumber: string | null
}

export interface RemittanceClient {
  name: string
  code: string | null
  vatNumber: string | null
}

export interface RemittanceRun {
  invoiceNumber: string
  periodStart: string
  periodEnd: string
  issuedOn: string
  trustCapital: number
  trustCommission: number
  dueToClient: number
  ptcReceived: number
  ptcFeesTaken: number
  ptcCapital: number
  ptcCommission: number
  dueToBf: number
  commissionVat: number
  carriedIn: number
  netPayover: number
  commissionRate: number | null
  paidAt: string | null
  eftReference: string | null
}

export interface CollectionRow {
  yourRef: string
  ourRef: string
  debtor: string
  status: string
  handedOver: string
  handoverAmount: number
  paid: string
  capitalReceived: number
  commission: number
  vat: number
  capitalOutstanding: number
  reversal: boolean
  lateCapture: boolean
}

export interface DirectRow {
  yourRef: string
  ourRef: string
  debtor: string
  paid: string
  receivedByYou: number
  annexureBFees: number
  capitalPortion: number
  commission: number
  dueToUs: number
  capitalOutstanding: number
  reversal: boolean
}

export interface RemittanceAdvice {
  firm: RemittanceFirm
  client: RemittanceClient
  run: RemittanceRun
  /** The three figures page one carries, in the order prompt 7 stacks them. */
  headline: {
    collectedByBf: number
    payments: number
    paidDirectly: number
    directNote: string | null
    net: number
    paidNote: string
  }
  /** "How we got there", one line each, the last being the net. */
  workings: { label: string; amount: number; emphasis?: boolean }[]
  collections: CollectionRow[]
  direct: DirectRow[]
  /** Anything a tax invoice needs and does not have. Reported, never silently blank. */
  problems: string[]
}

export const ANNEXURE_B_FOOTNOTE =
  'Annexure B fees are the fees and interest recovered from a payment made directly to you, in '
  + 'terms of the Debt Collectors Act regulations. They do not form part of the capital collected '
  + 'on the handover amount.'

/** "11 Nov 2024" — dates on a client document are written the way they are read aloud. */
export function advDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
}

/**
 * What a debtor's position is allowed to say on a client's statement.
 *
 * DERIVED, and the only phrase that can be earned rather than stored is "Paid in full". Everything
 * else falls back to the account's own words, cleaned of the internal prefix a client has no use
 * for: "Active: Unfrozen" is how a row got into the table, not a thing to print on an invoice.
 */
export function advStatus(row: Pick<RunPayment, 'paidInFull' | 'accountStatus'>): string {
  if (row.paidInFull) return 'Paid in full'
  const raw = (row.accountStatus ?? '').trim()
  if (!raw) return 'In progress'
  const after = (raw.includes(':') ? raw.slice(raw.indexOf(':') + 1).trim() : raw) || 'In progress'
  /*
   * AND THE STORED STATUS MAY NOT SAY IT EITHER. Dropping through to the account's own words was
   * most of the fix and not all of it: FileFish's "Paid in Full" beside R5 635.80 outstanding came
   * from a stored status, and a stored status can still hold those words. Where the capital is not
   * nought the phrase is refused whatever the column says -- which is the whole point of deriving
   * it. Caught by a break test that could not break, because the assertion asserted the bug.
   */
  return /paid\s*in\s*full/i.test(after) ? 'In progress' : after
}

export function buildRemittanceAdvice(input: {
  firm: RemittanceFirm
  client: RemittanceClient
  run: RemittanceRun
  lines: RunPayment[]
}): RemittanceAdvice {
  const { firm, client, run, lines } = input

  const problems: string[] = []
  if (!firm.vatNumber) problems.push('The firm has no VAT number on file, and a tax invoice must carry one.')
  if (!firm.address) problems.push('The firm has no address on file.')
  if (!client.vatNumber) problems.push(`${client.name} has no VAT number on file.`)
  if (!client.code) problems.push(`${client.name} has no client code, so the invoice number is provisional.`)

  /*
   * NEVER A LINE WITH NO CAPITAL ON IT. A payment whose half B was entirely consumed before it
   * reached capital gave the client a row saying R0.00, beside real ones -- which reads as "we
   * collected nothing for you" rather than "this payment went to costs you do not pay". The money
   * is still in the totals, where it belongs; it is the LINE that would mislead.
   */
  const collections: CollectionRow[] = lines
    .filter((l) => (l.lineKind === 'trust' || (l.lineKind === 'reversal' && !l.paidToClient)))
    .filter((l) => Math.abs(l.toCapital) > 0.004)
    .map((l) => ({
      yourRef: l.clientReference ?? '',
      ourRef: l.caseNumber ?? '',
      debtor: l.debtor,
      status: advStatus(l),
      handedOver: advDate(l.handoverDate),
      handoverAmount: l.capitalHandedOver,
      paid: advDate(l.receivedAt),
      capitalReceived: l.toCapital,
      commission: l.commission,
      vat: l.commissionVat,
      capitalOutstanding: l.capitalAfter,
      reversal: l.lineKind === 'reversal',
      lateCapture: l.lateCapture,
    }))

  const direct: DirectRow[] = lines
    .filter((l) => (l.lineKind === 'ptc' || (l.lineKind === 'reversal' && l.paidToClient)))
    .filter((l) => Math.abs(l.paymentAmount) > 0.004)
    .map((l) => ({
      yourRef: l.clientReference ?? '',
      ourRef: l.caseNumber ?? '',
      debtor: l.debtor,
      paid: advDate(l.receivedAt),
      receivedByYou: l.paymentAmount,
      /* ONLY WHAT THIS PAYMENT RECOVERED, never what the account still owes. The firm's own
         wording in prompt 4: do not show other fees still outstanding on the account. */
      annexureBFees: l.toInterest + l.toCosts,
      capitalPortion: l.toCapital,
      commission: l.commission,
      dueToUs: l.toInterest + l.toCosts + l.commission,
      capitalOutstanding: l.capitalAfter,
      reversal: l.lineKind === 'reversal',
    }))

  const paidNote = run.paidAt
    ? `Paid by EFT${run.eftReference ? ` ${run.eftReference}` : ''} on ${advDate(run.paidAt)}`
    : 'To be paid by EFT to your nominated account'

  const workings: { label: string; amount: number; emphasis?: boolean }[] = [
    { label: 'Capital collected on your behalf', amount: run.trustCapital },
    {
      label: run.commissionRate != null
        ? `Less our commission at ${fmtRate(run.commissionRate)}`
        : 'Less our commission',
      amount: -run.trustCommission,
    },
  ]
  if (run.dueToBf > 0) {
    workings.push({ label: 'Less our fees and commission on payments made to you directly', amount: -run.dueToBf })
  }
  workings.push({ label: 'Less VAT on commission', amount: -run.commissionVat })
  if (run.carriedIn !== 0) {
    workings.push({ label: 'Brought forward from your previous statement', amount: run.carriedIn })
  }
  workings.push({ label: 'Net amount we are paying you', amount: run.netPayover, emphasis: true })

  return {
    firm,
    client,
    run,
    headline: {
      collectedByBf: run.trustCapital,
      payments: collections.filter((c) => !c.reversal).length,
      paidDirectly: run.ptcReceived,
      directNote: run.ptcReceived > 0
        ? 'Our fees and commission on these are set off below'
        : null,
      net: run.netPayover,
      paidNote,
    },
    workings,
    collections,
    direct,
    problems,
  }
}

function fmtRate(fraction: number): string {
  const pct = fraction * 100
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2).replace(/\.?0+$/, '')}%`
}
