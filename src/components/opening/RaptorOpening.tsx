import { useEffect, useRef, useState } from 'react'
import { playRaptorSound } from './raptorSound'
import './raptorOpening.css'

/**
 * RAPTOR'S OWN OPENING, AFTER A SIGN-IN (S16, Raptor · Handover 15). Stephan, having picked the portal's "towers":
 * "Now for the Raptor login, let's also try and make three type of ones when it's loading and opening ... with the
 * Raptor theme and everything." Until then Raptor opened on a grey "Loading…".
 *
 * Raptor's colours and Raptor's mark -- the gold wing and the RAPTOR wordmark on the navy -- whatever skin the person
 * wears: it is the product's moment, not their desk's. Three, on one three-and-a-half-second clock, each with its
 * own sound (raptorSound.ts):
 *
 *   flight  -- speed lines and cloud streaking past, the wing strikes in from the left, a flare off its tip, the
 *              name slides out from behind it.
 *   ascent  -- rising through dawn cloud, the wing comes up out of the haze, a light runs along its feathers, the
 *              name sharpens into focus beneath it.
 *   lock    -- a gold radar and four brackets closing on the centre, a lock and a flash, the wing in the sights, the
 *              name typed out, "Raptor online".
 *
 * /opening plays any of them on demand; the sign-in plays FLIGHT until Stephan picks. It covers the app as it loads
 * underneath and dissolves into it; a tap skips it; Reduced motion gets the still mark (unless `force`, the replay
 * page). It never waits on anything: the app is already drawing under it.
 */
export type RaptorVariant = 'flight' | 'ascent' | 'lock'
export const RAPTOR_OPENING_DEFAULT: RaptorVariant = 'flight'

const FULL_MS = 3500

const seed = (i: number, n: number) => ((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1
const STREAKS = Array.from({ length: 22 }, (_, i) => ({ y: seed(i, 1) * 100, w: 8 + seed(i, 2) * 26, delay: seed(i, 3) * 1.1, dur: 0.45 + seed(i, 4) * 0.5, gold: i % 3 === 0 }))
const WISPS = Array.from({ length: 7 }, (_, i) => ({ y: 10 + seed(i, 5) * 80, w: 30 + seed(i, 6) * 40, delay: seed(i, 7) * 0.8, dur: 1.2 + seed(i, 8) }))
const CLOUDS = [0, 1, 2, 3, 4].map((i) => ({ y: 8 + i * 19, delay: i * 0.12, op: 0.10 + (i % 3) * 0.06 }))

export function RaptorOpening({ variant = RAPTOR_OPENING_DEFAULT, onDone, force = false }: {
  variant?: RaptorVariant
  onDone: () => void
  force?: boolean
}) {
  const reduced = !force && typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const [leaving, setLeaving] = useState(false)
  const done = useRef(false)
  const finish = () => {
    if (done.current) return
    done.current = true
    setLeaving(true)
    setTimeout(onDone, 550)
  }

  useEffect(() => {
    if (!reduced) playRaptorSound(variant)
    const t = setTimeout(finish, reduced ? 600 : FULL_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one play per mount; the replay page remounts by key
  }, [])

  const look = reduced ? 'still' : variant
  return (
    <div className={`raptor-opening is-${look} ${leaving ? 'is-leaving' : ''}`} data-testid="raptor-opening" data-variant={look}
      onClick={finish} role="presentation">
      {look === 'flight' && (
        <div aria-hidden className="ro-layer">
          {WISPS.map((w, i) => <span key={`w${i}`} className="ro-wisp" style={{ top: `${w.y}%`, width: `${w.w}vw`, animationDelay: `${w.delay}s`, animationDuration: `${w.dur}s` }} />)}
          {STREAKS.map((s, i) => <span key={i} className={`ro-streak ${s.gold ? 'is-gold' : ''}`} style={{ top: `${s.y}%`, width: `${s.w}vw`, animationDelay: `${s.delay}s`, animationDuration: `${s.dur}s` }} />)}
        </div>
      )}
      {look === 'ascent' && (
        <div aria-hidden className="ro-layer">
          <span className="ro-sun" />
          {CLOUDS.map((c, i) => <span key={i} className="ro-cloud" style={{ top: `${c.y}%`, animationDelay: `${c.delay}s`, opacity: c.op }} />)}
        </div>
      )}
      {look === 'lock' && (
        <div aria-hidden className="ro-layer">
          <span className="ro-grid" />
          <span className="ro-scan" />
          <div className="ro-radar"><span className="ro-ring" /><span className="ro-ring is-2" /><span className="ro-ring is-3" /><span className="ro-sweep" /></div>
          <span className="ro-bracket is-tl" /><span className="ro-bracket is-tr" /><span className="ro-bracket is-bl" /><span className="ro-bracket is-br" />
          <span className="ro-flash" />
        </div>
      )}

      <div className="ro-lockup" data-testid="raptor-opening-lockup">
        <div className="ro-wing-box">
          <img src="/brand/raptor-mark.png" alt="" className="ro-wing" />
          {look === 'ascent' && <span aria-hidden className="ro-glint" />}
          {look === 'flight' && <span aria-hidden className="ro-tipflare" />}
        </div>
        <div className="ro-words">
          <img src="/brand/raptor-words-light.png" alt="Raptor by Bredell Ferreira" className="ro-words-img" />
          {look === 'flight' && <span aria-hidden className="ro-sweep-light" />}
        </div>
      </div>
      {look === 'lock' && <p aria-hidden className="ro-readout">Raptor online</p>}
    </div>
  )
}
