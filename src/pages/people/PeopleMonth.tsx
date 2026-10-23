import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { PeriodStepper } from '../../components/people/PeriodStepper'
import { useAppStore } from '../../store/AppStore'
import {
  clientsWithPtc, defaultPayBasis, paydayOf, periodForKey, periodKeyOf, periodLabel, periodRange, salaryMonth, shortDay,
  summarise, type SummaryRow,
} from '../../lib/clerkCommission.ts'
import {
  fetchCarried, fetchCommissionPayments, fetchCommissionStart, fetchEmployeeProfiles, fetchPayoverRuns,
} from '../../lib/peopleApi'
import { clockToday } from '../../lib/clock.ts'
import { rand } from '../../lib/money'

/**
 * THE FIRM'S PAY FOR ONE PERIOD, ONE ROW A PERSON.
 *
 * BUILT FROM THE VERY STATEMENT EACH PERSON'S PAGE DRAWS (summarise calls buildStatement), so this
 * total and the sum of the pay pages cannot disagree. One database call for everybody's payments
 * rather than one a person: the summary of thirty clerks is one round trip, not thirty.
 *
 * WAITING PTC COMMISSION IS ITS OWN COLUMN AND NOT IN THE TOTAL -- the firm has not been paid it.
 */
export function PeopleMonth() {
  const { users } = useAppStore()
  const latest = periodKeyOf(clockToday())
  const [periodKey, setPeriodKey] = useState(latest)
  const [result, setResult] = useState<{ rows: SummaryRow[]; unheld: number; unread: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setResult(null); setError(null)
    const p = periodForKey(periodKey)
    ;(async () => {
      const [profiles, payments, carried, commissionStart] = await Promise.all([
        fetchEmployeeProfiles(), fetchCommissionPayments(p.start, p.end, null), fetchCarried(null), fetchCommissionStart(),
      ])
      const { runs } = await fetchPayoverRuns(clientsWithPtc(payments, carried))
      const byId = new Map(profiles.map((x) => [x.userId, x]))
      const people = users.filter((u) => u.status === 'Active' || payments.some((x) => x.holderId === u.id)).map((u) => ({
        userId: u.id,
        basis: byId.get(u.id)?.payBasis ?? defaultPayBasis(u.role),
        basic: byId.get(u.id)?.basicSalary ?? null,
        startedOn: u.startDate ?? null,
        endedOn: byId.get(u.id)?.endedOn ?? null,
      }))
      const out = summarise({ periodKey, people, payments, runs, carried, commissionStart })
      return { ...out, unread: runs === null && (payments.some((x) => x.paidToClient) || carried.length > 0) }
    })()
      .then((r) => { if (live) setResult(r) })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : 'Could not work out the month.') })
    return () => { live = false }
  }, [periodKey, users])

  const totals = useMemo(() => {
    const rows = result?.rows ?? []
    const add = (f: (r: SummaryRow) => number) => Math.round(rows.reduce((s, r) => s + f(r), 0) * 100) / 100
    return { basic: add((r) => r.basic), commission: add((r) => r.commission), pending: add((r) => r.pending), payable: add((r) => r.payable) }
  }, [result])
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? 'Unknown'

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="text-xl font-semibold tracking-tight text-slate-800">Month summary</h1>
          <span className="text-xs text-slate-400">What the firm pays for {periodLabel(periodKey)}</span>
        </div>
        <PeriodStepper value={periodKey} onChange={setPeriodKey} latest={latest} />
      </div>
      {/* THE PAY DAY, AND THE TWO MONTHS IT PAYS FOR (the firm, 23 Oct): commission on the collections
          month (11th to 10th), the basic on the salary month (26th to 25th), both on the 25th. */}
      <p className="text-sm text-slate-700">
        Paid on <span className="font-semibold" data-testid="month-payday">{shortDay(paydayOf(periodKey))}</span>
        <span className="text-slate-500"> · commission earned {periodRange(periodKey)} · basic for {shortDay(salaryMonth(periodKey).start)} – {shortDay(salaryMonth(periodKey).end)}</span>
      </p>
      {error && <Card className="p-4 text-sm text-negative-700 bg-negative-50 border-negative-100">{error}</Card>}
      {result?.unread && (
        <Card className="p-3 text-sm text-negative-700 bg-negative-50 border-negative-100">
          The clients’ payover runs could not be read, so every PTC’s commission is shown as waiting.
        </Card>
      )}
      {result === null && !error ? (
        <div className="flex items-center gap-2 text-slate-400 text-sm py-8"><Loader2 size={16} className="animate-spin" /> Working out the month…</div>
      ) : result && (
        <Card className="overflow-hidden" padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full list-table whitespace-nowrap" data-testid="month-summary">
              <thead>
                <tr className="bg-slate-50 text-slate-400">
                  <th className="text-left font-medium px-4 py-2.5">Person</th>
                  <th className="text-right font-medium px-4 py-2.5">Basic</th>
                  <th className="text-right font-medium px-4 py-2.5">Commission payable</th>
                  <th className="text-right font-medium px-4 py-2.5">Total payable</th>
                  <th className="text-right font-medium px-4 py-2.5">PTC waiting</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r) => (
                  <tr key={r.userId} className="border-t border-slate-100">
                    <td className="px-4 py-1.5"><Link to={`/people/${r.userId}`} className="text-brand-700 hover:underline">{nameOf(r.userId)}</Link></td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{rand(r.basic)}{r.prorata && <span className="ml-1 text-[11px] text-slate-400">pro rata</span>}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{r.scheme ? rand(r.commission) : <span className="text-slate-400">No scheme yet</span>}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums font-medium">{rand(r.payable)}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums text-slate-500">{r.scheme ? rand(r.pending) : ''}</td>
                  </tr>
                ))}
                <tr className="border-t border-slate-200 font-semibold text-slate-900">
                  <td className="px-4 py-2">Total</td>
                  <td className="px-4 py-2 text-right tabular-nums">{rand(totals.basic)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{rand(totals.commission)}</td>
                  <td className="px-4 py-2 text-right tabular-nums" data-testid="month-payable">{rand(totals.payable)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-500">{rand(totals.pending)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="px-4 py-2.5 text-[11px] text-slate-400 border-t border-slate-100">
            PTC waiting is not in the total: it is paid once the client’s payover run shows nothing outstanding.
            {result.unheld > 0 && ` ${rand(result.unheld)} came in on accounts nobody held on the day, which earns no commission.`}
          </p>
        </Card>
      )}
    </div>
  )
}
