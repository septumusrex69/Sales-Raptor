import { CLIENT_FLAGS, CLIENT_POSITIONS, positionReport } from '../../lib/clientPosition.ts'
import { clientLine } from '../../lib/accountNarrative.ts'
import type { DiaryKind } from '../../lib/diaryPriority.ts'
import { CALL_OUTCOMES, type CallOutcome } from '../../lib/callOutcome.ts'

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
export function ClientLinePreview({ account, next, chosen, promise, className = '' }: {
  account: {
    status: string
    subStatus: string | null
    clientActionAsk: string | null
  }
  /**
   * What the agent has just said happened, before any of it is saved.
   *
   * WITHOUT THIS THE PREVIEW LIED BY OMISSION. It read the account's STORED status, which is
   * still whatever it was before the call — so a clerk who had just recorded a refusal watched
   * the box tell them the client would be shown "We worked the account on 16 September", which
   * is the firm's own example of a sentence that says nothing while sounding like something.
   */
  chosen?: CallOutcome | null
  /** The promise on the account, so an arrangement reads its date off the record. */
  promise?: { amount: number; dueOn: string } | null
  /**
   * The entry being booked right now — kind and date. The preview follows both, because the
   * KIND is what turns "we will follow up on the 22nd" into "we will confirm the promised
   * payment on 30 September".
   */
  next: { kind: DiaryKind; dueOn: string } | null
  className?: string
}) {
  const meta = chosen ? CALL_OUTCOMES[chosen] : null
  const report = positionReport({
    status: account.status,
    subStatus: meta ? meta.subStatus : account.subStatus,
    openQueryWithClient: account.clientActionAsk !== null,
  })
  const flag = CLIENT_FLAGS[report.flag]
  const today = new Date().toISOString().slice(0, 10)
  const line = clientLine({
    /* Today, because this box only opens when somebody is working the account. */
    lastAttemptOn: today,
    /*
     * `reached` comes off the answer rather than being left unset. Unset means "something was
     * logged and nobody recorded what came of it", which is honest for the imported book and
     * wrong here — the person filling this in has just told us whether they got hold of anybody.
     */
    reached: meta ? meta.reached : undefined,
    position: meta ? meta.position : undefined,
    /* An arrangement reads its date off the promise record, never off anybody's typing. */
    promise: meta?.position === 'arranged' && promise
      ? { amount: promise.amount, dueOn: promise.dueOn, status: 'open', takenOn: today }
      : undefined,
    disputeRaisedOn: meta?.position === 'disputed' ? today : undefined,
    traceLodgedOn: meta?.position === 'tracing' ? today : undefined,
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
