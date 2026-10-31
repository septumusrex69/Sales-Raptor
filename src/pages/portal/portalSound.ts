/**
 * THE PORTAL'S START-UP SOUND (S16, Raptor · Handover 15). Stephan, of the screen a client waits on while the
 * portal opens: "have it make a cool sound. Like PlayStation 2 vibes login." So: a deep swell out of nothing, a
 * rising wash, and then a crystal chord that rings out through an echo -- drawn by the browser (Web Audio), no
 * file to fetch, about three seconds, timed to the splash: the chord lands as the BF monogram flares.
 *
 * A BROWSER PLAYS SOUND ONLY AFTER A TAP. Safari above all: an AudioContext must be started INSIDE the press. So
 * the sign-in buttons call primeSplashAudio() as they are pressed, and the splash plays through that context a
 * moment later. Opened from a saved session (no press), it tries, and if the browser says no it stays silent --
 * the animation never waits for the sound.
 */
let ctx: AudioContext | null = null

export function context(): AudioContext | null {
  if (ctx) return ctx
  try {
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    ctx = C ? new C() : null
  } catch { ctx = null }
  return ctx
}

/** Call from inside a click or submit: it is the press that lets the sound play later. */
export function primeSplashAudio(): void {
  const c = context()
  if (c && c.state === 'suspended') void c.resume().catch(() => {})
}

/**
 * The sound itself, one per opening (PortalSplash's `variant`). Returns false when the browser would not let it play.
 */
export function playSplashSound(variant: 'circle' | 'coast' | 'towers' | 'arcs' = 'circle'): boolean {
  const c = context()
  if (!c) return false
  if (c.state === 'suspended') void c.resume().catch(() => {})
  if (c.state !== 'running') return false
  if (variant === 'coast') return coastSound(c)
  if (variant === 'towers') return towersSound(c)
  /* The arcs play the towers' sound -- Stephan, 30 Oct: "I like the sound of the ... third video". */
  if (variant === 'arcs') return towersSound(c)
  const t0 = c.currentTime + 0.05
  const master = c.createGain()
  master.gain.setValueAtTime(0.0001, t0)
  master.gain.exponentialRampToValueAtTime(0.55, t0 + 0.4)
  master.gain.setValueAtTime(0.55, t0 + 3.0)
  master.gain.exponentialRampToValueAtTime(0.0001, t0 + 4.2)
  master.connect(c.destination)

  /* An echo for the shimmer: a feedback delay, darkened a little each time round. */
  const delay = c.createDelay(1)
  delay.delayTime.value = 0.23
  const feedback = c.createGain()
  feedback.gain.value = 0.38
  const tone = c.createBiquadFilter()
  tone.type = 'lowpass'
  tone.frequency.value = 3800
  delay.connect(tone); tone.connect(feedback); feedback.connect(delay); tone.connect(master)

  /* 1. THE DEEP SWELL: two low sines a fifth apart, slowly in, through a closing filter. */
  const low = c.createBiquadFilter()
  low.type = 'lowpass'
  low.frequency.setValueAtTime(180, t0)
  low.frequency.linearRampToValueAtTime(600, t0 + 1.3)
  low.frequency.exponentialRampToValueAtTime(120, t0 + 3.6)
  const lowGain = c.createGain()
  lowGain.gain.setValueAtTime(0.0001, t0)
  lowGain.gain.exponentialRampToValueAtTime(0.32, t0 + 1.2)
  lowGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 3.8)
  low.connect(lowGain); lowGain.connect(master)
  for (const [f, detune] of [[55, -6], [82.41, 5], [110, 0]] as const) {
    const o = c.createOscillator()
    o.type = f === 110 ? 'triangle' : 'sine'
    o.frequency.value = f
    o.detune.value = detune
    o.connect(low)
    o.start(t0); o.stop(t0 + 4)
  }

  /* 2. THE RISING WASH: noise through a band that sweeps up, gone just as the chord lands. */
  const noise = c.createBuffer(1, Math.floor(c.sampleRate * 1.6), c.sampleRate)
  const data = noise.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  const src = c.createBufferSource()
  src.buffer = noise
  const band = c.createBiquadFilter()
  band.type = 'bandpass'
  band.Q.value = 1.4
  band.frequency.setValueAtTime(300, t0 + 0.1)
  band.frequency.exponentialRampToValueAtTime(5200, t0 + 1.45)
  const washGain = c.createGain()
  washGain.gain.setValueAtTime(0.0001, t0 + 0.1)
  washGain.gain.exponentialRampToValueAtTime(0.09, t0 + 1.3)
  washGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.55)
  src.connect(band); band.connect(washGain); washGain.connect(master)
  src.start(t0 + 0.1); src.stop(t0 + 1.7)

  /* 3. THE CRYSTAL CHORD at 1.4 s: E major in high bells, each with a quick strike and a long ring, into the echo. */
  const strike = t0 + 1.4
  const bells: [number, number][] = [[329.63, 0.13], [659.25, 0.12], [987.77, 0.09], [1318.51, 0.07], [1661.22, 0.05], [2637.02, 0.025]]
  for (const [f, level] of bells) {
    for (const detune of [-4, 4]) {
      const o = c.createOscillator()
      o.type = 'sine'
      o.frequency.value = f
      o.detune.value = detune
      const g = c.createGain()
      g.gain.setValueAtTime(0.0001, strike)
      g.gain.exponentialRampToValueAtTime(level, strike + 0.012)
      g.gain.exponentialRampToValueAtTime(0.0001, strike + 2.6)
      o.connect(g); g.connect(master); g.connect(delay)
      o.start(strike); o.stop(strike + 2.7)
    }
  }
  return true
}

/* The master level and the echo every opening shares (Raptor's own openings too, raptorSound.ts): in over `attack`, held, out by `end`. */
export function bus(c: AudioContext, t0: number, end: number, peak = 0.55) {
  const master = c.createGain()
  master.gain.setValueAtTime(0.0001, t0)
  master.gain.exponentialRampToValueAtTime(peak, t0 + 0.3)
  master.gain.setValueAtTime(peak, end - 1.2)
  master.gain.exponentialRampToValueAtTime(0.0001, end)
  master.connect(c.destination)
  const delay = c.createDelay(1)
  delay.delayTime.value = 0.27
  const feedback = c.createGain()
  feedback.gain.value = 0.4
  const tone = c.createBiquadFilter()
  tone.type = 'lowpass'
  tone.frequency.value = 3200
  delay.connect(tone); tone.connect(feedback); feedback.connect(delay); tone.connect(master)
  return { master, delay }
}

/* One struck note: a quick attack and a long ring, into the master and the echo. */
export function strike(c: AudioContext, out: { master: GainNode; delay: DelayNode }, f: number, at: number, level: number, ring: number, type: OscillatorType = 'sine') {
  for (const detune of [-4, 4]) {
    const o = c.createOscillator()
    o.type = type
    o.frequency.value = f
    o.detune.value = detune
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, at)
    g.gain.exponentialRampToValueAtTime(level, at + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, at + ring)
    o.connect(g); g.connect(out.master); g.connect(out.delay)
    o.start(at); o.stop(at + ring + 0.1)
  }
}

/*
 * THE COAST: the sea breathing in twice (noise through a slow low-pass), a warm A-major pad under it, and as the
 * monogram clears the horizon a soft piano-like A and E that ring out over the water.
 */
function coastSound(c: AudioContext): boolean {
  const t0 = c.currentTime + 0.05
  const out = bus(c, t0, t0 + 4.4, 0.5)
  const noise = c.createBuffer(1, Math.floor(c.sampleRate * 4), c.sampleRate)
  const data = noise.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  const src = c.createBufferSource()
  src.buffer = noise
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  const swell = c.createGain()
  for (const [at, len] of [[0, 1.6], [1.5, 2.4]] as const) {
    lp.frequency.setValueAtTime(250, t0 + at)
    lp.frequency.linearRampToValueAtTime(1400, t0 + at + len * 0.45)
    lp.frequency.linearRampToValueAtTime(300, t0 + at + len)
    swell.gain.setValueAtTime(0.02, t0 + at)
    swell.gain.linearRampToValueAtTime(0.16, t0 + at + len * 0.45)
    swell.gain.linearRampToValueAtTime(0.03, t0 + at + len)
  }
  src.connect(lp); lp.connect(swell); swell.connect(out.master)
  src.start(t0); src.stop(t0 + 4)

  const pad = c.createGain()
  pad.gain.setValueAtTime(0.0001, t0)
  pad.gain.exponentialRampToValueAtTime(0.07, t0 + 1.4)
  pad.gain.exponentialRampToValueAtTime(0.0001, t0 + 4.2)
  pad.connect(out.master)
  for (const f of [110, 164.81, 220, 277.18]) {
    const o = c.createOscillator()
    o.type = 'triangle'
    o.frequency.value = f
    o.connect(pad)
    o.start(t0); o.stop(t0 + 4.3)
  }
  strike(c, out, 880, t0 + 1.25, 0.11, 2.6, 'triangle')
  strike(c, out, 1318.51, t0 + 1.55, 0.08, 2.4, 'triangle')
  strike(c, out, 1760, t0 + 1.95, 0.05, 2.0)
  return true
}

/*
 * DEEP, SOFT, NOTHING HIGH (30 Oct). Stephan, after hearing them: "It sounds like a video game. Just epic, deeper,
 * softer, soothing sounds, not video gamey ... it's got this deep, like, zzz thing ... with a deep undertone ... But
 * the high pitched things is too high pitched." So the openings he plays now are built only from these: a dark,
 * long echo; a warm pad; a soft cinematic boom with no click; the low detuned "zzz" he liked, swept open only as far
 * as a warm midrange; and felt-piano notes that never go above A4. No bells, no chimes, no square waves.
 */
export function softBus(c: AudioContext, t0: number, end: number, peak = 0.6) {
  const master = c.createGain()
  master.gain.setValueAtTime(0.0001, t0)
  master.gain.exponentialRampToValueAtTime(peak, t0 + 0.5)
  master.gain.setValueAtTime(peak, end - 1.6)
  master.gain.exponentialRampToValueAtTime(0.0001, end)
  /* A gentle low-pass over everything: the last word on "nothing high". */
  const air = c.createBiquadFilter()
  air.type = 'lowpass'
  air.frequency.value = 2400
  master.connect(air); air.connect(c.destination)
  const delay = c.createDelay(1.5)
  delay.delayTime.value = 0.42
  const feedback = c.createGain()
  feedback.gain.value = 0.45
  const tone = c.createBiquadFilter()
  tone.type = 'lowpass'
  tone.frequency.value = 1100
  delay.connect(tone); tone.connect(feedback); feedback.connect(delay); tone.connect(master)
  return { master, delay }
}
type Out = { master: GainNode; delay: DelayNode }

/** A warm pad: sines and soft triangles, slow in and slow out, through a closing low-pass. */
export function pad(c: AudioContext, out: Out, at: number, len: number, freqs: number[], level = 0.07, climb = 1) {
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.setValueAtTime(260, at)
  lp.frequency.linearRampToValueAtTime(900, at + len * 0.45)
  lp.frequency.linearRampToValueAtTime(320, at + len)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(level, at + Math.min(1.4, len * 0.4))
  g.gain.exponentialRampToValueAtTime(0.0001, at + len)
  lp.connect(g); g.connect(out.master); g.connect(out.delay)
  freqs.forEach((hz, i) => {
    for (const det of [-5, 5]) {
      const o = c.createOscillator()
      o.type = i % 2 ? 'triangle' : 'sine'
      o.frequency.setValueAtTime(hz * climb, at)
      if (climb !== 1) o.frequency.exponentialRampToValueAtTime(hz, at + len * 0.4)
      o.detune.value = det
      o.connect(lp)
      o.start(at); o.stop(at + len + 0.1)
    }
  })
}

/** A soft cinematic boom: a low sine sinking slowly, with a breath of low noise under it. No click. */
export function boom(c: AudioContext, out: Out, at: number, level = 0.5) {
  const o = c.createOscillator()
  o.type = 'sine'
  o.frequency.setValueAtTime(92, at)
  o.frequency.exponentialRampToValueAtTime(42, at + 2.2)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(level, at + 0.06)
  g.gain.exponentialRampToValueAtTime(0.0001, at + 2.6)
  o.connect(g); g.connect(out.master)
  o.start(at); o.stop(at + 2.7)
  const n = c.createBuffer(1, Math.floor(c.sampleRate * 1.6), c.sampleRate)
  const d = n.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  const src = c.createBufferSource()
  src.buffer = n
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.setValueAtTime(420, at)
  lp.frequency.exponentialRampToValueAtTime(90, at + 1.4)
  const ng = c.createGain()
  ng.gain.setValueAtTime(0.0001, at)
  ng.gain.exponentialRampToValueAtTime(level * 0.35, at + 0.05)
  ng.gain.exponentialRampToValueAtTime(0.0001, at + 1.5)
  src.connect(lp); lp.connect(ng); ng.connect(out.master)
  src.start(at); src.stop(at + 1.6)
}

/** The deep "zzz" Stephan liked: detuned low saws, swept open only to a warm midrange, slowly. */
export function lowChord(c: AudioContext, out: Out, at: number, freqs: number[], level = 0.06, len = 3) {
  const f = c.createBiquadFilter()
  f.type = 'lowpass'
  f.Q.value = 2
  f.frequency.setValueAtTime(140, at)
  f.frequency.exponentialRampToValueAtTime(1400, at + 1.1)
  f.frequency.exponentialRampToValueAtTime(260, at + len)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(level, at + 0.35)
  g.gain.exponentialRampToValueAtTime(0.0001, at + len)
  f.connect(g); g.connect(out.master); g.connect(out.delay)
  for (const hz of freqs) for (const det of [-11, 0, 11]) {
    const o = c.createOscillator()
    o.type = 'sawtooth'
    o.frequency.value = hz
    o.detune.value = det
    o.connect(f)
    o.start(at); o.stop(at + len + 0.1)
  }
}

/** A felt-piano note, low and round: a sine and a quiet triangle an octave up, through a low-pass. */
export function warm(c: AudioContext, out: Out, f: number, at: number, level = 0.08, ring = 2.6) {
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 1300
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(level, at + 0.03)
  g.gain.exponentialRampToValueAtTime(0.0001, at + ring)
  lp.connect(g); g.connect(out.master); g.connect(out.delay)
  for (const [hz, type, lv] of [[f, 'sine', 1], [f * 2, 'triangle', 0.25]] as const) {
    const o = c.createOscillator()
    const og = c.createGain()
    o.type = type
    o.frequency.value = hz
    og.gain.value = lv
    o.connect(og); og.connect(lp)
    o.start(at); o.stop(at + ring + 0.1)
  }
}

/** Air moving: noise through a low-pass that sweeps, for a rush that is felt rather than heard. */
export function rush(c: AudioContext, out: Out, at: number, len: number, from: number, to: number, level = 0.14) {
  const n = c.createBuffer(1, Math.floor(c.sampleRate * len), c.sampleRate)
  const d = n.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  const src = c.createBufferSource()
  src.buffer = n
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.setValueAtTime(from, at)
  lp.frequency.exponentialRampToValueAtTime(to, at + len)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(level, at + len * 0.7)
  g.gain.exponentialRampToValueAtTime(0.0001, at + len)
  src.connect(lp); lp.connect(g); g.connect(out.master)
  src.start(at); src.stop(at + len)
}

/*
 * THE TOWERS -- the portal's (Stephan's pick): the towers rise on a deep swell and a slow rush of air, the shock-ring
 * lands as a soft boom with the low "zzz" opening under it, and the badge settles on two warm low notes.
 */
function towersSound(c: AudioContext): boolean {
  const t0 = c.currentTime + 0.05
  const out = softBus(c, t0, t0 + 4.8)
  pad(c, out, t0, 4.4, [82.41, 110, 164.81, 220], 0.06, 0.94)
  rush(c, out, t0 + 0.1, 1.25, 260, 1300, 0.12)
  const hit = t0 + 1.35
  boom(c, out, hit, 0.5)
  lowChord(c, out, hit, [164.81, 207.65, 246.94, 329.63], 0.05, 3.2)
  warm(c, out, 329.63, hit + 0.35, 0.07, 2.8)
  warm(c, out, 246.94, hit + 0.75, 0.06, 2.6)
  return true
}
