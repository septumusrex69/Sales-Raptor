/**
 * ONE CLIENT'S PAYOVERS, EACH SAID IN THE WORDS OF WHERE IT HAS GOT TO.
 *
 * THE FIRM, 8 Oct, looking at the Trust ledger: "which clients were paid what ... for which payover
 * runs ... where do we see that? ... in the client section ... it needs to be stored somewhere the
 * payover documentation ... the PDFs." The answer is on the client record, beside the running
 * statement: every run for this client, what it came to, how far it has got, and the copies that
 * were actually sent.
 *
 * A RUN'S STATUS IS NOT ITS ANSWER. "Paid" covers a run somebody marked paid by hand and a run whose
 * line has turned up on the bank statement, and only the second is proof. So the step after paid is
 * the statement, and a hand-marked run says it is still waiting for it -- the same distinction
 * Payments to make draws, in the same words.
 *
 * Pure: no Supabase, so a check can import it.
 */
export interface ClientPayover {
  id: string
  invoiceNumber: string
  status: 'needs_review' | 'ready' | 'approved' | 'sent' | 'paid' | 'void'
  periodStart: string
  periodEnd: string
  netPayover: number
  paidAt: string | null
  eftReference: string | null
  /** The day its line is on the bank statement; null until it is. */
  statementDate: string | null
}

export type PayoverStage = { label: string; tone: 'wait' | 'todo' | 'done' | 'off' }

export function payoverStage(r: ClientPayover): PayoverStage {
  switch (r.status) {
    case 'needs_review': return { label: 'Being checked', tone: 'wait' }
    case 'ready': return { label: 'Waiting for approval', tone: 'wait' }
    case 'approved': return { label: 'Approved, advice not sent', tone: 'todo' }
    case 'sent': return { label: 'Advice sent, not paid yet', tone: 'todo' }
    case 'void': return { label: 'Cancelled', tone: 'off' }
    case 'paid':
      return r.statementDate
        ? { label: `Paid, on the statement ${dayLabel(r.statementDate)}`, tone: 'done' }
        : { label: 'Paid, waiting for the statement', tone: 'todo' }
  }
}

/** Only what was paid out counts as paid: approved and sent are still owed to the client. */
export function payoverTotals(rows: ClientPayover[]): { paid: number; owed: number } {
  let paid = 0; let owed = 0
  for (const r of rows) {
    if (r.status === 'paid') paid += r.netPayover
    else if (r.status === 'approved' || r.status === 'sent') owed += r.netPayover
  }
  return { paid: round2(paid), owed: round2(owed) }
}

function round2(n: number): number { return Math.round(n * 100) / 100 }
function dayLabel(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${d} ${MONTHS[m - 1]} ${y}`
}
