/**
 * THE SMS TAB: WHAT WAS SAID, AND WHEN IT WENT (R-10, Call centre, 27 Oct).
 *
 * The request: "the clerk can also view the sms that was sent as well as add the time when the sms
 * was sent." The words were already in sms_messages; nothing on the account read them back.
 * Holds: the time is Johannesburg's and 24-hour (an SMS at 00:30 on the 28th is not the 27th), the
 * moment it went is sent_at and falls back to created_at for a queued row, the text is drawn in
 * full, the tab is on the account and the list is read-only.
 *
 * Run: node scripts/qa/check-account-sms.mjs
 */
import { readFileSync } from 'node:fs'
import { smsWhen, toSms } from '../../src/lib/smsView.ts'

let pass = 0
const failures = []
const ok = (name, v) => { if (v === true) pass += 1; else failures.push(name) }
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const bare = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

ok('12:32 UTC is 14:32 in Johannesburg', smsWhen('2026-10-27T12:32:00Z') === '27 Oct 2026 · 14:32')
ok('22:30 UTC is already the next day, half past midnight', smsWhen('2026-10-27T22:30:00Z') === '28 Oct 2026 · 00:30')
ok('a bad timestamp draws nothing rather than "Invalid Date"', smsWhen('not a date') === '')

const row = {
  id: 's1', direction: 'outbound', msisdn: '0645498432', body: 'Please call us.', segments: 1,
  status: 'delivered', status_detail: null, sent_at: '2026-10-27T12:32:00Z', delivered_at: null,
  created_at: '2026-10-27T12:31:00Z',
}
ok('the moment it went is sent_at', toSms(row).at === '2026-10-27T12:32:00Z')
ok('a queued row falls back to when it was created', toSms({ ...row, sent_at: null }).at === '2026-10-27T12:31:00Z')
ok('the text is carried whole', toSms(row).body === 'Please call us.')

const panel = bare(read('src/pages/accounts/SmsPanel.tsx'))
ok('the panel draws the text of every message', /\{m\.body\}/.test(panel))
ok('...and the time it went', /smsWhen\(m\.at\)/.test(panel))
ok('...and never truncates the text', !/truncate|line-clamp/.test(panel))
ok('the panel sends nothing: it is read-only', !/sendAccountSms|recordSentSms|onClick/.test(panel))

const detail = bare(read('src/pages/accounts/AccountDetail.tsx'))
ok('the account has an SMS tab', /id: 'SMS', label: 'SMS'/.test(detail))
ok('...that draws the panel', /tab === 'SMS' && <SmsPanel/.test(detail))
ok('...and reloads with the account', /fetchAccountSms\(account\.id\)/.test(detail) && /fetchAccountSms\(id\)/.test(detail))

const fetchSrc = bare(read('src/lib/smsHistory.ts'))
ok('it reads this account\'s messages only', /\.eq\('account_id', accountId\)/.test(fetchSrc))
ok('...newest first', /order\('created_at', \{ ascending: false \}\)/.test(fetchSrc))

if (failures.length) {
  console.error(`check-account-sms: ${failures.length} failed, ${pass} passed\n  ✗ ${failures.join('\n  ✗ ')}`)
  process.exit(1)
}
console.log(`check-account-sms: ${pass} passed, 0 failed`)
