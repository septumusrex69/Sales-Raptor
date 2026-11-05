/**
 * A BUZZBOX EXTENSION IS AN ADMINISTRATOR'S TO SET (Raptor · Handover 17, S18; Stephan, 5 Nov: a clerk
 * could change "its own Buzzbox extension. So rather, it should say your Buzzbox is not connected, go
 * speak to an administrator").
 *
 * A clerk had picked somebody else's extension: every call they placed rang that person's desk first,
 * and was logged as theirs. And with no extension, Call fell back to a tel: link, which asked to leave
 * Raptor. Held here: the database reverts the column for anybody but an Administrator; the Settings
 * card offers the picker to Administrators only; and with BuzzBox connected but no extension, Call
 * says so and dials nothing.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-buzzbox-extension.mjs
 */
import { readFileSync } from 'node:fs'

let pass = 0
const failures = []
const ok = (n, a) => { if (a === true) pass += 1; else failures.push(n) }
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

const sql = read('supabase/schema.sql')
const at = sql.lastIndexOf('create or replace function public.protect_profile_privileged_fields(')
const guard = sql.slice(at, sql.indexOf('\nend $$;', at))
ok('the profile guard is in the schema', at > 0 && guard.length > 1000)
const adminAt = guard.indexOf("is distinct from 'Administrator' then")
const nonAdmin = adminAt < 0 ? '' : guard.slice(adminAt, guard.indexOf('return new;', adminAt))
ok('...and reverts the extension for anybody but an Administrator', /new\.buzzbox_extension := old\.buzzbox_extension;/.test(nonAdmin))

const link = read('src/components/PhoneLink.tsx')
const noExtAt = link.indexOf('if (noExtension) {')
ok('Call knows when BuzzBox is connected and the extension is not', /const noExtension = !!status\?\.connected && !status\.extension/.test(link) && noExtAt > 0)
const noExt = link.slice(noExtAt, link.indexOf('if (!canDial) {', noExtAt))
ok('...says the firm’s words', noExt.includes('Your BuzzBox is not connected. Speak to an administrator.'))
ok('...and dials nothing: no tel: link, nothing logged', !/tel:/.test(noExt) && !/onDialled/.test(noExt))
ok('...and no longer sends the clerk to pick one', !/pick yours/i.test(link))

const settings = read('src/pages/settings/SettingsPage.tsx')
const mine = settings.slice(settings.indexOf('<FormField label="Your extension">') - 400, settings.indexOf('<FormField label="Your extension">'))
ok('the Settings picker for your own extension is Administrators only', /\{isAdmin \? \(/.test(mine))
ok('...and everybody else is told who to ask', settings.includes("'Your BuzzBox is not connected. Speak to an administrator.'"))

const api = read('api/_lib/buzzbox/call.ts')
ok('the server says the same if a call gets that far', api.includes('Your BuzzBox is not connected. Speak to an administrator.'))

console.log(`${pass} passed, ${failures.length} failed`)
if (failures.length) { for (const f of failures) console.log(`  FAIL ${f}`); process.exit(1) }
