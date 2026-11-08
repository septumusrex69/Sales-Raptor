import { useEffect, useRef, useState } from 'react'
import { CalendarClock, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatDate } from '../../data/mockData'
import { capturedLate, paymentDates, type PaymentDate } from '../../lib/paymentDates'

/**
 * PAID · CAPTURED · APPROVED, ONE TAP AWAY (S19; Stephan, 7 Nov: "it doesn't need to be in your face, like taking up
 * a lot of space in important places. We can just access this information somewhere ... an easy, close place").
 *
 * A small calendar button beside a payment's date; a TAP opens the three dates under it -- a tap rather than a
 * hover, because the firm works on an iPad and a tablet has no hover. The dates are read when it opens, for that
 * one payment, so a list of six hundred payments costs nothing until somebody asks. See lib/paymentDates.ts for
 * what each date means and decides.
 */
export function PaymentDates({ paymentId }: { paymentId: string }) {
  const [open, setOpen] = useState(false)
  const [dates, setDates] = useState<PaymentDate[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const box = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open || dates) return
    let live = true
    void supabase.from('account_payment_lines')
      .select('received_at, created_at, captured_on, allocated_on, approved_at, paid_to_client')
      .eq('id', paymentId).maybeSingle()
      .then(({ data, error: e }) => {
        if (!live) return
        if (e || !data) setError(e?.message ?? 'Not found')
        else setDates(paymentDates(data as Parameters<typeof paymentDates>[0]))
      })
    return () => { live = false }
  }, [open, dates, paymentId])

  /* Closes on a tap anywhere else, like every other little panel in Raptor. */
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])

  return (
    <span ref={box} className="relative inline-flex align-middle">
      <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(!open) }}
        aria-expanded={open} aria-label="Paid, captured and approved dates" title="Paid, captured and approved"
        data-testid="payment-dates"
        className={`ml-1 rounded p-0.5 ${open ? 'text-slate-700 bg-slate-100' : 'text-slate-300 hover:text-slate-600 hover:bg-slate-100'}`}>
        <CalendarClock size={13} />
      </button>
      {open && (
        <span role="dialog" data-testid="payment-dates-panel" onClick={(e) => e.stopPropagation()}
          className="absolute left-0 top-full z-30 mt-1 w-64 whitespace-normal rounded-lg border border-slate-200 bg-[var(--color-card-solid,#fff)] p-3 text-left text-[12px] font-normal shadow-lg">
          {error ? <span className="text-negative-700">The dates could not be read: {error}</span>
            : !dates ? <span className="flex items-center gap-1.5 text-slate-400"><Loader2 size={12} className="animate-spin" /> Reading…</span>
              : (
                <>
                  {dates.map((d) => (
                    <span key={d.label} className="flex items-baseline justify-between gap-3 py-0.5" data-testid={`payment-date-${d.label.toLowerCase()}`}>
                      <span className="text-slate-500">
                        {d.label}
                        {/* S20: the date that puts it in a payover cycle, said where the dates are. */}
                        {d.decidesCycle && <span className="ml-1 text-[10.5px] text-slate-400" data-testid="payment-date-cycle">· cycle</span>}
                      </span>
                      <span className={`tabular-nums font-medium ${d.day ? 'text-slate-800' : 'text-slate-400'}`} title={d.note}>
                        {d.day ? formatDate(d.day) : 'Not yet'}
                      </span>
                    </span>
                  ))}
                  {capturedLate(dates) && (
                    <span className="mt-1.5 block border-t border-slate-100 pt-1.5 text-[11.5px] text-amber-700" data-testid="payment-captured-late">
                      Captured more than a week after it was paid.
                    </span>
                  )}
                </>
              )}
        </span>
      )}
    </span>
  )
}
