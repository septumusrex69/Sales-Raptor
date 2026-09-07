import { useAppStore } from '../store/AppStore'
import type { ID } from '../types'

/**
 * Who owns this record, shown in the hero band on a Client or Lead.
 *
 * Whose desk a record sits on decides who to ask about it, so it belongs at the top — but
 * beside the name rather than lined up among the figures, where it competed with them for
 * attention and pushed the real numbers along. The label differs by record because the job
 * does: a lead is worked by whoever is selling to them, a client is serviced by their liaison.
 */
export function HeroOwner({ ownerId, label }: { ownerId?: ID; label: string }) {
  const { userById } = useAppStore()
  const owner = ownerId ? userById(ownerId) : undefined

  // No avatar. One person's initial in a circle identifies nobody you didn't already read in
  // the name beside it, and it pulled the eye to the corner of a band whose subject is the
  // record, not its owner.
  //
  // The nudge down is optical, not structural: the name on the left sits under a taller
  // eyebrow and is set much larger, so two blocks aligned to the same top edge don't read as
  // level. This puts the two names on roughly the same line, which is the alignment the eye
  // actually looks for.
  return (
    <div className="mt-2.5 text-right leading-tight">
      <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-gold-500">{label}</p>
      <p className="text-sm font-semibold text-white">{owner?.name ?? 'Unassigned'}</p>
      {owner?.role && <p className="text-[11px] text-white/50">{owner.role}</p>}
    </div>
  )
}
