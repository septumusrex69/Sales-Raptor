/**
 * THE KINDS OF NOTIFICATION RAPTOR SENDS, AND WHO HAS SWITCHED WHICH OFF (Raptor H19).
 *
 * The Notifications tab used to list ten switches from the demo ("Proposal viewed", "Meeting starting") with
 * nothing behind most of them, and kept nothing. Stephan, 9 Nov: show the real ones, and let each person switch any
 * of them off for themselves.
 *
 * A KIND is the part of notifications.type before the dot -- 'change_request.reply' is a change_request -- exactly as
 * the database's notification_kind() reads it. A person's switches are rows in notification_preferences (muted
 * true/false); a trigger on notifications drops a row for a kind its person has switched off, whoever writes it, so
 * the screen never has to remember to ask.
 *
 * The list was taken from every place Raptor writes a notification (schema.sql, api/_lib, src/store) and from what
 * staging holds, 9 Nov. A kind not named here still arrives -- it simply has no switch yet.
 */
export interface NotificationKind {
  kind: string
  label: string
  blurb: string
}

export const NOTIFICATION_KINDS: NotificationKind[] = [
  { kind: 'handover', label: 'Accounts handed out', blurb: 'Accounts given to you from a batch, and a batch with problems or referrals.' },
  { kind: 'client', label: 'A client given to you', blurb: 'You are made the liaison on a client.' },
  { kind: 'query', label: 'Disputes and queries', blurb: 'A dispute or query given to you to answer.' },
  { kind: 'workflow', label: 'Notice workflows', blurb: 'A notice step held and waiting on you.' },
  { kind: 'diary', label: 'Diary cover', blurb: 'Somebody else worked one of your accounts and moved its diary date.' },
  { kind: 'debtor', label: 'Debtor portal', blurb: 'A debtor’s question, arrangement offer or proof of payment.' },
  { kind: 'portal', label: 'Client portal', blurb: 'A client’s question, reply, callback, payment or new handover.' },
  { kind: 'mandate_signed', label: 'Mandates signed', blurb: 'A client signed a mandate online.' },
  { kind: 'campaign', label: 'Call campaigns', blurb: 'A collector kept an account from your campaign without a promise.' },
  { kind: 'change_request', label: 'Change requests', blurb: 'The light bulb: new requests, replies, questions and status changes.' },
  { kind: 'portal_photo', label: 'Portal photograph', blurb: 'Today’s portal photograph is not reaching clients.' },
]

/** The kind of a notification's type: the part before the first dot. Mirrors notification_kind() in SQL. */
export function notificationKind(type: string | null | undefined): string {
  return (type ?? '').split('.')[0]
}
