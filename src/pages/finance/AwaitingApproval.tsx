import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, Loader2, RotateCcw, Search } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { Modal, inputClass } from '../../components/ui/Modal'
import { rand } from '../../lib/money'
import { formatDate } from '../../data/mockData'
import { fetchAccounts, type DebtorAccount } from '../../lib/accountBook'
import {
  fetchAwaitingApproval, approvePayments, setPaymentAccount, suspendPayment,
  type AwaitingPayment,
} from '../../lib/payover'

/**
 * THE DAY'S PAYMENTS, WAITING TO BE APPROVED.
 *
 * THE FIRM: "There should be a state of payments and payments that should be approved on a daily
 * basis... You should be able to approve every payment singly, or approve all payments, or
 * highlight certain ones and approve them."
 *
 * NOTHING HERE HAS HAPPENED YET, and that is the point. The figures are `preview_allocation` --
 * the same arithmetic the collector's dry run uses -- so what is approved is what was shown. No
 * balance has moved, no receipt fee has been raised, and no payover run can see any of it: an
 * unapproved payment has no allocation, and a run gathers allocations.
 *
 * THEY CARRY OVER BY THEMSELVES. The firm: "if there's a payment that has not been approved on a
 * specific day, then it carries over and it stays there." This list is everything not yet
 * approved, whatever day it arrived -- no nightly job, and so no night it fails to run.
 */
export function AwaitingApproval({ refreshKey, onApproved }: {
  refreshKey: number
  onApproved: () => void
}) {
  const [rows, setRows] = useState<AwaitingPayment[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  /* The receipt whose debtor is being corrected, if one is. */
  const [moving, setMoving] = useState<AwaitingPayment | null>(null)
  /*
   * AND THE RECEIPT NOBODY IS READY TO PLACE AT ALL.
   *
   * THE FIRM: "when something is in that state of approval, it should also give you an option to
   * put it into suspense... Otherwise you have to go and look for it in suspense and allocate it
   * later." Move is for when you KNOW the right debtor; this is for when you do not, and the
   * alternative was leaving it on the queue where the next person approves it onto the wrong one.
   */
  const [parking, setParking] = useState<AwaitingPayment | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setRows(await fetchAwaitingApproval()) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load the day’s payments.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load, refreshKey])

  const total = useMemo(() => rows.reduce((n, r) => n + r.amount, 0), [rows])
  const pickedTotal = useMemo(
    () => rows.filter((r) => picked.has(r.paymentId)).reduce((n, r) => n + r.amount, 0),
    [rows, picked],
  )

  async function approve(ids: string[]) {
    if (ids.length === 0 || busy) return
    setBusy(true); setError(null)
    try {
      const out = await approvePayments(ids)
      /* A PAYMENT THAT COULD NOT GO THROUGH NAMES ITSELF and the rest still did -- the database
         approves them one at a time inside one call. Reported rather than swallowed. */
      if (out.problems.length > 0) {
        setError(`${out.approved} approved, ${out.skipped} could not be: ${out.problems.slice(0, 3).join('; ')}`)
      }
      setPicked(new Set())
      await load()
      onApproved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Those payments could not be approved.')
    } finally { setBusy(false) }
  }

  function toggle(id: string) {
    setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }

  if (loading) {
    return <Card><div className="py-8 text-center"><Loader2 className="mx-auto w-4 h-4 animate-spin text-slate-400" /></div></Card>
  }
  if (rows.length === 0) {
    return (
      <Card>
        <p className="py-4 text-center text-[13px] text-slate-500">
          No payments waiting. Everything that has arrived has been approved.
        </p>
      </Card>
    )
  }

  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div>
          <h3 className="text-[15px] font-semibold text-slate-800">Payments waiting for you</h3>
          <p className="text-[12px] text-slate-500">
            Nothing has moved yet. These are the figures each one would post if you approve it.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[15px] font-semibold tabular-nums text-navy-950">{rand(total)}</span>
          <button type="button" disabled={busy || picked.size === 0}
            onClick={() => void approve([...picked])}
            className="text-xs font-medium px-2.5 py-1.5 rounded-md border border-slate-200
              text-slate-600 hover:border-[#c9a052] hover:bg-gold-50 disabled:opacity-40">
            Approve {picked.size} · {rand(pickedTotal)}
          </button>
          <button type="button" disabled={busy}
            onClick={() => void approve(rows.map((r) => r.paymentId))}
            className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg
              border border-gold-500 bg-gold-400 text-navy-950 hover:bg-gold-500 disabled:opacity-40">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Approve all {rows.length}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 bg-negative-50 px-4 py-2.5 text-[13px] text-negative-700">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /><span>{error}</span>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px] whitespace-nowrap">
          <thead className="text-[10.5px] uppercase tracking-wide text-slate-500">
            <tr className="border-b border-slate-100">
              <th className="px-3 py-2">
                <input type="checkbox"
                  checked={picked.size === rows.length && rows.length > 0}
                  onChange={(e) => setPicked(e.target.checked ? new Set(rows.map((r) => r.paymentId)) : new Set())} />
              </th>
              <th className="px-2 py-2 text-left font-medium">Received</th>
              <th className="px-2 py-2 text-left font-medium">Account</th>
              <th className="px-2 py-2 text-left font-medium">Debtor</th>
              <th className="px-2 py-2 text-right font-medium">Payment</th>
              <th className="px-2 py-2 text-right font-medium">Receipt fee</th>
              {/*
                THE FIRM'S OWN WORDS, off their export: retained interest, retained legal fees,
                retained collection commission.

                AND THE THIRD ONE IS THE POINT. "Swordfish made that part of the retained legal
                fees. Not anything else. So I think it's important for us to split this." It is
                already split here and always has been -- to_interest, to_costs, commission and
                commission_vat are four columns on payment_allocations, never one. What was
                missing was the firm's names on them, so nobody could see that the thing they
                asked for was already true.

                INTEREST BEFORE FEES is the firm's order and the reverse of Swordfish's: VAT is on
                fees and not on interest, so taking interest first carries less risk if the debtor
                stops paying.
              */}
              <th className="px-2 py-2 text-right font-medium">Retained interest</th>
              <th className="px-2 py-2 text-right font-medium">Retained legal fees</th>
              <th className="px-2 py-2 text-right font-medium">Capital</th>
              <th className="px-2 py-2 text-right font-medium">Retained col. commission</th>
              <th className="px-2 py-2 text-right font-medium">VAT</th>
              <th className="px-2 py-2 text-right font-medium">To client</th>
              <th className="px-2 py-2 text-right font-medium">Due to BF</th>
              <th className="px-2 py-2 text-left font-medium">Type</th>
              <th className="px-2 py-2 text-left font-medium">Reference</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.paymentId}
                /*
                  A RETURNED RECEIPT IS TINTED, and that is not decoration. The firm: a reversal
                  "goes back into a state ready for approval" -- so it arrives on this list looking
                  exactly like the morning's new money, and approving it unread puts it straight
                  back onto the debtor it should never have been on.
                */
                className={`border-b border-slate-50 ${
                  picked.has(r.paymentId) ? 'bg-gold-50/40'
                    : r.cameBackFrom ? 'bg-amber-50/50' : ''}`}>
                <td className="px-3 py-1.5">
                  <input type="checkbox" checked={picked.has(r.paymentId)}
                    onChange={() => toggle(r.paymentId)} />
                </td>
                <td className="px-2 py-1.5 text-slate-600">{formatDate(r.receivedOn)}</td>
                <td className="px-2 py-1.5 text-slate-600">
                  {r.caseNumber ?? r.accountNumber}
                  {/*
                    THE ONE THING THIS SCREEN MAY CHANGE, and the firm chose it: which debtor the
                    money goes on. The amount and the date are what the bank said. Offered on every
                    row rather than only the returned ones -- a receipt placed on the wrong debtor
                    by a mistyped reference is the same mistake found one step earlier.
                  */}
                  <button type="button" onClick={() => setMoving(r)}
                    className="ml-1.5 text-[11px] font-medium text-slate-400 underline underline-offset-2
                      hover:text-slate-700">
                    Move
                  </button>
                  {/*
                    BESIDE MOVE, BECAUSE THEY ARE THE SAME QUESTION ANSWERED TWO WAYS. Move is "I
                    know whose this is"; Suspense is "I know it is not this debtor's and I do not
                    yet know whose". The second had no button at all, so the only ways out of the
                    queue were approving it onto an account somebody doubted or leaving it there.
                  */}
                  <button type="button" onClick={() => setParking(r)}
                    className="ml-1.5 text-[11px] font-medium text-slate-400 underline underline-offset-2
                      hover:text-slate-700">
                    Suspense
                  </button>
                </td>
                <td className="px-2 py-1.5 text-slate-600 max-w-[12rem] truncate">{r.debtor}</td>
                <td className="px-2 py-1.5 text-right tabular-nums font-medium text-navy-950">{rand(r.amount)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{rand(r.receiptFee)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{rand(r.toInterest)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{rand(r.toCosts)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{rand(r.toCapital)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">
                  {/* NO RATE IS NOT A ZERO. Approving still writes the allocation, marked
                      needs_rate, and the exceptions screen carries it -- but a confident 0.00
                      here would read as "this client pays us nothing". */}
                  {r.hasRate ? rand(r.commission) : <span className="text-amber-700">no rate</span>}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{rand(r.commissionVat)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-[var(--c-green)]">{rand(r.toClient)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{rand(r.dueToBf)}</td>
                <td className="px-2 py-1.5">
                  {/* THE TWO DIRECTIONS OF MONEY, named the way the firm's own export names them. */}
                  <span className={`text-[10.5px] px-1.5 py-0.5 rounded ${
                    r.paidToClient
                      ? 'bg-[var(--tint-steel)] text-[var(--c-navy-mid)]'
                      : 'bg-slate-100 text-slate-600'}`}>
                    {r.paidToClient ? 'Client direct' : 'Direct'}
                  </span>
                  {/*
                    WHY IT IS BACK, carried from the reversal it replaces. Without it the row is
                    indistinguishable from new money and gets approved again exactly as it was.
                  */}
                  {r.cameBackFrom && (
                    <span className="ml-1 inline-flex items-center gap-1 text-[10.5px] px-1.5 py-0.5
                      rounded bg-amber-100 text-amber-900"
                      title={`Reversed ${r.cameBackOn ? formatDate(r.cameBackOn) : ''} — ${
                        r.cameBackReason ?? 'no reason given'}`}>
                      <RotateCcw size={10} /> Came back
                    </span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-slate-500 max-w-[14rem] truncate"
                  title={r.bankDescription ?? r.details ?? ''}>
                  {r.reference ?? r.bankDescription ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {moving && (
        <MoveAccountModal
          payment={moving}
          onClose={() => setMoving(null)}
          onDone={async () => { setMoving(null); await load() }}
        />
      )}
      {parking && (
        <SuspendModal
          payment={parking}
          onClose={() => setParking(null)}
          onDone={async () => { setParking(null); await load() }}
        />
      )}
    </Card>
  )
}

/**
 * PARKING A RECEIPT NOBODY IS READY TO APPROVE.
 *
 * THE FIRM: "when something is in that state of approval, it should also give you an option to put
 * it into suspense. So, for example, if you reverse a payment, it goes to a state of approval and
 * then you just say move to suspense."
 *
 * THE REASON IS REQUIRED AND THAT IS THE WHOLE OF THE BOX. `suspend_payment` refuses without one,
 * because a receipt sitting in suspense with no words is one nobody can place without going to
 * find whoever parked it -- and the person who parked it is the only one who knows why the account
 * it is on is wrong.
 *
 * IT STAYS ON ITS ACCOUNT, WRONGLY, AND ON PURPOSE. Detaching it would leave money belonging to
 * nobody and throw away the one clue to where it came from: the account somebody thought it was
 * for. The history then reads "received, reversed, parked, placed on the right debtor", which is
 * what happened.
 */
function SuspendModal({ payment, onClose, onDone }: {
  payment: AwaitingPayment
  onClose: () => void
  onDone: () => Promise<void> | void
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function park() {
    if (!reason.trim()) return
    setBusy(true); setError(null)
    try {
      await suspendPayment(payment.paymentId, reason.trim())
      await onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not move it to suspense.')
      setBusy(false)
    }
  }

  return (
    <Modal title="Move this receipt to suspense"
      subtitle={`${rand(payment.amount)} received ${formatDate(payment.receivedOn)}`}
      onClose={onClose} width={460}>
      <p className="text-sm text-slate-500">
        It leaves the approval queue and waits in suspense until somebody places it on the right
        debtor. Nothing is split and no fee is raised.
      </p>

      {/* WHERE IT IS SITTING NOW, said plainly: it is still on this account, and that is the only
          clue the next person has to where the money came from. */}
      <p className="text-[11px] text-slate-400 mt-2">
        It stays recorded against {payment.caseNumber ?? payment.accountNumber ?? 'this account'}
        {payment.debtor ? ` — ${payment.debtor}` : ''} until it is placed.
      </p>

      {/* AND WHY IT CAME BACK, where a reversal put it here. The person parking it should not have
          to go and find the words somebody else already wrote. */}
      {payment.cameBackReason && (
        <p className="text-[11px] text-amber-700 bg-amber-50 rounded-lg px-2.5 py-2 mt-2">
          Came back {payment.cameBackOn ? formatDate(payment.cameBackOn) : ''} — {payment.cameBackReason}
        </p>
      )}

      <div className="mt-3">
        <label htmlFor="suspense-reason" className="text-sm font-medium text-slate-700">
          Why is it going to suspense?
        </label>
        <textarea id="suspense-reason" rows={3} value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reference matched two accounts — waiting for the client to confirm which."
          className={`${inputClass} mt-1 resize-none`} />
        <span className="block text-[11px] text-slate-400 mt-1">
          This is what the next person reads when they come to place it.
        </span>
      </div>

      {error && <p className="text-sm text-negative-700 mt-2">{error}</p>}

      <div className="flex items-center gap-2 mt-4">
        <button type="button" onClick={() => void park()} disabled={busy || !reason.trim()}
          className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg
            bg-brand-600 text-white disabled:opacity-40">
          {busy && <Loader2 size={15} className="animate-spin" />}
          Move it to suspense
        </button>
        <button type="button" onClick={onClose} className="text-sm text-slate-600 hover:text-slate-800 px-2">
          Cancel
        </button>
      </div>
    </Modal>
  )
}

/**
 * PUTTING AN UNAPPROVED RECEIPT ON THE RIGHT DEBTOR.
 *
 * THE FIRM, ASKED WHAT THIS SCREEN MAY CHANGE: the account only. Which debtor the money goes on is
 * what was wrong; the amount and the date are the bank's own facts and nobody may quietly turn
 * R 5 000 into R 500.
 *
 * IT IS NOT AN EDIT TO A FINANCIAL RECORD, and `set_payment_account` is what makes that true
 * rather than this screen: nothing has been split, no receipt fee raised and no remittance run
 * against an unapproved payment, which is the whole reason the approval gate exists. Approved, the
 * function refuses and says to reverse it instead.
 *
 * THE SEARCH IS THE ACCOUNTS LIST'S OWN -- the same one Suspense uses to place a receipt. A second,
 * subtly different way to find a debtor is how somebody puts money on a similar-looking account.
 */
function MoveAccountModal({ payment, onClose, onDone }: {
  payment: AwaitingPayment
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
    /* Debounced, and no count: 100 000 rows per keystroke otherwise -- see fetchAccounts. */
    const t = setTimeout(() => {
      void fetchAccounts({ search: q, pageSize: 10, countRows: false })
        .then((r) => { if (!cancelled) setHits(r.accounts) })
        .catch(() => { if (!cancelled) setHits([]) })
        .finally(() => { if (!cancelled) setLooking(false) })
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [term])

  async function move() {
    if (!chosen || busy) return
    setBusy(true); setError(null)
    try {
      await setPaymentAccount(payment.paymentId, chosen.id)
      await onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That payment could not be moved.')
      setBusy(false)
    }
  }

  return (
    <Modal title="Which debtor is this?" onClose={onClose} width={520}>
      <div className="space-y-3">
        <div className="rounded-lg bg-slate-50 px-3 py-2.5">
          <p className="text-[15px] font-semibold tabular-nums text-navy-950">{rand(payment.amount)}</p>
          <p className="text-[12px] text-slate-600 mt-0.5 wrap-anywhere">
            {payment.reference ?? payment.bankDescription ?? 'No reference'}
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Received {formatDate(payment.receivedOn)} · on {payment.debtor} at the moment
          </p>
          {payment.cameBackFrom && (
            <p className="text-[11px] text-amber-800 mt-1">
              Reversed {payment.cameBackOn ? formatDate(payment.cameBackOn) : ''} —{' '}
              {payment.cameBackReason ?? 'no reason given'}
            </p>
          )}
        </div>

        <label className="block">
          <span className="text-sm font-medium text-slate-700">Move it to</span>
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

        {/* NOTHING IS SPLIT YET, said so nobody thinks moving it also books it. */}
        {chosen && (
          <p className="text-[12px] text-slate-500">
            Nothing is split until you approve it. The figures on the list are redrawn against this
            debtor&rsquo;s balances.
          </p>
        )}

        {error && <p className="rounded-lg bg-negative-50 px-3 py-2 text-[13px] text-negative-700">{error}</p>}

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
          <button type="button" onClick={onClose}
            className="rounded-lg px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button type="button" onClick={() => void move()} disabled={!chosen || busy}
            className="rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white
              hover:bg-brand-700 disabled:opacity-50">
            {busy ? 'Moving…' : 'Move it'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
