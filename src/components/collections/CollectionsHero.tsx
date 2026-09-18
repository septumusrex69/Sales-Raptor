import type { ReactNode } from 'react'
import { BarChart3, CalendarDays, Coins, Target, TrendingDown, TrendingUp } from 'lucide-react'
import { useAuth } from '../../store/AuthContext'
import { targetLaps } from '../../lib/collectionPace.ts'
import { greetingLine } from '../../lib/greeting.ts'
import { formatCurrency } from '../../data/mockData'

/**
 * The Collections hero, to the firm's own design.
 *
 * WHY THIS ONE IS NOT DashboardHero. The shared hero is a band with a title and a controls row,
 * and eight screens use it. This carries the four figures the floor is run on, the filters that
 * decide what those figures mean, and the firm's own brand lines — a different thing wearing the
 * same colours. Forcing it into the shared component would put four screens' worth of props on
 * something CompanyDetail also renders.
 *
 * EVERYTHING ON IT IS REAL. The mockup the firm sent carried round numbers; every figure here
 * comes from the same query the tables below it are drawn from, so the hero and the list can
 * never disagree. A hero that shows a number nothing else on the page produces is decoration,
 * and people stop reading decoration.
 *
 * IT DOES NOT NAME ITSELF, and that is deliberate. It carried the word "Collections" twice at
 * one point — as a gold eyebrow and again as the heading under it — and stripping one of them
 * out still left a panel introducing a screen the sidebar has already highlighted and the top
 * bar already titles. The space goes to the firm's line instead.
 */
export interface HeroFigures {
  /** What came in on the day being read, and what to call that day. */
  today: number
  todayLabel: string
  /** The previous WORKING day, so a Monday is not compared with a Sunday. Null where unknown. */
  changeOnPrevious: number | null
  previousLabel: string | null
  collected: number
  target: number | null
  /** Of target, 0–1. Null where nobody has set one. */
  achieved: number | null
  /** Rand ahead of, or behind, the pace the day implies. Negative is behind. */
  againstPace: number | null
  expectedByNow: number | null
  neededADay: number | null
  stillNeeded: number | null
}

export function CollectionsHero({ figures, filters, action, progress }: {
  figures: HeroFigures
  /** The period, as-at and team controls. Rendered into the bar at the foot. */
  filters: ReactNode
  /** Export, or whatever else belongs beside the filters. */
  action?: ReactNode
  /**
   * The month bar, RENDERED BY THE PAGE and passed in.
   *
   * It used to be a card of its own underneath, and the firm asked for it inside the panel rather
   * than as "another bulky white card immediately underneath". Passed as a node instead of as
   * numbers so that the arithmetic stays in the one place that already does it — a second copy of
   * "how far through the month are we" on this screen is a second answer to that question.
   */
  progress?: ReactNode
}) {
  const { currentUser } = useAuth()
  const ahead = (figures.againstPace ?? 0) >= 0

  return (
    /*
      A CARD, LIKE EVERY OTHER HERO ON THE APP, and tall enough to be a photograph.

      It ran full bleed with square corners for a version and the firm sent it back: one square
      panel running into the sidebar beside eight rounded ones reads as the screen somebody forgot
      to finish. The HEIGHT is the new part — the brief asks for "significantly more open mountain
      scenery between the headline and the KPI section", which is a minimum height and a spacer
      rather than padding, so the figures sit in the lower third whatever the window is doing.
    */
    <div className="collections-hero">
      {/* The brief caps the content at 1250-1350px. Wider than that and the rail of small caps
          ends up a screen away from the headline it belongs to. */}
      <div className="mx-auto flex w-full max-w-[1320px] flex-col px-5 py-7 sm:px-9 sm:py-9
        min-h-[540px] lg:min-h-[700px]">

        {/* ---------- the line, and the firm's own words beside it ---------- */}
        <div className="flex items-start justify-between gap-8">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.34em] text-white/60">
              {greetingLine(new Date(), currentUser?.name)}
            </p>
            <span className="mt-3 block h-px w-14 bg-[var(--ch-gold)]" />
            {/*
              TWO TONES, TWO LINES, AND ORDINARY SENTENCE CASE.

              The firm's reference sets the first half white and the second in champagne, across
              two lines. That only works as a deliberate break: left to wrap, the break lands
              wherever the window is wide and the colour change falls mid-phrase.

              THE CASE HAS BEEN ROUND THE HOUSES AND LANDED BACK HERE. The whole line was set in
              capitals once, then SKY and BEGINNING alone were lifted into them, and the firm
              settled on neither — "change it all back to small letters, it'll look better". They
              are right, and the reason is the weight: at font-light there are no ascenders or
              descenders in a capital to give the line any shape, so caps at this weight flatten
              it however they are arranged. The two tones and the break carry it instead.
            */}
            <h1 className="mt-4 text-[32px] sm:text-[44px] lg:text-[52px] font-light
              leading-[1.06] text-white">
              {/* Each LINE is its own span, which is not decoration: it makes the two halves
                  addressable as two things, by a stylesheet and by anything reading the page. */}
              <span>The sky is only</span><br />
              <span className="text-[var(--ch-champagne)]">the beginning.</span>
            </h1>
            <p className="mt-5 text-[11px] font-medium uppercase tracking-[0.34em] text-[var(--ch-gold)]">
              Discipline drives results
            </p>
          </div>
          {/*
            The rail of small caps, right-aligned the way the firm drew it. Hidden on a phone
            rather than wrapped: four words stacked down a narrow screen read as a list of
            headings, not as a brand line.
          */}
          <div className="hidden lg:block shrink-0 text-right">
            <p className="text-[11px] font-medium uppercase tracking-[0.34em] text-[var(--ch-champagne)] leading-[2]">
              Higher<br />Performance<br />Closer<br />Tomorrow
            </p>
            <span className="mt-3 ml-auto block h-px w-14 bg-[var(--ch-gold)]/70" />
          </div>
        </div>

        {/*
          THE OPEN SKY. A flexible spacer rather than a fixed margin, so the figures stay in the
          lower third of the panel at every height instead of drifting up on a short window and
          leaving the photograph as a band along the top.
        */}
        <div className="min-h-[72px] flex-1" />

        {/* ---------- the four figures ---------- */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 items-stretch">
          <Tile icon={<Coins size={17} />} label={figures.todayLabel}
            value={money(figures.today)}>
            {figures.changeOnPrevious === null ? (
              /* No comparison rather than a fabricated one. The first working day of the series has
                 nothing behind it, and "+100%" against nothing is not a fact about the day. */
              <span className="text-white/45">No working day before it to compare</span>
            ) : (
              <span className={`inline-flex items-center gap-1.5 ${
                figures.changeOnPrevious >= 0 ? 'text-[#3ecf8e]' : 'text-[#e45d68]'
              }`}>
                {figures.changeOnPrevious >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                {signedPct(figures.changeOnPrevious)}
                <span className="text-white/45">vs {figures.previousLabel}</span>
              </span>
            )}
          </Tile>

          <Tile icon={<BarChart3 size={17} />} label="Collected this period"
            value={money(figures.collected)}>
            {figures.target === null ? (
              <span className="text-white/45">No target set for this period</span>
            ) : (
              <>
                <span className="flex items-center gap-2.5">
                  <HeroBar achieved={figures.achieved} />
                  <span className="tabular-nums text-white/85">{pct(figures.achieved)}</span>
                </span>
                <span className="mt-1.5 block">
                  Target <span className="text-white/85">{money(figures.target)}</span>
                </span>
              </>
            )}
          </Tile>

          <Tile icon={<Target size={17} />}
            label={figures.againstPace === null ? 'Against pace' : ahead ? 'Ahead of pace' : 'Behind pace'}
            value={figures.againstPace === null ? '—' : money(Math.abs(figures.againstPace))}
            tone={figures.againstPace === null ? undefined : ahead ? 'good' : 'bad'}>
            {figures.expectedByNow === null
              ? <span className="text-white/45">Nothing to measure against yet</span>
              : <>Expected by now <span className="text-white/85">{money(figures.expectedByNow)}</span></>}
          </Tile>

          <Tile icon={<CalendarDays size={17} />} label="Needed per working day"
            value={figures.neededADay === null ? '—' : money(figures.neededADay)}>
            {figures.stillNeeded === null
              ? <span className="text-white/45">No target set for this period</span>
              : <>{money(figures.stillNeeded)} remaining</>}
          </Tile>
        </div>

        {/*
          ONE STRIP, TWO ROWS. The controls that say what the figures above are OF, and the month
          they are being read against. They were two separate cards and the firm asked for one
          panel — which is also the honest arrangement: the period picker and the month bar are
          the same fact asked twice, once as a control and once as a result.

          The controls are drawn as text rather than as boxed fields, which is how the firm draws
          them. The affordance is not thrown away with the box: each keeps a focus ring, the
          selects keep their chevron, and hovering lights the whole control.
        */}
        <div className="hero-glass mt-4">
          <div className="hero-controls flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-1.5">
            {filters}
            {action && <div className="ml-auto">{action}</div>}
          </div>
          {progress && <div className="border-t border-white/10">{progress}</div>}
        </div>
      </div>
    </div>
  )
}

/**
 * One of the four. Glass rather than a solid card, so the photograph is still a photograph
 * behind it — a row of opaque boxes would make the picture a strip along the top.
 *
 * COMPACT, AND ALL FOUR THE SAME HEIGHT. h-full inside an items-stretch grid, because the four
 * carry different amounts underneath — one has a progress bar, one has a single line — and four
 * panels of four heights across a photograph is the thing that reads as unfinished. The label
 * reserves two lines for the same reason it does anywhere: so the figures sit on one line.
 *
 * The icon is its own column rather than sitting inline with the label, because the label is a
 * sentence of small caps and an icon in the middle of one is read as a word.
 */
function Tile({ icon, label, value, tone, children }: {
  icon: ReactNode
  label: string
  value: string
  tone?: 'good' | 'bad'
  children: ReactNode
}) {
  const colour = tone === 'good' ? 'text-[#3ecf8e]' : tone === 'bad' ? 'text-[#e45d68]' : 'text-white'
  return (
    <div className="hero-glass flex h-full items-start gap-3 px-3.5 py-2.5">
      <span className="mt-0.5 shrink-0 text-[var(--ch-gold)]">{icon}</span>
      <div className="min-w-0">
        <p className="min-h-[2.2em] leading-[1.1] text-[10px] font-semibold uppercase tracking-[0.14em] text-white/65">
          {label}
        </p>
        <p className={`text-[19px] sm:text-[21px] font-medium tabular-nums leading-none mt-0.5 ${colour}`}>{value}</p>
        <div className="text-[11px] text-white/60 mt-1.5">{children}</div>
      </div>
    </div>
  )
}

/**
 * The bar on the second tile. Laps past target in green, exactly as it does in the tables below,
 * because the same figure drawn two different ways on one screen is two figures as far as a
 * reader is concerned.
 */
function HeroBar({ achieved }: { achieved: number | null }) {
  const { fill, over } = targetLaps(achieved)
  return (
    <span className="inline-block h-1 w-20 rounded-full bg-white/12 overflow-hidden align-middle">
      <span className={`block h-full rounded-full ${over ? 'bg-[#3ecf8e]' : 'bg-[var(--ch-champagne)]'}`}
        style={{ width: `${Math.round(fill * 100)}%` }} />
    </span>
  )
}

/*
 * THE SAME FORMATTER AS EVERYTHING ELSE ON THE PAGE.
 *
 * This had a hand-written one that grouped thousands with a hard space, matching the mockup the
 * firm drew — and the tables directly underneath use formatCurrency, which groups with a comma.
 * One screen showing "R 127 500" in the hero and "R 127,500" in the row below it reads as two
 * different figures for a moment every single time, which is a worse cost than not matching a
 * rendering. If the firm wants the South African space everywhere, that is one change in
 * formatCurrency and it moves the whole app at once.
 */
const money = formatCurrency

const pct = (v: number | null): string => (v === null ? '—' : `${Math.round(v * 100)}%`)
const signedPct = (v: number): string => `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v * 100))}%`
