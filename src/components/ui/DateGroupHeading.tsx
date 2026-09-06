/**
 * The thin band that separates one day's worth of rows from the next.
 *
 * Kept as one class string rather than three copies: the emails, leads and deals lists all
 * use it, and a heading that sat a pixel different on each would read as three unrelated
 * ideas instead of one convention. Deliberately quiet — it's a signpost between rows, not a
 * heading competing with them, so it earns its separation from the rules above and below
 * rather than from size or weight.
 */
export const DATE_GROUP_CLASS =
  'text-[9.5px] font-semibold uppercase tracking-[0.12em] text-slate-400 bg-slate-50/80 border-y border-slate-100 px-4 py-1'

export function DateGroupHeading({ label }: { label: string }) {
  return <p className={DATE_GROUP_CLASS}>{label}</p>
}
