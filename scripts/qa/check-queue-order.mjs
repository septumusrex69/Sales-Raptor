/**
 * THE APPROVAL QUEUE IN POSTING ORDER (Raptor · Handover 17, S18; Stephan, 5 Nov: "you can fix the
 * approval queue projection").
 *
 * Each waiting payment used to be previewed alone, and approve_payments posted in the order the screen
 * sent -- newest first. Held here: approval posts a debtor's payments oldest first; the projection
 * approves the earlier ones through the real posting and ALWAYS rolls them back; and the queue reads
 * the projection. The arithmetic was probed on staging (every waiting row closing to the cent, nothing
 * posted by reading the queue); this holds the shape that makes that true.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-queue-order.mjs
 */
import { readFileSync } from 'node:fs'

let pass = 0
const failures = []
const ok = (n, a) => { if (a === true) pass += 1; else failures.push(n) }

const sql = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8')
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--.*$/gm, '')
function lastFn(name) {
  const at = sql.lastIndexOf(`create or replace function public.${name}(`)
  if (at < 0) return ''
  return strip(sql.slice(at, sql.indexOf('\n$$;', at)))
}
const preview = lastFn('queue_preview')
const queue = lastFn('payments_awaiting_approval')
const approve = lastFn('approve_payments')

ok('queue_preview is in the schema', preview.length > 800)
ok('payments_awaiting_approval is in the schema', queue.length > 1500)
ok('approve_payments is in the schema', approve.length > 300)

ok('approval posts oldest first, whatever order the ids came in',
  /order by p\.received_at nulls last, p\.created_at nulls last, p\.id nulls last, x\.n/.test(approve))
ok('...and still approves each through approve_payment', /perform public\.approve_payment\(v_id\);/.test(approve))

ok('the projection approves only the EARLIER waiting payments on the same account',
  /p\.account_id = v\.account_id and p\.id <> v\.id/.test(preview)
  && /\(p\.received_at, p\.created_at, p\.id\) < \(v\.received_at, v\.created_at, v\.id\)/.test(preview))
ok('...in the order approval uses', /order by p\.received_at, p\.created_at, p\.id\s*\n\s*loop/.test(preview))
ok('...through the real posting, not a second arithmetic', /perform public\.approve_payment\(e\.id\);/.test(preview))
/* PRESENCE BEFORE ORDER: the raise must exist, and come after the preview it protects. */
const raiseAt = preview.indexOf("raise exception using errcode = 'RQSIM'")
ok('...and ALWAYS rolls them back', raiseAt > 0)
ok('...after reading the preview', raiseAt > preview.indexOf('return query select * from public.preview_allocation('))
ok('...catching only its own signal as success', /when sqlstate 'RQSIM' then return;/.test(preview))
ok('a payment with nothing waiting before it is previewed as before', /if v_earlier then[\s\S]*end if;\s*\n\s*return query select \* from public\.preview_allocation\(/.test(preview))

ok('the queue reads the projection', /left join lateral public\.queue_preview\(p\.id\) pv on true/.test(queue))
ok('...and is volatile, because what it calls writes and undoes', /language sql\s*\n\s*volatile/.test(queue))
ok('queue_preview is not offered to anyone signed out',
  /revoke all on function public\.queue_preview\(uuid\) from public, anon;/.test(sql))

/* S18, 6 Nov: the screen IS the posting order -- same-day payments on one account read top to bottom as they post. */
{
  const list = lastFn('payments_awaiting_approval') + '\n$$'
  const post = lastFn('approve_payments')
  ok('the queue is listed oldest first, received then captured then id', /order by p\.received_at, p\.created_at, p\.id\s*\$\$/.test(list))
  ok('...the order approval posts them in', /order by p\.received_at nulls last, p\.created_at nulls last, p\.id nulls last/.test(post))
  ok('...and the one each row is previewed in', /order by p\.received_at, p\.created_at, p\.id/.test(lastFn('queue_preview')))
}

console.log(`${pass} passed, ${failures.length} failed`)
if (failures.length) { for (const f of failures) console.log(`  FAIL ${f}`); process.exit(1) }
