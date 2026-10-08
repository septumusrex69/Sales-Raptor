import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Loader2 } from 'lucide-react'
import clsx from 'clsx'
import { Card } from '../../components/ui/Card'
import { DisposeExcessModal } from '../../components/finance/DisposeExcessModal'
import { ParkedCredits } from '../../components/finance/ParkedCredits'
import { BankLinesToAllocate } from '../../components/finance/BankLinesToAllocate'
import { Modal, inputClass } from '../../components/ui/Modal'
import { supabase } from '../../lib/supabase'
import { rand, ratePercent } from '../../lib/money'
import { fetchExceptions, rebuildRun, reallocateAccount, type ExceptionJob } from '../../lib/payover'

/**
 * EVERY EXCEPTION, AS A JOB SOMEBODY DOES.
 *
 * The firm's shape from the board: the problem, whose it is, how much is affected, and ONE button.
 * The count here has to equal the count on the work queue's tile -- so both read the same function
 * rather than each counting their own way, which is how two screens end up disagreeing about how
 * much work is left.
 *
 * ONLY ONE OF THE THREE IS A BUTTON THAT FIXES ANYTHING, and that is deliberate. Setting a missing
 * commission rate is a fact somebody looks up and enters, so it is done here and the account is
 * replayed and its run rebuilt in the same press. An overpayment and a payment on a written-off
 * account are DECISIONS -- refund or reallocate, re-open or return -- and the firm's own rule is
 * that corrections are made case by case, never swept. Those open the account, where the person
 * making the decision can see everything it depends on.
 */

const KIND_TONE: Record<string, string> = {
  needs_rate: 'bg-amber-100 text-amber-800',
  excess_credit: 'bg-sky-100 text-sky-800',
  closed_account: 'bg-slate-200 text-slate-700',
}

const KIND_LABEL: Record<string, string> = {
  needs_rate: 'No commission rate',
  excess_credit: 'Overpaid',
  closed_account: 'Closed or written off',
}

export function FinanceExceptions() {
  const [jobs, setJobs] = useState<ExceptionJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rateFor, setRateFor] = useState<ExceptionJob | null>(null)
  const [disposing, setDisposing] = useState<ExceptionJob | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setJobs(await fetchExceptions()) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load the exceptions.') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  const grouped = ['needs_rate', 'excess_credit', 'closed_account']
    .map((k) => ({ kind: k, rows: jobs.filter((j) => j.kind === k) }))
    .filter((g) => g.rows.length > 0)

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-negative-50 px-4 py-3 text-sm text-negative-700">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /><span>{error}</span>
        </div>
      )}

      {loading && <div className="py-16 text-center text-slate-400"><Loader2 className="mx-auto w-5 h-5 animate-spin" /></div>}

      {!loading && jobs.length === 0 && (
        <Card><p className="py-8 text-center text-sm text-slate-400">
          Nothing is holding a payover up. Every allocation has a rate, no account is overpaid, and
          no money has landed on a closed file.
        </p></Card>
      )}

      {!loading && grouped.map((g) => (
        <Card key={g.kind} padded={false}>
          <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
            <span className={clsx('rounded-full px-2.5 py-1 text-[11.5px] font-semibold', KIND_TONE[g.kind])}>
              {KIND_LABEL[g.kind]}
            </span>
            <span className="text-xs text-slate-400">
              {g.rows.length} {g.rows.length === 1 ? 'account' : 'accounts'} ·{' '}
              {rand(g.rows.reduce((t, r) => t + (r.amount ?? 0), 0))}
            </span>
          </div>
          <div className="divide-y divide-slate-50">
            {g.rows.slice(0, 200).map((j, i) => (
              <div key={`${j.allocationId ?? j.accountId}-${i}`} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-slate-800">
                    {j.client} · {j.debtor}
                  </div>
                  <div className="text-xs text-slate-400">{j.caseNumber ?? ''} · {j.problem}</div>
                </div>
                <div className="tabular-nums text-sm text-slate-700">{j.amount === null ? '—' : rand(j.amount)}</div>
                {j.kind === 'needs_rate' ? (
                  <button type="button" onClick={() => setRateFor(j)}
                    className="rounded-lg bg-navy-900 px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-navy-800">
                    {j.action}
                  </button>
                ) : j.kind === 'excess_credit' && j.allocationId ? (
                  /*
                   * DECIDED HERE NOW, RATHER THAN ON THE ACCOUNT.
                   *
                   * It used to open the account, on the reasoning that an overpayment is a DECISION
                   * and the person making it should see everything it depends on. That held while
                   * the only answers were refund, move or release -- each of which is about the
                   * debtor. The fourth, parking, is about the FIRM's time, and the thing it
                   * depends on is the amount, which is already in this row. Opening a whole account
                   * to decide that R4.12 is not worth a telephone call is the long way round.
                   *
                   * The account is still one click away, under the debtor's name.
                   */
                  <button type="button" onClick={() => setDisposing(j)}
                    className="rounded-lg bg-navy-900 px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-navy-800">
                    Decide it
                  </button>
                ) : (
                  <Link to={`/accounts/${j.accountId}`}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-[12.5px] font-medium text-slate-700 hover:bg-slate-100">
                    {j.action}
                  </Link>
                )}
              </div>
            ))}
            {g.rows.length > 200 && (
              <p className="px-4 py-3 text-xs text-slate-400">
                Showing the first 200 of {g.rows.length}. Fix these and the rest move up.
              </p>
            )}
          </div>
        </Card>
      ))}

      {/*
        AND WHAT WAS PARKED EARLIER. Not an exception -- nothing is holding a payover up -- but this
        is where somebody comes to deal with overpayments, and a credit parked six months ago has
        nowhere else to surface. It draws nothing at all when nothing is parked.
      */}
      <ParkedCredits />

      {/*
        EVERY STATEMENT LINE NOT YET ACCOUNTED FOR (prompt 12): money out that is not tied to a
        payover, a refund, a drawing or a bank charge, and money in that is not a debtor's and not
        yet said to be anything. Until this list is empty the trust ledger does not balance against
        the bank, and the trust overview says so.
      */}
      <BankLinesToAllocate />

      {disposing?.allocationId && (
        <DisposeExcessModal
          allocationId={disposing.allocationId}
          accountId={disposing.accountId}
          debtor={disposing.debtor}
          caseNumber={disposing.caseNumber}
          amount={disposing.amount ?? 0}
          onClose={() => setDisposing(null)}
          onDone={async () => { setDisposing(null); await load() }}
        />
      )}

      {rateFor && (
        <SetRateModal
          job={rateFor}
          onClose={() => setRateFor(null)}
          onDone={async () => { setRateFor(null); await load() }}
        />
      )}
    </div>
  )
}

/**
 * SET THE RATE, REPLAY THE ACCOUNT, REBUILD ITS RUN — in that order, in one press.
 *
 * Setting the rate alone changes nothing: the allocation was already written with no commission
 * and it is the allocation the run was built from. So the account is replayed, which deletes and
 * re-splits everything not already inside an issued invoice, and then the run is rebuilt from what
 * the replay left. Miss either step and the exception disappears from this list while the client
 * is still owed all of their capital.
 *
 * THE RATE GOES ON THE CLIENT, NOT THE ACCOUNT, unless the person says otherwise. A rate is
 * normally a term of the mandate and applies to every account under it; one account with a private
 * rate is the exception, and making the exception the default would leave the next ninety
 * accounts on this client still blocked.
 */
function SetRateModal({ job, onClose, onDone }: { job: ExceptionJob; onClose: () => void; onDone: () => Promise<void> }) {
  const [percent, setPercent] = useState('')
  const [scope, setScope] = useState<'client' | 'account'>('client')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fraction = Number(percent) / 100
  const valid = Number.isFinite(fraction) && fraction > 0 && fraction <= 1

  async function save() {
    setBusy(true); setError(null)
    try {
      const table = scope === 'client' ? 'companies' : 'debtor_accounts'
      const id = scope === 'client' ? job.companyId : job.accountId
      const { error: e } = await supabase.from(table).update({ commission_rate: fraction }).eq('id', id)
      if (e) throw new Error(e.message)
      await reallocateAccount(job.accountId)
      if (job.runId) {
        const { data } = await supabase.from('payover_runs')
          .select('company_id, period_start').eq('id', job.runId).maybeSingle()
        const r = data as { company_id: string; period_start: string } | null
        if (r) await rebuildRun(r.company_id, r.period_start)
      }
      await onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not set that rate.')
    } finally { setBusy(false) }
  }

  return (
    <Modal title="Set the commission rate" onClose={onClose} width={440}>
      <div className="space-y-3">
        <p className="text-[13px] text-slate-600">
          {job.client} — {job.debtor}. Nothing was taken on {rand(job.amount ?? 0)} of capital because
          no rate is on file, so the client would be paid all of it.
        </p>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Rate</label>
          <div className="flex items-center gap-2">
            <input value={percent} onChange={(e) => setPercent(e.target.value)}
              inputMode="decimal" placeholder="30" className={clsx(inputClass, 'w-24')} />
            <span className="text-sm text-slate-500">
              per cent{valid ? ` · ${ratePercent(fraction)} of the capital portion` : ''}
            </span>
          </div>
        </div>
        <div className="space-y-1.5">
          {(['client', 'account'] as const).map((sc) => (
            <label key={sc} className="flex items-start gap-2 text-[13px] text-slate-700">
              <input type="radio" checked={scope === sc} onChange={() => setScope(sc)} className="mt-1" />
              <span>
                {sc === 'client'
                  ? <>Every account for <b>{job.client}</b> — a rate is normally a term of the mandate.</>
                  : <>This account only — a private rate that overrides the client&rsquo;s.</>}
              </span>
            </label>
          ))}
        </div>
        {error && <p className="rounded-lg bg-negative-50 px-3 py-2 text-[13px] text-negative-700">{error}</p>}
        <p className="text-xs text-slate-400">
          The account is re-split and its payover rebuilt in the same press. Anything already inside
          an approved invoice is left exactly as it was.
        </p>
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
          <button type="button" onClick={onClose} className="rounded-lg px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
          <button type="button" disabled={!valid || busy} onClick={() => void save()}
            className="rounded-lg bg-navy-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50">
            {busy ? 'Working…' : 'Set the rate and rebuild'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
