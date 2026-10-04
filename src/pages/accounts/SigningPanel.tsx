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
import { isSignable, signingButtonHtml, signingEmailBody } from '../../lib/signingRules.ts'
import { chargeAcknowledgementOfDebt } from '../../lib/accountCharges.ts'


/**
 * SEND A DOCUMENT OUT TO BE SIGNED, AND SEE WHAT CAME BACK.
 *
 * THE FIRM: "building the online signature for the AOD... you can basically build in an online
 * signature platform. Forget about the OTP for now. Just anyone with a link can open it."
 *
 * IT GOES OUT BY EMAIL, and the link is shown as well rather than instead.
 *
 * THE FIRM, twice: "if you send from an email the acknowledgement of debt to be signed, it should
 * have the link in the email somehow, so that the guy can click on it" -- and then, when it still
 * had not: "my instruction was you have to send it from email." So creating the request opens the
 * composer with the covering words and the button already in it; see signingRules.ts for why the
 * button is a table and why the wording is three lines long.
 *
 * THE LINK STAYS ON THE SCREEN TOO. A debtor who answers on WhatsApp, a collector reading it to a
 * colleague, a second copy to an attorney -- all of that is a copy of the same address, and taking
 * it away would mean the only way to send one twice is to issue a second document.
 *
 * AND ISSUING ONE RAISES ITEM 4(a). See chargeAcknowledgementOfDebt: the gazette prices the
 * instrument and the consultation behind it, both of which have happened by the time the link
 * exists, and the firm asked for it "the moment that thing is issued".
 *
 * WHAT IS STORED IS THE ANSWERED DOCUMENT, not the template. See fillLetter: an acknowledgement of
 * debt is the instrument the firm would sue on, and a signed copy that re-merged itself would show
 * the court a different balance from the one the debtor agreed to.
 */
export function SigningPanel({
  accountId, values, debtorName, debtorKind, claimAmount, caseNumber, onEmail,
}: {
  accountId: string
  /** The merge values for this account, resolved by the page. Same ones the composer uses. */
  values: Record<string, string>
  debtorName: string | null
  /**
   * WHICH QUESTIONS THE DEBTOR IS ASKED AT ALL.
   *
   * THE FIRM: "why would you ask for the employer and for the company at the same time? If you're
   * speaking to a company, you're speaking to a company. If you're speaking to an individual,
   * you're speaking to an individual." A company has no employer and a person has no registration
   * number -- asking both makes the form read as something nobody looked at.
   */
  debtorKind: 'individual' | 'company'
  /**
   * THE CLAIM THE ACKNOWLEDGEMENT STATES, which decides which of the two item 4(a) bands applies.
   *
   * Off the ledger, like every other figure on this screen -- it is the same balance the document
   * itself quotes, so the fee and the instrument cannot disagree about what is owed. Null where
   * the statement has not loaded; then nothing is charged and the panel says so, because a band
   * guessed at is a fee the firm cannot defend.
   */
  claimAmount: number | null
  /** Raptor's own reference, for the covering email. See CLAUDE.md on which of the three it is. */
  caseNumber: string | null
  /** Where the email would go, so the button can say whether there is anywhere to send it. */
  /** Reserved for the composer's own address line; kept so the panel's props name the recipient. */
  debtorEmail?: string | null
  /**
   * HAND THE COVERING EMAIL TO THE PAGE'S OWN COMPOSER.
   *
   * Not a second compose box in here. The account's composer already knows the mailbox, the
   * recipients, the signature, the attachment limit and how to record a sent message against the
   * account -- a box of our own would be a second set of all of it, and the one that charged item
   * 1(a) would be whichever got remembered.
   */
  onEmail: (message: { subject: string; body: string; appendHtml: string; note: string }) => void
}) {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof listSigningRequests>> | null>(null)
  const [choosing, setChoosing] = useState(false)
  const [letters, setLetters] = useState<LibraryTemplate[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [made, setMade] = useState<{
    title: string
    url: string
    /** What item 4(a) earned, or null where there was no claim figure to band it on. */
    fee: Awaited<ReturnType<typeof chargeAcknowledgementOfDebt>>
    claimAmount: number | null
  } | null>(null)
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
      /*
       * THE SAME FILTER AttachLetter USES, AND TWO MORE. A template stored as text has no blocks
       * to freeze, and a signing link built from one would open on an empty sheet.
       *
       * ONLY THE ACKNOWLEDGEMENT OF DEBT. See isSignable, which carries the firm's words: "the
       * only document, and I repeat myself, is the acknowledgement of debt that can be signed
       * within the debtor's pane. All of the other ones are not in." The picker offered the whole
       * collections library -- a section 129, a final notice, a listing notice -- each of which a
       * debtor could then have put their signature on, which means nothing.
       *
       * AND ONLY THE HALF WRITTEN FOR THIS DEBTOR. The library is written twice all the way down;
       * offering a company's acknowledgement on a person's file is the choice between two rows
       * whose names differ by one word in brackets. Anything written for either side still shows.
       */
      setLetters(library.filter((r) => r.kind === 'letter' && r.format === 'document' && r.active
        && isSignable(r) && (r.audience === null || r.audience === debtorKind)))
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
      const blanks = blanksFor(leaveBlank ? [...unanswered, ...terms] : unanswered, debtorKind)
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
      const url = signingLink(token, window.location.origin)
      /*
       * THE FEE, RAISED ON ISSUE AND BEFORE THE COMPOSER OPENS.
       *
       * Item 4(a), banded on the claim -- see chargeAcknowledgementOfDebt for the firm's words and
       * for why the band comes from the figure on the document rather than from the account's
       * capital. It never throws: the document exists and the link is real either way.
       *
       * REPORTED EITHER WAY, which is why the result is kept. A cap can leave nothing to charge,
       * and "issued, nothing charged" is a sentence somebody needs to be able to read off the
       * screen rather than discover on a statement at month end.
       */
      const fee = claimAmount === null ? null : await chargeAcknowledgementOfDebt({
        accountId, claimAmount,
      })
      setMade({ title: template.name, url, fee, claimAmount })
      setChoosing(false)
      setCopied(false)
      /*
       * AND STRAIGHT INTO THE COMPOSER, because sending it is the point.
       *
       * THE FIRM: "my instruction was you have to send it from email." The panel used to stop at a
       * link on the screen and leave the sending to whoever remembered -- which on their first run
       * meant a signing request nobody ever sent. The box opens prefilled and is still a box: the
       * address, the wording and the button can all be changed before it goes, and closing it
       * leaves the request standing with its link on the screen.
       */
      onEmail({
        subject: `Acknowledgement of debt${caseNumber ? ` - ${caseNumber}` : ''}`,
        body: signingEmailBody(debtorName, caseNumber),
        appendHtml: signingButtonHtml(url),
        note: 'The button in this message opens the acknowledgement of debt for signature.',
      })
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
        subtitle="Email the acknowledgement of debt out to be signed. Anyone with the link can open it." />

      <button type="button" onClick={() => void openPicker()}
        className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg
          border border-slate-200 text-slate-700 hover:bg-slate-50">
        <PenLine size={12} /> Send the acknowledgement of debt
      </button>

      {made && (
        <div className="mt-3 rounded-lg border border-[#c9a052] bg-gold-50 px-3 py-2.5">
          <p className="text-xs font-medium text-slate-700">{made.title} is ready to sign.</p>
          {/*
            WHAT IT EARNED, said on the screen where it was raised.

            A fee a debtor will be asked for should be visible to the person who caused it at the
            moment they caused it -- and the three sentences are three different facts, not one
            with hedging: it charged, a cap left nothing, or there was no claim figure to band it
            on. The last one is the firm's to notice: it means the statement had not loaded, and
            the fee has to be raised by hand.
          */}
          <p className="mt-1 text-[11px] text-slate-500">
            {made.fee && made.fee.exclVat > 0
              ? `Charged ${rand(made.fee.exclVat)} under item 4(a), on a claim of ${rand(made.claimAmount ?? 0)}.`
              : made.fee
                ? 'Nothing was charged under item 4(a) — a cap left no room on this account.'
                : 'Nothing was charged under item 4(a): the balance had not loaded, so the band '
                  + 'could not be decided. Raise it by hand.'}
          </p>
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
              {/* NAMED, because the list is now narrow on purpose and an empty one would otherwise
                  read as a broken library. Only the acknowledgement of debt is ever offered here
                  -- see isSignable -- so the thing that is missing is the acknowledgement of debt
                  written for {debtorKind === 'company' ? 'a company' : 'a person'}. */}
              There is no acknowledgement of debt in the library for
              {debtorKind === 'company' ? ' a company' : ' a person'} yet. One is seeded by
              scripts/letters/seed-aod.sql. Nothing else is signed from a debtor&rsquo;s file.
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

/** Rands, the way every other figure on this screen is written. */
const rand = (n: number) => `R${n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

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
