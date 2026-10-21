/**
 * DEBTOR CAMPAIGNS (S10, 21 Oct): one SMS or one email to a selection of accounts.
 *
 * THE FIRM: "an option to run a campaign ... on something that you've selected ... send a specific
 * SMS, or ... a specific thing to all of the ... or a selection of the debtors".
 *
 * What this holds, and why each one costs somebody money if it goes:
 *
 *   1. WHO IS SKIPPED, in the order a person would fix it -- closed, prescribed, on hold, an open
 *      dispute, the wrong audience, nowhere to send it, a workflow notice today.
 *   2. THE WORDS ARE THE WORKFLOW'S WORDS: renderTemplate with optional fields, the non-breaking
 *      space out of an SMS's merged values before the segments are counted, emailBodyHtml's
 *      paragraphs and escaping.
 *   3. THE FEE: estimated as count x tariff on the day's schedule, and RAISED only by the charge
 *      engine, per message, after the provider took it -- never in bulk, never in the route.
 *   4. WHO ON WHICH DESKS: an Administrator on any account, a team leader on their own team's,
 *      enforced by the server for every account and again before each message.
 *   5. THE SENDER: calling hours before anything is claimed, the claim is SKIP LOCKED, a stale claim
 *      is failed and never re-sent, and the cron carries a campaign on only when it is the cron.
 *   6. THE MERGE ASSEMBLY IS THE RUNNER'S: the account fields the campaign passes to
 *      accountMergeValues are the ones step.ts passes.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-campaigns.mjs
 */
import { readFileSync } from 'node:fs'
import {
  CAMPAIGN_ACTION, CAMPAIGN_ITEM, campaignConfirmation, campaignFeeEstimate, campaignSkip,
  campaignWordingProblem, looksLikeMobile, mayCampaignOn, mayManageCampaign, renderCampaignMessage,
  skipWords, tallySkips,
} from '../../src/lib/campaigns.ts'
import { withinCallHours as callPanelHours } from '../../src/lib/callScripts.ts'
import { withinCallHours, johannesburgMinute } from '../../src/lib/contactHours.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, v) => check(name, v, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
/* Comments out first: a note saying what must never happen must not count as it happening. */
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const sqlCode = (s) => s.replace(/--[^\n]*/g, '')

/* ---------------------------------------------------------------- 1. who is skipped */

const facts = (over = {}) => ({
  book: 'active', holdReason: null, prescribed: false, debtorKind: 'individual',
  mobile: '082 123 4567', email: 'debtor@example.com', openDispute: false, workflowToday: false, ...over,
})
check('an ordinary account is sent the SMS', campaignSkip(facts(), 'sms'), null)
check('...and the email', campaignSkip(facts(), 'email'), null)
check('a closed account is skipped', campaignSkip(facts({ book: 'closed' }), 'sms'), 'closed')
check('a prescribed debt is skipped', campaignSkip(facts({ prescribed: true }), 'sms'), 'prescribed')
check('an account on hold is skipped', campaignSkip(facts({ book: 'on_hold', holdReason: 'debt_review' }), 'sms'), 'on_hold')
check('...and says why', skipWords('on_hold', { holdReason: 'debt_review' }), 'On hold: Under debt review')
check('an open dispute is skipped', campaignSkip(facts({ openDispute: true }), 'email'), 'dispute')
check('no mobile, no SMS', campaignSkip(facts({ mobile: null }), 'sms'), 'no_mobile')
check('...but the email still goes', campaignSkip(facts({ mobile: null }), 'email'), null)
check('no email, no email', campaignSkip(facts({ email: '  ' }), 'email'), 'no_email')
check('a number an SMS cannot reach is skipped', campaignSkip(facts({ mobile: '12345' }), 'sms'), 'bad_number')
check('a workflow notice today is skipped', campaignSkip(facts({ workflowToday: true }), 'sms'), 'workflow_today')
check('company wording does not go to a person', campaignSkip(facts(), 'sms', 'company'), 'wrong_audience')
check('...nor personal wording to a company', campaignSkip(facts({ debtorKind: 'company' }), 'sms', 'individual'), 'wrong_audience')
check('wording for either goes to both', campaignSkip(facts({ debtorKind: 'company' }), 'sms', null), null)
/* THE ORDER IS THE FIX ORDER: a closed account with no number is closed. */
check('closed is reported before anything else', campaignSkip(facts({ book: 'closed', mobile: null, openDispute: true }), 'sms'), 'closed')
check('...on hold before a missing number', campaignSkip(facts({ book: 'on_hold', mobile: null }), 'sms'), 'on_hold')
ok('a South African cell number is a mobile', looksLikeMobile('082 123 4567') && looksLikeMobile('+27 82 123 4567'))
ok('...a nine-digit typo is not', !looksLikeMobile('82 123 456'))
check('skips are counted by reason, most first',
  tallySkips([{ reason: 'no_mobile' }, { reason: 'dispute' }, { reason: 'no_mobile' }]).map((t) => [t.words, t.count]),
  [['No mobile number', 2], ['An open dispute', 1]])

/* ---------------------------------------------------------------- 2. the words */

const NBSP = String.fromCharCode(0xa0)
const values = {
  debtor_name: 'Thandi Mokoena', balance: `R${NBSP}1${NBSP}250,00`, case_number: 'RAP-100001',
  firm_name: 'Bredell Ferreira',
}
const sms = renderCampaignMessage({
  channel: 'sms', subject: null, values,
  body: 'Dear {{debtor_name}}, ID {{debtor_id_masked}}. You owe {{balance}} on {{case_number}}.',
})
ok('the SMS is merged', sms.text.includes('Thandi Mokoena') && sms.text.includes('RAP-100001'))
ok('...with no non-breaking space left in what the app merged', !sms.text.includes(NBSP))
check('...so it stays GSM-7, one segment', [sms.encoding, sms.segments], ['GSM-7', 1])
ok('...and the optional ID with its comma leaves, nothing reported missing', !sms.text.includes('{{') && sms.missing.length === 0)
const short = renderCampaignMessage({ channel: 'sms', subject: null, values, body: 'Hi {{debtor_name}}, {{listing_reference}}' })
check('a field the account cannot fill is reported, not blanked', short.missing, ['listing_reference'])
const email = renderCampaignMessage({
  channel: 'email', subject: 'Your account {{case_number}}', values: { ...values, debtor_name: 'Smit & Seun' },
  body: 'Dear {{debtor_name}}\n\nYou owe {{balance}}.\nPlease pay.',
})
check('the email subject is merged', email.subject, 'Your account RAP-100001')
ok('a blank line is a paragraph, a newline a line', email.html.includes('<br><br>') && /owe [^<]*\.<br>Please/.test(email.html))
ok('...and the debtor’s name is escaped', email.html.includes('Smit &amp; Seun'))
check('an email keeps the firm’s money format (nbsp is fine in mail)', email.text.includes(NBSP), true)

ok('typed text with an unknown field is refused',
  /not a field/.test(campaignWordingProblem({ channel: 'sms', subject: null, body: 'Hi {{debtr_name}}' }) ?? ''))
ok('an email needs a subject', /subject/.test(campaignWordingProblem({ channel: 'email', subject: ' ', body: 'Hi' }) ?? ''))
ok('a notice-posting email is a workflow step, not a campaign',
  /workflow/.test(campaignWordingProblem({ channel: 'email', subject: 'S', body: 'B', template: { kind: 'email', scope: 'collections', active: true, attachmentId: 'x' } }) ?? ''))
ok('sales wording never goes to a debtor',
  /sales/.test(campaignWordingProblem({ channel: 'sms', subject: null, body: 'B', template: { kind: 'sms', scope: 'sales', active: true, attachmentId: null } }) ?? ''))
ok('SMS wording is not an email', !!campaignWordingProblem({ channel: 'email', subject: 'S', body: 'B', template: { kind: 'sms', scope: 'collections', active: true, attachmentId: null } }))
check('good wording passes', campaignWordingProblem({ channel: 'sms', subject: null, body: 'Dear {{debtor_name}}' }), null)

/* ---------------------------------------------------------------- 3. the fee */

check('an email is item 1(a), an SMS 1(c)', [CAMPAIGN_ITEM.email, CAMPAIGN_ITEM.sms], ['1a', '1c'])
check('...on the catalogue codes the workflow writes', [CAMPAIGN_ACTION.email, CAMPAIGN_ACTION.sms], ['email_out', 'sms'])
const e2026 = campaignFeeEstimate('email', 40, null, '2026-10-21')
check('forty emails at R25 each', [e2026.perMessage, e2026.total], [25, 1000])
const s2026 = campaignFeeEstimate('sms', 10, 2, '2026-10-21')
check('ten two-segment SMSs at R3.50 a segment', [s2026.perMessage, s2026.total], [7, 70])
check('the monthly allowance is reported as the schedule has it (off since 10 Sept)', s2026.monthlyLimit, null)
ok('the confirmation reads the numbers back',
  /will send one SMS to 10 debtors\. 3 accounts are skipped.*item 1\(c\).*R70/.test(
    campaignConfirmation({ name: 'October reminder', channel: 'sms', sending: 10, skipped: 3, estimate: s2026, money: (n) => `R${n}` })))

const sendSrc = code('api/_lib/campaign/send.ts')
const routeSrc = code('api/_lib/campaign/route.ts')
const charged = sendSrc.indexOf('chargeItemWith(admin')
ok('the sender charges through the engine', charged > 0)
ok('...after the SMS provider took it', sendSrc.indexOf('await sendSms(') > 0 && sendSrc.indexOf('await sendSms(') < charged)
ok('...after the email went', sendSrc.indexOf('await sendAsUser(') > 0 && sendSrc.indexOf('await sendAsUser(') < charged)
ok('...per message, on the campaign item, quantity the segments',
  /itemId: CAMPAIGN_ITEM\[campaign\.channel\]/.test(sendSrc) && /quantity: campaign\.channel === 'sms' \? \(out\.segments \?\? 1\) : 1/.test(sendSrc))
ok('nothing is charged in the route, up front', !/chargeItemWith|account_fees'\)\.insert/.test(routeSrc))
ok('only one place raises a campaign fee', (sendSrc.match(/chargeItemWith\(/g) ?? []).length === 1)

/* ---------------------------------------------------------------- 4. who, on which desks */

const admin = { id: 'a', role: 'Administrator', teamId: null }
const leader = { id: 'l', role: 'Pre-legal Team Leader', teamId: 'T1' }
const manager = { id: 'm', role: 'Call Centre Manager', teamId: null }
const agent = { id: 'g', role: 'Pre-legal Agent', teamId: 'T1' }
const liaison = { id: 'li', role: 'Liaison', teamId: 'T2', grants: ['campaign.run'] }
const desk = (id, role, teamId) => ({ id, role, teamId })
ok('an Administrator on any desk', mayCampaignOn(admin, desk('x', 'Pre-legal Agent', 'T9')))
ok('...and on the unallocated pile', mayCampaignOn(admin, null))
ok('a team leader on their own team’s desk', mayCampaignOn(leader, desk('x', 'Pre-legal Agent', 'T1')))
ok('...and their own', mayCampaignOn(leader, desk('l', 'Pre-legal Team Leader', 'T1')))
ok('...not on another team’s', !mayCampaignOn(leader, desk('y', 'Pre-legal Agent', 'T2')))
ok('...not on the unallocated pile', !mayCampaignOn(leader, null))
ok('the call centre manager, in no team, on the floor', mayCampaignOn(manager, desk('x', 'Pre-legal Agent', 'T5')))
ok('...but not on a liaison’s desk', !mayCampaignOn(manager, desk('z', 'Liaison', 'T2')))
ok('an agent may run none', !mayCampaignOn(agent, desk('g', 'Pre-legal Agent', 'T1')))
ok('a grant gives the tick, and the team still bounds it', mayCampaignOn(liaison, desk('q', 'Liaison', 'T2')) && !mayCampaignOn(liaison, desk('r', 'Pre-legal Agent', 'T1')))
ok('a revoke takes it from an Administrator too', !mayCampaignOn({ ...admin, revokes: ['campaign.run'] }, null))
ok('a leader may stop their team’s campaign', mayManageCampaign(leader, { createdBy: 'other', teamId: 'T1' }))
ok('...not another team’s', !mayManageCampaign(leader, { createdBy: 'other', teamId: 'T2' }))

ok('the route asks the rule for EVERY account', /for \(const id of input\.accountIds\)[\s\S]{0,300}mayCampaignOn\(caller, holder\)/.test(routeSrc))
ok('...and refuses the whole selection when one is outside it', /if \(a\.outOfScope > 0\)[\s\S]{0,400}status: 403/.test(routeSrc))
ok('...needing the tick before anything', /!can\(caller, 'campaign\.run'\)/.test(routeSrc))
ok('the sender asks again before each message', /if \(!mayCampaignOn\(creator, holder\)\) return skip\('out_of_scope'\)/.test(sendSrc))
ok('...and the skip rule again', /const reason = campaignSkip\(facts, campaign\.channel, audience\)/.test(sendSrc))
ok('an email campaign refuses to start without the creator’s mailbox',
  /input\.channel === 'email' && !a\.mailbox/.test(routeSrc))
ok('...and sends from the creator’s mailbox, never a firm-wide sender', /sendAsUser\(admin, creator\.id,/.test(sendSrc) && !/resend/i.test(sendSrc))

/* ---------------------------------------------------------------- 5. the sender */

const hoursAt = sendSrc.indexOf('callHoursProblem(')
ok('calling hours are asked', hoursAt > 0)
ok('...before anything is claimed', hoursAt < sendSrc.indexOf("rpc('campaign_claim'"))
ok('the call panel and the campaign keep ONE set of hours', callPanelHours === withinCallHours)
ok('nine on a Tuesday is inside them', withinCallHours('2026-10-20', 9 * 60))
ok('...seven in the evening is not', !withinCallHours('2026-10-20', 19 * 60))
ok('...nor a Sunday', !withinCallHours('2026-10-25', 10 * 60))
ok('...nor Heritage Day', !withinCallHours('2026-09-24', 10 * 60))
check('Johannesburg’s minute, whatever the machine', johannesburgMinute(new Date(Date.UTC(2026, 9, 21, 7, 30))), 9 * 60 + 30)
ok('a message that went is filed on the account’s SMS list', /from\('sms_messages'\)\.insert\(\{\s*account_id: message\.account_id/.test(sendSrc))
ok('...or as the account’s own email, with its Message-ID', /from\('account_emails'\)\.insert\(\{[\s\S]{0,200}message_id: sent\.messageId/.test(sendSrc))
ok('the timeline names the campaign', /`Campaign “\$\{campaign\.name\}”: SMS to/.test(sendSrc))
ok('time running out gives back what was claimed, as pending',
  /update\(\{ state: 'pending', claimed_at: null \}\)[\s\S]{0,60}\.eq\('state', 'sending'\)/.test(sendSrc))

const syncAll = code('api/_lib/email/sync-all.ts')
ok('the five-minute cron carries campaigns on', /sendCampaignChunk\(admin/.test(syncAll))
ok('...only when it IS the cron', /if \(fromCron\) \{[\s\S]{0,200}sendCampaignChunk/.test(syncAll))
const dispatcher = code('api/workflow/[action].ts')
ok('the route lives on the workflow function, not a file of its own', /import campaign from '\.\.\/_lib\/campaign\/route\.js'/.test(dispatcher) && /\bcampaign,/.test(dispatcher))

const sql = read('supabase/schema.sql')
const lastFn = (name) => {
  const at = sql.lastIndexOf(`create or replace function public.${name}(`)
  return at < 0 ? '' : sqlCode(sql.slice(at, sql.indexOf('$$;', sql.indexOf('as $$', at)) + 3))
}
const claim = lastFn('campaign_claim')
ok('the claim exists', claim.length > 0)
ok('...takes rows nobody else holds', /for update skip locked/.test(claim))
ok('...and only of a campaign still sending', /c\.status = 'sending'/.test(claim))
ok('...a stale claim is FAILED, never put back to pending', /set state = 'failed'[\s\S]{0,200}state = 'sending' and claimed_at </.test(claim)
  && !/set state = 'pending'/.test(claim))
ok('...and only the server may call it', sql.includes('revoke all on function public.campaign_claim(uuid, integer) from public, anon, authenticated;')
  && sql.includes('grant execute on function public.campaign_claim(uuid, integer) to service_role;'))
const writes = sqlCode(sql).match(/create policy "[^"]+" on public\.campaign(s|_messages) for (insert|update|delete|all)/g) ?? []
check('no browser can write a campaign: read policies only', writes, [])
ok('row-level security is on both tables', /alter table public\.campaigns enable row level security/.test(sql)
  && /alter table public\.campaign_messages enable row level security/.test(sql))
ok('one message per account per campaign', /unique \(campaign_id, account_id\)/.test(sql))

/* ---------------------------------------------------------------- 6. the runner's assembly */

/*
 * THE ACCOUNT FIELDS HANDED TO accountMergeValues, BY NAME. A field added to step.ts's object and
 * not here is a campaign message held on a placeholder the workflow would have filled -- or worse,
 * the two quoting a figure from different columns.
 */
const accountKeys = (src) => {
  const at = src.indexOf('accountMergeValues({')
  const open = src.indexOf('account: {', at)
  const close = src.indexOf('\n    },', open)
  if (at < 0 || open < 0 || close < 0) return null
  return [...src.slice(open, close).matchAll(/^\s+([a-zA-Z]+):/gm)].map((m) => m[1]).sort()
}
const stepKeys = accountKeys(code('api/_lib/workflow/step.ts'))
const campaignKeys = accountKeys(code('api/_lib/campaign/gather.ts'))
ok('both assemblies can be read', Array.isArray(stepKeys) && Array.isArray(campaignKeys) && stepKeys.length > 10)
check('the campaign passes the account exactly as the runner does', campaignKeys, stepKeys)
const gather = code('api/_lib/campaign/gather.ts')
ok('...through the same ledger reader and the same balance',
  /fetchLedgerRows\(admin, \[accountId\]\)/.test(gather) && /computeBalance\(balanceInput\)/.test(gather) && /toFirmSettings\(firmRes\.data as never\)/.test(gather))

/* ---------------------------------------------------------------- the screen */

const list = code('src/pages/accounts/AccountsList.tsx')
ok('the Accounts list offers a campaign over the same selection as the hand-out',
  /setCampaigning\(allMatching\s*\?\s*\{ kind: 'matching', query \}\s*:\s*\{ kind: 'ids', ids: \[\.\.\.ticked\] \}\)/.test(list))
ok('...only to somebody with the tick', /mayCampaign && \(/.test(list) && /canRunCampaigns\(currentUser\)/.test(list))
ok('the browser resolves "all matching" through the hand-out’s resolver (applyAccountFilters)',
  /return resolveIds\(selection\)/.test(code('src/lib/campaignApi.ts')))

console.log(`\ncheck-campaigns: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
