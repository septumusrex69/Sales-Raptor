/**
 * A PAYMENT'S THREE DATES (S19, Raptor H18; Stephan, 7 Nov: "I think it's important to have the paid, captured, and
 * processed data for the payments. I think it doesn't need to be in your face ... accessible, but it doesn't have
 * to be in your face").
 *
 * They are three different facts and each decides something different (HANDOFF, "Payment dates", 5 Nov):
 *   PAID       received_at   -- the day the money left the debtor: the bank's date for a receipt, the typed date for a
 *                               PTC. Interest and the balance run to this day.
 *   CAPTURED   created_at    -- the day it went into Raptor: an import, a placement out of suspense, somebody typing
 *                               it. Stored since the start and shown nowhere until now.
 *   PROCESSED  allocated_on  -- the day it was approved into the books, which is the day the payover run takes it
 *                               from. approved_at where an older row has no allocated_on.
 * Commission and the collections figures still count by PAID; whether they should count by captured is an open
 * question for the firm, and showing the dates does not answer it.
 *
 * Every date is the JOHANNESBURG day (firmDay): 00:00 on 3 Jul is stored as 22:00 on the 2nd.
 */
import { firmDay } from './dateLabels.ts'

export interface PaymentDateRow {
  received_at: string | null
  created_at: string | null
  allocated_on: string | null
  approved_at: string | null
  paid_to_client?: boolean | null
}

export interface PaymentDate {
  label: 'Paid' | 'Captured' | 'Processed'
  /** YYYY-MM-DD, or null where it has not happened (a payment still waiting for approval). */
  day: string | null
  note: string
}

export function paymentDates(r: PaymentDateRow): PaymentDate[] {
  const processed = r.allocated_on ?? (r.approved_at ? firmDay(r.approved_at) : null)
  return [
    {
      label: 'Paid',
      day: r.received_at ? firmDay(r.received_at) : null,
      note: r.paid_to_client ? 'The day the debtor paid the client, off the confirmation' : 'The day the money reached the bank',
    },
    { label: 'Captured', day: r.created_at ? firmDay(r.created_at) : null, note: 'The day it went into Raptor' },
    {
      label: 'Processed',
      day: processed,
      note: processed ? 'Approved into the books; the payover run takes it from this day' : 'Waiting for approval',
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
