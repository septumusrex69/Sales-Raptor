/**
 * THE CURSOR STARTS WHERE THE MESSAGE IS MISSING SOMETHING (S10, 23 Oct).
 *
 * The firm, forwarding a mail: it "starts typing with message. It doesn't say who do I want to
 * send it to", under a title reading "Reply to" with nobody after it. Holds: the message box asks
 * for focus only once an address is in, and a forward is titled Forward.
 *
 * Run: node scripts/qa/check-compose-focus.mjs
 */
import { readFileSync } from 'node:fs'

let pass = 0
const failures = []
const ok = (name, v) => { if (v === true) pass += 1; else failures.push(name) }
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const compose = strip(readFileSync(new URL('../../src/components/ComposeEmailModal.tsx', import.meta.url), 'utf8'))
const mail = strip(readFileSync(new URL('../../src/pages/mail/MailPage.tsx', import.meta.url), 'utf8'))

ok('To asks for focus while it is empty', /autoFocus=\{!address\}/.test(compose))
ok('the message box asks for focus only once somebody is addressed', /autoFocus=\{!!initialSubject && !!address\}/.test(compose))
ok('no other autofocus on the message box', !/autoFocus=\{!!initialSubject\} \/>/.test(compose))
ok('a reply with nobody on it is not titled "Reply to"', /initialSubject && \(to \?\? address\) \? `Reply to/.test(compose))
ok('the mail page titles a forward Forward', /<ComposeEmailModal\s+title="Forward"\s+initialSubject=\{forwardSubject/.test(mail))

if (failures.length) {
  console.error(`check-compose-focus: ${failures.length} failed, ${pass} passed\n  ✗ ${failures.join('\n  ✗ ')}`)
  process.exit(1)
}
console.log(`check-compose-focus: ${pass} passed, 0 failed`)
