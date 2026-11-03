import { useEffect, useState } from 'react'
import { Card, CardHeader } from '../ui/Card'
import { useAuth } from '../../store/AuthContext'
import { proposalProblem, proposalSummary } from '../../lib/debtorArrangement'
import { acceptProposal, declineProposal, fetchPendingProposal, type DebtorProposal } from '../../lib/debtorProposals'
import { chargeMessage } from '../../lib/chargeEngine'
import { PROMISE_ITEM_ID } from '../../lib/promiseRules'
import { clockToday } from '../../lib/clock'

/**
 * THE DEBTOR'S OFFER, WAITING FOR A DECISION (Raptor H16, debtor portal part 3). Drawn only while one is pending, at
 * the top of the account's side column, because an offer is a debtor reaching out -- the answer should not wait for a
 * collector to scroll. Accept is recordPromise (see debtorProposals.ts); Decline needs a reason the debtor will read.
 *
 * The offer is shown against the portal's own rules as they stand TODAY -- the balance may have moved since it was
 * made -- and a breach is said, not enforced: a collector may accept what the page would not let the debtor ask for.
 */
export function DebtorProposalCard({ accountId, balance, settlement, onDecided }: {
  accountId: string
  balance: number | undefined
  settlement: number | undefined
  onDecided: () => void
}) {
  const { currentUser, session } = useAuth()
  const [p, setP] = useState<DebtorProposal | null>(null)
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    fetchPendingProposal(accountId).then((r) => { if (live) setP(r) }).catch(() => { /* no card, rather than a broken one */ })
    return () => { live = false }
  }, [accountId])

  if (done) return <Card><p className="text-sm text-emerald-700" data-testid="debtor-proposal-done">{done}</p></Card>
  if (!p) return null
  const actor = { id: currentUser?.id ?? null, name: currentUser?.name ?? null }
  const money = { balance: balance ?? 0, settlement: settlement ?? balance ?? 0 }
  const outside = balance === undefined ? null : proposalProblem(p, money, clockToday())

  async function accept() {
    setBusy(true); setError(null)
    try {
      const charge = await acceptProposal(p!, accountId, actor, session?.access_token ?? null)
      setDone(['Accepted. The promise is recorded and the debtor will get the confirmation. No arrangement fee: the debtor offered it themselves.',
        charge ? chargeMessage(charge, PROMISE_ITEM_ID) : ''].filter(Boolean).join(' '))
      onDecided()
    } catch (x) { setError(x instanceof Error ? x.message : String(x)) } finally { setBusy(false) }
  }
  async function decline() {
    setBusy(true); setError(null)
    try {
      await declineProposal(p!, accountId, reason, actor)
      setDone('Declined. The debtor will see your reason on their page and can offer again.')
      onDecided()
    } catch (x) { setError(x instanceof Error ? x.message : String(x)) } finally { setBusy(false) }
  }

  return (
    <div data-testid="debtor-proposal"><Card className="border-amber-300">
      <CardHeader title={p.needsAssessment ? 'The debtor applied for an arrangement' : 'The debtor offered an arrangement'} subtitle={`On the debtor portal, ${new Date(p.createdAt).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', timeZone: 'Africa/Johannesburg' })}. Nothing is agreed until you accept.`} />
      <p className="mt-3 text-sm font-medium text-slate-800">{proposalSummary(p, money.settlement)}.</p>
      {p.note && <p className="mt-1 text-sm text-slate-600">“{p.note}”</p>}
      {outside && <p className="mt-2 text-sm text-amber-700">Outside the portal’s rules today: {outside}</p>}
      {p.needsAssessment && (
        <p className="mt-2 text-sm text-slate-700" data-testid="debtor-proposal-assessment">
          Longer than 12 months, so it is an application with the affordability assessment:{' '}
          {p.assessmentState === 'signed'
            ? <a href={`/sign/${p.assessmentToken}`} target="_blank" rel="noreferrer" className="font-medium text-gold-700 underline">signed — read it</a>
            : p.assessmentState
              ? <span className="text-amber-700">waiting for the debtor to fill it in and sign.</span>
              : <span className="text-amber-700">it could not be made for them — send it from Sign a document on this account.</span>}
        </p>
      )}
      {!declining ? (
        <div className="mt-3 flex gap-2">
          <button type="button" disabled={busy || (p.needsAssessment && p.assessmentState !== 'signed')} onClick={accept}
            title={p.needsAssessment && p.assessmentState !== 'signed' ? 'Accept once the affordability assessment is signed' : undefined}
            className="rounded-lg bg-navy-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">Accept</button>
          <button type="button" disabled={busy} onClick={() => setDeclining(true)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700">Decline…</button>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} aria-label="Why it is declined"
            placeholder="Why, in words the debtor will read (e.g. the instalment needs to be at least R 600)"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <div className="flex gap-2">
            <button type="button" disabled={busy || !reason.trim()} onClick={decline} className="rounded-lg bg-navy-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">Decline the offer</button>
            <button type="button" disabled={busy} onClick={() => setDeclining(false)} className="text-sm text-slate-600 underline">Back</button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </Card></div>
  )
}
