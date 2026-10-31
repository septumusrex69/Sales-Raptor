import { context, softBus } from '../../pages/portal/portalSound'
import type { RaptorVariant } from './RaptorOpening'

/**
 * THE SOUND OF RAPTOR'S OPENINGS (S16), drawn by the browser and timed to RaptorOpening's clock: the arrival at
 * ~1.25 s. A browser plays sound only after a press -- the Sign In button primes it (primeSplashAudio) -- and a
 * refusal is silence, never a wait.
 *
 * RAPTOR'S OWN SOUND, NOT THE PORTAL'S (30 Oct). Stephan, of the first set: "It sounds like a video game ... deeper,
 * softer, soothing ... the high pitched things is too high pitched"; then, of the second, which had borrowed the
 * portal's pad and low "zzz": "it looks too much like Bredell Ferreira's ... it can have like other type of sounds,
 * make something different." So Raptor's is the mountain and the bird: wind over a ridge, WINGBEATS (a low, soft
 * push of air), DEEP DRUMS, and a warm, low HORN -- none of which the portal uses. Only the dark echo (softBus) is
 * shared, because that is the room, not the instrument. Nothing high: the horn is filtered under 1 kHz, and the body
 * sits about 90-330 Hz -- the drums tuned near 100 Hz -- as low as an iPad's speakers will still play.
 */
export function playRaptorSound(variant: RaptorVariant): boolean {
  const c = context()
  if (!c) return false
  if (c.state === 'suspended') void c.resume().catch(() => {})
  if (c.state !== 'running') return false
  const t0 = c.currentTime + 0.05
  if (variant === 'dive') dive(c, t0)
  else if (variant === 'summit') summit(c, t0)
  else lock(c, t0)
  return true
}
type Out = { master: GainNode; delay: DelayNode }

function noiseSource(c: AudioContext, seconds: number): AudioBufferSourceNode {
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * seconds), c.sampleRate)
  const d = buf.getChannelData(0)
  /* Brown noise -- each sample a step from the last -- is the low, soft roar of wind, not white hiss. */
  let last = 0
  for (let i = 0; i < d.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5 }
  const src = c.createBufferSource()
  src.buffer = buf
  return src
}

/** Wind over a ridge: brown noise through a slowly wandering band. */
function wind(c: AudioContext, out: Out, at: number, len: number, level = 0.5) {
  const src = noiseSource(c, len)
  const band = c.createBiquadFilter()
  band.type = 'bandpass'
  band.Q.value = 0.7
  band.frequency.setValueAtTime(380, at)
  band.frequency.linearRampToValueAtTime(720, at + len * 0.4)
  band.frequency.linearRampToValueAtTime(420, at + len)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(level, at + len * 0.35)
  g.gain.exponentialRampToValueAtTime(0.0001, at + len)
  src.connect(band); band.connect(g); g.connect(out.master)
  src.start(at); src.stop(at + len)
}

/** One wingbeat: a short, soft push of low air -- swelling in and falling away, like a big wing taking a stroke. */
function wingbeat(c: AudioContext, out: Out, at: number, level = 0.6) {
  const src = noiseSource(c, 0.5)
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.setValueAtTime(260, at)
  lp.frequency.exponentialRampToValueAtTime(1000, at + 0.12)
  lp.frequency.exponentialRampToValueAtTime(220, at + 0.42)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(level, at + 0.1)
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.45)
  src.connect(lp); lp.connect(g); g.connect(out.master)
  src.start(at); src.stop(at + 0.5)
}

/** A deep drum: a tuned skin (a sine dropping a fifth) with a soft felt beater (a breath of low noise). */
function drum(c: AudioContext, out: Out, at: number, pitch = 98, level = 0.5) {
  const o = c.createOscillator()
  o.type = 'sine'
  o.frequency.setValueAtTime(pitch * 1.5, at)
  o.frequency.exponentialRampToValueAtTime(pitch, at + 0.18)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(level, at + 0.012)
  g.gain.exponentialRampToValueAtTime(0.0001, at + 1.6)
  o.connect(g); g.connect(out.master); g.connect(out.delay)
  o.start(at); o.stop(at + 1.7)
  const src = noiseSource(c, 0.2)
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 650
  const ng = c.createGain()
  ng.gain.setValueAtTime(level * 0.5, at)
  ng.gain.exponentialRampToValueAtTime(0.0001, at + 0.15)
  src.connect(lp); lp.connect(ng); ng.connect(out.master)
  src.start(at); src.stop(at + 0.2)
}

/** A low horn: a few sawtooths in unison and fifths, swelling slowly through a filter that never opens past 1 kHz. */
function horn(c: AudioContext, out: Out, at: number, len: number, freqs: number[], level = 0.06) {
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.Q.value = 1.2
  lp.frequency.setValueAtTime(220, at)
  lp.frequency.linearRampToValueAtTime(950, at + len * 0.45)
  lp.frequency.linearRampToValueAtTime(380, at + len)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(level, at + len * 0.4)
  g.gain.exponentialRampToValueAtTime(0.0001, at + len)
  lp.connect(g); g.connect(out.master); g.connect(out.delay)
  for (const hz of freqs) for (const det of [-6, 6]) {
    const o = c.createOscillator()
    o.type = 'sawtooth'
    o.frequency.value = hz
    o.detune.value = det
    /* A slow vibrato, as a player's breath has. */
    const lfo = c.createOscillator()
    const depth = c.createGain()
    lfo.frequency.value = 4.6
    depth.gain.value = 4
    lfo.connect(depth); depth.connect(o.detune)
    o.connect(lp)
    o.start(at); o.stop(at + len + 0.1)
    lfo.start(at); lfo.stop(at + len + 0.1)
  }
}

/* LOCK-ON: wind high on the ridge, a drum that quickens as the brackets close -- four strokes, closer each time --
   the lock as two drums together and the horn rising, and one wingbeat as the wing appears in the sights. */
function lock(c: AudioContext, t0: number) {
  const out = softBus(c, t0, t0 + 5, 0.55)
  wind(c, out, t0, 4.2, 0.45)
  ;[0.1, 0.55, 0.88, 1.08].forEach((dt, i) => drum(c, out, t0 + dt, 110, 0.22 + i * 0.06))
  const hit = t0 + 1.25
  drum(c, out, hit, 92, 0.55)
  drum(c, out, hit + 0.02, 138, 0.3)
  horn(c, out, hit, 3.3, [146.83, 220, 293.66], 0.05)
  wingbeat(c, out, hit + 0.05, 0.55)
}

/* DIVE: three wingbeats climbing, then the fold -- a long rush of air as it stoops -- the strike as a deep drum, the
   horn under the feathers, and one last beat as it settles. */
function dive(c: AudioContext, t0: number) {
  const out = softBus(c, t0, t0 + 5, 0.55)
  wingbeat(c, out, t0 + 0.0, 0.5)
  wingbeat(c, out, t0 + 0.32, 0.55)
  wingbeat(c, out, t0 + 0.6, 0.6)
  wind(c, out, t0 + 0.6, 1.0, 0.8)
  const hit = t0 + 1.2
  drum(c, out, hit, 92, 0.6)
  horn(c, out, hit + 0.1, 3.2, [164.81, 246.94, 329.63], 0.05)
  wingbeat(c, out, hit + 0.9, 0.4)
}

/* SUMMIT: the wind on the peak in the dark, the horn rising with the sun, a slow beat of the wing as it glides
   across, and two drums, far off, as the name settles. */
function summit(c: AudioContext, t0: number) {
  const out = softBus(c, t0, t0 + 5.2, 0.6)
  wind(c, out, t0, 4.6, 0.5)
  horn(c, out, t0 + 0.3, 4.2, [130.81, 196, 261.63], 0.055)
  wingbeat(c, out, t0 + 0.5, 0.45)
  wingbeat(c, out, t0 + 1.05, 0.5)
  drum(c, out, t0 + 1.6, 98, 0.45)
  drum(c, out, t0 + 2.1, 98, 0.32)
}
