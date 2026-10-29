/**
 * THE PORTAL'S CHART COLOURS (S16, Raptor · Handover 15). Stephan's dashboard brief: "The existing charts contain
 * green and red segments that clash with the brand. Replace these colours everywhere ... No bright green ... No red
 * or burgundy ... No generic default chart-library palettes." The values are the brief's, the same as the --bf-*
 * tokens in portal.css (repeated here because an SVG fill and a Recharts prop need the value, not a variable
 * name a check can trace).
 *
 * BY STATUS, as the brief sets them: the open book's In progress navy, Paying gold, then light blue for an
 * arrangement ("Awaiting payment" in the brief), slate for legal; the finished book's Paid up navy, Settled gold,
 * Written off light blue, the rest blue-grey. The other rungs take the remaining approved tones; a colour repeats
 * only where a client could have more rungs than there are tones, and the legend's words tell them apart.
 * Raptor's own staff screens keep CLIENT_POSITION_COLOUR -- this is the portal's, and the portal's alone.
 */
export const BF = {
  navy: '#101F2C', navyChart: '#203B60', slate: '#46607B', blue: '#97B4CC', gold: '#C69F54',
  charcoal: '#32404D', muted: '#525D66', blueGrey: '#B4BFCC', paleBlue: '#D5E1EB', border: '#ECECEC',
  background: '#F4F4F4', white: '#FFFFFF',
} as const

export const PORTAL_OUTCOME_COLOUR: Record<string, string> = {
  /* the open book */
  in_progress: BF.navyChart,
  paying: BF.gold,
  arranged: BF.blue,
  legal: BF.slate,
  negotiating: BF.charcoal,
  broken_arrangement: BF.muted,
  tracing: BF.blueGrey,
  disputed: BF.charcoal,
  refusing: BF.muted,
  cannot_pay: BF.blueGrey,
  under_administration: BF.slate,
  frozen: BF.paleBlue,
  /* the finished book */
  paid_up: BF.navyChart,
  settled: BF.gold,
  written_off: BF.blue,
  withdrawn: BF.blueGrey,
  closed: BF.blueGrey,
}

/** Every outcome has a brand colour; anything new reads as "other" rather than a library default. */
export const portalOutcomeColour = (outcome: string): string => PORTAL_OUTCOME_COLOUR[outcome] ?? BF.blueGrey
