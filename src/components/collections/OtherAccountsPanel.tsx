import { Link } from 'react-router-dom'
import { Card, CardHeader } from '../ui/Card'
import { formatCurrency } from '../../data/mockData'
import { OTHER_ACCOUNTS_HEADING, orderOtherAccounts, type OtherAccount } from '../../lib/sameDebtor'

/**
 * The debtor's other accounts, each one a way into it.
 *
 * THE FIRM: "it will indicate, when you're on an account, this debtor has other accounts, those
 * account numbers, and you would be able to click on that account number and it opens that
 * account ... and then you can go back to the original just by clicking on the other one."
 *
 * THE WAY BACK IS THE SAME PANEL. There is no breadcrumb and no history to keep, because every
 * account in the group shows the rest of the group -- arriving at the second account, the first
 * is in this list. That is the whole mechanism, and it is the reason nothing is stored: a panel
 * built from the rows means the return journey exists without anybody building it.
 *
 * NOT SHOWN AT ALL WHERE THERE IS NOTHING TO SHOW. An empty "Other accounts (0)" on the great
 * majority of accounts is a panel that pushes the figures down the page in order to say nothing,
 * and CLAUDE.md is explicit that something which fires when nothing is wrong stops being read.
 */
export function OtherAccountsPanel({ rows }: { rows: OtherAccount[] }) {
  if (rows.length === 0) return null
  const ordered = orderOtherAccounts(rows)

  return (
    <Card>
      <CardHeader
        title={OTHER_ACCOUNTS_HEADING}
        subtitle={rows.length === 1
          ? 'One other account, on the same identity number.'
          : `${rows.length} other accounts, on the same identity number.`} />

      <ul className="divide-y divide-slate-100 -mx-1">
        {ordered.map((a) => (
          <li key={a.id}>
            <Link to={`/accounts/${a.id}`}
              className="flex items-baseline justify-between gap-3 px-1 py-2 rounded
                hover:bg-[var(--tint-steel-alt)]">
              <span className="min-w-0">
                <span className="block text-[13.5px] font-medium text-brand-700">
                  {a.reference ?? 'No reference'}
                </span>
                {/* WHOSE BOOK IT IS ON. The group crosses clients, so the reference on its own
                    would leave somebody guessing which client to phone about it. */}
                <span className="block text-[11.5px] text-slate-400 truncate">
                  {a.clientName ?? 'Unknown client'}
                  {a.writtenOff && ' · written off'}
                </span>
              </span>
              <span className="text-[13px] text-slate-600 shrink-0 tabular-nums">
                {a.balance === null ? '—' : formatCurrency(a.balance)}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {/*
        SAID OUTRIGHT, because it is what somebody would otherwise assume. Each account keeps its
        own capital, its own in duplum ceiling and its own commission; nothing here is a total, and
        an arrangement on one of these does not touch another.
      */}
      <p className="text-[11px] text-slate-400 mt-3 pt-3 border-t border-slate-100">
        Separate accounts, each with its own balance and its own arrangement. Nothing here is a
        combined total.
      </p>
    </Card>
  )
}
