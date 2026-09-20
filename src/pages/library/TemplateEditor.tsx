import { useRef, useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import {
  DESK_POSITIONS, type DeskPosition,
} from '../../lib/clientPosition'
import {
  KINDS_FOR_SCOPE, MERGE_FIELDS, TEMPLATE_KINDS, fieldsUsed, forecastSms, renderTemplate,
  sampleValues, templateProblems, unknownFields,
  type TemplateKind, type TemplateScope,
} from '../../lib/messageTemplates'
import type { TemplateDraft } from '../../lib/templateLibrary'
import { inputClass } from '../../components/ui/Modal'

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
export function TemplateEditor({ scope, draft, onChange, onSave, onCancel, saving, error }: {
  scope: TemplateScope
  draft: TemplateDraft
  onChange: (next: TemplateDraft) => void
  onSave: () => void
  onCancel: () => void
  saving: boolean
  error: string | null
}) {
  const body = useRef<HTMLTextAreaElement>(null)
  const subject = useRef<HTMLInputElement>(null)
  /** Which box the cursor was last in, so a field lands where the writer was working. */
  const [last, setLast] = useState<'body' | 'subject'>('body')

  const problems = templateProblems(draft)
  const unknown = unknownFields(scope, draft.body, draft.subject)
  const sms = draft.kind === 'sms'
    ? forecastSms(renderTemplate(draft.body, sampleValues()).text)
    : null

  function insert(key: string) {
    const token = `{{${key}}}`
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
              /* A subject belongs to email and to nothing else — the database says so too, and a
                 subject left behind on a change of kind is a refused save with no obvious cause. */
              onChange({ ...draft, kind, subject: kind === 'email' ? (draft.subject ?? '') : null })
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

      {/* ---------- the fields ---------- */}

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <p className="text-[11px] uppercase tracking-wide text-slate-400 mb-2">
          Fields you may use &mdash; press one to drop it in
        </p>
        <div className="flex flex-wrap gap-1.5">
          {MERGE_FIELDS[scope].map((f) => (
            <button key={f.key} type="button" onClick={() => insert(f.key)}
              title={`${f.label} — e.g. ${f.sample}`}
              className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-1 rounded
                border border-slate-200 bg-white text-navy-700 hover:border-[#c9a052] hover:bg-gold-50">
              <Plus size={10} className="text-slate-400" />
              {`{{${f.key}}}`}
            </button>
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
        <button type="button" onClick={onSave} disabled={saving || problems.length > 0}
          title={problems[0]?.message}
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
        <label className="ml-auto inline-flex items-center gap-2 text-xs text-slate-500">
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
