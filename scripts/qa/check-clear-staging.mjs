/**
 * CLEAR STAGING CANNOT BE BROKEN BY A NEW TABLE (S10, prompt 13 item 14).
 *
 * On 21 Oct the firm pressed Clear staging and got "cannot truncate a table referenced in a foreign
 * key constraint -- account_settlements references account_documents". Its lists were kept by hand
 * while tables were added around them. This check does not keep a third list: it reads every foreign
 * key out of schema.sql (scripts/qa/schemaForeignKeys.mjs, checked against staging's pg_constraint)
 * and holds the LAST clear_staging to them:
 *
 *   1. every table with a key INTO a truncated table is in the same truncate -- what Postgres demands;
 *   2. every key into a table removed row by row either cascades / sets null, or comes from a table
 *      already emptied by then (the truncate, or one removed earlier in the order);
 *   3. what the firm keeps -- people, mail, templates, workflows, settings, the clock -- is in neither;
 *   4. the four tables named in the failure and the prompt are cleared.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-clear-staging.mjs
 */
import { readFileSync } from 'node:fs'
import { foreignKeys } from './schemaForeignKeys.mjs'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, v) => check(name, v, true)

const sql = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8')
const lower = sql.toLowerCase()
const at = lower.lastIndexOf('create or replace function public.clear_staging(')
ok('clear_staging is in schema.sql', at >= 0)
const m = /\bas\s+\$(\w*)\$([\s\S]*?)\$\1\$/i.exec(sql.slice(Math.max(at, 0)))
const body = (m?.[2] ?? '').replace(/--[^\n]*/g, '')

// The truncate is built as 'trunc' || 'ate table ...' || '...' (the MCP tools hang on the plain
// word), so join the string pieces back up before reading the table names out of it.
const tr = /'trunc'\s*\|\|\s*'ate table ([\s\S]*?)';/.exec(body)
const truncated = tr ? tr[1].replace(/'\s*\|\|\s*'/g, '').split(',').map((t) => t.trim().replace(/^public\./, '')) : []
const removed = [...body.matchAll(/'de'\s*\|\|\s*'lete from public\.([a-z_]+)'/g)].map((x) => x[1])
ok('there is one truncate', truncated.length > 20)
ok('...and it comes before every row-by-row removal',
  tr !== null && removed.length > 0 && body.indexOf(tr[0]) < body.indexOf("'de' || 'lete"))
check('...and exactly one truncate statement', (body.match(/'trunc'\s*\|\|\s*'ate/g) ?? []).length, 1)

const keys = foreignKeys(sql)
ok('the schema reader finds the keys (sanity)', keys.length > 150)

// 1. Postgres refuses a truncate when any table outside it points in, whatever the key's action.
const tset = new Set(truncated)
const outside = keys.filter((k) => tset.has(k.to) && !tset.has(k.from)).map((k) => `${k.from}.${k.column} -> ${k.to}`)
check('every table pointing into the truncate is in it', [...new Set(outside)], [])

// 2. A row-by-row removal is refused by a no-action / restrict key from a table that still has rows.
const blocked = []
removed.forEach((t, i) => {
  const emptied = new Set([...truncated, ...removed.slice(0, i), t])
  for (const k of keys.filter((x) => x.to === t)) {
    if (emptied.has(k.from)) continue
    if (k.onDelete === 'c' || k.onDelete === 'n') continue
    blocked.push(`${k.from}.${k.column} -> ${t} (${k.onDelete})`)
  }
})
check('every key into a removed table lets it go', blocked, [])

// 3. What the firm keeps.
const KEPT = ['profiles', 'teams', 'departments', 'user_emails', 'calendar_events', 'email_connections', 'message_templates',
  'workflows', 'workflow_versions', 'workflow_nodes', 'workflow_phases', 'workflow_connections',
  'firm_settings', 'finance_setting_changes', 'staging_clock', 'deployment', 'mail_blocks',
  'mail_sender_rules', 'mail_recipient_hidden', 'buzzbox_settings']
check('nothing the firm keeps is cleared', KEPT.filter((t) => tset.has(t) || removed.includes(t)), [])

// 4. The failure of 21 Oct and the tables the prompt named.
for (const t of ['account_settlements', 'signing_requests', 'handover_drafts', 'account_balances']) {
  ok(`${t} is cleared`, tset.has(t) || removed.includes(t))
}
ok('debtor_accounts goes before companies (its key restricts)',
  removed.indexOf('debtor_accounts') >= 0 && removed.indexOf('debtor_accounts') < removed.indexOf('companies'))

// The reader itself: a key declared inline, by add column, and by a named constraint.
const tiny = `create table public.a (id uuid primary key);
create table public.b (id uuid, a_id uuid references public.a (id) on delete cascade, note text default 'references public.z');
alter table public.c add column if not exists a_id uuid references public.a(id);
alter table public.d add constraint d_a foreign key (x) references public.a (id) on delete set null;
create or replace function f() returns void language sql as $$ select 1 from x references public.q $$;
alter table public.d drop constraint d_a;`
check('the reader: inline, add column, named; strings and bodies ignored; a dropped key goes',
  foreignKeys(tiny).map((k) => `${k.from}.${k.column}>${k.to}:${k.onDelete}`), ['b.a_id>a:c', 'c.a_id>a:a'])

if (failures.length) {
  console.error(`check-clear-staging: ${failures.length} failed, ${pass} passed\n  ${failures.join('\n  ')}`)
  process.exit(1)
}
console.log(`check-clear-staging: ${pass} passed, 0 failed`)
