import { useEffect, useState } from 'react'
import { RAPTOR_OPENING_DEFAULT, RaptorOpening } from './RaptorOpening'
import { onRaptorOpening } from './openingQueue'

/**
 * THE OPENING AFTER A SIGN-IN, OUTSIDE THE ROUTES (S16). It sits above <Routes> in App, so it is never remounted (and
 * restarted) as the page under it goes from the sign-in to "Loading…" to the app -- which is what it covers. The
 * Sign In button asks for it (queueRaptorOpening) once the password is accepted; a reload of a session already
 * signed in plays nothing, because a ritual on every refresh is a wait.
 */
export function SignInOpening() {
  const [run, setRun] = useState(0)
  const [showing, setShowing] = useState(false)
  useEffect(() => {
    onRaptorOpening(() => { setRun((n) => n + 1); setShowing(true) })
    return () => onRaptorOpening(null)
  }, [])
  return showing ? <RaptorOpening key={run} variant={RAPTOR_OPENING_DEFAULT} onDone={() => setShowing(false)} /> : null
}
