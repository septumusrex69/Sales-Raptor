import { Forward, Mail, MessageSquare, Paperclip, Phone, Settings2, User } from 'lucide-react'
import { Card, CardHeader } from '../ui/Card'
import { formatDate } from '../../data/mockData'
import { VOICE_LABEL, type ThreadEntry, type ThreadVoice } from '../../lib/ticketThread.ts'

/**
 * THE WHOLE CONVERSATION, IN ONE LIST, EACH VOICE NAMED.
 *
 * THE FIRM, showing a design of what a dispute ticket should look like: one timeline carrying the
 * internal note, the client's email and the debtor's own words one under the other, each labelled
 * with who said it.
 *
 * IT WAS TWO CARDS. The notes were in one and the correspondence in another, so the question a
 * ticket exists to answer -- what has passed between the three parties, in what order -- could only
 * be answered by reading two lists and merging them in your head. On the firm's own example that is
 * the debtor at 09:15, the client at 10:02 and the liaison at 11:24: one exchange, three voices,
 * drawn as two unrelated boxes.
 *
 * THE CHIP IS THE WHOLE POINT, which is why it leads the row rather than sitting under it. A
 * liaison skimming a three-week-old ticket is looking for what the CLIENT said, and the difference
 * between that and a colleague's note has to survive being read at a glance -- see ticketThread,
 * which derives the voice rather than storing it.
 */

const VOICE_CHIP: Record<ThreadVoice, string> = {
  /* THE THREE OUTSIDE VOICES CARRY COLOUR AND THE INSIDE ONES DO NOT, because that is the division
     that matters on a ticket: what somebody outside the firm actually said is evidence, and what a
     colleague wrote about it is working. */
  debtor: 'bg-gold-100 text-navy-950 border-gold-200',
  client: 'bg-brand-50 text-brand-700 border-brand-100',
  sent: 'bg-slate-100 text-slate-600 border-slate-200',
  internal: 'bg-slate-100 text-slate-500 border-slate-200',
  call: 'bg-slate-100 text-slate-500 border-slate-200',
  system: 'bg-slate-50 text-slate-400 border-slate-100',
}

const VOICE_ICON: Record<ThreadVoice, typeof Mail> = {
  debtor: User,
  client: Mail,
  sent: Mail,
  internal: MessageSquare,
  call: Phone,
  system: Settings2,
}

export function TicketThread({ entries, canForward, why, onForward }: {
  entries: ThreadEntry[]
  /** Whether this person may put a message in front of the client. */
  canForward: boolean
  /** Why not, where not. Said beside the row rather than in a tooltip -- the firm works on an iPad
      and there is no hover to reveal one. */
  why: string | null
  onForward: (emailId: string) => void
}) {
  if (entries.length === 0) {
    return (
      <Card>
        <CardHeader title="The conversation" />
        <p className="text-sm text-slate-400 mt-1">
          Nothing has been said on this ticket yet. What you write above lands here.
        </p>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader
        title="The conversation"
        subtitle="Everything said on this ticket, newest first — inside the firm, to the client and from the debtor." />
      <ol className="mt-3 space-y-3">
        {entries.map((e) => {
          const Icon = VOICE_ICON[e.voice]
          return (
            <li key={e.key} className="flex gap-2.5">
              <span className="mt-0.5 shrink-0 w-6 h-6 rounded-full bg-slate-50 border border-slate-200
                inline-flex items-center justify-center text-slate-400">
                <Icon size={12} />
              </span>
              <div className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className={`text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5
                    rounded border ${VOICE_CHIP[e.voice]}`}>
                    {VOICE_LABEL[e.voice]}
                  </span>
                  <span className="text-xs font-medium text-slate-700 wrap-anywhere">{e.who}</span>
                  <span className="text-[11px] text-slate-400">{formatDate(e.at)}</span>
                </span>
                {/* THE SUBJECT ON AN EMAIL AND NOWHERE ELSE. A note has none, and a bold blank line
                    above every internal entry is furniture. */}
                {e.subject && (
                  <p className="text-xs font-medium text-slate-600 mt-1 wrap-anywhere">{e.subject}</p>
                )}
                <p className="text-sm text-slate-700 whitespace-pre-wrap wrap-anywhere mt-0.5">{e.body}</p>
                {(e.attachmentNames?.length ?? 0) > 0 && (
                  <p className="text-[11px] text-slate-500 mt-1 inline-flex items-start gap-1">
                    <Paperclip size={11} className="mt-0.5 shrink-0" />
                    <span className="wrap-anywhere">{e.attachmentNames!.join(', ')}</span>
                  </p>
                )}
                {/*
                  FORWARD, ON A MESSAGE AND ONLY ON A MESSAGE.
                  
                  An internal note is not a thing to put in front of a client -- it was written for
                  the next collector, which is exactly what the firm's own objection to putting
                  notes in client reporting was about.
                */}
                {e.emailId && (
                  <button type="button" onClick={() => onForward(e.emailId!)} disabled={!canForward}
                    title={why ?? undefined}
                    className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium
                      text-[var(--c-steel)] hover:underline disabled:opacity-40 disabled:no-underline">
                    <Forward size={11} /> Forward to the client
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ol>
      {why && <p className="mt-3 text-[11px] text-slate-500">{why}</p>}
      {/*
        WHAT A FORWARD COSTS, SAID BEFORE THE PRESS AND NOT AFTER.

        THE FIRM OVERRULED THE RECOMMENDATION PUT TO THEM AND THIS IS THE RECORD OF IT. The argument
        against charging was that item 3 on the dispute already covered the work; their answer was
        "raising the dispute charges a charge... and also correspondence to charge". So a forward is
        item 1(a) like any message that leaves the building, and the price belongs beside the button
        rather than on a statement a month later.

        IT CAME WITHIN A LINE OF BEING LOST when the correspondence card was folded into this
        thread -- the old card's own check is what caught it.
      */}
      {canForward && (
        <p className="mt-3 text-[11px] text-slate-400">
          Forwarding a message to the client is charged to the debtor at R25 under Annexure B
          item 1(a), the same as any other email that leaves.
        </p>
      )}
    </Card>
  )
}
