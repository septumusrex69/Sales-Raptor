/**
 * Can a lead or a client ever be charged an Annexure B fee?
 *
 * WHY THIS EXISTS. The firm asked for the same action row on every record page — the phone, SMS
 * and email on a Lead and a Client, not only on a debtor. The furniture is now shared, and that
 * is exactly where the money rule could follow it by accident: the debtor's Call button raises
 * item 2 on every dial and item 7 if they answer, because a debtor pays for the work of
 * collecting from them. A lead owes us nothing. A client is the person PAYING us.
 *
 * A fee raised against the wrong kind of record is not a visual bug. It lands on a statement, it
 * flows into a remittance, and the firm's own rule is that a remitted fee is never reversed. So
 * the guarantee is structural rather than careful: the shared record components reach the dialler
 * and the activity log, and they cannot reach the charge engine at all.
 *
 * This walks what those components actually import, transitively, and fails if any of it does.
 *
 *   node scripts/qa/check-crm-charges.mjs
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const ROOT = new URL('../..', import.meta.url).pathname
const START = join(ROOT, 'src/components/record')

/**
 * The modules that raise money, named once.
 *
 * chargeEngine is the floor — everything that charges goes through it — and the rest are listed
 * as well so a failure names the route a person would recognise rather than the bottom of it.
 */
const CHARGING = [
  'src/lib/chargeEngine',
  'src/lib/accountCharges',
  'src/lib/accountCalls',
  'src/lib/accountSms',
  'src/lib/accountPromises',
  'src/lib/accountTrace',
]

/** Resolve a relative import to a real file, trying the extensions this repo uses. */
function resolveImport(fromFile, spec) {
  if (!spec.startsWith('.')) return null
  const base = resolve(dirname(fromFile), spec.replace(/\.js$/, ''))
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

function importsOf(file) {
  const source = readFileSync(file, 'utf8')
  const specs = []
  for (const [, spec] of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) specs.push(spec)
  for (const [, spec] of source.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.push(spec)
  return specs
}

const seen = new Set()
/** file -> the file that pulled it in, so a failure can print the whole route. */
const broughtInBy = new Map()
const queue = []

for (const entry of readdirSync(START)) {
  if (/\.tsx?$/.test(entry)) queue.push(join(START, entry))
}
const entryPoints = [...queue]

while (queue.length > 0) {
  const file = queue.shift()
  if (seen.has(file)) continue
  seen.add(file)
  for (const spec of importsOf(file)) {
    const target = resolveImport(file, spec)
    if (!target || seen.has(target)) continue
    broughtInBy.set(target, file)
    queue.push(target)
  }
}

/** The chain from an entry point down to the offending module, for the error message. */
function routeTo(file) {
  const chain = [file]
  let at = file
  while (broughtInBy.has(at)) {
    at = broughtInBy.get(at)
    chain.unshift(at)
  }
  return chain.map((f) => relative(ROOT, f)).join('\n    -> ')
}

const problems = []
for (const file of seen) {
  const rel = relative(ROOT, file).replace(/\.tsx?$/, '')
  if (CHARGING.includes(rel)) problems.push(routeTo(file))
}

if (problems.length > 0) {
  console.error('\nFAIL — a shared record component can reach the fee engine:\n')
  for (const p of problems) console.error(`    ${p}\n`)
  console.error('These components are used on Lead and Client pages, where nobody owes the firm')
  console.error('anything. A fee raised there lands on a statement and flows into a remittance,')
  console.error('and a remitted fee is never reversed. Keep the charging path on the debtor side.\n')
  process.exit(1)
}

console.log(
  `PASS — ${entryPoints.length} shared record component(s) reach ${seen.size} module(s),`
  + ' and none of them can raise a fee',
)
