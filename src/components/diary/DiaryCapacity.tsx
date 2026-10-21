import { useEffect, useState } from 'react'
import { Check, Gauge, X } from 'lucide-react'
import { useAppStore } from '../../store/AppStore'
import { DEFAULT_DIARY_CAPACITY, MAX_DIARY_CAPACITY, MIN_DIARY_CAPACITY, validCapacity } from '../../lib/diaryPriority.ts'

/**
 * How many accounts this person means to work in a day.
 *
 * SET BY THE AGENT, ON THEIR OWN DIARY, at the firm's instruction — "the agent can control
 * himself and say, how many can I book per day". It is a working rate, not a target and not a
 * permission: nothing in the app refuses a booking because of it. What it does is give every
 * count in the diary a denominator, so "18" can be reported as "18 of 25" and a day that is
 * being overfilled can say so before it is.
 *
 * Thirty until somebody says otherwise. The number is not a firm policy — it is roughly what a
 * pre-legal desk gets through — and the whole point of putting it here is that the person doing
 * the work is the one who knows whether thirty is right for them.
 *
 * NOT SHOWN ON SOMEBODY ELSE'S DIARY. A team leader looking at an agent's day can see the
 * number in every load sentence; they cannot reach in and change it. Setting another person's
 * working rate for them is a conversation, not a control.
 */
export function DiaryCapacity({ userId, value, editable }: {
  userId: string | null
  /** The stored capacity, or null/undefined to show the firm default. */
  value: number | null | undefined
  /** False when this is a colleague's diary — the number still shows, the pencil does not. */
  editable: boolean
}) {
  const { updateUser } = useAppStore()
  const current = value && value > 0 ? value : DEFAULT_DIARY_CAPACITY
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(current))

  // Somebody else's change, or a different diary: the box should not keep showing the old one.
  useEffect(() => { setDraft(String(current)) }, [current])

  function save() {
    // Refused rather than clamped — see validCapacity. A refusal puts the old number back.
    const n = validCapacity(draft)
    if (n === null) { setDraft(String(current)); setEditing(false); return }
    if (userId && n !== current) updateUser(userId, { diaryCapacity: n })
    setEditing(false)
  }

  if (!editing) {
    const label = `${current} a day`
    if (!editable) {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-slate-400" title="This person's working rate">
          <Gauge size={13} />{label}
        </span>
      )
    }
    return (
      <button type="button" onClick={() => setEditing(true)}
        className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 rounded-lg px-2 py-1 hover:bg-slate-100 transition-colors"
        title="How many accounts you mean to work in a day">
        <Gauge size={13} />{label}
      </button>
    )
  }

  return (
    <span className="inline-flex items-center gap-1 text-xs text-slate-500">
      <Gauge size={13} className="text-slate-400" />
      <input
        autoFocus
        type="number"
        min={MIN_DIARY_CAPACITY}
        max={MAX_DIARY_CAPACITY}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save()
          if (e.key === 'Escape') { setDraft(String(current)); setEditing(false) }
        }}
        className="w-14 rounded-lg border border-slate-200 px-1.5 py-1 text-xs text-center tabular-nums outline-none focus:ring-2 focus:ring-brand-500/40"
      />
      <span>a day</span>
      <button type="button" onClick={save} title="Save"
        className="p-1 rounded-md text-[var(--c-fern)] hover:bg-slate-100"><Check size={13} /></button>
      <button type="button" onClick={() => { setDraft(String(current)); setEditing(false) }} title="Leave it"
        className="p-1 rounded-md text-slate-400 hover:bg-slate-100"><X size={13} /></button>
    </span>
  )
}
