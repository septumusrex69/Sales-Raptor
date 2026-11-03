import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Building2, Download, FilePen, Mail, Plus, RotateCcw, Search, Trash2, UserRound, X } from 'lucide-react'
import { useAppStore } from '../../store/AppStore'
import { useAuth } from '../../store/AuthContext'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { supabase } from '../../lib/supabase'
import { fetchAccount, fetchAccounts, fetchLedgersForAccounts, type DebtorAccount } from '../../lib/accountBook'
import { computeBalance } from '../../lib/accountBalance'
import { balanceInputFor } from '../../lib/balanceInput'
import { isWrittenOff } from '../../lib/accountStatus'
import { firmToday } from '../../lib/dateLabels'
import { uploadDocument } from '../../lib/accountWorkspace'
import { saveFile } from '../../lib/fileSave'
import { recordSentEmail } from '../../lib/accountEmails'
import { chargeMessage } from '../../lib/accountCharges'
import {
  amountDue, anyAmount, blankRow, debtorEmail, debtorName, fmtRand, freshLetter, letterFileName, letterFromAccount, linesTotal,
  missingFor, numberWord, parseAmt, type LetterState,
} from '../../lib/letterOfDemand'
import { DemandSheet, UnprintableError, type Which } from './demandSheet'

/**
 * NEW LETTER -- RYNO'S LETTER OF DEMAND BUILDER, INSIDE RAPTOR (Raptor · Handover 16, 3 Nov).
 *
 * Ryno: type everything in, OR find the client as you type ("like Google search"), then the debtor -- by name, or by
 * the client's reference or ours -- and Raptor "fetch[es] all the information", for a "double check" before it
 * goes; then "Raptor can send it", from a mailbox chosen here, or it is downloaded and sent by hand; and every
 * field, line and sentence stays editable, because "not all the debtors ... the invoicing is going to be so clear".
 *
 * A COPY IS KEPT ON THE ACCOUNT, every time one is sent or downloaded with an account chosen: a letter of demand is
 * a legal document, and the firm must always be able to show what went out and when. It is filed under the
 * account's Documents as "Letter of Demand" (DOCUMENT_KINDS already had the kind). Saving a document charges
 * nothing (the firm removed the perusal fee, 21 Oct). Sending it is an email to the debtor and is recorded exactly
 * as one -- recordSentEmail, item 1(a) -- because that is what it is.
 *
 * Nothing here writes to an account's figures. The balance is READ, worked out the way the book works it out.
 */

const DRAFT = 'raptor-letter-of-demand-v1'

interface Draft { s: LetterState; accountId: string | null; companyId: string | null; wording: Record<string, string> | null }

function readDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT)
    if (!raw) return null
    const d = JSON.parse(raw) as Draft
    return d && d.s && Array.isArray(d.s.rows) ? d : null
  } catch { return null }
}

const toBase64 = (bytes: Uint8Array) => {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

const INPUT = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-400'

export function LetterOfDemandPage() {
  const [params] = useSearchParams()
  const { companies } = useAppStore()
  const { currentUser } = useAuth()
  const host = useRef<HTMLDivElement>(null)
  const sheet = useRef<DemandSheet | null>(null)
  const today = firmToday()

  const draft = useMemo(() => readDraft(), [])
  const fromLink = params.get('client') || params.get('account')
  const [s, setS] = useState<LetterState>(() => (!fromLink && draft ? { ...draft.s, date: freshLetter(today).date } : freshLetter(today)))
  const [companyId, setCompanyId] = useState<string | null>(() => params.get('client') ?? (fromLink ? null : draft?.companyId ?? null))
  const [account, setAccount] = useState<DebtorAccount | null>(null)
  const [accountId, setAccountId] = useState<string | null>(() => params.get('account') ?? (fromLink ? null : draft?.accountId ?? null))
  const [balanceNote, setBalanceNote] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ which: Which; missing: string[] } | null>(null)
  const [sending, setSending] = useState(false)
  const [wordingTick, setWordingTick] = useState(0)
  /* Safari would not open the share sheet that long after the tap: one more tap, with the file in hand. */
  const [pendingSave, setPendingSave] = useState<{ blob: Blob; name: string } | null>(null)
  /* What was last saved on the account, per sheet, so a second download of the same letter is not a second copy. */
  const saved = useRef<Record<Which, string>>({ letter: '', ack: '' })

  const company = companies.find((c) => c.id === companyId) ?? null

  /* ---------- the island ---------- */
  useEffect(() => {
    if (!host.current) return
    const sh = new DemandSheet(host.current)
    sheet.current = sh
    if (!fromLink) sh.applyParagraphs(draft?.wording)
    return () => sh.destroy()
  }, [draft, fromLink])
  useEffect(() => { sheet.current?.render(s) }, [s])
  useEffect(() => { sheet.current?.setEditable(editing, () => setWordingTick((t) => t + 1)) }, [editing])

  /* ---------- the draft: this browser only, a convenience; the record of a letter is the copy on the account ---------- */
  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        localStorage.setItem(DRAFT, JSON.stringify({ s, accountId, companyId, wording: sheet.current?.paragraphs() ?? null } satisfies Draft))
      } catch { /* a private window keeps nothing; the page works the same */ }
    }, 400)
    return () => window.clearTimeout(t)
  }, [s, accountId, companyId, wordingTick])

  const patch = (p: Partial<LetterState>) => setS((x) => ({ ...x, ...p }))
  const setRow = (i: number, p: Partial<LetterState['rows'][number]>) => setS((x) => ({ ...x, rows: x.rows.map((r, j) => (j === i ? { ...r, ...p } : r)) }))

  /* ---------- an account, poured in ---------- */
  const chooseAccount = useCallback(async (a: DebtorAccount) => {
    setBusy('account'); setError(null)
    try {
      const [ledgers, { data: contacts }] = await Promise.all([
        fetchLedgersForAccounts([a.id]),
        supabase.from('account_contacts').select('kind, value, is_primary, retired_at, created_at').eq('account_id', a.id),
      ])
      const rows = ledgers.get(a.id)
      const b = rows ? computeBalance(balanceInputFor({
        account: {
          capitalHandedOver: a.capitalHandedOver, handoverDate: a.handoverDate, interestRateAnnual: a.interestRateAnnual, status: a.status,
          lastActionAt: a.lastActionAt, endedAs: a.endedAs, prescribed: a.prescribed, prescriptionDate: a.prescriptionDate, endedOn: a.endedOn,
        },
        ledgers: rows, today, writtenOff: isWrittenOff,
      })) : null
      const clientName = companies.find((c) => c.id === a.companyId)?.name ?? a.companyName ?? ''
      setS((x) => letterFromAccount(x, a, clientName, b ? b.balance : null, debtorEmail((contacts ?? []) as never[])))
      setAccount(a); setAccountId(a.id); setCompanyId(a.companyId)
      saved.current = { letter: '', ack: '' }
      setBalanceNote(b
        ? `Amount due is today’s balance on ${a.caseNumber}: ${fmtRand(b.balance)} (capital ${fmtRand(b.capital)}, interest ${fmtRand(b.interest)}, fees ${fmtRand(b.fees + b.receiptFees)}, paid ${fmtRand(b.payments)}).`
        : `The balance on ${a.caseNumber} could not be worked out, so the line is the capital handed over. Check the amount.`)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(null) }
  }, [companies, today])

  /* Opened from a link naming an account (or reloading a draft that had one): fill it in once. */
  const opened = useRef(false)
  useEffect(() => {
    if (opened.current || !accountId) return
    opened.current = true
    fetchAccount(accountId).then((a) => {
      if (!a) return
      if (params.get('account')) void chooseAccount(a)
      else setAccount(a)
    }).catch(() => undefined)
  }, [accountId, chooseAccount, params])
  /* Opened from a client's page: the client's name, nothing else. */
  useEffect(() => {
    if (params.get('client') && company && !s.client) patch({ client: company.name })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company])

  const clearAccount = () => { setAccount(null); setAccountId(null); setBalanceNote(null) }
  const startAgain = () => {
    setS(freshLetter(today)); setCompanyId(null); clearAccount(); setEditing(false)
    sheet.current?.resetParagraphs(); setStatus('New letter started')
  }

  /* ---------- the PDFs ---------- */
  async function makePdf(which: Which): Promise<{ bytes: Uint8Array; name: string } | null> {
    const sh = sheet.current
    if (!sh) return null
    const kind = which === 'ack' ? 'Acknowledgement of Receipt' : 'Letter of Demand'
    try {
      const bytes = await sh.pdf(which, `${kind} – ${s.debtor || 'Debtor'}`)
      return { bytes, name: letterFileName(kind, s) }
    } catch (e) {
      setError(e instanceof UnprintableError ? e.message : `The PDF could not be made: ${e instanceof Error ? e.message : String(e)}`)
      return null
    }
  }

  /** The copy on the account, once per distinct letter. */
  async function keepCopy(which: Which, pdf: { bytes: Uint8Array; name: string }): Promise<boolean> {
    if (!account) return false
    /* The LETTER's content, not the file's bytes: every PDF carries the moment it was made, so two of the same letter never match byte for byte. */
    const key = `${JSON.stringify(s)}:${JSON.stringify(sheet.current?.paragraphs() ?? {})}`
    if (saved.current[which] === key) return true
    await uploadDocument({
      accountId: account.id, file: new File([pdf.bytes as BlobPart], pdf.name, { type: 'application/pdf' }), kind: 'Letter of Demand',
      uploadedBy: currentUser?.id ?? null, uploadedByName: currentUser?.name ?? null,
    })
    saved.current[which] = key
    return true
  }

  async function download(which: Which) {
    setConfirm(null); setBusy(which); setError(null); setStatus(null)
    try {
      const pdf = await makePdf(which)
      if (!pdf) return
      /* fileSave.ts, the one place a file is saved: on an iPad it is the share sheet ("Save to Files"), not a tab over Raptor. */
      const blob = new Blob([pdf.bytes as BlobPart], { type: 'application/pdf' })
      const outcome = await saveFile(blob, pdf.name)
      if (outcome === 'needs-tap') setPendingSave({ blob, name: pdf.name })
      const kept = await keepCopy(which, pdf).catch((e: unknown) => { setError(`Downloaded, but the copy was not kept on the account: ${e instanceof Error ? e.message : String(e)}`); return false })
      setStatus(`${outcome === 'cancelled' ? `${pdf.name} was not saved.` : outcome === 'needs-tap' ? `${pdf.name} is ready.` : `${pdf.name} downloaded.`}${kept ? ' A copy is on the account, under Documents.' : ''}`)
    } finally { setBusy(null) }
  }
  const ask = (which: Which) => {
    const m = missingFor(s, which)
    if (m.length) setConfirm({ which, missing: m })
    else void download(which)
  }

  /* ---------- the client and the debtor, found as you type ---------- */
  const [clientQ, setClientQ] = useState('')
  const clientHits = useMemo(() => {
    const q = clientQ.trim().toLowerCase()
    if (!q) return []
    return companies.filter((c) => `${c.name} ${c.code ?? ''}`.toLowerCase().includes(q))
      .sort((a, b) => Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)) || a.name.localeCompare(b.name)).slice(0, 8)
  }, [clientQ, companies])

  const [debtorQ, setDebtorQ] = useState('')
  const [debtorHits, setDebtorHits] = useState<DebtorAccount[] | null>(null)
  useEffect(() => {
    const q = debtorQ.trim()
    if (q.length < 2) { setDebtorHits(null); return }
    let live = true
    const t = window.setTimeout(() => {
      /* In the database, paged, as every read of the book is: the search is the list's own clause. */
      fetchAccounts({ companyId: companyId ?? undefined, search: q, pageSize: 8, countRows: false })
        .then((p) => { if (live) setDebtorHits(p.accounts) }).catch(() => { if (live) setDebtorHits([]) })
    }, 250)
    return () => { live = false; window.clearTimeout(t) }
  }, [debtorQ, companyId])

  const total = linesTotal(s)
  const typed = parseAmt(s.amount)
  const amountHint = typed !== null && anyAmount(s) && Math.abs(typed - total) > 0.004
    ? (account && balanceNote ? balanceNote : `This doesn’t match the invoice total of ${fmtRand(total)}. Clear this box to use the invoice total.`)
    : 'Adds itself up from the invoices below. Type an amount only if it should be different.'

  return (
    <div className="space-y-4" data-testid="lod-page">
      <div className="flex flex-wrap items-center gap-2">
        <Link to={company ? `/companies/${company.id}` : '/companies'} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
          <ArrowLeft size={14} /> {company ? company.name : 'Clients'}
        </Link>
        <span className="ml-auto text-xs text-slate-400" aria-live="polite" data-testid="lod-status">{status}</span>
        {pendingSave && (
          <Button size="sm" variant="primary" icon={<Download size={14} />}
            onClick={() => { const p = pendingSave; setPendingSave(null); void saveFile(p.blob, p.name, { fromTap: true }) }}>Save {pendingSave.name}</Button>
        )}
        <Button size="sm" icon={<RotateCcw size={14} />} onClick={startAgain} data-testid="lod-new">New letter</Button>
        <Button size="sm" icon={<Download size={14} />} disabled={!!busy} onClick={() => ask('ack')} data-testid="lod-ack-pdf">Acknowledgement PDF</Button>
        <Button size="sm" icon={<Download size={14} />} disabled={!!busy} onClick={() => ask('letter')} data-testid="lod-pdf">Letter PDF</Button>
        <Button size="sm" variant="primary" icon={<Mail size={14} />} disabled={!!busy} onClick={() => setSending(true)} data-testid="lod-send">Send…</Button>
      </div>
      {error && <Card className="border-red-200 bg-red-50"><p className="text-sm text-red-700" data-testid="lod-error">{error}</p></Card>}
      {confirm && (
        <Card className="border-gold-300 bg-gold-50/70">
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-800" data-testid="lod-missing">
            <span className="flex-1 min-w-[16rem]">Still to fill in: {confirm.missing.join(', ')}. Anything missing will print in [brackets].</span>
            <Button size="sm" onClick={() => void download(confirm.which)}>Download anyway</Button>
            <Button size="sm" variant="primary" onClick={() => setConfirm(null)}>Keep editing</Button>
          </div>
        </Card>
      )}

      <div className="grid gap-5 xl:grid-cols-[420px_minmax(0,1fr)] items-start">
        {/* ------------------------------------------- THE FORM ------------------------------------------- */}
        <form className="card p-5 space-y-5 xl:sticky xl:top-20 xl:max-h-[calc(100dvh-6rem)] xl:overflow-auto" onSubmit={(e) => e.preventDefault()} autoComplete="off">
          <div>
            <h2 className="font-semibold text-lg text-slate-800">Letter of demand</h2>
            <p className="text-xs text-slate-500">Find the client and the debtor and Raptor fills it in, or type it all yourself. The letter and the acknowledgement update as you type.</p>
          </div>

          <Section title="Find in Raptor">
            <div className="relative">
              <Label icon={<Building2 size={13} />}>Client</Label>
              {company ? (
                <Chip label={`${company.name}${company.code ? ` · ${company.code}` : ''}`} onClear={() => { setCompanyId(null); clearAccount() }} testid="lod-client-chosen" />
              ) : (
                <>
                  <SearchBox value={clientQ} onChange={setClientQ} placeholder="Start typing a client’s name…" testid="lod-client-search" />
                  {clientHits.length > 0 && (
                    <Hits testid="lod-client-hits">
                      {clientHits.map((c) => (
                        <button key={c.id} type="button" className="w-full text-left px-3 py-2 hover:bg-slate-50 text-sm"
                          onClick={() => { setCompanyId(c.id); setClientQ(''); patch({ client: c.name }) }}>
                          <span className="text-slate-800">{c.name}</span>{c.code && <span className="text-xs text-slate-400 ml-2">{c.code}</span>}
                        </button>
                      ))}
                    </Hits>
                  )}
                </>
              )}
            </div>
            <div className="relative">
              <Label icon={<UserRound size={13} />}>Debtor</Label>
              {account ? (
                <Chip label={`${debtorName(account) || 'Unnamed'} · ${account.caseNumber}`} onClear={clearAccount} testid="lod-account-chosen" />
              ) : (
                <>
                  <SearchBox value={debtorQ} onChange={setDebtorQ} placeholder={company ? `A debtor of ${company.name}: name, our reference or theirs` : 'Name, our reference or the client’s reference'} testid="lod-debtor-search" />
                  {debtorHits && (
                    <Hits testid="lod-debtor-hits">
                      {debtorHits.length === 0 && <p className="px-3 py-2 text-sm text-slate-500">No account matches “{debtorQ.trim()}”{company ? ` for ${company.name}` : ''}.</p>}
                      {debtorHits.map((a) => (
                        <button key={a.id} type="button" className="w-full text-left px-3 py-2 hover:bg-slate-50" onClick={() => { setDebtorQ(''); setDebtorHits(null); void chooseAccount(a) }}>
                          <span className="block text-sm text-slate-800">{debtorName(a) || 'Unnamed'}</span>
                          <span className="block text-xs text-slate-500">{[a.caseNumber, a.clientReference, !company ? a.companyName : null].filter(Boolean).join(' · ')}</span>
                        </button>
                      ))}
                    </Hits>
                  )}
                </>
              )}
              {busy === 'account' && <p className="text-xs text-slate-500 mt-1">Fetching the account…</p>}
            </div>
            {account && balanceNote && (
              <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2" data-testid="lod-balance-note">
                {balanceNote} Check every field below before it goes: the account has one line, and the client’s invoices may be more.
              </p>
            )}
          </Section>

          <Section title="Parties">
            <Text label="Debtor" value={s.debtor} onChange={(v) => patch({ debtor: v })} placeholder="e.g. Esmar Transport and Consulting (Pty) Ltd" testid="lod-debtor" />
            <Text label="Client" value={s.client} onChange={(v) => patch({ client: v })} placeholder="e.g. Truevisions Enterprises (Pty) Ltd" testid="lod-client" />
            <Text label="Debtor’s email (to send it)" value={s.email} onChange={(v) => patch({ email: v })} placeholder="accounts@debtor.co.za" testid="lod-email" />
          </Section>

          <Section title="Letter">
            <div className="grid grid-cols-2 gap-3">
              <Text label="Date of letter" value={s.date} onChange={(v) => patch({ date: v })} testid="lod-date" />
              <Text label="Statement date" value={s.stmt} onChange={(v) => patch({ stmt: v })} placeholder="e.g. 27 October 2026" testid="lod-stmt" />
            </div>
            <Text label="Description of services" value={s.services} onChange={(v) => patch({ services: v })} testid="lod-services"
              hint={`Reads “…who rendered ${s.services.trim() || 'services'} to your company.”`} />
          </Section>

          <Section title="Payment">
            <div className="grid grid-cols-2 gap-3">
              <Text label="Payment reference" value={s.ref} onChange={(v) => patch({ ref: v })} placeholder="e.g. ESMAR" testid="lod-ref" />
              <Text label="Days to pay" value={s.days} onChange={(v) => patch({ days: v.replace(/[^\d]/g, '').slice(0, 2) })} testid="lod-days"
                hint={numberWord(parseInt(s.days, 10)) ?? undefined} />
            </div>
            <Text label="Amount due" value={s.amount} onChange={(v) => patch({ amount: v })} testid="lod-amount"
              onBlur={() => { const n = parseAmt(s.amount); patch({ amount: n === null ? '' : fmtRand(n) }) }}
              placeholder={anyAmount(s) ? `${fmtRand(total)} (from invoices)` : 'Adds up from the invoices'} hint={amountHint} />
          </Section>

          <Section title="Invoices">
            <Text label="Third column heading" value={s.col3} onChange={(v) => patch({ col3: v })} placeholder="REFERENCE" hint="For transport clients, use LOADCON." testid="lod-col3" />
            <div className="space-y-2.5" data-testid="lod-lines">
              {s.rows.map((r, i) => (
                <div key={i} className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                  <div className="flex items-center mb-2">
                    <span className="text-xs font-semibold tracking-wide text-slate-600">INVOICE {i + 1}</span>
                    <button type="button" className="ml-auto text-xs text-slate-500 hover:text-red-600 inline-flex items-center gap-1" aria-label={`Remove invoice ${i + 1}`}
                      onClick={() => setS((x) => ({ ...x, rows: x.rows.length > 1 ? x.rows.filter((_, j) => j !== i) : [blankRow()] }))}><Trash2 size={12} /> Remove</button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Text label="Invoice no." value={r.inv} onChange={(v) => setRow(i, { inv: v })} placeholder="INVO000798" testid={`lod-inv-${i}`} />
                    <Text label="Invoice date" value={r.date} onChange={(v) => setRow(i, { date: v })} placeholder="11 Aug 2026" />
                    <Text label={(s.col3 || 'Reference').charAt(0) + (s.col3 || 'Reference').slice(1).toLowerCase()} value={r.ref} onChange={(v) => setRow(i, { ref: v })} placeholder="2608/1619" />
                    <Text label="Amount" value={r.amt} onChange={(v) => setRow(i, { amt: v })} placeholder="R106,000.00" testid={`lod-amt-${i}`}
                      onBlur={() => { const n = parseAmt(r.amt); setRow(i, { amt: n === null ? '' : fmtRand(n) }) }} />
                    <div className="col-span-2"><Text label="Description" value={r.desc} onChange={(v) => setRow(i, { desc: v })} placeholder="Transport of beer" /></div>
                  </div>
                </div>
              ))}
            </div>
            <button type="button" onClick={() => setS((x) => ({ ...x, rows: [...x.rows, blankRow()] }))} data-testid="lod-add-line"
              className="w-full rounded-lg border border-dashed border-slate-300 py-2 text-sm text-slate-600 hover:border-brand-400 inline-flex items-center justify-center gap-1"><Plus size={14} /> Add invoice</button>
            <div className="flex items-baseline justify-between border-t border-slate-200 pt-2 text-sm">
              <span className="text-slate-500">Invoice total</span><b className="tabular-nums font-[Georgia,serif] text-base" data-testid="lod-total">{fmtRand(total)}</b>
            </div>
          </Section>
        </form>

        {/* ------------------------------------------- THE PAPER ------------------------------------------- */}
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant={editing ? 'primary' : 'secondary'} icon={<FilePen size={14} />} onClick={() => setEditing((e) => !e)} data-testid="lod-edit-wording">
              {editing ? 'Done editing the wording' : 'Edit the wording'}
            </Button>
            {editing && <Button size="sm" onClick={() => { sheet.current?.resetParagraphs(); sheet.current?.setEditable(true, () => setWordingTick((t) => t + 1)); setWordingTick((t) => t + 1) }}>Back to the standard wording</Button>}
            <span className="text-xs text-slate-500">
              {editing ? 'Click into any paragraph and type. The figures in it still follow the form.' : 'Amount due: '}
              {!editing && <b className="text-slate-700">{amountDue(s) === null ? '—' : fmtRand(amountDue(s) as number)}</b>}
            </span>
          </div>
          <div ref={host} className="min-w-0 rounded-xl bg-slate-100 p-3 sm:p-4" data-testid="lod-preview" />
        </div>
      </div>

      {sending && (
        <SendLetter s={s} account={account} onClose={() => setSending(false)} makePdf={makePdf} keepCopy={keepCopy}
          onSent={(msg) => { setSending(false); setStatus(msg) }} />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------------------------------------
 * Sending it
 * ---------------------------------------------------------------------------------------------- */

interface Sender { from: 'me' | 'owner' | 'central'; label: string; address: string | null; ready: boolean; why: string | null }

async function letterCall<T>(body: Record<string, unknown>): Promise<T> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Your session has expired. Sign in again.')
  const res = await fetch('/api/email/letter', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) })
  const out = await res.json().catch(() => ({})) as T & { error?: string }
  if (!res.ok) throw new Error(out.error ?? `The server answered ${res.status}.`)
  return out
}

const escHtml = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function SendLetter({ s, account, onClose, makePdf, keepCopy, onSent }: {
  s: LetterState; account: DebtorAccount | null; onClose: () => void
  makePdf: (w: Which) => Promise<{ bytes: Uint8Array; name: string } | null>
  keepCopy: (w: Which, pdf: { bytes: Uint8Array; name: string }) => Promise<boolean>
  onSent: (msg: string) => void
}) {
  const { currentUser } = useAuth()
  const [senders, setSenders] = useState<Sender[] | null>(null)
  const [from, setFrom] = useState<Sender['from']>('me')
  const [to, setTo] = useState(s.email)
  const [withAck, setWithAck] = useState(true)
  const due = amountDue(s)
  const [subject, setSubject] = useState(`Letter of demand: ${s.debtor || 'your account'}${s.ref ? ` (ref ${s.ref})` : ''}`)
  const [message, setMessage] = useState(
    `Dear Sir/Madam,\n\nPlease find attached our letter of demand on behalf of ${s.client || 'our client'}${due !== null ? `, for ${fmtRand(due)}` : ''}${withAck ? ', with an acknowledgement of receipt to complete and return' : ''}.\n\nKind regards`,
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const missing = missingFor(s, 'letter')

  useEffect(() => {
    letterCall<{ senders: Sender[] }>({ step: 'senders', accountId: account?.id ?? null })
      .then((r) => { setSenders(r.senders); const first = r.senders.find((x) => x.ready); if (first) setFrom(first.from) })
      .catch((e: unknown) => { setSenders([]); setError(e instanceof Error ? e.message : String(e)) })
  }, [account?.id])
  const chosen = senders?.find((x) => x.from === from) ?? null

  async function send() {
    setBusy(true); setError(null)
    try {
      const letter = await makePdf('letter')
      if (!letter) { setError('The letter could not be made: see the message above the form.'); return }
      const ack = withAck ? await makePdf('ack') : null
      if (withAck && !ack) { setError('The acknowledgement could not be made: see the message above the form.'); return }
      const files = [letter, ...(ack ? [ack] : [])]
      const bodyHtml = message.trim().split(/\n\s*\n/).map((p) => escHtml(p).replace(/\n/g, '<br>')).join('<br><br>')
      const r = await letterCall<{ messageId: string | null; from: string }>({
        step: 'send', from, accountId: account?.id ?? null, to: to.trim(), subject: subject.trim(), bodyHtml,
        attachments: files.map((f) => ({ filename: f.name, contentType: 'application/pdf', content: toBase64(f.bytes) })),
      })
      if (!account) { onSent(`Sent to ${to.trim()} from ${r.from}. It is on no account, so nothing was filed or charged.`); return }
      /* RECORDED AS EVERY EMAIL TO A DEBTOR IS: item 1(a), account_emails, the timeline -- the one function that does it. */
      const charge = await recordSentEmail({
        accountId: account.id, to: to.trim(), from: r.from, subject: subject.trim(), body: `${message.trim()}\n\n[Attached: ${files.map((f) => f.name).join(', ')}]`,
        messageId: r.messageId, actor: { id: currentUser?.id ?? null, name: currentUser?.name ?? null },
      })
      const kept = await Promise.all(files.map((f, i) => keepCopy(i === 0 ? 'letter' : 'ack', f))).then(() => true).catch(() => false)
      onSent(`Sent to ${to.trim()} from ${r.from}. ${chargeMessage(charge, '1a')}${kept ? ' A copy is on the account, under Documents.' : ' The copy could not be kept on the account: download it and add it under Documents.'}`)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  const canSend = !!chosen?.ready && /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(to.trim()) && !!subject.trim() && !busy
  return (
    <Modal title="Send the letter of demand" onClose={onClose} width={640}
      footer={(
        <div className="flex flex-wrap items-center gap-2 justify-end">
          {error && <span className="text-sm text-red-600 mr-auto" data-testid="lod-send-error">{error}</span>}
          <Button onClick={onClose}>Not yet</Button>
          <Button variant="primary" icon={<Mail size={14} />} disabled={!canSend} onClick={() => void send()} data-testid="lod-send-confirm">{busy ? 'Sending…' : 'Send'}</Button>
        </div>
      )}>
      <div className="space-y-3 text-sm" data-testid="lod-send-modal">
        {missing.length > 0 && <p className="rounded-lg bg-gold-50 border border-gold-200 px-3 py-2 text-gold-800">Still to fill in: {missing.join(', ')}. They will print in [brackets].</p>}
        <label className="block">
          <span className="block text-xs font-medium text-slate-500 mb-1">From</span>
          {senders === null ? <p className="text-slate-400">Checking the mailboxes…</p> : (
            <div className="space-y-1.5" data-testid="lod-from">
              {senders.map((x) => (
                <label key={x.from} className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${from === x.from ? 'border-brand-400 bg-brand-50/50' : 'border-slate-200'} ${x.ready ? '' : 'opacity-60'}`}>
                  <input type="radio" name="lod-from" className="mt-1" checked={from === x.from} disabled={!x.ready} onChange={() => setFrom(x.from)} data-testid={`lod-from-${x.from}`} />
                  <span><span className="block text-slate-800">{x.label}</span><span className="block text-xs text-slate-500">{x.address ?? x.why}</span></span>
                </label>
              ))}
            </div>
          )}
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-slate-500 mb-1">To</span>
          <input className={INPUT} value={to} onChange={(e) => setTo(e.target.value)} placeholder="accounts@debtor.co.za" data-testid="lod-send-to" />
          {!s.email && account && <span className="block text-xs text-slate-500 mt-1">The account has no email address on it. Type the debtor’s here.</span>}
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-slate-500 mb-1">Subject</span>
          <input className={INPUT} value={subject} onChange={(e) => setSubject(e.target.value)} data-testid="lod-send-subject" />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-slate-500 mb-1">Message</span>
          <textarea className={`${INPUT} min-h-[8rem] font-[Georgia,serif]`} value={message} onChange={(e) => setMessage(e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-slate-700">
          <input type="checkbox" checked={withAck} onChange={(e) => setWithAck(e.target.checked)} /> Attach the acknowledgement of receipt too
        </label>
        <p className="text-xs text-slate-500" data-testid="lod-send-note">
          {account
            ? `It goes from the mailbox chosen, is filed on ${account.caseNumber} and charged R25 under item 1(a) like every email to a debtor, and a copy of the letter is kept under its Documents.`
            : 'No account is chosen, so it is sent and that is all: nothing is filed or charged. Choose the debtor above to keep a copy on the account.'}
        </p>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------------------------------------
 * Small pieces
 * ---------------------------------------------------------------------------------------------- */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="border-t border-slate-200 pt-3 space-y-3 min-w-0">
      <legend className="pr-2 text-[10.5px] font-semibold tracking-[.14em] text-gold-700 uppercase">{title}</legend>
      {children}
    </fieldset>
  )
}

function Label({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return <span className="flex items-center gap-1 text-xs font-medium text-slate-600 mb-1">{icon}{children}</span>
}

function Text({ label, value, onChange, placeholder, hint, testid, onBlur }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; hint?: string; testid?: string; onBlur?: () => void
}) {
  return (
    <label className="block min-w-0">
      <span className="block text-xs font-medium text-slate-600 mb-1">{label}</span>
      <input className={INPUT} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} data-testid={testid} />
      {hint && <span className="block text-[11px] text-slate-500 mt-1">{hint}</span>}
    </label>
  )
}

function SearchBox({ value, onChange, placeholder, testid }: { value: string; onChange: (v: string) => void; placeholder: string; testid: string }) {
  return (
    <div className="relative">
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      <input className={`${INPUT} pl-8`} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} data-testid={testid} />
    </div>
  )
}

function Hits({ children, testid }: { children: React.ReactNode; testid: string }) {
  return <div className="absolute z-20 left-0 right-0 mt-1 rounded-lg border border-slate-200 bg-white shadow-lg max-h-72 overflow-auto" data-testid={testid}>{children}</div>
}

function Chip({ label, onClear, testid }: { label: string; onClear: () => void; testid: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50/60 px-3 py-2 text-sm text-slate-800" data-testid={testid}>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <button type="button" aria-label="Choose another" className="text-slate-400 hover:text-slate-700" onClick={onClear}><X size={14} /></button>
    </div>
  )
}
