import { useEffect, useState, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import { Card } from '../ui/Card'
import { formatDate } from '../../data/mockData'

/**
 * The two lines the next person needs before they read anything else.
 *
 * The debtor's account has had this since the firm asked for it, and it is the first thing
 * anybody reads on that page. The sales side had nothing like it: a lead or a client could carry
 * forty activities and no answer to "what is going on here?" short of reading all forty. The firm
 * asked for it everywhere, and they were right.
 *
 * DELIBERATELY NOT A NOTE. A note is a thing that happened, dated, and belongs on the timeline
 * with the others. This is the current state of affairs, overwritten as it changes — which is why
 * it is a column on the record rather than a row in a list, and why editing it leaves no trail.
 *
 * `summary` is the other half of the same request: alongside the words, the facts you would
 * otherwise go hunting for — what services they want, what deals are open. Those live where they
 * always did; this puts them where the eye already is.
 */
export function RecordComment({ text, at, placeholder, summary, busy, onSave }: {
  text?: string
  /** When it was last written, so a stale summary looks stale. */
  at?: string
  /** What to prompt with when there is nothing written yet. */
  placeholder: string
  /** The at-a-glance facts — service chips, open deals. Shown whether or not anything is written. */
  summary?: ReactNode
  busy?: boolean
  onSave: (next: string) => void | Promise<unknown>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(text ?? '')

  // Somebody else's save, or a reload, should not leave a stale draft behind the Edit button.
  useEffect(() => setDraft(text ?? ''), [text])

  if (editing) {
    return (
      <Card className="border-gold-100 bg-gold-50">
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus rows={3}
          placeholder={placeholder}
          className="w-full text-sm rounded-lg border border-gold-100 px-3 py-2 resize-none bg-white focus:outline-none focus:ring-2 focus:ring-gold-100" />
        <div className="flex items-center gap-2 mt-2">
          <button type="button" disabled={busy}
            onClick={async () => { await onSave(draft.trim()); setEditing(false) }}
            className="text-sm font-medium px-3 py-1.5 rounded-lg bg-brand-600 text-white disabled:opacity-50 inline-flex items-center gap-1.5">
            <Check size={13} /> {busy ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={() => { setDraft(text ?? ''); setEditing(false) }}
            className="text-sm text-slate-500 hover:text-slate-700">Cancel</button>
        </div>
      </Card>
    )
  }

  return (
    // Gold when there is something to read, dashed when there is not: an empty card that looks
    // the same as a full one is a card people stop looking at.
    <Card className={text ? 'border-gold-100 bg-gold-50' : 'border-dashed'}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] uppercase tracking-wide text-gold-600 font-semibold">Main comment</p>
          {text
            ? <p className="text-sm text-navy-900 mt-1 whitespace-pre-wrap">{text}</p>
            : <p className="text-sm text-slate-400 mt-1">
                Nothing written yet. Two lines on where this stands saves the next person reading
                the whole history.
              </p>}
          {at && <p className="text-[11px] text-slate-400 mt-1.5">Updated {formatDate(at)}</p>}
          {summary && <div className="mt-3 pt-3 border-t border-gold-100/70">{summary}</div>}
        </div>
        <button type="button" onClick={() => setEditing(true)}
          className="text-xs text-brand-600 hover:underline shrink-0">
          {text ? 'Edit' : 'Write one'}
        </button>
      </div>
    </Card>
  )
}

/** One fact in the summary strip: a label and a value, read left to right. */
export function RecordCommentFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
      <div className="text-[13px] text-slate-700 mt-0.5 flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  )
}

/** The strip itself. Wraps rather than scrolling, because it sits at the top of the page. */
export function RecordCommentSummary({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-x-8 gap-y-3">{children}</div>
}
