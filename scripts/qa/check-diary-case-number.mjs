/**
 * Raptor H13: R-6 -- the Diary shows Raptor's case number beside the debtor and the client.
 *
 * Asked for by the call centre ("the reference number, client name and debtor name") and answered
 * by them: Raptor's case number, because it is unique and every notice quotes it (the client's own
 * reference is shared by 21% of the book). Source read back: the select must fetch the column, the
 * mapper must carry it (a hand-written mapper drops columns silently, CLAUDE.md), and the row must draw it.
 *
 * Run: node scripts/qa/check-diary-case-number.mjs
 */
import { readFileSync } from 'node:fs'

let pass = 0
const failures = []
const ok = (name, actual) => {
  if (actual === true) { pass += 1; return }
  failures.push(`${name}\n    expected true\n    got      ${JSON.stringify(actual)}`)
}
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const diary = read('../../src/lib/diary.ts')
const page = read('../../src/pages/diary/DiaryPage.tsx')

const select = diary.slice(diary.indexOf('const ROW_SELECT'), diary.indexOf('`', diary.indexOf('const ROW_SELECT') + 20 + 'const ROW_SELECT'.length))
ok('the select fetches case_number', /debtor_accounts![\s\S]*\bcase_number\b/.test(select))
ok('the row type carries caseNumber', /caseNumber: string \| null/.test(diary))
ok('the mapper reads it', /caseNumber: r\.debtor_accounts\?\.case_number \?\? null/.test(diary))
const item = page.slice(page.indexOf('export function DiaryRowItem'))
ok('the row draws the case number', /row\.account\.caseNumber/.test(item))
ok('...before the debtor name link', item.indexOf('row.account.caseNumber') > -1 && item.indexOf('row.account.caseNumber') < item.indexOf('{debtorName(row)}\n'))
/* The firm's rule: it is OUR number, never the client's reference. */
ok('...and not the client reference', !/clientReference/.test(item.slice(0, item.indexOf('/* ---------- the backlog'))))

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
