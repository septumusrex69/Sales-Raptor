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

  /*
   * ONE CLIENT OR MANY (S11). THE FIRM, of the Swordfish clients that arrive needing a liaison: "you
   * should be able to do something with them in bulk ... assign them in bulk". `companyIds` is the
   * bulk form; each client is done exactly as one would be, and she gets ONE notification for the
   * lot rather than one per client -- forty bells for one decision is the warning people clear
   * without reading.
   */
  const { companyId, companyIds, liaisonId } = (req.body ?? {}) as { companyId?: string; companyIds?: string[]; liaisonId?: string }
  const ids = [...new Set(Array.isArray(companyIds) ? companyIds.map(String) : companyId ? [companyId] : [])].slice(0, 500)
  if (ids.length === 0 || !liaisonId) { res.status(400).json({ error: 'Choose the client and the liaison.' }); return }

  const [{ data: me }, { data: liaison }, { data: companies }, { data: clock }] = await Promise.all([
    admin.from('profiles').select('id, name, role').eq('id', caller.id).maybeSingle(),
    admin.from('profiles').select('id, name, role, status').eq('id', liaisonId).maybeSingle(),
    admin.from('companies').select('id, name, import_batch_id').in('id', ids),
    admin.rpc('raptor_clock'),
  ])
  const role = String(me?.role ?? '')
  if (!(role === 'Administrator' || role.includes('Sales') || role === 'Liaison Manager')) {
    res.status(403).json({ error: 'Only Sales, a Liaison Manager or an Administrator assigns a new client’s liaison.' }); return
  }
  if (!liaison || !(liaison.role === 'Liaison' || liaison.role === 'Liaison Manager')) {
    res.status(400).json({ error: 'Choose a liaison: only a Liaison or Liaison Manager looks after a client.' }); return
  }
  if (!companies?.length) { res.status(404).json({ error: 'That client was not found.' }); return }

  /* The firm's clock, so staging dates the tasks and the notes on the staging day. */
  const row = (Array.isArray(clock) ? clock[0] : clock) as { business_now?: string; business_today?: string } | null
  const nowIso = row?.business_now ?? new Date().toISOString()
  const today = row?.business_today ?? nowIso.slice(0, 10)
  const [y, m, d] = today.split('-').map(Number)
  const due = new Date(Date.UTC(y, m - 1, d + 1, 7, 0))
  while (due.getUTCDay() === 0 || due.getUTCDay() === 6) due.setUTCDate(due.getUTCDate() + 1)

  const problems: string[] = []
  let assigned = 0
  let newClients = 0
  for (const company of companies) {
    /* 1. The client is hers -- and, being looked after, no longer dormant. */
    const { error: upErr } = await admin.from('companies')
      .update({ account_owner_id: liaisonId, liaison_needed: false, liaison_assigned_at: nowIso,
        dormant_at: null, dormant_reason: null, dormant_by: null }).eq('id', company.id)
    if (upErr) { problems.push(`${company.name}: ${upErr.message}`); continue }
    assigned += 1

    /*
     * A CLIENT FROM SWORDFISH IS NOT NEW (S11), so no welcome. THE FIRM: "it already has a liaison.
     * They already have received a welcome letter." One the register gave no liaison on staff
     * arrives "Needs a liaison"; assigning it gives her the client and the notification, no tasks.
     */
    const imported = !!company.import_batch_id

    /* 2. Her two tasks, the next working day -- a new client only. */
    if (!imported) {
      newClients += 1
      const task = { status: 'Not Started', priority: 'High', owner_id: liaisonId, due_date: due.toISOString(),
        company_id: company.id, related_to_label: String(company.name) }
      const { error: taskErr } = await admin.from('tasks').insert([
        { ...task, title: `Send welcome email: ${company.name}`, type: 'Email' },
        { ...task, title: `Welcome call: ${company.name}`, type: 'Call' },
      ])
      if (taskErr) problems.push(`${company.name}: the welcome tasks were not made (${taskErr.message})`)
    }

    /* 4. The client's notes. */
    await admin.from('activities').insert({
      type: 'Deal update', user_id: caller.id, company_id: company.id, activity_date: nowIso,
      subject: `Liaison assigned: ${liaison.name}`,
      notes: imported
        ? `Assigned by ${me?.name ?? 'Sales'}. An existing client from Swordfish: no welcome email or welcome call.`
        : `Assigned by ${me?.name ?? 'Sales'}. Tasks set for ${due.toISOString().slice(0, 10)}: send the welcome email, and the welcome call.`,
    })
  }

  /* 3. Her pop-up and bell: one, however many clients. */
  if (assigned > 0) {
    const only = companies.length === 1 ? companies[0] : null
    await admin.from('notifications').insert({
      user_id: liaisonId, type: 'client.assigned', link: only ? `/companies/${only.id}` : '/companies',
      message: only
        ? (only.import_batch_id
          ? `${only.name} is yours to look after now. An existing client from Swordfish, so no welcome is needed.`
          : `New client: ${only.name}. Send them your welcome email from the client's page, and call to introduce yourself.`)
        : `${assigned} clients are yours to look after now${newClients
          ? `; ${newClients} of them ${newClients === 1 ? 'is' : 'are'} new and need${newClients === 1 ? 's' : ''} your welcome email and call (on your task list)`
          : ' -- existing clients from Swordfish, so no welcome is needed'}.`,
    })
  }

  const only = companies.length === 1 ? companies[0] : null
  res.status(problems.length && !assigned ? 500 : 200).json({
    assigned, imported: !!only?.import_batch_id, tasks: newClients > 0 && !problems.length,
    error: problems.length ? problems.join('; ') : null,
  })
}
