import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Copy, FileDown, Loader2, LogOut, Upload } from 'lucide-react'
import { DEBTOR_POP_MAX_BYTES, debtorPopFile, normaliseCaseNumber } from '../../lib/debtorPortal'
import { saveFile } from '../../lib/fileSave'
import { PROPOSAL_RULES, applicationNote, needsApplication, proposalProblem, proposalSummary } from '../../lib/debtorArrangement'
import type { Arrangement } from '../../lib/arrangements'
import {
  DebtorSignedOut, debtorToken, fetchDebtorAccount, fetchDebtorStatement, requestDebtorCode, saveDebtorToken,
  proposeDebtorArrangement, sendDebtorProofOfPayment, signOutDebtor, verifyDebtorCode,
  type DebtorAccount,
} from '../../lib/debtorPortalApi'

/**
 * /my-account -- THE DEBTOR PORTAL (Raptor H16, part 1). Stephan, 2 Nov: a debtor signs in with their case number
 * and a code sent to the email or cellphone the firm already has, and sees what they owe, what they have paid and
 * how to pay; part 2 adds the statement PDF and a proof-of-payment upload; part 3 lets them OFFER an arrangement,
 * which a collector accepts or declines. Disputes come next; nothing here offers them before they exist.
 *
 * PHONE FIRST. A debtor opens this from an SMS more often than from a desk, so it is one narrow column at every
 * width, large type for the number that matters, and nothing that needs a hover.
 *
 * BREDELL FERREIRA'S, NOT RAPTOR'S. Raptor is the firm's own system and its name means nothing to a debtor; the
 * page wears the firm's navy and gold, the colours on the letters they already have.
 */

const NAVY = '#111E2D'
const GOLD = '#C69F54'

const money = (n: number) => `R ${n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).split(' ').join(' ')}`
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const longDay = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}` }

export default function DebtorPortalPage() {
  const [token, setToken] = useState<string | null>(() => debtorToken())
  return (
    <div className="min-h-dvh bg-[#F2F5F8] text-[#1B2B3E]">
      <header className="border-b-[3px]" style={{ background: NAVY, borderColor: GOLD }}>
        <div className="mx-auto max-w-[560px] px-4 py-4">
          <p className="text-[13px] font-bold tracking-[0.3em]" style={{ color: GOLD }}>BREDELL FERREIRA</p>
          <p className="mt-0.5 text-[11px] tracking-[0.18em] text-[#AEBBCB]">YOUR ACCOUNT</p>
        </div>
      </header>
      <main className="mx-auto max-w-[560px] px-4 py-6">
        {token
          ? <AccountView token={token} onSignedOut={() => { saveDebtorToken(null); setToken(null) }} />
          : <SignIn onSignedIn={(t) => { saveDebtorToken(t); setToken(t) }} />}
      </main>
    </div>
  )
}

function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-[#D5DBE3] bg-white p-5 ${className}`}>{children}</section>
}
function Label({ children }: { children: ReactNode }) {
  return <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-[#3F5F86]">{children}</p>
}
const field = 'w-full rounded-lg border border-[#D5DBE3] bg-white px-3 py-3 text-base outline-none focus:border-[#C69F54] focus:ring-2 focus:ring-[#C69F54]/25'
const button = 'w-full rounded-lg px-4 py-3 text-base font-semibold text-white disabled:opacity-50'

/* ------------------------------------------------------------------ signing in */

function SignIn({ onSignedIn }: { onSignedIn: (token: string) => void }) {
  const [caseNumber, setCaseNumber] = useState(() => new URLSearchParams(window.location.search).get('case') ?? '')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function ask(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!normaliseCaseNumber(caseNumber)) { setError('Type the case number on our letter or SMS, for example RAP-123456.'); return }
    setBusy(true)
    try { setSent((await requestDebtorCode(caseNumber)).message) } catch (x) { setError(x instanceof Error ? x.message : String(x)) } finally { setBusy(false) }
  }
  async function verify(e: FormEvent) {
    e.preventDefault()
    setError(null); setBusy(true)
    try { onSignedIn((await verifyDebtorCode(caseNumber, code)).token) } catch (x) { setError(x instanceof Error ? x.message : String(x)) } finally { setBusy(false) }
  }

  return (
    <Card>
      <h1 className="text-xl font-bold" style={{ color: NAVY }}>See your account</h1>
      {!sent ? (
        <form onSubmit={ask} className="mt-4 space-y-4" data-testid="debtor-ask">
          <p className="text-[15px] text-[#5A6B80]">Type the case number from our letter, email or SMS. We will send a code to the email address (or cellphone) we have for you.</p>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Case number</span>
            <input value={caseNumber} onChange={(e) => setCaseNumber(e.target.value)} placeholder="RAP-123456" autoComplete="off"
              autoCapitalize="characters" aria-label="Case number" className={field} />
          </label>
          <button type="submit" disabled={busy} className={button} style={{ background: NAVY }}>
            {busy ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : 'Send me a code'}
          </button>
        </form>
      ) : (
        <form onSubmit={verify} className="mt-4 space-y-4" data-testid="debtor-verify">
          <p className="text-[15px] text-[#5A6B80]" data-testid="debtor-code-sent">{sent}</p>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">The six-digit code</span>
            <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={8}
              aria-label="Code" className={`${field} tracking-[0.4em] text-center text-xl`} />
          </label>
          <button type="submit" disabled={busy || code.replace(/\D/g, '').length < 6} className={button} style={{ background: NAVY }}>
            {busy ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : 'Open my account'}
          </button>
          <button type="button" onClick={() => { setSent(null); setCode(''); setError(null) }} className="w-full text-sm text-[#5A6B80] underline">
            Use a different case number, or send the code again
          </button>
        </form>
      )}
      {error && <p className="mt-3 text-sm text-red-700" data-testid="debtor-error">{error}</p>}
    </Card>
  )
}

/* ------------------------------------------------------------------ signed in */

function AccountView({ token, onSignedOut }: { token: string; onSignedOut: () => void }) {
  const [a, setA] = useState<DebtorAccount | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [round, setRound] = useState(0)

  useEffect(() => {
    let live = true
    fetchDebtorAccount(token)
      .then((r) => { if (live) setA(r) })
      .catch((x) => { if (!live) return; if (x instanceof DebtorSignedOut) onSignedOut(); else setError(x instanceof Error ? x.message : String(x)) })
    return () => { live = false }
  }, [token, onSignedOut, round])

  async function signOut() {
    try { await signOutDebtor(token) } catch { /* signed out here either way */ }
    onSignedOut()
  }

  if (error) return <Card><p className="text-sm text-red-700">{error}</p></Card>
  if (!a) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-[#5A6B80]" /></div>

  const s = a.summary
  /* A CLOSED ACCOUNT SAYS SO FIRST. Paid up and settled are the debtor's good news; a withdrawn account is back with
     the client and nothing on this page is ours to collect any more. */
  const closedLine = a.closed === 'paid_up' ? 'This account is paid in full and closed. Thank you.'
    : a.closed === 'settled' ? 'This account was settled and is closed. Thank you.'
      : a.closed === 'withdrawn' ? `${a.client || 'Our client'} has taken this account back. Please contact them about it.`
        : null

  return (
    <div className="space-y-4" data-testid="debtor-account">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold" style={{ color: NAVY }}>{a.name || 'Your account'}</h1>
          <p className="mt-0.5 text-sm text-[#5A6B80]">Case {a.caseNumber}{a.client ? ` · on behalf of ${a.client}` : ''}{a.clientReference ? ` (their reference ${a.clientReference})` : ''}</p>
        </div>
        <button type="button" onClick={signOut} className="flex shrink-0 items-center gap-1.5 text-sm text-[#5A6B80]" aria-label="Sign out">
          <LogOut size={15} /> Sign out
        </button>
      </div>

      {closedLine && <Card><p className="text-[15px] font-medium" style={{ color: NAVY }} data-testid="debtor-closed">{closedLine}</p></Card>}

      {a.closed !== 'withdrawn' && (
        <Card>
          <Label>What you owe today · {longDay(a.asAt)}</Label>
          <p className="mt-1 text-[34px] font-bold tabular-nums leading-tight" style={{ color: NAVY }} data-testid="debtor-balance">{money(Math.max(0, s.balance))}</p>
          {s.balance > 0 && s.settleToday !== s.balance && (
            <p className="mt-1 text-sm text-[#5A6B80]">To settle in full today: <span className="font-semibold tabular-nums" data-testid="debtor-settle">{money(s.settleToday)}</span>, which includes the fee on the final payment.</p>
          )}
          {s.balance < 0 && <p className="mt-1 text-sm text-[#5A6B80]">You have paid {money(-s.balance)} more than you owed. Please call us so we can return it.</p>}
          <dl className="mt-4 divide-y divide-[#EEF2F6] text-[15px]" data-testid="debtor-breakdown">
            <Row label="Original amount owed" value={s.capital} />
            <Row label="Interest" value={s.interest} />
            <Row label="Fees and costs (VAT included)" value={s.fees} />
            <Row label="You have paid" value={-s.paid} />
          </dl>
          {s.note && <p className="mt-3 rounded-lg bg-[#F2F5F8] p-3 text-sm text-[#3F5F86]" data-testid="debtor-note">{s.note}</p>}
        </Card>
      )}

      {a.pay && !a.closed && s.balance > 0 && (
        <Card>
          <Label>How to pay</Label>
          <p className="mt-1 text-[15px] text-[#5A6B80]">Pay into our trust account. <strong className="text-[#1B2B3E]">Always use your case number as the reference</strong> — that is how your payment reaches your account.</p>
          <dl className="mt-3 space-y-2 text-[15px]" data-testid="debtor-pay">
            <Pair label="Account name" value={a.pay.accountName} />
            {a.pay.bank && <Pair label="Bank" value={a.pay.bank} />}
            {a.pay.accountNumber && <Pair label="Account number" value={a.pay.accountNumber} />}
            {a.pay.accountType && <Pair label="Account type" value={a.pay.accountType} />}
            {a.pay.branchCode && <Pair label="Branch code" value={a.pay.branchCode} />}
            <div className="flex items-center justify-between gap-3 rounded-lg p-3" style={{ background: '#FBF6EC', border: `1px solid ${GOLD}` }}>
              <div><dt className="text-sm text-[#5A6B80]">Reference</dt><dd className="text-lg font-bold tracking-wide" style={{ color: NAVY }}>{a.pay.reference}</dd></div>
              <button type="button" className="flex items-center gap-1.5 text-sm font-medium" style={{ color: NAVY }}
                onClick={() => { void navigator.clipboard?.writeText(a.pay!.reference).then(() => setCopied(true)).catch(() => {}) }}>
                <Copy size={15} /> {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </dl>
        </Card>
      )}

      {!a.closed && s.balance > 0 && <ArrangementSection token={token} account={a} onSent={() => setRound((n) => n + 1)} />}

      {!a.closed && s.balance > 0 && <ProofOfPayment token={token} />}

      <Statement token={token} />

      <Card>
        <Label>Payments we have received</Label>
        {a.payments.length === 0
          ? <p className="mt-2 text-[15px] text-[#5A6B80]">None yet. A payment shows here once we have confirmed it, usually within two working days.</p>
          : (
            <ul className="mt-2 divide-y divide-[#EEF2F6] text-[15px]" data-testid="debtor-payments">
              {a.payments.map((p, i) => (
                <li key={`${p.on}-${i}`} className="flex justify-between py-2"><span>{longDay(p.on)}</span><span className="tabular-nums font-medium">{money(p.amount)}</span></li>
              ))}
            </ul>
          )}
      </Card>

      {a.contact && (a.contact.phone || a.contact.email) && (
        <p className="px-1 text-center text-sm text-[#5A6B80]">
          Questions? {a.contact.phone && <>Call us on <a href={`tel:${a.contact.phone.replace(/\s/g, '')}`} className="underline">{a.contact.phone}</a></>}
          {a.contact.phone && a.contact.email ? ' or email ' : a.contact.email ? 'Email ' : ''}
          {a.contact.email && <a href={`mailto:${a.contact.email}`} className="underline">{a.contact.email}</a>}
          , quoting {a.caseNumber}.
        </p>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: number }) {
  return <div className="flex justify-between py-2"><dt className="text-[#5A6B80]">{label}</dt><dd className="tabular-nums">{value < 0 ? `− ${money(-value)}` : money(value)}</dd></div>
}
function Pair({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-3"><dt className="text-[#5A6B80]">{label}</dt><dd className="text-right font-medium">{value}</dd></div>
}

/* ------------------------------------------------------------------ part 2 */

/**
 * THE STATEMENT, AS A PDF THE DEBTOR KEEPS. Drawn on the server (the collector's own statement, on the firm's
 * letterhead) and saved through fileSave.saveFile -- an ordinary download on a computer, the share sheet's "Save to
 * Files" on an iPhone -- because on a phone a PDF opened in the tab replaces the page and the debtor cannot get back.
 */
function Statement({ token }: { token: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /* SAFARI'S SECOND TAP (fileSave.ts): drawing the statement can outlast the tap that asked for it, and then an iPhone
     will not open the share sheet. The file is kept and one more tap -- "Save ..." -- hands it over. */
  const [ready, setReady] = useState<{ blob: Blob; name: string } | null>(null)
  async function download() {
    setBusy(true); setError(null); setReady(null)
    try {
      const r = await fetchDebtorStatement(token)
      const blob = new Blob([Uint8Array.from(atob(r.pdf), (ch) => ch.charCodeAt(0))], { type: 'application/pdf' })
      if ((await saveFile(blob, r.fileName)) === 'needs-tap') setReady({ blob, name: r.fileName })
    } catch (x) { setError(x instanceof Error ? x.message : String(x)) } finally { setBusy(false) }
  }
  return (
    <Card>
      <Label>Your statement</Label>
      <p className="mt-1 text-[15px] text-[#5A6B80]">Every amount on your account in date order, on our letterhead.</p>
      <button type="button" onClick={download} disabled={busy} data-testid="debtor-statement"
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border px-4 py-3 text-base font-semibold disabled:opacity-50"
        style={{ borderColor: NAVY, color: NAVY }}>
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <><FileDown size={18} /> Download my statement (PDF)</>}
      </button>
      {ready && (
        <button type="button" onClick={() => { void saveFile(ready.blob, ready.name, { fromTap: true }).then(() => setReady(null)) }}
          className="mt-2 w-full rounded-lg px-4 py-3 text-base font-semibold text-white" style={{ background: NAVY }}>
          Save {ready.name}
        </button>
      )}
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </Card>
  )
}

/**
 * SEND US YOUR PROOF OF PAYMENT. The slip is what matters; the amount and the day only help finance find the line on
 * the bank statement, so both are optional. Said plainly that it is not yet a payment -- a debtor who uploads a slip and
 * sees the balance unchanged must not think it went nowhere.
 */
function ProofOfPayment({ token }: { token: string }) {
  const [file, setFile] = useState<File | null>(null)
  const [amount, setAmount] = useState('')
  const [paidOn, setPaidOn] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function send(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!file || !debtorPopFile(file.name)) { setError('Choose a PDF or a photo (JPG, PNG or HEIC) of your proof of payment.'); return }
    if (file.size > DEBTOR_POP_MAX_BYTES) { setError('That file is larger than 3 MB. A photo or a smaller PDF will do.'); return }
    setBusy(true)
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''))
        r.onerror = () => reject(new Error('The file could not be read. Please choose it again.'))
        r.readAsDataURL(file)
      })
      await sendDebtorProofOfPayment(token, { fileName: file.name, data, amount: amount || undefined, paidOn: paidOn || undefined })
      setDone(true)
    } catch (x) { setError(x instanceof Error ? x.message : String(x)) } finally { setBusy(false) }
  }

  if (done) {
    return (
      <Card>
        <Label>Proof of payment</Label>
        <p className="mt-1 text-[15px]" style={{ color: NAVY }} data-testid="debtor-pop-done">Thank you, we have it. We will check it against our bank account; the payment shows on this page once it is confirmed, usually within two working days.</p>
        <button type="button" onClick={() => { setDone(false); setFile(null); setAmount(''); setPaidOn('') }} className="mt-2 text-sm text-[#5A6B80] underline">Send another</button>
      </Card>
    )
  }
  return (
    <Card>
      <Label>Paid already? Send us your proof of payment</Label>
      <form onSubmit={send} className="mt-3 space-y-3" data-testid="debtor-pop">
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-[#AEBBCB] px-4 py-4 text-[15px] text-[#3F5F86]">
          <Upload size={18} /> {file ? file.name : 'Choose the PDF or a photo'}
          <input type="file" accept=".pdf,.jpg,.jpeg,.png,.heic,.heif,.webp,application/pdf,image/*" className="sr-only" aria-label="Proof of payment file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-sm"><span className="mb-1 block text-[#5A6B80]">Amount (optional)</span>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="500" aria-label="Amount paid" className={field} />
          </label>
          <label className="block text-sm"><span className="mb-1 block text-[#5A6B80]">Date paid (optional)</span>
            <input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} aria-label="Date paid" className={field} />
          </label>
        </div>
        <button type="submit" disabled={busy || !file} className={button} style={{ background: NAVY }}>
          {busy ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : 'Send it'}
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-red-700" data-testid="debtor-pop-error">{error}</p>}
    </Card>
  )
}

/* ------------------------------------------------------------------ part 3 */

const EVERY: Record<string, string> = { once_off: 'once-off', weekly: 'a week', monthly: 'a month' }

/**
 * MAKE AN ARRANGEMENT. Four states, and the page shows exactly one: an arrangement in force (say it, and how to
 * change it -- by calling), an offer waiting (say so), an offer declined (say why, and let them offer again), or
 * nothing yet (the form). The rules are checked as they type, with the same proposalProblem the server applies, so a
 * debtor learns "at least R 410 a month" before pressing Send rather than after.
 */
function ArrangementSection({ token, account, onSent }: { token: string; account: DebtorAccount; onSent: () => void }) {
  const [arrangement, setArrangement] = useState<Arrangement>('monthly')
  const [amount, setAmount] = useState('')
  const [firstDueOn, setFirstDueOn] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const s = account.summary
  const today = account.asAt

  if (account.live) {
    return (
      <Card>
        <Label>Your arrangement</Label>
        <p className="mt-1 text-[15px]" style={{ color: NAVY }} data-testid="debtor-live-arrangement">
          {money(account.live.amount)} {EVERY[account.live.arrangement] ?? ''}, next payment due {longDay(account.live.dueOn)}.
        </p>
        {account.live.missed && <p className="mt-2 text-sm text-red-700">A payment was missed. Please pay it now, or call us.</p>}
        <p className="mt-2 text-sm text-[#5A6B80]">To change your arrangement, please call us.</p>
      </Card>
    )
  }
  if (account.proposal?.status === 'pending') {
    const pr = account.proposal
    /* AN APPLICATION WAITS ON THE FORM FIRST: until the assessment is signed there is nothing for us to decide, and the
       debtor is the only one who can move it -- so the button to it is the first thing they see. */
    const formOpen = pr.needsAssessment && pr.assessment && pr.assessment.state !== 'signed'
    return (
      <Card>
        <Label>{pr.needsAssessment ? 'Your application' : 'Your offer'}</Label>
        <p className="mt-1 text-[15px]" style={{ color: NAVY }} data-testid="debtor-offer-pending">
          We have your {pr.needsAssessment ? 'application' : 'offer'} of {money(pr.amount)} {EVERY[pr.arrangement] ?? ''} from {longDay(pr.firstDueOn)}.
          {formOpen ? ' Please fill in and sign the affordability assessment so we can look at it.' : ' One of our team will look at it and reply, usually within one working day.'}
        </p>
        {formOpen && (
          <a href={pr.assessment!.link} className={`${button} mt-3 block text-center`} style={{ background: NAVY }} data-testid="debtor-assessment-link">
            Fill in my affordability assessment
          </a>
        )}
        {pr.needsAssessment && !pr.assessment && <p className="mt-2 text-sm text-[#5A6B80]">We will email you the affordability assessment to fill in.</p>}
      </Card>
    )
  }

  const value = Number(amount.replace(/[^\d.,]/g, '').replace(',', '.'))
  const offer = { arrangement, amount: value, firstDueOn }
  const typed = amount.trim() !== '' && firstDueOn !== ''
  const problem = typed ? proposalProblem(offer, { balance: s.balance, settlement: s.settleToday }, today) : null
  const application = typed && !problem && needsApplication(offer, s.settleToday)

  async function send(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const p = proposalProblem(offer, { balance: s.balance, settlement: s.settleToday }, today)
    if (p) { setError(p); return }
    setBusy(true)
    try {
      const r = await proposeDebtorArrangement(token, { arrangement, amount, firstDueOn, note: note.trim() || undefined })
      /* Straight on to the form, in this tab: it is the next thing they have to do, and the portal is a tap back. */
      if (r.assessmentLink) { window.location.assign(r.assessmentLink); return }
      onSent()
    }
    catch (x) { setError(x instanceof Error ? x.message : String(x)) } finally { setBusy(false) }
  }

  return (
    <Card>
      <Label>Make an arrangement</Label>
      {account.proposal?.status === 'declined' && (
        <p className="mt-2 rounded-lg bg-[#FBF6EC] p-3 text-sm" style={{ color: NAVY }} data-testid="debtor-offer-declined">
          We could not accept your last offer: {account.proposal.declineReason}. You can make another below, or call us.
        </p>
      )}
      <p className="mt-1 text-[15px] text-[#5A6B80]">Tell us what you can pay. One of our team will look at it and reply; nothing is agreed until we do.</p>
      <form onSubmit={send} className="mt-3 space-y-3" data-testid="debtor-propose">
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-[#F2F5F8] p-1" role="radiogroup" aria-label="How often">
          {(['once_off', 'weekly', 'monthly'] as const).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={arrangement === k} onClick={() => setArrangement(k)}
              className={`rounded-md px-2 py-2 text-sm font-medium ${arrangement === k ? 'bg-white shadow-sm' : 'text-[#5A6B80]'}`}
              style={arrangement === k ? { color: NAVY } : undefined}>
              {k === 'once_off' ? 'Once-off' : k === 'weekly' ? 'Weekly' : 'Monthly'}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-sm"><span className="mb-1 block text-[#5A6B80]">{arrangement === 'once_off' ? 'Amount' : arrangement === 'weekly' ? 'Each week' : 'Each month'}</span>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="500" aria-label="Amount you can pay" className={field} />
          </label>
          <label className="block text-sm"><span className="mb-1 block text-[#5A6B80]">{arrangement === 'once_off' ? 'On' : 'First payment'}</span>
            <input type="date" value={firstDueOn} onChange={(e) => setFirstDueOn(e.target.value)} min={today} aria-label="First payment date" className={field} />
          </label>
        </div>
        <label className="block text-sm"><span className="mb-1 block text-[#5A6B80]">Anything we should know (optional)</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} aria-label="Note" className={field} />
        </label>
        {typed && !problem && <p className="text-sm" style={{ color: NAVY }} data-testid="debtor-offer-summary">{proposalSummary(offer, s.settleToday)}.</p>}
        {application && <p className="rounded-lg bg-[#FBF6EC] p-3 text-sm" style={{ color: NAVY }} data-testid="debtor-offer-application">{applicationNote(offer, s.settleToday)}</p>}
        {typed && problem && <p className="text-sm text-red-700" data-testid="debtor-offer-problem">{problem}</p>}
        <button type="submit" disabled={busy || !typed || !!problem} className={button} style={{ background: NAVY }}>
          {busy ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : application ? 'Send my application' : 'Send my offer'}
        </button>
        <p className="text-xs text-[#5A6B80]">The first payment must be within {PROPOSAL_RULES.firstPaymentWithinDays} days. Instalments that take longer than {PROPOSAL_RULES.longestMonths} months to settle the account are an application, with a short form about your income and expenses.</p>
      </form>
      {error && <p className="mt-2 text-sm text-red-700" data-testid="debtor-propose-error">{error}</p>}
    </Card>
  )
}
