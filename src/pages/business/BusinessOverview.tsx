import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { rand } from '../../lib/money'
import { fetchClientDebts, type ClientDebt } from '../../lib/business'
import { fetchTrustPosition, type TrustPosition } from '../../lib/trust'

/**
 * WHAT THE FIRM IS WORTH THIS MONTH — or the part of it Raptor can honestly answer today.
 *
 * TWO REAL FIGURES AND ONE ADMISSION. What the firm has earned and not yet drawn out of trust is
 * real, and so is what clients owe it; what the firm SPENT is not built at all. Until expenses
 * exist Raptor can say what the firm earned but not what it made, and the panel below says that
 * in words rather than drawing an empty table, which would read as a firm that spent nothing.
 *
 * THE EARNINGS FIGURE IS READ FROM THE TRUST SIDE ON PURPOSE. It is the same `owed_to_firm` the
 * trust overview shows as "Yours to draw" -- one number, one function, two screens. Summed again
 * here the two pages would quietly disagree about how much the firm may take, which is the exact
 * failure the payover arithmetic was centralised to avoid.
 */
export function BusinessOverview() {
  const [debts, setDebts] = useState<ClientDebt[]>([])
  const [trust, setTrust] = useState<TrustPosition | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    Promise.all([fetchClientDebts(), fetchTrustPosition()])
      .then(([d, t]) => { if (live) { setDebts(d); setTrust(t) } })
      .catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-slate-400 text-sm py-10">
        <Loader2 size={16} className="animate-spin" /> Reading the firm's accounts…
      </div>
    )
  }

  if (error) {
    return (
      <Card className="p-5 text-sm text-negative-700 bg-negative-50 border-negative-100">
        The firm's accounts could not be read: {error}
      </Card>
    )
  }

  const owedByClients = debts.reduce((s, d) => s + d.total, 0)

  return (
    <div className="space-y-5">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-xl font-semibold tracking-tight text-slate-800">Business overview</h1>
        <span className="text-xs text-slate-400">Bredell Ferreira's own money</span>
      </div>

      <div className="rounded-xl bg-positive-700 text-white px-6 py-5 flex flex-wrap items-end gap-10">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-positive-100 mb-1.5">
            Earned, still in trust
          </div>
          <div className="text-3xl font-medium tabular-nums leading-none">
            {rand(trust?.owedToFirm ?? 0)}
          </div>
        </div>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-positive-100 mb-1.5">
            Owed by clients
          </div>
          <div className="text-2xl font-medium tabular-nums leading-none">{rand(owedByClients)}</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-5 items-start">
        <div className="flex-[999_1_28rem] min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
            Clients who owe the firm
          </div>
          {debts.length === 0 ? (
            <Card className="p-6 text-sm text-slate-500 text-center">
              No client owes the firm anything. Charges raised on a withdrawal or an executive
              listing would appear here.
            </Card>
          ) : (
            <Card className="overflow-hidden p-0">
              {debts.map((d) => (
                <div key={d.companyId}
                  className="flex items-center gap-4 px-5 py-4 border-b border-slate-100 last:border-b-0">
                  <div className="flex-1 min-w-0">
                    <Link to={`/companies/${d.companyId}`}
                      className="text-sm font-semibold text-slate-800 hover:text-gold-700">
                      {d.client}
                    </Link>
                    <div className="text-[12.5px] text-slate-500 mt-0.5">
                      {d.count === 1 ? '1 charge' : `${d.count} charges`}
                      {d.oldest && `, oldest ${d.oldest}`}
                    </div>
                  </div>
                  {/*
                    THE TWO WAYS IT GETS SETTLED, SHOWN APART. Off-payover and invoiced are not the
                    same debt: one the firm takes, the other the client has to pay. Added together
                    they would read as one overdue figure and somebody would chase a client for
                    money that is already coming off their next run.
                  */}
                  <div className="text-right shrink-0">
                    {d.offPayover > 0 && (
                      <div className="text-[12.5px] text-gold-700 tabular-nums">
                        {rand(d.offPayover)} off their payover
                      </div>
                    )}
                    {d.invoiced > 0 && (
                      <div className="text-[12.5px] text-brand-500 tabular-nums">
                        {rand(d.invoiced)} invoiced
                      </div>
                    )}
                  </div>
                  <div className="text-[17px] font-medium tabular-nums w-28 text-right">
                    {rand(d.total)}
                  </div>
                </div>
              ))}
            </Card>
          )}
          <p className="mt-3 text-[12.5px] text-slate-500 leading-relaxed">
            A charge taken off a payover comes out of <em>that client's own</em> trust credit —
            never another client's, never a debtor's overpayment, and never a receipt nobody has
            placed. Those are different people's money in one bank account.
          </p>
        </div>

        <div className="flex-[1_1_20rem] min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
            What the firm spent
          </div>
          {/*
            NOT BUILT, AND DRAWN AS NOT BUILT. A dashed panel saying so is worth more than an empty
            table of expenses: the empty table reads as a firm that spent nothing this month, which
            is a figure, and a wrong one.
          */}
          <Card className="p-5 border-dashed">
            <p className="text-[13px] text-slate-500 leading-relaxed">
              Salaries, rent, the bureau's invoices, the SMS gateway, bank charges on both
              accounts. None of it is built yet, so Raptor can say what the firm earned but not
              what it made.
            </p>
            <div className="flex flex-wrap gap-1.5 mt-3">
              {['Supplier invoices', 'Payroll', 'Bureau and gateway costs', 'Bank charges'].map((t) => (
                <span key={t} className="text-[12px] text-slate-500 bg-slate-100 rounded-full px-2.5 py-1">
                  {t}
                </span>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
