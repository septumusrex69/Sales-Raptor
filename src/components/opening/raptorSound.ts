import { boom, context, lowChord, pad, rush, softBus, warm } from '../../pages/portal/portalSound'
import type { RaptorVariant } from './RaptorOpening'

/**
 * THE SOUND OF RAPTOR'S OPENINGS (S16), drawn by the browser and timed to RaptorOpening's clock: the arrival at
 * ~1.25 s. As in the portal, a browser plays sound only after a press -- the Sign In button primes it
 * (primeSplashAudio) -- and a refusal is silence, never a wait.
 *
 * DEEP AND SOFT, NOTHING HIGH (30 Oct). The first versions had bells, chimes, radar pings and square-wave beeps, and
 * Stephan: "It sounds like a video game. Just epic, deeper, softer, soothing sounds ... the high pitched things is too
 * high pitched." What he liked was "this deep, like, zzz thing ... with a deep undertone" -- the detuned low saws --
 * so each is now built from portalSound's soft pieces only: a pad, a slow rush of air, a boom with no click, that
 * low "zzz" opened only to a warm midrange, and felt-piano notes no higher than A4, all through a dark, long echo.
 * The body sits from about 75 to 330 Hz on purpose: lower than that an iPad's speakers do not play at all.
 */
export function playRaptorSound(variant: RaptorVariant): boolean {
  const c = context()
  if (!c) return false
  if (c.state === 'suspended') void c.resume().catch(() => {})
  if (c.state !== 'running') return false
  const t0 = c.currentTime + 0.05
  if (variant === 'ascent') ascent(c, t0)
  else if (variant === 'lock') lock(c, t0)
  else flight(c, t0)
  return true
}

/* FLIGHT: a low rush of air building as the wing comes in, the arrival as a boom with the deep D chord opening
   under it, and two warm notes as the name slides out. */
function flight(c: AudioContext, t0: number) {
  const out = softBus(c, t0, t0 + 4.8)
  rush(c, out, t0, 1.25, 1400, 220, 0.16)
  pad(c, out, t0 + 0.2, 4.2, [73.42, 110, 146.83], 0.05)
  const hit = t0 + 1.2
  boom(c, out, hit, 0.55)
  lowChord(c, out, hit, [110, 146.83, 185, 220], 0.06, 3.3)
  warm(c, out, 293.66, hit + 0.3, 0.07, 2.8)
  warm(c, out, 220, hit + 0.65, 0.06, 2.8)
}

/* ASCENT: wind low in the cloud, a pad that slowly climbs into place, the light along the wing as a gentle swell of
   the low chord, and three soft notes, low to lower, as the name comes into focus. */
function ascent(c: AudioContext, t0: number) {
  const out = softBus(c, t0, t0 + 5)
  rush(c, out, t0, 3.2, 300, 700, 0.1)
  pad(c, out, t0, 4.6, [98, 130.81, 196, 261.63], 0.07, 0.75)
  const hit = t0 + 1.3
  boom(c, out, hit, 0.35)
  lowChord(c, out, hit, [130.81, 196, 261.63, 329.63], 0.045, 3.4)
  warm(c, out, 392, hit + 0.25, 0.06, 2.8)
  warm(c, out, 329.63, hit + 0.55, 0.06, 2.8)
  warm(c, out, 261.63, hit + 0.85, 0.07, 3)
}

/* LOCK-ON: a slow low pulse, like a heartbeat, while the brackets close; the lock as the deepest boom of the three
   with the low chord under it; and one warm note, held, for "Raptor online". */
function lock(c: AudioContext, t0: number) {
  const out = softBus(c, t0, t0 + 4.8)
  for (let i = 0; i < 4; i++) {
    const at = t0 + 0.1 + i * 0.28
    const o = c.createOscillator()
    o.type = 'sine'
    o.frequency.value = 73.42
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, at)
    g.gain.exponentialRampToValueAtTime(0.18 + i * 0.05, at + 0.04)
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.25)
    o.connect(g); g.connect(out.master)
    o.start(at); o.stop(at + 0.3)
  }
  pad(c, out, t0, 4.4, [73.42, 98, 146.83], 0.05)
  const hit = t0 + 1.25
  boom(c, out, hit, 0.6)
  lowChord(c, out, hit, [123.47, 185, 246.94, 311.13], 0.055, 3.2)
  warm(c, out, 246.94, t0 + 2.5, 0.07, 2.2)
}
