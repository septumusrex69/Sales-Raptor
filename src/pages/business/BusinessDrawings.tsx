import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, ArrowRightLeft } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { Modal, FormField, inputClass, controlClass } from '../../components/ui/Modal'
import { rand } from '../../lib/money'
import { formatDateTime } from '../../data/mockData'
import { monthBounds, monthLabel, thisMonth, type BusinessMonth } from '../../lib/businessMonth'
import { drawFromTrust, fetchBusinessMonth, fetchDrawings, type Drawing } from '../../lib/businessApi'
import { canDrawFromTrust } from '../../lib/permissions'
import { useAuth } from '../../store/AuthContext'
import { clockNow } from '../../lib/clock.ts'

/**
 * DRAWING THE FIRM'S EARNINGS OUT OF TRUST.
 *
 * THE SCREEN THE TRUST OVERVIEW USED TO PROMISE. Its "Yours to draw" card said: "NOT A BUTTON YET...
 * draw_from_trust exists and refuses an overdrawing, but the screen that decides the amount and
 * records the reference is the business side's, which is not built." This is it.
 *
 * TWO TICKS TO DRAW, the firm's ruling of 7 Oct 2026: a drawing is made from the business side and
 * moves trust money, so it needs business.view (to be here at all) and finance.view as well. The
 * database asks both; the button is drawn off the same two, so it is never offered and refused.
 *
 * THE CEILING IS THE FIRM'S OWN BALANCE ON THE LEDGER, and the database is what holds it: a drawing
 * against anybody else's money is a trust shortfall, the most serious thing that can happen in that
 * account. The box says how much there is; draw_from_trust is what refuses more.
 */
export function BusinessDrawings() {
  const { currentUser } = useAuth()
  const now = thisMonth(clockNow())
  const [year, setYear] = useState(now.year)
  const [month, setMonth] = useState(now.month)
  const [rows, setRows] = useState<Drawing[]>([])
  const [figures, setFigures] = useState<BusinessMonth | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [drawing, setDrawing] = useState(false)
  const bounds = useMemo(() => monthBounds(year, month), [year, month])
  const mayDraw = canDrawFromTrust(currentUser)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [d, m] = await Promise.all([fetchDrawings(bounds.from, bounds.to), fetchBusinessMonth(bounds.from, bounds.to)])
      setRows(d); setFigures(m)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not read the drawings.') }
    finally { setLoading(false) }
  }, [bounds.from, bounds.to])
  useEffect(() => { void load() }, [load])

  function step(by: number) {
    const d = new Date(Date.UTC(year, month - 1 + by, 1))
    setYear(d.getUTCFullYear()); setMonth(d.getUTCMonth() + 1)
  }
  const held = figures?.stillInTrust ?? 0

  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="text-xl font-semibold tracking-tight text-slate-800">Drawings</h1>
          <span className="text-xs text-slate-400">The firm’s earnings moved out of trust to the business account</span>
        </div>
        {mayDraw && (
          <button type="button" onClick={() => setDrawing(true)} disabled={held <= 0}
            className="flex items-center gap-1.5 rounded-lg bg-navy-950 px-3.5 py-2 text-[13px] font-semibold text-white disabled:opacity-50">
            <ArrowRightLeft size={15} /> Draw to the business account
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-4">
        <Card className="flex-1 min-w-[14rem]">
          <p className="text-[11px] uppercase tracking-wide text-slate-400">Earned, still in trust</p>
          <p className="text-2xl font-semibold tabular-nums text-slate-900 mt-1" data-testid="held-for-firm">{rand(held)}</p>
          <p className="text-[11px] text-slate-400 mt-1">The most the firm may draw today.</p>
        </Card>
        <Card className="flex-1 min-w-[14rem]">
          <p className="text-[11px] uppercase tracking-wide text-slate-400">Drawn in {monthLabel(year, month)}</p>
          <p className="text-2xl font-semibold tabular-nums text-slate-900 mt-1">{rand(figures?.drawn ?? 0)}</p>
        </Card>
      </div>
      {!mayDraw && (
        <p className="text-xs text-slate-500">
          Drawing needs the trust account tick as well as this one. Ask an Administrator.
        </p>
      )}

      <div className="flex items-center gap-2">
        <button type="button" onClick={() => step(-1)} className={controlClass}>Earlier</button>
        <div className="text-sm font-medium text-slate-700 min-w-[10rem] text-center">{monthLabel(year, month)}</div>
        <button type="button" onClick={() => step(1)} className={controlClass}>Later</button>
      </div>

      {error && <Card className="p-4 text-sm text-negative-700 bg-negative-50 border-negative-100">{error}</Card>}

      {loading ? (
        <div className="flex items-center gap-2 text-slate-400 text-sm py-8">
          <Loader2 size={16} className="animate-spin" /> Reading the month…
        </div>
      ) : rows.length === 0 ? (
        <Card className="p-6 text-sm text-slate-500 text-center">Nothing drawn in {monthLabel(year, month)}.</Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <table className="w-full text-[12.5px] whitespace-nowrap">
            <thead>
              <tr className="bg-slate-50 text-slate-400 text-slate-400">
                <th className="text-left font-medium px-4 py-2.5">When</th>
                <th className="text-left font-medium px-4 py-2.5 w-full">Transfer</th>
                <th className="text-left font-medium px-4 py-2.5">By</th>
                <th className="text-right font-medium px-4 py-2.5">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="px-4 py-1.5 whitespace-nowrap tabular-nums text-slate-500">{formatDateTime(r.at)}</td>
                  <td className="px-4 py-1.5 text-slate-800">{r.reference}</td>
                  <td className="px-4 py-1.5 whitespace-nowrap text-slate-500">{r.drawnBy ?? '—'}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums whitespace-nowrap">{rand(r.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {drawing && (
        <DrawModal held={held} onClose={() => setDrawing(false)} onDone={() => { setDrawing(false); void load() }} />
      )}
    </div>
  )
}

function DrawModal({ held, onClose, onDone }: { held: number; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState('')
  const [reference, setReference] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const n = Number(amount.replace(/[\s,R]/g, ''))
  const over = Number.isFinite(n) && n > held
  const ready = Number.isFinite(n) && n > 0 && !over && reference.trim().length > 0

  async function go() {
    setBusy(true); setError(null)
    try { await drawFromTrust(n, reference.trim()); onDone() }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  return (
    <Modal title="Draw to the business account" subtitle={`The firm has ${rand(held)} earned and still in trust.`} onClose={onClose}>
      <div className="space-y-3">
        <FormField label="Amount" required>
          <input className={inputClass} inputMode="decimal" value={amount} autoFocus onChange={(e) => setAmount(e.target.value)} />
        </FormField>
        {over && (
          <p className="text-xs text-[var(--c-rust-deep)]">
            That is more than the firm has earned. Drawing it would be drawing somebody else’s money.
          </p>
        )}
        <FormField label="Which transfer this is" required>
          <input className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)}
            placeholder="e.g. EFT ref BF-OCT-01, as it reads on the bank statement" />
        </FormField>
        {error && <p className="text-sm text-rose-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
          <button type="button" disabled={!ready || busy} onClick={go}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-navy-950 text-white disabled:opacity-50 inline-flex items-center gap-2">
            {busy && <Loader2 size={14} className="animate-spin" />}
            Record the drawing
          </button>
        </div>
      </div>
    </Modal>
  )
}
