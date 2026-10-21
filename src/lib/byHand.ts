/**
 * WHAT A PERSON MAY PICK OUT OF THE LIBRARY BY HAND.
 *
 * THE FIRM: "you can remove all of the email templates from the emails except for the statement of
 * account and now the acknowledgements of debt, because the other stuff works with workflows."
 *
 * ------------------------------------------------------------------------------------------------
 * THIS NARROWS A PICKER. IT DOES NOT DELETE ANYTHING.
 * ------------------------------------------------------------------------------------------------
 *
 * 33 of the collections templates are referenced by 48 workflow_nodes -- the section 129 sequence,
 * all three dispute sequences and the arrangement sequences. Removing the rows would not tidy the
 * compose box; it would break every workflow the firm has. So the rows stay exactly where they are,
 * the runner keeps sending them, the Library keeps showing all of them for editing, and the only
 * thing that changes is WHAT A COLLECTOR IS OFFERED when they press Template in a compose box.
 *
 * ------------------------------------------------------------------------------------------------
 * WHY THIS IS A LIST AND NOT "WHATEVER NO WORKFLOW USES"
 * ------------------------------------------------------------------------------------------------
 *
 * Deriving it was the first idea and it is the firm's own sentence turned into code: offer what no
 * workflow sends. It was checked against the book and it does not work YET. Only 17 of the 47
 * collections emails are wired to a node, because the dispute and arrangement sequences are still
 * DRAFT versions -- so the derived rule would leave 30 templates in the picker, which is not what
 * was asked for and not what the firm means by "the other stuff works with workflows".
 *
 * It will become true as those versions are published. When it does, this list can be deleted and
 * the rule derived -- and the check beside this file is written so it will say so.
 *
 * ------------------------------------------------------------------------------------------------
 * KEYED ON seed_key, NEVER ON THE NAME
 * ------------------------------------------------------------------------------------------------
 *
 * A name is the firm's to edit -- the Library is where they correct their own wording, and
 * renaming "Statement of account (individual)" to "Account statement" must not silently empty the
 * picker. `seed_key` is set by the migration that seeded a row and is not editable anywhere in the
 * app, which is exactly what a stable identifier is for.
 *
 * ANYTHING THE FIRM WROTE THEMSELVES IS OFFERED. A template with no seed key was typed by somebody
 * at this firm, for their own use, and it is not this file's business to hide it: they made it to
 * send it. The list only decides among the templates a MIGRATION put there.
 */

/** The seeded templates a person may choose in a compose box. */
export const BY_HAND_SEED_KEYS: readonly string[] = [
  /* THE TWO THE FIRM NAMED. A statement is sent because somebody asked for one -- it answers a
     question, which is the definition of what belongs in a compose box rather than a sequence. */
  'email-account-statement-individual',
  'email-account-statement-company',
  /* The shorter one, same reasoning: it is sent on request and no sequence sends it. */
  'email-account-summary-individual',
  'email-account-summary-company',
  /*
   * THE ACKNOWLEDGEMENTS OF DEBT ARE NOT HERE ANY MORE, and that is the point of the list.
   *
   * They were, on the firm's own reasoning -- an AoD goes out because a debtor asked for terms on
   * the telephone, and no sequence could know that. What the firm then met was the consequence:
   * "there's no link to open it in the email that goes out. The link is copied in another place
   * and then you have to email it." The covering email is only half a message. The other half is a
   * 43-character token made at the moment of sending, which cannot be a merge field in a template
   * saved weeks earlier -- so a covering email sent BY HAND is a covering email with nothing to
   * open, and that is the one the firm sent.
   *
   * SO IT GOES OUT FROM THE SIGNING PANEL AND ONLY FROM THERE. Pressing "Send the acknowledgement
   * of debt" issues the document, raises item 4(a) and opens the composer with these same words
   * already in it and the button underneath -- see SigningPanel. Nothing was lost: the wording is
   * still the firm's, still in the Library, still editable. What went is the way of sending it
   * that could not work.
   */
  /*
   * AND THE PAYMENT SIMULATION, which the firm did not name either way.
   *
   * KEPT, because the account page has a button that composes one: the calculator draws the
   * figures and opens a compose box with this wording already on it. Dropping it from the picker
   * would leave that button working and the same message unreachable by hand, which is a worse
   * state than either answer. Say if it should go.
   */
  'email-ptp-simulation-individual',
  'email-ptp-simulation-company',
]

const SET = new Set(BY_HAND_SEED_KEYS)

/**
 * May this template be chosen in a compose box?
 *
 * TRUE FOR ANYTHING WITH NO SEED KEY -- see the header: that is a template somebody at this firm
 * wrote, and they wrote it to send it.
 *
 * EMAILS ONLY, WHICH IS EXACTLY WHAT WAS ASKED FOR AND NO MORE.
 *
 * The same argument could be made about SMSs -- 16 of them are sent by workflows -- and it is NOT
 * made here, because the firm did not ask and the consequence is not symmetrical: there is no
 * by-hand SMS in the list above, so narrowing that picker would leave a collector with nothing in
 * it but whatever the firm has typed themselves. Emptying a control nobody complained about is a
 * worse mistake than leaving it wide.
 *
 * A LETTER is chosen from the Attach control as an attachment, and a CALL SCRIPT is read down the
 * telephone. Neither is sent by a sequence in the way an email is.
 */
export function offeredByHand(t: {
  kind: string
  seedKey: string | null
}): boolean {
  if (t.kind !== 'email') return true
  if (t.seedKey === null) return true
  return SET.has(t.seedKey)
}
