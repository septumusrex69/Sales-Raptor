import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Loader2 } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { StatTile } from '../components/ui/StatTile'
import { CollectionsHero } from '../components/collections/CollectionsHero'
import { MyDetailsMissing } from '../components/dashboard/MyDetailsMissing'
import { MonthControls } from '../components/collections/MonthControls'
import { MonthProgress } from '../components/collections/MonthProgress'
import { useAppStore } from '../store/AppStore'
import { useAuth } from '../store/AuthContext'
import { useCollectionsMonth } from '../hooks/useCollectionsMonth'
import { salesSnapshot, type BookSnapshot } from '../lib/companySnapshot'
import { fetchBookSnapshot } from '../lib/companySnapshotData'
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

  useEffect(() => {
    let cancelled = false
    setBook(null); setBookError(null)
    fetchBookSnapshot(month.period)
      .then((snapshot) => { if (!cancelled) setBook(snapshot) })
      .catch((e) => { if (!cancelled) setBookError(e instanceof Error ? e.message : String(e)) })
    return () => { cancelled = true }
  }, [month.period])

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
        progress={<MonthProgress pace={month.pace} line={month.line} tone="dark"
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

      {/* ---------- what came in ---------- */}
      <Section title="Work coming in" why={`Handed to us in ${month.period.label}`}>
        {/*
          SAID IN WORDS, ONCE, because a six-figure number on a dashboard is read as the firm's
          money unless something says otherwise. It is the client's book to recover.
        */}
        <p className="mb-3 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
          Capital at handover — <span className="font-medium text-slate-600">the client's money to
          recover</span>, not the firm's.
        </p>
        <Figures loading={book === null} error={bookError}>
          <StatTile size="secondary" label="Accounts handed over"
            value={count(book?.intakeAccounts)}
            hint="Accounts whose handover date falls inside this period." />
          <StatTile size="secondary" label="Capital handed over"
            value={money(book?.intakeCapital)} />
          <StatTile size="secondary" label="Clients who sent work"
            value={count(book?.intakeClients)} />
          <StatTile size="secondary" label="Not yet allocated"
            value={count(book?.unallocatedActive)}
            hint="Live accounts on nobody's desk. Not only this period's — the whole book." />
        </Figures>
      </Section>

      {/* ---------- what we are holding ---------- */}
      <Section title="The book" why="What the firm is holding right now">
        <Figures loading={book === null} error={bookError}>
          <StatTile size="secondary" label="Accounts" value={count(book?.bookAccounts)}
            hint="Every account on the book, including written-off and frozen ones." />
          <StatTile size="secondary" label="Being worked" value={count(book?.activeAccounts)} />
          <StatTile size="secondary" label="Owed on those accounts"
            value={money(book?.activeCapital)}
            hint="Capital outstanding across the accounts being worked." />
          <StatTile size="secondary" label="Clients with live accounts"
            value={count(book?.activeClients)} />
          <StatTile size="secondary" label="Gone quiet" value={count(book?.quietAccounts)}
            hint="Worked at some point, and not in the last 30 days. Accounts with no action recorded in Raptor at all are counted separately — see below." />
        </Figures>
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
      </Section>

      {/* ---------- where the next book comes from ---------- */}
      <Section title="Where the next work comes from" why={`Sales in ${month.period.label}`}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatTile size="secondary" label="Open leads" value={count(sales.openLeads)}
            hint={`${sales.leadsAdded.toLocaleString('en-ZA')} added this period.`} />
          <StatTile size="secondary" label="Mandates signed" value={count(sales.mandatesSigned)}
            hint={sales.mandateBook > 0
              ? `${formatCurrency(sales.mandateBook)} of book signed this period.`
              : 'Handover deals won this period. A signed book earns nothing at signature.'} />
          <StatTile size="secondary" label="Deals open" value={count(sales.dealsOpen)}
            hint={`${formatCurrency(sales.dealsOpenValue)} in play.`} />
          <StatTile size="secondary" label="Deal value won" value={money(sales.dealsWonValue)}
            hint="Service deals won this period. Mandates are counted beside them, not in here." />
        </div>
      </Section>

      {/* ---------- the departments ---------- */}
      <Section title="The departments" why="Everybody sees everybody's headline. Yours opens in full.">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
function Figures({ loading, error, children }: {
  loading: boolean
  error: string | null
  children: React.ReactNode
}) {
  if (error) {
    return (
      <Card className="border-rose-200">
        <p className="text-sm text-rose-700">These figures could not be counted: {error}</p>
      </Card>
    )
  }
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
  return (
    <Card className={ours ? 'border-gold-300 bg-amber-50/40' : undefined}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-800">{label}</h3>
        <span className="text-xs tabular-nums text-slate-400">
          {people === 1 ? '1 person' : `${people} people`}
        </span>
      </div>
      <p className="mt-1 min-h-[2.5rem] text-xs text-slate-500">{blurb}</p>
      <Link to={dashboardPathFor(id)}
        className={`mt-3 block rounded-lg border px-3 py-2 text-center text-xs font-semibold ${
          ours
            ? 'border-navy-900 bg-navy-900 text-white hover:bg-navy-800'
            : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
        }`}>
        {ours ? 'This is your department →' : 'Open →'}
      </Link>
    </Card>
  )
}

const count = (v: number | undefined): string => (v === undefined ? '—' : v.toLocaleString('en-ZA'))
const money = (v: number | undefined): string => (v === undefined ? '—' : formatCurrency(v))
