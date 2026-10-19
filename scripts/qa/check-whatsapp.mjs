/**
 * WHATSAPP FROM RAPTOR, BY LINK (S9, 19 Oct). The firm: "if I click on the WhatsApp number and it
 * asks me which number to WhatsApp, it already opens it ... I don't want to build in WhatsApp because
 * it's expensive."
 *
 * Holds: the number is turned into the form wa.me needs (the leads list sent "0821234567" as typed
 * and reached nobody); only cellphones are offered; the opening line names the firm and our case
 * number; on a debtor's account the press is noted and charged under 1(c), on the sales side it is
 * noted and charged nothing; and every record page carries the button.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-whatsapp.mjs
 */
import { readFileSync } from 'node:fs'
import { whatsAppLink, whatsAppNote, whatsAppNumber, whatsAppOpening } from '../../src/lib/whatsapp.ts'

let pass = 0
const failures = []
const ok = (name, cond) => { if (cond) pass += 1; else failures.push(name) }
const check = (name, got, want) => ok(`${name}\n    expected ${JSON.stringify(want)}\n    got      ${JSON.stringify(got)}`, JSON.stringify(got) === JSON.stringify(want))
const read = (f) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

/* ---------- the number ---------- */
check('a local cellphone gains the 27 and loses the 0', whatsAppNumber('082 123 4567'), '27821234567')
check('...written any way', whatsAppNumber('(082) 123-4567'), '27821234567')
check('...or already international', whatsAppNumber('+27 82 123 4567'), '27821234567')
check('...or with 00', whatsAppNumber('0027821234567'), '27821234567')
check('06 and 07 are cellphones too', [whatsAppNumber('0612345678'), whatsAppNumber('0721234567')], ['27612345678', '27721234567'])
check('a landline is not offered (a chat that can never be delivered)', whatsAppNumber('011 592 0520'), null)
check('...nor a number too short or too long', [whatsAppNumber('082123456'), whatsAppNumber('08212345678')], [null, null])
check('another country’s number, written internationally, is kept', whatsAppNumber('+44 7700 900123'), '447700900123')
check('nothing on file, nothing offered', [whatsAppNumber(''), whatsAppNumber(null)], [null, null])

/* ---------- the link and the opening line ---------- */
check('the link opens WhatsApp on the number', whatsAppLink('27821234567'), 'https://wa.me/27821234567')
check('...with the line typed in, encoded', whatsAppLink('27821234567', 'Good day Piet, & more'), 'https://wa.me/27821234567?text=Good%20day%20Piet%2C%20%26%20more')
check('on an account the line names the firm and OUR case number',
  whatsAppOpening({ firstName: 'Piet', senderName: 'Nicole', caseNumber: 'BF-001234' }),
  'Good day Piet, this is Nicole from Bredell Ferreira, regarding your account BF-001234.')
check('...and without one, the firm only', whatsAppOpening({}), 'Good day, this is Bredell Ferreira.')

/* ---------- the button ---------- */
const button = strip(read('src/components/record/WhatsAppButton.tsx'))
ok('it is a real link that opens a new tab (nothing awaited first, so never a blocked pop-up)',
  /<a href=\{whatsAppLink\(n\.wa, message\)\} target="_blank" rel="noopener noreferrer"/.test(button))
ok('only numbers WhatsApp can reach are offered', /\.filter\(\(n\): n is typeof n & \{ wa: string \} => !!n\.wa\)/.test(button))
ok('more than one and it asks which', /WhatsApp which number\?/.test(button))
ok('the sales side notes it as a WhatsApp activity', /addActivity\(\{ type: 'WhatsApp'/.test(button))
ok('...and charges nothing there', !/chargeItem/.test(button))

/* ---------- the debtor's account: noted and charged 1(c), the firm's decision ---------- */
const acct = strip(read('src/lib/accountWhatsApp.ts'))
ok('on an account the press is charged under item 1(c)', /WHATSAPP_ITEM = '1c'/.test(read('src/lib/accountWhatsApp.ts')) && /itemId: WHATSAPP_ITEM/.test(acct))
ok('...as Swordfish’s own action code', /WHATSAPP_ACTION_CODE = 'whatsapp'/.test(read('src/lib/accountWhatsApp.ts')))
ok('...one per message sent, as the person says on the way back (the firm, 19 Oct)', /quantity: input\.count/.test(acct))
ok('...nought sent charges nothing', /input\.count > 0 \? await chargeItem\(/.test(acct))
ok('...and noted on the timeline, without the charge in the note', /body: whatsAppNote\(input\.number, input\.count\)/.test(acct))
check('the note says how many', whatsAppNote('082 456 7890', 2), 'WhatsApp to 082 456 7890 · 2 messages')
check('...and says so when nothing went', whatsAppNote('082 456 7890', 0), 'WhatsApp opened to 082 456 7890, nothing sent')
ok('the question is put up the moment WhatsApp opens, so it is waiting on the way back',
  /onClick=\{\(\) => \{ setChoosing\(false\); setAsking\(n\.value\) \}\}/.test(button))
const detail = strip(read('src/pages/accounts/AccountDetail.tsx'))
ok('the account’s WhatsApp is no longer "not built yet"', !/label="WhatsApp" title=\{soon\}/.test(detail) && /<WhatsAppButton numbers=\{callNumbers\}/.test(detail))
ok('...and records the press through recordWhatsApp', /recordWhatsApp\(\{ accountId: account\.id, number/.test(detail))

for (const [what, file] of [
  ['a client', 'src/pages/companies/CompanyDetail.tsx'], ['a lead', 'src/pages/leads/LeadDetail.tsx'],
  ['a contact', 'src/pages/contacts/ContactDetail.tsx'], ['a deal', 'src/pages/deals/DealDetail.tsx'],
]) ok(`${what} has WhatsApp beside Call`, /<CrmCallButton[\s\S]*?\/>[\s{}]*<CrmWhatsAppButton /.test(strip(read(file))))
ok('the leads list goes through whatsAppNumber, not the digits as typed', /whatsAppNumber\(lead\.mobile\)/.test(read('src/pages/leads/LeadsList.tsx')) && !/wa\.me\/\$\{lead\.mobile/.test(read('src/pages/leads/LeadsList.tsx')))

if (failures.length) { console.error(`check-whatsapp: ${failures.length} failed, ${pass} passed\n  ✗ ${failures.join('\n  ✗ ')}`); process.exit(1) }
console.log(`check-whatsapp: ${pass} passed, 0 failed`)
