import { useEffect, useState } from 'react'
import { HandCoins, Loader2 } from 'lucide-react'
import { fetchMyRecoveryCall, recoveryReopen } from '../../lib/campaignApi'

/**
 * "IF A GUY MAKES A PTP, HE CAN KEEP THE ACCOUNT" (the firm, 22 Oct).
 *
 * On a CLOSED account where the signed-in person holds an open call from a running RECOVERY
 * campaign, and nowhere else. One press re-opens the account and puts it on their desk
 * (recovery_reopen, which refuses anybody without that call) -- and then the promise is taken the
 * ordinary way, on the ordinary form, which a closed account does not offer.
 *
 * ASKED TWICE, ON PURPOSE. Re-opening moves an account between books and onto a desk; it must be
 * the collector's own decision that the debtor agreed, not a stray tap, so the first press only
 * asks and the second does it. Nothing re-opens an account automatically: "otherwise, the account
 * just stays where it was."
 */
export function RecoveryReopen({ accountId, book, userId, onReopened }: {
  accountId: string
  book: string | null
  userId: string | null
  onReopened: () => void | Promise<void>
}) {
  const [call, setCall] = useState<Awaited<ReturnType<typeof fetchMyRecoveryCall>>>(null)
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (book !== 'closed' || !userId) { setCall(null); return }
    let live = true
    fetchMyRecoveryCall(accountId, userId).then((c) => { if (live) setCall(c) }).catch(() => { if (live) setCall(null) })
    return () => { live = false }
  }, [accountId, book, userId])

  if (done) {
    return (
      <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-[13px] text-emerald-800" data-testid="recovery-reopened">
        Re-opened and on your desk. Take the promise now, on Promise to pay.
      </p>
    )
  }
  if (!call || !call.running || book !== 'closed') return null

  async function reopen() {
    setBusy(true); setError(null)
    try {
      await recoveryReopen(accountId)
      setDone(true)
      await onReopened()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }

  return (
    <div className="rounded-xl border border-gold-500 bg-gold-50 px-4 py-2.5" data-testid="recovery-reopen">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex-1 min-w-0 text-[13px] text-navy-950">
          <span className="font-medium">Recovery call</span> · {call.campaignName}. The account is closed and stays that way
          unless the debtor agrees to pay.
        </p>
        {!asking ? (
          <button type="button" onClick={() => setAsking(true)} data-testid="recovery-reopen-go"
            className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg bg-navy-950 text-white hover:bg-navy-900">
            <HandCoins size={14} /> Debtor agreed to pay — re-open and keep it
          </button>
        ) : (
          <span className="flex items-center gap-2">
            <button type="button" onClick={() => void reopen()} disabled={busy} data-testid="recovery-reopen-confirm"
              className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg bg-gold-400 border border-gold-500 text-navy-950 disabled:opacity-50">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <HandCoins size={14} />} Yes, re-open it onto my desk
            </button>
            <button type="button" onClick={() => setAsking(false)} disabled={busy} className="text-sm text-slate-600 px-2">Cancel</button>
          </span>
        )}
      </div>
      {asking && (
        <p className="mt-1.5 text-[12px] text-slate-600">
          This takes the account off the closed book, puts it on your desk, and records what it was closed as. Then take
          the promise as on any account.
        </p>
      )}
      {error && <p className="mt-1.5 text-[12px] text-negative-700">{error}</p>}
    </div>
  )
}
