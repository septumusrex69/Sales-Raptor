import { Fragment } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { Card } from '../../components/ui/Card'
import { rand } from '../../lib/money'
import type { PayoverTie, PtcAgeing, PtcRun } from '../../lib/trust'
import { AGE_LABEL, AGE_ORDER, ageAnalysis } from '../../lib/ptcAgeing'

/**
 * THE PTCs, REPORTED APART FROM THE TRUST ACCOUNT (the firm, 10 Oct: "Now you've incorporated PTCs
 * in this, and I don't think that's the right thing to do. We should report on that separately").
 *
 * A PTC is money a debtor paid the client directly. None of it came into the trust account; what the
 * firm is owed on it -- fees, interest, commission and VAT -- is collected one of two ways: off the
 * client's own trust money on the payover that carries it, or, where that is not enough, from the
 * client, into the BUSINESS account. So the questions here are the firm's own: which will be set off,
 * which will not, and how long what is left has been owing.
 *
 * A PTC rides the NEXT payover (10 Oct): captured on 15 October, it is on the 11 November advice,
 * and that is the day it is invoiced and the day its age counts from.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/* Written out rather than through Intl: en-ZA abbreviates September to "Sept" (CLAUDE.md). */
const day = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}` }
const r2 = (v: number) => Math.round(v * 100) / 100

/* An open run has not invoiced anything yet: its words are about what WILL happen. */
const OPEN = new Set(['needs_review', 'ready'])

function verdict(p: PtcRun): { text: string; tone: 'ok' | 'part' | 'short' } {
  const open = OPEN.has(p.status)
  if (p.short === 0) return { text: open ? 'Will be set off' : 'Set off', tone: 'ok' }
  if (p.setOff > 0) return { text: `${open ? 'Partly set off' : 'Partly set off'} · ${rand(p.short)} short`, tone: 'part' }
  return { text: open ? 'Won’t be set off · no trust money' : 'Not set off · the client owes it', tone: 'short' }
}

export function PtcByPayover({ runs }: { runs: PtcRun[] }) {
  if (runs.length === 0) {
    return (
      <Card className="mt-4 p-6 text-sm text-slate-500 text-center">
        No payments made straight to clients are on a payover.
      </Card>
    )
  }
  const groups = new Map<string, PtcRun[]>()
  for (const r of runs) groups.set(r.paysOn, [...(groups.get(r.paysOn) ?? []), r])
  return (
    <div data-testid="ptc-by-payover"><Card className="mt-4 p-0 overflow-x-auto">
      <table className="w-full min-w-[720px] text-[12.5px] whitespace-nowrap">
        <thead>
          <tr className="text-slate-400">
            <th className="text-left font-medium px-4 py-2">Client</th>
            <th className="text-left font-medium px-2 py-2">Payover</th>
            <th className="text-right font-medium px-2 py-2" title="What the debtors paid straight to the client">Paid to them</th>
            <th className="text-right font-medium px-2 py-2" title="The firm's share: fees, interest, commission and VAT">Owed to us</th>
            <th className="text-right font-medium px-2 py-2" title="Covered by the client's own trust money on this payover">Set off</th>
            <th className="text-right font-medium px-2 py-2">Short</th>
            <th className="text-left font-medium px-4 py-2">Where it stands</th>
          </tr>
        </thead>
        <tbody>
          {[...groups.entries()].map(([paysOn, rows]) => {
            const owed = r2(rows.reduce((s, r) => s + r.owed, 0))
            const setOff = r2(rows.reduce((s, r) => s + r.setOff, 0))
            const short = r2(rows.reduce((s, r) => s + r.short, 0))
            return (
              <Fragment key={paysOn}>
                <tr className="border-t border-slate-100 bg-slate-50" data-testid="ptc-payover">
                  <td colSpan={3} className="px-4 py-1.5 font-semibold text-slate-700">
                    Payover of {day(paysOn)} <span className="font-normal text-slate-400">· {rows.length} {rows.length === 1 ? 'client' : 'clients'}</span>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-slate-700">{rand(owed)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-positive-700">{rand(setOff)}</td>
                  <td className={clsx('px-2 py-1.5 text-right tabular-nums font-semibold', short > 0 ? 'text-negative-700' : 'text-slate-400')}>{short > 0 ? rand(short) : '—'}</td>
                  <td />
                </tr>
                {rows.map((r) => {
                  const v = verdict(r)
                  return (
                    <tr key={r.runId} className="border-t border-slate-50 text-slate-700" data-testid="ptc-run">
                      <td className="px-4 py-1.5 font-medium text-slate-800 max-w-[16rem] truncate" title={r.client}>
                        <Link to={`/companies/${r.companyId}?tab=Account`} className="hover:text-gold-700">{r.client}</Link>
                      </td>
                      <td className="px-2 py-1.5 text-slate-500">
                        <Link to={`/trust/runs/${r.runId}`} className="hover:text-gold-700">{r.invoiceNumber ?? 'the run'}</Link>
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{rand(r.received)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{rand(r.owed)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-positive-700">{r.setOff ? rand(r.setOff) : '—'}</td>
                      <td className={clsx('px-2 py-1.5 text-right tabular-nums', r.short > 0 ? 'text-negative-700 font-semibold' : 'text-slate-400')}>
                        {r.short > 0 ? rand(r.short) : '—'}
                      </td>
                      <td className={clsx('px-4 py-1.5',
                        v.tone === 'ok' ? 'text-positive-700' : v.tone === 'part' ? 'text-gold-800' : 'text-negative-700')}>
                        {v.text}
                      </td>
                    </tr>
                  )
                })}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </Card></div>
  )
}

export function PtcAgeAnalysis({ items, today }: { items: PtcAgeing[]; today: string }) {
  const { rows, totals, total } = ageAnalysis(items, today)
  if (rows.length === 0) {
    return (
      <Card className="mt-4 p-6 text-sm text-slate-500 text-center">
        No client owes the firm anything after set-off.
      </Card>
    )
  }
  return (
    <div data-testid="ptc-ageing"><Card className="mt-4 p-0 overflow-x-auto">
      <table className="w-full min-w-[720px] text-[12.5px] whitespace-nowrap">
        <thead>
          <tr className="text-slate-400">
            <th className="text-left font-medium px-4 py-2">Client</th>
            {AGE_ORDER.map((b) => <th key={b} className="text-right font-medium px-2 py-2">{AGE_LABEL[b]}</th>)}
            <th className="text-right font-medium px-4 py-2">Owes us</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.companyId} className="border-t border-slate-50 text-slate-700" data-testid="age-row">
              <td className="px-4 py-1.5 font-medium text-slate-800 max-w-[16rem] truncate" title={r.client}>
                <Link to={`/companies/${r.companyId}?tab=Account`} className="hover:text-gold-700">{r.client}</Link>
              </td>
              {AGE_ORDER.map((b) => (
                <td key={b} className={clsx('px-2 py-1.5 text-right tabular-nums',
                  r.buckets[b] === 0 ? 'text-slate-300' : b === 'd61' || b === 'd91' ? 'text-negative-700 font-semibold' : '')}>
                  {r.buckets[b] === 0 ? '—' : rand(r.buckets[b])}
                </td>
              ))}
              <td className="px-4 py-1.5 text-right tabular-nums font-semibold">{rand(r.total)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-slate-200 bg-slate-50 text-slate-600">
            <td className="px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider">Total</td>
            {AGE_ORDER.map((b) => <td key={b} className="px-2 py-1.5 text-right tabular-nums">{totals[b] ? rand(totals[b]) : '—'}</td>)}
            <td className="px-4 py-1.5 text-right tabular-nums font-semibold" data-testid="age-total">{rand(total)}</td>
          </tr>
        </tfoot>
      </table>
    </Card></div>
  )
}

/**
 * EACH PAYOVER, CHECKED (the firm: "the total monthly collections equals what's in the trust and
 * all the PTCs ... That's how we can double check all of the figures"). Into trust plus paid
 * straight to clients is what was collected for that payover -- counted from the payments, and
 * held against what the payover runs carry. A row that does not agree says by how much.
 */
export function PayoverCheck({ rows }: { rows: PayoverTie[] }) {
  if (rows.length === 0) return null
  return (
    <div data-testid="payover-check"><Card className="mt-4 p-0 overflow-x-auto">
      <table className="w-full min-w-[640px] text-[12.5px] whitespace-nowrap">
        <thead>
          <tr className="text-slate-400">
            <th className="text-left font-medium px-4 py-2">Payover</th>
            <th className="text-right font-medium px-2 py-2">Into trust</th>
            <th className="text-right font-medium px-2 py-2">Paid straight to clients</th>
            <th className="text-right font-medium px-2 py-2">Collected</th>
            <th className="text-left font-medium px-4 py-2" title="The same two figures, as the payover runs carry them">Against the runs</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const dTrust = r2(r.intoTrust - r.runsIntoTrust)
            const dDirect = r2(r.paidDirect - r.runsPaidDirect)
            const agrees = dTrust === 0 && dDirect === 0
            return (
              <tr key={r.paysOn} className="border-t border-slate-50 text-slate-700" data-testid="payover-check-row">
                <td className="px-4 py-1.5 font-medium text-slate-800">{day(r.paysOn)} <span className="font-normal text-slate-400">· {r.payments} {r.payments === 1 ? 'payment' : 'payments'}</span></td>
                <td className="px-2 py-1.5 text-right tabular-nums">{rand(r.intoTrust)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{rand(r.paidDirect)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{rand(r2(r.intoTrust + r.paidDirect))}</td>
                <td className={clsx('px-4 py-1.5', agrees ? 'text-positive-700' : 'text-negative-700 font-medium')}>
                  {agrees ? 'Agrees'
                    : [dTrust !== 0 && `Trust ${dTrust > 0 ? `${rand(dTrust)} not on a run` : `${rand(-dTrust)} more on the runs`}`,
                       dDirect !== 0 && `PTCs ${dDirect > 0 ? `${rand(dDirect)} not on a run` : `${rand(-dDirect)} more on the runs`}`]
                      .filter(Boolean).join(' · ')}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </Card></div>
  )
}
