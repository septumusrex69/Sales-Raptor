import { useCallback, useEffect, useRef, useState } from 'react'
import { Mic, Square } from 'lucide-react'
import {
  appendSpeech, dictationError, speechRecognition, storedLanguage, rememberLanguage,
  DICTATION_LANGUAGES, NO_DICTATION_HELP, type SpeechRecognitionLike,
} from '../../lib/dictation.ts'

/**
 * A microphone on a text box.
 *
 * Uses the speech recognition built into the browser: free, no account, no key, no supplier, and
 * the same button on every machine — which is the point. An iPad has dictation on its keyboard
 * and a Mac has it under fn-fn, but they are all different and half the firm will never find
 * them. One button in Raptor is one thing to teach.
 *
 * WHAT IT DOES NOT DO is send anything anywhere of ours. Chrome and Safari do the recognising
 * themselves, and the words arrive as text. Nothing is stored, nothing is uploaded by us, and
 * there is no bill.
 *
 * TWO THINGS HERE ARE NOT OBVIOUS AND BOTH CAME FROM USING IT.
 *
 * THE WORDS GO IN THE BOX, not beside the button. They used to appear as grey text next to
 * "Listening…", which meant watching one place while the thing you were writing sat empty
 * somewhere else. Now the box fills as you talk, exactly as if you were typing into it, and the
 * grey tail at the end is the phrase the recogniser has not finished thinking about.
 *
 * AND IT DOES NOT STOP WHEN YOU PAUSE. The browser ends a session of its own accord after a few
 * seconds of silence — which is fine for a search box and useless for somebody describing a
 * phone call, where thinking mid-sentence is the normal case. It restarts itself, silently, for
 * as long as the button says Listening. That is the difference between dictating a note and
 * dictating the first sentence of one.
 */
export function DictateButton({ value, onChange, size = 'normal' }: {
  /** The field's current text. Needed so speech can be joined onto the end of it. */
  value: string
  /** Called with the field's new text, live, as the words arrive. */
  onChange: (next: string) => void
  size?: 'normal' | 'small'
}) {
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lang, setLang] = useState(storedLanguage)

  const recognition = useRef<SpeechRecognitionLike | null>(null)
  /** Still wanted? Cleared by the Stop button, and by an error there is no point retrying. */
  const wanted = useRef(false)
  /** The text as it stood before the phrase now being spoken — what interim words append to. */
  const base = useRef(value)
  /** Latest value without re-subscribing the recogniser on every keystroke. */
  const latest = useRef(value)
  latest.current = value
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const hardStop = useCallback(() => {
    wanted.current = false
    recognition.current?.stop()
    recognition.current = null
    setListening(false)
  }, [])

  /*
   * A recogniser left running holds the microphone open and the browser shows a recording dot
   * over a page nobody is on. Closing the box has to end it.
   */
  useEffect(() => () => { wanted.current = false; recognition.current?.abort() }, [])

  const begin = useCallback(() => {
    const Ctor = speechRecognition()
    if (!Ctor) return

    const r = new Ctor()
    r.lang = lang
    r.continuous = true
    r.interimResults = true
    r.maxAlternatives = 1

    r.onresult = (event) => {
      let pending = ''
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i]
        const said = result[0].transcript
        if (result.isFinal) {
          // Settled. It becomes part of the text, and the next interim builds on it.
          base.current = appendSpeech(base.current, said)
          onChangeRef.current(base.current)
        } else {
          pending += said
        }
      }
      // Shown in the box itself so there is one place to look. Joined the same way the final
      // words will be, so nothing jumps when the recogniser makes up its mind.
      if (pending.trim()) onChangeRef.current(appendSpeech(base.current, pending))
    }

    r.onerror = (event) => {
      const message = dictationError(event.error)
      if (message) setError(message)
      // No point restarting into a blocked microphone or a missing one — that would spin.
      if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(event.error)) {
        wanted.current = false
        setListening(false)
      }
    }

    /*
     * THE RESTART. Chrome ends a session after a few seconds of quiet whatever `continuous`
     * says, so a long note stopped dead the first time somebody paused to think. While the
     * button still says Listening, start again.
     *
     * The delay matters: starting immediately inside onend throws "already started" on some
     * versions, and the whole thing dies silently.
     */
    r.onend = () => {
      if (!wanted.current) { setListening(false); return }
      window.setTimeout(() => { if (wanted.current) begin() }, 250)
    }

    try {
      r.start()
      recognition.current = r
      setListening(true)
    } catch {
      wanted.current = false
      setListening(false)
      setError('Dictation could not start. Try again.')
    }
  }, [lang])

  const start = useCallback(() => {
    setError(null)
    // Anything typed by hand before pressing the button is what speech joins onto.
    base.current = latest.current
    wanted.current = true
    begin()
  }, [begin])

  if (!speechRecognition()) {
    return (
      <span className="text-[11px] text-slate-400 inline-flex items-center gap-1" title={NO_DICTATION_HELP}>
        <Mic size={12} className="opacity-40" /> not in this browser
      </span>
    )
  }

  const pad = size === 'small' ? 'px-2 py-1' : 'px-2.5 py-1.5'

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => (listening ? hardStop() : start())}
        title={listening ? 'Stop listening' : `Talk instead of typing (${lang})`}
        className={`inline-flex items-center gap-1.5 rounded-lg border text-xs font-medium transition-colors ${pad} ${
          listening
            ? 'border-[var(--c-rust)] bg-[var(--tint-rust)] text-[var(--c-rust)]'
            : 'border-slate-200 text-slate-600 hover:bg-slate-50'
        }`}
      >
        {listening ? <Square size={12} className="animate-pulse" /> : <Mic size={12} />}
        {listening ? 'Listening — tap to stop' : 'Dictate'}
      </button>

      {/*
        Only once somebody is actually dictating. A language dropdown beside every note box on
        the off-chance is clutter; the moment it matters is when the words coming back are in the
        wrong language.
      */}
      {listening && DICTATION_LANGUAGES.length > 1 && (
        <select
          value={lang}
          onChange={(e) => {
            // A recogniser's language cannot change mid-run, so it is stopped and started again.
            const next = e.target.value
            setLang(next); rememberLanguage(next)
            hardStop()
          }}
          className="text-[11px] rounded border border-slate-200 bg-white px-1 py-0.5"
          title="Stops listening so you can start again in this language"
        >
          {DICTATION_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
        </select>
      )}

      {error && <span className="text-[11px] text-[var(--c-rust)]">{error}</span>}
    </span>
  )
}
