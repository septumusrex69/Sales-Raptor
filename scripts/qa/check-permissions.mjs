/**
 * WHO MAY SEE WHAT, where hiding a link is the only thing standing in the way.
 *
 * canViewClients was unchecked entirely: `return true` left the whole suite green. It gates six
 * places in the UI, and `companies` is OPEN-READ under RLS -- schema.sql calls it "open read,
 * open insert, update/delete gated to the owner" -- so this function is the only thing keeping a
 * pre-legal agent out of the client register: commission rates, mandates, banking details.
 *
 * THAT MAKES IT DIFFERENT FROM THE REST OF permissions.ts. The file's own docstring says these
 * "mirror the Supabase RLS policies... RLS remains the real enforcement boundary". True of
 * canEditOwned. NOT true of this one, where there is no boundary behind it -- which is worth a
 * check precisely because the comment says there is.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-permissions.mjs
 */
import { readFileSync } from 'node:fs'
import {
  canEditLibrary, canFreezeAccounts, canRefileMail, canReassign, canViewClients, canViewLibrary,
} from '../../src/lib/permissions.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)

/** Every role in the app, so a new one cannot be silently admitted to anything. */
const ROLES = [
  'Administrator', 'Sales Manager', 'Sales Representative', 'Liaison Manager', 'Liaison',
  'Pre-legal Team Leader', 'Pre-legal Agent', 'Read Only',
]

/* ---------- the client register ---------- */

/*
 * A PRE-LEGAL AGENT WORKS DEBTORS, NOT THE FIRM'S RELATIONSHIPS. They see the account, the
 * debtor, the ledger and the dispute -- everything needed to collect -- and not the client behind
 * it, whose commission rates and mandate are commercially sensitive and are the liaison's
 * business.
 */
check('a pre-legal agent may not see the client register', canViewClients('Pre-legal Agent'), false)
check('...and everybody else may',
  ROLES.filter((r) => r !== 'Pre-legal Agent').filter((r) => !canViewClients(r)), [])
/* Nobody at all, before a profile has loaded. A permission that defaults open is a permission
   that is open for the second between sign-in and the profile arriving. */
check('...and nobody before a profile has loaded', canViewClients(undefined), false)

/*
 * ENFORCED IN THE ROUTE AS WELL AS IN THE MENU. Hiding a link is not a permission -- an agent who
 * types /companies must land back on the book they are meant to be working.
 */
const app = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8')
ok('the /companies route is wrapped in a guard',
  /<Route path="\/companies"[^>]*element=\{<RequireClientAccess>/.test(app))
ok('...and so is the one client page', /<Route path="\/companies\/:id"[^>]*element=\{<RequireClientAccess>/.test(app))

/* ---------- the library ---------- */

/* "Perhaps everyone can view everything in the library. Only [an administrator] can edit." */
check('everyone reads the library', ROLES.filter((r) => !canViewLibrary(r)), [])
check('...and nobody before a profile has loaded', canViewLibrary(undefined), false)
check('only an administrator writes it', ROLES.filter((r) => canEditLibrary(r)), ['Administrator'])

/* ---------- the money and record actions ---------- */

/* Re-filing moves a debtor's correspondence between accounts and raises a second item 6 fee on
   the destination, which makes it a money action. */
check('only an administrator re-files already-filed mail',
  ROLES.filter((r) => canRefileMail(r)), ['Administrator'])

/* A freeze takes an account out of circulation. A liaison is included because a freeze is most
   often something a CLIENT asked for, and the liaison is who the client asks. */
check('freezing is management, plus the liaison the client speaks to',
  ROLES.filter((r) => canFreezeAccounts(r)),
  ['Administrator', 'Liaison Manager', 'Liaison', 'Pre-legal Team Leader'].filter((r) => ROLES.includes(r))
    .sort((a, b) => ROLES.indexOf(a) - ROLES.indexOf(b)))
check('a collector does not freeze accounts', canFreezeAccounts('Pre-legal Agent'), false)

check('reassigning is managerial',
  ROLES.filter((r) => canReassign({ role: r })),
  ['Administrator', 'Sales Manager', 'Liaison Manager'])
check('...and nobody, with no user at all', canReassign(null), false)

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
Every role checked against every gate rather than the one role somebody had in mind, so admitting
a new role to something is a decision rather than an omission -- and the client register, whose
only boundary is this function because the table itself is open-read.`)
