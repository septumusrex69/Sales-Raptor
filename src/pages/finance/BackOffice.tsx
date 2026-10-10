import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Loader2 } from 'lucide-react'
import clsx from 'clsx'
import { Card } from '../../components/ui/Card'
import { rand } from '../../lib/money'
import { useAppStore } from '../../store/AppStore'
import { fetchExpectedFromPromises, fetchMoneyPosition, type ExpectedPromise, type MoneyPosition } from '../../lib/payover'

/**
 * BF'S BACK OFFICE: WHAT IS LEFT TO TAKE.
 *
 * The firm's own view, and it never appears on anything a client receives. For every account,
 * every client and the whole book: what has been CHARGED, what has been TAKEN from payments, what
 * is still LEFT to take, and what can never be taken because of a cap, the in duplum ceiling or a
 * write-off.
 *
 * "CAN'T TAKE" IS NOT ONE THING and the three buckets mean different things by it, which is why
 * each is labelled rather than summed into a single scary number: interest that the in duplum
 * ceiling put out of reach, costs raised above the items 1-7 ceiling or since cancelled, and --
 * for receipt fees, which sit outside the cap entirely -- only a cancellation.
 *
 * COMMISSION HAS NO "LEFT". It is earned when capital comes in, not charged to the debtor, so the
 * column that would hold it holds a POTENTIAL instead: what the account would earn if the capital
 * still outstanding were all collected. Showing it as "left to take" would put money the firm has
 * not earned into the same total as money a debtor owes.
 */

interface Bucket {
  label: string
  charged: number
  taken: number
  left: number
  cant: number
  note?: string
}

export function BackOffice() {
  const { companies } = useAppStore()
  const [rows, setRows] = useState<MoneyPosition[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [client, setClient] = useState<string>('all')
  const [promises, setPromises] = useState<ExpectedPromise[]>([])

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [p, q] = await Promise.all([fetchMoneyPosition(), fetchExpectedFromPromises()])
      setRows(p)
      setPromises(q)
    }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load the back office.') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  const scoped = useMemo(
    () => (client === 'all' ? rows : rows.filter((r) => r.companyId === client)),
    [rows, client],
  )

  const sum = useCallback(
    (f: (r: MoneyPosition) => number) => scoped.reduce((t, r) => t + f(r), 0),
    [scoped],
  )

  const buckets: Bucket[] = [
    {
      label: 'Interest',
      charged: sum((r) => r.interestCharged), taken: sum((r) => r.interestTaken),
      left: sum((r) => r.interestLeft), cant: sum((r) => r.interestCantTake),
      note: 'Cannot take: past the in duplum ceiling, prescribed, or written off',
    },
    {
      label: 'Costs · Annexure B items 1–7',
      charged: sum((r) => r.costsCharged), taken: sum((r) => r.costsTaken),
      left: sum((r) => r.costsLeft), cant: sum((r) => r.costsCantTake),
      note: 'Cannot take: raised above the R 1 225 ceiling, or cancelled',
    },
    {
      label: 'Receipt fees · item 9',
      charged: sum((r) => r.receiptFeesCharged), taken: sum((r) => r.receiptFeesTaken),
      left: sum((r) => r.receiptFeesLeft), cant: sum((r) => r.receiptFeesCantTake),
      note: 'Outside the items 1–7 cap, so only a cancellation puts one out of reach',
    },
  ]

  /* The clients in the book, for the picker: the business side no longer draws them one by one. */
  const byClient = useMemo(() => {
    const ids = [...new Set(rows.map((r) => r.companyId))]
    return ids
      .map((id) => ({ id, name: companies.find((c) => c.id === id)?.name ?? 'Unknown client' }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [rows, companies])

  const cappedCount = scoped.filter((r) => r.costCapHeadroom === 0 && r.costCap > 0).length
  const scopedPromises = client === 'all' ? promises : promises.filter((p) => p.companyId === client)

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-negative-50 px-4 py-3 text-sm text-negative-700">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /><span>{error}</span>
        </div>
      )}
      {loading && <div className="py-16 text-center text-slate-400"><Loader2 className="mx-auto w-5 h-5 animate-spin" /></div>}

      {!loading && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <select value={client} onChange={(e) => setClient(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <option value="all">Every client</option>
              {byClient.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <span className="text-xs text-slate-400">
              {scoped.length.toLocaleString('en-ZA')} accounts
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Left to take" value={rand(sum((r) => r.bfLeftToTake))}
              note="Interest, costs and receipt fees still owed by debtors" />
            <Kpi label="Taken so far" value={rand(sum((r) => r.interestTaken + r.costsTaken + r.receiptFeesTaken))}
              note="Recovered from payments already split" />
            <Kpi label="Expected from promises" value={rand(scopedPromises.reduce((t, p) => t + p.bfShare, 0))}
              note={`BF's share of ${scopedPromises.length} ${scopedPromises.length === 1 ? 'account' : 'accounts'} promising before the cut-off`} />
            <Kpi label="Cannot be taken" value={rand(sum((r) => r.interestCantTake + r.costsCantTake + r.receiptFeesCantTake))}
              note={`Over the cap, in duplum or written off · ${cappedCount} accounts at the ceiling`} tone="warn" />
          </div>

          <Card padded={false}>
            <div className="border-b border-slate-100 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.07em] text-slate-400">
              By bucket
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-[12.5px] whitespace-nowrap">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-slate-400 text-slate-400">
                    <th className="px-4 py-2.5">Bucket</th>
                    <th className="px-4 py-2.5">Taken · left · cannot take</th>
                    <th className="px-4 py-2.5 text-right">Charged</th>
                    <th className="px-4 py-2.5 text-right">Taken</th>
                    <th className="px-4 py-2.5 text-right">Left to take</th>
                    <th className="px-4 py-2.5 text-right">Cannot take</th>
                  </tr>
                </thead>
                <tbody>
                  {buckets.map((b) => {
                    const total = Math.max(b.taken + b.left + b.cant, 0.01)
                    return (
                      <tr key={b.label} className="border-b border-slate-50">
                        {/* ONE THIN LINE (the firm, 10 Oct): what "cannot take" means is the label's tooltip. */}
                        <td className="px-4 py-1.5 font-medium text-slate-800" title={b.note}>{b.label}</td>
                        <td className="px-4 py-1.5">
                          <div className="flex h-3.5 w-full min-w-[120px] overflow-hidden rounded bg-slate-100">
                            <span className="block bg-emerald-500" style={{ width: `${(b.taken / total) * 100}%` }} />
                            <span className="block bg-gold-500" style={{ width: `${(b.left / total) * 100}%` }} />
                            <span className="block bg-negative-500" style={{ width: `${(b.cant / total) * 100}%` }} />
                          </div>
                        </td>
                        <td className="px-4 py-1.5 text-right tabular-nums">{rand(b.charged)}</td>
                        <td className="px-4 py-1.5 text-right tabular-nums text-emerald-700">{rand(b.taken)}</td>
                        <td className="px-4 py-1.5 text-right font-semibold tabular-nums">{rand(b.left)}</td>
                        <td className="px-4 py-1.5 text-right tabular-nums text-negative-600">{rand(b.cant)}</td>
                      </tr>
                    )
                  })}
                  <tr className="border-b border-slate-50">
                    <td className="px-4 py-1.5 font-medium text-slate-800"
                      title="Earned when capital comes in, so it has no &ldquo;left&rdquo; — only what the capital still outstanding would earn">
                      Commission
                    </td>
                    <td className="px-4 py-1.5" />
                    <td className="px-4 py-1.5 text-right tabular-nums">—</td>
                    <td className="px-4 py-1.5 text-right tabular-nums text-emerald-700">{rand(sum((r) => r.commissionEarned))}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums text-slate-400">
                      {rand(sum((r) => r.commissionPotential))} potential
                    </td>
                    <td className="px-4 py-1.5 text-right tabular-nums">—</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-4 px-4 py-3 text-xs text-slate-500">
              <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500" />Taken</span>
              <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-gold-500" />Left to take</span>
              <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-negative-500" />Cannot take</span>
            </div>
          </Card>

          {/*
            NO CLIENT-BY-CLIENT TABLE HERE (the firm, 10 Oct: "I think it overcomplicates things ...
            that should be really addressed in the trust section"). The business side reads the
            firm's figures as a whole; one client's figures are the picker at the top, and what is
            held for each client is the Trust ledger and the payover runs.
          */}
          {/*
            * EXPECTED FROM PROMISES BEFORE THE CUT-OFF.
            *
            * Every promise due between today and the 10th, run through the engine as a dry run. It
            * assumes each one is KEPT, in full and on time, which the firm's own broken-promise
            * rung says is not what happens -- so it is an estimate, and the heading says so rather
            * than letting a precise-looking number imply otherwise.
            *
            * THE PROMISES ON ONE ACCOUNT ARE WALKED IN ORDER, not measured independently. Two
            * promises against one debtor each measured against today's balances would take the
            * same interest twice; on a test account with R200 of interest and two R1 000
            * promises that is R140 of the firm's share invented out of nothing.
            */}
          <Card padded={false}>
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-4 py-3">
              <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-slate-400">
                Expected from promises, before the cut-off
              </span>
              <span className="text-xs text-slate-400">
                Assumes every promise is kept, in full and on time
              </span>
            </div>
            {scopedPromises.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-400">
                Nothing is promised between today and the 10th.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-[12.5px] whitespace-nowrap">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-slate-400 text-slate-400">
                      <th className="px-4 py-2.5">Debtor</th>
                      <th className="px-4 py-2.5">Due</th>
                      <th className="px-4 py-2.5 text-right">Promised</th>
                      <th className="px-4 py-2.5 text-right">BF&rsquo;s share</th>
                      <th className="px-4 py-2.5 text-right">Client&rsquo;s share</th>
                      <th className="px-4 py-2.5 text-right">VAT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scopedPromises.slice(0, 100).map((p) => (
                      <tr key={p.accountId} className="border-b border-slate-50">
                        <td className="px-4 py-2.5">
                          <Link to={`/accounts/${p.accountId}`} className="font-medium text-slate-800 hover:underline">{p.debtor}</Link>
                          <div className="text-xs text-slate-400">
                            {p.caseNumber} · {p.client}
                            {p.promises > 1 ? ` · ${p.promises} promises` : ''}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-500">
                          {p.firstDue ? new Date(`${p.firstDue}T00:00:00`).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' }) : '—'}
                          {p.lastDue && p.lastDue !== p.firstDue ? ` – ${new Date(`${p.lastDue}T00:00:00`).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}` : ''}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{rand(p.promised)}</td>
                        <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{rand(p.bfShare)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{rand(p.clientShare)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-400">{rand(p.vat)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-slate-800 text-sm font-semibold">
                      <td className="px-4 py-2.5" colSpan={2}>Total</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{rand(scopedPromises.reduce((t, p) => t + p.promised, 0))}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{rand(scopedPromises.reduce((t, p) => t + p.bfShare, 0))}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{rand(scopedPromises.reduce((t, p) => t + p.clientShare, 0))}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{rand(scopedPromises.reduce((t, p) => t + p.vat, 0))}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  )
}

function Kpi({ label, value, note, tone }: { label: string; value: string; note: string; tone?: 'warn' }) {
  return (
    <Card>
      <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-slate-400">{label}</div>
      <div className={clsx('mt-1 text-[22px] font-medium tabular-nums', tone === 'warn' ? 'text-negative-600' : 'text-slate-800')}>{value}</div>
      <div className="mt-1 text-xs text-slate-400">{note}</div>
    </Card>
  )
}
