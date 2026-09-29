import { useEffect, useState } from 'react'
import { AlertTriangle, Check, Loader2, Plus, Search, X } from 'lucide-react'
import { Modal, inputClass } from '../../components/ui/Modal'
import { rand } from '../../lib/money'
import { formatDate } from '../../data/mockData'
import { fetchAccounts, type DebtorAccount } from '../../lib/accountBook'
import { splitBankLine } from '../../lib/recordPayment'
import type { UnallocatedReceipt } from '../../lib/payover'

/**
 * ONE RECEIPT, SEVERAL DEBTORS.
 *
 * THE FIRM: "this would happen for us in case we have, for example, debt counsellors that pay one
 * payment for five different debtors."
 *
 * THE RUNNING REMAINDER IS THE WHOLE SCREEN. A split has to account for every cent: short, and
 * money the bank received belongs to nobody; over, and the firm has credited debtors with more
 * than arrived and will remit clients for it. Neither is recoverable once a remittance has gone
 * out, because a payment cannot be deleted. So the figure that is always on screen is what is
 * LEFT, and the button will not light until it is nothing.
 *
 * THE DATABASE REFUSES AN UNBALANCED SPLIT ANYWAY -- this only means somebody is never surprised
 * by that refusal after typing five rows.
 */
export function SplitReceiptModal({ receipt, onClose, onDone }: {
  receipt: UnallocatedReceipt
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const [parts, setParts] = useState<{ account: DebtorAccount; amount: string }[]>([])
  const [term, setTerm] = useState('')
  const [hits, setHits] = useState<DebtorAccount[]>([])
  const [looking, setLooking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const q = term.trim()
    if (q.length < 2) { setHits([]); return }
    let cancelled = false
    setLooking(true)
    const t = setTimeout(() => {
      void fetchAccounts({ search: q, pageSize: 8, countRows: false })
        .then((r) => { if (!cancelled) setHits(r.accounts) })
        .catch(() => { if (!cancelled) setHits([]) })
        .finally(() => { if (!cancelled) setLooking(false) })
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [term])

  const allocated = parts.reduce((n, p) => n + (Number(p.amount.replace(/[^\d.]/g, '')) || 0), 0)
  /* Cents, not rands: comparing two floats for equality is how a split that looks balanced is
     refused by the database for a hundredth of a cent nobody can see. */
  const leftCents = Math.round(receipt.amount * 100) - Math.round(allocated * 100)
  const balanced = leftCents === 0 && parts.length >= 2

  function add(account: DebtorAccount) {
    if (parts.some((p) => p.account.id === account.id)) return
    /* THE REMAINDER IS OFFERED AS THE AMOUNT, because on the last row it is always the answer and
       on the others it is the sensible starting point. */
    const remaining = Math.max(leftCents, 0) / 100
    setParts((p) => [...p, { account, amount: remaining > 0 ? remaining.toFixed(2) : '' }])
    setTerm(''); setHits([])
  }

  async function save() {
    if (!balanced || busy) return
    setBusy(true); setError(null)
    try {
      await splitBankLine(receipt.id, parts.map((p) => ({
        accountId: p.account.id,
        amount: Number(p.amount.replace(/[^\d.]/g, '')),
      })))
      await onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That split could not be recorded.')
      setBusy(false)
    }
  }

  return (
    <Modal title="Split this receipt" onClose={onClose} width={560}>
      <div className="space-y-3">
        <div className="rounded-lg bg-slate-50 px-3 py-2.5">
          <p className="text-[15px] font-semibold tabular-nums text-navy-950">{rand(receipt.amount)}</p>
          <p className="text-[12px] text-slate-600 mt-0.5 wrap-anywhere">{receipt.description}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">Received {formatDate(receipt.txnDate)}</p>
        </div>

        {parts.length > 0 && (
          <ul className="space-y-1.5">
            {parts.map((p, i) => (
              <li key={p.account.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] text-slate-800 truncate">
                    {[p.account.debtorFirstName, p.account.debtorSurname].filter(Boolean).join(' ') || 'No name'}
                  </span>
                  <span className="block text-[11px] text-slate-500">
                    {p.account.caseNumber} · {p.account.accountNumber}
                  </span>
                </span>
                <input value={p.amount} inputMode="decimal" placeholder="0.00"
                  onChange={(e) => setParts((all) =>
                    all.map((x, n) => (n === i ? { ...x, amount: e.target.value } : x)))}
                  className={`${inputClass} w-28 text-right tabular-nums`} />
                <button type="button" onClick={() => setParts((all) => all.filter((_, n) => n !== i))}
                  className="text-slate-400 hover:text-slate-700" title="Take this account off">
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* ---- what is left ---- */}
        <div className={`flex items-baseline justify-between rounded-lg px-3 py-2 ${
          balanced ? 'bg-positive-50' : leftCents < 0 ? 'bg-negative-50' : 'bg-amber-50'}`}>
          <span className="text-[12px] text-slate-600">
            {leftCents === 0 ? 'Every cent accounted for'
              : leftCents > 0 ? 'Still to allocate'
                : 'Over the payment by'}
          </span>
          <span className={`text-[15px] font-semibold tabular-nums ${
            balanced ? 'text-[var(--c-green)]' : leftCents < 0 ? 'text-negative-700' : 'text-amber-800'}`}>
            {rand(Math.abs(leftCents) / 100)}
          </span>
        </div>

        <label className="block">
          <span className="text-sm font-medium text-slate-700">Add an account</span>
          <span className="relative block mt-1">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={term} onChange={(e) => setTerm(e.target.value)}
              placeholder="Case number, account number, reference or surname"
              className={`${inputClass} pl-8`} />
          </span>
        </label>
        {looking && <p className="text-[12px] text-slate-400">Looking…</p>}
        {hits.length > 0 && (
          <ul className="max-h-44 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
            {hits.map((a) => (
              <li key={a.id}>
                <button type="button" onClick={() => add(a)}
                  className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2">
                  <Plus size={12} className="text-slate-400 shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-[13px] text-slate-800 truncate">
                      {[a.debtorFirstName, a.debtorSurname].filter(Boolean).join(' ') || 'No name'}
                    </span>
                    <span className="block text-[11px] text-slate-500">
                      {a.caseNumber} · {a.accountNumber} · {rand(a.capitalOutstanding)} outstanding
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* A SPLIT OF ONE IS NOT A SPLIT, and the database says so too -- said here first so
            nobody types an amount and then reads a refusal. */}
        {parts.length === 1 && (
          <p className="text-[12px] text-slate-500">
            One account is not a split. Add another, or close this and use Place it.
          </p>
        )}

        {error && (
          <p className="flex items-start gap-1.5 text-[13px] text-negative-700">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /><span>{error}</span>
          </p>
        )}

        {balanced && (
          <p className="text-[12px] text-slate-500">
            This records {parts.length} payments. Each one waits for approval like any other, and
            all of them stay linked to this deposit.
          </p>
        )}

        <div className="flex items-center gap-2 pt-1">
          <button type="button" onClick={() => void save()} disabled={!balanced || busy}
            className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg
              bg-brand-600 text-white disabled:opacity-40">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
            {busy ? 'Splitting…' : `Split between ${parts.length || 0}`}
          </button>
          <button type="button" onClick={onClose} className="text-sm text-slate-600 hover:text-slate-800 px-2">
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  )
}
