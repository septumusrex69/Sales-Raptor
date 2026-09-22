/**
 * What goes back to the client when a handover is accepted with something wrong on it.
 *
 * THE FIRM: "after this has been imported, if it was accepted with mistakes it should create a
 * client query -- now we are going to distinguish between a debtor dispute and a client query --
 * so it'll go on the client's account that there is an import correction needed on a specific
 * file, and all of the problems would be listed on there, and that would be flagged at the client
 * liaison. Also an email will be created and sent to the client liaison with the problems ... it
 * will show the client reference number and what is needed, what is the problem with that ... so
 * the client liaison can easily forward that to the client."
 *
 * TWO THINGS OUT OF ONE SET OF FACTS, and they are built here together so they cannot drift: a
 * query per account, which is how the firm chases it, and one email to the liaison, which is how
 * the client hears about it. Written apart, the email would say one thing and the queries another
 * the first time a message was reworded.
 *
 * A QUERY PER ACCOUNT, NOT ONE PER FILE. An import correction is something the client has to fix
 * on a named debtor, and it is answered, chased and closed one account at a time -- which is what
 * account_queries already does. One query per file would be a to-do list nobody could close half
 * of, hanging off an account it was only partly about.
 *
 * PURE: no database, no fetch, no supabase. The wording is the part worth being sure of, because
 * it leaves the building.
 */

export interface CorrectionRow {
  /** The client's own reference — what they will look the account up by. */
  reference: string | null
  /** The debtor, so a person reading the email knows who it is about. */
  name: string | null
  /** Every problem left on the row when it was accepted. */
  problems: { key: string | null; message: string; level: 'refuse' | 'warn' }[]
  /** The row as it arrived, for showing the client what their own sheet said. */
  values: Record<string, string | null>
  /** What the person accepting it wrote, if anything. */
  note: string | null
}

/** A column key to the heading a client would recognise. Injected, so this file stays pure. */
export type LabelFor = (key: string) => string

/**
 * The query's description: what the client has to fix, on this account.
 *
 * The note the accepting person typed leads, because it is the instruction; the problems follow
 * as the evidence. Same order as the note that goes on the account, for the same reason.
 */
export function correctionDescription(row: CorrectionRow): string {
  const typed = (row.note ?? '').trim()
  const lines = row.problems.map((p) => `• ${p.message}`)
  const head = typed
    || 'Accepted on import with the following outstanding, for the client to confirm:'
  return [head, '', ...lines].join('\n')
}

/* ---------------------------------------------------------------- the email */

const esc = (v: string) => v
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** What the client's sheet actually had in the box the problem is about. */
export function givenFor(row: CorrectionRow, key: string | null): string {
  if (!key) return '—'
  const v = (row.values[key] ?? '').trim()
  /* NOT AN EMPTY CELL. A blank column in a table of problems reads as "we forgot to fill this
     in", which is the opposite of the point — the emptiness IS the problem. */
  return v || '(nothing)'
}

export interface CorrectionEmail {
  subject: string
  bodyHtml: string
  /** How many accounts it is about, for the note that records it was sent. */
  accounts: number
}

/**
 * The email to the client liaison.
 *
 * WRITTEN TO BE FORWARDED, at the firm's instruction: "so the client liaison can easily forward
 * that to the client." So it is addressed to the client throughout — "your sheet", "could you
 * confirm" — and carries nothing internal. A liaison who has to rewrite it before sending it on
 * is a liaison who will not send it on.
 *
 * FOUR COLUMNS, because the firm named three of them and the fourth is what makes the other
 * three usable: the reference to look it up by, the FIELD, what the sheet said, and what we need.
 * Without the field, "0823456789 is not an ID number" makes the reader hunt for which column that
 * was.
 */
export function correctionEmail(input: {
  clientName: string
  filename: string
  /** Today, as an ISO day. Formatted here so the caller cannot pass a different shape. */
  today: string
  rows: CorrectionRow[]
  labelFor: LabelFor
}): CorrectionEmail {
  const { clientName, filename, rows, labelFor } = input
  const when = new Date(`${input.today}T00:00:00Z`).toLocaleDateString('en-ZA', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  })

  const cells = rows.flatMap((row) => row.problems.map((p) => `
    <tr>
      <td style="padding:6px 10px;border:1px solid #d9dee6;white-space:nowrap">${esc(row.reference ?? '—')}</td>
      <td style="padding:6px 10px;border:1px solid #d9dee6">${esc(row.name ?? '—')}</td>
      <td style="padding:6px 10px;border:1px solid #d9dee6">${esc(p.key ? labelFor(p.key) : '—')}</td>
      <td style="padding:6px 10px;border:1px solid #d9dee6">${esc(givenFor(row, p.key))}</td>
      <td style="padding:6px 10px;border:1px solid #d9dee6">${esc(p.message)}</td>
    </tr>`).join(''))

  const accounts = rows.length
  const bodyHtml = `
<p>Good day,</p>
<p>We have today brought in the handover sheet <strong>${esc(filename)}</strong> for
${esc(clientName)}. The accounts are open and being worked — nothing is waiting on this —
but there were ${accounts === 1 ? 'one account' : `${accounts} accounts`} where the information on
the sheet could not be used as it stands.</p>
<p>Could you please have a look at the list below and let us know whether the details are correct,
or whether you have anything further on your side that we can correct these with.</p>
<table style="border-collapse:collapse;font-size:13px;font-family:Calibri,Arial,sans-serif">
  <thead>
    <tr style="background:#1b2a4a;color:#ffffff;text-align:left">
      <th style="padding:6px 10px;border:1px solid #1b2a4a">Your reference</th>
      <th style="padding:6px 10px;border:1px solid #1b2a4a">Debtor</th>
      <th style="padding:6px 10px;border:1px solid #1b2a4a">Field</th>
      <th style="padding:6px 10px;border:1px solid #1b2a4a">What your sheet says</th>
      <th style="padding:6px 10px;border:1px solid #1b2a4a">What we need</th>
    </tr>
  </thead>
  <tbody>${cells.join('')}</tbody>
</table>
<p>Kind regards</p>`.trim()

  return {
    subject: `${clientName} — handover ${when}: ${accounts} account${accounts === 1 ? '' : 's'} `
      + 'need correcting',
    bodyHtml,
    accounts,
  }
}
