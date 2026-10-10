/**
 * THE FIRM DRAWS ITS SHARE ONLY ONCE THE CLIENT HAS BEEN PAID (the firm, 10 Oct: "Bredell Ferreira can
 * only claim its part of the trust fund money once the client has been paid. So, work it out like
 * that").
 *
 * Held here:
 *   1. SETTLED is paid, or approved/sent with nothing to pay the client (net payover at or below nil);
 *      a run still being checked, a void run, or no run at all is not settled;
 *   2. a firm entry that came out of a client's money WAITS until that client's run is settled -- on
 *      a receipt by its allocation's run, on a charge set off or a PTC share by its own run -- and
 *      bank interest, a transfer in and a parked credit never wait;
 *   3. waiting entries are netted, and only a net BELOW nil reaches the drawable figure: every rule
 *      here can only lower what may be drawn, so it cannot cause a shortfall;
 *   4. draw_from_trust limits on drawable, and says which of the two reasons refused it;
 *   5. the screens offer drawable, not the whole balance, and say what waits.
 *
 * Proved live on staging (scripts/qa/live/staging-clock-sim.sql): before each cycle's runs are paid
 * the firm's share all waits and a drawing of it is refused; once the clients are paid it is drawn,
 * and the trust ends each cycle at R0.00.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-firm-drawable.mjs
 */
import { readFileSync } from 'node:fs'

let pass = 0
const failures = []
const ok = (name, actual) => { if (actual === true) { pass += 1; return } failures.push(`${name}\n    got ${JSON.stringify(actual)}`) }
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

const sql = read('supabase/schema.sql')
const lastFn = (name) => {
  const at = sql.lastIndexOf(`create or replace function public.${name}(`)
  if (at < 0) return ''
  const m = /\bas \$(\w*)\$([\s\S]*?)\$\1\$/.exec(sql.slice(at))
  return strip(m?.[2] ?? '')
}

/* ---------- 1. settled ---------- */
const settled = lastFn('firm_run_settled')
ok('settled: paid', /r\.paid_at is not null/.test(settled))
ok('...or approved with nothing to pay the client',
  /or \(r\.status in \('approved', 'sent', 'paid'\) and coalesce\(r\.net_payover, 0\) <= 0\)/.test(settled))
ok('...and no run at all is not settled', /from public\.payover_runs r where r\.id = p_run\), false\)/.test(settled))

/* ---------- 2. what waits ---------- */
const split = lastFn('firm_trust_split')
const exempt = split.indexOf("in ('credit', 'bank_interest', 'transfer_in') then false")
const byAlloc = split.indexOf('when x.allocation_id is not null then not public.firm_run_settled(a.payover_run_id)')
const byRun = split.indexOf('when x.payover_run_id is not null then not public.firm_run_settled(x.payover_run_id)')
ok('a receipt\'s share waits on its allocation\'s run', byAlloc > 0)
ok('a set-off or PTC share waits on its own run', byRun > 0)
/* PRESENCE BEFORE ORDER: an indexOf of -1 would make the order hold vacuously. */
ok('money that was never a client\'s never waits -- and is decided first', exempt > 0 && exempt < byAlloc && byAlloc < byRun)
ok('...the allocation joined, not required', /left join public\.payment_allocations a on a\.id = x\.allocation_id/.test(split))
ok('only the firm\'s entries', /where x\.party = 'firm' and \(p_company is null or x\.company_id = p_company\)/.test(split))

/* ---------- 3. it can only lower the figure ---------- */
ok('drawable = free + the waiting net only when below nil; waiting never below nil',
  /select round\(held, 2\), round\(free \+ least\(pend, 0\), 2\), round\(greatest\(pend, 0\), 2\)/.test(split))
ok('it answers only the trust or the business tick',
  /where public\.has_capability\('finance\.view'\) or public\.has_capability\('business\.view'\)/.test(split))
ok('not to anon', sql.includes('revoke all on function public.firm_trust_split(uuid) from public, anon;')
  && sql.includes('revoke all on function public.firm_run_settled(uuid) from public, anon;'))

/* ---------- 4. the drawing ---------- */
const draw = lastFn('draw_from_trust')
const readsAt = draw.indexOf('from public.firm_trust_split(p_company) s;')
const limitAt = draw.indexOf('if p_amount > coalesce(v_drawable, 0) then')
const insertAt = draw.indexOf('insert into public.trust_creditor_entries')
ok('draw_from_trust reads the split, limits on drawable, before it writes',
  readsAt > 0 && limitAt > readsAt && insertAt > limitAt)
ok('...and says it is waiting on clients when it is the firm\'s but not yet drawable',
  /if p_amount <= coalesce\(v_held, 0\) then\s+raise exception 'The firm may draw % now\. The rest of its % in trust waits until the clients it came from have been paid\.'/.test(draw))
ok('...a minus said as nothing', /else 'nothing' end/.test(draw))

/* ---------- 5. the screens ---------- */
const lib = strip(read('src/lib/trust.ts'))
ok('the screens read firm_trust_split', /supabase\.rpc\('firm_trust_split'\)/.test(lib))
const out = strip(read('src/pages/trust/TrustPaymentsOut.tsx'))
ok('Payments to make offers drawable', /available=\{Math\.max\(firm\.drawable, 0\)\}/.test(out)
  && /\{rand\(Math\.max\(firm\.drawable, 0\)\)\}/.test(out))
ok('...says what waits', /data-testid="firm-waiting"/.test(out))
ok('...and no longer offers the whole balance', !/owedToFirm/.test(out))
const drw = strip(read('src/pages/business/BusinessDrawings.tsx'))
ok('Drawings offers drawable', /<DrawModal held=\{drawable\}/.test(drw) && /disabled=\{drawable <= 0\.004\}/.test(drw))
ok('...and an unreadable split offers nothing, not the balance', /const drawable = Math\.max\(split\?\.drawable \?\? 0, 0\)/.test(drw))
const ov = strip(read('src/pages/business/BusinessOverview.tsx'))
ok('the overview says what may be drawn now', /data-testid="firm-drawable-now"/.test(ov))

/* ---------- the simulation proves it on the database ---------- */
const sim = read('scripts/qa/live/staging-clock-sim.sql')
ok('the simulation draws through draw_from_trust, the drawable amount',
  /select round\(drawable, 2\) into v_fee from public\.firm_trust_split\(\);\s+if v_fee > 0 then\s+v_entry := public\.draw_from_trust\(v_fee/.test(sim))
ok('...and expects a drawing before the clients are paid to be refused', /'The firm may draw nothing now\.%'/.test(sim))

if (failures.length > 0) console.error(failures.map((f) => `  ✗ ${f}`).join('\n'))
console.log(`check-firm-drawable: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length > 0 ? 1 : 0)
