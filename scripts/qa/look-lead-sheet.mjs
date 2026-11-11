/**
 * What the leads-sheet import would do with a real sheet, without a database.
 *
 * Run: node --experimental-strip-types --import ./scripts/qa/tsresolve.mjs scripts/qa/look-lead-sheet.mjs <sheet.csv> [--all]
 *
 * Pretends Raptor is empty and has four reps, so it shows every translation the import makes.
 */
import { readFileSync } from 'node:fs'
import { parseCsvRows } from '../../src/lib/csv.ts'
import { FIELD_BY_KEY, guessMapping, guessValues, planLeadSheet, readSheet } from '../../src/lib/leadSheetImport.ts'

const file = process.argv[2]
if (!file) { console.log('usage: look-lead-sheet.mjs <sheet.csv> [--all]'); process.exit(2) }
const users = ['Destiny', 'Felicia', 'Christoffel', 'Ryno'].map((n, i) => ({ id: `u${i}`, name: `${n} Surname`, status: 'Active' }))
let n = 0
const sheet = readSheet(parseCsvRows(readFileSync(file, 'utf8')))
const mapping = guessMapping(sheet)
const { maps, counts } = guessValues(sheet, mapping, users, 'u3')
console.log('Columns'); sheet.headers.forEach((h, i) => console.log(`  ${(h || '(no heading)').padEnd(28)} → ${FIELD_BY_KEY[mapping[i]]?.label ?? mapping[i]}`))
const print = (title, k) => {
  console.log(`\n${title}`)
  for (const [from, to] of Object.entries(maps[k])) console.log(`  ${(from || '(blank)').padEnd(36)} ×${String(counts[k][from]).padEnd(3)} → ${JSON.stringify(to)}`)
}
for (const k of ['outcome', 'source', 'owner', 'commission', 'rejection']) print(k, k)
const plan = planLeadSheet(sheet, mapping, maps, { leads: [], companies: [], users }, {
  defaultOwnerId: 'u3', today: new Date().toISOString().slice(0, 10), newId: () => `id${++n}`,
})
console.log(`leads ${plan.leads.length} · skipped ${plan.skipped.length} · blank ${plan.skippedBlank} · problems ${plan.problems.length}`)
const by = (f) => Object.entries(plan.leads.reduce((m, l) => ({ ...m, [f(l)]: (m[f(l)] ?? 0) + 1 }), {}))
console.log('status', by((l) => l.lead.status))
console.log('deal stage', by((l) => l.deal.stage))
console.log('\nSkipped'); for (const s of plan.skipped) console.log(`  row ${s.line} ${s.name}: ${s.reason}`)
console.log('\nProblems'); for (const p of plan.problems) console.log(`  ${p}`)
console.log('\nRemarks'); for (const p of plan.remarks) console.log(`  ${p}`)
if (process.argv.includes('--all')) {
  for (const p of plan.leads) {
    const l = p.lead
    console.log(`\n#${p.sheetNumber} row ${p.line} ${l.companyName} | ${l.firstName} / ${l.lastName} | ${l.email ?? '-'} | m ${l.mobile ?? '-'} p ${l.phone ?? '-'} | ${l.status}/${p.deal.stage} | R${l.estimatedHandoverAmount ?? '-'} × ${l.estimatedAccountsCount ?? '-'} | ${l.classification ?? '-'} | ${l.createdAt.slice(0, 10)} last ${l.lastContactAt?.slice(0, 10) ?? '-'} | ${l.commissionRate ?? l.commissionScale ?? '-'} | ${l.rejectionReason ?? ''}`)
  }
}
