import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import clsx from 'clsx'
import { Card } from '../../components/ui/Card'
import { rand } from '../../lib/money'
import {
  fetchTrustPosition, fetchUnreconciledPayouts,
  type TrustPosition, type UnreconciledPayout,
} from '../../lib/trust'

/**
 * IS THE TRUST ACCOUNT RIGHT?
 *
 * The one question nothing in Raptor answered. Everything behind this screen -- the creditors
 * ledger, the debtors inside it, the reconciliation against the bank -- has been in the database
 * for several prompts and had no face at all; the firm, correctly: "I'm not particularly happy
 * with how things are going... with how things look in the current trust management thing."
 *
 * IT OPENS ON THE DIFFERENCE, NOT ON A TOTAL. Cash against what is owed, and the gap between them
 * is the headline whether or not it is zero. A trust screen whose arithmetic can only ever come
 * out at nil is worth nothing: the whole reason to reconcile is the day it does not, and the
 * firm's own trust account is short right now -- a payment out with no run behind it, and a bank
 * charge that belongs to no creditor.
 *
 * AND IT EXPLAINS THE DIFFERENCE RATHER THAN REPORTING IT. A red number with no rows under it
 * tells somebody they have a problem and nothing about where to start. `unreconciled_payouts`
 * already knows which debits are unmatched, so they are named here with the action each one
 * needs -- a payout gets matched to its run, a bank charge gets funded from the business account,
 * and those are different jobs that a single "investigate" would flatten.
 *
 * A NEGATIVE PARTY BALANCE OWES THE TRUST. The four rows are the four people whose money can be
 * in there, and a client can be on the wrong side of it: a PTC -- the debtor paid the client
 * direct -- leaves the client owing the firm's fees back to the trust. That is `owedByClients`,
 * and showing it as a smaller creditor balance instead would hide a receivable inside a payable.
 */

export function TrustOverview() {
  const [position, setPosition] = useState<TrustPosition | null>(null)
  const [payouts, setPayouts] = useState<UnreconciledPayout[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    Promise.all([fetchTrustPosition(), fetchUnreconciledPayouts()])
      .then(([p, u]) => { if (live) { setPosition(p); setPayouts(u) } })
      .catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-slate-400 text-sm py-10">
        <Loader2 size={16} className="animate-spin" /> Reading the trust account…
      </div>
    )
  }

  if (error) {
    return (
      <Card className="p-5 text-sm text-negative-700 bg-negative-50 border-negative-100">
        The trust account could not be read: {error}
      </Card>
    )
  }

  /*
   * NO ROW MEANS NOT ALLOWED, NOT EMPTY. trust_position() carries its guard in a `where` clause,
   * so it returns nothing rather than raising. Drawing zeroes here would tell somebody who may not
   * see the trust account that it is empty -- a claim about the firm's money, where a refusal is
   * the truth.
   */
  if (!position) {
    return (
      <Card className="p-5 text-sm text-slate-500">
        The trust account is not yours to see. Ask an administrator if you need it.
      </Card>
    )
  }

  const short = position.difference < 0

  return (
    <div className="space-y-5">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-xl font-semibold tracking-tight text-slate-800">Trust overview</h1>
        <span className="text-xs text-slate-400">
          Money the firm holds for other people, as at today
        </span>
      </div>

      {/* Cash, what is owed, and the gap. The gap is the point of the panel. */}
      <div className="rounded-xl bg-navy-950 text-white px-6 py-5 flex flex-wrap items-end gap-10">
        <Figure label="In the bank" value={rand(position.trustCash)} />
        <Figure label="Owed out of it" value={rand(position.netOwed)} />
        <Figure
          label="Difference"
          value={rand(position.difference)}
          small
          tone={position.difference === 0 ? 'text-positive-100' : 'text-negative-300'}
        />
      </div>

      {position.difference !== 0 && (
        <Card className={clsx('p-4 border', short
          ? 'bg-negative-50 border-negative-100'
          : 'bg-gold-50 border-gold-100')}>
          <div className={clsx('text-sm font-semibold', short ? 'text-negative-700' : 'text-gold-800')}>
            {short
              ? `The bank holds ${rand(Math.abs(position.difference))} less than Raptor says is owed.`
              : `The bank holds ${rand(position.difference)} more than Raptor says is owed.`}
          </div>
          <div className="text-[13px] text-slate-500 mt-1">
            {short
              ? 'Money has left the trust account that nothing accounts for.'
              : 'Something has been received that nobody is yet recorded as being owed.'}
          </div>
          {payouts.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {payouts.map((p) => (
                <div key={p.id}
                  className="bg-white border border-negative-100 rounded-lg px-3 py-2
                    flex items-baseline gap-3 text-[13px]">
                  <span className="font-semibold text-negative-700 tabular-nums">
                    {rand(Math.abs(p.amount))}
                  </span>
                  <span className="text-slate-500">{p.description || 'No description'}</span>
                  {/*
                    THE CANDIDATE IS A SUGGESTION, AND THE WORD MATTERS. The function matches a
                    debit to a run by amount and date, which is a guess that happens to be right
                    most of the time; a screen that said "matched" would have somebody pressing
                    past it without looking.
                  */}
                  <Link to="/trust/payover" className="font-medium text-gold-700 hover:text-gold-800">
                    {p.candidateRun ? `Match to ${p.candidateInvoice ?? 'the run'}` : 'Find its run'}
                  </Link>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      <div className="flex flex-wrap gap-5 items-start">
        <div className="flex-[999_1_28rem] min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
            Whose money is in there
          </div>
          <Card className="overflow-hidden p-0">
            <Party who="Clients" tone="bg-brand-500"
              note="Capital recovered less commission, until the payover is paid"
              amount={position.owedToClients} />
            <Party who="Debtors" tone="bg-gold-600"
              note="Overpaid their account, awaiting a decision"
              amount={position.owedToDebtors} />
            <Party who="Bredell Ferreira" tone="bg-positive"
              note="Fees, interest and commission earned, not yet drawn"
              amount={position.owedToFirm} />
            <Party who="Not yet identified" tone="bg-slate-400"
              note="Receipts on the statement nobody has placed"
              amount={position.unidentified} />
            <div className="flex items-center gap-4 px-5 py-4 border-t border-slate-100 bg-slate-50">
              <div className="flex-1 text-[12.5px] font-bold uppercase tracking-wide text-slate-600">
                Net owed out of trust
              </div>
              <div className="text-lg font-semibold tabular-nums">{rand(position.netOwed)}</div>
            </div>
          </Card>
          <p className="mt-3 text-[12.5px] text-slate-500 leading-relaxed">
            A client nets across their whole book, because that is how they are paid — one payover
            run for the company. A debtor nets per account: two files of the same person are two
            debts.
          </p>
        </div>

        <div className="flex-[1_1_20rem] min-w-0 space-y-4">
          {position.owedByClients > 0 && (
            /*
              THE OTHER DIRECTION, AND IT ONLY DRAWS WHEN THERE IS ONE. A trust debtor is unusual
              enough that a permanent card reading R 0.00 would be noise; absent is the honest
              resting state, and the firm's own instruction about warnings is that one which fires
              when nothing is wrong is worse than none.
            */
            <Card className="p-5">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                Owed back to the trust
              </div>
              <div className="text-2xl font-semibold tabular-nums text-gold-800">
                {rand(position.owedByClients)}
              </div>
              <p className="text-[12.5px] text-slate-500 mt-2 leading-relaxed">
                A debtor paid the client direct, so the firm's fees on that money are owed back.
                It comes off the client's next payover.
              </p>
            </Card>
          )}

          <Card className="p-5 bg-navy-950 text-white border-navy-950">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
              Yours to draw
            </div>
            <div className="text-2xl font-semibold tabular-nums">{rand(position.owedToFirm)}</div>
            <p className="text-[12.5px] text-slate-400 mt-2 leading-relaxed">
              Fees, interest and commission already earned, sitting in trust until they are moved
              to the business account.
            </p>
            {/*
              NOT A BUTTON YET, AND SAYING SO. `draw_from_trust` exists and refuses an overdrawing,
              but the screen that decides the amount and records the reference is the business
              side's, which is not built. A control here that opened nothing would be worse than
              the sentence.
            */}
            <p className="text-[12px] text-slate-500 mt-3 pt-3 border-t border-white/10">
              Drawing it is done from the business account, which is still being built.
            </p>
          </Card>
        </div>
      </div>
    </div>
  )
}

function Figure({ label, value, small, tone }: {
  label: string; value: string; small?: boolean; tone?: string
}) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
        {label}
      </div>
      <div className={clsx(
        'font-medium tabular-nums leading-none',
        small ? 'text-2xl' : 'text-3xl',
        tone,
      )}>
        {value}
      </div>
    </div>
  )
}

function Party({ who, note, amount, tone }: {
  who: string; note: string; amount: number; tone: string
}) {
  return (
    <div className="flex items-center gap-4 px-5 py-4 border-b border-slate-100 last:border-b-0">
      <div className={clsx('w-[3px] h-8 rounded-sm shrink-0', tone)} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-slate-800">{who}</div>
        <div className="text-[12.5px] text-slate-500 mt-0.5">{note}</div>
      </div>
      <div className="text-[17px] font-medium tabular-nums">{rand(amount)}</div>
    </div>
  )
}
