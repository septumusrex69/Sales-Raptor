import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from '../../src/lib/fetchAll.js'
import { normaliseEmail } from '../../src/lib/marketing.js'
import {
  MAX_PROSPECT_ROWS, planProspectImport, prospectLeadRow, type KnownAddresses, type ProspectPlan, type ProspectRow,
} from '../../src/lib/prospectImport.js'

/**
 * IMPORTED PROSPECT LISTS ON THE SERVER (S10, 22 Oct): the preview and the write, ONE plan.
 *
 * The browser reads the spreadsheet and sends its rows; nothing it counted is trusted. The server
 * reads every lead, company and contact address and plans the list against them -- the preview the
 * marketer approves and the write a moment later are the same function over the same tables, so a
 * lead somebody typed in between is caught by the write as "already a lead", not doubled.
 *
 * THE FILE IS NEVER STORED. Its name, who uploaded it and when, and the counts, are kept on
 * marketing_lists; its rows become leads and nothing else.
 */

/** Rows from the browser, read defensively: it is a request body, not a type. */
export function rowsFrom(raw: unknown): ProspectRow[] | { error: string } {
  if (!Array.isArray(raw)) return { error: 'No rows were sent.' }
  if (raw.length > MAX_PROSPECT_ROWS) return { error: `One upload takes at most ${MAX_PROSPECT_ROWS} rows.` }
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')
  return raw.map((r, i) => {
    const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>
    return {
      firstName: str(o.firstName, 200), lastName: str(o.lastName, 200), email: str(o.email, 320),
      company: str(o.company, 300), phone: str(o.phone, 60), note: str(o.note, 3000),
      line: Number.isFinite(Number(o.line)) ? Number(o.line) : i + 2,
    }
  })
}

/** Every address Raptor already knows, split into the two that keep a row out. */
export async function knownAddresses(admin: SupabaseClient): Promise<KnownAddresses> {
  const [leads, companies, contacts] = await Promise.all([
    fetchAllRows<{ email: string | null }>(() => admin.from('leads').select('email').not('email', 'is', null).order('id'), { table: 'leads' }),
    fetchAllRows<{ email: string | null }>(() => admin.from('companies').select('email').not('email', 'is', null).order('id'), { table: 'companies' }),
    fetchAllRows<{ email: string | null; company_id: string | null }>(() => admin.from('contacts')
      .select('email, company_id').not('email', 'is', null).order('id'), { table: 'contacts' }),
  ])
  const leadEmails = new Set(leads.map((l) => normaliseEmail(l.email)).filter(Boolean))
  const clientEmails = new Set(companies.map((c) => normaliseEmail(c.email)).filter(Boolean))
  for (const c of contacts) {
    const e = normaliseEmail(c.email)
    if (!e) continue
    /* A contact on a company is a client's person; a contact captured against a lead is a lead's. */
    if (c.company_id) clientEmails.add(e)
    else leadEmails.add(e)
  }
  return { leadEmails, clientEmails }
}

export interface ImportPreview {
  counts: ProspectPlan['counts']
  examples: ProspectPlan['examples']
  /** The first few new people, as they will be written. */
  sample: { email: string; name: string; company: string }[]
}

export function previewOf(plan: ProspectPlan): ImportPreview {
  return {
    counts: plan.counts,
    examples: plan.examples,
    sample: plan.fresh.slice(0, 10).map((r) => ({ email: r.email, name: `${r.firstName} ${r.lastName}`.trim(), company: r.company })),
  }
}

/**
 * THE LIST AND ITS LEADS, OR NEITHER. The list row first (the leads point at it), then the leads in
 * chunks; if a chunk is refused, what was written is taken out again and the list with it, so a
 * failed upload never leaves half a list that a second attempt would then count as "already a lead".
 */
export async function writeImport(
  admin: SupabaseClient,
  rows: ProspectRow[],
  meta: { name: string; fileName: string | null; callerId: string },
): Promise<{ listId: string; written: number; preview: ImportPreview } | { error: string; status: number }> {
  const name = meta.name.trim().slice(0, 200)
  if (!name) return { error: 'Give the list a name, so campaigns can find it.', status: 400 }
  const plan = planProspectImport(rows, await knownAddresses(admin))
  const preview = previewOf(plan)
  if (!plan.fresh.length) return { error: 'Nobody on this list is new to Raptor, so nothing was imported.', status: 400 }

  const { data: list, error: listError } = await admin.from('marketing_lists')
    .insert({ name, file_name: meta.fileName?.slice(0, 300) || null, uploaded_by: meta.callerId, counts: plan.counts })
    .select('id').single()
  if (listError || !list) return { error: `The list could not be saved: ${listError?.message ?? 'no answer'}`, status: 500 }
  const listId = (list as { id: string }).id

  const leadRows = plan.fresh.map((r) => prospectLeadRow(r, { ownerId: meta.callerId, listId, listName: name, fileName: meta.fileName }))
  let written = 0
  for (let i = 0; i < leadRows.length; i += 500) {
    const { error } = await admin.from('leads').insert(leadRows.slice(i, i + 500))
    if (error) {
      await admin.from('leads').delete().eq('marketing_list_id', listId)
      await admin.from('marketing_lists').delete().eq('id', listId)
      return { error: `The leads could not be saved, so nothing was imported: ${error.message}`, status: 500 }
    }
    written += Math.min(500, leadRows.length - i)
  }
  await admin.from('marketing_lists').update({ lead_count: written }).eq('id', listId)
  return { listId, written, preview }
}
