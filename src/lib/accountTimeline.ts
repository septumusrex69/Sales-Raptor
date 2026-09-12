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
import { feeLabel } from './feeLabel.ts'

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
  /**
   * Raptor wrote this, not a person.
   *
   * The split the firm asked for: "all of the actions, and then you can just hide the automated
   * actions ... so it only shows the writings, the comments, that type of important stuff."
   *
   * It is a fact recorded at the source, never guessed from the text. A fee line is automatic
   * because raising it is the machine's half of an action somebody else took; a note is automatic
   * when Raptor composed it ("Trace done — 4 credit bureau searches"), and is not when a person
   * typed the words. Payments, promises and a dispute's own history stay: money arriving and
   * decisions being taken are the story, not bookkeeping about it.
   */
  automated: boolean
}

const dayOf = (iso: string) => iso.slice(0, 10)

/**
 * Build the stream, newest first — and newest first WITHIN a day as well.
 *
 * This used to sort by day, then by a fixed rank per kind, and only then by time. The rank won
 * over the clock, so a dispute closed at 15:12 sat underneath a promise taken at 09:30 the same
 * morning: the days ran newest-first while the events inside each day ran oldest-first. The firm
 * put it plainly — "newest on top and then go down".
 *
 * The rank stays, demoted to a tiebreak, because most of the book genuinely has no time of day.
 * Every one of the 1,070 imported payments is stamped midnight, and so are 59,158 of the 59,215
 * fees: the export carried dates, not timestamps. Those rows are all exactly equal within their
 * day and something has to order them, or the timeline reshuffles itself between two loads. Money
 * still leads a day nobody recorded a time on. It no longer overrules a day where they did.
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
      title: feeLabel(f.description, f.segments),
      detail: f.cancelledAt ? 'Cancelled. The fee stands — it attaches to the action being issued.' : null,
      by: f.performedBy,
      amount: f.billed ? f.amountExclVat + f.vatAmount : null,
      free: !f.billed,
      actionCode: f.actionCode,
      // Always. A fee line is Raptor charging for something a person did; the doing is already
      // on the timeline as its own entry, written in words.
      automated: true,
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
      // Money arriving is the story, not bookkeeping about it.
      automated: false,
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
      /*
       * Read off the row, not guessed from the words.
       *
       *   system      Raptor composed it: "Trace done — 4 credit bureau searches."
       *   manual      somebody typed it into Raptor.
       *   swordfish   somebody typed it into the old system. Still a person's writing, and on
       *               this book it is most of it — 1,449 of the 1,523 notes we hold.
       *
       * An earlier sketch matched on the body's prefix instead. That works until a collector
       * writes "Trace done, nothing came back" in their own words and the app decides they are
       * a machine.
       */
      automated: n.source === 'system',
      /*
       * A note ABOUT something gets that something's icon.
       *
       * What a collector typed after a call is not a loose thought, it is the record of the
       * call, and showing it as a plain sticky beside every other note lost that. The kind is
       * set when the note is written, so nothing here has to read the words and guess.
       */
      actionCode: n.kind === 'call' ? 'phone_call' : null,
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
      // A promise is the single most important thing a collector produces. It never hides.
      automated: false,
    })
  }

  return entries.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1
    if (a.at !== b.at) return a.at < b.at ? 1 : -1
    if (a.kind !== b.kind) return RANK[a.kind] - RANK[b.kind]
    // Last resort, so two midnight fees of the same kind cannot swap places between loads.
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
  })
}

/**
 * What to show: everything, or only what a person put there.
 *
 * Filtering here rather than in the component so the count in "showing 10 of 431" is the count of
 * what you are actually looking at. A filter applied after the slice would page through hidden
 * rows and hand you a short page with no explanation.
 */
export function filterTimeline(entries: TimelineEntry[], showAutomated: boolean): TimelineEntry[] {
  return showAutomated ? entries : entries.filter((e) => !e.automated)
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
