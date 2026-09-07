/**
 * Percentage change between two periods, or `null` where there isn't one.
 *
 * A zero prior period has no percentage relationship to anything. Returning a flat 100% from a
 * zero base — which is what the arithmetic does if you let it — put a confident green "↑ 100%"
 * on every tile in any month following an empty one, on figures nobody had actually grown.
 * That is the fastest way to teach people the numbers on a dashboard are decorative, and once
 * they believe that they stop reading the true ones too.
 *
 * `null` means "no prior data", and the tile says so in words.
 */
export function pctDelta(curr: number, prev: number): number | null {
  if (prev === 0) return null
  return Math.round(((curr - prev) / prev) * 100)
}
