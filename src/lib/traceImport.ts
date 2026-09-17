/**
 * Putting a bureau profile onto an account.
 *
 * Everything here runs AFTER a person has read the screen and ticked what they want. Nothing is
 * inferred and nothing is imported wholesale: traceProfile reads the document, the modal shows
 * what it found, and this writes only what came back ticked.
 *
 * WHY THAT IS NOT OVER-CAUTION. A bureau profile is a third party's record of somebody else. One
 * real profile carries twenty-six phone numbers, the oldest from 2008 and several against ten
 * other people; another carries a namesake's address. Imported unread, the account fills with
 * numbers that have never been this debtor's and a collector spends a morning on them.
 *
 * THE UPLOAD CHARGES NOTHING. The trace itself is Annexure B item 4(c) and it is charged where it
 * is incurred -- on the Trace button, when the search is run at the bureau. Filing the PDF
 * afterwards is not a second search, and charging for it would put a fee on the debtor's
 * statement for an act of admin.
 */
import { supabase } from './supabase'
import { addNote } from './accountWorkspace'
import { setSubStatus } from './accountStandingData.ts'
import { keepNewestPerThing } from './traceStore.ts'
import { likelyRelatives } from './traceProfile.ts'
import type { AdministrationReading, TraceProfile } from './traceProfile.ts'

/* eslint-disable @typescript-eslint/no-explicit-any -- rows come back as untyped JSON from PostgREST. */

/**
 * Who the report is about, which is the question the firm asked for in these words: "the trace
 * would ask you, is this for the company, or is this for a director?"
 *
 * On an individual account there is only one answer and the screen does not ask.
 */
export type TraceTarget =
  | { of: 'debtor' }
  | { of: 'director'; directorId: string | null; idNumber: string | null; fullName: string }

/**
 * The one decision the import still asks a person to make.
 *
 * IT USED TO ASK SIX. Every finding arrived with a tick box and only the ticked ones were kept,
 * which the firm ended: "the moment that you upload a trace, everything should be uploaded. All
 * of the information should be uploaded. It shouldn't be ticked."
 *
 * They are right, and the ticks were solving the wrong problem. What they were really guarding
 * against was a bureau's twenty-six numbers landing on the account's principal contact list — so
 * the fix is that nothing lands there at import, not that findings are thrown away. A number the
 * bureau saw in 2019 costs nothing to keep and is worth having when the two recent ones turn out
 * to be dead; thrown away at the door, the firm pays for the same search twice to get it back.
 *
 * What survives as a question is the rung, because that is not a finding. It changes what the
 * client is told about this account, and "a PDF said so" is not an answer to "why does this now
 * report as under administration".
 */
export interface TraceDecisions {
  administration: AdministrationReading | null
}

export interface TraceImportResult {
  /** The trace just filed, so the screen can offer to open it and work it. */
  traceId: string | null
  directors: number
  judgments: number
  /** Directors already on the account whose row was refreshed rather than added. */
  directorsUpdated: number
  /** Other companies recorded against the person the trace was for. */
  directorships: number
  /** The rung the account was moved to, where the reader proposed one and it was accepted. */
  movedTo: string | null
  /** Findings kept on the trace. Everything the search found, which is now everything. */
  filed: number
}

const empty: TraceImportResult = {
  traceId: null, directors: 0, judgments: 0, directorsUpdated: 0, directorships: 0, movedTo: null,
  filed: 0,
}

/**
 * A director's row, found or created, so a consumer trace has something to hang off.
 *
 * Matched on the ID NUMBER FIRST and the name only as a fallback. A bureau spells a name the way
 * the register captured it, so the same person arrives with all three of their names on the
 * company's profile and with two of them on their own — and matching on that files them twice.
 * The thirteen-digit number is identical on both.
 */
async function directorRow(accountId: string, target: Extract<TraceTarget, { of: 'director' }>): Promise<string | null> {
  if (target.directorId) return target.directorId
  if (target.idNumber) {
    const { data } = await supabase.from('account_directors')
      .select('id').eq('account_id', accountId).eq('id_number', target.idNumber).maybeSingle()
    if (data?.id) return data.id as string
  }
  const { data, error } = await supabase.from('account_directors')
    .insert({
      account_id: accountId,
      id_number: target.idNumber,
      full_name: target.fullName,
      /* Unknown, not Active. A person traced on their own report has no directorship status on it. */
      status: null,
      source: 'xds',
    })
    .select('id').single()
  if (error) throw new Error(error.message)
  return (data as any).id as string
}

export async function importTrace(input: {
  accountId: string
  profile: TraceProfile
  target: TraceTarget
  decisions: TraceDecisions
  actor: { id: string | null; name: string | null }
}): Promise<TraceImportResult> {
  const { accountId, profile, target, decisions, actor } = input
  const result: TraceImportResult = { ...empty }
  const tracedAt = new Date().toISOString()

  /*
   * THE DIRECTOR THE REPORT IS ABOUT, resolved before anything else is written.
   *
   * Their judgments and their numbers both hang off this row, so if it cannot be created there is
   * nothing to attach and the import stops before it has half-written an account.
   */
  const aboutDirector = target.of === 'director' ? await directorRow(accountId, target) : null

  /* ---------- directors, off a commercial report ---------- */
  if (profile.directors.length > 0) {
    /*
     * Read first, then split into inserts and updates.
     *
     * upsert() would need the unique key (account_id, id_number, full_name), and the whole point
     * of re-running a trace is that a name or a status has CHANGED — a director who has since
     * resigned arrives with a different tuple and upserts as a second person. Matching on the ID
     * number is the only stable key.
     */
    const { data: existing, error } = await supabase.from('account_directors')
      .select('id,id_number,full_name').eq('account_id', accountId)
    if (error) throw new Error(error.message)
    const byId = new Map<string, any>()
    const byName = new Map<string, any>()
    for (const row of existing ?? []) {
      if (row.id_number) byId.set(String(row.id_number), row)
      byName.set(String(row.full_name).toUpperCase(), row)
    }

    const fresh: any[] = []
    for (const d of profile.directors) {
      const found = (d.idNumber && byId.get(d.idNumber)) || byName.get(d.fullName.toUpperCase())
      const fields = {
        id_number: d.idNumber,
        full_name: d.fullName,
        status: d.status,
        appointed_on: d.appointedOn,
        source: 'xds',
      }
      if (found) {
        const up = await supabase.from('account_directors').update(fields).eq('id', found.id)
        if (up.error) throw new Error(up.error.message)
        result.directorsUpdated += 1
      } else {
        fresh.push({ account_id: accountId, ...fields })
      }
    }
    if (fresh.length > 0) {
      const ins = await supabase.from('account_directors').insert(fresh)
      if (ins.error) throw new Error(ins.error.message)
      result.directors = fresh.length
    }
  }

  /* ---------- judgments ---------- */
  if (profile.judgments.length > 0) {
    /*
     * against_director_id carries WHO the judgment is against, and it is the whole reason a
     * director's personal judgments can be stored at all. Filed against the account, they would
     * count as the company's — see the column's comment.
     */
    const rows = profile.judgments.map((j) => ({
      account_id: accountId,
      against_director_id: aboutDirector,
      case_number: j.caseNumber,
      case_type: j.caseType,
      case_reason: j.caseReason,
      plaintiff: j.plaintiff,
      filed_on: j.filedOn,
      /*
       * THE ROW IN THE BUREAU'S OWN WORDS, where the columns could not be split.
       *
       * Kept only in that case. Stored on every judgment it would read as a second, competing
       * version of fields that are already right — and the screen shows it as unread, which is a
       * true thing to say about a row nobody could parse and a false one about a row that parsed
       * cleanly.
       */
      source_text: j.unread,
      source: 'xds',
    }))
    /*
     * The unique key folds a null director to a fixed uuid, which PostgREST cannot express as an
     * on_conflict target — so the same case is deleted and rewritten rather than upserted. That
     * is right for a re-pulled profile anyway: the bureau's version replaces ours.
     */
    const numbers = rows.map((r) => r.case_number)
    const scoped = supabase.from('account_judgments').delete()
      .eq('account_id', accountId).in('case_number', numbers)
    /*
     * SCOPED TO THE SAME SUBJECT, which is the whole care in this statement. Deleting by case
     * number alone would wipe the company's judgment when a director's report happens to carry a
     * case with the same number — and case numbers are per court per year, so that is not rare.
     */
    const del = aboutDirector === null
      ? await scoped.is('against_director_id', null)
      : await scoped.eq('against_director_id', aboutDirector)
    if (del.error) throw new Error(del.error.message)
    const ins = await supabase.from('account_judgments').insert(rows)
    if (ins.error) throw new Error(ins.error.message)
    result.judgments = rows.length
  }

  /* ---------- nothing goes on the contact list here ---------- */
  /*
   * THE PRINCIPAL CONTACT DETAILS ARE EARNED, NOT IMPORTED.
   *
   * This used to copy the ticked numbers, addresses and jobs straight onto account_contacts, so
   * the list a collector rings was half bureau guesswork the moment a trace landed. The firm's
   * replacement, in their words: upload everything, then "work the trace" -- "once the trace is
   * being worked, then it can be saved or added once it's verified."
   *
   * So a finding becomes a contact in exactly one place now: promoteTraceItem, called from the
   * workspace by somebody who has tried it and said what happened. The contact list is then a
   * list of things known to work rather than a list of things a bureau printed, which is the
   * difference between a collector trusting it and scrolling past it.
   */

  /* ---------- the trace itself, kept whole ---------- */
  /*
   * EVERYTHING THE SEARCH FOUND, not only what was ticked.
   *
   * The ticks decide what goes onto the account's PRINCIPAL details — the curated list a
   * collector rings. The trace keeps the rest, because a number the bureau saw in 2019 is not
   * worth a contact row and is absolutely worth having when the two recent ones turn out to be
   * dead. Thrown away at import, the firm pays for the same search twice.
   *
   * Written before the contacts, so a finding that is also promoted can be linked to the contact
   * row it became.
   */
  const traceRow = await supabase.from('account_traces').insert({
    account_id: accountId,
    subject_kind: target.of === 'director' ? 'director' : 'debtor',
    director_id: aboutDirector,
    report_kind: profile.kind,
    subject_name: profile.subjectName,
    id_number: profile.idNumber,
    registration_number: profile.registrationNumber,
    company_status: profile.companyStatus,
    contact_score: profile.contactScore,
    risk_score: profile.riskScore,
    enquired_on: profile.enquiredOn,
    pulled_by: actor.id,
  }).select('id').single()
  if (traceRow.error) throw new Error(traceRow.error.message)
  const traceId = (traceRow.data as any).id as string
  result.traceId = traceId

  const relatives = new Set(likelyRelatives(profile.subjectName, profile.links).map((l) => l.fullName))
  const itemRows: any[] = [
    ...profile.contacts.map((c) => ({
      kind: c.kind, value: c.value, label: null,
      people_linked: c.peopleLinked, seen_on: c.updatedOn, amount: null, status: null,
    })),
    ...profile.addresses.map((a) => ({
      kind: 'address', value: a.value, label: a.province,
      people_linked: null, seen_on: a.updatedOn, amount: null, status: null,
    })),
    ...profile.employment.map((e) => ({
      kind: 'employer', value: e.employer, label: e.designation,
      people_linked: null, seen_on: e.updatedOn, amount: null, status: null,
    })),
    ...profile.directorships.map((d) => ({
      kind: 'directorship', value: d.name, label: null,
      people_linked: null, seen_on: d.appointedOn, amount: null, status: d.status,
    })),
    ...profile.properties.map((pr) => ({
      kind: 'property', value: pr.address, label: pr.role,
      people_linked: null, seen_on: pr.purchasedOn, amount: pr.purchaseAmount,
      /*
       * The current-owner flag is what separates an asset from a house sold in 2008. One real
       * report lists a property as 'Seller' AND current owner — the bureau's own contradiction,
       * carried through rather than resolved, because guessing which column is right would put a
       * made-up asset on a client report.
       */
      status: pr.currentOwner ? 'current owner' : 'past',
    })),
    ...profile.links.map((l) => ({
      kind: 'link', value: l.fullName,
      label: [l.type, l.linkedThrough].filter(Boolean).join(' · ') || null,
      people_linked: null, seen_on: null, amount: null,
      /*
       * 'relative' is a JUDGEMENT AND IS MARKED AS ONE. It means the surname matched, which is
       * evidence of a family connection and not proof of one — the screen says "possible".
       */
      status: relatives.has(l.fullName) ? 'relative' : 'link',
    })),
  ]
  /* One row per thing before it ever reaches the database — see keepNewestPerThing for why. */
  const deduped = keepNewestPerThing(itemRows)

  if (deduped.length > 0) {
    /*
     * Upserted rather than inserted, so a duplicate nobody anticipated cannot throw away the
     * whole search a second time. The deduplication above is the rule; this is the seatbelt.
     */
    const ins = await supabase.from('account_trace_items')
      .upsert(
        deduped.map((r) => ({ ...r, trace_id: traceId, account_id: accountId })),
        { onConflict: 'trace_id,kind,value', ignoreDuplicates: true },
      )
    if (ins.error) {
      /*
       * A TRACE WITH NO FINDINGS IS WORSE THAN NO TRACE. Without this the failed import leaves an
       * empty trace on the account that a collector can open, read nothing from, and not explain.
       */
      await supabase.from('account_traces').delete().eq('id', traceId)
      throw new Error(ins.error.message)
    }
    result.filed = deduped.length
  }

  /* ---------- the other companies they sit on ---------- */
  if (profile.directorships.length > 0 && aboutDirector !== null) {
    /*
     * ONLY EVER AGAINST A PERSON. A directorship belongs to the director, not to the account —
     * filed against the account it would read as a company the DEBTOR owns, which is a different
     * and much stronger claim than the one the document makes.
     */
    const { data: have, error } = await supabase.from('account_director_companies')
      .select('company_name').eq('director_id', aboutDirector)
    if (error) throw new Error(error.message)
    const seen = new Set((have ?? []).map((r: any) => String(r.company_name).toUpperCase()))
    const fresh = profile.directorships
      .filter((c) => !seen.has(c.name.toUpperCase()))
      .map((c) => ({
        director_id: aboutDirector,
        company_name: c.name,
        status: c.status === 'Active' || c.status === 'Resigned' ? c.status : null,
        appointed_on: c.appointedOn,
        source: 'xds',
      }))
    if (fresh.length > 0) {
      const ins = await supabase.from('account_director_companies').insert(fresh)
      if (ins.error) throw new Error(ins.error.message)
      result.directorships = fresh.length
    }
  }

  /* ---------- the rung, where a person accepted the proposal ---------- */
  if (decisions.administration !== null) {
    await setSubStatus(accountId, decisions.administration.subStatus)
    result.movedTo = decisions.administration.subStatus
  }

  /* ---------- when this person was last traced ---------- */
  if (aboutDirector !== null) {
    /*
     * A trace costs money under item 4(c). Recording the date against the person is what stops
     * the firm paying for the same search twice, and it is the one field that cannot be read off
     * the PDF — it is a fact about US, not about them.
     */
    const up = await supabase.from('account_directors')
      .update({ traced_at: tracedAt, traced_by: actor.id }).eq('id', aboutDirector)
    if (up.error) throw new Error(up.error.message)
  }

  /*
   * ON THE TIMELINE, because an account that changed and cannot say why is the complaint this
   * whole page exists to answer. Written last: a note about an import that failed halfway would
   * be a note about something that did not happen.
   */
  await addNote({
    accountId,
    body: traceNote(profile, target, result),
    authorName: actor.name,
    createdBy: actor.id,
    /* Raptor composed these words, not a collector. The timeline filters on it. */
    source: 'system',
  })

  return result
}

/** What the timeline says happened, in the firm's words rather than in counts of rows. */
export function traceNote(profile: TraceProfile, target: TraceTarget, r: TraceImportResult): string {
  const who = target.of === 'director'
    ? `${target.fullName} (director)`
    : profile.subjectName ?? 'the debtor'
  const bits: string[] = []
  if (r.directors > 0) bits.push(`${r.directors} director${r.directors === 1 ? '' : 's'} added`)
  if (r.directorsUpdated > 0) bits.push(`${r.directorsUpdated} updated`)
  if (r.judgments > 0) bits.push(`${r.judgments} judgment${r.judgments === 1 ? '' : 's'}`)
  if (r.directorships > 0) bits.push(`${r.directorships} other directorship${r.directorships === 1 ? '' : 's'}`)
  /*
   * WHAT THE SEARCH FOUND, and none of it on the contact list. The timeline used to say how many
   * numbers went onto the account, which is now always none: a finding reaches the contact list
   * by being worked, and that is its own timeline entry when it happens.
   */
  if (r.filed > 0) bits.push(`${r.filed} finding${r.filed === 1 ? '' : 's'} kept on the trace`)
  const found = bits.length > 0 ? bits.join(', ') : 'nothing taken from it'
  const status = profile.companyStatus ? ` Status at CIPC: ${profile.companyStatus}.` : ''
  /*
   * THE RUNG CHANGE IS NAMED, not left to be inferred from the status line. It is the one part of
   * an import that changes what the client is told, so the timeline says it in its own sentence.
   */
  const moved = r.movedTo ? ` Account moved to ${r.movedTo}.` : ''
  return `Trace filed for ${who}${profile.enquiredOn ? `, pulled ${profile.enquiredOn}` : ''} — ${found}.${status}${moved}`
}
