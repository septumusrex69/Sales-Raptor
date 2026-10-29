/**
 * THE RING WITH THE WHITE CUTS BETWEEN ITS SLICES -- the company dashboard's "The book", moved here whole
 * so a second screen can wear it (S16, Raptor · Handover 15; Stephan, of the portal's open accounts: "the
 * circle you used on the dashboard ... with the little white offcuts ... use this type of pie chart").
 *
 * Not RingDonut: that one draws its own legend under the ring in a single line, which on a half-width
 * panel ran off the card, and the screens using this draw their legend beside it. One stroked circle per
 * slice, each cut 3 units short so the card shows between them; a ring with one slice has no cut.
 */
export interface GapRingSlice { key: string; value: number; color: string }

export function GapRing({ slices, total, label, size = 168, stroke = 24, testId }: {
  slices: GapRingSlice[]
  /** The figure in the middle; usually the sum, and said by the caller so it can be formatted. */
  total: string
  label: string
  size?: number
  stroke?: number
  testId?: string
}) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r
  const sum = slices.reduce((t, x) => t + x.value, 0)
  const live = slices.filter((x) => x.value > 0)
  const gap = live.length > 1 ? 3 : 0
  let at = 0
  return (
    <div className="relative shrink-0" style={{ height: size, width: size }} data-testid={testId}>
      <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full -rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-slate-100)" strokeWidth={stroke} />
        {sum > 0 && live.map((x) => {
          const raw = (x.value / sum) * c
          const len = Math.max(raw - gap, 0.01)
          const el = (
            <circle key={x.key} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={x.color} data-slice={x.key}
              strokeWidth={stroke} strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-at} />
          )
          at += raw
          return el
        })}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold tabular-nums text-slate-800">{total}</span>
        <span className="max-w-[62%] text-center text-xs leading-tight text-slate-500">{label}</span>
      </div>
    </div>
  )
}
