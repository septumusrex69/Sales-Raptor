import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { SupabaseClient } from '@supabase/supabase-js'
import { adminClient, requireCaller } from '../auth.js'
import { firmClock } from '../workflow/clock.js'
import { moneyZa } from '../workflow/locale.js'
import { can } from '../../../src/lib/capabilities.js'
import {
  CAMPAIGN_CEILING, campaignFeeEstimate, campaignSkip, campaignWordingProblem, mayCampaignOn,
  mayManageCampaign, mayRecoverOn, renderCampaignMessage, senderFor, skipWords, tallySkips, writtenOffMessageSkip,
  type CampaignChannel, type SendFrom, type SkipReason,
} from '../../../src/lib/campaigns.js'
import { callHoursProblem, johannesburgMinute } from '../../../src/lib/contactHours.js'
import { callerFor, centralSender, factsFor, holdersFor, valuesFor, withMailbox, type AccountFacts } from './gather.js'
import { sendCampaignChunk, stopCampaign } from './send.js'
import { callAssess, callCreate, readCallInput } from './call.js'

/**
 * POST /api/workflow/campaign -- a campaign from the Accounts list, four operations on one route.
 *
 *   preview   what would happen: the counts, why each skip, one real account's message, the fee.
 *   create    the same assessment again ON THE SERVER, and then the rows. Nothing the browser says
 *             about counts or desks is believed; it sends which accounts and the wording, and this
 *             decides everything else.
 *   send      the next few messages of one campaign -- the screen calls it while it is open.
 *   stop      cancel what is still pending.
 *
 * A ROUTE ON THE WORKFLOW FUNCTION, not a file of its own: Vercel's Hobby plan counts files and
 * api/ is at twelve. See api/workflow/[action].ts.
 *
 * WHO: campaign.run, and then mayCampaignOn for EVERY account -- an Administrator on any, a team
 * leader only on their own team's desks. A selection with one account outside that is refused
 * whole rather than trimmed: a person who meant those accounts should be told, not quietly given a
 * smaller campaign than the one they confirmed.
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
  const user = await requireCaller(req, admin)
  if (!user) {
    res.status(401).json({ error: 'Invalid or expired session.' })
    return
  }
  const caller = await callerFor(admin, user.id)
  if (!caller || !can(caller, 'campaign.run')) {
    res.status(403).json({ error: 'Campaigns are run by an Administrator, a team leader or a liaison.' })
    return
  }

  const body = (req.body ?? {}) as Record<string, unknown>
  try {
    switch (body.op) {
      case 'preview': {
        const input = readInput(body)
        if ('error' in input) { res.status(400).json({ error: input.error }); return }
        res.status(200).json({ ok: true, ...forBrowser(await assess(admin, caller, input)) })
        return
      }
      case 'create': {
        const input = readInput(body)
        if ('error' in input) { res.status(400).json({ error: input.error }); return }
        const made = await create(admin, caller, input, body)
        if ('error' in made) { res.status(made.status).json({ error: made.error }); return }
        res.status(200).json({ ok: true, ...made })
        return
      }
      /* A CALL CAMPAIGN: accounts onto the collectors' diaries rather than a message out (call.ts). */
      case 'call-preview':
      case 'call-create': {
        const input = readCallInput(body)
        if ('error' in input) { res.status(400).json({ error: input.error }); return }
        if (body.op === 'call-preview') {
          const a = await callAssess(admin, caller, input)
          res.status(200).json({ ok: true, ...a.forBrowser })
          return
        }
        const made = await callCreate(admin, caller, input, body)
        if ('error' in made) { res.status(made.status).json({ error: made.error }); return }
        res.status(200).json({ ok: true, ...made })
        return
      }
      case 'send':
      case 'stop': {
        const id = typeof body.campaignId === 'string' ? body.campaignId : ''
        const { data: campaign } = await admin.from('campaigns').select('id, created_by, team_id, status').eq('id', id).maybeSingle()
        if (!campaign || !mayManageCampaign(caller, { createdBy: campaign.created_by, teamId: campaign.team_id })) {
          res.status(404).json({ error: 'No such campaign, or it is not yours to run.' })
          return
        }
        if (body.op === 'stop') {
          const cancelled = await stopCampaign(admin, id, { id: caller.id, name: caller.name })
          res.status(200).json({ ok: true, cancelled })
          return
        }
        /* FORTY SECONDS against the function's limit, the workflow runner's margin for a pass that
           opens an SMTP connection per email. The screen calls again for the rest. */
        const chunk = await sendCampaignChunk(admin, { campaignId: id, budgetMs: 40_000 })
        res.status(200).json({ ok: true, ...chunk })
        return
      }
      default:
        res.status(400).json({ error: 'Say what to do: preview, create, send or stop.' })
    }
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) })
  }
}

interface Input {
  channel: CampaignChannel
  templateId: string | null
  subject: string | null
  body: string
  accountIds: string[]
  /* Raptor H12: who an email comes from; live accounts or written-off ones, by reason. */
  sendFrom: SendFrom
  target: 'live' | 'written_off'
  reasons: string[]
}

function readInput(body: Record<string, unknown>): Input | { error: string } {
  const channel = body.channel === 'sms' || body.channel === 'email' ? body.channel : null
  if (!channel) return { error: 'Choose SMS or email.' }
  const ids = Array.isArray(body.accountIds)
    ? [...new Set(body.accountIds.filter((v): v is string => typeof v === 'string'))]
    : []
  if (ids.length === 0) return { error: 'Select the accounts the campaign goes to.' }
  if (ids.length > CAMPAIGN_CEILING) {
    return { error: `That is ${ids.length.toLocaleString('en-ZA')} accounts. A campaign reaches ${CAMPAIGN_CEILING.toLocaleString('en-ZA')} at most -- narrow the filters.` }
  }
  return {
    channel,
    templateId: typeof body.templateId === 'string' && body.templateId ? body.templateId : null,
    subject: channel === 'email' && typeof body.subject === 'string' ? body.subject : null,
    body: typeof body.body === 'string' ? body.body : '',
    accountIds: ids,
    /* An SMS goes under the firm's name whoever runs it, so only an email has a sender to choose. */
    sendFrom: channel === 'email' && (body.sendFrom === 'owner' || body.sendFrom === 'central') ? body.sendFrom : 'me',
    target: body.target === 'written_off' ? 'written_off' : 'live',
    reasons: Array.isArray(body.reasons) ? body.reasons.filter((r): r is string => typeof r === 'string') : [],
  }
}

type Caller = NonNullable<Awaited<ReturnType<typeof callerFor>>>

/** Everything the preview shows and the creation re-checks, decided once here. */
async function assess(admin: SupabaseClient, caller: Caller, input: Input) {
  const clock = await firmClock(admin)
  const template = input.templateId
    ? (await admin.from('message_templates')
      .select('id, kind, scope, active, attachment_id, audience').eq('id', input.templateId).maybeSingle()).data
    : null
  const wordingProblem = input.templateId && !template
    ? 'That wording is no longer in the library.'
    : campaignWordingProblem({
      channel: input.channel, subject: input.subject, body: input.body,
      template: template ? {
        kind: template.kind as string, scope: template.scope as string, active: Boolean(template.active),
        attachmentId: (template.attachment_id as string) ?? null,
      } : null,
    })
  const audience = (template?.audience as 'individual' | 'company' | null) ?? null

  const facts = await factsFor(admin, input.accountIds, clock.today)
  const holders = await holdersFor(admin, [...facts.values()].flatMap((f) => [f.assignedTo, f.liaisonId]))
  const outOfScope: string[] = []
  const sendable: AccountFacts[] = []
  const skipped: { id: string; reason: SkipReason; holdReason: string | null }[] = []
  for (const id of input.accountIds) {
    const f = facts.get(id)
    if (!f) continue
    const holder = f.assignedTo ? holders.get(f.assignedTo) ?? null : null
    const liaison = f.liaisonId ? holders.get(f.liaisonId) ?? null : null
    /* The written-off book is mostly on nobody's desk: the recovery call's widening applies. */
    const may = input.target === 'written_off' ? mayRecoverOn(caller, holder, liaison) : mayCampaignOn(caller, holder, liaison)
    if (!may) { outOfScope.push(id); continue }
    const reason = input.target === 'written_off'
      ? writtenOffMessageSkip({ ...f, onCallCampaign: false }, input.channel, input.reasons, audience)
      : campaignSkip(f, input.channel, audience)
    if (reason) skipped.push({ id, reason, holdReason: f.holdReason })
    else sendable.push(f)
  }

  /*
   * WHO EACH EMAIL GOES OUT AS (Raptor H12), decided here for the preview's split and again by the
   * sender at the moment it goes (send.ts). An account nobody can send as is skipped, and said.
   */
  const central = input.channel === 'email' ? await centralSender(admin) : null
  const mailboxes = input.channel === 'email'
    ? await withMailbox(admin, [caller.id, central?.id ?? null, ...sendable.map((f) => f.assignedTo)])
    : new Map<string, string>()
  const senders = new Map<string, number>()
  if (input.channel === 'email') {
    for (let i = sendable.length - 1; i >= 0; i -= 1) {
      const f = sendable[i]
      const h = f.assignedTo ? holders.get(f.assignedTo) ?? null : null
      const who = senderFor({
        sendFrom: input.sendFrom, callerId: caller.id, callerHasMailbox: mailboxes.has(caller.id),
        centralId: central && mailboxes.has(central.id) ? central.id : null,
        holder: h ? { id: h.id, active: h.active, hasMailbox: mailboxes.has(h.id) } : null,
      })
      if (!who) { sendable.splice(i, 1); skipped.push({ id: f.id, reason: 'no_sender', holdReason: null }); continue }
      senders.set(who, (senders.get(who) ?? 0) + 1)
    }
  }
  const senderNames = senders.size
    ? new Map(((await admin.from('profiles').select('id, name').in('id', [...senders.keys()])).data ?? [])
      .map((p) => [p.id as string, (p.name as string) ?? ''] as const))
    : new Map<string, string>()
  const fromSplit = [...senders.entries()].map(([id, count]) => ({
    name: senderNames.get(id) || 'Somebody', address: mailboxes.get(id) ?? null, count, central: id === central?.id,
  })).sort((a, b) => b.count - a.count)

  /*
   * ONE REAL ACCOUNT'S MESSAGE, merged exactly as it will be sent. The first sendable one whose
   * fields all fill -- and if the first few do not, the preview says which fields are missing on
   * the one it shows, because "{{listing_reference}}" in the preview is the warning.
   */
  let sample: null | {
    accountId: string; caseNumber: string | null; debtor: string | null
    text: string; subject: string | null; html: string | null; segments: number | null
    encoding: string | null; missing: string[]
  } = null
  if (!wordingProblem) {
    for (const f of sendable.slice(0, 5)) {
      const merged = await valuesFor(admin, f.id, caller.id, clock.today)
      if (!merged) continue
      const out = renderCampaignMessage({ channel: input.channel, subject: input.subject, body: input.body, values: merged.values })
      sample = {
        accountId: f.id, caseNumber: (merged.account.case_number as string) ?? null,
        debtor: merged.values.debtor_name ?? null,
        text: out.text, subject: out.subject, html: out.html, segments: out.segments, encoding: out.encoding,
        missing: out.missing,
      }
      if (out.missing.length === 0) break
    }
  }

  const estimate = campaignFeeEstimate(input.channel, sendable.length, sample?.segments ?? null, clock.today)
  /*
   * A WRITTEN-OFF ACCOUNT IS CHARGED NOTHING TODAY -- the charge engine's rule (chargeEngine.ts: "a
   * written-off account earns nothing more", because the statement drops fees dated after the
   * write-off). The firm has said it wants these charged; until that rule is changed with the
   * statement, the preview says what will actually happen rather than promise a fee.
   */
  const writtenOffUncharged = input.target === 'written_off'
  /*
   * ITEM 1(c)'s MONTHLY ALLOWANCE, WHERE IT BINDS. Off since 10 September at the firm's instruction
   * (annexureB.ts ENFORCE_MONTHLY_LIMITS), in which case monthlyLimit is null and nobody is "at the
   * cap". Where it binds, the accounts already at it still get the SMS and pay nothing for it --
   * the engine's decision -- and the screen says how many.
   */
  let atMonthlyLimit = 0
  if (estimate.monthlyLimit !== null && sendable.length > 0) {
    const monthStart = `${clock.today.slice(0, 7)}-01`
    const counts = new Map<string, number>()
    for (let i = 0; i < sendable.length; i += 100) {
      const { data } = await admin.from('account_fees').select('account_id')
        .in('account_id', sendable.slice(i, i + 100).map((f) => f.id))
        .eq('annexure_item', '1c').eq('billed', true).gte('incurred_at', monthStart).limit(1000)
      for (const r of data ?? []) counts.set(r.account_id as string, (counts.get(r.account_id as string) ?? 0) + 1)
    }
    atMonthlyLimit = [...counts.values()].filter((n) => n >= (estimate.monthlyLimit ?? Infinity)).length
  }

  const mailbox = input.channel === 'email'
    ? ((await admin.from('email_connections').select('email').eq('user_id', caller.id).maybeSingle()).data?.email as string | undefined) ?? null
    : null

  return {
    selected: input.accountIds.length,
    found: facts.size,
    outOfScope: outOfScope.length,
    sending: sendable.length,
    skipped: skipped.length,
    skips: tallySkips(skipped),
    sample,
    estimate,
    estimateWords: moneyZa(estimate.total),
    atMonthlyLimit,
    mailbox,
    sendFrom: input.sendFrom,
    target: input.target,
    fromSplit,
    central: central ? { name: central.name, address: mailboxes.get(central.id) ?? null } : null,
    writtenOffUncharged,
    hoursProblem: callHoursProblem(clock.today, johannesburgMinute(clock.now)),
    wordingProblem,
    /* Which accounts, for create -- never sent to the browser (forBrowser). */
    _sendable: sendable,
    _skipped: skipped,
  }
}

/** The assessment without the per-account lists, which are the server's working and not a screen's. */
function forBrowser(a: Awaited<ReturnType<typeof assess>>) {
  const out: Record<string, unknown> = { ...a }
  delete out._sendable
  delete out._skipped
  return out
}

async function create(
  admin: SupabaseClient, caller: Caller, input: Input, body: Record<string, unknown>,
): Promise<{ campaignId: string; sending: number; skipped: number } | { error: string; status: number }> {
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return { error: 'Give the campaign a name, so it can be found and stopped.', status: 400 }
  if (name.length > 120) return { error: 'Keep the name under 120 characters.', status: 400 }

  const a = await assess(admin, caller, input)
  if (a.wordingProblem) return { error: a.wordingProblem, status: 400 }
  if (a.outOfScope > 0) {
    return {
      error: `${a.outOfScope.toLocaleString('en-ZA')} of these accounts ${a.outOfScope === 1 ? 'is' : 'are'} not on your team’s desks. `
        + 'A team leader runs a campaign on their own team’s accounts; narrow the selection.',
      status: 403,
    }
  }
  if (input.channel === 'email' && input.sendFrom === 'me' && !a.mailbox) {
    return {
      error: 'Your mailbox is not connected. An email campaign from you goes from your own mailbox so the replies come back to you -- connect it in Settings first.',
      status: 400,
    }
  }
  if (input.channel === 'email' && input.sendFrom === 'central' && !a.central?.address) {
    return { error: 'The central mailbox is not set up. Choose it in Settings -> Mail, and connect its mailbox, first.', status: 400 }
  }
  if (input.target === 'written_off' && input.reasons.length === 0) {
    return { error: 'Choose which write-off reasons the campaign goes to.', status: 400 }
  }
  if (a.sending === 0) return { error: 'Every selected account is skipped, so there is nothing to send.', status: 400 }

  /* A DOUBLE PRESS IS NOT A SECOND CAMPAIGN. Two debtors' worth of the same SMS, charged twice. */
  const since = new Date(Date.now() - 2 * 60_000).toISOString()
  const { data: twin } = await admin.from('campaigns').select('id')
    .eq('created_by', caller.id).eq('name', name).gte('created_at', since).limit(1).maybeSingle()
  if (twin) return { error: `“${name}” was started a moment ago. Find it under Campaigns.`, status: 409 }

  const selection = body.selection && typeof body.selection === 'object' ? body.selection : { kind: 'ids' }
  const { data: made, error } = await admin.from('campaigns').insert({
    name, channel: input.channel, template_id: input.templateId,
    subject: input.channel === 'email' ? (input.subject ?? '') : null, body: input.body,
    selection, created_by: caller.id, created_by_name: caller.name || null, team_id: caller.teamId,
    selected: a.selected, to_send: a.sending, skipped: a.skipped, fee_estimate: a.writtenOffUncharged ? 0 : a.estimate.total,
    send_from: input.sendFrom, target: input.target, reasons: input.target === 'written_off' ? input.reasons : [],
  }).select('id').single()
  if (error || !made) return { error: error?.message ?? 'The campaign could not be saved.', status: 500 }

  const rows = [
    ...a._sendable.map((f) => ({ campaign_id: made.id, account_id: f.id, state: 'pending' })),
    ...a._skipped.map((s) => ({
      campaign_id: made.id, account_id: s.id, state: 'skipped', reason: skipWords(s.reason, { holdReason: s.holdReason }),
    })),
  ]
  for (let i = 0; i < rows.length; i += 500) {
    const { error: rowsError } = await admin.from('campaign_messages').insert(rows.slice(i, i + 500))
    if (rowsError) {
      /* HALF A CAMPAIGN IS NOT STARTED. Stopped with the reason, so nothing pending goes out. */
      await stopCampaign(admin, made.id, null, `It could not be set up: ${rowsError.message}`)
      return { error: `The campaign could not be set up: ${rowsError.message}`, status: 500 }
    }
  }
  return { campaignId: made.id as string, sending: a.sending, skipped: a.skipped }
}
