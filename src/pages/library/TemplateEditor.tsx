import { useRef, useState } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import {
  DESK_POSITIONS, type DeskPosition,
} from '../../lib/clientPosition'
import {
  KINDS_FOR_SCOPE, TEMPLATE_KINDS, fieldsUsed, forecastSms, groupedFields, renderTemplate,
  sampleValues, templateProblems, unknownFields,
  type TemplateKind, type TemplateScope,
} from '../../lib/messageTemplates'
import type { TemplateDraft } from '../../lib/templateLibrary'
import { inputClass } from '../../components/ui/Modal'
import { LetterPageEditor } from './LetterPageEditor'
import { PreviewPdf } from '../../components/letters/PreviewPdf'
import {
  blankLetter, parseLetter, serialiseLetter, letterProblems, canUseLetter, lettersText,
} from '../../lib/letterDocument.ts'

/**
 * Writing one piece of the firm's wording.
 *
 * THE MERGE FIELDS ARE A LIST YOU PRESS, not a list you copy from. The firm: "you should be able
 * to add, for example, a merge field... you can type the merge field or you can add the merge
 * field." Both, deliberately — somebody who knows the name types it, and somebody who does not
 * presses it. Typing one that does not exist is caught on the way in rather than on the way out
 * to four hundred debtors, which is what the closed list is for.
 *
 * INSERTED AT THE CURSOR, never appended. A field appended to the end of a letter is a field
 * somebody then has to cut and paste into the sentence it belongs in, and the reason to offer the
 * button at all was to save exactly that.
 */
export function TemplateEditor({
  scope, draft, onChange, onSave, onCancel, saving, error, onDelete, letters,
}: {
  scope: TemplateScope
  draft: TemplateDraft
  /**
   * The letters on this side, offered as the thing an email can carry.
   *
   * Only letters, and only this side's: the database enforces both (check_template_attachment
   * refuses a non-letter, a cross-scope attachment and an email attached to itself), and a
   * dropdown that offers what the save will refuse is a dropdown that teaches people the app is
   * broken. Retired ones stay on the list — an email already carrying one must still be able to
   * show what it carries.
   */
  letters: { id: string; name: string; active: boolean }[]
  onChange: (next: TemplateDraft) => void
  onSave: () => void
  onCancel: () => void
  saving: boolean
  error: string | null
  /**
   * Null on a template that does not exist yet.
   *
   * There is nothing to delete before the first save, and offering the button anyway would be a
   * button whose only possible meaning is Cancel — which is already beside it.
   */
  onDelete: (() => void) | null
}) {
  const body = useRef<HTMLTextAreaElement>(null)
  const subject = useRef<HTMLInputElement>(null)
  /*
   * THE SAME BUTTONS, INTO A DIFFERENT KIND OF BOX. A laid-out letter has no textarea to put a
   * caret in, so the page editor lends this one a "drop it here" and the field buttons below reach
   * through it. Before this they pressed and nothing happened, on the one kind of template with
   * the most fields in it.
   */
  const letterInsert = useRef<((text: string) => void) | null>(null)
  /** Which box the cursor was last in, so a field lands where the writer was working. */
  const [last, setLast] = useState<'body' | 'subject'>('body')

  /*
   * READ ONCE PER KEYSTROKE ON THE BODY, and null where it will not parse. Null is not an empty
   * document: a letter that cannot be read back must show the raw text and refuse to edit, or
   * somebody opens a broken template in an empty editor and saves over the top of it.
   */
  const letterDoc = draft.kind === 'letter' && draft.format === 'document'
    ? parseLetter(draft.body)
    : null
  const letterProblems_ = letterDoc ? letterProblems(letterDoc, scope) : []
  const problems = templateProblems(draft)
  /* Empty for a laid-out letter: letterProblems reads the document properly, header and body
     apart, and this one would read its JSON as prose. See templateProblems. */
  const unknown = draft.format === 'document'
    ? []
    : unknownFields(scope, draft.body, draft.subject)
  const sms = draft.kind === 'sms'
    ? forecastSms(renderTemplate(draft.body, sampleValues()).text)
    : null

  function insert(key: string) {
    const token = `{{${key}}}`
    if (letterInsert.current) { letterInsert.current(token); return }
    const el = last === 'subject' && draft.kind === 'email' ? subject.current : body.current
    if (!el) return
    const at = el.selectionStart ?? el.value.length
    const to = el.selectionEnd ?? at
    const next = el.value.slice(0, at) + token + el.value.slice(to)
    onChange(last === 'subject' && draft.kind === 'email'
      ? { ...draft, subject: next }
      : { ...draft, body: next })
    /* Focus and caret restored after React has written the new value, or the cursor jumps to the
       end and the next field lands somewhere the writer was not looking. */
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(at + token.length, at + token.length)
    })
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="block text-[11px] uppercase tracking-wide text-slate-400 mb-1">Name</span>
          <input className={inputClass} value={draft.name}
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
            placeholder="What the firm calls it on a list" />
        </label>
        <label className="block">
          <span className="block text-[11px] uppercase tracking-wide text-slate-400 mb-1">Kind</span>
          <select className={inputClass} value={draft.kind}
            onChange={(e) => {
              const kind = e.target.value as TemplateKind
              /* A subject belongs to email and to nothing else, and so does an attachment — the
                 database says both (message_templates_attachment_kind). Either one left behind on
                 a change of kind is a refused save with no obvious cause. */
              /* A letter that has never been laid out starts as a blank document rather than
                 as the old plain text: the text is kept where it is if somebody switches back,
                 and message_templates_format_kind refuses a document on anything else. */
              const becomingLetter = kind === 'letter' && draft.format !== 'document'
              const laidOut = draft.format === 'document' ? parseLetter(draft.body) : null
              onChange({
                ...draft, kind,
                subject: kind === 'email' ? (draft.subject ?? '') : null,
                attachmentId: kind === 'email' ? draft.attachmentId : null,
                format: kind === 'letter' ? 'document' : 'text',
                body: becomingLetter && parseLetter(draft.body) === null
                  ? serialiseLetter(blankLetter())
                  /* AND THE OTHER WAY: a laid-out letter turned into an SMS keeps its words and
                     loses its layout, rather than leaving a JSON blob in the body to be charged
                     by the segment for its own punctuation. Nobody's writing is thrown away. */
                  : kind !== 'letter' && laidOut !== null
                    ? lettersText(laidOut)
                    : draft.body,
              })
            }}>
            {KINDS_FOR_SCOPE[scope].map((k) => (
              <option key={k} value={k}>{TEMPLATE_KINDS[k].label}</option>
            ))}
          </select>
        </label>
      </div>

      {/* Collections only: the 13 rungs describe a debtor account, and the database refuses one
          on a sales template. Absent rather than disabled on the sales side. */}
      {scope === 'collections' && (
        <label className="block">
          <span className="block text-[11px] uppercase tracking-wide text-slate-400 mb-1">
            Written for
          </span>
          <select className={inputClass} value={draft.position ?? ''}
            onChange={(e) => onChange({
              ...draft, position: (e.target.value || null) as DeskPosition | null,
            })}>
            {/* The general version, and the reason a library is usable before all 42 exist. */}
            <option value="">Any account</option>
            {(Object.keys(DESK_POSITIONS) as DeskPosition[]).map((p) => (
              <option key={p} value={p}>{DESK_POSITIONS[p].label}</option>
            ))}
          </select>
        </label>
      )}

      {draft.kind === 'email' && (
        <label className="block">
          <span className="block text-[11px] uppercase tracking-wide text-slate-400 mb-1">Subject</span>
          <input ref={subject} className={inputClass} value={draft.subject ?? ''}
            onFocus={() => setLast('subject')}
            onChange={(e) => onChange({ ...draft, subject: e.target.value })} />
        </label>
      )}

      {/*
        WHAT IT POSTS WITH.

        On the email and not on the letter, because that is the direction the firm works in: you
        write the covering email for a notice, not a notice for an email. The Section 129 pair is
        the reason this exists at all — the email's own words say a notice is attached, and until
        now nothing in Raptor recorded which notice that was.
      */}
      {draft.kind === 'email' && letters.length > 0 && (
        <label className="block">
          <span className="block text-[11px] uppercase tracking-wide text-slate-400 mb-1">
            Sends with
          </span>
          <select className={inputClass} value={draft.attachmentId ?? ''}
            onChange={(e) => onChange({ ...draft, attachmentId: e.target.value || null })}>
            <option value="">Nothing attached</option>
            {letters.map((l) => (
              <option key={l.id} value={l.id}>{l.active ? l.name : `${l.name} (retired)`}</option>
            ))}
          </select>
        </label>
      )}

      {/*
        A LETTER IS LAID OUT; EVERYTHING ELSE IS TYPED.
        
        The same body column holds both, and `format` says which -- so the box you get is decided
        by what the thing IS rather than by a switch somebody has to remember to flick. An SMS
        will never be laid out, and a section 129 cannot be written in a textarea: it has four
        numbered sections, three tables and a running header.
      */}
      {draft.kind === 'letter' && draft.format === 'document' ? (
        <div>
          <span className="flex items-baseline justify-between mb-1">
            <span className="text-[11px] uppercase tracking-wide text-slate-400">The letter</span>
            {/*
              THE PDF, FROM THE DRAFT IN FRONT OF YOU. At the firm's request: "an option to
              preview what the PDF would look like... once you've done everything, just a
              preview." It reads the LIVE document rather than the saved row, so it answers the
              question somebody actually has, which is about the edit they have just made.
            */}
            {letterDoc !== null && (
              <PreviewPdf doc={letterDoc} scope={scope} values={sampleValues()}
                name={draft.name || 'Letter'} />
            )}
            {letterDoc === null && (
              <span className="text-[11px] text-negative-700">
                This letter could not be read back. Nothing has been changed.
              </span>
            )}
          </span>
          {letterDoc !== null && (
            <LetterPageEditor doc={letterDoc} readOnly={false} insertRef={letterInsert}
              onChange={(next) => onChange({ ...draft, body: serialiseLetter(next) })} />
          )}
          {/*
            REFUSALS FROM THE DOCUMENT ITSELF, which templateProblems cannot see -- a ragged
            table renders as a page that looks fine and is missing a cell.
          */}
          {letterProblems_.map((p) => (
            <p key={p.message} className={`mt-2 text-xs ${
              p.level === 'refuse' ? 'text-negative-700' : 'text-slate-500'}`}>{p.message}</p>
          ))}
        </div>
      ) : (
      <label className="block">
        <span className="flex items-baseline justify-between mb-1">
          <span className="text-[11px] uppercase tracking-wide text-slate-400">The words</span>
          {/* What it will cost, live, on the awkward sample. Annexure B item 1(c) is per SEGMENT:
              a template that fits 160 against a short name and spills at 161 against a long one
              charges the second debtor double for the same words. */}
          {sms && (
            <span className={`text-[11px] tabular-nums ${
              sms.segments > 1 ? 'text-negative-700' : 'text-slate-400'}`}>
              {sms.segments} segment{sms.segments === 1 ? '' : 's'} &middot; R{sms.cost.toFixed(2)} a send
            </span>
          )}
        </span>
        <textarea ref={body} rows={draft.kind === 'sms' ? 4 : 14}
          className={`${inputClass} font-mono text-[13px] leading-relaxed`}
          value={draft.body}
          onFocus={() => setLast('body')}
          onChange={(e) => onChange({ ...draft, body: e.target.value })} />
      </label>
      )}

      {/* ---------- the fields ---------- */}

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <p className="text-[11px] uppercase tracking-wide text-slate-400 mb-2">
          Fields you may use &mdash; press one to drop it in
        </p>
        {/*
          GROUPED, AT THE FIRM'S REQUEST: "now it's like all over the place ... debtor details,
          collector details, liaison details, firm details." Forty chips in one row, in the order
          the fields happened to be written, put the trust account between a debtor's ID number
          and today's date -- so finding the bank details meant reading the whole row.

          The group titles come from FIELD_GROUPS rather than from anything on this screen, so the
          order here is the order in that table and the two cannot drift.
        */}
        <div className="space-y-2.5">
          {groupedFields(scope).map((g) => (
            <div key={g.title}>
              <p className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">{g.title}</p>
              <div className="flex flex-wrap gap-1.5">
                {g.fields.map((f) => (
                  <button key={f.key} type="button" onClick={() => insert(f.key)}
                    title={`${f.label} — e.g. ${f.sample}`}
                    className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-1 rounded
                      border border-slate-200 bg-white text-navy-700 hover:border-[#c9a052] hover:bg-gold-50">
                    <Plus size={10} className="text-slate-400" />
                    {`{{${f.key}}}`}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        {/*
          AND THE ONES THAT ARE NOT FIELDS. Typed by hand, or borrowed from the other library.
          renderTemplate leaves an unresolved placeholder STANDING rather than printing a gap, so
          this is the difference between catching it here and posting braces to a debtor.
        */}
        {unknown.length > 0 && (
          <p className="mt-2.5 text-xs text-negative-700">
            {unknown.map((k) => `{{${k}}}`).join(', ')} {unknown.length === 1 ? 'is' : 'are'} not
            {' '}a field on this side. As it stands {unknown.length === 1 ? 'it' : 'they'} would go
            out with the braces still in.
          </p>
        )}
      </div>

      {error && <p className="text-sm text-negative-700">{error}</p>}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button type="button" onClick={onSave}
          disabled={saving || problems.length > 0 || !canUseLetter(letterProblems_)}
          title={problems[0]?.message ?? letterProblems_.find((p) => p.level === 'refuse')?.message}
          className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg
            border border-gold-500 bg-gold-400 text-navy-950 hover:bg-gold-500
            disabled:opacity-40 disabled:hover:bg-gold-400">
          {saving && <Loader2 size={14} className="animate-spin" />} Save
        </button>
        <button type="button" onClick={onCancel} disabled={saving}
          className="text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 text-slate-600
            hover:bg-slate-50 disabled:opacity-40">
          Cancel
        </button>
        {onDelete && (
          /*
            LAST, AND APART. The one action here that cannot be undone sits at the far end of the
            row from Save, so a hurried hand does not find it on the way.
          */
          <button type="button" onClick={onDelete} disabled={saving}
            className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2
              rounded-lg border border-negative-200 text-negative-700 hover:bg-negative-50
              disabled:opacity-40">
            <Trash2 size={13} /> Delete
          </button>
        )}
        <label className={`${onDelete ? '' : 'ml-auto'} inline-flex items-center gap-2 text-xs text-slate-500`}>
          <input type="checkbox" checked={draft.active}
            onChange={(e) => onChange({ ...draft, active: e.target.checked })} />
          {/* Retired rather than deleted: "what did we used to send?" is the question asked the
              day a debtor produces a letter nobody recognises. */}
          In use
        </label>
      </div>

      {/* The first thing standing between this and a save, said before the button is pressed. */}
      {problems.length > 0 && (
        <p className="text-xs text-slate-500">{problems[0].message}</p>
      )}
      {fieldsUsed(draft.body, draft.subject).length === 0 && draft.kind !== 'call_script' && (
        <p className="text-xs text-slate-400">
          This one names nobody and quotes no reference. That is allowed, and it is worth checking
          it was meant.
        </p>
      )}
    </div>
  )
}
