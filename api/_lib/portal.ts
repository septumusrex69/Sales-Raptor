import crypto from 'node:crypto'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { SupabaseClient } from '@supabase/supabase-js'
import { adminClient, requireCaller } from './auth.js'
import { credentialsKeyProblem, hashPassword, keyedHash, passwordMatches, sameHex } from './crypto.js'
import { sendAsUser } from './email/sendAsUser.js'
import { EMAIL_IN_KIND, receivedEmailNote } from '../../src/lib/emailRules.js'
import { can } from '../../src/lib/capabilities.js'
import { codeSenderOrder, deviceLabel, normaliseCode, resendDecision } from '../../src/lib/loginCode.js'
import {
  CODE_SENT_MESSAGE, PORTAL_CODE_MESSAGE, PORTAL_PASSWORD_FAILURES, PORTAL_PASSWORD_LOCK_MINUTES, PORTAL_PASSWORD_WRONG,
  portalPasswordProblem, PORTAL_CODE_MINUTES, PORTAL_SESSION_DAYS, PORTAL_TOKEN_HEADER,
  isPortalToken, normalisePortalEmail, portalCallback, portalCodeCheck, portalCodeEmail, portalInviteEmail, portalLine,
  portalHandoverPdfName, portalHandoverSheetName, portalMessageText, portalOutcomes, portalSingleHandover,
  PORTAL_HANDOVER_MAX_BYTES, portalPaymentReport, portalPaymentText, portalQuestion, portalRands, portalTicketNo, portalTopic,
  type PortalBookRow, type PortalSummaryGroup,
} from '../../src/lib/clientPortal.js'

/**
 * /api/portal/<action> -- THE CLIENT PORTAL'S SERVER (S14, Raptor H13). See src/lib/clientPortal.ts.
 *
 * EVERY READ IS THE SERVICE ROLE, FILTERED BY THE SESSION'S CLIENT. The browser names nothing it may
 * read: not a company, not an account. The client comes off the session row, so a client who edits a
 * request can only change what they search for inside their own book.
 *
 * Two kinds of caller, never mixed:
 *   anonymous    request-code, verify, sign-in      (the code, or the password set after it, is the authority)
 *   portal user  me, book, sign-out, set-password,  (x-portal-token)
 *                tickets, ticket, ticket-reply, ask, callback, payment-report,
 *                dashboard, reports, report-file, handovers, handover-sheet, handover-single
 *   staff        staff-list, staff-invite, staff-set-active   (a Raptor session + dispute.write_to_client)
 *
 * The staff tick is dispute.write_to_client because a portal login is a way of writing to a client about
 * their book, and that tick is the firm's answer to who holds the client relationship.
 */

type Handler = (req: VercelRequest, res: VercelResponse, admin: SupabaseClient) => Promise<void>

const now = () => Date.now()

/* ------------------------------------------------------------------ anonymous: the sign-in */

const requestCode: Handler = async (req, res, admin) => {
  const email = normalisePortalEmail((req.body ?? {}).email)
  if (!email) { res.status(400).json({ error: 'Type the email address the firm invited.' }); return }
  const { data: user } = await admin.from('client_portal_users')
    .select('id, name, email, active, invited_by, company_id').ilike('email', email).maybeSingle()
  /* THE SAME ANSWER FOR AN ADDRESS THAT MAY NOT SIGN IN -- see CODE_SENT_MESSAGE. */
  /* THE SAME ANSWER TO THE BROWSER, BUT NOT TO THE LOG (S15): a code that "never arrived" was otherwise
     undiagnosable -- not found, switched off and sent all read alike. The log is the firm's, not the client's. */
  if (!user || !user.active) {
    console.log(`[portal] code asked for ${email}: ${user ? 'switched off' : 'no portal login with that address'}`)
    res.status(200).json({ message: CODE_SENT_MESSAGE }); return
  }

  const t = now()
  const { data: last } = await admin.from('client_portal_codes')
    .select('sent_at, window_started_at, sends_in_window').eq('user_id', user.id).maybeSingle()
  const decision = resendDecision(last ? {
    sentAt: last.sent_at as string, windowStartedAt: last.window_started_at as string,
    sendsInWindow: Number(last.sends_in_window ?? 0),
  } : null, t)
  if (!decision.ok) { console.log(`[portal] code for portal user ${user.id} held: ${decision.reason}`); res.status(429).json({ error: decision.reason, waitSeconds: decision.waitSeconds }); return }

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
  const { error: saveErr } = await admin.from('client_portal_codes').upsert({
    user_id: user.id, code_hash: keyedHash('portal-code', `${user.id}:${code}`),
    expires_at: new Date(t + PORTAL_CODE_MINUTES * 60_000).toISOString(), attempts: 0,
    sent_at: new Date(t).toISOString(), window_started_at: decision.windowStartedAt, sends_in_window: decision.sendsInWindow,
  }, { onConflict: 'user_id' })
  if (saveErr) { console.error(`[portal] code not saved for portal user ${user.id}: ${saveErr.message}`); res.status(500).json({ error: 'The code could not be made just now. Try again in a minute.' }); return }

  /*
   * WHO SENDS IT. Raptor has no system mailbox (loginCode.ts says why), so a person's connected one: the
   * liaison who invited them first -- the name the client already knows -- then an Administrator's.
   */
  const [{ data: staff }, { data: boxes }] = await Promise.all([
    admin.from('profiles').select('id, name, status, role').or(`role.eq.Administrator${user.invited_by ? `,id.eq.${user.invited_by}` : ''}`),
    admin.from('email_connections').select('user_id'),
  ])
  const withMailbox = new Set((boxes ?? []).map((b) => b.user_id as string))
  const order = codeSenderOrder((user.invited_by as string | null) ?? '', (staff ?? []).map((p) => ({
    id: p.id as string, name: String(p.name ?? ''), hasMailbox: withMailbox.has(p.id as string), active: p.status === 'Active',
  })))
  /* The button goes back to the portal the client asked from, and the email is signed by whoever sends it. */
  const host = req.headers['x-forwarded-host'] ?? req.headers.host
  const url = host ? `https://${String(host)}/portal` : undefined
  const nameOf = new Map((staff ?? []).map((p) => [p.id as string, String(p.name ?? '')]))
  let sent = false
  let lastError = 'Nobody at the firm has a mailbox connected to send it from.'
  for (const senderId of order) {
    const mail = portalCodeEmail({ name: String(user.name ?? ''), code, url, from: nameOf.get(senderId) })
    const r = await sendAsUser(admin, senderId, { to: user.email as string, subject: mail.subject, bodyHtml: mail.html })
    if (r.ok) { sent = true; console.log(`[portal] code for portal user ${user.id} sent from ${senderId}`); break }
    lastError = r.error
  }
  if (!sent) {
    await admin.from('client_portal_codes').update({ expires_at: new Date(t).toISOString() }).eq('user_id', user.id)
    console.error(`[portal] no mailbox would send a code for portal user ${user.id}: ${lastError}`)
    res.status(502).json({ error: 'The code could not be emailed just now. Try again shortly, or call the firm.' }); return
  }
  res.status(200).json({ message: CODE_SENT_MESSAGE })
}

const verify: Handler = async (req, res, admin) => {
  const body = req.body ?? {}
  const email = normalisePortalEmail(body.email)
  const code = normaliseCode(body.code)
  if (!email || !code) { res.status(400).json({ error: 'Type the six digits from the email.' }); return }
  const { data: user } = await admin.from('client_portal_users').select('id, active, password_hash').ilike('email', email).maybeSingle()
  const { data: stored } = user?.active
    ? await admin.from('client_portal_codes').select('code_hash, expires_at, attempts').eq('user_id', user.id).maybeSingle()
    : { data: null }
  const t = now()
  const check = portalCodeCheck(stored ? { expiresAt: stored.expires_at as string, attempts: Number(stored.attempts) } : null, t)
  if (check !== 'compare') { res.status(400).json({ error: PORTAL_CODE_MESSAGE[check] }); return }
  if (!sameHex(stored!.code_hash as string, keyedHash('portal-code', `${user!.id}:${code}`))) {
    await admin.from('client_portal_codes').update({ attempts: Number(stored!.attempts) + 1 }).eq('user_id', user!.id)
    res.status(400).json({ error: PORTAL_CODE_MESSAGE.none }); return
  }

  /* Spent the moment it matches, so the same six digits cannot open a second browser. */
  await admin.from('client_portal_codes').delete().eq('user_id', user!.id)
  const session = await openSession(admin, req, user!.id, t, body.remember !== false)
  if (!session) { res.status(500).json({ error: 'You could not be signed in just now. Try again.' }); return }
  /* A CODE IS THE FIRST VISIT OR THE RESET (S16), so the browser asks for a password next: always when there
     is none yet, and when the client came here because they forgot it. The code also clears a lock. */
  await admin.from('client_portal_users').update({ password_failures: 0, password_locked_until: null }).eq('id', user!.id)
  res.status(200).json({ ...session, needsPassword: !user!.password_hash || body.reset === true })
}

/** A new signed-in browser: the token goes to it once, only its keyed hash is kept. */
/* KEEP ME SIGNED IN (S16): ticked, a month, as before; not ticked, a day -- the browser forgets it sooner still
   (portalApi keeps it for the tab only), and the server must not hold a month-long key for a shared office PC. */
async function openSession(admin: SupabaseClient, req: VercelRequest, userId: string, t: number, remember = true): Promise<{ token: string; expiresAt: string } | null> {
  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(t + (remember ? PORTAL_SESSION_DAYS : 1) * 86_400_000).toISOString()
  const { error } = await admin.from('client_portal_sessions').insert({
    user_id: userId, token_hash: keyedHash('portal-session', token), expires_at: expiresAt,
    device: deviceLabel(req.headers['user-agent'] as string | undefined),
  })
  if (error) return null
  await admin.from('client_portal_users').update({ last_login_at: new Date(t).toISOString() }).eq('id', userId)
  return { token, expiresAt }
}

/*
 * THE EVERYDAY SIGN-IN (S16): the address and the password set after the first code. One answer for an
 * unknown address, a login with no password yet and a wrong password (PORTAL_PASSWORD_WRONG), for the same
 * reason the code's answer never says whether an address is a client's. Five wrong in a row lock it for a
 * quarter of an hour; the emailed code still opens it.
 */
const signIn: Handler = async (req, res, admin) => {
  const body = req.body ?? {}
  const email = normalisePortalEmail(body.email)
  const password = typeof body.password === 'string' ? body.password : ''
  if (!email || !password) { res.status(400).json({ error: 'Type your email address and your password.' }); return }
  const { data: user } = await admin.from('client_portal_users')
    .select('id, active, password_hash, password_failures, password_locked_until').ilike('email', email).maybeSingle()
  const t = now()
  if (user?.password_locked_until && Date.parse(user.password_locked_until as string) > t) {
    res.status(429).json({ error: `Too many wrong passwords. Try again in ${PORTAL_PASSWORD_LOCK_MINUTES} minutes, or email yourself a code.` }); return
  }
  if (!user || !user.active || !user.password_hash || !passwordMatches(password, user.password_hash as string)) {
    if (user?.password_hash) {
      const failures = Number(user.password_failures ?? 0) + 1
      await admin.from('client_portal_users').update({
        password_failures: failures >= PORTAL_PASSWORD_FAILURES ? 0 : failures,
        password_locked_until: failures >= PORTAL_PASSWORD_FAILURES ? new Date(t + PORTAL_PASSWORD_LOCK_MINUTES * 60_000).toISOString() : null,
      }).eq('id', user.id)
      if (failures >= PORTAL_PASSWORD_FAILURES) console.log(`[portal] password locked for portal user ${user.id}`)
    }
    res.status(400).json({ error: PORTAL_PASSWORD_WRONG }); return
  }
  const session = await openSession(admin, req, user.id as string, t, body.remember !== false)
  if (!session) { res.status(500).json({ error: 'You could not be signed in just now. Try again.' }); return }
  await admin.from('client_portal_users').update({ password_failures: 0, password_locked_until: null }).eq('id', user.id)
  res.status(200).json(session)
}

/* ------------------------------------------------------------------ a signed-in client */

interface PortalCaller { userId: string; sessionId: string; name: string; email: string; companyId: string; clientName: string }

async function requirePortalUser(req: VercelRequest, admin: SupabaseClient): Promise<PortalCaller | null> {
  const token = req.headers[PORTAL_TOKEN_HEADER]
  if (!isPortalToken(token)) return null
  const { data: s } = await admin.from('client_portal_sessions')
    .select('id, user_id, expires_at').eq('token_hash', keyedHash('portal-session', token)).maybeSingle()
  if (!s || Date.parse(s.expires_at as string) <= now()) return null
  const { data: u } = await admin.from('client_portal_users')
    .select('id, name, email, active, company_id, companies(name)').eq('id', s.user_id).maybeSingle()
  /* SWITCHED OFF BY THE FIRM IS SIGNED OUT, at once: the session is checked against the user every call. */
  if (!u || !u.active) return null
  await admin.from('client_portal_sessions').update({ last_seen_at: new Date().toISOString() }).eq('id', s.id)
  const company = u.companies as unknown as { name: string } | null
  return {
    userId: u.id as string, sessionId: s.id as string, name: String(u.name ?? ''), email: u.email as string,
    companyId: u.company_id as string, clientName: company?.name ?? '',
  }
}

const me: Handler = async (req, res, admin) => {
  const who = await requirePortalUser(req, admin)
  if (!who) { res.status(401).json({ error: 'Please sign in again.' }); return }
  res.status(200).json({ name: who.name, email: who.email, client: who.clientName })
}

const book: Handler = async (req, res, admin) => {
  const who = await requirePortalUser(req, admin)
  if (!who) { res.status(401).json({ error: 'Please sign in again.' }); return }
  const body = req.body ?? {}
  const search = typeof body.search === 'string' ? body.search.slice(0, 100) : null
  const offset = Number.isInteger(body.offset) && body.offset >= 0 ? body.offset : 0
  const { data, error } = await admin.rpc('portal_book', {
    p_client: who.companyId, p_search: search, p_open_only: body.includeClosed !== true, p_limit: 100, p_offset: offset,
  })
  if (error) { res.status(500).json({ error: 'Your accounts could not be read just now.' }); return }
  const d = data as { total: number; totals: Record<string, number>; rows: PortalBookRow[] }
  res.status(200).json({
    total: d.total,
    totals: {
      capitalHandedOver: Number(d.totals.capital_handed_over) || 0, paidThisMonth: Number(d.totals.paid_this_month) || 0,
      paidToDate: Number(d.totals.paid_to_date) || 0, capitalOutstanding: Number(d.totals.capital_outstanding) || 0,
    },
    lines: d.rows.map(portalLine),
  })
}

const signOut: Handler = async (req, res, admin) => {
  const who = await requirePortalUser(req, admin)
  if (who) await admin.from('client_portal_sessions').delete().eq('id', who.sessionId)
  res.status(200).json({ ok: true })
}

/* SETTING THE PASSWORD (S16), from a browser the code just signed in. Hashed here, never stored as typed. */
const setPassword: Handler = async (req, res, admin) => {
  const who = await requirePortalUser(req, admin)
  if (!who) { res.status(401).json({ error: 'Please sign in again.' }); return }
  const password = (req.body ?? {}).password
  const problem = portalPasswordProblem(password, who.email)
  if (problem) { res.status(400).json({ error: problem }); return }
  const { error } = await admin.from('client_portal_users').update({
    password_hash: hashPassword(password as string), password_set_at: new Date(now()).toISOString(),
    password_failures: 0, password_locked_until: null,
  }).eq('id', who.userId)
  if (error) { res.status(500).json({ error: 'Your password could not be saved just now. Try again.' }); return }
  console.log(`[portal] password set for portal user ${who.userId}`)
  res.status(200).json({ ok: true })
}

/* ------------------------------------------------------------------ a signed-in client: tickets (S15) */

/*
 * PHASE 2a (S15, Raptor · Handover 14). Stephan's order: tickets in the portal (see them and answer),
 * questions about a debtor, callbacks. Every write below lands on the LIAISON's desk -- the client's
 * account owner -- and rings their bell, because each one is work that has just become theirs
 * (emailSync explains why the bell is for exactly that and nothing else).
 *
 * NOT CHARGED. What a client types into the portal raises no fee on the debtor's account. The firm's
 * ruling charges item 6 on the client's EMAIL about an account; whether a portal message is the same
 * thing is the firm's question, put to Stephan in S15 and not yet answered, and an unraised fee can be
 * raised by hand where a raised one is a complaint. If the answer is yes, raise it in fileClientMessage
 * the way emailSync's fileAccountEmail does.
 */

/** The client and its sub-accounts: every company a portal user's tickets and accounts may belong to. */
async function clientGroup(admin: SupabaseClient, clientId: string): Promise<Set<string>> {
  const { data } = await admin.from('companies').select('id').or(`id.eq.${clientId},parent_company_id.eq.${clientId}`)
  return new Set((data ?? []).map((c) => c.id as string))
}

/**
 * WHO HEARS ABOUT IT: the client's liaison, or -- where the client has none -- every active
 * Administrator, because a question nobody is told about is a question nobody answers.
 */
async function liaisonFor(admin: SupabaseClient, clientId: string): Promise<{ owner: string | null; tell: string[] }> {
  const { data: co } = await admin.from('companies').select('account_owner_id').eq('id', clientId).maybeSingle()
  const owner = (co?.account_owner_id as string | null) ?? null
  if (owner) return { owner, tell: [owner] }
  const { data: admins } = await admin.from('profiles').select('id').eq('role', 'Administrator').eq('status', 'Active')
  return { owner: null, tell: (admins ?? []).map((p) => p.id as string) }
}

async function ring(admin: SupabaseClient, to: string[], type: string, message: string, link: string) {
  if (to.length === 0) return
  const { error } = await admin.from('notifications').insert(to.map((userId) => ({ user_id: userId, type, message, link })))
  if (error) console.error(`[portal] notification not made (${type}): ${error.message}`)
}

/** The ticket behind a number, if -- and only if -- it is this client's and of a kind they may see. */
async function clientTicket(admin: SupabaseClient, who: PortalCaller, ticketNo: number) {
  const { data: q } = await admin.from('account_queries')
    .select('id, kind, status, stage, owner_id, account_id, handover_id, debtor_accounts(company_id, case_number), handovers(company_id)')
    .eq('ticket_no', ticketNo).maybeSingle()
  if (!q || !['dispute', 'import', 'litigation', 'client'].includes(q.kind as string)) return null
  const acc = q.debtor_accounts as unknown as { company_id: string; case_number: string | null } | null
  const sheet = q.handovers as unknown as { company_id: string } | null
  const company = acc?.company_id ?? sheet?.company_id
  if (!company || !(await clientGroup(admin, who.companyId)).has(company)) return null
  return {
    id: q.id as string, status: q.status as string, stage: q.stage as string, ownerId: (q.owner_id as string | null) ?? null,
    accountId: (q.account_id as string | null) ?? null, caseNumber: acc?.case_number ?? null,
  }
}

const tickets: Handler = async (req, res, admin) => {
  const who = await requirePortalUser(req, admin)
  if (!who) { res.status(401).json({ error: 'Please sign in again.' }); return }
  const { data, error } = await admin.rpc('portal_tickets', { p_client: who.companyId })
  if (error) { res.status(500).json({ error: 'Your tickets could not be read just now.' }); return }
  res.status(200).json({ tickets: data ?? [] })
}

const ticket: Handler = async (req, res, admin) => {
  const who = await requirePortalUser(req, admin)
  if (!who) { res.status(401).json({ error: 'Please sign in again.' }); return }
  const ticketNo = portalTicketNo((req.body ?? {}).ticketNo)
  if (ticketNo === null) { res.status(400).json({ error: 'Which ticket?' }); return }
  const { data, error } = await admin.rpc('portal_ticket_thread', { p_client: who.companyId, p_ticket_no: ticketNo })
  if (error) { res.status(500).json({ error: 'That ticket could not be read just now.' }); return }
  /* NOT FOUND AND NOT YOURS ARE ONE ANSWER, for the reason the sign-in gives one answer. */
  if (data === null) { res.status(404).json({ error: 'There is no such ticket on your accounts.' }); return }
  res.status(200).json({ messages: data })
}

/**
 * The client's words, filed on the ticket as a message received -- the same row an emailed reply makes,
 * so the liaison reads it in the ticket's Emails tab beside everything else the client wrote. The
 * correspondent is the database's to decide, and a portal user's address reads as the client's
 * (client_portal_tickets). charged_excl_vat 0, said in the row: see the note at the top of this block.
 */
async function fileClientMessage(admin: SupabaseClient, who: PortalCaller, t: { id: string; accountId: string | null; ownerId: string | null },
  subject: string, body: string): Promise<boolean> {
  const { error } = await admin.from('account_emails').insert({
    account_id: t.accountId, query_id: t.id, direction: 'in',
    debtor_address: who.email, subject, body,
    message_id: `<portal-${crypto.randomUUID()}@raptor.portal>`,
    sent_by_name: `${who.name || who.email} (client portal)`,
    received_by: t.ownerId, occurred_at: new Date().toISOString(), charged_excl_vat: 0,
  })
  if (error) console.error(`[portal] message not filed on ticket ${t.id}: ${error.message}`)
  /*
   * AND ON THE ACCOUNT'S ACTIVITY (S15). Stephan: "there should be an activity or a note, something for
   * every query." The same note an emailed reply makes (emailSync.fileAccountEmail): a 'manual' email-in
   * line on the account's timeline. NOT on the ticket's own thread -- the message above already is, and
   * the conversation would show the client saying it twice.
   */
  if (!error && t.accountId) await note(admin, t.accountId, receivedEmailNote(`${who.name || who.email} (client portal)`, subject, body), EMAIL_IN_KIND, who)
  return !error
}

/** A line on the account's timeline, written by the client through the portal. */
async function note(admin: SupabaseClient, accountId: string, body: string, kind: string, who: PortalCaller) {
  const { error } = await admin.from('account_notes').insert({
    account_id: accountId, body, kind, source: 'manual', author_name: `${who.name || who.email} (client portal)`,
  })
  if (error) console.error(`[portal] note not written on account ${accountId}: ${error.message}`)
}

const ticketReply: Handler = async (req, res, admin) => {
  const who = await requirePortalUser(req, admin)
  if (!who) { res.status(401).json({ error: 'Please sign in again.' }); return }
  const body = req.body ?? {}
  const ticketNo = portalTicketNo(body.ticketNo)
  const text = portalMessageText(body.message)
  if (ticketNo === null || !text) { res.status(400).json({ error: 'Type your reply first.' }); return }
  const t = await clientTicket(admin, who, ticketNo)
  if (!t) { res.status(404).json({ error: 'There is no such ticket on your accounts.' }); return }
  /* A CLOSED TICKET IS ANSWERED. Writing on it would put words on a desk nobody looks at; a new
     question is a new ticket, and the screen offers exactly that. */
  if (t.status !== 'open') { res.status(409).json({ error: 'That ticket is closed. Ask a new question from the account instead.' }); return }
  if (!(await fileClientMessage(admin, who, t, `Re: ticket T-${ticketNo}`, text))) {
    res.status(500).json({ error: 'Your reply could not be saved just now. Try again.' }); return
  }
  /* THE CLIENT HAS ANSWERED, SO IT IS THE LIAISON'S TURN: a ticket left on stage 'client' after the
     client wrote back reads on the board as still waiting on them. */
  if (t.stage === 'client') await admin.from('account_queries').update({ stage: 'liaison' }).eq('id', t.id)
  const { owner, tell } = await liaisonFor(admin, who.companyId)
  await ring(admin, t.ownerId ? [t.ownerId] : owner ? [owner] : tell, 'portal.reply',
    `${who.clientName}: ${who.name || who.email} replied on ticket T-${ticketNo}${t.caseNumber ? ` (${t.caseNumber})` : ''} from the client portal.`,
    `/queries/${t.id}`)
  res.status(200).json({ ok: true })
}

/** An account on this client's book, by OUR reference -- the only one the portal shows that is unique. */
async function clientAccount(admin: SupabaseClient, who: PortalCaller, caseNumber: unknown) {
  if (typeof caseNumber !== 'string' || !caseNumber.trim()) return null
  const { data: a } = await admin.from('debtor_accounts')
    .select('id, company_id, case_number, debtor_first_name, debtor_surname').eq('case_number', caseNumber.trim()).maybeSingle()
  if (!a || !(await clientGroup(admin, who.companyId)).has(a.company_id as string)) return null
  return { id: a.id as string, caseNumber: a.case_number as string,
    debtor: [a.debtor_first_name, a.debtor_surname].filter(Boolean).join(' ') || 'the debtor' }
}

const ask: Handler = async (req, res, admin) => {
  const who = await requirePortalUser(req, admin)
  if (!who) { res.status(401).json({ error: 'Please sign in again.' }); return }
  const body = req.body ?? {}
  const text = portalMessageText(body.question)
  if (!text) { res.status(400).json({ error: 'Type your question first.' }); return }
  const a = await clientAccount(admin, who, body.caseNumber)
  if (!a) { res.status(404).json({ error: 'That account is not on your book.' }); return }
  const { owner, tell } = await liaisonFor(admin, who.companyId)
  const topic = portalTopic(body.topic)
  const question = portalQuestion(topic, text)
  const { data: q, error } = await admin.from('account_queries').insert({
    account_id: a.id, kind: 'client', stage: 'liaison', status: 'open', description: question,
    owner_id: owner, raised_by: null, raised_by_name: `${who.name || who.email} (client portal)`,
  }).select('id, ticket_no').single()
  if (error || !q) {
    console.error(`[portal] question not raised on ${a.caseNumber}: ${error?.message}`)
    res.status(500).json({ error: 'Your question could not be sent just now. Try again.' }); return
  }
  /*
   * THE QUESTION IS ALSO THE FIRST MESSAGE ON THE TICKET (S15). Stephan opened the first one in Raptor and
   * could not answer it: a ticket with no mail on it has nothing to press Reply on, and "Email the client"
   * goes to the company's address rather than the person who asked. Filed as what the client wrote, from
   * their own address, Reply goes back to them, threaded -- and what the liaison sends is on the portal,
   * because a portal user's address reads as the client's.
   */
  await fileClientMessage(admin, who, { id: q.id as string, accountId: a.id, ownerId: owner },
    `${topic}: ${a.debtor} (${a.caseNumber})`, text)
  await ring(admin, tell, 'portal.question',
    `${who.clientName} asked about ${a.debtor} (${a.caseNumber}) from the client portal -- ${topic}: ${text.slice(0, 120)}`,
    `/queries/${q.id}`)
  res.status(200).json({ ticketNo: q.ticket_no })
}

/*
 * A PAYMENT MADE TO THE CLIENT (S15). Recorded on the account as an UNAPPROVED payment, paid to client
 * (portal_record_ptc, which holds every rule and the client's book), so it waits in Trust's approval queue
 * with every other receipt; then a ticket says what the client told us, and the liaison's bell rings.
 * The payment first: a ticket about a payment the database refused would be a ticket about nothing.
 */
const paymentReport: Handler = async (req, res, admin) => {
  const who = await requirePortalUser(req, admin)
  if (!who) { res.status(401).json({ error: 'Please sign in again.' }); return }
  const body = req.body ?? {}
  /* Today in South Africa: a payment made this evening is not "in the future" because UTC has not caught up. */
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' })
  const r = portalPaymentReport(body, today)
  if (!r.ok) { res.status(400).json({ error: r.error }); return }
  const a = await clientAccount(admin, who, body.caseNumber)
  if (!a) { res.status(404).json({ error: 'That account is not on your book.' }); return }
  const { error: payErr } = await admin.rpc('portal_record_ptc', {
    p_client: who.companyId, p_account: a.id, p_amount: r.report.amount.toFixed(2), p_received_on: r.report.paidOn,
    p_reference: r.report.reference, p_reported_by: `${who.name || who.email} (${who.email})`, p_note: r.report.note || null,
  })
  /* The database's refusals are written for the client (a duplicate, a closed account, before the handover). */
  if (payErr) {
    const readable = ['22023', '23502', '23505', 'P0002'].includes(payErr.code ?? '')
    if (!readable) console.error(`[portal] payment not recorded on ${a.caseNumber}: ${payErr.message}`)
    res.status(readable ? 400 : 500).json({ error: readable ? payErr.message : 'Your payment could not be recorded just now. Try again.' }); return
  }
  const text = portalPaymentText(r.report)
  const { owner, tell } = await liaisonFor(admin, who.companyId)
  const { data: q } = await admin.from('account_queries').insert({
    account_id: a.id, kind: 'client', stage: 'liaison', status: 'open', description: text,
    owner_id: owner, raised_by: null, raised_by_name: `${who.name || who.email} (client portal)`,
  }).select('id, ticket_no').single()
  if (q) {
    await fileClientMessage(admin, who, { id: q.id as string, accountId: a.id, ownerId: owner },
      `Payment made to us directly: ${a.debtor} (${a.caseNumber})`, text)
  } else {
    await note(admin, a.id, text, 'note', who)
  }
  await ring(admin, tell, 'portal.payment',
    `${who.clientName} recorded a payment made to them directly: ${a.debtor} (${a.caseNumber}) paid ${portalRands(r.report.amount)} on ${r.report.paidOn}. It is waiting for approval in Trust.`,
    q ? `/queries/${q.id}` : `/accounts/${a.id}`)
  res.status(200).json({ ticketNo: q?.ticket_no ?? null })
}

const callback: Handler = async (req, res, admin) => {
  const who = await requirePortalUser(req, admin)
  if (!who) { res.status(401).json({ error: 'Please sign in again.' }); return }
  const body = req.body ?? {}
  const c = portalCallback(body)
  if (!c.ok) { res.status(400).json({ error: c.error }); return }
  /* ABOUT ONE ACCOUNT, OR THE CLIENT IN GENERAL. Named where it is one, so the liaison opens the right file. */
  const a = body.caseNumber ? await clientAccount(admin, who, body.caseNumber) : null
  if (body.caseNumber && !a) { res.status(404).json({ error: 'That account is not on your book.' }); return }
  const { owner, tell } = await liaisonFor(admin, who.companyId)
  const today = new Date().toISOString().slice(0, 10)
  const title = `Call ${who.name || who.email} at ${who.clientName} on ${c.phone} (${c.when})`
    + (a ? ` about ${a.debtor}, ${a.caseNumber}` : '') + (c.about ? ` -- "${c.about}"` : '')
  /* A task must have an owner. With no liaison it goes to the first Administrator told, so it is on a
     list rather than nowhere; every one of them still hears about it. */
  const taskOwner = owner ?? tell[0]
  if (!taskOwner) { res.status(500).json({ error: 'Nobody at the firm could be given your request. Please phone the firm.' }); return }
  /* A TASK, because a callback is a thing to do by a time -- and it sits on the liaison's own list with
     every other call they owe, not in a separate portal inbox somebody has to remember to open. */
  const { error } = await admin.from('tasks').insert({
    title: title.slice(0, 500), type: 'Call', status: 'Not Started', priority: 'High', owner_id: taskOwner,
    due_date: today, company_id: who.companyId, related_to_label: a?.caseNumber ?? who.clientName,
  })
  if (error) {
    console.error(`[portal] callback task not made for ${who.companyId}: ${error.message}`)
    res.status(500).json({ error: 'Your request could not be sent just now. Please phone the firm.' }); return
  }
  if (a) await note(admin, a.id, `The client asked to be called back from the client portal: ${title}`, 'note', who)
  await ring(admin, tell, 'portal.callback', `${who.clientName} asked to be called back: ${title.slice(0, 200)}`, `/companies/${who.companyId}`)
  res.status(200).json({ ok: true })
}

/* ------------------------------------------------------------------ a signed-in client: dashboard and reports (S15) */

/*
 * THE DASHBOARD (S15). Stephan: "something like a dashboard on there ... handed over accounts, collected, then
 * by status, circles" -- then "it's also very slow" and "how many accounts have been paid up ... in progress
 * ... in dispute ... in negotiation". One read (portal_summary: the book grouped in the database), turned into
 * outcomes by portalOutcomes -- clientPosition's rules, the same the Accounts list uses -- and the tickets.
 */
const dashboard: Handler = async (req, res, admin) => {
  const who = await requirePortalUser(req, admin)
  if (!who) { res.status(401).json({ error: 'Please sign in again.' }); return }
  /* Thirteen months of handovers, so the 12-month chart has a whole first month whatever today's date. */
  const from = new Date(); from.setUTCMonth(from.getUTCMonth() - 13)
  const [{ data, error }, { data: t }, { data: days }, { data: paid }, { owner }] = await Promise.all([
    admin.rpc('portal_summary', { p_client: who.companyId }),
    admin.rpc('portal_tickets', { p_client: who.companyId }),
    admin.rpc('portal_handovers_by_day', { p_client: who.companyId, p_from: from.toISOString().slice(0, 10) }),
    /* The tiles' trends (S16, Stephan's mock-up): collected per month, on portal_summary's own filter. */
    admin.rpc('portal_collected_by_month', { p_client: who.companyId, p_from: from.toISOString().slice(0, 10) }),
    liaisonFor(admin, who.companyId),
  ])
  /* WHO TO CALL (S16; Stephan's list: "the liaison's details -- name, number, WhatsApp, email"). Only what
     the firm already gives a client in an email signature; nobody else's. */
  const { data: l } = owner
    ? await admin.from('profiles').select('name, email, phone, whatsapp').eq('id', owner).maybeSingle()
    : { data: null }
  if (error) { res.status(500).json({ error: 'Your dashboard could not be read just now.' }); return }
  const d = data as { totals: Record<string, number>; groups: PortalSummaryGroup[] }
  const tickets = (t ?? []) as { status: string; stage: string }[]
  res.status(200).json({
    accounts: Number(d.totals.accounts) || 0,
    open: Number(d.totals.open) || 0,
    figures: {
      capitalHandedOver: Number(d.totals.capital_handed_over) || 0,
      collectedToDate: Number(d.totals.paid_to_date) || 0,
      collectedThisMonth: Number(d.totals.paid_this_month) || 0,
      capitalOutstanding: Number(d.totals.capital_outstanding) || 0,
    },
    outcomes: portalOutcomes(d.groups),
    tickets: {
      waitingOnYou: tickets.filter((x) => x.status === 'open' && x.stage === 'client').length,
      open: tickets.filter((x) => x.status === 'open').length,
    },
    handoverDays: ((days ?? []) as { day: string; accounts: number; capital: number | string }[])
      .map((r) => ({ day: String(r.day).slice(0, 10), accounts: Number(r.accounts) || 0, capital: Number(r.capital) || 0 })),
    collectedMonths: ((paid ?? []) as { month: string; collected: number | string }[])
      .map((r) => ({ month: String(r.month).slice(0, 7), collected: Number(r.collected) || 0 })),
    liaison: l ? { name: (l.name as string) || '', email: (l.email as string) || null,
      phone: (l.phone as string) || null, whatsapp: (l.whatsapp as string) || null } : null,
  })
}

/*
 * REPORTS (S15). Stephan: "a section where you would see your previous reports". The reports the firm already
 * sends a client are its remittance advices, and every one is kept exactly as it was sent -- the PDF and the
 * spreadsheet as attached (payover_run_sends, which nothing may edit). So this lists THOSE copies, never a
 * statement rebuilt today: a client comparing the portal with the email in their inbox must find the same
 * document. The monthly progress report joins this list when it is built.
 */
const reports: Handler = async (req, res, admin) => {
  const who = await requirePortalUser(req, admin)
  if (!who) { res.status(401).json({ error: 'Please sign in again.' }); return }
  const group = [...(await clientGroup(admin, who.companyId))]
  const { data, error } = await admin.from('payover_run_sends')
    .select('id, version, sent_at, subject, net_payover, pdf_path, xlsx_path, companies(name), payover_runs(period_start, period_end)')
    .in('company_id', group).order('sent_at', { ascending: false }).limit(500)
  if (error) { res.status(500).json({ error: 'Your reports could not be read just now.' }); return }
  res.status(200).json({
    reports: (data ?? []).map((r) => {
      const run = r.payover_runs as unknown as { period_start: string; period_end: string } | null
      const co = r.companies as unknown as { name: string } | null
      return {
        id: r.id as string, kind: 'remittance', version: Number(r.version), sentAt: r.sent_at as string,
        title: r.subject as string, client: co?.name ?? '', amount: Number(r.net_payover),
        periodStart: run?.period_start ?? null, periodEnd: run?.period_end ?? null,
        /* The paths stay on the server; the browser asks for a file by the report's id. */
        hasPdf: !!r.pdf_path, hasSheet: !!r.xlsx_path,
      }
    }),
  })
}

const reportFile: Handler = async (req, res, admin) => {
  const who = await requirePortalUser(req, admin)
  if (!who) { res.status(401).json({ error: 'Please sign in again.' }); return }
  const body = req.body ?? {}
  if (typeof body.id !== 'string' || (body.file !== 'pdf' && body.file !== 'xlsx')) { res.status(400).json({ error: 'Which file?' }); return }
  const { data: r } = await admin.from('payover_run_sends').select('company_id, pdf_path, xlsx_path').eq('id', body.id).maybeSingle()
  /* NOT FOUND AND NOT YOURS ARE ONE ANSWER. */
  if (!r || !(await clientGroup(admin, who.companyId)).has(r.company_id as string)) {
    res.status(404).json({ error: 'There is no such report on your accounts.' }); return
  }
  const path = (body.file === 'pdf' ? r.pdf_path : r.xlsx_path) as string
  /* Two minutes: long enough to open, short enough that a forwarded link is a dead one. The bucket stays private. */
  const { data: link, error } = await admin.storage.from('payover-advice').createSignedUrl(path, 120, {
    download: decodeURIComponent(path.split('/').pop() || 'report'),
  })
  if (error || !link) { res.status(500).json({ error: 'That file could not be opened just now.' }); return }
  res.status(200).json({ url: link.signedUrl })
}

/* ------------------------------------------------------------------ a signed-in client: handing accounts over (S15) */

/*
 * PHASE 2b. Stephan: "go ahead with handover accounts". A client sends a sheet, or one account typed into a
 * form; either is kept exactly as sent (bucket portal-handovers, under the client's id) and waits for the firm
 * on the client's page. NOTHING IS LOADED HERE: somebody who may load this client's accounts opens it in the
 * import -- the same reading, judging and approving every other batch goes through -- or declines it, saying
 * why. See the portal_handovers migration.
 */
const handovers: Handler = async (req, res, admin) => {
  const who = await requirePortalUser(req, admin)
  if (!who) { res.status(401).json({ error: 'Please sign in again.' }); return }
  const { data, error } = await admin.from('client_handover_submissions')
    .select('id, kind, file_name, accounts, pdf_names, status, submitted_by, created_at, decided_at, decline_reason')
    .eq('company_id', who.companyId).order('created_at', { ascending: false }).limit(200)
  if (error) { res.status(500).json({ error: 'Your handovers could not be read just now.' }); return }
  res.status(200).json({
    handovers: (data ?? []).map((h) => ({
      id: h.id, kind: h.kind, fileName: h.file_name, accounts: h.accounts, pdfs: (h.pdf_names as string[] | null)?.length ?? 0,
      status: h.status, submittedBy: h.submitted_by, createdAt: h.created_at, decidedAt: h.decided_at, declineReason: h.decline_reason,
    })),
  })
}

/** Base64 off the wire, refused rather than truncated when it is not what it says. */
function decoded(b64: unknown): Buffer | null {
  if (typeof b64 !== 'string' || !/^[A-Za-z0-9+/=\s]+$/.test(b64)) return null
  const buf = Buffer.from(b64, 'base64')
  return buf.length > 0 ? buf : null
}

const SHEET_TYPE: Record<string, string> = {
  '.csv': 'text/csv', '.zip': 'application/zip',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xlsm': 'application/vnd.ms-excel.sheet.macroEnabled.12',
}

/** Keep what was sent, write the row, ring the liaison. Files first: a row pointing at nothing is worse than none. */
async function receiveHandover(admin: SupabaseClient, who: PortalCaller, h: {
  kind: 'sheet' | 'single'; fileName: string; sheet: Buffer; pdfs: { name: string; bytes: Buffer }[]; accounts: number | null; note: string | null
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const id = crypto.randomUUID()
  const folder = `${who.companyId}/${id}`
  const store = admin.storage.from('portal-handovers')
  const ext = h.fileName.slice(h.fileName.lastIndexOf('.')).toLowerCase()
  const sheetPath = `${folder}/${h.fileName}`
  const up = await store.upload(sheetPath, h.sheet, { contentType: SHEET_TYPE[ext] ?? 'application/octet-stream', upsert: false })
  if (up.error) { console.error(`[portal] handover sheet not kept: ${up.error.message}`); return { ok: false, error: 'Your handover could not be saved just now. Try again.' } }
  const pdfPaths: string[] = []
  for (const p of h.pdfs) {
    const path = `${folder}/pdf/${p.name}`
    const r = await store.upload(path, p.bytes, { contentType: 'application/pdf', upsert: false })
    if (r.error) { console.error(`[portal] handover pdf not kept: ${r.error.message}`); return { ok: false, error: `${p.name} could not be saved. Try again.` } }
    pdfPaths.push(path)
  }
  const { error } = await admin.from('client_handover_submissions').insert({
    id, company_id: who.companyId, portal_user_id: who.userId, submitted_by: who.name || who.email,
    kind: h.kind, file_path: sheetPath, file_name: h.fileName, pdf_paths: pdfPaths, pdf_names: h.pdfs.map((p) => p.name),
    accounts: h.accounts, note: h.note,
  })
  if (error) { console.error(`[portal] handover row not written: ${error.message}`); return { ok: false, error: 'Your handover could not be saved just now. Try again.' } }
  const { tell } = await liaisonFor(admin, who.companyId)
  await ring(admin, tell, 'portal.handover',
    h.kind === 'single'
      ? `${who.clientName} handed over one account from the client portal (${h.fileName.replace(/\.csv$/, '')}). Open it in the import from their page.`
      : `${who.clientName} handed over a sheet from the client portal: ${h.fileName}${h.pdfs.length ? ` and ${h.pdfs.length} PDF${h.pdfs.length === 1 ? '' : 's'}` : ''}. Open it in the import from their page.`,
    `/companies/${who.companyId}`)
  return { ok: true, id }
}

const handoverSheet: Handler = async (req, res, admin) => {
  const who = await requirePortalUser(req, admin)
  if (!who) { res.status(401).json({ error: 'Please sign in again.' }); return }
  const body = req.body ?? {}
  const fileName = portalHandoverSheetName(body.fileName)
  if (!fileName) { res.status(400).json({ error: 'Send the handover sheet as an Excel file (.xlsx) or a CSV.' }); return }
  const sheet = decoded(body.content)
  if (!sheet) { res.status(400).json({ error: 'That file is empty.' }); return }
  const pdfs: { name: string; bytes: Buffer }[] = []
  for (const p of Array.isArray(body.pdfs) ? body.pdfs.slice(0, 200) : []) {
    const name = portalHandoverPdfName(p?.name)
    const bytes = decoded(p?.content)
    if (!name || !bytes) { res.status(400).json({ error: 'Only PDF documents can go with a sheet.' }); return }
    pdfs.push({ name, bytes })
  }
  if (sheet.length + pdfs.reduce((n, p) => n + p.bytes.length, 0) > PORTAL_HANDOVER_MAX_BYTES) {
    res.status(413).json({ error: 'That is too large to send here. Send the sheet on its own, or email the documents to your liaison.' }); return
  }
  /* A CSV's lines, counted as a courtesy; an Excel file is counted by the import, where it is read properly. */
  const accounts = fileName.toLowerCase().endsWith('.csv') ? Math.max(0, sheet.toString('utf8').split(/\r?\n/).filter((l) => l.trim()).length - 1) : null
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 1000) || null : null
  const r = await receiveHandover(admin, who, { kind: 'sheet', fileName, sheet, pdfs, accounts, note })
  if (!r.ok) { res.status(500).json({ error: r.error }); return }
  res.status(200).json({ id: r.id })
}

const handoverSingle: Handler = async (req, res, admin) => {
  const who = await requirePortalUser(req, admin)
  if (!who) { res.status(401).json({ error: 'Please sign in again.' }); return }
  const body = req.body ?? {}
  const single = portalSingleHandover(body.account && typeof body.account === 'object' ? body.account : {})
  if (!single.ok) { res.status(400).json({ error: single.error }); return }
  const fileName = `${single.reference.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 60) || 'account'}.csv`
  const r = await receiveHandover(admin, who, {
    kind: 'single', fileName, sheet: Buffer.from(single.csv, 'utf8'), pdfs: [], accounts: 1, note: null,
  })
  if (!r.ok) { res.status(500).json({ error: r.error }); return }
  res.status(200).json({ id: r.id })
}

/* ------------------------------------------------------------------ staff: who may sign in */

async function requireStaff(req: VercelRequest, res: VercelResponse, admin: SupabaseClient) {
  const caller = await requireCaller(req, admin)
  if (!caller) { res.status(401).json({ error: 'Invalid or expired session.' }); return null }
  const { data: p } = await admin.from('profiles').select('id, name, role, grants, revokes, status').eq('id', caller.id).maybeSingle()
  if (!p || p.status !== 'Active'
      || !can({ role: p.role as never, grants: p.grants ?? undefined, revokes: p.revokes ?? undefined }, 'dispute.write_to_client')) {
    res.status(403).json({ error: 'Only the people who write to clients can give them portal access.' }); return null
  }
  return { id: p.id as string, name: String(p.name ?? '') }
}

const staffList: Handler = async (req, res, admin) => {
  if (!(await requireStaff(req, res, admin))) return
  const companyId = (req.body ?? {}).companyId
  if (typeof companyId !== 'string') { res.status(400).json({ error: 'Which client?' }); return }
  const { data, error } = await admin.from('client_portal_users')
    .select('id, email, name, active, invited_at, last_login_at, invited_by').eq('company_id', companyId).order('invited_at')
  if (error) { res.status(500).json({ error: error.message }); return }
  res.status(200).json({ users: data ?? [] })
}

const staffInvite: Handler = async (req, res, admin) => {
  const staff = await requireStaff(req, res, admin)
  if (!staff) return
  const body = req.body ?? {}
  const email = normalisePortalEmail(body.email)
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : ''
  if (typeof body.companyId !== 'string' || !email) { res.status(400).json({ error: 'Type the contact’s email address.' }); return }
  const { data: co } = await admin.from('companies').select('id, name, parent_company_id').eq('id', body.companyId).maybeSingle()
  if (!co) { res.status(404).json({ error: 'That client could not be found.' }); return }
  /*
   * ON THE MAIN CLIENT ONLY. The book is read as the client AND its sub-accounts (portal_book), so a login
   * on a sub-account would either see nothing or -- read the obvious way -- the whole group. Neither is a
   * choice to make by accident.
   */
  if (co.parent_company_id) { res.status(400).json({ error: 'Invite them on the main client: the portal shows the client and all its sub-accounts together.' }); return }

  const { data: existing } = await admin.from('client_portal_users').select('id, company_id').ilike('email', email).maybeSingle()
  if (existing && existing.company_id !== co.id) {
    res.status(409).json({ error: 'That address can already sign in for another client. One address, one client.' }); return
  }
  const row = existing
    ? await admin.from('client_portal_users').update({ active: true, ...(name ? { name } : {}) }).eq('id', existing.id).select('id').single()
    : await admin.from('client_portal_users').insert({ company_id: co.id, email, name, invited_by: staff.id }).select('id').single()
  if (row.error) { res.status(500).json({ error: row.error.message }); return }

  const host = req.headers['x-forwarded-host'] ?? req.headers.host
  const url = `https://${String(host)}/portal`
  const mail = portalInviteEmail({ name, clientName: co.name as string, url, from: staff.name })
  const sent = await sendAsUser(admin, staff.id, { to: email, subject: mail.subject, bodyHtml: mail.html })
  /* Access is given either way; an invitation that did not go is said, not hidden. */
  res.status(200).json({ id: row.data.id, emailed: sent.ok, emailError: sent.ok ? null : sent.error, url })
}

const staffSetActive: Handler = async (req, res, admin) => {
  if (!(await requireStaff(req, res, admin))) return
  const body = req.body ?? {}
  if (typeof body.id !== 'string' || typeof body.active !== 'boolean') { res.status(400).json({ error: 'Which contact?' }); return }
  const { error } = await admin.from('client_portal_users').update({ active: body.active }).eq('id', body.id)
  if (error) { res.status(500).json({ error: error.message }); return }
  /* Switched off signs them out everywhere now, not in thirty days. */
  if (!body.active) await admin.from('client_portal_sessions').delete().eq('user_id', body.id)
  res.status(200).json({ ok: true })
}

export const PORTAL_ROUTES: Record<string, Handler> = {
  'request-code': requestCode,
  verify,
  'sign-in': signIn,
  'set-password': setPassword,
  me,
  book,
  'sign-out': signOut,
  tickets,
  ticket,
  'ticket-reply': ticketReply,
  ask,
  callback,
  'payment-report': paymentReport,
  dashboard,
  reports,
  'report-file': reportFile,
  handovers,
  'handover-sheet': handoverSheet,
  'handover-single': handoverSingle,
  'staff-list': staffList,
  'staff-invite': staffInvite,
  'staff-set-active': staffSetActive,
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = typeof req.query.action === 'string' ? req.query.action : ''
  /* hasOwnProperty, as in api/email: `?action=constructor` must not find Object.prototype's. */
  const route = Object.prototype.hasOwnProperty.call(PORTAL_ROUTES, action) ? PORTAL_ROUTES[action] : undefined
  if (!route) { res.status(404).json({ error: `Unknown portal route: ${action || '(none)'}` }); return }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }
  const admin = adminClient()
  if (!admin) { res.status(500).json({ error: 'Server is missing Supabase configuration.' }); return }
  const keyProblem = credentialsKeyProblem()
  if (keyProblem) { res.status(500).json({ error: keyProblem }); return }
  await route(req, res, admin)
}
