/**
 * TRUST AND BUSINESS ARE TWO PLACES, AND NOTHING MAY QUIETLY REJOIN THEM.
 *
 * THE FIRM: "the trust and the business should be separated. It shouldn't be in the same tab in
 * finance. It should be like outside, for example. So the trust, we have one place where we manage
 * the trust and we have another place outside where we manage the business."
 *
 * WHAT THIS GUARDS, AND WHY EACH ONE IS HERE RATHER THAN TRUSTED:
 *
 * 1. THE TWO MENU ITEMS ASK DIFFERENT QUESTIONS. The split is only worth the churn if the ticks
 *    are separate; one predicate behind both items would be the old single Finance gate wearing
 *    two labels, and nobody would notice until a bookkeeper could open a payover run.
 *
 * 2. NO SCREEN IS REACHABLE FROM THE WRONG WORKSPACE. Back office is the firm's own income and
 *    spent its life fifth in a strip of TRUST screens. It is the one that has moved, so it is the
 *    one most likely to be moved back by somebody tidying.
 *
 * 3. EVERY OLD /finance ADDRESS STILL LANDS. The payover queue is linked from mail the firm has
 *    already sent and cannot edit. A redirect quietly dropped in a later refactor breaks a link in
 *    somebody's inbox, which is the kind of failure nobody reports -- they just stop using it.
 *
 * 4. A RAIL ITEM POINTS AT A ROUTE THAT EXISTS. This is the one that would otherwise rot: the
 *    trust ledger is BUILT IN THE DATABASE and has no page, so the temptation to list it is real.
 *    A menu item that goes nowhere is a menu that lies, and the app has already paid for that once
 *    -- "a menu item that always refuses is worse than no menu item".
 *
 * 5. THE TAB STRIP IS GONE AND STAYS GONE. Re-adding FinanceTabs beside the rail would give two
 *    navigations for one section, which is how the strip got crowded in the first place.
 *
 * 6. business.view DOES NOT CLAIM AN ENFORCEMENT IT LACKS. capabilities.ts's own rule: only what
 *    is enforced goes in, and a tick drawn on the settings screen that nothing checks is worse
 *    than the missing rule it pretends to be. Nothing in the database gates the business side yet,
 *    so `inDatabase` must stay off until the first table arrives with a policy.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-workspace-split.mjs
 */
import { readFileSync } from 'node:fs'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const no = (name, actual) => check(name, actual, false)

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
/* Comments quote the routes they explain, so an assertion read against the raw file can pass on
   prose. Every structural assertion below runs against this. */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const app = strip(read('src/App.tsx'))
const sidebar = strip(read('src/components/layout/Sidebar.tsx'))
const rail = strip(read('src/components/layout/WorkspaceRail.tsx'))
const trustLayout = strip(read('src/pages/trust/TrustLayout.tsx'))
const businessLayout = strip(read('src/pages/business/BusinessLayout.tsx'))
const caps = read('src/lib/capabilities.ts')
const perms = strip(read('src/lib/permissions.ts'))

/* ------------------------- 1. two items, two different ticks ------------------------- */

ok('the sidebar has a Trust item', /\{ to: '\/trust', label: 'Trust'/.test(sidebar))
ok('the sidebar has a Business item', /\{ to: '\/business', label: 'Business'/.test(sidebar))
/* "Finance" was the word doing the damage: one heading over both books says they are one pot. */
no('and no Finance item is left', /\{ to: '\/finance'/.test(sidebar))
no('...nor a Finance label', /label: 'Finance'/.test(sidebar))

ok('Trust is gated', /n\.to !== '\/trust' \|\| canViewFinance\(currentUser\)/.test(sidebar))
ok('Business is gated', /n\.to !== '\/business' \|\| canViewBusiness\(currentUser\)/.test(sidebar))
/*
 * THE POINT OF THE WHOLE SPLIT, ASSERTED DIRECTLY. Two items behind ONE predicate is the old gate
 * with two labels on it.
 */
const trustGate = sidebar.match(/n\.to !== '\/trust' \|\| (\w+)\(/)?.[1]
const businessGate = sidebar.match(/n\.to !== '\/business' \|\| (\w+)\(/)?.[1]
ok('both gates were found', !!trustGate && !!businessGate)
no('and they are not the same predicate', trustGate === businessGate)

ok('canViewTrust exists', /export function canViewTrust\(/.test(perms))
ok('canViewBusiness exists', /export function canViewBusiness\(/.test(perms))
/* finance.view is written into RLS and into live profiles' grants; the trust predicate must keep
   asking for it rather than being "improved" to a new name that no policy knows. */
ok('trust still asks finance.view', /canViewTrust[\s\S]{0,160}?can\(user, 'finance\.view'\)/.test(perms))
ok('business asks business.view', /canViewBusiness[\s\S]{0,160}?can\(user, 'business\.view'\)/.test(perms))

/* ------------------------- 2. nothing is in the wrong workspace ------------------------- */

/* The routes nested under each workspace's <Route>, read as two slices of App.tsx. */
const trustBlock = app.slice(
  app.indexOf('<Route path="/trust"'),
  app.indexOf('<Route path="/business"'),
)
const businessBlock = app.slice(
  app.indexOf('<Route path="/business"'),
  app.indexOf('<Route path="/finance"'),
)
ok('the trust routes were found', trustBlock.length > 0)
ok('the business routes were found', businessBlock.length > 0)

/*
 * BACK OFFICE IS THE FIRM'S OWN INCOME. Asserted in BOTH directions: present where it belongs and
 * absent where it used to be. One direction only and moving it back passes half the check.
 */
ok('back office is a business route', /path="back-office"/.test(businessBlock))
no('...and not a trust one', /back-office/.test(trustBlock))
ok('...and it is not re-listed in the trust rail', !/back-office/.test(trustLayout))

/* The six that ARE trust screens, each asserted where it lives. */
for (const path of ['payments', 'check', 'payover', 'runs/:id', 'exceptions', 'settings']) {
  ok(`${path} is a trust route`, trustBlock.includes(`path="${path}"`))
}
ok('the trust overview is the index', /<Route index element=\{<TrustOverview \/>\}/.test(trustBlock))
ok('the business overview is the index', /<Route index element=\{<BusinessOverview \/>\}/.test(businessBlock))

/* Each workspace behind its OWN guard, which is where a URL typed by hand is actually stopped. */
ok('trust is behind RequireFinance', /<Route path="\/trust" element=\{<RequireFinance>/.test(app))
ok('business is behind RequireBusiness', /<Route path="\/business" element=\{<RequireBusiness>/.test(app))

/* ------------------------- 3. every old address still lands ------------------------- */

/*
 * THE WHOLE SET, NAMED. A loop over "whatever redirects exist" would pass on an empty list, which
 * is exactly the vacuous assertion this file's siblings were caught on.
 */
const MOVED = [
  ['/finance', '/trust'],
  ['/finance/payments', '/trust/payments'],
  ['/finance/check', '/trust/check'],
  ['/finance/payover', '/trust/payover'],
  ['/finance/exceptions', '/trust/exceptions'],
  ['/finance/settings', '/trust/settings'],
  /* The one that changed WORKSPACE rather than only address. */
  ['/finance/back-office', '/business/back-office'],
]
for (const [from, to] of MOVED) {
  ok(`${from} still lands, at ${to}`,
    new RegExp(`<Route path="${from}" element=\\{<Navigate to="${to}" replace \\/>\\}`).test(app))
}
/*
 * THE RUN DETAIL CARRIES AN ID, so it cannot be a plain <Navigate> -- the id has to be read off
 * the old URL and put back into the new one. It is the one most worth keeping: a run's page is
 * what the firm links to when they send somebody a payover, and those links are in sent mail.
 */
ok('a run keeps its old address', /<Route path="\/finance\/runs\/:id" element=\{<RunRedirect \/>\}/.test(app))
ok('...and the redirect carries the id', /to=\{`\/trust\/runs\/\$\{id\}`\}/.test(app))

/* AND NOTHING STILL LINKS TO THE OLD PLACE from inside the app. A redirect is for other people's
   bookmarks, not for our own <Link>s -- one that bounces through a redirect works and is a bug. */
const LINKING = [
  'src/pages/finance/FinanceWorkQueue.tsx', 'src/pages/finance/RunDetail.tsx',
  'src/pages/accounts/LedgerPanel.tsx', 'src/pages/trust/TrustOverview.tsx',
  'src/pages/business/BusinessOverview.tsx',
]
for (const f of LINKING) {
  no(`${f.split('/').pop()} does not link to /finance`, /['"`]\/finance/.test(strip(read(f))))
}

/* ------------------------- 4. a rail item opens something ------------------------- */

/*
 * THE ONE MOST LIKELY TO ROT. The trust ledger, client charges and the drawing to business are all
 * live in the DATABASE with no page; listing one here would draw a menu item that goes nowhere.
 * So every `to:` in either rail must match a route that actually exists.
 */
const railTargets = (src) => [...src.matchAll(/to: '(\/[^']*)'/g)].map((m) => m[1])
const trustTargets = railTargets(trustLayout)
const businessTargets = railTargets(businessLayout)
/* Read the count first: a loop over an empty list passes vacuously, which is this file's
   sibling-check trap written down. */
check('the trust rail has its five, settings and the door', trustTargets.length, 7)
check('the business rail has its two and the door', businessTargets.length, 3)

const routeExists = (to) => {
  if (to === '/trust') return /<Route path="\/trust"/.test(app)
  if (to === '/business') return /<Route path="\/business"/.test(app)
  const [, workspace, ...rest] = to.split('/')
  const block = workspace === 'trust' ? trustBlock : businessBlock
  return block.includes(`path="${rest.join('/')}"`)
}
for (const to of [...trustTargets, ...businessTargets]) {
  ok(`${to} opens a real route`, routeExists(to))
}

/* THE LEDGER IS NOT LISTED, and this is the assertion that will fail the day somebody adds it
   without a page. It is phrased as "absent" rather than "never mentioned" so the comment
   explaining WHY it is absent can stay. */
no('the trust ledger is not in the rail yet', trustTargets.includes('/trust/ledger'))

/* Each rail carries a door to the other book, which is how somebody crosses without a tab. */
ok('trust has a door to business', trustTargets.includes('/business'))
ok('business has a door to trust', trustTargets.includes('/trust') || businessTargets.includes('/trust'))

/* ------------------------- 5. the strip is gone ------------------------- */

for (const f of [
  'src/pages/finance/FinancePayments.tsx', 'src/pages/finance/CheckPayments.tsx',
  'src/pages/finance/FinanceWorkQueue.tsx', 'src/pages/finance/FinanceExceptions.tsx',
  'src/pages/finance/FinanceSettings.tsx', 'src/pages/finance/BackOffice.tsx',
]) {
  no(`${f.split('/').pop()} draws no tab strip`, /<FinanceTabs/.test(read(f)))
}

/* The rail is a column in the page with its own fold key, the way Settings has worked since the
   firm asked for that pane to collapse -- not a third bar of chrome. */
ok('the rail folds', /useCollapsed\('crm\.workspaceNav\.collapsed'\)/.test(rail))
/* Folded, it must still say WHICH workspace you are in: that is the single thing the split exists
   to keep clear, and a bare icon would throw it away to save 224px. */
ok('...and folded it still names the workspace', /PanelLeftOpen[\s\S]{0,120}\{title\}/.test(rail))

/* ------------------------- 6. the new tick claims nothing extra ------------------------- */

ok('business.view is a capability', /\| 'business\.view'/.test(caps))
ok('...with a label and a blurb', /'business\.view': \{[\s\S]{0,400}?blurb:/.test(caps))
/*
 * AND IT DOES NOT CLAIM THE DATABASE ENFORCES IT, because nothing does yet. This is the assertion
 * to DELETE in the migration that adds the first business table with a policy -- not before.
 */
const businessMeta = caps.slice(caps.indexOf("'business.view': {"))
  .slice(0, caps.slice(caps.indexOf("'business.view': {")).indexOf('},') + 2)
ok('the business meta was found', businessMeta.length > 20)
no('...and does not claim the database enforces it', /inDatabase/.test(businessMeta))
/* finance.view's does, and must keep doing: it is behind real RLS. */
const financeMeta = caps.slice(caps.indexOf("'finance.view': {"))
  .slice(0, caps.slice(caps.indexOf("'finance.view': {")).indexOf('},') + 2)
ok('finance.view still claims the database', /inDatabase: true/.test(financeMeta))

/* THE SQL TEMPLATE AGREES. check-capabilities holds every role in both directions; this asserts
   the one row that matters here, so a failure names the business side rather than a count. */
const sql = read('supabase/schema.sql')
const lastRoleFn = sql.lastIndexOf('create or replace function public.role_capabilities(')
ok('role_capabilities is in schema.sql', lastRoleFn > -1)
const adminArray = sql.slice(lastRoleFn, sql.indexOf('$$;', lastRoleFn))
ok("...and the Administrator's template has business.view", /'business\.view'/.test(adminArray))

/* ------------------- 7. the browser spells the database's closed lists ------------------- */

/*
 * A LITERAL THAT DRIFTS FROM A CHECK CONSTRAINT DOES NOT THROW -- IT SILENTLY NEVER MATCHES.
 *
 * `client_charges.settlement` is a closed list of exactly ('set_off', 'invoice'). business.ts
 * compares against it to decide whether a charge comes off the client's next payover or is
 * invoiced for them to pay. Written as 'off_payover' -- which it was -- every charge fell into the
 * invoiced column, and somebody would have chased a client for money already coming off their run.
 * Nothing failed, nothing logged, and the screen looked complete.
 *
 * SO THE CONSTRAINT IS THE SOURCE AND THE BROWSER IS HELD TO IT, rather than the two being written
 * out twice and trusted to agree.
 */
const business = strip(read('src/lib/business.ts'))
const settlementCheck = sql.match(/settlement = ANY \(ARRAY\[([^\]]*)\]\)/)
  ?? sql.match(/settlement in \(([^)]*)\)/)
  ?? sql.match(/check \(settlement in \(([^)]*)\)\)/)
ok('the settlement constraint is in schema.sql', !!settlementCheck)
const allowed = (settlementCheck?.[1] ?? '')
  .split(',').map((x) => x.trim().replace(/::text/g, '').replace(/^'|'$/g, '')).filter(Boolean)
check('...and it is the two the firm has', [...allowed].sort(), ['invoice', 'set_off'])

/* Every settlement literal the browser compares against must be one the constraint permits. */
const compared = [...business.matchAll(/settlement === '([^']*)'/g)].map((m) => m[1])
ok('business.ts compares a settlement at all', compared.length > 0)
for (const lit of compared) {
  ok(`'${lit}' is a settlement the database allows`, allowed.includes(lit))
}

/* --------------- 8. the client statement does ONE arithmetic, the database's --------------- */

/*
 * `client_account` computes the running balance in one ordered window. A component that added the
 * amounts up again would be a SECOND arithmetic over the same money, and the day the two disagreed
 * a client would be holding a statement that does not match the payover it was built from.
 *
 * ASSERTED IN SOURCE BECAUSE IT CANNOT BE ASSERTED IN THE BROWSER. A faithful fixture's amounts
 * necessarily total its balances, so a re-summing component draws exactly the same figures and the
 * e2e passes either way. That is recorded in e2e/client-statement.mjs rather than left for
 * somebody to discover by trusting a green run.
 */
const panel = strip(read('src/components/companies/ClientAccountPanel.tsx'))
ok('the panel draws the balance it was given', /rand\(e\.balance\)/.test(panel))
/* The closing figure likewise: the LAST row's balance, not a total of the column. */
ok('...and the closing figure is the last row', /entries\[entries\.length - 1\]\.balance/.test(panel))
/*
 * AND IT SUMS NOTHING. Any reduce/+= over the entries is the second arithmetic arriving, whatever
 * it is called.
 */
no('...and nothing is re-summed', /\.reduce\(|balance \+=|total \+=/.test(panel))

/* -------- 9. the trust functions ask a capability, and read only the trust account -------- */

/*
 * A ROLE NAME IN A FUNCTION BODY CANNOT BE REACHED BY A GRANT. check-capabilities already asserts
 * this for may_record_payment, may_approve_payment and reverse_payment -- "asks for a capability,
 * rather than naming roles" -- because the alternative is that giving somebody the trust account
 * works on the button and not on the rule underneath it. These four were the ones still spelling
 * the role out.
 *
 * READ THE LAST DEFINITION. schema.sql is append-only, so a function replaced by a later migration
 * appears in the file twice and indexOf lands on the superseded copy. The opening paren is part of
 * the search: the bare name also appears in that function's own grant, revoke and comment lines.
 */
function liveBody(name) {
  const at = sql.lastIndexOf(`create or replace function public.${name}(`)
  if (at < 0) return null
  const opens = sql.indexOf('as $$', at)
  const ends = sql.indexOf('$$;', opens)
  return opens < 0 || ends < 0 ? null : sql.slice(opens, ends)
}

for (const fn of ['trust_position', 'unreconciled_payouts', 'draw_from_trust', 'reconcile_bank_debit']) {
  const body = liveBody(fn)
  ok(`${fn} is in schema.sql`, !!body)
  ok(`${fn} asks a capability`, /has_capability\('finance\.view'\)/.test(body ?? ''))
  no(`...rather than naming the role`, /current_user_role\(\) (is distinct from|=) 'Administrator'/.test(body ?? ''))
}

/*
 * AND THE TWO READERS LOOK AT THE TRUST ACCOUNT ONLY.
 *
 * unreconciled_payouts never did. trust_position has always compared trust cash against trust
 * creditors, but the function that EXPLAINS the difference read every debit in the table whatever
 * account it was on -- so a payment out of the BUSINESS account appeared on the trust
 * reconciliation as an unexplained trust payout, and somebody would go hunting for a payover run
 * behind a supplier invoice. It matters more now that the business account is a place in Raptor
 * rather than a column nothing reads.
 */
for (const fn of ['trust_position', 'unreconciled_payouts']) {
  ok(`${fn} reads the trust account only`,
    /l\.bank_account = f\.trust_account_number/.test(liveBody(fn) ?? ''))
}

/* NOT TO anon. Supabase grants EXECUTE on a new public function to anon by default, and these
   answer questions about -- or move -- other people's money. */
for (const sig of ['trust_position()', 'unreconciled_payouts()',
  'draw_from_trust(numeric, text, uuid)', 'reconcile_bank_debit(uuid, uuid)']) {
  ok(`${sig} is revoked from anon`,
    sql.includes(`revoke all on function public.${sig} from anon;`))
}

console.log(`check-workspace-split: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
if (failures.length) process.exit(1)
