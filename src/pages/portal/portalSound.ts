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

function context(): AudioContext | null {
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

/** The sound itself. Returns false when the browser would not let it play. */
export function playSplashSound(): boolean {
  const c = context()
  if (!c) return false
  if (c.state === 'suspended') void c.resume().catch(() => {})
  if (c.state !== 'running') return false
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
