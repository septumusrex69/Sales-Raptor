import { CLIENT_FLAGS, CLIENT_POSITIONS, positionReport } from '../../lib/clientPosition.ts'
import { clientLine } from '../../lib/accountNarrative.ts'
import type { DiaryKind } from '../../lib/diaryPriority.ts'

/**
 * What the client will read, shown at the moment the next date is booked.
 *
 * ASKED FOR DIRECTLY: "the moment a diary date is set for the next time an account should be
 * worked, the clerk should confirm what the client will see."
 *
 * It is the best possible place for it. The agent has just done the work, knows what happened,
 * and is choosing the date that becomes the last clause of the sentence — so the preview moves
 * as they move the date, and a line that would read "No contact attempted" is in front of the
 * one person who can still do something about it.
 *
 * Not a second place to edit anything. It is a mirror of the records, and the way to change it
 * is to change them — take the promise, log the call, pick a nearer date.
 */
export function ClientLinePreview({ account, next, className = '' }: {
  account: {
    status: string
    subStatus: string | null
    clientActionAsk: string | null
  }
  /**
   * The entry being booked right now — kind and date. The preview follows both, because the
   * KIND is what turns "we will follow up on the 22nd" into "we will confirm the promised
   * payment on 30 September".
   */
  next: { kind: DiaryKind; dueOn: string } | null
  className?: string
}) {
  const report = positionReport({
    status: account.status,
    subStatus: account.subStatus,
    openQueryWithClient: account.clientActionAsk !== null,
  })
  const flag = CLIENT_FLAGS[report.flag]
  const line = clientLine({
    /*
     * Today, because this box only opens when somebody is working the account. `reached` is left
     * unset on purpose: nothing here records whether the debtor actually answered, and claiming
     * "no reply" would put a statement about the DEBTOR in a client report when the gap is ours.
     */
    lastAttemptOn: new Date().toISOString().slice(0, 10),
    next,
  })

  return (
    <div className={`rounded-lg bg-slate-50 px-3 py-2.5 ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          What the client will see
        </span>
        <span className={`text-[11px] font-medium ${
          report.flag === 'client_action' ? 'text-[var(--c-rust-deep)]' : 'text-slate-400'}`}>
          {flag.dot} {flag.label}
        </span>
      </div>
      <p className="text-xs font-medium text-slate-700 mt-1">{CLIENT_POSITIONS[report.position].label}</p>
      <p className="text-sm text-slate-600">{line.happened}</p>
      {/* The commitment, on its own line. Run into the sentence above it stops being read. */}
      {line.next && <p className="text-sm font-medium text-slate-700 mt-0.5">{line.next}</p>}
      {account.clientActionAsk && (
        <p className="text-[11px] text-[var(--c-rust-deep)] mt-1">{account.clientActionAsk}</p>
      )}
    </div>
  )
}
