/**
 * SETTING SOMEBODY UP, IN ONE SITTING (S10, 22 Oct).
 *
 * The firm, after Camille and the others tested: a pre-legal agent could not be put in a team; a
 * new user "doesn't show immediately ... you need to refresh"; and adding a person should ask for
 * their mailbox and BuzzBox extension straight away. On staging every team had been made as a
 * Sales team -- the kind defaulted to Sales -- and the database refused every collector put in one.
 *
 * Holds: a new team's kind is guessed from its name and must be chosen; "Add member" offers only
 * those the database would accept, and says why about the rest; the invite box says why no team is
 * offered; the list re-reads the people after an invitation; the invite box goes on to the mailbox
 * and the extension; Edit User carries the extension.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-user-setup.mjs
 */
import { readFileSync } from 'node:fs'
import { guessTeamKind, teamsForRole } from '../../src/lib/departments.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, v) => check(name, v, true)
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '')
const page = strip(readFileSync(new URL('../../src/pages/settings/SettingsPage.tsx', import.meta.url), 'utf8'))

check('"Call Centre" is a call centre team', guessTeamKind('Call Centre'), 'Call centre')
check('"Pre-legal Bravo" too', guessTeamKind('Pre-legal Bravo'), 'Call centre')
check('"Client Services" is communications', guessTeamKind('Client Services'), 'Communications')
check('"Marketing" is sales', guessTeamKind('Marketing'), 'Sales')
check('a name that says nothing is asked, not guessed', guessTeamKind('Admin'), null)
check('a pre-legal agent fits only a call centre team',
  teamsForRole('Pre-legal Agent', [{ kind: 'Sales' }, { kind: 'Call centre' }]).map((t) => t.kind), ['Call centre'])

/*
 * 23 OCT: teams are made and filled on Users -> Departments & teams (DepartmentsTeams.tsx), so the
 * same four promises are held there. The kind is offered from the department's other teams and the
 * names (suggestedKind -> guessTeamKind) until somebody picks, and never defaults to Sales.
 */
const org = strip(readFileSync(new URL('../../src/components/settings/DepartmentsTeams.tsx', import.meta.url), 'utf8'))
ok('a new team has no default kind', /useState<TeamKind \| ''>\(''\)/.test(org))
ok('...the button waits for one', /disabled=\{!name\.trim\(\) \|\| !departmentId \|\| !offered\}/.test(org))
ok('...and the name suggests it until somebody picks',
  /const offered = kindTouched \? kind : \(suggestedKind\(departmentId, deptName, name, teams\) \?\? ''\)/.test(org))
ok('"Add member" offers only those the database accepts', /\.filter\(\(u\) => teamsForRole\(u\.role, \[team\]\)\.length > 0\)/.test(org))
ok('...and says why about the rest', /data-testid="team-cannot-join"/.test(org))
ok('the invite box says why no team is offered', /data-testid="invite-no-team"/.test(page))
ok('the people are re-read after an invitation', /void refreshPeople\(\)\s*setSent\(true\)/.test(page))
ok('...the invite goes on to the mailbox', /data-testid="invite-connect-mailbox"/.test(page) && /<AdminEmailConnectModal\s+user=\{\{ id: newUserId/.test(page))
ok('...and the BuzzBox extension', /<BuzzBoxExtensionField userId=\{newUserId\} \/>/.test(page))
ok('Edit User carries the extension', /<BuzzBoxExtensionField userId=\{user\.id\} \/>/.test(page))

if (failures.length) {
  console.error(`check-user-setup: ${failures.length} failed, ${pass} passed\n  ${failures.join('\n  ')}`)
  process.exit(1)
}
console.log(`check-user-setup: ${pass} passed, 0 failed`)
