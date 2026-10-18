import type { VercelRequest, VercelResponse } from '@vercel/node'
import { adminClient, requireCaller } from '../auth.js'
import { credentialsKeyProblem } from '../crypto.js'
import { sendAsUser } from './sendAsUser.js'
import { welcomeEmail } from '../../../src/lib/welcomeEmail.js'

/**
 * ASSIGN A NEW CLIENT'S LIAISON, AND WELCOME THE CLIENT (S8, 18 Oct).
 *
 * The firm: "once ... the mandate has been signed ... it should show up in the salesperson's dashboard
 * and it should be allocated to a liaison. And then after that, it sends an automatic email to the
 * client like, hi, my name is Bonita ... And then it should inform somehow the liaison that it should
 * call this person ... a pop-up or notification ... and also in their to-do list."
 *
 * One press, five things, in this order:
 *   1. the client is the liaison's (account_owner_id), and no longer waiting for one;
 *   2. the welcome email goes FROM THE LIAISON'S MAILBOX, copied to the closer. If her mailbox is not
 *      connected it goes from the closer's instead -- the body still introduces her and gives her
 *      numbers -- because a welcome held up by a mailbox setting is the first impression gone;
 *   3. a "Welcome call" task on her list, due the next working day;
 *   4. a notification that pops up for her (client.assigned, see newWork.ts);
 *   5. both written into the client's notes.
 * The assignment is done with the service key AFTER checking the caller may make it: Sales,
 * an Administrator, or a Liaison Manager. The liaison must be a liaison.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }
  const admin = adminClient()
  if (!admin) { res.status(500).json({ error: 'Server is missing Supabase configuration.' }); return }
  const keyProblem = credentialsKeyProblem()
  if (keyProblem) { res.status(500).json({ error: keyProblem }); return }
  const caller = await requireCaller(req, admin)
  if (!caller) { res.status(401).json({ error: 'Invalid or expired session.' }); return }

  const { companyId, liaisonId } = (req.body ?? {}) as { companyId?: string; liaisonId?: string }
  if (!companyId || !liaisonId) { res.status(400).json({ error: 'Choose the client and the liaison.' }); return }

  const [{ data: me }, { data: liaison }, { data: company }, { data: clock }] = await Promise.all([
    admin.from('profiles').select('id, name, role').eq('id', caller.id).maybeSingle(),
    admin.from('profiles').select('id, name, role, email, phone, whatsapp, status').eq('id', liaisonId).maybeSingle(),
    admin.from('companies').select('id, name, email, contact_person, account_owner_id, liaison_needed').eq('id', companyId).maybeSingle(),
    admin.rpc('raptor_clock'),
  ])
  const role = String(me?.role ?? '')
  if (!(role === 'Administrator' || role.includes('Sales') || role === 'Liaison Manager')) {
    res.status(403).json({ error: 'Only Sales, a Liaison Manager or an Administrator assigns a new client’s liaison.' }); return
  }
  if (!liaison || !(liaison.role === 'Liaison' || liaison.role === 'Liaison Manager')) {
    res.status(400).json({ error: 'Choose a liaison: only a Liaison or Liaison Manager looks after a client.' }); return
  }
  if (!company) { res.status(404).json({ error: 'That client was not found.' }); return }

  /* The firm's clock, so staging dates the task and the notes on the staging day. */
  const row = (Array.isArray(clock) ? clock[0] : clock) as { business_now?: string; business_today?: string } | null
  const nowIso = row?.business_now ?? new Date().toISOString()
  const today = row?.business_today ?? nowIso.slice(0, 10)

  /* The person at the client to write to: the mandate's first contact, else the client's own address. */
  const { data: contact } = await admin.from('contacts').select('first_name, last_name, email')
    .eq('company_id', companyId).not('email', 'is', null).order('created_at', { ascending: true }).limit(1).maybeSingle()
  const to = (company.email as string | null) || (contact?.email as string | null) || null
  const contactName = contact ? `${contact.first_name ?? ''} ${contact.last_name && contact.last_name !== '—' ? contact.last_name : ''}`.trim()
    : ((company.contact_person as string | null) ?? null)

  /* 1. The client is hers. */
  const { error: upErr } = await admin.from('companies')
    .update({ account_owner_id: liaisonId, liaison_needed: false, liaison_assigned_at: nowIso }).eq('id', companyId)
  if (upErr) { res.status(500).json({ error: upErr.message }); return }

  /* 2. The welcome, from her mailbox; the closer's if hers is not connected. */
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
  if (sent.ok) await admin.from('companies').update({ welcome_sent_at: nowIso }).eq('id', companyId)

  /* 3. The welcome call, on her list, the next working day. */
  const [y, m, d] = today.split('-').map(Number)
  const due = new Date(Date.UTC(y, m - 1, d + 1, 7, 0))
  while (due.getUTCDay() === 0 || due.getUTCDay() === 6) due.setUTCDate(due.getUTCDate() + 1)
  await admin.from('tasks').insert({
    title: `Welcome call: ${company.name}`, type: 'Call', status: 'Not Started', priority: 'High',
    owner_id: liaisonId, due_date: due.toISOString(), company_id: companyId, related_to_label: String(company.name),
  })

  /* 4. Her pop-up and bell. */
  await admin.from('notifications').insert({
    user_id: liaisonId, type: 'client.assigned', link: `/companies/${companyId}`,
    message: `New client: ${company.name}. ${sent.ok ? 'Your welcome email has gone to them' : 'The welcome email could not go'} — call to introduce yourself.`,
  })

  /* 5. The client's notes. */
  await admin.from('activities').insert([
    { type: 'Deal update', user_id: caller.id, company_id: companyId, activity_date: nowIso,
      subject: `Liaison assigned: ${liaison.name}`, notes: `Assigned by ${me?.name ?? 'Sales'}. Welcome call task set for ${due.toISOString().slice(0, 10)}.` },
    ...(sent.ok ? [{ type: 'Email', user_id: sentBy ?? caller.id, company_id: companyId, activity_date: nowIso,
      subject: mail.subject, notes: mail.text }] : []),
  ])

  res.status(200).json({ assigned: true, sent: sent.ok, from: sent.ok ? sent.from : null, error: sent.ok ? null : sent.error, fromLiaison: sentBy === liaisonId })
}
