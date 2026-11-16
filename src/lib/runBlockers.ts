/**
 * WHERE EACH REASON A PAYOVER RUN "CANNOT BE APPROVED YET" IS PUT RIGHT (Raptor H19).
 *
 * The run page listed payover_run_blockers and offered one link under all of them, "Work through the
 * exceptions", to /trust/exceptions. That is right for one kind of the four. Stephan, 16 Nov, on a run
 * held by "1 receipt(s) dated in this cycle still wait for approval": "when i go to review it does not
 * show anything" -- because a receipt waiting for approval is not an exception. It sits in the approval
 * queue on Payments in, and To sort never lists it. A link that lands on an empty page reads as the
 * blocker being wrong, which is worse than no link at all.
 *
 * So each kind names its own place. The kinds are the database's (payover_run_blockers in schema.sql);
 * check-run-blocker-links holds this list to that function in both directions, so a fifth kind added
 * there is a failure here rather than another link to the wrong page.
 */
export type RunBlockerKind = 'needs_rate' | 'excess_credit' | 'awaiting_approval' | 'no_client_code'

export interface BlockerAction {
  label: string
  to: string
}

export function blockerAction(kind: string, companyId: string): BlockerAction | null {
  switch (kind) {
    /* Approve, reject or park it in suspense -- all three happen on the queue itself. */
    case 'awaiting_approval': return { label: 'Approve them on Payments in', to: '/trust/payments' }
    /* What happens to an overpayment is decided on To sort: refund, move, release or park. */
    case 'excess_credit': return { label: 'Decide the credits on To sort', to: '/trust/exceptions' }
    /* Both are facts about the CLIENT, set on the client record, not anything a trust screen fixes. */
    case 'needs_rate': return { label: 'Set the commission on the client', to: `/companies/${companyId}` }
    case 'no_client_code': return { label: 'Give the client a code', to: `/companies/${companyId}` }
    default: return null
  }
}

/** The blockers' actions, one link per place even where two blockers share it. */
export function blockerActions(kinds: string[], companyId: string): BlockerAction[] {
  const seen = new Set<string>()
  const out: BlockerAction[] = []
  for (const k of kinds) {
    const a = blockerAction(k, companyId)
    if (a && !seen.has(a.to)) { seen.add(a.to); out.push(a) }
  }
  return out
}
