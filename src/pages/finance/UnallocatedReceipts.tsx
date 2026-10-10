import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Check, Loader2, Search } from 'lucide-react'
import { Card, CardHeader } from '../../components/ui/Card'
import { Modal, inputClass } from '../../components/ui/Modal'
import { rand } from '../../lib/money'
import { formatDate } from '../../data/mockData'
import { fetchAccounts, type DebtorAccount } from '../../lib/accountBook'
import { SplitReceiptModal } from './SplitReceiptModal'
import {
  fetchUnallocatedReceipts, placeBankLine,
  fetchUnreconciledPayouts, reconcileBankDebit,
  fetchSuspendedPayments, releasePaymentFromSuspense, setPaymentAccount,
  type UnallocatedReceipt, type UnreconciledPayout, type SuspendedPayment,
} from '../../lib/payover'

/**
 * MONEY IN THE TRUST ACCOUNT THAT NOBODY HAS PLACED YET.
 *
 * THE FIRM CHOSE THE QUEUE over skipping these. Roughly a fifth of the firm's receipts arrive
 * with a depositor's name where the account number should be -- "CAPITEC L SOLOMONS" -- and no
 * rule turns that into an account. They are not a parsing failure: they are somebody's money,
 * sitting in the firm's trust account, belonging to a debtor nobody has identified.
 *
 * WHY THE TOTAL IS AT THE TOP. Until a receipt is placed, the debtor is not credited and the
 * client is not remitted -- so a debtor who has paid stays on the book and may be chased for a
 * debt they settled. The figure is the firm's own measure of how much is in that state, and it is
 * the reason this list is a screen rather than a report somebody runs.
 *
 * NOTHING IS GUESSED. The search is the same one the accounts list uses, and placing a receipt is
 * a person deciding. A wrong placement credits the wrong debtor AND remits the wrong client, and
 * a payment is immutable once processed -- reversal leaves both rows on the ledger for ever.
 */
export function UnallocatedReceipts({ refreshKey, onPlaced, onTotals }: {
  refreshKey: number
  onPlaced: () => void
  /** What is unmatched or in suspense, for the overview tile on Payments in -- read once here. */
  onTotals?: (count: number, total: number) => void
}) {
  const [rows, setRows] = useState<UnallocatedReceipt[]>([])
  const [payouts, setPayouts] = useState<UnreconciledPayout[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [placing, setPlacing] = useState<UnallocatedReceipt | null>(null)
  const [splitting, setSplitting] = useState<UnallocatedReceipt | null>(null)
  const [tying, setTying] = useState<string | null>(null)
  /*
   * THE OTHER HALF OF SUSPENSE, and it is a different kind of thing from the list above.
   *
   * A bank line up there has never been attributed to anybody. These were attributed and then
   * un-attributed -- somebody looked at the approval queue, decided the account was wrong and
   * parked it. The firm asked for the button that puts them here: "otherwise you have to go and
   * look for it in suspense and allocate it later."
   */
  const [parked, setParked] = useState<SuspendedPayment[]>([])
  const [placingParked, setPlacingParked] = useState<SuspendedPayment | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [r, p, sp] = await Promise.all([
        fetchUnallocatedReceipts(), fetchUnreconciledPayouts(), fetchSuspendedPayments(),
      ])
      setRows(r); setPayouts(p); setParked(sp)
      /* BOTH HALVES OF SUSPENSE: receipts never attributed, and receipts parked off the queue. */
      onTotals?.(r.length + sp.length, r.reduce((n, x) => n + x.amount, 0) + sp.reduce((n, x) => n + x.amount, 0))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the unplaced receipts.')
    } finally { setLoading(false) }
  }, [onTotals])
  useEffect(() => { void load() }, [load, refreshKey])

  async function tie(lineId: string, runId: string) {
    setTying(lineId); setError(null)
    try {
      await reconcileBankDebit(lineId, runId)
      await load(); onPlaced()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That payment out could not be tied to the run.')
    } finally { setTying(null) }
  }

  const waiting = rows.reduce((n, r) => n + r.amount, 0)

  return (
    <>
      <Card padded={false} className="border-t-[3px] border-t-gold-400">
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 px-5 py-4">
          <div>
            {/*
              SUSPENSE, AND THE NAME ON THE SCREEN IS THE FIRM'S MOCK-UP'S: "Needs an account". The
              firm's own word for the pot is suspense -- "all payments that do not have reference
              numbers go into something we call the suspense account" -- and it is still said in
              the line under it. It is a LIST rather than a standing account in the book: asked
              directly, the firm chose the queue, and no money is posted to a debtor until somebody
              places it.
            */}
            <h3 className="text-[16px] font-semibold text-slate-800">Needs an account</h3>
            <p className="text-[12.5px] text-slate-500">
              Receipts held in suspense until matched to an account. Until one is placed the debtor
              is not credited and the client is not remitted.
            </p>
          </div>
          {rows.length + parked.length > 0 && (
            <span className="text-right">
              {/* THE BALANCE IS THE POINT AS MUCH AS THE LIST: it is the firm's own measure of how
                  much is sitting in trust belonging to nobody yet. */}
              <span className="inline-block rounded-md bg-amber-50 px-2 py-0.5 text-[12px] font-medium text-amber-800">
                {rows.length + parked.length} to resolve
              </span>
              {rows.length > 0 && (
                <span className="mt-1 block text-[13px] font-semibold tabular-nums text-amber-700">{rand(waiting)}</span>
              )}
            </span>
          )}
        </div>

        {error && (
          <div className="flex items-start gap-2 bg-negative-50 px-4 py-2.5 text-[13px] text-negative-700">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /><span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="py-8 text-center"><Loader2 className="mx-auto w-4 h-4 animate-spin text-slate-400" /></div>
        ) : rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-[13px] text-slate-500">
            Nothing needs an account. Every receipt imported has been placed.
          </p>
        ) : (
          <table className="w-full text-[12.5px] whitespace-nowrap">
            <thead className="text-[11px] uppercase tracking-wide text-slate-500">
              <tr className="border-b border-slate-100">
                <th className="px-4 py-2 text-left font-medium">Received</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
                <th className="px-3 py-2 text-left font-medium">What the bank said</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-50">
                  <td className="px-4 py-2 text-slate-600 whitespace-nowrap">{formatDate(r.txnDate)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium text-slate-800">{rand(r.amount)}</td>
                  <td className="px-3 py-2 text-slate-600">
                    <span className="wrap-anywhere">{r.description}</span>
                    {/*
                      THE TWO REASONS A RECEIPT IS HERE ARE DIFFERENT PROBLEMS. No reference means
                      recognising a name. A reference that IS here and still unplaced means it
                      matched more than one account -- and that is the one to slow down on,
                      because both candidates look right.
                    */}
                    {r.hadReference && (
                      <span className="ml-2 text-[11px] text-amber-700">
                        {r.reference} matched more than one account
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span className="inline-flex gap-1.5">
                      <button type="button" onClick={() => setPlacing(r)}
                        className="text-xs font-medium px-2.5 py-1 rounded-md border border-slate-200
                          text-slate-600 hover:border-[#c9a052] hover:bg-gold-50">
                        Place it
                      </button>
                      {/* ONE DEPOSIT, SEVERAL DEBTORS -- a debt counsellor paying for five. */}
                      <button type="button" onClick={() => setSplitting(r)}
                        className="text-xs font-medium px-2.5 py-1 rounded-md border border-slate-200
                          text-slate-600 hover:border-[#c9a052] hover:bg-gold-50">
                        Split it
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* ---------------- receipts somebody parked off the approval queue ---------------- */}
      {/*
        ITS OWN CARD, NOT MIXED INTO THE LIST ABOVE, because they are different problems wearing
        one word. A bank line up there needs somebody to RECOGNISE a depositor. One of these needs
        somebody to DECIDE which debtor it belongs to -- it was already on one, and a person looked
        at it and said no. The words they left are the whole of what the next person has to go on,
        which is why the reason is required to park it and is the widest column here.
      */}
      {parked.length > 0 && (
        <Card padded={false}>
          <CardHeader title="Parked off the approval queue"
            subtitle="Somebody had these in front of them and would not approve them where they sat. They are still recorded against that account until they are placed." />
          <table className="w-full text-[12.5px] whitespace-nowrap">
            <thead className="text-[11px] uppercase tracking-wide text-slate-500">
              <tr className="border-b border-slate-100">
                <th className="px-4 py-2 text-left font-medium">Received</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
                <th className="px-3 py-2 text-left font-medium">Sitting on</th>
                <th className="px-3 py-2 text-left font-medium">Why it was parked</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {parked.map((r) => (
                <tr key={r.paymentId} className="border-b border-slate-50">
                  <td className="px-4 py-2 text-slate-600 whitespace-nowrap">{formatDate(r.receivedOn)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium text-slate-800">{rand(r.amount)}</td>
                  <td className="px-3 py-2 text-slate-600 whitespace-nowrap">
                    {r.caseNumber ?? '—'}
                    {r.debtor && <span className="block text-[11px] text-slate-400 truncate max-w-[10rem]">{r.debtor}</span>}
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    <span className="wrap-anywhere">{r.reason ?? '—'}</span>
                    {/* AND WHY IT CAME BACK, where a reversal put it in the queue in the first
                        place. Two different people wrote those two sentences and the second one
                        only makes sense beside the first. */}
                    {r.cameBackReason && (
                      <span className="block text-[11px] text-amber-700 mt-0.5">
                        Reversed — {r.cameBackReason}
                      </span>
                    )}
                    <span className="block text-[11px] text-slate-400 mt-0.5">
                      Parked {formatDate(r.suspendedOn)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <span className="inline-flex gap-1.5">
                      <button type="button" onClick={() => setPlacingParked(r)}
                        className="text-xs font-medium px-2.5 py-1 rounded-md border border-slate-200
                          text-slate-600 hover:border-[#c9a052] hover:bg-gold-50">
                        Place it
                      </button>
                      {/* BACK TO THE QUEUE, for one parked by mistake. Without it the only way out
                          is placing it somewhere, which is how a receipt ends up on an account
                          chosen to clear a list. */}
                      <button type="button"
                        onClick={async () => {
                          await releasePaymentFromSuspense(r.paymentId)
                          await load(); onPlaced()
                        }}
                        className="text-xs font-medium px-2.5 py-1 rounded-md text-slate-400
                          hover:text-slate-700 underline underline-offset-2">
                        Back to the queue
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* ---------------- money out, waiting to be tied to a run ---------------- */}
      {payouts.length > 0 && (
        <Card padded={false}>
          <CardHeader title="Payments out, not yet tied to a run"
            subtitle="Confirming one against the run it settles marks that run paid — witnessed by the bank rather than asserted." />
          <table className="w-full text-[12.5px] whitespace-nowrap">
            <tbody>
              {payouts.map((p) => (
                <tr key={p.id} className="border-t border-slate-50">
                  <td className="px-4 py-2 text-slate-600 whitespace-nowrap">{formatDate(p.txnDate)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium text-slate-800">{rand(Math.abs(p.amount))}</td>
                  <td className="px-3 py-2 text-slate-600 wrap-anywhere">{p.description}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {/*
                      A RUN IS OFFERED ONLY WHERE THE AMOUNTS ALREADY AGREE EXACTLY -- the database
                      refuses anything else. So this is a confirmation of which client, not a
                      judgement about whether the figure is close enough.
                    */}
                    {p.candidateRun ? (
                      <button type="button" disabled={tying === p.id}
                        onClick={() => void tie(p.id, p.candidateRun as string)}
                        className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md
                          border border-slate-200 text-slate-600 hover:border-[#c9a052] hover:bg-gold-50 disabled:opacity-40">
                        {tying === p.id ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                        {p.candidateInvoice} · {p.candidateClient}
                      </button>
                    ) : (
                      <span className="text-[11px] text-slate-400">No run of this amount</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {placing && (
        <PlaceModal
          title="Place this receipt"
          summary={{
            amount: placing.amount, description: placing.description, receivedOn: placing.txnDate,
          }}
          onPlace={async (accountId) => { await placeBankLine(placing.id, accountId) }}
          onClose={() => setPlacing(null)}
          onDone={async () => { setPlacing(null); await load(); onPlaced() }} />
      )}

      {/* AND PLACING A PARKED ONE IS set_payment_account, which clears the parking as it goes --
          a receipt that has just been given the right account is not in suspense any more. */}
      {placingParked && (
        <PlaceModal
          title="Place this parked receipt"
          summary={{
            amount: placingParked.amount,
            description: placingParked.reference ?? placingParked.details ?? 'No reference',
            receivedOn: placingParked.receivedOn,
            note: placingParked.reason,
          }}
          onPlace={(accountId) => setPaymentAccount(placingParked.paymentId, accountId)}
          onClose={() => setPlacingParked(null)}
          onDone={async () => { setPlacingParked(null); await load(); onPlaced() }} />
      )}

      {splitting && (
        <SplitReceiptModal receipt={splitting} onClose={() => setSplitting(null)}
          onDone={async () => { setSplitting(null); await load(); onPlaced() }} />
      )}
    </>
  )
}

/**
 * Placing one receipt against one account.
 *
 * THE SEARCH IS THE ACCOUNTS LIST'S OWN, so a clerk finds a debtor the same way here as
 * everywhere else -- case number, account number, client reference or surname. Introducing a
 * second, subtly different way to find a debtor is how somebody ends up placing money against a
 * similar-looking account.
 */
/*
 * TAKES WHAT TO SHOW AND WHAT TO DO, rather than a bank line.
 *
 * BECAUSE THERE ARE NOW TWO THINGS TO PLACE and they are placed by different functions: an
 * unallocated bank LINE through `placeBankLine`, and a receipt somebody parked off the approval
 * queue through `setPaymentAccount`. Copying this box for the second would have meant a second
 * debtor search -- which is the exact thing this file's own note warns about: "introducing a
 * second, subtly different way to find a debtor is how somebody ends up placing money against a
 * similar-looking account."
 */
function PlaceModal({ title, summary, onPlace, onClose, onDone }: {
  title: string
  /** The grey box at the top: what this money is, in as few lines as say it. */
  summary: { amount: number; description: string; receivedOn: string; note?: string | null }
  onPlace: (accountId: string) => Promise<void>
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const [term, setTerm] = useState('')
  const [hits, setHits] = useState<DebtorAccount[]>([])
  const [looking, setLooking] = useState(false)
  const [chosen, setChosen] = useState<DebtorAccount | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const q = term.trim()
    if (q.length < 2) { setHits([]); return }
    let cancelled = false
    setLooking(true)
    const t = setTimeout(() => {
      /* No count: the box shows ten and never says how many matched -- see fetchAccounts. */
      void fetchAccounts({ search: q, pageSize: 10, countRows: false })
        .then((r) => { if (!cancelled) setHits(r.accounts) })
        .catch(() => { if (!cancelled) setHits([]) })
        .finally(() => { if (!cancelled) setLooking(false) })
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [term])

  async function place() {
    if (!chosen || busy) return
    setBusy(true); setError(null)
    try {
      await onPlace(chosen.id)
      await onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That receipt could not be placed.')
      setBusy(false)
    }
  }

  return (
    <Modal title={title} onClose={onClose} width={520}>
      <div className="space-y-3">
        <div className="rounded-lg bg-slate-50 px-3 py-2.5">
          <p className="text-[15px] font-semibold tabular-nums text-navy-950">{rand(summary.amount)}</p>
          <p className="text-[12px] text-slate-600 mt-0.5 wrap-anywhere">{summary.description}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">Received {formatDate(summary.receivedOn)}</p>
          {/* WHY IT IS HERE, on a parked receipt: the words whoever parked it left. */}
          {summary.note && <p className="text-[11px] text-amber-700 mt-1 wrap-anywhere">{summary.note}</p>}
        </div>

        <label className="block">
          <span className="text-sm font-medium text-slate-700">Which account?</span>
          <span className="relative block mt-1">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={term} onChange={(e) => { setTerm(e.target.value); setChosen(null) }}
              autoFocus placeholder="Case number, account number, reference or surname"
              className={`${inputClass} pl-8`} />
          </span>
        </label>

        {looking && <p className="text-[12px] text-slate-400">Looking…</p>}

        {hits.length > 0 && !chosen && (
          <ul className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
            {hits.map((a) => (
              <li key={a.id}>
                <button type="button" onClick={() => setChosen(a)}
                  className="w-full text-left px-3 py-2 hover:bg-slate-50">
                  <span className="block text-[13px] text-slate-800">
                    {[a.debtorFirstName, a.debtorSurname].filter(Boolean).join(' ') || 'No name'}
                  </span>
                  <span className="block text-[11px] text-slate-500">
                    {a.caseNumber} · {a.accountNumber} · {rand(a.capitalOutstanding)} outstanding
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {chosen && (
          <div className="rounded-lg border border-brand-500 bg-brand-50/50 px-3 py-2">
            <p className="text-[13px] text-slate-800">
              {[chosen.debtorFirstName, chosen.debtorSurname].filter(Boolean).join(' ') || 'No name'}
            </p>
            <p className="text-[11px] text-slate-500">{chosen.caseNumber} · {chosen.accountNumber}</p>
            <button type="button" onClick={() => setChosen(null)}
              className="text-[11px] text-slate-500 underline mt-1">Pick a different one</button>
          </div>
        )}

        {/*
          WHAT PRESSING IT DOES, said before it is pressed. A payment has no update or delete
          policy: once this is recorded the only way back is a reversal, with a reason, and both
          rows stay on the ledger for ever.
        */}
        {chosen && (
          <p className="text-[12px] text-slate-500">
            This records the payment and splits it immediately — receipt fee, interest, costs,
            capital and commission. It can only be reversed afterwards, not removed.
          </p>
        )}

        {error && <p className="text-[13px] text-negative-700">{error}</p>}

        <div className="flex items-center gap-2 pt-1">
          <button type="button" onClick={() => void place()} disabled={!chosen || busy}
            className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg
              bg-brand-600 text-white disabled:opacity-40">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
            {busy ? 'Placing…' : 'Place it'}
          </button>
          <button type="button" onClick={onClose} className="text-sm text-slate-600 hover:text-slate-800 px-2">
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  )
}
