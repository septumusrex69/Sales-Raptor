/**
 * THE NEW CLIENT'S WELCOME (S8, 18 Oct; made the liaison's press, 23 Oct): Sales assigns a liaison,
 * which SENDS NOTHING -- she is told, and "Send welcome email" and "Welcome call" go on her list; the
 * welcome goes from her when she presses Send, once, stamped with who pressed; and the four steps are
 * ticked from facts already on the client.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-welcome.mjs
 */
import { readFileSync } from 'node:fs'
import { welcomeEmail } from '../../src/lib/welcomeEmail.ts'
import { welcomeSteps, isLiaisonRole, maySendWelcome, welcomeSentLine } from '../../src/lib/welcome.ts'
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
ok('assigned and not yet sent: the email step says it waits for her', welcomeSteps({ ...co, welcomeSentAt: undefined }, [])[2].hint === 'waiting for the liaison to send it' && welcomeSteps({ ...co, welcomeSentAt: undefined }, [])[2].done === false)
ok('...and says nothing of waiting once it has gone', welcomeSteps(co, [])[2].hint === undefined)
check('"sent on <date> by <name>"', welcomeSentLine(co, 'Nicole Botha'), 'Welcome email sent on 12/10/2026 by Nicole Botha')
check('...without a name nobody could trace', welcomeSentLine(co, null), 'Welcome email sent on 12/10/2026')
check('...and nothing before it is sent', welcomeSentLine({ welcomeSentAt: undefined }, 'X'), null)
const own = { accountOwnerId: 'u-nic', liaisonNeeded: false }
ok('her client: she may send', maySendWelcome({ id: 'u-nic', role: 'Liaison' }, own))
ok('...a Liaison Manager and an Administrator may', maySendWelcome({ id: 'm', role: 'Liaison Manager' }, own) && maySendWelcome({ id: 'a', role: 'Administrator' }, own))
ok('...another liaison and Sales may not', !maySendWelcome({ id: 'u-other', role: 'Liaison' }, own) && !maySendWelcome({ id: 's', role: 'Sales Rep' }, own))
ok('...nobody, while the client still waits for a liaison', !maySendWelcome({ id: 'a', role: 'Administrator' }, { accountOwnerId: 'a', liaisonNeeded: true }))
ok('only a Liaison or Liaison Manager may be a client\'s liaison', isLiaisonRole('Liaison') && isLiaisonRole('Liaison Manager') && !isLiaisonRole('Sales Rep') && !isLiaisonRole('Administrator'))

/* ---------- her pop-up ---------- */
const notes = [
  { id: 'a', type: 'client.assigned', read: false, link: '/companies/c1', message: 'New client: Abc', createdAt: '' },
  { id: 'b', type: 'client.assigned', read: true, link: '/companies/c2', message: 'old', createdAt: '' },
  { id: 'c', type: 'Task due', read: false, link: '/tasks', message: 'x', createdAt: '' },
]
check('the pop-up: unread new-client notices only', newClientPopup(notes, '/').map((n) => n.id), ['a'])
check('...and never over the client it would open', newClientPopup(notes, '/companies/c1').length, 0)

/* ---------- assigning: hers, two tasks, her notice, the notes -- and NO email ---------- */
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const assign = strip(read('api/_lib/email/assignLiaison.ts'))
const route = strip(read('api/_lib/email/welcome.ts'))
const router = read('api/email/[action].ts')
ok('both routes are registered on the one email function', /\n  welcome,\n/.test(router) && /'assign-liaison': assignLiaison,/.test(router)
  && /import assignLiaison from '\.\.\/_lib\/email\/assignLiaison\.js'/.test(router))
ok('assigning refuses anybody but Sales, a Liaison Manager or an Administrator', /role === 'Administrator' \|\| role\.includes\('Sales'\) \|\| role === 'Liaison Manager'/.test(assign) && /status\(403\)/.test(assign))
ok('...and a liaison who is not one', /liaison\.role === 'Liaison' \|\| liaison\.role === 'Liaison Manager'/.test(assign))
ok('the client becomes hers and stops waiting', /account_owner_id: liaisonId, liaison_needed: false, liaison_assigned_at: nowIso/.test(assign))
ok('ASSIGNING SENDS NOTHING: no mail code in the assign route', assign.length > 500 && !/sendAsUser|welcomeEmail|welcome_sent_at|resend|nodemailer/i.test(assign))
ok('TWO tasks on her list: "Send welcome email" and "Welcome call"', /title: `Send welcome email: \$\{company\.name\}`/.test(assign) && /title: `Welcome call: \$\{company\.name\}`/.test(assign)
  && /owner_id: liaisonId/.test(assign))
ok('...due the next working day', /getUTCDay\(\) === 0 \|\| due\.getUTCDay\(\) === 6/.test(assign) && /d \+ 1/.test(assign))
ok('her pop-up notice', /type: 'client\.assigned'/.test(assign) && /user_id: liaisonId/.test(assign))
ok('the assignment written into the client\'s notes', /Liaison assigned: \$\{liaison\.name\}/.test(assign))
ok('dated on the firm\'s clock', /admin\.rpc\('raptor_clock'\)/.test(assign) && /admin\.rpc\('raptor_clock'\)/.test(route))
ok('the welcome route no longer assigns, makes tasks or notifies', route.length > 500 && !/liaison_assigned_at|tasks'\)\.insert|notifications'\)\.insert/.test(route))
const store = read('src/store/AppStore.tsx')
ok('converting a lead assigns through the assign route, never the welcome route', /fetch\('\/api\/email\/assign-liaison'/.test(store) && !/fetch\('\/api\/email\/welcome'/.test(store))
const card = read('src/components/companies/WelcomeCard.tsx')
ok('the card\'s Assign posts to the assign route', /post\('assign-liaison', \{ companyId: company\.id, liaisonId: pick \}\)/.test(card))

/* ---------- sending: her press, once, and who pressed ---------- */
ok('the welcome is from the client\'s liaison, read off the client', /const liaisonId = String\(company\.account_owner_id/.test(route))
ok('...pressed by her, a Liaison Manager or an Administrator -- not Sales', /caller\.id === liaisonId \|\| role === 'Administrator' \|\| role === 'Liaison Manager'/.test(route) && !/includes\('Sales'\)/.test(route))
ok('NEVER TWICE BY ACCIDENT: already sent is refused unless asked again', /company\.welcome_sent_at && again !== true/.test(route) && /status\(409\)/.test(route))
ok('the welcome goes from HER mailbox first, the presser\'s only if hers will not', route.indexOf('sendAsUser(admin, liaisonId') > 0 && route.indexOf('sendAsUser(admin, liaisonId') < route.indexOf('sendAsUser(admin, caller.id'))
const failAt = route.indexOf('if (!sent.ok)')
const stampAt = route.indexOf('welcome_sent_at: nowIso, welcome_sent_by: caller.id')
ok('sending stamps WHEN and WHO', stampAt > 0)
ok('...only after it went (a failed send stamps nothing)', failAt > 0 && stampAt > failAt && failAt > route.indexOf('sendAsUser(admin, liaisonId'))
const doneAt = route.indexOf(".update({ status: 'Completed', completed_at: nowIso })")
ok('sending completes her "Send welcome email" task', doneAt > 0 && /\.like\('title', 'Send welcome email:%'\)/.test(route) && failAt > 0 && doneAt > failAt)
ok('...and notes the email on the client', /type: 'Email', user_id: sentBy \?\? caller\.id, company_id: companyId/.test(route))
ok('the card asks before sending again', /setConfirmAgain\(true\)/.test(card) && /send\(true\)/.test(card) && /data-testid="welcome-again-confirm"/.test(card))
ok('...and says when and by whom', /welcomeSentLine\(company, company\.welcomeSentBy/.test(card))
const sqlAll = read('supabase/schema.sql')
ok('companies.welcome_sent_by is in the schema', /add column if not exists welcome_sent_by uuid references public\.profiles \(id\)/.test(sqlAll))

/* ---------- signing marks the client as waiting ---------- */
const sql = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8')
const fn = sql.slice(sql.lastIndexOf('create or replace function public.mandate_on_signed('))
ok('a client signed online waits for a liaison', /liaison_needed = true/.test(fn.slice(0, fn.indexOf('$$;'))))

if (failures.length) { console.error(`check-welcome: ${failures.length} failed, ${pass} passed\n  ✗ ${failures.join('\n  ✗ ')}`); process.exit(1) }
console.log(`check-welcome: ${pass} passed, 0 failed`)
