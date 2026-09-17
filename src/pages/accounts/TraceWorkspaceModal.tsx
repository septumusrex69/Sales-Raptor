import { useEffect, useMemo, useState } from 'react'
import {
  Briefcase, Building2, Check, ChevronLeft, ChevronRight, FileText, Home, Info, Loader2, Mail, MapPin,
  Phone, Plus, Search, User, Users,
} from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { PhoneLink } from '../../components/PhoneLink'
import {
  OUTCOME_OPTIONS, TRACE_CATEGORIES, TRACE_SORTS, canPromote, categoryById, categoryCounts,
  outcomeTone, pageOf, riskTone, workRows,
  type FiledTrace, type OutcomeFilter, type OutcomeTone, type TraceCategoryId,
  type TraceItem, type TraceItemKind, type TraceOutcome, type TraceRow, type TraceSort,
} from '../../lib/traceStore.ts'
import { promoteTraceItem, recordTraceOutcome, traceReportUrl } from '../../lib/traceStoreData.ts'
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

export function TraceWorkspaceModal({ traces, openId, onOpen, actor, onClose, onChanged }: {
  /** Every trace on the account, so a collector can move between them without closing this. */
  traces: FiledTrace[]
  openId: string
  onOpen: (traceId: string) => void
  actor: { id: string | null; name: string | null }
  onClose: () => void
  onChanged: () => Promise<void>
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
  async function promote(row: TraceRow, asNextOfKin: boolean) {
    const item = row.items.find((i) => i.promotedContactId === null) ?? row.items[0]
    setBusy(row.key); setError(null)
    try {
      await promoteTraceItem({
        item, accountId: trace.accountId,
        /* Whose profile it came off. On a director's trace the contact is that director's. */
        subjectName: trace.subjectKind === 'director' ? trace.subjectName : null,
        asNextOfKin,
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
      window.open(await traceReportUrl(trace.documentId), '_blank', 'noopener')
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
                <span className="ml-1.5 text-slate-400 font-normal">
                  {'·'} {t.subjectKind === 'director' ? 'Director' : 'Company'}
                </span>
              </button>
            ))}
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
                    {OUTCOME_OPTIONS.filter((o) => o.outcome !== null).map((o) => (
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
                          busy={busy === row.key}
                          onOutcome={(o) => void setOutcome(row, o)}
                          onPromote={(kin) => void promote(row, kin)} />
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

function Row({ row, category, worked, busy, onOutcome, onPromote }: {
  row: TraceRow
  category: TraceCategoryId
  worked: boolean
  busy: boolean
  onOutcome: (outcome: TraceOutcome | null) => void
  onPromote: (asNextOfKin: boolean) => void
}) {
  const dialable = category === 'phones'
  const ruledOut = row.outcome === 'not_theirs' || row.outcome === 'unreachable'
  /* Ruled out or a property: there is nothing to put on the contact list. */
  const savable = row.items.some(canPromote)

  return (
    <tr className="align-middle">
      <td className="px-3 py-2.5">
        <div className="flex items-start gap-2.5">
          {dialable && <Phone size={14} className="mt-1 shrink-0 text-slate-400" />}
          <div className="min-w-0">
            <div className={`break-words ${ruledOut ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
              {/* Dialled from here, through the same button as everywhere else in the app. */}
              {dialable && !ruledOut ? <PhoneLink number={row.value} /> : row.value}
            </div>
            {/*
              THE TYPES IT WAS FILED UNDER, which is the whole evidence that this row is three
              of the bureau's. A number that is the Cell, the Home and the Work number is one
              line somebody uses for everything — worth knowing before you ring it.
            */}
            <p className="text-xs text-slate-400">
              {[
                category === 'phones'
                  ? row.kinds.map((k) => KIND_WORD[k]).filter(Boolean).join(' · ')
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
              title={OUTCOME_OPTIONS.find((o) => o.outcome === row.outcome)?.meaning}
              className="text-sm rounded-lg border border-slate-200 pl-1.5 pr-1 py-1.5 bg-white text-slate-700">
              {OUTCOME_OPTIONS.map((o) => (
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
        {row.promoted ? (
          <span className="text-positive-700 inline-flex items-center gap-1.5 text-sm">
            <Check size={14} /> Saved
          </span>
        ) : savable ? (
          <div className="inline-flex items-center gap-1.5">
            <button type="button" onClick={() => onPromote(false)} disabled={busy}
              className="inline-flex items-center gap-1 text-sm font-medium px-2.5 py-1.5 rounded-lg border border-gold-500 text-navy-950 hover:bg-gold-50">
              <Plus size={13} /> Save
            </button>
            {/*
              A RELATIVE GOES ON AS A NEXT OF KIN, labelled. The firm asked for it in those words,
              and the label is what stops a collector opening a call to somebody's sister as
              though she were the debtor.
            */}
            {category === 'people' && (
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
