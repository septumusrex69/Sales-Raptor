/**
 * What a second trace found that the first one did not.
 *
 * THE FIRM: "if we have to update a trace, let's say three months later we do a trace and we can
 * update it -- like, okay, well, there's a new trace. And then it should compare it with the data
 * from the old trace and show you if there's any new data."
 *
 * WHICH IS THE ONLY REASON TO RUN A SECOND ONE. A bureau profile pulled three months after the
 * first is mostly the same profile: the same four numbers, the same address, the same employer.
 * A collector who has already worked those is being asked to read forty lines to find the two
 * that changed -- and a second search costs the account Annexure B item 4(c), so what it BOUGHT
 * is the fair question to answer on the screen.
 *
 * ---- ABSENCE IS NOT EVIDENCE, AND THIS IS THE CARE THE WHOLE FILE TURNS ON ----
 *
 * A number missing from the newer report does NOT mean the number is dead. Bureaux age records
 * out, a consumer profile and a commercial one carry different columns, and two pulls minutes
 * apart can differ. So nothing here says "gone", "disconnected" or "no longer valid" -- those are
 * claims only a collector who dialled it may make, and `TraceOutcome` is where they live.
 *
 * What is said is exactly what is true: this one is new, and that one was on the earlier report
 * and is not on this one. The second is worth knowing and is not worth acting on by itself,
 * which is why it is counted quietly rather than listed first.
 *
 * ---- AND THE MATCHING IS ON THE THING, NOT ON THE SPELLING ----
 *
 * 082 123 4567 and 0821234567 are one number, and reported as two "new" findings the feature is
 * worse than useless: it manufactures work on every re-trace. Same for +27 against the leading
 * nought, and for an address that gained a comma.
 *
 * PURE, so the comparison can be read back without a bureau, a database or a browser anywhere
 * near it.
 */

import type { TraceItem, TraceItemKind } from './traceStore.ts'

/** Where a finding stands against the earlier report. */
export type TraceChangeState =
  /** On this report and not on the earlier one. The answer to "what did we buy". */
  | 'new'
  /** On both. Already worked, most likely. */
  | 'carried'
  /** On the earlier report and not on this one. See the note above: NOT "gone". */
  | 'dropped'

export interface TraceChange {
  kind: TraceItemKind
  value: string
  label: string | null
  state: TraceChangeState
  /** The item itself, where there is one on the newer report. Null for a dropped finding. */
  item: TraceItem | null
}

/**
 * The key two findings must share to be the same finding.
 *
 * A NUMBER IS ITS DIGITS. South Africa writes one number at least four ways -- 082 123 4567,
 * 0821234567, +27 82 123 4567, (082) 123-4567 -- and the bureau's own columns are not consistent
 * between a consumer profile and a commercial one. Compared as typed, every re-trace would report
 * the same four numbers as four new findings.
 *
 * +27 IS THE LEADING NOUGHT. Kept apart, a profile that switched to the international form would
 * report every number on it as new, which is the failure this exists to prevent wearing a
 * different hat.
 *
 * EVERYTHING ELSE IS FOLDED, NOT STRIPPED. An address is compared on its words with the spacing
 * and punctuation taken out; it is NOT reduced to letters and digits, because "Unit 3" and
 * "Unit 8" must stay two addresses and an employer's name is worth reading as written.
 */
export function traceKey(kind: TraceItemKind, value: string): string {
  const v = (value ?? '').trim()
  if (kind === 'mobile' || kind === 'phone' || kind === 'work') {
    const digits = v.replace(/\D/g, '')
    /* 27821234567 -> 0821234567. Only where it really is a country code and a nine-digit
       subscriber number, so a thirteen-digit ID typed into a phone column is left alone. */
    const local = /^27\d{9}$/.test(digits) ? `0${digits.slice(2)}` : digits
    /* One prefix for all three phone columns -- see the note below. */
    return `tel:${local}`
  }
  if (kind === 'email') return `email:${v.toLowerCase()}`
  return `${kind}:${v.toLowerCase().replace(/[\s,.]+/g, ' ').trim()}`
}

/*
 * THE THREE PHONE COLUMNS COMPARE AS ONE. The bureau files a number under Mobile on one report
 * and under Home on the next, and reported as a new finding it is a collector ringing a number
 * they rang in June. Which column it sat in is not a fact about the debtor.
 */

/**
 * The newer report against the older one.
 *
 * ORDERED NEW FIRST, then carried, then dropped -- which is the order somebody reads them in and
 * the order of how much each is worth. Within a state the bureau's own order is kept: it is not
 * ours to re-rank, and the first number on a profile is generally the one it is most confident of.
 */
export function compareTraces(
  latest: readonly TraceItem[],
  previous: readonly TraceItem[],
): TraceChange[] {
  const before = new Map<string, TraceItem>()
  for (const i of previous) {
    const k = traceKey(i.kind, i.value)
    if (!before.has(k)) before.set(k, i)
  }
  const now = new Set(latest.map((i) => traceKey(i.kind, i.value)))

  const out: TraceChange[] = latest.map((i) => ({
    kind: i.kind,
    value: i.value,
    label: i.label,
    state: (before.has(traceKey(i.kind, i.value)) ? 'carried' : 'new') as TraceChangeState,
    item: i,
  }))

  for (const [k, i] of before) {
    if (now.has(k)) continue
    out.push({ kind: i.kind, value: i.value, label: i.label, state: 'dropped', item: null })
  }

  const rank: Record<TraceChangeState, number> = { new: 0, carried: 1, dropped: 2 }
  return out.sort((a, b) => rank[a.state] - rank[b.state])
}

export interface TraceComparison {
  changes: TraceChange[]
  added: number
  carried: number
  dropped: number
}

export function compareTraceReports(
  latest: readonly TraceItem[],
  previous: readonly TraceItem[],
): TraceComparison {
  const changes = compareTraces(latest, previous)
  return {
    changes,
    added: changes.filter((c) => c.state === 'new').length,
    carried: changes.filter((c) => c.state === 'carried').length,
    dropped: changes.filter((c) => c.state === 'dropped').length,
  }
}

/**
 * One line for the screen, in the firm's words.
 *
 * NOTHING NEW IS SAID OUT LOUD, and that is not a consolation prize. A second search the account
 * has been charged for that found nothing the first one did not is a fact worth putting in front
 * of whoever decides to run a third.
 *
 * A DROPPED FINDING IS COUNTED, NEVER NAMED HERE. It is a footnote to a sentence about what is
 * new, and the wording says what is true -- it was on the earlier report -- rather than implying
 * the number is dead, which nobody who has not dialled it may say.
 */
export function comparisonLine(c: TraceComparison): string {
  const bits: string[] = []
  bits.push(c.added === 0
    ? 'Nothing on this report that the previous one did not already have.'
    : c.added === 1
      ? '1 new finding on this report.'
      : `${c.added} new findings on this report.`)
  if (c.carried > 0) {
    bits.push(c.carried === 1 ? '1 was on the earlier one too.' : `${c.carried} were on the earlier one too.`)
  }
  if (c.dropped > 0) {
    bits.push(c.dropped === 1
      ? '1 finding on the earlier report is not on this one.'
      : `${c.dropped} findings on the earlier report are not on this one.`)
  }
  return bits.join(' ')
}

/** The little of a trace this needs to pair one report with the one before it. */
export interface ComparableTrace {
  id: string
  subjectKind: 'debtor' | 'director'
  directorId: string | null
  enquiredOn: string | null
  createdAt: string
  items: TraceItem[]
}

/**
 * The report this one should be read against, or null where there is not one.
 *
 * THE SAME SUBJECT, AND THAT IS THE WHOLE OF THE CARE HERE. A company account carries one trace
 * for the company and one for each director, so "the previous trace" by date is very often a
 * different PERSON -- and compared against it every finding on both would be reported as new,
 * which is worse than saying nothing at all. Paired on the subject, two reports on one director
 * three months apart find each other and the company's own report is left out of it.
 *
 * `traces` is expected newest first, which is the order the account screen holds them in and the
 * order the database returns them in. The pairing does not depend on it -- the list is searched
 * for the next one about the same subject -- but the caller's `latest` should be the newest or
 * the comparison answers a question nobody asked.
 */
export function previousTraceFor<T extends ComparableTrace>(
  traces: readonly T[], latest: T,
): T | null {
  const sameSubject = (t: T) => t.subjectKind === latest.subjectKind
    && (t.directorId ?? null) === (latest.directorId ?? null)
  /*
   * ORDERED BY WHEN THE BUREAU LOOKED, falling back to when the row was written. A PDF filed
   * today can be a report pulled in March -- see TraceUploadModal, where `enquiredOn` comes off
   * the report itself -- so ordering on createdAt alone would call a six-month-old report the
   * "newer" one and report its stale numbers as new findings.
   */
  const when = (t: T) => t.enquiredOn ?? t.createdAt
  const earlier = traces
    .filter((t) => t.id !== latest.id && sameSubject(t) && when(t) <= when(latest))
    .sort((a, b) => (when(a) < when(b) ? 1 : -1))
  return earlier[0] ?? null
}
