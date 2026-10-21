import { useEffect, useState } from 'react'
import { AlertTriangle, Check, FileUp, Loader2, Paperclip, Search } from 'lucide-react'
import { Modal, inputClass } from '../../components/ui/Modal'
import { rand } from '../../lib/money'
import { fetchAccounts, type DebtorAccount } from '../../lib/accountBook'
import { uploadDocument } from '../../lib/accountWorkspace'
import {
  recordManualPayment, DuplicatePayment, ProofRequired, ReferenceRequired,
} from '../../lib/recordPayment'
import { chargePtcConfirmation } from '../../lib/accountCharges'
import { chargeMessage } from '../../lib/accountCharges'
import { useAuth } from '../../store/AuthContext'
import { clockToday } from '../../lib/clock.ts'

/**
 * RECORDING ONE PAYMENT BY HAND.
 *
 * THE FIRM asked for two things and this is both: "we should be able to load a manual payment...
 * and we need to account for the PTCs that we usually type in manually."
 *
 * THE PTC HALF IS NOT A CONVENIENCE. A debtor paying the CLIENT direct never touches the firm's
 * trust account, so no bank statement the firm can upload will ever carry it. This form is the
 * only way a PTC can be recorded at all -- the engine has split them correctly since it was
 * written, and nothing could create one.
 *
 * SO "WHO GOT THE MONEY" IS THE WHOLE QUESTION, asked as two choices with their consequences
 * written out, rather than a checkbox called "PTC" that means nothing to somebody new. It sets
 * `paid_to_client`, and the two directions come out opposite on identical figures: a trust
 * receipt leaves the firm owing the client; a PTC leaves the client owing the firm.
 */
const METHODS = ['EFT', 'Cash', 'Debit order', 'Card', 'Cheque', 'Other']

export function RecordPaymentModal({ onClose, onDone, fixedAccount }: {
  onClose: () => void
  onDone: () => Promise<void> | void
  /**
   * The account this was opened on, where it was opened on one.
   *
   * ON THE ACCOUNT PAGE THERE IS NOTHING TO SEARCH FOR -- the debtor is already on the screen,
   * and offering a search there invites recording a payment against the account somebody meant
   * to look at rather than the one they are on.
   */
  fixedAccount?: { id: string; caseNumber: string | null; accountNumber: string | null; name: string }
}) {
  const { currentUser } = useAuth()
  const today = clockToday()

  const [term, setTerm] = useState('')
  const [hits, setHits] = useState<DebtorAccount[]>([])
  const [looking, setLooking] = useState(false)
  const [account, setAccount] = useState<DebtorAccount | null>(null)
  const accountId = fixedAccount?.id ?? account?.id ?? null

  /* The client's confirmation. Uploaded before the payment, so a PTC is never recorded without
     it -- see the note on the file input below. */
  const [proof, setProof] = useState<{ id: string; name: string } | null>(null)
  const [uploading, setUploading] = useState(false)

  const [amount, setAmount] = useState('')
  const [receivedOn, setReceivedOn] = useState(today)
  const [paidToClient, setPaidToClient] = useState(false)
  const [method, setMethod] = useState('EFT')
  const [reference, setReference] = useState('')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /* The duplicate the database found, held so the person can look at it and say it is a second
     payment. Never assumed -- see recordManualPayment. */
  const [duplicate, setDuplicate] = useState<string | null>(null)

  useEffect(() => {
    const q = term.trim()
    if (q.length < 2) { setHits([]); return }
    let cancelled = false
    setLooking(true)
    const t = setTimeout(() => {
      /* No count: the box shows ten and never says how many matched. */
      void fetchAccounts({ search: q, pageSize: 10, countRows: false })
        .then((r) => { if (!cancelled) setHits(r.accounts) })
        .catch(() => { if (!cancelled) setHits([]) })
        .finally(() => { if (!cancelled) setLooking(false) })
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [term])

  const value = Number(amount.replace(/[^\d.]/g, ''))
  /*
   * A PTC is not ready until its confirmation is attached, and NOTHING is ready without a
   * reference. The database refuses both -- this only stops the button offering to do something
   * that will be refused.
   *
   * THE FIRM ASKED FOR THE REFERENCE LOOKING AT THIS BOX: "this reference here should be
   * compulsory." It is the only thing tying a payment typed in by hand to anything outside
   * Raptor -- a receipt on a statement carries the debtor's own, and a capture carries whatever
   * somebody writes here or nothing at all.
   */
  const ready = !!accountId && Number.isFinite(value) && value > 0 && !!receivedOn
    && !!reference.trim() && (!paidToClient || !!proof)

  async function attach(file: File) {
    if (!accountId) return
    setUploading(true); setError(null)
    try {
      const { document } = await uploadDocument({
        accountId,
        file,
        kind: 'Proof of payment',
        uploadedBy: currentUser?.id ?? null,
        uploadedByName: currentUser?.name ?? null,
        /*
          NO PERUSAL FEE ON THE UPLOAD ITSELF -- but not because a PTC is free. The firm corrected
          that: "you can charge a perusal fee for a PTC because the debtor has paid into the
          client's account and it cost us administration to verify this."
          
          The charge is `ptc_confirmation`, raised ONCE AFTER THE PAYMENT LANDS (see save below).
          Charging here as well would bill the debtor twice for one verification -- and would
          charge them even when the payment is then refused, which is the case where no
          confirmation happened at all.
        */
        chargePerusalFee: false,
      })
      setProof({ id: document.id, name: document.name })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That confirmation could not be attached.')
    } finally { setUploading(false) }
  }

  async function save(confirmDuplicate: boolean) {
    if (!accountId || !ready || busy) return
    setBusy(true); setError(null)
    try {
      const paymentId = await recordManualPayment({
        accountId: accountId as string,
        amount: value,
        receivedOn,
        paidToClient,
        method,
        reference: reference.trim() || null,
        confirmDuplicate,
        proofDocumentId: proof?.id ?? null,
      })
      /*
        AND THE DEBTOR PAYS FOR THE VERIFICATION, at the firm's instruction -- item 3, "other
        necessary expenses", described as a PTC confirmation. AFTER the payment, never before: a
        PTC that would not save has not been confirmed.

        ONLY ON A PTC. A trust receipt is witnessed by the firm's own bank statement and costs
        nobody any verifying.
      */
      if (paidToClient && paymentId) {
        const charge = await chargePtcConfirmation({
          accountId: accountId as string,
          createdBy: currentUser?.id ?? null,
        })
        if (charge?.reason === 'charged') console.info(chargeMessage(charge, '3'))
      }
      await onDone()
      onClose()
    } catch (e) {
      if (e instanceof DuplicatePayment) { setDuplicate(e.message); setBusy(false); return }
      if (e instanceof ProofRequired) { setError(e.message); setBusy(false); return }
      /* The database's own sentence, which is written to be read and says what to put in the box.
         Named rather than folded into the generic failure so it never wears "could not be
         recorded", which reads as something going wrong rather than something missing. */
      if (e instanceof ReferenceRequired) { setError(e.message); setBusy(false); return }
      setError(e instanceof Error ? e.message : 'That payment could not be recorded.')
      setBusy(false)
    }
  }

  return (
    <Modal title="Record a payment" onClose={onClose} width={520}>
      <div className="space-y-3">
        {/* ---- which account ---- */}
        {fixedAccount ? (
          <div className="rounded-lg bg-slate-50 px-3 py-2">
            <p className="text-[13px] text-slate-800">{fixedAccount.name}</p>
            <p className="text-[11px] text-slate-500">
              {fixedAccount.caseNumber} · {fixedAccount.accountNumber}
            </p>
          </div>
        ) : !account ? (
          <>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Which account?</span>
              <span className="relative block mt-1">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={term} onChange={(e) => setTerm(e.target.value)} autoFocus
                  placeholder="Case number, account number, reference or surname"
                  className={`${inputClass} pl-8`} />
              </span>
            </label>
            {looking && <p className="text-[12px] text-slate-400">Looking…</p>}
            {hits.length > 0 && (
              <ul className="max-h-52 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
                {hits.map((a) => (
                  <li key={a.id}>
                    <button type="button" onClick={() => setAccount(a)}
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
          </>
        ) : (
          <div className="rounded-lg border border-brand-500 bg-brand-50/50 px-3 py-2">
            <p className="text-[13px] text-slate-800">
              {[account.debtorFirstName, account.debtorSurname].filter(Boolean).join(' ') || 'No name'}
            </p>
            <p className="text-[11px] text-slate-500">
              {account.caseNumber} · {account.accountNumber} · {rand(account.capitalOutstanding)} outstanding
            </p>
            <button type="button" onClick={() => { setAccount(null); setDuplicate(null) }}
              className="text-[11px] text-slate-500 underline mt-1">Pick a different one</button>
          </div>
        )}

        {/* ---- who got the money ---- */}
        {/*
          THE WHOLE QUESTION, asked in words rather than as a checkbox called PTC. The two options
          say what each DOES, because the consequence is not visible anywhere else until a
          remittance is drawn -- and by then it may have gone out.
        */}
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium text-slate-700 mb-1.5">Who received the money?</legend>
          {([
            [false, 'We did — it is in our trust account',
              'We owe the client the capital, less our commission. It goes out on the next remittance.'],
            [true, 'The client did — the debtor paid them direct',
              'A PTC. The client already has the money and now owes us the interest, the costs and our commission.'],
          ] as const).map(([value_, label, what]) => (
            <label key={String(value_)}
              className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                paidToClient === value_ ? 'border-brand-500 bg-brand-50/50' : 'border-slate-200 hover:bg-slate-50'
              }`}>
              <input type="radio" name="ptc" checked={paidToClient === value_}
                onChange={() => { setPaidToClient(value_); setDuplicate(null) }} className="mt-0.5" />
              <span className="min-w-0">
                <span className="block text-sm text-slate-800">{label}</span>
                <span className="block text-[11px] text-slate-500">{what}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {/* ---- the client's confirmation ---- */}
        {/*
          THE FIRM: "whenever a PTC is uploaded, it should ask you for a confirmation and you
          should upload the confirmation. It just will be in the form of a PDF or an email or
          something like that."

          ONLY ON A PTC, and the asymmetry is the point. A trust receipt is WITNESSED -- the money
          is in the firm's own bank and the statement says so. A PTC is CLAIMED: the firm never
          sees the money, and on the strength of that claim it reduces a debtor's balance AND
          invoices the client for commission on money it never handled. The confirmation is what
          that invoice rests on.
        */}
        {paidToClient && (
          <div className="rounded-lg border border-slate-200 px-3 py-2.5">
            <p className="text-sm font-medium text-slate-700">The client's confirmation</p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              A PDF, an email, a screenshot — whatever the client sent showing the debtor paid
              them. Required: we never saw this money, so this is what the commission invoice
              rests on. Verifying it raises item 3, a PTC confirmation.
            </p>
            {proof ? (
              <p className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-[var(--c-green)]">
                <Paperclip size={12} /> {proof.name}
                <button type="button" onClick={() => setProof(null)}
                  className="text-slate-500 underline ml-1">Replace</button>
              </p>
            ) : (
              <label className={`mt-2 inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5
                rounded-md border border-slate-200 text-slate-600 ${accountId ? 'cursor-pointer hover:border-[#c9a052] hover:bg-gold-50' : 'opacity-40'}`}>
                {uploading ? <Loader2 size={12} className="animate-spin" /> : <FileUp size={12} />}
                {uploading ? 'Attaching…' : 'Attach the confirmation'}
                <input type="file" className="hidden" disabled={!accountId || uploading}
                  accept=".pdf,.eml,.msg,image/*"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void attach(f) }} />
              </label>
            )}
            {!accountId && (
              <p className="text-[11px] text-slate-400 mt-1">Pick the account first.</p>
            )}
          </div>
        )}

        {/* ---- how much, when, how ---- */}
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Amount</span>
            <input value={amount} onChange={(e) => { setAmount(e.target.value); setDuplicate(null) }}
              inputMode="decimal" placeholder="0.00" className={`${inputClass} tabular-nums`} />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Received on</span>
            {/*
              THE DAY THE MONEY CAME IN, not today. The payover cycle is cut on this date, so a PTC
              a client reports three weeks late belongs in the month the debtor actually paid.
              max is today: a payment dated forward lands in a cycle that has not been cut.
            */}
            <input type="date" value={receivedOn} max={today}
              onChange={(e) => { setReceivedOn(e.target.value); setDuplicate(null) }}
              className={inputClass} />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">How</span>
            <select value={method} onChange={(e) => setMethod(e.target.value)}
              className={`${inputClass} bg-white`}>
              {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">
              Reference<span className="text-negative-600 ml-0.5">*</span>
            </span>
            {/*
              WHAT TO PUT IN IT, rather than a blank box with a star on it. The answer differs by
              direction and the placeholder says which: our statement's reference when the money
              came to us, the client's own when the debtor paid them.
            */}
            <input value={reference} onChange={(e) => setReference(e.target.value)}
              placeholder={paidToClient ? 'The client’s reference' : 'As it appears on the statement'}
              className={inputClass} />
          </label>
        </div>

        {/* ---- the duplicate, if the database found one ---- */}
        {duplicate && (
          <div className="rounded-lg bg-amber-50 px-3 py-2.5 text-[13px] text-amber-900">
            <p className="flex items-start gap-1.5">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{duplicate}</span>
            </p>
            {/* A DEBTOR GENUINELY CAN PAY THE SAME AMOUNT TWICE IN A DAY, so this is a question
                rather than a refusal -- but it is asked, because a payment cannot be deleted. */}
            <button type="button" onClick={() => void save(true)} disabled={busy || !ready}
              className="mt-2 text-xs font-medium px-2.5 py-1 rounded-md border border-amber-300
                bg-white text-amber-900 hover:bg-amber-100 disabled:opacity-40">
              Yes, this is a second payment — record it
            </button>
          </div>
        )}

        {/*
          WHAT PRESSING IT DOES. account_payments has no update or delete policy: once recorded,
          the only way back is a reversal with a reason, and both rows stay on the ledger.
        */}
        {ready && !duplicate && (
          <p className="text-[12px] text-slate-500">
            This splits immediately — receipt fee, interest, costs, capital and commission. It can
            only be reversed afterwards, not removed.
          </p>
        )}

        {error && <p className="text-[13px] text-negative-700">{error}</p>}

        <div className="flex items-center gap-2 pt-1">
          <button type="button" onClick={() => void save(false)} disabled={!ready || busy || !!duplicate}
            className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg
              bg-brand-600 text-white disabled:opacity-40">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
            {busy ? 'Recording…' : paidToClient ? 'Record this PTC' : 'Record this payment'}
          </button>
          <button type="button" onClick={onClose} className="text-sm text-slate-600 hover:text-slate-800 px-2">
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  )
}
