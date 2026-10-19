import { useState } from 'react'
import { Loader2, Mail } from 'lucide-react'
import { FileActions } from '../ui/FileActions'
import { letterPdfBytes } from '../../lib/letterAttachment.ts'
import { letterFilename, toBase64 } from '../../lib/letterPdf.ts'
import { summaryOfAccount, statementOfAccount } from '../../lib/accountSummaryLetter.ts'
import { fetchLibrary } from '../../lib/templateLibrary.ts'
import { renderTemplate } from '../../lib/messageTemplates'
import type { AttachedFile } from '../../lib/letterAttachment.ts'
import type { BalanceBreakdown, StatementLine } from '../../lib/accountBalance.ts'

/**
 * THE TWO DOCUMENTS A DEBTOR ASKS FOR, WHERE THE FIRM PUT THEM.
 *
 * THE FIRM DREW THIS: "summary or statement", pencilled beside the Print button on the account's
 * transactions list, with "put it where you can email it". So it sits where the movements are --
 * the person looking at the table is the person who has just been asked for it.
 *
 * A SUMMARY IS ONE PAGE AND A STATEMENT IS THE WORKING. Two buttons rather than one document with
 * a toggle: a collector answering "what do I owe" and one answering "prove it" are on different
 * calls, and a control that needs a decision before it does anything is one people press twice.
 *
 * IT DOES NOT SEND -- it opens the account's compose box with the PDF attached and the firm's own
 * covering wording merged. That box sends through the collector's mailbox, files the message on
 * the account and raises item 1(a): one path, one charge, one record. A sender here would be a
 * second place that has to remember the R25, and the one that forgot it would be the unattended
 * one. It is also what lets a person read a page of figures before it reaches a debtor.
 */
export type AccountDocKind = 'summary' | 'statement'

const SEEDS: Record<AccountDocKind, { individual: string; company: string }> = {
  summary: {
    individual: 'email-account-summary-individual',
    company: 'email-account-summary-company',
  },
  statement: {
    individual: 'email-account-statement-individual',
    company: 'email-account-statement-company',
  },
}

const TITLES: Record<AccountDocKind, string> = {
  summary: 'Summary of account',
  statement: 'Statement of account',
}

export function AccountDocuments({
  breakdown, lines, handedOver, asAt, money, values, reference, audience, status, onEmail,
}: {
  /** The statement's own assembly. Never recomputed here -- see accountSummaryLetter. */
  breakdown: BalanceBreakdown | undefined
  lines: StatementLine[]
  handedOver: number
  /** The day the figures were struck. Printed on the page, never assumed to be today. */
  asAt: string
  money: (n: number) => string
  /** The account's merge values, so the trust account here is the one on the section 129. */
  values?: Record<string, string>
  /** What the debtor knows the account by. Goes in the filename, not in the document. */
  reference?: string | null
  audience?: 'individual' | 'company' | null
  /** The firm's word for where the account stands -- "Pre-legal". Left off where unknown. */
  status?: string | null
  /** Hands the drawn PDF and the merged wording up to the page's one compose box. */
  onEmail?: (doc: {
    file: AttachedFile
    subject: string
    body: string
    missing: string[]
  }) => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  /* Nothing to draw and nothing to say about it: an account with no figures has no summary. */
  if (!breakdown || !values) return null

  function build(kind: AccountDocKind) {
    const input = { breakdown: breakdown as BalanceBreakdown, handedOver, asAt, money, status, lines }
    return kind === 'summary' ? summaryOfAccount(input) : statementOfAccount(input)
  }

  /*
   * THROUGH letterPdfBytes, which draws every other letter this firm sends: it fetches the
   * letterhead as bytes, embeds Charter, and refuses a document whose merge fields this account
   * cannot fill. Drawn any other way these two would be the PDFs that do not come out on the
   * firm's paper.
   */
  async function bytesFor(kind: AccountDocKind) {
    return letterPdfBytes({
      doc: build(kind), scope: 'collections', values: values as Record<string, string>,
      filled: true, name: TITLES[kind],
    })
  }

  /*
   * THE PDF, for Open or Download (the firm, 19 Oct: "an option to open it or download it ... the
   * same should work for every single document and PDF, whatever is generated"). A failure is said
   * here, beside the buttons, in full -- "{{firm_bank}} cannot be filled from this account" says what
   * to go and fix -- and is also rethrown so the file's own buttons stop waiting.
   */
  async function pdfOf(kind: AccountDocKind): Promise<Blob> {
    setFailed(null)
    try {
      return new Blob([(await bytesFor(kind)) as BlobPart], { type: 'application/pdf' })
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e))
      throw new Error('Could not be drawn -- see the reason below.')
    }
  }

  async function emailIt(kind: AccountDocKind) {
    if (!onEmail) return
    setBusy(`${kind}-email`); setFailed(null)
    try {
      const wanted = audience === 'company' ? SEEDS[kind].company : SEEDS[kind].individual
      const template = (await fetchLibrary('collections')).find((t) => t.seedKey === wanted)
      if (!template) {
        setFailed(`The covering email for a ${kind === 'summary' ? 'summary' : 'statement'} of account is not in the library.`)
        return
      }
      const bytes = await bytesFor(kind)
      const subject = renderTemplate(template.subject, values as Record<string, string>)
      const body = renderTemplate(template.body, values as Record<string, string>)
      onEmail({
        file: {
          filename: letterFilename(TITLES[kind], reference ?? null),
          contentType: 'application/pdf',
          size: bytes.length,
          content: toBase64(bytes),
        },
        subject: subject.text,
        body: body.text,
        /* Both halves, deduplicated: an unresolved field in the subject is as bad as one in the
           body, and the box warns once rather than twice about the same key. */
        missing: [...new Set([...subject.missing, ...body.missing])],
      })
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="print:hidden">
      <div className="flex flex-wrap items-center gap-1.5">
        {(['summary', 'statement'] as AccountDocKind[]).map((kind) => (
          <span key={kind} className="inline-flex items-center rounded-lg border border-slate-200">
            {/*
              EMAIL IS THE PRIMARY HALF, because it is what the firm asked for -- "put it where you
              can email it". The download is what a collector uses to read the page first, or to
              hand it over a counter.
            */}
            {onEmail && (
              <button type="button" disabled={busy !== null}
                onClick={() => { void emailIt(kind) }}
                title={`Email the ${kind} to the debtor, with the PDF attached`}
                className="inline-flex items-center gap-1.5 rounded-l-lg px-2.5 py-1.5 text-xs font-medium text-navy-950 hover:bg-gold-100 disabled:opacity-40">
                {busy === `${kind}-email`
                  ? <Loader2 size={13} className="animate-spin" />
                  : <Mail size={13} />}
                {TITLES[kind]}
              </button>
            )}
            {/* OPEN OR DOWNLOAD, each its own press -- see FileActions. */}
            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 ${onEmail ? 'border-l border-slate-200' : ''}`}>
              {!onEmail && <span className="pl-1 text-xs font-medium text-slate-600">{TITLES[kind]}</span>}
              <FileActions name={letterFilename(TITLES[kind], reference ?? null)} buttonsOnly
                fetchFile={() => pdfOf(kind)} testId={`account-doc-${kind}`} />
            </span>
          </span>
        ))}
      </div>
      {/* The reason it could not be drawn, beside the buttons rather than in a tooltip only: on
          the iPad the firm works on there is no hover to reveal one. */}
      {failed && <p className="mt-1.5 text-[11px] leading-snug text-negative-700">{failed}</p>}
    </div>
  )
}
