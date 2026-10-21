/**
 * Reading and writing the library, which is the only part of it that touches a database.
 *
 * Kept apart from messageTemplates.ts on purpose: everything about what a template IS — the
 * fields it may use, what it costs to send, how it renders — is pure and testable without a
 * network. This file is the thin layer that fetches and saves, and it holds no rules of its own.
 */
import { supabase } from './supabase'
import type { DeskPosition } from './clientPosition.ts'
import type {
  MessageTemplate, TemplateKind, TemplateScope, TemplateUsage,
} from './messageTemplates.ts'

/** Named by hand, like every mapper here. See the warning about silent drops in CLAUDE.md. */
const COLUMNS = 'id, scope, kind, name, subject, body, position, language, active, '
  + 'attachment_id, audience, format, seed_key, updated_at'

interface Row {
  id: string
  scope: string
  kind: string
  name: string
  subject: string | null
  body: string
  position: string | null
  language: string
  active: boolean
  attachment_id: string | null
  audience: string | null
  format: string
  seed_key: string | null
  updated_at: string
}

/** A library row, plus the two things only the list cares about. */
export interface LibraryTemplate extends MessageTemplate {
  /** Set on anything a migration seeded, null on anything the firm wrote. */
  seedKey: string | null
  updatedAt: string
  /**
   * Who the wording is for: 'individual', 'company', or null where it suits either.
   *
   * THE FIRM'S COLLECTIONS LIBRARY IS WRITTEN TWICE all the way down -- "Dear" against "To the
   * directors of", an ID number against a registration number, summons against liquidation.
   * Carried here so the picker inside an account can offer the half that fits the debtor in
   * front of it; without it a collector chooses between two rows whose names differ by one word
   * in brackets, and the wrong choice tells a person they are being wound up.
   */
  audience: 'individual' | 'company' | null
}

function toTemplate(r: Row): LibraryTemplate {
  return {
    id: r.id,
    scope: r.scope as TemplateScope,
    kind: r.kind as TemplateKind,
    name: r.name,
    subject: r.subject,
    body: r.body,
    position: (r.position as DeskPosition | null) ?? null,
    language: r.language,
    active: r.active,
    audience: (r.audience as 'individual' | 'company' | null) ?? null,
    attachmentId: r.attachment_id,
    format: r.format === 'document' ? 'document' : 'text',
    seedKey: r.seed_key,
    updatedAt: r.updated_at,
  }
}

/**
 * Everything in one side's library, live and retired alike.
 *
 * RETIRED ONES COME BACK TOO. A library that hides what was turned off cannot answer "what did we
 * used to send?", which is the question asked the day a debtor produces a letter nobody recognises.
 * The list marks them; it does not drop them.
 *
 * Ordered by kind and then by name, because a person looking for wording knows what KIND they
 * want before they know what it is called.
 */
export async function fetchLibrary(scope: TemplateScope): Promise<LibraryTemplate[]> {
  const { data, error } = await supabase
    .from('message_templates')
    .select(COLUMNS)
    .eq('scope', scope)
    .order('kind')
    .order('name')
  if (error) throw new Error(error.message)
  return ((data ?? []) as unknown as Row[]).map(toTemplate)
}

/** What a save sends. Everything a person can change, and nothing they cannot. */
export interface TemplateDraft {
  scope: TemplateScope
  kind: TemplateKind
  name: string
  /** Email only. The database refuses a subject on anything else, and requires one on an email. */
  subject: string | null
  body: string
  position: DeskPosition | null
  active: boolean
  /** The letter an email attaches. Null on everything else, and the database says so. */
  attachmentId: string | null
  /**
   * Whether `body` is what it looks like, or a letterDocument JSON.
   *
   * Only a letter may be a document -- message_templates_format_kind says so -- and the save
   * forces it back to 'text' for anything else rather than trusting the form, because a kind
   * changed from letter to SMS with the format left behind is a refused save with no obvious
   * cause.
   */
  format: 'text' | 'document'
}

/**
 * Write a template back.
 *
 * NO seed_key EITHER WAY. It is the handle a migration uses to seed a draft without duplicating
 * it and without overwriting the firm's edits, so it belongs to the migration and not to the
 * person editing the words. Letting the form set it would let two rows claim to be the same seed.
 */
export async function saveTemplate(id: string, draft: TemplateDraft): Promise<void> {
  const { error } = await supabase
    .from('message_templates')
    .update({
      kind: draft.kind,
      name: draft.name.trim(),
      subject: draft.kind === 'email' ? (draft.subject ?? '').trim() : null,
      body: draft.body,
      position: draft.position,
      active: draft.active,
      /* Cleared on anything that is not an email, because the constraint refuses one there and a
         subject left behind on a change of kind is a refused save with no obvious cause. */
      attachment_id: draft.kind === 'email' ? draft.attachmentId : null,
      format: draft.kind === 'letter' ? draft.format : 'text',
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) throw new Error(friendly(error.message))
}

/** A new one. The scope comes from the library it is being written in, never from a picker. */
export async function createTemplate(draft: TemplateDraft): Promise<string> {
  const { data, error } = await supabase
    .from('message_templates')
    .insert({
      scope: draft.scope,
      kind: draft.kind,
      name: draft.name.trim(),
      subject: draft.kind === 'email' ? (draft.subject ?? '').trim() : null,
      body: draft.body,
      position: draft.position,
      language: 'en',
      active: draft.active,
      attachment_id: draft.kind === 'email' ? draft.attachmentId : null,
      format: draft.kind === 'letter' ? draft.format : 'text',
    })
    .select('id')
    .single()
  if (error) throw new Error(friendly(error.message))
  return data.id as string
}

/**
 * The database's own words, turned into the firm's.
 *
 * These constraints exist to stop a real mistake, so the message has to say which mistake. A
 * PostgREST string about a check constraint tells the person nothing they can act on.
 */
function friendly(message: string): string {
  if (message.includes('message_templates_subject_kind')) {
    return 'An email needs a subject line, and nothing else may carry one.'
  }
  if (message.includes('message_templates_position_scope')) {
    return 'A position belongs to a debtor account, so only a collections template may have one.'
  }
  if (message.includes('message_templates_kind_check')) return 'That is not a kind of message.'
  if (message.includes('message_templates_attachment_kind')) {
    return 'Only an email can carry an attachment.'
  }
  if (message.includes('message_templates_format_kind')) {
    return 'Only a letter is laid out as a document. Everything else is plain words.'
  }
  /* The trigger raises in its own words, which already name the mistake — see
     check_template_attachment. Passed through rather than replaced with something vaguer. */
  if (message.includes('can be attached') || message.includes('cannot attach')) {
    return message.replace(/^.*?ERROR:\s*/i, '')
  }
  if (message.includes('row-level security')) {
    return 'Only an administrator may change the library.'
  }
  return message
}

/**
 * Where this template is already wired in, before anybody throws it away.
 *
 * ASKED OF THE DATABASE RATHER THAN ASSUMED, because the damage is silent: the foreign key is
 * `on delete set null`, so deleting a template that a workflow step sends does not fail and does
 * not warn. The step survives saying "send an email" with nothing to send.
 *
 * One query with the version and workflow joined, so the answer can name where rather than only
 * count. A library with a dozen templates and a workflow with a dozen steps does not need paging.
 */
export async function templateUsage(id: string): Promise<TemplateUsage> {
  const { data, error } = await supabase
    .from('workflow_nodes')
    .select('id, workflow_versions!inner(state, workflows!inner(name))')
    .eq('template_id', id)
  if (error) throw new Error(friendly(error.message))

  const rows = (data ?? []) as unknown as {
    workflow_versions: { state: string; workflows: { name: string } }
  }[]
  /*
   * EMAILS THAT ATTACH THIS LETTER. Asked in the same breath as the workflow steps, because it is
   * the same silent shape: `on delete set null` leaves the covering email intact and attaching
   * nothing, still saying "attached is a notice issued in terms of section 129(1)(a)".
   */
  const { data: attachers, error: attachError } = await supabase
    .from('message_templates')
    .select('name')
    .eq('attachment_id', id)
  if (attachError) throw new Error(friendly(attachError.message))

  const names = new Set<string>()
  let frozenSteps = 0
  for (const r of rows) {
    /* active = running against live accounts; archived = accounts already ran on it. Both are
       frozen, and both are a reason to retire rather than delete. See deleteRefusal. */
    if (r.workflow_versions.state === 'active' || r.workflow_versions.state === 'archived') {
      frozenSteps += 1
    }
    if (r.workflow_versions.workflows?.name) names.add(r.workflow_versions.workflows.name)
  }
  return {
    steps: rows.length,
    frozenSteps,
    workflows: [...names],
    attachedTo: ((attachers ?? []) as { name: string }[]).map((a) => a.name),
  }
}

/**
 * Throw one away for good.
 *
 * The caller checks deleteRefusal first — this does not, because the rule is worth stating in a
 * pure function the check scripts can reach, and restating it here would be two copies of it.
 * The database's own last word is the delete policy, which is Administrator only.
 */
export async function deleteTemplate(id: string): Promise<void> {
  const { error } = await supabase.from('message_templates').delete().eq('id', id)
  if (error) throw new Error(friendly(error.message))
}
