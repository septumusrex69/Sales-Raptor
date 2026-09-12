import {
  Banknote, CalendarClock, FileSignature, FileSearch, HandCoins, Mail, MailOpen,
  MapPinned, MessageCircleQuestion, MessageSquare, MessagesSquare, Phone, ScrollText,
  StickyNote, Undo2, type LucideIcon,
} from 'lucide-react'
import type { TimelineEntry } from '../../lib/accountTimeline'

/**
 * What a timeline event looks like.
 *
 * Two rules. First, the icon says WHICH action it was — a call gets a phone, a trace gets a
 * map pin — because a collector scanning two years of history is looking for "when did we last
 * actually speak to them", and eleven identical document icons answer nothing.
 *
 * Second, the colours come from the Raptor palette (navy, gold, and the muted green and brick
 * that mean good and bad everywhere else in the app) rather than from Tailwind's stock emerald
 * and amber, which sit next to this navy looking like another app's palette pasted in.
 */
export interface TimelineStyle {
  icon: LucideIcon
  /** Background of the icon disc. */
  ring: string
  /** Icon colour. */
  fg: string
}

/** Money in is the good outcome; money going back out is the bad one. */
const PAYMENT: TimelineStyle = { icon: Banknote, ring: 'bg-positive-50', fg: 'text-positive' }
const REVERSAL: TimelineStyle = { icon: Undo2, ring: 'bg-negative-50', fg: 'text-negative' }
const PROMISE: TimelineStyle = { icon: HandCoins, ring: 'bg-gold-50', fg: 'text-gold-600' }
const NOTE: TimelineStyle = { icon: StickyNote, ring: 'bg-slate-100', fg: 'text-slate-500' }
/* A dispute takes the negative colour: it is the debtor pushing back, and it changes the call. */
const QUERY: TimelineStyle = { icon: MessageCircleQuestion, ring: 'bg-negative-50', fg: 'text-negative' }

/**
 * Everything we do to an account, by our own catalogue rather than by Swordfish's wording.
 *
 * Each channel gets its own colour as well as its own icon, because a collector scanning two
 * years of history is looking for a shape — "we phoned, phoned, phoned, then wrote" — and a
 * column of identical grey discs hides exactly that. The palette stays inside Raptor's own:
 * navy for the things we say, gold for the things that carry weight, green and brick reserved
 * for money in and money back out.
 */
const CHANNEL: Record<string, { icon: LucideIcon; ring: string; fg: string }> = {
  // Spoken to: the navy end of the palette, because a call is the ordinary work.
  phone_call: { icon: Phone, ring: 'bg-brand-100', fg: 'text-brand-600' },
  consultation: { icon: MessagesSquare, ring: 'bg-brand-100', fg: 'text-brand-600' },
  // Written to, electronically. Lighter navy: cheaper, and there are far more of them.
  sms: { icon: MessageSquare, ring: 'bg-brand-50', fg: 'text-brand-500' },
  whatsapp: { icon: MessagesSquare, ring: 'bg-brand-50', fg: 'text-brand-500' },
  email_out: { icon: Mail, ring: 'bg-brand-50', fg: 'text-brand-500' },
  // From them, not from us. Green, like a payment: the debtor made contact.
  email_in: { icon: MailOpen, ring: 'bg-positive-50', fg: 'text-positive' },
  // Paper that carries legal weight, and the paper they signed. Gold.
  letter: { icon: ScrollText, ring: 'bg-gold-50', fg: 'text-gold-600' },
  acknowledgement_of_debt: { icon: FileSignature, ring: 'bg-gold-100', fg: 'text-gold-600' },
  promise_to_pay: { icon: CalendarClock, ring: 'bg-gold-50', fg: 'text-gold-600' },
  // Looking for someone who does not want to be found.
  trace: { icon: MapPinned, ring: 'bg-navy-700/10', fg: 'text-navy-700' },
  perusal: { icon: FileSearch, ring: 'bg-navy-700/10', fg: 'text-navy-700' },
}

/**
 * Imported rows whose legacy name never mapped to a code still deserve the right icon and
 * colour, so the description is read as a fallback. Ordered: first pattern to match wins.
 */
const BY_DESCRIPTION: [RegExp, string][] = [
  [/\b(call|phone|tel)\b/i, 'phone_call'],
  [/\bwhats ?app\b/i, 'whatsapp'],
  [/\bsms\b/i, 'sms'],
  [/\be-?mail\b.*\b(in|incoming|received)\b/i, 'email_in'],
  [/\be-?mail\b/i, 'email_out'],
  [/\b(letter|demand|lod|notice)\b/i, 'letter'],
  [/\btrace\b/i, 'trace'],
  [/\b(perusal|document|file)\b/i, 'perusal'],
  [/\b(aod|acknowledge)/i, 'acknowledgement_of_debt'],
  [/\b(promise|ptp|arrangement)\b/i, 'promise_to_pay'],
]

const FALLBACK: TimelineStyle = { icon: ScrollText, ring: 'bg-slate-100', fg: 'text-slate-500' }

export function styleFor(entry: TimelineEntry): TimelineStyle {
  if (entry.kind === 'payment') return entry.status === 'reversed' ? REVERSAL : PAYMENT
  if (entry.kind === 'promise') return PROMISE
  // A note carrying an action code is a note ABOUT that action -- what was said on a call --
  // and wears its icon. Everything else a person types is a plain note.
  if (entry.kind === 'note') return (entry.actionCode ? CHANNEL[entry.actionCode] : undefined) ?? NOTE
  if (entry.kind === 'query') return QUERY

  const code = entry.actionCode ?? BY_DESCRIPTION.find(([re]) => re.test(entry.title))?.[1]
  const style: TimelineStyle = (code ? CHANNEL[code] : undefined) ?? FALLBACK

  // An action that could not be charged keeps its icon but loses its colour. The work happened
  // and belongs in the history; it just did not earn anything, and the eye should travel past it
  // to the rows that did.
  return entry.free ? { icon: style.icon, ring: 'bg-slate-50', fg: 'text-slate-300' } : style
}

/** Chip colours for a promise's outcome, in the same family. */
export const PROMISE_CHIP: Record<string, string> = {
  open: 'bg-gold-100 text-gold-600',
  kept: 'bg-positive-100 text-positive-700',
  broken: 'bg-negative-100 text-negative-700',
  cancelled: 'bg-slate-100 text-slate-500',
}
