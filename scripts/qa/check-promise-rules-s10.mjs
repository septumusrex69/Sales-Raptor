/**
 * ONE LIVE PROMISE PER ACCOUNT, AND A BROKEN ARRANGEMENT GOES BACK TO SECTION 129 (S10, prompt 13
 * items 9 and 10). Probed on staging (S10): a second open promise was refused with the sentence, and
 * breaking the first started exactly one section 129 run on an account that had none.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-promise-rules-s10.mjs
 */
import { readFileSync } from 'node:fs'

let pass = 0
const failures = []
const ok = (name, v) => { if (v === true) pass += 1; else failures.push(name) }
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const sql = read('supabase/schema.sql')
const lastFn = (name) => {
  const at = sql.lastIndexOf(`create or replace function public.${name}(`)
  if (at < 0) return ''
  const m = /\bas\s+\$(\w*)\$([\s\S]*?)\$\1\$/i.exec(sql.slice(at))
  return (m?.[2] ?? '').replace(/--[^\n]*/g, '')
}

/* ---------- 10 ---------- */
const one = lastFn('refuse_second_live_promise')
ok('a second live promise is refused, open or defaulted',
  /p\.id <> new\.id and p\.status in \('open', 'defaulted'\)/.test(one) && /new\.status in \('open', 'defaulted'\)/.test(one))
ok('...in a sentence that says what to do', /Record what became of it \(kept, broken or cancelled\) before making another/.test(one))
ok('...on insert and on a revival', /create or replace trigger promises_one_live_per_account\s+before insert or update of status on public\.promises_to_pay/.test(sql))
ok('...with the unique index as the backstop',
  /create unique index if not exists promises_to_pay_one_live\s+on public\.promises_to_pay \(account_id\) where status in \('open', 'defaulted'\)/.test(sql))
const page = read('src/pages/accounts/AccountDetail.tsx')
ok('the panel does not offer "Take one" while one is live', /outstanding\.length > 0 && !open\s+\? <span[^>]*data-testid="one-live-promise"/.test(page))

/* ---------- 9 ---------- */
const broke = lastFn('workflow_resume_on_promise_broken')
ok('on broken, the held sequence resumes as before', /perform public\.workflow_resume_account\(new\.account_id, 'promise_broken', 'promise'\)/.test(broke))
ok('...and a section 129 starts where the account never had one',
  /v_version := public\.section_129_version\(\)/.test(broke)
  && /insert into public\.workflow_runs \(account_id, version_id, started_on, started_by\)\s+values \(new\.account_id, v_version, public\.raptor_today\(\), new\.resolved_by\)/.test(broke))
ok('...once per account ever, across every version of it', /rv\.workflow_id = \(select workflow_id from public\.workflow_versions where id = v_version\)/.test(broke))
ok('...not over another live promise', /p\.id <> new\.id and p\.status in \('open', 'defaulted'\)/.test(broke))
ok('...nor an open dispute', /q\.kind = 'dispute' and q\.status <> 'closed'/.test(broke))
ok('...nor a closed account', /a\.ended_as is null/.test(broke))
ok('...only on the move INTO broken', /if new\.status = 'broken' and coalesce\(old\.status, ''\) <> 'broken' then/.test(broke))
const which = lastFn('section_129_version')
ok('the section 129 is the active by-hand version with statutory steps',
  /v\.state = 'active' and v\.trigger_kind = 'by_hand'/.test(which) && /n\.statutory/.test(which))

if (failures.length) {
  console.error(`check-promise-rules-s10: ${failures.length} failed, ${pass} passed\n  ✗ ${failures.join('\n  ✗ ')}`)
  process.exit(1)
}
console.log(`check-promise-rules-s10: ${pass} passed, 0 failed`)
