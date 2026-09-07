import { Card, CardHeader } from '../ui/Card'
import { formatCurrency } from '../../data/mockData'
import { TARGET_METRIC_BY_ID, type TargetProgress } from '../../lib/targets'

const STANDING_COLOR: Record<TargetProgress['standing'], string> = {
  met: 'var(--c-green)',
  'on-track': 'var(--c-gold)',
  'below-floor': 'var(--c-rust-deep)',
  none: 'var(--c-grey-pale)',
}

function fmt(value: number, unit: 'count' | 'currency') {
  return unit === 'currency' ? formatCurrency(value) : Math.round(value).toLocaleString('en-ZA')
}

/**
 * Progress against target, with the month's own pace drawn on it.
 *
 * The pace marker is the part that makes this worth having. A bar on its own says a number is
 * short of a figure, which on the third of the month is meaningless — everything is short of
 * the month's target on the third. The tick shows how far through the month we are, so being
 * behind reads as behind *for today* rather than behind in the abstract, and a team that is
 * ahead of pace can see it while there is still time for it to mean something.
 *
 * The floor, where one is set, is drawn as a second mark. Below it the bar turns red: the
 * business treats a minimum and a goal as different promises, and one bar colour cannot say
 * both.
 */
function TargetBar({ progress, elapsed }: { progress: TargetProgress; elapsed: number }) {
  const def = TARGET_METRIC_BY_ID[progress.metric]
  const color = STANDING_COLOR[progress.standing]
  const floorPct = progress.threshold !== undefined ? Math.min((progress.threshold / progress.target) * 100, 100) : undefined
  const pacePct = Math.min(elapsed * 100, 100)
  const aheadOfPace = progress.ratio >= elapsed

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-slate-500">{def.label}</span>
        <span className="text-xs text-slate-400 tabular-nums">
          <span className="font-bold text-slate-700">{fmt(progress.actual, def.unit)}</span>
          {' / '}
          {fmt(progress.target, def.unit)}
        </span>
      </div>

      <div className="relative h-2.5 mt-1.5 rounded-full bg-slate-100 overflow-hidden">
        <div className="h-full rounded-full transition-[width]" style={{ width: `${progress.pct}%`, backgroundColor: color }} />
        {floorPct !== undefined && floorPct < 100 && (
          <span
            className="absolute top-0 bottom-0 w-px bg-slate-400/70"
            style={{ left: `${floorPct}%` }}
            title={`Minimum: ${fmt(progress.threshold!, def.unit)}`}
          />
        )}
      </div>

      {/* The pace tick sits under the bar rather than on it, so it reads as a date rather than
          as another quantity competing with the fill. */}
      <div className="relative h-3 mt-0.5">
        <span className="absolute top-0 -translate-x-1/2 text-[9px] leading-none text-slate-400 select-none" style={{ left: `${pacePct}%` }} title="How far through the sales month we are">
          ▲
        </span>
      </div>

      <p className="text-[11px] text-slate-400 -mt-0.5">
        {progress.standing === 'met' ? (
          <span className="font-medium text-[var(--c-green)]">Target met</span>
        ) : progress.standing === 'below-floor' ? (
          <span className="font-medium text-[var(--c-rust-deep)]">Below the {fmt(progress.threshold!, def.unit)} minimum</span>
        ) : aheadOfPace ? (
          <span className="font-medium text-[var(--c-green)]">Ahead of pace</span>
        ) : (
          <>Behind pace &mdash; {fmt(Math.max(progress.target - progress.actual, 0), def.unit)} to go</>
        )}
      </p>
    </div>
  )
}

export function TargetsCard({
  title,
  subtitle,
  items,
  elapsed,
}: {
  title: string
  subtitle: string
  items: TargetProgress[]
  elapsed: number
}) {
  if (items.length === 0) return null
  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} />
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-x-6 gap-y-4">
        {items.map((p) => (
          <TargetBar key={p.metric} progress={p} elapsed={elapsed} />
        ))}
      </div>
    </Card>
  )
}
