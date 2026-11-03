import crypto from 'node:crypto'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { SupabaseClient } from '@supabase/supabase-js'
import { adminClient } from './auth.js'
import { credentialsKeyProblem, keyedHash, sameHex } from './crypto.js'
import { sendAsUser } from './email/sendAsUser.js'
import { sendSms } from './sms/connectMobile.js'
import { codeSenderOrder, deviceLabel, normaliseCode, resendDecision } from '../../src/lib/loginCode.js'
import { portalCodeCheck, PORTAL_CODE_MESSAGE } from '../../src/lib/clientPortal.js'
import { computeBalance, type BalanceBreakdown } from '../../src/lib/accountBalance.js'
import { needsApplication, proposalProblem, proposalSummary } from '../../src/lib/debtorArrangement.js'
import { debtorLetterValues, debtorStatement, unfilledFields, type DebtorLetterInput, type DebtorStatementAccount } from '../../src/lib/debtorStatement.js'
import { fillLetter, parseLetter } from '../../src/lib/letterDocument.js'
import { blanksFor, FILLABLE } from '../../src/lib/signingBlanks.js'
import { newToken } from '../../src/lib/signingRules.js'
import { letterToPdf } from '../../src/lib/letterPdf.js'
import { toSettings as toFirmSettings } from '../../src/lib/firmSettingsRow.js'
import { letterheadFor } from './workflow/letterhead.js'
import { charterFor } from './workflow/fonts.js'
import { moneyZa } from './workflow/locale.js'
import { balanceInputFor } from '../../src/lib/balanceInput.js'
import { balanceAccountFromRow, fetchLedgerRows } from '../../src/lib/storedBalance.js'
import {
  DEBTOR_CODE_MINUTES, DEBTOR_CODE_SENT, DEBTOR_SESSION_DAYS, DEBTOR_TOKEN_HEADER, codeDestination, debtorCodeEmail,
  debtorCodeSms, debtorPayments, debtorSummary, normaliseCaseNumber, type ContactRow,
  DEBTOR_POP_MAX_BYTES, debtorPopClaim, debtorPopFile, debtorPopNote, debtorDispute, debtorQuestion, type DebtorTicket,
} from '../../src/lib/debtorPortal.js'
import { sweep } from './workflow/run.js'

/**
 * /api/debtor/<action> -- THE DEBTOR PORTAL'S SERVER (Raptor H16). See src/lib/debtorPortal.ts.
 *
 * EVERY READ IS THE SERVICE ROLE, FILTERED BY THE SESSION'S ACCOUNT. The browser names nothing: not an account,
 * not a client. The account comes off the session row, so a debtor who edits a request can only ask about their
 * own debt. The tables behind it have RLS on and no policies, so this is the only door.
 *
 *   anonymous   request-code, verify       (the code, sent to a contact the firm holds, is the authority)
 *   debtor      account, statement, proof-of-payment, propose, dispute, ask, sign-out   (x-debtor-token)
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

/** THE ONE PLACE THE PORTAL WORKS OUT A BALANCE -- computeBalance over the account page's ledgers. */
async function balanceOf(admin: SupabaseClient, accountRow: Record<string, unknown>, accountId: string, today: string): Promise<BalanceBreakdown> {
  const ledgers = await fetchLedgerRows(admin, [accountId])
  return computeBalance(balanceInputFor({ account: balanceAccountFromRow(accountRow), ledgers: ledgers.get(accountId)!, today }))
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
    const bytes = await letterToPdf({ doc, page: paper.page, filled: true, values, letterhead: paper.image, charter: await charterFor() })
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
 * NO ITEM 3. raiseQuery charges a dispute a collector raises; this one nobody at the firm has looked at yet, and a fee
 * raised with no person in the loop is the firm's decision to make, not this code's (asked in HANDOFF).
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
