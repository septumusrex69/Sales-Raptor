import type { VercelRequest, VercelResponse } from '@vercel/node'
import { adminClient, requireCaller } from '../auth.js'

/**
 * ASSIGN A NEW CLIENT'S LIAISON -- AND SEND NOTHING (23 Oct).
 *
 * Until today this was the first half of the welcome route, and the same press SENT the welcome
 * email from the liaison's mailbox. What that did: Camille converted Dr Alianna Labuschagne and
 * assigned Nicole; the welcome went in Nicole's name at 11:55:58 without Nicole pressing anything;
 * Nicole was later told to send the welcome and believed it had not gone. The firm: "a client is
 * created and assigned to a client liaison. The client liaison gets a notification and it becomes a
 * task that they have to send a welcome letter and that they have to do an introductory call."
 *
 * So one press, four things, and no email:
 *   1. the client is the liaison's (account_owner_id), and no longer waiting for one;
 *   2. TWO tasks on her list, due the next working day: "Send welcome email: <client>" and
 *      "Welcome call: <client>". The first is completed by the welcome route when she sends it;
 *   3. a notification that pops up for her (client.assigned, see newWork.ts);
 *   4. the assignment written into the client's notes.
 *
 * THE SAME WHEN THE PERSON ASSIGNING IS THE LIAISON. A liaison manager giving a client to herself
 * still gets the two tasks and sends from the card: one rule, so nobody has to remember which press
 * sends and which does not. Nothing in the old route made that case special except the cc.
 *
 * Done with the service key AFTER checking the caller may make it: Sales, an Administrator, or a
 * Liaison Manager. The liaison must be a liaison.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }
  const admin = adminClient()
  if (!admin) { res.status(500).json({ error: 'Server is missing Supabase configuration.' }); return }
  const caller = await requireCaller(req, admin)
  if (!caller) { res.status(401).json({ error: 'Invalid or expired session.' }); return }

  const { companyId, liaisonId } = (req.body ?? {}) as { companyId?: string; liaisonId?: string }
  if (!companyId || !liaisonId) { res.status(400).json({ error: 'Choose the client and the liaison.' }); return }

  const [{ data: me }, { data: liaison }, { data: company }, { data: clock }] = await Promise.all([
    admin.from('profiles').select('id, name, role').eq('id', caller.id).maybeSingle(),
    admin.from('profiles').select('id, name, role, status').eq('id', liaisonId).maybeSingle(),
    admin.from('companies').select('id, name').eq('id', companyId).maybeSingle(),
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

  /* The firm's clock, so staging dates the tasks and the notes on the staging day. */
  const row = (Array.isArray(clock) ? clock[0] : clock) as { business_now?: string; business_today?: string } | null
  const nowIso = row?.business_now ?? new Date().toISOString()
  const today = row?.business_today ?? nowIso.slice(0, 10)

  /* 1. The client is hers. */
  const { error: upErr } = await admin.from('companies')
    .update({ account_owner_id: liaisonId, liaison_needed: false, liaison_assigned_at: nowIso }).eq('id', companyId)
  if (upErr) { res.status(500).json({ error: upErr.message }); return }

  /* 2. Her two tasks, the next working day. */
  const [y, m, d] = today.split('-').map(Number)
  const due = new Date(Date.UTC(y, m - 1, d + 1, 7, 0))
  while (due.getUTCDay() === 0 || due.getUTCDay() === 6) due.setUTCDate(due.getUTCDate() + 1)
  const task = { status: 'Not Started', priority: 'High', owner_id: liaisonId, due_date: due.toISOString(),
    company_id: companyId, related_to_label: String(company.name) }
  const { error: taskErr } = await admin.from('tasks').insert([
    { ...task, title: `Send welcome email: ${company.name}`, type: 'Email' },
    { ...task, title: `Welcome call: ${company.name}`, type: 'Call' },
  ])

  /* 3. Her pop-up and bell. */
  await admin.from('notifications').insert({
    user_id: liaisonId, type: 'client.assigned', link: `/companies/${companyId}`,
    message: `New client: ${company.name}. Send them your welcome email from the client's page, and call to introduce yourself.`,
  })

  /* 4. The client's notes. */
  await admin.from('activities').insert({
    type: 'Deal update', user_id: caller.id, company_id: companyId, activity_date: nowIso,
    subject: `Liaison assigned: ${liaison.name}`,
    notes: `Assigned by ${me?.name ?? 'Sales'}. Tasks set for ${due.toISOString().slice(0, 10)}: send the welcome email, and the welcome call.`,
  })

  res.status(200).json({ assigned: true, tasks: !taskErr, error: taskErr ? taskErr.message : null })
}
