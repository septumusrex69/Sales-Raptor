const SOUND_KEY = 'crm.celebrationSound'

export function celebrationSoundEnabled(): boolean {
  try {
    return window.localStorage.getItem(SOUND_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setCelebrationSoundEnabled(on: boolean) {
  try {
    window.localStorage.setItem(SOUND_KEY, on ? 'on' : 'off')
  } catch {
    // Storage blocked. The preference just won't survive the session.
  }
}

/**
 * A short rising flourish, synthesised rather than shipped as a file.
 *
 * Generated because a few lines of oscillator beat a binary asset nobody can tune: the pitch,
 * length and warmth are all readable here, and there is no extra request on a page load that
 * will never need it.
 *
 * Only milestones make a sound. A chime on every closed deal, across a floor of fifty people,
 * is a sound everybody has muted by the end of the week — and then the milestone has no way
 * left to announce itself.
 */
export function playCelebrationChime() {
  if (!celebrationSoundEnabled()) return
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    const ctx = new Ctor()
    const start = ctx.currentTime

    // A major triad walked upward — warm rather than triumphant, which wears better on the
    // twentieth hearing than a fanfare does.
    const notes = [523.25, 659.25, 783.99, 1046.5]
    notes.forEach((freq, i) => {
      const at = start + i * 0.09
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      // Quick in, long out: a struck note rather than a held one.
      gain.gain.setValueAtTime(0, at)
      gain.gain.linearRampToValueAtTime(0.16, at + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.85)
      osc.connect(gain).connect(ctx.destination)
      osc.start(at)
      osc.stop(at + 0.9)
    })

    // Release the hardware once it has finished rather than leaving contexts open.
    window.setTimeout(() => void ctx.close().catch(() => {}), 1600)
  } catch {
    // Audio is a nicety. If the browser refuses, the celebration is still on screen.
  }
}
