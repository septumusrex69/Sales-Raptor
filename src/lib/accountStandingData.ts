/**
 * Reading what stands behind a debtor and against them.
 *
 * The queries only. The vocabulary, the types and every rule live in accountStanding.ts, which
 * imports nothing — so the checks can run them without a database, the way handOut.ts and
 * handOutData.ts are split.
 */
import { supabase } from './supabase'
import { sortDirectors, type AccountDirector, type AccountJudgment, type AccountStanding } from './accountStanding.ts'

/* eslint-disable @typescript-eslint/no-explicit-any -- rows come back as untyped JSON from PostgREST. */

const toDirector = (r: any): AccountDirector => ({
  id: r.id,
  accountId: r.account_id,
  idNumber: r.id_number ?? null,
  fullName: r.full_name,
  status: (r.status as 'Active' | 'Resigned' | null) ?? null,
  appointedOn: r.appointed_on ?? null,
  source: r.source ?? 'xds',
  tracedAt: r.traced_at ?? null,
})

const toJudgment = (r: any): AccountJudgment => ({
  id: r.id,
  accountId: r.account_id,
  caseNumber: r.case_number,
  caseType: r.case_type ?? null,
  caseReason: r.case_reason ?? null,
  plaintiff: r.plaintiff ?? null,
  filedOn: r.filed_on ?? null,
  amount: r.amount === null || r.amount === undefined ? null : Number(r.amount),
  source: r.source ?? 'xds',
  recordedAt: r.recorded_at,
})

/**
 * Both lists in one round trip's worth of waiting.
 *
 * Most accounts have neither — the whole imported book is individuals with no bureau profile
 * pulled — so this resolves to two empty arrays and the panel does not render. That is the
 * common case and it must cost nothing.
 */
export async function fetchStanding(accountId: string): Promise<AccountStanding> {
  const [d, j] = await Promise.all([
    supabase.from('account_directors')
      .select('id,account_id,id_number,full_name,status,appointed_on,source,traced_at')
      .eq('account_id', accountId),
    supabase.from('account_judgments')
      .select('id,account_id,case_number,case_type,case_reason,plaintiff,filed_on,amount,source,recorded_at')
      .eq('account_id', accountId)
      .order('filed_on', { ascending: false, nullsFirst: false }),
  ])
  if (d.error) throw d.error
  if (j.error) throw j.error
  return {
    directors: sortDirectors((d.data ?? []).map(toDirector)),
    judgments: (j.data ?? []).map(toJudgment),
  }
}

