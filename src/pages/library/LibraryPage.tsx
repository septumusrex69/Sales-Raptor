import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, BookOpen, Loader2, Paperclip, Pencil, Plus, X } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { Modal } from '../../components/ui/Modal'
import { useAuth } from '../../store/AuthContext'
import { canEditLibrary, canViewLibrary } from '../../lib/permissions'
import {
  createTemplate, deleteTemplate, fetchLibrary, saveTemplate, templateUsage,
  type LibraryTemplate, type TemplateDraft,
} from '../../lib/templateLibrary'
import { TemplateEditor } from './TemplateEditor'
import { LibraryHeader } from './LibraryHeader'
import {
  KINDS_FOR_SCOPE, TEMPLATE_KINDS, TEMPLATE_SCOPES, deleteRefusal, deleteWarning, fieldsUsed,
  forecastSms, renderTemplate, sampleValues, unknownFields, usageNote,
  type TemplateKind, type TemplateScope,
} from '../../lib/messageTemplates'
import { DESK_POSITIONS } from '../../lib/clientPosition'
import { A4_LETTERHEAD, parseLetter } from '../../lib/letterDocument.ts'
import { LetterPage } from '../../components/letters/LetterPage'
import { PreviewPdf } from '../../components/letters/PreviewPdf'
import { defaultOf, fetchLetterheads, type Letterhead } from '../../lib/letterheads.ts'

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
  const mayView = canViewLibrary(currentUser?.role)

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
  /**
   * The delete somebody has asked for and not yet confirmed.
   *
   * ASKED OF THE DATABASE BEFORE IT IS OFFERED, because the damage is silent: the workflow step's
   * template_id is `on delete set null`, so a delete that breaks a running workflow succeeds
   * quietly. `refusal` is why it may not happen at all; `warning` is what somebody should know
   * before it does.
   */
  const [confirming, setConfirming] = useState<
    { template: LibraryTemplate; refusal: string | null; warning: string | null } | null
  >(null)
  const [checking, setChecking] = useState(false)
  /**
   * What is already sending the open template, in one line above its words.
   *
   * THE OTHER HALF OF MOVING THE WORKFLOWS IN HERE. A person about to rewrite a sentence needs to
   * know whether a published workflow is sending it to every new account tomorrow — that changes
   * whether they edit it at all, and there was nowhere in Raptor that said so. Asked when a
   * template is OPENED rather than when delete is pressed, because by then the edit is made.
   *
   * Silent on failure. This is a nicety beside the wording itself; an error banner over a
   * template somebody is trying to read would be the tail wagging the dog.
   */
  const [usedBy, setUsedBy] = useState<string | null>(null)
  /**
   * The paper a letter is shown on.
   *
   * ONE FETCH FOR THE WHOLE LIBRARY, and null is a real answer rather than a loading state: a
   * firm that has not uploaded a letterhead writes on plain paper, and the preview should show
   * plain paper rather than wait for something that is never coming.
   */
  const [letterhead, setLetterhead] = useState<Letterhead | null>(null)
  useEffect(() => {
    let cancelled = false
    fetchLetterheads()
      .then((rows) => { if (!cancelled) setLetterhead(defaultOf(rows)) })
      .catch(() => { /* plain paper is a correct fallback, and not worth a banner */ })
    return () => { cancelled = true }
  }, [])

  const load = useCallback(async (next: TemplateScope) => {
    setRows(null)
    setError(null)
    try { setRows(await fetchLibrary(next)) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }, [])

  useEffect(() => {
    if (!mayView) return
    void load(scope)
  }, [scope, mayView, load])

  const open = useMemo(
    () => rows?.find((r) => r.id === openId) ?? null,
    [rows, openId],
  )
  /* One lookup for the whole page: a row names the letter it attaches, and so does the pane. */
  const byId = useMemo(
    () => new Map((rows ?? []).map((r) => [r.id, r])),
    [rows],
  )
  /**
   * What an email on this side may be given to carry.
   *
   * Retired letters stay in: an email already carrying one has to keep showing what it carries,
   * and dropping it from the list would silently reset the picker to "Nothing attached" on the
   * next save. Self-attachment is excluded at the call site, where the id being edited is known.
   */
  const letters = useMemo(
    () => (rows ?? []).filter((r) => r.kind === 'letter'),
    [rows],
  )

  useEffect(() => {
    setUsedBy(null)
    if (!openId) return
    let cancelled = false
    templateUsage(openId)
      .then((u) => { if (!cancelled) setUsedBy(usageNote(u)) })
      .catch(() => { /* see above: never in the way of reading the words */ })
    return () => { cancelled = true }
  }, [openId])

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

  /** Look up where it is used, then ask. Never the other way round. */
  async function askToDelete(template: LibraryTemplate) {
    setChecking(true)
    setSaveError(null)
    try {
      const usage = await templateUsage(template.id)
      setConfirming({
        template,
        refusal: deleteRefusal(usage),
        warning: deleteWarning(usage, template.seedKey),
      })
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e))
    } finally {
      setChecking(false)
    }
  }

  async function reallyDelete() {
    if (!confirming || confirming.refusal) return
    setSaving(true)
    setSaveError(null)
    try {
      await deleteTemplate(confirming.template.id)
      setConfirming(null)
      setEditing(null)
      setOpenId(null)
      await load(scope)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  /*
   * REFUSED, NOT HIDDEN — for the only person this can still happen to, which is somebody with no
   * profile loaded at all. A blank page where a menu item led is indistinguishable from a page
   * that failed to load, and the person seeing it reports a bug rather than learning the rule.
   */
  if (!mayView) {
    return (
      <Card>
        <div className="py-12 text-center">
          <BookOpen size={22} className="mx-auto text-slate-300" />
          <p className="text-sm text-slate-600 mt-3 font-medium">The library is not open to you.</p>
          <p className="text-xs text-slate-400 mt-1.5 max-w-md mx-auto">
            The scripts and templates still reach you on an account and in a campaign, filled in
            for the debtor you are working.
          </p>
        </div>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <LibraryHeader mayEdit={mayEdit} />

      <Card padded={false}>
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
          {/*
            EVERYONE READS, AN ADMINISTRATOR WRITES — the firm's rule, and the reason the whole
            page is not gated. What is hidden is the controls that change something, never the
            words themselves: a collector on a live call benefits from seeing the ladder a script
            sits on, and the risk a library carries is in writing it.

            Gone rather than disabled. A greyed-out "New template" is an invitation to keep
            clicking; the rule itself is stated once, in the header, where it is read and
            understood instead of guessed at from an absence.
          */}
          {mayEdit && (
            <button type="button"
              onClick={() => { setOpenId(null); setEditing({ id: null, draft: blankDraft(scope) }) }}
              className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg
                border border-gold-500 bg-gold-400 text-navy-950 hover:bg-gold-500">
              <Plus size={14} /> New template
            </button>
          )}
        </div>
      </Card>

      {/*
        THE CONFIRM, WHICH IS ALSO WHERE A REFUSAL LANDS.
        
        One box for both answers rather than a refusal somewhere else, because the question the
        person asked is the same either way — "can I throw this away?" — and an answer that
        appears in a different place from the question reads as something having gone wrong.
      */}
      {confirming && (
        <Modal title="Delete this template?" width={520}
          onClose={() => setConfirming(null)}>
          <p className="text-sm text-slate-700">
            <span className="font-medium">{confirming.template.name}</span>
            {' '}&mdash; {TEMPLATE_KINDS[confirming.template.kind].label.toLowerCase()} on the
            {' '}{TEMPLATE_SCOPES[confirming.template.scope].label.toLowerCase()} side.
          </p>

          {confirming.refusal ? (
            <p className="mt-3 text-sm text-negative-700 border-l-2 border-negative-300 pl-3">
              {confirming.refusal}
            </p>
          ) : (
            <>
              {confirming.warning && (
                <p className="mt-3 text-sm text-slate-600 border-l-2 border-gold-400 pl-3">
                  {confirming.warning}
                </p>
              )}
              {/*
                THE ALTERNATIVE, OFFERED EVERY TIME AND NOT ONLY WHEN DELETE IS REFUSED. Retiring
                takes it out of circulation exactly as deleting does -- the resolver only reads
                active templates -- and keeps the words for the day somebody asks what was sent.
              */}
              <p className="mt-3 text-xs text-slate-400">
                Retiring it instead takes it out of use just as completely, and keeps the wording
                for the day somebody asks what the firm used to send.
              </p>
            </>
          )}

          {saveError && <p className="mt-3 text-sm text-negative-700">{saveError}</p>}

          <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
            <button type="button" onClick={() => setConfirming(null)} disabled={saving}
              className="text-sm font-medium px-3 py-2 rounded-lg border border-slate-200
                text-slate-600 hover:bg-slate-50 disabled:opacity-40">
              {confirming.refusal ? 'Close' : 'Keep it'}
            </button>
            {!confirming.refusal && (
              <button type="button" onClick={() => void reallyDelete()} disabled={saving}
                className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2
                  rounded-lg border border-negative-600 bg-negative-600 text-white
                  hover:bg-negative-700 disabled:opacity-40">
                {saving && <Loader2 size={14} className="animate-spin" />} Delete permanently
              </button>
            )}
          </div>
        </Modal>
      )}

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
                byId={byId}
                openId={openId} onOpen={(id) => { setOpenId(id); setEditing(null) }} />
            ))}
            {rows.length === 0 && (
              <p className="text-sm text-slate-400 px-1">
                Nothing written yet on the {TEMPLATE_SCOPES[scope].label.toLowerCase()} side.
              </p>
            )}
          </div>

          <Card padded={false}>
            {/* `mayEdit &&` as well as the hidden buttons: hiding a control is not a permission,
                and this is the one place a stale state could still put a form on screen. */}
            {mayEdit && editing ? (
              <div className="p-5">
                <h3 className="text-sm font-semibold text-navy-950 mb-3">
                  {editing.id ? 'Editing' : `New ${TEMPLATE_SCOPES[scope].label.toLowerCase()} template`}
                </h3>
                <TemplateEditor scope={scope} draft={editing.draft}
                  letters={letters.filter((l) => l.id !== editing.id)}
                  onChange={(draft) => setEditing({ ...editing, draft })}
                  onSave={() => void save()} onCancel={() => { setEditing(null); setSaveError(null) }}
                  saving={saving || checking} error={saveError}
                  onDelete={editing.id && open
                    ? () => void askToDelete(open)
                    : null} />
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
                      {open.attachmentId && (
                        <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5
                          rounded-full bg-gold-50 text-[var(--c-gold-deep)]">
                          <Paperclip size={10} /> Carries a letter
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
                  {mayEdit && (
                    <button type="button"
                      onClick={() => { setSaveError(null); setEditing({ id: open.id, draft: draftOf(open) }) }}
                      className="shrink-0 inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5
                        rounded-lg border border-slate-200 text-slate-600 hover:border-[#c9a052] hover:bg-gold-50">
                      <Pencil size={13} /> Edit
                    </button>
                  )}
                </div>
                {usedBy && (
                  <p className="px-5 py-2 border-b border-slate-100 bg-navy-50/40 text-[11px] text-slate-500">
                    {usedBy}
                  </p>
                )}
                <Reading template={open} letterhead={letterhead}
                  attaches={open.attachmentId ? byId.get(open.attachmentId) ?? null : null} />
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
function KindGroup({ kind, rows, openId, onOpen, byId }: {
  kind: TemplateKind
  rows: LibraryTemplate[]
  openId: string | null
  onOpen: (id: string) => void
  /** Every template on this side, so a row can name the letter it attaches. */
  byId: Map<string, LibraryTemplate>
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
        <ListRow key={t.id} template={t} current={openId === t.id} onOpen={() => onOpen(t.id)}
          attaches={t.attachmentId ? byId.get(t.attachmentId) ?? null : null} />
      ))}
    </div>
  )
}

/** One row down the left. A name, what it is filed under, and whether it is sound. */
function ListRow({ template, current, onOpen, attaches }: {
  template: LibraryTemplate
  current: boolean
  onOpen: () => void
  /**
   * The letter this one carries, where it carries one.
   *
   * On the LIST, not only on the opened message, at the firm's instruction: "it should be clear
   * which email templates are accompanied by a letter." Which ones post something is a property
   * of the set, and answering it should not need twenty clicks.
   */
  attaches: LibraryTemplate | null
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
        {/* The clip is on a span, not on the <svg> itself: an aria-label on a bare SVG is not
            reliably announced, and the span is also what carries the hover title. */}
        {attaches && (
          <span data-attaches="yes" title={`Sends with ${attaches.name}`}
            aria-label={`Sends with ${attaches.name}`} className="shrink-0 inline-flex">
            <Paperclip size={11} className="text-slate-400" />
          </span>
        )}
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
function Reading({ template, attaches, letterhead }: {
  template: LibraryTemplate
  /** The letter it carries, already looked up. Null where it carries none. */
  attaches: LibraryTemplate | null
  /** The paper it prints on. Null prints on plain paper, which is what a firm without one has. */
  letterhead: Letterhead | null
}) {
  const [filled, setFilled] = useState(false)
  /** The letter, opened over the email. Closed again with one press — see the firm's own words. */
  const [showing, setShowing] = useState(false)
  const unknown = unknownFields(template.scope, template.body, template.subject)
  const used = fieldsUsed(template.body, template.subject)
  const values = sampleValues()
  const sms = template.kind === 'sms'
    ? forecastSms(renderTemplate(template.body, values).text)
    : null
  /* Null on anything that is not a laid-out letter, and also on one that will not parse -- which
     is shown as its raw text rather than as an empty page pretending to be the letter. */
  const doc = template.format === 'document' ? parseLetter(template.body) : null
  const attachedDoc = attaches?.format === 'document' ? parseLetter(attaches.body) : null
  const page = letterhead?.page ?? A4_LETTERHEAD

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
        {/*
          AND THE PDF ITSELF, for a letter. The pane below draws ONE continuous sheet with the
          letterhead painted once -- so on a two-page notice its footer block lands across the
          middle of the text, which is what the firm sent a screenshot of. The PDF paginates
          properly, and it is what gets posted.
        */}
        {doc && (
          <PreviewPdf doc={doc} scope={template.scope} values={values} name={template.name} />
        )}
        {sms && (
          <span className={`text-[11px] tabular-nums ${
            sms.segments > 1 ? 'text-negative-700' : 'text-slate-400'}`}>
            {sms.segments} segment{sms.segments === 1 ? '' : 's'} &middot; R{sms.cost.toFixed(2)} a send
          </span>
        )}
      </div>

      {/*
        THE ATTACHMENT, ON BOTH VIEWS.
        
        Deliberately above the subject rather than below the body: an email whose own words say
        "attached is a notice issued in terms of section 129(1)(a)" is only correct if something
        is attached, and that is the first thing to check, not the last. It survives the Merge
        fields / Example data toggle because it is a fact about the message either way.
      */}
      {attaches && (
        <div className="px-5 py-2.5 border-b border-slate-100 bg-gold-50/60">
          <span className="text-[10px] uppercase tracking-wide text-slate-400 block mb-1">
            Attached
          </span>
          <button type="button" data-attachment-open onClick={() => setShowing(true)}
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-navy-950
              hover:underline">
            <Paperclip size={13} className="text-slate-400" />
            {attaches.name}
            {!attaches.active && <span className="text-[10px] text-slate-400">(retired)</span>}
          </button>
        </div>
      )}

      {/* Read over the email rather than instead of it: the question being answered is whether
          the two go together, and losing your place in the email to answer it is a poor trade. */}
      {showing && attaches && (
        <Modal title={attaches.name}
          subtitle={`Attached to ${template.name}`}
          width={760}
          onClose={() => setShowing(false)}
          padded={false}
          headerRight={
            <button type="button" onClick={() => setShowing(false)}
              className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700">
              <X size={13} /> Close
            </button>
          }>
          {/* The attached letter is a laid-out letter too, so it opens as the page it posts as
              rather than as the JSON it is stored as. */}
          {attachedDoc !== null ? (
            <div className="px-5 py-5 bg-slate-100 flex justify-center max-h-[72vh] overflow-y-auto">
              <LetterPage doc={attachedDoc} page={page} filled={filled} values={values} scale={0.72} />
            </div>
          ) : (
            <pre className="px-5 py-4 whitespace-pre-wrap break-words font-sans text-[13px]
              leading-relaxed text-slate-700 max-h-[70vh] overflow-y-auto">{
              filled ? renderTemplate(attaches.body, values).text : attaches.body
            }</pre>
          )}
        </Modal>
      )}

      {template.subject !== null && (
        <div className="px-5 py-3 border-b border-slate-100 bg-navy-50/40">
          <span className="block text-[10px] uppercase tracking-wide text-slate-400 mb-1">Subject</span>
          <span className="text-[13px] text-navy-950 font-medium">{show(template.subject)}</span>
        </div>
      )}

      {/*
        A LETTER IS SHOWN ON THE PAGE IT PRINTS ON, at real millimetres and scaled to fit.
        
        The thing that goes wrong with a letter is never the words: it is the last paragraph
        sitting on top of the letterhead's footer block, or the address falling under the logo.
        Neither is visible in a text box, so a text box is the wrong way to read one.
      */}
      {doc !== null ? (
        <div className="px-5 py-5 bg-slate-100 flex justify-center">
          <LetterPage doc={doc} page={page} filled={filled} values={values} scale={0.62} pages={2} />
        </div>
      ) : (
        <pre className={`px-5 py-4 whitespace-pre-wrap break-words text-slate-700
          ${template.kind === 'call_script' ? 'font-mono text-[12.5px]' : 'font-sans text-[13.5px]'}
          leading-relaxed`}>{show(template.body)}</pre>
      )}

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
    attachmentId: null,
    /* A new letter starts as a document, because that is what a letter is here. Everything else
       starts as words. The kind picker moves it if the writer changes their mind. */
    format: scope === 'collections' && KINDS_FOR_SCOPE[scope][0] === 'letter' ? 'document' : 'text',
  }
}

const draftOf = (t: LibraryTemplate): TemplateDraft => ({
  scope: t.scope, kind: t.kind, name: t.name, subject: t.subject,
  body: t.body, position: t.position, active: t.active, attachmentId: t.attachmentId,
  format: t.format,
})
