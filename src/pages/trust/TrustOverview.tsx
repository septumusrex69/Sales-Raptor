import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Loader2 } from 'lucide-react'
import clsx from 'clsx'
import { Card } from '../../components/ui/Card'
import { rand } from '../../lib/money'
import {
  fetchClientsOwing, fetchFirmTrustSplit, fetchOverpaymentsKept, fetchTrustCashByCycle, fetchTrustCycles,
  fetchSwordfishHolding, fetchTrustOpening, fetchTrustPosition,
  type ClientOwing, type FirmTrustSplit, type TrustCashCycle, type TrustCycle, type TrustOpening, type TrustPosition,
} from '../../lib/trust'
import { fetchLinesToAllocate, fetchPaymentsOutList } from '../../lib/bankAllocationApi'
import type { StatementLine } from '../../lib/bankLineAllocation'
import { fetchExceptions } from '../../lib/payover'
import { canPay, type OutgoingPayment } from '../../lib/bankFile'
import { cycleLabel, overdueCycles } from '../../lib/trustCycles'
import { trustHeadline } from '../../lib/trustBalance'
import { clockToday } from '../../lib/clock.ts'
import { accountedFromCash } from '../../lib/trustUnaccounted'
import { currentHoldings, todoItems } from '../../lib/trustOverview'
import { swordfishLeft, type SwordfishHolding } from '../../lib/swordfishHolding'

/**
 * IS THE TRUST ACCOUNT RIGHT, AND WHOSE PAYOVER IS EACH PART OF IT WAITING FOR?
 *
 * The first question was the one nothing in Raptor answered; the second was the one THIS screen
 * could not. The firm: "it should reflect everything that is currently in the trust. How much
 * money is currently in the trust? And what is for this month's payover? And what is for next
 * month's payover? ... if we're on the 6th of October, the money for last month that was running
 * from the 10th of August to the 11th of September has not been paid out on the 11th of October.
 * So that money's in there. Plus, money from the 11th of September to the 6th of October is in
 * there as well."
 *
 * WHICH IS THE WHOLE POINT. On any day after the 11th the trust holds at least two payovers at
 * once -- a closed cycle waiting for its day and an open one still filling up -- and a running
 * total per party adds them together. "Clients: R11 362,50" is a true figure that answers neither
 * "what goes out on the 11th" nor "what have we collected this month", and those are the two
 * things somebody standing in front of this screen actually wants.
 *
 * IT STILL OPENS ON THE DIFFERENCE. Cash against what is owed, and the gap between them is the
 * headline whether or not it is zero. A trust screen whose arithmetic can only ever come out at
 * nil is worth nothing: the whole reason to reconcile is the day it does not, and the firm's own
 * trust account is short right now -- a payment out with no run behind it, and a bank charge that
 * belongs to no creditor.
 *
 * AND IT EXPLAINS THE DIFFERENCE RATHER THAN REPORTING IT. `unreconciled_payouts` already knows
 * which debits are unmatched, so they are named with the action each one needs -- a payout gets
 * matched to its run, a bank charge gets funded from the business account, and those are
 * different jobs that a single "investigate" would flatten.
 *
 * TWO VIEWS OF ONE BALANCE AND ONE PIECE OF ARITHMETIC. The cycle bands and the control block are
 * the SAME money read two ways: `trust_by_cycle` buckets every creditor entry exactly once, so its
 * client column sums to the control's `owedToClients` and its two firm columns to `owedToFirm`.
 * That is asserted in `check-trust-cycles` against the live database rather than assumed, because
 * the same money described two ways on two halves of one screen is exactly the drift the payover
 * arithmetic was centralised to avoid.
 */
export function TrustOverview() {
  const [position, setPosition] = useState<TrustPosition | null>(null)
  const [cycles, setCycles] = useState<TrustCycle[]>([])
  const [kept, setKept] = useState<{ amount: number; accounts: number } | null>(null)
  const [opening, setOpening] = useState<TrustOpening | null>(null)
  const [cash, setCash] = useState<TrustCashCycle[]>([])
  const [firm, setFirm] = useState<FirmTrustSplit | null>(null)
  const [lines, setLines] = useState<StatementLine[]>([])
  const [overpaid, setOverpaid] = useState(0)
  const [outList, setOutList] = useState<OutgoingPayment[]>([])
  const [owing, setOwing] = useState<ClientOwing[]>([])
  const [swordfish, setSwordfish] = useState<SwordfishHolding | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    Promise.all([
      fetchTrustPosition(), fetchTrustCycles(), fetchTrustCashByCycle(),
      /* Everything below is a part of "what needs doing": unreadable, that item is simply not drawn. */
      fetchOverpaymentsKept().catch(() => null), fetchTrustOpening().catch(() => null),
      fetchFirmTrustSplit().catch(() => null), fetchLinesToAllocate().catch(() => [] as StatementLine[]),
      fetchExceptions().then((j) => j.filter((x) => x.kind === 'excess_credit').length).catch(() => 0),
      fetchPaymentsOutList().catch(() => [] as OutgoingPayment[]), fetchClientsOwing().catch(() => [] as ClientOwing[]),
      /* NOT optional like the rest: unread, the bucket would be counted as nobody's money. */
      fetchSwordfishHolding(),
    ])
      .then(([p, c, cc, k, o, f, l, ov, po, ow, sf]) => {
        if (!live) return
        setPosition(p); setCycles(c); setCash(cc); setKept(k); setOpening(o); setFirm(f); setLines(l)
        setOverpaid(ov); setOutList(po); setOwing(ow); setSwordfish(sf)
      })
      .catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-slate-400 text-sm py-10">
        <Loader2 size={16} className="animate-spin" /> Reading the trust account…
      </div>
    )
  }
  if (error) {
    return (
      <Card className="p-5 text-sm text-negative-700 bg-negative-50 border-negative-100">
        The trust account could not be read: {error}
      </Card>
    )
  }
  /* NO ROW MEANS NOT ALLOWED, NOT EMPTY (trust_position's guard is a where clause). */
  if (!position) {
    return (
      <Card className="p-5 text-sm text-slate-500">
        The trust account is not yours to see. Ask an administrator if you need it.
      </Card>
    )
  }

  const today = clockToday()
  /* ACCOUNTED FOR IS THE MONEY IN THE BANK WITH AN OWNER (10 Oct), one function shared with the
     Not accounted for list so the two can never disagree. */
  const accounted = accountedFromCash(cash, swordfishLeft(swordfish))
  const head = trustHeadline({
    trustCash: position.trustCash, owners: accounted, unidentified: position.unidentified,
    difference: r2(position.trustCash - accounted - position.unidentified),
  })
  const openingSet = Boolean(opening?.asAt)
  const holdings = currentHoldings({
    cash, firm, kept: kept?.amount ?? 0, swordfish,
    label: (c) => cycleLabel(c.periodStart, c.periodEnd), payDay: longDate,
  })
  const credits = lines.filter((l) => l.direction === 'credit')
  const todo = todoItems({
    notAccounted: head.notAccounted,
    suspense: { count: credits.length, amount: r2(credits.reduce((t, l) => t + l.amount, 0)) },
    linesToAllocate: lines.filter((l) => l.direction === 'debit').length,
    overpaymentsToDecide: overpaid,
    overduePayovers: overdueCycles(cycles, today).map((c) => ({ label: cycleLabel(c.periodStart, c.periodEnd), amount: c.toClients })),
    paymentsOut: {
      ready: outList.filter(canPay).length,
      readyAmount: r2(outList.filter(canPay).reduce((t, p) => t + p.amount, 0)),
      pending: outList.filter((p) => !canPay(p)).length,
    },
    clientsOwe: { count: owing.length, total: r2(owing.reduce((t, o) => t + o.total, 0)) },
    firmDrawable: firm?.drawable ?? 0,
  })

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-800">Trust overview</h1>
          <p className="text-sm text-slate-500 mt-1">Today: whose money is in the account, and what needs doing</p>
        </div>
        {/* A STATEMENT, NOT A PICKER: the position is today's. History is on Bank statement. */}
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700">
          As at {longDate(today)}
        </div>
      </div>

      {/* THE MONEY FIRST, THEN HOW MUCH OF IT HAS A NAME ON IT (the firm, 10 Oct). */}
      <div className="rounded-2xl bg-navy-950 text-white px-6 sm:px-8 py-6 grid grid-cols-1 sm:grid-cols-3 gap-6" data-testid="trust-headline">
        <div>
          <Figure label="In the trust account" value={rand(head.inTrust)} />
          <div className={clsx('mt-2 text-xs', openingSet ? 'text-slate-300' : 'text-amber-300 font-semibold')}>
            {openingSet && opening?.amount !== null && opening?.asAt
              ? `Opening ${rand(opening.amount)} at ${longDate(opening.asAt)}, plus statements since`
              : 'Statement lines only \u2014 no opening balance captured'}
          </div>
        </div>
        <div>
          <Figure label="Accounted for" value={rand(head.accounted)} />
          <div className="mt-2 text-xs text-slate-300">Clients, Bredell Ferreira and debtors{swordfishLeft(swordfish) !== 0 ? ', and what Swordfish still pays' : ''}</div>
        </div>
        {/* THE FIGURE OPENS EVERY ITEM BEHIND IT (S7). */}
        <Link to="/trust/unaccounted" data-testid="open-unaccounted" className="block rounded-xl -m-2 p-2 hover:bg-white/5 transition-colors">
          <Figure label="Not accounted for" value={rand(head.notAccounted)}
            tone={head.notAccounted === 0 ? undefined : head.notAccounted < 0 ? 'text-negative-300' : 'text-amber-300'} />
          <div className={clsx('mt-2 text-xs font-semibold',
            head.notAccounted === 0 ? 'text-positive-100' : head.notAccounted < 0 ? 'text-negative-300' : 'text-amber-300')}>
            {head.notAccounted === 0 ? 'Every rand has an owner'
              : head.notAccounted < 0 ? 'Bank holds less than the books owe' : 'Needs placing or explaining'}
            {head.notAccounted !== 0 && <span className="ml-1 underline underline-offset-2">· See every item</span>}
          </div>
        </Link>
      </div>

      <section>
        <h2 className="text-xl font-semibold tracking-tight text-slate-800">What is in the trust account</h2>
        <p className="text-sm text-slate-500 mt-1">
          Only money in the account today. Payovers already paid and the firm&rsquo;s transfers are history, on Bank statement and the Trust ledger.
        </p>

        <div className="mt-4 grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          <Card className="lg:col-span-7 px-6 py-2"><div data-testid="holdings">
            {holdings.length === 0 && <p className="py-6 text-center text-sm text-slate-500">Nothing is held for anybody.</p>}
            {holdings.map((h) => (
              <Owner key={h.key} who={h.who} what={h.what} amount={h.amount} to={h.to} />
            ))}
            {/* Ownership-block markers kept for the rule checks: the totals, then what has no owner. */}
            <Subtotal label="Total accounted for" value={head.accounted} />
            {head.notAccounted !== 0 && (
              <Link to="/trust/unaccounted" className="block">
                <Owner who="Not accounted for" what="Needs placing or explaining, see every item" amount={head.notAccounted} />
              </Link>
            )}
            <Subtotal label="Total not accounted for" value={head.notAccounted} />
            <Subtotal label="In the trust account" value={head.inTrust} strong />
          </div></Card>

          {/*
            WHAT NEEDS DOING, INSTEAD OF A RECONCILIATION CARD (the firm, 13 Oct: "the ownership
            reconciliation, is that really necessary ... isn't there anything better"). Each line is
            a job and opens where it is done; nothing to do says so plainly.
          */}
          <Card className="lg:col-span-5 px-6 py-5"><div data-testid="needs-doing">
            <div className="flex items-center justify-between gap-3">
              <div className="text-lg font-semibold text-slate-800">Needs doing</div>
              <span className={clsx('rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold whitespace-nowrap',
                todo.some((t) => t.tone === 'bad') ? 'bg-negative-50 text-negative-700'
                  : todo.some((t) => t.tone === 'warn') ? 'bg-amber-100 text-amber-800' : 'bg-positive-50 text-positive-700')}>
                {todo.some((t) => t.tone === 'bad') ? 'Does not balance' : todo.some((t) => t.tone === 'warn') ? 'Work to sort' : 'Balances'}
              </span>
            </div>
            {todo.length === 0 ? (
              <p className="mt-4 text-[13.5px] text-positive-700">Nothing. Bank and books agree, and nothing is waiting.</p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-100">
                {todo.map((t) => (
                  <li key={t.key} data-testid="todo-item">
                    <Link to={t.to} className="flex items-start gap-3 py-2.5 hover:bg-slate-50 -mx-2 px-2 rounded-lg">
                      <span className={clsx('mt-1.5 h-2 w-2 shrink-0 rounded-full',
                        t.tone === 'bad' ? 'bg-negative-500' : t.tone === 'warn' ? 'bg-amber-400' : 'bg-sky-400')} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13.5px] font-medium text-slate-800">{t.label}</span>
                        <span className="block text-[12.5px] text-slate-500">{t.detail}</span>
                      </span>
                      <ArrowRight size={14} className="mt-1 text-slate-400" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {!openingSet && head.notAccounted !== 0 && (
              <p className="mt-3 text-[13px] text-slate-600" data-testid="no-opening">
                No opening balance is captured, so the bank figure is only the statements imported so far.{' '}
                <Link to="/trust/settings" className="font-medium text-gold-700 hover:text-gold-800">Capture it in Trust settings</Link>.
              </p>
            )}
          </div></Card>
        </div>
      </section>
    </div>
  )
}

const r2 = (v: number): number => Math.round(v * 100) / 100

const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December']
/* Written out rather than through Intl: en-ZA abbreviates September to "Sept" (CLAUDE.md). */
function longDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${LONG_MONTHS[m - 1]} ${y}`
}

function Owner({ who, what, amount, lead, to }: {
  who: string; what: string; amount: number; lead?: boolean; to?: string
}) {
  const row = (
    /* THREE FIXED COLUMNS, so every amount sits on one right edge -- a column of money that
       wanders with the length of the words beside it cannot be read down. On a phone the
       description drops under the name. */
    <div className="grid grid-cols-[1fr_auto] sm:grid-cols-[minmax(9rem,11rem)_1fr_auto] items-baseline
      gap-x-4 gap-y-0.5 py-2.5 border-b border-slate-100 last:border-b-0">
      <div className="text-[14px] font-semibold text-slate-800">{who}</div>
      <div className="col-start-1 row-start-2 sm:col-start-2 sm:row-start-1 text-[12.5px] text-slate-500">{what}</div>
      <div className={clsx('col-start-2 row-start-1 sm:col-start-3 text-right text-[15px] font-semibold tabular-nums whitespace-nowrap',
        lead ? 'text-positive-700' : amount < 0 ? 'text-gold-800' : 'text-slate-800')}>
        {rand(amount)}
      </div>
    </div>
  )
  return to ? <Link to={to} className="block hover:bg-slate-50 -mx-2 px-2 rounded-lg">{row}</Link> : row
}

function Subtotal({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={clsx('flex items-baseline gap-4 py-2.5 border-t',
      strong ? 'border-slate-300' : 'border-slate-200')}>
      <div className="flex-1 text-xs font-bold uppercase tracking-wider text-slate-500">{label}</div>
      <div className={clsx('font-semibold tabular-nums text-slate-800', strong ? 'text-2xl' : 'text-lg')}>
        {rand(value)}
      </div>
    </div>
  )
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-300 mb-2">
        {label}
      </div>
      <div className={clsx('text-3xl lg:text-4xl font-semibold tabular-nums leading-none', tone)}>
        {value}
      </div>
    </div>
  )
}
