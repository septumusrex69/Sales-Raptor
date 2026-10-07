import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, FileText, Loader2, Pencil, Trash2, Upload } from 'lucide-react'
import { Card } from '../ui/Card'
import { formatDate } from '../../data/mockData'
import {
  CLIENT_DOCUMENT_KINDS, MANDATE_KIND, clientDocumentUrl, deleteClientDocument,
  fetchClientDocuments, uploadClientDocument, type ClientDocument,
} from '../../lib/clientDocuments'
import { DEFAULT_INTEREST_RATE_ANNUAL } from '../../lib/newDebtor'
import type { Company } from '../../types'
import { fromSwordfish } from '../../lib/mandateRule'

const KB = 1024
const fileSize = (n: number | null) =>
  n === null ? '' : n < KB ? `${n} B` : n < KB * KB ? `${Math.round(n / KB)} KB` : `${(n / KB / KB).toFixed(1)} MB`

/** The date field wants yyyy-mm-dd; the column is a timestamptz. */
const dateValue = (iso: string | undefined) => (iso ? new Date(iso).toISOString().slice(0, 10) : '')

/**
 * THE MANDATE: the date it was signed, and the mandate itself.
 *
 * THE FIRM, stopped importing a handover: "now it tells me I can't upload this handover sheet
 * because there's no contract signed. However, there was no option where I can upload a
 * contract... there should be a function inside the client section where it says upload a
 * mandate."
 *
 * TWO SEPARATE GAPS, BOTH REAL.
 *
 * The DATE could only ever be set on the form that creates the client. That form deliberately
 * does not insist on it — a client is usually loaded while the mandate is still in the post, and
 * a form that will not save without a date is a form people fill in with a made-up one — and the
 * client page then rendered the date only `&&` it was already there. So the ordinary path
 * produced a client that nothing in the app could unblock, and the import's refusal ("add the
 * date it was signed on the client first") named a thing that could not be done.
 *
 * The MANDATE ITSELF had nowhere to live at all. The date was on record, the paper was not —
 * and the date is a claim, while the signed document is the answer to "on whose authority" when
 * a debtor's attorney asks.
 *
 * THE IMPORT STILL GATES ON THE DATE, NOT THE DOCUMENT, and that is a decision rather than an
 * oversight. The firm's rule is "a client needs a mandate before a handover can be imported";
 * the date is the firm declaring they hold one. A gate on the upload would stop a handover the
 * morning the mandate comes back signed and the scanner is busy — a new refusal nobody asked
 * for. So the missing document is said here, quietly, where it is context, and not on the import
 * screen as an alarm.
 *
 * WHO MAY CHANGE IT is canEditOwned, which mirrors the companies RLS update policy exactly: the
 * client's own liaison, an Administrator, a Sales Manager or a Liaison Manager. Deleting a filed
 * document is narrower still and enforced by RLS — nobody quietly removes the authority the firm
 * is collecting on.
 */
export function MandateCard({
  company, canEdit, canDelete, userId, userName, onSave,
}: {
  company: Company
  canEdit: boolean
  canDelete: boolean
  userId: string | null
  userName: string | null
  /**
   * Writes the mandate through the store, so every screen reading it agrees at once.
   *
   * ONE CALLBACK FOR BOTH FIELDS, NOT TWO, and the Save button is why. They are two readings of
   * one piece of paper behind one press, so two callbacks meant two PATCHes at the same row a
   * few milliseconds apart -- two rows in the audit trail for one edit, two chances for the
   * second to fail after the first succeeded, and a store that briefly holds half the change.
   * The browser check counts the writes for exactly this reason.
   *
   * A KEY LEFT OUT IS LEFT ALONE; a key present and undefined takes that field off record.
   */
  onSave: (patch: { mandateSignedAt?: string | undefined; defaultInterestRateAnnual?: number | undefined }) => void
}) {
  const [docs, setDocs] = useState<ClientDocument[] | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(dateValue(company.mandateSignedAt))
  const [rateDraft, setRateDraft] = useState(
    typeof company.defaultInterestRateAnnual === 'number'
      ? String(company.defaultInterestRateAnnual) : '')
  const [kind, setKind] = useState<string>(MANDATE_KIND)
  const [uploading, setUploading] = useState(false)
  const [opening, setOpening] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<ClientDocument | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  /* THE LIST, AND THE ONE PLACE IT IS REFRESHED. An upload and a delete both call it rather than
     patching the array they have, so the screen shows what the database holds. */
  const load = useCallback(async () => {
    try { setDocs(await fetchClientDocuments(company.id)) }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); setDocs([]) }
  }, [company.id])
  useEffect(() => { void load() }, [load])

  /* The box opens on whatever is on record now, not on whatever it held when the page loaded. */
  useEffect(() => { setDraft(dateValue(company.mandateSignedAt)) }, [company.mandateSignedAt])

  const signed = company.mandateSignedAt
  const hasMandateDoc = (docs ?? []).some((d) => d.kind === MANDATE_KIND)

  function save() {
    /*
     * MIDDAY, NOT MIDNIGHT. `new Date('2026-09-30')` is midnight UTC, which in South Africa
     * (UTC+2) is still the 30th — but the same string parsed west of Greenwich is the 29th, and
     * the date read back would be a day early. Noon survives every timezone this firm will ever
     * be read in.
     */
    /*
     * THE RATE SAVES WITH THE DATE, because they are one fact about one piece of paper and two
     * Save buttons on one card is two things to forget. An unreadable box is left alone rather
     * than written as nought: nought is a real rate meaning "no interest is ever charged", and
     * somebody who typed "24%" and got a silent zero would have taken interest off a whole book.
     */
    const typed = rateDraft.replace(/[\s%]/g, '').trim()
    const pct = typed === '' ? undefined : Number(typed)
    const rateOk = typed === ''
      || (Number.isFinite(pct) && (pct as number) >= 0 && (pct as number) <= 100)
    /* ONE PATCH, both fields — see onSave. The rate's key is omitted entirely where the box could
       not be read, so an unreadable value leaves the stored rate exactly as it was. */
    onSave({
      mandateSignedAt: draft ? new Date(`${draft}T12:00:00`).toISOString() : undefined,
      ...(rateOk ? { defaultInterestRateAnnual: pct } : {}),
    })
    setEditing(false)
  }

  const rate = company.defaultInterestRateAnnual
  const hasRate = typeof rate === 'number'
  /* What the box currently holds, judged the same way `save` judges it, so the warning under the
     field and the thing that actually gets written cannot disagree. */
  const typedRate = rateDraft.replace(/[\s%]/g, '').trim()
  const rateReadable = typedRate === ''
    || (Number.isFinite(Number(typedRate)) && Number(typedRate) >= 0 && Number(typedRate) <= 100)

  async function onPick(files: FileList | null) {
    if (!files?.length) return
    setUploading(true); setErr(null)
    try {
      // One at a time, in order, so a failure names the file that failed.
      for (const file of Array.from(files)) {
        await uploadClientDocument({
          companyId: company.id, file, kind, uploadedBy: userId, uploadedByName: userName,
        })
      }
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  /* NO FEE IS RAISED BY OPENING ONE. An account's documents charge Annexure B item 3 on both
     saving and opening; this is the client's own paper, and the sales side raises nothing. */
  async function open(doc: ClientDocument) {
    setOpening(doc.id); setErr(null)
    try { window.open(await clientDocumentUrl(doc.storagePath), '_blank', 'noopener') }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
    finally { setOpening(null) }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="font-semibold text-[15px] text-slate-800">The mandate</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            The authority this firm collects on. No handover can be imported without it.
          </p>
        </div>
        {canEdit && !editing && (
          <button type="button" onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg
              border border-slate-200 text-slate-600 hover:bg-slate-50">
            <Pencil size={13} /> {signed ? 'Change the date' : 'Add the date'}
          </button>
        )}
      </div>

      {/* ---------- the date ---------- */}
      {editing ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 mb-4">
          <label className="block text-xs font-medium text-slate-500 mb-1.5" htmlFor="mandate-signed-on">
            Mandate signed on
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input id="mandate-signed-on" type="date" value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm bg-white" />
            <button type="button" onClick={save}
              className="text-sm font-medium px-3 py-1.5 rounded-lg bg-brand-600 text-white">
              Save
            </button>
            <button type="button" onClick={() => { setDraft(dateValue(signed)); setEditing(false) }}
              className="text-sm px-3 py-1.5 rounded-lg text-slate-500 hover:bg-slate-100">
              Cancel
            </button>
          </div>
          {/*
            CLEARING IT IS A REAL ACTION AND IS SAID OUT LOUD. An empty date stops every future
            handover for this client, which is the correct answer if the mandate turns out never
            to have been signed and a surprise if somebody just emptied the box.
          */}
          <p className="text-[11px] text-slate-400 mt-2">
            {draft
              ? 'The date the client signed, not the date it was filed.'
              : fromSwordfish(company)
                ? 'Brought across from Swordfish, so handovers still go through without a date.'
                : 'Saving it empty takes the mandate off record — no handover could then be imported.'}
          </p>

          {/* ---------- and the rate the mandate sets ---------- */}
          {/*
            ON THE MANDATE CARD AND NOWHERE ELSE, because the mandate is where the firm said the
            rate lives. Asked why the handover sheet no longer carries one: "the rate is in the
            agreement the firm already holds." Nothing in Raptor held that agreement's rate, so the
            import wrote 0 on every account and the firm met the consequence on a simulation —
            "why is interest not running? It should be running."

            BESIDE THE SIGNING DATE rather than in a card of its own: they are two readings of one
            piece of paper, and a rate on a separate card is a rate nobody opens the page to set.
          */}
          <div className="mt-3 pt-3 border-t border-slate-200">
            <label className="block text-xs font-medium text-slate-500 mb-1.5" htmlFor="mandate-interest">
              Interest the mandate allows, % a year
            </label>
            <input id="mandate-interest" value={rateDraft} inputMode="decimal"
              onChange={(e) => setRateDraft(e.target.value)} placeholder="e.g. 24"
              className="w-28 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm bg-white" />
            {/*
              A WARNING ONLY WHEN SOMETHING IS WRONG. An empty box is a client whose mandate has
              not been read yet, which the card already says below; a number this cannot read is
              somebody about to lose what they typed, and that is worth interrupting for.
            */}
            <p className={`text-[11px] mt-2 ${rateReadable ? 'text-slate-400' : 'text-negative-700'}`}>
              {!rateReadable
                ? `“${rateDraft}” is not a rate between 0 and 100, so it will not be saved.`
                : typedRate === ''
                  ? `Left empty, accounts for this client open at the firm’s standing `
                    + `${DEFAULT_INTEREST_RATE_ANNUAL}% a year. Set it lower here where the mandate says so.`
                  : 'Accounts opened for this client from now on inherit this. Accounts already on '
                    + 'the book keep the rate they were opened with.'}
            </p>
          </div>
        </div>
      ) : signed ? (
        <div className="mb-4">
          <p className="text-sm text-slate-700">
            Signed <span className="font-medium text-navy-950">{formatDate(signed)}</span>.
          </p>
          {/*
            THE RATE, OR ITS ABSENCE, AND THE ABSENCE IS THE ONE WORTH SAYING. A mandate on record
            with no rate against it opens every account at 0%: nothing accrues, every settlement
            quote is the balance, and the first anybody knows is a collector asking why a
            simulation shows no interest. Which is exactly how the firm found it.
          */}
          {hasRate ? (
            <p className="text-sm text-slate-600 mt-1">
              Interest <span className="font-medium text-navy-950">{rate}% a year</span> on accounts
              opened for this client.
            </p>
          ) : (
            <p className="text-sm text-slate-600 mt-1">
              {/*
                NO LONGER A WARNING, because it is no longer a surprise. THE FIRM: "all debt clients
                are by default loaded on 24% interest. If we change it, we want to change it. We
                will reduce it if we want." An empty box is now the ordinary case and says what will
                happen; the amber it used to wear was for a client whose accounts ran NO interest at
                all, which is the state that no longer occurs.
              */}
              Nothing recorded, so accounts open at the firm’s standing{' '}
              <span className="font-medium text-navy-950">{DEFAULT_INTEREST_RATE_ANNUAL}% a year</span>.
              {canEdit ? ' Record a lower rate above where the mandate says one.' : ''}
            </p>
          )}
        </div>
      ) : fromSwordfish(company) ? (
        /* PROMPT 10: a client the Swordfish import brought across already has a book with the
           firm, and takes handovers without a mandate date. Said in plain words rather than as a
           red warning, because nothing is wrong -- and the date and the paper can still be added
           above and below if somebody has them. */
        <p className="text-sm text-slate-600 mb-4">
          Brought across from Swordfish: no mandate needed for handovers.
          {canEdit ? ' If you have the signed mandate, add its date above and file it below.' : ''}
        </p>
      ) : (
        <p className="text-sm text-negative-700 mb-4">
          No mandate on record, so no handover can be imported for this client.
          {canEdit
            ? ' Add the date it was signed above, and file the signed mandate below.'
            : ' Ask the client’s liaison or an administrator to record the date it was signed.'}
        </p>
      )}

      {/* ---------- the document itself ---------- */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-100">
        <p className="text-xs text-slate-400">
          {docs === null ? 'Reading the file…'
            : docs.length === 0 ? 'Nothing filed for this client yet.'
              : `${docs.length} document${docs.length === 1 ? '' : 's'} on file.`}
        </p>
        <div className="flex items-center gap-2">
          <select value={kind} onChange={(e) => setKind(e.target.value)}
            aria-label="What kind of document"
            className="text-sm rounded-lg border border-slate-200 px-2 py-1.5 bg-white">
            {CLIENT_DOCUMENT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <input ref={fileRef} type="file" multiple className="hidden"
            onChange={(e) => onPick(e.target.files)} />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
            className="text-sm font-medium px-3 py-1.5 rounded-lg bg-brand-600 text-white
              disabled:opacity-50 inline-flex items-center gap-1.5">
            {uploading
              ? <><Loader2 size={13} className="animate-spin" /> Uploading…</>
              : <><Upload size={13} /> Upload a mandate</>}
          </button>
        </div>
      </div>

      {err && <p className="text-sm text-negative-700 mt-3">{err}</p>}

      {/*
        A DATE ON RECORD WITH NO MANDATE BEHIND IT. Said here and nowhere else: it is a real gap —
        the firm cannot produce the authority if it is asked for — but it is not a reason to stop
        an import, and a second warning on the import screen would be a warning that fires when
        nothing is wrong.
      */}
      {docs !== null && signed && !hasMandateDoc && (
        <p className="text-xs text-amber-700 mt-3">
          The date is on record but the signed mandate is not filed. Upload it so the firm can
          produce the authority if a debtor’s attorney asks on whose instruction the demand went
          out.
        </p>
      )}

      {docs !== null && docs.length > 0 && (
        <div className="divide-y divide-slate-50 mt-2">
          {docs.map((d) => (
            <div key={d.id} className="flex items-center gap-3 py-2.5">
              <FileText size={16} className="text-slate-300 shrink-0" />
              <div className="min-w-0 flex-1">
                <button type="button" onClick={() => open(d)}
                  className="text-sm text-slate-800 hover:text-brand-600 hover:underline text-left break-words">
                  {d.name}
                </button>
                <p className="text-[11px] text-slate-400">
                  {[d.kind, fileSize(d.sizeBytes), formatDate(d.createdAt), d.uploadedByName]
                    .filter(Boolean).join(' · ')}
                </p>
              </div>
              <button type="button" onClick={() => open(d)} disabled={opening === d.id}
                className="text-slate-400 hover:text-brand-600 shrink-0 disabled:opacity-50" title="Open">
                {opening === d.id ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              </button>
              {/* Always visible, never hover-only: the firm works on an iPad and there is no
                  hover on a touch screen, so a hidden control does not exist for them. */}
              {canDelete && (
                <button type="button" onClick={() => setDeleting(d)}
                  className="text-slate-300 hover:text-negative shrink-0 p-1"
                  title={`Delete ${d.name}`} aria-label={`Delete ${d.name}`}>
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {deleting && (
        <ConfirmDeleteMandate
          doc={deleting}
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            try { await deleteClientDocument(deleting); setDeleting(null); await load() }
            catch (e) { setErr(e instanceof Error ? e.message : String(e)); setDeleting(null) }
          }} />
      )}
    </Card>
  )
}

/**
 * Deleting a client's document, deliberately made harder than pressing a button — the same shape
 * as an account's, for a stronger reason: a mandate nobody can produce is a book the firm cannot
 * show it was ever instructed to collect.
 */
function ConfirmDeleteMandate({ doc, onCancel, onConfirm }: {
  doc: ClientDocument
  onCancel: () => void
  onConfirm: () => Promise<void>
}) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const ok = typed.trim().toUpperCase() === 'DELETE'
  return (
    <div className="mt-4 p-4 rounded-lg border border-negative-100 bg-negative-50">
      <p className="text-sm font-medium text-negative-700">Delete this document?</p>
      <p className="text-sm text-slate-700 mt-1 break-words">{doc.name}</p>
      <p className="text-xs text-slate-500 mt-2">
        The file is removed from storage as well as from this list, and it cannot be brought back.
        Type <span className="font-mono font-semibold">DELETE</span> to confirm.
      </p>
      <div className="flex items-center gap-2 mt-3">
        <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="DELETE"
          aria-label="Type DELETE to confirm"
          className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm bg-white w-28" />
        <button type="button" disabled={!ok || busy}
          onClick={async () => { setBusy(true); await onConfirm(); setBusy(false) }}
          className="text-sm font-medium px-3 py-1.5 rounded-lg bg-negative text-white disabled:opacity-40">
          {busy ? 'Deleting…' : 'Delete'}
        </button>
        <button type="button" onClick={onCancel}
          className="text-sm px-3 py-1.5 rounded-lg text-slate-500 hover:bg-slate-100">
          Cancel
        </button>
      </div>
    </div>
  )
}
