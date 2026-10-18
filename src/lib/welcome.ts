/**
 * A NEW CLIENT'S WELCOME, AS STEPS (S8, 18 Oct; the firm: "inform that they've been contacted and
 * welcomed and introduced"). Derived, never stored as a status: each step is a fact already on the
 * client -- the mandate date, the assignment, the welcome email's date, and a CALL logged on the
 * client after the assignment. A stored "welcomed" flag would be one more thing to forget to tick.
 */
import type { Activity, Company, UserRole } from '../types'

export const isLiaisonRole = (role: UserRole | string): boolean => role === 'Liaison' || role === 'Liaison Manager'

export interface WelcomeStep { key: 'signed' | 'assigned' | 'emailed' | 'called'; label: string; done: boolean; when: string | null }

const day = (iso: string | undefined | null): string | null => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : null)

/** The welcome call is any call logged on the client from the day it was assigned. */
export function welcomeCall(company: Pick<Company, 'id' | 'liaisonAssignedAt'>, activities: Pick<Activity, 'type' | 'companyId' | 'activityDate'>[]) {
  if (!company.liaisonAssignedAt) return null
  const from = company.liaisonAssignedAt.slice(0, 10)
  return activities
    .filter((a) => a.companyId === company.id && (a.type === 'Courtesy Call' || a.type === 'Call') && a.activityDate.slice(0, 10) >= from)
    .sort((a, b) => a.activityDate.localeCompare(b.activityDate))[0] ?? null
}

export function welcomeSteps(
  company: Pick<Company, 'id' | 'mandateSignedAt' | 'liaisonAssignedAt' | 'welcomeSentAt'>,
  activities: Pick<Activity, 'type' | 'companyId' | 'activityDate'>[],
): WelcomeStep[] {
  const call = welcomeCall(company, activities)
  return [
    { key: 'signed', label: 'Mandate signed', done: !!company.mandateSignedAt, when: day(company.mandateSignedAt) },
    { key: 'assigned', label: 'Liaison assigned', done: !!company.liaisonAssignedAt, when: day(company.liaisonAssignedAt) },
    { key: 'emailed', label: 'Welcome email sent', done: !!company.welcomeSentAt, when: day(company.welcomeSentAt) },
    { key: 'called', label: 'Welcome call made', done: !!call, when: day(call?.activityDate) },
  ]
}
