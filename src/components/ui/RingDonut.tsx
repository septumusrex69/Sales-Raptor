export interface RingDonutSlice {
  name: string
  value: number
  color: string
  /** Muted slices (excluded from that donut's own rate) get de-emphasized legend text too. */
  muted?: boolean
}

/** SVG geometry for the rounded-stroke ring — a plain stroked circle per slice (round caps, small gaps), not a filled pie wedge. */
const DONUT_SIZE = 160
const DONUT_STROKE = 22
const DONUT_R = (DONUT_SIZE - DONUT_STROKE) / 2
const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_R

/** Shared rounded-stroke ring donut, used by the Win Rate and Communications dashboard cards so every ring chart in the app reads the same way. */
export function RingDonut({
  data,
  centerValue,
  centerLabel,
  centerColor = 'var(--c-ink)',
  caption,
  legend = true,
  size = 'md',
}: {
  /*
   * 'sm' (S19): the small ring that sits at the side of a card of figures -- Stephan, 8 Nov, of the collector's
   * promises, traces and day: "keep it there, but just on the side of it ... make like a small little pie chart". The
   * figures stay the reading; the ring is the glance. Its legend stacks, with the numbers, under it.
   */
  size?: 'md' | 'sm'
  data: RingDonutSlice[]
  centerValue: string
  centerLabel: string
  centerColor?: string
  caption?: string
  /** Off where the card lists the slices itself, beside the ring (the client page's rings). */
  legend?: boolean
}) {
  const total = data.reduce((s, d) => s + d.value, 0)
  const gap = data.length > 1 ? 3 : 0
  let cumulative = 0
  const arcs = data.map((d) => {
    const raw = total > 0 ? (d.value / total) * DONUT_CIRCUMFERENCE : 0
    const length = Math.max(raw - gap, 0)
    const offset = -cumulative
    cumulative += raw
    return { color: d.color, length, offset, key: d.name }
  })

  return (
    <div className="flex flex-col items-center gap-2.5" data-testid={size === 'sm' ? 'mini-ring' : undefined}>
      <div className={`${size === 'sm' ? 'h-24 w-24' : 'h-40 w-40'} relative`}>
        <svg viewBox={`0 0 ${DONUT_SIZE} ${DONUT_SIZE}`} className="h-full w-full -rotate-90">
          <circle cx={DONUT_SIZE / 2} cy={DONUT_SIZE / 2} r={DONUT_R} fill="none" stroke="var(--tint-steel-alt)" strokeWidth={DONUT_STROKE} />
          {arcs.map((a) => (
            <circle
              key={a.key}
              cx={DONUT_SIZE / 2}
              cy={DONUT_SIZE / 2}
              r={DONUT_R}
              fill="none"
              stroke={a.color}
              strokeWidth={DONUT_STROKE}
              strokeLinecap="round"
              strokeDasharray={`${a.length} ${DONUT_CIRCUMFERENCE - a.length}`}
              strokeDashoffset={a.offset}
            >
              {/* Hover says what the slice is and how many: identity never rests on colour alone. */}
              <title>{`${a.key}: ${data.find((d) => d.name === a.key)?.value ?? 0}`}</title>
            </circle>
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none px-2">
          <span className={`${size === 'sm' ? 'text-[17px]' : 'text-[26px]'} font-extrabold leading-none`} style={{ color: centerColor }}>{centerValue}</span>
          <span className={`${size === 'sm' ? 'text-[8.5px] max-w-[64px]' : 'text-[9px] max-w-[86px]'} font-semibold text-slate-400 mt-1 tracking-wide text-center leading-tight`}>{centerLabel}</span>
        </div>
      </div>
      {caption && <span className="text-[11px] text-slate-400 text-center -mt-1">{caption}</span>}
      {legend && <div className={size === 'sm'
        ? 'flex flex-col gap-0.5 text-[11px] min-w-[7.5rem]'
        : 'flex items-center gap-3 text-[11px] flex-wrap justify-center'}>
        {data.map((d) => (
          <span key={d.name} className={`flex items-center gap-1 ${d.muted ? 'text-slate-400' : 'text-slate-600'}`}>
            <span className={`${size === 'sm' ? 'w-2 h-2' : 'w-1.5 h-1.5'} rounded-full shrink-0`} style={{ backgroundColor: d.color }} />
            {d.name} <b className={`${d.muted ? 'font-semibold' : 'font-bold'} ${size === 'sm' ? 'ml-auto tabular-nums' : ''}`}>{d.value}</b>
          </span>
        ))}
      </div>}
    </div>
  )
}
