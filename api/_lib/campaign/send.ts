import type { SupabaseClient } from '@supabase/supabase-js'
import { sendAsUser } from '../email/sendAsUser.js'
import { sendSms, toMsisdn } from '../sms/connectMobile.js'
import { firmClock } from '../workflow/clock.js'
import { chargeItemWith, type ChargeDb, type ChargeResult } from '../../../src/lib/chargeEngine.js'
import { itemAmountFor, scheduleFor } from '../../../src/lib/annexureB.js'
import {
  CAMPAIGN_ACTION, CAMPAIGN_ITEM, campaignSkip, mayCampaignOn, renderCampaignMessage, skipWords,
  type CampaignChannel, type SkipReason,
} from '../../../src/lib/campaigns.js'
import { callHoursProblem, johannesburgMinute } from '../../../src/lib/contactHours.js'
import { callerFor, factsFor, holdersFor, valuesFor } from './gather.js'

/**
 * WORKING THROUGH A CAMPAIGN, A FEW MESSAGES AT A TIME.
 *
 * TWO CALLERS AND ONE FUNCTION. The Campaigns screen calls it over and over while it is open, so a
 * campaign started on an iPad goes out while somebody watches; the five-minute mail cron calls it
 * too (api/_lib/email/sync-all.ts), so closing the iPad does not strand the rest. Neither knows
 * about the other, and neither needs to: campaign_claim marks each message `sending` in the same
 * statement that picks it, so the two never take one account's message twice.
 *
 * BOUNDED BY THE CLOCK, NOT A COUNT -- the workflow runner's lesson. A function killed at its limit
 * reports nothing, and an email is seconds of SMTP. So it stops itself with time to spare, gives
 * back anything it claimed and did not reach, and the next call carries on.
 *
 * ONLY IN THE FIRM'S CALLING HOURS (contactHours.ts): weekdays 08:00-17:00, Saturday 09:00-13:00,
 * never a Sunday or a public holiday, on Johannesburg's clock (the staging clock's day on staging).
 * Outside them nothing is claimed at all, and the campaign waits for the next call inside them.
 *
 * EVERY MESSAGE IS ITS OWN SEND AND ITS OWN FEE. Charged through the engine at the moment it goes,
 * after the provider took it -- never in bulk up front -- so the in duplum ceiling, a written-off
 * account and (where it binds) item 1(c)'s monthly allowance are decided per debtor, by the same
 * code that decides them for a message sent by hand.
 */

/** Messages claimed per campaign per pass. Small for email: each is a fresh SMTP connection to
    one person's mailbox, and a mail server that sees forty at once from one login refuses some. */
const PER_PASS: Record<CampaignChannel, number> = { sms: 25, email: 8 }

/** The pause between two emails from one mailbox -- the throttle. A second each keeps a campaign
    of a few hundred under any provider's per-minute ceiling the firm is likely to be on. */
const EMAIL_GAP_MS = 1_000

export interface ChunkResult {
  /** Why nothing was sent, where it is outside the calling hours. */
  outsideHours: string | null
  sent: number
  skipped: number
  failed: number
  /** Claimed and given back because the time ran out. */
  returned: number
  campaigns: { id: string; status: string; note: string | null }[]
}

interface CampaignRow {
  id: string; name: string; channel: CampaignChannel; subject: string | null; body: string
  template_id: string | null; created_by: string | null; status: string
}

interface MessageRow { id: string; account_id: string }

export async function sendCampaignChunk(
  admin: SupabaseClient, options: { campaignId?: string; budgetMs: number },
): Promise<ChunkResult> {
  const started = Date.now()
  const result: ChunkResult = { outsideHours: null, sent: 0, skipped: 0, failed: 0, returned: 0, campaigns: [] }
  const clock = await firmClock(admin)

  /* THE HOURS FIRST, so nothing is even claimed outside them. */
  const problem = callHoursProblem(clock.today, johannesburgMinute(clock.now))
  if (problem) {
    result.outsideHours = `${problem} The campaign waits and carries on inside those hours.`
    return result
  }

  let query = admin.from('campaigns')
    .select('id, name, channel, subject, body, template_id, created_by, status')
    .eq('status', 'sending').order('created_at')
  if (options.campaignId) query = query.eq('id', options.campaignId)
  const { data: campaigns, error } = await query
  if (error) throw new Error(error.message)

  for (const campaign of (campaigns ?? []) as CampaignRow[]) {
    if (Date.now() - started > options.budgetMs) break
    const note = await workCampaign(admin, campaign, clock, started, options.budgetMs, result)
    const status = await finishIfDone(admin, campaign.id)
    result.campaigns.push({ id: campaign.id, status, note })
  }
  return result
}

async function workCampaign(
  admin: SupabaseClient, campaign: CampaignRow, clock: { today: string; now: Date },
  started: number, budgetMs: number, result: ChunkResult,
): Promise<string | null> {
  const creator = campaign.created_by ? await callerFor(admin, campaign.created_by) : null
  if (!creator) {
    /* Nobody to send it as and nobody whose desks it was checked against: it stops. */
    const note = 'The person who ran this campaign is no longer in Raptor, so it was stopped.'
    await stopCampaign(admin, campaign.id, null, note)
    return note
  }

  /* NOT CONNECTED, NOT SENT. The creation refused this; a mailbox disconnected since means the
     campaign waits, with the reason on it, rather than failing every account one by one. */
  if (campaign.channel === 'email') {
    const { data: conn } = await admin.from('email_connections').select('email').eq('user_id', creator.id).maybeSingle()
    if (!conn) {
      const note = `${creator.name || 'The person who ran it'} has no connected mailbox, so the emails are waiting. `
        + 'Connect it in Settings and the campaign carries on.'
      await admin.from('campaigns').update({ note }).eq('id', campaign.id)
      return note
    }
  }
  await admin.from('campaigns').update({ note: null }).eq('id', campaign.id)

  const audience = campaign.template_id
    ? ((await admin.from('message_templates').select('audience').eq('id', campaign.template_id).maybeSingle())
      .data?.audience as 'individual' | 'company' | null) ?? null
    : null

  const { data: claimed, error } = await admin.rpc('campaign_claim', {
    p_campaign: campaign.id, p_limit: PER_PASS[campaign.channel],
  })
  if (error) throw new Error(error.message)
  const messages = (claimed ?? []) as MessageRow[]

  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i]
    /* OUT OF TIME: give back what this pass claimed and did not reach. Ours, claimed seconds ago
       and never attempted, so pending again is exactly true -- unlike a claim found stale, which
       campaign_claim fails because nobody can say whether it went. */
    if (Date.now() - started > budgetMs) {
      const rest = messages.slice(i).map((m) => m.id)
      await admin.from('campaign_messages').update({ state: 'pending', claimed_at: null })
        .in('id', rest).eq('state', 'sending')
      result.returned += rest.length
      break
    }
    try {
      const outcome = await sendOne(admin, campaign, creator, message, audience, clock)
      result[outcome] += 1
    } catch (e) {
      /* AN EXCEPTION BEFORE THE PROVIDER WAS ASKED -- an unreadable row. Failed with the reason;
         sendOne records `sent` itself the moment the provider has taken the message, so nothing
         that went out is ever written down as failed. */
      await admin.from('campaign_messages').update({
        state: 'failed', reason: e instanceof Error ? e.message : String(e), updated_at: new Date().toISOString(),
      }).eq('id', message.id).eq('state', 'sending')
      result.failed += 1
    }
    if (campaign.channel === 'email' && i < messages.length - 1) {
      await new Promise((r) => setTimeout(r, EMAIL_GAP_MS))
    }
  }
  return null
}

/** One account's message: re-checked, merged, sent, charged, filed. */
async function sendOne(
  admin: SupabaseClient, campaign: CampaignRow,
  creator: NonNullable<Awaited<ReturnType<typeof callerFor>>>,
  message: MessageRow, audience: 'individual' | 'company' | null,
  clock: { today: string; now: Date },
): Promise<'sent' | 'skipped' | 'failed'> {
  const skip = async (reason: SkipReason, words?: string) => {
    await admin.from('campaign_messages').update({
      state: 'skipped', reason: words ?? skipWords(reason), updated_at: new Date().toISOString(),
    }).eq('id', message.id)
    return 'skipped' as const
  }

  /*
   * EVERYTHING ASKED AGAIN, because a campaign can run for days. A dispute raised on Tuesday, an
   * account frozen on Wednesday, a file moved to another team's desk -- the preview's count was true
   * when it was read, and the message goes on what is true now.
   */
  const facts = (await factsFor(admin, [message.account_id], clock.today)).get(message.account_id)
  if (!facts) return skip('closed', 'The account is no longer in the book')
  const holder = facts.assignedTo ? (await holdersFor(admin, [facts.assignedTo])).get(facts.assignedTo) ?? null : null
  if (!mayCampaignOn(creator, holder)) return skip('out_of_scope')
  const reason = campaignSkip(facts, campaign.channel, audience)
  if (reason) return skip(reason, skipWords(reason, facts))

  const merged = await valuesFor(admin, message.account_id, creator.id, clock.today)
  if (!merged) return skip('closed', 'The account could not be read')
  const out = renderCampaignMessage({
    channel: campaign.channel, subject: campaign.subject, body: campaign.body, values: merged.values,
  })
  if (out.missing.length > 0) {
    return skip('unfilled', `Nothing on the account fills ${out.missing.map((f) => `{{${f}}}`).join(', ')}`)
  }

  const sentAt = clock.now.toISOString()
  const actionDate = new Date(sentAt)
  const nowIso = () => new Date().toISOString()
  let smsId: string | null = null
  let emailId: string | null = null
  let sentTo: string

  if (campaign.channel === 'sms') {
    const msisdn = toMsisdn(facts.mobile ?? '')
    if (!msisdn) return skip('bad_number')
    sentTo = msisdn
    const reference = `bf${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    let provider
    try {
      provider = await sendSms({ to: msisdn, text: out.text, reference })
    } catch (e) {
      /* THE PROVIDER REFUSED: failed, with its words, and nothing is charged. */
      await admin.from('campaign_messages').update({
        state: 'failed', reason: e instanceof Error ? e.message : String(e), updated_at: nowIso(),
      }).eq('id', message.id)
      return 'failed'
    }
    /* ON THE ACCOUNT, exactly as /api/sms/send files a single message -- the same columns, so the
       account's SMS tab and the delivery report cannot tell the two apart. */
    const { data: row } = await admin.from('sms_messages').insert({
      account_id: message.account_id, direction: 'outbound', msisdn, body: out.text,
      segments: out.segments ?? 1, encoding: out.encoding, status: 'sent', reference,
      provider_id: provider.providerId, provider_raw: provider.raw, sent_at: sentAt,
      created_by: creator.id, created_by_name: creator.name || null,
    }).select('id').maybeSingle()
    smsId = (row?.id as string) ?? null
  } else {
    sentTo = facts.email ?? ''
    const sent = await sendAsUser(admin, creator.id, {
      to: sentTo, subject: out.subject ?? '', bodyHtml: out.html ?? '',
    })
    if (!sent.ok) {
      await admin.from('campaign_messages').update({ state: 'failed', reason: sent.error, updated_at: nowIso() })
        .eq('id', message.id)
      return 'failed'
    }
    /*
     * FILED AS THE ACCOUNT'S OWN CORRESPONDENCE, with the Message-ID, which is what threads the
     * debtor's reply back onto this account -- into the mailbox of the person who ran the campaign,
     * because that is the address it left from. The tariff price now, corrected below to what the
     * engine actually charged.
     */
    const { data: row } = await admin.from('account_emails').insert({
      account_id: message.account_id, direction: 'out', debtor_address: sentTo, our_address: sent.from,
      subject: out.subject ?? '', body: out.text, message_id: sent.messageId,
      sent_by: creator.id, sent_by_name: creator.name || null,
      charged_excl_vat: itemAmountFor('1a', 1, 0, scheduleFor(actionDate)),
    }).select('id').maybeSingle()
    emailId = (row?.id as string) ?? null
  }

  /*
   * IT HAS GONE. From this line nothing may record it as failed: the debtor has the message. The
   * fee and the note are written as well as they can be, and a fault in either is noted on the row
   * rather than turned into a "failed" that invites somebody to send it again.
   */
  let fee: ChargeResult | null = null
  let feeProblem: string | null = null
  try {
    fee = await chargeItemWith(admin as unknown as ChargeDb, {
      accountId: message.account_id,
      itemId: CAMPAIGN_ITEM[campaign.channel],
      actionCode: CAMPAIGN_ACTION[campaign.channel],
      /* The statement's words for a single send, because it IS a single send to this debtor. */
      description: campaign.channel === 'sms' ? 'SMS' : 'Email',
      quantity: campaign.channel === 'sms' ? (out.segments ?? 1) : 1,
      at: actionDate,
      createdBy: creator.id,
    })
  } catch (e) {
    feeProblem = `Sent, but the fee could not be raised: ${e instanceof Error ? e.message : String(e)}`
  }
  if (emailId && fee) {
    await admin.from('account_emails').update({ charged_excl_vat: fee.exclVat }).eq('id', emailId)
  }

  /* THE TIMELINE SAYS WHERE IT CAME FROM. Nothing about money -- the firm's standing rule; the fee
     is its own line on the same timeline. */
  await admin.from('account_notes').insert({
    account_id: message.account_id,
    body: campaign.channel === 'sms'
      ? `Campaign “${campaign.name}”: SMS to ${sentTo}: ${out.text}`
      : `Campaign “${campaign.name}”: email to ${sentTo}, “${out.subject ?? ''}”.`,
    source: 'system',
    author_name: creator.name || null,
    created_by: creator.id,
  })

  await admin.from('campaign_messages').update({
    state: 'sent', sent_to: sentTo, segments: out.segments, sent_at: sentAt, updated_at: nowIso(),
    fee_excl_vat: fee?.exclVat ?? null, fee_reason: feeProblem ?? fee?.reason ?? null,
    sms_message_id: smsId, account_email_id: emailId, reason: null,
  }).eq('id', message.id)
  return 'sent'
}

/** Nothing pending and nothing in flight: the campaign is finished. Returns the status now. */
async function finishIfDone(admin: SupabaseClient, campaignId: string): Promise<string> {
  const { count } = await admin.from('campaign_messages').select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId).in('state', ['pending', 'sending'])
  if ((count ?? 0) > 0) return 'sending'
  await admin.from('campaigns').update({ status: 'finished', finished_at: new Date().toISOString() })
    .eq('id', campaignId).eq('status', 'sending')
  return 'finished'
}

/**
 * STOP: everything still pending is cancelled, with who and why. A message mid-send finishes --
 * the provider may already have it, and cancelling the row would make the record lie.
 */
export async function stopCampaign(
  admin: SupabaseClient, campaignId: string, by: { id: string; name: string } | null, note?: string,
): Promise<number> {
  const reason = by ? `Stopped by ${by.name || 'somebody'} before it was sent` : (note ?? 'Stopped before it was sent')
  const { data } = await admin.from('campaign_messages')
    .update({ state: 'cancelled', reason, updated_at: new Date().toISOString() })
    .eq('campaign_id', campaignId).eq('state', 'pending').select('id')
  await admin.from('campaigns').update({
    status: 'stopped', stopped_at: new Date().toISOString(), stopped_by: by?.id ?? null, note: note ?? null,
  }).eq('id', campaignId).eq('status', 'sending')
  return (data ?? []).length
}
