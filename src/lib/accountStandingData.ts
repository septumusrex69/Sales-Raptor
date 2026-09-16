/**
 * Reading what stands behind a debtor and against them.
 *
 * The queries only. The vocabulary, the types and every rule live in accountStanding.ts, which
 * imports nothing — so the checks can run them without a database, the way handOut.ts and
 * handOutData.ts are split.
 */
import { supabase } from './supabase'
import {
  sortDirectors,
  type AccountDirector, type AccountJudgment, type AccountStanding, type DirectorCompany,
  type PractitionerKind,
} from './accountStanding.ts'

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
  companies: [],
})

const toDirectorCompany = (r: any): DirectorCompany => ({
  id: r.id,
  directorId: r.director_id,
  companyName: r.company_name,
  status: (r.status as 'Active' | 'Resigned' | null) ?? null,
  appointedOn: r.appointed_on ?? null,
  registrationNumber: r.registration_number ?? null,
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
  sourceText: r.source_text ?? null,
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
      .select('id,account_id,case_number,case_type,case_reason,plaintiff,filed_on,amount,source_text,source,recorded_at')
      .eq('account_id', accountId)
      .order('filed_on', { ascending: false, nullsFirst: false }),
  ])
  if (d.error) throw d.error
  if (j.error) throw j.error

  const directors = sortDirectors((d.data ?? []).map(toDirector))

  /*
   * The directorships in a second round trip, keyed on the directors we just read.
   *
   * NOT an embedded select. PostgREST would nest them under the director rows, which the
   * hand-written mapper above would then have to know about — and a shape that only the mapper
   * understands is the same silent-undefined trap this codebase already has a name for. Two plain
   * queries and an explicit join here is a few milliseconds and no mystery.
   *
   * Skipped entirely when there are no directors, which is nearly every account.
   */
  if (directors.length > 0) {
    const { data, error } = await supabase.from('account_director_companies')
      .select('id,director_id,company_name,status,appointed_on,registration_number')
      .in('director_id', directors.map((x) => x.id))
    if (error) throw error
    const byDirector = new Map<string, DirectorCompany[]>()
    for (const row of (data ?? []).map(toDirectorCompany)) {
      const list = byDirector.get(row.directorId)
      if (list) list.push(row); else byDirector.set(row.directorId, [row])
    }
    for (const director of directors) director.companies = byDirector.get(director.id) ?? []
  }

  return { directors, judgments: (j.data ?? []).map(toJudgment) }
}


/**
 * Recording who to deal with when it is no longer the debtor.
 *
 * Typed by a person, not read off a document, and that is the point: a trace profile says a
 * company is in final liquidation and does NOT name the liquidator. Somebody has to look it up —
 * the Master's office, the notice, the client — and this is where it lands when they do.
 *
 * Clearing it is setting the kind to null, which is somebody correcting a mistake rather than an
 * appointment ending. An appointment that has ended leaves the account under administration until
 * a person says otherwise, so nothing here touches the sub-status.
 */
export async function savePractitioner(accountId: string, input: {
  kind: PractitionerKind | null
  name: string | null
  firm: string | null
  reference: string | null
  phone: string | null
  email: string | null
  appointedOn: string | null
}): Promise<void> {
  const trim = (v: string | null) => (v ?? '').trim() || null
  const { error } = await supabase.from('debtor_accounts').update({
    practitioner_kind: input.kind,
    practitioner_name: trim(input.name),
    practitioner_firm: trim(input.firm),
    practitioner_reference: trim(input.reference),
    practitioner_phone: trim(input.phone),
    practitioner_email: trim(input.email),
    /* An empty date input reads as '' and Postgres will not take that for a date. */
    practitioner_appointed_on: trim(input.appointedOn),
  }).eq('id', accountId)
  if (error) throw new Error(error.message)
}

/**
 * Putting an account on the rung a document says it belongs on.
 *
 * WRITES THE SUB-STATUS, because that is what the rung is derived from — positions are derived,
 * never stored, and the one string every screen reads is this one. See clientPosition.
 *
 * Deliberately narrow: it takes the wording from administrationReading, which only produces
 * phrases the derivation already knows. A free-text status setter belongs on the account screen
 * with the firm's own list in front of the person choosing, not on the end of a PDF import.
 */
export async function setSubStatus(accountId: string, subStatus: string): Promise<void> {
  const { error } = await supabase.from('debtor_accounts')
    .update({ sub_status: subStatus }).eq('id', accountId)
  if (error) throw new Error(error.message)
}
