/**
 * "CHECKED ... AGO" ON THE MAIL PAGE IS MEASURED ON THE REAL CLOCK (S15, Raptor · Handover 14).
 *
 * Stephan, on staging set to 11 Nov while the real date was 28 Oct: "my thing says checked 14 days ago,
 * weird." The mailbox's last sync is stamped on the real clock; agoLabel measures from the firm's
 * (staging) clock unless told otherwise, so the two clocks' gap was read as the age of the check. The
 * bell had exactly this fault (notificationGroups). Mail arrives in real time, so the label asks the
 * real clock.
 *
 * Run: node scripts/qa/check-mail-checked-clock.mjs
 */
import { readFileSync } from 'node:fs'
const page = readFileSync(new URL('../../src/pages/mail/MailPage.tsx', import.meta.url), 'utf8')
const failures = []
if (!/Checked \{agoLabel\(checkedAt, new Date\(\)\)\}/.test(page)) failures.push('the mail page\'s "Checked" label is measured on the real clock')
if (/Checked \{agoLabel\(checkedAt\)\}/.test(page)) failures.push('...and not on the staging clock')
if (failures.length) { console.error(`check-mail-checked-clock: ${failures.length} failed\n  ✗ ${failures.join('\n  ✗ ')}`); process.exit(1) }
console.log('check-mail-checked-clock: 2 passed, 0 failed')
