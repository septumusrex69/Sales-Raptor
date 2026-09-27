import type { SupabaseClient } from '@supabase/supabase-js'
import { sendAsUser } from '../email/sendAsUser.js'
import { sendSms, toMsisdn } from '../sms/connectMobile.js'
import { accountMergeValues } from '../../../src/lib/accountMergeValues.js'
import { computeBalance } from '../../../src/lib/accountBalance.js'
import { planSend, type StepTemplate } from '../../../src/lib/workflowSend.js'
import { letterToPdf, letterFilename } from '../../../src/lib/letterPdf.js'
import { emailBodyHtml } from '../../../src/lib/emailStyle.js'
import { A4_LETTERHEAD, type LetterDocument } from '../../../src/lib/letterDocument.js'
import { charterFor } from './fonts.js'
import { moneyZa } from './locale.js'
import { toSettings as toFirmSettings } from '../../../src/lib/firmSettingsRow.js'
import { notifyHeld } from './notify.js'
import { nextUnpaidFromRow } from '../../../src/lib/ptpSchedule.js'
import {
  chargeItemWith, type ChargeDb, type ChargeResult,
} from '../../../src/lib/chargeEngine.js'

/** Why a message earned nothing, in the firm's words rather than the engine's enum. */
const CHARGE_REFUSED: Record<Exclude<ChargeResult['reason'], 'charged'>, string> = {
  'written-off': 'the account is written off',
  'item-total-spent': 'this item has nothing left on it',
  'monthly-limit': 'the monthly limit on this item is reached',
  'at-ceiling': 'in duplum -- fees and interest are at the capital outstanding',
}
import {
  disputeDaysPhrase, disputeWindow, noticeRespondBy,
} from '../../../src/lib/disputeWindow.js'
import { repaymentPlan, settlementLadder } from '../../../src/lib/repaymentPlan.js'
import { repaymentLetter, repaymentLetterRefusal } from '../../../src/lib/repaymentLetter.js'

/**
 * ONE STEP OF ONE RUN, DECIDED AND ACTED ON.
 *
 * Lifted out of the morning run because a person pressing "Send it now" on a held step has to
 * take exactly the same path -- the same guards, the same wording, the same fee, the same record.
 * Written twice, the button and the cron would drift, and the drift would show up as a debtor
 * charged differently depending on who happened to send the notice.
 *
 * WHAT IT DOES NOT DO IS DECIDE WHETHER IT MAY GO. `planSend` decides, and it is pure and
 * checked; this fetches what planSend needs, does what it says, and writes down what happened.
 * A release lifts one refusal inside planSend and nothing here changes at all.
 */
export interface DueStep {
  id: string
  node_id: string
  due_on: string
  /**
   * EVERY STATE, not only the two the morning run selects.
   *
   * The cron asks for pending and held; a release reads ONE step by its id, and that row may be
   * in any state at all -- which is exactly what the route has to check before it does anything.
   * Narrowed to the cron's two, the release route could not even ask "has this already gone?"
   * without the compiler calling the comparison unintentional.
   *
   * Only `!== 'held'` is read from it here, which is true of every value.
   */
  state: 'pending' | 'held' | 'sent' | 'cancelled' | 'failed'
  /** The reason already on it, if it is already held. What a new reason is compared against. */
  note: string | null
  run_id: string
  /**
   * WHICH INSTALMENT OF THE ARRANGEMENT THIS STEP IS ABOUT -- 0 where it is about the run.
   *
   * READ FOR ONE THING ONLY: finding the message this one goes out behind. Two steps of a pair
   * share a date AND an instalment, and on a weekly arrangement two DIFFERENT instalments' steps
   * can share the date, so the date alone would pair an SMS with the wrong email.
   *
   * WHAT THE NOTICE QUOTES IS NOT THIS. {{ptp_amount}} and {{ptp_date}} come from nextUnpaid --
   * the earliest instalment not yet paid, decided on the morning the message goes -- which is the
   * one definition ptpSchedule argues is right on all five arrangement notices. A step dated off
   * instalment 3 while instalment 2 is still owed should quote the one the debtor owes.
   *
   * OPTIONAL BECAUSE THE RELEASE ROUTE READS ONE STEP BY ID and its select is the narrow one; an
   * absent column reads as 0, which is what every step planned before instalments existed is.
   */
  instalment_no?: number
  workflow_runs: { id: string; account_id: string; version_id: string; started_on: string }
}

export type StepOutcome = {
  result: 'sent' | 'held' | 'stillHeld' | 'failed'
  note: string | null
  /** How many people were told, where this was news. */
  told?: number
}

export async function runOneStep(
  admin: SupabaseClient, step: DueStep, today: string,
  /**
   * WHO PRESSED THE BUTTON, WHERE ONE WAS PRESSED.
   *
   * Absent on the morning run, which is the ordinary case: nobody pressed anything, so
   * `needsRelease` steps stay held and `sent_by` stays null. Present on a release, where it does
   * two things -- lifts the one refusal in planSend that waits for a person, and puts a name
   * against the send. The second matters as much as the first: "who sent this section 129" is a
   * question asked long afterwards, and "the system" is not an answer.
   */
  releasedBy?: string,
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
      .select('id, phase_id, key, kind, label, description, day, deadline_days, deadline_unit, channel, template_id, template_company_id, after_minutes, needs_release, statutory, assign_to, x, y, ordinal, anchor, anchor_offset, anchor_unit')
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

  const [contactsRes, collectorRes, liaisonRes, templatesRes, ledgerRes, priorRes, promiseRes,
    disputeRes, noticesRes] = await Promise.all([
    admin.from('account_contacts').select('kind, value, is_primary, retired_at').eq('account_id', account.id),
    account.assigned_to
      ? admin.from('profiles').select('id, name, phone, email, whatsapp').eq('id', account.assigned_to).maybeSingle()
      : Promise.resolve({ data: null }),
    account.companies?.account_owner_id
      ? admin.from('profiles').select('id, name, phone, email, whatsapp').eq('id', account.companies.account_owner_id).maybeSingle()
      : Promise.resolve({ data: null }),
    admin.from('message_templates')
      .select('id, kind, subject, body, audience, name, attachment_id, attaches_schedule')
      .in('id', [node.templateId, node.templateCompanyId].filter(Boolean) as string[]),
    ledgersFor(admin, account.id),
    /* Did the step this one follows actually go? Only asked where the node says it follows one --
       `afterMinutes` is what carries that, and the handover SMS is the reason it exists. */
    node.afterMinutes === null
      ? Promise.resolve({ data: null })
      /* THE SAME DAY AND THE SAME INSTALMENT. The date alone was enough while every step was
         dated off the run; on a weekly arrangement the default three working days after
         instalment 1 and the reminder two working days before instalment 2 share a Thursday, and
         this SMS would then be waiting on the wrong email -- see slotOf in stepPairs.ts. */
      : admin.from('workflow_run_steps').select('state')
        .eq('run_id', step.run_id).eq('due_on', step.due_on)
        .eq('instalment_no', step.instalment_no ?? 0).neq('id', step.id)
        .order('state').limit(1).maybeSingle(),
    /*
     * THE LIVE ARRANGEMENT, WHICH IS WHAT {{ptp_amount}} AND {{ptp_date}} COME FROM.
     *
     * READ FOR EVERY STEP, NOT ONLY THE ARRANGEMENT'S OWN. A section 129 template does not quote
     * these fields, so on the collections sequence this row is fetched and unused -- one indexed
     * read against one account, against the alternative of the runner having to know which node
     * belongs to which sequence in order to decide what to load. Guessing that wrong is a notice
     * held on a placeholder it could have answered.
     *
     * `defaulted` COUNTS AS LIVE. It is the 48 hours the default letter promises, during which the
     * arrangement is still on its existing terms and a payment revives it -- so the letter and the
     * SMS that go out in that window must still be able to quote the instalment that was missed.
     */
    admin.from('promises_to_pay')
      .select('amount, due_on, arrangement, day_of_month, on_last_day, day_of_week, instalments_kept, total_promised')
      .eq('account_id', account.id).in('status', ['open', 'defaulted'])
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
    /*
     * THE OPEN DISPUTE, WHICH IS WHAT THE FOUR {{dispute_*}} FIELDS COME FROM.
     *
     * READ FOR EVERY STEP, for the same reason the arrangement above is: a section 129 does not
     * quote these fields and the read costs one indexed row, against the alternative of the runner
     * having to know which node belongs to which sequence before it can decide what to load.
     *
     * THE NEWEST OPEN ONE. A closed dispute is a finding already given, and a message about it
     * would quote a window that ran out; `alleged_on desc` rather than raised_at, because the
     * notice quotes the day the debtor SAID it and that is the date this is about.
     *
     * kind = 'dispute' AND NOT THE OTHER TWO. account_queries also carries 'help' -- an agent asking
     * a team leader -- and 'litigation'. Neither is something a debtor alleged, and merging either
     * into a notice would tell a debtor their account is disputed because a collector asked for
     * supervision.
     */
    admin.from('account_queries')
      .select('description, alleged_on, received_on')
      .eq('account_id', account.id).eq('kind', 'dispute').neq('status', 'closed')
      .order('alleged_on', { ascending: false, nullsFirst: false })
      .limit(1).maybeSingle(),
    /*
     * THE STATUTORY NOTICES ALREADY SENT ON THIS ACCOUNT, and their own periods, which is what the
     * dispute window is measured against.
     *
     * STATUTORY ONLY, and that is the filter that matters. A dispute message must not reset the
     * clock the section 129 started -- but nor may the dispute REQUEST become the notice the next
     * one is measured against, and it declares a ten-day period of its own. `statutory` is the
     * column that separates "a notice the Act or the mandate requires" from a letter the firm chose
     * to send, so it is the one asked here.
     *
     * ACROSS EVERY RUN ON THE ACCOUNT, not only this one: the demand and the dispute sequence are
     * two different runs by design, and the window belongs to the account rather than to a run.
     */
    admin.from('workflow_run_steps')
      .select('sent_at, workflow_nodes!inner(deadline_days, deadline_unit, statutory), workflow_runs!inner(account_id)')
      .eq('workflow_runs.account_id', account.id)
      .eq('workflow_nodes.statutory', true)
      .eq('state', 'sent'),
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
      /*
       * THE SCHEDULE FIRST, where the wording asks for one. A row carrying both is not a case the
       * library can produce -- the schedule is on two arrangement emails and neither names a letter
       * -- and if it ever were, the built one is the one that is about THIS account.
       *
       * Handed over as a document rather than as bytes, exactly like a stored letter, so everything
       * downstream is unchanged: planSend reads its merge fields, letterProblems refuses it if the
       * account cannot fill them, and the same code draws the PDF.
       */
      attachment: r.attaches_schedule && scheduleDoc
        ? { key: 'Payment arrangement schedule', doc: scheduleDoc }
        : r.attachment_id
          ? (attachments.get(r.attachment_id) ?? null)
          : null,
    }
  }

  /*
   * THE ACCOUNT AS THE ARITHMETIC SEES IT, named once.
   *
   * The balance the notice quotes and the projection the repayment schedule is drawn from are the
   * SAME position -- written out twice they would eventually disagree, and the two people who would
   * compare them are the debtor holding the schedule and the collector reading the notice.
   */
  const position = {
    capitalHandedOver: Number(account.capital_handed_over ?? 0),
    handoverDate: account.opening_as_at ?? null,
    ledgers: ledgerRes,
    inDuplum: true,
    interestRateAnnual: account.interest_rate_annual ? Number(account.interest_rate_annual) : undefined,
  }
  /* THE BALANCE THE NOTICE QUOTES, through the one place that arithmetic lives. A second
     implementation here would eventually disagree with the statement the debtor is holding. */
  const balance = computeBalance({ ...position, accrueTo: today })

  /*
   * THE ACCOUNT'S OWN REPAYMENT SCHEDULE, where the wording being sent carries one.
   *
   * THE FIRM: "put it in the emails for this payment arrangement schedule... maybe it just goes out
   * automatically once the payment has been recorded." So the arrangement confirmation now leaves
   * with a page showing what the arrangement will cost, what it would cost paid faster, and how far
   * the debtor already is -- built here because it cannot be a stored template: its length is the
   * answer. See message_templates.attaches_schedule.
   *
   * NULL RATHER THAN A HOLD WHERE IT CANNOT BE BUILT. Three honest cases -- no arrangement on the
   * account, an offer that never clears it, one that outruns the horizon -- and in all three the
   * confirmation itself is still true and worth sending. Holding the step would stop a debtor being
   * told their arrangement is confirmed because an illustration of it could not be drawn.
   *
   * BUILT ONCE, whichever audience the node resolves to: the schedule is about the account and the
   * money, and there is no individual and company version of arithmetic.
   */
  const scheduleDoc = (() => {
    const promise = promiseRes.data
    if (!promise || !promise.arrangement || !promise.due_on) return null
    if (!(Number(promise.amount) > 0)) return null
    const recurring = {
      arrangement: promise.arrangement as 'once_off' | 'weekly' | 'monthly',
      dueOn: promise.due_on as string,
      dayOfMonth: (promise.day_of_month as number | null) ?? null,
      onLastDay: Boolean(promise.on_last_day),
      dayOfWeek: (promise.day_of_week as number | null) ?? null,
    }
    const plan = repaymentPlan({
      account: position, instalment: Number(promise.amount), schedule: recurring,
    })
    /* The same refusal the collector's own panel shows, so a schedule the screen would not offer is
       not one the runner quietly posts. */
    if (repaymentLetterRefusal(plan) !== null) return null
    return repaymentLetter({
      plan,
      /* A SCHEDULE HERE, NOT A SIMULATION, and it is the only caller that says so. This one rides
         with the CONFIRMATION -- the arrangement has been agreed and recorded, and a page headed
         "payment simulation" would read as the firm still weighing up what it had just agreed to.
         The calculator's copy goes out mid-negotiation and is the other one. */
      purpose: 'schedule',
      money: moneyZa,
      each: recurring.arrangement === 'weekly' ? 'a week' : 'a month',
      balanceToday: balance.balance,
      faster: settlementLadder({ account: position, schedule: recurring }, plan),
      paidSoFar: balance.payments,
    })
  })()

  /*
   * HOW LONG THE DEBTOR HAS, worked out before the merge because two fields come out of it.
   *
   * Computed even where there is no dispute -- disputeWindow is arithmetic on two dates and costs
   * nothing -- and then offered only where there is one, so the 'fresh' ten days of an account
   * with no demand cannot leak onto a notice that is not about a dispute at all.
   */
  const window = disputeWindow(today, noticeRespondBy(
    ((noticesRes.data ?? []) as unknown as NoticeStepRow[]).flatMap((r) => {
      /* A step with no sent_at is not a sent step, whatever its state column says. */
      const sentOn = r.sent_at ? r.sent_at.slice(0, 10) : null
      if (!sentOn) return []
      const n = oneOf(r.workflow_nodes)
      return [{
        sentOn,
        deadlineDays: n?.deadline_days ?? null,
        deadlineUnit: n?.deadline_unit ?? null,
      }]
    }),
  ))

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
    /*
     * MAPPED, NEVER CAST. The row is snake_case and FirmSettings is camelCase, so passing the
     * raw row through `as never` made `firmName` and `officeHours` undefined -- and every notice
     * held on "{{firm_name}} and {{firm_hours}}" while the firm's own details sat correctly in
     * the table. The cast silenced the compiler on the one thing it could have caught.
     */
    firm: toFirmSettings(firm as never),
    today,
    money: moneyZa,
    /* THE EARLIEST INSTALMENT NOT YET PAID, decided by ptpSchedule and nowhere else -- which on a
       default letter is the one that was MISSED, and is what makes "has not reached our trust
       account" a true sentence rather than a demand for money not yet owed. */
    nextInstalment: nextUnpaidFromRow(promiseRes.data),
    /*
     * WHAT A RECEIPT CONFIRMS: the newest unreversed payment, off the ledger the balance above it
     * already came from -- so the figure the debtor is thanked for and the balance under it cannot
     * disagree. `ledgersFor` has already dropped the reversed ones, and they are ordered by
     * received_at, so the last is the newest.
     */
    paymentReceived: ledgerRes.payments.at(-1)?.amount ?? null,
    /*
     * THE DISPUTE, AND THE DATE ITS MESSAGES QUOTE.
     *
     * `daysLeft` ARRIVES AS A PHRASE, not a number: disputeDaysPhrase decides how a period reads,
     * singular included, and a second place deciding that is a template that says "6 business days
     * days".
     *
     * AND THE WINDOW IS COMPUTED ONCE FOR BOTH. `respondByOverride` and `daysLeft` come out of the
     * same disputeWindow call, so the count and the date cannot disagree -- which is the whole
     * point of the override: while a demand is running the debtor has what is LEFT of ITS period
     * and must be given ITS date, and two dates days apart under one heading is an ambiguity a
     * debtor is entitled to resolve in their own favour.
     *
     * NULL WHERE THERE IS NO DISPUTE, which leaves the placeholders standing and holds the step --
     * correct, because a dispute message merged against an account with no dispute on it would tell
     * a debtor they have until nothing to send their documents.
     */
    dispute: disputeRes.data
      ? {
        daysLeft: disputeDaysPhrase(window.days),
        allegedOn: disputeRes.data.alleged_on ?? null,
        receivedOn: disputeRes.data.received_on ?? null,
        summary: disputeRes.data.description ?? null,
      }
      : null,
    respondByOverride: disputeRes.data ? window.respondBy : null,
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
    /* Lifts the wait-for-a-person refusal and nothing else. Every other guard still applies to
       whoever pressed the button -- a release cannot supply a missing listing reference. */
    released: Boolean(releasedBy),
    afterStepSent: node.afterMinutes === null
      ? undefined
      : priorRes.data?.state === 'sent',
  })

  if (!plan.can) return hold(plan.note ?? 'This step cannot go out yet.', about(account, node.label, collector?.id ?? null))

  /* ---------- it goes ---------- */

  const sentAt = new Date().toISOString()
  /* The account_emails row this send files, so the fee raised further down can correct the price
     written on it. Null on an SMS, and on an email whose filing failed. */
  let filedEmailId: string | null = null
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

    /*
     * FILED AS THE ACCOUNT'S OWN CORRESPONDENCE.
     *
     * The firm, on an account whose handover had gone out: the Emails tab read "No email with
     * this debtor yet" while the same account carried an R25 charge under item 1(a) for sending
     * one. Every by-hand send writes this row; the workflow did not, so a notice the firm has
     * billed for was nowhere in the account's correspondence.
     *
     * ON THE ACCOUNT, NOT ON A MAILBOX. account_emails is keyed by account and readable by anyone
     * signed in -- which is what makes it survive a reallocation, where a copy sitting only in
     * the sender's own mailbox does not. That is the whole difference between the two, and this
     * is the side that outlives whoever happened to be holding the file.
     *
     * THE MESSAGE ID IS RECORDED so the debtor's reply threads onto this message rather than
     * arriving as an unrelated one; the mailbox the message LEFT BY is recorded for the reason
     * sendAsUser gives about somebody leaving the firm.
     *
     * NEVER FAILS THE SEND. The message has gone and the fee is about to be raised; a red error
     * after a debtor has in fact been written to would be false.
     */
    const { data: filed, error: fileError } = await admin.from('account_emails').insert({
      account_id: account.id,
      direction: 'out',
      debtor_address: pickContact(contacts, 'email'),
      our_address: sent.from,
      subject: plan.subject ?? '',
      body: plan.body,
      message_id: sent.messageId,
      sent_by: collector?.id ?? null,
      /* The workflow did this, not a person -- and it says so, because "sent by Itumeleng" on a
         notice nobody typed would be wrong about who to ask. */
      sent_by_name: 'Workflow',
      /*
       * THE TARIFF PRICE FOR NOW, CORRECTED BELOW ONCE THE FEE IS ACTUALLY RAISED.
       *
       * The row is filed here because the message has just gone and losing the record of it is
       * worse than any figure on it; the charge cannot happen yet, because it needs the send to
       * have succeeded. So this is the best number available at this line -- and it is not always
       * the true one, which is what `filedEmailId` is for.
       */
      charged_excl_vat: plan.charge?.rand ?? 0,
    }).select('id').maybeSingle()
    if (fileError) {
      console.error(`[workflow] ${step.id}: the notice went but was not filed: ${fileError.message}`)
    }
    filedEmailId = (filed?.id as string) ?? null
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
  /*
   * THROUGH THE CHARGE ENGINE, WHICH IS WHAT EVERY OTHER FEE IN RAPTOR GOES THROUGH.
   *
   * THE FIRM: "I also sent the section 129 number. It doesn't record the fees associated." The fee
   * WAS recorded -- and it was recorded wrong, in four ways at once, because this wrote the row by
   * hand instead of asking chargeItemWith:
   *
   *   NO VAT. `vat_amount` was never set, so it took the column default of nought while
   *     `vat_rate` said 15. Every notice the workflow sent charged R25.00 where the same email sent
   *     by hand charges R28.75. The firm's own money, on every message, since the runner was built.
   *   NO IN DUPLUM CEILING. recoverableFee trims the fee that crosses the line and writes
   *     everything after it at nought, not billed -- s103(5), and this ignored it.
   *   NO MONTHLY CAP. Item 1(c) is ten SMSs a month; this would have raised an eleventh.
   *   NO TARIFF DATE. `tariff_effective_from` was null, so a fee could not be read back against the
   *     schedule it was priced on.
   *
   * THE ENGINE PRICES IT TOO, so plan.charge.rand is now only the QUOTE the step drawer shows. The
   * two agree -- both call itemAmountFor on scheduleFor(the action's date) -- and where they differ
   * it is because a cap bit, which is the engine being right.
   *
   * THE FEE IS STILL RAISED AFTER THE PROVIDER ACCEPTED, and in that order for the reason
   * api/_lib/sms/send.ts gives: a fee for a message that never left is worse than a message with
   * no fee. The first is a charge the firm cannot justify; the second is a bookkeeping gap.
   *
   * ON THE ACCOUNT, WHICH IS THE ONLY PLACE FEES ARE RAISED. A workflow runs on an account and on
   * nothing else, so there is no lead or deal this could reach -- said out loud because the next
   * person here will be looking at a campaign over a list.
   */
  let fee: ChargeResult | null = null
  if (plan.charge) {
    fee = await chargeItemWith(admin as unknown as ChargeDb, {
      accountId: account.id as string,
      itemId: plan.charge.item,
      /* The catalogue code the timeline draws an icon from, and what reconciliation groups on. It
         was null on every workflow fee, which is why they had no icon. */
      actionCode: node.channel === 'sms' ? 'sms' : 'email_out',
      description: node.label,
      /* SEGMENTS ARE THE QUANTITY. One row at the segment rate, not one row per segment -- a
         statement is read by a debtor. Null on an email, which is priced per message, so one. */
      quantity: plan.charge.segments ?? 1,
      /* THE ACTION'S OWN MOMENT, not when the sweep happened to run: the engine prices on
         scheduleFor(at), so a fee stamped with the cron's clock would eventually be priced on one
         schedule and dated into another. */
      at: new Date(sentAt),
      createdBy: releasedBy ?? null,
      /* WHICH FEES THE RUNNER RAISED stays answerable. The engine stamps 'raptor' by default,
         which is right for a person doing something; these are the sweep, and losing that would
         make "what did the workflow charge this month" a question nothing can answer. */
      source: 'workflow',
    })
  }

  /*
   * AND THE FILED EMAIL IS TOLD WHAT IT ACTUALLY COST.
   *
   * IT WAS WRITTEN WITH THE TARIFF PRICE, which is what the schedule says an email is worth and
   * not always what the account was charged. The engine can lawfully return less or nothing at
   * all: in duplum caps the non-capital at the capital outstanding, and item 1(c) caps SMSs at
   * ten a month. On an account already at its ceiling every workflow email read R25.00 in the
   * account's own email list while the ledger beside it recorded R0.00 -- two figures about one
   * message, and the one on the screen was the wrong one.
   *
   * THE LEDGER IS THE TRUTH and this makes the list agree with it. Only where they differ, so the
   * ordinary send is one write as before.
   */
  if (filedEmailId && fee && fee.exclVat !== (plan.charge?.rand ?? 0)) {
    await admin.from('account_emails')
      .update({ charged_excl_vat: fee.exclVat })
      .eq('id', filedEmailId)
  }

  await admin.from('workflow_run_steps')
    .update({ state: 'sent', sent_at: sentAt, sent_by: releasedBy ?? null, note: null })
    .eq('id', step.id)

  /*
   * AND IT GOES ON THE ACCOUNT'S OWN TIMELINE.
   *
   * The firm, looking at an account whose handover had gone out: "I don't see that there's any
   * charges for any SMS nor any notes for the workflow that has gone out."
   *
   * The charges WERE raised -- items 1(a) and 1(c), correctly -- but the only trace of any of it
   * was a fee row and a tick inside the workflow panel. The collector's timeline, which is the
   * thing somebody actually reads before picking up the telephone, said nothing had happened.
   *
   * SAME TABLE AND SAME SOURCE AS EVERYTHING ELSE, so the collector reads one timeline rather
   * than two -- the reason the by-hand debtor note was put there too.
   *
   * IT NAMES THE CHARGE. A fee the debtor will be asked to pay should be legible where the action
   * is, not only in a total on the position panel.
   */
  /*
   * WHAT WAS ACTUALLY CHARGED, not what was quoted.
   *
   * This printed plan.charge.rand -- the QUOTE the step drawer shows -- so on an account at the in
   * duplum ceiling the timeline said "R25.00 raised" beside a fee row of nought. Now it reads the
   * engine's own answer.
   *
   * AND IT SAYS WHEN NOTHING WAS CHARGED, rather than going quiet. A notice that earned the firm
   * nothing is a fact a collector should be able to see on the account -- and "the ceiling" and
   * "ten SMSs this month already" are different facts with different answers.
   */
  const charged = fee === null
    ? ''
    : fee.reason === 'charged'
      ? ` R${(fee.exclVat + fee.vat).toFixed(2)} raised under item ${plan.charge?.item ?? ''}.`
      : ` No charge: ${CHARGE_REFUSED[fee.reason]}.`
  /* The same fallback the SMS send itself uses, or the note names a number the message did not
     go to on an account whose only number is filed as a landline. */
  const toWhom = node.channel === 'sms'
    ? (pickContact(contacts, 'mobile') ?? pickContact(contacts, 'phone'))
    : pickContact(contacts, 'email')
  await admin.from('account_notes').insert({
    account_id: account.id,
    body: `${node.label} sent${toWhom ? ` to ${toWhom}` : ''}.${charged}`,
    author_name: 'Workflow',
    created_by: releasedBy ?? null,
    source: 'workflow',
  })

  /*
   * AND THE ACCOUNT COUNTS AS WORKED.
   *
   * `last_action_at` is what the client-facing narrative reads to decide whether anybody has been
   * in touch, and what "Gone quiet" and "never worked" are filtered on. The firm: "the status is
   * not correct -- it says no contact attempt has been made yet, however the handover messages
   * already went out."
   *
   * Two notices to a debtor is a contact attempt by any reading, so the account is stamped. Dated
   * with the ACTION rather than with now, for the same reason the fee is.
   */
  await admin.from('debtor_accounts')
    /*
     * THE FIRM'S DATE, NOT THE SERVER'S. last_action_at is a DATE, and sentAt is a UTC timestamp:
     * an action at one in the morning in Johannesburg is eleven the previous night in UTC, so
     * casting it would file the work under yesterday. `today` is already the firm's own day --
     * the runner computes it once for exactly this reason.
     */
    .update({ last_action_at: today })
    .eq('id', account.id)

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
/**
 * A SENT STATUTORY STEP AND THE PERIOD ITS NODE DECLARED, which is what the dispute window is
 * measured against. The embedded node comes back as an object on a !inner join, and PostgREST types
 * it as unknown, so it is named here rather than cast at the call site.
 */
interface NoticeStepRow {
  sent_at: string | null
  /*
   * ONE OR MANY, AND THE CODE MUST NOT CARE WHICH. PostgREST returns a single OBJECT for a
   * many-to-one embed like a step's node, while the untyped client infers an array -- so a type that
   * commits to either is wrong somewhere, and a cast would be a guess about the shape rather than a
   * statement about it. `oneOf` below reads both, which also survives the day this becomes a
   * to-many join.
   */
  workflow_nodes: NoticeNode | NoticeNode[] | null
}
interface NoticeNode {
  deadline_days: number | null
  deadline_unit: 'calendar' | 'business' | null
}
const oneOf = (v: NoticeNode | NoticeNode[] | null): NoticeNode | null =>
  (Array.isArray(v) ? (v[0] ?? null) : v)
interface TemplateRow {
  id: string; kind: 'sms' | 'email' | 'call_script' | 'letter'
  subject: string | null; body: string
  audience: 'individual' | 'company' | null
  name: string; attachment_id: string | null
  /** True where this wording carries the account's own repayment schedule. See the column's own
      comment: it is built per account, so there is no template to point `attachment_id` at. */
  attaches_schedule: boolean | null
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
    /* Which clock dated the step. Nothing here READS it -- what a notice quotes is the earliest
       unpaid instalment, decided by nextUnpaid on the morning it goes -- but the mapper lists
       every column by hand, and CLAUDE.md's standing hazard is the one it leaves out. */
    anchor: (r.anchor as never) ?? 'run',
    anchorOffset: (r.anchor_offset as number) ?? null,
    anchorUnit: (r.anchor_unit as never) ?? null,
  }
}
