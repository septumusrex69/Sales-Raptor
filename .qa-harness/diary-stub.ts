/**
 * Stands in for src/lib/diary.ts during the offline layout render.
 *
 * RE-EXPORTS THE REAL MODULE and overrides only the two functions that would reach Supabase.
 * It used to list every export by hand, which meant it went stale the moment diary.ts grew a
 * function — and a stale stub fails the bundle, which is loud, but a stale BUNDLE is silent: the
 * page renders with yesterday's class names against today's stylesheet and the measurement lies
 * about a layout bug that was already fixed. That cost a wrong reading once; this cannot.
 *
 * build.mjs skips its own plugin for this file's import, or it would resolve to itself forever.
 */
export * from '../src/lib/diary.ts'

const loads = new Map<string, number>()
const base = Date.parse('2026-09-14T00:00:00Z')
for (let i = -14; i < 42; i += 1) {
  const d = new Date(base + i * 86400000).toISOString().slice(0, 10)
  loads.set(d, [0, 3, 44, 28, 31, 7, 12][Math.abs(i) % 7])
}

export async function fetchDayLoads() { return loads }

/** The tally beside "to go". Real one would reach Supabase. */
export async function countWorkedToday() { return 9 }

export async function fetchDay() {
  return {
    due: [
      { id: 'e1', accountId: 'a1', ownerId: 'u1', kind: 'promise_broken',
        reason: 'Agreed R2 500 on the 10th of the month and nothing came off the account at all.' },
      { id: 'e2', accountId: 'a2', ownerId: 'u1', kind: 'review', reason: null },
      { id: 'e3', accountId: 'a3', ownerId: 'u1', kind: 'callback', reason: 'Ring after the 12th.' },
    ],
    overdue: [],
  } as never
}
