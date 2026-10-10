import { Card, CardHeader } from '../ui/Card'
import { formatCurrency, formatDate } from '../../data/mockData'
import { useAppStore } from '../../store/AppStore'
import type { Company, Handover } from '../../types'

const DAY = 24 * 60 * 60 * 1000

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / DAY)
}

/**
 * What a client signed for against what they've actually sent.
 *
 * The signed figure is a claim — clients say a million and send fifty thousand — so it's shown
 * as what it is and never scored against. What matters is the arrivals: books come in
 * instalments over months, so a client at 20% two months into a ten-month drip is on schedule,
 * not failing. That's why there's no traffic light on the fill percentage.
 *
 * The number actually worth acting on is the last one: a client with book outstanding who has
 * gone quiet is somebody to phone, and nothing else on the page says that.
 *
 * The action UPLOADS, it does not record. THE FIRM: "if I record a batch, that is an absolutely
 * useless exercise. You should say upload a batch." Typing a capital figure and a count created
 * no accounts, so the received figure below could disagree with the book it claimed to describe.
 * A batch now exists only because a handover sheet was read and approved, and its capital is
 * added up from the accounts that arrived in it.
 */
export function HandoverBook({ company, onUpload }: { company: Company; onUpload: () => void }) {
  const { handovers, deals } = useAppStore()

  const rows = handovers
    .filter((h) => h.companyId === company.id)
    .sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime())

  /*
   * A BATCH THAT WAS TAKEN BACK OUT DOES NOT COUNT, AND IS STILL DRAWN.
   * ------------------------------------------------------------------
   * THE FIRM, on a client whose Handover Book read "3 batches received" and R 106 746 000 000 011
   * 868: "the notes that I made of like retracting the handover file, that's also not there. You
   * remember I took it out, those handover files."
   *
   * THEY HAD TAKEN THEM OUT. Two of the three carried `discarded_at`, their accounts were gone, and
   * every figure here counted them anyway — the card read three batches and twenty-four accounts
   * over a book of eight. A discard that leaves the client's own page saying the opposite is a
   * discard nobody can trust.
   *
   * KEPT AND MARKED RATHER THAN HIDDEN, which is the same decision handoverDiscard makes about the
   * row itself: a batch that arrived and was withdrawn is a fact about this client, and a client
   * asking "what happened to the file I sent on the 1st" has to find an answer here. Hiding it
   * would make the firm's own retraction invisible, which is half of what they were complaining
   * about.
   */
  const live = rows.filter((h) => !h.discardedAt)
  const discarded = rows.length - live.length

  // What they signed for, taken from the mandates themselves rather than the signup estimate,
  // so it follows any correction made on the deal.
  const signedBook = deals
    .filter((d) => d.companyId === company.id && d.stage === 'Won' && d.handoverAmount != null)
    .reduce((sum, d) => sum + (d.handoverAmount ?? 0), 0)

  const received = live.reduce((sum, h) => sum + h.capitalAmount, 0)
  const accounts = live.reduce((sum, h) => sum + (h.accountsCount ?? 0), 0)
  const outstanding = Math.max(signedBook - received, 0)
  const fill = signedBook > 0 ? Math.round((received / signedBook) * 100) : null
  /* AND THE QUIET CLOCK RUNS OFF A BATCH THAT IS STILL THERE. A discarded one would say a client
     sent something yesterday when what they sent has been taken back out. */
  const quietDays = live.length > 0 ? daysSince(live[0].receivedAt) : null

  if (signedBook === 0 && rows.length === 0) return null

  return (
    <Card>
      <CardHeader
        title="Handover Book"
        subtitle={`${live.length === 1 ? '1 batch' : `${live.length} batches`} received`
          + (discarded > 0 ? ` \u00b7 ${discarded} discarded` : '')}
        action={
          <button onClick={onUpload} className="text-xs font-medium text-brand-600 hover:underline">
            Upload a batch
          </button>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3 mb-4">
        <Figure label="Signed Book" value={formatCurrency(signedBook)} hint="What they signed for" />
        <Figure label="Received" value={formatCurrency(received)} hint={accounts > 0 ? `${accounts.toLocaleString()} accounts` : undefined} />
        <Figure label="Outstanding" value={formatCurrency(outstanding)} hint={fill !== null ? `${fill}% received` : undefined} />
        <Figure
          label="Last Batch"
          value={quietDays === null ? '—' : quietDays === 0 ? 'Today' : `${quietDays}d ago`}
          hint={outstanding > 0 && quietDays !== null && quietDays > 60 ? 'Gone quiet — worth a call' : undefined}
          alert={outstanding > 0 && quietDays !== null && quietDays > 60}
        />
      </div>

      {fill !== null && (
        <div className="h-2 rounded-full bg-[var(--tint-steel-alt)] overflow-hidden mb-4">
          <div className="h-full rounded-full" style={{ width: `${Math.min(fill, 100)}%`, backgroundColor: 'var(--outcome-won)' }} />
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-slate-400">Nothing handed over yet.</p>
      ) : (
        // The checking list's shape, which the firm asked for on every list: a row a batch, the
        // date, the capital, the count and the reference each in a column of their own, so a
        // reference no longer pushes the date of the batch below it out of line.
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-[12.5px] whitespace-nowrap">
            <thead>
              <tr className="border-b border-slate-100 text-slate-400">
                <th className="px-2 py-1.5 text-left font-medium">Received</th>
                <th className="px-2 py-1.5 text-right font-medium">Capital</th>
                <th className="px-2 py-1.5 text-right font-medium">Accounts</th>
                <th className="px-2 py-1.5 text-left font-medium">Reference</th>
                <th className="px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((h: Handover) => (
                <tr key={h.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                  <td className="px-2 py-1.5 text-slate-500 tabular-nums">{formatDate(h.receivedAt)}</td>
                  {/* STRUCK THROUGH, NOT REMOVED. The figure is what the sheet said; the line
                      through it is what the firm did about it. */}
                  <td className={`px-2 py-1.5 text-right tabular-nums whitespace-nowrap ${h.discardedAt ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
                    {formatCurrency(h.capitalAmount)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-slate-400">
                    {h.accountsCount != null ? `${h.accountsCount} accounts` : ''}
                  </td>
                  <td className="px-2 py-1.5 text-slate-400">
                    {h.reference && <span className="block max-w-[16rem] truncate" title={h.reference}>{h.reference}</span>}
                  </td>
                  {/* SAID IN WORDS AS WELL AS IN A LINE. A strikethrough alone is not a state to
                      anybody reading this aloud down a telephone, and it is not a state at all to
                      somebody who cannot see it. */}
                  <td className="px-2 py-1.5">
                    {h.discardedAt && (
                      <span className="text-[var(--c-gold-deep)]">
                        discarded {formatDate(h.discardedAt)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

function Figure({ label, value, hint, alert }: { label: string; value: string; hint?: string; alert?: boolean }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400 mb-1">{label}</p>
      <p className={`text-lg font-bold ${alert ? 'text-[var(--c-rust-deep)]' : 'text-slate-800'}`}>{value}</p>
      {hint && <p className={`text-[11.5px] mt-0.5 ${alert ? 'text-[var(--c-rust-deep)]' : 'text-slate-400'}`}>{hint}</p>}
    </div>
  )
}
