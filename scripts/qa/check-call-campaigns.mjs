/**
 * CALL CAMPAIGNS (S10, 21 Oct): accounts onto the collectors' diaries, worked NOW above everything
 * or SPREAD to an end date at a chosen place, into the room each collector keeps free.
 *
 * Holds:
 *   1. the planner -- now puts everything on today and says who goes over; spread shares evenly,
 *      never past a day's room, and reports what does not fit rather than overfilling;
 *   2. the order -- a NOW call above a broken PTP and above an account about to prescribe, in every
 *      order an agent can choose; a spread call between the rungs it was placed between;
 *   3. the database -- the ladder, the stored priority honouring the rank, a campaign call beside the
 *      account's own diary date and not instead of it, the diary date ignoring calls, the ending;
 *   4. the diary code -- booking a date never takes a campaign call off, a call is never moved;
 *   5. who -- a liaison on their own clients, a Liaison Manager on their team's;
 *   6. the sender leaves call campaigns alone, Stop and the cron end them.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-call-campaigns.mjs
 */
import { readFileSync } from 'node:fs'
import {
  planCalls, callDays, endDateProblem, SPREAD_RANKS, NOW_RANK, STANDARD_DAY, callConfirmation,
} from '../../src/lib/callCampaign.ts'
import {
  DEFAULT_DIARY_CAPACITY, DIARY_PRIORITY, BOOKABLE_KINDS, sortDiary, orderDiary, workedNow,
} from '../../src/lib/diaryPriority.ts'
import { callSkip, mayCampaignOn } from '../../src/lib/campaigns.ts'
import { ROLE_CAPABILITIES } from '../../src/lib/capabilities.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, v) => check(name, v, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/^\s*--.*$/gm, '')

/* ---------- 1. the planner ---------- */
// Mon 2 Nov 2026 to Fri 6 Nov: five working days.
const week = callDays('2026-11-02', '2026-11-06')
check('a working week is five days', week.length, 5)
check('a weekend is not a call day', callDays('2026-11-07', '2026-11-08'), [])

const twenty = Array.from({ length: 20 }, (_, i) => ({ accountId: `a${i}`, ownerId: 'thabo' }))
const spread = planCalls({
  mode: 'spread', today: '2026-11-02', endsOn: '2026-11-06', accounts: twenty,
  capacityOf: () => 50, loadOf: () => 40,
})
const perDay = (plan) => Object.fromEntries(week.map((d) => [d, plan.placed.filter((p) => p.dueOn === d).length]))
check('spread: twenty over five days is four a day', perDay(spread), Object.fromEntries(week.map((d) => [d, 4])))
check('...nothing left over', spread.unplaced.length, 0)

const tight = planCalls({
  mode: 'spread', today: '2026-11-02', endsOn: '2026-11-06', accounts: twenty,
  capacityOf: () => 50, loadOf: (o, d) => (d === '2026-11-02' ? 50 : 48),
})
check('spread: a full day takes none, the rest only their room', perDay(tight),
  { '2026-11-02': 0, '2026-11-03': 2, '2026-11-04': 2, '2026-11-05': 2, '2026-11-06': 2 })
check('...and what does not fit is reported, not crammed in', tight.unplaced.length, 12)
ok('...no day past the capacity', week.every((d) => (d === '2026-11-02' ? 50 : 48) + perDay(tight)[d] <= 50))

const now = planCalls({
  mode: 'now', today: '2026-11-02', endsOn: '2026-11-02', accounts: twenty,
  capacityOf: () => 50, loadOf: () => 45,
})
ok('now: every call on today', now.placed.length === 20 && now.placed.every((p) => p.dueOn === '2026-11-02'))
check('now: over capacity is shown, not solved', now.over.get('thabo'), 15)
check('now: nothing left off', now.unplaced.length, 0)

check('the end date: gone', endDateProblem('spread', '2026-11-02', '2026-11-01'), 'The end date has already gone.')
check('the end date: needed for spread only', endDateProblem('now', '2026-11-02', null), null)
ok('the end date: none chosen is a problem', endDateProblem('spread', '2026-11-02', null) !== null)
check('the server\'s standard day is the diary\'s', STANDARD_DAY, DEFAULT_DIARY_CAPACITY)
ok('the confirmation says missed calls still count', /still counted as missed/.test(callConfirmation({
  name: 'x', mode: 'now', rank: 5, endsOn: '2026-11-02', placing: 3, collectors: 1, skipped: 0, unplaced: 0, overCollectors: 0, endWords: '',
})))

/* ---------- 2. the order ---------- */
check('NOW sits above a broken promise', NOW_RANK < DIARY_PRIORITY.promise_broken, true)
ok('a spread campaign is never above a broken promise, nor tied with a rung',
  SPREAD_RANKS.every((r) => r.rank > DIARY_PRIORITY.promise_broken && r.rank < DIARY_PRIORITY.review
    && !Object.values(DIARY_PRIORITY).includes(r.rank)))
const today = '2026-11-02'
const day = [
  { id: 'review', kind: 'review', dueOn: today },
  { id: 'broken', kind: 'promise_broken', dueOn: today },
  { id: 'prescribing', kind: 'review', dueOn: today, prescriptionOn: '2026-11-20' },
  { id: 'new', kind: 'new_account', dueOn: today },
  { id: 'spread15', kind: 'campaign', rank: 15, dueOn: today },
  { id: 'now', kind: 'campaign', rank: 5, dueOn: today },
]
check('the day: now first -- above prescription -- and spread where it was put',
  sortDiary(day, today).map((e) => e.id), ['now', 'prescribing', 'broken', 'spread15', 'new', 'review'])
for (const order of ['amount', 'oldest', 'first:review']) {
  check(`...and now stays first when the agent sorts "${order}"`, orderDiary(day, order, today)[0].id, 'now')
}
ok('a spread call is not "now"', !workedNow({ kind: 'campaign', rank: 15 }))
ok('nobody books a campaign call by hand', !BOOKABLE_KINDS.includes('campaign'))
for (const f of ['src/components/diary/NextDiaryFields.tsx', 'src/components/diary/DiariseModal.tsx']) {
  ok(`${f} offers only bookable kinds`, /BOOKABLE_KINDS\.map/.test(read(f)) && !/DIARY_KIND_ORDER\.map/.test(read(f)))
}

/* ---------- 3. the database ---------- */
const sql = read('supabase/schema.sql')
const lastFn = (name) => {
  const at = sql.lastIndexOf(`create or replace function public.${name}(`)
  if (at < 0) return ''
  const m = /\bas\s+\$(\w*)\$([\s\S]*?)\$\1\$/i.exec(sql.slice(at))
  return m ? m[2] : ''
}
ok('the ladder: a campaign is 5', /when 'campaign'\s+then 5/.test(lastFn('diary_priority')))
ok('the stored priority honours the rank', /alter column priority set expression as \(coalesce\(rank, public\.diary_priority\(kind\)\)\)/.test(sql))
const lastIndex = (name) => {
  const all = [...sql.matchAll(new RegExp(`create unique index if not exists ${name}\\s+on ([^;]+);`, 'g'))]
  return all.length ? all[all.length - 1][1] : ''
}
ok('one diary date per account still -- counting every kind but a campaign call',
  /where state = 'open' and kind <> 'campaign'/.test(lastIndex('diary_entries_one_open_per_account')))
ok('...and one campaign call per account at a time',
  /where state = 'open' and kind = 'campaign'/.test(lastIndex('diary_entries_one_open_campaign_call')))
ok('the account\'s diary date ignores campaign calls', /kind <> 'campaign'/.test(lastFn('sync_account_diary_date')))
ok('a campaign call carries its campaign, and only it a rank',
  /\(kind = 'campaign'\) = \(campaign_id is not null\) and \(rank is null or kind = 'campaign'\)/.test(sql))
const expire = lastFn('call_campaigns_expire')
ok('ending cancels what is open and keeps the day', /set state = 'cancelled'/.test(expire) && !/due_on\s*=/.test(expire))
ok('...only the server may end one', /revoke all on function public\.call_campaigns_expire\(uuid, uuid\) from public, anon, authenticated;/.test(sql))
ok('the counts are one row per campaign', /group by x\.campaign_id/.test(lastFn('campaign_counts')))

/* ---------- 4. the diary code ---------- */
const diary = strip(read('src/lib/diary.ts'))
const diarise = diary.slice(diary.indexOf('export async function diarise('), diary.indexOf('export async function completeEntry('))
ok('booking a date never takes a campaign call off', /\.eq\('state', 'open'\)\s*\.neq\('kind', 'campaign'\)/.test(diarise))
ok('...nor books one', /if \(input\.kind === 'campaign'\) throw/.test(diarise))
ok('a call is never moved', /if \(input\.entry\.kind === 'campaign'\) throw/.test(diary))
ok('"has a diary date" means its own', /\.eq\('account_id', accountId\)\s*\.eq\('state', 'open'\)\s*\.neq\('kind', 'campaign'\)/.test(diary))
ok('the hand-out supersedes only the account\'s own date', /\.eq\('state', 'open'\)\s*\.neq\('kind', 'campaign'\)/.test(strip(read('src/lib/handOutWrite.ts'))))
ok('the day list carries the campaign\'s script, and what kind of campaign it is',
  /campaigns!diary_entries_campaign_id_fkey \( name, body, ends_on, call_kind, status \)/.test(diary))

/* ---------- 5. who ---------- */
const person = (id, role, teamId = null) => ({ id, role, teamId })
const liaison = person('lia', 'Liaison', 'liaisons')
const desk = person('col', 'Pre-legal Agent', 'floor-a')
ok('a liaison on their own client, whoever\'s desk', mayCampaignOn(liaison, desk, liaison))
ok('...not on somebody else\'s client', !mayCampaignOn(liaison, desk, person('other', 'Liaison', 'liaisons')))
ok('a Liaison Manager on their team\'s liaisons\' clients',
  mayCampaignOn(person('mgr', 'Liaison Manager', 'liaisons'), desk, person('other', 'Liaison', 'liaisons')))
ok('...not another team\'s', !mayCampaignOn(person('mgr', 'Liaison Manager', 'liaisons'), desk, person('x', 'Liaison', 'elsewhere')))
ok('a collector runs none', !mayCampaignOn(person('col', 'Pre-legal Agent', 'floor-a'), desk, null))
ok('both liaison roles hold the tick', ROLE_CAPABILITIES.Liaison.includes('campaign.run') && ROLE_CAPABILITIES['Liaison Manager'].includes('campaign.run'))
const base = { book: 'active', holdReason: null, prescribed: false, debtorKind: 'individual', mobile: '0821234567', email: null, openDispute: false, workflowToday: true, assignedTo: 'col', onCallCampaign: false }
check('a call: a workflow notice today is not a skip', callSkip(base), null)
check('...nobody\'s desk is', callSkip({ ...base, assignedTo: null }), 'no_desk')
check('...no number is', callSkip({ ...base, mobile: null }), 'no_phone')
check('...one campaign call at a time', callSkip({ ...base, onCallCampaign: true }), 'on_call_campaign')
check('...a frozen account before anything else', callSkip({ ...base, book: 'on_hold', assignedTo: null }), 'on_hold')

/* ---------- 6. the sender, Stop and the cron ---------- */
const send = strip(read('api/_lib/campaign/send.ts'))
ok('the message sender leaves call campaigns alone', /\.eq\('status', 'sending'\)\.neq\('channel', 'call'\)/.test(send))
ok('Stop on a call campaign takes its calls off the diaries', /kind\?\.channel === 'call'[\s\S]{0,200}call_campaigns_expire/.test(send))
ok('the cron ends campaigns past their day', /rpc\('call_campaigns_expire', \{\}\)/.test(strip(read('api/_lib/email/sync-all.ts'))))
const call = strip(read('api/_lib/campaign/call.ts'))
ok('the server checks scope for every account, liaison included', /mayCampaignOn\(caller, holder, liaison\)/.test(call))
ok('...and refuses a selection with any outside it', /if \(b\.outOfScope > 0\)/.test(call))
ok('the page does not push call campaigns through the sender', /r\.status === 'sending' && r\.channel !== 'call'/.test(read('src/pages/accounts/CampaignsPage.tsx')))

if (failures.length) {
  console.error(`check-call-campaigns: ${failures.length} failed, ${pass} passed\n  ${failures.join('\n  ')}`)
  process.exit(1)
}
console.log(`check-call-campaigns: ${pass} passed, 0 failed`)
