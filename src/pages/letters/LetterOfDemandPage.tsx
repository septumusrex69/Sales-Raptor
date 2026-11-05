import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Download, FileText, Link2, RotateCcw, Search, Send, X } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Modal, inputClass } from '../../components/ui/Modal'
import { useAuth } from '../../store/AuthContext'
import { useAppStore } from '../../store/AppStore'
import { supabase } from '../../lib/supabase'
import { clockNow } from '../../lib/clock'
import { emailBodyHtml } from '../../lib/emailStyle'
import { recordSentEmail } from '../../lib/accountEmails'
import { uploadDocument } from '../../lib/accountWorkspace'
import { uploadClientDocument } from '../../lib/clientDocuments'
import { saveFile } from '../../lib/fileSave'
import {
  STANDARD_WORDING, WORDING_FIELDS, WORDING_LABELS, amountDue, amountMismatch, blankRow, coveringEmail, debtorDisplayName,
  fieldValues, fileName, fillFromAccount, formatAmount, freshLetter, invoiceTotal, maySendFromCentral, missingFor, parseAmount,
  rankClients, sendBlockers, unknownFields, wordingSegments, FIELD_PLACEHOLDERS,
  type DebtorChoice, type InvoiceRow, type LetterState, type Wording, type WordingField,
} from '../../lib/letterOfDemand'
import { BODY_BOTTOM, BODY_TOP, PAGE_H, PAGE_W, PT, bytesToBase64, readSheet, sheetToPdf } from '../../lib/demandLetterPdf'
import './letterOfDemand.css'

/**
 * THE LETTER OF DEMAND BUILDER, IN RAPTOR (S13 · Raptor · Handover 16, Ryno, 3 Nov).
 *
 * Opened from "New letter" on the Clients list and on a client's page. Ryno's own page, carried over: the
 * form on the left, the A4 letter and its acknowledgement of receipt on the right, updating as you type, and
 * a PDF that is the preview, word for word. What Raptor adds is where the details can come from (a client
 * and a debtor found as you type, or an account's reference), that every paragraph can be reworded, and that
 * the letter can be sent from here -- with a copy kept on the client and the account. The rules are in
 * src/lib/letterOfDemand.ts.
 */

const DRAFT_KEY = 'raptor-lod-draft-v1'
const ACCOUNT_COLUMNS = 'id, company_id, account_number, client_reference, debtor_first_name, debtor_surname, debtor_kind, capital_handed_over, account_balances(balance)'

type AccountRow = {
  id: string; company_id: string; account_number: string | null; client_reference: string | null
  debtor_first_name: string | null; debtor_surname: string | null; debtor_kind: string | null; capital_handed_over: number | string | null
  account_balances: { balance: number | string | null } | { balance: number | string | null }[] | null
}

function toChoice(r: AccountRow): DebtorChoice {
  const bal = Array.isArray(r.account_balances) ? r.account_balances[0] : r.account_balances
  /* numeric arrives from PostgREST as a STRING ("10.5"): Number() it, or "R10.5" becomes R0 (CLAUDE.md). */
  const num = (v: number | string | null | undefined) => (v === null || v === undefined || v === '' ? null : Number(v))
  return {
    id: r.id, companyId: r.company_id, accountNumber: r.account_number, clientReference: r.client_reference,
    debtorFirstName: r.debtor_first_name, debtorSurname: r.debtor_surname, debtorKind: r.debtor_kind === 'company' ? 'company' : 'individual',
    capitalHandedOver: num(r.capital_handed_over), balance: num(bal?.balance),
  }
}

/** Words for a PostgREST or() filter: its commas and brackets are syntax, so they are taken out of what was typed. */
const searchable = (t: string) => t.replace(/[,()*%\\"]/g, ' ').trim()
/*
 * A VALUE IN DOUBLE QUOTES, so a reference with a dot or a colon in it ("INV.2026.14", "A:17") is read as one
 * value and not as PostgREST syntax. The quotes themselves were taken out of the text by searchable().
 */
const quoted = (t: string) => `"${searchable(t)}"`

function readDraft(): LetterState | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const d = JSON.parse(raw) as LetterState
    return d && Array.isArray(d.rows) ? d : null
  } catch { return null }
}

export function LetterOfDemandPage() {
  const [params] = useSearchParams()
  const { currentUser, session } = useAuth()
  const { companies, addActivity } = useAppStore()
  const clientParam = params.get('client')
  const accountParam = params.get('account')

  /*
   * A DRAFT IS KEPT ON THIS DEVICE, as Ryno's page kept it -- and taken up again only for the same client, so
   * "New letter" on another client's page never opens on the last client's debtor. The date is always today's.
   */
  const [s, setS] = useState<LetterState>(() => {
    const fresh = freshLetter(clockNow())
    const draft = readDraft()
    if (draft && !accountParam && (!clientParam || draft.clientId === clientParam)) {
      return { ...fresh, ...draft, wording: { ...STANDARD_WORDING, ...draft.wording }, date: fresh.date }
    }
    const client = clientParam ? companies.find((c) => c.id === clientParam) : null
    return client ? { ...fresh, client: client.name, clientId: client.id } : fresh
  })
  const [status, setStatus] = useState('')
  const [debtorEmails, setDebtorEmails] = useState<string[]>([])
  const [notice, setNotice] = useState<{ text: string; actions?: [string, () => void, boolean?][] } | null>(null)
  const [busy, setBusy] = useState<'letter' | 'ack' | null>(null)
  const [sending, setSending] = useState(false)
  const [wordingOpen, setWordingOpen] = useState(false)
  const wordingRefs = useRef<Partial<Record<keyof Wording, HTMLTextAreaElement | null>>>({})
  /* What was last filed, so downloading the same letter twice files it once. */
  const filedRef = useRef<Set<string>>(new Set())

  const edit = (patch: Partial<LetterState>) => setS((x) => ({ ...x, ...patch }))
  const editRow = (i: number, patch: Partial<InvoiceRow>) => setS((x) => ({ ...x, rows: x.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) }))

  useEffect(() => {
    const t = setTimeout(() => {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify(s)); setStatus((x) => x || 'Draft kept on this device') } catch { /* private window: nothing kept */ }
    }, 400)
    return () => clearTimeout(t)
  }, [s])

  /* The client may arrive after the page: the store loads companies once, and a deep link can beat it. */
  useEffect(() => {
    if (!clientParam || s.clientId !== clientParam || s.client) return
    const c = companies.find((x) => x.id === clientParam)
    if (c) edit({ client: c.name })
  }, [companies, clientParam, s.clientId, s.client])

  const loadEmails = useCallback(async (accountId: string | null) => {
    if (!accountId) { setDebtorEmails([]); return }
    const { data } = await supabase.from('account_contacts').select('value, is_primary')
      .eq('account_id', accountId).eq('kind', 'email').is('retired_at', null)
    const rows = (data ?? []) as { value: string; is_primary: boolean }[]
    setDebtorEmails(rows.sort((a, b) => Number(b.is_primary) - Number(a.is_primary)).map((r) => r.value.trim()).filter(Boolean))
  }, [])

  const choose = useCallback((d: DebtorChoice) => {
    setS((x) => {
      const filled = fillFromAccount(x, d)
      /* Found by reference with no client chosen: the account says whose book it is on. */
      if (!x.clientId) {
        const c = companies.find((cc) => cc.id === d.companyId)
        if (c) return { ...filled, clientId: c.id, client: c.name }
      }
      return filled
    })
    void loadEmails(d.id)
    setStatus(`Filled from ${debtorDisplayName(d)}. Check the invoices against the client’s statement.`)
  }, [companies, loadEmails])

  /* Opened from an account: fill it in once. */
  useEffect(() => {
    if (!accountParam) return
    void supabase.from('debtor_accounts').select(ACCOUNT_COLUMNS).eq('id', accountParam).maybeSingle()
      .then(({ data }) => { if (data) choose(toChoice(data as unknown as AccountRow)) })
  }, [accountParam, choose])
  useEffect(() => { void loadEmails(s.accountId) }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  const values = useMemo(() => fieldValues(s), [s])
  const due = amountDue(s)
  const mismatch = amountMismatch(s)
  const unknown = unknownFields(s.wording)
  const bookIds = useMemo(() => (s.clientId ? [s.clientId, ...companies.filter((c) => c.parentCompanyId === s.clientId).map((c) => c.id)] : []), [s.clientId, companies])

  /* ------------------------------------------ the preview's paper ------------------------------------------ */
  const fitRef = useRef<HTMLDivElement>(null)
  const stackRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLElement>(null)
  const ackRef = useRef<HTMLElement>(null)

  /*
   * PAGES, as Ryno's page broke them: a block that would cross the bottom margin starts the next page, and
   * an invoice table that runs over repeats its heading. Same breaks on screen and in the PDF, because the
   * PDF is read off this very sheet. Spacers and repeated headings are put in after React has drawn, and
   * taken out again before the next measurement.
   */
  const scale = () => Number(stackRef.current?.dataset.scale) || 1
  const paginate = useCallback((sh: HTMLElement) => {
    sh.querySelectorAll('.pgsp,.threp,.pgmark').forEach((e) => e.remove())
    sh.style.minHeight = ''
    const at = (el: Element, edge: 'top' | 'bottom') => (el.getBoundingClientRect()[edge] - sh.getBoundingClientRect().top) / scale() * PT
    const blocks = [...sh.querySelectorAll<HTMLElement>('.blk, .blk-th, .irow, .totrow')]
    for (let i = 0; i < blocks.length; i += 1) {
      const b = blocks[i]
      const top = at(b, 'top')
      let bot = at(b, 'bottom')
      /* A heading never ends a page alone, nor does the last invoice leave its total behind. */
      if (b.classList.contains('blk-th') && blocks[i + 1]) bot = at(blocks[i + 1], 'bottom')
      if (b.classList.contains('irow') && blocks[i + 1]?.classList.contains('totrow')) bot = at(blocks[i + 1], 'bottom')
      const page = Math.floor(top / PAGE_H)
      if (bot > page * PAGE_H + BODY_BOTTOM && bot - top < BODY_BOTTOM - BODY_TOP) {
        const sp = document.createElement('div')
        sp.className = 'pgsp'
        sp.style.height = `${(page + 1) * PAGE_H + BODY_TOP - top}pt`
        const th = sh.querySelector('.blk-th')
        if (th && ((b.classList.contains('irow') && b.previousElementSibling) || b.classList.contains('totrow'))) {
          const h = th.cloneNode(true) as HTMLElement
          h.classList.remove('blk-th'); h.classList.add('threp')
          b.before(sp, h)
        } else b.before(sp)
      }
    }
    const last = sh.lastElementChild
    const pages = last ? Math.max(1, Math.floor((at(last, 'bottom') - 1) / PAGE_H) + 1) : 1
    sh.style.minHeight = `${pages * PAGE_H}pt`
    for (let p = 1; p < pages; p += 1) {
      const m = document.createElement('div')
      m.className = 'pgmark'; m.style.top = `${p * PAGE_H}pt`
      m.innerHTML = `<span>PAGE ${p + 1}</span>`
      sh.appendChild(m)
    }
  }, [])
  /* While a PDF is being read off the sheet, the sheet stays full size: no redraw may shrink it again. */
  const exportingRef = useRef(false)
  const rescale = useCallback(() => {
    const fit = fitRef.current, stack = stackRef.current
    if (!fit || !stack || !fit.parentElement || exportingRef.current) return
    const w = PAGE_W / PT
    const k = Math.min(1, fit.parentElement.clientWidth / w)
    stack.style.transform = k < 1 ? `scale(${k})` : ''
    stack.dataset.scale = String(k)
    fit.style.width = `${w * k}px`
    fit.style.height = `${stack.offsetHeight * k}px`
  }, [])
  const layout = useCallback(() => {
    for (const sh of [sheetRef.current, ackRef.current]) if (sh) paginate(sh)
    rescale()
  }, [paginate, rescale])
  useLayoutEffect(() => { layout() })
  useEffect(() => {
    void document.fonts?.ready.then(layout)
    const parent = fitRef.current?.parentElement
    const ro = parent && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => rescale()) : null
    if (ro && parent) ro.observe(parent)
    return () => ro?.disconnect()
  }, [layout, rescale])

  /* ------------------------------------------ the PDF ------------------------------------------ */
  async function makePdf(which: 'letter' | 'ack'): Promise<Uint8Array> {
    const stack = stackRef.current!
    const target = (which === 'ack' ? ackRef.current : sheetRef.current)!
    ;(document.activeElement as HTMLElement | null)?.blur()
    exportingRef.current = true
    stack.classList.add('exporting')
    stack.style.transform = ''
    stack.dataset.scale = '1'
    try {
      await document.fonts?.ready
      for (const sh of [sheetRef.current, ackRef.current]) if (sh) paginate(sh)
      const drawing = readSheet(target)
      return await sheetToPdf(drawing, { title: `${which === 'ack' ? 'Acknowledgement of Receipt' : 'Letter of Demand'} – ${s.debtor || 'Debtor'}` })
    } finally {
      exportingRef.current = false
      stack.classList.remove('exporting')
      layout()
    }
  }

  /** A copy on the client, and on the account where there is one -- once per letter, however often it is downloaded. */
  async function fileCopy(bytes: Uint8Array, which: 'letter' | 'ack'): Promise<string | null> {
    const key = `${which}:${JSON.stringify({ ...s, date: s.date })}`
    if (filedRef.current.has(key)) return null
    const file = new File([bytes as BlobPart], fileName(which, s), { type: 'application/pdf' })
    const by = { uploadedBy: currentUser?.id ?? null, uploadedByName: currentUser?.name ?? null }
    const kind = which === 'ack' ? 'Correspondence' : 'Letter of Demand'
    const problems: string[] = []
    if (s.accountId) await uploadDocument({ accountId: s.accountId, file, kind, ...by }).catch((e: unknown) => { problems.push(`the account (${String((e as Error).message ?? e)})`) })
    if (s.clientId) await uploadClientDocument({ companyId: s.clientId, file, kind, ...by }).catch((e: unknown) => { problems.push(`the client (${String((e as Error).message ?? e)})`) })
    if (!problems.length) filedRef.current.add(key)
    return problems.length ? `The copy could not be filed on ${problems.join(' or ')}.` : null
  }

  function ask(which: 'letter' | 'ack') {
    const m = missingFor(which, s)
    if (m.length) {
      setNotice({
        text: `Still to fill in: ${m.join(', ')}. Anything missing will print in [brackets].`,
        actions: [['Download anyway', () => void download(which)], ['Keep editing', () => {}, true]],
      })
    } else void download(which)
  }

  async function download(which: 'letter' | 'ack') {
    setBusy(which)
    try {
      const bytes = await makePdf(which)
      /*
       * fileSave.ts is the one place a file is handed over: it knows the iPad's share sheet -- and that Safari
       * will not open it this long after the tap (the PDF took a moment), in which case one more tap does.
       */
      const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
      const name = fileName(which, s)
      if (await saveFile(blob, name) === 'needs-tap') {
        setNotice({ text: 'The PDF is ready.', actions: [[`Save ${name}`, () => void saveFile(blob, name, { fromTap: true }), true]] })
      }
      const problem = await fileCopy(bytes, which)
      setStatus(problem ?? `${which === 'ack' ? 'Acknowledgement' : 'Letter'} downloaded${s.clientId || s.accountId ? ', and a copy filed' : ''}`)
    } catch (e) {
      setNotice({ text: `The PDF could not be made: ${e instanceof Error ? e.message : String(e)}. Reload the page and try again.` })
    } finally { setBusy(null) }
  }

  function startAgain() {
    setNotice({
      text: 'Start a new letter? This clears every detail and invoice.',
      actions: [['Clear everything', () => {
        const fresh = freshLetter(clockNow())
        setS(s.clientId ? { ...fresh, clientId: s.clientId, client: s.client } : fresh)
        setDebtorEmails([])
        filedRef.current.clear()
        setStatus('New letter started')
      }, true], ['Keep editing', () => {}]],
    })
  }

  const focusWording = (k: keyof Wording) => {
    setWordingOpen(true)
    requestAnimationFrame(() => { const el = wordingRefs.current[k]; el?.focus(); el?.scrollIntoView({ block: 'center', behavior: 'smooth' }) })
  }

  /* One paragraph of the letter, from its (possibly reworded) text. Click it to reword it. Plain functions, not
     components, so a keystroke redraws the words without remounting the paragraph under the pagination. */
  const para = (k: keyof Wording, className = 'blk') => (
    <p className={`${className} editable`} onClick={() => focusWording(k)} title="Click to reword this paragraph" data-testid={`lod-para-${k}`}>
      {wordingSegments(s.wording[k], values).map((seg, i) => {
        const inner = seg.field ? <span className={`calc${seg.empty ? ' empty' : ''}`}>{seg.text}</span> : seg.text
        return seg.bold ? <b key={i}>{inner}</b> : <Fragment key={i}>{inner}</Fragment>
      })}
    </p>
  )
  const calc = (f: WordingField) => <span className={`calc${values[f] ? '' : ' empty'}`}>{values[f] || FIELD_PLACEHOLDERS[f]}</span>
  const col3 = (s.col3 || '').trim().toUpperCase() || 'REFERENCE'
  const col3Label = col3.charAt(0) + col3.slice(1).toLowerCase()

  return (
    <div className="lod space-y-3" data-testid="lod-page">
      <div className="flex flex-wrap items-center gap-2">
        <Link to={s.clientId ? `/companies/${s.clientId}` : '/companies'} className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft size={15} /> {s.clientId ? 'Back to the client' : 'Clients'}
        </Link>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500" aria-live="polite" data-testid="lod-status">{status}</span>
          <Button size="sm" icon={<RotateCcw size={14} />} onClick={startAgain}>New letter</Button>
          <Button size="sm" icon={<Download size={14} />} disabled={!!busy} onClick={() => ask('ack')} data-testid="lod-download-ack">
            {busy === 'ack' ? 'Preparing…' : 'Acknowledgement PDF'}
          </Button>
          <Button size="sm" icon={<Download size={14} />} disabled={!!busy} onClick={() => ask('letter')} data-testid="lod-download">
            {busy === 'letter' ? 'Preparing…' : 'Letter PDF'}
          </Button>
          <Button size="sm" variant="primary" icon={<Send size={14} />} disabled={!!busy} onClick={() => setSending(true)} data-testid="lod-send">Send to the debtor</Button>
        </div>
      </div>

      {notice && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gold-300 bg-gold-50 px-4 py-2.5 text-sm text-slate-700" data-testid="lod-notice">
          <span className="flex-1 min-w-[14rem]">{notice.text}</span>
          {(notice.actions ?? [['OK', () => {}, true]]).map(([label, fn, primary]) => (
            <Button key={label} size="sm" variant={primary ? 'primary' : 'secondary'} onClick={() => { setNotice(null); fn() }}>{label}</Button>
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(20rem,26rem)_minmax(0,1fr)] items-start">
        {/* ------------------------------------------ the form ------------------------------------------ */}
        <form className="rounded-xl border border-slate-200 bg-white p-4 space-y-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto"
          onSubmit={(e) => e.preventDefault()} autoComplete="off" data-testid="lod-form">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2"><FileText size={18} className="text-gold-600" /> Letter of demand</h2>
            <p className="text-xs text-slate-500">Find the client and the debtor to fill it in, or type everything yourself. The letter and the acknowledgement update as you type.</p>
          </div>

          <Section title="PARTIES">
            <ClientField value={s.client} linked={s.clientId} companies={companies}
              onType={(client) => edit({ client, clientId: null, accountId: null })}
              onPick={(c) => { edit({ client: c.name, clientId: c.id, accountId: null }); setDebtorEmails([]) }}
              onUnlink={() => edit({ clientId: null, accountId: null })} />
            <DebtorField value={s.debtor} bookIds={bookIds} linked={s.accountId}
              onType={(debtor) => edit({ debtor })} onPick={choose}
              onUnlink={() => { edit({ accountId: null }); setDebtorEmails([]) }} />
            <ReferenceField bookIds={bookIds} onFound={choose} />
          </Section>

          <Section title="LETTER">
            <div className="grid grid-cols-2 gap-2.5">
              <Field label="Date of letter"><input className={inputClass} value={s.date} onChange={(e) => edit({ date: e.target.value })} /></Field>
              <Field label="Statement date"><input className={inputClass} value={s.stmt} placeholder="e.g. 27 October 2026" onChange={(e) => edit({ stmt: e.target.value })} data-testid="lod-stmt" /></Field>
            </div>
            <Field label="Description of services" hint={`Reads “…who rendered ${s.services.trim() || 'services'} to your company.” Leave as “services” or make it specific, like “transport services”.`}>
              <input className={inputClass} value={s.services} onChange={(e) => edit({ services: e.target.value })} />
            </Field>
          </Section>

          <Section title="PAYMENT">
            <div className="grid grid-cols-2 gap-2.5">
              <Field label="Payment reference"><input className={inputClass} value={s.ref} placeholder="e.g. KAROO" onChange={(e) => edit({ ref: e.target.value })} data-testid="lod-ref" /></Field>
              <Field label="Days to pay"><input className={inputClass} value={s.days} inputMode="numeric" onChange={(e) => edit({ days: e.target.value.replace(/[^\d]/g, '').slice(0, 2) })} /></Field>
            </div>
            <Field label="Amount due" hint={mismatch ?? 'Adds itself up from the invoices below. Type an amount only if it should be different.'} warn={!!mismatch}>
              <input className={inputClass} value={s.amount} inputMode="decimal" data-testid="lod-amount"
                placeholder={s.rows.some((r) => parseAmount(r.amt) !== null) ? `${formatAmount(invoiceTotal(s.rows))} (from invoices)` : 'Adds up from the invoices'}
                onChange={(e) => edit({ amount: e.target.value })}
                onBlur={(e) => { const n = parseAmount(e.target.value); edit({ amount: n === null ? '' : formatAmount(n) }) }} />
            </Field>
          </Section>

          <Section title="INVOICES">
            <Field label="Third column heading" hint="For transport clients, use LOADCON.">
              <input className={inputClass} value={s.col3} placeholder="REFERENCE" onChange={(e) => edit({ col3: e.target.value })} />
            </Field>
            <div className="space-y-2.5" data-testid="lod-invoices">
              {s.rows.map((r, i) => (
                <div key={i} className="rounded-lg border border-slate-200 bg-slate-50 p-2.5" data-testid="lod-invoice">
                  <div className="flex items-center justify-between mb-1.5">
                    <b className="text-xs tracking-wide text-slate-600">INVOICE {i + 1}</b>
                    <button type="button" className="text-xs text-slate-500 hover:text-red-600" aria-label={`Remove invoice ${i + 1}`}
                      onClick={() => setS((x) => ({ ...x, rows: x.rows.length > 1 ? x.rows.filter((_, j) => j !== i) : [blankRow()] }))}>Remove</button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Invoice no."><input className={inputClass} value={r.inv} placeholder="INV-0002" onChange={(e) => editRow(i, { inv: e.target.value })} data-testid="lod-inv-no" /></Field>
                    <Field label="Invoice date"><input className={inputClass} value={r.date} placeholder="11 Aug 2026" onChange={(e) => editRow(i, { date: e.target.value })} /></Field>
                    <Field label={col3Label}><input className={inputClass} value={r.ref} placeholder="LC-1001" onChange={(e) => editRow(i, { ref: e.target.value })} /></Field>
                    <Field label="Amount"><input className={inputClass} value={r.amt} inputMode="decimal" placeholder="R106,000.00" data-testid="lod-inv-amt"
                      onChange={(e) => editRow(i, { amt: e.target.value })}
                      onBlur={(e) => { const n = parseAmount(e.target.value); editRow(i, { amt: n === null ? '' : formatAmount(n) }) }} /></Field>
                    <div className="col-span-2"><Field label="Description"><input className={inputClass} value={r.desc} placeholder="Delivery of goods" onChange={(e) => editRow(i, { desc: e.target.value })} /></Field></div>
                  </div>
                </div>
              ))}
            </div>
            <button type="button" className="w-full rounded-lg border border-dashed border-slate-300 py-2 text-sm font-medium text-slate-600 hover:border-gold-500"
              onClick={() => setS((x) => ({ ...x, rows: [...x.rows, blankRow()] }))} data-testid="lod-add-invoice">+ Add invoice</button>
            <div className="flex items-baseline justify-between border-t border-slate-200 pt-2 text-sm">
              <span className="text-slate-600">Invoice total</span><b className="font-serif text-lg tabular-nums" data-testid="lod-invoice-total">{formatAmount(invoiceTotal(s.rows))}</b>
            </div>
          </Section>

          <Section title="WORDING" right={(
            <button type="button" className="text-xs text-brand-700 hover:underline" onClick={() => setWordingOpen((o) => !o)} data-testid="lod-wording-toggle">
              {wordingOpen ? 'Hide' : 'Reword the letter'}
            </button>
          )}>
            {!wordingOpen ? (
              <p className="text-xs text-slate-500">Click any paragraph on the letter to reword it, or open the wording here.</p>
            ) : (
              <div className="space-y-2.5" data-testid="lod-wording">
                <p className="text-xs text-slate-500">
                  Words in braces are filled in for you: {WORDING_FIELDS.map((f) => `{${f}}`).join(' ')}. Put **two asterisks** around words to make them bold.
                </p>
                {WORDING_LABELS.map(([k, label]) => (
                  <Field key={k} label={label}>
                    <textarea ref={(el) => { wordingRefs.current[k] = el }} className={`${inputClass} min-h-[5.5rem] text-[13px] leading-snug`}
                      value={s.wording[k]} onChange={(e) => setS((x) => ({ ...x, wording: { ...x.wording, [k]: e.target.value } }))} data-testid={`lod-wording-${k}`} />
                  </Field>
                ))}
                {unknown.length > 0 && <p className="text-xs text-red-600">Raptor does not know {unknown.map((u) => `{${u}}`).join(', ')}: it prints as typed.</p>}
                <Button size="sm" onClick={() => edit({ wording: { ...STANDARD_WORDING } })}>Back to the standard wording</Button>
              </div>
            )}
          </Section>
        </form>

        {/* ------------------------------------------ the paper ------------------------------------------ */}
        <section className="preview" aria-label="Preview">
          <div className="fit" ref={fitRef}>
            <div className="stack" ref={stackRef}>
              <div className="doclab ui">DOCUMENT 1 · LETTER OF DEMAND</div>
              <article className="sheet" ref={sheetRef} aria-label="Letter of demand" data-testid="lod-sheet">
                <div className="blk meta">
                  <div><div className="lab">DATE</div><div className="v">{calc('date')}</div></div>
                  <div><div className="lab">TO</div><div className="v b">{calc('debtor')}</div></div>
                  <div><div className="lab">ON BEHALF OF</div><div className="v b">{calc('client')}</div></div>
                </div>
                <div className="blk">
                  <div className="title">Letter of Demand</div>
                  <div className="lab sub">OUTSTANDING INVOICES</div>
                  <div className="rule" />
                </div>
                <div className="blk panel">
                  <div><div className="lab">AMOUNT DUE</div><div className="big" data-testid="lod-sheet-total">{calc('total')}</div></div>
                  <div><div className="lab">PAYMENT DEADLINE</div><div className="mid">{calc('days')} calendar days</div><div className="note">from receipt of this letter</div></div>
                  <div><div className="lab">PAYMENT REFERENCE</div><div className="mid">{calc('ref')}</div><div className="note">on all payments</div></div>
                </div>
                <p className="blk">Dear Sir/Madam,</p>
                {para('intro')}
                <div className="inv">
                  <div className="row th blk-th"><div>INVOICE</div><div>DATE</div><div>{col3}</div><div>DESCRIPTION</div><div>AMOUNT</div></div>
                  <div>
                    {s.rows.map((r, i) => {
                      const n = parseAmount(r.amt)
                      const cells: [string, string][] = [[r.inv, '[Invoice no.]'], [r.date, '[Date]'], [r.ref, '[Ref. no.]'], [r.desc, '[Description]'], [n === null ? '' : formatAmount(n), '[Amount]']]
                      return (
                        <div key={i} className={`row irow${i % 2 ? ' alt' : ''}`}>
                          {cells.map(([v, ph], j) => <div key={j}><span className={`calc${v.trim() ? '' : ' empty'}`}>{v.trim() || ph}</span></div>)}
                        </div>
                      )
                    })}
                    <div className="tot totrow"><span className="lab">TOTAL OUTSTANDING</span><span className="amt">{calc('total')}</span></div>
                  </div>
                </div>
                {para('demand')}
                <div className="blk need">
                  <div className="lab">WHAT WE NEED FROM YOU</div>
                  <div className="opts">
                    <div><div className="n">01</div><h3>Pay in full</h3>{para('pay', '')}</div>
                    <div><div className="n">02</div><h3>Already paid?</h3>{para('paid', '')}</div>
                    <div><div className="n">03</div><h3>Disputing an amount?</h3>{para('dispute', '')}</div>
                  </div>
                </div>
                {para('reserve')}
                {para('closing')}
                <div className="blk sig">
                  <div>Yours faithfully,</div>
                  <div className="name">Bredell Ferreira</div>
                  <div className="for">On behalf of {calc('client')}</div>
                </div>
              </article>

              <div className="doclab ui">DOCUMENT 2 · ACKNOWLEDGEMENT OF RECEIPT</div>
              <article className="sheet ack" ref={ackRef} aria-label="Acknowledgement of receipt" data-testid="lod-ack">
                <div className="blk meta">
                  <div><div className="lab">LETTER DATED</div><div className="v">{calc('date')}</div></div>
                  <div><div className="lab">DEBTOR</div><div className="v b">{calc('debtor')}</div></div>
                  <div><div className="lab">CREDITOR</div><div className="v b">{calc('client')}</div></div>
                </div>
                <div className="blk">
                  <div className="title">Acknowledgement of Receipt</div>
                  <div className="lab sub">LETTER OF DEMAND</div>
                  <div className="rule" />
                </div>
                <div className="blk panel">
                  <div><div className="lab">AMOUNT CLAIMED</div><div className="big">{calc('total')}</div></div>
                  <div><div className="lab">RETURN THIS PAGE WITHIN</div><div className="mid">{calc('days')} calendar days</div><div className="note">from receipt of the letter</div></div>
                  <div><div className="lab">PAYMENT REFERENCE</div><div className="mid">{calc('ref')}</div><div className="note">quote on all payments</div></div>
                </div>
                <p className="blk intro">Please complete, sign and return this page to Bredell Ferreira at <b>info@bredellferreira.co.za</b> within the period above.</p>
                <p className="blk">I, the undersigned, being duly authorised to sign on behalf of <b>{calc('debtor')}</b>, acknowledge receipt of the letter of demand dated {calc('date')}, issued by Bredell Ferreira on behalf of <b>{calc('client')}</b>, claiming payment of <b>{calc('total')}</b>.</p>
                <div className="blk">
                  <div className="lab" style={{ fontSize: '7pt', letterSpacing: '1.8pt' }}>THE DEBTOR’S RESPONSE · TICK ONE</div>
                  <div className="ticks">
                    <div className="tick"><div className="box" /><div><b>We will pay</b> the full amount of {calc('total')} within {calc('days')} calendar days of receipt, using the reference {calc('ref')}.</div></div>
                    <div className="tick"><div className="box" /><div><b>We have already paid.</b> Proof of payment is attached.</div></div>
                    <div className="tick"><div className="box" /><div><b>We dispute the amount claimed.</b> The basis of the dispute is set out below, with supporting documents attached.</div></div>
                  </div>
                </div>
                <div className="blk lines">
                  <div className="lab" style={{ fontSize: '7pt', letterSpacing: '1.8pt' }}>DETAILS OF DISPUTE OR COMMENTS</div>
                  <div className="line" /><div className="line" /><div className="line" />
                </div>
                <div className="blk">
                  <div className="lab" style={{ fontSize: '7pt', letterSpacing: '1.8pt', marginBottom: '4pt' }}>SIGNED FOR AND ON BEHALF OF THE DEBTOR</div>
                  <div className="signed">
                    <div className="fields">
                      {['FULL NAME', 'DESIGNATION / CAPACITY', 'SIGNATURE', 'DATE RECEIVED', 'CONTACT NUMBER', 'EMAIL ADDRESS'].map((l) => (
                        <div key={l}><div className="line" /><div className="lab" style={{ marginTop: '3pt' }}>{l}</div></div>
                      ))}
                    </div>
                    <div className="stamp"><div className="lab">COMPANY STAMP</div></div>
                  </div>
                </div>
                <p className="blk fineprint">Signing this page confirms receipt of the letter of demand only. It is not an admission of liability and does not affect the debtor’s right to dispute the claim.</p>
              </article>
            </div>
          </div>
        </section>
      </div>

      {sending && (
        <SendLetterModal letter={s} debtorEmails={debtorEmails} amount={due} accessToken={session?.access_token ?? null}
          role={currentUser?.role ?? null} makePdf={makePdf}
          onClose={() => setSending(false)}
          onSent={async ({ to, from, subject, body, messageId, letterPdf, ackPdf }) => {
            setSending(false)
            /*
             * THE LETTER HAS GONE: what follows is the record, and a record that fails is said, never a reason
             * to look as if the send failed -- the composer's rule (AccountDetail's recordSentEmail).
             */
            const problems: string[] = []
            if (s.accountId) {
              /* Item 1(a), R25: an email to a debtor about their account, charged by the path that charges every other email. */
              await recordSentEmail({
                accountId: s.accountId, to, from, subject, body, messageId,
                actor: { id: currentUser?.id ?? null, name: currentUser?.name ?? null },
              }).catch((e: unknown) => { problems.push(`the account’s email record (${e instanceof Error ? e.message : String(e)})`) })
            }
            const one = await fileCopy(letterPdf, 'letter')
            if (one) problems.push(one)
            if (ackPdf) { const two = await fileCopy(ackPdf, 'ack'); if (two) problems.push(two) }
            if (s.clientId) addActivity({ type: 'Email', subject: `Letter of demand sent to ${s.debtor || to}`, notes: `To ${to}${from ? ` from ${from}` : ''}. ${body}`, companyId: s.clientId })
            setStatus(problems.length ? `Sent to ${to}. ${problems.join(' ')}` : `Sent to ${to}${from ? ` from ${from}` : ''}. A copy is filed${s.accountId ? ' on the account' : ''}${s.clientId ? ' on the client' : ''}.`)
          }} />
      )}
    </div>
  )
}

/* ------------------------------------------ small parts ------------------------------------------ */

function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <fieldset className="border-t border-slate-200 pt-3 space-y-2.5 min-w-0">
      <legend className="flex w-full items-center pr-2 text-[10.5px] font-semibold tracking-[.14em] text-gold-700">
        <span>{title}</span>{right && <span className="ml-auto tracking-normal font-normal">{right}</span>}
      </legend>
      {children}
    </fieldset>
  )
}

function Field({ label, hint, warn, children }: { label: string; hint?: string; warn?: boolean; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="block text-xs font-semibold text-slate-700 mb-1">{label}</span>
      {children}
      {hint && <span className={`block mt-1 text-[11.5px] leading-snug ${warn ? 'rounded bg-gold-50 px-1.5 py-1 text-gold-800' : 'text-slate-500'}`}>{hint}</span>}
    </label>
  )
}

/** A box that suggests as you type, with the list under it. Typing never has to pick: what is typed stands. */
function Suggest<T>({ label, value, onType, items, render, onPick, placeholder, testid, linkedNote, onUnlink, loading }: {
  label: string; value: string; onType: (v: string) => void; items: T[]; render: (t: T) => ReactNode; onPick: (t: T) => void
  placeholder?: string; testid: string; linkedNote?: string | null; onUnlink?: () => void; loading?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  return (
    <div className="relative min-w-0">
      <Field label={label}>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className={`${inputClass} pl-8`} value={value} placeholder={placeholder} data-testid={testid}
            onChange={(e) => { onType(e.target.value); setOpen(true); setActive(0) }}
            onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={(e) => {
              if (!open || !items.length) return
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)) }
              if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)) }
              if (e.key === 'Enter') { e.preventDefault(); onPick(items[active]); setOpen(false) }
            }} />
        </div>
      </Field>
      {linkedNote && (
        <p className="mt-1 flex items-center gap-1 text-[11.5px] text-emerald-700" data-testid={`${testid}-linked`}>
          <Link2 size={12} /> {linkedNote}
          {onUnlink && <button type="button" className="ml-1 text-slate-400 hover:text-slate-700" aria-label="Unlink" onClick={onUnlink}><X size={12} /></button>}
        </p>
      )}
      {open && (items.length > 0 || loading) && (
        <ul className="absolute z-30 mt-1 w-full max-h-72 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-xl" data-testid={`${testid}-list`}>
          {loading && !items.length && <li className="px-3 py-2 text-xs text-slate-400">Searching…</li>}
          {items.map((t, i) => (
            <li key={i}>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); onPick(t); setOpen(false) }} onMouseEnter={() => setActive(i)}
                className={`w-full px-3 py-1.5 text-left text-sm ${i === active ? 'bg-brand-50' : 'hover:bg-slate-50'}`} data-testid={`${testid}-option`}>
                {render(t)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

type Company = ReturnType<typeof useAppStore>['companies'][number]

function ClientField({ value, linked, companies, onType, onPick, onUnlink }: {
  value: string; linked: string | null; companies: Company[]; onType: (v: string) => void; onPick: (c: Company) => void; onUnlink: () => void
}) {
  const items = useMemo(() => (linked ? [] : rankClients(companies, value)), [companies, value, linked])
  const parentName = (c: Company) => companies.find((p) => p.id === c.parentCompanyId)?.name
  return (
    <Suggest label="Client" value={value} onType={onType} items={items} onPick={onPick} testid="lod-client"
      placeholder="Start typing a client’s name, or type it in full"
      linkedNote={linked ? 'Raptor client: the debtor search looks on their book' : null} onUnlink={onUnlink}
      render={(c) => (
        <span className="flex items-center gap-2">
          <span className="truncate">{c.name}</span>
          {c.code && <span className="font-mono text-[10px] text-slate-500">{c.code}</span>}
          {c.parentCompanyId && <span className="ml-auto truncate text-[11px] text-slate-400">under {parentName(c)}</span>}
        </span>
      )} />
  )
}

function DebtorField({ value, bookIds, linked, onType, onPick, onUnlink }: {
  value: string; bookIds: string[]; linked: string | null; onType: (v: string) => void; onPick: (d: DebtorChoice) => void; onUnlink: () => void
}) {
  const [items, setItems] = useState<DebtorChoice[]>([])
  const [loading, setLoading] = useState(false)
  const book = bookIds.join(',')
  useEffect(() => {
    const q = searchable(value)
    if (!book || linked || q.length < 2) { setItems([]); return }
    let live = true
    setLoading(true)
    const t = setTimeout(() => {
      void supabase.from('debtor_accounts').select(ACCOUNT_COLUMNS).in('company_id', book.split(','))
        .or(['debtor_surname', 'debtor_first_name', 'account_number', 'client_reference'].map((c) => `${c}.ilike."%${q}%"`).join(','))
        .order('debtor_surname').limit(12)
        .then(({ data }) => { if (live) { setItems(((data ?? []) as unknown as AccountRow[]).map(toChoice)); setLoading(false) } })
    }, 250)
    return () => { live = false; clearTimeout(t) }
  }, [value, book, linked])
  return (
    <Suggest label="Debtor" value={value} onType={onType} items={items} onPick={onPick} testid="lod-debtor" loading={loading}
      placeholder={book ? 'Start typing the debtor’s name or account number' : 'The debtor’s name (choose a Raptor client to search their book)'}
      linkedNote={linked ? 'Filled from the account: the letter is filed there too' : null} onUnlink={onUnlink}
      render={(d) => (
        <span className="flex items-center gap-2">
          <span className="truncate">{debtorDisplayName(d)}</span>
          <span className="ml-auto shrink-0 font-mono text-[11px] text-slate-500">{d.accountNumber ?? d.clientReference ?? ''}</span>
          {(d.balance ?? d.capitalHandedOver) !== null && <span className="shrink-0 text-[11px] text-slate-500 tabular-nums">{formatAmount((d.balance ?? d.capitalHandedOver) as number)}</span>}
        </span>
      )} />
  )
}

/**
 * THE REFERENCE BOX (Ryno: "enter in the client's reference number or the debtor's reference number to us
 * and then he can fetch all the information"). Raptor's account number, or the client's own reference --
 * which can belong to more than one account, so on a chosen client's book first, and a list where it is
 * still more than one.
 */
function ReferenceField({ bookIds, onFound }: { bookIds: string[]; onFound: (d: DebtorChoice) => void }) {
  const [ref, setRef] = useState('')
  const [many, setMany] = useState<DebtorChoice[]>([])
  const [msg, setMsg] = useState<string | null>(null)
  async function look() {
    const t = ref.trim()
    setMany([]); setMsg(null)
    if (!t) return
    let q = supabase.from('debtor_accounts').select(ACCOUNT_COLUMNS).or(['account_number', 'client_reference', 'legacy_reference'].map((c) => `${c}.eq.${quoted(t)}`).join(',')).limit(10)
    if (bookIds.length) q = q.in('company_id', bookIds)
    const { data, error } = await q
    if (error) { setMsg(error.message); return }
    const found = ((data ?? []) as unknown as AccountRow[]).map(toChoice)
    if (found.length === 1) { onFound(found[0]); setRef('') } else if (found.length > 1) setMany(found)
    else setMsg(bookIds.length ? 'No account with that reference on this client’s book.' : 'No account with that reference.')
  }
  return (
    <div>
      <Field label="Or find it by reference">
        <div className="flex gap-2">
          <input className={inputClass} value={ref} placeholder="Account number or the client’s reference" data-testid="lod-reference"
            onChange={(e) => setRef(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void look() } }} />
          <Button size="sm" onClick={() => void look()} data-testid="lod-reference-find">Find</Button>
        </div>
      </Field>
      {msg && <p className="mt-1 text-[11.5px] text-slate-500" data-testid="lod-reference-msg">{msg}</p>}
      {many.length > 0 && (
        <ul className="mt-1 rounded-lg border border-slate-200 divide-y divide-slate-100" data-testid="lod-reference-many">
          <li className="px-3 py-1.5 text-[11.5px] text-slate-500">{many.length} accounts carry that reference. Which one?</li>
          {many.map((d) => (
            <li key={d.id}><button type="button" className="w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50" onClick={() => { onFound(d); setMany([]); setRef('') }}>
              {debtorDisplayName(d)} <span className="font-mono text-[11px] text-slate-500">{d.accountNumber}</span>
            </button></li>
          ))}
        </ul>
      )}
    </div>
  )
}

/* ------------------------------------------ sending ------------------------------------------ */

interface Sent { to: string; from: string | null; subject: string; body: string; messageId: string | null; letterPdf: Uint8Array; ackPdf: Uint8Array | null }

/**
 * SEND IT FROM RAPTOR (Ryno: "we can get the debtor's email address and then Raptor can send it ... controlled
 * from which email address"). To: the account's addresses, or any typed. From: your own mailbox, or the firm's
 * central one for an Administrator or a client liaison. Nothing with a gap in it goes (sendBlockers).
 */
function SendLetterModal({ letter, debtorEmails, amount, accessToken, role, makePdf, onClose, onSent }: {
  letter: LetterState; debtorEmails: string[]; amount: number | null; accessToken: string | null; role: string | null
  makePdf: (which: 'letter' | 'ack') => Promise<Uint8Array>; onClose: () => void; onSent: (s: Sent) => Promise<void>
}) {
  const [to, setTo] = useState(debtorEmails[0] ?? '')
  const [withAck, setWithAck] = useState(true)
  const initial = coveringEmail(letter, true)
  const [subject, setSubject] = useState(initial.subject)
  const [body, setBody] = useState(initial.body)
  const [mailbox, setMailbox] = useState<'own' | 'central'>('own')
  const [own, setOwn] = useState<string | null | undefined>(undefined)
  const [central, setCentral] = useState<string | null | undefined>(maySendFromCentral(role) ? undefined : null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const blockers = sendBlockers(letter)

  useEffect(() => {
    if (!accessToken) return
    const ask = async (q: string) => {
      const r = await fetch(`/api/email/status${q}`, { headers: { Authorization: `Bearer ${accessToken}` } }).catch(() => null)
      const j = r && r.ok ? ((await r.json().catch(() => null)) as { connected?: boolean; email?: string | null } | null) : null
      return j?.connected ? j.email ?? '' : null
    }
    void ask('').then(setOwn)
    if (maySendFromCentral(role)) void ask('?mailbox=central').then(setCentral)
  }, [accessToken, role])
  /* The covering note follows whether the acknowledgement goes, unless somebody has already rewritten it. */
  useEffect(() => { setBody((b) => (b === coveringEmail(letter, !withAck).body ? coveringEmail(letter, withAck).body : b)) }, [withAck])  // eslint-disable-line react-hooks/exhaustive-deps

  const fromAddress = mailbox === 'central' ? central : own
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim())
  const canSend = !busy && !blockers.length && valid && !!fromAddress && !!subject.trim() && !!accessToken

  async function send() {
    setBusy(true); setError(null)
    try {
      const letterPdf = await makePdf('letter')
      const ackPdf = withAck ? await makePdf('ack') : null
      const attachments = [
        { filename: fileName('letter', letter), contentType: 'application/pdf', content: bytesToBase64(letterPdf) },
        ...(ackPdf ? [{ filename: fileName('ack', letter), contentType: 'application/pdf', content: bytesToBase64(ackPdf) }] : []),
      ]
      const res = await fetch('/api/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ to: to.trim(), subject: subject.trim(), bodyHtml: emailBodyHtml(body), attachments, mailbox }),
      })
      const j = (await res.json().catch(() => ({}))) as { error?: string; messageId?: string; from?: string }
      if (!res.ok) { setError(res.status === 413 ? 'The letter is too large to send. Download it and send it yourself.' : j.error ?? 'It could not be sent.'); setBusy(false); return }
      await onSent({ to: to.trim(), from: j.from ?? fromAddress ?? null, subject: subject.trim(), body: body.trim(), messageId: j.messageId ?? null, letterPdf, ackPdf })
    } catch (e) {
      setError(`It could not be sent: ${e instanceof Error ? e.message : String(e)}`)
      setBusy(false)
    }
  }

  return (
    <Modal title="Send the letter of demand" subtitle={amount !== null ? `${formatAmount(amount)} · ${letter.debtor || 'the debtor'}` : undefined} onClose={onClose} width={640}
      footer={(
        <div className="flex flex-wrap items-center justify-end gap-2">
          {error && <span className="mr-auto text-sm text-red-600" data-testid="lod-send-error">{error}</span>}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={<Send size={14} />} disabled={!canSend} onClick={() => void send()} data-testid="lod-send-confirm">{busy ? 'Sending…' : 'Send'}</Button>
        </div>
      )}>
      <div className="space-y-3" data-testid="lod-send-modal">
        {blockers.length > 0 && (
          <p className="rounded-lg bg-gold-50 border border-gold-200 px-3 py-2 text-sm text-gold-800" data-testid="lod-send-blockers">
            A letter of demand goes out complete. Still to fill in: {blockers.join(', ')}. (You can still download it as a draft.)
          </p>
        )}
        <Field label="To">
          <input className={inputClass} value={to} list="lod-debtor-emails" placeholder="The debtor’s email address" onChange={(e) => setTo(e.target.value)} data-testid="lod-send-to" />
          <datalist id="lod-debtor-emails">{debtorEmails.map((e) => <option key={e} value={e} />)}</datalist>
        </Field>
        {debtorEmails.length > 0 && (
          <div className="flex flex-wrap gap-1.5 -mt-1">
            {debtorEmails.map((e) => (
              <button key={e} type="button" onClick={() => setTo(e)} className={`rounded-full border px-2 py-0.5 text-xs ${to === e ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-slate-200 text-slate-600'}`}>{e}</button>
            ))}
          </div>
        )}
        <Field label="From">
          <select className={inputClass} value={mailbox} onChange={(e) => setMailbox(e.target.value as 'own' | 'central')} data-testid="lod-send-from">
            <option value="own">{own === undefined ? 'Your mailbox (checking…)' : own ? `Your mailbox · ${own}` : 'Your mailbox (not connected)'}</option>
            {central !== null && <option value="central">{central === undefined ? 'The firm’s central mailbox (checking…)' : `The firm’s central mailbox · ${central}`}</option>}
          </select>
        </Field>
        {mailbox === 'own' && own === null && <p className="-mt-1 text-xs text-red-600">Connect your mailbox under Settings → Integrations to send from it, or download the letter and send it yourself.</p>}
        <Field label="Subject"><input className={inputClass} value={subject} onChange={(e) => setSubject(e.target.value)} data-testid="lod-send-subject" /></Field>
        <Field label="Message"><textarea className={`${inputClass} min-h-[9rem]`} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={withAck} onChange={(e) => setWithAck(e.target.checked)} data-testid="lod-send-ack" /> Attach the acknowledgement of receipt
        </label>
        <p className="text-xs text-slate-500" data-testid="lod-send-note">
          The letter goes as a PDF, with your signature under the message.{' '}
          {letter.accountId || letter.clientId
            ? `A copy is filed ${[letter.accountId && 'on the account', letter.clientId && 'on the client'].filter(Boolean).join(' and ')}.`
            : 'It is not linked to a client or an account in Raptor, so no copy is filed here: keep your own.'}
          {letter.accountId && ' As every email to a debtor about their account, it is charged R25 under item 1(a), and their reply comes back to the account.'}
        </p>
      </div>
    </Modal>
  )
}
