/**
 * Updating debtor details on accounts that are already in the book.
 *
 * The full import is destructive: it clears the ledgers and rebuilds them from all five exports,
 * because a balance assembled from a mix of old and new rows is not a balance. Debtor details are
 * the opposite — a phone number does not participate in any sum — so they can be applied on their
 * own, to a book that is already loaded, as often as you like.
 *
 * Re-running is safe because the import OWNS its rows and nothing else's. Every contact, promise
 * and note it writes carries source = 'swordfish'; applying the file again deletes exactly those
 * and writes them fresh. A number a collector typed in during a call carries source = 'manual'
 * and is never touched. Without that line the second run would double every phone number.
 */
import { supabase } from './supabase'
import { type AccountRef, type EnrichPlan } from './swordfishDebtors'

/** Rows this import writes, and therefore the only ones a re-run may replace. */
const OWNED = 'swordfish'

export { planEnrichment, type AccountRef, type EnrichPlan } from './swordfishDebtors'

/** Every account's reference, paged — PostgREST caps a request at 1,000 rows. */
export async function fetchAccountRefs(): Promise<AccountRef[]> {
  const out: AccountRef[] = []
  const size = 1000
  for (let page = 0; ; page++) {
    const { data, error } = await supabase
      .from('debtor_accounts')
      .select('id,swordfish_reference,account_number')
      .order('id')
      .range(page * size, page * size + size - 1)
    if (error) throw new Error(error.message)
    const rows = data ?? []
    for (const r of rows) {
      out.push({ id: r.id, swordfishReference: r.swordfish_reference, accountNumber: r.account_number })
    }
    if (rows.length < size) return out
  }
}

export interface EnrichProgress { step: string; done: number; total: number }

/**
 * Apply it.
 *
 * Order matters: the owned rows are cleared before the new ones are written, so a re-run replaces
 * rather than accumulates. The account patches go last — if anything fails, the account rows are
 * the ones a person is most likely to notice being half-done.
 */
export async function applyEnrichment(
  plan: EnrichPlan,
  onProgress: (p: EnrichProgress) => void,
): Promise<{ contacts: number; promises: number; notes: number; accounts: number }> {
  const ids = [...new Set(plan.patches.map((p) => p.id))]

  // Chunked because a URL carrying 735 uuids in an `in.(...)` filter is longer than servers accept.
  const idChunks: string[][] = []
  for (let i = 0; i < ids.length; i += 200) idChunks.push(ids.slice(i, i + 200))

  const tables = [
    { table: 'account_contacts', label: 'contact details' },
    { table: 'promises_to_pay', label: 'promises' },
    { table: 'account_notes', label: 'comments' },
  ] as const

  for (const [i, t] of tables.entries()) {
    onProgress({ step: `Clearing previously imported ${t.label}`, done: i, total: tables.length })
    for (const chunk of idChunks) {
      const { error } = await supabase.from(t.table).delete().eq('source', OWNED).in('account_id', chunk)
      if (error) throw new Error(`Clearing ${t.label}: ${error.message}`)
    }
  }

  const inserts = [
    { table: 'account_contacts', label: 'contact details', rows: plan.contacts as object[] },
    { table: 'promises_to_pay', label: 'promises', rows: plan.promises as object[] },
    { table: 'account_notes', label: 'comments', rows: plan.notes as object[] },
  ]
  for (const t of inserts) {
    for (let i = 0; i < t.rows.length; i += 500) {
      const chunk = t.rows.slice(i, i + 500)
      const { error } = await supabase.from(t.table).insert(chunk)
      if (error) throw new Error(`Writing ${t.label}: ${error.message}`)
      onProgress({ step: `Writing ${t.label}`, done: Math.min(i + 500, t.rows.length), total: t.rows.length })
    }
  }

  // One request per account, twenty-five at a time. PostgREST cannot update many rows to many
  // different values in one call, and a stored procedure to do it is more machinery than 735
  // rows is worth.
  let updated = 0
  for (let i = 0; i < plan.patches.length; i += 25) {
    const batch = plan.patches.slice(i, i + 25)
    const results = await Promise.all(batch.map(({ id, ...fields }) =>
      supabase.from('debtor_accounts').update(fields).eq('id', id)))
    const failed = results.find((r) => r.error)
    if (failed?.error) throw new Error(`Updating accounts: ${failed.error.message}`)
    updated += batch.length
    onProgress({ step: 'Updating accounts', done: updated, total: plan.patches.length })
  }

  return {
    contacts: plan.contacts.length,
    promises: plan.promises.length,
    notes: plan.notes.length,
    accounts: updated,
  }
}
