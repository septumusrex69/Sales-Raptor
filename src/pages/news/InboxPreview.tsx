import { useState } from 'react'
import { Monitor, Smartphone, Tablet } from 'lucide-react'
import { splitFrom } from '../../lib/marketing.ts'

/**
 * THE EMAIL AS AN INBOX SHOWS IT (S13): the From name, the subject and the preheader on one line, the
 * way Gmail and Outlook list it, and then the message opened -- at a phone's width, an iPad's (the firm
 * works on one) or a desktop's. The firm asked for the campaign section to "look better"; a preview that
 * is only the body hides the two lines that decide whether anybody opens it.
 *
 * The body is the very HTML that is sent (renderCampaignEmail), in a sandboxed frame. The frame is
 * narrowed, never `transform: scale()`d: what wraps at 375 px here is what wraps on a phone.
 */
const WIDTHS = { phone: 375, tablet: 768, desktop: 0 } as const
type Width = keyof typeof WIDTHS

export function InboxPreview({ from, subject, preheader, html, recipientName, fromNote }: {
  /** "Name <address>" or a bare address, or null while it is not known. */
  from: string | null
  subject: string
  preheader: string
  html: string
  recipientName: string | null
  /** A line under the From when the From differs per recipient (liaison mode). */
  fromNote?: string | null
}) {
  const [width, setWidth] = useState<Width>('tablet')
  const { name, address } = splitFrom(from)
  const shownName = name || address || 'Bredell Ferreira News'
  const initial = shownName.trim().charAt(0).toUpperCase() || 'B'
  const px = WIDTHS[width]
  return (
    <div data-testid="news-inbox">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-slate-500">As {recipientName ?? 'somebody with no first name on file'} will see it</p>
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5" role="radiogroup" aria-label="Width">
          {([['phone', Smartphone, 'Phone'], ['tablet', Tablet, 'iPad'], ['desktop', Monitor, 'Desktop']] as const).map(([k, Icon, label]) => (
            <button key={k} type="button" role="radio" aria-checked={width === k} title={label} aria-label={label}
              data-testid={`news-width-${k}`} onClick={() => setWidth(k)}
              className={`p-1.5 rounded-md ${width === k ? 'bg-brand-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
              <Icon size={14} />
            </button>
          ))}
        </div>
      </div>
      <div className="rounded-xl border border-slate-200 bg-slate-100/70 p-3 overflow-x-auto">
        <div className="mx-auto transition-[max-width] duration-200" style={{ maxWidth: px ? `${px}px` : '100%' }}>
          {/* The line in the list of mail, before anybody opens it. */}
          <div className="rounded-t-lg bg-white border border-slate-200 px-3 py-2.5 flex items-start gap-3" data-testid="news-inbox-row">
            <div className="h-8 w-8 shrink-0 rounded-full bg-brand-600 text-white text-sm font-semibold grid place-items-center">{initial}</div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-semibold text-slate-900 truncate" data-testid="news-inbox-from">{shownName}</span>
                <span className="ml-auto text-xs text-slate-400 shrink-0">08:14</span>
              </div>
              <div className="text-sm truncate">
                <span className="font-semibold text-slate-800" data-testid="news-preview-subject">{subject || <span className="text-slate-400 font-normal">No subject yet</span>}</span>
                {preheader && <span className="text-slate-500"> — {preheader}</span>}
              </div>
            </div>
          </div>
          {/* The message, opened. */}
          <div className="bg-white border-x border-b border-slate-200 rounded-b-lg">
            <div className="px-3 py-2 border-b border-slate-100 text-xs text-slate-500 space-y-0.5">
              <div><span className="text-slate-400">From</span> <span className="text-slate-700">{name ? `${name} <${address}>` : address || '—'}</span></div>
              {fromNote && <div className="text-slate-500" data-testid="news-inbox-from-note">{fromNote}</div>}
            </div>
            <iframe title="Preview" sandbox="" srcDoc={html} className="w-full h-[30rem] bg-white rounded-b-lg" data-testid="news-preview" />
          </div>
        </div>
      </div>
    </div>
  )
}
