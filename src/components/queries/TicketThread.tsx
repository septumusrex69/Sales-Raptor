import { useState } from 'react'
import { ChevronDown, Forward, HelpCircle, Info, Mail, MessageSquare, Paperclip, Phone, Reply, Settings2, User } from 'lucide-react'
import { Card } from '../ui/Card'
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

/* WHICH VOICES THE FILTER OFFERS. The firm's design carried "All messages" above the list: on a ticket
   with forty entries the client's own words are what a liaison is looking for. */
const FILTERS: { id: 'all' | 'client' | 'debtor' | 'firm'; label: string; voices: ThreadVoice[] | null }[] = [
  { id: 'all', label: 'All messages', voices: null },
  { id: 'client', label: 'The client', voices: ['client'] },
  { id: 'debtor', label: 'The debtor', voices: ['debtor'] },
  { id: 'firm', label: 'Inside the firm', voices: ['internal', 'call', 'system', 'sent'] },
]

const time = (iso: string) => new Date(iso).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Johannesburg' })

export function TicketThread({ entries, canForward, why, onForward, onReply, replyHint }: {
  entries: ThreadEntry[]
  /** Whether this person may put a message in front of the client. */
  canForward: boolean
  /** Why not, where not. Said beside the row rather than in a tooltip -- the firm works on an iPad
      and there is no hover to reveal one. */
  why: string | null
  onForward: (emailId: string) => void
  /**
   * REPLY ON THE TICKET, NOT ON ONE EMAIL (S15). Stephan: "This reply currently is a reply on an email ...
   * I think rather a reply to the ticket." One button at the head of the conversation: it answers the
   * client, is filed on the ticket (so the portal shows it) and goes to them by email with a link to the
   * portal -- a client who works in email reads it there, one who works in the portal answers there.
   */
  onReply?: () => void
  /** Who the reply goes to, said under the button. */
  replyHint?: string | null
}) {
  const [filter, setFilter] = useState<typeof FILTERS[number]['id']>('all')
  const shown = FILTERS.find((f) => f.id === filter)?.voices
  const visible = shown ? entries.filter((e) => shown.includes(e.voice)) : entries

  return (
    <Card>
      {/* THE HEAD, as the firm drew it: a dark tile, the title and what the list is, the filter -- and the
          one reply, because answering is what this card is for. */}
      <div className="flex flex-wrap items-start gap-4 pb-4 border-b border-slate-100">
        <span className="shrink-0 w-11 h-11 rounded-xl bg-navy-900 text-white inline-flex items-center justify-center">
          <MessageSquare size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-bold text-slate-900">The conversation</h3>
          <p className="text-sm text-slate-500">Everything said on this ticket, newest first — inside the firm, with the client and from the debtor.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {entries.length > 0 && (
            <label className="relative">
              <span className="sr-only">Show</span>
              <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} data-testid="thread-filter"
                className="appearance-none rounded-lg border border-slate-200 bg-white pl-3 pr-8 py-2 text-sm text-slate-700">
                {FILTERS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
              <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            </label>
          )}
          {onReply && (
            <button type="button" onClick={onReply} disabled={!canForward} title={why ?? undefined} data-testid="thread-reply"
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-40">
              <Reply size={15} /> Reply on this ticket
            </button>
          )}
        </div>
      </div>
      {onReply && replyHint && canForward && <p className="mt-2 text-xs text-slate-500" data-testid="thread-reply-hint">{replyHint}</p>}

      {visible.length === 0 ? (
        <p className="text-sm text-slate-400 mt-4">
          {entries.length === 0 ? 'Nothing has been said on this ticket yet. What you write lands here.' : 'Nothing from them on this ticket.'}
        </p>
      ) : (
        <ol className="divide-y divide-slate-100">
          {visible.map((e) => {
            const Icon = VOICE_ICON[e.voice]
            return (
              <li key={e.key} className="flex gap-3.5 py-4" data-testid="thread-entry">
                <span className="shrink-0 w-10 h-10 rounded-full bg-slate-100 inline-flex items-center justify-center text-slate-500">
                  <Icon size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <span className={`text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md border ${VOICE_CHIP[e.voice]}`}>
                      {VOICE_LABEL[e.voice]}
                    </span>
                    <span className="text-sm font-semibold text-slate-800 wrap-anywhere">{e.who}</span>
                    <span className="text-slate-200" aria-hidden="true">|</span>
                    <span className="text-xs text-slate-500">{formatDate(e.at)}</span>
                    <span className="text-xs text-slate-600 bg-slate-100 rounded-md px-1.5 py-0.5 tabular-nums">{time(e.at)}</span>
                  </span>
                  {/* THE SUBJECT ON AN EMAIL AND NOWHERE ELSE. A note has none, and a bold blank line
                      above every internal entry is furniture. */}
                  {e.subject && (
                    <p className="mt-2 flex items-center gap-2 rounded-lg bg-[var(--tint-steel)] px-3 py-1.5 text-sm font-medium text-slate-700 wrap-anywhere">
                      <HelpCircle size={15} className="shrink-0 text-slate-500" /> {e.subject}
                    </p>
                  )}
                  <p className="text-sm text-slate-700 whitespace-pre-wrap wrap-anywhere mt-2">{e.body}</p>
                  {(e.attachmentNames?.length ?? 0) > 0 && (
                    <p className="text-[11px] text-slate-500 mt-1 inline-flex items-start gap-1">
                      <Paperclip size={11} className="mt-0.5 shrink-0" />
                      <span className="wrap-anywhere">{e.attachmentNames!.join(', ')}</span>
                    </p>
                  )}
                  {/*
                    FORWARD, ON THE DEBTOR'S OWN MESSAGES AND NOWHERE ELSE (S15). Stephan: "forward to the
                    client doesn't really make sense" -- on the client's own message it does not; on a
                    debtor's dispute it is the whole point, the liaison putting the debtor's words in front
                    of the creditor. An internal note never: it was written for the next collector.
                  */}
                  {e.emailId && e.voice === 'debtor' && (
                    <button type="button" onClick={() => onForward(e.emailId!)} disabled={!canForward}
                      title={why ?? undefined} data-testid="thread-forward"
                      className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium
                        text-[var(--c-steel)] hover:bg-slate-50 disabled:opacity-40">
                      <Forward size={14} /> Forward to the client
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      )}
      {why && <p className="mt-3 text-[11px] text-slate-500">{why}</p>}
      {/*
        WHAT A REPLY OR A FORWARD COSTS, SAID BEFORE THE PRESS AND NOT AFTER.

        THE FIRM OVERRULED THE RECOMMENDATION PUT TO THEM AND THIS IS THE RECORD OF IT. The argument
        against charging was that item 3 on the dispute already covered the work; their answer was
        "raising the dispute charges a charge... and also correspondence to charge". So a forward is
        item 1(a) like any message that leaves the building, and the price belongs beside the button
        rather than on a statement a month later.

        IT CAME WITHIN A LINE OF BEING LOST when the correspondence card was folded into this
        thread -- the old card's own check is what caught it.
      */}
      {canForward && (
        <p className="mt-3 flex items-start gap-2.5 rounded-lg bg-[var(--tint-steel)] px-3 py-2.5 text-xs text-slate-600">
          <Info size={15} className="shrink-0 text-[var(--c-navy-mid)]" />
          Replying to or forwarding a message is charged to the debtor at R25 under Annexure B
          item 1(a), the same as any other email that leaves.
        </p>
      )}
    </Card>
  )
}
