import crypto from 'node:crypto'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { SupabaseClient } from '@supabase/supabase-js'
import { adminClient, requireCaller } from './auth.js'
import { credentialsKeyProblem, keyedHash, sameHex } from './crypto.js'
import { sendAsUser } from './email/sendAsUser.js'
import { can } from '../../src/lib/capabilities.js'
import { codeSenderOrder, deviceLabel, normaliseCode, resendDecision } from '../../src/lib/loginCode.js'
import {
  CODE_SENT_MESSAGE, PORTAL_CODE_MESSAGE, PORTAL_CODE_MINUTES, PORTAL_SESSION_DAYS, PORTAL_TOKEN_HEADER,
  isPortalToken, normalisePortalEmail, portalCallback, portalCodeCheck, portalCodeEmail, portalInviteEmail, portalLine,
  portalMessageText, portalTicketNo, type PortalBookRow,
} from '../../src/lib/clientPortal.js'

/**
 * /api/portal/<action> -- THE CLIENT PORTAL'S SERVER (S14, Raptor H13). See src/lib/clientPortal.ts.
 *
 * EVERY READ IS THE SERVICE ROLE, FILTERED BY THE SESSION'S CLIENT. The browser names nothing it may
 * read: not a company, not an account. The client comes off the session row, so a client who edits a
 * request can only change what they search for inside their own book.
 *
 * Two kinds of caller, never mixed:
 *   anonymous    request-code, verify               (the code is the authority)
 *   portal user  me, book, sign-out,                (x-portal-token)
 *                tickets, ticket, ticket-reply, ask, callback
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
  if (!user || !user.active) { res.status(200).json({ message: CODE_SENT_MESSAGE }); return }

  const t = now()
  const { data: last } = await admin.from('client_portal_codes')
    .select('sent_at, window_started_at, sends_in_window').eq('user_id', user.id).maybeSingle()
  const decision = resendDecision(last ? {
    sentAt: last.sent_at as string, windowStartedAt: last.window_started_at as string,
    sendsInWindow: Number(last.sends_in_window ?? 0),
  } : null, t)
  if (!decision.ok) { res.status(429).json({ error: decision.reason, waitSeconds: decision.waitSeconds }); return }

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
  const { error: saveErr } = await admin.from('client_portal_codes').upsert({
    user_id: user.id, code_hash: keyedHash('portal-code', `${user.id}:${code}`),
    expires_at: new Date(t + PORTAL_CODE_MINUTES * 60_000).toISOString(), attempts: 0,
    sent_at: new Date(t).toISOString(), window_started_at: decision.windowStartedAt, sends_in_window: decision.sendsInWindow,
  }, { onConflict: 'user_id' })
  if (saveErr) { res.status(500).json({ error: 'The code could not be made just now. Try again in a minute.' }); return }

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
  const mail = portalCodeEmail({ name: String(user.name ?? ''), code })
  let sent = false
  let lastError = 'Nobody at the firm has a mailbox connected to send it from.'
  for (const senderId of order) {
    const r = await sendAsUser(admin, senderId, { to: user.email as string, subject: mail.subject, bodyHtml: mail.html })
    if (r.ok) { sent = true; break }
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
  const { data: user } = await admin.from('client_portal_users').select('id, active').ilike('email', email).maybeSingle()
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
  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(t + PORTAL_SESSION_DAYS * 86_400_000).toISOString()
  const { error } = await admin.from('client_portal_sessions').insert({
    user_id: user!.id, token_hash: keyedHash('portal-session', token), expires_at: expiresAt,
    device: deviceLabel(req.headers['user-agent'] as string | undefined),
  })
  if (error) { res.status(500).json({ error: 'You could not be signed in just now. Try again.' }); return }
  await admin.from('client_portal_users').update({ last_login_at: new Date(t).toISOString() }).eq('id', user!.id)
  res.status(200).json({ token, expiresAt })
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
  return !error
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
  const { data: q, error } = await admin.from('account_queries').insert({
    account_id: a.id, kind: 'client', stage: 'liaison', status: 'open', description: text,
    owner_id: owner, raised_by: null, raised_by_name: `${who.name || who.email} (client portal)`,
  }).select('id, ticket_no').single()
  if (error || !q) {
    console.error(`[portal] question not raised on ${a.caseNumber}: ${error?.message}`)
    res.status(500).json({ error: 'Your question could not be sent just now. Try again.' }); return
  }
  await ring(admin, tell, 'portal.question',
    `${who.clientName} asked about ${a.debtor} (${a.caseNumber}) from the client portal: ${text.slice(0, 140)}`,
    `/queries/${q.id}`)
  res.status(200).json({ ticketNo: q.ticket_no })
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
  await ring(admin, tell, 'portal.callback', `${who.clientName} asked to be called back: ${title.slice(0, 200)}`, `/companies/${who.companyId}`)
  res.status(200).json({ ok: true })
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
  me,
  book,
  'sign-out': signOut,
  tickets,
  ticket,
  'ticket-reply': ticketReply,
  ask,
  callback,
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
