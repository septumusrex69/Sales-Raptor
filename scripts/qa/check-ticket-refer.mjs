/**
 * REFER A TICKET, ANSWER IT, AND THE ONE REPLY (S15, Raptor · Handover 14).
 *
 * Stephan, on the first question a client asked from the portal: refer it "to the clerk, to the agent, and
 * give it a referral reason ... and have them give feedback", "also ... refer it to a team leader"; the
 * client's message was drawn DEBTOR; "this reply currently is a reply on an email ... rather a reply to
 * the ticket"; "forward to the client doesn't really make sense"; "click on the reference number and it
 * goes to the account".
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-ticket-refer.mjs
 */
import fs from 'node:fs'
import { canGiveFeedback, emailVoice, feedbackNote, referNote, referTargets } from '../../src/lib/ticketThread.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass += 1
  else failures.push(`${name}\n      expected ${JSON.stringify(expected)}\n      got      ${JSON.stringify(actual)}`)
}
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

/* ---------- who a ticket can be referred to ---------- */
const users = [
  { id: 'liz', name: 'Liz Liaison', role: 'Liaison' },
  { id: 'ag', name: 'Andile Agent', role: 'Collector', teamId: 't1' },
  { id: 'tl1', name: 'Thandi Leader', role: 'Pre-legal Team Leader', teamId: 't1' },
  { id: 'tl2', name: 'Other Leader', role: 'Pre-legal Team Leader', teamId: 't2' },
  { id: 'tl3', name: 'Gone Leader', role: 'Pre-legal Team Leader', teamId: 't1', status: 'Inactive' },
]
check('the agent on the account, then THEIR team leader', referTargets({ agentId: 'ag', actorId: 'liz', users }).map((t) => [t.id, t.stage]),
  [['ag', 'agent'], ['tl1', 'team_leader']])
check('...never an inactive leader, never another team\'s when their own has one',
  referTargets({ agentId: 'ag', actorId: 'liz', users }).some((t) => t.id === 'tl3' || t.id === 'tl2'), false)
check('an agent with no team offers every active team leader',
  referTargets({ agentId: 'ag', actorId: 'liz', users: users.map((u) => (u.id === 'ag' ? { ...u, teamId: null } : u)) }).map((t) => t.id),
  ['ag', 'tl1', 'tl2'])
check('never the person referring', referTargets({ agentId: 'ag', actorId: 'tl1', users }).map((t) => t.id), ['ag'])
check('no agent on the account still offers the team leaders', referTargets({ agentId: null, actorId: 'liz', users }).map((t) => t.id), ['tl1', 'tl2'])
check('the referral is filed with its reason', referNote('Andile Agent', ' Any arrangement? '), 'Referred to Andile Agent: Any arrangement?')

/* ---------- the answer back ---------- */
check('the agent holding it may answer back to the liaison', canGiveFeedback({ stage: 'agent', status: 'open', ownerId: 'ag' }, 'ag', 'liz'), true)
check('...so may the team leader holding it', canGiveFeedback({ stage: 'team_leader', status: 'open', ownerId: 'tl1' }, 'tl1', 'liz'), true)
check('...not somebody it is not with', canGiveFeedback({ stage: 'agent', status: 'open', ownerId: 'ag' }, 'tl1', 'liz'), false)
check('...not on the liaison\'s own desk', canGiveFeedback({ stage: 'liaison', status: 'open', ownerId: 'liz' }, 'liz', 'liz'), false)
check('...not with no liaison to go back to', canGiveFeedback({ stage: 'agent', status: 'open', ownerId: 'ag' }, 'ag', null), false)
check('...not once closed', canGiveFeedback({ stage: 'agent', status: 'closed', ownerId: 'ag' }, 'ag', 'liz'), false)
check('the feedback is filed under the agent\'s name', feedbackNote('Andile Agent', 'Promised R500.'), 'Feedback from Andile Agent: Promised R500.')

/* ---------- the client's portal message is the CLIENT's ---------- */
const mail = { id: 'e', direction: 'in', debtorAddress: 'stephan@urbanhausgroup.co.za', subject: null, body: '', attachmentNames: [], sentByName: null, occurredAt: '' }
check('a message the database calls the client\'s reads Client, whatever the address', emailVoice({ ...mail, correspondent: 'client' }, []), 'client')
check('...and an inbound one it calls the debtor\'s still reads Debtor', emailVoice({ ...mail, correspondent: 'debtor' }, []), 'debtor')

/* ---------- the page ---------- */
const page = strip(fs.readFileSync('src/pages/queries/QueryDetail.tsx', 'utf8'))
check('the reference links to the account', /to=\{`\/accounts\/\$\{data\.account\.id\}`\}[\s\S]{0,200}caseNumber/.test(page), true)
check('referring moves the ticket to the chosen person AND their rung', /updateQuery\(q\.id, \{ ownerId: target\.id, stage: target\.stage \}/.test(page), true)
check('...with the reason on the thread and in their bell', /note: referNote\(target\.name, reason\)/.test(page) && /referred[\s\S]{0,120}to you: \$\{reason/.test(page), true)
check('feedback goes back to the liaison\'s desk and stage', /updateQuery\(q\.id, \{ ownerId: data\.liaisonId, stage: 'liaison' \}/.test(page), true)
check('...and is not offered where Send Back already is', /canGiveFeedback\(q, currentUser\?\.id, data\.liaisonId\) && !canSendBack\(q, currentUser\?\.id\)/.test(page), true)
check('the thread is answered ON THE TICKET, not on one email', /onReply=\{replyOnTicket\}/.test(page), true)
check('...to whoever at the client last wrote, threaded', /function replyOnTicket\(\)[\s\S]{0,400}startReply\(lastFromClient, false\)/.test(page), true)
check('...ending with the portal link where somebody at the client can sign in',
  /const portalLine = activePortal\.length > 0/.test(page) && /\/portal \(ticket/.test(page) && /\? portalLine/.test(page), true)
const thread = strip(fs.readFileSync('src/components/queries/TicketThread.tsx', 'utf8'))
check('Forward to the client is on the debtor\'s messages only', /e\.emailId && e\.voice === 'debtor' &&/.test(thread), true)
check('...and there is no Reply on a single message any more', /onReply\(e\./.test(thread), false)
check('the charge is still said beside the buttons', /R25 under Annexure B\s+item 1\(a\)/.test(fs.readFileSync('src/components/queries/TicketThread.tsx', 'utf8')), true)

if (failures.length) {
  console.log(`check-ticket-refer: ${pass} passed, ${failures.length} failed`)
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`check-ticket-refer: ${pass} passed, 0 failed`)
