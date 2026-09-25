import { Mail, MessageSquare, Phone } from 'lucide-react'
import { RUN_STEP_WORDS, shapeOf, type RunStep, type StepShape } from '../../lib/runSteps.ts'

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

export function WorkflowTrack({ steps, selectedId, onSelect }: {
  steps: RunStep[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <div className="@container -mx-1 overflow-x-auto px-1 pb-1">
      <ol className="flex items-start">
        {steps.map((step, i) => {
          const shape = shapeOf(step)
          const Icon = CHANNELS[step.channel ?? '']
          const selected = step.id === selectedId
          return (
            <li key={step.id} className="flex items-start">
              {/*
                THE LINE BETWEEN, drawn by the step on its right rather than as its own element:
                one connector per gap, and never a stray tail past the last dot. It is coloured by
                the step BEFORE it, so the filled part of the track is the part that has happened.
              */}
              {i > 0 && (
                <span aria-hidden className={`mt-[7px] h-[2px] w-1 shrink-0 @sm:mt-[9px] @sm:w-5 ${
                  shapeOf(steps[i - 1]) === 'sent' ? 'bg-[var(--color-positive)]/40' : 'bg-slate-200'
                }`} />
              )}
              <button type="button" onClick={() => onSelect(step.id)}
                title={`${step.label} — ${RUN_STEP_WORDS[step.state].label}`}
                aria-label={`${step.label} — ${RUN_STEP_WORDS[step.state].label}`}
                aria-current={selected ? 'step' : undefined}
                className="group flex w-4 shrink-0 flex-col items-center gap-0.5 @sm:w-[76px] @sm:gap-1">
                <span className={`flex h-4 w-4 items-center justify-center rounded-full border-2
                  @sm:h-5 @sm:w-5 ${DOT[shape]} ${
                  selected ? 'ring-2 ring-navy-950/25 ring-offset-1' : 'group-hover:ring-2 group-hover:ring-slate-200'
                }`}>
                  {/* The channel inside the dot, where there is one -- an email and an SMS on the
                      same day are two dots that otherwise look identical, and they are the pair
                      the firm's sequences are built out of. */}
                  {Icon && <Icon size={8} className={shape === 'waiting' || shape === 'cancelled'
                    ? 'text-slate-400' : 'text-white'} />}
                </span>
                {/*
                  THE DAY NUMBER, WHICH IS HOW THE FIRM WRITES THEIR OWN CHART. It is the one
                  thing short enough to sit under a dot in the rail, and it is what makes the
                  track a sequence rather than a row of beads -- two dots reading "1 1" are the
                  email and the SMS that go out together. The unit it counts in is spelled out in
                  the detail below, where "Business day 39" has room to be written.
                */}
                <span className={`text-[9px] leading-none tabular-nums ${LABEL[shape]}`}>
                  {step.day}
                </span>
                <span className={`hidden text-center text-[10px] leading-tight @sm:line-clamp-2 @sm:block ${LABEL[shape]}`}>
                  {step.label}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
