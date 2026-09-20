import { useEffect, useState } from 'react'
import { ChevronDown, FileText, Loader2 } from 'lucide-react'
import { fetchLibrary, type LibraryTemplate } from '../../lib/templateLibrary.ts'
import { renderTemplate, type TemplateKind, type TemplateScope } from '../../lib/messageTemplates'

/**
 * THE FIRM'S WORDING, REACHED FROM INSIDE AN ACCOUNT.
 *
 * At the firm's instruction: "everything that we have in the library, to be in the account as
 * well as an option." Until now only one kind of template could be reached from an account — a
 * letter, through Attach a letter — so the SMS and email wording the firm had written, approved
 * and priced was sitting on a screen nobody visits while collecting, and a collector wrote each
 * message again from memory.
 *
 * FILLED IN AGAINST THIS ACCOUNT, not previewed against samples. The library previews with
 * `sampleValues()` because it has no debtor in front of it; here there is one, so the words land
 * with the real balance and the real reference in them. A collector who has to fill in the
 * brackets by hand will eventually send one with the brackets still in it.
 *
 * AND WHAT COULD NOT BE FILLED IS NAMED. `renderTemplate` leaves an unresolved placeholder
 * STANDING rather than blanking it, so the failure is visible in the box — but it is visible as
 * "{{respond_by}}" in the middle of a sentence, which reads as a mistake somebody made rather
 * than as a field the app could not answer. Saying which field, and why, is the difference
 * between a collector fixing it and a collector sending it.
 *
 * ONLY WHAT IS LIVE. Retired templates are not offered: the library keeps them so somebody can
 * answer "what did we used to send?", which is a different question from "what do I send now".
 */
export function UseTemplate({ scope, kind, values, onPick, disabled, label }: {
  scope: TemplateScope
  kind: TemplateKind
  /**
   * The merge values for this account.
   *
   * RESOLVED BY THE CALLER, like AttachLetter's. A message is merged against an account, a
   * balance and a date, and this component has none of those.
   */
  values: Record<string, string>
  /**
   * The chosen wording, already merged. `missing` is every field nothing could fill — empty on
   * the ordinary case, which is what lets the caller warn only when there is something to warn
   * about.
   */
  onPick: (picked: {
    template: LibraryTemplate
    subject: string | null
    body: string
    missing: string[]
  }) => void
  disabled?: boolean
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<LibraryTemplate[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  /* Fetched when the list is first opened, not on mount: most messages are typed, and a library
     read on every account that is merely LOOKED at is a round trip nobody asked for. */
  useEffect(() => {
    if (!open || rows !== null) return
    let cancelled = false
    void (async () => {
      try {
        const all = await fetchLibrary(scope)
        if (!cancelled) setRows(all.filter((r) => r.kind === kind && r.active))
      } catch (e) {
        if (!cancelled) { setRows([]); setError(e instanceof Error ? e.message : String(e)) }
      }
    })()
    return () => { cancelled = true }
  }, [open, rows, scope, kind])

  function pick(row: LibraryTemplate) {
    const body = renderTemplate(row.body, values)
    const subject = row.subject ? renderTemplate(row.subject, values) : null
    onPick({
      template: row,
      subject: subject?.text ?? null,
      body: body.text,
      /* Both halves, de-duplicated: a field used in the subject AND the body is one problem, not
         two, and naming it twice makes the warning read as noise. */
      missing: [...new Set([...body.missing, ...(subject?.missing ?? [])])],
    })
    setOpen(false)
  }

  return (
    <div className="relative">
      <button type="button" disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg
          border border-slate-200 text-slate-600 hover:border-[#c9a052] hover:bg-gold-50
          disabled:opacity-40">
        <FileText size={13} />
        {label ?? 'Use a template'}
        <ChevronDown size={12} className="text-slate-400" />
      </button>

      {open && (
        <>
          {/* Closes on a click anywhere else, which is what a menu does. */}
          <button type="button" aria-hidden tabIndex={-1}
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 w-80 max-h-72 overflow-auto rounded-lg border
            border-slate-200 bg-white shadow-lg py-1">
            {rows === null && (
              <p className="flex items-center gap-2 px-3 py-2 text-xs text-slate-400">
                <Loader2 size={12} className="animate-spin" /> Reading the library&hellip;
              </p>
            )}
            {error && <p className="px-3 py-2 text-xs text-negative-700">{error}</p>}
            {rows !== null && rows.length === 0 && !error && (
              /* Named, rather than an empty box. "Nothing here" with no reason reads as broken. */
              <p className="px-3 py-2 text-xs text-slate-400">
                Nothing written for this yet. The library is where it goes.
              </p>
            )}
            {(rows ?? []).map((row) => (
              <button key={row.id} type="button" onClick={() => pick(row)}
                className="w-full text-left px-3 py-2 hover:bg-slate-50">
                <span className="block text-sm text-navy-950">{row.name}</span>
                {/*
                  WHAT IT SAYS, IN ONE LINE. A list of names alone means opening four of them to
                  find the one you meant; the first words are usually enough to recognise it.
                  Merged, so what is previewed is what will land in the box.
                */}
                <span className="block text-[11px] text-slate-400 truncate">
                  {renderTemplate(row.subject ?? row.body, values).text.slice(0, 80)}
                </span>
                {/* An email that posts a letter says so here, because it is the reason to pick
                    this one over the one beside it. */}
                {row.attachmentId && (
                  <span className="inline-flex items-center gap-1 mt-0.5 text-[10px] text-[var(--c-gold-deep)]">
                    <FileText size={9} /> posts a letter
                  </span>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
