import {
  Banknote, CalendarClock, FileSignature, FileSearch, HandCoins, Mail, MailOpen,
  MapPinned, MessageSquare, MessagesSquare, Phone, RotateCcw, ScrollText, StickyNote,
  Undo2, type LucideIcon,
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

/** Everything we do to an account, by our own catalogue rather than by Swordfish's wording. */
const BY_ACTION_CODE: Record<string, LucideIcon> = {
  phone_call: Phone,
  sms: MessageSquare,
  whatsapp: MessagesSquare,
  email_out: Mail,
  email_in: MailOpen,
  letter: ScrollText,
  trace: MapPinned,
  perusal: FileSearch,
  consultation: MessagesSquare,
  acknowledgement_of_debt: FileSignature,
  promise_to_pay: CalendarClock,
}

/**
 * Imported rows whose legacy name never mapped to a code still deserve the right icon, so the
 * description is read as a fallback. Ordered: the first pattern that matches wins.
 */
const BY_DESCRIPTION: [RegExp, LucideIcon][] = [
  [/\b(call|phone|tel)\b/i, Phone],
  [/\bwhats ?app\b/i, MessagesSquare],
  [/\bsms\b/i, MessageSquare],
  [/\be-?mail\b/i, Mail],
  [/\b(letter|demand|lod|notice)\b/i, ScrollText],
  [/\btrace\b/i, MapPinned],
  [/\b(perusal|document|file)\b/i, FileSearch],
  [/\b(aod|acknowledge)/i, FileSignature],
  [/\b(promise|ptp|arrangement)\b/i, CalendarClock],
  [/\b(reversal|returned|unpaid|rd)\b/i, RotateCcw],
]

export function styleFor(entry: TimelineEntry): TimelineStyle {
  if (entry.kind === 'payment') return entry.status === 'reversed' ? REVERSAL : PAYMENT
  if (entry.kind === 'promise') return PROMISE
  if (entry.kind === 'note') return NOTE

  const byCode = entry.actionCode ? BY_ACTION_CODE[entry.actionCode] : undefined
  const icon = byCode ?? BY_DESCRIPTION.find(([re]) => re.test(entry.title))?.[1] ?? ScrollText
  // An action that could not be charged is history, not money, so it sits back: grey disc rather
  // than navy, which lets the charged work and the payments carry the eye down the column.
  return entry.free
    ? { icon, ring: 'bg-slate-50', fg: 'text-slate-400' }
    : { icon, ring: 'bg-brand-50', fg: 'text-brand-500' }
}

/** Chip colours for a promise's outcome, in the same family. */
export const PROMISE_CHIP: Record<string, string> = {
  open: 'bg-gold-100 text-gold-600',
  kept: 'bg-positive-100 text-positive-700',
  broken: 'bg-negative-100 text-negative-700',
  cancelled: 'bg-slate-100 text-slate-500',
}
