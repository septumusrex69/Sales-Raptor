/**
 * THE PAID-UP LETTER: AUTOMATIC, BY EMAIL, NEVER AN SMS, NEVER CHARGED (S15, Raptor · Handover 14).
 *
 * Stephan: "I don't want to see an SMS go out. It's a waste of money. But we can send a letter to a guy
 * who's paid up his account, even though if that is a small balance." Asked: automatically; a small
 * balance waived gets the same letter; no email address is noted on the account.
 *
 * What would go wrong quietly, and so what this holds:
 *   - an R25 fee raised on the letter, putting a balance back on an account the letter says owes nothing;
 *   - an SMS step creeping into the workflow;
 *   - the run started BEFORE closing stops every sequence (and so stopped by it);
 *   - a settlement the client agreed getting a letter that says "paid up";
 *   - the covering email promising an attachment it does not carry.
 *
 * Run: node scripts/qa/check-paid-up-letter.mjs
 */
import { readFileSync } from 'node:fs'

let pass = 0
const failures = []
const ok = (name, cond) => { if (cond) pass += 1; else failures.push(name) }
const read = (f) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')
const sql = read('supabase/schema.sql')
const lastFn = (name) => {
  const at = sql.lastIndexOf(`create or replace function public.${name}(`)
  if (at < 0) return ''
  const opens = sql.indexOf('as $$', at)
  return sql.slice(opens, sql.indexOf('end $$;', opens))
}

/* ---------- not charged ---------- */
const send = read('src/lib/workflowSend.ts')
ok('planSend takes whether the account is closed paid', /paidUp\?: boolean/.test(send))
ok('...and quotes no charge when it is', /const charge = input\.paidUp \? null : quote\(node, body, dueOn\)/.test(send))
const step = read('api/_lib/workflow/step.ts')
ok('the runner says so for paid up AND settled', /paidUp: account\.ended_as === 'paid_up' \|\| account\.ended_as === 'settled'/.test(step))

/* ---------- started on close, after everything else is stopped ---------- */
const settle = lastFn('settle_account')
const stopAt = settle.indexOf('perform public.stop_workflows_on_close(')
const startAt = settle.indexOf("v.trigger_kind = 'account_paid_up'")
ok('closing starts the paid-up letter', startAt >= 0)
ok('...after it stops every other sequence', stopAt >= 0 && startAt > stopAt)
ok('...for paid up, and for settled only with no approved settlement paid',
  /if p_as = 'paid_up'\s+or \(p_as = 'settled' and not exists \(\s+select 1 from public\.account_settlements s where s\.account_id = p_account and s\.status = 'paid'\)\)/.test(settle))
ok('...once per account and version, ever',
  /not exists \(select 1 from public\.workflow_runs r where r\.account_id = p_account and r\.version_id = v\.id\)/.test(settle))
ok('the database allows the trigger', /'account_paid_up'\]\)\)/.test(sql))
const builder = read('src/lib/workflowBuilder.ts')
ok('...and the library names it', /account_paid_up: \{ label: 'An account is closed as paid up'/.test(builder) && /'account_paid_up', 'by_hand'/.test(builder))

/* ---------- email only ---------- */
const seed = sql.slice(sql.lastIndexOf("if exists (select 1 from public.workflows where key = 'paid-up-letter')"))
ok('the workflow is seeded', seed.length > 0 && /'paid-up-letter', 'Paid-up letter'/.test(seed))
ok('...with one step, by email', /'paid-up-email', 'communication', 'Paid-up letter'/.test(seed) && /0, 'email',/.test(seed))
ok('...and no SMS step at all', !/'sms'/.test(seed.slice(0, seed.indexOf('end $$;'))))

/* ---------- the email carries the letter ---------- */
const attaches = JSON.parse(read('scripts/letters/attachments.json'))
ok('the paid-up emails attach the paid-up letters',
  attaches['email-paid-up-individual'] === 'letter-paid-up-individual' && attaches['email-paid-up-company'] === 'letter-paid-up-company')
const letters = JSON.parse(read('scripts/letters/letters.json'))
const text = (k) => JSON.stringify(letters[k] ?? '')
ok('the letter says nothing is owing', /Amount still owing/.test(text('letter-paid-up-individual')) && /"Nothing"/.test(text('letter-paid-up-individual')))
ok('...quotes no balance, so a waived few rand are never mentioned', !/\{\{balance\}\}|\{\{paid_to_date\}\}/.test(text('letter-paid-up-individual') + text('letter-paid-up-company')))
ok('...and says it went by email alone', /Sent by email\. Proof/.test(text('letter-paid-up-company')) && !/notification by SMS/.test(text('letter-paid-up-individual')))

if (failures.length) { console.error(`check-paid-up-letter: ${failures.length} failed, ${pass} passed\n  ✗ ${failures.join('\n  ✗ ')}`); process.exit(1) }
console.log(`check-paid-up-letter: ${pass} passed, 0 failed`)
