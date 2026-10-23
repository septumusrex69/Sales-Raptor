import { useEffect, useState } from 'react'
import { fetchClientIntakeByDay } from '../../lib/companySnapshotData'
import { firstThreeMonths } from '../../lib/clientBook'
import { clockToday } from '../../lib/clock'
import { formatCurrency, formatDate } from '../../data/mockData'

/**
 * "FIRST THREE MONTHS: N accounts, R X handed over" on the client record (the firm, 23 Oct).
 *
 * Converting a lead used to ask for a handover amount and a number of accounts as if they were facts.
 * They are not known at conversion; they are what the client hands over in its first three months,
 * counted from its first account -- the same window that makes a client NEW on the company dashboard.
 * So the figure is READ, here, from the client's handovers by day (client_intake_by_day, the client
 * and its sub-accounts), and the lead's estimate stays beside it as the estimate it was.
 *
 * Top-level clients only: client_intake_by_day counts a client with its sub-accounts, so asked for a
 * sub-account it would answer nothing and the line would read as a client that sent no work.
 */
export function FirstThreeMonths({ clientId }: { clientId: string }) {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof fetchClientIntakeByDay>> | null>(null)
  useEffect(() => {
    let live = true
    fetchClientIntakeByDay(clientId, { start: new Date(2000, 0, 1), end: new Date(`${clockToday()}T12:00:00`) })
      .then((r) => { if (live) setRows(r) })
      .catch(() => { if (live) setRows([]) })
    return () => { live = false }
  }, [clientId])
  if (rows === null) return null
  const first = firstThreeMonths(rows)
  if (!first) return null
  const open = !first.complete(clockToday())
  return (
    <p className="text-xs text-slate-500 mt-3" data-testid="first-three-months">
      <span className="font-medium text-slate-700">First three months:</span>{' '}
      <span className="tabular-nums">{first.accounts} account{first.accounts === 1 ? '' : 's'}, {formatCurrency(first.capital)} handed over</span>
      <span className="text-slate-400">
        {' '}· from {formatDate(first.from)}{open ? `, still counting until ${formatDate(first.until)}` : ''}
      </span>
    </p>
  )
}
