import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, BookOpen, Loader2 } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { useAuth } from '../../store/AuthContext'
import { canEditLibrary } from '../../lib/permissions'
import { fetchLibrary, type LibraryTemplate } from '../../lib/templateLibrary'
import {
  KINDS_FOR_SCOPE, TEMPLATE_KINDS, TEMPLATE_SCOPES, fieldsUsed, forecastSms, renderTemplate,
  sampleValues, unknownFields, type TemplateKind, type TemplateScope,
} from '../../lib/messageTemplates'
import { DESK_POSITIONS } from '../../lib/clientPosition'

/**
 * Everything the firm says, in one place, kept apart from the machinery that says it.
 *
 * WHY IT EXISTS. Until now the wording lived where it was sent — in the SMS box, in the mail
 * composer, in queryLetters.ts — and there was no screen for message_templates at all. That is
 * survivable while a collector writes one message to one debtor. It stops being survivable the
 * moment a workflow or a campaign sends the same words to four hundred people, because then the
 * words are the firm's position in writing, four hundred times over.
 *
 * TWO LIBRARIES, NOT FOUR. The firm's own reasoning on deals: "a client can make a deal or a lead
 * can make a deal" — so a deal is a stage of one relationship, not a party of its own. Clients are
 * absent because what they need is a bulk newsletter, which is a campaign and not reusable
 * wording. See TemplateScope.
 *
 * ADMINISTRATORS ONLY: "collectors can't see the library because collectors don't build it...
 * team leaders neither." A collector still meets these words on an account and in a campaign
 * runner, resolved against the debtor in front of them — what is closed is where they are WRITTEN.
 */
export function LibraryPage() {
  const { currentUser } = useAuth()
  const mayEdit = canEditLibrary(currentUser?.role)

  const [scope, setScope] = useState<TemplateScope>('collections')
  const [rows, setRows] = useState<LibraryTemplate[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    if (!mayEdit) return
    let cancelled = false
    setRows(null)
    setError(null)
    fetchLibrary(scope)
      .then((list) => { if (!cancelled) setRows(list) })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
    return () => { cancelled = true }
  }, [scope, mayEdit])

  /*
   * REFUSED, NOT HIDDEN. A blank page where a menu item led is indistinguishable from a page that
   * failed to load, and the person seeing it reports a bug rather than learning the rule.
   */
  if (!mayEdit) {
    return (
      <Card>
        <div className="py-12 text-center">
          <BookOpen size={22} className="mx-auto text-slate-300" />
          <p className="text-sm text-slate-600 mt-3 font-medium">The library is not open to you.</p>
          <p className="text-xs text-slate-400 mt-1.5 max-w-md mx-auto">
            Only an administrator writes the firm&rsquo;s wording. The scripts and templates
            themselves still reach you on an account and in a campaign, filled in for the debtor
            you are working.
          </p>
        </div>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card padded={false}>
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="text-lg font-semibold text-navy-950">Library</h2>
          <p className="text-sm text-slate-500 mt-0.5 max-w-3xl">
            Every message the firm sends, written once and used everywhere &mdash; by a collector on
            an account, by a workflow on a day, and by a campaign across a list.
          </p>
        </div>

        {/*
          THE SIDE COMES FIRST, above the kinds, because it decides what the kinds even are and
          which fields a writer may use. It is not a filter over one list; it is two libraries.
        */}
        <div className="px-5 py-3 flex flex-wrap items-center gap-3">
          <div className="flex rounded-lg border border-slate-200 p-0.5">
            {(Object.keys(TEMPLATE_SCOPES) as TemplateScope[]).map((id) => (
              <button key={id} type="button" onClick={() => { setScope(id); setOpen(null) }}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  scope === id ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-700'
                }`}>
                {TEMPLATE_SCOPES[id].label}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-400">{TEMPLATE_SCOPES[scope].hint}</p>
        </div>
      </Card>

      {error && (
        <Card><p className="text-sm text-negative-700">{error}</p></Card>
      )}

      {rows === null && !error && (
        <Card>
          <p className="text-[13px] text-slate-400 inline-flex items-center gap-1.5">
            <Loader2 size={13} className="animate-spin" /> Reading the library&hellip;
          </p>
        </Card>
      )}

      {rows !== null && KINDS_FOR_SCOPE[scope].map((kind) => (
        <KindSection key={kind} kind={kind} scope={scope}
          rows={rows.filter((r) => r.kind === kind)}
          open={open} onOpen={setOpen} />
      ))}
    </div>
  )
}

/** One kind of wording, within one side. */
function KindSection({ kind, scope, rows, open, onOpen }: {
  kind: TemplateKind
  scope: TemplateScope
  rows: LibraryTemplate[]
  open: string | null
  onOpen: (id: string | null) => void
}) {
  return (
    <Card padded={false}>
      <div className="px-5 py-3 border-b border-slate-100 flex items-baseline justify-between gap-3">
        <h3 className="text-[11px] uppercase tracking-wide text-slate-400">
          {TEMPLATE_KINDS[kind].plural}
        </h3>
        <span className="text-xs text-slate-400 tabular-nums">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        /* Said plainly. A heading with nothing under it and no explanation reads as a list that
           failed to load rather than one nobody has written yet. */
        <p className="px-5 py-6 text-sm text-slate-400">
          Nothing written yet on the {TEMPLATE_SCOPES[scope].label.toLowerCase()} side.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map((t) => (
            <TemplateRow key={t.id} template={t}
              expanded={open === t.id} onToggle={() => onOpen(open === t.id ? null : t.id)} />
          ))}
        </ul>
      )}
    </Card>
  )
}

function TemplateRow({ template, expanded, onToggle }: {
  template: LibraryTemplate
  expanded: boolean
  onToggle: () => void
}) {
  /*
   * WHAT THIS TEMPLATE ASKS FOR THAT NOBODY CAN ANSWER.
   *
   * The single most useful thing this page says. renderTemplate deliberately leaves an unresolved
   * placeholder STANDING rather than printing a gap — so a template referring to a field that does
   * not exist does not fail, it posts "{{bank_account_number}}" to a debtor. On a statutory notice
   * that is the firm's letterhead over a rendering fault.
   */
  const unknown = useMemo(
    () => unknownFields(template.scope, template.body, template.subject),
    [template],
  )
  const used = useMemo(() => fieldsUsed(template.body, template.subject), [template])

  /* What it will cost, on the sample data — the awkward sample, not a tidy one. See MERGE_FIELDS. */
  const sms = template.kind === 'sms'
    ? forecastSms(renderTemplate(template.body, sampleValues()).text)
    : null

  return (
    <li>
      <button onClick={onToggle} aria-expanded={expanded}
        className="w-full text-left px-5 py-3 hover:bg-slate-50 flex items-start gap-3">
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-2">
            <span className="text-sm font-medium text-slate-800">{template.name}</span>
            {!template.active && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">
                Retired
              </span>
            )}
            {template.position && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-navy-50 text-navy-700">
                {DESK_POSITIONS[template.position].label}
              </span>
            )}
            {unknown.length > 0 && (
              <span title={`Cannot be filled in: ${unknown.join(', ')}`}
                className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-negative-50 text-negative-700">
                <AlertTriangle size={10} />
                {unknown.length} field{unknown.length === 1 ? '' : 's'} with nothing behind them
              </span>
            )}
          </span>
          {template.subject && (
            <span className="block text-xs text-slate-400 mt-0.5 truncate">{template.subject}</span>
          )}
        </span>
        {sms && (
          <span className={`shrink-0 text-[11px] tabular-nums pt-0.5 ${
            sms.segments > 1 ? 'text-negative-700' : 'text-slate-400'}`}>
            {sms.segments} segment{sms.segments === 1 ? '' : 's'}
          </span>
        )}
      </button>

      {expanded && (
        <div className="px-5 pb-4">
          {/* The words as written, with the fields still in braces. What it looks like FILLED IN
              belongs beside an account, where the values are real. */}
          <pre className="text-[13px] text-slate-700 whitespace-pre-wrap break-words font-sans
            bg-slate-50 rounded-lg p-3 border border-slate-100">{template.body}</pre>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {used.map((k) => (
              <span key={k} className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                unknown.includes(k)
                  ? 'bg-negative-50 text-negative-700'
                  : 'bg-navy-50 text-navy-700'}`}>
                {`{{${k}}}`}
              </span>
            ))}
          </div>
          {unknown.length > 0 && (
            <p className="mt-2.5 text-xs text-negative-700 border-l-2 border-negative-300 pl-2.5">
              Raptor cannot fill {unknown.length === 1 ? 'this one' : 'these'} in. As it stands the
              message goes out with the braces still in it.
            </p>
          )}
        </div>
      )}
    </li>
  )
}
