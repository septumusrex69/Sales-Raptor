import { useMemo, useRef, useState } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import clsx from 'clsx'
import { Modal, inputClass } from '../ui/Modal'
import { ComposeEmailModal } from '../ComposeEmailModal'
import { useAuth } from '../../store/AuthContext'
import { supabase } from '../../lib/supabase'
import { clockNow } from '../../lib/clock'
import { fetchLetterheads, defaultOf } from '../../lib/letterheads'
import { A4_LETTERHEAD } from '../../lib/letterDocument'
import { letterToPdf, letterFilename, toBase64 } from '../../lib/letterPdf'
import { fetchCharter, isCharter } from '../../lib/charter'
import { withFilled } from '../../lib/signingBlanks'
import { createSigningRequest, signingButtonHtml, signingLink } from '../../lib/signing'
import {
  STANDARD_RATE, STANDARD_SCALE, commissionLine, commissionProblems, mandateBlanks, mandateDocument,
  pct, type MandateBand, type MandateCommission, type MandateParty, type MandateTerms,
} from '../../lib/mandate'

/**
 * SEND A MANDATE FOR ONLINE SIGNING (S8, 18 Oct).
 *
 * The firm: "when a lead has been added ... the mandate needs to be sent ... we can send with the
 * attached mandates, with the commission percentage that should be filled in before we send ... a
 * sliding scale ... a standard sliding scale ... but we should be able to change some of the
 * parameters ... individual or a company ... send out the mandate as the PDF ... and to sign it
 * immediately ... from a link."
 *
 * Two steps. First the terms -- individual or company, a flat rate or the scale (the firm's standard
 * 25 / 20 / 15 / 10, every band editable). Then the email, in the ordinary composer so the salesperson
 * reads it before it goes, carrying the mandate as a PDF and a Sign online button. The signing request
 * is made when the email is prepared and holds the terms frozen; signing it (mandate_on_signed) makes
 * the lead a client.
 */
export function SendMandateModal({ leadId, dealId, clientName, email, contactName, party: partyGiven, onClose, onSent }: {
  leadId: string | null
  /** What the lead was added as (S8): the window opens on it and only confirms it. */
  party?: MandateParty
  dealId: string | null
  clientName: string
  email: string | null
  contactName: string | null
  onClose: () => void
  /** The email as sent, and one line for the record's notes ("Mandate sent for signing online: ..."). */
  onSent: (subject: string, body: string, note: string) => void
}) {
  const { currentUser } = useAuth()
  const [party, setParty] = useState<MandateParty>(partyGiven ?? 'company')
  const [name, setName] = useState(clientName)
  /* FLAT FIRST (the firm, 18 Oct: "by default, it should be on flat rate. Sliding scale should be the
     option"). */
  const [kind, setKind] = useState<'rate' | 'scale'>('rate')
  const [rate, setRate] = useState(String(STANDARD_RATE * 100))
  const [bands, setBands] = useState<{ upTo: string; rate: string }[]>(
    () => STANDARD_SCALE.map((b) => ({ upTo: b.upTo === null ? '' : String(b.upTo), rate: String(b.rate * 100) })))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [compose, setCompose] = useState<{ subject: string; body: string; html: string; file: { filename: string; contentType: string; size: number; content: string } } | null>(null)

  const commission: MandateCommission = useMemo(() => kind === 'rate'
    ? { kind: 'rate', rate: Number(rate) / 100 }
    : { kind: 'scale', bands: bands.map((b, i): MandateBand => ({ upTo: i === bands.length - 1 ? null : Number(b.upTo.replace(/[\s,]/g, '')), rate: Number(b.rate) / 100 })) },
  [kind, rate, bands])
  const problems = [...commissionProblems(commission), ...(name.trim() ? [] : ['Give the client’s name.'])]

  /*
   * FETCHED WHILE THE TERMS ARE CHOSEN, NOT AFTER (the firm, 18 Oct: "it's kind of taking a long time
   * preparing the email"). The letterhead image and the four Charter files are the slow part -- a
   * full-page image off storage and four font files -- and none of them depends on anything typed
   * here, so they start the moment the window opens and are usually in hand by the time Prepare is
   * pressed.
   */
  const assets = useRef<Promise<{ sheet: typeof A4_LETTERHEAD; letterhead: { bytes: Uint8Array; type: 'png' | 'jpg' } | null; charter: Awaited<ReturnType<typeof fetchCharter>> }> | null>(null)
  if (!assets.current) {
    assets.current = (async () => {
      const [sheet, charter] = await Promise.all([
        fetchLetterheads().then((all) => defaultOf(all)?.page ?? A4_LETTERHEAD).catch(() => A4_LETTERHEAD),
        fetchCharter(''),
      ])
      let letterhead: { bytes: Uint8Array; type: 'png' | 'jpg' } | null = null
      if (sheet.backgroundUrl) {
        const got = await fetch(sheet.backgroundUrl).catch(() => null)
        if (got?.ok) letterhead = { bytes: new Uint8Array(await got.arrayBuffer()), type: /\.jpe?g($|\?)/i.test(sheet.backgroundUrl) ? 'jpg' : 'png' }
      }
      return { sheet, letterhead, charter }
    })()
  }

  async function prepare() {
    setBusy(true); setError(null)
    try {
      const terms: MandateTerms = { party, clientName: name.trim(), commission }
      const doc = mandateDocument(terms)
      const blanks = mandateBlanks(party)
      const prefill: Record<string, string> = { mandate_client_name: name.trim(), ...(email ? { mandate_email: email } : {}) }
      const { sheet, letterhead, charter } = await (assets.current as NonNullable<typeof assets.current>)
      /* The request first: the PDF and the email both point at it. Frozen terms, prefilled answers. */
      const token = await createSigningRequest({
        accountId: null, title: 'Debt collection agreement', body: doc.blocks, pageSetup: sheet, blanks,
        signerName: contactName, signerEmail: email, createdBy: currentUser?.id ?? null,
      })
      const { error: e } = await supabase.from('signing_requests')
        .update({ lead_id: leadId, deal_id: dealId, mandate: terms, filled: prefill }).eq('token', token)
      if (e) throw new Error(e.message)

      const bytes = await letterToPdf({
        doc, page: sheet, filled: true, values: withFilled({}, blanks, prefill), letterhead,
        charter: isCharter(doc.defaults.font) ? charter : null, signed: null,
      })
      const filename = letterFilename('Debt collection agreement', name.trim())
      const url = signingLink(token, window.location.origin)
      const greeting = contactName ? `Dear ${contactName.split(' ')[0]}` : 'Good day'
      setCompose({
        subject: `Debt collection agreement - ${name.trim()}`,
        body: `${greeting}\n\n`
          + `Thank you for the opportunity to assist ${name.trim()} with its collections. Attached is our debt collection agreement, `
          + `on a contingency basis: no collection, no fee. Commission: ${commissionLine(commission)}${kind === 'scale' ? ', as set out in clause 2' : ' of the capital collected'}.\n\n`
          + 'You can complete and sign it online in a few minutes, on your phone or computer: press the button below, fill in your details and banking, and sign. '
          + 'A signed copy comes straight back to you.\n\n'
          + 'Kind regards',
        html: signingButtonHtml(url, 'Sign the agreement online'),
        file: { filename, contentType: 'application/pdf', size: bytes.length, content: toBase64(bytes) },
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (compose) {
    return (
      <ComposeEmailModal
        title="Send the mandate"
        to={email ?? undefined}
        initialSubject={compose.subject}
        initialBody={compose.body}
        initialAttachments={[compose.file]}
        appendHtml={compose.html}
        appendNote="The Sign online button goes under your message."
        onClose={onClose}
        onSent={async (subject, body) => {
          /* The deal moves to Mandate Sent, with the day, as the pipeline already reads it. */
          if (dealId) await supabase.from('deals').update({ stage: 'Mandate Sent', mandate_sent_at: clockNow().toISOString() }).eq('id', dealId).neq('stage', 'Won')
          onSent(subject, body, `Mandate sent for signing online: ${party === 'company' ? 'a company' : 'an individual'}, commission ${commissionLine(commission)}`)
        }}
      />
    )
  }

  return (
    <Modal title="Send the mandate" onClose={onClose} width={620}>
      <div className="space-y-4" data-testid="send-mandate">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">The client is</span>
            <Segmented value={party} onChange={setParty} options={[['company', 'A company'], ['individual', 'An individual']]} name="party" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">{party === 'company' ? 'Company name' : 'Full name'}</span>
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
        </div>

        <div>
          <span className="mb-1 block text-xs font-medium text-slate-500">Commission</span>
          <Segmented value={kind} onChange={setKind} options={[['rate', 'Flat rate'], ['scale', 'Sliding scale']]} name="commission" />
          {kind === 'rate' ? (
            <div className="mt-2 flex items-center gap-2">
              <input className={clsx(inputClass, 'w-24')} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} aria-label="Commission rate" />
              <span className="text-sm text-slate-500">% of the capital collected</span>
            </div>
          ) : (
            <div className="mt-2 rounded-lg border border-slate-200">
              <table className="w-full text-sm" data-testid="mandate-scale">
                <thead><tr className="text-left text-[11px] text-slate-400"><th className="px-3 py-1.5 font-medium">Capital on the account</th><th className="px-3 py-1.5 font-medium">Commission</th><th /></tr></thead>
                <tbody>
                  {bands.map((b, i) => {
                    const last = i === bands.length - 1
                    return (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="px-3 py-1.5">
                          {/* EACH BAND SAYS WHERE IT STARTS AND ENDS, in words, and the amounts are grouped
                              in thousands (the firm, 18 Oct: "all of these zeros are confusing ... it should
                              also show ... below or between"). */}
                          {last ? (
                            <span className="text-slate-600">Above <b className="tabular-nums">{rands(bands[i - 1]?.upTo)}</b></span>
                          ) : (
                            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                              <span className="whitespace-nowrap text-slate-600">{i === 0 ? 'Up to' : <>From <b className="tabular-nums">{rands(bands[i - 1]?.upTo, 0.01)}</b> up to</>}</span>
                              <span className="text-slate-400">R</span>
                              <input className={clsx(inputClass, 'w-36 py-1 tabular-nums')} inputMode="numeric" value={grouped(b.upTo)} aria-label={`Band ${i + 1} up to`}
                                onChange={(e) => setBands((all) => all.map((x, j) => j === i ? { ...x, upTo: e.target.value.replace(/[^0-9]/g, '') } : x))} />
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-1.5">
                          <div className="flex items-center gap-1">
                            <input className={clsx(inputClass, 'w-20 py-1')} inputMode="decimal" value={b.rate} aria-label={`Band ${i + 1} rate`}
                              onChange={(e) => setBands((all) => all.map((x, j) => j === i ? { ...x, rate: e.target.value } : x))} />
                            <span className="text-slate-400">%</span>
                          </div>
                        </td>
                        <td className="px-2 text-right">
                          {bands.length > 2 && !last && (
                            <button type="button" aria-label="Remove band" className="text-slate-400 hover:text-rose-600"
                              onClick={() => setBands((all) => all.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <div className="flex items-center justify-between border-t border-slate-100 px-3 py-1.5 text-xs">
                <button type="button" className="inline-flex items-center gap-1 font-medium text-slate-600 hover:text-slate-900"
                  onClick={() => setBands((all) => [...all.slice(0, -1), { upTo: '', rate: '' }, all[all.length - 1]])}><Plus size={13} /> Add a band</button>
                <button type="button" className="text-slate-500 hover:text-slate-800"
                  onClick={() => setBands(STANDARD_SCALE.map((x) => ({ upTo: x.upTo === null ? '' : String(x.upTo), rate: String(x.rate * 100) })))}>
                  Back to the standard scale
                </button>
              </div>
            </div>
          )}
          <p className="mt-1.5 text-xs text-slate-500">
            {kind === 'scale'
              ? 'One rate per account, by the capital handed over on that account. The boundary amount is in the lower band.'
              : `${pct(commission.kind === 'rate' ? commission.rate : 0)} of the capital collected on every account.`}
          </p>
        </div>

        {problems.length > 0 && <ul className="text-xs text-rose-600">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
        {error && <p className="text-xs text-rose-600" role="alert">{error}</p>}
        {!email && <p className="text-xs text-amber-700">There is no email address on this lead; you can type one in the next step.</p>}

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
          <button type="button" className="rounded-lg px-3.5 py-2 text-sm text-slate-600 hover:bg-slate-100" onClick={onClose}>Cancel</button>
          <button type="button" disabled={busy || problems.length > 0} onClick={() => void prepare()}
            className="inline-flex items-center gap-2 rounded-lg bg-navy-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
            {busy && <Loader2 size={14} className="animate-spin" />} Prepare the email
          </button>
        </div>
      </div>
    </Modal>
  )
}

/** "100000" -> "100 000": the thousands grouped the way every rand in Raptor is written. */
function grouped(v: string): string {
  const digits = v.replace(/[^0-9]/g, '')
  return digits ? Number(digits).toLocaleString('en-ZA').replace(/[\s,]/g, ' ') : ''
}
/** A band's boundary as rand, "R 100 000" or, as the start of the next band, "R 100 000.01". */
function rands(v: string | undefined, plus = 0): string {
  const n = Number((v ?? '').replace(/[^0-9]/g, ''))
  if (!n) return 'R …'
  return `R ${grouped(String(Math.floor(n)))}${plus ? '.01' : ''}`
}

function Segmented<T extends string>({ value, onChange, options, name }: { value: T; onChange: (v: T) => void; options: [T, string][]; name: string }) {
  return (
    <div className="inline-flex rounded-lg border border-slate-200 p-0.5 text-sm" role="radiogroup" aria-label={name}>
      {options.map(([v, label]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}
          className={clsx('rounded-md px-3 py-1', value === v ? 'bg-navy-900 text-white' : 'text-slate-600 hover:text-slate-900')}>{label}</button>
      ))}
    </div>
  )
}
