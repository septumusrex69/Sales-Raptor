import { Fragment } from 'react'
import { Mail, MessageSquare, Phone } from 'lucide-react'
import { shortDate } from '../../lib/dateLabels.ts'
import {
  markerIndex, shapeOf, words, type RunStep, type StepShape,
} from '../../lib/runSteps.ts'

/**
 * THE SEQUENCE AS A ROW OF DOTS, WHICH IS HOW THE FIRM DRAWS IT.
 *
 * THE FIRM, LOOKING AT THE LIST THIS REPLACED: "this doesn't work for me. The layout here, it's
 * long... I have an idea. I'll draw you something. So it'll be like a flow diagram almost... it'll
 * be little things and it'll have different like colours if it's been successful or not
 * successful. But you can also like extend it to show every single step in the process." They then
 * drew it: dots on a line, filled behind, hollow ahead, and a drop-down under it.
 *
 * WHY THE LIST WAS WRONG AND THIS IS NOT. An eleven-step sequence written out is eleven rows of
 * equal weight, and the account screen carries two runs of it — so the one thing that needed doing
 * was a row in a table twenty rows long. A dot says the only three things anybody reads at a
 * glance: how far along this debtor is, whether anything has stopped, and what is next. The
 * sentences are still there, one at a time, under the dot that is asking for them.
 *
 * IT IS A ROW OF BUTTONS, NOT A PICTURE. Every dot is pressable and says what it is, because the
 * firm works on an iPad and a track you can only read is a track that has to be expanded to be
 * used. `aria-label` carries the words the dot draws as a colour.
 *
 * AND IT CHANGES WITH THE ROOM IT IS GIVEN, which is a container query rather than the page's
 * width: this panel sits in the account's narrow rail today and the same component has to read
 * on a wide screen. Narrow, a step is a dot with its day number under it and eleven of them fit;
 * wide, the firm's own words for the step appear underneath as well. The NAME is never the only
 * place a step is identified -- the detail below the track and the drop-down both spell it out --
 * so the narrow reading loses nothing, which is what makes dropping it honest.
 */

/** The channel a step goes out on, where it has one. A review step has none. */
const CHANNELS: Record<string, typeof Mail> = { email: Mail, sms: MessageSquare, whatsapp: MessageSquare, call: Phone }

/**
 * WHAT EACH SHAPE LOOKS LIKE.
 *
 * FILLED IS BEHIND YOU AND HOLLOW IS AHEAD — the firm's own drawing, and the one convention that
 * needs no key. Gold is the firm's attention colour everywhere else in Raptor, so a stopped step
 * reads as "this one is yours" without a legend; green is the outcome colour, not a decoration.
 */
const DOT: Record<StepShape, string> = {
  sent: 'bg-[var(--color-positive)] border-[var(--color-positive)]',
  stopped: 'bg-[var(--c-gold)] border-[var(--c-gold)]',
  waiting: 'bg-white border-slate-300',
  cancelled: 'bg-white border-slate-200 border-dashed',
}

const LABEL: Record<StepShape, string> = {
  sent: 'text-slate-600',
  stopped: 'text-[var(--c-gold-deep)] font-medium',
  waiting: 'text-slate-400',
  cancelled: 'text-slate-300 line-through',
}

/**
 * WHERE TODAY FALLS ON THE TRACK.
 *
 * AFTER THE LAST STEP THAT HAS COME DUE, which is the reading somebody wants: everything to the
 * left of the mark should have happened, everything to the right has not. A step due TODAY sits
 * on the left of it, because today is its day — it is late only tomorrow.
 *
 * Returns steps.length where the whole sequence is behind us, and 0 on a run dated into the
 * future, so the mark is drawn at one end rather than not at all.
 */
export function WorkflowTrack({ steps, selectedId, onSelect, today }: {
  steps: RunStep[]
  selectedId: string | null
  onSelect: (id: string) => void
  /**
   * The firm's today, or null on a run that is over.
   *
   * NULL RATHER THAN A MARK AT THE END. A run the account has left stopped where it stopped, and
   * a "today" caret past the last dot of a finished sequence says the sequence is still counting
   * when it is not.
   */
  today: string | null
}) {
  const at = today === null ? -1 : markerIndex(steps, today)
  const mark = (key: string) => (
    <li key={key} className="flex items-start" aria-label="Today">
      {/*
        TODAY, AS A LINE THROUGH THE TRACK. The firm: "it's important to show where in the
        workflow is it currently." Drawn taller than the dots rather than as a dot of its own,
        because it is not a step and must not be counted as one -- and in gold, which is the
        colour the rest of Raptor uses for "this is where you are wanted".
      */}
      <span aria-hidden className="mx-1 mt-[-2px] h-7 w-[2px] shrink-0 rounded-full bg-[var(--c-gold)]" />
    </li>
  )
  return (
    <div className="@container -mx-1 px-1 pb-1">
      {/*
        IT WRAPS RATHER THAN SCROLLING, AND THAT IS WHAT BOUGHT THE SIZE. The firm: "it could be
        maybe a little bit bigger those little circles because it's not filling the whole screen."
        Eleven dots big enough to press do not fit across the account's rail on one line -- at
        twenty pixels they need two hundred and twenty and the rail gives two hundred -- so a
        single scrolling line forced them down to sixteen and still left the right-hand end empty.
        Wrapped, seven sit on a line, the line fills, and the dots are the size of a fingertip.

        EACH STEP CARRIES THE CONNECTOR ON ITS LEFT, so a wrapped line begins with a short stub
        and reads as a continuation rather than a new sequence -- and no tail hangs off the end.
      */}
      <ol className="flex flex-wrap items-start gap-y-2">
        {steps.map((step, i) => {
          const shape = shapeOf(step)
          const Icon = CHANNELS[step.channel ?? '']
          const selected = step.id === selectedId
          return (
            <Fragment key={step.id}>
              {at === i && mark(`mark-${i}`)}
              <li className="flex items-start">
                {/*
                  THE LINE BETWEEN, drawn by the step on its right rather than as its own element:
                  one connector per gap, and never a stray tail past the last dot. It is coloured
                  by the step BEFORE it, so the filled part of the track is the part that has
                  happened.
                */}
                {i > 0 && (
                  <span aria-hidden className={`mt-[9px] h-[2px] w-2 shrink-0 @sm:w-5 ${
                    shapeOf(steps[i - 1]) === 'sent' ? 'bg-[var(--color-positive)]/40' : 'bg-slate-200'
                  }`} />
                )}
                <button type="button" onClick={() => onSelect(step.id)}
                  title={words(step)}
                  aria-label={words(step)}
                  aria-current={selected ? 'step' : undefined}
                  className="group flex w-5 shrink-0 flex-col items-center gap-0.5 @sm:w-[76px] @sm:gap-1">
                  <span className={`flex h-5 w-5 items-center justify-center rounded-full border-2
                    ${DOT[shape]} ${
                    selected ? 'ring-2 ring-navy-950/25 ring-offset-1' : 'group-hover:ring-2 group-hover:ring-slate-200'
                  }`}>
                    {/* The channel inside the dot, where there is one -- an email and an SMS on
                        the same day are two dots that otherwise look identical, and they are the
                        pair the firm's sequences are built out of. */}
                    {Icon && <Icon size={10} className={shape === 'waiting' || shape === 'cancelled'
                      ? 'text-slate-400' : 'text-white'} />}
                  </span>
                  {/*
                    THE DAY NUMBER, WHICH IS HOW THE FIRM WRITES THEIR OWN CHART. It is the one
                    thing short enough to sit under a dot in the rail, and it is what makes the
                    track a sequence rather than a row of beads -- two dots reading "1 1" are the
                    email and the SMS that go out together. The unit it counts in is spelled out
                    under the track and again in the detail, where there is room to write it.
                  */}
                  <span className={`text-[9px] leading-none tabular-nums ${LABEL[shape]}`}>
                    {step.day}
                  </span>
                  <span className={`hidden text-center text-[10px] leading-tight @sm:line-clamp-2 @sm:block ${LABEL[shape]}`}>
                    {step.label}
                  </span>
                  {/* AND THE DATE, WHERE THERE IS ROOM FOR IT. In the rail there is not -- a date
                      is twice the width of a dot -- so there it is carried by the dot's own
                      label, which a long press reads out, and spelled in full in the detail
                      under the track. */}
                  <span className="hidden text-center text-[9px] leading-none text-slate-400 tabular-nums @sm:block">
                    {shortDate(step.sentAt ? step.sentAt.slice(0, 10) : step.dueOn)}
                  </span>
                </button>
              </li>
            </Fragment>
          )
        })}
        {at === steps.length && mark('mark-end')}
      </ol>
    </div>
  )
}
