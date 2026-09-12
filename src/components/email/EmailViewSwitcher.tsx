import { Columns2, Rows3 } from 'lucide-react'
import type { EmailView } from '../../lib/emailView'

/**
 * List or reading pane, chosen where the email is.
 *
 * Two icons rather than words, and the same segmented control as the account Overview's layout
 * switcher — this is the same kind of choice and should not look like a different mechanism.
 *
 * Hidden below lg, where it would be a control with nothing to offer: a reading pane needs two
 * columns, and two columns inside an iPad's width gives a list too narrow to read and a message
 * too narrow to read. Below that everything is the list, and the choice is remembered for when
 * the person is back at a desk.
 */
const OPTIONS: { id: EmailView; label: string; icon: typeof Rows3; hint: string }[] = [
  { id: 'list', label: 'List', icon: Rows3, hint: 'One column; opening a message expands it in place' },
  { id: 'reading', label: 'Reading pane', icon: Columns2, hint: 'The list on the left, the message beside it' },
]

export function EmailViewSwitcher({ view, onChange, className = '' }: {
  view: EmailView
  onChange: (next: EmailView) => void
  className?: string
}) {
  return (
    <div className={`hidden lg:flex items-center gap-0.5 rounded-lg border border-slate-200 p-0.5 ${className}`}>
      {OPTIONS.map((o) => (
        <button key={o.id} type="button" onClick={() => onChange(o.id)}
          title={`${o.label} — ${o.hint}`} aria-label={o.label} aria-pressed={view === o.id}
          className={`p-1.5 rounded-md ${view === o.id
            ? 'bg-navy-950 text-white'
            : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}>
          <o.icon size={15} />
        </button>
      ))}
    </div>
  )
}
