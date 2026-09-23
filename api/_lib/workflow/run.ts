import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { SupabaseClient } from '@supabase/supabase-js'
import { adminClient } from '../auth.js'
import { sendAsUser } from '../email/sendAsUser.js'
import { sendSms, toMsisdn } from '../sms/connectMobile.js'
import { accountMergeValues } from '../../../src/lib/accountMergeValues.js'
import { computeBalance } from '../../../src/lib/accountBalance.js'
import { planSend, type StepTemplate } from '../../../src/lib/workflowSend.js'
import { letterToPdf, letterFilename } from '../../../src/lib/letterPdf.js'
import { emailBodyHtml } from '../../../src/lib/emailStyle.js'
import { A4_LETTERHEAD, type LetterDocument } from '../../../src/lib/letterDocument.js'
import { charterFor } from './fonts.js'
import { notifyHeld } from './notify.js'
import { todayInJohannesburg, moneyZa } from './locale.js'

/**
 * THE MORNING RUN: every workflow step that has come due, sent or held.
 *
 * The firm: "I'll send every letter by hand once and every SMS once. And then I want these things
 * working automatically in the workflow." This is the second half of that sentence.
 *
 * ONCE A DAY, AND THAT IS THE RIGHT GRAIN. Every step is dated to a DAY -- `landsOn` resolves
 * "business day 32" to a date when the run starts -- so nothing in the firm's sequence is finer
 * than daily, and a runner that woke every five minutes would spend the day asking a question
 * whose answer changes at midnight. It is a Vercel cron in vercel.json, like the mail sync
 * beside it, rather than pg_cron reaching back out over HTTP: one scheduler, already in the repo,
 * already understood.
 *
 * WHAT IT DOES NOT DO IS DECIDE. `planSend` decides, and it is pure and checked; this fetches
 * what planSend needs, does what it says, and writes down what happened. The division matters
 * because everything interesting is in the decision and none of it is testable through a mailbox.
 *
 * NOTHING IS RETRIED BLINDLY. A step that could not be sent goes to `held` with the reason in the
 * firm's words, where a person sees it on the account -- it does not go to `failed` and it is not
 * attempted again tomorrow as though nothing happened. The one exception is a send the PROVIDER
 * refused, which is `failed`: that is not something a collector can fix by filling in a field.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  /* Vercel sends `Authorization: Bearer $CRON_SECRET` on cron-triggered requests when the env var
     is set. Same guard as the mail sync, which is the only other thing on a timer. */
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const admin = adminClient()
  if (!admin) {
    res.status(500).json({ error: 'Server is missing Supabase configuration.' })
    return
  }

  /*
   * THE FIRM'S TODAY, NOT THE SERVER'S. The function runs in Paris (vercel.json pins cdg1) and
   * the firm is in Johannesburg, two hours ahead in winter and one in summer. Around midnight the
   * two disagree about what day it is, and a step dated tomorrow would go out tonight.
   */
  const today = todayInJohannesburg()

  /*
   * EVERY STEP DUE, AND OVERDUE ONES WITH IT. `due_on <= today` rather than `= today`: a day the
   * cron did not fire, or a step whose account was only reachable later, must not be skipped for
   * ever. The order is oldest first so a sequence that fell behind goes out in the order it was
   * written -- the reminder before the final notice, never the other way round.
   *
   * AND HELD STEPS ARE ASKED AGAIN, which is what makes the notification worth sending. A hold is
   * "nothing on the account fills {{listing_reference}}" -- a sentence that tells somebody what to
   * go and do. Looked at once and never again, doing it would change nothing and the notice would
   * sit held for ever; asked each morning, filling the field is all the collector has to do.
   *
   * A STEP THAT WAITS FOR A PERSON STILL WAITS. planSend refuses a `needsRelease` step every time
   * it is asked, so re-asking cannot send a section 129 nobody released -- it costs one decision
   * a day and changes nothing until a person acts, which is the correct behaviour rather than a
   * side effect of it.
   *
   * `failed` IS NOT RE-ASKED. That is a provider refusal, not something the account is missing,
   * and quietly retrying a message the network rejected is how a debtor gets four copies.
   */
  const { data: due, error } = await admin
    .from('workflow_run_steps')
    .select('id, node_id, due_on, state, note, run_id, workflow_runs!inner(id, account_id, version_id, started_on, state)')
    .in('state', ['pending', 'held'])
    .lte('due_on', today)
    .eq('workflow_runs.state', 'running')
    .order('due_on', { ascending: true })
    .limit(200)
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  const steps = (due ?? []) as unknown as DueStep[]
  /* `held` is a NEW hold or one whose reason changed; `stillHeld` is one that has not moved.
     Counted apart because the first is news and the second is the state of the floor -- a run
     reporting "held: 40" every morning would read as forty things going wrong daily. */
  const outcome = {
    considered: steps.length, sent: 0, held: 0, stillHeld: 0, failed: 0,
    told: 0, notes: [] as string[],
  }

  for (const step of steps) {
    try {
      const what = await runOneStep(admin, step, today)
      outcome[what.result] += 1
      outcome.told += what.told ?? 0
      /* Only what is new goes in the notes. A standing hold is already on the step. */
      if (what.note && what.result !== 'stillHeld') outcome.notes.push(`${step.id}: ${what.note}`)
    } catch (e) {
      /*
       * ONE STEP'S FAILURE IS NOT THE RUN'S. Two hundred accounts are being worked here; a single
       * unreadable row must not stop the other hundred and ninety-nine from being told anything.
       * The step stays pending and is picked up tomorrow, because an exception is not evidence
       * that the step should be held -- nobody has decided anything about it.
       */
      outcome.failed += 1
      outcome.notes.push(`${step.id}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  res.status(200).json({ ok: true, today, ...outcome })
}

interface DueStep {
  id: string
  node_id: string
  due_on: string
  state: 'pending' | 'held'
  /** The reason already on it, if it is already held. What a new reason is compared against. */
  note: string | null
  run_id: string
  workflow_runs: { id: string; account_id: string; version_id: string; started_on: string }
}

type StepOutcome = {
  result: 'sent' | 'held' | 'stillHeld' | 'failed'
  note: string | null
  /** How many people were told, where this was news. */
  told?: number
}

async function runOneStep(
  admin: SupabaseClient, step: DueStep, today: string,
): Promise<StepOutcome> {
  const run = step.workflow_runs

  /*
   * HOLD IT, AND TELL SOMEBODY ONLY IF THIS IS NEWS.
   *
   * The reason goes on the step every time, because that is the record. The NOTIFICATION goes out
   * only when the reason is new or has changed -- CLAUDE.md's rule that a warning firing when
   * nothing is wrong is worse than no warning, and here the cost is exact: a section 129 waiting
   * for a person waits every morning until somebody releases it, so a daily notification would
   * teach the collector to clear the bell without reading it. On the one message that means a
   * statutory demand has not gone out.
   *
   * `account` and `debtorName` are passed in rather than read here because the early holds happen
   * before the account has been fetched -- and a hold that cannot name the account is still a
   * hold worth recording.
   */
  const hold = async (note: string, about?: {
    accountId: string; collectorId: string | null; debtorName: string | null; caseNumber: string | null
    stepLabel: string
  }): Promise<StepOutcome> => {
    const isNews = step.state !== 'held' || step.note !== note
    await admin.from('workflow_run_steps').update({ state: 'held', note }).eq('id', step.id)
    if (!isNews) return { result: 'stillHeld', note }
    const told = about ? await notifyHeld(admin, { ...about, reason: note }) : 0
    return { result: 'held', note, told }
  }

  /* ---------- everything planSend needs, in as few round trips as this will go ---------- */

  const [nodeRes, accountRes, firmRes] = await Promise.all([
    admin.from('workflow_nodes')
      .select('id, phase_id, key, kind, label, description, day, deadline_days, deadline_unit, channel, template_id, template_company_id, after_minutes, needs_release, statutory, assign_to, x, y, ordinal')
      .eq('id', step.node_id).maybeSingle(),
    admin.from('debtor_accounts')
      .select('*, companies(name, account_owner_id)')
      .eq('id', run.account_id).maybeSingle(),
    admin.from('firm_settings').select('*').maybeSingle(),
  ])
  const nodeRow = nodeRes.data
  const account = accountRes.data
  const firm = firmRes.data
  if (!nodeRow) return hold('The step this run was built from is no longer in the workflow.')
  if (!account) return hold('The account this run belongs to could not be read.')
  if (!firm) {
    return hold('The firm’s own details have not been filled in, so a notice cannot be addressed.', {
      accountId: account.id as string, collectorId: (account.assigned_to as string) ?? null,
      debtorName: debtorNameOf(account), caseNumber: (account.case_number as string) ?? null,
      stepLabel: (nodeRow.label as string) ?? 'A workflow step',
    })
  }

  const node = toNode(nodeRow)

  const [contactsRes, collectorRes, liaisonRes, templatesRes, ledgerRes, priorRes] = await Promise.all([
    admin.from('account_contacts').select('kind, value, is_primary, retired_at').eq('account_id', account.id),
    account.assigned_to
      ? admin.from('profiles').select('id, name, phone, email, whatsapp').eq('id', account.assigned_to).maybeSingle()
      : Promise.resolve({ data: null }),
    account.companies?.account_owner_id
      ? admin.from('profiles').select('id, name, phone, email, whatsapp').eq('id', account.companies.account_owner_id).maybeSingle()
      : Promise.resolve({ data: null }),
    admin.from('message_templates')
      .select('id, kind, subject, body, audience, name, attachment_id')
      .in('id', [node.templateId, node.templateCompanyId].filter(Boolean) as string[]),
    ledgersFor(admin, account.id),
    /* Did the step this one follows actually go? Only asked where the node says it follows one --
       `afterMinutes` is what carries that, and the handover SMS is the reason it exists. */
    node.afterMinutes === null
      ? Promise.resolve({ data: null })
      : admin.from('workflow_run_steps').select('state')
        .eq('run_id', step.run_id).eq('due_on', step.due_on).neq('id', step.id)
        .order('state').limit(1).maybeSingle(),
  ])

  const collector = collectorRes.data
  /*
   * THE MAILBOX THE MESSAGE LEAVES BY, and it is the collector's.
   *
   * The wording names them -- "{{collector_name}} will contact you" -- and invites a reply to
   * them, so a reply must land where they will see it. Sent from a firm-wide mailbox instead, a
   * debtor's answer arrives somewhere nobody is reading on behalf of this account.
   *
   * HELD, NEVER SENT FROM SOMEBODY ELSE'S NAME. An account with no collector, or a collector with
   * no connected mailbox, is a thing a team leader can put right in a minute; a statutory demand
   * signed by the wrong person is not.
   */
  if (node.channel === 'email' && !collector?.id) {
    return hold(
      'Nobody is assigned to this account, so there is no mailbox for the notice to go out from.',
      about(account, node.label, null),
    )
  }

  const rows = (templatesRes.data ?? []) as TemplateRow[]
  const attachments = await lettersFor(admin, rows)
  const asStepTemplate = (id: string | null): StepTemplate | null => {
    const r = rows.find((t) => t.id === id)
    if (!r) return null
    return {
      id: r.id, kind: r.kind, subject: r.subject, body: r.body, audience: r.audience,
      attachment: r.attachment_id
        ? (attachments.get(r.attachment_id) ?? null)
        : null,
    }
  }

  /* THE BALANCE THE NOTICE QUOTES, through the one place that arithmetic lives. A second
     implementation here would eventually disagree with the statement the debtor is holding. */
  const balance = computeBalance({
    capitalHandedOver: Number(account.capital_handed_over ?? 0),
    handoverDate: account.opening_as_at ?? null,
    ledgers: ledgerRes,
    inDuplum: true,
    interestRateAnnual: account.interest_rate_annual ? Number(account.interest_rate_annual) : undefined,
    accrueTo: today,
  })

  const values = accountMergeValues({
    account: {
      caseNumber: account.case_number ?? null,
      handoverDate: account.opening_as_at ?? null,
      paymentsToDate: balance.payments,
      listingDate: account.listing_date ?? null,
      listingReference: account.listing_reference ?? null,
      bureausListed: account.bureaus_listed ?? null,
      debtorKind: account.debtor_kind === 'company' ? 'company' : 'individual',
      debtorTitle: account.debtor_title ?? null,
      debtorFirstName: account.debtor_first_name ?? null,
      debtorSurname: account.debtor_surname ?? null,
      accountNumber: account.account_number ?? null,
      clientReference: account.client_reference ?? null,
      capitalOutstanding: Number(account.capital_outstanding ?? 0),
      preferredLanguage: account.preferred_language ?? null,
    },
    balance: balance.balance,
    clientName: account.companies?.name ?? null,
    /* No one is at a keyboard, so the agent IS the collector -- see accountMergeValues. */
    agent: collector,
    collector,
    liaison: liaisonRes.data,
    debtorIdNumber: account.debtor_id_number ?? null,
    contacts: (contactsRes.data ?? []).map((c: ContactRow) => ({
      kind: c.kind, value: c.value, isPrimary: c.is_primary, retiredAt: c.retired_at,
    })),
    firm: firm as never,
    today,
    money: moneyZa,
  })

  const contacts = (contactsRes.data ?? []) as ContactRow[]
  const plan = planSend({
    node,
    individual: asStepTemplate(node.templateId),
    company: asStepTemplate(node.templateCompanyId),
    debtor: {
      kind: account.debtor_kind === 'company' ? 'company' : 'individual',
      email: pickContact(contacts, 'email'),
      mobile: pickContact(contacts, 'mobile') ?? pickContact(contacts, 'phone'),
    },
    values,
    dueOn: step.due_on,
    afterStepSent: node.afterMinutes === null
      ? undefined
      : priorRes.data?.state === 'sent',
  })

  if (!plan.can) return hold(plan.note ?? 'This step cannot go out yet.', about(account, node.label, collector?.id ?? null))

  /* ---------- it goes ---------- */

  const sentAt = new Date().toISOString()
  if (node.channel === 'sms') {
    /* Not null: planSend already refused with `no_address` if there were no number, and this is
       past that. Named here rather than resolved twice, so the number that was sent to and the
       number that is recorded cannot be different ones. */
    const number = pickContact(contacts, 'mobile') ?? pickContact(contacts, 'phone') ?? ''
    try {
      /* It THROWS on a refusal -- SmsError -- rather than returning a flag, so the catch below is
         the whole error path. `reference` is what the provider quotes back on the delivery
         report, so a DLR can be matched to the step that sent it, not only to the account. */
      await sendSms({ to: toMsisdn(number) ?? number, text: plan.body, reference: step.id })
    } catch (e) {
      /* THE PROVIDER REFUSED, which is not something a collector fixes by filling in a field.
         `failed` rather than `held`, so it reads as a fault rather than as waiting on somebody. */
      const why = e instanceof Error ? e.message : String(e)
      await admin.from('workflow_run_steps').update({ state: 'failed', note: why }).eq('id', step.id)
      return { result: 'failed', note: why }
    }
    await admin.from('sms_messages').insert({
      account_id: account.id, direction: 'outbound', msisdn: number,
      body: plan.body, segments: plan.charge?.segments ?? 1,
      /* The same reference the provider was given, so its delivery report finds this row. */
      reference: step.id, sent_at: sentAt,
    })
  } else {
    /*
     * THE NOTICE IS DRAWN HERE, not fetched: a PDF built at the moment of sending quotes the
     * balance and the dates as they are TODAY, which is what the covering email says it does.
     * Charter's four faces are fetched from the deployment's own origin -- see fonts.ts -- and a
     * failure falls back to Times rather than refusing, because a notice in the wrong serif went
     * out and a notice that would not attach did not.
     */
    const files = []
    if (plan.template?.attachment) {
      const bytes = await letterToPdf({
        doc: plan.template.attachment.doc,
        page: A4_LETTERHEAD,
        filled: true,
        values,
        charter: await charterFor(),
      })
      files.push({
        filename: letterFilename(plan.template.attachment.key, values.case_number ?? null),
        content: Buffer.from(bytes),
        contentType: 'application/pdf',
      })
    }
    const sent = await sendAsUser(admin, collector!.id, {
      to: pickContact(contacts, 'email')!,
      subject: plan.subject ?? '',
      /* THE FIRM'S PARAGRAPHING. A blank line is a paragraph and a single newline is a line --
         emailBodyHtml is the one place that is decided, and it escapes, which matters on a
         debtor called "Smit & Seun". */
      bodyHtml: emailBodyHtml(plan.body),
      attachments: files,
    })
    if (!sent.ok) {
      await admin.from('workflow_run_steps').update({ state: 'failed', note: sent.error }).eq('id', step.id)
      return { result: 'failed', note: sent.error }
    }
  }

  /*
   * THE FEE IS RAISED AFTER THE PROVIDER ACCEPTED, and in that order for the reason
   * api/_lib/sms/send.ts gives: a fee for a message that never left is worse than a message with
   * no fee. The first is a charge the firm cannot justify; the second is a bookkeeping gap.
   *
   * ON THE ACCOUNT, WHICH IS THE ONLY PLACE FEES ARE RAISED. A workflow runs on an account and on
   * nothing else, so there is no lead or deal this could reach -- said out loud because the next
   * person here will be looking at a campaign over a list.
   */
  if (plan.charge) {
    await admin.from('account_fees').insert({
      account_id: account.id,
      description: node.label,
      annexure_item: plan.charge.item,
      amount_excl_vat: plan.charge.rand,
      /* OMITTED ON AN EMAIL, not passed as null: `segments` is NOT NULL with a default of 1, and
         an explicit null overrides a default rather than falling back to it. Probed -- the fee
         insert was refused outright, which would have left a sent notice with no charge against
         it, on the one table nobody can correct afterwards. */
      ...(plan.charge.segments === null ? {} : { segments: plan.charge.segments }),
      /* `incurred_at` is the column, and the ACTION's time is what goes in it -- the same date
         planSend priced the charge on. A fee stamped with the moment the cron happened to run
         would eventually be priced on one schedule and dated into another. */
      incurred_at: sentAt,
      source: 'workflow',
    })
  }

  await admin.from('workflow_run_steps')
    .update({ state: 'sent', sent_at: sentAt, note: null })
    .eq('id', step.id)

  /* The run is over when nothing is waiting. Checked here rather than on a timer, because the
     step that just went is the only thing that can have changed the answer. */
  const { data: left } = await admin.from('workflow_run_steps')
    .select('id').eq('run_id', step.run_id).in('state', ['pending', 'held', 'failed']).limit(1)
  if ((left ?? []).length === 0) {
    await admin.from('workflow_runs').update({ state: 'finished' }).eq('id', step.run_id)
  }

  return { result: 'sent', note: null }
}

/** What a notification needs to name the account, gathered once rather than at each hold. */
function about(account: Record<string, unknown>, stepLabel: string, collectorId: string | null) {
  return {
    accountId: account.id as string,
    collectorId: collectorId ?? ((account.assigned_to as string) ?? null),
    debtorName: debtorNameOf(account),
    caseNumber: (account.case_number as string) ?? null,
    stepLabel,
  }
}

/**
 * What the debtor is called, in a sentence somebody reads off a bell without opening anything.
 *
 * A COMPANY IS NOT A "FIRST NAME". The book holds a company's registered name in the surname
 * field -- there is nowhere else for it to go -- so joining the two parts is right either way,
 * and for a company the first part is simply empty.
 */
function debtorNameOf(account: Record<string, unknown>): string | null {
  const name = [account.debtor_first_name, account.debtor_surname]
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean).join(' ')
  return name || null
}

/* ---------------------------------------------------------------- the gathering */

interface ContactRow {
  kind: string; value: string | null; is_primary: boolean | null; retired_at: string | null
}
interface TemplateRow {
  id: string; kind: 'sms' | 'email' | 'call_script' | 'letter'
  subject: string | null; body: string
  audience: 'individual' | 'company' | null
  name: string; attachment_id: string | null
}

/** The primary live contact of a kind, never a retired one -- the same rule as the address. */
function pickContact(contacts: ContactRow[], kind: string): string | null {
  const live = contacts.filter((c) => c.kind === kind && !c.retired_at)
  const pick = live.find((c) => c.is_primary) ?? live[0]
  return (pick?.value ?? '').trim() || null
}

/** The notices these templates post, read once and parsed once. */
async function lettersFor(admin: SupabaseClient, rows: TemplateRow[]) {
  const ids = [...new Set(rows.map((r) => r.attachment_id).filter(Boolean))] as string[]
  const out = new Map<string, { key: string; doc: LetterDocument }>()
  if (ids.length === 0) return out
  const { data } = await admin.from('message_templates').select('id, name, body, seed_key').in('id', ids)
  for (const row of data ?? []) {
    try {
      out.set(row.id, { key: (row.seed_key as string) ?? (row.name as string), doc: JSON.parse(row.body as string) })
    } catch {
      /* A notice whose JSON will not parse is one planSend must refuse rather than one this
         should throw over -- left out of the map, the step holds with "cannot be sent". */
    }
  }
  return out
}

/**
 * The three ledgers computeBalance reads, in the shape it reads them.
 *
 * COLUMN NAMES COPIED FROM accountBook's own select, not guessed. Seven of the first draft's were
 * wrong -- `paid_on` for `received_at`, `raised_at` for `incurred_at`, `period_from` for
 * `accrued_on`, `amount` for `amount_accrued` -- and PostgREST answers an unknown column with an
 * error rather than a null, so every one of them would have thrown on the first real morning.
 *
 * A REVERSED PAYMENT IS NOT A PAYMENT. Filtered here exactly as the account screen filters it, or
 * a notice quotes a balance that a reversal has already put back.
 */
async function ledgersFor(admin: SupabaseClient, accountId: string) {
  const [payments, fees, accruals] = await Promise.all([
    admin.from('account_payments')
      .select('received_at, amount, paid_to_client, reversed_at, collection_commission')
      .eq('account_id', accountId).order('received_at'),
    admin.from('account_fees')
      .select('incurred_at, description, amount_excl_vat, vat_amount, billed, segments, cancelled_at')
      .eq('account_id', accountId).order('incurred_at'),
    admin.from('account_interest_accruals')
      .select('accrued_on, days, amount_accrued')
      .eq('account_id', accountId).order('accrued_on'),
  ])
  return {
    payments: (payments.data ?? [])
      .filter((p) => !p.reversed_at)
      .map((p) => ({
        date: (p.received_at as string).slice(0, 10),
        amount: Number(p.amount ?? 0),
        paidToClient: Boolean(p.paid_to_client),
        commissionExclVat: p.collection_commission === null ? null : Number(p.collection_commission),
      })),
    fees: (fees.data ?? [])
      /* A cancelled fee is one somebody took off the account. Left in, the notice quotes a
         balance higher than the statement beside it. */
      .filter((f) => !f.cancelled_at)
      .map((f) => ({
        date: (f.incurred_at as string).slice(0, 10),
        at: f.incurred_at as string,
        description: (f.description as string) ?? '',
        exclVat: Number(f.amount_excl_vat ?? 0),
        vat: Number(f.vat_amount ?? 0),
        billed: Boolean(f.billed),
        segments: f.segments === null ? undefined : Number(f.segments),
      })),
    interest: (accruals.data ?? []).map((i) => ({
      from: i.accrued_on as string,
      days: Number(i.days ?? 0),
      amount: Number(i.amount_accrued ?? 0),
    })),
  }
}

/** The row PostgREST hands back, in the shape workflowBuilder describes. */
function toNode(r: Record<string, unknown>) {
  return {
    id: r.id as string,
    phaseId: (r.phase_id as string) ?? null,
    key: r.key as string,
    kind: r.kind as never,
    label: r.label as string,
    description: (r.description as string) ?? null,
    day: r.day as number,
    deadlineDays: (r.deadline_days as number) ?? null,
    deadlineUnit: (r.deadline_unit as never) ?? null,
    channel: (r.channel as never) ?? null,
    templateId: (r.template_id as string) ?? null,
    templateCompanyId: (r.template_company_id as string) ?? null,
    afterMinutes: (r.after_minutes as number) ?? null,
    needsRelease: Boolean(r.needs_release),
    statutory: Boolean(r.statutory),
    assignTo: (r.assign_to as string) ?? null,
    x: (r.x as number) ?? null,
    y: (r.y as number) ?? null,
    ordinal: (r.ordinal as number) ?? 0,
  }
}
