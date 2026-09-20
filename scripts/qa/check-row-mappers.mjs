/**
 * THE HAND-WRITTEN ROW MAPPERS, CHECKED STRUCTURALLY RATHER THAN FIELD BY FIELD.
 *
 * CLAUDE.md names this trap by name, and it was still open: "a column present in the database, in
 * the type and in the select('*') but missing from the mapper reads as undefined for ever and
 * nothing fails. diary_capacity sat in that state for months."
 *
 * The audit of this suite found the guard was OPT-IN PER FIELD. Fourteen of accountBook's
 * fifty-eight were pinned, because fourteen features had been built by somebody who wrote a line
 * for the field they were working on; forty-four could be replaced with a constant and the whole
 * suite stayed green — among them inDuplumCeiling, capitalOutstanding, commissionRate,
 * prescribed, paymentsToDate and accountNumber. The in duplum ceiling could read zero on every
 * account in the book, permanently, and four thousand assertions said nothing.
 *
 * So this file does not test fields. It tests the SHAPE: every key the interface declares must be
 * assigned in the mapper, and must be assigned from the column its name implies. That way a field
 * added tomorrow is covered the moment it is declared, which is the only version of this check
 * that keeps working without somebody remembering it.
 *
 * WHAT IT CANNOT SEE, said plainly: a mapper that reads the right column and mangles the value —
 * Number(r.x) where the column is text, say — passes here. That is a different check's job, and
 * it is a much smaller hole than the one this closes.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-row-mappers.mjs
 */
import { readFileSync } from 'node:fs'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const snake = (k) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)

/** The body of `interface Name { … }`, comments stripped. */
function interfaceBody(src, name) {
  const at = src.search(new RegExp(`(export )?interface ${name}\\b[^{]*\\{`))
  if (at === -1) return null
  const open = src.indexOf('{', at)
  let depth = 0
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}') { depth -= 1; if (depth === 0) return src.slice(open + 1, i) }
  }
  return null
}

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

/** The property names an interface declares, at its top level only. */
function declaredKeys(src, name) {
  const body = interfaceBody(src, name)
  if (body === null) return null
  const clean = stripComments(body)
  const keys = []
  let depth = 0
  for (const line of clean.split('\n')) {
    const before = depth
    depth += (line.match(/[{([]/g) ?? []).length - (line.match(/[}\])]/g) ?? []).length
    if (before !== 0) continue
    const m = /^\s*([A-Za-z_$][\w$]*)\s*\??\s*:/.exec(line)
    if (m) keys.push(m[1])
  }
  return keys
}

/** The body of `function name(...) { … }` or `const name = (...) => ({ … })`. */
function functionBody(src, name) {
  const at = src.search(new RegExp(`(function ${name}\\b|const ${name}\\s*[:=])`))
  if (at === -1) return null
  const open = src.indexOf('{', at)
  let depth = 0
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}') { depth -= 1; if (depth === 0) return src.slice(open + 1, i) }
  }
  return null
}

/**
 * Check one mapper against one interface.
 *
 * `derived` is the explicit allow-list: fields that are genuinely computed rather than read off a
 * column. Every entry is a decision somebody made on purpose, so listing them here is the record
 * of that — and it is a list that only shrinks by accident, never grows by one.
 */
function auditMapper({ label, file, iface, ifaceFile, mapper, row = 'r', derived = {} }) {
  const src = read(file)
  /* The type and its mapper do not always live in the same file: User is declared in types.ts
     and mapped in AuthContext, which is exactly the separation diary_capacity fell through. */
  const keys = declaredKeys(read(ifaceFile ?? file), iface)
  ok(`${label}: the ${iface} interface is readable`, keys !== null && keys.length > 5)
  const body = functionBody(src, mapper)
  ok(`${label}: ${mapper} is readable`, body !== null)
  if (!keys || !body) return

  const clean = stripComments(body)
  /* Every `key:` assigned at the top level of the returned object. */
  const assigned = new Set([...clean.matchAll(/^\s{2,6}([A-Za-z_$][\w$]*)\s*:/gm)].map((m) => m[1]))

  const missing = keys.filter((k) => !assigned.has(k))
  check(`${label}: every declared field is assigned in ${mapper}`, missing, [])

  /*
   * AND FROM THE COLUMN ITS NAME IMPLIES. This is the half that catches a field assigned a
   * constant, or assigned from the wrong column -- which is what the audit's mutations did, and
   * what nothing in the suite noticed.
   */
  const wrong = []
  for (const key of keys) {
    if (key in derived) continue
    const line = new RegExp(`^\\s{2,6}${key}\\s*:([\\s\\S]*?)(?=\\n\\s{2,6}[A-Za-z_$][\\w$]*\\s*:|$)`, 'm')
    const value = line.exec(clean)?.[1] ?? ''
    if (!new RegExp(`\\b${row}\\.${snake(key)}\\b`).test(value)) wrong.push(key)
  }
  check(`${label}: every field reads the column its name implies`, wrong, [])

  /* The allow-list has to stay honest: an entry for a field that IS read off its column is an
     entry that would hide that field going wrong later. */
  const pointless = Object.keys(derived).filter((k) => {
    const line = new RegExp(`^\\s{2,6}${k}\\s*:([\\s\\S]*?)(?=\\n\\s{2,6}[A-Za-z_$][\\w$]*\\s*:|$)`, 'm')
    return new RegExp(`\\b${row}\\.${snake(k)}\\b`).test(line.exec(clean)?.[1] ?? '')
  })
  check(`${label}: nothing is excused that does not need excusing`, pointless, [])
}

/* ------------------------------------------------------------------ the book */

/*
 * accountBook.toAccount. The one CLAUDE.md warns about by name, and the one whose in duplum
 * ceiling could read zero on every account in the book with the suite green.
 */
auditMapper({
  label: 'the collections book',
  file: 'src/lib/accountBook.ts',
  iface: 'DebtorAccount',
  mapper: 'toAccount',
  derived: {
    /* Computed from the ledgers, not stored -- see the header of accountBalance.ts. */
    balance: 'derived from the three ledgers',
    /* A join, not a column on debtor_accounts. */
    companyName: 'joined from companies',
    clientName: 'joined from companies',
    assignedToName: 'joined from profiles',
  },
})

/* ------------------------------------------------------------------ the person */

/* AuthContext.mapProfileRow -- the mapper diary_capacity actually went missing from. */
auditMapper({
  label: 'the signed-in person',
  file: 'src/store/AuthContext.tsx',
  iface: 'User',
  ifaceFile: 'src/types.ts',
  mapper: 'mapProfileRow',
  row: 'row',
  derived: {},
})

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
Every field a row type declares is assigned in its hand-written mapper, and assigned from the
column its name implies -- so a column added tomorrow is covered the moment it is declared, rather
than the day somebody remembers to write a line for it. The trap CLAUDE.md names by name, closed
structurally instead of one field at a time.`)
