/**
 * Reading and writing the library, which is the only part of it that touches a database.
 *
 * Kept apart from messageTemplates.ts on purpose: everything about what a template IS — the
 * fields it may use, what it costs to send, how it renders — is pure and testable without a
 * network. This file is the thin layer that fetches and saves, and it holds no rules of its own.
 */
import { supabase } from './supabase'
import type { DeskPosition } from './clientPosition.ts'
import type { MessageTemplate, TemplateKind, TemplateScope } from './messageTemplates.ts'

/** Named by hand, like every mapper here. See the warning about silent drops in CLAUDE.md. */
const COLUMNS = 'id, scope, kind, name, subject, body, position, language, active, seed_key, updated_at'

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
  seed_key: string | null
  updated_at: string
}

/** A library row, plus the two things only the list cares about. */
export interface LibraryTemplate extends MessageTemplate {
  /** Set on anything a migration seeded, null on anything the firm wrote. */
  seedKey: string | null
  updatedAt: string
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
  if (message.includes('row-level security')) {
    return 'Only an administrator may change the library.'
  }
  return message
}
