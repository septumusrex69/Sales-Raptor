import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../store/AuthContext'

/** How long a session may sit untouched before it ends. */
const IDLE_LIMIT_MS = 30 * 60 * 1000
/** How much warning someone gets before it does. */
const WARN_BEFORE_MS = 60 * 1000
/** Shared across tabs: working in one tab must not be idleness in another. */
const ACTIVITY_KEY = 'crm.lastActivity'
/** Writing to storage on every mousemove would be absurd; once every few seconds is plenty. */
const WRITE_THROTTLE_MS = 5000
const CHECK_INTERVAL_MS = 5000

function readLastActivity(): number {
  try {
    const raw = window.localStorage.getItem(ACTIVITY_KEY)
    const parsed = raw ? Number(raw) : NaN
    return Number.isFinite(parsed) ? parsed : Date.now()
  } catch {
    return Date.now()
  }
}

function writeLastActivity(at: number) {
  try {
    window.localStorage.setItem(ACTIVITY_KEY, String(at))
  } catch {
    // Storage blocked. The in-memory timer still works for this tab.
  }
}

/**
 * Signs someone out after a spell of doing nothing.
 *
 * A collections floor has shared desks and people who walk away mid-account, and what is on
 * screen is a named person's ID number, address and debt. An unattended session is the easiest
 * way for that to be seen by someone who shouldn't see it, and no amount of database security
 * helps once the browser is already signed in.
 *
 * Activity is shared between tabs through storage, so a clerk working in one tab is not logged
 * out by another sitting idle. And it warns before acting: ending a session silently mid-typing
 * loses work and teaches people to distrust the app.
 */
export function IdleTimeout() {
  const { session, signOut } = useAuth()
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  const lastWriteRef = useRef(0)

  const markActive = useCallback(() => {
    const now = Date.now()
    if (now - lastWriteRef.current < WRITE_THROTTLE_MS) return
    lastWriteRef.current = now
    writeLastActivity(now)
  }, [])

  const staySignedIn = useCallback(() => {
    lastWriteRef.current = 0
    markActive()
    setSecondsLeft(null)
  }, [markActive])

  useEffect(() => {
    if (!session) return
    writeLastActivity(Date.now())

    const events: (keyof DocumentEventMap)[] = ['pointerdown', 'keydown', 'wheel', 'touchstart']
    events.forEach((e) => document.addEventListener(e, markActive, { passive: true }))

    const timer = window.setInterval(() => {
      const idleFor = Date.now() - readLastActivity()
      if (idleFor >= IDLE_LIMIT_MS) {
        setSecondsLeft(null)
        void signOut()
        return
      }
      const untilLogout = IDLE_LIMIT_MS - idleFor
      setSecondsLeft(untilLogout <= WARN_BEFORE_MS ? Math.ceil(untilLogout / 1000) : null)
    }, CHECK_INTERVAL_MS)

    return () => {
      events.forEach((e) => document.removeEventListener(e, markActive))
      window.clearInterval(timer)
    }
  }, [session, signOut, markActive])

  if (secondsLeft === null) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-xl">
        <p className="font-semibold text-navy-950 mb-1">Still there?</p>
        <p className="text-sm text-slate-500 mb-4">
          You'll be signed out in {secondsLeft} second{secondsLeft === 1 ? '' : 's'} because this session has been idle.
        </p>
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={staySignedIn}
            className="text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700"
            autoFocus
          >
            Stay signed in
          </button>
          <button onClick={() => void signOut()} className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-500 hover:bg-slate-100">
            Sign out now
          </button>
        </div>
      </div>
    </div>
  )
}
