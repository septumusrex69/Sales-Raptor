import { useEffect, useMemo, useState } from 'react'
import {
  Briefcase, Building2, Check, ChevronLeft, ChevronRight, FileText, Home, Info, Loader2, Mail, MapPin,
  Phone, Plus, Search, User, Users,
} from 'lucide-react'
import {
  compareTraces, compareTraceReports, comparisonLine, previousTraceFor, traceKey,
} from '../../lib/traceCompare.ts'
import { canRework, roundLine, traceRound } from '../../lib/traceRound.ts'
import { Modal } from '../../components/ui/Modal'
import { PhoneLink } from '../../components/PhoneLink'
import {
  TRACE_CATEGORIES, TRACE_OUTCOMES, TRACE_SORTS, canPromote, categoryById, categoryCounts,
  outcomeOptionsFor,
  linkedHow, linkedNumber, outcomeTone, pageOf, registrationIn, riskTone, savesAs, workRows,
  type FiledTrace, type OutcomeFilter, type OutcomeTone, type TraceCategoryId,
  type TraceItem, type TraceItemKind, type TraceOutcome, type TraceRow, type TraceSort,
} from '../../lib/traceStore.ts'
import { promoteTraceItem, recordTraceOutcome, traceReportUrl } from '../../lib/traceStoreData.ts'
import { recordDial } from '../../lib/accountCalls'
import { TraceButton } from './TraceButton'
import { formatDate, formatMoney } from '../../data/mockData'

/**
 * Working inside a trace.
 *
 * The firm's own description of what this is for: "You can work inside the tracing information.
 * You're calling a number that was on the trace. That number was verified. You can verify it, or
 * you called the person on the trace, you couldn't make contact, but it was ringing or the phone
 * was off. You can unverify it or say that it's not the debtor's telephone number. Then there
 * should be an option to add it to the principal contact details."
 *
 * So: ring it here, say what happened, and save the ones that turn out to be real. Nothing
 * arrives on the account's contact list because a bureau printed it — only because somebody tried
 * it and said so.
 *
 * WHAT THE BUREAU SAID IS NEVER EDITED. A finding keeps the value and the date it was printed
 * with, for as long as the trace is on the account. What changes is our column beside it.
 *
 * ONE SECTION AT A TIME, which is the firm's own design. This was a single scroll of seven
 * headings, and a profile with twenty-six numbers on it meant the addresses were a thousand
 * pixels below the fold — so a collector who opened it to check an address read numbers instead.
 * A rail on the left with a count against each section makes the size of each one visible before
 * you open it, and the table under it is then short enough to work.
 */
const ICONS: Record<TraceCategoryId, typeof Phone> = {
  phones: Phone, emails: Mail, addresses: MapPin, employment: Briefcase,
  people: Users, companies: Building2, property: Home,
}

/** How many rows fit under the table before it needs a page. */
const PAGE = 6

export function TraceWorkspaceModal({
  traces, openId, onOpen, actor, onClose, onChanged, onUploadNew,
}: {
  /** Every trace on the account, so a collector can move between them without closing this. */
  traces: FiledTrace[]
  openId: string
  onOpen: (traceId: string) => void
  actor: { id: string | null; name: string | null }
  onClose: () => void
  onChanged: () => Promise<void>
  /** Offered where this round is spent: a fresh bureau search, which is a new round. */
  onUploadNew?: () => void
}) {
  const trace = traces.find((t) => t.id === openId) ?? traces[0]
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /* Applied over the fetched rows so a click shows immediately without refetching the account. */
  const [local, setLocal] = useState<Record<string, Partial<TraceItem>>>({})

  const [openCategory, setOpenCategory] = useState<TraceCategoryId>('phones')
  const [search, setSearch] = useState('')
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>('any')
  const [sort, setSort] = useState<TraceSort>('recent')
  const [page, setPage] = useState(1)

  const items = useMemo(
    () => trace.items.map((i) => ({ ...i, ...(local[i.id] ?? {}) })),
    [trace.items, local],
  )
  const counts = useMemo(() => categoryCounts(items), [items])
  const category = categoryById(openCategory)

  /*
   * WHAT THIS REPORT FOUND THAT THE LAST ONE DID NOT.
   *
   * THE FIRM, looking at a second report on one subject: "if you upload a new trace, I see it
   * shows the new trace, but it's kind of the same data as the other one. So it should kind of
   * show you, oh, there's new information or there's not new information."
   *
   * EVERY PIECE OF THIS WAS ALREADY WRITTEN AND DRAWN ON THE OTHER SCREEN. traceCompare has done
   * the comparison since the firm first asked for it; the account's trace panel renders a one-line
   * summary of it, and this modal -- which is where somebody actually READS a trace -- showed
   * nothing. So the library is unchanged and only the wiring is new.
   *
   * AGAINST THE SAME SUBJECT, never simply the report before it: a company account carries one for
   * the company and one per director, so "the previous trace" by date is usually a different
   * person, and every finding on both would come back as new. previousTraceFor handles it.
   */
  /* WHERE THIS ATTEMPT STANDS. Derived off the live rows, so a picked outcome moves it at once. */
  const round = useMemo(() => traceRound(items), [items])
  const reworkable = useMemo(() => canRework(items), [items])

  const earlier = useMemo(() => previousTraceFor(traces, trace), [traces, trace])
  const since = useMemo(
    () => (earlier ? compareTraceReports(trace.items, earlier.items) : null),
    [earlier, trace.items],
  )
  /*
   * WHICH FINDINGS ARE NEW, as a set of keys.
   *
   * THE COUNT IS NOT THE ANSWER, and this is the half that makes the feature worth having: a line
   * saying "4 new findings" still leaves somebody reading thirty-eight rows to find them. Keyed on
   * traceKey so the match is on the NUMBER and not its spelling -- 082 123 4567 and 0821234567 are
   * one finding, and reported as two the feature would manufacture work on every re-trace.
   */
  const newKeys = useMemo(() => {
    if (!earlier) return null
    return new Set(
      compareTraces(trace.items, earlier.items)
        .filter((c) => c.state === 'new')
        .map((c) => traceKey(c.kind, c.value)),
    )
  }, [earlier, trace.items])

  const rows = useMemo(
    () => workRows({ items, category, search, outcome: outcomeFilter, sort }),
    [items, category, search, outcomeFilter, sort],
  )
  const shown = pageOf(rows, page, PAGE)

  /*
   * Back to the first page whenever the question changes, and back to numbers whenever the trace
   * does. Without it, switching to a director whose profile has two numbers leaves you on page 3
   * of the last one — and pageOf clamps the slice, so you would see the right rows under a page
   * number that had nothing to do with them.
   */
  useEffect(() => { setPage(1) }, [openCategory, search, outcomeFilter, sort, trace.id])
  useEffect(() => { setOpenCategory('phones'); setSearch(''); setOutcomeFilter('any') }, [trace.id])

  /**
   * A NUMBER RUNG OFF THE TRACE IS A CALL ON THE ACCOUNT.
   *
   * THE FIRM: "I should also be able to call the numbers from in the trace." The press already
   * rang -- every number here has been a PhoneLink all along -- so what was missing was not the
   * dialling, it was the RECORD. recordDial raises Annexure B item 2, writes "Called ..." onto the
   * timeline and inserts the account_calls row, which is the only thing BuzzBox can match its
   * events back to. Without it a collector worked through a fresh trace, rang six numbers, and the
   * account showed nothing and charged nothing.
   *
   * THE SAME FUNCTION THE ACCOUNT'S OWN CALL BUTTON USES, so there is one way a call is recorded
   * rather than two. Written twice they drift, and the failure is a book where some calls are
   * billable and some are not depending on which screen somebody was looking at.
   *
   * NO EXTENSION, because PhoneLink has already placed the call by the time this runs and reports
   * only what it dialled. BuzzBox's own event carries the extension and is matched on the number.
   *
   * NEVER ALLOWED TO FAIL THE CALL. The conversation is happening; a fee that would not write is
   * something to report afterwards, not a red box over a call that went through. Same reasoning as
   * the account_calls insert inside recordDial itself.
   */
  function dial(number: string) {
    void recordDial({ accountId: trace?.accountId ?? '', number, extension: null, actor })
      .then(() => onChanged())
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }

  /**
   * An outcome goes on EVERY finding behind the row.
   *
   * The row is one number; the findings behind it are the Cell, Home and Work columns the bureau
   * printed it in. Writing to one of the three would leave the other two reading "Not tested"
   * against a number somebody has just rung.
   */
  async function setOutcome(row: TraceRow, outcome: TraceOutcome | null) {
    setBusy(row.key); setError(null)
    try {
      for (const item of row.items) await recordTraceOutcome({ itemId: item.id, outcome, actor })
      const at = outcome === null ? null : new Date().toISOString()
      setLocal((s) => {
        const next = { ...s }
        for (const item of row.items) next[item.id] = { ...next[item.id], outcome, outcomeAt: at }
        return next
      })
      await onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setBusy(null) }
  }

  /**
   * Saved ONCE, off the newest finding.
   *
   * The same number under three columns is one contact. Promoting each finding would put it on
   * the account's contact list three times, which is the list the collector then has to read.
   */
  /*
   * SAVING A PERSON ASKS WHAT THEY ARE TO THE CASE FIRST.
   *
   * THE FIRM: "if you save the person and their number as a next of kin, you should be able to
   * make a note -- what is the relationship to the case."
   *
   * ASKED, NOT REQUIRED. A collector who already knows the row is their sister should not be made
   * to type it, and a box that refuses would turn a one-press save into an argument. Pressing Save
   * with it empty writes the same note without the sentence.
   *
   * ONLY ON A PERSON. "What is this number to the case" is not a question about a work landline
   * off the debtor's own profile, and asking it there would be a field nobody can answer.
   */
  const [saying, setSaying] = useState<{ row: TraceRow; asNextOfKin: boolean } | null>(null)
  const [relationship, setRelationship] = useState('')

  async function promote(row: TraceRow, asNextOfKin: boolean, why?: string) {
    const item = row.items.find((i) => i.promotedContactId === null) ?? row.items[0]
    setBusy(row.key); setError(null)
    try {
      await promoteTraceItem({
        item, accountId: trace.accountId,
        /* Whose profile it came off. On a director's trace the contact is that director's. */
        subjectName: trace.subjectKind === 'director' ? trace.subjectName : null,
        asNextOfKin,
        relationship: why?.trim() || null,
        actor,
      })
      setLocal((s) => ({ ...s, [item.id]: { ...s[item.id], promotedContactId: 'done' } }))
      await onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setBusy(null) }
  }

  const [opening, setOpening] = useState(false)
  async function openReport() {
    if (!trace.documentId) return
    setOpening(true); setError(null)
    try {
      /*
        noopener, because the signed URL must not be reachable by the tab it opens.

        The URL is signed first and the window opened after, which is what the documents panel
        does and is the only shape available while the signature costs a round trip. A strict
        popup blocker can refuse a window opened after an await; if that turns out to bite, the
        answer is to open the tab first and point it at the URL when it arrives, not to hand out
        an address that is not signed.
      */
      /* THE ACCOUNT, so the perusal lands on it. The firm: "this includes a trace." */
      window.open(await traceReportUrl(trace.documentId, trace.accountId), '_blank', 'noopener')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setOpening(false) }
  }

  const subjectRole = trace.subjectKind === 'director'
    ? `Director of ${traces.find((t) => t.subjectKind === 'debtor')?.subjectName ?? 'the debtor'}`
    : trace.registrationNumber ? `Registration ${trace.registrationNumber}`
      : trace.idNumber ? `ID ${trace.idNumber}` : 'The debtor'

  return (
    <Modal
      title="Trace results"
      subtitle={[trace.subjectName, trace.registrationNumber ?? trace.idNumber].filter(Boolean).join(' · ')}
      onClose={onClose}
      width={1080}
      padded={false}
      headerRight={trace.documentId && (
        /*
          THE PDF ITSELF, because what is on this screen is our reading of it and somebody will
          want to check a name against the original. The bucket is private, so there is no address
          to link to -- the URL is signed for sixty seconds when the button is pressed, exactly as
          the documents panel does it.
        */
        <button type="button" onClick={() => void openReport()} disabled={opening}
          className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 text-slate-600 hover:border-[#c9a052] hover:bg-gold-50 disabled:opacity-50">
          {opening ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
          View report
        </button>
      )}
      footer={(
        <div className="flex items-center justify-between gap-3">
          {/*
            WHERE THE SAVED ONES WENT. "Saved" against a row says something happened; it does not
            say where to find it, and a collector who saves four numbers and then cannot see them
            on the trace assumes it did not work.
          */}
          <p className="text-xs text-slate-400 inline-flex items-center gap-1.5 min-w-0">
            <Info size={13} className="shrink-0" />
            <span className="truncate">Saved items appear in Contact details.</span>
          </p>
          <button onClick={onClose}
            className="shrink-0 text-sm font-medium px-4 py-2 rounded-lg bg-brand-600 text-white shadow-sm hover:bg-brand-700">
            Done
          </button>
        </div>
      )}
    >
      <div className="px-5 pt-4 pb-5">
        {/*
          MOVING BETWEEN THE TRACES ON AN ACCOUNT, at the firm's instruction: "I need to go, for
          example, between the traces."

          A company account collects one per director plus one for the company itself, and
          comparing them is the work — the number that is dead on one director's profile is often
          live on another's. Closing and reopening to switch loses whatever was half-read.
        */}
        {traces.length > 1 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {traces.map((t) => (
              <button key={t.id} type="button" onClick={() => onOpen(t.id)}
                className={`text-sm px-3 py-2 rounded-lg border ${
                  t.id === trace.id
                    ? 'border-gold-500 bg-gold-50 text-navy-950 font-medium'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                }`}>
                {t.subjectName ?? 'Trace'}
                {/*
                  THE DATE, BECAUSE TWO REPORTS ON ONE SUBJECT WERE OTHERWISE IDENTICAL BUTTONS.
                  That is the firm's complaint in its simplest form -- they had two tabs reading
                  exactly the same words and no way to tell which was the new one.
                  
                  AND NOT "COMPANY" ON A PERSON. This read `subjectKind === 'director' ? 'Director'
                  : 'Company'`, so EVERY trace of the debtor was labelled Company whoever the
                  debtor was -- the firm's own screenshot shows "Stephan Ferreira · Company"
                  against a thirteen-digit identity number. The report kind is the thing that knows:
                  a commercial report is about a company, a consumer report is about a person.
                */}
                <span className="ml-1.5 text-slate-400 font-normal">
                  {'·'} {t.subjectKind === 'director' ? 'Director'
                    : t.reportKind === 'commercial' ? 'Company'
                      : t.reportKind === 'consumer' ? 'Person' : 'Debtor'}
                  {' · '}
                  {formatDate(t.enquiredOn ?? t.createdAt)}
                </span>
              </button>
            ))}
          </div>
        )}

        {/*
          WHERE THIS ATTEMPT STANDS, AND WHAT TO DO IF IT IS SPENT.
          
          THE FIRM: "if we've worked through an entire trace, it should mention that the entire
          trace has been worked through. There should be an option to upload a new trace or to
          rework the trace -- you've worked once through the entire trace, now trying again."
          
          TWO DIFFERENT JOBS, AND ONLY ONE COSTS THE DEBTOR. A new trace is a fresh bureau search
          under item 4(c); ringing a number that rang out before is not a search at all and the
          calls are already charged under item 2. So they are two buttons, worded as what they are.
          
          RE-WORK IS OFFERED ONLY WHERE SOMETHING RANG. A spent round of disconnected lines and
          wrong numbers has nothing to try again, and a button that re-opens a list of dead numbers
          teaches people the feature is pointless. See canRework.
        */}
        {round.workable > 0 && (
          <div className={`mb-4 rounded-lg border px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 ${
            round.state === 'spent'
              ? 'border-[var(--c-rust)]/40 bg-[var(--tint-rust)]'
              : round.state === 'worked_through'
                ? 'border-[var(--c-green)]/30 bg-[var(--c-green)]/5'
                : 'border-slate-200 bg-slate-50'}`}>
            <p className={`text-xs mr-auto ${
              round.state === 'spent' ? 'text-[var(--c-rust-deep)] font-medium' : 'text-slate-600'}`}>
              {roundLine(round)}
            </p>
            {round.state === 'spent' && reworkable && (
              <button type="button" onClick={() => { setOutcomeFilter('no_answer'); setOpenCategory('phones'); setPage(1) }}
                title="The numbers that rang. Try them at a different hour — this costs nothing extra."
                className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50">
                Work the ones that rang
              </button>
            )}
            {round.state === 'spent' && onUploadNew && (
              <button type="button" onClick={onUploadNew}
                title="A fresh bureau search — Annexure B item 4(c)"
                className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-gold-500 bg-gold-400 text-navy-950">
                Upload a new trace
              </button>
            )}
          </div>
        )}

        {/*
          WHAT THIS REPORT BOUGHT, said before anybody reads a row.
          
          NOTHING NEW IS STILL SAID OUT LOUD, and in the firm's words rather than as an empty
          space: a second search the account has been charged for that found nothing is a fact
          worth putting in front of whoever decides to run a third.
          
          AND NOTHING HERE CALLS A FINDING DEAD. A number on the earlier report and not on this one
          is not a disconnected number -- bureaux age records out and a consumer profile and a
          commercial one carry different columns. Only a collector who dialled it may say
          otherwise, which is what an outcome is for. See traceCompare.
        */}
        {since && earlier && (
          <div className={`mb-4 rounded-lg border px-3 py-2 ${
            since.added > 0
              ? 'border-[var(--c-green)]/30 bg-[var(--c-green)]/5'
              : 'border-slate-200 bg-slate-50'}`}>
            <p className="text-xs text-slate-600">
              <span className={since.added > 0 ? 'font-medium text-[var(--c-green)]' : 'font-medium text-slate-500'}>
                {comparisonLine(since)}
              </span>
              {' '}
              <span className="text-slate-400">
                Compared with the report of {formatDate(earlier.enquiredOn ?? earlier.createdAt)}.
              </span>
            </p>
          </div>
        )}

        {/* Who this profile is about, and how much the bureau thinks of it. */}
        <div className="rounded-xl border border-slate-200 px-4 py-3 flex flex-wrap items-center gap-3">
          <span className="shrink-0 grid place-items-center w-11 h-11 rounded-full bg-gold-50 text-[var(--c-gold-deep)]">
            <User size={20} />
          </span>
          <div className="min-w-0 mr-auto">
            <p className="text-base font-semibold text-slate-800 truncate">{trace.subjectName ?? 'Trace'}</p>
            <p className="text-xs text-slate-500 truncate">{subjectRole}</p>
          </div>
          {trace.contactScore && <Grade label="Contact score" value={trace.contactScore} tone="grey" />}
          {/*
            Only a high grade is loud. A grade shown in red whatever it says is a grade nobody
            reads, and most profiles come back average.
          */}
          {trace.riskScore && <Grade label="Potential risk" value={trace.riskScore} tone={riskTone(trace.riskScore)} />}
          {trace.enquiredOn && (
            <p className="text-xs text-slate-400 shrink-0">Report pulled {formatDate(trace.enquiredOn)}</p>
          )}
        </div>

        {error && <p className="text-sm text-negative-700 mt-3">{error}</p>}

        {/*
          A COMPANY PROFILE HAS NOTHING OF THIS KIND AND MUST SAY SO. Numbers, addresses and next
          of kin come off a PERSON's report; a commercial one carries directors and judgments,
          which live on the account itself. Without this the collector opens a working surface
          with nothing in it and no idea whether that is a bug.
        */}
        {items.length === 0 ? (
          <p className="text-sm text-slate-500 mt-4">
            Nothing to work on this one. {trace.reportKind === 'commercial'
              ? 'A company profile carries directors and judgments — both are on the account itself, under Standing. The numbers, addresses and next of kin come off a director’s own trace.'
              : 'The report had no contact details, addresses or links in it.'}
          </p>
        ) : (
          <div className="mt-4 flex flex-col md:flex-row gap-4">
            {/*
              The rail, with a count against each section. The counts are what make it worth
              having: a profile carrying one property and twenty-six numbers looks nothing like
              one carrying eight directorships, and which it is should be visible before you
              open anything.
            */}
            <nav className="md:w-56 shrink-0 flex md:flex-col gap-1 overflow-x-auto md:overflow-visible">
              {TRACE_CATEGORIES.map((c) => {
                const Icon = ICONS[c.id]
                const on = c.id === openCategory
                return (
                  <button key={c.id} type="button" onClick={() => setOpenCategory(c.id)}
                    disabled={counts[c.id] === 0}
                    className={`shrink-0 inline-flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-left ${
                      on ? 'bg-gold-50 border border-gold-500 text-navy-950 font-medium'
                        : counts[c.id] === 0
                          ? 'border border-transparent text-slate-300'
                          : 'border border-transparent text-slate-600 hover:bg-slate-50'
                    }`}>
                    <Icon size={16} className="shrink-0" />
                    <span className="md:flex-1 truncate">{c.title}</span>
                    {/* Nought is shown as nothing, not as a zero to read past. */}
                    {counts[c.id] > 0 && (
                      <span className={`text-xs ${on ? 'text-navy-950/60' : 'text-slate-400'}`}>{counts[c.id]}</span>
                    )}
                  </button>
                )
              })}
            </nav>

            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-slate-800">{category.title}</h3>
              <p className="text-xs text-slate-500 mt-0.5">{category.blurb}</p>

              <div className="flex flex-wrap items-center gap-2 mt-3">
                <label className="relative flex-1 min-w-[12rem]">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input value={search} onChange={(e) => setSearch(e.target.value)}
                    placeholder={`Search ${category.title.toLowerCase()}…`}
                    aria-label={`Search ${category.title.toLowerCase()}`}
                    className="w-full text-sm rounded-lg border border-slate-200 pl-8 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-100" />
                </label>
                {/* Only where an outcome is a thing that can be recorded at all. */}
                {category.worked && (
                  <select value={outcomeFilter} onChange={(e) => setOutcomeFilter(e.target.value as OutcomeFilter)}
                    aria-label="Filter by outcome"
                    className="text-sm rounded-lg border border-slate-200 px-2.5 py-2 bg-white text-slate-600">
                    <option value="any">All outcomes</option>
                    <option value="untested">Not tested</option>
                    {/* THIS LIST'S OWN, not all seven. Filtering an address list by "Disconnected"
                        returns nothing for ever, which reads as a broken filter rather than as a
                        question that was never askable. */}
                    {outcomeOptionsFor(category.id).filter((o) => o.outcome !== null).map((o) => (
                      <option key={o.outcome} value={o.outcome as string}>{o.label}</option>
                    ))}
                  </select>
                )}
                <select value={sort} onChange={(e) => setSort(e.target.value as TraceSort)}
                  aria-label="Sort"
                  className="text-sm rounded-lg border border-slate-200 px-2.5 py-2 bg-white text-slate-600">
                  {TRACE_SORTS.map((s) => <option key={s.sort} value={s.sort}>{s.label}</option>)}
                </select>
              </div>

              <div className="mt-3 rounded-xl border border-slate-200 overflow-hidden">
                {/* Its own scroller, so a wide table never scrolls the modal sideways. */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50/70 text-left text-xs text-slate-500">
                        <th className="font-medium px-3 py-2.5">{category.valueHeading}</th>
                        <th className="font-medium px-3 py-2.5 whitespace-nowrap">Last seen</th>
                        <th className="font-medium px-3 py-2.5 whitespace-nowrap">Links</th>
                        {category.worked && <th className="font-medium px-3 py-2.5">Outcome</th>}
                        <th className="font-medium px-3 py-2.5 whitespace-nowrap">Account</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {shown.rows.map((row) => (
                        <Row key={row.key} row={row} category={category.id} worked={category.worked}
                          isNew={newKeys?.has(traceKey(row.items[0].kind, row.items[0].value)) ?? false}
                          busy={busy === row.key}
                          onOutcome={(o) => void setOutcome(row, o)}
                          onPromote={(kin) => {
                            /* A PERSON IS ASKED ABOUT; A NUMBER IS JUST SAVED. */
                            if (category.id === 'people') {
                              setRelationship(''); setSaying({ row, asNextOfKin: kin })
                            } else void promote(row, kin)
                          }}
                          onDial={dial}
                          accountId={trace?.accountId ?? ''} actor={actor}
                          onChanged={async () => { await onChanged() }}
                          onUploadNew={() => onUploadNew?.()} />
                      ))}
                      {shown.rows.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-3 py-8 text-center text-sm text-slate-400">
                            Nothing here matches that.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="flex flex-wrap items-center gap-3 px-3 py-2.5 border-t border-slate-100 bg-slate-50/50">
                  {/*
                    SAYING SO, because a number the bureau printed three times appears here once
                    and somebody comparing this against the PDF has to know why the counts differ.
                  */}
                  <p className="text-xs text-slate-400 inline-flex items-center gap-1.5 mr-auto min-w-0">
                    <Info size={13} className="shrink-0" />
                    <span className="truncate">Matching {category.title.toLowerCase()} are grouped; the report is unchanged.</span>
                  </p>
                  <p className="text-xs text-slate-500 shrink-0">
                    Showing {shown.showing} of {shown.total}
                  </p>
                  <div className="flex items-center gap-1 shrink-0">
                    <button type="button" onClick={() => setPage(shown.page - 1)} disabled={shown.page <= 1}
                      aria-label="Previous page"
                      className="p-1.5 rounded-lg border border-slate-200 text-slate-500 disabled:opacity-40 hover:bg-white">
                      <ChevronLeft size={14} />
                    </button>
                    <button type="button" onClick={() => setPage(shown.page + 1)} disabled={shown.page >= shown.pages}
                      aria-label="Next page"
                      className="p-1.5 rounded-lg border border-slate-200 text-slate-500 disabled:opacity-40 hover:bg-white">
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      {/*
        WHAT THIS PERSON IS TO THE CASE, asked once, where the saving happens.
        
        THE FIRM: "if you save the person and their number as a next of kin, you should be able to
        make a note -- what is the relationship to the case, what is the relation of this person to
        the case."
        
        THE BUREAU'S OWN ANSWER IS NOT THAT. linkedHow reads whatever XDS printed about how two
        records touch -- a shared address, a shared surname -- which is a data match, not "his
        sister, he stays there weekends, she takes messages". One of those tells you to ring her.
        
        OPTIONAL, AND SAVE IS THE DEFAULT PRESS. A collector who already knows should not be made
        to type it; a box that refused would turn a one-press save into an argument.
      */}
      {saying && (
        <Modal title={`Save ${saying.row.value}`} onClose={() => setSaying(null)} width={440}>
          <p className="text-sm text-slate-500">
            {saying.asNextOfKin
              ? 'Goes on the account as a next of kin, so nobody opens a call to them as though they were the debtor.'
              : 'Goes on the account as a person and their number.'}
          </p>
          <label className="block mt-3">
            <span className="text-sm font-medium text-slate-700">What are they to the case?</span>
            <textarea value={relationship} onChange={(e) => setRelationship(e.target.value)} rows={3}
              autoFocus
              placeholder="His sister. He stays there at weekends and she takes messages."
              className="w-full mt-1 text-sm rounded-lg border border-slate-200 px-2.5 py-2 resize-none" />
            <span className="block text-[11px] text-slate-400 mt-1">
              Optional. Goes on the account&rsquo;s history with the number, not on the row.
            </span>
          </label>
          <div className="flex justify-end gap-2 mt-4">
            <button type="button" onClick={() => setSaying(null)}
              className="text-sm px-3 py-2 rounded-lg text-slate-500 hover:bg-slate-100">
              Cancel
            </button>
            <button type="button"
              onClick={() => {
                const { row, asNextOfKin } = saying
                setSaying(null)
                void promote(row, asNextOfKin, relationship)
              }}
              className="text-sm font-medium px-3.5 py-2 rounded-lg border border-gold-500 bg-gold-400 text-navy-950">
              Save it
            </button>
          </div>
        </Modal>
      )}
    </Modal>
  )
}

function Grade({ label, value, tone }: { label: string; value: string; tone: OutcomeTone }) {
  return (
    <span className={`shrink-0 inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border ${
      tone === 'red' ? 'border-negative-100 bg-negative-50 text-negative-700'
        : tone === 'amber' ? 'border-gold-200 bg-gold-50 text-[var(--c-gold-deep)]'
          : tone === 'green' ? 'border-positive-100 bg-positive-50 text-positive-700'
            : 'border-slate-200 bg-slate-50 text-slate-600'
    }`}>
      {label}: <span className="font-medium">{value}</span>
    </span>
  )
}

const DOT: Record<OutcomeTone, string> = {
  grey: 'bg-slate-300', green: 'bg-[var(--c-green)]', amber: 'bg-gold-400', red: 'bg-negative-700',
}

const KIND_WORD: Partial<Record<TraceItemKind, string>> = {
  phone: 'Home', work: 'Work', mobile: 'Mobile',
}

function Row({ row, category, worked, isNew, busy, onOutcome, onPromote, onDial,
  accountId, actor, onChanged, onUploadNew }: {
  row: TraceRow
  category: TraceCategoryId
  worked: boolean
  /**
   * ON THIS REPORT AND NOT ON THE ONE BEFORE IT.
   *
   * THE COUNT IS NOT THE ANSWER. "4 new findings on this report" still leaves somebody reading
   * thirty-eight rows to find the four, which is exactly the work the firm was complaining about:
   * "it's kind of the same data as the other one." The badge is what turns a number into a glance.
   */
  isNew: boolean
  busy: boolean
  onOutcome: (outcome: TraceOutcome | null) => void
  onPromote: (asNextOfKin: boolean) => void
  /**
   * A CALL FROM HERE IS A CALL ON THE ACCOUNT.
   *
   * THE FIRM: "I should also be able to call the numbers from in the trace."
   *
   * The numbers were already PhoneLinks, so the press already rang -- which is what made this
   * worth finding rather than obvious. What it did not do was TELL THE ACCOUNT: no item 2 fee, no
   * line on the timeline, and no account_calls row, which is the marker BuzzBox matches its events
   * against. A collector working a fresh trace rings six numbers, and the account shows none of it
   * and bills none of it. Same handler as the account's own Call button, so there is one way a
   * call is recorded rather than two.
   */
  onDial: (number: string) => void
  /* FOR TRACING A LINKED COMPANY, which is a trace of its own against the same account. */
  accountId: string
  actor: { id: string | null; name: string | null }
  onChanged: () => Promise<void>
  onUploadNew: () => void
}) {
  const dialable = category === 'phones'
  /*
   * A LINKED PERSON CAN BE RUNG TOO, on the number the bureau says they share with the debtor.
   * The links block gives a name and what the link ran through, and where that was a telephone
   * the telephone is sitting in the label — so it was on the screen and not dialable, which is
   * the number a collector chasing a relative most wants to press.
   */
  const shared = category === 'people' ? linkedNumber(row.label) : null
  /* STRUCK THROUGH: every way a finding can be dead. `moved_on` and `denies_link` joined the two
     that were here -- an address they have left is as useless to ring as a disconnected line. */
  const ruledOut = row.outcome === 'not_theirs' || row.outcome === 'unreachable'
    || row.outcome === 'moved_on' || row.outcome === 'denies_link'
  /* Ruled out or a property: there is nothing to put on the contact list. */
  const savable = row.items.some(canPromote)

  return (
    <tr className="align-middle">
      <td className="px-3 py-2.5">
        <div className="flex items-start gap-2.5">
          {dialable && <Phone size={14} className="mt-1 shrink-0 text-slate-400" />}
          <div className="min-w-0">
            {/* BESIDE THE VALUE, not in a column of its own: a column would be empty on every row
                of a first trace, and an empty column reads as something that failed to load. */}
            {isNew && (
              <span className="float-right ml-2 shrink-0 text-[10px] font-semibold uppercase tracking-wide
                text-[var(--c-green)] bg-[var(--c-green)]/10 px-1.5 py-0.5 rounded">
                New
              </span>
            )}
            <div className={`break-words ${ruledOut ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
              {/* Dialled from here, through the same button as everywhere else in the app. */}
              {dialable && !ruledOut
                ? <PhoneLink number={row.value} onDialled={(c) => onDial(c.to)} />
                : row.value}
            </div>
            {/*
              THE TYPES IT WAS FILED UNDER, which is the whole evidence that this row is three
              of the bureau's. A number that is the Cell, the Home and the Work number is one
              line somebody uses for everything — worth knowing before you ring it.
            */}
            {/* Rung from here, through the same button as everywhere else in the app. */}
            {shared !== null && (
              <p className="text-sm mt-0.5">
                <PhoneLink number={shared} onDialled={(c) => onDial(c.to)} />
              </p>
            )}
            <p className="text-xs text-slate-400">
              {[
                category === 'phones'
                  ? row.kinds.map((k) => KIND_WORD[k]).filter(Boolean).join(' · ')
                  /* The number has a line of its own above; this says how they are connected. */
                  : category === 'people' ? linkedHow(row.label)
                    : row.label,
                category === 'property' && row.amount !== null ? formatMoney(row.amount) : null,
                category === 'property' ? (/owner/i.test(row.status ?? '') ? 'still owns it' : 'no longer theirs') : null,
                category === 'people' && row.status === 'relative' ? 'possible relative — same surname' : null,
                category === 'companies' ? row.status : null,
              ].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>
      </td>

      <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">
        {row.seenOn ? formatDate(row.seenOn) : '—'}
      </td>

      {/*
        HOW MANY OTHER PEOPLE THE BUREAU HOLDS IT AGAINST. Fourteen means a switchboard or a
        recycled number, and it is the single most useful thing on the row for deciding whether
        to ring it at all.
      */}
      <td className="px-3 py-2.5 whitespace-nowrap">
        {row.peopleLinked !== null && row.peopleLinked > 1
          ? <span className="text-[var(--c-steel)]">{row.peopleLinked} people</span>
          : <span className="text-slate-400">{'—'}</span>}
      </td>

      {worked && (
        <td className="px-3 py-2.5">
          <div className="inline-flex items-center gap-2">
            {busy && <Loader2 size={13} className="animate-spin text-slate-400" />}
            {/*
              A PICKER, NOT A ROW OF BUTTONS, and "Not tested" is one of its choices. That is the
              firm's "you can unverify it": an outcome that can only ever move forwards leaves a
              wrong one standing, and the next collector rings a number this one proved dead.
            */}
            <span className={`shrink-0 w-2 h-2 rounded-full ${DOT[outcomeTone(row.outcome)]}`} />
            <select
              value={row.outcome ?? ''}
              onChange={(e) => onOutcome(e.target.value === '' ? null : e.target.value as TraceOutcome)}
              disabled={busy}
              aria-label={`Outcome for ${row.value}`}
              title={TRACE_OUTCOMES.find((o) => o.outcome === row.outcome)?.meaning}
              className="text-sm rounded-lg border border-slate-200 pl-1.5 pr-1 py-1.5 bg-white text-slate-700">
              {/*
                THE LIST'S OWN WORDS, AND ONLY THE ANSWERS IT CAN HAVE.
                
                THE FIRM: "if you click on the not tested, it says, okay, well, wrong person or
                disconnected. What does that mean? An address is an address or not an address.
                Employment the same." One picker written for a telephone was drawn against all
                four lists, so an address could be marked Disconnected and an employer No answer.
                
                A question with no true answer is worse than no question: a column of "Not tested"
                against rows nobody could ever answer is how a column comes to mean nothing.
              */}
              {outcomeOptionsFor(category).map((o) => (
                <option key={o.label} value={o.outcome ?? ''}>{o.label}</option>
              ))}
            </select>
            {/*
              A merged row whose findings disagree says so rather than picking one of them. It
              can only happen to a trace worked before the rows were grouped, and silently
              showing one of the two would be a claim nobody made.
            */}
            {row.mixed && (
              <span className="text-xs text-slate-400" title="The bureau's own rows for this were given different outcomes.">
                mixed
              </span>
            )}
          </div>
        </td>
      )}

      <td className="px-3 py-2.5 whitespace-nowrap">
        {/*
          A LINKED COMPANY IS SOMETHING YOU CAN TRACE IN ITS OWN RIGHT.

          THE FIRM, reading a row with nothing on the end of it: "again, at the companies, like,
          you should ask if you can trace them."

          THEY ARE RIGHT AND THE ROW WAS DEAD. A directorship cannot be rung and cannot answer, so
          `companies` is not a list you WORK -- no outcome picker, nothing to save onto the
          debtor's own contact list -- and that left the whole column with no action at all. But a
          company the debtor directs is exactly where the money is: it has its own registered
          address, its own directors and its own public record at CIPC.

          IT TRACES THE COMPANY, NOT THE DEBTOR. debtorKind 'company' is what decides which key is
          copied and which of the sources make sense -- CIPC and the VAT vendor search answer about
          a company and SASSA does not. The name comes off the row, which is what the bureau
          printed.
        */}
        {category === 'companies' ? (
          <TraceButton
            accountId={accountId}
            actor={actor}
            debtorKind="company"
            /* The bureau prints the registration number in the label where it has one; the name is
               what every source can be searched on either way. */
            idNumber={registrationIn(row.label)}
            debtorName={row.value}
            label="Trace this company"
            className="inline-flex items-center gap-1 text-sm font-medium px-2.5 py-1.5 rounded-lg
              border border-slate-200 text-slate-700 hover:bg-slate-50"
            onDone={onChanged}
            onUpload={onUploadNew}
          />
        ) : row.promoted ? (
          <span className="text-positive-700 inline-flex items-center gap-1.5 text-sm">
            <Check size={14} /> Saved
          </span>
        ) : savable ? (
          <div className="inline-flex items-center gap-1.5">
            {/*
              THE BUTTON SAYS WHAT IT WILL SAVE IT AS. The firm: "it's also important to notify
              when you save something, what is it? Is it a work number? Is it an additional email?
              Is it a house number?" It said "Save", and which of those a number became was
              something you found out afterwards by reading the contact list. See savesAs, which
              speaks the same vocabulary the account's own rows do.
            */}
            <button type="button" onClick={() => onPromote(false)} disabled={busy}
              title={`Save it on the account as ${savesAs(row.items[0])}`}
              className="inline-flex items-center gap-1 text-sm font-medium px-2.5 py-1.5 rounded-lg border border-gold-500 text-navy-950 hover:bg-gold-50">
              <Plus size={13} /> Save as {savesAs(row.items[0])}
            </button>
            {/*
              A RELATIVE GOES ON AS A NEXT OF KIN, labelled. The firm asked for it in those words,
              and the label is what stops a collector opening a call to somebody's sister as
              though she were the debtor.

              AND SO DOES A NUMBER SOMEBODY ELSE ANSWERED. THE FIRM: "if you reach someone else,
              or a next of kin, on a specific number on the phone numbers, you should be able to
              add them as a next of kin as well. Because now it only gives you save as work number
              -- but it's not tested, it doesn't make sense."

              WHICH IS THE CASE THE LIST SPLIT COULD NOT COVER. The linked-people list holds who
              the BUREAU connected; a wife who picks up the debtor's old mobile is somebody the
              COLLECTOR found, and until now the only thing offered was to file her line as the
              debtor's own work number. Offered exactly where it is true -- somebody answered and
              it was not the debtor -- which is what `reached_other` means.
            */}
            {(category === 'people' || row.outcome === 'reached_other') && (
              <button type="button" onClick={() => onPromote(true)} disabled={busy}
                className="text-xs font-medium text-[var(--c-steel)] hover:underline">
                as next of kin
              </button>
            )}
          </div>
        ) : (
          <span className="text-slate-400">{'—'}</span>
        )}
      </td>
    </tr>
  )
}
