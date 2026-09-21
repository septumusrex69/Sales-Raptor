import { Card, CardHeader } from '../ui/Card'
import { tierStart } from '../../lib/commission.ts'
import type { Company } from '../../types'

const money = (n: number) => n.toLocaleString('en-ZA', {
  style: 'currency', currency: 'ZAR', minimumFractionDigits: 2,
})
const percent = (fraction: number) => `${(fraction * 100).toFixed(2).replace(/\.00$/, '')}%`

/**
 * What this client is billed on.
 *
 * THE FIRM: "I don't see anywhere where their collection commission is displayed. They're signing
 * what they're signed on."
 *
 * It was stored and never shown — `commission_rate` and `commission_bands` have been on
 * `companies` since the Swordfish import wrote them, and no screen read them back. The one number
 * every account on this client's book inherits, and the only way to see it was to open an account
 * and read the rate stamped on it.
 *
 * SHOWN AS A FRACTION TURNED BACK INTO A PERCENTAGE, because that is how it is spoken about. The
 * database holds 0.3 and a person says thirty percent; a card showing 0.3 would be read as a
 * third of a percent by somebody in a hurry.
 *
 * AND THE SOURCE IS SHOWN WITH IT, where there is one. A rate with no mandate behind it is a rate
 * somebody typed, and the difference matters the day a client queries an invoice.
 */
export function CommissionCard({ company }: { company: Company }) {
  const bands = company.commissionBands ?? []
  const hasScale = bands.length > 0
  const hasRate = typeof company.commissionRate === 'number' && company.commissionRate > 0

  return (
    <Card>
      <CardHeader
        title="Collection commission"
        subtitle={hasScale ? 'A sliding scale on the capital handed over' : undefined} />

      {!hasScale && !hasRate && (
        /*
          A WARNING THAT ONLY FIRES WHEN SOMETHING IS WRONG. An account opened for a client with no
          rate inherits nothing, and it is invoiced at whatever somebody types on the day.
        */
        <p className="text-sm text-negative-700">
          Nothing signed. An account opened for this client inherits no rate, so it would be
          invoiced at whatever is typed on the day.
        </p>
      )}

      {hasScale ? (
        <ul className="space-y-1.5">
          {bands.map((b, i) => {
            const from = tierStart(i === 0 ? null : bands[i - 1].upTo)
            return (
              <li key={i} className="flex items-baseline justify-between gap-3 text-sm tabular-nums">
                <span className="text-slate-600">
                  {from === null ? '—' : money(from)}
                  {b.upTo === null ? ' and above' : ` up to ${money(b.upTo)}`}
                </span>
                <span className="font-semibold text-navy-950">{percent(b.rate)}</span>
              </li>
            )
          })}
        </ul>
      ) : hasRate ? (
        <p className="text-2xl font-semibold text-navy-950 tabular-nums">
          {percent(company.commissionRate as number)}
          <span className="ml-2 text-sm font-normal text-slate-500">of everything collected</span>
        </p>
      ) : null}

      <div className="mt-3 pt-3 border-t border-slate-100 space-y-1 text-[11px] text-slate-400">
        {company.commissionBandsSource && <p>{company.commissionBandsSource}</p>}
        {/*
          THE MANDATE DATE IS HERE because it is the same question: on whose authority, and on what
          terms. Its absence stops a handover being imported at all, so it is worth seeing beside
          the rate rather than only when an import refuses.
        */}
        {company.mandateSignedAt ? (
          <p>Mandate signed {new Date(company.mandateSignedAt).toLocaleDateString('en-ZA')}.</p>
        ) : (
          <p className="text-negative-700">
            No mandate on record — no handover can be imported for this client.
          </p>
        )}
      </div>
    </Card>
  )
}
