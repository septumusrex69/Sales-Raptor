/**
 * AN INVITE MAKES A NEW PERSON, OR IT REFUSES — IT NEVER QUIETLY BECOMES AN EXISTING ONE.
 *
 * The firm: "I created a user called Raap Jasper ... it created the account ... and it shows me
 * Stefnova. It's all weird."
 *
 * No user was created. That address had belonged to a profile since 5 September.
 * `inviteUserByEmail` on an address that already exists SUCCEEDS — it re-invites them — so:
 *
 *   - the name typed into the box was dropped (handle_new_user fires on INSERT, and the row was
 *     already there, so nothing ever applied it);
 *   - the chosen role was stamped onto THAT person instead;
 *   - and the box said "Invite sent ... they'll appear in this list with the role and team you
 *     just set."
 *
 * An administrator believed they had made a colleague and had quietly changed one. That is the
 * worst shape a bug can take on the screen that manages people.
 *
 * AND THE SECOND HALF OF THE SAME STORY: that profile's team was three weeks stale — a
 * Communications team — while its role now said Pre-legal Agent. DashboardRouter asked the TEAM
 * first, so a pre-legal agent opened Raptor on the Communications dashboard: courtesy calls,
 * meetings and client servicing, without one collections figure. The file's own paragraph had
 * said "THE ROLE DECIDES, because a team is optional and a role is not" since it was written.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-invite-identity.mjs
 */
import { readFileSync, existsSync } from 'node:fs'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '')

const invite = read('api/invite-user.ts')
const router = read('src/pages/DashboardRouter.tsx')
const settings = read('src/pages/settings/SettingsPage.tsx')

ok('the invite endpoint is readable at all', invite.length > 0)
ok('the dashboard router is readable at all', router.length > 0)

/* ------------------------------------------------ an address that is taken is refused */

ok('the endpoint looks the address up before doing anything with it',
  /from\('profiles'\)\.select\('name, role'\)\.ilike\('email', email\.trim\(\)\)/.test(invite))
/*
 * THE REFUSAL IS REACHED, not merely present. Written as a bare search for `res.status(409)` this
 * passed with the guard changed to `if (false && taken)` -- the refusal was still in the file and
 * could never run. Found by break-testing, which is the only reason it is written this way.
 */
ok('...and refuses rather than carrying on',
  /\n  if \(taken\) \{[\s\S]{0,600}?res\.status\(409\)/.test(invite))
/*
 * BY NAME. "That email is taken" leaves somebody guessing which of fifty-eight people it is;
 * naming them turns it into one decision — edit that person, or use another address.
 */
ok('...naming who it already belongs to', /already belongs to \$\{who\.name/.test(invite))
ok('...and their role, so it is obvious whether it is the same person',
  /who\.role \? ` \(\$\{who\.role\}\)`/.test(invite))
/* Re-sending an invitation is a different action and already has its own button, so a refusal
   here costs nothing. Said in the message rather than left for somebody to wonder about. */
ok('...and points at the button that DOES re-send a link', /Send login link/.test(invite))

/*
 * CHECKED BEFORE THE INVITE IS SENT, not after. Ordered assertions are vacuous if the thing they
 * order is gone -- indexOf returns -1 and -1 is less than everything -- so BOTH are asserted
 * present first. This codebase has been caught by exactly that twice.
 */
const lookupAt = invite.indexOf("from('profiles').select('name, role')")
const inviteAt = invite.indexOf('admin.auth.admin.inviteUserByEmail')
ok('the lookup is there', lookupAt > 0)
ok('the invite is there', inviteAt > 0)
ok('...and nobody is emailed before the address is checked', lookupAt < inviteAt)

/* The modal shows whatever the server said, so the sentence above actually reaches somebody. */
ok('the box shows the server’s own words', /setError\(body\.error \?\? /.test(settings))

/* ------------------------------------------------ the role outranks the team */

/*
 * ASSERTED PRESENT BEFORE ORDER, for the reason above: with the pre-legal branch deleted this
 * would otherwise pass while every collector landed on the wrong dashboard.
 */
const roleAt = router.indexOf('PRE_LEGAL.includes(currentUser.role)')
const teamAt = router.indexOf("myTeam?.kind === 'Communications'")
ok('the pre-legal branch exists', roleAt > 0)
ok('the communications branch exists', teamAt > 0)
ok('...and the role is asked first', roleAt < teamAt)
/*
 * EVERY COLLECTIONS ROLE, not just the agent -- a team leader and the call centre manager carry
 * a book too. Read out of the array rather than matched as a literal: pinned to the exact two
 * roles it had, this broke the moment 'Call Centre Manager' was added, which is a correct change
 * reported as a fault. Assert what must be TRUE of the list, not how it is written.
 */
const preLegal = [...(/const PRE_LEGAL = \[([^\]]*)\]/.exec(router)?.[1] ?? '')
  .matchAll(/'([^']+)'/g)].map((m) => m[1])
ok('the collections roles are listed at all', preLegal.length > 0)
for (const r of ['Pre-legal Agent', 'Pre-legal Team Leader', 'Call Centre Manager']) {
  ok(`...including ${r}, who lands on the collections floor`, preLegal.includes(r))
}
/* An administrator still comes first: they oversee the firm, not a floor. */
const adminAt = router.indexOf("currentUser?.role === 'Administrator'")
ok('an administrator is still answered before either', adminAt > 0 && adminAt < roleAt)

/* ------------------------------------------------ one door, not two */

/*
 * The firm: "the add someone who has left doesn't deserve its own button -- if you add a user,
 * you can just select somewhere there, for example by the role, say that that person already
 * left."
 *
 * They were two buttons and two forms over the same four fields, differing in one decision, and
 * the second sat on the screen permanently for something done perhaps twice a year.
 */
ok('there is no second button for it', !/Add someone who has left/.test(settings))
ok('...and the second form is gone with it', !/function FormerUserModal/.test(settings))
ok('the decision lives in the one form instead', /const \[hasLeft, setHasLeft\] = useState\(false\)/.test(settings))
ok('...as a tick beside the role', /This person has already left the firm/.test(settings))

/*
 * WHAT FOLLOWS FROM IT. A record gets no email and no password, so the fields change with the
 * tick rather than the person being asked for things that mean nothing.
 */
ok('a record needs a name, where an invitation does not',
  /label=\{hasLeft \? 'Full name' : 'Full Name \(optional\)'\} required=\{hasLeft\}/.test(settings))
ok('...refused before anything is sent if it is missing',
  /if \(hasLeft && !name\.trim\(\)\)/.test(settings))
ok('...and the role is asked in the past tense', /label=\{hasLeft \? 'Role they had' : 'Role'\}/.test(settings))
/* They are filed under "No longer here" rather than in a department, so a team changes nothing. */
ok('a team is not asked for somebody who has left', /\{!hasLeft && \(\s*\n?\s*<FormField label="Team \(optional\)">/.test(settings))
ok('the button says which of the two it is doing', /hasLeft \? 'Add record' : 'Send Invite'/.test(settings))

/*
 * AND IT IS STILL signIn:false THAT SEPARATES THEM, which is what the endpoint reads. Asserted on
 * the body actually posted, because this is the one line that decides whether a real person is
 * emailed a sign-in link.
 */
ok('a record posts signIn:false', /hasLeft\s*\n?\s*\? \{ email, name: name\.trim\(\), role, signIn: false \}/.test(settings))
ok('...and an invitation still carries the team', /: \{ email, name: name \|\| undefined, role, teamId: teamId \|\| undefined \}/.test(settings))

/*
 * THE DUPLICATE GUARD NOW COVERS BOTH DOORS. It used to sit inside the invite path, below the
 * fork, so adding somebody "who has left" on an address already in use reached createUser and
 * came back with Supabase's own wording -- true, and no help about whose address it is.
 */
const forkAt = invite.indexOf('if (signIn === false) {')
ok('the former-user fork is there', forkAt > 0)
ok('...and the address is checked BEFORE it', lookupAt > 0 && lookupAt < forkAt)

/* ------------------------------------------------ */

for (const f of failures) console.error(`  ✗ ${f}`)
console.log(`check-invite-identity: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
