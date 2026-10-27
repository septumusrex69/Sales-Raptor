/**
 * EVERYTHING IS OPEN EXCEPT MONEY (S14, 27 Oct). Stephan, of Ryno: "give him access to anything except
 * the financial or anything that has to do with finances." .github/CODEOWNERS owns the money files (and
 * the database, the rules, the permissions) so a change to them waits for Stephan's approval.
 *
 * Two ways that silently stops being true, both held here: a money file RENAMED, so its line matches
 * nothing and the new name is open; and a NEW money file nobody added a line for.
 *
 * Run: node scripts/qa/check-codeowners.mjs
 */
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

let pass = 0
const failures = []
const ok = (name, v) => { if (v === true) pass += 1; else failures.push(name) }

const files = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean)
const lines = readFileSync(new URL('../../.github/CODEOWNERS', import.meta.url), 'utf8')
  .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  .map((l) => { const [pattern, ...owners] = l.split(/\s+/); return { pattern, owners } })

/* A CODEOWNERS pattern as GitHub reads the ones used here: a leading / anchors at the root, a
   trailing / is a folder and everything in it, * is any run of characters inside one name. */
const toRegex = (p) => {
  const body = p.replace(/^\//, '').replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')
  return new RegExp(`^${body}${p.endsWith('/') ? '' : '$'}`)
}
const rules = lines.map((l) => ({ ...l, re: toRegex(l.pattern) }))
const ownerOf = (f) => { let o = null; for (const r of rules) if (r.re.test(f)) o = r.owners; return o }

for (const r of rules) ok(`"${r.pattern}" still matches a file`, files.some((f) => r.re.test(f)))
ok('every line names its owner', rules.every((r) => r.owners.includes('@septumusrex69')))

/* Money by its NAME: a new file called like this is money until somebody decides otherwise. */
const money = /^(src\/(pages|components)\/(trust|business|finance|people)\/|src\/lib\/[^/]*(balance|charge|annexure|tariff|commission|payover|payment|remittance|settlement|trust|bank|business|ledger|excessCredit|interestAccrual|simplePay|money|repayment)[^/]*\.ts$|supabase\/)/i
const open = files.filter((f) => money.test(f) && !ownerOf(f))
ok(`every money file is owned (open: ${open.join(', ') || 'none'})`, open.length === 0)
ok('...and the sales and campaign screens are open', !ownerOf('src/pages/news/NewsPage.tsx') && !ownerOf('src/pages/leads/LeadsPage.tsx'))
ok('...while consent and the rules stay owned', !!ownerOf('src/pages/news/UnsubscribePage.tsx') && !!ownerOf('CLAUDE.md') && !!ownerOf('.github/CODEOWNERS'))

if (failures.length) {
  console.error(`check-codeowners: ${failures.length} failed, ${pass} passed\n  ✗ ${failures.join('\n  ✗ ')}`)
  process.exit(1)
}
console.log(`check-codeowners: ${pass} passed, 0 failed`)
