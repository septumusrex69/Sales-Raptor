/**
 * One account's story, in one stream.
 *
 * A collector picking up an account needs to know what happened, not which table it happened in.
 * So the fee ledger (every letter, call, SMS and trace), the payment ledger, the notes and the
 * promises are merged here into a single chronological list.
 *
 * Interest accruals are deliberately left out. There are 29 to 56 of them on a typical migrated
 * account, they are computed rather than done, and they would bury the human events under a
 * monthly drumbeat nobody needs to read. Interest belongs on the Statement, which is the record
 * of money; this is the record of contact.
 */
import type { AccountLedgers } from './accountBook'
import type { AccountNote, PromiseToPay } from './accountWorkspace'

export type TimelineKind = 'action' | 'payment' | 'note' | 'promise' | 'query'

export interface TimelineEntry {
  id: string
  kind: TimelineKind
  /** ISO date (yyyy-mm-dd) the thing happened. */
  date: string
  /** Full timestamp where we have one, for ordering within a day. */
  at: string
  title: string
  detail?: string | null
  /** Who did it. Free text: imported history was made by people without Raptor logins. */
  by?: string | null
  amount?: number | null
  /** True where the event cost the debtor nothing — work past the Annexure B ceiling. */
  free?: boolean
  /** Set on promises, so the timeline can show kept/broken/overdue without re-deriving it. */
  status?: string | null
  /** Our closed action catalogue (src/lib/actionTariff.ts), so a call gets a phone and a letter
   *  gets an envelope. Null on imported rows whose legacy name never mapped. */
  actionCode?: string | null
}

const dayOf = (iso: string) => iso.slice(0, 10)

/**
 * Build the stream, newest first.
 *
 * Sorting is by DAY first, then by a fixed rank per kind, and only then by timestamp. Sorting on
 * the raw timestamp instead looks right and is not: fees and payments come from date columns and
 * carry no time, so '2026-08-05' sorts against '2026-08-05T09:12:00Z' as a shorter string and a
 * payment sinks below every note made that day. Money leads the day it arrived on.
 *
 * The fixed rank matters beyond that: a timeline that reshuffles itself between two loads is a
 * timeline nobody trusts.
 */
const RANK: Record<TimelineKind, number> = { payment: 0, promise: 1, query: 2, action: 3, note: 4 }

export function buildTimeline(
  ledgers: AccountLedgers | null,
  notes: AccountNote[] = [],
  promises: PromiseToPay[] = [],
): TimelineEntry[] {
  const entries: TimelineEntry[] = []

  for (const f of ledgers?.fees ?? []) {
    entries.push({
      id: `fee:${f.id}`,
      kind: 'action',
      date: dayOf(f.incurredAt),
      at: f.incurredAt,
      title: f.segments > 1 ? `${f.description} ×${f.segments}` : f.description,
      detail: f.cancelledAt ? 'Cancelled. The fee stands — it attaches to the action being issued.' : null,
      by: f.performedBy,
      amount: f.billed ? f.amountExclVat + f.vatAmount : null,
      free: !f.billed,
      actionCode: f.actionCode,
    })
  }

  for (const p of ledgers?.payments ?? []) {
    entries.push({
      id: `pay:${p.id}`,
      kind: 'payment',
      date: dayOf(p.receivedAt),
      at: p.receivedAt,
      title: p.reversedAt ? 'Payment reversed' : 'Payment received',
      detail: [p.method, p.reference, p.details, p.paidToClient ? 'Paid direct to client' : null]
        .filter(Boolean)
        .join(' · ') || null,
      amount: p.amount,
      status: p.reversedAt ? 'reversed' : null,
    })
  }

  for (const n of notes) {
    entries.push({
      id: `note:${n.id}`,
      // A query's own history is not an ordinary note: it belongs to a dispute, and a collector
      // scanning the timeline needs to see that at a glance rather than read for it.
      kind: n.kind === 'query' ? 'query' : 'note',
      date: dayOf(n.createdAt),
      at: n.createdAt,
      title: n.body,
      by: n.authorName,
    })
  }

  for (const p of promises) {
    entries.push({
      id: `promise:${p.id}`,
      kind: 'promise',
      date: dayOf(p.createdAt),
      at: p.createdAt,
      title: 'Promise to pay',
      detail: [`due ${p.dueOn}`, p.method, p.notes].filter(Boolean).join(' · '),
      amount: p.amount,
      status: p.status,
    })
  }

  return entries.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1
    if (a.kind !== b.kind) return RANK[a.kind] - RANK[b.kind]
    return a.at < b.at ? 1 : a.at > b.at ? -1 : 0
  })
}

/** Group into date headings, preserving the stream's order. */
export function groupByDay(entries: TimelineEntry[]): { date: string; entries: TimelineEntry[] }[] {
  const out: { date: string; entries: TimelineEntry[] }[] = []
  for (const e of entries) {
    const last = out[out.length - 1]
    if (last && last.date === e.date) last.entries.push(e)
    else out.push({ date: e.date, entries: [e] })
  }
  return out
}
