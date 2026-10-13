/**
 * IS THE CLIENT KEEPING THEIR ARRANGEMENT? (S7)
 *
 * The firm, 12 Oct: "What if he makes an installment arrangement to pay with us?" An arrangement is a
 * schedule, not money -- so much a month from a day, for so many months (client_payment_arrangements).
 * Whether it is being kept is worked out here from the payments the client actually made into the
 * business account, never stored: a stored "behind" needs a job to keep it true, and a night that job
 * does not run is a night the screen lies.
 *
 * KEPT is measured against what was due BY TODAY, cumulatively: a client who paid two instalments in
 * one go in month one is not behind in month two. Only payments ON OR AFTER the arrangement was made
 * count -- what they paid before agreeing to it is what the arrangement was agreed on top of.
 *
 * Pure, so a check can hold it.
 */
export interface Arrangement {
  id: string
  instalment: number
  firstDue: string
  instalments: number
  createdAt: string
  note: string | null
}

export interface ClientReceipt { amount: number; receivedOn: string }

export interface ArrangementStatus {
  /** The due dates, one a month from the first, on the same day of the month (clamped to the month's end). */
  dueDates: string[]
  dueSoFar: number
  paidSince: number
  /** Positive is behind by that much; nil or less is up to date. */
  behind: number
  nextDue: string | null
  dueCount: number
  finished: boolean
}

const r2 = (v: number) => Math.round(v * 100) / 100

export function dueDates(firstDue: string, count: number): string[] {
  const [y, m, d] = firstDue.split('-').map(Number)
  const out: string[] = []
  for (let i = 0; i < count; i += 1) {
    const monthIndex = m - 1 + i
    /* The 31st in a 30-day month is the 30th, not the 1st of the next: Date.UTC would roll it over. */
    const last = new Date(Date.UTC(y, monthIndex + 1, 0)).getUTCDate()
    out.push(new Date(Date.UTC(y, monthIndex, Math.min(d, last))).toISOString().slice(0, 10))
  }
  return out
}

export function arrangementStatus(a: Arrangement, receipts: ClientReceipt[], today: string): ArrangementStatus {
  const dates = dueDates(a.firstDue, a.instalments)
  const dueCount = dates.filter((x) => x <= today).length
  const dueSoFar = r2(dueCount * a.instalment)
  const since = a.createdAt.slice(0, 10)
  const paidSince = r2(receipts.filter((p) => p.receivedOn >= since).reduce((t, p) => t + p.amount, 0))
  const total = r2(a.instalments * a.instalment)
  return {
    dueDates: dates, dueSoFar, paidSince, behind: r2(dueSoFar - paidSince),
    nextDue: dates.find((x) => x > today) ?? null, dueCount,
    finished: paidSince >= total,
  }
}
