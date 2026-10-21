/**
 * THE NEW CLIENT'S WELCOME (S8, 18 Oct): Sales assigns a liaison, the welcome goes from her, she is
 * told three ways, and the four steps are ticked from facts already on the client.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-welcome.mjs
 */
import { readFileSync } from 'node:fs'
import { welcomeEmail } from '../../src/lib/welcomeEmail.ts'
import { welcomeSteps, isLiaisonRole } from '../../src/lib/welcome.ts'
import { newClientPopup } from '../../src/lib/newWork.ts'

let pass = 0
const failures = []
const ok = (name, cond) => { if (cond) pass += 1; else failures.push(name) }
const check = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want))

/* ---------- the email ---------- */
const mail = welcomeEmail({
  clientName: 'Abc Cricket', contactName: 'Piet Pompies',
  liaison: { name: 'Bonita Mahlangu', email: 'bonita@bf.example', phone: '012 000 0001', whatsapp: '012 000 0001' },
  closerName: 'Dean Fourie', bannerUrl: 'https://raptor.example/brand/email/welcome.jpg',
})
ok('the subject welcomes the client by name', mail.subject === 'Welcome to Bredell Ferreira - Abc Cricket')
ok('it greets the person at the client', mail.text.startsWith('Dear Piet'))
ok('"my name is Bonita"', /My name is Bonita Mahlangu and I will be your client liaison/.test(mail.text))
ok('...taking over from the closer, by first name', /taking over from Dean/.test(mail.text))
ok('...says she will call', /I will give you a call shortly/.test(mail.text))
ok('...and how to reach her directly', /Phone: 012 000 0001/.test(mail.text) && /Email: bonita@bf\.example/.test(mail.text))
ok('...a WhatsApp the same as the phone is not said twice', !/WhatsApp:/.test(mail.text))
ok('the banner picture is at the top', mail.html.startsWith('<div') && /<img src="https:\/\/raptor\.example\/brand\/email\/welcome\.jpg"/.test(mail.html))
for (const [name, re] of [['no commission', /commission/i], ['no fee', /\bfees?\b/i], ['no promise of a result', /guarantee|we will recover/i]]) ok(`it says nothing about terms: ${name}`, !re.test(mail.text))
ok('no person at the client: "Good day"', welcomeEmail({ clientName: 'X', contactName: null, liaison: { name: 'B M', email: null, phone: null, whatsapp: null }, closerName: null, bannerUrl: 'u' }).text.startsWith('Good day'))

/* ---------- the steps ---------- */
const co = { id: 'c1', mandateSignedAt: '2026-10-11T08:00:00Z', liaisonAssignedAt: '2026-10-12T08:00:00Z', welcomeSentAt: '2026-10-12T08:00:01Z' }
check('signed, assigned, emailed, not yet called', welcomeSteps(co, []).map((s) => s.done), [true, true, true, false])
check('a call logged on the client after the assignment ticks the last step', welcomeSteps(co, [{ type: 'Courtesy Call', companyId: 'c1', activityDate: '2026-10-13T09:00:00Z' }]).map((s) => s.done), [true, true, true, true])
check('...a call from BEFORE the assignment does not', welcomeSteps(co, [{ type: 'Call', companyId: 'c1', activityDate: '2026-10-01T09:00:00Z' }])[3].done, false)
check('...nor an email, nor a call on another client', welcomeSteps(co, [{ type: 'Email', companyId: 'c1', activityDate: '2026-10-13T09:00:00Z' }, { type: 'Call', companyId: 'c2', activityDate: '2026-10-13T09:00:00Z' }])[3].done, false)
ok('only a Liaison or Liaison Manager may be a client\'s liaison', isLiaisonRole('Liaison') && isLiaisonRole('Liaison Manager') && !isLiaisonRole('Sales Rep') && !isLiaisonRole('Administrator'))

/* ---------- her pop-up ---------- */
const notes = [
  { id: 'a', type: 'client.assigned', read: false, link: '/companies/c1', message: 'New client: Abc', createdAt: '' },
  { id: 'b', type: 'client.assigned', read: true, link: '/companies/c2', message: 'old', createdAt: '' },
  { id: 'c', type: 'Task due', read: false, link: '/tasks', message: 'x', createdAt: '' },
]
check('the pop-up: unread new-client notices only', newClientPopup(notes, '/').map((n) => n.id), ['a'])
check('...and never over the client it would open', newClientPopup(notes, '/companies/c1').length, 0)

/* ---------- the route ---------- */
const route = readFileSync(new URL('../../api/_lib/email/welcome.ts', import.meta.url), 'utf8')
const router = readFileSync(new URL('../../api/email/[action].ts', import.meta.url), 'utf8')
ok('the route is registered', /\n  welcome,\n/.test(router) && /import welcome from '\.\.\/_lib\/email\/welcome\.js'/.test(router))
ok('it refuses anybody but Sales, a Liaison Manager or an Administrator', /role === 'Administrator' \|\| role\.includes\('Sales'\) \|\| role === 'Liaison Manager'/.test(route) && /status\(403\)/.test(route))
ok('...and a liaison who is not one', /liaison\.role === 'Liaison' \|\| liaison\.role === 'Liaison Manager'/.test(route))
ok('the client becomes hers and stops waiting', /account_owner_id: liaisonId, liaison_needed: false, liaison_assigned_at: nowIso/.test(route))
ok('the welcome goes from HER mailbox first, the closer\'s only if hers will not', route.indexOf('sendAsUser(admin, liaisonId') > 0 && route.indexOf('sendAsUser(admin, liaisonId') < route.indexOf('sendAsUser(admin, caller.id'))
ok('a "Welcome call" task on her list, on a working day', /title: `Welcome call: \$\{company\.name\}`/.test(route) && /owner_id: liaisonId/.test(route) && /getUTCDay\(\) === 0 \|\| due\.getUTCDay\(\) === 6/.test(route))
ok('her pop-up notice', /type: 'client\.assigned'/.test(route) && /user_id: liaisonId/.test(route))
ok('both written into the client\'s notes', /Liaison assigned: \$\{liaison\.name\}/.test(route))
ok('dated on the firm\'s clock', /admin\.rpc\('raptor_clock'\)/.test(route))

/* ---------- signing marks the client as waiting ---------- */
const sql = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8')
const fn = sql.slice(sql.lastIndexOf('create or replace function public.mandate_on_signed('))
ok('a client signed online waits for a liaison', /liaison_needed = true/.test(fn.slice(0, fn.indexOf('$$;'))))

if (failures.length) { console.error(`check-welcome: ${failures.length} failed, ${pass} passed\n  ✗ ${failures.join('\n  ✗ ')}`); process.exit(1) }
console.log(`check-welcome: ${pass} passed, 0 failed`)
