import { Fragment, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react'
import clsx from 'clsx'
import { Card } from '../../components/ui/Card'
import { rand } from '../../lib/money'
import { fetchTrustAwaiting, fetchTrustCashByCycle, fetchTrustOpening, fetchTrustPosition } from '../../lib/trust'
import { fetchLinesToAllocate, fetchPaymentsOutPaid } from '../../lib/bankAllocationApi'
import { firmDay } from '../../lib/dateLabels'
import {
  accountedFromCash, GROUP_HELP, GROUP_TITLE, unaccountedItems, type Unaccounted, type UnaccountedGroup,
} from '../../lib/trustUnaccounted'

/**
 * NOT ACCOUNTED FOR, EVERY ITEM IN ONE LIST (S7, the firm, 12 Oct: "If I click on that, it should
 * show me everything ... because now you're going to like 50 different places to allocate things").
 *
 * Opened from the Trust overview's figure. Every line says what it is and what to do about it, and
 * the lines add up to the overview's figure -- or say, on a line of their own, how far they do not.
 * The arithmetic is trustUnaccounted.ts; this page only fetches and draws.
 */
export function TrustUnaccounted() {
  const [data, setData] = useState<{ inTrust: number; accounted: number; list: Unaccounted } | null>(null)
  const [allowed, setAllowed] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    Promise.all([
      fetchTrustPosition(), fetchTrustCashByCycle(), fetchLinesToAllocate(),
      /* Since the beginning: every payment marked paid and not yet on a statement is listed whatever
         its age; confirmed ones are not wanted here at all. */
      fetchPaymentsOutPaid('2000-01-01'),
      fetchTrustAwaiting().catch(() => null), fetchTrustOpening().catch(() => null),
    ])
      .then(([position, cash, lines, paidOut, awaiting, opening]) => {
        if (!live) return
        /* No row is "not yours to see", never an empty account (as on the overview). */
        if (!position) { setAllowed(false); return }
        const accounted = accountedFromCash(cash)
        const notAccounted = Math.round((position.trustCash - accounted) * 100) / 100
        setData({
          inTrust: position.trustCash, accounted,
          list: unaccountedItems({ notAccounted, lines, awaiting, paidOut, openingSet: Boolean(opening?.asAt) }),
        })
      })
      .catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)) })
    return () => { live = false }
  }, [])

  if (error) {
    return <Card className="p-5 text-sm text-negative-700 bg-negative-50 border-negative-100">The trust account could not be read: {error}</Card>
  }
  if (!allowed) {
    return <Card className="p-5 text-sm text-slate-500">The trust account is not yours to see. Ask an administrator if you need it.</Card>
  }
  if (!data) {
    return <div className="flex items-center gap-2 text-slate-400 text-sm py-10"><Loader2 size={16} className="animate-spin" /> Reading the trust account…</div>
  }

  const total = Math.round((data.inTrust - data.accounted) * 100) / 100
  const groups = (['statement', 'paid_out', 'awaiting', 'unexplained', 'to_match'] as UnaccountedGroup[])
    .map((g) => ({ g, items: data.list.items.filter((i) => i.group === g) }))
    .filter((x) => x.items.length > 0)

  return (
    <div className="space-y-6">
      <div>
        <Link to="/trust" className="inline-flex items-center gap-1 text-[13px] text-slate-500 hover:text-slate-700">
          <ArrowLeft size={14} /> Back to the Trust overview
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-800">Not accounted for</h1>
        <p className="text-sm text-slate-500 mt-1">
          Everything that makes the trust account differ from what has an owner, in one list, with what to do about each.
        </p>
      </div>

      <Card className="px-6 py-4">
        <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2" data-testid="unaccounted-sum">
        <Sum label="In the trust account" value={data.inTrust} />
        <Sum label="Less: accounted for" value={data.accounted} />
        <Sum label="Not accounted for" value={total} strong />
        <span className="text-[13px] text-slate-500">
          {total === 0 ? 'Every rand has an owner.'
            : data.list.remainder === 0 ? (() => { const n = data.list.items.filter((i) => i.group !== 'to_match').length; return `Fully explained by the ${n} ${n === 1 ? 'item' : 'items'} below.` })()
              : `${rand(data.list.explained)} explained below; ${rand(data.list.remainder)} is not.`}
          {data.list.items.some((i) => i.group === 'to_match') && ' Lines that only need matching move nothing and are listed last.'}
        </span>
        </div>
      </Card>

      {groups.length === 0 ? (
        <Card className="px-6 py-10 text-center text-sm text-positive-700">Nothing to place or explain.</Card>
      ) : (
        <Card padded={false} className="overflow-x-auto">
          <table className="w-full list-table whitespace-nowrap">
            <thead>
              <tr className="border-b border-slate-100 text-left text-slate-400">
                <th className="pl-4 pr-2 py-2 font-medium">Date</th>
                <th className="px-2 py-2 font-medium">What</th>
                <th className="px-2 py-2 text-right font-medium">Amount</th>
                <th className="px-4 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {groups.map(({ g, items }) => (
                <Fragment key={g}>
                  <tr className="border-b border-slate-100" data-testid="unaccounted-group" data-group={g}>
                    <td colSpan={4} className="p-0">
                      <div className={clsx('flex items-start justify-between gap-x-4 whitespace-normal border-l-4 px-4 py-1.5',
                        g === 'unexplained' ? 'border-l-negative-500 bg-negative-50' : g === 'to_match' ? 'border-l-slate-300 bg-slate-50' : 'border-l-gold-500 bg-gold-50')}>
                        {/* The explanation WRAPS under the title: on one line it set the table's
                            width and pushed every action off an iPad's screen. */}
                        <span className="min-w-0 text-[13px] font-semibold text-slate-800">
                          {GROUP_TITLE[g]}
                          <span className="block text-[12.5px] font-normal text-slate-500">{GROUP_HELP[g]}</span>
                        </span>
                        <span className="text-[14px] font-semibold tabular-nums text-slate-800">
                          {rand(Math.round(items.reduce((t, i) => t + i.amount, 0) * 100) / 100)}
                        </span>
                      </div>
                    </td>
                  </tr>
                  {items.map((i) => (
                    <tr key={i.key} className="border-b border-slate-50 text-slate-700" data-testid="unaccounted-item">
                      <td className="pl-4 pr-2 py-1.5 align-top tabular-nums text-slate-500">{i.date ? fmtDay(firmDay(i.date)) : '—'}</td>
                      {/* WHAT, AND WHY IT IS HERE UNDER IT: as two columns the table outgrew an iPad. */}
                      <td className="px-2 py-1.5 whitespace-normal">
                        <div className="font-medium text-slate-800">{i.title}</div>
                        <div className="text-[12px] text-slate-500">{i.detail}</div>
                      </td>
                      <td className={clsx('px-2 py-1.5 text-right font-semibold tabular-nums', i.amount < 0 && 'text-negative-700')}>{rand(i.amount)}</td>
                      <td className="px-4 py-1.5 text-right">
                        {i.action && (
                          <Link to={i.action.to} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-gold-700 hover:text-gold-800">
                            {i.action.label} <ArrowRight size={13} />
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {groups.some((x) => x.g === 'paid_out') && (
        <p className="text-[13px] text-slate-500">
          The ones marked paid clear when the statement they went out on is imported, on{' '}
          <Link to="/trust/payments" className="font-medium text-gold-700 hover:text-gold-800">Payments in</Link>;
          each matches its debit by its BF reference.
        </p>
      )}
    </div>
  )
}

function Sum({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div>
      <div className="text-[11.5px] font-bold uppercase tracking-wider text-slate-400">{label}</div>
      <div className={clsx('tabular-nums', strong ? 'text-xl font-semibold text-amber-700' : 'text-lg text-slate-800')}>{rand(value)}</div>
    </div>
  )
}

/* Written out: en-ZA abbreviates September to "Sept" (CLAUDE.md). */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function fmtDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}
