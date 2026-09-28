import { useEffect, useRef, useState } from 'react'
import { FlaskConical, Loader2, Play, Square, SkipForward } from 'lucide-react'
import { Card, CardHeader } from '../ui/Card'
import { useAuth } from '../../store/AuthContext'
import { advanceTestClock } from '../../lib/accountRun.ts'
import { isTestAccount } from '../../lib/testClock.ts'

/**
 * WALKING AN ACCOUNT THROUGH ITS SEQUENCE WHILE YOU WATCH.
 *
 * THE FIRM: "Can we start testing the workflows in real time, kind of... everything go out one
 * minute after the other... let's make it two minutes where everything happens. So it could switch
 * between workflows... and I will tick received or not received."
 *
 * ONE TICK IS ONE EVENT, at the firm's choosing rather than one day at a time -- so the quiet gap
 * between day 20 and day 39 of a section 129 costs nobody twenty minutes of waiting, and the whole
 * eleven-step sequence plays out in about twenty.
 *
 * IT BEATS FROM THE PAGE YOU ARE LOOKING AT, and that is the honest version rather than a
 * limitation. The plan's cron fires once a day, so there is nothing on the server that could keep a
 * two-minute rhythm -- but the firm will be sitting here ticking "received" and "not received"
 * between steps, and a clock that only runs while somebody is watching cannot be left on by
 * accident over a weekend.
 *
 * IT STOPS ITSELF ON A REFUSAL. The two things the endpoint refuses -- a real account, a production
 * database -- are facts about where you are and not failures to retry; beating on against them
 * would be four hundred refusals an hour into somebody's log.
 *
 * AND IT IS NOT DRAWN AT ALL EXCEPT ON A TEST ACCOUNT. The same predicate the server checks and the
 * database enforces, so the button is never offered where the press would be refused -- and no real
 * debtor's page ever carries a control that rewrites the dates on their notices.
 */
export function TestClockPanel({ accountId, accountNumber, onTick }: {
  accountId: string
  accountNumber: string | null
  /** Reload the account, so the rail redraws with whatever the tick sent. */
  onTick: () => Promise<void> | void
}) {
  const { session } = useAuth()
  const [running, setRunning] = useState(false)
  const [busy, setBusy] = useState(false)
  const [last, setLast] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  /* THE BEAT READS THESE RATHER THAN CLOSING OVER THEM. An interval captures the values that
     existed when it was set, so a tick five minutes in would otherwise still be using the token and
     the callback from the first render. */
  const tickRef = useRef<() => Promise<void>>(async () => {})

  const token = session?.access_token

  async function tick() {
    if (!token || busy) return
    setBusy(true)
    const result = await advanceTestClock(token, accountId)
    setBusy(false)
    if (!result.ok) {
      setProblem(result.problem)
      /* STOPPED, not retried: see the note above. */
      setRunning(false)
      return
    }
    setProblem(null)
    const moved = result.jumpedDays === 0
      ? 'Nothing to move forward to'
      : `Moved ${result.jumpedDays} day${result.jumpedDays === 1 ? '' : 's'}`
    setLast(`${moved} · ${result.sent} sent, ${result.held} waiting`)
    await onTick()
  }
  tickRef.current = tick

  useEffect(() => {
    if (!running) return
    /* TWO MINUTES, the firm's own number. Long enough to read what went out and tick a promise or
       a dispute in between, which is the whole point of watching it happen. */
    const id = window.setInterval(() => { void tickRef.current() }, 120_000)
    return () => window.clearInterval(id)
  }, [running])

  if (!isTestAccount(accountNumber)) return null

  return (
    <Card>
      <CardHeader
        title="Test clock"
        subtitle="Pulls the next step onto today and runs the daily pass. Messages go out for real."
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setRunning((v) => !v)}
          disabled={!token}
          className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border disabled:opacity-50 ${
            running
              ? 'border-negative-100 text-negative-700 bg-white hover:bg-negative-50'
              : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}
        >
          {running ? <><Square size={12} /> Stop</> : <><Play size={12} /> Start · every 2 min</>}
        </button>
        <button
          type="button"
          onClick={() => void tickRef.current()}
          disabled={!token || busy}
          className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <SkipForward size={12} /> Next step now
        </button>
        {busy && <Loader2 size={14} className="animate-spin text-slate-400" />}
      </div>

      {last && <p className="text-[11px] text-slate-500 mt-2">{last}</p>}
      {problem && <p className="text-[11px] text-negative-700 mt-2">{problem}</p>}

      {/* SAID ON THE SCREEN, because the firm chose it knowing the cost: every SMS segment is
          billed by Connect Mobile each time a sequence is run through. */}
      <p className="text-[10px] text-slate-400 mt-2 leading-snug inline-flex items-start gap-1">
        <FlaskConical size={11} className="mt-0.5 shrink-0" />
        <span>
          Staging only, and only on a BF-TEST account — the server and the database both refuse
          anything else. Emails and SMSs are sent for real, so each run through a sequence costs
          what it would cost a debtor.
        </span>
      </p>
    </Card>
  )
}
