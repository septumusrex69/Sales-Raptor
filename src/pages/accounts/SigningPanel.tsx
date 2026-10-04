import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, Loader2, PenLine } from 'lucide-react'
import { Card, CardHeader } from '../../components/ui/Card'
import { Modal } from '../../components/ui/Modal'
import { fetchLibrary, type LibraryTemplate } from '../../lib/templateLibrary'
import { A4_LETTERHEAD, fillLetter, parseLetter, type PageSetup } from '../../lib/letterDocument.ts'
import { defaultOf, fetchLetterheads } from '../../lib/letterheads'
import { blanksFor, FILLABLE } from '../../lib/signingBlanks.ts'
import {
  createSigningRequest, listSigningRequests, signingLink, type SigningState,
} from '../../lib/signing.ts'

/**
 * SEND A DOCUMENT OUT TO BE SIGNED, AND SEE WHAT CAME BACK.
 *
 * THE FIRM: "building the online signature for the AOD... you can basically build in an online
 * signature platform. Forget about the OTP for now. Just anyone with a link can open it."
 *
 * THE LINK IS THE DELIVERABLE, and it is shown rather than sent. Emailing it automatically is the
 * obvious next step and is deliberately not this: the firm asked for something they can test, and
 * a link on the screen can be pasted into WhatsApp, into an email somebody writes themselves, or
 * read to a colleague -- all of which is how the first week of a new workflow actually goes.
 *
 * WHAT IS STORED IS THE ANSWERED DOCUMENT, not the template. See fillLetter: an acknowledgement of
 * debt is the instrument the firm would sue on, and a signed copy that re-merged itself would show
 * the court a different balance from the one the debtor agreed to.
 */
export function SigningPanel({ accountId, values, debtorName }: {
  accountId: string
  /** The merge values for this account, resolved by the page. Same ones the composer uses. */
  values: Record<string, string>
  debtorName: string | null
}) {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof listSigningRequests>> | null>(null)
  const [choosing, setChoosing] = useState(false)
  const [letters, setLetters] = useState<LibraryTemplate[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [made, setMade] = useState<{ title: string; url: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    try { setRows(await listSigningRequests(accountId)) } catch { setRows([]) }
  }, [accountId])
  useEffect(() => { void load() }, [load])

  /*
   * THE FIRM'S OWN PAPER, fetched here and frozen onto the request.
   *
   * The signer is anonymous and cannot read the letterheads table, so the sheet has to travel with
   * the document. Plain A4 where there is none: the right width and the right margins is not the
   * firm's letterhead, but it is a document rather than a wall of text at browser width.
   */
  const [sheet, setSheet] = useState<PageSetup>(A4_LETTERHEAD)
  useEffect(() => {
    let cancelled = false
    void fetchLetterheads()
      .then((all) => { if (!cancelled) setSheet(defaultOf(all)?.page ?? A4_LETTERHEAD) })
      .catch(() => { /* A letterhead we cannot read costs the paper, not the document. */ })
    return () => { cancelled = true }
  }, [])

  async function openPicker() {
    setChoosing(true)
    setError(null)
    if (letters !== null) return
    try {
      const library = await fetchLibrary('collections')
      /* THE SAME FILTER AttachLetter USES. A template stored as text has no blocks to freeze, and
         a signing link built from one would open on an empty sheet. */
      setLetters(library.filter((r) => r.kind === 'letter' && r.format === 'document' && r.active))
    } catch (e) {
      setLetters([])
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function send(template: LibraryTemplate, leaveBlank: boolean) {
    setBusy(template.id)
    setError(null)
    try {
      const doc = parseLetter(template.body)
      if (!doc) throw new Error(`${template.name} could not be read back, so nothing was sent.`)
      /*
       * WHAT THE DEBTOR FILLS IN, DECIDED HERE AND NOT GUESSED.
       *
       * THE FIRM: "you currently pull the data from the PTP. But there's a scenario where no PTP
       * exists. So when you send it, it should use the PTP data, or it should ask: use the PTP
       * data or leave it blank."
       *
       * THE TWO ARE DIFFERENT DOCUMENTS and only a person knows which is wanted. Left blank, the
       * arrangement is whatever the debtor offers; filled from the promise, it is the arrangement
       * the firm already has and the debtor is acknowledging it. Sending the second where the
       * first was meant puts terms in a debtor's mouth.
       *
       * AND ANYTHING RAPTOR SIMPLY HAS NO ANSWER FOR goes to the debtor regardless -- their
       * address, their identity number -- because those are theirs and a blank is better than
       * braces. signingBlanks.ts holds the closed list of what may ever be asked.
       */
      const unanswered = FILLABLE
        .filter((b) => !(values[b.key] ?? '').trim())
        .map((b) => b.key)
      const terms = ['ptp_amount', 'ptp_frequency', 'ptp_date']
      const blanks = blanksFor(leaveBlank ? [...unanswered, ...terms] : unanswered)
      const token = await createSigningRequest({
        accountId,
        title: template.name,
        /* ANSWERED NOW, FROZEN FROM NOW. See fillLetter. */
        body: fillLetter(doc, values, blanks.map((b) => b.key)).blocks,
        /* THE PAPER IS FROZEN WITH THE WORDS. Without it the signer gets bare white at browser
           width -- the firm's "it's not on a letterhead, the letters are all over the place". */
        pageSetup: sheet,
        blanks,
        signerName: debtorName,
      })
      setMade({ title: template.name, url: signingLink(token, window.location.origin) })
      setChoosing(false)
      setCopied(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
    } catch {
      /* A browser that refuses the clipboard. The link is on the screen and selectable, which is
         the fallback -- telling somebody it copied when it did not is worse than not offering. */
      setCopied(false)
    }
  }

  return (
    <Card>
      <CardHeader title="Signing"
        subtitle="Send a document out to be signed online. Anyone with the link can open it." />

      <button type="button" onClick={() => void openPicker()}
        className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg
          border border-slate-200 text-slate-700 hover:bg-slate-50">
        <PenLine size={12} /> Send for signature
      </button>

      {made && (
        <div className="mt-3 rounded-lg border border-[#c9a052] bg-gold-50 px-3 py-2.5">
          <p className="text-xs font-medium text-slate-700">{made.title} is ready to sign.</p>
          <p className="mt-1 text-[11px] text-slate-500 break-all select-all">{made.url}</p>
          <button type="button" onClick={() => void copy(made.url)}
            className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--c-steel)] hover:underline">
            {copied ? <><Check size={11} /> Copied</> : <><Copy size={11} /> Copy the link</>}
          </button>
          {/* SAID PLAINLY, because it is the firm's own decision and somebody should be able to
              read it off the screen rather than remember it: there is no one-time pin yet. */}
          <p className="mt-2 text-[10px] text-slate-500">
            Anyone holding this link can open and sign it &mdash; there is no one-time pin yet.
            Send it only to the person who should sign.
          </p>
        </div>
      )}

      {error && <p className="text-xs text-negative-700 mt-2">{error}</p>}

      {rows && rows.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-2 text-xs">
              <span className="text-slate-700">{r.title}</span>
              <span className={r.state === 'signed' ? 'text-[var(--c-green)]' : 'text-slate-400'}>
                {stateWords(r)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {rows && rows.length === 0 && !made && (
        <p className="text-xs text-slate-400 mt-3">Nothing has been sent for signature yet.</p>
      )}

      {choosing && (
        <Modal title="Which document?" onClose={() => setChoosing(false)} width={520}>
          {letters === null && (
            <p className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 size={14} className="animate-spin" /> Loading the library…
            </p>
          )}
          {letters?.length === 0 && (
            <p className="text-sm text-slate-500">
              There are no letters in the library yet. An acknowledgement of debt is seeded by
              scripts/letters/seed-aod.sql.
            </p>
          )}
          <div className="space-y-2">
            {(letters ?? []).map((t) => (
              <div key={t.id} className="rounded-lg border border-slate-200">
              <button type="button" onClick={() => void send(t, false)} disabled={busy !== null}
                className="w-full text-left px-3.5 py-3 rounded-lg
                  hover:border-[#c9a052] hover:bg-gold-50 disabled:opacity-50">
                <span className="block text-sm font-semibold text-slate-800">{t.name}</span>
                <span className="block text-xs text-slate-500 mt-0.5">
                  The figures are fixed at the moment you send it.
                </span>
              </button>
              {/*
                AND THE SECOND WAY OF SENDING THE SAME DOCUMENT.

                THE FIRM: "you currently pull the data from the PTP. But there's a scenario where
                no PTP exists. So when you send it, it should use the PTP data, or it should ask:
                use the PTP data or leave it blank. So then you will put a small line where the
                person can fill in whatever it is that they need to fill in, based on an
                arrangement that they would like to make."

                TWO PRESSES RATHER THAN A TICK BOX, because they are two different documents and
                the difference matters: one states the arrangement the firm already has, the other
                asks the debtor for one. A tick somebody leaves as they found it is how the wrong
                one goes out.
              */}
              <button type="button" onClick={() => void send(t, true)} disabled={busy !== null}
                className="w-full text-left px-3.5 py-2 border-t border-slate-100 text-xs
                  text-slate-500 hover:bg-gold-50 disabled:opacity-50 rounded-b-lg">
                Or send it with the arrangement left blank, for the debtor to fill in
              </button>
              </div>
            ))}
          </div>
          {error && <p className="text-sm text-negative-700 mt-3">{error}</p>}
        </Modal>
      )}
    </Card>
  )
}

/** What a row says. Kept out of the markup so the four states read as one list. */
function stateWords(r: { state: SigningState; signedAt: string | null; signedName: string | null }): string {
  /*
   * THE DATE IS GONE FROM THIS LINE, at the firm's asking: "this AOD says signed at -- maybe we
   * can remove that. It just gives you the option to sign."
   *
   * WHO signed is the thing somebody reads this row for; WHEN is on the signed document itself,
   * which is where a court would look for it and where it is now filed. A row that spends half its
   * width on a date nobody is checking is a row that reads as busy.
   */
  if (r.state === 'signed') {
    return `Signed${r.signedName ? ` by ${r.signedName}` : ''}`
  }
  if (r.state === 'declined') return 'Declined'
  if (r.state === 'cancelled') return 'Withdrawn'
  return 'Waiting to be signed'
}
