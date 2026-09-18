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

export function CollectionsHero({ figures, filters, action }: {
  figures: HeroFigures
  /** The period, as-at and team controls. Rendered into the bar at the foot. */
  filters: ReactNode
  /** Export, or whatever else belongs beside the filters. */
  action?: ReactNode
}) {
  const { currentUser } = useAuth()
  const ahead = (figures.againstPace ?? 0) >= 0

  return (
    /*
      FULL BLEED, AND THE CORNERS ARE SQUARE. This was an inset rounded card floating inside the
      page's own padding, with the lockup repeated across the top of it — the firm's word for it
      was "bulky", and they were right: a panel with a frame, a gap and a second copy of the
      brand reads as a box sitting on the screen rather than as the top of the screen. The
      negative margins cancel <main>'s p-6 so the photograph runs edge to edge under the top bar,
      which is where the picture stops being decoration and starts being the page.
    */
    <div className="collections-hero -mx-6 -mt-6 px-6 pt-7 pb-5 sm:px-10 sm:pt-9 sm:pb-6">
      {/* ---------- the line, and the firm's own words beside it ---------- */}
      <div className="flex items-start justify-between gap-6">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.3em] text-white/55">
            {greetingLine(new Date(), currentUser?.name)}
          </p>
          {/*
            TWO LINES, BROKEN WHERE THE FIRM BREAKS IT. Left to wrap on its own the break lands
            wherever the window happens to be wide, and half the point of the line is the shape
            it makes — a sentence about today over a sentence about tomorrow.
          */}
          <h1 className="mt-2.5 text-3xl sm:text-[46px] font-bold tracking-tight text-white leading-[1.12]">
            Recovery today.<br />A stronger tomorrow.
          </h1>
          <p className="mt-3 text-[11px] font-medium uppercase tracking-[0.3em] text-gold-400">
            Discipline drives results
          </p>
        </div>
        {/*
          The rail of small caps, right-aligned the way the firm drew it. Hidden on a phone
          rather than wrapped: four words stacked down a narrow screen read as a list of
          headings, not as a brand line.
        */}
        <div className="hidden lg:block shrink-0 text-right">
          <p className="text-[11px] font-medium uppercase tracking-[0.3em] text-gold-400 leading-[1.9]">
            Higher<br />Performance<br />Closer<br />Tomorrow
          </p>
          <span className="mt-3 ml-auto block h-px w-16 bg-gold-500/70" />
        </div>
      </div>

      {/* ---------- the four figures ---------- */}
      <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Tile icon={<Coins size={22} />} label={figures.todayLabel}
          value={money(figures.today)}>
          {figures.changeOnPrevious === null ? (
            /* No comparison rather than a fabricated one. The first working day of the series has
               nothing behind it, and "+100%" against nothing is not a fact about the day. */
            <span className="text-white/45">No working day before it to compare</span>
          ) : (
            <span className={`inline-flex items-center gap-1.5 ${
              figures.changeOnPrevious >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}>
              {figures.changeOnPrevious >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
              {signedPct(figures.changeOnPrevious)}
              <span className="text-white/45">vs {figures.previousLabel}</span>
            </span>
          )}
        </Tile>

        <Tile icon={<BarChart3 size={22} />} label="Collected this period"
          value={money(figures.collected)}>
          {figures.target === null ? (
            <span className="text-white/45">No target set for this period</span>
          ) : (
            <>
              <span className="block">
                Target for the period{' '}
                <span className="text-white/85">{money(figures.target)}</span>
              </span>
              <span className="mt-2 flex items-center gap-2.5">
                <HeroBar achieved={figures.achieved} />
                <span className="tabular-nums text-white/85">{pct(figures.achieved)}</span>
              </span>
            </>
          )}
        </Tile>

        <Tile icon={<Target size={22} />}
          label={figures.againstPace === null ? 'Against pace' : ahead ? 'Ahead of pace' : 'Behind pace'}
          value={figures.againstPace === null ? '—' : money(Math.abs(figures.againstPace))}
          tone={figures.againstPace === null ? undefined : ahead ? 'good' : 'bad'}>
          {figures.expectedByNow === null
            ? <span className="text-white/45">Nothing to measure against yet</span>
            : <>Expected by now <span className="text-white/85">{money(figures.expectedByNow)}</span></>}
        </Tile>

        <Tile icon={<CalendarDays size={22} />} label="Needed per working day"
          value={figures.neededADay === null ? '—' : money(figures.neededADay)}>
          {figures.stillNeeded === null
            ? <span className="text-white/45">No target set for this period</span>
            : <>{money(figures.stillNeeded)} remaining</>}
        </Tile>
      </div>

      {/*
        WHAT THE FIGURES ABOVE ARE OF — as controls, not as a caption beside them.

        This carried both at first: a line reading "Collection period: 11 Sep – 10 Oct 2026" and
        then the picker that sets it, one under the other. Two rows saying the same thing, and the
        reader has to work out which of them is the live one. The controls already show their own
        values, so the caption went.

        They are drawn as text rather than as boxed fields, which is how the firm draws them. The
        affordance is not thrown away with the box: each one keeps a focus ring, the selects keep
        their chevron, and hovering lights the whole control.
      */}
      <div className="hero-controls mt-7 flex flex-wrap items-center gap-x-4 gap-y-3">
        {filters}
        {action}
        {/*
          The brand line is the only thing pushed right, and the export button sits with the
          controls rather than opposite them. With the button on the right the row wrapped on a
          laptop and left it stranded on a line of its own — which is the shape the firm called
          bulky in the first place. Wrapped this way the brand line is what drops, right-aligned,
          and nothing looks stranded.
        */}
        <span className="ml-auto hidden lg:flex items-center gap-4">
          <span className="block h-px w-12 bg-gold-500/70" />
          <span className="text-[10px] font-medium uppercase tracking-[0.3em] text-white/45">
            Built for a higher standard
          </span>
        </span>
      </div>
    </div>
  )
}

/**
 * One of the four. Glass rather than a solid card, so the photograph is still a photograph
 * behind it — a row of opaque boxes would make the picture a strip along the top.
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
  const colour = tone === 'good' ? 'text-emerald-400' : tone === 'bad' ? 'text-rose-400' : 'text-white'
  return (
    <div className="flex items-start gap-3.5 rounded-xl border border-white/10 bg-slate-950/45 px-4 py-4 backdrop-blur-sm">
      <span className="mt-0.5 shrink-0 text-gold-400">{icon}</span>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/65">{label}</p>
        <p className={`text-2xl sm:text-[28px] font-bold tabular-nums mt-1 ${colour}`}>{value}</p>
        <div className="text-xs text-white/60 mt-1.5">{children}</div>
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
    <span className="inline-block h-1.5 w-24 rounded-full bg-white/15 overflow-hidden align-middle">
      <span className={`block h-full rounded-full ${over ? 'bg-emerald-400' : 'bg-gold-400'}`}
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
