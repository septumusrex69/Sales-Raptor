import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Card } from '../ui/Card'
import { rand } from '../../lib/money'
import {
  periodLabel, RATE_SOURCE_LABEL, shortDay,
  type PayStatement, type PtcGroup, type StatementLine,
} from '../../lib/clerkCommission.ts'

/**
 * ONE PERSON'S PAY FOR ONE PERIOD, IN THE FIRM'S ORDER: "in a pay slip, there will be all payments
 * made, and the commission for every single payment, and then there will be a section that says PTCs
 * paid out ... and then PTCs not paid out, or like pending or waiting."
 *
 * PENDING IS DRAWN BELOW THE TOTAL AND OUTSIDE IT. It is money the firm has not been paid; putting it
 * above the line, or in it, is how a clerk is told they earned something they will not be paid.
 */

const pct = (r: number | null) => (r === null ? '—' : `${(Math.round(r * 1e6) / 1e4).toLocaleString('en-ZA', { maximumFractionDigits: 4 })}%`)

function Section({ title, sub, testid, children }: { title: string; sub: string; testid: string; children: ReactNode }) {
  return (
    <Card className="overflow-hidden" padded={false}>
      <div className="px-4 pt-3 pb-2" data-testid={testid}>
        <h3 className="text-[15px] font-semibold text-slate-800">{title}</h3>
        <p className="text-[12px] text-slate-500">{sub}</p>
      </div>
      {children}
    </Card>
  )
}

function Lines({ lines, showSource = true }: { lines: StatementLine[]; showSource?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full list-table whitespace-nowrap">
        <thead>
          <tr className="bg-slate-50 text-slate-400">
            <th className="text-left font-medium px-4 py-2">Date</th>
            <th className="text-left font-medium px-4 py-2">Account</th>
            <th className="text-left font-medium px-4 py-2">Client</th>
            <th className="text-right font-medium px-4 py-2">Paid</th>
            <th className="text-right font-medium px-4 py-2">Client rate</th>
            <th className="text-right font-medium px-4 py-2">Your rate</th>
            {showSource && <th className="text-left font-medium px-4 py-2">From</th>}
            <th className="text-right font-medium px-4 py-2">Commission</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={`${l.payment.paymentId}-${l.kind}`} className="border-t border-slate-100 align-top">
              <td className="px-4 py-1.5 text-slate-600">
                {shortDay(l.on)}
                {l.kind !== 'receipt' && (
                  <span className="block text-[11px] text-negative-700">
                    {l.kind === 'ptc_reversal' ? 'PTC reversed after it was paid out' : `Reversed (received ${shortDay(l.payment.receivedOn)})`}
                  </span>
                )}
                {l.payment.holderSource === 'backfill' && (
                  <span className="block text-[11px] text-slate-400" title="The desk history began after this account was handed out; the holder on that day is taken to have held it since handover.">
                    Holder reconstructed
                  </span>
                )}
              </td>
              <td className="px-4 py-1.5">
                <Link to={`/accounts/${l.payment.accountId}`} className="text-brand-700 hover:underline">{l.payment.caseNumber ?? 'Account'}</Link>
                {l.payment.debtor && <span className="block text-[11px] text-slate-400">{l.payment.debtor}</span>}
              </td>
              <td className="px-4 py-1.5 text-slate-600">{l.payment.client ?? '—'}</td>
              <td className="px-4 py-1.5 text-right tabular-nums">{rand(l.amount)}</td>
              <td className="px-4 py-1.5 text-right tabular-nums text-slate-500">
                {pct(l.payment.clientRate)}
                {l.payment.clientRateSource === 'account' && <span className="block text-[11px] text-slate-400">not split yet</span>}
              </td>
              <td className="px-4 py-1.5 text-right tabular-nums">{pct(l.rate)}</td>
              {showSource && (
                <td className="px-4 py-1.5 text-slate-600" title={l.reason ?? undefined}>
                  {RATE_SOURCE_LABEL[l.source]}
                  {l.reason && <span className="block text-[11px] text-slate-400 max-w-[16rem] truncate">{l.reason}</span>}
                </td>
              )}
              <td className={`px-4 py-1.5 text-right tabular-nums font-medium ${l.commission < 0 ? 'text-negative-700' : ''}`}>{rand(l.commission)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Groups({ groups, pending }: { groups: PtcGroup[]; pending: boolean }) {
  return (
    <div className="divide-y divide-slate-100 border-t border-slate-100">
      {groups.map((g) => (
        <div key={g.companyId ?? g.client}>
          <div className="px-4 py-2 flex flex-wrap items-baseline justify-between gap-2 bg-slate-50/60">
            <div className="text-sm font-medium text-slate-800">
              {g.client}
              {pending && (
                <span className="ml-2 text-[12px] font-normal text-slate-500" data-testid="ptc-owed">
                  {g.owed !== null
                    ? `Owes the firm ${rand(g.owed)}${g.owedSince ? ` since ${shortDay(g.owedSince)}` : ''}.`
                    : g.waiting}
                </span>
              )}
            </div>
            <div className="text-sm tabular-nums font-medium">{rand(g.commission)}</div>
          </div>
          <Lines lines={g.lines} />
        </div>
      ))}
    </div>
  )
}

export function PayStatementView({ statement, provisional, scheme }: {
  statement: PayStatement
  /** The period has not closed: what is released is read against the client's balance today. */
  provisional: boolean
  /** The words to use when the person has no commission scheme. */
  scheme: string | null
}) {
  const s = statement
  return (
    <div className="space-y-4" data-testid="pay-statement">
      {provisional && (
        <p className="text-[12px] text-slate-500">
          {periodLabel(s.period.key)} closes on {shortDay(s.period.end)}. Until then these figures move as payments come in,
          and a PTC is released only if the client owes the firm nothing at the close.
        </p>
      )}
      {s.ledgerUnread && (
        <Card className="p-3 text-sm text-negative-700 bg-negative-50 border-negative-100">
          What the clients owe the firm could not be read, so every PTC’s commission is shown as waiting.
        </Card>
      )}

      {!s.scheme ? (
        <Card className="p-4 text-sm text-slate-600" >
          <span data-testid="no-scheme">{scheme ?? 'Commission scheme not set up yet.'}</span>
        </Card>
      ) : (
        <>
          <Section testid="section-payments" title="Payments"
            sub="Every payment into trust on an account you held that day, and its commission. A reversal is taken back in the month it is reversed.">
            {s.payments.length === 0
              ? <p className="px-4 pb-3 text-sm text-slate-400">No payments this period.</p>
              : <Lines lines={s.payments} />}
            <div className="px-4 py-2 border-t border-slate-100 flex justify-between text-sm font-medium">
              <span>Commission on payments</span><span className="tabular-nums" data-testid="payments-total">{rand(s.paymentsTotal)}</span>
            </div>
          </Section>

          <Section testid="section-ptc-paid" title="PTCs paid out"
            sub="Payments made straight to the client. Their commission waits until the client owes the firm nothing, and is paid in the month that happens.">
            {s.released.length === 0
              ? <p className="px-4 pb-3 text-sm text-slate-400">None released this period.</p>
              : <Groups groups={s.released} pending={false} />}
            <div className="px-4 py-2 border-t border-slate-100 flex justify-between text-sm font-medium">
              <span>PTC commission paid out</span><span className="tabular-nums" data-testid="released-total">{rand(s.releasedTotal)}</span>
            </div>
          </Section>
        </>
      )}

      <Card className="max-w-md">
        <div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-slate-600">Basic salary</span><span className="tabular-nums">{rand(s.basic)}</span></div>
          {s.scheme && (
            <>
              <div className="flex justify-between"><span className="text-slate-600">Commission on payments</span><span className="tabular-nums">{rand(s.paymentsTotal)}</span></div>
              <div className="flex justify-between"><span className="text-slate-600">PTC commission paid out</span><span className="tabular-nums">{rand(s.releasedTotal)}</span></div>
            </>
          )}
          <div className="flex justify-between border-t border-slate-200 pt-2 font-semibold text-slate-900">
            <span>Payable for {periodLabel(s.period.key)}</span>
            <span className="tabular-nums" data-testid="payable-total">{rand(s.payable)}</span>
          </div>
        </div>
      </Card>

      {s.scheme && (
        <Section testid="section-ptc-pending" title="PTCs waiting"
          sub="Not in the total above. Released in full in the first month the client owes the firm nothing at the month’s close.">
          {s.pending.length === 0
            ? <p className="px-4 pb-3 text-sm text-slate-400">Nothing waiting.</p>
            : <Groups groups={s.pending} pending />}
          <div className="px-4 py-2 border-t border-slate-100 flex justify-between text-sm font-medium text-slate-500">
            <span>Waiting, not payable</span><span className="tabular-nums" data-testid="pending-total">{rand(s.pendingTotal)}</span>
          </div>
        </Section>
      )}
    </div>
  )
}
