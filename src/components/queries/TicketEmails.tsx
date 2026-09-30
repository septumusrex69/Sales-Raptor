import { useState } from 'react'
import { Forward, Mail, Paperclip } from 'lucide-react'
import { Card, CardHeader } from '../ui/Card'
import { formatDate } from '../../data/mockData'
import type { AccountEmail } from '../../lib/accountEmails'

/**
 * THE EMAIL THAT RAISED THIS TICKET, ON THE TICKET, AND THE BUTTON THAT PASSES IT ON.
 *
 * THE FIRM: "can me, as a client liaison, for example, Stefan, or Nicole, forward that email just
 * like that to the client?"
 *
 * THEY COULD NOT, AND THE REASON WAS NOT THE DATA. The email has been filed against the ticket
 * since the day the button existed — `query_id` on account_emails, its attachments filed beside it
 * as documents — and no screen ever read it back. A liaison working a dispute had the agent's note
 * and nothing the debtor actually wrote, and the only way to the words was to leave the ticket,
 * find the account, and scroll its mail.
 *
 * THE BODY IS NOT THE NOTE AND THE NOTE IS NOT THE BODY. The description is the clerk's summary,
 * mandatory and written by whoever took it; this is what the debtor sent. The firm asked for both
 * separately — "the email now goes into the description, whereas the email should come to the
 * ticket in another form" — and this is the other form.
 *
 * ORDERED OLDEST FIRST, unlike the account's list, because a ticket's mail is a short conversation
 * read in order: the objection, then what was passed on about it.
 *
 * WHO MAY FORWARD IS NOT DECIDED HERE. `canSendToClient` decides it, the same function the rest of
 * the query screens ask, and its own note says why a collections agent is not on that list: the
 * conversation with a client belongs to whoever holds the relationship.
 */
export function TicketEmails({ emails, canForward, why, onForward }: {
  emails: AccountEmail[]
  /** False where this person may not write to the client, or has no mailbox connected. */
  canForward: boolean
  /** Said on the button rather than discovered on Send. Null when it is allowed. */
  why: string | null
  onForward: (email: AccountEmail) => void
}) {
  /*
   * ABSENT RATHER THAN EMPTY. Most tickets are raised on a call and have no email at all; a card
   * headed "Correspondence" saying "nothing here" on two disputes in three is a card people learn
   * to scroll past, and it would push the rows that matter further down every batch ticket.
   */
  if (emails.length === 0) return null

  return (
    <Card>
      <CardHeader
        title={emails.length === 1 ? 'The email this came from' : 'Correspondence on this ticket'}
        subtitle={emails.length === 1
          ? 'Filed against the ticket with its attachments.'
          : `${emails.length} messages, oldest first.`}
      />
      <div className="mt-3 space-y-3">
        {emails.map((e) => (
          <Message key={e.id} email={e} canForward={canForward} why={why} onForward={onForward} />
        ))}
      </div>
    </Card>
  )
}

function Message({ email: e, canForward, why, onForward }: {
  email: AccountEmail
  canForward: boolean
  why: string | null
  onForward: (email: AccountEmail) => void
}) {
  /*
   * COLLAPSED PAST A SCREENFUL, not past a line. A dispute is usually two paragraphs and clamping
   * those behind "Show more" would make the commonest case a click; a forwarded thread with six
   * turns of quoted history under it is what this is actually for.
   */
  const body = e.body ?? ''
  const long = body.length > 1200
  const [open, setOpen] = useState(!long)
  const inbound = e.direction === 'in'

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-800 wrap-anywhere">
            {e.subject?.trim() || '(no subject)'}
          </p>
          {/*
            WHICH WAY IT WENT, IN WORDS. An arrow or a colour would not survive the one question a
            liaison actually asks of this card — did we already send this on? — and "Sent to" beside
            an address answers it without a legend.
          */}
          <p className="text-[11px] text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-1.5">
            <span className="inline-flex items-center gap-1">
              <Mail size={11} className="text-slate-400" />
              {inbound ? 'From' : 'Sent to'} {e.debtorAddress}
            </span>
            <span className="text-slate-300">&middot;</span>
            <span>{formatDate(e.occurredAt)}</span>
            {e.sentByName && !inbound && (
              <>
                <span className="text-slate-300">&middot;</span>
                <span>by {e.sentByName}</span>
              </>
            )}
          </p>
          {e.attachmentNames.length > 0 && (
            /* NAMED, NOT COUNTED. "3 attachments" tells a liaison nothing; "bank statement Mar.pdf"
               is often the whole answer to what the dispute is about. */
            <p className="text-[11px] text-slate-500 mt-1 flex flex-wrap items-center gap-x-1.5">
              <Paperclip size={11} className="text-slate-400" />
              {e.attachmentNames.join(' · ')}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => onForward(e)}
          disabled={!canForward}
          title={why ?? undefined}
          className="text-xs font-medium px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 flex items-center gap-1.5 shrink-0 disabled:opacity-40"
        >
          <Forward size={13} /> Forward
        </button>
      </div>

      {/*
        WHAT IT COSTS, BESIDE THE BUTTON THAT SPENDS IT. The firm's ruling: "raising the dispute
        charges a charge. I think it should charge the debtor for it. And also correspondence to
        charge." So a forward to the client is item 1(a) like any other message that leaves —
        item 3 on the dispute and item 1(a) on the correspondence are two chargeable things, not
        one charged twice — and the price is said before the press rather than found afterwards.
      */}
      {canForward && (
        <p className="text-[11px] text-slate-400 mt-1.5">
          Forwarding is charged to the debtor under item 1(a), like any other email that leaves.
        </p>
      )}
      {!canForward && why && <p className="text-[11px] text-slate-400 mt-1.5">{why}</p>}

      {body.trim() && (
        <>
          <p className={`text-sm text-slate-700 whitespace-pre-wrap wrap-anywhere mt-2 ${open ? '' : 'line-clamp-6'}`}>
            {body}
          </p>
          {long && (
            <button type="button" onClick={() => setOpen((v) => !v)}
              className="text-[11px] text-brand-600 hover:underline mt-1">
              {open ? 'Show less' : 'Show more'}
            </button>
          )}
        </>
      )}
      {!body.trim() && (
        /* SAID, NOT LEFT BLANK. The sync stores a snippet rather than the whole message, and an
           empty card reads as a message with nothing in it rather than one we did not keep. */
        <p className="text-[11px] text-slate-400 mt-2">
          Nothing of this message was stored — open it in the mailbox to read it.
        </p>
      )}
    </div>
  )
}
