import type { SupabaseClient } from '@supabase/supabase-js'
import { firmClock } from '../workflow/clock.js'
import {
  CAMPAIGN_CEILING, callSkip, mayCampaignOn, mayGiveCampaignTo, mayRecoverOn, recoverySkip, skipWords,
  tallySkips, traceSkip, type SkipReason,
} from '../../../src/lib/campaigns.js'
import {
  DEFAULT_SPREAD_RANK, NOW_RANK, SPREAD_RANKS, STANDARD_DAY, endDateProblem, planCalls,
  sharedAmongChosen, type CallKind, type CallMode,
} from '../../../src/lib/callCampaign.js'
import { itemAmountFor, scheduleFor } from '../../../src/lib/annexureB.js'
import type { UserRole } from '../../../src/types.js'
import { callerFor, factsFor, holdersFor } from './gather.js'

/**
 * A CALL CAMPAIGN ON THE SERVER: preview and create (S10, 21 Oct). callCampaign.ts decides where
 * each call lands; this reads what it needs to decide with, and writes the diary entries.
 *
 * Nothing the browser says about counts, desks or room is believed. It sends which accounts, the
 * mode, the rank, the end date and the script; this assesses all of it again on create, exactly as
 * the SMS and email campaigns do.
 *
 * WRITTEN WITH THE SERVICE KEY, after the caller's scope has been checked for every account. A
 * campaign call is a diary entry the collector did not book, on a desk the creator may not hold --
 * that is the point of it -- so it cannot go through the collector's own insert.
 *
 * THREE KINDS SINCE 22 OCT (callCampaign.ts CallKind). A WORK call goes to whoever holds the
 * account. A RECOVERY call (the written-off book, chosen by write-off reason) and a TRACE item (live
 * or written-off accounts) are SHARED AMONG THE PEOPLE THE CAMPAIGN NAMES, through the same planner
 * with a pool -- and put on a closed account they leave it closed and on whatever desk it was:
 * nothing here writes to debtor_accounts.
 */

type Caller = NonNullable<Awaited<ReturnType<typeof callerFor>>>

export interface CallInput {
  kind: CallKind
  mode: CallMode
  rank: number
  endsOn: string | null
  script: string
  accountIds: string[]
  /** Recovery and trace: who works it. */
  collectorIds: string[]
  /** Recovery, and a trace on the closed book: the write-off reason keys chosen. */
  reasons: string[]
  /** Trace only: the live book or the written-off book. */
  traceTarget: 'live' | 'closed'
}

export function readCallInput(body: Record<string, unknown>): CallInput | { error: string } {
  const kind: CallKind = body.kind === 'recovery' || body.kind === 'trace' ? body.kind : 'work'
  const mode = body.mode === 'now' || body.mode === 'spread' ? body.mode : null
  if (!mode) return { error: 'Say how the campaign is worked: now, or spread until an end date.' }
  const rank = mode === 'now' ? NOW_RANK : Number(body.rank ?? DEFAULT_SPREAD_RANK)
  if (mode === 'spread' && !SPREAD_RANKS.some((r) => r.rank === rank)) return { error: 'Choose where on the day the calls go.' }
  const strings = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && !!x))] : [])
  const ids = strings(body.accountIds)
  if (ids.length === 0) return { error: 'Select the accounts the campaign rings.' }
  if (ids.length > CAMPAIGN_CEILING) {
    return { error: `That is ${ids.length.toLocaleString('en-ZA')} accounts. A campaign reaches ${CAMPAIGN_CEILING.toLocaleString('en-ZA')} at most -- narrow the filters.` }
  }
  const script = typeof body.script === 'string' ? body.script.trim() : ''
  if (!script) return { error: kind === 'trace' ? 'Say what the tracer should look for.' : 'Write what the collector says, or asks for, on the call.' }
  if (script.length > 2000) return { error: 'Keep the script under 2 000 characters -- it is read before every call.' }
  const collectorIds = strings(body.collectorIds)
  if (sharedAmongChosen(kind) && collectorIds.length === 0) return { error: 'Choose who works it.' }
  const traceTarget = body.traceTarget === 'closed' ? 'closed' : 'live'
  const reasons = strings(body.reasons)
  const closedBook = kind === 'recovery' || (kind === 'trace' && traceTarget === 'closed')
  if (closedBook && reasons.length === 0) return { error: 'Choose which write-off reasons the campaign takes.' }
  return {
    kind, mode, rank, endsOn: typeof body.endsOn === 'string' ? body.endsOn : null, script, accountIds: ids,
    collectorIds: sharedAmongChosen(kind) ? collectorIds : [],
    reasons: closedBook ? reasons : [],
    traceTarget,
  }
}

/** What would happen. `forBrowser` is what the preview shows; the rest is create's working. */
export async function callAssess(admin: SupabaseClient, caller: Caller, input: CallInput) {
  const clock = await firmClock(admin)
  const endsOn = input.mode === 'now' ? clock.today : (input.endsOn ?? '')
  const dateProblem = endDateProblem(input.mode, clock.today, input.endsOn)
  const pooled = sharedAmongChosen(input.kind)

  const facts = await factsFor(admin, input.accountIds, clock.today)
  const people = await holdersFor(admin, [...facts.values()].flatMap((f) => [f.assignedTo, f.liaisonId]))

  /* ONE CAMPAIGN ITEM PER ACCOUNT AT A TIME -- the index's rule, asked first so it is a skip with a
     reason rather than a refused insert half way through. */
  const onCall = new Set<string>()
  for (let i = 0; i < input.accountIds.length; i += 100) {
    const { data, error } = await admin.from('diary_entries').select('account_id')
      .in('account_id', input.accountIds.slice(i, i + 100)).eq('state', 'open').eq('kind', 'campaign')
    if (error) throw new Error(error.message)
    for (const r of data ?? []) onCall.add(r.account_id as string)
  }

  /* WHO WORKS IT, for a recovery or trace campaign: every person named must be one this caller may
     give work to (mayGiveCampaignTo). One that is not refuses the campaign, as an account outside
     scope does -- the box offered only the right people, so a stranger here is a crafted request. */
  let badCollectors = 0
  const pool: string[] = []
  if (pooled && input.collectorIds.length) {
    const { data, error } = await admin.from('profiles').select('id, role, team_id, status').in('id', input.collectorIds)
    if (error) throw new Error(error.message)
    const found = new Map((data ?? []).map((p) => [p.id as string, p]))
    for (const id of input.collectorIds) {
      const p = found.get(id)
      if (p && mayGiveCampaignTo(caller, {
        id, role: p.role as UserRole, teamId: (p.team_id as string) ?? null, active: p.status !== 'Inactive',
      })) pool.push(id)
      else badCollectors += 1
    }
  }

  let outOfScope = 0
  const callable: { accountId: string; ownerId: string }[] = []
  const skipped: { id: string; reason: SkipReason; holdReason: string | null }[] = []
  for (const id of input.accountIds) {
    const f = facts.get(id)
    if (!f) continue
    const holder = f.assignedTo ? people.get(f.assignedTo) ?? null : null
    const liaison = f.liaisonId ? people.get(f.liaisonId) ?? null : null
    /* THE CLOSED BOOK HAS ITS OWN SCOPE: an account on nobody's desk, or a departed collector's, is
       a leader's to recover (mayRecoverOn). A live-book trace keeps the ordinary rule. */
    const closedBook = input.kind === 'recovery' || (input.kind === 'trace' && input.traceTarget === 'closed')
    const inScope = closedBook ? mayRecoverOn(caller, holder, liaison) : mayCampaignOn(caller, holder, liaison)
    if (!inScope) { outOfScope += 1; continue }
    const closed = { ...f, onCallCampaign: onCall.has(id) }
    const reason = input.kind === 'recovery' ? recoverySkip(closed, input.reasons)
      : input.kind === 'trace' ? traceSkip(closed, input.traceTarget, input.reasons)
        : callSkip(closed)
    if (reason) skipped.push({ id, reason, holdReason: f.holdReason })
    else callable.push({ accountId: id, ownerId: pooled ? '' : f.assignedTo as string })
  }

  /* THE ROOM: each collector's rate, and what is already open on each day of the campaign. */
  const owners = pooled ? pool : [...new Set(callable.map((c) => c.ownerId))]
  const capacity = new Map<string, number>()
  const load = new Map<string, number>()
  const names = new Map<string, string>()
  for (let i = 0; i < owners.length; i += 100) {
    const part = owners.slice(i, i + 100)
    const [{ data: profiles }, { data: open }] = await Promise.all([
      admin.from('profiles').select('id, name, diary_capacity').in('id', part),
      dateProblem ? Promise.resolve({ data: [] as { owner_id: string; due_on: string }[] })
        : admin.from('diary_entries').select('owner_id, due_on').in('owner_id', part).eq('state', 'open')
          .gte('due_on', clock.today).lte('due_on', endsOn).limit(50_000),
    ])
    for (const p of profiles ?? []) {
      capacity.set(p.id as string, Number(p.diary_capacity) > 0 ? Number(p.diary_capacity) : STANDARD_DAY)
      names.set(p.id as string, (p.name as string) ?? '')
    }
    for (const r of (open ?? []) as { owner_id: string; due_on: string }[]) {
      const k = `${r.owner_id}|${r.due_on}`
      load.set(k, (load.get(k) ?? 0) + 1)
    }
  }
  const plan = dateProblem || (pooled && pool.length === 0)
    ? { placed: [], unplaced: [], over: new Map<string, number>() }
    : planCalls({
      mode: input.mode, today: clock.today, endsOn, accounts: callable,
      capacityOf: (o) => capacity.get(o) ?? STANDARD_DAY,
      loadOf: (o, d) => load.get(`${o}|${d}`) ?? 0,
      pool: pooled ? pool : undefined,
    })

  /* Per collector, for the preview: how many each gets, and who goes over their day. */
  const perCollector = owners.map((o) => ({
    name: names.get(o) || 'Somebody',
    calls: plan.placed.filter((p) => p.ownerId === o).length,
    unplaced: plan.unplaced.filter((p) => p.ownerId === o).length,
    over: plan.over.get(o) ?? 0,
  })).sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name))

  /*
   * A TRACE CAMPAIGN COSTS NOTHING BY BEING ONE -- but each trace it leads to may, and the box says
   * so as the SMS box does. A credit bureau search is item 4(c), raised by recordTrace when the
   * tracer records the search, through the charge engine, exactly as a single trace is; nothing is
   * charged here. The estimate is one search per account, on the schedule in force today.
   */
  const traceEstimate = input.kind === 'trace'
    ? (() => {
      const schedule = scheduleFor(clock.today)
      const perSearch = itemAmountFor('4c', 1, 0, schedule)
      return { item: '4c', perSearch, total: Math.round(perSearch * plan.placed.length * 100) / 100, citation: schedule.citation }
    })()
    : null

  return {
    today: clock.today,
    endsOn,
    plan,
    skipped,
    pool,
    forBrowser: {
      kind: input.kind,
      selected: input.accountIds.length,
      found: facts.size,
      outOfScope,
      badCollectors,
      placing: plan.placed.length,
      unplaced: plan.unplaced.length,
      skipped: skipped.length,
      skips: tallySkips(skipped),
      collectors: perCollector,
      overCollectors: perCollector.filter((c) => c.over > 0).length,
      today: clock.today,
      endsOn,
      dateProblem,
      traceEstimate,
    },
  }
}

export async function callCreate(
  admin: SupabaseClient, caller: Caller, input: CallInput, body: Record<string, unknown>,
): Promise<{ campaignId: string; placing: number; skipped: number; unplaced: number } | { error: string; status: number }> {
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return { error: 'Give the campaign a name, so it can be found and stopped.', status: 400 }
  if (name.length > 120) return { error: 'Keep the name under 120 characters.', status: 400 }

  const a = await callAssess(admin, caller, input)
  const b = a.forBrowser
  if (b.dateProblem) return { error: b.dateProblem, status: 400 }
  if (b.outOfScope > 0) {
    return {
      error: `${b.outOfScope.toLocaleString('en-ZA')} of these accounts ${b.outOfScope === 1 ? 'is' : 'are'} outside what you may campaign on: `
        + 'your team’s desks, or your own clients. Narrow the selection.',
      status: 403,
    }
  }
  if (b.badCollectors > 0) return { error: 'One of the people chosen is not somebody you can give this work to.', status: 403 }
  if (b.placing === 0) return { error: 'No call can be placed: every account is skipped or no diary has room before the end date.', status: 400 }

  const since = new Date(Date.now() - 2 * 60_000).toISOString()
  const { data: twin } = await admin.from('campaigns').select('id')
    .eq('created_by', caller.id).eq('name', name).gte('created_at', since).limit(1).maybeSingle()
  if (twin) return { error: `“${name}” was started a moment ago. Find it under Campaigns.`, status: 409 }

  const pooled = sharedAmongChosen(input.kind)
  const selection = body.selection && typeof body.selection === 'object' ? body.selection : { kind: 'ids' }
  const { data: made, error } = await admin.from('campaigns').insert({
    name, channel: 'call', body: input.script, subject: null, selection,
    created_by: caller.id, created_by_name: caller.name || null, team_id: caller.teamId,
    call_kind: input.kind, collector_ids: pooled ? a.pool : null,
    write_off_reasons: input.reasons.length ? input.reasons : null,
    call_mode: input.mode, call_rank: input.rank, starts_on: a.today, ends_on: a.endsOn,
    selected: b.selected, to_send: b.placing, skipped: b.skipped, unplaced: b.unplaced, fee_estimate: 0,
    note: b.skips.length ? b.skips.map((s) => `${s.count} · ${s.words}`).join('; ') : null,
  }).select('id').single()
  if (error || !made) return { error: error?.message ?? 'The campaign could not be saved.', status: 500 }

  const rows = a.plan.placed.map((p) => ({
    account_id: p.accountId, owner_id: p.ownerId, due_on: p.dueOn, kind: 'campaign', rank: input.rank,
    campaign_id: made.id, source: 'campaign',
    reason: `${input.kind === 'trace' ? 'Trace campaign' : input.kind === 'recovery' ? 'Recovery campaign' : 'Campaign'}: ${name}`,
    created_by: caller.id, created_by_name: caller.name || null,
  }))
  for (let i = 0; i < rows.length; i += 500) {
    const { error: rowsError } = await admin.from('diary_entries').insert(rows.slice(i, i + 500))
    if (rowsError) {
      /* HALF A CAMPAIGN IS NOT STARTED: what landed comes off again, and the campaign says why. */
      await admin.rpc('call_campaigns_expire', { p_campaign: made.id, p_by: caller.id })
      await admin.from('campaigns').update({
        status: 'stopped', stopped_at: new Date().toISOString(), note: `It could not be set up: ${rowsError.message}`,
      }).eq('id', made.id)
      return { error: `The campaign could not be set up: ${rowsError.message}`, status: 500 }
    }
  }
  /* Skipped accounts, for "which and why" later: kept as rows on the messages table, never pending,
     so the sender (which skips call campaigns anyway) has nothing to claim. */
  const skippedRows = a.skipped.map((s) => ({
    campaign_id: made.id, account_id: s.id, state: 'skipped', reason: skipWords(s.reason, { holdReason: s.holdReason }),
  }))
  for (let i = 0; i < skippedRows.length; i += 500) {
    await admin.from('campaign_messages').insert(skippedRows.slice(i, i + 500))
  }
  return { campaignId: made.id as string, placing: b.placing, skipped: b.skipped, unplaced: b.unplaced }
}
