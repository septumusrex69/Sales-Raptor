import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
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
 * Firefox has no such API. There the button says so and names the operating system's own
 * dictation instead, rather than sitting there doing nothing.
 */
export function DictateButton({ onText, size = 'normal' }: {
  /** Called with each finished phrase. Join it on with appendSpeech. */
  onText: (text: string) => void
  size?: 'normal' | 'small'
}) {
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [lang, setLang] = useState(storedLanguage)
  const recognition = useRef<SpeechRecognitionLike | null>(null)

  const Ctor = speechRecognition()

  const stop = useCallback(() => {
    recognition.current?.stop()
    recognition.current = null
    setListening(false)
    setInterim('')
  }, [])

  // Stop listening if the box is closed mid-sentence: a recogniser left running holds the
  // microphone open, and the browser shows a recording dot over a page nobody is on.
  useEffect(() => () => { recognition.current?.abort() }, [])

  const start = useCallback(() => {
    if (!Ctor) return
    setError(null)
    const r = new Ctor()
    r.lang = lang
    // Keep going between sentences rather than stopping at the first pause — a collector
    // describing a call talks for thirty seconds with gaps in it.
    r.continuous = true
    // Show the words as they are heard. Without this the box sits empty while somebody talks,
    // and they stop and start again thinking it is broken.
    r.interimResults = true
    r.maxAlternatives = 1

    r.onresult = (event) => {
      let pending = ''
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i]
        const said = result[0].transcript
        if (result.isFinal) onText(said)
        else pending += said
      }
      setInterim(pending)
    }
    r.onerror = (event) => {
      const message = dictationError(event.error)
      if (message) setError(message)
      setListening(false)
    }
    r.onend = () => { setListening(false); setInterim('') }

    try {
      r.start()
      recognition.current = r
      setListening(true)
    } catch {
      setError('Dictation could not start. Try again.')
    }
  }, [Ctor, lang, onText])

  if (!Ctor) {
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
        onClick={() => (listening ? stop() : start())}
        title={listening ? 'Stop listening' : `Talk instead of typing (${lang})`}
        className={`inline-flex items-center gap-1.5 rounded-lg border text-xs font-medium transition-colors ${pad} ${
          listening
            ? 'border-[var(--c-rust)] bg-[var(--tint-rust)] text-[var(--c-rust)]'
            : 'border-slate-200 text-slate-600 hover:bg-slate-50'
        }`}
      >
        {listening ? <Square size={12} className="animate-pulse" /> : <Mic size={12} />}
        {listening ? 'Listening…' : 'Dictate'}
      </button>

      {/*
        Only once somebody is actually dictating. A language dropdown sitting beside every note
        box on the off-chance is clutter; the moment it matters is when the words coming back are
        in the wrong language.
      */}
      {listening && DICTATION_LANGUAGES.length > 1 && (
        <select
          value={lang}
          onChange={(e) => {
            // The recogniser's language cannot change mid-run, so it is stopped and restarted.
            const next = e.target.value
            setLang(next); rememberLanguage(next)
            stop()
          }}
          className="text-[11px] rounded border border-slate-200 bg-white px-1 py-0.5"
          title="Stops listening so you can start again in this language"
        >
          {DICTATION_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
        </select>
      )}

      {/* The words so far, before they are final — proof it is hearing you. */}
      {interim && <span className="text-[11px] text-slate-400 italic truncate max-w-[16rem]">{interim}</span>}
      {error && <span className="text-[11px] text-[var(--c-rust)]">{error}</span>}
    </span>
  )
}

/**
 * A text box you can talk into.
 *
 * Wraps any input or textarea and puts the microphone under it. The value stays the caller's —
 * this only ever hands back "here is what was said", joined on with appendSpeech so the result
 * reads as sentences rather than as a transcript.
 */
export function Dictatable({ value, onChange, children, label }: {
  value: string
  onChange: (next: string) => void
  /** The input or textarea itself. */
  children: ReactNode
  /** Shown beside the microphone, e.g. "or type it". */
  label?: string
}) {
  return (
    <div>
      {children}
      <div className="flex flex-wrap items-center gap-2 mt-1.5">
        <DictateButton onText={(said) => onChange(appendSpeech(value, said))} size="small" />
        {label && <span className="text-[11px] text-slate-400">{label}</span>}
      </div>
    </div>
  )
}
