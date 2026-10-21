/**
 * Stands in for src/lib/reminders.ts during the offline layout render.
 *
 * Re-exports the real module and overrides only what would reach Supabase — the same shape as
 * diary-stub.ts, and for the same reason: a stub that lists exports by hand goes stale the
 * moment the module grows one, and a stale bundle measures yesterday's markup in silence.
 */
export * from '../src/lib/reminders.ts'

export async function fetchDue() {
  return [
    {
      id: 'r1',
      accountId: 'a1',
      ownerId: 'u1',
      // Long enough ago to exercise the "hours late" wording, which is the common real case.
      dueAt: new Date(Date.now() - 95 * 60_000).toISOString(),
      body: 'Call Nomvula van der Westhuizen-Bekker back about the arrangement she asked for',
      state: 'waiting',
      snoozes: 3,
      account: {
        accountNumber: 'BF-10023',
        debtorFirstName: 'Nomvula',
        debtorSurname: 'van der Westhuizen-Bekker',
      },
    },
    { id: 'r2', accountId: 'a2', ownerId: 'u1', dueAt: new Date().toISOString(), body: 'Second one',
      state: 'waiting', snoozes: 0,
      account: { accountNumber: 'BF-10024', debtorFirstName: 'Sipho', debtorSurname: 'Dlamini' } },
  ] as never
}
