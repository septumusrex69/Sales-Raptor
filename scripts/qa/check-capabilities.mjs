/**
 * WHAT A PERSON MAY DO, AND THE FACT THAT IT IS WRITTEN TWICE.
 *
 * THE FIRM, SHOWING ME SWORDFISH'S PERMISSION SCREENS: "every user has their own unique set of
 * permissions. So you can choose, for example, for a user to have a management template, but you
 * can add them more functionality. Perhaps we should do something similar."
 *
 * WHAT RAPTOR HAD WAS THE ROLE AND NOTHING ELSE -- thirteen predicates, each a hand-written list
 * of role names, with no way to give one person one extra thing. So a template plus grants minus
 * revokes, and because the browser decides which buttons to DRAW while the database decides what
 * may HAPPEN, the rule exists in two languages. That is what this file is mostly for: held in one
 * direction only, a capability added in TypeScript and forgotten in SQL is a button that draws and
 * then refuses, and one added in SQL and forgotten in TypeScript is a permission nobody can see.
 *
 * AND ONE THING ON SWORDFISH'S OWN SCREEN IS WHY THERE IS A SECOND TIER. "Apply In Duplum" is a
 * checkbox there. In duplum is NCA s103(5) -- whether it applies is a fact about the DEBT, and a
 * per-user permission for it means two people open one account and are told two different things
 * about what is legally recoverable. So the list is CLOSED, and the assertions at the foot of this
 * file are what keep it closed.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-capabilities.mjs
 */
import { readFileSync } from 'node:fs'
import {
  CAPABILITIES, CAPABILITY_ORDER, ROLE_CAPABILITIES, can, capabilitiesOf, departsFromRole,
} from '../../src/lib/capabilities.ts'
import {
  canViewFinance, canRecordPayment, canViewClients, canFreezeAccounts, canHandOutAccounts,
  canReassign, canLeadCollections, canRefileMail, canViewLibrary, canEditLibrary, mayPoolDisputes,
} from '../../src/lib/permissions.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(--|\/\/).*$/gm, '')

const sql = read('supabase/schema.sql')
const auth = code('src/store/AuthContext.tsx')
const perms = code('src/lib/permissions.ts')

const ROLES = Object.keys(ROLE_CAPABILITIES)
const asUser = (role, grants, revokes) => ({ id: 'u', role, grants, revokes })

/* ---------------- the list is a list, and every entry says what it is ---------------- */

ok('there are capabilities', CAPABILITY_ORDER.length > 0)
for (const c of CAPABILITY_ORDER) {
  const meta = CAPABILITIES[c]
  ok(`${c} has a label`, !!meta?.label && meta.label.length > 3)
  /* THE BLURB IS WHAT THE PERSON TICKING THE BOX READS. A capability whose meaning lives only in
     its identifier is one somebody grants by guessing what the words before the dot mean. */
  ok(`${c} says what it lets somebody do`, !!meta?.blurb && meta.blurb.length > 40)
  ok(`${c} is in a group`, !!meta?.group)
}
/* NAMED AREA.THING, so the settings screen can group them and so a reader can tell
   'payment.approve' from 'payment.record' without opening the file. */
for (const c of CAPABILITY_ORDER) {
  ok(`${c} is named area.thing`, /^[a-z_]+\.[a-z_]+$/.test(c))
}

/* ---------------- template, then grant, then revoke ---------------- */

/*
 * THE ORDER IS THE WHOLE RULE AND IT IS ASSERTED RATHER THAN DESCRIBED. Revoke last means somebody
 * who was given something and then had it taken away has had it taken away; any other order lets
 * the two columns disagree, with the answer depending on which was edited most recently.
 */
check('a role gives what its template says',
  can(asUser('Liaison'), 'payment.record'), true)
check('...and not what it does not', can(asUser('Liaison'), 'payment.approve'), false)
check('a grant adds one thing',
  can(asUser('Liaison', ['payment.approve']), 'payment.approve'), true)
check('...without adding anything else',
  can(asUser('Liaison', ['payment.approve']), 'finance.view'), false)
check('a revoke takes one away',
  can(asUser('Liaison', undefined, ['payment.record']), 'payment.record'), false)
check('...and beats a grant of the same thing',
  can(asUser('Liaison', ['payment.approve'], ['payment.approve']), 'payment.approve'), false)
/* AN ADMINISTRATOR IS NOT ABOVE A REVOKE. The firm asked for both directions, and a role that
   quietly ignored one would be the one role where the screen lies about what it is showing. */
check('an administrator can have something taken away',
  can(asUser('Administrator', undefined, ['finance.view']), 'finance.view'), false)
/* NOBODY SIGNED IN MAY DO ANYTHING. A page that renders before the profile arrives must draw the
   refusing version rather than briefly offering a button. */
check('nobody signed in may do nothing', can(null, 'library.view'), false)
check('...and undefined is the same as null', can(undefined, 'library.view'), false)
/* A STALE NAME IS IGNORED, NOT FATAL. These are text arrays in Postgres and a capability removed
   from the code leaves rows behind; a name nobody recognises must not stop somebody signing in. */
check('a grant nobody recognises is ignored',
  [...capabilitiesOf(asUser('Read Only', ['nonsense.thing']))], ['library.view'])
check('...and so is a revoke', [...capabilitiesOf(asUser('Read Only', undefined, ['nonsense.thing']))], ['library.view'])

/* AND THE SCREEN CAN TELL A DEPARTURE FROM THE TEMPLATE. Swordfish's own screens cannot, which is
   how nobody can tell a deliberate exception from an accidental click a year later. */
check('a grant is a departure', departsFromRole(asUser('Liaison', ['finance.view']), 'finance.view'), true)
check('a revoke is a departure', departsFromRole(asUser('Liaison', undefined, ['client.view']), 'client.view'), true)
check('the template itself is not', departsFromRole(asUser('Liaison'), 'client.view'), false)

/* ---------------- every predicate is now a capability, and behaves as it did ---------------- */

/*
 * THE TEMPLATES WERE TRANSCRIBED FROM THESE PREDICATES, so with no grant and no revoke every one
 * of them must still answer exactly what it answered before. This is the assertion that makes the
 * rewiring a refactor rather than a redecision -- a table of role against answer, written out, so
 * that changing who may approve a payment is a visible edit to this file.
 */
const EXPECTED = {
  canViewFinance: ['Administrator'],
  canRecordPayment: ['Administrator', 'Call Centre Manager', 'Pre-legal Team Leader', 'Liaison Manager', 'Liaison'],
  canViewClients: ROLES.filter((r) => r !== 'Pre-legal Agent' && r !== 'Read Only'),
  canFreezeAccounts: ['Administrator', 'Pre-legal Team Leader', 'Liaison Manager', 'Liaison'],
  canHandOutAccounts: ['Administrator', 'Sales Manager', 'Liaison Manager', 'Call Centre Manager', 'Pre-legal Team Leader'],
  canReassign: ['Administrator', 'Sales Manager', 'Liaison Manager'],
  canLeadCollections: ['Administrator', 'Call Centre Manager', 'Pre-legal Team Leader'],
  canRefileMail: ['Administrator'],
  canEditLibrary: ['Administrator'],
  mayPoolDisputes: ['Administrator'],
  canViewLibrary: ROLES,
}
const FN = {
  canViewFinance, canRecordPayment, canViewClients, canFreezeAccounts, canHandOutAccounts,
  canReassign, canLeadCollections, canRefileMail, canEditLibrary, mayPoolDisputes, canViewLibrary,
}
for (const [name, allowed] of Object.entries(EXPECTED)) {
  for (const role of ROLES) {
    check(`${name} for ${role}`, FN[name](asUser(role)), allowed.includes(role))
  }
}
/*
 * ONE THING GENUINELY CHANGED AND IT IS NAMED HERE RATHER THAN LEFT TO BE NOTICED. canViewClients
 * used to be "any role except Pre-legal Agent", which included Read Only. Read Only now gets the
 * library and nothing else -- which is what the name has always promised.
 */
check('Read Only sees the library', can(asUser('Read Only'), 'library.view'), true)
check('...and nothing else', [...capabilitiesOf(asUser('Read Only'))], ['library.view'])

/*
 * AND THE PREDICATES ASK THE ONE FUNCTION rather than listing roles again. A list of role names
 * left behind in one of them is a permission a grant cannot reach -- the firm's "add them more
 * functionality" working on the button and not on the rule underneath it.
 */
check('every predicate goes through can()', (perms.match(/return can\(user, '/g) ?? []).length, 11)
/*
 * THREE PLACES IN THIS FILE STILL READ THE ROLE, AND EACH IS DELIBERATE -- so they are named here
 * rather than forbidden, and a FOURTH appearing fails this. The file's own header says why:
 * canEditOwned mirrors an RLS policy word for word, visibleDisputeOwners answers "whose rows"
 * rather than "may you", and isAssignableOwner is a fact about other people used to fill a picker.
 */
/*
 * ASSERTED BY WHERE THEY ARE, not by counting them. A count is a number somebody updates to make
 * the check pass; this blanks out the three functions that are allowed to read a role and then
 * holds the REST of the file to none -- so a fourth one appearing fails wherever it is written.
 */
const ALLOWED_TO_READ_A_ROLE = [
  'canEditOwned', 'visibleDisputeOwners', 'isAssignableOwner', 'useDefaultOwnerFilter',
]
let rest = perms
for (const fn of ALLOWED_TO_READ_A_ROLE) {
  const at = rest.indexOf(`export function ${fn}`)
  ok(`${fn} is still there to be excused`, at >= 0)
  if (at < 0) continue
  /* To the end of the function: `\n}` at column zero, which is how every export in this file ends. */
  const end = rest.indexOf('\n}', at)
  rest = rest.slice(0, at) + rest.slice(end < 0 ? rest.length : end)
}
check('nothing else in the file reads a role', (rest.match(/\.role (===|!==) '/g) ?? []), [])
/* AND THE HEADER SAYS WHY, so the next person does not "finish the job" by making them grantable. */
ok('...and the file records why they are not capabilities',
  /still read the role and are not capabilities/i.test(read('src/lib/permissions.ts')))

/* ---------------- the column has to reach the rule ---------------- */

/*
 * CLAUDE.md's OWN WARNING, WITH THE WORST POSSIBLE CONSEQUENCE. mapProfileRow lists every field by
 * hand; a column in the table, the type and the select('*') but missing from it reads as undefined
 * for ever and nothing fails. Here that is every grant the firm has given anybody silently doing
 * nothing -- on a screen that goes on showing the tick.
 */
ok('the profile row type carries the grants', /grants: string\[\] \| null/.test(auth))
ok('...and the revokes', /revokes: string\[\] \| null/.test(auth))
ok('the mapper carries the grants', /grants: row\.grants \?\? undefined,/.test(auth))
ok('...and the revokes', /revokes: row\.revokes \?\? undefined,/.test(auth))

/* ---------------- written twice, so held in both directions ---------------- */

/* schema.sql is append-only: the LAST definition is the live one, and the bare name also appears
   in the grant, the revoke and the comment that follow it. */
const liveFn = (name) => {
  const at = Math.max(
    sql.lastIndexOf(`create or replace function public.${name}(`),
    sql.lastIndexOf(`create function public.${name}(`),
  )
  return at < 0 ? null : sql.slice(at, sql.indexOf('$$;', at))
}

const roleFn = liveFn('role_capabilities')
ok('the database has the templates too', !!roleFn)
/*
 * BOTH DIRECTIONS, PER ROLE. One direction only and a capability granted by the template in SQL
 * and not in TypeScript is a button that never draws for somebody who may in fact do it.
 */
for (const role of ROLES) {
  /* Role names are letters, spaces and hyphens only, so nothing here needs escaping. */
  const m = new RegExp("when '" + role + "' then array\\[([^\\]]*)\\]")
  const found = (roleFn ?? '').match(m)
  ok(`${role} has a template in the database`, !!found)
  const inSql = (found?.[1] ?? '').split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean)
  check(`${role}: the two lists agree`, [...inSql].sort(), [...ROLE_CAPABILITIES[role]].sort())
}
/* AND NO ROLE IN ONE THAT IS MISSING FROM THE OTHER. A role added to the type and forgotten in SQL
   falls to the `else` and gets NOTHING -- somebody who cannot do their job with nothing saying why. */
const rolesInSql = [...(roleFn ?? '').matchAll(/when '([^']+)' then/g)].map((m) => m[1])
check('the database knows exactly the roles the app does', [...rolesInSql].sort(), [...ROLES].sort())

/*
 * THE CLOSED LIST IS THE ADMINISTRATOR'S TEMPLATE, by definition -- which is what `all_capabilities`
 * returns and what `has_capability` gates on. If a capability is added without giving it to an
 * Administrator it becomes ungrantable to ANYBODY, silently, so it is asserted here.
 */
check('an administrator has every capability there is',
  [...ROLE_CAPABILITIES.Administrator].sort(), [...CAPABILITY_ORDER].sort())
const allFn = liveFn('all_capabilities')
ok('...and the database says so the same way', /role_capabilities\('Administrator'\)/.test(allFn ?? ''))

/* ---------------- the database enforces it, not only the browser ---------------- */

const hasFn = liveFn('has_capability')
ok('the database can answer it', !!hasFn)
/* AN UNKNOWN NAME IS NOT A CAPABILITY. Found by probing this very function: granting somebody
   'not.a.real.capability' and asking for it came back TRUE, where the browser ignores it. */
ok('...refusing a capability that does not exist',
  /p_capability = any\(public\.all_capabilities\(\)\)/.test(hasFn ?? ''))
ok('...reading the role template', /role_capabilities\(p\.role\)/.test(hasFn ?? ''))
ok('...adding the grants', /p_capability = any\(coalesce\(p\.grants/.test(hasFn ?? ''))
/* REVOKE LAST, in SQL as in TypeScript, or the two halves disagree about the one case the firm
   asked for by name. */
ok('...and taking the revokes away last',
  /and not \(p_capability = any\(coalesce\(p\.revokes/.test(hasFn ?? ''))
/*
 * IT ANSWERS ABOUT THE CALLER AND NOBODY ELSE. A function that takes a user id answers "may THIS
 * person do X" for any id, which is a way to enumerate what everybody in the firm may do.
 */
ok('...about the signed-in person only', /p\.id = auth\.uid\(\)/.test(hasFn ?? ''))
ok('...and takes no user id', !/p_user/.test(hasFn ?? ''))

/* THE THREE THAT ALREADY EXISTED NOW ASK IT. While they spelled out role names a grant could not
   reach them, and "add them more functionality" would have worked on the button and not on the
   database underneath it. */
for (const [fn, capability] of [
  ['may_record_payment', 'payment.record'],
  ['may_approve_payment', 'payment.approve'],
]) {
  const body = liveFn(fn)
  ok(`${fn} asks for a capability`, new RegExp(`has_capability\\('${capability}'\\)`).test(body ?? ''))
  ok(`...rather than naming roles`, !/current_user_role\(\)/.test(body ?? ''))
}
const rev = liveFn('reverse_payment')
ok('reversing a payment asks for a capability', /has_capability\('payment\.reverse'\)/.test(rev ?? ''))
ok('...rather than naming Administrator', !/current_user_role\(\) is distinct from 'Administrator'/.test(rev ?? ''))

/* NOT TO anon. Supabase grants EXECUTE on a public function to anon by default, and these answer
   questions about who may move money. */
for (const fn of ['has_capability(text)', 'role_capabilities(text)', 'all_capabilities()']) {
  ok(`${fn} is revoked from public`, sql.includes(`revoke all on function public.${fn} from public;`))
  ok(`...and granted to authenticated only`,
    sql.includes(`grant execute on function public.${fn} to authenticated;`))
}

/* ---------------- and the list stays closed ---------------- */

/*
 * THE SECOND TIER, ASSERTED. These are law or the firm's stated policy, and every one of them is
 * something Swordfish either does expose as a checkbox or plausibly could. A capability whose name
 * touches one of them is the beginning of somebody being able to tick it.
 *
 *   in duplum          NCA s103(5); a fact about the debt, not about who is looking.
 *   the tariff         Annexure B, priced by the date of the ACTION.
 *   imported history   "the data has to stay exactly like that".
 *   the ledgers        no update or delete policy; Postgres refuses.
 *   commission         on the company dashboard, "not even for an administrator".
 */
for (const forbidden of ['duplum', 'tariff', 'annexure', 'commission', 'immutab', 'ledger', 'remittance_rate']) {
  check(`nothing grantable is about ${forbidden}`,
    CAPABILITY_ORDER.filter((c) => c.toLowerCase().includes(forbidden)), [])
}
/* AND THE COMPANY DASHBOARD'S RULE IS STILL NOT A PERMISSION. check-company-dashboard asserts the
   absence of the figures; this asserts that nobody has since made them grantable instead. */
ok('commission on the company dashboard is not a capability',
  !CAPABILITY_ORDER.some((c) => c.startsWith('dashboard.')))

console.log(`\ncheck-capabilities: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
