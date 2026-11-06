/**
 * legal@ IS CONNECTED WHERE IT IS CHOSEN (Raptor · Handover 17, S18; Stephan, 6 Nov: "It gives me an option to
 * choose everybody else's email addresses ... Doesn't give me an option to choose legal. I think you should be
 * able to connect it from there").
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-central-mailbox.mjs
 */
import { readFileSync } from 'node:fs'

let pass = 0
const failures = []
const ok = (n, a) => { if (a === true) pass += 1; else failures.push(n) }
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const card = read('src/components/settings/CentralMailboxCard.tsx')

ok('the card offers to connect legal@ itself', /Connect \$\{UNASSIGNED_MAILBOX\}/.test(card) && /email: UNASSIGNED_MAILBOX/.test(card))
ok('...making a login nobody can sign in to when there is none', /\/api\/invite-user', \{ email, name: [^}]*role: 'Read Only', signIn: false \}/.test(card))
ok('...reusing one that already has the address', /users\.find\(\(u\) => \(u\.email \?\? ''\)\.toLowerCase\(\) === email\)/.test(card))
ok('...connecting its mailbox through the same route as for a colleague', /\/api\/email\/connect', \{\s*targetUserId: userId/.test(card))
ok('...and choosing it as the central mailbox', /firm_mailboxes'\)\.upsert\(\{\s*purpose: 'central', user_id: userId/.test(card))
ok('...in that order: login, mailbox, choice', card.indexOf("'/api/invite-user'") < card.indexOf("'/api/email/connect'")
  && card.indexOf("'/api/email/connect'") < card.lastIndexOf("purpose: 'central', user_id: userId"))
ok('the password is cleared once used', /setForm\(\(f\) => \(\{ \.\.\.f, password: '' \}\)\)/.test(card))
ok('the card is full width, not a squashed column', /md:col-span-2/.test(card))
ok('the existing-login picker is a full-width input', /className=\{`\$\{inputClass\} mt-2 text-sm`\}/.test(card))
ok('...and lists inactive logins too (legal@ is one)', !/status !== 'Inactive'/.test(card))
ok('Administrators only', /if \(!admin\) return null/.test(card))

const settings = read('src/pages/settings/SettingsPage.tsx')
ok('BuzzBox: everyone’s extensions are folded away', /<details data-testid="buzzbox-everyone">/.test(settings))

console.log(`${pass} passed, ${failures.length} failed`)
if (failures.length) { for (const f of failures) console.log(`  FAIL ${f}`); process.exit(1) }
