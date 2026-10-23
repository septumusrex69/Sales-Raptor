import type { VercelRequest, VercelResponse } from '@vercel/node'
import { adminClient, requireCaller } from '../auth.js'
import { credentialsKeyProblem } from '../crypto.js'
import { sendAsUser } from './sendAsUser.js'
import { welcomeEmail } from '../../../src/lib/welcomeEmail.js'

/**
 * SEND A NEW CLIENT'S WELCOME EMAIL -- WHEN THE LIAISON PRESSES SEND (23 Oct; S8 before it).
 *
 * The firm (S8): "it sends an automatic email to the client like, hi, my name is Bonita ... welcome
 * to Bredell Ferreira". It used to go the moment Sales assigned the liaison, and on 23 Oct that went
 * wrong in the way an automatic send goes wrong: it went in Nicole's name without her, and when she
 * was told to send it she believed it had not gone. Now (the firm): "it becomes a task that they have
 * to send a welcome letter". ASSIGNING sends nothing (assignLiaison.ts makes the task); this route is
 * the press on the client's Welcome card, and does:
 *   1. the welcome email, FROM THE LIAISON'S MAILBOX; if hers is not connected, from the mailbox of
 *      whoever pressed, the body still introducing her -- the sending exactly as it always was;
 *   2. welcome_sent_at AND welcome_sent_by (the person who pressed), so the card can say "sent on
 *      <date> by <name>" and nobody sends it twice believing it is still to do;
 *   3. her "Send welcome email" task completed;
 *   4. the email written into the client's notes.
 * NEVER TWICE BY ACCIDENT: once sent, it refuses (409) unless the body says `again: true`, which the
 * card only sends behind a confirm.
 * May press: the client's liaison, a Liaison Manager, or an Administrator.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }
  const admin = adminClient()
  if (!admin) { res.status(500).json({ error: 'Server is missing Supabase configuration.' }); return }
  const keyProblem = credentialsKeyProblem()
  if (keyProblem) { res.status(500).json({ error: keyProblem }); return }
  const caller = await requireCaller(req, admin)
  if (!caller) { res.status(401).json({ error: 'Invalid or expired session.' }); return }

  const { companyId, again } = (req.body ?? {}) as { companyId?: string; again?: boolean }
  if (!companyId) { res.status(400).json({ error: 'Which client?' }); return }

  const [{ data: me }, { data: company }, { data: clock }] = await Promise.all([
    admin.from('profiles').select('id, name, role').eq('id', caller.id).maybeSingle(),
    admin.from('companies').select('id, name, email, contact_person, account_owner_id, liaison_needed, welcome_sent_at').eq('id', companyId).maybeSingle(),
    admin.rpc('raptor_clock'),
  ])
  if (!company) { res.status(404).json({ error: 'That client was not found.' }); return }
  /* The welcome is from the client's liaison: whoever the client is assigned to. */
  const liaisonId = String(company.account_owner_id ?? '')
  const { data: liaison } = await admin.from('profiles').select('id, name, role, email, phone, whatsapp, status').eq('id', liaisonId).maybeSingle()
  if (company.liaison_needed || !liaison || !(liaison.role === 'Liaison' || liaison.role === 'Liaison Manager')) {
    res.status(400).json({ error: 'Assign the client a liaison first: the welcome is from her.' }); return
  }
  const role = String(me?.role ?? '')
  if (!(caller.id === liaisonId || role === 'Administrator' || role === 'Liaison Manager')) {
    res.status(403).json({ error: 'The welcome is the liaison’s to send (or a Liaison Manager’s, or an Administrator’s).' }); return
  }
  if (company.welcome_sent_at && again !== true) {
    res.status(409).json({ error: 'The welcome email has already been sent to this client.', sentAt: company.welcome_sent_at }); return
  }

  /* The firm's clock, so staging dates the task and the notes on the staging day. */
  const row = (Array.isArray(clock) ? clock[0] : clock) as { business_now?: string; business_today?: string } | null
  const nowIso = row?.business_now ?? new Date().toISOString()

  /* The person at the client to write to: the mandate's first contact, else the client's own address. */
  const { data: contact } = await admin.from('contacts').select('first_name, last_name, email')
    .eq('company_id', companyId).not('email', 'is', null).order('created_at', { ascending: true }).limit(1).maybeSingle()
  const to = (company.email as string | null) || (contact?.email as string | null) || null
  const contactName = contact ? `${contact.first_name ?? ''} ${contact.last_name && contact.last_name !== '—' ? contact.last_name : ''}`.trim()
    : ((company.contact_person as string | null) ?? null)

  /* 1. The welcome, from her mailbox; the presser's if hers is not connected. */
  const host = req.headers['x-forwarded-host'] ?? req.headers.host
  const origin = host ? `https://${Array.isArray(host) ? host[0] : host}` : 'https://sales-raptor.vercel.app'
  const mail = welcomeEmail({
    clientName: String(company.name), contactName: contactName || null,
    liaison: { name: String(liaison.name), email: (liaison.email as string | null) ?? null, phone: (liaison.phone as string | null) ?? null, whatsapp: (liaison.whatsapp as string | null) ?? null },
    closerName: liaisonId === caller.id ? null : String(me?.name ?? '') || null,
    bannerUrl: `${origin}/brand/email/welcome.jpg`,
  })
  let sent: { ok: boolean; from?: string; error?: string } = { ok: false, error: 'The client has no email address.' }
  let sentBy: string | null = null
  if (to) {
    const cc = liaisonId === caller.id ? null : ((await admin.from('profiles').select('email').eq('id', caller.id).maybeSingle()).data?.email as string | null) ?? null
    const asLiaison = await sendAsUser(admin, liaisonId, { to, cc, subject: mail.subject, bodyHtml: mail.html })
    if (asLiaison.ok) { sent = asLiaison; sentBy = liaisonId }
    else {
      const asCaller = await sendAsUser(admin, caller.id, { to, cc: (liaison.email as string | null) ?? null, subject: mail.subject, bodyHtml: mail.html })
      sent = asCaller.ok ? asCaller : { ok: false, error: asLiaison.error }
      sentBy = asCaller.ok ? caller.id : null
    }
  }
  if (!sent.ok) {
    res.status(200).json({ sent: false, error: sent.error ?? 'The welcome email could not go.' }); return
  }

  /* 2. Sent, and by whom: the person who pressed. */
  await admin.from('companies').update({ welcome_sent_at: nowIso, welcome_sent_by: caller.id }).eq('id', companyId)

  /* 3. Her "Send welcome email" task is done -- whoever pressed, it was the task. */
  await admin.from('tasks').update({ status: 'Completed', completed_at: nowIso })
    .eq('company_id', companyId).like('title', 'Send welcome email:%').in('status', ['Not Started', 'In Progress'])

  /* 4. The client's notes: the email itself, under the mailbox it went from. */
  await admin.from('activities').insert({ type: 'Email', user_id: sentBy ?? caller.id, company_id: companyId, activity_date: nowIso,
    subject: mail.subject, notes: `Sent by ${me?.name ?? 'the liaison'}${again ? ' (again)' : ''}.\n\n${mail.text}` })

  res.status(200).json({ sent: true, from: sent.from ?? null, fromLiaison: sentBy === liaisonId, sentAt: nowIso, sentBy: caller.id })
}
