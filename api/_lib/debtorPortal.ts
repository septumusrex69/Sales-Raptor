import crypto from 'node:crypto'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { SupabaseClient } from '@supabase/supabase-js'
import { adminClient, requireCaller } from './auth.js'
import { credentialsKeyProblem, hashPassword, keyedHash, passwordMatches, sameHex } from './crypto.js'
import { sendAsUser } from './email/sendAsUser.js'
import { sendSms } from './sms/connectMobile.js'
import { codeSenderOrder, deviceLabel, normaliseCode, resendDecision } from '../../src/lib/loginCode.js'
import { UNASSIGNED_MAILBOX, withLegal } from '../../src/lib/unassignedMailbox.js'
import { portalCodeCheck, portalPasswordProblem, PORTAL_CODE_MESSAGE, PORTAL_PASSWORD_FAILURES, PORTAL_PASSWORD_LOCK_MINUTES } from '../../src/lib/clientPortal.js'
import { computeBalance, type BalanceBreakdown } from '../../src/lib/accountBalance.js'
import { needsApplication, proposalProblem, proposalSummary } from '../../src/lib/debtorArrangement.js'
import { debtorLetterValues, debtorStatement, unfilledFields, type DebtorLetterInput, type DebtorStatementAccount } from '../../src/lib/debtorStatement.js'
import { fillLetter, parseLetter } from '../../src/lib/letterDocument.js'
import { blanksFor, FILLABLE } from '../../src/lib/signingBlanks.js'
import { newToken } from '../../src/lib/signingRules.js'
import { letterToPdf } from '../../src/lib/letterPdf.js'
import { toSettings as toFirmSettings } from '../../src/lib/firmSettingsRow.js'
import { letterheadFor } from './workflow/letterhead.js'
import { brandFor, charterFor } from './workflow/fonts.js'
import { isBrand } from '../../src/lib/brandFonts.js'
import { moneyZa } from './workflow/locale.js'
import { balanceInputFor } from '../../src/lib/balanceInput.js'
import { balanceAccountFromRow, fetchLedgerRows } from '../../src/lib/storedBalance.js'
import {
  DEBTOR_CODE_MINUTES, DEBTOR_CODE_SENT, DEBTOR_SESSION_DAYS, DEBTOR_TOKEN_HEADER, codeDestination, debtorCodeEmail,
  debtorCodeSms, debtorPayments, debtorSummary, debtorLogin, DEBTOR_LOGIN_HINT, type ContactRow, type DebtorLogin,
  DEBTOR_POP_MAX_BYTES, debtorPopClaim, debtorPopFile, debtorPopNote, debtorDispute, debtorQuestion, type DebtorTicket,
  DEBTOR_PASSWORD_WRONG, DEBTOR_REMEMBER_DAYS, debtorInviteEmail, debtorPortalLink,
} from '../../src/lib/debtorPortal.js'
import { sweep } from './workflow/run.js'
import { chargeItemWith } from '../../src/lib/chargeEngine.js'
import { CORRESPONDENCE_ACTION_CODE, CORRESPONDENCE_DESCRIPTION, CORRESPONDENCE_ITEM_ID } from '../../src/lib/emailRules.js'

/**
 * /api/debtor/<action> -- THE DEBTOR PORTAL'S SERVER (Raptor H16). See src/lib/debtorPortal.ts.
 *
 * EVERY READ IS THE SERVICE ROLE, FILTERED BY THE SESSION'S ACCOUNT. The browser names nothing: not an account,
 * not a client. The account comes off the session row, so a debtor who edits a request can only ask about their
 * own debt. The tables behind it have RLS on and no policies, so this is the only door.
 *
 *   anonymous   request-code, verify, sign-in   (the code, sent to a contact the firm holds, is the authority -- ONCE;
 *                                               after it, the password the debtor chose)
 *   staff       invite                     (a Raptor session: email the debtor the link to their account)
 *   debtor      account, statement, proof-of-payment, propose, dispute, ask, set-password, sign-out   (x-debtor-token)
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

/**
 * THE ACCOUNT(S) A CASE NUMBER, ID NUMBER OR EMAIL ADDRESS NAMES (Raptor H16, 4 Nov; Stephan: "sign in ... with your
 * ID number, and then a password also, your email address, or your case number"). A case number names one account;
 * an identity number or an email may name several -- the same person owing two of the firm's clients -- and then the
 * PASSWORD decides which (signIn), and a code is sent only where there is exactly one (requestCode). An email counts
 * only as a CURRENT contact on the account: a retired one is an address the firm knows is wrong.
 */
type LoginAccount = { id: string; case_number: string; debtor_first_name: string | null; assigned_to: string | null; ended_as: string | null }
async function accountsFor(admin: SupabaseClient, login: DebtorLogin): Promise<LoginAccount[]> {
  const cols = 'id, case_number, debtor_first_name, assigned_to, ended_as'
  if (login.kind === 'case') {
    const { data } = await admin.from('debtor_accounts').select(cols).eq('case_number', login.value).limit(1)
    return (data ?? []) as LoginAccount[]
  }
  if (login.kind === 'id') {
    const { data } = await admin.from('debtor_accounts').select(cols).eq('debtor_id_number', login.value).limit(10)
    return (data ?? []) as LoginAccount[]
  }
  const { data: hits } = await admin.from('account_contacts').select('account_id')
    .eq('kind', 'email').is('retired_at', null).ilike('value', login.value.replace(/[%_\\]/g, (c) => `\\${c}`)).limit(10)
  const ids = [...new Set((hits ?? []).map((h) => h.account_id as string))]
  if (!ids.length) return []
  const { data } = await admin.from('debtor_accounts').select(cols).in('id', ids)
  return (data ?? []) as LoginAccount[]
}

const requestCode: Handler = async (req, res, admin) => {
  const login = debtorLogin((req.body ?? {}).login ?? (req.body ?? {}).caseNumber)
  if (!login) { res.status(400).json({ error: DEBTOR_LOGIN_HINT }); return }
  const found = await accountsFor(admin, login)
  /* ONE ACCOUNT OR NONE: a code opens one account, and with several the code would have to choose -- so it does not,
     and the answer (the same answer) tells them to use the case number. */
  const acct = found.length === 1 ? found[0] : null
  const caseNumber = acct?.case_number ?? `${login.kind}:${login.kind === 'case' ? login.value : '(hidden)'}`
  if (found.length > 1) console.log(`[debtor] code asked by ${login.kind}: ${found.length} accounts match, none chosen`)
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
    /* WHO SENDS IT: the collector on the account first -- the name the debtor already hears from -- then the firm's
       legal@ mailbox where it is connected (UNASSIGNED_MAILBOX; Stephan, 4 Nov: "why did the email go out from
       Camille"), and an Administrator's only after both. Raptor has no system mailbox (loginCode.ts says why). */
    const [{ data: staff }, { data: boxes }] = await Promise.all([
      admin.from('profiles').select('id, name, status, role').or(`role.eq.Administrator${acct.assigned_to ? `,id.eq.${acct.assigned_to}` : ''}`),
      admin.from('email_connections').select('user_id, email'),
    ])
    const withMailbox = new Set((boxes ?? []).map((b) => b.user_id as string))
    const ordered = codeSenderOrder((acct.assigned_to as string | null) ?? '', (staff ?? []).map((p) => ({
      id: p.id as string, name: String(p.name ?? ''), hasMailbox: withMailbox.has(p.id as string), active: p.status === 'Active',
    })))
    const legal = (boxes ?? []).find((b) => String(b.email ?? '').toLowerCase() === UNASSIGNED_MAILBOX)?.user_id as string | undefined
    const order = withLegal(ordered, (acct.assigned_to as string | null) ?? null, legal ?? null)
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
  const who = debtorLogin(body.login ?? body.caseNumber)
  const code = normaliseCode(body.code)
  if (!who || !code) { res.status(400).json({ error: 'Type the six digits we sent you.' }); return }
  /* The same rule as the send: a code was only sent where exactly one account matched. */
  const found = await accountsFor(admin, who)
  const acct = found.length === 1 ? found[0] : null
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

  /*
   * A CODE IS THE FIRST VISIT OR THE RESET (Stephan, 3 Nov: "do one ... confirm your email address ... But not every
   * single time"). It confirms the debtor holds the account's contact, clears any lock, and the page asks for a
   * password next -- always where there is none yet, and when they came here because they forgot it.
   */
  const { data: login } = await admin.from('debtor_portal_logins').select('password_hash').eq('account_id', acct!.id).maybeSingle()
  await admin.from('debtor_portal_logins').upsert({
    account_id: acct!.id, confirmed_at: new Date(t).toISOString(), password_failures: 0, password_locked_until: null,
  }, { onConflict: 'account_id' })
  const session = await openDebtorSession(admin, req, acct!.id, t, body.remember === true, 'code')
  if (!session) { res.status(500).json({ error: 'You could not be signed in just now. Try again.' }); return }
  res.status(200).json({ ...session, needsPassword: !login?.password_hash || body.reset === true })
}

/**
 * A NEW SIGNED-IN BROWSER: the token goes to it once, only its keyed hash is kept. "Keep me signed in on this device"
 * is a month; without it, a day -- and the page keeps it for the tab only, because a debtor is as likely to be on a
 * borrowed phone as their own. The collector sees the sign-in on the timeline (a debtor looking today is worth a call).
 */
async function openDebtorSession(admin: SupabaseClient, req: VercelRequest, accountId: string, t: number, remember: boolean, how: 'code' | 'password'): Promise<{ token: string; expiresAt: string } | null> {
  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(t + (remember ? DEBTOR_REMEMBER_DAYS : 1) * 86_400_000).toISOString()
  const { error } = await admin.from('debtor_portal_sessions').insert({
    account_id: accountId, token_hash: keyedHash('debtor-session', token), expires_at: expiresAt,
    device: deviceLabel(req.headers['user-agent'] as string | undefined),
  })
  if (error) return null
  await admin.from('debtor_portal_logins').update({ last_login_at: new Date(t).toISOString() }).eq('account_id', accountId)
  await admin.from('account_notes').insert({
    account_id: accountId, source: 'system', author_name: 'Debtor portal',
    body: how === 'code' ? 'The debtor confirmed their email (or cellphone) and signed in to their account online (debtor portal).' : 'The debtor signed in to their account online (debtor portal).',
  })
  return { token, expiresAt }
}

/**
 * THE EVERYDAY SIGN-IN: case number and password. One answer for a case that is not ours, a login with no password yet
 * and a wrong password (DEBTOR_PASSWORD_WRONG). Five wrong in a row lock it for a quarter of an hour, the client
 * portal's numbers; the code still opens it, so a locked-out debtor is never stuck.
 */
const signIn: Handler = async (req, res, admin) => {
  const body = req.body ?? {}
  const who = debtorLogin(body.login ?? body.caseNumber)
  const password = typeof body.password === 'string' ? body.password : ''
  if (!who || !password) { res.status(400).json({ error: `${DEBTOR_LOGIN_HINT} Then your password.` }); return }
  const found = await accountsFor(admin, who)
  const { data: rows } = found.length
    ? await admin.from('debtor_portal_logins').select('account_id, password_hash, password_failures, password_locked_until, last_login_at').in('account_id', found.map((a) => a.id))
    : { data: [] }
  const logins = ((rows ?? []) as { account_id: string; password_hash: string | null; password_failures: number | null; password_locked_until: string | null; last_login_at: string | null }[])
    .filter((l) => l.password_hash)
  const t = realNow()
  const open = logins.filter((l) => !(l.password_locked_until && Date.parse(l.password_locked_until) > t))
  if (logins.length > 0 && open.length === 0) {
    res.status(429).json({ error: `Too many wrong passwords. Try again in ${PORTAL_PASSWORD_LOCK_MINUTES} minutes, or send yourself a code.` }); return
  }
  /*
   * WHICHEVER ACCOUNT THE PASSWORD OPENS. One identity number or email may name several accounts, each with its own
   * password; the one whose password this is, is the one meant. Where two share a password, the one still open, then
   * the one used last. A wrong password counts against every account it was tried on, so the lock still means five.
   */
  const matched = open.filter((l) => passwordMatches(password, l.password_hash as string))
  if (matched.length === 0) {
    for (const l of open) {
      const failures = Number(l.password_failures ?? 0) + 1
      await admin.from('debtor_portal_logins').update({
        password_failures: failures >= PORTAL_PASSWORD_FAILURES ? 0 : failures,
        password_locked_until: failures >= PORTAL_PASSWORD_FAILURES ? new Date(t + PORTAL_PASSWORD_LOCK_MINUTES * 60_000).toISOString() : null,
      }).eq('account_id', l.account_id)
    }
    console.log(`[debtor] sign-in by ${who.kind} refused: ${found.length} account(s), ${logins.length} with a password`)
    res.status(400).json({ error: DEBTOR_PASSWORD_WRONG }); return
  }
  const ended = new Map(found.map((a) => [a.id, !!a.ended_as]))
  matched.sort((x, y) => Number(ended.get(x.account_id)) - Number(ended.get(y.account_id)) || String(y.last_login_at ?? '').localeCompare(String(x.last_login_at ?? '')))
  const acct = { id: matched[0].account_id }
  await admin.from('debtor_portal_logins').update({ password_failures: 0, password_locked_until: null }).eq('account_id', acct.id)
  const session = await openDebtorSession(admin, req, acct.id as string, t, body.remember === true, 'password')
  if (!session) { res.status(500).json({ error: 'You could not be signed in just now. Try again.' }); return }
  res.status(200).json(session)
}

/** SETTING THE PASSWORD, from a browser the code just signed in. Hashed here (scrypt), never stored as typed. */
const setPassword: Handler = async (req, res, admin) => {
  const who = await requireDebtor(req, admin)
  if (!who) { res.status(401).json({ error: 'Please sign in again.' }); return }
  const password = (req.body ?? {}).password
  const problem = portalPasswordProblem(password, null)
  if (problem) { res.status(400).json({ error: problem }); return }
  const { error } = await admin.from('debtor_portal_logins').upsert({
    account_id: who.accountId, password_hash: hashPassword(password as string), password_set_at: new Date().toISOString(),
    password_failures: 0, password_locked_until: null,
  }, { onConflict: 'account_id' })
  if (error) { res.status(500).json({ error: 'Your password could not be saved just now. Try again.' }); return }
  res.status(200).json({ ok: true })
}

/* ------------------------------------------------------------------ staff: invite the debtor */

/**
 * EMAIL THE DEBTOR THE LINK TO THEIR ACCOUNT (Stephan, 3 Nov: "I don't know how to invite someone to that"). From the
 * account page, by anybody signed in to Raptor, from THEIR OWN mailbox -- the name the debtor hears from. To the
 * account's own email (codeDestination's choice), never one typed here. The link carries the case number; it is
 * directions, not a key. Noted on the timeline. NOT CHARGED: it is an invitation to see the account, not a
 * communication about the debt (the same reasoning as the sign-in code) -- the firm's to change.
 */
const invite: Handler = async (req, res, admin) => {
  const caller = await requireCaller(req, admin)
  if (!caller) { res.status(401).json({ error: 'Sign in to Raptor again.' }); return }
  const { data: me } = await admin.from('profiles').select('id, name, status').eq('id', caller.id).maybeSingle()
  if (!me || me.status !== 'Active') { res.status(403).json({ error: 'Your Raptor login is not active.' }); return }
  const accountId = (req.body ?? {}).accountId
  if (typeof accountId !== 'string') { res.status(400).json({ error: 'Which account?' }); return }
  const [{ data: a }, { data: contacts }] = await Promise.all([
    admin.from('debtor_accounts').select('id, case_number, debtor_first_name, ended_as, companies(name)').eq('id', accountId).maybeSingle(),
    admin.from('account_contacts').select('kind, value, is_primary, retired_at').eq('account_id', accountId),
  ])
  if (!a) { res.status(404).json({ error: 'That account could not be found.' }); return }
  const dest = codeDestination((contacts ?? []) as ContactRow[])
  if (!dest || dest.channel !== 'email') { res.status(400).json({ error: 'This account has no email address for the debtor. Add one under Contacts first, or copy the link and send it another way.' }); return }
  const host = req.headers['x-forwarded-host'] ?? req.headers.host
  const url = debtorPortalLink(`https://${String(host)}`, a.case_number as string)
  const mail = debtorInviteEmail({
    name: String(a.debtor_first_name ?? ''), caseNumber: a.case_number as string,
    client: (a.companies as unknown as { name: string } | null)?.name ?? '', url, from: String(me.name ?? ''),
  })
  const sent = await sendAsUser(admin, me.id as string, { to: dest.to, subject: mail.subject, bodyHtml: mail.html })
  if (!sent.ok) { res.status(502).json({ error: `The invitation could not be emailed: ${sent.error}`, url }); return }
  await admin.from('account_notes').insert({
    account_id: a.id, source: 'system', author_name: me.name ?? null, created_by: me.id,
    body: `Invited the debtor to see their account online (debtor portal): emailed ${dest.to}.`,
  })
  res.status(200).json({ ok: true, to: dest.to, url })
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

/** THE ONE PLACE THE PORTAL WORKS OUT A BALANCE -- computeBalance over the account page's ledgers. */
async function balanceOf(admin: SupabaseClient, accountRow: Record<string, unknown>, accountId: string, today: string): Promise<BalanceBreakdown> {
  const ledgers = await fetchLedgerRows(admin, [accountId])
  return computeBalance(balanceInputFor({ account: balanceAccountFromRow(accountRow), ledgers: ledgers.get(accountId)!, today }))
}

/** The collector assigned to the account, as the debtor may see them: a name and the ways to reach them, nothing else. */
async function agentOf(admin: SupabaseClient, accountId: string): Promise<{ name: string; phone: string | null; email: string | null; whatsapp: string | null } | null> {
  const { data: a } = await admin.from('debtor_accounts').select('assigned_to').eq('id', accountId).maybeSingle()
  if (!a?.assigned_to) return null
  const { data: p } = await admin.from('profiles').select('name, phone, email, whatsapp, status').eq('id', a.assigned_to).maybeSingle()
  if (!p || p.status !== 'Active' || !String(p.name ?? '').trim()) return null
  return { name: String(p.name), phone: (p.phone as string | null) || null, email: (p.email as string | null) || null, whatsapp: (p.whatsapp as string | null) || null }
}

/** What the debtor has agreed, or offered: the live promise, and the latest proposal (pending, or declined lately). */
async function arrangementState(admin: SupabaseClient, accountId: string) {
  const [{ data: live }, { data: prop }] = await Promise.all([
    admin.from('promises_to_pay').select('arrangement, amount, due_on, status').eq('account_id', accountId).in('status', ['open', 'defaulted']).maybeSingle(),
    admin.from('debtor_arrangement_proposals').select('status, arrangement, amount, first_due_on, decline_reason, created_at, decided_at, needs_assessment, signing_token')
      .eq('account_id', accountId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ])
  return {
    live: live ? { arrangement: live.arrangement as string, amount: Number(live.amount), dueOn: live.due_on as string, missed: live.status === 'defaulted' } : null,
    proposal: prop ? {
      status: prop.status as string, arrangement: prop.arrangement as string, amount: Number(prop.amount), firstDueOn: prop.first_due_on as string,
      declineReason: (prop.decline_reason as string | null) ?? null, createdAt: prop.created_at as string,
      needsAssessment: !!prop.needs_assessment,
      assessment: prop.signing_token ? await assessmentOf(admin, prop.signing_token as string) : null,
    } : null,
  }
}

/** Where the application's affordability assessment stands, and the debtor's own link to it. */
async function assessmentOf(admin: SupabaseClient, token: string): Promise<{ state: string; link: string } | null> {
  const { data } = await admin.from('signing_requests').select('state').eq('token', token).maybeSingle()
  return data ? { state: data.state as string, link: `/sign/${token}` } : null
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
    /* THE SAME computeBalance, OVER THE SAME LEDGERS, AS THE ACCOUNT PAGE -- in duplum and all. A second sum here
       would one day tell a debtor a different number from the one the collector quotes on the phone. */
    summary = debtorSummary(await balanceOf(admin, a, who.accountId, today))
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
    /* YOUR AGENT (3 Nov, Stephan: "speak to your agent. This is the person assigned to you"): the collector on the
       account -- the client portal names its liaison the same way. Their name and the ways to reach them; where nobody
       holds the account, null, and the page gives the firm's own number instead. */
    agent: await agentOf(admin, who.accountId),
    ...(await arrangementState(admin, who.accountId)),
    tickets: await ticketsOf(admin, who.accountId),
  })
}

/**
 * THE DEBTOR'S OWN TICKETS: every dispute on the account (theirs, however it was raised -- it is their dispute) and
 * every question they asked here. Open or closed and when; not who holds it, not the internal stage, not the finding's
 * working -- the finding reaches them as a letter, which is how the firm answers a dispute.
 */
async function ticketsOf(admin: SupabaseClient, accountId: string): Promise<DebtorTicket[]> {
  const { data } = await admin.from('account_queries').select('ticket_no, kind, status, created_at, category, description')
    .eq('account_id', accountId).in('kind', ['dispute', 'debtor']).order('created_at', { ascending: false }).limit(20)
  return ((data ?? []) as Record<string, unknown>[]).map((q) => ({
    no: q.ticket_no === null || q.ticket_no === undefined ? null : Number(q.ticket_no),
    kind: q.kind === 'dispute' ? 'dispute' : 'question',
    raisedOn: new Date(q.created_at as string).toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' }),
    open: q.status !== 'closed',
    about: String(q.description ?? '').slice(0, 140),
  }))
}

/* ------------------------------------------------------------------ part 2: the statement, and a proof of payment */

/**
 * THE STATEMENT OF ACCOUNT, AS THE COLLECTOR WOULD SEND IT: the same statementOfAccount, the same buildStatement over
 * the same ledgers, the same merge values (accountMergeValues, as the morning run builds them), drawn by letterToPdf on
 * the firm's letterhead in Charter -- so the PDF a debtor downloads and the one the collector emails are one document.
 * A second, simpler statement for the portal would one day disagree with the real one about what is owed.
 */
/**
 * EVERYTHING A DOCUMENT FOR THE DEBTOR NEEDS -- the account, the firm, the contacts, the collector and the liaison,
 * the ledgers and the firm's day -- read once, the way the morning run reads it. Used by the statement and by the
 * affordability assessment an application carries, so both documents are merged from the same answers.
 */
async function letterInput(admin: SupabaseClient, accountId: string): Promise<(DebtorLetterInput & { debtorKind: 'individual' | 'company'; caseNumber: string; name: string }) | null> {
  const { today } = await firmNow(admin)
  const [{ data: a }, { data: firm }, { data: contacts }] = await Promise.all([
    admin.from('debtor_accounts')
      .select('id,capital_handed_over,handover_date,interest_rate_annual,status,last_action_at,ended_as,ended_on,prescribed,prescription_date,case_number,opening_as_at,listing_date,listing_reference,bureaus_listed,debtor_kind,debtor_title,debtor_first_name,debtor_surname,account_number,client_reference,capital_outstanding,preferred_language,debtor_id_number,assigned_to,companies(name,account_owner_id)')
      .eq('id', accountId).maybeSingle(),
    admin.from('firm_settings').select('*').maybeSingle(),
    admin.from('account_contacts').select('kind, value, is_primary, retired_at').eq('account_id', accountId),
  ])
  if (!a || !firm) return null
  const company = a.companies as unknown as { name: string; account_owner_id: string | null } | null
  const [{ data: collector }, { data: liaison }, ledgers] = await Promise.all([
    a.assigned_to ? admin.from('profiles').select('id, name, phone, email, whatsapp').eq('id', a.assigned_to).maybeSingle() : Promise.resolve({ data: null }),
    company?.account_owner_id ? admin.from('profiles').select('id, name, phone, email, whatsapp').eq('id', company.account_owner_id).maybeSingle() : Promise.resolve({ data: null }),
    fetchLedgerRows(admin, [accountId]),
  ])
  return {
    account: a as DebtorStatementAccount, ledgers: ledgers.get(accountId)!, firm: toFirmSettings(firm as never),
    contacts: ((contacts ?? []) as ContactRow[]).map((c) => ({ kind: c.kind, value: c.value, isPrimary: !!c.is_primary, retiredAt: c.retired_at })),
    collector, liaison, clientName: company?.name ?? null, today, money: moneyZa,
    debtorKind: a.debtor_kind === 'company' ? 'company' : 'individual', caseNumber: a.case_number as string,
    name: [a.debtor_first_name, a.debtor_surname].filter(Boolean).join(' '),
  }
}

/**
 * THE STATEMENT OF ACCOUNT, AS THE COLLECTOR WOULD SEND IT: the same statementOfAccount, the same buildStatement over
 * the same ledgers, the same merge values (accountMergeValues, as the morning run builds them), drawn by letterToPdf on
 * the firm's letterhead in Charter -- so the PDF a debtor downloads and the one the collector emails are one document.
 * A second, simpler statement for the portal would one day disagree with the real one about what is owed.
 */
const statement: Handler = async (req, res, admin) => {
  const who = await requireDebtor(req, admin)
  if (!who) { res.status(401).json({ error: 'Please sign in again.' }); return }
  const input = await letterInput(admin, who.accountId)
  if (!input) { res.status(404).json({ error: 'Your statement could not be drawn just now. Please call us.' }); return }
  try {
    const { doc, values, fileName } = debtorStatement(input)
    const gaps = unfilledFields(doc, values)
    if (gaps.length) {
      /* Said to the firm in the log (what to fill in), and to the debtor as "call us" -- never a statement with braces. */
      console.error(`[debtor] statement for ${who.accountId} not drawn: nothing fills ${gaps.map((g) => `{{${g}}}`).join(', ')}`)
      res.status(500).json({ error: 'Your statement could not be drawn just now. Please call us and we will send it to you.' }); return
    }
    const paper = await letterheadFor(admin)
    const bytes = await letterToPdf({ doc, page: paper.page, filled: true, values, letterhead: paper.image, charter: await charterFor(), brand: isBrand(doc.defaults.font) ? await brandFor() : null })
    res.status(200).json({ fileName, pdf: Buffer.from(bytes).toString('base64') })
  } catch (e) {
    /* A failure while drawing (a font, the letterhead, a character the PDF cannot print) -- said to the firm, not the debtor. */
    console.error(`[debtor] statement for ${who.accountId} not drawn: ${e instanceof Error ? e.message : e}`)
    res.status(500).json({ error: 'Your statement could not be drawn just now. Please try again later, or call us.' })
  }
}

/**
 * A PROOF OF PAYMENT: kept with the account's documents (kind 'Proof of payment', the app's own list), a line on the
 * timeline, and the collector's bell -- or the Administrators', on an account nobody holds. It is NOT a payment: a slip
 * is a claim, and money is money only when finance sees it on the trust account. So nothing here touches a ledger.
 */
const proofOfPayment: Handler = async (req, res, admin) => {
  const who = await requireDebtor(req, admin)
  if (!who) { res.status(401).json({ error: 'Please sign in again.' }); return }
  const body = req.body ?? {}
  const file = debtorPopFile(body.fileName)
  if (!file) { res.status(400).json({ error: 'Send a PDF or a photo (JPG, PNG or HEIC) of your proof of payment.' }); return }
  const bytes = typeof body.data === 'string' && /^[A-Za-z0-9+/=\s]+$/.test(body.data) ? Buffer.from(body.data, 'base64') : null
  if (!bytes || bytes.length === 0) { res.status(400).json({ error: 'The file did not arrive. Please choose it again.' }); return }
  if (bytes.length > DEBTOR_POP_MAX_BYTES) { res.status(400).json({ error: 'That file is larger than 3 MB. A photo or a smaller PDF will do.' }); return }
  const { today } = await firmNow(admin)
  const claim = debtorPopClaim(body, today)
  if (!claim.ok) { res.status(400).json({ error: claim.error }); return }

  const { data: a } = await admin.from('debtor_accounts').select('id, case_number, assigned_to').eq('id', who.accountId).maybeSingle()
  if (!a) { res.status(404).json({ error: 'Your account could not be found. Please call us.' }); return }
  /* FILE FIRST, THEN THE ROW (accountWorkspace.uploadDocument's order): a row pointing at nothing is a broken link. */
  const path = `${a.id}/${crypto.randomUUID()}-${file.name}`
  const up = await admin.storage.from('account-documents').upload(path, bytes, { contentType: file.contentType, upsert: false })
  if (up.error) { console.error(`[debtor] proof of payment not kept for ${a.id}: ${up.error.message}`); res.status(500).json({ error: 'Your proof of payment could not be saved just now. Try again.' }); return }
  const { error: rowErr } = await admin.from('account_documents').insert({
    account_id: a.id, name: file.name, storage_path: path, mime_type: file.contentType, size_bytes: bytes.length,
    kind: 'Proof of payment', uploaded_by: null, uploaded_by_name: 'The debtor (debtor portal)',
    notes: [claim.amount !== null ? `Amount ${moneyZa(claim.amount)}` : null, claim.paidOn ? `paid on ${claim.paidOn}` : null].filter(Boolean).join(', ') || null,
  })
  if (rowErr) { console.error(`[debtor] proof of payment row not written for ${a.id}: ${rowErr.message}`); res.status(500).json({ error: 'Your proof of payment could not be saved just now. Try again.' }); return }

  const text = debtorPopNote(a.case_number as string, claim, moneyZa)
  await admin.from('account_notes').insert({ account_id: a.id, body: text, source: 'system', author_name: 'Debtor portal' })
  let tell: string[] = a.assigned_to ? [a.assigned_to as string] : []
  if (tell.length === 0) {
    const { data: admins } = await admin.from('profiles').select('id').eq('role', 'Administrator').eq('status', 'Active')
    tell = (admins ?? []).map((p) => p.id as string)
  }
  if (tell.length) {
    const { error } = await admin.from('notifications').insert(tell.map((userId) => ({ user_id: userId, type: 'debtor.proof_of_payment', message: text, link: `/accounts/${a.id}` })))
    if (error) console.error(`[debtor] notification not made: ${error.message}`)
  }
  res.status(200).json({ ok: true })
}

/* ------------------------------------------------------------------ part 3: an arrangement, proposed */

/**
 * THE DEBTOR OFFERS; A COLLECTOR DECIDES. Checked against PROPOSAL_RULES here as well as on the page (a page can be
 * edited), with the balance worked out the portal's one way. Refused while an arrangement is live -- changing one is
 * a conversation, and one live promise per account is the database's rule -- and while an offer is still waiting.
 * Nothing here is a promise: no promises_to_pay row, no fee, no message. The collector's Accept does all of that.
 */
/**
 * THE AFFORDABILITY ASSESSMENT FOR AN APPLICATION -- the firm's own signing document (letter-affordability-individual /
 * -company), made here the way the account's Sign panel makes it: the debtor's particulars merged in, everything Raptor
 * cannot answer plus the offer's three terms left as boxes the debtor fills (blanksFor; the terms on this document are
 * always the debtor's -- see SigningPanel DOCUMENTS.offersTerms), frozen on the letterhead. No fee: the firm prices
 * the acknowledgement of debt under item 4(a), not a questionnaire. Returns the token, or null if it could not be made
 * -- the offer still stands and the collector can send the form from the account.
 */
async function createAssessment(admin: SupabaseClient, accountId: string): Promise<string | null> {
  const input = await letterInput(admin, accountId)
  if (!input) return null
  const { data: tpl } = await admin.from('message_templates')
    .select('name, body').eq('seed_key', `letter-affordability-${input.debtorKind}`).eq('active', true).maybeSingle()
  const doc = tpl ? parseLetter(tpl.body as string) : null
  if (!tpl || !doc) { console.error(`[debtor] no affordability assessment template for ${input.debtorKind}`); return null }
  const { values } = debtorLetterValues(input)
  const unanswered = FILLABLE.filter((b) => !(values[b.key] ?? '').trim()).map((b) => b.key)
  const blanks = blanksFor([...unanswered, 'ptp_amount', 'ptp_frequency', 'ptp_date'], input.debtorKind)
  const paper = await letterheadFor(admin)
  const token = newToken()
  const { error } = await admin.from('signing_requests').insert({
    token, account_id: accountId, title: tpl.name as string,
    body: fillLetter(doc, values, blanks.map((b) => b.key)).blocks,
    page_setup: paper.page, blanks, signer_name: input.name || null,
  })
  if (error) { console.error(`[debtor] affordability assessment not created for ${accountId}: ${error.message}`); return null }
  return token
}

const propose: Handler = async (req, res, admin) => {
  const who = await requireDebtor(req, admin)
  if (!who) { res.status(401).json({ error: 'Please sign in again.' }); return }
  const body = req.body ?? {}
  const offer = {
    arrangement: (['once_off', 'weekly', 'monthly'].includes(body.arrangement) ? body.arrangement : '') as 'once_off' | 'weekly' | 'monthly',
    amount: Math.round(Number(String(body.amount ?? '').replace(/[^\d.,]/g, '').replace(',', '.')) * 100) / 100,
    firstDueOn: typeof body.firstDueOn === 'string' ? body.firstDueOn : '',
  }
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) || null : null
  const { today } = await firmNow(admin)
  const { data: a } = await admin.from('debtor_accounts')
    .select('id,capital_handed_over,handover_date,interest_rate_annual,status,last_action_at,ended_as,ended_on,prescribed,prescription_date,case_number,assigned_to')
    .eq('id', who.accountId).maybeSingle()
  if (!a) { res.status(404).json({ error: 'Your account could not be found. Please call us.' }); return }
  if (a.ended_as) { res.status(400).json({ error: 'This account is closed, so there is nothing to arrange.' }); return }
  const state = await arrangementState(admin, who.accountId)
  if (state.live) { res.status(409).json({ error: 'You already have an arrangement with us. To change it, please call us.' }); return }
  if (state.proposal?.status === 'pending') { res.status(409).json({ error: 'We already have your offer and will reply soon. To change it, please call us.' }); return }

  let b: BalanceBreakdown
  try { b = await balanceOf(admin, a, who.accountId, today) } catch { res.status(500).json({ error: 'Your balance could not be worked out just now. Please try again later.' }); return }
  /* A ONCE-OFF IS THE SETTLEMENT, AS THE SERVER WORKS IT OUT (Stephan, 4 Nov) -- not a figure the page sent, which
     could be a day stale or edited. The page shows the same number; this is the one that is recorded. */
  if (offer.arrangement === 'once_off') offer.amount = b.settlement
  const problem = proposalProblem(offer, { balance: b.balance, settlement: b.settlement }, today)
  if (problem) { res.status(400).json({ error: problem }); return }

  /* MORE THAN 12 MONTHS IS AN APPLICATION (Stephan, 3 Nov): the same offer, with the affordability assessment. */
  const application = needsApplication(offer, b.settlement)
  const { data: row, error } = await admin.from('debtor_arrangement_proposals').insert({
    account_id: who.accountId, arrangement: offer.arrangement, amount: offer.amount, first_due_on: offer.firstDueOn, note, balance_then: b.balance,
    needs_assessment: application,
  }).select('id').single()
  if (error) {
    /* The one-pending index: a second press got here first. */
    if (error.code === '23505') { res.status(409).json({ error: 'We already have your offer and will reply soon.' }); return }
    console.error(`[debtor] proposal not saved for ${who.accountId}: ${error.message}`)
    res.status(500).json({ error: 'Your offer could not be sent just now. Try again.' }); return
  }
  let token: string | null = null
  if (application) {
    token = await createAssessment(admin, who.accountId)
    if (token) await admin.from('debtor_arrangement_proposals').update({ signing_token: token }).eq('id', row!.id)
  }
  const text = application
    ? `The debtor applied for an arrangement longer than 12 months on the debtor portal: ${proposalSummary(offer, b.settlement)}.${note ? ` They wrote: "${note}"` : ''} `
      + (token ? 'They have been sent the affordability assessment to fill in; accept or decline once it is signed.' : 'The affordability assessment could not be made for them -- send it from the account.')
    : `The debtor offered an arrangement on the debtor portal: ${proposalSummary(offer, b.settlement)}.${note ? ` They wrote: "${note}"` : ''} Accept or decline it on the account.`
  await admin.from('account_notes').insert({ account_id: who.accountId, body: text, source: 'system', author_name: 'Debtor portal' })
  let tell: string[] = a.assigned_to ? [a.assigned_to as string] : []
  if (tell.length === 0) {
    const { data: admins } = await admin.from('profiles').select('id').eq('role', 'Administrator').eq('status', 'Active')
    tell = (admins ?? []).map((p) => p.id as string)
  }
  if (tell.length) {
    const { error: bellErr } = await admin.from('notifications').insert(tell.map((userId) => ({
      user_id: userId, type: 'debtor.arrangement_offer', message: `${a.case_number}: ${text}`, link: `/accounts/${who.accountId}`,
    })))
    if (bellErr) console.error(`[debtor] notification not made: ${bellErr.message}`)
  }
  /* The debtor goes straight on to the form; the link is theirs (they are signed in to this very account). */
  res.status(200).json({ ok: true, application, assessmentLink: token ? `/sign/${token}` : null })
}

/* ------------------------------------------------------------------ part 4: a dispute, or a question */

/** Who hears of a debtor's ticket: the owner it is given to, and the collector on the account, or the Administrators. */
async function ringAbout(admin: SupabaseClient, ids: (string | null)[], type: string, message: string, link: string) {
  let tell = [...new Set(ids.filter(Boolean) as string[])]
  if (tell.length === 0) {
    const { data: admins } = await admin.from('profiles').select('id').eq('role', 'Administrator').eq('status', 'Active')
    tell = (admins ?? []).map((p) => p.id as string)
  }
  if (!tell.length) return
  const { error } = await admin.from('notifications').insert(tell.map((userId) => ({ user_id: userId, type, message, link })))
  if (error) console.error(`[debtor] notification not made (${type}): ${error.message}`)
}

/**
 * A DISPUTE, IN WRITING. Typed by the debtor on their own account, it is a written dispute exactly as an email is
 * (raiseQuery's `reached: 'written'`): alleged and received today, in_writing -- so workflow_start_on_dispute starts
 * the real dispute sequence and the collection sequences stop until the firm gives its finding (CLAUDE.md: a dispute
 * is one of the three things that take an account out of a workflow). Classified by the debtor's own reason, mapped
 * to the firm's categories. Given to the client's liaison -- a dispute's finding needs somebody with standing
 * (ESCALATION_KINDS.dispute.goesTo) -- or the collector where the client has none.
 *
 * ITEM 6, NOT ITEM 3. Stephan, 3 Nov: "If they raise a dispute, it's correspondence received ... because there will be
 * action on that, just charge them for the correspondence received." So it is billed exactly as a debtor's email is --
 * item 6, R13, chargeItemWith with every cap and ceiling, the same constants emailSync uses -- and never item 3, which
 * recovers the time a collector spends raising one.
 */
const dispute: Handler = async (req, res, admin) => {
  const who = await requireDebtor(req, admin)
  if (!who) { res.status(401).json({ error: 'Please sign in again.' }); return }
  const d = debtorDispute(req.body ?? {})
  if (!d.ok) { res.status(400).json({ error: d.error }); return }
  const { data: a } = await admin.from('debtor_accounts').select('id, case_number, assigned_to, companies(account_owner_id)').eq('id', who.accountId).maybeSingle()
  if (!a) { res.status(404).json({ error: 'Your account could not be found. Please call us.' }); return }
  const liaison = (a.companies as unknown as { account_owner_id: string | null } | null)?.account_owner_id ?? null
  const owner = liaison ?? (a.assigned_to as string | null) ?? null
  const { today, now } = await firmNow(admin)
  const { data: q, error } = await admin.from('account_queries').insert({
    account_id: a.id, kind: 'dispute', category: d.category, description: d.text, status: 'open',
    owner_id: owner, stage: liaison ? 'liaison' : 'agent',
    raised_by: null, raised_by_name: 'The debtor (debtor portal)',
    alleged_on: today, received_on: today, in_writing: true,
  }).select('id, ticket_no').single()
  if (error || !q) {
    /* one_open_dispute_per_account: a second dispute is added to the first, which a person does. */
    if (error?.code === '23505') { res.status(409).json({ error: 'You already have an open dispute on this account. Send us a message below and we will add it to that one.' }); return }
    console.error(`[debtor] dispute not raised on ${a.id}: ${error?.message}`)
    res.status(500).json({ error: 'Your dispute could not be sent just now. Try again, or call us.' }); return
  }
  await admin.from('account_notes').insert({
    account_id: a.id, query_id: q.id, kind: 'query', source: 'system', author_name: 'Debtor portal',
    body: `The debtor disputed the account in writing on the debtor portal (${d.category}): ${d.text}`,
  })
  /* Wrapped like emailSync's: a fee that could not be raised must not lose the debtor's dispute. Raised once, after the
     ticket is saved, so a failed save is never billed. */
  try {
    await chargeItemWith(admin, {
      accountId: a.id as string, itemId: CORRESPONDENCE_ITEM_ID, actionCode: CORRESPONDENCE_ACTION_CODE,
      description: CORRESPONDENCE_DESCRIPTION, createdBy: null, at: new Date(now),
    })
  } catch (e) { console.error(`[debtor] item 6 not raised on the dispute on ${a.id}: ${e instanceof Error ? e.message : e}`) }
  await ringAbout(admin, [owner, a.assigned_to as string | null], 'debtor.dispute',
    `${a.case_number}: the debtor disputed the account on the debtor portal (${d.category}). Collection is paused until it is answered.`, `/queries/${q.id}`)
  /*
   * AND THE DISPUTE SEQUENCE GETS ITS DATES NOW, as raiseQuery's nudge does for a collector -- a run arrives from the
   * trigger with no steps, and left to the morning the debtor's acknowledgement goes out tomorrow. It cannot fail the
   * dispute: the dispute is saved, and the morning sweep is the backstop.
   */
  try { await sweep(admin, { accountIds: [a.id as string], today, now: new Date(now) }) }
  catch (e) { console.error(`[debtor] dispute sequence not planned for ${a.id}: ${e instanceof Error ? e.message : e}`) }
  res.status(200).json({ ticketNo: q.ticket_no ?? null })
}

/** A QUESTION: a ticket of the debtor's own kind, with the collector on the account. Never charged. */
const ask: Handler = async (req, res, admin) => {
  const who = await requireDebtor(req, admin)
  if (!who) { res.status(401).json({ error: 'Please sign in again.' }); return }
  const d = debtorQuestion(req.body ?? {})
  if (!d.ok) { res.status(400).json({ error: d.error }); return }
  const { data: a } = await admin.from('debtor_accounts').select('id, case_number, assigned_to').eq('id', who.accountId).maybeSingle()
  if (!a) { res.status(404).json({ error: 'Your account could not be found. Please call us.' }); return }
  const { data: q, error } = await admin.from('account_queries').insert({
    account_id: a.id, kind: 'debtor', description: d.text, status: 'open',
    owner_id: a.assigned_to ?? null, stage: 'agent', raised_by: null, raised_by_name: 'The debtor (debtor portal)',
  }).select('id, ticket_no').single()
  if (error || !q) {
    console.error(`[debtor] question not raised on ${a.id}: ${error?.message}`)
    res.status(500).json({ error: 'Your question could not be sent just now. Try again, or call us.' }); return
  }
  await admin.from('account_notes').insert({
    account_id: a.id, query_id: q.id, kind: 'query', source: 'system', author_name: 'Debtor portal',
    body: `The debtor asked on the debtor portal: ${d.text}`,
  })
  await ringAbout(admin, [a.assigned_to as string | null], 'debtor.question', `${a.case_number}: the debtor asked a question on the debtor portal: ${d.text.slice(0, 120)}`, `/queries/${q.id}`)
  res.status(200).json({ ticketNo: q.ticket_no ?? null })
}

const signOut: Handler = async (req, res, admin) => {
  const who = await requireDebtor(req, admin)
  if (who) await admin.from('debtor_portal_sessions').delete().eq('id', who.sessionId)
  res.status(200).json({ ok: true })
}

export const DEBTOR_ROUTES: Record<string, Handler> = {
  'request-code': requestCode,
  verify,
  'sign-in': signIn,
  'set-password': setPassword,
  invite,
  account,
  statement,
  'proof-of-payment': proofOfPayment,
  propose,
  dispute,
  ask,
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
