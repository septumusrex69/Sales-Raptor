import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import clsx from 'clsx'
import { Card } from '../ui/Card'
import { rand } from '../../lib/money'
import { parkedState, type ParkedCredit } from '../../lib/excessCredit'
import { fetchParkedCredits, returnParkedCredit, takeParkedCredit } from '../../lib/excessCreditApi'

/**
 * OVERPAYMENTS PARKED, AND WHETHER THEIR TIME HAS COME.
 *
 * The firm asked for this ending: *"who are we going to pay five rand to? We're going to give the
 * guy a call, and the costs are going to be already more than 20 rand... It can go to us or
 * whatever."* Parking is the decision to WAIT; what happens afterwards is this screen.
 *
 * WAITING IS THE ORDINARY STATE AND IT IS DRAWN QUIETLY. Most rows sit here for months and nothing
 * is owed from anybody; a list that shouted at every one of them would train people to skip it, and
 * the few that are ripe are the whole reason to open it.
 *
 * TAKING IS REFUSED BEFORE THE DATE, IN THE DATABASE. The button is simply absent here, but that is
 * the courtesy -- `take_parked_credit` raises on an early take, because taking a credit the day it
 * was parked is keeping a debtor's money rather than giving up on returning it, and that difference
 * is the only thing that makes this defensible at all.
 *
 * AND IT GIVES BACK. A debtor turning up afterwards is exactly the case this has to survive, so a
 * taken credit keeps a way to return it -- two fresh ledger entries, never an edit.
 */
export function ParkedCredits() {
  const [rows, setRows] = useState<ParkedCredit[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setRows(await fetchParkedCredits()) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not read the parked credits.') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  async function act(c: ParkedCredit, take: boolean) {
    const reason = window.prompt(take
      ? 'Why is the firm taking this one?'
      : 'Why is it going back to the debtor?')
    if (!reason || reason.trim() === '') return
    setBusy(c.allocationId); setError(null)
    try {
      if (take) await takeParkedCredit(c.allocationId, reason)
      else await returnParkedCredit(c.allocationId, reason)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setBusy(null) }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-400 py-6">
        <Loader2 size={15} className="animate-spin" /> Reading the parked credits…
      </div>
    )
  }

  /* NOTHING PARKED IS NOT AN EMPTY STATE WORTH DRAWING. It is the normal condition of the firm. */
  if (rows.length === 0 && !error) return null

  const ripe = rows.filter((r) => parkedState(r) === 'ripe').length

  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-3 flex-wrap">
        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
          Parked overpayments
        </div>
        {ripe > 0 && (
          <span className="text-[12.5px] text-gold-800">
            {ripe === 1 ? 'one has waited its time' : `${ripe} have waited their time`}
          </span>
        )}
      </div>

      {error && (
        <div className="rounded-lg bg-negative-50 px-4 py-3 text-sm text-negative-700">{error}</div>
      )}

      <Card className="overflow-hidden p-0">
        {rows.map((c) => {
          const state = parkedState(c)
          return (
            <div key={c.allocationId}
              className="flex flex-wrap items-center gap-3 px-5 py-3.5 border-b border-slate-100 last:border-b-0">
              <div className="flex-1 min-w-0">
                <Link to={`/accounts/${c.accountId}`}
                  className="text-sm font-medium text-slate-800 hover:text-gold-700">
                  {c.debtor}
                </Link>
                <div className="text-[12.5px] text-slate-500 mt-0.5">
                  {[c.caseNumber, c.client].filter(Boolean).join(' · ')}
                </div>
              </div>

              <div className="text-[12.5px] text-slate-500 min-w-[9rem]">
                {state === 'taken'
                  ? 'Taken to the firm'
                  : state === 'ripe'
                    ? `Waited since ${c.parkedOn ?? 'it was parked'}`
                    : `Comes back ${c.ripeOn ?? 'later'}`}
              </div>

              <span className={clsx('rounded-full px-2 py-px text-[11px] font-medium',
                state === 'taken' ? 'bg-positive-100 text-positive-700'
                  : state === 'ripe' ? 'bg-gold-100 text-gold-800'
                    : 'bg-slate-100 text-slate-500')}>
                {state === 'taken' ? 'Ours' : state === 'ripe' ? 'Ready' : 'Waiting'}
              </span>

              <div className="text-[15px] font-medium tabular-nums w-24 text-right">
                {rand(c.amount)}
              </div>

              <div className="w-28 text-right">
                {busy === c.allocationId ? (
                  <Loader2 size={15} className="animate-spin inline text-slate-400" />
                ) : state === 'ripe' ? (
                  <button type="button" onClick={() => void act(c, true)}
                    className="text-[13px] font-medium text-gold-700 hover:text-gold-800">
                    Take it
                  </button>
                ) : state === 'taken' ? (
                  <button type="button" onClick={() => void act(c, false)}
                    className="text-[13px] font-medium text-slate-500 hover:text-slate-700">
                    Give it back
                  </button>
                ) : null}
              </div>
            </div>
          )
        })}
      </Card>

      <p className="text-[12.5px] text-slate-500 leading-relaxed">
        A parked credit is still the debtor&rsquo;s. The firm may take one only once its period has
        run, and giving it back writes two fresh ledger entries rather than undoing anything.
      </p>
    </div>
  )
}
