/**
 * THE DISPUTES BOARD OPENS ON YOUR OWN WORK.
 *
 * The firm, having made a new user and opened it: "I went into the disputes pane and I saw
 * everybody's dispute. I think by default it should be related to the user. As an administrator,
 * you should be able to see other people's disputes. And as a team leader, you should be able to
 * see the disputes of a specific person in your team ... or as a liaison manager, of yourself and
 * your team. For any individual in your team — I can't see how it would benefit to look at a
 * bird's eye view at the entire team's tickets."
 *
 * The filter started on "All Owners" and offered every person in the firm, so a collector on
 * their first morning was reading the whole floor.
 *
 * WHAT THIS GUARDS:
 *
 *   - THE THREE ANSWERS, RUN RATHER THAN READ. Administrator: everybody. Leader: self and their
 *     own team, one at a time. Everybody else: themselves, with nobody else in the picker.
 *   - NO POOLED TEAM VIEW. The firm ruled it out in the same breath as granting the team, so
 *     "All Owners" is not offered to a leader at all.
 *   - A LEADER WITH NO TEAM LEADS NOBODY. teamId is optional and eleven of the firm's people have
 *     none; matching undefined to undefined would hand every teamless leader every other
 *     teamless person.
 *   - AND THE FILTER IS A RULE, NOT A DROPDOWN. A value that is not in the permitted list falls
 *     back to the person themselves, never to "All".
 *   - THE TOTALS DESCRIBE THE BOARD BEING SHOWN. "Total Disputes 26" above four cards is somebody
 *     else's number at the top of your work.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-dispute-scope.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { mayPoolDisputes, visibleDisputeOwners } from '../../src/lib/permissions.ts'

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

/* A floor: two teams, a leader on each, an administrator, and two people with no team. */
const ADMIN = { id: 'admin', name: 'Admin', role: 'Administrator', teamId: 'alpha' }
const LEAD_A = { id: 'lead-a', name: 'Leader Alpha', role: 'Pre-legal Team Leader', teamId: 'alpha' }
const LEAD_B = { id: 'lead-b', name: 'Leader Bravo', role: 'Pre-legal Team Leader', teamId: 'bravo' }
const LIAISON_MGR = { id: 'lm', name: 'Liaison Manager', role: 'Liaison Manager', teamId: 'alpha' }
const AGENT_A = { id: 'agent-a', name: 'Agent Alpha', role: 'Pre-legal Agent', teamId: 'alpha' }
const AGENT_A2 = { id: 'agent-a2', name: 'Agent Alpha Two', role: 'Pre-legal Agent', teamId: 'alpha' }
const AGENT_B = { id: 'agent-b', name: 'Agent Bravo', role: 'Pre-legal Agent', teamId: 'bravo' }
const LOOSE_LEAD = { id: 'loose-lead', name: 'Teamless Leader', role: 'Pre-legal Team Leader' }
const LOOSE_AGENT = { id: 'loose-agent', name: 'Teamless Agent', role: 'Pre-legal Agent' }
const SALES_MGR = { id: 'sm', name: 'Sales Manager', role: 'Sales Manager', teamId: 'alpha' }
const EVERYONE = [ADMIN, LEAD_A, LEAD_B, LIAISON_MGR, AGENT_A, AGENT_A2, AGENT_B, LOOSE_LEAD, LOOSE_AGENT, SALES_MGR]

const seen = (me) => visibleDisputeOwners(me, EVERYONE).map((u) => u.id)

/* ------------------------------------------------ the three answers */

check('an administrator sees everybody', seen(ADMIN).sort(), EVERYONE.map((u) => u.id).sort())
/* Themselves first: it is the board they open every morning. */
check('...with themselves at the top of the list', seen(ADMIN)[0], 'admin')

check('a collector sees only their own', seen(AGENT_A), ['agent-a'])
/*
 * THE WHOLE COMPLAINT, AS ONE ASSERTION. A new user opened the board and read the floor.
 */
ok('...and a colleague on the same team is not in their picker', !seen(AGENT_A).includes('agent-a2'))

/*
 * TEAM MEMBERSHIP IS TEAM MEMBERSHIP, and that is deliberate rather than overlooked. The
 * administrator and the sales manager below are filed under team alpha, so a leader of alpha
 * sees them -- the firm said "any individual in your team" and no role was carved out of it.
 * Inventing an exclusion for senior roles would be a rule nobody asked for, and in the firm's own
 * data the administrator IS on a team.
 */
check('a team leader sees their own team, themselves first',
  seen(LEAD_A), ['lead-a', 'admin', 'lm', 'agent-a', 'agent-a2', 'sm'])
ok('...and nobody from another team', !seen(LEAD_A).some((id) => ['lead-b', 'agent-b'].includes(id)))
check('a liaison manager sees the same team',
  seen(LIAISON_MGR).sort(), ['admin', 'agent-a', 'agent-a2', 'lead-a', 'lm', 'sm'].sort())
check('the other team’s leader sees the other team', seen(LEAD_B).sort(), ['agent-b', 'lead-b'].sort())

/*
 * INFERRED, NOT INSTRUCTED. The firm named the administrator, the team leader and the liaison
 * manager. A sales manager leads the sales side and a dispute is a collections record.
 */
check('a sales manager is not a collections leader here', seen(SALES_MGR), ['sm'])

/* ------------------------------------------------ a leader with no team */

/*
 * THE TRAP: teamId is optional, so `u.teamId === me.teamId` with both undefined is TRUE, and a
 * teamless leader would be handed every other teamless person in the firm.
 */
check('a leader with no team leads nobody', seen(LOOSE_LEAD), ['loose-lead'])
ok('...and specifically not every other teamless person', !seen(LOOSE_LEAD).includes('loose-agent'))
check('nobody signed in sees nothing', visibleDisputeOwners(null, EVERYONE), [])

/* ------------------------------------------------ no bird's-eye view for a leader */

check('only an administrator may pool the board', mayPoolDisputes('Administrator'), true)
check('a team leader may not', mayPoolDisputes('Pre-legal Team Leader'), false)
check('a liaison manager may not', mayPoolDisputes('Liaison Manager'), false)
check('a collector may not', mayPoolDisputes('Pre-legal Agent'), false)

/* ------------------------------------------------ and the screen applies it */

const board = read('src/pages/accounts/DisputesBoard.tsx')
ok('the board is readable at all', board.length > 0)
ok('the board asks who may be looked at', /visibleDisputeOwners\(currentUser, users\)/.test(board))
ok('...and no longer offers every person in the firm',
  !/<option value="All">All Owners<\/option>\s*\n\s*\{users\.map/.test(board))
ok('...offering "All Owners" only to somebody who may pool', /\{mayPool && <option value="All">/.test(board))
/*
 * THE FILTER IS HELD TO THE LIST. Without this the scope is a dropdown rather than a rule: an
 * ?owner= in the URL, or a value left over from a role change, would put somebody else's board up.
 */
ok('a filter value outside the permitted list falls back to the person themselves',
  /owners\.some\(\(u\) => u\.id === owner\) \? owner : \(currentUser\?\.id \?\? 'All'\)/.test(board))
ok('...and the rows are filtered by that, not by the raw dropdown', /if \(scope !== 'All' && r\.ownerId !== scope\)/.test(board))
/* It starts on the person, which is the firm's sentence. */
ok('the board opens on the person themselves', /setOwner\(currentUser\.id\)/.test(board))
ok('...once, so it never stomps a filter somebody has changed', /if \(defaulted\.current \|\| !currentUser\) return/.test(board))
/* And the strip describes the board being shown rather than the firm. */
ok('the totals count only the board being shown',
  /\(rows \?\? \[\]\)\.filter\(\(r\) => scope === 'All' \|\| r\.ownerId === scope\)/.test(board))

/* ------------------------------------------------ */

for (const f of failures) console.error(`  ✗ ${f}`)
console.log(`check-dispute-scope: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
