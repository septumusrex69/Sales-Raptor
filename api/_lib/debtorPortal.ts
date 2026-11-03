import crypto from 'node:crypto'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { SupabaseClient } from '@supabase/supabase-js'
import { adminClient } from './auth.js'
import { credentialsKeyProblem, keyedHash, sameHex } from './crypto.js'
import { sendAsUser } from './email/sendAsUser.js'
import { sendSms } from './sms/connectMobile.js'
import { codeSenderOrder, deviceLabel, normaliseCode, resendDecision } from '../../src/lib/loginCode.js'
import { portalCodeCheck, PORTAL_CODE_MESSAGE } from '../../src/lib/clientPortal.js'
import { computeBalance } from '../../src/lib/accountBalance.js'
import { balanceInputFor } from '../../src/lib/balanceInput.js'
import { balanceAccountFromRow, fetchLedgerRows } from '../../src/lib/storedBalance.js'
import {
  DEBTOR_CODE_MINUTES, DEBTOR_CODE_SENT, DEBTOR_SESSION_DAYS, DEBTOR_TOKEN_HEADER, codeDestination, debtorCodeEmail,
  debtorCodeSms, debtorPayments, debtorSummary, normaliseCaseNumber, type ContactRow,
} from '../../src/lib/debtorPortal.js'

/**
 * /api/debtor/<action> -- THE DEBTOR PORTAL'S SERVER (Raptor H16). See src/lib/debtorPortal.ts.
 *
 * EVERY READ IS THE SERVICE ROLE, FILTERED BY THE SESSION'S ACCOUNT. The browser names nothing: not an account,
 * not a client. The account comes off the session row, so a debtor who edits a request can only ask about their
 * own debt. The tables behind it have RLS on and no policies, so this is the only door.
 *
 *   anonymous   request-code, verify       (the code, sent to a contact the firm holds, is the authority)
 *   debtor      account, sign-out          (x-debtor-token)
 */

type Handler = (req: VercelRequest, res: VercelResponse, admin: SupabaseClient) => Promise<void>

/** The firm's day and moment (the staging clock's on staging), as raptor_clock keeps them -- see workflow/clock.ts. */
async function firmNow(admin: SupabaseClient): Promise<{ today: string; now: number }> {
  const { data } = await admin.rpc('raptor_clock')
  const row = (Array.isArray(data) ? data[0] : data) as { business_today?: string; business_now?: string } | null
  if (row?.business_today && row?.business_now) return { today: row.business_today, now: Date.parse(row.business_now) }
  return { today: new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' }), now: Date.now() }
}

const realNow = () => Date.now()

/* ------------------------------------------------------------------ anonymous: the sign-in */

const requestCode: Handler = async (req, res, admin) => {
  const caseNumber = normaliseCaseNumber((req.body ?? {}).caseNumber)
  if (!caseNumber) { res.status(400).json({ error: 'Type the case number on our letter or SMS, for example RAP-123456.' }); return }
  const { data: acct } = await admin.from('debtor_accounts')
    .select('id, case_number, debtor_first_name, assigned_to').eq('case_number', caseNumber).maybeSingle()
  const { data: contacts } = acct
    ? await admin.from('account_contacts').select('kind, value, is_primary, retired_at').eq('account_id', acct.id)
    : { data: [] }
  const dest = codeDestination((contacts ?? []) as ContactRow[])
  /* THE SAME ANSWER WHATEVER HAPPENED -- see DEBTOR_CODE_SENT. The log says which, for the firm. */
  if (!acct || !dest) {
    console.log(`[debtor] code asked for ${caseNumber}: ${acct ? 'no email or mobile on the account' : 'no such case'}`)
    res.status(200).json({ message: DEBTOR_CODE_SENT }); return
  }

  const t = realNow()
  const { data: last } = await admin.from('debtor_portal_codes')
    .select('sent_at, window_started_at, sends_in_window').eq('account_id', acct.id).maybeSingle()
  const decision = resendDecision(last ? {
    sentAt: last.sent_at as string, windowStartedAt: last.window_started_at as string, sendsInWindow: Number(last.sends_in_window ?? 0),
  } : null, t)
  if (!decision.ok) { res.status(429).json({ error: decision.reason, waitSeconds: decision.waitSeconds }); return }

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
  const { error: saveErr } = await admin.from('debtor_portal_codes').upsert({
    account_id: acct.id, code_hash: keyedHash('debtor-code', `${acct.id}:${code}`),
    expires_at: new Date(t + DEBTOR_CODE_MINUTES * 60_000).toISOString(), attempts: 0, sent_to: dest.channel,
    sent_at: new Date(t).toISOString(), window_started_at: decision.windowStartedAt, sends_in_window: decision.sendsInWindow,
  }, { onConflict: 'account_id' })
  if (saveErr) { console.error(`[debtor] code not saved for ${acct.id}: ${saveErr.message}`); res.status(500).json({ error: 'The code could not be made just now. Try again in a minute.' }); return }

  let sent = false
  let why = ''
  if (dest.channel === 'email') {
    /* WHO SENDS IT: the collector on the account first -- the name the debtor already hears from -- then an
       Administrator's mailbox. Raptor has no system mailbox (loginCode.ts says why). */
    const [{ data: staff }, { data: boxes }] = await Promise.all([
      admin.from('profiles').select('id, name, status, role').or(`role.eq.Administrator${acct.assigned_to ? `,id.eq.${acct.assigned_to}` : ''}`),
      admin.from('email_connections').select('user_id'),
    ])
    const withMailbox = new Set((boxes ?? []).map((b) => b.user_id as string))
    const order = codeSenderOrder((acct.assigned_to as string | null) ?? '', (staff ?? []).map((p) => ({
      id: p.id as string, name: String(p.name ?? ''), hasMailbox: withMailbox.has(p.id as string), active: p.status === 'Active',
    })))
    const host = req.headers['x-forwarded-host'] ?? req.headers.host
    const mail = debtorCodeEmail({ name: String(acct.debtor_first_name ?? ''), code, caseNumber, url: host ? `https://${String(host)}/my-account` : undefined })
    why = 'Nobody at the firm has a mailbox connected to send it from.'
    for (const senderId of order) {
      const r = await sendAsUser(admin, senderId, { to: dest.to, subject: mail.subject, bodyHtml: mail.html })
      if (r.ok) { sent = true; break }
      why = r.error
    }
  } else {
    try { await sendSms({ to: dest.to, text: debtorCodeSms(code), reference: `debtor-code-${acct.id}-${t}` }); sent = true }
    catch (e) { why = e instanceof Error ? e.message : String(e) }
  }
  if (!sent) {
    await admin.from('debtor_portal_codes').update({ expires_at: new Date(t).toISOString() }).eq('account_id', acct.id)
    console.error(`[debtor] code for ${acct.id} not sent by ${dest.channel}: ${why}`)
    res.status(502).json({ error: 'The code could not be sent just now. Try again shortly, or call us.' }); return
  }
  res.status(200).json({ message: DEBTOR_CODE_SENT })
}

const verify: Handler = async (req, res, admin) => {
  const body = req.body ?? {}
  const caseNumber = normaliseCaseNumber(body.caseNumber)
  const code = normaliseCode(body.code)
  if (!caseNumber || !code) { res.status(400).json({ error: 'Type the six digits we sent you.' }); return }
  const { data: acct } = await admin.from('debtor_accounts').select('id').eq('case_number', caseNumber).maybeSingle()
  const { data: stored } = acct
    ? await admin.from('debtor_portal_codes').select('code_hash, expires_at, attempts').eq('account_id', acct.id).maybeSingle()
    : { data: null }
  const t = realNow()
  const check = portalCodeCheck(stored ? { expiresAt: stored.expires_at as string, attempts: Number(stored.attempts) } : null, t)
  if (check !== 'compare') { res.status(400).json({ error: PORTAL_CODE_MESSAGE[check] }); return }
  if (!sameHex(stored!.code_hash as string, keyedHash('debtor-code', `${acct!.id}:${code}`))) {
    await admin.from('debtor_portal_codes').update({ attempts: Number(stored!.attempts) + 1 }).eq('account_id', acct!.id)
    res.status(400).json({ error: PORTAL_CODE_MESSAGE.none }); return
  }
  /* Spent the moment it matches, so the same six digits cannot open a second browser. */
  await admin.from('debtor_portal_codes').delete().eq('account_id', acct!.id)

  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(t + DEBTOR_SESSION_DAYS * 86_400_000).toISOString()
  const { error } = await admin.from('debtor_portal_sessions').insert({
    account_id: acct!.id, token_hash: keyedHash('debtor-session', token), expires_at: expiresAt,
    device: deviceLabel(req.headers['user-agent'] as string | undefined),
  })
  if (error) { res.status(500).json({ error: 'You could not be signed in just now. Try again.' }); return }
  /* THE COLLECTOR SEES IT: a debtor who looked at their account this morning is a debtor worth calling today. */
  await admin.from('account_notes').insert({
    account_id: acct!.id, body: 'The debtor signed in to their account online (debtor portal).', source: 'system', author_name: 'Debtor portal',
  })
  res.status(200).json({ token, expiresAt })
}

/* ------------------------------------------------------------------ a signed-in debtor */

async function requireDebtor(req: VercelRequest, admin: SupabaseClient): Promise<{ accountId: string; sessionId: string } | null> {
  const token = req.headers[DEBTOR_TOKEN_HEADER]
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return null
  const { data: s } = await admin.from('debtor_portal_sessions')
    .select('id, account_id, expires_at').eq('token_hash', keyedHash('debtor-session', token)).maybeSingle()
  if (!s || Date.parse(s.expires_at as string) <= realNow()) return null
  await admin.from('debtor_portal_sessions').update({ last_seen_at: new Date().toISOString() }).eq('id', s.id)
  return { accountId: s.account_id as string, sessionId: s.id as string }
}

const account: Handler = async (req, res, admin) => {
  const who = await requireDebtor(req, admin)
  if (!who) { res.status(401).json({ error: 'Please sign in again.' }); return }
  const { today } = await firmNow(admin)
  const [{ data: a }, { data: firm }, { data: pays }] = await Promise.all([
    admin.from('debtor_accounts')
      /* Written out rather than built from ACCOUNT_SELECT so check-select-columns can read it; check-debtor-portal
         holds it to every column ACCOUNT_SELECT names, which is what computeBalance needs. */
      .select('id,capital_handed_over,handover_date,interest_rate_annual,status,last_action_at,ended_as,ended_on,prescribed,prescription_date,case_number,debtor_first_name,debtor_second_name,debtor_surname,account_number,client_reference,companies(name)')
      .eq('id', who.accountId).maybeSingle(),
    admin.from('firm_settings').select('firm_name, trust_bank, trust_branch_code, trust_account_number, trust_account_name, trust_account_type, phone, email').limit(1).maybeSingle(),
    admin.from('account_payments').select('received_at, amount, approved_at, reversed_at, rejected_at').eq('account_id', who.accountId),
  ])
  if (!a) { res.status(404).json({ error: 'Your account could not be found. Please call us.' }); return }
  let summary
  try {
    const ledgers = await fetchLedgerRows(admin, [who.accountId])
    /* THE SAME computeBalance, OVER THE SAME LEDGERS, AS THE ACCOUNT PAGE -- in duplum and all. A second sum here
       would one day tell a debtor a different number from the one the collector quotes on the phone. */
    summary = debtorSummary(computeBalance(balanceInputFor({ account: balanceAccountFromRow(a), ledgers: ledgers.get(who.accountId)!, today })))
  } catch (e) {
    console.error(`[debtor] balance for ${who.accountId} failed: ${e instanceof Error ? e.message : e}`)
    res.status(500).json({ error: 'Your balance could not be worked out just now. Please try again later.' }); return
  }
  const name = [a.debtor_first_name, a.debtor_second_name, a.debtor_surname].filter((x) => x && String(x).trim()).join(' ')
  const client = (a.companies as unknown as { name: string } | null)?.name ?? ''
  res.status(200).json({
    asAt: today,
    name, caseNumber: a.case_number, client, clientReference: a.client_reference ?? a.account_number ?? null,
    closed: a.ended_as ?? null,
    summary,
    payments: debtorPayments((pays ?? []) as Parameters<typeof debtorPayments>[0]),
    /* HOW TO PAY: the TRUST account, never the business one (CLAUDE.md, "Three directions of money"), with the
       case number as the reference -- the one thing that puts the payment on the right account without a person. */
    pay: firm ? {
      accountName: firm.trust_account_name ?? firm.firm_name ?? 'Bredell Ferreira Trust Account',
      bank: firm.trust_bank ?? null, branchCode: firm.trust_branch_code ?? null,
      accountNumber: firm.trust_account_number ?? null, accountType: firm.trust_account_type ?? null,
      reference: a.case_number,
    } : null,
    contact: firm ? { phone: firm.phone ?? null, email: firm.email ?? null } : null,
  })
}

const signOut: Handler = async (req, res, admin) => {
  const who = await requireDebtor(req, admin)
  if (who) await admin.from('debtor_portal_sessions').delete().eq('id', who.sessionId)
  res.status(200).json({ ok: true })
}

export const DEBTOR_ROUTES: Record<string, Handler> = {
  'request-code': requestCode,
  verify,
  account,
  'sign-out': signOut,
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = typeof req.query.action === 'string' ? req.query.action : ''
  /* hasOwnProperty, as in api/portal: `?action=constructor` must not find Object.prototype's. */
  const route = Object.prototype.hasOwnProperty.call(DEBTOR_ROUTES, action) ? DEBTOR_ROUTES[action] : undefined
  if (!route) { res.status(404).json({ error: `Unknown route: ${action || '(none)'}` }); return }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }
  const admin = adminClient()
  if (!admin) { res.status(500).json({ error: 'Server is missing Supabase configuration.' }); return }
  const keyProblem = credentialsKeyProblem()
  if (keyProblem) { res.status(500).json({ error: keyProblem }); return }
  await route(req, res, admin)
}
