/**
 * WHO MUST CONFIRM A SIGN-IN WITH AN AUTHENTICATOR APP, AND WHAT THEY SEE (S8, 18 Oct; audit B-02).
 *
 * Pure, so a check can hold it: AdminTwoStep reads the session's assurance level and asks this.
 *   - 'none'  -- carry on: not an Administrator, or already confirmed this session (aal2);
 *   - 'code'  -- an Administrator with an authenticator: type the six digits;
 *   - 'enrol' -- an Administrator without one: set it up now.
 * Only Administrators, at the firm's ask: they are the role that can add people and move trust money.
 * Anybody else who has set one up is not asked here (Supabase still holds their factor).
 */
export type TwoStepState = 'none' | 'code' | 'enrol'

export function needsTwoStep(role: string | undefined | null, current: string | null, next: string | null): TwoStepState {
  if (role !== 'Administrator') return 'none'
  if (current === 'aal2') return 'none'
  return next === 'aal2' ? 'code' : 'enrol'
}
