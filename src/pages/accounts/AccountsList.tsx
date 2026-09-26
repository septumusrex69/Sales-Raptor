import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertTriangle, Loader2, Search, UserCheck, X } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { inputClass } from '../../components/ui/Modal'
import { useAppStore } from '../../store/AppStore'
import { ClientPicker } from '../../components/ui/ClientPicker'
import { useAuth } from '../../store/AuthContext'
import {
  fetchAccounts, fetchBookFacets, fetchBookSummary, fetchViewCounts, hasCommissionDrift,
  type BookFacets, type BookSummary, type DebtorAccount,
} from '../../lib/accountBook'
import { clearedFilters, filterChips, queryFromParams } from '../../lib/accountFilters'
import {
  QUIET_VIEW_DAYS, activeView, viewParams, viewsFor, type ViewCounts,
} from '../../lib/accountViews'
import { CLIENT_FLAGS, DESK_POSITIONS, clientFlag, deskPosition } from '../../lib/clientPosition'
import { AccountFilters } from './AccountFilters'
import { HandOutModal } from './HandOutModal'
import type { Selection } from '../../lib/accountAllocation'
import { canHandOutAccounts } from '../../lib/permissions'
import { formatCurrency, formatDate } from '../../data/mockData'

/*
 * HOW MANY ROWS COME BACK AT A TIME, and it is a choice rather than a constant because the two
 * jobs done on this screen are not the same job. Reading a client's book is a hundred at a time
 * and a scroll. Shuffling it — the firm's word for moving every account that has gone two month
 * ends without paying — is three thousand accounts that have to be ticked in one go, and a
 * hundred at a time makes that twenty-nine presses of a button at the bottom of the page.
 *
 * Offered at the TOP, next to the count it changes. It used to be only "Load 100 more" at the
 * foot of the table, which meant scrolling past everything on screen to ask for more of it.
 */
const PAGE_SIZES = [100, 500, 1000, 2000] as const
const PAGE_SIZE = PAGE_SIZES[0]

/** Who may ask for somebody else's desk. An agent's book is their own. */

/**
 * The collections book.
 *
 * Paged from the database rather than held in the app: this is the table that will reach hundreds
 * of thousands of rows, and a list that loads everything to show fifty is a list that stops
 * working the month it matters. Every filter goes to the database for the same reason — a
 * `.filter()` over the fifty rows on screen gives an answer that is right about the page and
 * wrong about the book.
 *
 * THE URL IS THE STATE. Narrowing the book is how somebody asks a question of it, and a question
 * you cannot paste into a message is half a tool.
 */
export function AccountsList() {
  const { companies, users, teams } = useAppStore()
  const { currentUser } = useAuth()
  const [params, setParams] = useSearchParams()
  const [accounts, setAccounts] = useState<DebtorAccount[]>([])
  const [summary, setSummary] = useState<BookSummary | null>(null)
  const [facets, setFacets] = useState<BookFacets | null>(null)
  const [viewCounts, setViewCounts] = useState<ViewCounts | null>(null)
  /** Appending, not replacing: pages beyond the first are added to what is already on screen. */
  const [loadingMore, setLoadingMore] = useState(false)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState(params.get('q') ?? '')
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  /** True once "select all N matching" is used: the selection is the filter, not a list of ids. */
  const [allMatching, setAllMatching] = useState(false)
  const [allocating, setAllocating] = useState<Selection | null>(null)
  /** Opened once from the URL, so closing it does not have it spring straight back. */
  const [handOutOpened, setHandOutOpened] = useState(false)
  const [done, setDone] = useState<string | null>(null)

  const companyId = params.get('client') ?? undefined
  const companyName = companies.find((c) => c.id === companyId)?.name
  const canSeeOthers = canHandOutAccounts(currentUser?.role)

  const setParam = useCallback((key: string, value: string | null) => {
    const next = new URLSearchParams(params)
    if (value === null || value === '') next.delete(key); else next.set(key, value)
    setParams(next, { replace: true })
    setPage(0)
  }, [params, setParams])

  const clearFilters = useCallback(() => {
    setParams(clearedFilters(params), { replace: true })
    setPage(0)
  }, [params, setParams])

  // The typed box is local so it stays responsive; the URL catches up after a pause. Writing
  // every keystroke into history would make the back button walk the surname letter by letter.
  useEffect(() => {
    const t = window.setTimeout(() => {
      if ((params.get('q') ?? '') !== search) setParam('q', search || null)
    }, 300)
    return () => window.clearTimeout(t)
  }, [search, params, setParam])

  const key = params.toString()
  const teamMembers = useCallback(
    (id: string) => teams.find((t) => t.id === id)?.memberIds ?? [],
    [teams],
  )
  const query = useMemo(
    () => queryFromParams(new URLSearchParams(key), new Date(), { teamMembers }),
    [key, teamMembers],
  )

  /*
   * A SELECTION DOES NOT SURVIVE A CHANGE OF QUESTION. Ticking eleven rows, then narrowing the
   * filters, then allocating would act on accounts no longer on screen — the worst kind of bulk
   * action, because it looks exactly like the right one.
   */
  useEffect(() => { setTicked(new Set()); setAllMatching(false) }, [key])

  /*
   * STRAIGHT INTO THE HAND-OUT, where the link said so.
   *
   * THE FIRM: "after I've accepted the handovers, it should immediately go to a state of where
   * they should be allocated and referred." Approving used to leave somebody on a filtered list
   * with the work still to find: tick the accounts, then find Hand out. The batch IS the
   * selection, so the link carries ?handout=1 and the screen opens on the thing to do.
   *
   * EVERYTHING THE FILTER MATCHES, not the page. A batch is often more than one page, and a
   * hand-out of the first fifty of two hundred is the worst possible outcome -- it looks done.
   *
   * ONCE. Closing the modal must not have it open again on the next render, and the flag is what
   * stops that; the link stays in the URL so the page can be reloaded and still be about the
   * batch, which is what the filter is for.
   */
  useEffect(() => {
    if (handOutOpened || !canSeeOthers) return
    if (new URLSearchParams(key).get('handout') !== '1') return
    setHandOutOpened(true)
    setAllMatching(true)
    setAllocating({ kind: 'matching', query })
  }, [key, query, handOutOpened, canSeeOthers])

  /*
   * The first page, whenever the question changes. Pages after it are appended by loadMore, so
   * this effect deliberately does not depend on `page` — otherwise loading more would refetch
   * from the top and throw away what is already on screen.
   */
  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null); setPage(0)
    void (async () => {
      try {
        const [res, sum] = await Promise.all([
          fetchAccounts({ ...query, page: 0, pageSize }),
          fetchBookSummary(query.companyId),
        ])
        if (cancelled) return
        setAccounts(res.accounts); setTotal(res.total); setSummary(sum)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [query, pageSize])

  async function loadMore() {
    setLoadingMore(true); setError(null)
    try {
      const next = page + 1
      const res = await fetchAccounts({ ...query, page: next, pageSize })
      /*
       * Merged by id rather than concatenated. The book is ordered by account number and rows can
       * move between pages while somebody reads — an account allocated, or a new handover landing
       * — and a blind concat shows the same account twice, which reads as a duplicate in the book
       * rather than as a paging artefact.
       */
      setAccounts((prev) => {
        const seen = new Set(prev.map((a) => a.id))
        return [...prev, ...res.accounts.filter((a) => !seen.has(a.id))]
      })
      setTotal(res.total)
      setPage(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoadingMore(false)
    }
  }

  // The dropdowns offer what the book holds, which changes with the client. Its own request, so
  // a slow facet count never holds up the list itself.
  useEffect(() => {
    let cancelled = false
    void fetchBookFacets(companyId)
      .then((f) => { if (!cancelled) setFacets(f) })
      .catch(() => { if (!cancelled) setFacets(null) })
    return () => { cancelled = true }
  }, [companyId])

  /*
   * The badges on the views row. Their own request too, and failing quietly: a view without a
   * number is still a working link, and a screen that refuses to show accounts because a count
   * did not come back would be trading the thing people came for against a decoration.
   */
  useEffect(() => {
    let cancelled = false
    void fetchViewCounts({
      userId: currentUser?.id ?? null,
      companyId,
      quietDays: QUIET_VIEW_DAYS,
    })
      .then((c) => { if (!cancelled) setViewCounts(c) })
      .catch(() => { if (!cancelled) setViewCounts(null) })
    return () => { cancelled = true }
  }, [companyId, currentUser?.id])

  const pageIds = accounts.map((a) => a.id)
  const allOnPageTicked = allMatching || (pageIds.length > 0 && pageIds.every((id) => ticked.has(id)))
  const selectedCount = allMatching ? total : ticked.size
  const canAllocate = canSeeOthers

  /*
   * Unticking a row while "all matching" is on drops back to THIS PAGE minus that row, rather
   * than to a selection of one. The alternative reads as a cancel — six hundred accounts go from
   * selected to not selected because somebody changed their mind about a single one — and the
   * count in the bar is the only warning they would get.
   */
  const toggle = (id: string) => {
    const base = allMatching ? new Set(pageIds) : ticked
    const next = new Set(base)
    if (next.has(id)) next.delete(id); else next.add(id)
    setAllMatching(false)
    setTicked(next)
  }

  const togglePage = () => {
    const next = new Set(allMatching ? [] : ticked)
    if (allOnPageTicked) for (const id of pageIds) next.delete(id)
    else for (const id of pageIds) next.add(id)
    setAllMatching(false)
    setTicked(next)
  }

  const clearSelection = () => { setTicked(new Set()); setAllMatching(false) }

  const reload = async () => {
    clearSelection()
    setPage(0)
    const [res, sum, counts] = await Promise.all([
      fetchAccounts({ ...query, page: 0, pageSize }),
      fetchBookSummary(query.companyId),
      fetchViewCounts({ userId: currentUser?.id ?? null, companyId, quietDays: QUIET_VIEW_DAYS })
        .catch(() => null),
    ])
    setAccounts(res.accounts); setTotal(res.total); setSummary(sum)
    if (counts) setViewCounts(counts)
  }

  const driftOnly = params.get('drift') === '1'
  const narrowed = filterChips(params).length > 0 || !!query.search
  const shown = accounts.length
  const current = activeView(params, currentUser?.id ?? null)
  const views = viewsFor(canSeeOthers)

  return (
    <div className="space-y-4">
      {/*
        NO LINK TO THE WORKFLOWS HERE. The firm, looking at the book: "you can see the workflow
        thing. I think you can remove it from there. It's already in the library."

        It was kept on this page when the workflows moved, on the argument that a workflow IS
        what happens to an account and somebody wondering about it is looking at the book. That
        argument was answered by the two places a workflow is now actually reached from: the
        Library, where they are written, and the account's own Workflow tab, which says what is
        running on the file in front of you. A third door into the same room, on a page about
        twenty-three thousand accounts, is a link that belongs to none of them.

        /accounts/workflows still redirects, for anyone holding the old bookmark.
      */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {/*
            The summary is the CLIENT'S WHOLE BOOK, not the filtered list, and says so. A tile
            that silently followed the filters would read "Accounts 3" next to a list of three
            and there would be no number left anywhere saying how big the book really is.
          */}
          <Tile label={narrowed ? 'Accounts (whole book)' : 'Accounts'} value={summary.accounts.toLocaleString('en-ZA')} />
          <Tile label="Capital handed over" value={formatCurrency(summary.capital)} />
          <Tile label={companyId ? 'Client' : 'Clients'} value={companyId ? (companyName ?? '—') : String(summary.clients)} />
          <Tile
            label="Off their mandate rate"
            value={summary.commissionDrift.toLocaleString('en-ZA')}
            tone={summary.commissionDrift > 0 ? 'warn' : undefined}
            action={summary.commissionDrift > 0
              ? { label: driftOnly ? 'Show all' : 'Show these', onClick: () => setParam('drift', driftOnly ? null : '1') }
              : undefined}
          />
        </div>
      )}

      {/*
        THE VIEWS ROW EXISTS BECAUSE THE DEFAULT WAS ARBITRARY. Six figures of accounts sorted
        alphabetically by account number is nobody's question — you open the book, land on
        "Abc1111", and cannot tell whether you are looking at the whole thing or a stray filter.
        The answer is not to start blank and make people build a query before they see anything;
        it is to make the questions people actually ask one click away, with the number attached.

        Each view is nothing but a set of URL parameters, so clicking one leaves the address bar
        saying exactly what is on screen: it can be pasted, bookmarked, narrowed further by hand,
        and cleared. None of that is true of a hidden mode.
      */}
      <div className="flex flex-wrap items-center gap-1.5">
        {views.map((v) => {
          const on = current === v.id
          const count = viewCounts?.[v.countKey as keyof ViewCounts]
          return (
            <button key={v.id} type="button" title={v.hint}
              onClick={() => {
                const next = viewParams(v.id, currentUser?.id ?? null)
                // The client survives a change of view: scoping the book to one client is a
                // different question from which view is being asked of it.
                if (companyId) next.set('client', companyId)
                setParams(next, { replace: true })
              }}
              className={`inline-flex items-center gap-1.5 text-sm rounded-lg border px-2.5 py-1.5 ${
                on
                  ? 'border-navy-950 bg-navy-950 text-white'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
              {v.label}
              {count !== undefined && (
                <span className={`tabular-nums text-[11px] ${on ? 'text-white/70' : 'text-slate-400'}`}>
                  {count.toLocaleString('en-ZA')}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2 p-4 border-b border-slate-100">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className={`${inputClass} pl-9`}
              placeholder="Account number, client reference or surname"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {/* Searchable, at the firm's asking. The book is filtered by client constantly and
              a wheel of every client is the slowest way there is to do it on an iPad. */}
          <div className="w-64">
            <ClientPicker
              clients={companies}
              value={companyId ?? ''}
              onChange={(id) => setParam('client', id || null)}
              clearLabel="All clients" />
          </div>
          <AccountFilters
            params={params} setParam={setParam} onClear={clearFilters}
            facets={facets} users={users} teams={teams} canSeeOthers={canSeeOthers}
          />
        </div>

        {/*
          THE BAR APPEARS ONLY WHEN SOMETHING IS SELECTED, and it says how many. A bulk action
          whose scope is implied by which boxes happen to be ticked somewhere above the fold is
          how two hundred accounts move without anybody meaning it.
        */}
        {selectedCount > 0 && (
          <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 bg-brand-50 border-b border-brand-100">
            <span className="text-sm font-medium text-brand-800 tabular-nums">
              {selectedCount.toLocaleString('en-ZA')} selected
            </span>
            {/*
              The page is not the book. Ticking the header box selects fifty, and without this
              there is no way to say "and the other six hundred" except by paging through them.
            */}
            {allOnPageTicked && !allMatching && total > accounts.length && (
              <button type="button" className="text-xs font-medium text-brand-700 underline"
                onClick={() => setAllMatching(true)}>
                Select all {total.toLocaleString('en-ZA')} matching
              </button>
            )}
            {allMatching && (
              <span className="text-xs text-brand-700">Everything these filters match, not just this page.</span>
            )}
            <div className="ml-auto flex items-center gap-2">
              {canAllocate && (
                <button type="button"
                  className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg bg-navy-950 text-white hover:bg-navy-900"
                  onClick={() => setAllocating(allMatching
                    ? { kind: 'matching', query }
                    : { kind: 'ids', ids: [...ticked] })}>
                  <UserCheck size={14} /> Hand out
                </button>
              )}
              <button type="button" className="text-slate-400 hover:text-slate-600 p-1" onClick={clearSelection}
                title="Clear the selection">
                <X size={15} />
              </button>
            </div>
          </div>
        )}

        {done && (
          <div className="flex items-start gap-2 px-4 py-2.5 text-sm text-emerald-800 bg-emerald-50 border-b border-emerald-100">
            <span className="flex-1">{done}</span>
            <button type="button" className="text-emerald-600 hover:text-emerald-800" onClick={() => setDone(null)}>
              <X size={14} />
            </button>
          </div>
        )}

        {error && (
          <div className="p-4 text-sm text-rose-700 bg-rose-50/50 flex items-start gap-2">
            <AlertTriangle size={15} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/*
          WHAT IS ON SCREEN AND WHY, said out loud. Without this line a filter left set from an
          hour ago looks exactly like a small book, and the only clue is a number on a button
          somebody has to notice. It is the sentence that answers "is this everything?" before
          anybody has to ask it.
        */}
        {!loading && accounts.length > 0 && (
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-4 py-2 border-b border-slate-100 bg-slate-50/50 text-xs text-slate-500">
            <span className="tabular-nums">
              Showing {shown.toLocaleString('en-ZA')} of {total.toLocaleString('en-ZA')}
            </span>
            <span className="text-slate-300">·</span>
            <span>{companyName ?? 'all clients'}</span>
            {narrowed && (
              <>
                <span className="text-slate-300">·</span>
                <span className="text-amber-700">narrowed</span>
                <button type="button" className="font-medium text-brand-600 hover:underline" onClick={clearFilters}>
                  Show the whole book
                </button>
              </>
            )}
            {/*
              HOW MANY ROWS, AT THE TOP, beside the count it changes. A shuffle needs every
              account ticked in one go, and reaching for it at the foot of a hundred rows means
              scrolling past all of them to ask for more of them.

              Only sizes the book can actually fill are offered. A "2 000" button on a client with
              310 accounts does nothing when pressed, and a control that does nothing is one
              people stop trusting the rest of.
            */}
            <span className="ml-auto flex items-center gap-1">
              <span className="text-slate-400">Show</span>
              {PAGE_SIZES.filter((n, i) => i === 0 || n <= total * 2).map((n) => (
                <button key={n} type="button" onClick={() => setPageSize(n)}
                  aria-pressed={pageSize === n}
                  className={`rounded-full border px-2 py-0.5 tabular-nums ${
                    pageSize === n
                      ? 'border-navy-950 bg-navy-950 text-white'
                      : 'border-slate-200 text-slate-600 hover:border-brand-300 hover:text-brand-700'}`}>
                  {n.toLocaleString('en-ZA')}
                </button>
              ))}
            </span>
          </div>
        )}

        {loading ? (
          <div className="p-10 grid place-items-center text-slate-400">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : accounts.length === 0 ? (
          <div className="p-10 text-center">
            {narrowed ? (
              <>
                <p className="text-sm text-slate-600">No accounts match these filters.</p>
                <button className="text-xs font-medium text-brand-600 hover:underline mt-1" onClick={clearFilters}>
                  Clear the filters
                </button>
              </>
            ) : (
              <>
                <p className="text-sm text-slate-600">No accounts here yet.</p>
                <p className="text-xs text-slate-400 mt-1">
                  The book comes across from Swordfish in <Link className="text-brand-600 underline" to="/settings">Settings → Data Import</Link>.
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
                  {canAllocate && (
                    <th className="pl-4 pr-1 py-2.5 w-8">
                      <input type="checkbox" className="accent-brand-600" checked={allOnPageTicked}
                        onChange={togglePage} aria-label="Select every account on this page" />
                    </th>
                  )}
                  <th className="px-4 py-2.5 font-medium">Account</th>
                  <th className="px-4 py-2.5 font-medium">Debtor</th>
                  <th className="px-4 py-2.5 font-medium text-right">Capital</th>
                  <th className="px-4 py-2.5 font-medium text-right">Paid</th>
                  <th className="px-4 py-2.5 font-medium text-right">Rate</th>
                  <th className="px-4 py-2.5 font-medium">Position</th>
                  <th className="px-4 py-2.5 font-medium">Desk</th>
                  <th className="px-4 py-2.5 font-medium">Last worked</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => {
                  const drift = hasCommissionDrift(a)
                  const desk = a.assignedTo ? users.find((u) => u.id === a.assignedTo)?.name : null
                  return (
                    <tr key={a.id} className={`border-b border-slate-50 last:border-0 ${
                      allMatching || ticked.has(a.id) ? 'bg-brand-50/50' : 'hover:bg-slate-50/60'}`}>
                      {canAllocate && (
                        <td className="pl-4 pr-1 py-2.5">
                          <input type="checkbox" className="accent-brand-600"
                            checked={allMatching || ticked.has(a.id)}
                            onChange={() => toggle(a.id)}
                            aria-label={`Select ${a.accountNumber ?? 'this account'}`} />
                        </td>
                      )}
                      <td className="px-4 py-2.5">
                        <Link to={`/accounts/${a.id}`} className="font-medium text-brand-700 hover:underline">
                          {a.accountNumber ?? '—'}
                        </Link>
                        {a.clientReference && <span className="block text-[11px] text-slate-400">{a.clientReference}</span>}
                      </td>
                      <td className="px-4 py-2.5 text-slate-700">
                        {[a.debtorFirstName, a.debtorSurname].filter(Boolean).join(' ') || '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{formatCurrency(a.capitalHandedOver)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">
                        {a.paymentsToDate ? formatCurrency(a.paymentsToDate) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {a.commissionRate === null ? (
                          <span className="text-slate-400">—</span>
                        ) : drift ? (
                          <span className="text-amber-700" title={`Mandate says ${pct(a.commissionRateExpected)}`}>
                            {pct(a.commissionRate)} <span className="text-amber-500">≠</span>
                          </span>
                        ) : (
                          <span className="text-slate-600">{pct(a.commissionRate)}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <PositionPill account={a} />
                      </td>
                      <td className="px-4 py-2.5 text-slate-500">
                        {desk ?? <span className="text-amber-600" title="Nobody is carrying this account.">Unallocated</span>}
                      </td>
                      <td className="px-4 py-2.5 text-slate-500">{a.lastActionAt ? formatDate(a.lastActionAt) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {!loading && shown < total && (
          <div className="flex flex-wrap items-center justify-between gap-2 p-4 border-t border-slate-100 text-sm">
            <span className="text-slate-500 tabular-nums">
              {(total - shown).toLocaleString('en-ZA')} more
            </span>
            <button className="btn-secondary inline-flex items-center gap-1.5"
              disabled={loadingMore} onClick={() => void loadMore()}>
              {loadingMore && <Loader2 size={14} className="animate-spin" />}
              Load {Math.min(pageSize, total - shown).toLocaleString('en-ZA')} more
            </button>
          </div>
        )}
      </Card>

      {allocating && (
        <HandOutModal
          selection={allocating}
          selectedCount={selectedCount}
          users={users}
          teams={teams}
          actor={{ id: currentUser?.id ?? null, name: currentUser?.name ?? null }}
          /* Only when the list is a single batch. A hand-out made out of some other filter has no
             one batch to point at, and a link to the wrong one is worse than a link to the desk. */
          handoverId={params.get('handover')}
          onClose={() => setAllocating(null)}
          onDone={async (message) => { setDone(message); await reload() }}
        />
      )}
    </div>
  )
}

const pct = (r: number | null) => (r === null ? '—' : `${(r * 100).toFixed(r * 100 % 1 === 0 ? 0 : 1)}%`)

function Tile({ label, value, tone, action }: {
  label: string; value: string; tone?: 'warn'; action?: { label: string; onClick: () => void }
}) {
  return (
    <Card className={tone === 'warn' ? 'border-amber-200' : undefined}>
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`text-xl font-semibold tabular-nums mt-0.5 ${tone === 'warn' ? 'text-amber-700' : 'text-slate-800'}`}>{value}</p>
      {action && (
        <button className="text-[11px] font-medium text-brand-600 hover:underline mt-1" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </Card>
  )
}

/**
 * Where the account stands, in the firm's own words.
 *
 * This column used to print debtor_accounts.status raw — "Active: Unfrozen", which describes how
 * the row got into the table and not one thing about the debtor. The position is derived from the
 * status, the sub-status and the freeze, by the same function the client's report uses, so the
 * list and the report cannot disagree about an account.
 *
 * NO PAYMENT SIGNAL HERE. `paidInPeriod` needs a reporting period and this list has none, so an
 * account that paid this month reads as whatever it was before the money — Arranged, usually.
 * The alternative would be to infer a period the person did not choose.
 */
export function PositionPill({ account }: { account: DebtorAccount }) {
  // status carries the freeze: freezeAccount() writes 'Frozen' to it, which is what
  // clientPosition() reads. frozenBy says who asked, not whether.
  /*
   * deskPosition, not clientPosition: this is our screen, and it carries the fourteenth rung the
   * firm keeps to itself. A never-worked account reads "New" here and "In progress" on the report
   * a client gets — see the note on DeskPosition.
   */
  const position = deskPosition({
    status: account.status,
    subStatus: account.subStatus,
    bucket: account.bucket,
    everWorked: !!account.lastActionAt,
  })
  const flag = clientFlag(position === 'new' ? 'in_progress' : position, !!account.clientActionAsk)
  const meta = DESK_POSITIONS[position]
  const tone = flag === 'client_action' ? 'bg-rose-50 text-rose-700'
    : flag === 'attention' ? 'bg-amber-50 text-amber-700'
      : flag === 'inactive' ? 'bg-slate-100 text-slate-500'
        : 'bg-emerald-50 text-emerald-700'
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${tone}`} title={meta.meaning}>
        {meta.label}
      </span>
      {account.clientActionAsk && (
        <span className="text-[11px] text-rose-600" title={account.clientActionAsk}>{CLIENT_FLAGS.client_action.dot}</span>
      )}
      {account.inDuplum && (
        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700"
          title="Non-capital has reached the capital handed over; it may not grow further.">
          in duplum
        </span>
      )}
    </span>
  )
}

/** The raw inherited status, where the raw status is what is being shown. */
export function StatusPill({ status, inDuplum }: { status: string; inDuplum?: boolean }) {
  const written = /written.off/i.test(status)
  const tone = written ? 'bg-slate-100 text-slate-500'
    : /active/i.test(status) ? 'bg-emerald-50 text-emerald-700'
      : 'bg-slate-100 text-slate-600'
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${tone}`}>{status || '—'}</span>
      {inDuplum && (
        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700" title="Non-capital has reached the capital handed over; it may not grow further.">
          in duplum
        </span>
      )}
    </span>
  )
}
