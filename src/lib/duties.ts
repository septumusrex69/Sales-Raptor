import type { Capability } from './capabilities.js'

/**
 * WHAT A DEPARTMENT ADDS TO ITS PEOPLE.
 *
 * THE FIRM (Stephan, 23 Oct): "a department, for example, like reception, which is just one person.
 * But they have other certain functionalities ... the transferring the call and transferring an
 * account ... different responsibilities."
 *
 * PERMISSIONS STAY ROLE-BASED. The role is what somebody may do, the department is where they sit --
 * and a duty is the one narrow bridge between the two: a thing a department's job needs that its
 * people's roles do not give them. Reception's person is an Administrator by role today ("just keep
 * her as an administrator for now"), but the day she is not, moving an account is still her job.
 *
 * A CLOSED LIST, the same argument capabilities.ts makes for itself: each duty arrives in the same
 * commit as whatever enforces it, and the database refuses any other value
 * (departments_duties_known). check-departments-teams holds this file against the SQL.
 *
 * A DUTY NEVER REACHES MONEY, TRUST, PAY OR SETTINGS. A duty can only grant what is in
 * DUTY_MAY_GRANT, which is book work and nothing else; settings are the Administrator ROLE, which a
 * duty does not touch. A department is something an Administrator makes in two clicks, and a
 * receptionist who could see the trust account because somebody ticked a box on a department would
 * be a permission nobody could find.
 */
export type Duty = 'transfer_calls' | 'reassign_accounts'

export interface DutyMeta {
  label: string
  /** What it lets the department's people do, and -- where it is true -- what is not built yet. */
  blurb: string
}

export const DUTIES: Record<Duty, DutyMeta> = {
  transfer_calls: {
    label: 'Transfers incoming calls',
    blurb: 'Reception answers the line and puts callers through. Recorded here so the department carries it; '
      + 'transferring calls inside Raptor is not built yet, so this changes nothing on screen today.',
  },
  reassign_accounts: {
    label: 'Moves accounts to people',
    blurb: 'Can put an account on somebody’s desk — the same hand-out a team leader has — whatever their role.',
  },
}

export const DUTY_ORDER = Object.keys(DUTIES) as Duty[]

/**
 * THE ONLY CAPABILITIES A DUTY MAY EVER GIVE. Mirrors duty_grantable() in the database. Widening it
 * is a decision, and check-departments-teams refuses anything from the Money group here.
 */
export const DUTY_MAY_GRANT: readonly Capability[] = ['book.hand_out']

/**
 * What each duty gives. Mirrors duty_capabilities() in the database.
 *
 * reassign_accounts IS 'book.hand_out' AND NOT 'book.reassign'. Hand-out is the account's desk --
 * debtor_accounts lets anybody signed in write assigned_to, so the tick is the whole gate and a duty
 * can open it. book.reassign is the SALES side's lead and deal owner, which the leads and deals RLS
 * still decides by role; giving it here would offer a button Postgres then refuses.
 */
export const DUTY_CAPABILITIES: Record<Duty, Capability[]> = {
  transfer_calls: [],
  reassign_accounts: ['book.hand_out'],
}

export function isDuty(v: string): v is Duty {
  return v in DUTIES
}

/** What these duties give, with anything outside DUTY_MAY_GRANT dropped -- a second fence, not the first. */
export function dutyCapabilities(duties: readonly string[] | undefined): Capability[] {
  const out = new Set<Capability>()
  for (const d of duties ?? []) {
    if (!isDuty(d)) continue
    for (const c of DUTY_CAPABILITIES[d]) if (DUTY_MAY_GRANT.includes(c)) out.add(c)
  }
  return [...out]
}
