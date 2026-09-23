import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * TELLING SOMEBODY A STEP DID NOT GO.
 *
 * A held step writes its reason onto the step, where it is perfectly correct and perfectly
 * invisible: nobody opens a workflow run to see what did not happen. The firm's own rule, from
 * the new-account carry-over, is the shape of this -- "it flags them and it flags the team leader
 * as well in the team leader's dashboard."
 *
 * ONLY WHEN THE REASON IS NEW. CLAUDE.md: a warning that fires when nothing is wrong is worse
 * than no warning, because people stop reading it. A section 129 waiting on a person waits every
 * morning until somebody releases it, and a notification each morning would teach the collector
 * to clear the bell without looking -- on the one message that means a statutory demand has not
 * gone out. So the caller compares the new reason with the reason already on the step, and only
 * a CHANGE is announced.
 *
 * THE COLLECTOR AND THEIR OWN TEAM'S LEADER, not every leader in the firm. Five pre-legal teams
 * carry one leader each, so fanning out would put five notifications on the floor for one account
 * nobody else can act on.
 */

export interface HeldNotice {
  accountId: string
  /** Whoever the account is assigned to. Null is itself one of the reasons a step holds. */
  collectorId: string | null
  /** What the debtor is called, for a message somebody can read without opening it. */
  debtorName: string | null
  /** Raptor's own reference, which is the one every notice quotes and the one people search on. */
  caseNumber: string | null
  /** The step, in the firm's words -- "Final notice", not a node key. */
  stepLabel: string
  /** Why it did not go, already written for the person who has to fix it. */
  reason: string
}

/**
 * Raise the notification, and return how many people were told.
 *
 * Returns 0 rather than throwing when there is nobody to tell: a step that could not be announced
 * is still a step that was correctly held, and failing the send loop over a notification would
 * turn a small problem into a silent morning.
 */
export async function notifyHeld(admin: SupabaseClient, notice: HeldNotice): Promise<number> {
  const audience = await whoToTell(admin, notice.collectorId)
  if (audience.length === 0) return 0

  const who = notice.debtorName?.trim() || 'an account'
  const ref = notice.caseNumber ? ` (${notice.caseNumber})` : ''
  const message = `${notice.stepLabel} for ${who}${ref} has not gone out. ${notice.reason}`

  const { error } = await admin.from('notifications').insert(
    audience.map((userId) => ({
      user_id: userId,
      type: 'workflow.held',
      message,
      /* Straight to the account, because every one of these reasons is fixed there -- a missing
         listing reference, an address, a wording nobody has written yet. */
      link: `/accounts/${notice.accountId}`,
    })),
  )
  return error ? 0 : audience.length
}

/**
 * The collector, and the leader of the collector's own team.
 *
 * WITH ONE FAN-OUT, DELIBERATELY. An account with nobody assigned has no collector to tell and no
 * team to find a leader in -- and it is the case a leader most needs to hear about, because a
 * live workflow on an unassigned account will not send anything at all until somebody is given
 * it. So that one goes to every pre-legal team leader. It is bounded by the number of teams, and
 * it is the only branch here that reaches past one desk.
 *
 * ADMINISTRATORS ARE NOT TOLD. `canLeadCollections` includes them because they may SEE the
 * floor's work; being shown it is not the same as being handed it every morning, and two more
 * notifications per hold is the noise that stops the bell meaning anything.
 */
async function whoToTell(admin: SupabaseClient, collectorId: string | null): Promise<string[]> {
  if (!collectorId) {
    const { data } = await admin.from('profiles').select('id').eq('role', 'Pre-legal Team Leader')
    return (data ?? []).map((p) => p.id as string)
  }

  const { data: collector } = await admin
    .from('profiles').select('id, team_id').eq('id', collectorId).maybeSingle()
  if (!collector) return []

  const out = new Set<string>([collector.id as string])
  if (collector.team_id) {
    const { data: leaders } = await admin
      .from('profiles').select('id')
      .eq('team_id', collector.team_id).eq('role', 'Pre-legal Team Leader')
    for (const l of leaders ?? []) out.add(l.id as string)
  }
  /* A collector with no team gets told alone. Not escalated to every leader in the firm: nobody
     has said whose floor they are on, and guessing wrong is how a notification lands on four
     people who cannot act on it. The gap is the missing team, and it shows up here as one
     person being told instead of two. */
  return [...out]
}
