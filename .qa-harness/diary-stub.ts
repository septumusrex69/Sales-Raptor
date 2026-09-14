/** Stands in for src/lib/diary.ts during the offline layout render — no database, fixed loads. */
const loads = new Map<string, number>()
const base = Date.parse('2026-09-14T00:00:00Z')
for (let i = -14; i < 42; i += 1) {
  const d = new Date(base + i * 86400000).toISOString().slice(0, 10)
  loads.set(d, [0, 3, 44, 28, 31, 7, 12][Math.abs(i) % 7])
}
export async function fetchDayLoads() { return loads }
export type DayLoads = Map<string, number>
export type DiaryEntry = Record<string, unknown>
export type DiaryRow = Record<string, unknown>
export type DayOfWork = { due: DiaryRow[]; overdue: DiaryRow[] }
export type AgentLoad = Record<string, unknown>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function debtorName(r: any) {
  return [r.account?.debtorFirstName, r.account?.debtorSurname].filter(Boolean).join(' ')
}
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
export async function fetchTeamLoad() { return [] }
export async function fetchOverdue() { return [] }
export async function fetchAccountDiary() { return [] }
export async function fetchStripLoads() { return loads }
export async function completeEntry() { return {} }
export async function moveEntry() { return {} }
export async function bulkMove() { return { moved: 0, failed: [] } }
export async function cancelEntry() {}
export async function diarise() { return {} }
