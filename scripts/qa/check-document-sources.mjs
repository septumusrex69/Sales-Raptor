/**
 * EVERY PLACE THAT FILES A DOCUMENT ON AN ACCOUNT USES A SOURCE THE DATABASE ACCEPTS (S9, 20 Oct).
 *
 * The ticket route filed email attachments with `source: 'email'` from the day it was built, and
 * `account_documents_source_check` allowed only manual, filename-match and generated -- so a dispute
 * raised from an email was raised and its PDF lost, with the constraint's name on the screen. A
 * value written in TypeScript and a list written in SQL are two lists, and this holds them together.
 *
 * Run: node scripts/qa/check-document-sources.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

let pass = 0
const failures = []
const ok = (name, cond) => { if (cond) pass += 1; else failures.push(name) }
const root = new URL('../../', import.meta.url).pathname

const sql = readFileSync(join(root, 'supabase/schema.sql'), 'utf8')
const at = sql.lastIndexOf('constraint account_documents_source_check')
const allowed = at > 0 ? [...sql.slice(at, sql.indexOf(';', at)).matchAll(/'([a-z-]+)'/g)].map((m) => m[1]) : []
ok('the constraint is in schema.sql, with its list', allowed.length >= 3)

const files = []
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(f)) files.push(p) } }
walk(join(root, 'src')); walk(join(root, 'api'))
const used = []
for (const f of files) {
  const text = readFileSync(f, 'utf8')
  for (const m of text.matchAll(/from\('account_documents'\)\s*\.insert\(/g)) {
    const body = text.slice(m.index, m.index + 1500)
    const end = body.indexOf('})')
    const src = /source:\s*'([a-z-]+)'/.exec(end > 0 ? body.slice(0, end) : body)
    if (src) used.push([f.replace(root, ''), src[1]])
  }
}
ok(`the ticket route's email attachments are among what is filed (${used.map((u) => u[1]).join(', ')})`, used.some(([f, s]) => f.includes('ticket.ts') && s === 'email'))
for (const [f, s] of used) ok(`${f} files source '${s}', which the database accepts (${allowed.join(', ')})`, allowed.includes(s))

if (failures.length) { console.error(`check-document-sources: ${failures.length} failed, ${pass} passed\n  ✗ ${failures.join('\n  ✗ ')}`); process.exit(1) }
console.log(`check-document-sources: ${pass} passed, 0 failed`)
