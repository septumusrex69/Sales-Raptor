/**
 * ONLY A LIAISON MAY BE A CLIENT'S LIAISON.
 *
 * THE FIRM, LOOKING AT THE PICKER ON "ADD A CLIENT": "There should only be liaisons or liaison
 * manager, not anybody else, any other user when adding a client."
 *
 * IT WAS OFFERING EVERYBODY. `liaisons={users.filter((u) => u.status === 'Active')}` -- every
 * active person in the firm, so the box listed a pre-legal agent, a pre-legal team leader, two
 * administrators and a sales rep. The prop had been called `liaisons` since it was written and
 * nothing had ever filtered it, which is the quietest way for a rule to be missing: the name says
 * the rule is there.
 *
 * WHY A ROLE AND NOT A CAPABILITY, which is the opposite of how permissions.ts usually works.
 * `client.view` is held by seven of the nine roles -- a pre-legal team leader has it, so does a
 * sales rep -- because SEEING a client and BEING the firm's named contact for one are different
 * questions. This is the second. A grant of client.view, given so somebody can read a commission
 * rate, must not quietly make them answerable for the relationship.
 *
 * AND WHAT IT COSTS IF IT IS WRONG: the liaison is whose name goes on the mandate, who the client
 * telephones, and who `{{liaison_name}}` resolves to on a letter that goes out to them.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-client-liaison.mjs
 */
import { readFileSync } from 'node:fs'
import { CLIENT_LIAISON_ROLES, canBeClientLiaison, canViewClients } from '../../src/lib/permissions.ts'
import { ROLE_CAPABILITIES } from '../../src/lib/capabilities.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

/* ---------------- the two roles, and only the two ---------------- */

check('the firm named two roles and there are two',
  [...CLIENT_LIAISON_ROLES].sort(), ['Liaison', 'Liaison Manager'])
ok('a liaison may be one', canBeClientLiaison({ role: 'Liaison' }))
ok('...and so may a liaison manager', canBeClientLiaison({ role: 'Liaison Manager' }))

/*
 * AND NOBODY ELSE, asserted over EVERY role rather than the four that happened to be on the
 * screenshot. A role added tomorrow is covered the day it is written.
 */
const everyone = Object.keys(ROLE_CAPABILITIES)
ok('there are roles to check at all', everyone.length >= 9)
const wrongly = everyone.filter((role) => canBeClientLiaison({ role })
  && !CLIENT_LIAISON_ROLES.includes(role))
check('no other role may be a client’s liaison', wrongly, [])
/* THE FOUR FROM THE FIRM'S OWN SCREENSHOT, by name, because those are the ones they saw. */
for (const role of ['Administrator', 'Sales Representative', 'Pre-legal Agent', 'Pre-legal Team Leader']) {
  ok(`...not ${role}`, !canBeClientLiaison({ role }))
}
/* AND NOT NOBODY. A null user must be false rather than throwing or passing. */
ok('nobody is not a liaison', !canBeClientLiaison(null))
ok('...nor is an undefined one', !canBeClientLiaison(undefined))

/*
 * IT IS NARROWER THAN SEEING A CLIENT, and this is the assertion that says why it is a role
 * rather than a capability. If these two ever coincide somebody has widened one of them.
 */
const canSee = everyone.filter((role) => canViewClients({ role }))
ok('more roles may SEE a client than may BE its liaison', canSee.length > CLIENT_LIAISON_ROLES.length)
ok('...including a pre-legal team leader, who may see but not be',
  canViewClients({ role: 'Pre-legal Team Leader' }) && !canBeClientLiaison({ role: 'Pre-legal Team Leader' }))
ok('...and a sales rep',
  canViewClients({ role: 'Sales Representative' }) && !canBeClientLiaison({ role: 'Sales Representative' }))

/*
 * AND A GRANT CANNOT WIDEN IT. canBeClientLiaison reads the ROLE and takes no grants, so giving
 * somebody client.view so they can read a commission rate does not make them answerable for the
 * relationship. Asserted by handing it a user carrying every capability there is.
 */
ok('a capability grant does not make somebody a liaison',
  !canBeClientLiaison({ role: 'Pre-legal Agent', grants: ['client.view'] }))

/* ---------------- and the screen actually asks ---------------- */

const list = read('src/pages/companies/CompaniesList.tsx')
ok('the clients list filters the picker', /canBeClientLiaison\(u\)/.test(list))
/* STILL ACTIVE PEOPLE ONLY. A former colleague keeps their role, and offering one as the firm's
   named contact for a new client is exactly the wrong name to put on a mandate. */
ok('...and still only offers somebody who is here', /u\.status === 'Active'/.test(list))

/* ---------------- a firm with no liaison is told, not stuck ---------------- */

/*
 * THE EDGE THIS RULE CREATES. Before it, the picker was never empty -- it listed everybody. Now a
 * firm with no Liaison and no Liaison Manager gets an empty box, and "somebody has to look after
 * this client" becomes a demand nobody can meet. That is a dead form, which is worse than the
 * over-wide list it replaced.
 */
const modal = read('src/components/companies/AddClientModal.tsx')
ok('the picker says so when nobody holds the role',
  /Nobody holds that role yet/.test(modal))
ok('...and is not left pretending to be usable', /disabled=\{liaisons\.length === 0\}/.test(modal))
ok('...and the problem names what to go and do',
  /Set somebody\\u2019s role in Settings/.test(modal))
/* SAID AT THE FIELD, not only after pressing Save: an empty picker with nothing beside it reads
   as a screen that failed to load rather than as a rule. */
ok('...where the choice is made, not only in the errors',
  /liaisons\.length === 0[\s\S]{0,400}A Liaison or Liaison Manager/.test(modal))

console.log(`\ncheck-client-liaison: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
