import { Link } from 'react-router-dom'
import { CalendarClock, Mail, MapPin, StickyNote, User, Users, Video } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { joinLink, whenItIs } from '../../lib/dayPlan.ts'
import type { CalendarEvent } from '../../lib/calendarEvents.ts'

/**
 * A MEETING, SHOWN AS A MEETING.
 *
 * THE FIRM, clicking one on the calendar: "if I click on the 8th where it says call centre
 * discussion, it takes me to the emails. But it doesn't take me to that specific email. I don't
 * want it to take me to the email at all -- rather to call centre discussion. There's not a lot of
 * details that were brought through. Who was that with? Who did it come from?"
 *
 * THE CAUSE WAS ONE LINE. The calendar built every meeting chip with `href: '/mail'` -- not the
 * message, the MAILBOX. So every meeting on the calendar went to the same place, and the one thing
 * it could not tell you was anything about the meeting.
 *
 * AND EVERY DETAIL THEY ASKED FOR WAS ALREADY STORED AND DRAWN NOWHERE. `calendar_events` carries
 * the organiser's name and address, the attendees, the location, the notes, and `user_email_id` --
 * the invitation it arrived on. The calendar simply never had a place to show any of it, so this
 * component is a reading of a row rather than anything new behind it.
 *
 * ------------------------------------------------------------------------------------------------
 * THE MAILBOX IS SOMEWHERE YOU GO ON PURPOSE
 * ------------------------------------------------------------------------------------------------
 *
 * The invitation is still one press away, and it goes to THAT MESSAGE rather than to the inbox --
 * which is the other half of the firm's complaint ("it doesn't take me to that specific email").
 * Absent where the meeting was made by hand, because there is no invitation to open and a dead
 * button is worse than none.
 */
export function MeetingModal({ meeting, onClose }: {
  meeting: CalendarEvent
  onClose: () => void
}) {
  const when = whenItIs(meeting)
  /*
   * THE LINK YOU ACTUALLY PRESS AT TWO MINUTES PAST.
   *
   * THE FIRM: "if the link is pulled in there as well, that'd be cool."
   *
   * It was on this screen already and not pressable: the join URL sits in the middle of forty
   * lines of Teams boilerplate -- meeting id, passcode, tenant key, two help links -- so getting
   * into the meeting meant selecting a line of text by hand on a tablet thirty seconds after it
   * had started. joinLink picks the one URL out of that and refuses the help pages; see its note.
   */
  const join = joinLink(meeting.notes, meeting.location)
  /* NAMED, NOT COUNTED. "3 attendees" is the fact a calendar square has room for; on the meeting
     itself the question is who, and a count here would send somebody back to the email. */
  const people = meeting.attendees.filter((a) => a.name || a.email)

  return (
    <Modal title={meeting.title || 'Meeting'} onClose={onClose} width={520}>
      <dl className="space-y-3">
        <Line icon={<CalendarClock size={15} />} label="When" value={when} />
        {meeting.location && (
          <Line icon={<MapPin size={15} />} label="Where" value={meeting.location} />
        )}
        {/*
          WHO IT CAME FROM, which is the firm's own question twice over -- "who was that with? who
          did it come from?" The organiser is the person to ring if it has to move.
        */}
        {(meeting.organiserName || meeting.organiserEmail) && (
          <Line icon={<User size={15} />} label="Organised by"
            value={[meeting.organiserName, meeting.organiserEmail].filter(Boolean).join(' · ')} />
        )}
        {people.length > 0 && (
          <Line icon={<Users size={15} />} label={people.length === 1 ? 'Attendee' : 'Attendees'}
            value={(
              <span className="block space-y-0.5">
                {people.map((a, i) => (
                  <span key={`${a.email ?? a.name ?? i}`} className="block">
                    {a.name ?? a.email}
                    {a.name && a.email && <span className="text-slate-400"> · {a.email}</span>}
                  </span>
                ))}
              </span>
            )} />
        )}
        {meeting.notes && (
          <Line icon={<StickyNote size={15} />} label="Notes" value={
            /* The invitation's own words, wrapped as written. An agenda arrives as several lines
               and run together it reads as one sentence nobody can follow. */
            <span className="whitespace-pre-wrap wrap-anywhere">{meeting.notes}</span>
          } />
        )}
      </dl>

      {/*
        THE INVITATION ITSELF, AND IT OPENS THAT MESSAGE.

        `?message=` rather than `/mail`, which is the specific half of what the firm asked for.
        ABSENT where the meeting was made by hand: there is no invitation, and a button that lands
        somebody in an inbox with nothing selected is the fault this whole screen exists to fix.
      */}
      {/*
        JOIN, AND IT IS THE GOLD ONE. At two minutes past the hour it is the only control on this
        screen anybody wants; the invitation and the notes are what you read beforehand.
      */}
      {join && (
        <div className="mt-5">
          <a href={join} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-semibold px-3.5 py-2 rounded-lg
              border border-gold-500 bg-gold-400 text-navy-950 hover:bg-gold-500">
            <Video size={15} /> Join the meeting
          </a>
        </div>
      )}

      {meeting.userEmailId && (
        <div className={`${join ? 'mt-3' : 'mt-5'} pt-3 border-t border-slate-100`}>
          <Link to={`/mail?message=${encodeURIComponent(meeting.userEmailId)}`}
            className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg
              border border-slate-200 text-slate-600 hover:bg-slate-50">
            <Mail size={14} /> Open the invitation
          </Link>
        </div>
      )}
    </Modal>
  )
}

function Line({ icon, label, value }: {
  icon: React.ReactNode
  label: string
  value: React.ReactNode
}) {
  return (
    <div className="flex gap-2.5">
      <span className="mt-0.5 shrink-0 text-slate-300">{icon}</span>
      <div className="min-w-0">
        <dt className="text-[11px] uppercase tracking-wide text-slate-400">{label}</dt>
        <dd className="text-sm text-slate-700">{value}</dd>
      </div>
    </div>
  )
}
