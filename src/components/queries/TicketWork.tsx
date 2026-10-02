import { useState } from 'react'
import { Loader2, Mail, MessageSquare, Phone, StickyNote } from 'lucide-react'
import { Card, CardHeader } from '../ui/Card'
import { DictateButton } from '../ui/Dictate'
import { formatDate } from '../../data/mockData'
import type { AccountNote } from '../../lib/accountWorkspace'

/**
 * THE TICKET AS A PLACE YOU WORK, RATHER THAN A ROW YOU READ.
 *
 * THE FIRM, looking at a request that had reached the liaison: "there needs to be options. There
 * needs to be like a mail, where we will be able to request something from the client... it should
 * already be able to draft an email for the client. There should also be an option to call the
 * client just from the ticket. Make notes on the ticket, and the notes should also live in the
 * client section and on the ticket... So now we're working on the ticket, making the ticket better,
 * workable, flexible."
 *
 * WHAT WAS THERE WAS A DESCRIPTION, THREE FIGURES AND TWO WAYS TO CLOSE IT. A liaison who wanted to
 * do the one thing the ticket exists for — ask the client — had to leave it, find the client, find
 * the account, and write from there, and nothing they did came back.
 *
 * ----------------------------------------------------------------------------------------------
 * THE PLUMBING WAS ALREADY BUILT. THE SCREEN JUST DID NOT USE IT.
 * ----------------------------------------------------------------------------------------------
 *
 * This is the part worth writing down, because it is why this is a panel and not a migration.
 * `addNote` has taken a `queryId` since queries existed; `account_emails.query_id` has filed mail
 * against a ticket since the Forward button was built. So the firm's "three places" — the ticket,
 * the client's own space, and the mailbox — is not a thing to design. It is what the tables already
 * do, and every one of those writes has been landing on the account's timeline all along. What was
 * missing was anywhere to make them from, and anywhere to read them back.
 *
 * SO EVERY ACTION HERE GOES THROUGH THE ACCOUNT'S OWN LIBRARY, not a second write path of its own.
 * A note written here is an account note that carries this ticket's id; an email sent here is
 * recorded by the same `recordSentEmail` the account uses, charged the same item 1(a). Two paths to
 * one record is how a dispute ends up with a history the account does not have.
 *
 * ----------------------------------------------------------------------------------------------
 * WHAT A CALL FROM HERE DOES AND DOES NOT DO
 * ----------------------------------------------------------------------------------------------
 *
 * IT RECORDS, AND IT CHARGES NOTHING. Item 2 is a telephone call, and the account's own Call button
 * raises it — but that is a call to the DEBTOR. This one is to the CLIENT, about a question the
 * firm is asking on the debtor's behalf, and the dispute has already charged item 3 for exactly
 * that work. Billing a debtor again because the liaison rang the client to chase their own answer
 * is not something that would survive being asked about.
 *
 * It is written down rather than decided quietly: if the firm wants it charged, the fee goes here
 * and the reasoning above is what has to change first.
 */

export type TicketAction = 'email' | 'call' | 'note'

export function TicketWork({
  notes, canReachClient, canEmail, clientWhy, emailWhy, busy, onEmail, onNote, onCall,
}: {
  /** The ticket's own thread. Oldest first — a ticket is a short exchange read in order. */
  notes: AccountNote[]
  /**
   * MAY THIS PERSON TOUCH THE CLIENT AT ALL?
   *
   * THE FIRM, of a ticket that a collector raised and a liaison owns: "the debt collector has
   * viewing options and it can view, but it cannot, for example, send an email to the client, it
   * doesn't have that permissions. However, the liaison can do anything within the ticket."
   *
   * THE LINE IS WHETHER IT REACHES THE CLIENT, not whether it writes to the database. A call to the
   * client is the same act as an email to them — somebody at the credit provider is spoken to on
   * the firm's behalf — so it sits behind the same permission, and `canSendToClient`'s own note
   * already says why: the conversation with a client belongs to whoever holds the relationship.
   *
   * A NOTE IS NOT CLIENT CONTACT and stays open to everybody who can see the ticket. The collector
   * raised it, it is their debtor, and "he rang again this morning about this" is exactly the thing
   * the liaison needs and the only person who knows it is the one the firm has just made read-only.
   * Locking the note as well would make the ticket a worse record to protect a relationship the
   * note does not touch.
   */
  canReachClient: boolean
  /** False where they may reach the client but have no mailbox connected. */
  canEmail: boolean
  /** Why they may not reach the client at all. Null when they may. */
  clientWhy: string | null
  /** Said on the button rather than discovered on Send. Null when it is allowed. */
  emailWhy: string | null
  busy: boolean
  onEmail: () => void
  /** Writes an account note carrying this ticket's id. Resolves when it is filed. */
  onNote: (body: string) => Promise<void>
  /** Likewise, with who was spoken to folded into the sentence. */
  onCall: (who: string, said: string) => Promise<void>
}) {
  const [open, setOpen] = useState<TicketAction | null>(null)
  const [body, setBody] = useState('')
  const [who, setWho] = useState('')
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)

  /* ONE COMPOSER FOR BOTH, because a note and a call note are the same record with a different
     first line. Two textareas would be two places to add dictation to. */
  const close = () => { setOpen(null); setBody(''); setWho(''); setFailed(null) }

  async function save() {
    const words = body.trim()
    if (!words || saving) return
    setSaving(true); setFailed(null)
    try {
      if (open === 'call') await onCall(who.trim(), words)
      else await onNote(words)
      close()
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title="Working this ticket"
        subtitle="Everything done here is filed on the ticket and on the account’s own history." />

      {/*
        THREE THINGS A PERSON ACTUALLY DOES WITH A TICKET: ask the client, ring them, write down
        what happened. Side by side rather than hidden behind a menu — this is the panel's whole
        purpose, and a purpose behind a chevron is a purpose nobody finds.
      */}
      <div className="flex flex-wrap gap-2 mt-3">
        <button type="button" onClick={onEmail} disabled={!canEmail || busy}
          title={emailWhy ?? 'Write to the client about this ticket'}
          className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg
            bg-brand-600 text-white shadow-sm hover:bg-brand-700 disabled:opacity-50">
          <Mail size={14} /> Email the client
        </button>
        {/* RINGING THE CLIENT IS CLIENT CONTACT, so it sits behind the same permission as writing
            to them — see canReachClient. Disabled rather than hidden: a collector should be able to
            see that the firm does call the client about this, and who does it. */}
        <button type="button" onClick={() => setOpen(open === 'call' ? null : 'call')}
          disabled={busy || !canReachClient}
          title={clientWhy ?? 'Record a call you have had with the client about this'}
          className={`inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border
            disabled:opacity-50
            ${open === 'call' ? 'border-navy-950 bg-navy-950 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
          <Phone size={14} /> Log a call
        </button>
        <button type="button" onClick={() => setOpen(open === 'note' ? null : 'note')} disabled={busy}
          className={`inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border
            ${open === 'note' ? 'border-navy-950 bg-navy-950 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
          <StickyNote size={14} /> Add a note
        </button>
      </div>
      {/* THE REASON IT IS DISABLED, BESIDE THE BUTTON rather than in a tooltip only: on the iPad
          the firm works on there is no hover to reveal one. */}
      {/* ONE SENTENCE, NOT TWO. Where somebody may not reach the client at all, that is the reason
          both buttons are off and repeating it under each would be the same line twice. */}
      {(clientWhy ?? emailWhy) && (
        <p className="mt-1.5 text-[11px] text-slate-500">{clientWhy ?? emailWhy}</p>
      )}
      {/* AND WHAT THEY CAN STILL DO, because a panel of greyed buttons reads as a page that is not
          for you — and it is: the note is the collector's half of this ticket. */}
      {clientWhy && (
        <p className="mt-0.5 text-[11px] text-slate-400">
          You can still add a note — anything you write here reaches whoever is answering it.
        </p>
      )}

      {open && (
        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
          {open === 'call' && (
            <label className="block mb-2">
              <span className="text-xs font-medium text-slate-500">Who did you speak to?</span>
              <input value={who} onChange={(e) => setWho(e.target.value)}
                placeholder="e.g. Nicole at Rinda Roo"
                className="w-full mt-1 text-sm rounded-lg border border-slate-200 px-2.5 py-1.5 bg-white" />
            </label>
          )}
          <span className="flex items-baseline justify-between gap-3">
            <span className="text-xs font-medium text-slate-500">
              {open === 'call' ? 'What was said?' : 'What should the next person know?'}
            </span>
            {/*
              DICTATED, the same control the escalate box and the call note use. THE FIRM asked for
              it on the dispute in the first place — "there should be a dictate so you can speak to
              the dispute" — and a liaison writing up a call they have just finished is the same
              moment: the words are in their head and not yet in their fingers.
            */}
            <DictateButton size="small" value={body} onChange={setBody} />
          </span>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3}
            placeholder={open === 'call'
              ? 'They are pulling the file and will come back to us on Friday.'
              : 'What has been done, or what is still waiting.'}
            className="w-full mt-1 text-sm rounded-lg border border-slate-200 px-2.5 py-2 resize-none bg-white" />
          {failed && <p className="mt-1.5 text-[11px] text-negative-700">{failed}</p>}
          <div className="flex items-center gap-2 mt-2">
            <button type="button" onClick={() => void save()} disabled={!body.trim() || saving}
              className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg
                bg-brand-600 text-white disabled:opacity-50">
              {saving && <Loader2 size={13} className="animate-spin" />}
              {open === 'call' ? 'File the call' : 'File the note'}
            </button>
            <button type="button" onClick={close}
              className="text-sm px-3 py-1.5 rounded-lg text-slate-500 hover:bg-slate-100">
              Cancel
            </button>
            {/* A CALL TO THE CLIENT COSTS THE DEBTOR NOTHING, and the panel says so where the
                decision is made rather than leaving somebody to find out from a statement. The
                reasoning is at the top of this file. */}
            <span className="text-[11px] text-slate-400">
              {open === 'call'
                ? 'Recorded only — a call to the client raises no fee on the debtor.'
                : 'Goes on the account’s history too.'}
            </span>
          </div>
        </div>
      )}

      {/* ---------------- the thread ---------------- */}

      {notes.length > 0 && (
        <div className="mt-4 pt-3 border-t border-slate-100 space-y-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-400">
            {notes.length === 1 ? 'One entry' : `${notes.length} entries`}
          </p>
          {notes.map((n) => (
            <div key={n.id} className="flex gap-2.5">
              <MessageSquare size={13} className="mt-0.5 shrink-0 text-slate-300" />
              <div className="min-w-0">
                <p className="text-sm text-slate-700 whitespace-pre-wrap wrap-anywhere">{n.body}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {n.authorName ?? 'Raptor'} · {formatDate(n.createdAt)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
