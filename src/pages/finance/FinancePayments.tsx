import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Loader2, Plus } from 'lucide-react'
import clsx from 'clsx'
import { Card } from '../../components/ui/Card'
import { Modal, inputClass } from '../../components/ui/Modal'
import { supabase } from '../../lib/supabase'
import { rand } from '../../lib/money'
import { reversePayment } from '../../lib/payover'
import { useAppStore } from '../../store/AppStore'
import { BankImportCard } from './BankImportCard'
import { UnallocatedReceipts } from './UnallocatedReceipts'
import { RecordPaymentModal } from './RecordPaymentModal'
import { AwaitingApproval } from './AwaitingApproval'

/**
 * EVERY PAYMENT WITH ITS FULL ALLOCATION — the one screen where the whole split is visible.
 *
 * PAGED FROM THE DATABASE, every filter with it. The book is hundreds of thousands of rows and
 * this table joins three of its largest; a `.filter()` over what is on screen gives an answer that
 * is right about the page and wrong about the book, which is the failure CLAUDE.md names.
 *
 * REVERSING A PAYMENT ASKS WHY AND MEANS IT. The reason is written onto the payment, the receipt
 * fee is cancelled with it, the capital goes back -- including the part already inside an issued
 * invoice, which the replay may not touch -- and every later payment on the account is re-split
 * against the balances this one had moved. All of that is one trigger in the database; this screen
 * only has to ask the question.
 */

interface Row {
  id: string
  received_at: string
  created_at: string
  amount: number
  paid_to_client: boolean
  reversed_at: string | null
  reversal_reason: string | null
  account_id: string
  approved_at: string | null
  debtor_accounts: { case_number: string | null; debtor_surname: string | null; debtor_first_name: string | null; company_id: string } | null
  /**
   * THE SPLIT, AND IT ARRIVES AS AN OBJECT RATHER THAN A LIST.
   *
   * `payment_allocations.payment_id` is UNIQUE -- one split per payment, which is the rule -- and
   * PostgREST reads that index and decides the relationship is to-ONE. So the embed comes back as
   * a single object, not an array of one. Read with `?.[0]` it was undefined on every row, and the
   * table drew a dash in every money column of every payment on the book: receipt fee, interest,
   * costs, capital, commission, all of it, on payments that were approved and split hours earlier.
   *
   * TYPED AS BOTH because that is what can actually arrive: the shape follows an index, and an
   * index is the kind of thing that gets dropped and re-made. See `oneOf`.
   */
  payment_allocations: Allocation | Allocation[] | null
}

interface Allocation {
  receipt_fee_excl: number | null; receipt_fee_vat: number | null
  to_interest: number; to_costs: number | null; to_capital: number
  commission: number; commission_vat: number; to_client: number; due_to_bf: number
  status: string; payover_run_id: string | null
}

/** Whichever shape PostgREST chose. */
const oneOf = (a: Allocation | Allocation[] | null | undefined): Allocation | undefined =>
  (Array.isArray(a) ? a[0] : a ?? undefined)

const PAGE = 100

export function FinancePayments() {
  const { companies } = useAppStore()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [client, setClient] = useState('all')
  const [kind, setKind] = useState<'all' | 'trust' | 'ptc'>('all')
  const [page, setPage] = useState(0)
  const [reverseFor, setReverseFor] = useState<Row | null>(null)
  /* Bumped whenever an import or a placement changes the ledger, so the queue and the table below
     reload together rather than disagreeing about what has been placed. */
  const [imported, setImported] = useState(0)
  const [recording, setRecording] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      let q = supabase
        .from('account_payments')
        .select('id, received_at, created_at, amount, paid_to_client, reversed_at, reversal_reason, account_id, approved_at,'
          + ' debtor_accounts!inner(case_number, debtor_surname, debtor_first_name, company_id),'
          + ' payment_allocations(receipt_fee_excl, receipt_fee_vat, to_interest, to_costs, to_capital,'
          + ' commission, commission_vat, to_client, due_to_bf, status, payover_run_id)')
        .eq('is_demo', false)
        .order('created_at', { ascending: false })
        .range(page * PAGE, page * PAGE + PAGE - 1)
      if (client !== 'all') q = q.eq('debtor_accounts.company_id', client)
      if (kind !== 'all') q = q.eq('paid_to_client', kind === 'ptc')
      const { data, error: e } = await q
      if (e) throw new Error(e.message)
      setRows((data ?? []) as unknown as Row[])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the payments.')
    } finally { setLoading(false) }
  }, [client, kind, page])

  useEffect(() => { void load() }, [load])

  const clientName = useMemo(
    () => (id: string | undefined) => companies.find((c) => c.id === id)?.name ?? '',
    [companies],
  )

  return (
    <div className="space-y-4">
      {/*
        THE IMPORT COMES FIRST, above the ledger it fills. This screen already listed every
        payment with its full allocation and could reverse one; what it could not do was record a
        payment arriving, which is why the firm asked where to import payments and the answer was
        nowhere. The list below is the same list -- what changed is that something now puts rows
        in it other than the Swordfish migration.
      */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-slate-500">
          {/*
            SAID HERE BECAUSE IT IS THE THING PEOPLE GET WRONG. A statement only ever carries money
            that reached the firm's own bank; a debtor who paid the CLIENT direct never appears on
            one, so a PTC has to be typed.
          */}
          Money the firm received comes in on the statement. A PTC never will — the debtor paid the
          client, so it has to be recorded by hand.
        </p>
        <button type="button" onClick={() => setRecording(true)}
          className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg
            border border-gold-500 bg-gold-400 text-navy-950 hover:bg-gold-500">
          <Plus size={14} /> Record a payment
        </button>
      </div>
      {/*
        WAITING FOR APPROVAL COMES FIRST, above the import and above the ledger. It is the day's
        work: money arrives, somebody checks what each payment would do, and approves it. Nothing
        below this has happened until they do.
      */}
      <AwaitingApproval refreshKey={imported} onApproved={() => { setImported((n) => n + 1); void load() }} />
      <BankImportCard onImported={() => { setImported((n) => n + 1); void load() }} />
      <UnallocatedReceipts refreshKey={imported} onPlaced={() => { setImported((n) => n + 1); void load() }} />
      {recording && (
        <RecordPaymentModal onClose={() => setRecording(false)}
          onDone={async () => { setImported((n) => n + 1); await load() }} />
      )}
      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-negative-50 px-4 py-3 text-sm text-negative-700">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /><span>{error}</span>
        </div>
      )}
      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
          <select value={client} onChange={(e) => { setClient(e.target.value); setPage(0) }}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <option value="all">Every client</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={kind} onChange={(e) => { setKind(e.target.value as typeof kind); setPage(0) }}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <option value="all">Trust and client-direct</option>
            <option value="trust">Paid into the trust account</option>
            <option value="ptc">Paid to the client directly</option>
          </select>
          <span className="ml-auto text-xs text-slate-400">Page {page + 1}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px]">
            <thead>
              <tr className="border-b border-slate-100 text-left text-[11.5px] font-medium uppercase tracking-[0.06em] text-slate-400">
                <th className="px-4 py-2.5">Debtor</th>
                <th className="px-4 py-2.5">Captured</th>
                <th className="px-4 py-2.5 text-right">Gross</th>
                <th className="px-4 py-2.5 text-right">Receipt fee</th>
                <th className="px-4 py-2.5 text-right">Interest</th>
                <th className="px-4 py-2.5 text-right">Costs</th>
                <th className="px-4 py-2.5 text-right">Capital</th>
                <th className="px-4 py-2.5 text-right">Commission</th>
                <th className="px-4 py-2.5 text-right">To client / due BF</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={10} className="px-4 py-10 text-center"><Loader2 className="mx-auto w-5 h-5 animate-spin text-slate-400" /></td></tr>}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={10} className="px-4 py-10 text-center text-sm text-slate-400">No payments match that.</td></tr>
              )}
              {!loading && rows.map((r) => {
                const a = oneOf(r.payment_allocations)
                const waiting = !r.approved_at && !r.reversed_at
                const reversed = Boolean(r.reversed_at)
                return (
                  <tr key={r.id} className={clsx('border-b border-slate-50 text-sm', reversed && 'text-slate-400 line-through')}>
                    <td className="px-4 py-2.5">
                      <Link to={`/accounts/${r.account_id}`} className="font-medium hover:underline">
                        {[r.debtor_accounts?.debtor_first_name, r.debtor_accounts?.debtor_surname].filter(Boolean).join(' ') || 'Unnamed debtor'}
                      </Link>
                      <div className="text-xs text-slate-400">
                        {r.debtor_accounts?.case_number} · {clientName(r.debtor_accounts?.company_id)}
                        {r.paid_to_client && ' · paid the client directly'}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{fmt(r.created_at)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{rand(r.amount)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{a ? rand((a.receipt_fee_excl ?? 0) + (a.receipt_fee_vat ?? 0)) : '—'}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{a ? rand(a.to_interest) : '—'}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{a ? rand(a.to_costs ?? 0) : '—'}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{a ? rand(a.to_capital) : '—'}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{a ? rand(a.commission + a.commission_vat) : '—'}</td>
                    <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                      {a ? rand(r.paid_to_client ? a.due_to_bf : a.to_client) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {/*
                        AN UNAPPROVED PAYMENT SAYS SO, and is not offered a Reverse.
                        THE FIRM, ON CAPTURING ONE AND SEEING IT APPEAR HERE STRAIGHT AWAY: "should
                        it go in there already? Or should it wait to be approved before it goes
                        there?"
                        IT BELONGS HERE -- this list is the book, and a payment that is invisible
                        until somebody approves it is a payment the person who captured it cannot
                        find and captures again. What it must not do is look the same as one that
                        has moved money. Its money columns are empty because there IS no split
                        yet, which reads as a fault rather than a state unless the row says which.
                        AND NOTHING TO REVERSE: no fee raised, no capital moved, no remittance. It
                        is taken out of the queue above instead, which is the act that fits.
                      */}
                      {waiting && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-900">
                          Waiting for approval
                        </span>
                      )}
                      {!reversed && !waiting && (
                        <button type="button" onClick={() => setReverseFor(r)}
                          className="rounded-lg border border-slate-200 px-2.5 py-1 text-[12px] font-medium text-slate-600 hover:bg-slate-100">
                          Reverse
                        </button>
                      )}
                      {reversed && <span className="text-[11px]">{r.reversal_reason}</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-4 py-3">
          <button type="button" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-[13px] disabled:opacity-40">Back</button>
          <button type="button" disabled={rows.length < PAGE} onClick={() => setPage((p) => p + 1)}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-[13px] disabled:opacity-40">Next 100</button>
        </div>
      </Card>

      {reverseFor && (
        <ReverseModal
          row={reverseFor}
          onClose={() => setReverseFor(null)}
          onDone={async () => { setReverseFor(null); await load() }}
        />
      )}
    </div>
  )
}

/**
 * REVERSING ASKS WHY, AND THE ANSWER IS KEPT.
 *
 * It becomes the cancellation reason on the receipt fee -- so the account's own ledger says a fee
 * was raised and then cancelled because the cheque came back, rather than the fee simply
 * vanishing. Everything else follows in the database.
 */
function ReverseModal({ row, onClose, onDone }: { row: Row; onClose: () => void; onDone: () => Promise<void> }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /* THE SAME MISREAD SILENCED THIS. `?.[0]` on an object is undefined, so the warning that this
     payment is already inside an issued invoice never drew -- on any payment, ever. */
  const invoiced = Boolean(oneOf(row.payment_allocations)?.payover_run_id)
  return (
    <Modal title="Reverse this payment" onClose={onClose} width={440}>
      <div className="space-y-3">
        <p className="text-[13px] text-slate-600">
          {rand(row.amount)} received {fmt(row.received_at)}. The receipt fee is cancelled, the
          capital goes back on the account, and every later payment is re-split against the balances
          this one moved.
        </p>
        {/*
          WHERE THE MONEY GOES, which the firm asked about directly: "not really the suspense
          account -- it goes back into a state ready for approval." Said here because it is the
          difference between a reversal that loses the receipt and one that hands it back to be
          redone, and nobody should have to find that out by looking afterwards.
        */}
        <p className="rounded-lg bg-brand-50 px-3 py-2 text-[13px] text-slate-700">
          This receipt then comes back to <strong className="font-medium">Awaiting approval</strong>{' '}
          as {rand(row.amount)} still to be placed, so it can go on the right debtor and be approved
          again. This reversal stays on the ledger with your reason on it.
        </p>
        {invoiced && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
            This payment has already been paid over. The invoice that carried it is not touched —
            the correction becomes a negative line in the client&rsquo;s next run.
          </p>
        )}
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Why</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass}
            placeholder="Cheque returned, debit order unpaid, captured twice…" />
        </div>
        {error && <p className="rounded-lg bg-negative-50 px-3 py-2 text-[13px] text-negative-700">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
          <button type="button" onClick={onClose} className="rounded-lg px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
          {/*
            THROUGH THE FUNCTION, NOT AT THE TABLE.

            This used to PATCH account_payments directly, and account_payments is one of the four
            ledgers that carry no update policy on purpose. Postgres does not refuse such a write;
            RLS MATCHES NO ROWS. PostgREST answers 204, `error` is null, the box closes and the
            list reloads -- and the payment is exactly as it was. The firm would have read that as
            a reversal that worked, with the account still credited for money that came back.

            `reverse_payment` is Administrator-only and keeps the reason. Everything that follows
            -- the receipt fee cancelled, the capital given back, the later payments re-split --
            is the trigger on reversed_at, as it always was.
          */}
          <button type="button" disabled={busy || !reason.trim()}
            onClick={() => {
              setBusy(true); setError(null)
              void reversePayment(row.id, reason.trim())
                .then(async () => { await onDone(); setBusy(false) })
                .catch((e: unknown) => {
                  setError(e instanceof Error ? e.message : 'That payment could not be reversed.')
                  setBusy(false)
                })
            }}
            className="rounded-lg bg-negative-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-negative-700 disabled:opacity-50">
            {busy ? 'Reversing…' : 'Reverse it'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
}
