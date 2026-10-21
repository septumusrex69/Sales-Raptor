/**
 * DOING A LIST OF SLOW THINGS A FEW AT A TIME.
 *
 * THE FIRM: "the company's got 50 people, so in 60 seconds it doesn't sync anything -- or it syncs
 * two people and the third person is not synced. You still have a loophole in your method."
 *
 * THEY ARE DESCRIBING A SERIAL LOOP, and that is exactly what the mail sweep was: fifty mailboxes,
 * one after another, each one waiting on a mail server on the other side of the world before the
 * next one starts. sync-all.ts has carried a note admitting it since the day it was written --
 * "this route is the wrong shape for that many mailboxes".
 *
 * NEARLY ALL OF THAT TIME IS WAITING, NOT WORKING. A mailbox sync is a TLS handshake, a LOGIN and
 * a UID SEARCH per folder; the function spends it idle. Fifty of them a few at a time finish in
 * about the time five of them took.
 *
 * A FEW, NOT ALL FIFTY. Every mailbox in this firm is on the same mail server, and a server that
 * is asked for fifty simultaneous connections refuses some of them -- which would turn a sweep
 * that reached everybody slowly into one that reaches nobody quickly.
 *
 * ORDER STILL DECIDES WHO GOES FIRST. Each worker takes the next item off the front, so a list
 * sorted oldest-first is still started oldest-first -- which is the whole of the starvation fix
 * and must survive being made concurrent.
 *
 * Pure: no database, no network, no clock. Give it a list and something to do with each one.
 */

/**
 * Run `work` over `items`, at most `size` at a time.
 *
 * NEVER REJECTS. A worker that threw would abandon everything behind it in the queue -- fifty
 * mailboxes stopped by one bad password is the failure this shape exists to avoid. `work` is
 * expected to catch its own, and anything that escapes is swallowed here rather than taking the
 * rest of the list with it.
 */
export async function inPool<T>(
  items: T[],
  size: number,
  work: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const width = Math.max(1, Math.min(Math.floor(size), items.length))
  if (items.length === 0) return
  let next = 0
  const worker = async () => {
    for (;;) {
      const i = next
      next += 1
      if (i >= items.length) return
      try {
        await work(items[i], i)
      } catch {
        /* See above: one item's failure is not the list's. */
      }
    }
  }
  await Promise.all(Array.from({ length: width }, worker))
}
