/**
 * R-9: a team leader can send a ticket back to the clerk who raised it, with a question, and the
 * clerk is told. Holds the rule (ticketThread.canSendBack), the note, and the wiring in
 * QueryDetail and updateQuery.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-send-back.mjs
 */
import { readFileSync } from 'node:fs'
import { canSendBack, sendBackNote } from '../../src/lib/ticketThread.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

const open = { stage: 'team_leader', status: 'open', raisedBy: 'clerk' }
check('team leader can send it back', canSendBack(open, 'tl'), true)
check('not by the clerk themselves', canSendBack(open, 'clerk'), false)
check('not once it is with the liaison', canSendBack({ ...open, stage: 'liaison' }, 'tl'), false)
check('not once it is already with the agent', canSendBack({ ...open, stage: 'agent' }, 'tl'), false)
check('not when closed', canSendBack({ ...open, status: 'closed' }, 'tl'), false)
check('not when nobody raised it', canSendBack({ ...open, raisedBy: null }, 'tl'), false)
check('note names the clerk and the question', sendBackNote('Sam', ' Which month? '), 'Sent back to Sam: Which month?')
check('note without a name', sendBackNote(null, 'Why?'), 'Sent back to the clerk: Why?')

const detail = read('src/pages/queries/QueryDetail.tsx')
const lib = read('src/lib/accountQueries.ts')
check('detail offers the button only by the rule', /canSendBack\(q, currentUser\?\.id\)/.test(detail), true)
check('detail hands it to the raiser at the agent stage',
  /ownerId: q\.raisedBy, stage: 'agent'/.test(detail), true)
check('detail files the question on the thread', /note: sendBackNote\(/.test(detail), true)
check('the clerk\'s bell gets its own sentence', /message: context\.bell/.test(lib) && /input\.message \?\?/.test(lib), true)

console.log(`\ncheck-send-back: ${pass} passed, ${failures.length} failed`)
if (failures.length) { for (const f of failures) console.log(`  FAIL ${f}`); process.exit(1) }
