import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import clsx from 'clsx'
import { Modal, FormField, inputClass, controlClass } from '../ui/Modal'
import { rand } from '../../lib/money'
import {
  DISPOSALS, NOT_WORTH_REFUNDING, disposalAdvice, type ExcessDisposal,
} from '../../lib/excessCredit'
import { disposeExcessCredit, fetchMoveTargets } from '../../lib/excessCreditApi'
import type { OtherAccount } from '../../lib/sameDebtor'

/**
 * WHAT HAPPENS TO AN OVERPAYMENT.
 *
 * A debtor who pays more than they owe leaves a credit that is THEIRS. It holds the payover run
 * until somebody decides, which is deliberate: a run that went out with an undecided credit in it
 * would be an invoice the client already has, built on money that might have to come back.
 *
 * THE BOX SUGGESTS AND DOES NOT CHOOSE. Below R20 a refund costs the firm more in time than the
 * debtor gets back -- the firm's own arithmetic -- so parking leads, and the reason is on the
 * screen rather than implied by the ordering. Every option stays available at every amount, because
 * "too small to bother with" is a judgement about a particular debtor.
 *
 * A REASON IS ALWAYS REQUIRED. Each of these moves somebody's money or decides not to, and in six
 * months the only account of why will be the sentence typed here.
 */
export function DisposeExcessModal({ allocationId, accountId, debtor, caseNumber, amount, onClose, onDone }: {
  allocationId: string
  /** The account the money came in on, so its debtor's OTHER accounts can be offered for a move. */
  accountId: string
  debtor: string
  caseNumber: string | null
  amount: number
  onClose: () => void
  onDone: () => void
}) {
  const advice = disposalAdvice(amount)
  const [disposal, setDisposal] = useState<ExcessDisposal>(advice.suggest)
  const [reason, setReason] = useState('')
  const [payableTo, setPayableTo] = useState(debtor)
  const [moveTo, setMoveTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /* Null while reading; a failed read offers nothing rather than a box to type a key into. */
  const [targets, setTargets] = useState<OtherAccount[] | null>(null)

  useEffect(() => {
    let live = true
    fetchMoveTargets(accountId)
      .then((t) => { if (live) setTargets(t) })
      .catch(() => { if (live) setTargets([]) })
    return () => { live = false }
  }, [accountId])

  const chosen = DISPOSALS.find((d) => d.id === disposal)
  const missing = (chosen?.needs === 'payable_to' && payableTo.trim() === '')
    || (chosen?.needs === 'move_to' && moveTo.trim() === '')

  async function submit() {
    if (busy) return
    setBusy(true); setError(null)
    try {
      await disposeExcessCredit(allocationId, disposal, reason, {
        payableTo: chosen?.needs === 'payable_to' ? payableTo : undefined,
        moveTo: chosen?.needs === 'move_to' ? moveTo : undefined,
      })
      onDone()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`${rand(amount)} overpaid`}
      subtitle={`${debtor}${caseNumber ? ` · ${caseNumber}` : ''}. It is the debtor’s money until somebody says otherwise.`}
      width={560}
      onClose={onClose}
      footer={(
        <div className="flex items-center justify-between gap-3">
          <div className="text-[12.5px] text-negative-700">{error}</div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className={controlClass}>Cancel</button>
            <button
              type="button" onClick={submit} disabled={busy || reason.trim() === '' || missing}
              className="rounded-lg bg-navy-950 px-4 py-2 text-sm font-semibold text-white
                disabled:opacity-40"
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : 'Decide it'}
            </button>
          </div>
        </div>
      )}
    >
      <div className="space-y-4">
        {/* The arithmetic that makes a small refund a bad idea, said rather than implied. */}
        {amount < NOT_WORTH_REFUNDING && (
          <div className="rounded-lg bg-gold-50 px-4 py-3 text-[13px] leading-relaxed text-gold-800">
            {advice.because}
          </div>
        )}

        <div className="space-y-1.5">
          {DISPOSALS.map((d) => (
            <button
              key={d.id} type="button" onClick={() => setDisposal(d.id)}
              className={clsx('w-full text-left rounded-lg border px-3 py-2',
                disposal === d.id ? 'border-gold-500 bg-gold-50' : 'border-slate-200 hover:bg-slate-50')}
            >
              <div className="text-[13.5px] font-medium text-slate-800">{d.label}</div>
              <div className="text-[12px] text-slate-500 mt-0.5">{d.blurb}</div>
            </button>
          ))}
        </div>

        {chosen?.needs === 'payable_to' && (
          <FormField label="Payable to" required>
            <input className={inputClass} value={payableTo}
              onChange={(e) => setPayableTo(e.target.value)} />
          </FormField>
        )}

        {chosen?.needs === 'move_to' && (
          /* A LIST OF THE DEBTOR'S OTHER ACCOUNTS, never a box for a database key (the firm, 8 Oct:
             "I don't know how to fix anything ... there's no option"). */
          targets === null ? (
            <p className="text-[12.5px] text-slate-400">Looking for the debtor&rsquo;s other accounts…</p>
          ) : targets.length === 0 ? (
            <p className="text-[12.5px] text-negative-700" data-testid="no-move-target">
              This debtor has no other open account with us, so there is nowhere to move it.
            </p>
          ) : (
            <FormField label="The account it moves to" required>
              <select className={inputClass} value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
                <option value="">Choose one of their accounts…</option>
                {targets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {[t.reference ?? 'No reference', t.clientName, t.balance === null ? null : `owes ${rand(t.balance)}`]
                      .filter(Boolean).join(' · ')}
                  </option>
                ))}
              </select>
            </FormField>
          )
        )}

        <FormField label="Why" required>
          <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder={disposal === 'parked'
              ? 'Too small to be worth returning'
              : 'The debtor asked for it back'} />
        </FormField>

        {disposal === 'parked' && (
          <p className="text-[12.5px] text-slate-500 leading-relaxed">
            Nothing moves. The money stays the debtor&rsquo;s and the credit stops holding the
            payover run. It comes back on the parked list when its period has run, and only then
            can the firm take it.
          </p>
        )}
      </div>
    </Modal>
  )
}
