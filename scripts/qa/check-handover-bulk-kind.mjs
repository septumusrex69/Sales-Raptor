/**
 * R-5: person-or-business chosen in bulk on a NEW handover draft.
 * Only guessed rows are offered; facts (stated, registration number, valid ID) and excluded rows
 * are never touched; and the screen shows the count and asks before writing.
 */
import { readFileSync } from 'node:fs'
import { kindGroups, KIND_WORDS } from '../../src/lib/handoverBulkKind.ts'
import { HANDOVER_COLUMNS } from '../../src/lib/handoverSheet.ts'

let pass = 0
const failures = []
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) { pass += 1; return }
  failures.push(`${label}\n    expected ${e}\n    got      ${a}`)
}
const ok = (label, actual) => check(label, actual, true)
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const row = (id, values, excluded = false) => ({ id, line: Number(id.slice(1)) + 1, excluded, values })
const rows = [
  row('r1', { name: 'Smit' }),                                   // no evidence
  row('r2', { name: 'Kasteel Trading (Pty) Ltd' }),             // registered name
  row('r3', { name: 'Jansen', debtor_kind: 'Sole proprietor' }), // unrecognised word
  row('r4', { name: 'Dlamini', debtor_kind: 'Person' }),        // stated
  row('r5', { name: 'Acme', registration_number: '2001/012345/07' }), // fact
  row('r6', { name: 'Botha', id_number: '8001015009087' }),     // valid ID: fact
  row('r7', { name: 'Excluded Person' }, true),                 // excluded
]
const g = kindGroups(rows)
const ids = (guess) => (g.find((x) => x.guess === guess)?.rows ?? []).map((r) => r.id)
check('no evidence', ids('no-evidence'), ['r1'])
check('registered name', ids('registered-name'), ['r2'])
check('unrecognised word', ids('unrecognised-word'), ['r3'])
const all = g.flatMap((x) => x.rows.map((r) => r.id))
ok('stated, registration number and valid ID are never offered', !['r4', 'r5', 'r6'].some((i) => all.includes(i)))
ok('an excluded row is never offered', !all.includes('r7'))
check('nothing to ask -> no groups', kindGroups([rows[3], rows[4]]), [])

/* the words written are the ones the sheet's own dropdown offers */
const col = HANDOVER_COLUMNS.find((c) => c.key === 'debtor_kind')
check('bulk words are the dropdown choices', [KIND_WORDS.person, KIND_WORDS.business], col.choices)

/* the screen: count shown, confirmation before writing, one cell write per row via the same path */
const card = code(read('../../src/components/settings/HandoverImportCard.tsx'))
const panel = code(read('../../src/components/settings/BulkKindPanel.tsx'))
ok('card draws the panel', card.includes('<BulkKindPanel'))
ok('card applies it through onEdit/setDraftRowValue per row', card.includes('onBulkKind'))
ok('panel asks before writing', panel.includes('confirming') && panel.includes('Change '))
ok('panel says the count', panel.includes('rows.length'))
ok('card writes debtor_kind through the one-cell path', /setDraftRowValue\(id, 'debtor_kind', word\)/.test(card))
ok('nothing here writes an ID or registration number', !/id_number|registration_number/.test(panel + card.slice(card.indexOf('async function bulkKind'), card.indexOf('async function exclude'))))

if (failures.length) {
  console.error(`check-handover-bulk-kind: ${failures.length} failed\n` + failures.join('\n'))
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
