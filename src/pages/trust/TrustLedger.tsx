import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import clsx from 'clsx'
import { Card } from '../../components/ui/Card'
import { rand } from '../../lib/money'
import {
  fetchTrustBalances, fetchTrustPosition,
  type TrustBalance, type TrustParty, type TrustPosition,
} from '../../lib/trust'

/**
 * WHO THE TRUST OWES, WHO OWES IT, AND WHETHER THE BANK AGREES.
 *
 * The overview says how much; this says to whom. Everything behind it has been in the database
 * since the creditors ledger went in and had no screen at all -- which is why the rail carried no
 * item for it until now: a menu item that opens nothing is a menu that lies.
 *
 * THREE TABS, AND THEY ARE THE THREE QUESTIONS SOMEBODY ACTUALLY ASKS. Who are we holding money
 * for. Who owes the trust money back. And does the bank balance agree with the sum of the two.
 *
 * CREDITORS AND DEBTORS ARE THE SAME LEDGER READ IN TWO DIRECTIONS, not two tables: a party's
 * balance is positive or negative, and a PTC -- the debtor paid the client direct -- is exactly
 * what turns a client from one into the other. Splitting them into separate stores would let the
 * two drift; splitting them on screen is how the firm reads them.
 *
 * THE LEDGER DOES NOT SUM TO WHAT THE OVERVIEW SAYS IS OWED, AND THE SCREEN SAYS SO. The position
 * adds unplaced receipts to what is owed out, because money on the statement with nobody's name on
 * it is still somebody's; this list can only name parties it knows. Two figures that differ with
 * no explanation read as a system that disagrees with itself.
 */

const TABS: { id: Tab; label: string }[] = [
  { id: 'creditors', label: 'Owed out of trust' },
  { id: 'debtors', label: 'Owed back to trust' },
  { id: 'reconciliation', label: 'Against the bank' },
]
type Tab = 'creditors' | 'debtors' | 'reconciliation'

const PARTY: Record<TrustParty, { label: string; tone: string }> = {
  client: { label: 'Client', tone: 'bg-brand-100 text-brand-700' },
  debtor: { label: 'Debtor', tone: 'bg-gold-100 text-gold-800' },
  firm: { label: 'The firm', tone: 'bg-positive-100 text-positive-700' },
  unidentified: { label: 'Unplaced', tone: 'bg-slate-200 text-slate-600' },
}

export function TrustLedger() {
  const [tab, setTab] = useState<Tab>('creditors')
  const [rows, setRows] = useState<TrustBalance[]>([])
  const [position, setPosition] = useState<TrustPosition | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    Promise.all([fetchTrustBalances(), fetchTrustPosition()])
      .then(([b, p]) => { if (live) { setRows(b); setPosition(p) } })
      .catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [])

  /* POSITIVE IS OWED OUT, NEGATIVE OWES THE TRUST. One ledger, read in two directions. */
  const creditors = useMemo(() => rows.filter((r) => r.balance > 0), [rows])
  const debtors = useMemo(() => rows.filter((r) => r.balance < 0), [rows])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-slate-400 text-sm py-10">
        <Loader2 size={16} className="animate-spin" /> Reading the ledger…
      </div>
    )
  }
  if (error) {
    return (
      <Card className="p-5 text-sm text-negative-700 bg-negative-50 border-negative-100">
        The ledger could not be read: {error}
      </Card>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-xl font-semibold tracking-tight text-slate-800">Trust ledger</h1>
        <span className="text-xs text-slate-400">
          Every cent in the trust account belongs to one of four parties
        </span>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-slate-100 pb-2">
        {TABS.map((t) => (
          <button
            key={t.id} type="button" onClick={() => setTab(t.id)}
            className={clsx(
              'rounded-lg px-3 py-1.5 text-[13.5px] font-medium transition-colors',
              tab === t.id ? 'bg-gold-50 text-gold-800' : 'text-slate-500 hover:bg-slate-100',
            )}
          >
            {t.label}
            {t.id === 'creditors' && creditors.length > 0 && (
              <span className="ml-1.5 text-slate-400 tabular-nums">{creditors.length}</span>
            )}
            {t.id === 'debtors' && debtors.length > 0 && (
              <span className="ml-1.5 text-slate-400 tabular-nums">{debtors.length}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'creditors' && (
        <Balances
          rows={creditors}
          empty="The trust owes nobody anything. Every client has been paid and the firm has drawn what it earned."
          note={position
            ? `These balances come to ${rand(creditors.reduce((s, r) => s + r.balance, 0))}. `
              + `The overview says ${rand(position.netOwed)} is owed out, and the difference is `
              + `${rand(position.unidentified)} of receipts nobody has placed — still somebody's money, `
              + 'but not yet anybody’s by name.'
            : undefined}
        />
      )}

      {tab === 'debtors' && (
        <Balances
          rows={debtors}
          empty="Nobody owes the trust. A PTC — a debtor paying the client direct — is what usually puts a client on this side."
          note="A negative balance owes the trust rather than is owed by it. It comes off the client's next payover rather than being invoiced, because the money is already theirs to net against."
        />
      )}

      {tab === 'reconciliation' && position && <Reconciliation position={position} rows={rows} />}
    </div>
  )
}

function Balances({ rows, empty, note }: { rows: TrustBalance[]; empty: string; note?: string }) {
  if (rows.length === 0) {
    return <Card className="p-6 text-sm text-slate-500 text-center">{empty}</Card>
  }
  return (
    <div className="space-y-3">
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-[10.5px] uppercase tracking-wide text-slate-400">
                <th className="text-left font-medium px-4 py-2.5">Whose</th>
                <th className="text-left font-medium px-4 py-2.5">Which</th>
                <th className="text-right font-medium px-4 py-2.5">Entries</th>
                <th className="text-right font-medium px-4 py-2.5">Balance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.party}-${r.whoId}`} className="border-t border-slate-100">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* A client and an account are both real pages; the firm and an unplaced
                          receipt are not somebody you can open. */}
                      {r.party === 'client' ? (
                        <Link to={`/companies/${r.whoId}`}
                          className="font-medium text-slate-800 hover:text-gold-700">{r.whoName}</Link>
                      ) : r.party === 'debtor' ? (
                        <Link to={`/accounts/${r.whoId}`}
                          className="font-medium text-slate-800 hover:text-gold-700">{r.whoName}</Link>
                      ) : (
                        <span className="font-medium text-slate-800">{r.whoName}</span>
                      )}
                      <span className={clsx('rounded-full px-2 py-px text-[11px] font-medium',
                        PARTY[r.party].tone)}>
                        {PARTY[r.party].label}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{r.whoDetail || '—'}</td>
                  <td className="px-4 py-3 text-right text-slate-500 tabular-nums">{r.entries}</td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums whitespace-nowrap">
                    {rand(Math.abs(r.balance))}
                  </td>
                </tr>
              ))}
              <tr className="border-t border-slate-200 bg-slate-50">
                <td className="px-4 py-3 text-[12.5px] font-bold uppercase tracking-wide text-slate-600"
                  colSpan={3}>
                  Total
                </td>
                <td className="px-4 py-3 text-right text-base font-semibold tabular-nums">
                  {rand(Math.abs(rows.reduce((s, r) => s + r.balance, 0)))}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
      {note && <p className="text-[12.5px] text-slate-500 leading-relaxed">{note}</p>}
    </div>
  )
}

/**
 * CASH AGAINST WHAT IS OWED, LINE BY LINE.
 *
 * Drawn as a worked sum rather than two figures and a verdict, because when it does not come out
 * the next question is always "which part". The difference line is the answer the account is
 * reconciled on, and it is the only one that is allowed to be anything but informational.
 */
function Reconciliation({ position, rows }: { position: TrustPosition; rows: TrustBalance[] }) {
  const named = rows.reduce((s, r) => s + r.balance, 0)
  const balanced = position.difference === 0
  return (
    <div className="space-y-3">
      <Card className="p-0 overflow-hidden">
        <Line label="In the trust bank account" value={position.trustCash} strong />
        <Line label="Owed to clients" value={-position.owedToClients} />
        <Line label="Owed to debtors who overpaid" value={-position.owedToDebtors} />
        <Line label="Earned by the firm, not yet drawn" value={-position.owedToFirm} />
        <Line label="Receipts nobody has placed" value={-position.unidentified} />
        {position.debtors > 0 && (
          <Line label="Owed back to the trust" value={position.debtors} />
        )}
        <div className={clsx('flex items-center gap-4 px-5 py-4 border-t-2',
          balanced ? 'border-positive bg-positive-50' : 'border-negative bg-negative-50')}>
          <div className="flex-1 text-[12.5px] font-bold uppercase tracking-wide text-slate-700">
            Difference
          </div>
          <div className={clsx('text-lg font-semibold tabular-nums',
            balanced ? 'text-positive-700' : 'text-negative-700')}>
            {rand(position.difference)}
          </div>
        </div>
      </Card>

      <p className="text-[12.5px] text-slate-500 leading-relaxed">
        {balanced
          ? 'The bank holds exactly what Raptor says is owed. Nothing to do.'
          : 'Until this is nil the trust account does not balance. The overview names the debits '
            + 'that nothing accounts for, and each one is either matched to a payover run or funded '
            + 'from the business account.'}
      </p>
      <p className="text-[12.5px] text-slate-400 leading-relaxed">
        Named parties come to {rand(named)}; the rest is receipts on the statement nobody has placed.
        Money with nobody&rsquo;s name on it is still somebody&rsquo;s, so it counts as owed.
      </p>
    </div>
  )
}

function Line({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="flex items-center gap-4 px-5 py-3 border-b border-slate-100 last:border-b-0">
      <div className={clsx('flex-1 text-sm', strong ? 'font-semibold text-slate-800' : 'text-slate-600')}>
        {label}
      </div>
      <div className={clsx('tabular-nums whitespace-nowrap',
        strong ? 'text-base font-semibold' : 'text-sm text-slate-700')}>
        {value < 0 ? `(${rand(Math.abs(value))})` : rand(value)}
      </div>
    </div>
  )
}
