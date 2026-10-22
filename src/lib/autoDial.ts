/**
 * AUTO-DIAL: THE NEXT CAMPAIGN CALL RINGS ITSELF (S10, 22 Oct).
 *
 * The firm asked for an automatic dialler. This is the one Raptor can honestly build on what it
 * has: BuzzBox click-to-dial rings the collector's own extension and bridges the debtor when they
 * pick up. With auto-dial on, landing on the next CAMPAIGN account in a diary run ("Done & next")
 * places that call without the press -- the same call the Call button places, charged and asked
 * about the same way (CallButton listens for the event below and runs its own path), because an
 * auto-dialled call that skipped item 2 or the consultation question would be a second, cheaper
 * kind of call nobody decided to have.
 *
 * NEVER WITHOUT BUZZBOX. A tel: link hands the number to the device; it cannot be pressed by a
 * page, and a page that tried would either do nothing or open a dialler the collector did not ask
 * for. So without BuzzBox and an extension this does nothing automatic, and the bar says so in one
 * line.
 *
 * NEVER OUTSIDE THE CALLING HOURS (contactHours.ts) -- the firm's own hours, which a machine is
 * held to more strictly than a person, not less.
 *
 * ONCE PER VISIT. React runs an effect twice in development and re-renders often; a call placed
 * twice is two calls to a debtor and two item 2 fees. The guard is keyed on the diary entry AND the
 * navigation that reached it (react-router's location.key), held outside React, so a re-render or a
 * double effect cannot dial again but coming back to the account later is a new visit.
 */
import { callHoursProblem } from './contactHours.js'

/** The browser's memory of the toggle. Per browser on purpose: it is a way of working, not a record. */
export const AUTO_DIAL_KEY = 'raptor.diary.autoDial'

export function readAutoDial(): boolean {
  try { return localStorage.getItem(AUTO_DIAL_KEY) === 'on' } catch { return false }
}

export function writeAutoDial(on: boolean): void {
  try { localStorage.setItem(AUTO_DIAL_KEY, on ? 'on' : 'off') } catch { /* private window: forgets, nothing else */ }
}

export type AutoDialDecision =
  | { dial: true; number: string }
  | { dial: false; why: string | null }

/**
 * SHOULD THIS VISIT DIAL? `why` is the one line the bar shows where it will not -- null where there
 * is nothing worth saying (auto-dial off, or not a campaign call).
 */
export function autoDialDecision(input: {
  enabled: boolean
  /** BuzzBox is connected AND this person has an extension (BuzzBoxContext.canDial). */
  canDial: boolean
  isCampaignCall: boolean
  number: string | null
  /** Johannesburg's day and minute of the day, from the firm's clock. */
  day: string
  minute: number
  /** This visit has already dialled (claimAutoDial said no). */
  alreadyDialled: boolean
}): AutoDialDecision {
  if (!input.enabled || !input.isCampaignCall) return { dial: false, why: null }
  if (!input.canDial) return { dial: false, why: 'Auto-dial needs BuzzBox and your extension; a phone link cannot be dialled for you.' }
  if (!input.number?.trim()) return { dial: false, why: 'No number on this account to dial.' }
  const hours = callHoursProblem(input.day, input.minute)
  if (hours) return { dial: false, why: `Not dialling: ${hours}` }
  if (input.alreadyDialled) return { dial: false, why: null }
  return { dial: true, number: input.number.trim() }
}

const claimed = new Set<string>()

/** True the first time a visit asks, false ever after: the guard against a second call. */
export function claimAutoDial(entryId: string, visitKey: string): boolean {
  const key = `${entryId}|${visitKey}`
  if (claimed.has(key)) return false
  claimed.add(key)
  return true
}

/** Whether this visit has already claimed its call, without claiming it. */
export function autoDialClaimed(entryId: string, visitKey: string): boolean {
  return claimed.has(`${entryId}|${visitKey}`)
}

/** The event the work bar sends and CallButton answers, so the call placed is CallButton's own. */
export const AUTO_DIAL_EVENT = 'raptor:auto-dial'
export const AUTO_DIAL_RESULT_EVENT = 'raptor:auto-dial-result'
export interface AutoDialRequest { accountId: string; number: string }
export interface AutoDialResult { accountId: string; ok: boolean; error?: string }

/** A number shown short, the way a collector reads one off the screen: "082 555 1234". */
export function dialWords(number: string): string {
  const d = number.replace(/[^\d+]/g, '')
  return /^0\d{9}$/.test(d) ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : number.trim()
}
