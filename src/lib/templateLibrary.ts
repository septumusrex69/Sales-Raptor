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
