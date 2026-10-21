import type { VercelRequest, VercelResponse } from '@vercel/node'
import { adminClient, requireCaller } from '../auth.js'
import { sendSms, toMsisdn, SmsError } from './connectMobile.js'
import { smsCost } from './cost.js'

/**
 * Send one SMS, record it against the record it belongs to, and let the caller charge for it.
 *
 * The provider is asked FIRST, and the order is the point: a fee for a message that never left
 * is worse than a message with no fee. The second is a bookkeeping gap; the first is a charge the
 * firm cannot justify.
 *
 * WHO PAYS DEPENDS ON WHAT IT IS ADDRESSED TO, and this route does not decide it — it records it.
 * A message on a debtor's ACCOUNT raises Annexure B item 1(c) at R3.50 a segment, because a
 * debtor pays for the work of collecting from them; the account page charges it after this
 * returns. A message on a lead, a deal, a client or a contact charges nothing at all: a lead owes
 * us nothing and a client is the person paying US.
 *
 * That distinction is a column rather than a rule somebody has to remember. `account_id` set
 * means chargeable; any of the other four means not. The database refuses more than one of them
 * on a row, and refuses a fee on a row with no account — see sms_messages in schema.sql.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  const admin = adminClient()
  if (!admin) {
    res.status(500).json({ error: 'Server is missing Supabase configuration.' })
    return
  }
  const caller = await requireCaller(req, admin)
  if (!caller) {
    res.status(401).json({ error: 'Invalid or expired session.' })
    return
  }

  const { accountId, leadId, dealId, companyId, contactId, to, text } = (req.body ?? {}) as {
    accountId?: string; leadId?: string; dealId?: string; companyId?: string; contactId?: string
    to?: string; text?: string
  }

  /*
   * Exactly one target, checked here as well as by the database.
   *
   * The constraint is the guarantee; this is so a mistake comes back as a sentence a person can
   * read rather than as a Postgres check violation.
   */
  const targets = [accountId, leadId, dealId, companyId, contactId].filter(Boolean)
  if (targets.length !== 1) {
    res.status(400).json({
      error: targets.length === 0
        ? 'An SMS has to be addressed to a record — an account, lead, deal, client or contact.'
        : 'An SMS belongs to one record, not several.',
    })
    return
  }
  if (!to?.trim() || !text?.trim()) {
    res.status(400).json({ error: 'A number and a message are both required.' })
    return
  }
  const msisdn = toMsisdn(to)
  if (!msisdn) {
    res.status(400).json({ error: `"${to}" is not a number an SMS can be sent to.` })
    return
  }

  const { data: profile } = await admin.from('profiles').select('name').eq('id', caller.id).maybeSingle<{ name: string }>()
  const cost = smsCost(text)
  // Ours, and echoed back on the delivery report. Unique so a retry cannot be mistaken for a
  // second message, and short enough to survive a provider that truncates identifiers.
  const reference = `bf${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

  let result
  try {
    result = await sendSms({ to: msisdn, text, reference })
  } catch (err) {
    if (err instanceof SmsError) {
      res.status(err.status).json({ error: err.message })
      return
    }
    res.status(502).json({ error: 'Could not send the message.' })
    return
  }

  const { data: row, error } = await admin.from('sms_messages').insert({
    account_id: accountId ?? null,
    lead_id: leadId ?? null,
    deal_id: dealId ?? null,
    company_id: companyId ?? null,
    contact_id: contactId ?? null,
    direction: 'outbound',
    msisdn,
    body: text,
    segments: cost.segments,
    encoding: cost.encoding,
    status: 'sent',
    reference,
    provider_id: result.providerId,
    provider_raw: result.raw,
    sent_at: new Date().toISOString(),
    created_by: caller.id,
    created_by_name: profile?.name ?? null,
  }).select('id').single()
  if (error) {
    // The message is gone whether or not we managed to write it down, and saying otherwise would
    // invite somebody to send it again.
    res.status(500).json({ error: `The message was sent, but could not be recorded: ${error.message}` })
    return
  }

  res.status(200).json({
    ok: true,
    id: row.id,
    reference,
    segments: cost.segments,
    encoding: cost.encoding,
    to: msisdn,
    // So the caller does not have to work out whether to charge: the route already knows what
    // this message was addressed to.
    chargeable: !!accountId,
  })
}
