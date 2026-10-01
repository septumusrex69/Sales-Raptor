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

/** "1 account" / "2 accounts", because "1 accounts" went out to a client once already. */
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * ONE QUERY FOR THE WHOLE SHEET, in words.
 *
 * THE FIRM: "let's say there's a handover sheet of 500 imports and 50 of them have problems. Now
 * there'll be 50 different individual queries. I think we should have a query per handover sheet."
 *
 * It was one query per row, which on a real batch is a liaison's client page turned into fifty
 * copies of the same sentence about fifty different debtors -- and fifty things to chase and
 * close separately when the client answers all of them in one reply. The correction is one
 * conversation about one file, so it is one query about one batch.
 *
 * A SUMMARY, NOT THE TABLE. The rows themselves are not copied in here: they are read back off
 * the frozen draft wherever the query is opened, which keeps one record of what was wrong rather
 * than a description that was true on the day it was written. What this has to do is say enough
 * that the line on a client's page means something without opening it.
 */
export function batchQueryDescription(input: {
  filename: string
  /** Opened, but something on them needs the client to confirm it. */
  toConfirm: number
  /** Not opened at all: refused, or thrown out. */
  notBroughtIn: number
}): string {
  const parts: string[] = []
  if (input.notBroughtIn > 0) {
    parts.push(`${count(input.notBroughtIn, 'account', 'accounts')} could not be opened and `
      + `${input.notBroughtIn === 1 ? 'needs' : 'need'} to be sent again`)
  }
  if (input.toConfirm > 0) {
    parts.push(`${count(input.toConfirm, 'account is', 'accounts are')} open with something for `
      + 'the client to confirm')
  }
  /* Named, never left as a bare count. A liaison with four clients and three sheets each cannot
     tell two queries apart by "6 accounts". */
  return `${input.filename} — ${parts.join(', ')}.`
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
  /** How many accounts it is about at all, for the note that records it was sent. */
  accounts: number
}

/**
 * The heading of the column the CLIENT fills in.
 *
 * THE FIRM: "there's an empty thing ... forward this email back to us or respond to this email,
 * but fill in this block on the right hand side, the information we require."
 */
export const ANSWER_COLUMN = 'Fill this in'

/**
 * A cell somebody types into when they hit Reply.
 *
 * EMPTY, WIDE AND PALE, because that is the whole of what makes it look like a box to fill in
 * rather than a column we forgot to populate. Every other blank in this email says "(nothing)"
 * for exactly that reason -- this is the one place an empty cell means the opposite, so it is
 * drawn differently on purpose.
 *
 * `&nbsp;` rather than nothing at all: an empty <td> collapses to a sliver in Outlook, and a box
 * one pixel high is not a box anybody can click into.
 */
const ANSWER_CELL =
  '<td style="padding:6px 10px;border:1px solid #9aa6b8;background:#ffffff;min-width:160px">'
  + '&nbsp;</td>'

/** One row of a table, so both tables are drawn by the same code. */
function tableRows(rows: CorrectionRow[], labelFor: LabelFor): string {
  return rows.flatMap((row) => row.problems.map((p) => `
    <tr>
      <td style="padding:6px 10px;border:1px solid #d9dee6;white-space:nowrap">${esc(row.reference ?? '\u2014')}</td>
      <td style="padding:6px 10px;border:1px solid #d9dee6">${esc(row.name ?? '\u2014')}</td>
      <td style="padding:6px 10px;border:1px solid #d9dee6">${esc(p.key ? labelFor(p.key) : '\u2014')}</td>
      <td style="padding:6px 10px;border:1px solid #d9dee6">${esc(givenFor(row, p.key))}</td>
      <td style="padding:6px 10px;border:1px solid #d9dee6">${esc(p.message)}</td>
      ${ANSWER_CELL}
    </tr>`).join(''))
    .join('')
}

function table(heading: string, intro: string, rows: CorrectionRow[], labelFor: LabelFor): string {
  if (rows.length === 0) return ''
  return `
<h3 style="font-size:15px;margin:22px 0 4px">${esc(heading)}</h3>
<p style="margin:0 0 8px">${intro}</p>
<!-- NO font-family HERE, and that is the fix rather than the omission. These two carried
     Calibri while the message around them was wrapped in whatever the firm chose in Settings,
     so a correction sheet went out in two faces -- the covering sentence in the firm's, the
     table that IS the request in somebody else's default. Inherited, one email is one face, and
     changing it is one setting. The size stays, because a data table is meant to be smaller
     than the prose above it. -->
<table style="border-collapse:collapse;font-size:13px">
  <thead>
    <tr style="background:#1b2a4a;color:#ffffff;text-align:left">
      <th style="padding:6px 10px;border:1px solid #1b2a4a">Your reference</th>
      <th style="padding:6px 10px;border:1px solid #1b2a4a">Debtor</th>
      <th style="padding:6px 10px;border:1px solid #1b2a4a">Field</th>
      <th style="padding:6px 10px;border:1px solid #1b2a4a">What your sheet says</th>
      <th style="padding:6px 10px;border:1px solid #1b2a4a">What we need</th>
      <!-- A width ATTRIBUTE as well as the style. Outlook lays tables out with Word, which
           ignores min-width on a cell -- and an empty column collapsed to its heading is not a
           box anybody can see to type in. -->
      <th width="180" style="padding:6px 10px;border:1px solid #1b2a4a;width:180px">${esc(ANSWER_COLUMN)}</th>
    </tr>
  </thead>
  <tbody>${tableRows(rows, labelFor)}</tbody>
</table>`
}

/** "1 account" / "3 accounts", because "1 account need correcting" went out to a client. */

/**
 * The email to the client liaison.
 *
 * WRITTEN TO BE FORWARDED, at the firm's instruction: "so the client liaison can easily forward
 * that to the client." So it is addressed to the client throughout — "your sheet", "could you
 * confirm" — and carries nothing internal. A liaison who has to rewrite it before sending it on
 * is a liaison who will not send it on.
 *
 * THREE ANSWERS, IN THE ORDER THE FIRM ASKED FOR THEM: "what has been imported, and what needs
 * additional information, and which ones have not been imported because critical information is
 * required."
 *
 * THE ONES THAT DID NOT COME IN WERE MISSING ENTIRELY, and they are the half that matters most.
 * The email was built from the accounts that WERE opened, so a handover where eight rows were
 * rejected told the client about none of them — the accounts they most need to fix and re-send
 * were the ones we said nothing about. The firm spotted it: "there were more ones that I didn't
 * accept that should have been on this email."
 *
 * THEY GET NO CLIENT QUERY, AND CANNOT. A query hangs off an account, and a rejected row never
 * opened one. The email is the only way the client hears about them, which is the second reason
 * it may not be skipped.
 */
export function correctionEmail(input: {
  clientName: string
  /**
   * The person at the client this is for, where the client has one on record.
   *
   * THE FIRM: "the email should be addressed to a specific person or to a specific client."
   * It opened "Good day," at nobody — which on a message the liaison is meant to FORWARD means
   * they have to top and tail it before sending, and a message somebody has to rewrite is one
   * they will write themselves instead.
   *
   * Used exactly as it is stored. Taking the first word would greet "Mrs C Bredell" as "Mrs",
   * and the firm types this field themselves, so what they put in it is what they want said.
   */
  contactName?: string | null
  filename: string
  /** Today, as an ISO day. Formatted here so the caller cannot pass a different shape. */
  today: string
  /** Every account that was opened, including the ones with nothing wrong. */
  broughtIn: number
  /** Opened, but something on them needs the client to confirm it. */
  toConfirm: CorrectionRow[]
  /** Not opened: rejected, or refused for something an account cannot be opened without. */
  notBroughtIn: CorrectionRow[]
  labelFor: LabelFor
}): CorrectionEmail {
  const { clientName, filename, toConfirm, notBroughtIn, labelFor } = input
  const contact = (input.contactName ?? '').trim()
  const when = new Date(`${input.today}T00:00:00Z`).toLocaleDateString('en-ZA', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  })

  /* WHAT HAPPENED, IN ONE LINE, before any table. Somebody forwarding this to a client should be
     able to answer "so where are we?" without counting rows. */
  const clean = input.broughtIn - toConfirm.length
  /*
   * THE TOTAL FIRST, AT THE FIRM'S ASKING: "12 accounts were handed over on the import sheet,
   * 12 accounts are open and being worked, 11 of them with nothing outstanding."
   *
   * The lines under it are what happened to the sheet; without the total they do not add up to
   * anything a reader can check. A client who sent 500 and is told "480 are open" has to add two
   * numbers to find out whether the other twenty are accounted for -- and the one number they
   * actually know is how many they sent.
   */
  const handedOver = input.broughtIn + notBroughtIn.length
  const summary = [
    handedOver > 0
      ? `<li>${count(handedOver, 'account was', 'accounts were')} handed over on this sheet.</li>`
      : '',
    input.broughtIn > 0
      ? `<li>${count(input.broughtIn, 'account is', 'accounts are')} open and being worked`
        + `${clean > 0 && toConfirm.length > 0 ? `, ${clean} of them with nothing outstanding` : ''}.</li>`
      : '',
    toConfirm.length > 0
      ? `<li>${count(toConfirm.length, 'account needs', 'accounts need')} something confirmed. `
        + 'We are working ' + (toConfirm.length === 1 ? 'it' : 'them') + ' in the meantime.</li>'
      : '',
    notBroughtIn.length > 0
      ? `<li><strong>${count(notBroughtIn.length, 'account could', 'accounts could')} not be `
        + 'opened</strong> and will need to be sent again.</li>'
      : '',
  ].filter(Boolean).join('')

  /*
   * HOW TO ANSWER, SAID ONCE AND BEFORE THE TABLES.
   *
   * THE FIRM: "there's an empty thing ... forward this email back to us or respond to this email,
   * but fill in this block on the right hand side, the information we require."
   *
   * TWO WAYS, because clients are not the same. Somebody with three rows to fix will reply and
   * type into the last column; somebody with two hundred wants the spreadsheet, which is attached.
   * Naming both here is what makes the empty column read as a box to fill in rather than as a
   * column we forgot to populate -- and the attachment is only mentioned when there IS one.
   */
  const howToAnswer = [
    `<p style="margin:14px 0 4px">Please reply to this email with the last column,`
    + ` <strong>${esc(ANSWER_COLUMN)}</strong>, completed \u2014 you can type straight into it.`,
    notBroughtIn.length > 0
      ? ' The accounts we could not open are also attached as a spreadsheet, if you would rather'
        + ' correct them there and send it back.'
      : '',
    '</p>',
  ].filter(Boolean).join('')

  const bodyHtml = `
<p>Good day${contact ? ` ${esc(contact)}` : ''},</p>
<p>We have today brought in the handover sheet <strong>${esc(filename)}</strong> for
${esc(clientName)}.</p>
<ul>${summary}</ul>
${howToAnswer}
${table(
    'Not brought in — please send these again',
    'We cannot open an account without these, so nothing is being done on them yet.',
    notBroughtIn, labelFor,
  )}
${table(
    'Brought in, but please confirm',
    'These are open and being worked. Could you check the details below and let us know whether '
    + 'they are correct, or whether you have anything further on your side.',
    toConfirm, labelFor,
  )}
<p>Kind regards</p>`.trim()

  /*
   * THE SUBJECT SAYS WHAT IT IS, THEN WHOSE, THEN WHEN, at the firm's instruction: "in the
   * subject line it should say data import for Bredell Ferreira, for example. Or this date."
   *
   * It read "Bredell Ferreira — handover 22 September 2026", which leads with a name and leaves
   * somebody to work out what about it. A liaison forwarding this to a client, and the client
   * filing it, both want the same first two words.
   *
   * THE COUNTS STAY ON THE END, because they are what makes it worth opening now rather than
   * later -- and the two need different things from the client, so both are named.
   */
  const parts = [
    notBroughtIn.length > 0 ? `${notBroughtIn.length} not brought in` : '',
    toConfirm.length > 0 ? `${toConfirm.length} to confirm` : '',
  ].filter(Boolean)

  return {
    subject: `Data import for ${clientName} \u2014 ${when}`
      + `${parts.length ? `: ${parts.join(', ')}` : ''}`,
    bodyHtml,
    accounts: toConfirm.length + notBroughtIn.length,
  }
}

/**
 * AND WHEN NOTHING WAS WRONG, SAY THAT TOO.
 *
 * THE FIRM: "a handover import that was perfectly imported can go to the client liaison and send
 * to them that everything was imported fine and it was good. So that they know that all was
 * good."
 *
 * THE LIAISON ONLY EVER HEARD FROM THIS FILE WHEN SOMETHING WAS WRONG. A clean sheet went in
 * silently, so the liaison's experience of every import was either a list of corrections or
 * nothing at all — and nothing at all is indistinguishable from an import that never ran. The
 * client asks "did you get our file?" and the person who should be able to answer has no record
 * of it either way.
 *
 * IT IS FOR THE LIAISON, NOT FOR THE CLIENT. The corrections email is written to be forwarded —
 * it greets the client's own contact and asks them to fill a column in. This one is an internal
 * note: it says what landed, it asks for nothing, and it does not pretend to be a letter. A
 * liaison who wants to pass the good news on can write two lines themselves, which is the right
 * amount of effort for news that needs no action.
 *
 * WHAT COUNTS AS CLEAN IS NARROW, and the caller decides it: every row opened, none refused, none
 * excluded and nothing left to confirm. A repaired telephone number does NOT disqualify it —
 * those are `note` problems, things the import put right on the way in, and a sheet whose only
 * blemish was a leading zero Excel ate is exactly the sheet the firm means by "it was good".
 */
export function importedCleanlyEmail(input: {
  clientName: string
  filename: string
  /** Today, as an ISO day. Formatted here so the caller cannot pass a different shape. */
  today: string
  /** Accounts opened. Always the whole sheet, or this email is not the right one. */
  accounts: number
  /** What they are worth, so the liaison can check it against what the client said they sent. */
  capital: number
  /** How many numbers the import put right on the way in. Said only where there were any. */
  repaired?: number
}): CorrectionEmail {
  const when = new Date(`${input.today}T00:00:00Z`).toLocaleDateString('en-ZA', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  })
  /*
   * THE FIRM'S OWN MONEY FORMAT -- a space between the thousands and two decimals. Written out
   * rather than taken from en-ZA's own grouping, which uses a NON-BREAKING space: invisible in an
   * email, and the one character that has already cost this codebase a bug in an SMS.
   */
  const money = `R ${input.capital.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`

  /*
   * SAID AS A FACT, NOT CONGRATULATED. "Nothing needs your attention" is the whole message; a
   * sentence celebrating it would make the next one, which is about a sheet with forty problems
   * on it, read as a reproach.
   */
  const repaired = (input.repaired ?? 0) > 0
    ? `<p style="margin:12px 0 0;color:#555">${count(input.repaired ?? 0,
      'telephone number had', 'telephone numbers had')} a leading zero put back — Excel had read `
      + `${(input.repaired ?? 0) === 1 ? 'it' : 'them'} as a number. Nothing to do; the accounts `
      + 'opened with the corrected numbers.</p>'
    : ''

  return {
    subject: `${input.clientName} — handover imported, nothing outstanding`,
    bodyHtml: `
<p>The handover sheet <strong>${esc(input.filename)}</strong> for ${esc(input.clientName)} was
brought in on ${esc(when)}.</p>
<ul>
<li>${count(input.accounts, 'account is', 'accounts are')} open and being worked.</li>
<li>${esc(money)} handed over.</li>
<li>Nothing needs the client to confirm anything, and nothing was left behind.</li>
</ul>
${repaired}
<p style="margin:14px 0 0;color:#555">No reply needed. This is for your records.</p>`,
    accounts: input.accounts,
  }
}
