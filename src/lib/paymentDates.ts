/**
 * A PAYMENT'S THREE DATES (S19, Raptor H18; Stephan, 7 Nov: "I think it's important to have the paid, captured, and
 * processed data for the payments. I think it doesn't need to be in your face ... accessible, but it doesn't have
 * to be in your face").
 *
 * They are three different facts and each decides something different:
 *   PAID       received_at   -- the day the money left the debtor: the bank's date for a receipt, the typed date for a
 *                               PTC. Interest and the balance run to this day.
 *   CAPTURED   captured_on   -- the day it went into Raptor: an import, a placement out of suspense, somebody typing
 *                               it. captured_on since S20 (the staging clock's day); created_at on older rows.
 *   APPROVED   allocated_on  -- the day it was approved into the books. approved_at where an older row has none.
 *
 * WHICH ONE DECIDES THE PAYOVER CYCLE (S20, Raptor H19; Stephan, 8 Nov -- this replaced "the approval date decides"):
 * a trust receipt's BANK date ("if a payment reflects in the bank account on the 10th, it reflects on the 10th"), a
 * PTC's CAPTURE date ("even though it was made 2 months before"). The same day counts its collections and its
 * commission. payment_cycle_day() in the database is the one place it is decided; `cycleDay` here says which of the
 * three it is, so the panel can mark it. Approval is still what lets anything post; approved after its cycle's run
 * had gone, a payment rides the next open run as a LATE line.
 *
 * Every date is the JOHANNESBURG day (firmDay): 00:00 on 3 Jul is stored as 22:00 on the 2nd.
 */
import { firmDay } from './dateLabels.ts'

export interface PaymentDateRow {
  received_at: string | null
  created_at: string | null
  captured_on?: string | null
  allocated_on: string | null
  approved_at: string | null
  paid_to_client?: boolean | null
}

export interface PaymentDate {
  label: 'Paid' | 'Captured' | 'Approved'
  /** YYYY-MM-DD, or null where it has not happened (a payment still waiting for approval). */
  day: string | null
  note: string
  /** True on the one date that puts it in a payover cycle (and in a collections and commission period). */
  decidesCycle: boolean
}

/** The day that decides the payment's payover cycle -- the browser's copy of payment_cycle_day(). */
export function cycleDay(r: PaymentDateRow): string | null {
  if (r.paid_to_client) return r.captured_on ?? (r.created_at ? firmDay(r.created_at) : null)
  return r.received_at ? firmDay(r.received_at) : null
}

export function paymentDates(r: PaymentDateRow): PaymentDate[] {
  const approved = r.allocated_on ?? (r.approved_at ? firmDay(r.approved_at) : null)
  const ptc = !!r.paid_to_client
  return [
    {
      label: 'Paid',
      day: r.received_at ? firmDay(r.received_at) : null,
      note: ptc ? 'The day the debtor paid the client, off the confirmation'
        : 'The day the money reached the bank -- its payover cycle',
      decidesCycle: !ptc,
    },
    {
      label: 'Captured',
      day: r.captured_on ?? (r.created_at ? firmDay(r.created_at) : null),
      note: ptc ? 'The day it went into Raptor -- a PTC’s payover cycle' : 'The day it went into Raptor',
      decidesCycle: ptc,
    },
    {
      label: 'Approved',
      day: approved,
      note: approved ? 'Approved into the books; nothing posts before this' : 'Waiting for approval',
      decidesCycle: false,
    },
  ]
}

/** True where capturing came well after paying -- a late PTC, a receipt placed out of suspense. Worth a second look. */
export function capturedLate(dates: PaymentDate[], days = 7): boolean {
  const paid = dates.find((d) => d.label === 'Paid')?.day
  const captured = dates.find((d) => d.label === 'Captured')?.day
  if (!paid || !captured) return false
  return (Date.parse(`${captured}T00:00:00Z`) - Date.parse(`${paid}T00:00:00Z`)) / 86400000 > days
}

/**
 * A LATE LINE, IN THE FIRM'S WORDS (S20): "received 20 Sep 2026, approved 12 Nov 2026" -- for a PTC, captured rather
 * than received, since that is its cycle day. `fmt` is the caller's date formatter, so screen and PDF agree.
 */
export function lateLineNote(d: { paidToClient: boolean; receivedOn: string | null; capturedOn: string | null; approvedOn: string | null },
  fmt: (day: string) => string): string {
  const first = d.paidToClient
    ? (d.capturedOn ? `captured ${fmt(d.capturedOn)}` : null)
    : (d.receivedOn ? `received ${fmt(d.receivedOn)}` : null)
  const second = d.approvedOn ? `approved ${fmt(d.approvedOn)}` : null
  return ['Late', [first, second].filter(Boolean).join(', ')].filter(Boolean).join(': ')
}
