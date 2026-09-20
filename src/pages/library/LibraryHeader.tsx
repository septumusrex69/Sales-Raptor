import { NavLink } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { Card } from '../../components/ui/Card'

/**
 * The top of both library screens, and the switch between them.
 *
 * WHY THE WORKFLOWS ARE HERE AT ALL, in the firm's own words: "if we are building a workflow,
 * currently it lives in the accounts section. I think it should live in the library section."
 * Which is right, and for a harder reason than tidiness — `workflow_nodes.template_id` points at
 * `message_templates`, so a step and the words it sends are one thing. While they lived three
 * screens apart the builder had no way to set that column at all: a communication step could be
 * created saying "send an email" with nothing to send, and the builder could count those and not
 * fix them.
 *
 * TWO SECTIONS AND NOT TABS INSIDE ONE PAGE, because a workflow deserves an address. The builder
 * used to be Settings -> Workflows -> click, with no URL, so there was no way to send anybody a
 * link to the workflow being argued about.
 */
export function LibraryHeader({ mayEdit }: { mayEdit: boolean }) {
  return (
    <Card padded={false}>
      <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-navy-950">Library</h2>
          <p className="text-sm text-slate-500 mt-0.5 max-w-3xl">
            Every message the firm sends and every sequence that sends it &mdash; written once and
            used everywhere, by a collector on an account, by a workflow on a day, and by a
            campaign across a list.
          </p>
        </div>
        {/*
          SAID ONCE, AT THE TOP, rather than beside every control that is missing. Everyone reads
          the library at the firm's instruction; only an administrator writes it. A person who
          cannot find Edit should not have to work out why from its absence.
        */}
        {!mayEdit && (
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-400 shrink-0">
            <Lock size={12} /> An administrator writes these
          </span>
        )}
      </div>
      <div className="px-5 flex gap-5 border-b border-slate-100">
        {[['/library', 'Templates'], ['/library/workflows', 'Workflows']].map(([to, label]) => (
          <NavLink key={to} to={to} end={to === '/library'}
            className={({ isActive }) => `py-2.5 text-sm border-b-2 -mb-px transition-colors ${
              isActive
                ? 'border-gold-400 font-medium text-navy-950'
                : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}>
            {label}
          </NavLink>
        ))}
      </div>
    </Card>
  )
}
