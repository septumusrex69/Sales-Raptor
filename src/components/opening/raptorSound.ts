import { bus, context, strike } from '../../pages/portal/portalSound'
import type { RaptorVariant } from './RaptorOpening'

/**
 * THE SOUND OF RAPTOR'S OPENINGS (S16), drawn by the browser like the portal's (portalSound.ts, whose master bus,
 * echo and struck note these share), and timed to RaptorOpening's clock: the impact at ~1.25 s. As there, a browser
 * plays sound only after a press -- the Sign In button primes it (primeSplashAudio) -- and a refusal is silence,
 * never a wait.
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

function noise(c: AudioContext, seconds: number): AudioBufferSourceNode {
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * seconds), c.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  const src = c.createBufferSource()
  src.buffer = buf
  return src
}

/* A deep hit: a sine falling from `from` to `to` Hz. */
function thump(c: AudioContext, out: GainNode, at: number, from = 130, to = 36, level = 0.6) {
  const o = c.createOscillator()
  o.type = 'sine'
  o.frequency.setValueAtTime(from, at)
  o.frequency.exponentialRampToValueAtTime(to, at + 0.5)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(level, at + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.9)
  o.connect(g); g.connect(out)
  o.start(at); o.stop(at + 1)
}

/* A chord of detuned saws swept open through a filter -- the "arrival". */
function sweptChord(c: AudioContext, out: { master: GainNode; delay: DelayNode }, at: number, freqs: number[], level = 0.08) {
  const f = c.createBiquadFilter()
  f.type = 'lowpass'
  f.Q.value = 5
  f.frequency.setValueAtTime(300, at)
  f.frequency.exponentialRampToValueAtTime(4000, at + 0.7)
  f.frequency.exponentialRampToValueAtTime(800, at + 2.6)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(level, at + 0.04)
  g.gain.exponentialRampToValueAtTime(0.0001, at + 2.7)
  f.connect(g); g.connect(out.master); g.connect(out.delay)
  for (const hz of freqs) for (const det of [-9, 9]) {
    const o = c.createOscillator()
    o.type = 'sawtooth'
    o.frequency.value = hz
    o.detune.value = det
    o.connect(f)
    o.start(at); o.stop(at + 2.8)
  }
}

/* FLIGHT: air tearing past (noise swept high to low and loud), the strike -- a thump and a bright D-major arrival. */
function flight(c: AudioContext, t0: number) {
  const out = bus(c, t0, t0 + 4.2, 0.5)
  const src = noise(c, 1.5)
  const band = c.createBiquadFilter()
  band.type = 'bandpass'
  band.Q.value = 0.9
  band.frequency.setValueAtTime(5000, t0)
  band.frequency.exponentialRampToValueAtTime(400, t0 + 1.25)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(0.22, t0 + 1.05)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.35)
  src.connect(band); band.connect(g); g.connect(out.master)
  src.start(t0); src.stop(t0 + 1.5)
  const hit = t0 + 1.2
  thump(c, out.master, hit)
  sweptChord(c, out, hit, [146.83, 220, 293.66, 369.99, 440])
  strike(c, out, 1174.66, hit + 0.05, 0.05, 2.2)
}

/* ASCENT: wind, a pad that climbs, and as the light runs along the wing, a high chime of three. */
function ascent(c: AudioContext, t0: number) {
  const out = bus(c, t0, t0 + 4.4, 0.5)
  const src = noise(c, 3.6)
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.setValueAtTime(300, t0)
  lp.frequency.linearRampToValueAtTime(1600, t0 + 1.3)
  lp.frequency.linearRampToValueAtTime(400, t0 + 3.4)
  const w = c.createGain()
  w.gain.setValueAtTime(0.0001, t0)
  w.gain.exponentialRampToValueAtTime(0.12, t0 + 1.0)
  w.gain.exponentialRampToValueAtTime(0.0001, t0 + 3.5)
  src.connect(lp); lp.connect(w); w.connect(out.master)
  src.start(t0); src.stop(t0 + 3.6)
  const pad = c.createGain()
  pad.gain.setValueAtTime(0.0001, t0)
  pad.gain.exponentialRampToValueAtTime(0.06, t0 + 1.3)
  pad.gain.exponentialRampToValueAtTime(0.0001, t0 + 4.2)
  pad.connect(out.master)
  for (const hz of [130.81, 196, 261.63, 329.63]) {
    const o = c.createOscillator()
    o.type = 'triangle'
    o.frequency.setValueAtTime(hz * 0.75, t0)
    o.frequency.exponentialRampToValueAtTime(hz, t0 + 1.3)
    o.connect(pad)
    o.start(t0); o.stop(t0 + 4.3)
  }
  strike(c, out, 1318.51, t0 + 1.3, 0.08, 2.4)
  strike(c, out, 1975.53, t0 + 1.5, 0.06, 2.2)
  strike(c, out, 2637.02, t0 + 1.7, 0.04, 2.0)
}

/* LOCK: radar pings, the lock-on beeps climbing, then the hit and the chord -- and a last double blip, "online". */
function lock(c: AudioContext, t0: number) {
  const out = bus(c, t0, t0 + 4.2, 0.5)
  for (let i = 0; i < 4; i++) strike(c, out, 1567.98, t0 + 0.1 + i * 0.27, 0.05, 0.35)
  ;[880, 1046.5, 1318.51, 1760].forEach((hz, i) => strike(c, out, hz, t0 + 0.95 + i * 0.07, 0.04, 0.12, 'square'))
  const hit = t0 + 1.25
  thump(c, out.master, hit, 110, 32, 0.65)
  sweptChord(c, out, hit, [110, 164.81, 220, 277.18, 329.63], 0.07)
  strike(c, out, 2093, t0 + 2.5, 0.035, 0.15, 'square')
  strike(c, out, 2637.02, t0 + 2.6, 0.035, 0.2, 'square')
}
