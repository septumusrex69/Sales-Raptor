import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, BookOpen, Loader2, Pencil, Plus } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { useAuth } from '../../store/AuthContext'
import { canEditLibrary } from '../../lib/permissions'
import {
  createTemplate, fetchLibrary, saveTemplate, type LibraryTemplate, type TemplateDraft,
} from '../../lib/templateLibrary'
import { TemplateEditor } from './TemplateEditor'
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
  const [openId, setOpenId] = useState<string | null>(null)

  /**
   * What is being written, if anything.
   *
   * `null` is reading. A draft with no `id` is a new template; one with an id is an edit. One
   * state rather than two flags, because "adding while editing" is not a thing and two booleans
   * would let it happen.
   */
  const [editing, setEditing] = useState<{ id: string | null; draft: TemplateDraft } | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const load = useCallback(async (next: TemplateScope) => {
    setRows(null)
    setError(null)
    try { setRows(await fetchLibrary(next)) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }, [])

  useEffect(() => {
    if (!mayEdit) return
    void load(scope)
  }, [scope, mayEdit, load])

  const open = useMemo(
    () => rows?.find((r) => r.id === openId) ?? null,
    [rows, openId],
  )

  async function save() {
    if (!editing) return
    setSaving(true)
    setSaveError(null)
    try {
      const id = editing.id
        ? (await saveTemplate(editing.id, editing.draft), editing.id)
        : await createTemplate(editing.draft)
      setEditing(null)
      await load(scope)
      /* Land on what was just written, which for a new one is the only way to find it. */
      setOpenId(id)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

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
          THE SIDE COMES FIRST, above everything, because it decides what the kinds even are and
          which fields a writer may use. It is not a filter over one list; it is two libraries.
        */}
        <div className="px-5 py-3 flex flex-wrap items-center gap-3">
          <div className="flex rounded-lg border border-slate-200 p-0.5">
            {(Object.keys(TEMPLATE_SCOPES) as TemplateScope[]).map((id) => (
              <button key={id} type="button"
                onClick={() => { setScope(id); setOpenId(null); setEditing(null) }}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  scope === id ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-700'
                }`}>
                {TEMPLATE_SCOPES[id].label}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-400 flex-1 min-w-0">{TEMPLATE_SCOPES[scope].hint}</p>
          <button type="button"
            onClick={() => { setOpenId(null); setEditing({ id: null, draft: blankDraft(scope) }) }}
            className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg
              border border-gold-500 bg-gold-400 text-navy-950 hover:bg-gold-500">
            <Plus size={14} /> New template
          </button>
        </div>
      </Card>

      {error && <Card><p className="text-sm text-negative-700">{error}</p></Card>}

      {rows === null && !error && (
        <Card>
          <p className="text-[13px] text-slate-400 inline-flex items-center gap-1.5">
            <Loader2 size={13} className="animate-spin" /> Reading the library&hellip;
          </p>
        </Card>
      )}

      {rows !== null && (
        /*
          TWO COLUMNS, at the firm's own suggestion after working with a review copy laid out this
          way: the list stays put while you read, so moving between twenty pieces of wording is a
          click rather than a scroll back up. It stacks below `lg`, where a 288px column would
          leave the letter itself unreadable.
        */
        <div className="grid gap-4 lg:grid-cols-[288px_minmax(0,1fr)] items-start">
          <div className="lg:sticky lg:top-2">
            {KINDS_FOR_SCOPE[scope].map((kind) => (
              <KindGroup key={kind} kind={kind}
                rows={rows.filter((r) => r.kind === kind)}
                openId={openId} onOpen={(id) => { setOpenId(id); setEditing(null) }} />
            ))}
            {rows.length === 0 && (
              <p className="text-sm text-slate-400 px-1">
                Nothing written yet on the {TEMPLATE_SCOPES[scope].label.toLowerCase()} side.
              </p>
            )}
          </div>

          <Card padded={false}>
            {editing ? (
              <div className="p-5">
                <h3 className="text-sm font-semibold text-navy-950 mb-3">
                  {editing.id ? 'Editing' : `New ${TEMPLATE_SCOPES[scope].label.toLowerCase()} template`}
                </h3>
                <TemplateEditor scope={scope} draft={editing.draft}
                  onChange={(draft) => setEditing({ ...editing, draft })}
                  onSave={() => void save()} onCancel={() => { setEditing(null); setSaveError(null) }}
                  saving={saving} error={saveError} />
              </div>
            ) : open ? (
              <>
                <div className="px-5 py-3.5 border-b border-slate-100 flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold text-navy-950">{open.name}</h3>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-navy-50 text-navy-700">
                        {TEMPLATE_KINDS[open.kind].label}
                      </span>
                      {open.position && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gold-50 text-[var(--c-gold-deep)]">
                          {DESK_POSITIONS[open.position].label}
                        </span>
                      )}
                      {!open.active && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">
                          Retired
                        </span>
                      )}
                      {unknownFields(open.scope, open.body, open.subject).length > 0 && (
                        <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5
                          rounded-full bg-negative-50 text-negative-700">
                          <AlertTriangle size={10} />
                          {unknownFields(open.scope, open.body, open.subject).length} field
                          {unknownFields(open.scope, open.body, open.subject).length === 1 ? '' : 's'}
                          {' '}with nothing behind them
                        </span>
                      )}
                    </div>
                  </div>
                  <button type="button"
                    onClick={() => { setSaveError(null); setEditing({ id: open.id, draft: draftOf(open) }) }}
                    className="shrink-0 inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5
                      rounded-lg border border-slate-200 text-slate-600 hover:border-[#c9a052] hover:bg-gold-50">
                    <Pencil size={13} /> Edit
                  </button>
                </div>
                <Reading template={open} />
              </>
            ) : (
              <div className="py-16 text-center">
                <BookOpen size={20} className="mx-auto text-slate-300" />
                <p className="text-sm text-slate-400 mt-2.5">Pick something on the left to read it.</p>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  )
}

/** One kind of wording, as a heading over its rows in the left column. */
function KindGroup({ kind, rows, openId, onOpen }: {
  kind: TemplateKind
  rows: LibraryTemplate[]
  openId: string | null
  onOpen: (id: string) => void
}) {
  if (rows.length === 0) return null
  return (
    <div className="mb-4">
      <div className="flex items-baseline justify-between px-1 pb-1.5">
        <h3 className="text-[10px] uppercase tracking-[0.16em] text-slate-400 font-semibold">
          {TEMPLATE_KINDS[kind].plural}
        </h3>
        <span className="text-[10px] text-slate-400 tabular-nums">{rows.length}</span>
      </div>
      {rows.map((t) => (
        <ListRow key={t.id} template={t} current={openId === t.id} onOpen={() => onOpen(t.id)} />
      ))}
    </div>
  )
}

/** One row down the left. A name, what it is filed under, and whether it is sound. */
function ListRow({ template, current, onOpen }: {
  template: LibraryTemplate
  current: boolean
  onOpen: () => void
}) {
  const broken = unknownFields(template.scope, template.body, template.subject).length > 0
  return (
    <button type="button" onClick={onOpen} aria-current={current}
      className={`block w-full text-left rounded-md border px-2.5 py-2 mb-1 transition
        ${current
          ? 'border-slate-200 border-l-[3px] border-l-gold-500 bg-navy-50'
          : 'border-slate-200 bg-white hover:border-slate-300'}`}>
      <span className="flex items-center gap-1.5">
        {/* A dot rather than a word: at this width a chip pushes the name out of view, and the
            reader only needs to know there is something to look at. */}
        {broken && <span title="Asks for a field nothing can fill"
          className="w-1.5 h-1.5 rounded-full bg-negative-500 shrink-0" />}
        <span className={`text-[13px] truncate ${current ? 'text-navy-950 font-semibold' : 'text-slate-700 font-medium'}`}>
          {template.name}
        </span>
        {!template.active && <span className="text-[9px] text-slate-400 shrink-0">retired</span>}
      </span>
      <span className="block text-[10px] font-mono text-slate-400 mt-0.5 truncate">
        {template.seedKey ?? (template.position ? DESK_POSITIONS[template.position].label : 'written here')}
      </span>
    </button>
  )
}

/**
 * The message on the right, either as it is written or as it would arrive.
 *
 * TWO VIEWS OF ONE THING, and the firm asked for both by pointing at them: the fields in braces
 * are what you edit; the same words filled in are what the debtor reads. Neither answers the
 * other's question — a letter that scans beautifully with {{balance}} in it can read as nonsense
 * once the number is there, and a preview alone cannot tell you which words are the template's.
 */
function Reading({ template }: { template: LibraryTemplate }) {
  const [filled, setFilled] = useState(false)
  const unknown = unknownFields(template.scope, template.body, template.subject)
  const used = fieldsUsed(template.body, template.subject)
  const values = sampleValues()
  const sms = template.kind === 'sms'
    ? forecastSms(renderTemplate(template.body, values).text)
    : null

  const show = (text: string | null) => {
    if (!text) return null
    if (!filled) return text
    return renderTemplate(text, values).text
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 px-5 py-2.5 border-b border-slate-100">
        <div className="flex rounded-lg border border-slate-200 p-0.5">
          {([[false, 'Merge fields'], [true, 'Example data']] as const).map(([id, label]) => (
            <button key={label} type="button" onClick={() => setFilled(id)}
              aria-pressed={filled === id}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                filled === id ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-700'
              }`}>
              {label}
            </button>
          ))}
        </div>
        {sms && (
          <span className={`text-[11px] tabular-nums ${
            sms.segments > 1 ? 'text-negative-700' : 'text-slate-400'}`}>
            {sms.segments} segment{sms.segments === 1 ? '' : 's'} &middot; R{sms.cost.toFixed(2)} a send
          </span>
        )}
      </div>

      {template.subject !== null && (
        <div className="px-5 py-3 border-b border-slate-100 bg-navy-50/40">
          <span className="block text-[10px] uppercase tracking-wide text-slate-400 mb-1">Subject</span>
          <span className="text-[13px] text-navy-950 font-medium">{show(template.subject)}</span>
        </div>
      )}

      <pre className={`px-5 py-4 whitespace-pre-wrap break-words text-slate-700
        ${template.kind === 'call_script' ? 'font-mono text-[12.5px]' : 'font-sans text-[13.5px]'}
        leading-relaxed`}>{show(template.body)}</pre>

      <div className="px-5 py-3 border-t border-slate-100 bg-slate-50">
        <p className="text-[10px] uppercase tracking-wide text-slate-400 mb-1.5">Fields used</p>
        <div className="flex flex-wrap gap-1.5">
          {used.length === 0 && <span className="text-xs text-slate-400">None.</span>}
          {used.map((k) => (
            <span key={k} className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
              unknown.includes(k) ? 'bg-negative-50 text-negative-700' : 'bg-navy-50 text-navy-700'}`}>
              {`{{${k}}}`}
            </span>
          ))}
        </div>
        {unknown.length > 0 && (
          <p className="mt-2.5 text-xs text-negative-700 border-l-2 border-negative-300 pl-2.5">
            Raptor cannot fill {unknown.length === 1 ? 'that one' : 'those'} in. As it stands the
            message goes out with the braces still in it.
          </p>
        )}
      </div>
    </>
  )
}

/** A fresh template, opened empty in the side that is showing. */
function blankDraft(scope: TemplateScope): TemplateDraft {
  return {
    scope,
    kind: KINDS_FOR_SCOPE[scope][0],
    name: '',
    subject: null,
    body: '',
    position: null,
    active: true,
  }
}

const draftOf = (t: LibraryTemplate): TemplateDraft => ({
  scope: t.scope, kind: t.kind, name: t.name, subject: t.subject,
  body: t.body, position: t.position, active: t.active,
})
