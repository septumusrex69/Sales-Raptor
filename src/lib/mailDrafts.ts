/**
 * UNSENT EMAIL, KEPT (S15). Stephan: "Perhaps there's also not a bad idea to add a drafts section ... if you
 * are writing an email and something happens, it's annoying." Every compose box saves what is in it as it is
 * typed, under a key for what it is (a reply to this message, a forward of that one, a new email); closing
 * the box, a page that reloads, a laptop that sleeps -- the words are still here, offered back the next time
 * the same box opens, and listed under Drafts on the Mail page. Sending removes it.
 *
 * IN THIS BROWSER, and said so: it is a convenience against losing work, not a mailbox. Every read and write
 * is wrapped, because a private window or an iPad with site data blocked throws on access -- and then there
 * is simply no draft, never a broken compose box.
 */
import { clockNowMs } from './clock.ts'

export interface MailDraft {
  key: string
  /** What the box was, said for the Drafts list: "Forward", "Reply to x", "New Email". */
  title: string
  to: string
  cc: string
  subject: string
  body: string
  inReplyTo: string | null
  /** The forwarded original as edited, where it fits; a draft too large to keep keeps the words only. */
  quotedHtml: string | null
  savedAt: number
}

const STORE = 'raptor.mail.drafts'
const MAX_DRAFTS = 30
const MAX_QUOTED = 150_000

function read(): MailDraft[] {
  try {
    const raw = localStorage.getItem(STORE)
    const list = raw ? JSON.parse(raw) as MailDraft[] : []
    return Array.isArray(list) ? list : []
  } catch { return [] }
}
function write(list: MailDraft[]): void {
  try { localStorage.setItem(STORE, JSON.stringify(list)) } catch { /* nowhere to keep it; nothing to break */ }
}

export function listDrafts(): MailDraft[] {
  return read().sort((a, b) => b.savedAt - a.savedAt)
}
export function findDraft(key: string): MailDraft | null {
  return read().find((d) => d.key === key) ?? null
}
export function saveDraft(d: Omit<MailDraft, 'savedAt'>): void {
  const quoted = d.quotedHtml && d.quotedHtml.length <= MAX_QUOTED ? d.quotedHtml : null
  const rest = read().filter((x) => x.key !== d.key)
  write([{ ...d, quotedHtml: quoted, savedAt: clockNowMs() }, ...rest].slice(0, MAX_DRAFTS))
}
export function dropDraft(key: string): void {
  write(read().filter((d) => d.key !== key))
}

/** The key for a compose box: the same box opened again finds its draft; a different one does not. */
export function draftKeyFor(input: { title?: string | null; to?: string | null; subject?: string | null; inReplyTo?: string | null; forwardOf?: string | null }): string {
  return [input.forwardOf ? `fwd:${input.forwardOf}` : '', input.inReplyTo ? `re:${input.inReplyTo}` : '',
    input.title ?? '', input.to ?? '', input.subject ?? ''].join('|')
}
