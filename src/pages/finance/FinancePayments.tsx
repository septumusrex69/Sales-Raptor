import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Loader2, Plus } from 'lucide-react'
import clsx from 'clsx'
import { Card } from '../../components/ui/Card'
import { FinanceTabs } from './FinanceTabs'
import { Modal, inputClass } from '../../components/ui/Modal'
import { supabase } from '../../lib/supabase'
import { rand } from '../../lib/money'
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
  debtor_accounts: { case_number: string | null; debtor_surname: string | null; debtor_first_name: string | null; company_id: string } | null
  payment_allocations: {
    receipt_fee_excl: number | null; receipt_fee_vat: number | null
    to_interest: number; to_costs: number | null; to_capital: number
    commission: number; commission_vat: number; to_client: number; due_to_bf: number
    status: string; payover_run_id: string | null
  }[] | null
}

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
        .select('id, received_at, created_at, amount, paid_to_client, reversed_at, reversal_reason, account_id,'
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
      <FinanceTabs />
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
        <div className="flex items-start gap-2 rounded-lg bg-rust-50 px-4 py-3 text-sm text-rust-700">
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
                const a = r.payment_allocations?.[0]
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
                      {!reversed && (
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
  const invoiced = Boolean(row.payment_allocations?.[0]?.payover_run_id)
  return (
    <Modal title="Reverse this payment" onClose={onClose} width={440}>
      <div className="space-y-3">
        <p className="text-[13px] text-slate-600">
          {rand(row.amount)} received {fmt(row.received_at)}. The receipt fee is cancelled, the
          capital goes back on the account, and every later payment is re-split against the balances
          this one moved.
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
        {error && <p className="rounded-lg bg-rust-50 px-3 py-2 text-[13px] text-rust-700">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
          <button type="button" onClick={onClose} className="rounded-lg px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
          <button type="button" disabled={busy || !reason.trim()}
            onClick={() => {
              setBusy(true); setError(null)
              void supabase.from('account_payments')
                .update({ reversed_at: new Date().toISOString(), reversal_reason: reason.trim() })
                .eq('id', row.id)
                .then(async ({ error: e }) => {
                  if (e) { setError(e.message); setBusy(false); return }
                  await onDone(); setBusy(false)
                })
            }}
            className="rounded-lg bg-rust-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-rust-700 disabled:opacity-50">
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
