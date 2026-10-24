import { isWorkingDay } from './workingDays.js'

/**
 * A BATCH NOBODY HANDED OUT IS SAID TO THE PEOPLE WHO LOOK AFTER ITS CLIENT (S11).
 *
 * THE FIRM, asked who should hear about a handover nobody handed out: "I think that's still also with
 * the liaison and the liaison manager." Until now the only sign was a line on Settings -> Data
 * Import ("A recent handover has accounts on nobody's desk"), which is a screen somebody has to be
 * on. Accounts on nobody's desk get no diary entry, no workflow and no call: the new-account rule
 * (newAccounts.ts) cannot carry into the day what was never put on a desk.
 *
 * HOW IT HAPPENS, which is why the loader is not the only one told: the loader could not hand out
 * (a liaison, until S11 let her hand out what she may load); the loader closed the hand-out the
 * import opens and was pulled away; or accounts were taken off a desk and put back in the pile.
 *
 * THE FIRST WORKING MORNING AFTER IT CAME IN, AND ONCE. The import already ends ON the hand-out, so
 * the same day is the loader's own to finish; a batch loaded at four on a Friday is not late on
 * Saturday with nobody in the building. Once, because the task it raises stays open until the
 * batch is handed out -- a notification every morning is the warning people learn to clear without
 * reading. The morning run (api/workflow/run, 06:00) asks this; workingDays.ts is the only place
 * that knows a public holiday, which is why it is not a database job.
 */

/** Whether a batch received on `receivedOn` (yyyy-mm-dd, Johannesburg) is due its reminder `today`. */
export function handoutReminderDue(receivedOn: string, today: string, extra: Record<string, string> = {}): boolean {
  return receivedOn < today && isWorkingDay(today, extra)
}

/**
 * WHO IS TOLD: the client's liaison and every Liaison Manager, each once. No liaison on the client
 * is the managers alone -- which is also the case where somebody most needs to look.
 */
export function handoutReminderRecipients(liaisonId: string | null, liaisonManagerIds: readonly string[]): string[] {
  return [...new Set([...(liaisonId ? [liaisonId] : []), ...liaisonManagerIds])]
}

/** The task's title. Also how an open reminder is recognised, so it is written in one place. */
export function handoutTaskTitle(unallocated: number, clientName: string | null): string {
  return `Hand out ${unallocated} ${unallocated === 1 ? 'account' : 'accounts'}: ${clientName ?? 'a client'}`
}

export function handoutReminderMessage(unallocated: number, total: number, clientName: string | null, reference: string | null): string {
  return `${unallocated} of ${total} ${total === 1 ? 'account' : 'accounts'} from ${clientName ?? 'a client'}'s batch`
    + `${reference ? ` ${reference}` : ''} ${unallocated === 1 ? 'is' : 'are'} on nobody's desk. Hand them out so they are worked.`
}

/** Where the notification and the task open: the batch, straight into its hand-out. */
export function handoutLink(handoverId: string): string {
  return `/accounts?handover=${handoverId}&handout=1`
}
