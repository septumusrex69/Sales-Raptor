import { Fragment } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { rand } from '../../lib/money'
import type { Allocation, Component } from '../../lib/allocationRules'

/**
 * THE THREE THINGS THE FEES SIDE PAYS, DRAWN THE SAME WAY WHEREVER THEY APPEAR.
 *
 * THE FIRM: "the fees you need to split up into three sections. First is the interest, which is
 * the first thing that is taken. Then the receipt fee, which is the 10% excluding VAT. Then the
 * fees, which is the Annexure B fees. Now for every single one... the total interest, the interest
 * already retained, the interest that is available, the interest we are taking now, and the
 * interest after. Now, the column that you will be showing to us is the interest that we are
 * taking now. But if you click on the interest taking, it expands all of the other columns just to
 * double check."
 *
 * ------------------------------------------------------------------------------------------------
 * WHY THIS IS A COMPONENT AND NOT A SECOND COPY OF THE TABLE
 * ------------------------------------------------------------------------------------------------
 *
 * Two screens show these figures: the approval queue, where the payment has not happened, and the
 * administrator's check, where it has. CLAUDE.md's rule about useCollectionsMonth applies exactly
 * -- the firm asked for the repetition, and the repetition is only safe while it is one piece of
 * arithmetic drawn one way. Written out on both screens the failure is not a wrong table, it is
 * the approval queue and the audit list quietly disagreeing about what a payment paid, and the
 * audit list is the one somebody would believe.
 *
 * THE ORDER IS THE ENGINE'S ORDER AND NOT A PREFERENCE. finance_split pays interest out of half A
 * first and the costs pool after it, and the costs pool is settled oldest fee first -- which is
 * why on a small payment the receipt fee this very payment raises can take nothing at all. Drawn
 * in any other order the screen would imply a sequence the money does not follow.
 */
export const SECTIONS = [
  { key: 'interest', label: 'Interest', of: (a: Allocation) => a.interest },
  /* VAT-INCLUSIVE, which the firm asked for by name: "this receipt fee that's shown should be
     inclusive of that". The rate is 10% EXCLUDING VAT and then VAT is added, so the inclusive
     figure is both what the debtor is charged and what the split actually spends. It was drawn
     exclusive beside inclusive costs, which is two units in one row. */
  { key: 'receiptFee', label: 'Receipt fee', of: (a: Allocation) => a.receiptFee },
  { key: 'fees', label: 'Fees', of: (a: Allocation) => a.fees },
] as const

export type SectionKey = typeof SECTIONS[number]['key']

/**
 * THE FOUR FIGURES BEHIND A "TAKING NOW", AS THE FIRM WROTE THEM OUT BY HAND.
 *
 *   a        total run         everything of this kind ever raised
 *   b        retained          what earlier payments took
 *   a - b    available         what is there to take
 *   c        taking now        what THIS payment takes -- the column that is always shown
 *   a-b-c    after             what is left
 *
 * THE FIFTH IS NOT THE FIRM'S AND IT IS NOT PADDING. In duplum (NCA s103(5)) stops interest and
 * fees together exceeding the capital outstanding, so on an account at its ceiling part of what RAN
 * can never be RECOVERED -- RRC00005 carries R437,01 of fees against R380,00 of capital. Without it
 * the expansion would not add up and the firm's own formula would look broken on correct
 * arithmetic.
 */
export const BEFORE: { label: string; of: (c: Component) => number }[] = [
  { label: 'run', of: (c) => c.total },
  { label: 'ceiling refuses', of: (c) => c.cannotTake },
  { label: 'retained', of: (c) => c.retained },
  { label: 'available', of: (c) => c.available },
]

/** How many columns the three sections occupy, given which are opened out. */
export function feeColumns(opened: Set<SectionKey>): number {
  return SECTIONS.reduce((n, s) => n + (opened.has(s.key) ? BEFORE.length + 2 : 1), 0)
}

/** Open and close one section, for a screen that keeps the set in its own state. */
export function toggled(opened: Set<SectionKey>, key: SectionKey): Set<SectionKey> {
  const next = new Set(opened)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}

/**
 * THE HEADINGS. One column a section, and the heading is the button that opens the rest.
 *
 * PER SECTION AND NOT PER ROW: the four figures are a column each, and a row that opened its own
 * would put a different number of cells in one table.
 */
export function FeeHeadCells({ opened, onToggle }: {
  opened: Set<SectionKey>
  onToggle: (key: SectionKey) => void
}) {
  return (
    <>
      {SECTIONS.map((sec, i) => (
        <Fragment key={sec.key}>
          {opened.has(sec.key) && BEFORE.map((f) => (
            <th key={f.label}
              className={`px-2 py-2 text-right font-normal text-slate-400 ${
                f.label === 'run' ? 'border-l border-slate-200' : ''}`}>
              {sec.label} {f.label}
            </th>
          ))}
          <th className={`px-2 py-2 text-right font-medium ${
            !opened.has(sec.key) && i === 0 ? 'border-l border-slate-200'
              : !opened.has(sec.key) ? 'border-l border-slate-100' : ''}`}>
            <button type="button" onClick={() => onToggle(sec.key)}
              className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-navy-950"
              title={opened.has(sec.key)
                ? `Hide the ${sec.label.toLowerCase()} arithmetic`
                : `Show what this ${sec.label.toLowerCase()} figure comes out of`}>
              {opened.has(sec.key) ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              {sec.label} taking
            </button>
          </th>
          {opened.has(sec.key) && (
            <th className="px-2 py-2 text-right font-normal text-slate-400">{sec.label} after</th>
          )}
        </Fragment>
      ))}
    </>
  )
}

/**
 * THE CELLS, for one allocation.
 *
 * `note` IS THE INTEREST SECTION'S ALONE and the caller supplies it, because only the caller knows
 * whether the figure is a forecast. On the approval queue most of the interest is the open period
 * -- computed to the day the money arrived and written only when somebody approves -- and a
 * collector who went looking for it in the ledger beforehand would not find it. On a posted
 * payment there is nothing to warn about: it is a ledger row.
 */
export function FeeBodyCells({ a, opened, note }: {
  a: Allocation
  opened: Set<SectionKey>
  note?: string
}) {
  return (
    <>
      {SECTIONS.map((sec, i) => {
        const c = sec.of(a)
        const mine = sec.key === 'interest' ? note : undefined
        return (
          <Fragment key={sec.key}>
            {opened.has(sec.key) && BEFORE.map((f) => (
              <td key={f.label} title={f.label === 'available' ? mine : undefined}
                className={`px-2 py-1.5 text-right tabular-nums text-slate-400 ${
                  f.label === 'run' ? 'border-l border-slate-200' : ''}`}>
                {rand(f.of(c))}
                {f.label === 'available' && mine && (
                  <span className="ml-1 text-[10px] text-slate-400">·</span>
                )}
              </td>
            ))}
            <td title={mine}
              className={`px-2 py-1.5 text-right tabular-nums text-slate-700 ${
                !opened.has(sec.key) && i === 0 ? 'border-l border-slate-200'
                  : !opened.has(sec.key) ? 'border-l border-slate-100' : ''}`}>
              {rand(c.taking)}
            </td>
            {opened.has(sec.key) && (
              <td className="px-2 py-1.5 text-right tabular-nums text-slate-400">{rand(c.after)}</td>
            )}
          </Fragment>
        )
      })}
    </>
  )
}
