/**
 * Tracing a debtor — at XDS, or anywhere else the firm looks.
 *
 * XDS is a registered credit bureau, so a search there is Annexure B item 4(c) — "necessary
 * registered credit bureau search", R16 excluding VAT. It is not a fee we invented: the gazette
 * names the work. The gazette's four-a-month allowance is not enforced (see
 * ENFORCE_MONTHLY_LIMITS): one account can carry a company and several sureties, and each of them
 * is a separate person to find.
 *
 * The portal has no way to be handed a debtor, so this cannot search on anyone's behalf. What it
 * does is the paperwork either side of the search: it opens the portal, records that a search was
 * done, and charges for it — so a collector stops having to remember to write up a trace they
 * performed twenty minutes ago on another screen.
 *
 * Worth being plain about the trade: the charge is raised when the portal is OPENED, not when a
 * result comes back, because nothing tells us what happened inside XDS. That is why the button
 * asks first. A trace that earns nothing is still recorded, same as every other capped item.
 */
import { addNote } from './accountWorkspace'
import { chargeItem, type ChargeResult } from './accountCharges'
import {
  chargeForSource, chargesForThisSearch, traceSourceById, traceSourceNote,
} from './traceSources.ts'
import { attemptIsChargeable } from './traceAttempt.ts'

/** Item 4(c). Named once so the reason for the charge is greppable from the button. */
export const TRACE_ITEM = '4c'
export const TRACE_ACTION_CODE = 'TRC'

/**
 * The bureau's own portal.
 *
 * A constant rather than a setting because the firm uses one bureau. When a second one arrives
 * this becomes a row in settings and the button grows a menu; until then a setting nobody ever
 * changes is just somewhere else to look.
 */
export const XDS_PORTAL_URL = 'https://www.online.xds.co.za/Portal/Account/Login?ReturnUrl=%2FPortal%2F'

/**
 * Record a trace against an account: the fee, then the note.
 *
 * In that order deliberately. The note quotes what the charge came to, so a timeline entry can
 * never claim a fee the ledger does not carry.
 */
export async function recordTrace(input: {
  accountId: string
  actor: { id: string | null; name: string | null }
  /** How many searches were actually run. One account can carry a company and its sureties. */
  count?: number
  /**
   * WHERE THEY LOOKED. Defaults to XDS, which is what every existing caller meant.
   *
   * THE FIRM: "where do I do the other traces, like for example CSA and stuff." The firm looks in
   * more places than one bureau, and until now the only search Raptor could record was the one it
   * had a button for -- so every other search was done, cost the firm time, and was charged to
   * nobody and written down nowhere.
   */
  sourceId?: string
  /** Where the source is "Somewhere else", what the collector typed. Timeline only. */
  named?: string | null
  /** What came back, typed by the collector. See traceSourceNote.found. */
  found?: string | null
  /**
   * TRUE WHERE A NON-BUREAU SEARCH HAS ALREADY BEEN CHARGED FOR THIS SAME PERSON.
   *
   * Answered by the caller because only the account can answer it: the fee ledger stores a
   * description a debtor reads, not a subject key, so there is nothing in it to group on. See
   * chargesForThisSearch for why it is once per subject and not once per month.
   */
  alreadyChargedForSubject?: boolean
  /*
   * NULL WHERE NOTHING WAS CHARGED BECAUSE THIS SUBJECT IS ALREADY COVERED.
   *
   * Not a ChargeResult with a made-up reason: `reason` is a closed list of the ways the GAZETTE
   * stops a fee -- the ceiling, the monthly allowance, a written-off account -- and adding a value
   * to it would have every screen that explains a refusal start explaining this one in the
   * gazette's voice. This is not a refusal. It is one necessary expense that has already been
   * raised, which is a different sentence and belongs to the caller.
   */
}): Promise<ChargeResult | null> {
  const count = Math.max(1, Math.floor(input.count ?? 1))
  const source = traceSourceById(input.sourceId ?? 'xds')
  const what = chargeForSource(source)
  /*
   * RECORDED EVEN WHERE IT EARNS NOTHING, and the note goes on either way. A second non-bureau
   * search for the same person raises no fee -- it is one necessary expense -- but the next
   * collector still has to know somebody has already looked there.
   */
  const charge = chargesForThisSearch({
    source, alreadyChargedForSubject: input.alreadyChargedForSubject ?? false,
  })
    ? await chargeItem({
      accountId: input.accountId,
      itemId: what.itemId,
      actionCode: what.actionCode,
      description: what.description,
      /* Item 3 is one expense however many places were looked in; only a bureau charges by the
         search, which is why the count is passed on one and not the other. */
      quantity: source.kind === 'credit_bureau' ? count : 1,
      createdBy: input.actor.id,
    })
    : null
  await addNote({
    accountId: input.accountId,
    body: traceSourceNote({ source, named: input.named, found: input.found, count }),
    // Raptor's words, not a person's: hidden when the timeline is set to show only
    // what people wrote. See TimelineEntry.automated.
    source: 'system',
    authorName: input.actor.name,
    createdBy: input.actor.id,
  })
  return charge
}

/**
 * RECORD A TRACE THAT CAME BACK WITH NOTHING TO WORK ON.
 *
 * THE FIRM: "I think it's some place that we have to say like trace attempted and there was no
 * trace on the data. We would need more information like an ID number... we haven't been able to
 * trace the data on the information provided."
 *
 * AND IT CHARGES, WHICH IT DID NOT AT FIRST. The firm corrected that: "now you should charge them
 * even though we couldn't find the trace, because you already filled the things in with the credit
 * bureau -- you did a credit bureau trace, whether or not the finding was positive or not, you
 * still charge them." Item 4(c) prices a necessary registered credit bureau search and says nothing
 * about the search succeeding; the bureau is paid either way. Pressing Trace opens the portal
 * whether or not Raptor had a key to hand over, so the collector went there and typed in what the
 * account had -- the search ran, and it ran thin.
 *
 * ONLY THE BUREAU RAISES ONE. attemptIsChargeable holds the line and says why: item 3 is "other
 * necessary EXPENSES", and a public form that could not be submitted is not an expense.
 *
 * THE FEE FIRST, THEN THE NOTE, like recordTrace -- so a timeline entry can never quote a charge
 * the ledger does not carry.
 *
 * IT IS STILL A RECORD ABOVE ALL. Before it existed the only way out of the trace box was "Didn't
 * trace", which wrote nothing at all -- so an account that could not be traced read exactly like an
 * account nobody had got round to. See traceAttempt.ts.
 */
export async function recordTraceAttempt(input: {
  accountId: string
  actor: { id: string | null; name: string | null }
  /** Where they looked. Decides whether this raises a fee, and under which item. */
  sourceId?: string
  /** The sentence, from traceAttemptNote. Composed by the caller, which knows what was missing. */
  note: string
}): Promise<ChargeResult | null> {
  const source = traceSourceById(input.sourceId ?? 'xds')
  const what = chargeForSource(source)
  const charge = attemptIsChargeable(source)
    ? await chargeItem({
      accountId: input.accountId,
      itemId: what.itemId,
      actionCode: what.actionCode,
      description: what.description,
      /* ONE SEARCH. The row of counts is not offered on this path -- a search that came back with
         nothing to work on is one search, and asking how many would be asking a question whose
         answer nobody has. */
      quantity: 1,
      createdBy: input.actor.id,
    })
    : null
  await addNote({
    accountId: input.accountId,
    body: input.note,
    /* Raptor's words rather than a person's, same as a trace that did run. See
       TimelineEntry.automated. */
    source: 'system',
    authorName: input.actor.name,
    createdBy: input.actor.id,
  })
  return charge
}

/**
 * What the charge is for.
 *
 * Only what was done — how MANY is `segments` on the row, and the statement and the timeline both
 * render it from there. Spelling the count out here as well is what produced "Credit bureau
 * search (XDS) x 4 ×4".
 *
 * The bureau's name came off at the firm's request. It told the debtor nothing they needed and
 * named a supplier on a document that goes outside the building.
 */
export const TRACE_DESCRIPTION = 'Credit bureau search'

/**
 * What the timeline says happened.
 *
 * No fee named — it is on the transaction list, and on this timeline as its own entry. The
 * firm's instruction: "don't have to say about the charges in the notes."
 */
export function traceNote(count = 1): string {
  const searches = count > 1 ? `${count} credit bureau searches` : 'credit bureau search'
  return `Trace done — ${searches}.`
}
