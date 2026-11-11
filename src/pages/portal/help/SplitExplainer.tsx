import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from 'lucide-react'
import { rand } from '../../../lib/money'
import { SPLIT_EXAMPLES, splitPayment, type SplitInput, type SplitResult } from './splitExample'

/**
 * THE 50/50 SPLIT, TOLD LIKE A SHORT FILM (Ryno, 11 Nov · Raptor · Handover 19: "a fun and professional video
 * explaining the 50/50 allocation split to our clients and how payments are allocated").
 *
 * WHY IT IS DRAWN RATHER THAN FILMED, for now: a recorded video carries its numbers baked into the pixels, and the
 * day a figure on it disagrees with `splitExample` nobody will notice. This is the same arithmetic the "try your own
 * numbers" panel and the QA check run, drawn on the portal's own navy and gold, sharp on an iPad, nothing to host
 * or buffer. It still behaves like a video -- a play button, chapters, a progress line, pause, replay -- because that
 * is what Ryno asked for and what a client knows how to use. If a produced film arrives later, PortalHelp shows it
 * beside this rather than instead of it (HELP_VIDEO_SRC there).
 *
 * ONE PICTURE THAT CHANGES, NOT EIGHT SLIDES. The bar is the payment, end to end, the whole way through; each scene
 * only moves a boundary or reveals a slice, with a CSS transition on width. So what the client watches is the same
 * R1 000 being divided, which is the one idea the film has to land -- a sequence of separate diagrams would let them
 * think each step was a different pot of money.
 *
 * MOTION IS OPTIONAL. Nothing plays until it is pressed, and with "reduce motion" switched on the scenes still step
 * but nothing slides (motion-reduce:transition-none). The captions say everything the pictures do.
 */

interface Scene {
  kicker: string
  title: string
  caption: (r: SplitResult) => string
  seconds: number
}

const SCENES: Scene[] = [
  {
    kicker: 'Meet the payment', title: 'A debtor pays.',
    caption: (r) => `Say one of your debtors pays ${rand(r.payment)}. Here is exactly where every rand goes.`, seconds: 5,
  },
  {
    kicker: 'The 50/50 rule', title: 'Snap. Right down the middle.',
    caption: (r) => `First, the payment is split in two: ${rand(r.half)} to the fees side, ${rand(r.otherHalf)} to the capital side. The capital is your money.`, seconds: 6,
  },
  {
    kicker: 'The fees side', title: 'Fees queue up, in order.',
    caption: (r) => `The fees half pays interest first (${rand(r.toInterest)}), then this payment’s receipt fee (${rand(r.toReceiptFee)}), then the Annexure B collection fees (${rand(r.toFees)}).`, seconds: 7,
  },
  {
    kicker: 'The roll', title: 'Change left over? It rolls to capital.',
    caption: (r) => r.rolled > 0
      ? `The fees were all paid with ${rand(r.rolled)} to spare, so that rolls across to capital. Capital now gets ${rand(r.toCapital)}. The fees side never takes more than half.`
      : `The fees used their whole half this time, so nothing rolls. The fees side never takes more than half, and capital always gets at least its ${rand(r.otherHalf)}.`,
    seconds: 7,
  },
  {
    kicker: 'Our commission', title: 'Commission comes off capital only.',
    caption: (r) => `From the capital we take our commission at your agreed rate (${rand(r.commission)}) and the VAT on it (${rand(r.commissionVat)}). Never on interest, never on fees.`, seconds: 6,
  },
  {
    kicker: 'Paid over to you', title: 'And this part is yours.',
    caption: (r) => `${rand(r.toClient)} is paid over to you, and it is on your remittance advice line by line.`, seconds: 6,
  },
  {
    kicker: 'Paid to you directly?', title: 'Same split, other way round.',
    caption: () => 'If the debtor pays you instead, tell us with “Paid to you”. You keep the whole payment, and the fees and commission on it are set off against your next payover.', seconds: 7,
  },
  {
    kicker: 'That’s the 50/50', title: 'Half for fees. Half for you. Never less.',
    caption: () => 'Fees are the debtor’s to pay on top of your debt, so they never come out of your capital. Play it again, or try your own numbers below.', seconds: 6,
  },
]

const pct = (part: number, whole: number) => (whole > 0 ? `${(part / whole) * 100}%` : '0%')
const ease = 'transition-all duration-700 ease-out motion-reduce:transition-none'

/**
 * THE BAR: the whole payment, end to end. `stage` is how far the story has got -- 0 a single coin, 7 the full split.
 * Also drawn at stage 7 by the calculator, so the still picture and the film are one drawing.
 */
export function SplitBar({ r, stage, dark = true }: { r: SplitResult; stage: number; dark?: boolean }) {
  const split = stage >= 1
  const fees = stage >= 2
  const rolled = stage >= 3
  const cut = stage >= 4
  /* Before the roll each side is exactly half; after it, the boundary moves to where the fees side really stopped. */
  const feesWidth = !split ? 0 : rolled ? r.feesSide : r.half
  const capitalWidth = !split ? r.payment : rolled ? r.payment - r.feesSide : r.otherHalf
  const label = dark ? 'text-white/80' : 'text-[#46607B]'
  const seg = (w: number, of: number, bg: string, text: string, show: boolean, title: string) => (
    <div className={`h-full flex items-center justify-center overflow-hidden ${ease}`} title={title}
      style={{ width: show ? pct(w, of) : '0%', background: bg }}>
      <span className={`text-[11px] sm:text-xs font-bold whitespace-nowrap px-1 ${text}`}>{show && w / of > 0.12 ? rand(w) : ''}</span>
    </div>
  )
  return (
    <div className="w-full" data-testid="split-bar" data-stage={stage}>
      <div className={`flex h-14 sm:h-16 w-full ${split ? 'gap-1.5' : 'gap-0'} ${ease}`}>
        {/* THE FEES SIDE */}
        <div className={`h-full flex rounded-l-xl overflow-hidden ${ease} ${split ? '' : 'opacity-0'}`}
          style={{ width: pct(feesWidth, r.payment), background: fees ? 'transparent' : '#C69F54' }} data-testid="split-fees">
          {fees && <>
            {seg(r.toInterest, feesWidth || 1, '#C69F54', 'text-[#101F2C]', true, 'Interest')}
            {seg(r.toReceiptFee, feesWidth || 1, '#D9BB80', 'text-[#101F2C]', true, 'Receipt fee')}
            {seg(r.toFees, feesWidth || 1, '#ECDCB8', 'text-[#101F2C]', true, 'Annexure B fees')}
            {/* What the fees half could not spend: dashed, so it reads as room rather than money. */}
            {!rolled && r.rolled > 0 && <div className={`h-full border-2 border-dashed border-[#C69F54] ${ease}`} style={{ width: pct(r.rolled, feesWidth || 1) }} />}
          </>}
        </div>
        {/* THE CAPITAL SIDE */}
        <div className={`h-full flex overflow-hidden ${split ? 'rounded-r-xl' : 'rounded-xl'} ${ease}`}
          style={{ width: pct(capitalWidth, r.payment), background: '#97B4CC' }} data-testid="split-capital">
          {cut ? <>
            {seg(r.commission, r.toCapital, '#46607B', 'text-white', true, 'Commission')}
            {seg(r.commissionVat, r.toCapital, '#32404D', 'text-white', true, 'VAT on commission')}
            {seg(r.toClient, r.toCapital, stage >= 5 ? '#FFFFFF' : '#D5E1EB', 'text-[#101F2C]', true, 'Paid over to you')}
          </> : (
            <div className="h-full w-full flex items-center justify-center">
              <span className="text-xs sm:text-sm font-bold text-[#101F2C]">{split ? rand(capitalWidth) : rand(r.payment)}</span>
            </div>
          )}
        </div>
      </div>
      {/* THE KEY, revealed with the story. */}
      <div className={`mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] sm:text-xs ${label}`}>
        {split && !fees && <Key colour="#C69F54" text={`Fees side ${rand(r.half)}`} />}
        {fees && <Key colour="#C69F54" text={`Interest ${rand(r.toInterest)}`} />}
        {fees && <Key colour="#D9BB80" text={`Receipt fee ${rand(r.toReceiptFee)}`} />}
        {fees && <Key colour="#ECDCB8" text={`Annexure B ${rand(r.toFees)}`} />}
        {fees && !rolled && r.rolled > 0 && <Key dashed text={`Left over ${rand(r.rolled)}`} />}
        {split && !cut && <Key colour="#97B4CC" text={`Capital ${rand(capitalWidth)}`} />}
        {cut && <Key colour="#46607B" text={`Commission ${rand(r.commission)}`} />}
        {cut && <Key colour="#32404D" text={`VAT ${rand(r.commissionVat)}`} />}
        {cut && <Key colour={stage >= 5 ? '#FFFFFF' : '#D5E1EB'} text={`To you ${rand(r.toClient)}`} />}
      </div>
    </div>
  )
}

function Key({ colour, text, dashed = false }: { colour?: string; text: string; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2.5 w-2.5 rounded-sm ${dashed ? 'border border-dashed border-[#C69F54]' : ''}`} style={{ background: colour }} />
      {text}
    </span>
  )
}

export function SplitExplainer({ input = SPLIT_EXAMPLES[0].input }: { input?: SplitInput }) {
  const r = useMemo(() => splitPayment(input), [input])
  const [scene, setScene] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [started, setStarted] = useState(false)
  /* Seconds into the current scene; the progress line and the advance both read it. */
  const [into, setInto] = useState(0)
  /* THE CLOCK ONLY COUNTS; a separate effect decides when a scene is over. Advancing from inside the counter's
     updater would be a side effect in a state updater, which React's strict mode runs twice -- two scenes a tick. */
  useEffect(() => {
    if (!playing) return
    const id = window.setInterval(() => setInto((t) => t + 0.1), 100)
    return () => window.clearInterval(id)
  }, [playing])
  useEffect(() => {
    if (into < SCENES[scene].seconds) return
    if (scene < SCENES.length - 1) { setScene(scene + 1); setInto(0) } else setPlaying(false)
  }, [into, scene])

  const go = (s: number) => { setScene(Math.max(0, Math.min(SCENES.length - 1, s))); setInto(0); setStarted(true) }
  const play = () => {
    setStarted(true)
    if (scene === SCENES.length - 1 && into >= SCENES[scene].seconds) { setScene(0); setInto(0) }
    setPlaying((p) => !p)
  }
  const total = SCENES.reduce((n, s) => n + s.seconds, 0)
  const elapsed = SCENES.slice(0, scene).reduce((n, s) => n + s.seconds, 0) + into
  const s = SCENES[scene]
  const finished = scene === SCENES.length - 1 && into >= s.seconds

  return (
    <div className="rounded-2xl overflow-hidden border border-[#101F2C]/10 bg-[#101F2C] text-white" data-testid="split-explainer" data-scene={scene}>
      {/* THE STAGE */}
      <div className="relative aspect-[4/3] sm:aspect-auto sm:h-[400px] overflow-hidden">
        {/* The BF ring, faint, off the corner -- the same open circle the sidebar's foot carries. */}
        <svg aria-hidden className="absolute -right-24 -top-24 h-[420px] w-[420px] opacity-60" viewBox="0 0 200 200" fill="none">
          <path d="M 168 64 A 76 76 0 1 0 168 136" stroke="#C69F54" strokeOpacity="0.35" strokeWidth="1.2" />
          <path d="M 150 76 A 56 56 0 1 0 150 124" stroke="#97B4CC" strokeOpacity="0.18" strokeWidth="1" />
        </svg>
        <svg aria-hidden className="absolute inset-x-0 bottom-0 h-24 w-full" viewBox="0 0 400 60" preserveAspectRatio="none" fill="none">
          <path d="M-10 50 C 120 20, 260 70, 410 18" stroke="#C69F54" strokeOpacity="0.5" strokeWidth="1" />
        </svg>

        <div className="relative h-full flex flex-col px-5 sm:px-10 pt-5 sm:pt-8 pb-6">
          <div key={scene} className="animate-[helpIn_.5s_ease-out] motion-reduce:animate-none">
            <p className="text-[10.5px] sm:text-xs font-bold uppercase tracking-[0.16em] text-[#C69F54]">
              {scene + 1} / {SCENES.length} · {s.kicker}
            </p>
            <h3 className="text-xl sm:text-3xl font-bold mt-1.5 leading-tight" style={{ fontFamily: "'Raleway Variable', 'Raleway', sans-serif" }}>{s.title}</h3>
          </div>

          <div className="flex-1 flex flex-col justify-center">
            {/* THE COIN: the payment, before it becomes a bar. */}
            <div className={`mx-auto mb-4 flex items-center justify-center rounded-full border-2 border-[#C69F54] bg-[#C69F54]/15 ${ease}
              ${scene === 0 ? 'h-24 w-24 sm:h-28 sm:w-28 opacity-100' : 'h-0 w-0 opacity-0 border-0 mb-0'}`} aria-hidden>
              {scene === 0 && <span className="text-lg sm:text-xl font-bold text-[#C69F54]">{rand(r.payment)}</span>}
            </div>
            {scene <= 5 && <SplitBar r={r} stage={scene} />}
            {scene === 6 && (
              <div className="grid sm:grid-cols-3 gap-2 sm:gap-3 text-sm animate-[helpIn_.5s_ease-out] motion-reduce:animate-none" data-testid="split-direct">
                <Card k="1" t="The debtor pays you" d={`You keep the whole ${rand(r.payment)}.`} />
                <Card k="2" t="You tell us" d="Press “Paid to you” on the account." />
                <Card k="3" t="We set it off" d={`The ${rand(r.toFirm)} of fees and commission comes off your next payover.`} />
              </div>
            )}
            {scene === 7 && (
              <div className="grid grid-cols-2 gap-2 sm:gap-3 max-w-xl animate-[helpIn_.5s_ease-out] motion-reduce:animate-none">
                <Card k="½" t="Fees side" d="Interest, receipt fee, Annexure B. Never more than half." />
                <Card k="½" t="Capital side" d="At least half, plus whatever the fees did not need." />
              </div>
            )}
          </div>
        </div>

        {/* THE BIG PLAY BUTTON, before anything has happened. */}
        {!started && (
          <button type="button" onClick={play} data-testid="split-play-big"
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#101F2C]/55 backdrop-blur-[2px] hover:bg-[#101F2C]/45 transition-colors">
            <span className="h-16 w-16 sm:h-20 sm:w-20 rounded-full bg-[#C69F54] text-[#101F2C] flex items-center justify-center shadow-lg">
              <Play size={30} className="ml-1" fill="currentColor" />
            </span>
            <span className="text-sm font-semibold">Watch: how a payment is split · {Math.round(total)} sec</span>
          </button>
        )}
      </div>

      {/* THE CAPTION: everything the pictures say, in words, for anyone who would rather read. */}
      <p className="px-5 sm:px-10 py-3 text-sm sm:text-[15px] text-white/90 bg-[#0B1620] min-h-[4.5rem]" aria-live="polite" data-testid="split-caption">
        {s.caption(r)}
      </p>

      {/* THE CONTROLS */}
      <div className="px-3 sm:px-6 pb-3 pt-2 bg-[#0B1620]">
        <div className="flex gap-1 mb-2.5" role="group" aria-label="Chapters">
          {SCENES.map((x, i) => (
            <button key={x.kicker} type="button" onClick={() => go(i)} title={x.kicker} aria-label={`Chapter ${i + 1}: ${x.kicker}`}
              aria-current={i === scene ? 'step' : undefined} className="flex-1 h-1.5 rounded-full bg-white/15 overflow-hidden" data-testid="split-chapter">
              <span className="block h-full bg-[#C69F54]" style={{ width: i < scene ? '100%' : i > scene ? '0%' : `${(into / x.seconds) * 100}%` }} />
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <Ctl label="Previous" onClick={() => go(scene - 1)} disabled={scene === 0}><ChevronLeft size={18} /></Ctl>
          <Ctl label={finished ? 'Replay' : playing ? 'Pause' : 'Play'} onClick={play} testId="split-play" strong>
            {finished ? <RotateCcw size={16} /> : playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
          </Ctl>
          <Ctl label="Next" onClick={() => go(scene + 1)} disabled={scene === SCENES.length - 1} testId="split-next"><ChevronRight size={18} /></Ctl>
          <span className="ml-2 text-xs tabular-nums text-white/60">
            {clock(elapsed)} / {clock(total)}
          </span>
          <span className="ml-auto text-[11px] text-white/50 hidden sm:inline">An illustration. Your remittance advice is the record.</span>
        </div>
      </div>
    </div>
  )
}

const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`

function Ctl({ label, onClick, disabled, children, testId, strong }: {
  label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode; testId?: string; strong?: boolean
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label} data-testid={testId}
      className={`h-9 w-9 rounded-full flex items-center justify-center disabled:opacity-30 transition-colors ${strong
        ? 'bg-[#C69F54] text-[#101F2C] hover:brightness-110' : 'text-white hover:bg-white/10'}`}>
      {children}
    </button>
  )
}

function Card({ k, t, d }: { k: string; t: string; d: string }) {
  return (
    <div className="rounded-xl border border-white/15 bg-white/[0.06] p-3 sm:p-4">
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[#C69F54] text-[#C69F54] text-sm font-bold">{k}</span>
      <p className="mt-2 font-semibold text-white">{t}</p>
      <p className="text-white/75 text-xs sm:text-sm mt-0.5">{d}</p>
    </div>
  )
}
