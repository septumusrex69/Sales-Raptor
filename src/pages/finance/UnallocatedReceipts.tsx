import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Check, Loader2, Search } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { Modal, inputClass } from '../../components/ui/Modal'
import { rand } from '../../lib/money'
import { formatDate } from '../../data/mockData'
import { fetchAccounts, type DebtorAccount } from '../../lib/accountBook'
import { SplitReceiptModal } from './SplitReceiptModal'
import { lineNature } from '../../lib/bankLineAllocation.ts'
import { ReturnedReceiptPicker } from '../../components/finance/ReturnedReceiptPicker'
import { allocateBankLine } from '../../lib/bankAllocationApi'
import {
  fetchUnallocatedReceipts, placeBankLine,
  fetchUnreconciledPayouts, reconcileBankDebit,
  fetchSuspendedPayments, releasePaymentFromSuspense, setPaymentAccount,
  fetchSuspendedBankLines, suspendBankLine, releaseBankLineFromSuspense,
  type UnallocatedReceipt, type UnreconciledPayout, type SuspendedPayment, type SuspendedBankLine,
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
export function UnallocatedReceipts({ refreshKey, onPlaced, onTotals, hidePayouts = false }: {
  /* On To sort the money out is under Statement lines to allocate, so it is not listed twice. */
  hidePayouts?: boolean
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
  /* BANK LINES SOMEBODY LOOKED FOR AND COULD NOT PLACE (S10, prompt 13 item 13), and the line being
     moved there -- the note is asked for before it goes. */
  const [suspended, setSuspended] = useState<SuspendedBankLine[]>([])
  const [suspending, setSuspending] = useState<UnallocatedReceipt | null>(null)
  const [placingParked, setPlacingParked] = useState<SuspendedPayment | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [r, p, sp, sl] = await Promise.all([
        fetchUnallocatedReceipts(), fetchUnreconciledPayouts(), fetchSuspendedPayments(), fetchSuspendedBankLines(),
      ])
      setRows(r); setPayouts(p); setParked(sp); setSuspended(sl)
      /* EVERY HALF OF SUSPENSE: receipts nobody has looked at, ones looked for and moved to suspense,
         and receipts parked off the queue. All of it is money in trust that is nobody's yet. */
      onTotals?.(r.length + sl.length + sp.length,
        r.reduce((n, x) => n + x.amount, 0) + sl.reduce((n, x) => n + x.amount, 0) + sp.reduce((n, x) => n + x.amount, 0))
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

  /*
   * BOOKED IN ONE PRESS WHERE THE BANK'S OWN WORDS SAY WHAT IT IS (the firm, 13 Oct, at CREDIT
   * INTEREST under "Needs an account" and two bank charges reading "No run of this amount"). Interest
   * is the firm's and is never placed on a debtor; a bank charge is the firm's cost. Both go through
   * allocate_bank_line, the one thing that writes an allocation.
   */
  async function book(lineId: string, kind: 'bank_interest' | 'bank_charge') {
    setTying(lineId); setError(null)
    try {
      await allocateBankLine(lineId, kind, null, null)
      await load(); onPlaced()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That line could not be booked.')
    } finally { setTying(null) }
  }

  const waiting = rows.reduce((n, r) => n + r.amount, 0)

  return (
    /* ONE COLUMN WITH ITS OWN GAPS: a fragment left the cards' spacing to whoever drew it, and the
       Payments out card sat jammed under this one (the firm, 13 Oct: "looks weird"). */
    <div className="space-y-4">
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
          <table className="w-full list-table whitespace-nowrap">
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
                    {lineNature(r.description, 'credit') === 'bank_interest' ? (
                      <button type="button" disabled={tying === r.id} onClick={() => void book(r.id, 'bank_interest')}
                        data-testid="book-interest"
                        className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md border border-slate-200
                          text-slate-600 hover:border-[#c9a052] hover:bg-gold-50 disabled:opacity-40">
                        {tying === r.id ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                        Book as bank interest
                      </button>
                    ) : (
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
                      {/* "I LOOKED AND COULD NOT PLACE IT" (S10, prompt 13 item 13): off this list,
                          with the note, into In suspense below. */}
                      <button type="button" onClick={() => setSuspending(r)} data-testid="move-to-suspense"
                        className="text-xs font-medium px-2.5 py-1 rounded-md text-slate-400
                          hover:text-slate-700 underline underline-offset-2">
                        Move to suspense
                      </button>
                    </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* ---------------- bank lines somebody looked for and moved to suspense ---------------- */}
      {/*
        ITS OWN CARD, FOR THE SAME REASON THE PARKED RECEIPTS HAVE ONE: Needs an account is what
        nobody has looked at yet; this is what somebody has, and their note is what the next person
        reads before looking again. Placed or split from here exactly as from above.
      */}
      {suspended.length > 0 && (
        <Card padded={false}>
          <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 px-5 py-4">
            <div>
              <h3 className="text-[16px] font-semibold text-slate-800">In suspense</h3>
              <p className="text-[12.5px] text-slate-500">
                Somebody looked for whose these are and could not place them. Still nobody&rsquo;s until placed.
              </p>
            </div>
            <span className="text-[13px] font-semibold tabular-nums text-amber-700">
              {rand(suspended.reduce((n, x) => n + x.amount, 0))}
            </span>
          </div>
          <table className="w-full list-table whitespace-nowrap" data-testid="suspended-bank-lines">
            <thead className="text-[11px] uppercase tracking-wide text-slate-500">
              <tr className="border-b border-slate-100">
                <th className="px-4 py-2 text-left font-medium">Received</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
                <th className="px-3 py-2 text-left font-medium">What the bank said</th>
                <th className="px-3 py-2 text-left font-medium">What was tried</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {suspended.map((r) => (
                <tr key={r.id} className="border-b border-slate-50">
                  <td className="px-4 py-2 text-slate-600 whitespace-nowrap">{formatDate(r.txnDate)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium text-slate-800">{rand(r.amount)}</td>
                  <td className="px-3 py-2 text-slate-600"><span className="wrap-anywhere">{r.description}</span></td>
                  <td className="px-3 py-2 text-slate-600">
                    <span className="wrap-anywhere">{r.note}</span>
                    <span className="block text-[11px] text-slate-400 mt-0.5">
                      {r.suspendedByName ?? 'Somebody'}, {formatDate(r.suspendedAt)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <span className="inline-flex gap-1.5">
                      <button type="button" onClick={() => setPlacing(r)}
                        className="text-xs font-medium px-2.5 py-1 rounded-md border border-slate-200
                          text-slate-600 hover:border-[#c9a052] hover:bg-gold-50">
                        Place it
                      </button>
                      <button type="button" onClick={() => setSplitting(r)}
                        className="text-xs font-medium px-2.5 py-1 rounded-md border border-slate-200
                          text-slate-600 hover:border-[#c9a052] hover:bg-gold-50">
                        Split it
                      </button>
                      <button type="button"
                        onClick={async () => {
                          try { await releaseBankLineFromSuspense(r.id); await load(); onPlaced() }
                          catch (e) { setError(e instanceof Error ? e.message : String(e)) }
                        }}
                        className="text-xs font-medium px-2.5 py-1 rounded-md text-slate-400
                          hover:text-slate-700 underline underline-offset-2">
                        Back to Needs an account
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {suspending && (
        <SuspendLineModal line={suspending} onClose={() => setSuspending(null)}
          onDone={async () => { setSuspending(null); await load(); onPlaced() }} />
      )}

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
          <div className="border-b border-slate-100 px-5 py-4">
            <h3 className="text-[16px] font-semibold text-slate-800">Parked off the approval queue</h3>
            <p className="text-[12.5px] text-slate-500">
              Somebody had these in front of them and would not approve them where they sat. They are still recorded
              against that account until they are placed.
            </p>
          </div>
          <table className="w-full list-table whitespace-nowrap">
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
      {payouts.length > 0 && !hidePayouts && (
        <Card padded={false}>
          {/* The same padded header as Needs an account: CardHeader assumes a padded card, and on an
              unpadded one it drew flush against the edge. */}
          <div className="border-b border-slate-100 px-5 py-4">
            <h3 className="text-[16px] font-semibold text-slate-800">Payments out to allocate</h3>
            <p className="text-[12.5px] text-slate-500">
              Money that left the trust account with nothing recorded against it yet. A payover is tied to its run, a
              bank charge is booked to the firm, and a debit order that came back is reversed on the debtor&rsquo;s account.
            </p>
          </div>
          <table className="w-full list-table whitespace-nowrap">
            <tbody>
              {payouts.map((p) => (
                <tr key={p.id} className="border-t border-slate-50">
                  <td className="px-4 py-2 text-slate-600 whitespace-nowrap">{formatDate(p.txnDate)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium text-slate-800">{rand(Math.abs(p.amount))}</td>
                  <td className="px-3 py-2 text-slate-600 whitespace-normal wrap-anywhere">{p.description}</td>
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
                    ) : lineNature(p.description, 'debit') === 'bank_charge' ? (
                      <button type="button" disabled={tying === p.id} onClick={() => void book(p.id, 'bank_charge')}
                        data-testid="book-charge"
                        className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md
                          border border-slate-200 text-slate-600 hover:border-[#c9a052] hover:bg-gold-50 disabled:opacity-40">
                        {tying === p.id ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                        Book as a bank charge
                      </button>
                    ) : lineNature(p.description, 'debit') === 'returned_debit' ? (
                      /* A BOUNCED DEBIT ORDER IS A RECEIPT THAT WAS NEVER MONEY (prompt 12): the pair is
                         suggested here and a person confirms it -- the receipt is reversed and both lines
                         close against each other. */
                      <span data-testid="returned-debit"><ReturnedReceiptPicker lineId={p.id} compact onDone={() => { void load(); onPlaced() }} /></span>
                    ) : (
                      <Link to="/trust/exceptions" className="text-xs font-medium text-gold-700 hover:text-gold-800">
                        Allocate it on Exceptions
                      </Link>
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
    </div>
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
              autoFocus placeholder="Case number, account number, reference, surname, cell or email"
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

/**
 * MOVE A BANK LINE TO SUSPENSE, WITH WHAT WAS TRIED (S10, prompt 13 item 13).
 *
 * The note is REQUIRED, here and in suspend_bank_line: the firm's own example is the sentence --
 * "I looked for this payment and couldn't place it" -- and a receipt in suspense with no words is
 * one the next person has to search for from the beginning.
 */
function SuspendLineModal({ line, onClose, onDone }: {
  line: UnallocatedReceipt
  onClose: () => void
  onDone: () => void | Promise<void>
}) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  async function go() {
    if (!note.trim()) { setErr('Say what you looked for.'); return }
    setBusy(true); setErr(null)
    try { await suspendBankLine(line.id, note.trim()); await onDone() }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false) }
  }
  return (
    <Modal title="Move this receipt to suspense" onClose={onClose} width={480}>
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
        <p className="text-sm font-medium text-slate-800 tabular-nums">{rand(line.amount)} &middot; {formatDate(line.txnDate)}</p>
        <p className="text-xs text-slate-500 mt-0.5 wrap-anywhere">{line.description}</p>
      </div>
      <label htmlFor="bank-line-suspense-note" className="block mt-3 text-sm font-medium text-slate-700">
        What did you look for?
      </label>
      <textarea id="bank-line-suspense-note" className={`${inputClass} mt-1`} rows={3} value={note} autoFocus
        data-testid="suspense-note"
        onChange={(e) => setNote(e.target.value)}
        placeholder="I looked for this payment and couldn't place it: no Solomons in the book, nobody owes R500" />
      <p className="text-[12px] text-slate-500 mt-1">
        It stays unplaced money in the trust account, under In suspense, and can be placed from there.
      </p>
      {err && <p className="text-sm text-negative-700 mt-2">{err}</p>}
      <div className="flex justify-end gap-2 mt-4">
        <button type="button" onClick={onClose} disabled={busy}
          className="text-sm px-3 py-2 rounded-lg text-slate-500 hover:bg-slate-100">Cancel</button>
        <button type="button" onClick={() => void go()} disabled={busy || !note.trim()}
          className="text-sm font-semibold px-3.5 py-2 rounded-lg border border-gold-500 bg-gold-400 text-navy-950 disabled:opacity-50">
          {busy ? 'Moving\u2026' : 'Move to suspense'}
        </button>
      </div>
    </Modal>
  )
}
