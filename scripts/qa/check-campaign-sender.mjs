/**
 * WHO A DEBTOR CAMPAIGN COMES FROM, CAMPAIGNS ON WRITTEN-OFF ACCOUNTS, AND THE CLIENT'S "NOT OUR
 * WRITTEN-OFF ACCOUNTS" (Raptor H12).
 *
 * THE FIRM (26 Oct): a campaign should "ask if it goes out from ... a centralized email, or ... the
 * person who sends it, or ... the person who owns the account" -- the central one legal@; written
 * off and withdrawn are "two different things"; a client may ask us not to work its written-off
 * accounts ("yes, client switch"); and "yes, charge fees" -- held back by S12 as a money decision, then
 * chosen (B, Raptor H13): a written-off account is charged like any other; a prescribed one is not.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-campaign-sender.mjs
 */
import { readFileSync } from 'node:fs'
import {
  SEND_FROM_LABEL, campaignConfirmation, recoverySkip, senderFor, traceSkip, writtenOffMessageSkip, writeOffReasonKey,
} from '../../src/lib/campaigns.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass += 1
  else failures.push(`${name}\n      expected ${JSON.stringify(expected)}\n      got      ${JSON.stringify(actual)}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*(\/\/|--).*$/gm, '')

/* ---------- who it comes from ---------- */
const base = { callerId: 'me', callerHasMailbox: true, centralId: 'legal', holder: { id: 'nic', active: true, hasMailbox: true } }
check('"Me" is the person running it', senderFor({ ...base, sendFrom: 'me' }), 'me')
check('...and nobody when their mailbox is not connected', senderFor({ ...base, sendFrom: 'me', callerHasMailbox: false }), null)
check('"Central" is the central mailbox', senderFor({ ...base, sendFrom: 'central' }), 'legal')
check('...and nobody when none is set up', senderFor({ ...base, sendFrom: 'central', centralId: null }), null)
check('"Collector" is the account\'s collector', senderFor({ ...base, sendFrom: 'owner' }), 'nic')
check('...an empty desk goes from the central mailbox', senderFor({ ...base, sendFrom: 'owner', holder: null }), 'legal')
check('...so does a collector who has left, or has no mailbox', [
  senderFor({ ...base, sendFrom: 'owner', holder: { id: 'nic', active: false, hasMailbox: true } }),
  senderFor({ ...base, sendFrom: 'owner', holder: { id: 'nic', active: true, hasMailbox: false } }),
], ['legal', 'legal'])
check('...and with no central mailbox, the person running it', senderFor({ ...base, sendFrom: 'owner', holder: null, centralId: null }), 'me')
check('the three choices, in the firm\'s words', Object.keys(SEND_FROM_LABEL), ['me', 'owner', 'central'])

/* ---------- the written-off book ---------- */
const reason = writeOffReasonKey({ endedAs: 'written_off', endedReason: 'Uncontactable', writeOffReason: null })
const wo = { book: 'closed', endedAs: 'written_off', endedReason: 'Uncontactable', writeOffReason: null, status: 'Closed', holdReason: null,
  prescribed: false, debtorKind: 'individual', mobile: '0821234567', email: 'd@x.co.za', openDispute: false, workflowToday: false, onCallCampaign: false }
check('a written-off account with a chosen reason is sent', writtenOffMessageSkip(wo, 'email', [reason]), null)
check('...withdrawn never is', writtenOffMessageSkip({ ...wo, endedAs: 'withdrawn' }, 'email', [reason]), 'withdrawn')
check('...paid up or settled never is', [writtenOffMessageSkip({ ...wo, endedAs: 'paid_up' }, 'sms', [reason]), writtenOffMessageSkip({ ...wo, endedAs: 'settled' }, 'sms', [reason])], ['paid', 'paid'])
check('...nor a live account', writtenOffMessageSkip({ ...wo, book: 'active', endedAs: null, status: 'Active' }, 'sms', [reason]), 'not_closed')
check('...nor a prescribed one, a reason not chosen, or an open dispute', [
  writtenOffMessageSkip({ ...wo, prescribed: true }, 'email', [reason]),
  writtenOffMessageSkip(wo, 'email', ['none']),
  writtenOffMessageSkip({ ...wo, openDispute: true }, 'email', [reason]),
], ['prescribed', 'reason_not_chosen', 'dispute'])
check('...it needs an address for an email and a number an SMS reaches', [
  writtenOffMessageSkip({ ...wo, email: null }, 'email', [reason]),
  writtenOffMessageSkip({ ...wo, mobile: null }, 'sms', [reason]),
  writtenOffMessageSkip({ ...wo, mobile: '12' }, 'sms', [reason]),
], ['no_email', 'no_mobile', 'bad_number'])
check('...an email needs no number', writtenOffMessageSkip({ ...wo, mobile: null }, 'email', [reason]), null)

/* ---------- the client switch ---------- */
check('a client that said no is left out of a message to written-off accounts', writtenOffMessageSkip({ ...wo, clientNoWriteoff: true }, 'email', [reason]), 'client_no_writeoff')
check('...out of a recovery call', recoverySkip({ ...wo, clientNoWriteoff: true }, [reason]), 'client_no_writeoff')
check('...and out of a trace on the closed book', traceSkip({ ...wo, clientNoWriteoff: true }, 'closed', [reason]), 'client_no_writeoff')
check('...but not out of a trace on the live book: it is about written-off accounts only',
  traceSkip({ ...wo, book: 'active', endedAs: null, status: 'Active', clientNoWriteoff: true }, 'live', [reason]), null)
check('...and withdrawn stays withdrawn whatever the switch says', recoverySkip({ ...wo, endedAs: 'withdrawn', clientNoWriteoff: true }, [reason]), 'withdrawn')

/* ---------- fees: a written-off campaign is charged (the firm chose B, Raptor H13, 27 Oct) ---------- */
ok('a campaign on written-off accounts states its fee like any other',
  /charged to the debtor’s account under Annexure B item 1\(a\) as it goes: about R75 excluding VAT/.test(campaignConfirmation({
    name: 'x', channel: 'email', sending: 3, skipped: 0, estimate: { item: '1a', perMessage: 25, total: 75 }, money: (n) => `R${n}`,
  })))
ok('...because the charge engine no longer refuses a written-off account -- only a prescribed one',
  !/isWrittenOff/.test(code('src/lib/chargeEngine.ts')) && /const closed = hasPrescribed\(/.test(code('src/lib/chargeEngine.ts'))
  && /const recoverable = !closed && room > 0/.test(code('src/lib/chargeEngine.ts')))
ok('...and the server previews and records the real estimate, written off or not',
  !/writtenOffUncharged/.test(code('api/_lib/campaign/route.ts')) && /fee_estimate: a\.estimate\.total/.test(code('api/_lib/campaign/route.ts'))
  && !/writtenOffUncharged|No fee today/.test(code('src/pages/accounts/CampaignModal.tsx')))

/* ---------- the database ---------- */
const schema = read('supabase/schema.sql')
const block = schema.slice(schema.lastIndexOf('Migration `campaign_sender_and_written_off`'))
ok('how a closed account ended is a stored column, from the same reading as recovery',
  /add column if not exists closure text generated always as \(\s*case when ended_as is not null or coalesce\(status, ''\) ~\* '\^\(written\.off\|closed\)'\s*then public\.recovery_closure\(ended_as, status, write_off_reason\) end\) stored/.test(block))
ok('the client switch says when, why and who', ['no_writeoff_work_at', 'no_writeoff_work_reason', 'no_writeoff_work_by'].every((c) => block.includes(`add column if not exists ${c}`)))
ok('a campaign stores who it comes from, its book and its reasons', /send_from in \('me', 'owner', 'central'\)/.test(block) && /target in \('live', 'written_off'\)/.test(block))
ok('only an Administrator chooses the central mailbox', /create policy firm_mailboxes_write on public\.firm_mailboxes for all to authenticated\s+using \(public\.current_user_role\(\) = 'Administrator'\)/.test(block))

/* ---------- the screens ---------- */
const modal = code('src/pages/accounts/CampaignModal.tsx')
ok('the campaign box asks which accounts and who it comes from', /data-testid="campaign-target"/.test(read('src/pages/accounts/CampaignModal.tsx'))
  && /data-testid="campaign-send-from"/.test(read('src/pages/accounts/CampaignModal.tsx')) && /useState<SendFrom>\('me'\)/.test(modal))
ok('...offers "who it comes from" for an email only', /\{channel === 'email' && \(\s*<FormField label="Send it from">/.test(modal))
ok('...and both closed-book boxes offer the reasons from one list', /useWriteOffReasons\(ids, target === 'written_off', setError\)/.test(modal)
  && /useWriteOffReasons\(ids, closedBook, setError\)/.test(code('src/pages/accounts/CallCampaignModal.tsx')))
ok('the client page offers the switch', /<ClientWrittenOffWork company=\{company\} \/>/.test(code('src/pages/companies/CompanyDetail.tsx')))
ok('the central mailbox is chosen in Settings', /<CentralMailboxCard \/>/.test(code('src/pages/settings/SettingsPage.tsx')))
ok('Closed is filtered by how it ended, through the one clause builder', /if \(q\.ending\) out = out\.eq\('closure', q\.ending\)/.test(code('src/lib/accountBook.ts'))
  && /q\.book === 'closed' && \(ending === 'paid_up'/.test(code('src/lib/accountFilters.ts')) && /data-testid="closed-endings"/.test(read('src/pages/accounts/AccountsList.tsx')))

if (failures.length) {
  console.log(`check-campaign-sender: ${pass} passed, ${failures.length} failed`)
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`check-campaign-sender: ${pass} passed, 0 failed`)
