import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { ArrowRight, Banknote, Coins, FileSignature, FileText, Handshake, Loader2 } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Card } from '../components/ui/Card'
import { CollectionsHero } from '../components/collections/CollectionsHero'
import { MyDetailsMissing } from '../components/dashboard/MyDetailsMissing'
import { MonthControls } from '../components/collections/MonthControls'
import { MonthProgress } from '../components/collections/MonthProgress'
import { useAppStore } from '../store/AppStore'
import { useAuth } from '../store/AuthContext'
import { useCollectionsMonth } from '../hooks/useCollectionsMonth'
import { bookSlices, departmentHeadline, intakeBars, intakeComparison, intakeSplit, salesSnapshot, type BookSlice, type BookSnapshot, type IntakeBar, type IntakeRow } from '../lib/companySnapshot'
import { getPreviousSalesMonth } from '../lib/salesMonth'
import { viewParams } from '../lib/accountViews'
import { fetchBookSnapshot, fetchIntakeByDay, isoDay } from '../lib/companySnapshotData'
import { DEPARTMENTS, dashboardPathFor, departmentOf, myDashboardPath, type Department } from '../lib/departments'
import { formatCurrency } from '../data/mockData'

/**
 * THE COMPANY DASHBOARD — the screen everybody in the firm opens Raptor on.
 *
 * THE FIRM ASKED FOR ONE, and the reason is not reporting: "it's important for everybody in the
 * company to understand that we are a collective. So it's important to go into the company
 * dashboard as the first thing that you see. And then you should go to your own stuff."
 *
 * IT IS THE ONLY SCREEN THAT WEARS THE PHOTOGRAPH. The hero was built for the collections
 * dashboard and the firm moved it here whole — "I want the epicness of the collections
 * dashboard, that picture that we made. That should be the main. When you open the company, you
 * should see epicness" — with the instruction that nothing about it changes: the picture stays
 * full height, the four figures stay over it, and the period controls and the month bar stay
 * INSIDE the dark panel rather than becoming cards underneath. Every other dashboard in Raptor
 * wears the ordinary brand band, so that landing here reads as arriving somewhere.
 *
 * IT LEADS WITH COLLECTIONS BECAUSE THE FIRM DOES. "The whole company is tied to the output of
 * the collections ... the main thing ultimately is how much we've collected, because we work on
 * commission." The same figures appear again on the collections dashboard, at the firm's
 * instruction — "we can repeat the same figures" — and they are worked out once, in
 * useCollectionsMonth, so the two can never disagree.
 *
 * WHAT IS DELIBERATELY ABSENT IS THE FIRM'S OWN INCOME. No commission, no Annexure B revenue.
 * The firm, agreeing the screen: "we're not going to be disclosing commission and income from
 * the Annexure B fees. We'll do that on another place, which is not even for an administrator."
 * Everything here is either the client's money to recover or a count of work.
 */
export function CompanyDashboard() {
  const { users, leads, deals } = useAppStore()
  const { currentUser } = useAuth()
  const month = useCollectionsMonth()
  const [book, setBook] = useState<BookSnapshot | null>(null)
  const [bookError, setBookError] = useState<string | null>(null)
  const [intake, setIntake] = useState<IntakeRow[] | null>(null)
  const [prior, setPrior] = useState<IntakeRow[] | null>(null)
  /* ACCOUNTS OR RAND (the firm, 18 Oct): ten small accounts and one of R500 000 are different days. */
  const [measure, setMeasure] = useState<'accounts' | 'capital'>('accounts')
  const [barsError, setBarsError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setBook(null); setBookError(null)
    fetchBookSnapshot(month.period)
      .then((snapshot) => { if (!cancelled) setBook(snapshot) })
      .catch((e) => { if (!cancelled) setBookError(e instanceof Error ? e.message : String(e)) })
    return () => { cancelled = true }
  }, [month.period])

  useEffect(() => {
    let cancelled = false
    setIntake(null); setBarsError(null)
    setPrior(null)
    fetchIntakeByDay(month.period)
      .then((rows) => { if (!cancelled) setIntake(rows) })
      .catch((e) => { if (!cancelled) setBarsError(e instanceof Error ? e.message : String(e)) })
    /* Last month, for the faint bars behind and the "up from" words. Unreadable, it is simply left
       off -- this month's chart does not wait on it or fail with it. */
    fetchIntakeByDay(getPreviousSalesMonth(month.period))
      .then((rows) => { if (!cancelled) setPrior(rows) })
      .catch(() => { if (!cancelled) setPrior([]) })
    return () => { cancelled = true }
  }, [month.period])

  /* Every day of the period, the as-at day deciding which are still to come. */
  const bars = useMemo(() => {
    if (intake === null) return null
    const before = getPreviousSalesMonth(month.period)
    return intakeBars(isoDay(month.period.start), isoDay(month.period.end), intake, isoDay(month.asAt),
      prior === null ? undefined : { fromIso: isoDay(before.start), toIso: isoDay(before.end), rows: prior })
  }, [intake, prior, month.period, month.asAt])
  const compare = bars ? intakeComparison(bars) : null
  const split = bars ? intakeSplit(bars) : null
  const navigate = useNavigate()
  /* WHERE EACH FIGURE OPENS (the firm, 18 Oct: the numbers were dead ends). The account list's own
     saved views where one asks exactly this question, so the list and the figure agree on the rule. */
  const accountsLink = (p: URLSearchParams) => `/accounts?${p.toString()}`
  const handedOver = (from: string, to: string) => accountsLink(new URLSearchParams({ book: 'whole', from, to }))

  /* The sales side is a few hundred rows AppStore already holds, so it is counted here rather
     than asked for again. See companySnapshot.ts on why a mandate is not a deal value. */
  const sales = useMemo(() => salesSnapshot(leads, deals, month.period), [leads, deals, month.period])

  /* Live people only, by department, so a card's headcount is the number of people doing that
     job today. byDepartment already drops the archived; this is the same reading of the role. */
  const headcount = useMemo(() => {
    const counts = new Map<Department, number>()
    for (const u of users) {
      if (u.status === 'Inactive') continue
      const d = departmentOf(u.role)
      counts.set(d, (counts.get(d) ?? 0) + 1)
    }
    return counts
  }, [users])

  const mine = departmentOf(currentUser?.role)

  return (
    <div className="space-y-4">
      <CollectionsHero
        figures={month.figures}
        filters={<MonthControls month={month} />}
        /*
          THE WAY OUT OF THE COMPANY SCREEN AND INTO YOUR OWN, in the hero's action slot where the
          collections dashboard keeps its export. The firm asked for a button rather than a
          toggle: "you shouldn't be able to toggle between them — there should just be maybe a
          button that's like, go to my dashboard."
        */
        action={
          <Link to={myDashboardPath(currentUser?.role)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/10
              px-3 py-1.5 text-xs font-medium text-white hover:bg-white/20">
            Go to my dashboard <ArrowRight size={14} />
          </Link>
        }
        progress={<MonthProgress pace={month.pace} line={month.line} tone="dark" measured={month.measured}
          note={month.floor.withTarget < month.floor.members
            ? `${month.floor.members - month.floor.withTarget} of ${month.floor.members} have no target, so the total is short by their share.`
            : undefined} />}
      />

      {month.error && (
        <Card className="border-rose-200">
          <p className="text-sm text-rose-700">{month.error}</p>
        </Card>
      )}

      {/*
        THE ONE THING ON THIS SCREEN THAT IS ABOUT YOU RATHER THAN THE FIRM, and it is here
        because this is the screen everybody lands on. The firm: "if someone doesn't have a phone
        number entered, it should be on their dashboard as a warning." It draws nothing at all
        where there is nothing missing, so the collective screen stays the collective screen.
      */}
      <MyDetailsMissing />

      {/*
        THE FIRM'S LAYOUT (18 Oct, from their own mock-up): two cards side by side -- what came in, as a
        bar a day with the sales tiles under it, and the book as a ring -- then the departments as one
        row. The hero above is untouched (CLAUDE.md: it moved house and did not change).
      */}
      <div className="grid gap-4 lg:grid-cols-5">
        {/* ---------- what came in ---------- */}
        <Panel className="lg:col-span-3" title="Work coming in" why={`Handed to us in ${month.period.label}`}
          to={handedOver(isoDay(month.period.start), isoDay(month.period.end))} testId="work-coming-in">
          {/*
            SAID IN WORDS, ONCE, because a six-figure number on a dashboard is read as the firm's
            money unless something says otherwise. It is the client's book to recover.
          */}
          <p className="mb-2 text-xs text-slate-500" data-testid="intake-line">
            {book === null ? '\u00a0' : <>
              <span className="font-semibold text-slate-700">{count(book.intakeAccounts)} accounts</span>
              {' from '}{count(book.intakeClients)} {book.intakeClients === 1 ? 'client' : 'clients'}
              {compare && <span data-testid="intake-compare" className={clsx('font-medium',
                compare.now > compare.then ? 'text-emerald-700' : compare.now < compare.then ? 'text-rose-600' : 'text-slate-500')}>
                {', '}{compare.words}</span>}
              {' · '}{money(book.intakeCapital)} capital at handover — the client's money to recover, not the firm's.
            </>}
          </p>
          {split && (
            /* TOTAL, EXISTING, NEW (the firm, 18 Oct). A client is new for its first three months of
               handovers, counted from its first account; the legend says so on hover. */
            <div className="mb-2 grid grid-cols-3 gap-2" data-testid="intake-split">
              {([
                ['Total', split.total, null],
                ['Existing clients', split.existing, 'var(--color-gold-400)'],
                ['New clients', split.fresh, 'var(--color-navy-700)'],
              ] as const).map(([label, v, colour]) => (
                <div key={label} className="rounded-lg bg-slate-50 px-3 py-2"
                  title={label === 'New clients' ? 'Inside their first three months of handovers, counted from their first account. Sales\u2019 work.'
                    : label === 'Existing clients' ? 'Past their first three months. Communications\u2019 work.' : undefined}>
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                    {colour && <span className="h-2 w-2 rounded-sm" style={{ background: colour }} />}{label}
                  </div>
                  <div className="text-base font-bold tabular-nums text-slate-800">{measure === 'accounts' ? count(v.accounts) : money(v.capital)}</div>
                </div>
              ))}
            </div>
          )}
          <div className="mb-1 flex justify-end">
            <div className="inline-flex rounded-lg border border-slate-200 p-0.5 text-[11px]" role="radiogroup" aria-label="Show the bars as">
              {(['accounts', 'capital'] as const).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={measure === m} data-testid={`measure-${m}`}
                  onClick={() => setMeasure(m)}
                  className={clsx('rounded-md px-2 py-0.5', measure === m ? 'bg-navy-900 text-white' : 'text-slate-500 hover:text-slate-700')}>
                  {m === 'accounts' ? 'Accounts' : 'Rand'}
                </button>
              ))}
            </div>
          </div>
          <Figures loading={bars === null && barsError === null} error={barsError} plain>
            <IntakeChart bars={bars ?? []} measure={measure}
              onDay={(b) => navigate(handedOver(b.day, b.day))} />
          </Figures>
          <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
            <SalesTile icon={<FileText size={16} />} label="Open leads" value={count(sales.openLeads)}
              hint={`${sales.leadsAdded.toLocaleString('en-ZA')} added this period.`} />
            <SalesTile icon={<FileSignature size={16} />} label="Mandates signed" value={count(sales.mandatesSigned)}
              hint={sales.mandateBook > 0
                ? `${formatCurrency(sales.mandateBook)} of book signed this period.`
                : 'Handover deals won this period. A signed book earns nothing at signature.'} />
            <SalesTile icon={<Handshake size={16} />} label="Deals open" value={count(sales.dealsOpen)}
              hint={`${formatCurrency(sales.dealsOpenValue)} in play.`} />
            <SalesTile icon={<Coins size={16} />} label="Deal value won" value={money(sales.dealsWonValue)}
              hint="Service deals won this period. Mandates are counted beside them, not in here." />
          </div>
        </Panel>

        {/* ---------- what we are holding ---------- */}
        <Panel className="lg:col-span-2" title="The book" why="What the firm is holding right now" to={accountsLink(viewParams('whole_book', null))} testId="the-book">
          <Figures loading={book === null} error={bookError} plain>
            {book && <BookRing book={book} links={{
              worked: accountsLink(new URLSearchParams({ book: 'active' })),
              unallocated: accountsLink(viewParams('unallocated', null)),
              quiet: accountsLink(viewParams('gone_quiet', null)),
              clients: '/clients',
            }} />}
          </Figures>
          {book !== null && (
            <div className="mt-4 flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-3" data-testid="owed">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-white text-slate-500"><Banknote size={18} /></span>
              <div>
                <div className="text-xs text-slate-500" title="Capital outstanding across the accounts being worked. The client's to recover.">Owed on those accounts</div>
                <div className="text-xl font-bold tabular-nums text-slate-800">{money(book.activeCapital)}</div>
              </div>
            </div>
          )}
          {/*
            THE NUMBER THAT WOULD OTHERWISE BE A FALSE ALARM.

            last_action_at was only ever written by the Swordfish import until Raptor began stamping
            it, so most of the imported book carries no action at all. Folded into "gone quiet" it
            would read as a firm that has abandoned fourteen thousand accounts; left off entirely it
            would hide a real gap. So it is said plainly, once, and named for what it is.
          */}
          {book !== null && book.neverActioned > 0 && (
            <p className="mt-2 text-xs text-slate-400">
              {book.neverActioned.toLocaleString('en-ZA')} live accounts have no action recorded in
              Raptor yet — most of them came across from Swordfish, which did not carry one.
            </p>
          )}
        </Panel>
      </div>

      {/* ---------- the departments ---------- */}
      <Section title="Departments" why="Everybody sees everybody's headline. Yours opens in full.">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="departments">
          {DEPARTMENTS.filter((d) => d.id !== 'Other').map((d) => (
            <DepartmentCard key={d.id} id={d.id} label={d.label} blurb={d.blurb}
              people={headcount.get(d.id) ?? 0} ours={d.id === mine}
              headline={departmentHeadline(d.id, {
                collected: month.rows === null ? null : month.figures.collected,
                mandates: sales.mandatesSigned,
                intakeClients: book?.intakeClients ?? null,
                intakeAccounts: book?.intakeAccounts ?? null,
                fromNew: split ? split.fresh.accounts : null,
                fromExisting: split ? split.existing.accounts : null,
              }, formatCurrency)} />
          ))}
        </div>
      </Section>

      <p className="border-t border-slate-200 pt-3 text-xs text-slate-400">
        Everyone in the firm lands here. Commission and Annexure B income are deliberately not on
        it — those belong to the finance screen, which is a separate build and a narrower audience.
      </p>
    </div>
  )
}

/* ---------- the parts ---------- */

function Section({ title, why, children }: { title: string; why: string; children: React.ReactNode }) {
  return (
    <section className="pt-2">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-base font-bold text-slate-800">{title}</h2>
        <p className="text-xs text-slate-400">{why}</p>
      </div>
      {children}
    </section>
  )
}

/**
 * A row of figures that has not arrived yet, or could not.
 *
 * A SPINNER RATHER THAN ZEROES. A tile reading "0 accounts" while the count is in flight is not
 * a slower answer, it is a wrong one — and on a screen the whole firm opens, a wrong nought is
 * read and repeated before it corrects itself.
 */
function Figures({ loading, error, plain, children }: {
  loading: boolean
  error: string | null
  /** Inside a panel already: no card of its own, and the children drawn as they are, not as a tile grid. */
  plain?: boolean
  children: React.ReactNode
}) {
  if (error) {
    return (
      <Card className="border-rose-200">
        <p className="text-sm text-rose-700">These figures could not be counted: {error}</p>
      </Card>
    )
  }
  if (loading && plain) {
    return (
      <div className="grid place-items-center py-10 text-slate-400">
        <Loader2 size={18} className="animate-spin" />
      </div>
    )
  }
  if (plain) return <>{children}</>
  if (loading) {
    return (
      <Card>
        <div className="grid place-items-center py-6 text-slate-400">
          <Loader2 size={18} className="animate-spin" />
        </div>
      </Card>
    )
  }
  return <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-3">{children}</div>
}

/**
 * One department, and the way into it.
 *
 * YOURS IS MARKED, and only yours opens in full: the firm wants the headline shared with
 * everybody and the detail kept where the work is. "Every person in the call centre has a whole
 * department which should be monitored together as a big team, and then they have smaller teams
 * ... their own statistics is important, their team statistics is important, and their
 * department statistics is important for them to see."
 */
function DepartmentCard({ id, label, blurb, people, ours, headline }: {
  id: Department
  label: string
  blurb: string
  people: number
  ours: boolean
  headline: { value: string; label: string } | null
}) {
  const photo = DEPARTMENT_PHOTO[id]
  /*
   * A PHOTOGRAPH A DEPARTMENT (the firm, 18 Oct, sending the four pictures and the mock-up: "do
   * this"). The desk for administration, the summit for sales, the open sea for communications, the
   * headset for the call centre. The words sit on a dark wash from the left so they read on any part
   * of the picture, in light and dark skins alike. Yours wears the gold edge.
   */
  return (
    <div data-testid={`department-${id}`}
      className={clsx('relative isolate overflow-hidden rounded-2xl bg-navy-950 text-white min-h-[150px]',
        ours ? 'ring-2 ring-gold-400' : 'ring-1 ring-black/5')}>
      {photo && <img src={photo} alt="" loading="lazy" className="absolute inset-0 -z-10 h-full w-full object-cover" />}
      <div className="absolute inset-0 -z-10 bg-gradient-to-r from-navy-950/90 via-navy-950/65 to-navy-950/10" />
      <div className="flex h-full flex-col gap-1.5 p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-base font-bold leading-tight">{label}</h3>
          <span className="shrink-0 text-xs tabular-nums text-white/75">
            {people === 1 ? '1 person' : `${people} people`}
          </span>
        </div>
        <p className="max-w-[17rem] text-[12.5px] leading-snug text-white/85">{blurb}</p>
        {headline && (
          <p className="text-xs text-white/80" data-testid={`headline-${id}`}>
            <span className="font-bold tabular-nums text-gold-300">{headline.value}</span> {headline.label}
          </p>
        )}
        <Link to={dashboardPathFor(id)}
          className={clsx('mt-auto inline-flex w-fit items-center gap-1.5 rounded-lg border px-4 py-1.5 text-xs font-semibold backdrop-blur-sm',
            ours ? 'border-gold-400 bg-gold-400 text-navy-950 hover:bg-gold-300' : 'border-white/40 bg-navy-950/40 hover:bg-navy-950/70')}>
          {ours ? 'Yours' : 'Open'} <ArrowRight size={13} />
        </Link>
      </div>
    </div>
  )
}

const DEPARTMENT_PHOTO: Partial<Record<Department, string>> = {
  'Administration': '/brand/departments/administration.webp',
  'Sales': '/brand/departments/sales.webp',
  'Communications': '/brand/departments/communications.webp',
  'Call centre': '/brand/departments/call-centre.webp',
}


/** A white card with a title, a quiet subtitle and "View all" -- the firm's mock-up, both panels. */
function Panel({ title, why, to, testId, className, children }: {
  title: string
  why: string
  to: string
  testId: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <section className={clsx('card p-5', className)} data-testid={testId}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <h2 className="text-base font-bold text-slate-800">{title}</h2>
          <p className="text-xs text-slate-400">{why}</p>
        </div>
        <Link to={to} className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
          View all <ArrowRight size={13} />
        </Link>
      </div>
      {children}
    </section>
  )
}

/**
 * A BAR A DAY, the firm's own picture of "Work coming in".
 *
 * Gold for a working day, grey for a weekend (a short Saturday is a closed day, not a slow one), and
 * a day still to come drawn as an empty slot rather than a nought bar. LAST MONTH sits faintly behind,
 * day for day, so growing or drying up is read at a glance (the firm, 18 Oct). A bar is a way in:
 * clicking it opens the accounts handed over that day. Accounts or rand -- the rand is capital at
 * handover, the client's money to recover; nothing here is the firm's.
 */
function IntakeChart({ bars, measure, onDay }: {
  bars: IntakeBar[]
  measure: 'accounts' | 'capital'
  onDay: (b: IntakeBar) => void
}) {
  const key = measure === 'accounts' ? 'accounts' : 'capital'
  /*
   * EACH BAR IN TWO PARTS (the firm, 18 Oct): gold for work from EXISTING clients (Communications'),
   * navy for work from NEW clients -- inside their first three months (Sales'). A weekend is no longer
   * drawn grey: the colour now says whose work it was, and one colour cannot say two things.
   */
  const data = bars.map((b) => ({
    ...b,
    fromExisting: measure === 'accounts' ? b.accounts - b.newAccounts : b.capital - b.newCapital,
    fromNew: measure === 'accounts' ? b.newAccounts : b.newCapital,
  }))
  const priorKey = measure === 'accounts' ? 'priorAccounts' : 'priorCapital'
  const max = Math.max(0, ...bars.map((b) => Math.max(b[key], b[priorKey] ?? 0)))
  const fmt = (v: number) => measure === 'accounts' ? v.toLocaleString('en-ZA') : shortRand(v)
  return (
    <div className="h-48 [&_*:focus]:outline-none" data-testid="intake-chart">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} accessibilityLayer={false} margin={{ top: 4, right: 0, bottom: 0, left: measure === 'accounts' ? -24 : -4 }} barCategoryGap="18%" barGap="-100%">
          {/* barGap -100%: last month's bar sits BEHIND this month's, not beside it. */}
          <CartesianGrid vertical={false} stroke="var(--color-slate-100)" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} interval={0}
            tick={{ fontSize: 10, fill: 'var(--color-slate-400)' }} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={measure === 'accounts' ? 40 : 52}
            domain={[0, max > 0 ? 'auto' : 4]} tickFormatter={fmt} tick={{ fontSize: 10, fill: 'var(--color-slate-400)' }} />
          <Tooltip cursor={{ fill: 'var(--color-slate-50)' }}
            content={({ active, payload }) => {
              const b = payload?.[0]?.payload as IntakeBar | undefined
              if (!active || !b) return null
              const now = measure === 'accounts' ? `${b.accounts.toLocaleString('en-ZA')} ${b.accounts === 1 ? 'account' : 'accounts'}` : rand0(b.capital)
              const split = measure === 'accounts'
                ? { existing: (b.accounts - b.newAccounts).toLocaleString('en-ZA'), fresh: b.newAccounts.toLocaleString('en-ZA') }
                : { existing: rand0(b.capital - b.newCapital), fresh: rand0(b.newCapital) }
              const then = b[priorKey] === null ? null : measure === 'accounts' ? `${(b.priorAccounts ?? 0).toLocaleString('en-ZA')}` : rand0(b.priorCapital ?? 0)
              return (
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
                  <div className="font-semibold text-slate-800">{longDay(b.day)}</div>
                  <div className="text-slate-600">{b.future ? 'Still to come' : `${now} handed over`}</div>
                  {!b.future && b.accounts > 0 && (
                    <div className="text-slate-500">{split.existing} from existing clients · {split.fresh} from new</div>
                  )}
                  {then !== null && <div className="text-slate-400">Same day last month: {then}</div>}
                  {!b.future && b.accounts > 0 && <div className="mt-1 text-gold-700">Click to open them</div>}
                </div>
              )
            }} />
          <Bar dataKey={priorKey} fill="var(--color-slate-200)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
          {(['fromExisting', 'fromNew'] as const).map((part) => (
            <Bar key={part} dataKey={part} stackId="now" radius={part === 'fromNew' ? [3, 3, 0, 0] : [0, 0, 0, 0]} isAnimationActive={false}
              onClick={(d: { payload?: IntakeBar }) => { if (d?.payload && d.payload.accounts > 0) onDay(d.payload) }}>
              {data.map((b) => (
                <Cell key={b.day} cursor={b.accounts > 0 ? 'pointer' : undefined}
                  fill={b.future ? 'transparent' : part === 'fromNew' ? 'var(--color-navy-700)' : 'var(--color-gold-400)'} />
              ))}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/* "R 187 500" on the tooltip; "R188k" on the axis, where five digits do not fit. */
const rand0 = (v: number): string => `R ${Math.round(v).toLocaleString('en-ZA')}`
const shortRand = (v: number): string => v >= 1_000_000 ? `R${(v / 1_000_000).toFixed(1)}m` : v >= 1000 ? `R${Math.round(v / 1000)}k` : `R${Math.round(v)}`

/** A legend line that opens its accounts, the arrow appearing on hover. */
function LegendRow({ to, testId, dot, label, value, tone }: {
  to?: string
  testId: string
  dot?: React.ReactNode
  label: string
  value: string
  tone?: 'warn' | 'bad'
}) {
  const inner = (
    <>
      {dot ?? <span className="h-2.5 w-2.5 shrink-0" />}
      <span className="flex-1 text-slate-600">{label}</span>
      <span className={clsx('font-semibold tabular-nums', tone === 'warn' ? 'rounded bg-gold-100 px-1.5 text-gold-800'
        : tone === 'bad' ? 'text-rose-600' : 'text-slate-800')}>{value}</span>
      {to && <ArrowRight size={12} className="shrink-0 text-slate-300 group-hover:text-slate-600" />}
    </>
  )
  return to
    ? <Link to={to} data-testid={testId} className="group -mx-1.5 flex items-center gap-2 rounded-md px-1.5 py-0.5 hover:bg-slate-50">{inner}</Link>
    : <div data-testid={testId} className="flex items-center gap-2 py-0.5">{inner}</div>
}

const RING_COLOUR: Record<BookSlice['key'], string> = {
  worked: 'var(--color-navy-900)',
  unallocated: 'var(--color-gold-400)',
  not_worked: 'var(--color-slate-300)',
}

/** The book as a ring that adds up (bookSlices), with the two figures that are not slices under it. */
function BookRing({ book, links }: {
  book: BookSnapshot
  links: { worked: string; unallocated: string; quiet: string; clients: string }
}) {
  const slices = bookSlices(book)
  const to: Partial<Record<BookSlice['key'], string>> = { worked: links.worked, unallocated: links.unallocated }
  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center" data-testid="book-ring">
      <Ring slices={slices} total={book.bookAccounts} />
      <ul className="w-full space-y-2 text-sm">
        {slices.map((s) => {
          /* NOT YET ALLOCATED IS A JOB, so it is gold when it is not nought (the firm, 18 Oct). */
          const alert = s.key === 'unallocated' && s.value > 0
          return (
            <li key={s.key} title={s.key === 'not_worked' ? 'On the book and not live: closed, on hold, written off or frozen.' : undefined}>
              <LegendRow to={to[s.key]} testId={`ring-${s.key}`}
                dot={<span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: RING_COLOUR[s.key] }} />}
                label={s.label} value={count(s.value)} tone={alert ? 'warn' : undefined} />
            </li>
          )
        })}
        <li className="border-t border-slate-100 pt-2">
          <LegendRow to={links.clients} testId="ring-clients" label="Clients with live accounts" value={count(book.activeClients)} />
        </li>
        <li title="Worked at some point, and not in the last 30 days. Accounts with no action recorded in Raptor at all are counted separately.">
          <LegendRow to={links.quiet} testId="ring-quiet" label="Gone quiet" value={count(book.quietAccounts)}
            tone={book.quietAccounts > 0 ? 'bad' : undefined} />
        </li>
      </ul>
    </div>
  )
}

/**
 * THE RING ITSELF. Not RingDonut: that one draws its own legend under the ring in a single line,
 * which on a half-width panel ran off the card, and this panel's legend is the list beside it.
 * A plain stroked circle per slice, as RingDonut draws them, so every ring in the app reads alike.
 */
function Ring({ slices, total }: { slices: BookSlice[]; total: number }) {
  const size = 168, stroke = 24, r = (size - stroke) / 2, c = 2 * Math.PI * r
  const sum = slices.reduce((t, x) => t + x.value, 0)
  const live = slices.filter((x) => x.value > 0)
  const gap = live.length > 1 ? 3 : 0
  let at = 0
  return (
    <div className="relative h-[168px] w-[168px] shrink-0">
      <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full -rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-slate-100)" strokeWidth={stroke} />
        {sum > 0 && live.map((x) => {
          const raw = (x.value / sum) * c
          const len = Math.max(raw - gap, 0.01)
          const el = (
            <circle key={x.key} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={RING_COLOUR[x.key]}
              strokeWidth={stroke} strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-at} />
          )
          at += raw
          return el
        })}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold tabular-nums text-slate-800">{count(total)}</span>
        <span className="text-xs text-slate-500">{total === 1 ? 'Account' : 'Accounts'}</span>
      </div>
    </div>
  )
}

/** One of the four sales figures, drawn as the mock-up has them: the icon in its own square, then the figure. */
function SalesTile({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3" title={hint}>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-50 text-slate-500">{icon}</span>
      <span className="min-w-0">
        <span className="block text-xs leading-tight text-slate-500">{label}</span>
        <span className="block text-lg font-bold tabular-nums leading-tight text-slate-800">{value}</span>
      </span>
    </div>
  )
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/* Hand-rolled: en-ZA renders September as "Sept". */
const longDay = (iso: string): string => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTH_NAMES[m - 1]} ${y}` }

const count = (v: number | undefined): string => (v === undefined ? '—' : v.toLocaleString('en-ZA'))
const money = (v: number | undefined): string => (v === undefined ? '—' : formatCurrency(v))
