import { useMemo, useState } from 'react'
import { Check, Loader2, RotateCcw, ShieldCheck } from 'lucide-react'
import { Modal } from '../ui/Modal'
import {
  CAPABILITIES, CAPABILITY_ORDER, ROLE_CAPABILITIES, capabilitiesOf, type Capability,
} from '../../lib/capabilities.ts'
import type { User } from '../../types'

/**
 * WHAT ONE PERSON MAY DO, AND WHAT THAT IS A DEPARTURE FROM.
 *
 * THE FIRM, SHOWING ME SWORDFISH'S OWN PERMISSION SCREENS: "every user has their own unique set of
 * permissions. So you can choose, for example, for a user to have a management template, but you
 * can add them more functionality."
 *
 * THE ONE THING THIS DOES THAT THEIRS DOES NOT, and it is the reason it exists rather than being a
 * grid of checkboxes: THE ROLE'S TEMPLATE IS VISIBLE BEHIND EVERY TICK. Swordfish's screens show
 * the answer and not the question, so a year later nobody can tell a deliberate exception from a
 * box somebody clicked by accident -- and on their own screens, nine ticks in ten are simply
 * whatever the template gave. Here each row says what the role gives, and anything else is marked
 * "added" or "removed" and can be put back in one press.
 *
 * FIFTEEN ROWS, NOT FIVE HUNDRED. Swordfish's four grids run to about 575 entries and two of them
 * are 93% ticked, because they are really feature switches -- E4, Archi, WhatsApp, Debicheck --
 * dressed as permissions. What is here is every capability Raptor actually enforces, and a new one
 * appears only in the commit that enforces it. A tick that checks nothing is worse than a missing
 * rule, because somebody relies on it.
 *
 * SAVED ON THE PRESS, NOT PER TICK. Somebody moving a person from one shape to another makes three
 * or four changes; writing each one is three or four chances to half-apply a decision, and the
 * database is not where a half-made mind belongs.
 */
export function CapabilitiesModal({ user, onClose, onSave }: {
  user: User
  onClose: () => void
  /** Writes both columns at once. Anything but an Administrator has the write silently reverted
      by protect_profile_privileged_fields, which is the real boundary -- see the schema. */
  onSave: (patch: { grants: string[]; revokes: string[] }) => Promise<void> | void
}) {
  const template = useMemo(() => new Set(ROLE_CAPABILITIES[user.role] ?? []), [user.role])
  /* WHAT THEY HAVE RIGHT NOW, through the same function the whole app asks. Recomputing it here
     from the two columns would be a second opinion about what this person may do. */
  const [held, setHeld] = useState<Set<Capability>>(() => capabilitiesOf(user))
  const [busy, setBusy] = useState(false)

  const toggle = (c: Capability) => setHeld((prev) => {
    const next = new Set(prev)
    if (next.has(c)) next.delete(c); else next.add(c)
    return next
  })

  /*
   * THE TWO COLUMNS ARE DERIVED FROM THE TICKS, never edited directly. A screen that let somebody
   * put a name in BOTH would be a screen where the answer depends on which field was edited last;
   * here a capability is either the template's, or added, or removed, and the difference from the
   * template is the only thing stored.
   */
  const grants = CAPABILITY_ORDER.filter((c) => held.has(c) && !template.has(c))
  const revokes = CAPABILITY_ORDER.filter((c) => !held.has(c) && template.has(c))
  const changed = grants.length > 0 || revokes.length > 0
  const dirty = JSON.stringify([...capabilitiesOf(user)].sort()) !== JSON.stringify([...held].sort())

  const groups = useMemo(() => {
    const out = new Map<string, Capability[]>()
    for (const c of CAPABILITY_ORDER) {
      const g = CAPABILITIES[c].group
      out.set(g, [...(out.get(g) ?? []), c])
    }
    return [...out]
  }, [])

  async function save() {
    setBusy(true)
    try {
      await onSave({ grants, revokes })
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`What ${user.name.split(' ')[0]} may do`}
      subtitle={`${user.role} — the ticks below start from what that role gives everybody`}
      onClose={onClose}
      width={620}
    >
      <div className="space-y-4">
        {groups.map(([group, caps]) => (
          <div key={group}>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{group}</p>
            <div className="mt-1.5 space-y-1">
              {caps.map((c) => {
                const on = held.has(c)
                const byRole = template.has(c)
                /* ADDED, REMOVED, or nothing at all. The third case is the common one and wears no
                   mark, so the exceptions are what the eye finds. */
                const mark = on && !byRole ? 'added' : !on && byRole ? 'removed' : null
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => toggle(c)}
                    className={`w-full text-left flex items-start gap-2.5 px-2.5 py-2 rounded-lg border transition-colors ${
                      mark ? 'border-[#c9a052] bg-gold-50' : 'border-transparent hover:bg-slate-50'}`}
                  >
                    <span className={`mt-0.5 w-4 h-4 rounded shrink-0 grid place-items-center ${
                      on ? 'bg-brand-600 text-white' : 'border border-slate-300 bg-white'}`}>
                      {on && <Check size={11} strokeWidth={3} />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-slate-700">
                        {CAPABILITIES[c].label}
                        {mark && (
                          <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--c-gold-deep)]">
                            {mark}
                          </span>
                        )}
                      </span>
                      {/* WHAT IT LETS SOMEBODY DO, under the name. A capability whose meaning lives
                          in its identifier is one people grant by guessing. */}
                      <span className="block text-[11px] text-slate-500 mt-0.5 leading-snug">
                        {CAPABILITIES[c].blurb}
                      </span>
                      {/* AND WHETHER TAKING IT AWAY ACTUALLY STOPS THEM. On the ones the database
                          enforces a revoke is a refusal; on the rest it only hides the button, and
                          saying which is the difference between a control and a decoration. */}
                      {CAPABILITIES[c].inDatabase && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-slate-400 mt-0.5">
                          <ShieldCheck size={10} /> Enforced by the database
                        </span>
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}

        {/*
          WHAT IS ABOUT TO BE STORED, IN WORDS, before it is stored. The whole point of the screen
          is that a departure stays legible -- so the thing that will actually be written to the two
          columns is said, rather than left to be inferred from a page of ticks.
        */}
        <div className="rounded-lg bg-slate-50 px-3 py-2.5 text-[11px] text-slate-600">
          {changed ? (
            <>
              {grants.length > 0 && (
                <p><span className="font-semibold">Added:</span>{' '}
                  {grants.map((c) => CAPABILITIES[c].label).join(', ')}</p>
              )}
              {revokes.length > 0 && (
                <p className={grants.length > 0 ? 'mt-0.5' : ''}>
                  <span className="font-semibold">Removed:</span>{' '}
                  {revokes.map((c) => CAPABILITIES[c].label).join(', ')}
                </p>
              )}
              <p className="mt-1 text-slate-400">
                Everything else is whatever a {user.role} gets. Change the role and these follow it.
              </p>
            </>
          ) : (
            <p>Exactly what a {user.role} gets, with nothing added or taken away.</p>
          )}
        </div>

        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy || !dirty}
            className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg bg-brand-600 text-white disabled:opacity-40"
          >
            {busy && <Loader2 size={15} className="animate-spin" />}
            Save
          </button>
          {/* BACK TO THE TEMPLATE IN ONE PRESS. Untick-and-retick across fifteen rows to undo an
              experiment is how a half-undone experiment gets saved. */}
          <button
            type="button"
            onClick={() => setHeld(new Set(template))}
            disabled={busy || !changed}
            className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-800 px-2 disabled:opacity-40"
          >
            <RotateCcw size={13} /> Back to what the role gives
          </button>
          <button type="button" onClick={onClose} className="text-sm text-slate-600 hover:text-slate-800 px-2 ml-auto">
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  )
}
