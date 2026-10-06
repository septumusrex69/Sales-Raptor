import { Plus, Trash2 } from 'lucide-react'
import { FormField, inputClass } from '../ui/Modal'
import { startOf, type Tier } from '../../lib/commissionTiers.ts'

/**
 * A SLIDING SCALE, TYPED THE WAY THE FIRM SAYS IT -- one editor, used wherever a scale is set.
 *
 * Moved out of AddClientModal when Trust settings needed it too. The firm, on the commission
 * dialog there: "Here I can't choose a sliding scale." Two copies of this would drift on the two
 * rules that matter in it -- the start of a tier is SHOWN, not typed, and a new tier goes in above
 * the last, because the last is "and above" -- and a scale entered one way on a new client and
 * another way in settings is the same mandate priced two ways.
 *
 * TYPED AS PERCENTAGES AND RANDS, STORED AS FRACTIONS. Everything in Raptor holds commission as
 * 0.3 for thirty per cent; the conversion is `tiersToBands`, here, at the boundary.
 */
export function CommissionScaleEditor({ tiers, onTiers, source, onSource }: {
  tiers: Tier[]
  onTiers: (next: Tier[] | ((prev: Tier[]) => Tier[])) => void
  source: string
  onSource: (s: string) => void
}) {
  return (
    <div className="space-y-2">
      {tiers.map((t, i) => (
        <div key={i} className="flex items-center gap-2">
          {/*
            WHERE EACH TIER STARTS IS SHOWN, NOT TYPED, at the firm's instruction: "if it's up to
            100,000 for one tier, the next tier should start from 100,001 automatically." Two
            numbers to keep in step is two numbers that drift, and the one nobody re-reads is the
            start.

            IT IS A CENT ABOVE, NOT A RAND. rateForCapital is `capital <= upTo`, so the boundary
            rand belongs to the LOWER band -- commission.ts says so in its own words, "an account
            handed over at exactly R25,000.00 is 25%, not 22.5%". An account at R100 000.50 is real
            and has to belong somewhere, and a label saying "From R100 001" would put it in
            neither tier.
          */}
          <span className="text-xs text-slate-400 w-28 shrink-0 tabular-nums">{startOf(tiers, i)}</span>
          <input className={`${inputClass} max-w-[9rem]`} value={t.upTo} aria-label={`Tier ${i + 1} up to`}
            placeholder={i === tiers.length - 1 ? 'and above' : '100000'}
            onChange={(e) => onTiers((prev) => prev.map((x, j) => (j === i ? { ...x, upTo: e.target.value } : x)))} />
          <input className={`${inputClass} max-w-[5rem]`} value={t.rate} placeholder="30" aria-label={`Tier ${i + 1} rate`}
            onChange={(e) => onTiers((prev) => prev.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)))} />
          <span className="text-sm text-slate-500">%</span>
          {tiers.length > 2 && (
            <button type="button" className="text-slate-300 hover:text-negative-600" aria-label={`Remove tier ${i + 1}`}
              onClick={() => onTiers((prev) => prev.filter((_, j) => j !== i))}>
              <Trash2 size={14} />
            </button>
          )}
        </div>
      ))}
      {/* The new tier goes in ABOVE the last one, because the last is "and above" and has to stay
          there -- see scheduleProblems. */}
      <button type="button"
        onClick={() => onTiers((prev) => [...prev.slice(0, -1), { upTo: '', rate: '' }, prev[prev.length - 1]])}
        className="inline-flex items-center gap-1 text-xs font-medium text-brand-600">
        <Plus size={12} /> Another tier
      </button>
      <FormField label="Where the scale comes from">
        <input className={inputClass} value={source} onChange={(e) => onSource(e.target.value)}
          placeholder="Signed mandate, 30 April 2024" />
      </FormField>
    </div>
  )
}
