import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { Activity, ArrowRight, Banknote, BarChart3, Coins, FileSignature, FileText, Handshake, Headset, Loader2, Users } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Card } from '../components/ui/Card'
import { CollectionsHero } from '../components/collections/CollectionsHero'
import { MyDetailsMissing } from '../components/dashboard/MyDetailsMissing'
import { MonthControls } from '../components/collections/MonthControls'
import { MonthProgress } from '../components/collections/MonthProgress'
import { useAppStore } from '../store/AppStore'
import { useAuth } from '../store/AuthContext'
import { useCollectionsMonth } from '../hooks/useCollectionsMonth'
import { bookSlices, intakeBars, salesSnapshot, type BookSlice, type BookSnapshot, type IntakeBar } from '../lib/companySnapshot'
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
  const [intake, setIntake] = useState<{ day: string; accounts: number }[] | null>(null)
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
    fetchIntakeByDay(month.period)
      .then((rows) => { if (!cancelled) setIntake(rows) })
      .catch((e) => { if (!cancelled) setBarsError(e instanceof Error ? e.message : String(e)) })
    return () => { cancelled = true }
  }, [month.period])

  /* Every day of the period, the as-at day deciding which are still to come. */
  const bars = useMemo(() => intake === null ? null
    : intakeBars(isoDay(month.period.start), isoDay(month.period.end), intake, isoDay(month.asAt)),
  [intake, month.period, month.asAt])

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
          to="/accounts" testId="work-coming-in">
          {/*
            SAID IN WORDS, ONCE, because a six-figure number on a dashboard is read as the firm's
            money unless something says otherwise. It is the client's book to recover.
          */}
          <p className="mb-2 text-xs text-slate-500" data-testid="intake-line">
            {book === null ? '\u00a0' : <>
              <span className="font-semibold text-slate-700">{count(book.intakeAccounts)} accounts</span>
              {' from '}{count(book.intakeClients)} {book.intakeClients === 1 ? 'client' : 'clients'}
              {' · '}{money(book.intakeCapital)} capital at handover — the client's money to recover, not the firm's.
            </>}
          </p>
          <Figures loading={bars === null && barsError === null} error={barsError} plain>
            <IntakeChart bars={bars ?? []} />
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
        <Panel className="lg:col-span-2" title="The book" why="What the firm is holding right now" to="/accounts" testId="the-book">
          <Figures loading={book === null} error={bookError} plain>
            {book && <BookRing book={book} />}
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
              people={headcount.get(d.id) ?? 0} ours={d.id === mine} />
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
function DepartmentCard({ id, label, blurb, people, ours }: {
  id: Department
  label: string
  blurb: string
  people: number
  ours: boolean
}) {
  const Icon = DEPARTMENT_ICON[id]
  return (
    <Link to={dashboardPathFor(id)} title={blurb} data-testid={`department-${id}`}
      className={clsx('group flex items-center gap-3 rounded-2xl border bg-white px-4 py-3 transition-colors',
        ours ? 'border-gold-300 bg-gold-50/60' : 'border-slate-200 hover:border-slate-300')}>
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gold-50 text-gold-700">
        <Icon size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold text-slate-800">{label}</span>
        <span className="block text-xs tabular-nums text-slate-400">
          {people === 1 ? '1 person' : `${people} people`}{ours ? ' · yours' : ''}
        </span>
      </span>
      <span className={clsx('grid h-8 w-8 place-items-center rounded-full',
        ours ? 'bg-navy-900 text-white' : 'bg-slate-50 text-slate-600 group-hover:bg-slate-100')}>
        <ArrowRight size={15} />
      </span>
    </Link>
  )
}

const DEPARTMENT_ICON: Record<Department, typeof Users> = {
  'Administration': Users,
  'Sales': BarChart3,
  'Communications': Activity,
  'Call centre': Headset,
  'Other': Users,
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
 * a day still to come drawn as an empty slot rather than a nought bar. The tooltip says the day and
 * the count; nothing here is money.
 */
function IntakeChart({ bars }: { bars: IntakeBar[] }) {
  const max = Math.max(0, ...bars.map((b) => b.accounts))
  return (
    <div className="h-48" data-testid="intake-chart">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={bars} margin={{ top: 4, right: 0, bottom: 0, left: -24 }} barCategoryGap="18%">
          <CartesianGrid vertical={false} stroke="var(--color-slate-100)" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} interval={0}
            tick={{ fontSize: 10, fill: 'var(--color-slate-400)' }} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40}
            domain={[0, max > 0 ? 'auto' : 4]} tick={{ fontSize: 10, fill: 'var(--color-slate-400)' }} />
          <Tooltip cursor={{ fill: 'var(--color-slate-50)' }}
            formatter={(v) => [`${Number(v).toLocaleString('en-ZA')} ${Number(v) === 1 ? 'account' : 'accounts'}`, 'Handed over']}
            labelFormatter={(_, p) => { const b = p?.[0]?.payload as IntakeBar | undefined; return b ? longDay(b.day) : '' }} />
          <Bar dataKey="accounts" radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {bars.map((b) => (
              <Cell key={b.day} fill={b.future ? 'transparent' : b.weekend ? 'var(--color-slate-300)' : 'var(--color-gold-400)'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

const RING_COLOUR: Record<BookSlice['key'], string> = {
  worked: 'var(--color-navy-900)',
  unallocated: 'var(--color-gold-400)',
  not_worked: 'var(--color-slate-300)',
}

/** The book as a ring that adds up (bookSlices), with the two figures that are not slices under it. */
function BookRing({ book }: { book: BookSnapshot }) {
  const slices = bookSlices(book)
  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center" data-testid="book-ring">
      <Ring slices={slices} total={book.bookAccounts} />
      <ul className="w-full space-y-2 text-sm">
        {slices.map((s) => (
          <li key={s.key} className="flex items-center gap-2"
            title={s.key === 'not_worked' ? 'On the book and not live: closed, on hold, written off or frozen.' : undefined}>
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: RING_COLOUR[s.key] }} />
            <span className="flex-1 text-slate-600">{s.label}</span>
            <span className="font-semibold tabular-nums text-slate-800">{count(s.value)}</span>
          </li>
        ))}
        <li className="border-t border-slate-100 pt-2 flex items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0" />
          <span className="flex-1 text-slate-600">Clients with live accounts</span>
          <span className="font-semibold tabular-nums text-slate-800">{count(book.activeClients)}</span>
        </li>
        <li className="flex items-center gap-2" title="Worked at some point, and not in the last 30 days. Accounts with no action recorded in Raptor at all are counted separately.">
          <span className="h-2.5 w-2.5 shrink-0" />
          <span className="flex-1 text-slate-600">Gone quiet</span>
          <span className={clsx('font-semibold tabular-nums', book.quietAccounts > 0 ? 'text-rose-600' : 'text-slate-800')}>{count(book.quietAccounts)}</span>
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
