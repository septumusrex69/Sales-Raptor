/**
 * KEEP A RECOVERY ACCOUNT WITHOUT A PROMISE (S10, 22 Oct).
 *
 * The firm: on a recovery call with no PTP, "the request to keep this account. If they want to keep
 * this account, they should write a reason for it, and then it can go to their names." Holds: the
 * database takes the reason through the same guarded re-open, writes it on the account and tells
 * whoever ran the campaign; the finish box offers it only on a recovery call, requires the reason
 * and a later day, and books the next date.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-recovery-keep.mjs
 */
import { readFileSync } from 'node:fs'

let pass = 0
const failures = []
const ok = (name, v) => { if (v === true) pass += 1; else failures.push(name) }
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '')

const sql = read('supabase/schema.sql')
const at = sql.lastIndexOf('create or replace function public.recovery_reopen(')
const fn = at >= 0 ? sql.slice(at, sql.indexOf('end $$;', at)) : ''
ok('the re-open takes a reason', /recovery_reopen\(p_account uuid, p_keep_reason text default null\)/.test(fn))
ok('...behind the same guards (own open recovery call, running campaign, never paid or withdrawn)',
  /d\.owner_id = v_uid/.test(fn) && /call_kind is distinct from 'recovery'/.test(fn) && /v_as in \('paid_up', 'settled'\)/.test(fn) && /v_as = 'withdrawn'/.test(fn))
ok('...the reason goes on the account', /kept without a promise, because ' \|\| v_keep/.test(fn))
ok('...and whoever ran the campaign is told', /if v_keep is not null and v_c\.created_by is not null[\s\S]{0,120}insert into public\.notifications/.test(fn))
ok('the old one-argument version is gone', /drop function if exists public\.recovery_reopen\(uuid\);/.test(sql.slice(at - 2000, at)))

const box = strip(read('src/components/diary/ClosedFinish.tsx'))
ok('the box requires a reason and a later day', /disabled=\{busy \|\| !reason\.trim\(\) \|\| dueOn <= today\}/.test(box))
for (const p of ['src/components/diary/DiaryWorkBar.tsx', 'src/components/diary/CompleteDiaryModal.tsx']) {
  const s = strip(read(p))
  ok(`${p}: offered on a recovery call only`, /onKeep=\{entry\.campaign\?\.kind === 'recovery' \?/.test(s))
  ok(`${p}: re-opened with the reason, then worked with a next date`,
    /await recoveryReopen\(entry\.accountId, reason\)\s*await workEntry\(\{[\s\S]{0,160}next: \{ comesBack: true, dueOn, kind: 'review' \}/.test(s))
}

if (failures.length) {
  console.error(`check-recovery-keep: ${failures.length} failed, ${pass} passed\n  ✗ ${failures.join('\n  ✗ ')}`)
  process.exit(1)
}
console.log(`check-recovery-keep: ${pass} passed, 0 failed`)
