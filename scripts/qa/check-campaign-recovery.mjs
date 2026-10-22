/**
 * CAMPAIGNS, ROUND TWO (S10, 22 Oct): the firm's four instructions and their amendment.
 *
 * Holds:
 *   1. REALLOCATED MID-CAMPAIGN -- a work campaign's open call follows the account to its new desk,
 *      moved (never edited) in the order the one-open-call index needs; to nobody, it comes off.
 *   2. RECOVERY -- the closed book only, never withdrawn / paid up / settled (however the book
 *      recorded it), never prescribed, only the write-off reasons chosen; shared among the chosen
 *      collectors by the ONE planner; nothing re-opens an account but its collector's press, which
 *      the database refuses to anybody else and which moves the desk before the book.
 *   3. RESULTS FOR EVERYBODY -- security definer, any active staff member, no fee anywhere on the
 *      page, PTPs made by the stated definition; the trace funnel derived stage by stage.
 *   4. AUTO-DIAL -- only with BuzzBox, only in calling hours, once per visit, through CallButton.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-campaign-recovery.mjs
 */
import { readFileSync } from 'node:fs'
import {
  recoverySkip, traceSkip, recoveryClosure, writeOffReasonKey, mayRecoverOn, mayGiveCampaignTo, callSkip,
} from '../../src/lib/campaigns.ts'
import { planCalls, shareAmong, callConfirmation, sharedAmongChosen } from '../../src/lib/callCampaign.ts'
import { autoDialDecision, claimAutoDial, autoDialClaimed, readAutoDial, dialWords } from '../../src/lib/autoDial.ts'
import { traceFunnel, resultKind } from '../../src/lib/campaignResults.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, v) => check(name, v, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/^\s*--.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

const sql = read('supabase/schema.sql')
/* THE LAST DEFINITION IS THE LIVE ONE (CLAUDE.md): read the last `create or replace function`. */
const lastFn = (name) => {
  const at = sql.lastIndexOf(`create or replace function public.${name}(`)
  if (at < 0) return ''
  const m = /\bas\s+\$(\w*)\$([\s\S]*?)\$\1\$/i.exec(sql.slice(at))
  return m ? m[2] : ''
}
const lastFnHead = (name) => {
  const at = sql.lastIndexOf(`create or replace function public.${name}(`)
  return at < 0 ? '' : sql.slice(at, sql.indexOf('$$', at))
}

/* ================================================================ 1. the call follows the desk */
const follow = lastFn('campaign_call_follows_desk')
ok('the follow function exists', follow.length > 0)
ok('it fires on assigned_to, after the update',
  /create trigger campaign_call_follows_desk\s+after update of assigned_to on public\.debtor_accounts/.test(sql))
ok('only a WORK campaign\'s call follows the desk (recovery and trace were given to chosen people)',
  /c\.call_kind = 'work'/.test(follow))
{
  const moved = follow.indexOf("set state = 'moved'")
  const insert = follow.indexOf('insert into public.diary_entries')
  const pointer = follow.indexOf('set moved_to = v_new')
  ok('the old call is marked moved, with who and why', moved >= 0 && /moved_by = auth\.uid\(\)/.test(follow)
    && /moved_reason = 'Account reallocated to '/.test(follow))
  ok('...BEFORE the new one is inserted (one open campaign call per account)', moved >= 0 && insert >= 0 && moved < insert)
  ok('...and points at it afterwards', insert >= 0 && pointer > insert)
  ok('the new call keeps the day, the rank, the campaign, the source and the reason',
    /\(v_old\.account_id, new\.assigned_to, v_old\.due_on, v_old\.kind, v_old\.rank, v_old\.campaign_id,\s*v_old\.source, v_old\.reason/.test(follow))
  ok('to nobody: the call comes off with a reason', /if new\.assigned_to is null then[\s\S]{0,200}set state = 'cancelled'/.test(follow))
}
ok('moved_to is not a column protect_closed_diary_entries reverts (so the pointer can be written)',
  !/new\.moved_to\s*:=/.test(lastFn('protect_closed_diary_entries')))
ok('a moved call is counted once: not as missed', /count\(\*\) filter \(where d\.state = 'cancelled'\)/.test(lastFn('campaign_counts'))
  && !/'moved'/.test(lastFn('campaign_counts')))
ok('...nor by collector on the Campaigns page', /if \(r\.state === 'moved'\) continue/.test(read('src/lib/campaignApi.ts')))

/* ================================================================ 2. recovery: who is taken */
const closed = (over = {}) => ({
  book: 'closed', holdReason: null, prescribed: false, debtorKind: 'individual', mobile: '0825551234', email: null,
  openDispute: false, workflowToday: false, endedAs: 'written_off', endedReason: 'Uncontactable', writeOffReason: null,
  status: 'Active: Activated', onCallCampaign: false, ...over,
})
const UNC = writeOffReasonKey({ endedAs: 'written_off', endedReason: 'Uncontactable', writeOffReason: null })
check('a written-off account with a chosen reason is rung', recoverySkip(closed(), [UNC]), null)
check('a live account is not the recovery campaign\'s', recoverySkip(closed({ book: 'active', endedAs: null }), [UNC]), 'not_closed')
check('PAID UP is never in one', recoverySkip(closed({ endedAs: 'paid_up' }), [UNC, 'none']), 'paid')
check('SETTLED is never in one', recoverySkip(closed({ endedAs: 'settled' }), [UNC, 'none']), 'paid')
check('WITHDRAWN is never in one', recoverySkip(closed({ endedAs: 'withdrawn' }), [UNC, 'none']), 'withdrawn')
check('...nor withdrawn as Swordfish recorded it, in the status',
  recoverySkip(closed({ endedAs: null, status: 'Closed: Withdrawn by client', writeOffReason: null }), ['none']), 'withdrawn')
check('...or in the imported reason',
  recoverySkip(closed({ endedAs: null, status: 'Written-off', writeOffReason: 'Withdrawn - client request' }), [writeOffReasonKey({ endedAs: null, endedReason: null, writeOffReason: 'Withdrawn - client request' })]), 'withdrawn')
check('Swordfish\'s "Paid in Full" is paid, not written off',
  recoverySkip(closed({ endedAs: null, status: 'Written-off', writeOffReason: 'Paid in Full' }), [writeOffReasonKey({ endedAs: null, endedReason: null, writeOffReason: 'Paid in Full' })]), 'paid')
check('prescribed: NCA s126B', recoverySkip(closed({ prescribed: true }), [UNC]), 'prescribed')
check('a reason not chosen is skipped', recoverySkip(closed({ endedReason: 'Cannot pay' }), [UNC]), 'reason_not_chosen')
check('an open dispute is skipped', recoverySkip(closed({ openDispute: true }), [UNC]), 'dispute')
check('no number, no call', recoverySkip(closed({ mobile: null }), [UNC]), 'no_phone')
check('one campaign item per account', recoverySkip(closed({ onCallCampaign: true }), [UNC]), 'on_call_campaign')
check('NOBODY\'S DESK IS NOT A REASON on the closed book', recoverySkip(closed({ assignedTo: null }), [UNC]), null)
check('the ordinary call campaign still skips closed accounts', callSkip({ ...closed(), assignedTo: 'x' }), 'closed')

/* the reasons, grouped */
check('a reason is grouped trimmed and case-folded',
  writeOffReasonKey({ endedAs: 'written_off', endedReason: '  uncontactable ', writeOffReason: null }), UNC)
check('Raptor\'s and Swordfish\'s reasons are kept apart',
  writeOffReasonKey({ endedAs: null, endedReason: null, writeOffReason: 'Uncontactable' }), 'imported:uncontactable')
check('...inner spaces folded too', writeOffReasonKey({ endedAs: null, endedReason: null, writeOffReason: 'Refusal  to  pay' }), 'imported:refusal to pay')
check('no reason recorded', writeOffReasonKey({ endedAs: null, endedReason: null, writeOffReason: '   ' }), 'none')
check('recoveryClosure reads the firm\'s own word first', recoveryClosure({ endedAs: 'written_off', status: 'Closed: Withdrawn', writeOffReason: null }), 'written_off')

/* the SQL reads them the same way */
const closure = lastFn('recovery_closure')
ok('recovery_closure: ended_as first, then withdrawn from status or reason, then paid in full, then settled',
  /when p_ended_as is not null then p_ended_as/.test(closure) && /p_status, ''\) ~\* 'withdr' or coalesce\(p_write_off_reason, ''\) ~\* 'withdr'/.test(closure)
  && /paid\\s\*in\\s\*full/.test(closure) && /\^\\s\*settled/.test(closure))
const key = lastFn('write_off_reason_key')
ok('write_off_reason_key: raptor from ended_reason, imported from write_off_reason, folded, else none',
  /'raptor:' \|\| lower\(regexp_replace\(btrim\(p_ended_reason\)/.test(key) && /'imported:' \|\| lower\(regexp_replace\(btrim\(p_write_off_reason\)/.test(key) && /else 'none'/.test(key))
const reasons = lastFn('recovery_reasons')
ok('the reasons are counted in the database, recoverable accounts only',
  /recovery_closure\(a\.ended_as, a\.status, a\.write_off_reason\) = 'written_off'/.test(reasons) && /not coalesce\(a\.prescribed, false\)/.test(reasons)
  && /has_capability\('campaign\.run'\)/.test(reasons))
ok('...security definer, granted to signed-in people', /security definer/.test(lastFnHead('recovery_reasons'))
  && /grant execute on function public\.recovery_reasons\(uuid\[\]\) to authenticated;/.test(sql))
ok('the box asks the database for them rather than loading the book', /rpc\('recovery_reasons'/.test(read('src/lib/campaignApi.ts')))

/* the withdrawn tick is gone, everywhere */
ok('no include-withdrawn column survives (the last word on it is its removal)',
  sql.lastIndexOf('include_withdrawn') === sql.lastIndexOf("op column if exists include_withdrawn") + "op column if exists ".length)
ok('...and the call box offers no such tick', !/withdr[a-z]* tick|include.?withdrawn|includeWithdrawn/i.test(read('src/pages/accounts/CallCampaignModal.tsx')))
ok('...and the server reads none', !/includeWithdrawn|include_withdrawn/.test(read('api/_lib/campaign/call.ts')))
ok('a recovery campaign must name its reasons', /call_kind <> 'recovery' or \(write_off_reasons is not null and cardinality\(write_off_reasons\) > 0\)/.test(sql))

/* trace */
check('a trace on the closed book needs no number', traceSkip(closed({ mobile: null }), 'closed', [UNC]), null)
check('...and still never takes a withdrawn account', traceSkip(closed({ endedAs: 'withdrawn' }), 'closed', [UNC, 'none']), 'withdrawn')
check('a live trace skips a closed account', traceSkip(closed(), 'live', []), 'closed')
check('a live trace needs no number either', traceSkip(closed({ book: 'active', endedAs: null, mobile: null }), 'live', []), null)

/* who */
const admin = { id: 'a', role: 'Administrator', teamId: null }
const leader = { id: 'l', role: 'Pre-legal Team Leader', teamId: 't1' }
const liaison = { id: 'z', role: 'Liaison', teamId: 'tl' }
ok('a leader may recover an account on nobody\'s desk', mayRecoverOn(leader, null, null))
ok('...or on the desk of somebody who has left', mayRecoverOn(leader, { id: 'x', role: 'Pre-legal Agent', teamId: 't2', active: false }, null))
ok('...but not another team\'s live collector\'s', !mayRecoverOn(leader, { id: 'x', role: 'Pre-legal Agent', teamId: 't2', active: true }, null))
ok('a liaison only over their own clients', mayRecoverOn(liaison, null, { id: 'z', role: 'Liaison', teamId: 'tl' })
  && !mayRecoverOn(liaison, null, { id: 'q', role: 'Liaison', teamId: 'tl' }))
const agent = (over = {}) => ({ id: 'g', role: 'Pre-legal Agent', teamId: 't1', active: true, ...over })
ok('a leader gives work to their own team', mayGiveCampaignTo(leader, agent()) && !mayGiveCampaignTo(leader, agent({ teamId: 't2' })))
ok('a liaison may choose any collector', mayGiveCampaignTo(liaison, agent({ teamId: 't9' })))
ok('nobody gives work to somebody who has left', !mayGiveCampaignTo(admin, agent({ active: false })))
ok('...or to somebody off the floor', !mayGiveCampaignTo(admin, agent({ role: 'Sales Representative' })))
ok('the server checks every person named', /mayGiveCampaignTo\(caller,/.test(read('api/_lib/campaign/call.ts'))
  && /if \(b\.badCollectors > 0\)/.test(read('api/_lib/campaign/call.ts')))
ok('...and the closed book\'s own scope', /closedBook \? mayRecoverOn\(caller, holder, liaison\) : mayCampaignOn\(caller, holder, liaison\)/.test(read('api/_lib/campaign/call.ts')))

/* shared by the ONE planner */
ok('recovery and trace are shared among the chosen; work goes to the holder',
  sharedAmongChosen('recovery') && sharedAmongChosen('trace') && !sharedAmongChosen('work'))
const accts = (n) => Array.from({ length: n }, (_, i) => ({ accountId: `a${i}`, ownerId: '' }))
const even = shareAmong({ mode: 'now', today: '2026-11-02', endsOn: '2026-11-02', accounts: accts(10), pool: ['p', 'q'], capacityOf: () => 50, loadOf: () => 0 })
check('equal room, equal shares', [even.filter((a) => a.ownerId === 'p').length, even.filter((a) => a.ownerId === 'q').length], [5, 5])
const lopsided = shareAmong({ mode: 'now', today: '2026-11-02', endsOn: '2026-11-02', accounts: accts(9), pool: ['p', 'q'], capacityOf: () => 50, loadOf: (o) => (o === 'p' ? 44 : 47) })
check('as evenly as the room allows: six of room and three get six and three', [lopsided.filter((a) => a.ownerId === 'p').length, lopsided.filter((a) => a.ownerId === 'q').length], [6, 3])
const full = shareAmong({ mode: 'now', today: '2026-11-02', endsOn: '2026-11-02', accounts: accts(4), pool: ['p', 'q'], capacityOf: () => 50, loadOf: () => 50 })
check('no room anywhere: still shared evenly, so what does not fit is nobody\'s alone', [full.filter((a) => a.ownerId === 'p').length, full.filter((a) => a.ownerId === 'q').length], [2, 2])
const pooledPlan = planCalls({ mode: 'spread', today: '2026-11-02', endsOn: '2026-11-06', accounts: accts(10), pool: ['p', 'q'], capacityOf: () => 50, loadOf: () => 49 })
check('planCalls with a pool places through the same day-by-day room', [pooledPlan.placed.length, pooledPlan.unplaced.length], [10, 0])
ok('...each day within the one free place per person', ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']
  .every((d) => ['p', 'q'].every((o) => pooledPlan.placed.filter((x) => x.dueOn === d && x.ownerId === o).length <= 1)))
ok('the server uses the planner\'s pool, not a second planner', /pool: pooled \? pool : undefined/.test(read('api/_lib/campaign/call.ts')))
ok('putting an account on a campaign writes nothing to the account', !/from\('debtor_accounts'\)\s*\.update/.test(read('api/_lib/campaign/call.ts')))
ok('the confirm words say a recovery leaves the account where it was',
  /stay closed and where they are/.test(callConfirmation({ name: 'x', mode: 'now', rank: 5, endsOn: '', placing: 2, collectors: 1, skipped: 0, unplaced: 0, overCollectors: 0, endWords: '', kind: 'recovery' })))

/* the press, and only the press */
const reopen = lastFn('recovery_reopen')
ok('recovery_reopen is security definer, for signed-in people', /security definer/.test(lastFnHead('recovery_reopen'))
  && /grant execute on function public\.recovery_reopen\(uuid\) to authenticated;/.test(sql))
ok('REFUSED unless the caller holds the open campaign call', /d\.state = 'open' and d\.kind = 'campaign' and d\.owner_id = v_uid/.test(reopen)
  && /if not found then\s+raise exception 'Only the collector/.test(reopen))
ok('...from a RECOVERY campaign', /v_c\.call_kind is distinct from 'recovery'/.test(reopen))
ok('...that is still running', /v_c\.status <> 'sending' or v_c\.ends_on < public\.raptor_today\(\)/.test(reopen))
ok('refuses paid, withdrawn and prescribed', /v_as in \('paid_up', 'settled'\)/.test(reopen) && /if v_as = 'withdrawn' then/.test(reopen)
  && /if v_a\.prescribed then/.test(reopen) && /public\.recovery_closure\(v_a\.ended_as, v_a\.status, v_a\.write_off_reason\)/.test(reopen))
{
  const desk = reopen.indexOf('set assigned_to = v_uid')
  const book = reopen.indexOf('set ended_as = null')
  ok('the desk moves BEFORE the book (no handover sequence on a re-opened file)', desk >= 0 && book >= 0 && desk < book)
  ok('...in two statements, the second not touching assigned_to', book >= 0 && !/assigned_to/.test(reopen.slice(book, reopen.indexOf(';', book))))
}
ok('what it was is recorded on the call and on the timeline', /recovered_from = jsonb_build_object\(/.test(reopen) && /insert into public\.account_notes/.test(reopen))
ok('interest is not touched', !/interest/.test(reopen))
ok('a closed status comes back as Swordfish\'s own word', /'Active: Re-opened'/.test(reopen))
ok('the account page offers it only for a running recovery call of mine', /call_kind !== 'recovery'/.test(read('src/lib/campaignApi.ts'))
  && /eq\('owner_id', userId\)/.test(read('src/lib/campaignApi.ts')))
ok('...and it asks twice before doing it', /setAsking\(true\)/.test(read('src/components/accounts/RecoveryReopen.tsx'))
  && /recovery-reopen-confirm/.test(read('src/components/accounts/RecoveryReopen.tsx')))
ok('no promise form on a closed account', /\{open && !closed && \(/.test(read('src/pages/accounts/AccountDetail.tsx'))
  && /closed=\{account\.book === 'closed'\}/.test(read('src/pages/accounts/AccountDetail.tsx')))
ok('finishing an item on a closed account books no date', /entry\.kind === 'campaign' && entry\.account\.book === 'closed'/.test(read('src/components/diary/CompleteDiaryModal.tsx'))
  && /entry\.kind === 'campaign' && account\.book === 'closed'/.test(read('src/components/diary/DiaryWorkBar.tsx'))
  && !/diarise\(/.test(read('src/lib/diary.ts').split('export async function finishOnClosedAccount')[1]?.split('export ')[0] ?? 'diarise('))

/* ================================================================ 3. results for everybody */
const results = lastFn('campaign_results')
ok('results: security definer, for any active staff member', /security definer/.test(lastFnHead('campaign_results'))
  && /status = 'Active'/.test(results) && /grant execute on function public\.campaign_results\(\) to authenticated;/.test(sql))
ok('...and no fee or estimate in what it returns', !/fee/i.test(lastFnHead('campaign_results')) && !/fee/i.test(results))
ok('by collector the same', /security definer/.test(lastFnHead('campaign_results_by_collector')) && !/fee/i.test(lastFn('campaign_results_by_collector')))
const promises = lastFn('campaign_call_promises')
ok('a PTP made: by the collector whose diary the call was on, after the call landed',
  /p\.created_by = d\.owner_id and p\.created_at >= d\.created_at/.test(promises))
ok('...until the end of the day it was worked', /when 'done' then \(\(\(\(coalesce\(d\.closed_at, d\.done_at\)\) at time zone 'Africa\/Johannesburg'\)::date \+ 1\)/.test(promises))
ok('...measured on ONE clock: the moment an entry closes is stamped on now(), as created_at is',
  /if old\.state = 'open' and new\.state <> 'open' then\s+new\.closed_at := now\(\);/.test(lastFn('stamp_diary_closed_at'))
  && /create trigger stamp_diary_closed_at\s+before update on public\.diary_entries/.test(sql))
ok('...counted once per promise', /distinct on \(d\.campaign_id, p\.id\)/.test(promises))
const page = strip(read('src/pages/campaigns/CampaignResultsPage.tsx'))
ok('the results page shows no fee', !/fee|feeEstimate|counts\.fees/i.test(page))
ok('...and changes nothing', !/stopCampaign|sendCampaignPass|createCallCampaign/.test(page))
/* 22 Oct: a tab of Reports (open to everybody) rather than a menu item of its own -- the firm asked. */
ok('it is a Reports tab, which everybody has', /'Rejected Deals', 'Campaigns'\] as const/.test(read('src/pages/reports/ReportsPage.tsx'))
  && /\{tab === 'Campaigns' && <CampaignResultsPage \/>\}/.test(read('src/pages/reports/ReportsPage.tsx'))
  && !/n\.to !== '\/reports'/.test(read('src/components/layout/Sidebar.tsx')))
ok('...and the old address still lands there', /path="\/campaigns\/results" element=\{<Navigate to="\/reports\?tab=Campaigns" replace \/>\}/.test(read('src/App.tsx')))
ok('a collector can read the campaign their call came from', /create policy campaigns_read_own_calls on public\.campaigns for select to authenticated/.test(sql))
check('kinds in the firm\'s words', ['sms', 'email', 'work', 'recovery', 'trace'].map((k) => resultKind({ channel: k === 'sms' || k === 'email' ? k : 'call', callKind: k })),
  ['SMS', 'Email', 'Calls', 'Recovery calls', 'Trace'])

/* the trace funnel */
const funnelSql = lastFn('trace_campaign_funnel')
ok('funnel: contact counts only after new details', /when s1\.details_at is null then null else[\s\S]{0,200}f\.annexure_item = '7' and f\.created_at >= s1\.details_at/.test(funnelSql))
ok('...a PTP and money only after contact', /p\.created_at >= s2\.contact_at/.test(funnelSql) && /m\.created_at >= s2\.contact_at/.test(funnelSql))
ok('...money is live money only', /m\.reversed_at is null and m\.rejected_at is null and not coalesce\(m\.is_demo, false\)/.test(funnelSql))
ok('...new details: a contact added or verified, or a trace finding verified, after the referral',
  /k\.created_at >= ref\.t0/.test(funnelSql) && /k\.verified_at \+ \(select d from shift\) >= ref\.t0/.test(funnelSql) && /i\.outcome = 'verified'/.test(funnelSql))
ok('...on one clock: the firm-clock stamps are shifted onto the real one, created_at everywhere else',
  /\(now\(\) at time zone 'Africa\/Johannesburg'\)::date - public\.raptor_today\(\)/.test(funnelSql) && !/incurred_at|received_at/.test(funnelSql))
ok('...searched: a bureau report or an item 4(c) search', /account_traces/.test(funnelSql) && /f\.annexure_item = '4c'/.test(funnelSql))
const f = traceFunnel([
  { searchedAt: 'x', detailsAt: 'x', contactAt: 'x', promisedAt: 'x', promised: 1000, paid: 250 },
  { searchedAt: 'x', detailsAt: 'x', contactAt: null, promisedAt: null, promised: 0, paid: 0 },
  { searchedAt: null, detailsAt: null, contactAt: null, promisedAt: null, promised: 0, paid: 0 },
])
check('the funnel in total', f, { referred: 3, searched: 2, details: 2, contact: 1, promised: 1, promisedAmount: 1000, paid: 1, paidAmount: 250 })
ok('a trace campaign\'s preview shows what the searches would cost the debtors', /itemAmountFor\('4c', 1, 0, schedule\)/.test(read('api/_lib/campaign/call.ts'))
  && /trace-estimate/.test(read('src/pages/accounts/CallCampaignModal.tsx')))

/* ================================================================ 4. auto-dial */
const base = { enabled: true, canDial: true, isCampaignCall: true, number: '0825551234', day: '2026-11-02', minute: 10 * 60, alreadyDialled: false }
check('on, BuzzBox, a campaign call, in hours: it dials', autoDialDecision(base), { dial: true, number: '0825551234' })
check('off: nothing, and nothing said', autoDialDecision({ ...base, enabled: false }), { dial: false, why: null })
check('not a campaign call: nothing', autoDialDecision({ ...base, isCampaignCall: false }), { dial: false, why: null })
ok('without BuzzBox it says so in one line and does not dial', /BuzzBox/.test(autoDialDecision({ ...base, canDial: false }).why ?? '')
  && autoDialDecision({ ...base, canDial: false }).dial === false)
ok('never outside the calling hours', autoDialDecision({ ...base, minute: 18 * 60 }).dial === false
  && autoDialDecision({ ...base, day: '2026-11-08' }).dial === false)
check('never twice in one visit', autoDialDecision({ ...base, alreadyDialled: true }), { dial: false, why: null })
ok('the claim is given once per entry and visit', claimAutoDial('e1', 'k1') && !claimAutoDial('e1', 'k1') && autoDialClaimed('e1', 'k1')
  && claimAutoDial('e1', 'k2'))
check('the toggle reads false where storage throws', readAutoDial(), false)
check('the number is said the way it is read', dialWords('0825551234'), '082 555 1234')
const bar = read('src/components/diary/DiaryWorkBar.tsx')
ok('the bar claims before it dispatches', /if \(!claimAutoDial\(current\.id, location\.key\)\) return[\s\S]{0,200}dispatchEvent/.test(bar))
ok('...and its Stop turns auto-dial off', /const stopAutoDial = \(\) => \{ writeAutoDial\(false\)/.test(bar))
ok('the call itself is CallButton\'s own path (charged, asked about)', /latestDialled\.current\(\{ from: r\.from, to: r\.to, viaPabx: true \}\)/.test(read('src/pages/accounts/CallButton.tsx')))
ok('no new serverless function', !/autoDial|auto-dial/.test(read('api/buzzbox/[action].ts')))

if (failures.length) {
  console.error(`check-campaign-recovery: ${failures.length} failed, ${pass} passed\n  ${failures.join('\n  ')}`)
  process.exit(1)
}
console.log(`check-campaign-recovery: ${pass} passed, 0 failed`)
