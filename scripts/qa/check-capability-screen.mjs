/**
 * THE SCREEN THAT GIVES SOMEBODY ONE EXTRA THING -- AND THE LOCK UNDERNEATH IT.
 *
 * THE FIRM: "you can choose, for example, for a user to have a management template, but you can
 * add them more functionality."
 *
 * ------------------------------------------------------------------------------------------
 * THE LOCK FIRST, BECAUSE IT WAS MISSING
 * ------------------------------------------------------------------------------------------
 *
 * `profiles_update` lets anybody update THEIR OWN row -- that is how a person edits their name,
 * phone and email signature -- and `protect_profile_privileged_fields` exists precisely to stop a
 * self-edit smuggling something privileged through. It reverted role, status and team_id, and knew
 * nothing about `grants`, because grants did not exist when it was written.
 *
 * So for one commit, any signed-in person could PATCH their own profile with
 * grants = ['finance.view','payment.approve','payment.reverse'] and have all three: has_capability
 * reads the column directly. Found by building the screen and asking what stops somebody pointing
 * it at themselves. THIS FILE IS THE THING THAT WOULD HAVE CAUGHT IT.
 *
 * ------------------------------------------------------------------------------------------
 * AND THEN THE SCREEN
 * ------------------------------------------------------------------------------------------
 *
 * What it does that Swordfish's does not is show the ROLE'S TEMPLATE behind every tick. Theirs
 * shows the answer and not the question, which is why nine ticks in ten on their screens are
 * simply whatever the template gave and nobody can tell a deliberate exception from an accidental
 * click a year later.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-capability-screen.mjs
 */
import { readFileSync } from 'node:fs'
import { ROLE_CAPABILITIES, CAPABILITIES, CAPABILITY_ORDER } from '../../src/lib/capabilities.ts'

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
const modal = code('src/components/settings/CapabilitiesModal.tsx')
const settings = code('src/pages/settings/SettingsPage.tsx')

/* ---------------- the lock ---------------- */

const at = sql.lastIndexOf('create or replace function public.protect_profile_privileged_fields()')
ok('the self-edit guard exists', at > 0)
const guard = at > 0 ? sql.slice(at, sql.indexOf('$$;', at)) : ''

/* THE THREE IT ALWAYS PROTECTED, so adding two did not quietly drop one. */
for (const col of ['role', 'status', 'team_id']) {
  ok(`${col} is still kept at its old value`, new RegExp(`new\\.${col} := old\\.${col};`).test(guard))
}
/*
 * AND THE TWO THAT DECIDE WHAT A PERSON MAY DO. BOTH, because a revoke somebody clears on
 * themselves is a grant by another route -- protecting only `grants` would leave the other half of
 * the same hole open.
 */
ok('a grant cannot be given to yourself', /new\.grants := old\.grants;/.test(guard))
ok('...nor a revoke cleared off yourself', /new\.revokes := old\.revokes;/.test(guard))
/*
 * `is distinct from`, NEVER a bare `<>` -- CLAUDE.md's own trap, and this trigger had it.
 * current_user_role() is NULL with no session, `null <> 'Administrator'` is NULL, `if NULL then`
 * does not run, and the protection is skipped for exactly the caller it should refuse hardest.
 */
ok('...and it fails closed on nobody at all',
  /current_user_role\(\) is distinct from 'Administrator'/.test(guard))
ok('...rather than with a bare comparison', !/current_user_role\(\) <> /.test(guard))
/* REVERTED, NOT RAISED, deliberately: an ordinary self-edit sends the whole row back, grants
   included, and refusing it would break editing your own name for everybody. */
ok('...silently, so an ordinary self-edit still works', !/raise exception/.test(guard))
/* AND IT IS ACTUALLY ATTACHED. A function nothing fires is a comment. */
ok('the trigger is on every update of a profile',
  /create trigger protect_profile_privileged_fields\s*\n\s*before update on public\.profiles\s*\n\s*for each row/.test(sql))

/* ---------------- the screen ---------------- */

ok('there is a screen for it', /export function CapabilitiesModal\(/.test(modal))
ok('...reachable from the user list', /<CapabilitiesModal/.test(settings))
/*
 * BESIDE THE ROLE, NOT INSIDE THE EDIT BOX. The role is the template and this is the departure
 * from it -- two different questions about one person, and burying the second inside a form about
 * somebody's name and team is how "may she approve a payment?" becomes hard to find.
 */
ok('...from its own button on the row', /setCapabilityUser\(u\)/.test(settings))
/*
 * ADMINISTRATOR ONLY ON THE SCREEN TOO. Not the boundary -- the trigger is -- but a button that
 * always silently does nothing is worse than no button.
 *
 * READ BACKWARDS FROM THE BUTTON TO THE CONDITION THAT ENCLOSES IT, not forwards from a condition
 * to the button. The first way round was `/isAdmin && \([\s\S]{0,2000}?setCapabilityUser/`, and the
 * break test caught it: an EARLIER `{isAdmin && (` -- the cell holding the password-reset button --
 * sits within that window, so the assertion passed with the capability button moved out of any
 * guard at all. A forward search finds a condition; it does not establish that the condition is
 * the one in force.
 */
const buttonAt = settings.indexOf('setCapabilityUser(u)')
ok('the button is on the row', buttonAt > 0)
const enclosing = settings.slice(0, buttonAt).lastIndexOf('&& (')
ok('...inside some condition', enclosing > 0)
check('...and that condition is being an administrator',
  settings.slice(Math.max(0, enclosing - 8), enclosing).trim(), 'isAdmin')

/* THE ROLE'S TEMPLATE IS WHAT THE TICKS START FROM, and is visible behind them. */
ok('the template is read from the role', /ROLE_CAPABILITIES\[user\.role\]/.test(modal))
ok('...and what they hold is asked of the same function the app asks',
  /capabilitiesOf\(user\)/.test(modal))
/*
 * MARKED AS A DEPARTURE. This is the one thing Swordfish's screens do not do and the reason this
 * is not just a grid: without it nobody can tell a deliberate exception from an accidental click.
 */
ok('a capability the role does not give is marked added', /'added'/.test(modal))
ok('...and one taken away is marked removed', /'removed'/.test(modal))
ok('...and the two are drawn differently from the rest', /mark \?/.test(modal))

/*
 * THE COLUMNS ARE DERIVED FROM THE TICKS, never edited directly. A screen that let somebody put a
 * capability in BOTH columns is a screen where the answer depends on which was edited last.
 */
ok('a grant is what the role does not give',
  /held\.has\(c\) && !template\.has\(c\)/.test(modal))
ok('a revoke is what the role gives and they do not have',
  /!held\.has\(c\) && template\.has\(c\)/.test(modal))
/* AND THEY GO TOGETHER. Writing one column without the other would leave a name in both. */
ok('both columns are written at once', /onSave\(\{ grants, revokes \}\)/.test(modal))

/* SAID BEFORE IT IS SAVED. The point of the screen is that a departure stays legible, so what will
   actually be stored is spelled out rather than inferred from a page of ticks. */
ok('the screen says what it is about to store', /Added:/.test(modal) && /Removed:/.test(modal))
/* AND BACK TO THE TEMPLATE IN ONE PRESS: unticking fifteen rows by hand to undo an experiment is
   how a half-undone experiment gets saved. */
ok('...and offers a way back to the role', /setHeld\(new Set\(template\)\)/.test(modal))
/* SAVED ON A PRESS, not per tick. Four changes written one at a time is four chances to
   half-apply a decision. */
ok('nothing is written until Save', !/onSave\([\s\S]{0,40}?\)\s*\}\s*\)\s*\}\s*onClick=\{\(\) => toggle/.test(modal))
ok('...and Save is dead until something changed', /disabled=\{busy \|\| !dirty\}/.test(modal))

/* ---------------- every row says what it means ---------------- */

/*
 * THE BLURB AND THE DATABASE MARK ARE BOTH DRAWN, and neither is decoration. A capability whose
 * meaning lives in its identifier is one people grant by guessing; and whether a revoke actually
 * STOPS somebody or only hides a button is the difference between a control and a decoration.
 */
ok('each row says what it lets somebody do', /CAPABILITIES\[c\]\.blurb/.test(modal))
ok('...and which ones the database enforces', /CAPABILITIES\[c\]\.inDatabase/.test(modal))
check('the ones marked as enforced are the ones the database really checks',
  CAPABILITY_ORDER.filter((c) => CAPABILITIES[c].inDatabase).sort(),
  ['business.view', 'finance.view', 'library.edit', 'mail.refile', 'payment.approve',
    'payment.move', 'payment.record', 'payment.reverse', 'settlement.approve'].sort())
/*
 * AND THE DATABASE REALLY ASKS FOR EACH ONE, which is what the mark claims.
 *
 * THIS ASSERTION USED TO BE VACUOUS AND HID A REAL HOLE. It read
 * `has_capability('X') || sql.includes("'X'")`, and the second half matches the role_capabilities
 * TEMPLATE -- which lists every capability by name -- so it could never fail. Behind it, five of
 * the eight were enforced by naming the Administrator ROLE instead: granting somebody
 * `library.edit`, `mail.refile` or `payment.move` ticked a box and changed nothing, because a role
 * spelled out in a policy cannot be reached by a grant.
 *
 * The fallback is gone. Only the real form counts.
 */
for (const c of CAPABILITY_ORDER.filter((x) => CAPABILITIES[x].inDatabase)) {
  ok(`${c} is asked for in the database`, sql.includes(`has_capability('${c}')`))
}

/* ---------------- and the groups hold every capability ---------------- */

/* A CAPABILITY IN NO GROUP IS DRAWN NOWHERE. The screen builds its blocks from the group on each
   entry, so an entry with a group nothing renders is a permission that silently cannot be given. */
const GROUPS = ['Money', 'The book', 'Clients and disputes', 'The library']
for (const c of CAPABILITY_ORDER) {
  ok(`${c} is in a group the screen draws`, GROUPS.includes(CAPABILITIES[c].group))
}
/* AND THE ADMINISTRATOR TEMPLATE IS STILL EVERY ONE, which is what makes the list closed and what
   `all_capabilities()` returns in the database. */
check('an administrator still has every capability',
  [...ROLE_CAPABILITIES.Administrator].sort(), [...CAPABILITY_ORDER].sort())

console.log(`\ncheck-capability-screen: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
