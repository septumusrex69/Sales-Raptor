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
  centerColor = '#1e293b',
  caption,
}: {
  data: RingDonutSlice[]
  centerValue: string
  centerLabel: string
  centerColor?: string
  caption?: string
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
    <div className="flex flex-col items-center gap-2.5">
      <div className="h-40 w-40 relative">
        <svg viewBox={`0 0 ${DONUT_SIZE} ${DONUT_SIZE}`} className="h-full w-full -rotate-90">
          <circle cx={DONUT_SIZE / 2} cy={DONUT_SIZE / 2} r={DONUT_R} fill="none" stroke="#eef1f6" strokeWidth={DONUT_STROKE} />
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
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none px-2">
          <span className="text-[26px] font-extrabold leading-none" style={{ color: centerColor }}>{centerValue}</span>
          <span className="text-[9px] font-semibold text-slate-400 mt-1 tracking-wide text-center leading-tight max-w-[86px]">{centerLabel}</span>
        </div>
      </div>
      {caption && <span className="text-[11px] text-slate-400 text-center -mt-1">{caption}</span>}
      <div className="flex items-center gap-3 text-[11px] flex-wrap justify-center">
        {data.map((d) => (
          <span key={d.name} className={`flex items-center gap-1 ${d.muted ? 'text-slate-400' : 'text-slate-600'}`}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: d.color }} />
            {d.name} <b className={d.muted ? 'font-semibold' : 'font-bold'}>{d.value}</b>
          </span>
        ))}
      </div>
    </div>
  )
}
