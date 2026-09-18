import type { ReactNode } from 'react'
import { BarChart3, CalendarDays, Coins, Target, TrendingDown, TrendingUp } from 'lucide-react'
import { useTheme } from '../../store/ThemeContext'
import { targetLaps } from '../../lib/collectionPace.ts'
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
  const { theme } = useTheme()
  const ahead = (figures.againstPace ?? 0) >= 0

  return (
    <div className="collections-hero px-5 py-5 sm:px-7 sm:py-7">
      {/* ---------- brand line ---------- */}
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
        <img src={theme.lockupLight} alt="Raptor by Bredell Ferreira" className="h-10 sm:h-12 w-auto" />
        <p className="hidden sm:block text-[10px] font-medium uppercase tracking-[0.34em] text-white/55">
          People <span className="text-white/25">|</span> Process <span className="text-white/25">|</span> Performance
        </p>
      </div>

      {/* ---------- title, and the firm's own line ---------- */}
      <div className="mt-5 flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-gold-400">Collections</p>
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-white mt-1.5">Collections</h1>
          <p className="text-sm sm:text-base text-white/60 mt-1.5">
            Performance today. A stronger tomorrow.
          </p>
          <span className="mt-4 block h-px w-16 bg-gold-500/70" />
        </div>
        {/*
          The rail of small caps, right-aligned the way the firm drew it. Hidden on a phone
          rather than wrapped: four words stacked down a narrow screen read as a list of
          headings, not as a brand line.
        */}
        <div className="hidden lg:block text-right">
          <p className="text-[11px] font-medium uppercase tracking-[0.3em] text-white/70 leading-7">
            Higher<br />Recovery<br />Brighter<br />Tomorrows
          </p>
          <span className="mt-3 ml-auto block h-px w-14 bg-gold-500/70" />
        </div>
      </div>

      {/* ---------- the four figures ---------- */}
      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <Tile icon={<Coins size={18} />} label={figures.todayLabel}
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

        <Tile icon={<BarChart3 size={18} />} label="Collected this period"
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

        <Tile icon={<Target size={18} />}
          label={figures.againstPace === null ? 'Against pace' : ahead ? 'Ahead of pace' : 'Behind pace'}
          value={figures.againstPace === null ? '—' : money(Math.abs(figures.againstPace))}
          tone={figures.againstPace === null ? undefined : ahead ? 'good' : 'bad'}>
          {figures.expectedByNow === null
            ? <span className="text-white/45">Nothing to measure against yet</span>
            : <>Expected by now <span className="text-white/85">{money(figures.expectedByNow)}</span></>}
        </Tile>

        <Tile icon={<CalendarDays size={18} />} label="Needed per working day"
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
      */}
      <div className="mt-6 pt-4 border-t border-white/10 flex flex-wrap items-center gap-x-5 gap-y-3">
        <span className="hidden sm:inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-white/45">
          <CalendarDays size={14} /> Period
        </span>
        {filters}
        <div className="ml-auto flex items-center gap-4">
          {action}
          <p className="hidden lg:block text-[10px] font-medium uppercase tracking-[0.3em] text-white/45">
            Discipline creates results
          </p>
        </div>
      </div>
    </div>
  )
}

/**
 * One of the four. Glass rather than a solid card, so the photograph is still a photograph
 * behind it — a row of opaque boxes would make the picture a strip along the top.
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
    <div className="rounded-xl border border-white/10 bg-white/[0.045] px-4 py-3.5 backdrop-blur-sm">
      <p className="flex items-center gap-2.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/65">
        <span className="text-gold-400">{icon}</span>
        {label}
      </p>
      <p className={`text-2xl sm:text-[28px] font-bold tabular-nums mt-1.5 ${colour}`}>{value}</p>
      <div className="text-xs text-white/60 mt-1.5">{children}</div>
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
