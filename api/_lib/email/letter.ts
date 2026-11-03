import type { VercelRequest, VercelResponse } from '@vercel/node'
import { adminClient, requireCaller } from '../auth.js'
import { credentialsKeyProblem } from '../crypto.js'
import { sendAsUser } from './sendAsUser.js'
import { callerFor, centralSender, withMailbox } from '../campaign/gather.js'
import { can } from '../../../src/lib/capabilities.js'

/**
 * /api/email/letter -- A LETTER OF DEMAND, FROM THE MAILBOX SOMEBODY CHOSE (Raptor · Handover 16, Ryno, 3 Nov).
 *
 *   { step: 'senders', accountId? }    which mailboxes this person may send it from, with their addresses
 *   { step: 'send', from, accountId?, to, subject, bodyHtml, attachments }
 *
 * Ryno: "we need to be able to be controlled from which email address do we send it." Three answers, the same three
 * a debtor campaign has (api/_lib/campaign): MY OWN mailbox; the mailbox of whoever holds the ACCOUNT ('owner'); or
 * the firm's CENTRAL mailbox, legal@ (firm_mailboxes). Raptor sends only as a login whose mailbox it holds
 * (sendAsUser), so each is a login. Sending in SOMEBODY ELSE'S name is what campaign.run already allows and nothing
 * else does, so the other two need it; your own mailbox needs nothing more than /api/email/send does.
 *
 * NOT CHARGED OR FILED HERE. The browser records the sent message through recordSentEmail -- the account page's
 * own path: item 1(a), account_emails, the timeline note -- so a letter of demand is billed and filed exactly as
 * every other email to a debtor is, by the one function that does it. A second, subtly different way to bill an
 * email is how two systems come to disagree (MailPage says the same).
 */
type From = 'me' | 'owner' | 'central'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }
  const admin = adminClient()
  if (!admin) { res.status(500).json({ error: 'Server is missing Supabase configuration.' }); return }
  const keyProblem = credentialsKeyProblem()
  if (keyProblem) { res.status(500).json({ error: keyProblem }); return }
  const user = await requireCaller(req, admin)
  if (!user) { res.status(401).json({ error: 'Invalid or expired session.' }); return }
  const caller = await callerFor(admin, user.id)
  if (!caller) { res.status(403).json({ error: 'Your profile was not found.' }); return }

  const body = (req.body ?? {}) as {
    step?: string; from?: string; accountId?: string; to?: string; subject?: string; bodyHtml?: string
    attachments?: { filename?: string; contentType?: string; content?: string }[]
  }
  const accountId = typeof body.accountId === 'string' && /^[0-9a-f-]{36}$/.test(body.accountId) ? body.accountId : null
  const mayOthers = can(caller, 'campaign.run')

  /* Who holds the account, where there is one: that desk's mailbox is the 'owner' choice. */
  let ownerId: string | null = null
  let ownerName: string | null = null
  if (accountId) {
    const { data } = await admin.from('debtor_accounts').select('assigned_to, profiles!debtor_accounts_assigned_to_fkey(name)').eq('id', accountId).maybeSingle()
    ownerId = (data?.assigned_to as string | null) ?? null
    const p = data ? ((Array.isArray(data.profiles) ? data.profiles[0] : data.profiles) as { name?: string } | null) : null
    ownerName = p?.name ?? null
  }
  const central = mayOthers ? await centralSender(admin) : null
  const mailboxes = await withMailbox(admin, [user.id, mayOthers ? ownerId : null, central?.id ?? null])

  if (body.step === 'senders') {
    const out: { from: From; label: string; address: string | null; ready: boolean; why: string | null }[] = [
      { from: 'me', label: 'My mailbox', address: mailboxes.get(user.id) ?? null, ready: mailboxes.has(user.id),
        why: mailboxes.has(user.id) ? null : 'Connect your mailbox in Settings first.' },
    ]
    if (mayOthers && ownerId && ownerId !== user.id) {
      out.push({ from: 'owner', label: `${ownerName ?? 'The collector'} (holds the account)`, address: mailboxes.get(ownerId) ?? null,
        ready: mailboxes.has(ownerId), why: mailboxes.has(ownerId) ? null : 'Their mailbox is not connected.' })
    }
    if (mayOthers) {
      out.push({ from: 'central', label: central ? `The firm’s mailbox (${central.name})` : 'The firm’s mailbox', address: central ? mailboxes.get(central.id) ?? null : null,
        ready: !!central && mailboxes.has(central.id), why: !central ? 'No central mailbox is set (Settings → Integrations).' : mailboxes.has(central.id) ? null : 'Its mailbox is not connected.' })
    }
    res.status(200).json({ senders: out })
    return
  }

  if (body.step !== 'send') { res.status(400).json({ error: 'Unknown step.' }); return }
  const from: From = body.from === 'owner' || body.from === 'central' ? body.from : 'me'
  if (from !== 'me' && !mayOthers) { res.status(403).json({ error: 'Sending in somebody else’s name needs the “Run a campaign to debtors” permission.' }); return }
  const senderId = from === 'me' ? user.id : from === 'owner' ? ownerId : central?.id ?? null
  if (!senderId) { res.status(400).json({ error: from === 'owner' ? 'Nobody holds this account.' : 'No central mailbox is set.' }); return }
  if (!mailboxes.has(senderId)) { res.status(400).json({ error: 'That mailbox is not connected, so nothing can be sent from it.' }); return }

  const to = (body.to ?? '').trim()
  if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(to)) { res.status(400).json({ error: 'Type one email address to send it to.' }); return }
  if (!body.subject?.trim() || !body.bodyHtml?.trim()) { res.status(400).json({ error: 'The email needs a subject and a message.' }); return }
  const files = (body.attachments ?? []).filter((f) => f?.filename && f?.content).map((f) => ({
    filename: String(f.filename), content: Buffer.from(String(f.content), 'base64'), contentType: f.contentType || 'application/pdf',
  }))
  if (!files.length) { res.status(400).json({ error: 'The letter is not attached.' }); return }
  if (files.reduce((n, f) => n + f.content.length, 0) > 4 * 1024 * 1024) { res.status(400).json({ error: 'The letter is too large to send.' }); return }

  const result = await sendAsUser(admin, senderId, { to, subject: body.subject.trim(), bodyHtml: body.bodyHtml, attachments: files })
  if (!result.ok) { res.status(400).json({ error: result.error }); return }
  res.status(200).json({ ok: true, messageId: result.messageId, from: result.from })
}
