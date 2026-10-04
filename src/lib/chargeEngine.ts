/**
 * Raising a fee against an account — the arithmetic and the writes, with the database handed in.
 *
 * Split out of accountCharges.ts so the same code can run in two places. The browser charges
 * through the anon client when a collector clicks something; the BuzzBox webhook charges through
 * the service-role client when a call connects, with no browser involved at all. A second
 * implementation for the server would be a second set of Annexure B rules to keep in step, and
 * the two would drift the first time a cap changed.
 *
 * So the client is a parameter. accountCharges.ts is the browser's thin wrapper around this, and
 * api/_lib/buzzbox/ passes the admin client. Nothing here imports a Supabase client of its own,
 * which is what lets it load under Node — src/lib/supabase.ts reads import.meta.env and throws
 * outside Vite.
 *
 * Two caps apply to every charge, and both are the gazette's, not ours:
 *
 *   The item's own limit. Item 3 reads "Other necessary expenses not specifically provided for,
 *   **a total amount of**: R25,00" — one R25 for the account, however many sundry expenses it
 *   accumulates. The second query on an account therefore charges nothing under item 3.
 *
 *   The items 1–7 ceiling: the capital, or R1,225, whichever is less. Past it the work continues
 *   and the money stops.
 *
 *   The item's monthly allowance. A credit bureau search is "R16,00" with a maximum of four a
 *   month; the fifth in a month earns nothing. Unlike item 3 this comes back next month, so it
 *   is counted per calendar month rather than for the life of the account.
 *
 * A charge that comes out at zero is still recorded, as an unbilled row. What was done is history
 * whether or not it earned anything, and an account that shows no trace of the work is an account
 * nobody can prove was worked.
 */
/*
 * `.js`, not `.ts`, and this is load-bearing.
 *
 * Vercel does not bundle an API route -- it transpiles each file and ships them, so Node resolves
 * these specifiers at runtime against the EMITTED files. A `./accountStatus.ts` specifier survives
 * into the output and points at a file that no longer exists, and every /api/buzzbox/* route dies
 * with ERR_MODULE_NOT_FOUND. It did, on live, for eleven minutes.
 *
 * `.js` is the specifier TypeScript expects for that emit, and Vite resolves it back to the `.ts`
 * source for the browser build. So it works in both places, which is the whole point of this file.
 *
 * The cost: `node --experimental-strip-types` cannot resolve `.js` to a `.ts` file on disk, so the
 * QA script for this module runs with scripts/qa/tsresolve.mjs, which teaches it to.
 */
import { isWrittenOff } from './accountStatus.js'
/*
 * FROM reminderTime, NOT diaryPriority, though both export this.
 *
 * chargeEngine is reachable from a serverless function (emailSync files an inbound message and
 * charges item 6), and diaryPriority pulls in workingDays with a `.ts` specifier -- which does
 * not survive Vercel's transpile and takes the route down at runtime. check-api-imports caught it
 * the moment this import was added. reminderTime has no imports of its own, so it drags nothing
 * into the function, and its own note says exactly why this is not toISOString().
 */
import { todayIso } from './reminderTime.js'
import { DAILY_LIMIT, MONTHLY_LIMIT, type ActionCode } from './actionTariff.js'
import {
  itemAmountFor, itemTotalRemaining, monthlyLimit, monthlyRoom, recoverableFee, roundToCents,
  scheduleFor,
} from './annexureB.js'

export interface ChargeResult {
  /** Excluding VAT. Zero where a cap left no room. */
  exclVat: number
  vat: number
  /** Why nothing was charged, for showing to the person who did the work. */
  /*
   * A CLOSED LIST OF THE WAYS A FEE CAN COME TO NOTHING, and every one of them is a sentence
   * somebody reads. 'tracing-limit' is the firm's own cap rather than the gazette's, which is why
   * it is not folded into 'monthly-limit': the two refuse for different reasons and the collector
   * should be told which.
   */
  reason: 'charged' | 'written-off' | 'item-total-spent' | 'monthly-limit' | 'tracing-limit'
    | 'daily-limit' | 'at-ceiling'
}

export interface ChargeInput {
  accountId: string
  /** Annexure B item id, e.g. '3'. */
  itemId: string
  /** Our action catalogue code, for the timeline's icon and for reconciliation. */
  actionCode: string
  description: string
  createdBy?: string | null
  /**
   * How many units of the item this one charge covers — four bureau searches on an account with
   * a company and three sureties. One row at four times the rate, not four rows: a statement is
   * read by a debtor, and four identical lines is arithmetic homework.
   */
  quantity?: number
  /** Defaults to now. Passed in by tests. */
  at?: Date
  /**
   * THE SIZE OF THE DEBT, for the one item whose price depends on it.
   *
   * Item 4(a) -- an acknowledgement of debt -- is priced by the Magistrates' Courts Rules in two
   * bands: R161 while the claim is under R50,000 and R209 from R50,000 up, both excluding VAT.
   * THE FIRM: "the two different fees that I added -- it depends on the amount, it's below 50,000
   * and over 50,000 for the claim amount."
   *
   * PASSED IN RATHER THAN READ OFF THE ACCOUNT, and that is deliberate. The engine already knows
   * the account's CAPITAL, which is close enough to be tempting and is not the same number: the
   * Rules band on the claim, and what the firm is suing for is the balance the acknowledgement
   * itself states. The caller is holding that figure -- it is the one on the document the debtor
   * is about to sign -- so it comes from there, and the fee cannot disagree with the instrument.
   *
   * ABSENT ON EVERY OTHER ITEM. See itemAmountFor: nothing else looks at it.
   */
  debtAmount?: number
  /**
   * WHO RAISED IT: 'raptor' for a person doing something, 'workflow' for the sweep.
   *
   * Defaulted rather than required, because every caller but one is a person. The runner passes
   * 'workflow' so that "what did the sequences charge this month" stays a question the ledger can
   * answer -- it used to write its own row and stamped itself.
   */
  source?: 'raptor' | 'workflow'
}

/**
 * The little of a Supabase client this needs.
 *
 * Structural rather than importing SupabaseClient, for the same reason the file takes a client at
 * all: the type lives in a package the browser bundle already carries and the point here is not
 * to care which client it is. It also keeps the QA scripts able to pass a fake.
 */
export interface ChargeDb {
  rpc: (fn: string, args: Record<string, unknown>) => {
    single: <T>() => PromiseLike<{ data: T | null; error: { message: string } | null }>
  }
  from: (table: string) => any
}

const VAT_RATE = 0.15

/**
 * Charge an Annexure B item to an account, respecting every cap.
 *
 * Reads the fee ledger first: the item's own spend and the account's total towards the ceiling
 * are both facts about what has already happened, and computing them from anything other than
 * the ledger would be guessing.
 */
export async function chargeItemWith(db: ChargeDb, input: ChargeInput): Promise<ChargeResult> {
  const at = input.at ?? new Date()
  const schedule = scheduleFor(at)

  /*
   * One request, and it returns three numbers rather than a ledger.
   *
   * This used to select every fee row on the account to add up two of its columns — up to 822
   * rows and half a megabyte of JSON on the busiest account, fetched from Paris, to compute two
   * sums Postgres can do in microseconds. The database is where you add up rows.
   */
  const { data, error: basisError } = await db
    .rpc('account_charge_basis', { p_account_id: input.accountId, p_item: input.itemId })
    .single<{ capital: number; spent_on_item: number; towards_ceiling: number }>()
  if (basisError) throw new Error(basisError.message)

  const capital = Number(data?.capital ?? 0)
  const spentOnItem = Number(data?.spent_on_item ?? 0)
  const towardsCeiling = Number(data?.towards_ceiling ?? 0)

  /*
   * A written-off account earns nothing more.
   *
   * The statement drops fees dated after the write-off, so charging one produced money that was
   * recorded, announced to the collector, and then invisible everywhere it mattered. The work is
   * still written down — it happened — it simply cannot be recovered.
   */
  const { data: acct, error: statusError } = await db
    .from('debtor_accounts').select('status').eq('id', input.accountId).maybeSingle()
  if (statusError) throw new Error(statusError.message)
  const closed = isWrittenOff((acct as { status?: string | null } | null)?.status)

  const quantity = Math.max(1, Math.floor(input.quantity ?? 1))
  const remainingOnItem = itemTotalRemaining(input.itemId, spentOnItem, schedule, input.debtAmount)
  const asked = itemAmountFor(input.itemId, quantity, spentOnItem, schedule, input.debtAmount)

  /*
   * The monthly allowance, for the two items that have one.
   *
   * Only charges that EARNED something count against it: a search recorded at zero took nothing
   * from the debtor, so it cannot be the reason the next one goes unrecovered. Costs an extra
   * count request, and only on the items where the gazette actually imposes a limit.
   */
  const limit = monthlyLimit(input.itemId, schedule)
  let room = Infinity
  if (limit !== null) {
    const monthStart = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1))
    const nextMonth = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1))
    const { count, error: countError } = await db
      .from('account_fees')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', input.accountId)
      .eq('annexure_item', input.itemId)
      .eq('billed', true)
      .gte('incurred_at', monthStart.toISOString())
      .lt('incurred_at', nextMonth.toISOString())
    if (countError) throw new Error(countError.message)
    room = monthlyRoom(limit, count ?? 0)
  }

  /*
   * AND THE DAY'S ALLOWANCE, FOR THE ONE ACTION THAT HAS ONE.
   *
   * THE FIRM, OF A PERUSAL OF DOCUMENTS: "limited to one a day. So one charge a day. Can't be more
   * than one perusal of documents in a day. This includes a trace and everything else."
   *
   * COUNTED ON THE ACTION CODE, which is what makes "and everything else" true: opening a
   * document, saving one, reading a trace report and handing a dispute to a liaison are all
   * `perusal`, so they share the day rather than each having one.
   *
   * ONLY CHARGES THAT EARNED SOMETHING COUNT, exactly as the monthly allowance works: a perusal
   * recorded at nought took nothing from the debtor, so it cannot be the reason the next one goes
   * unrecovered.
   *
   * THE DAY IS THE ONE THE PERSON IS IN, NOT THE SERVER'S. The window runs from local midnight to
   * local midnight, which for everybody who raises a perusal is Johannesburg -- the charge is made
   * from the browser, by somebody who has just opened a document. Built from the same clock the
   * rest of the app calls `today`, rather than from a timezone written out here, so the two cannot
   * disagree about which day a fee belongs to. A boundary read in the wrong zone is a second
   * charge on a debtor who was perused once.
   */
  /*
   * AND THE FIRM'S OWN MONTHLY CAP ON TRACING, WHICH IS NOT THE GAZETTE'S.
   *
   * THE FIRM: "Cap all the tracing activities at four a month. Whether or not it's a trace or the
   * other necessary expense."
   *
   * COUNTED ON THE ACTION, NOT THE ITEM, and that is the whole of "whether or not": a bureau
   * search is item 4(c) and a SASSA, deeds or web search is item 3, and four is the total of both.
   * Counted on the item it would be two separate fours -- twice what they asked for -- and item 3
   * also carries the perusal of documents, so an item-3 cap would stop a collector opening a PDF
   * because somebody had searched the deeds office that month.
   *
   * SEPARATE FROM THE GAZETTE'S ALLOWANCE ABOVE, which stays switched off. That one is per item
   * and the firm turned it off in September; this is the firm's own rule about their own activity
   * and binds regardless. The two happen to agree at four.
   *
   * ONLY CHARGES THAT EARNED SOMETHING COUNT, like both allowances above: a search recorded at
   * nought took nothing from the debtor, so it cannot be the reason the next one goes unrecovered.
   */
  const perMonth = MONTHLY_LIMIT[input.actionCode]
  let actionMonthRoom = Infinity
  if (perMonth !== undefined) {
    const monthStart = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1))
    const nextMonth = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1))
    const { count, error: monthError } = await db
      .from('account_fees')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', input.accountId)
      .eq('action_code', input.actionCode)
      .eq('billed', true)
      .gte('incurred_at', monthStart.toISOString())
      .lt('incurred_at', nextMonth.toISOString())
    if (monthError) throw new Error(monthError.message)
    actionMonthRoom = Math.max(0, perMonth - (count ?? 0))
  }

  const perDay = DAILY_LIMIT[input.actionCode as ActionCode]
  let dayRoom = Infinity
  if (perDay !== undefined) {
    const dayStart = new Date(at)
    dayStart.setHours(0, 0, 0, 0)
    const dayEnd = new Date(dayStart)
    dayEnd.setDate(dayEnd.getDate() + 1)
    const { count, error: dayError } = await db
      .from('account_fees')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', input.accountId)
      .eq('action_code', input.actionCode)
      .eq('billed', true)
      .gte('incurred_at', dayStart.toISOString())
      .lt('incurred_at', dayEnd.toISOString())
    if (dayError) throw new Error(dayError.message)
    dayRoom = Math.max(0, perDay - (count ?? 0))
  }

  const recoverable = !closed && room > 0 && dayRoom > 0 && actionMonthRoom > 0
    ? recoverableFee(asked, towardsCeiling, capital, schedule) : 0

  const exclVat = roundToCents(recoverable)
  const vat = roundToCents(exclVat * VAT_RATE)
  const reason: ChargeResult['reason'] =
    exclVat > 0 ? 'charged'
      : closed ? 'written-off'
        : room <= 0 ? 'monthly-limit'
          : actionMonthRoom <= 0 ? 'tracing-limit'
            : dayRoom <= 0 ? 'daily-limit'
            : remainingOnItem <= 0 ? 'item-total-spent'
              : 'at-ceiling'

  const { error } = await db.from('account_fees').insert({
    account_id: input.accountId,
    annexure_item: input.itemId,
    tariff_effective_from: schedule.effectiveFrom,
    action_code: input.actionCode,
    description: input.description,
    amount_excl_vat: exclVat,
    vat_rate: VAT_RATE * 100,
    vat_amount: vat,
    // The unit count this row stands for. Named for SMS, which needed it first; it means the
    // same thing here — how many of the item one line covers.
    segments: quantity,
    counts_toward_fee_cap: true,
    // False where a cap left nothing: the action happened, it just earned nothing. The balance
    // engine already excludes unbilled rows, and the timeline already draws them as "not charged".
    billed: exclVat > 0,
    incurred_at: at.toISOString(),
    source: input.source ?? 'raptor',
    created_by: input.createdBy ?? null,
  })
  if (error) throw new Error(error.message)

  /*
   * AND THE ACCOUNT COUNTS AS WORKED.
   *
   * `last_action_at` is what the client-facing narrative reads to decide whether anybody has been
   * in touch, and what "Gone quiet" and "never worked" are filtered on across the whole book.
   *
   * NOTHING IN RAPTOR HAD EVER WRITTEN IT. Only the Swordfish import did, so every account worked
   * inside Raptor since go-live still carried its imported "Last Action Date", and an account
   * opened here carried none at all for ever -- emailed, telephoned and charged for, and still
   * reading "No contact attempt has been made yet" to the client.
   *
   * HERE, BECAUSE THIS IS THE ONE PLACE AN ACTION IS RECORDED. Email, SMS, a call, a trace, a
   * promise and a dispute all come through chargeItem, and the row is inserted even when a cap
   * left nothing to charge -- the action happened, which is exactly what this column means.
   * Hooked at the six call sites instead, the seventh would have been forgotten.
   *
   * IT ONLY EVER MOVES FORWARD. `at` can be backdated, and an older action must not drag the
   * account's last-worked date backwards and make a live file look quiet. The `or` does that in
   * the same request rather than reading the row first and racing another writer.
   *
   * THE LOCAL DAY, NOT A UTC INSTANT: the column is a DATE, and toISOString would file work done
   * at one in the morning in Johannesburg under the day before.
   */
  const actionDay = todayIso(at)
  const { error: stampError } = await db.from('debtor_accounts')
    .update({ last_action_at: actionDay })
    .eq('id', input.accountId)
    .or(`last_action_at.is.null,last_action_at.lt.${actionDay}`)
  /*
   * NEVER FAILS THE ACTION. The work has been done and the fee is already written down; throwing
   * here would report a failure for something that succeeded, and the worst case is a date that
   * is a day stale.
   */
  if (stampError) console.error('[chargeEngine] could not mark the account worked:', stampError.message)

  return { exclVat, vat, reason }
}

/** What the person who did the work should be told about what it earned. */
export function chargeMessage(r: ChargeResult, itemId: string): string {
  if (r.reason === 'charged') {
    return `Charged R${r.exclVat.toFixed(2)} plus VAT under Annexure B item ${itemId}.`
  }
  if (r.reason === 'item-total-spent') {
    return `No charge: item ${itemId} is a total for the account and it has already been used.`
  }
  if (r.reason === 'written-off') {
    return 'No charge: the account is written off, so nothing further can be recovered. The action is recorded.'
  }
  if (r.reason === 'monthly-limit') {
    return `No charge: item ${itemId} has already been charged its maximum for this month. It is recorded, and the allowance resets next month.`
  }
  /*
   * THE FIRM'S OWN CAP ON TRACING, AND THE SENTENCE SAYS SO RATHER THAN BLAMING THE GAZETTE.
   *
   * "Cap all the tracing activities at four a month. Whether or not it's a trace or the other
   * necessary expense." It names the four and says the search still happened, because the common
   * case for meeting this is a collector doing genuinely necessary work on a multi-debtor account
   * -- which is the exact objection that had the gazette's own per-item allowance switched off in
   * September. They should be able to read why it refused and take it to a team leader.
   */
  if (r.reason === 'tracing-limit') {
    return 'No charge: four tracing charges have already been raised on this account this month, '
      + 'counting bureau searches and other searches together. The search is recorded, and the '
      + 'allowance resets next month.'
  }
  /* THE FIRM'S OWN RULE RATHER THAN THE GAZETTE'S, so the sentence says so: a perusal is charged
     once a day however many documents are opened, and the work is still written down. */
  if (r.reason === 'daily-limit') {
    return 'No charge: this has already been charged once today. It is recorded, and it can be charged again tomorrow.'
  }
  return 'No charge: the account is at the Annexure B fee ceiling.'
}
