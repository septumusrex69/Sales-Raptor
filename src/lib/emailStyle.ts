/**
 * HOW AN EMAIL IS SET, kept apart from the rest of the firm's settings.
 *
 * SPLIT OUT SO IT CAN BE CHECKED. `firmSettings.ts` imports the Supabase client, so a QA check
 * cannot import it at all -- check-firm-settings reads it back as TEXT for exactly that reason.
 * These three are pure: the faces an email may be set in, the rule that wraps an outgoing
 * message, and the same rule as a style object for the box somebody types it in. Nothing here
 * touches the network, so what actually goes out can be asserted rather than described.
 *
 * firmSettings re-exports all three, so nothing that used them had to move.
 */
import { CHARTER_EMAIL_STACK } from './charter.ts'

/** Only the two fields the style needs, rather than the whole settings row. */
export interface EmailFace {
  emailFont: string
  emailSizePt: number
}

/**
 * THE FACES AN EMAIL MAY BE SET IN, and why the list is this short.
 *
 * A mail client cannot fetch a webfont. Gmail, Outlook and Apple Mail all ignore `@font-face`
 * entirely, so a face the reader does not already have installed silently becomes Times New
 * Roman — which means offering a long list would be offering choices that do not survive the
 * send. These are the faces that ship with Windows and macOS both.
 *
 * Stored as the whole stack rather than the family name, so the fallback travels with the choice
 * and a Linux reader gets a sensible substitute instead of the browser's default.
 */
export const EMAIL_FONTS: { label: string; value: string }[] = [
  /*
   * CHARTER FIRST, AND GEORGIA RIGHT BEHIND IT, which is the honest way to offer it here.
   *
   * The firm asked for Charter on the letters and then on "the letters in the emails". On a
   * letter that is straightforward -- the PDF carries the font with it. An email cannot: the rule
   * above applies to Charter like everything else, so a reader who does not have it installed
   * sees the next face in the stack and never knows. That next face is Georgia ON PURPOSE. Both
   * are Matthew Carter's, Georgia being the screen-drawn relative of Charter, so the letter, the
   * covering email and the same email read on somebody else's phone are the same handwriting
   * rather than three. Times, where even Georgia is missing, is the third.
   *
   * SO THE LABEL SAYS SO. A picker that offered a bare "Charter" would be promising the firm
   * something it cannot deliver to a debtor's inbox, and the first time somebody compared the
   * sent folder with the attachment they would be right to stop trusting the setting.
   */
  { label: 'Charter (Georgia where it is not installed)', value: CHARTER_EMAIL_STACK },
  { label: 'Georgia', value: 'Georgia, "Times New Roman", Times, serif' },
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Trebuchet MS', value: '"Trebuchet MS", Tahoma, sans-serif' },
  { label: 'Courier New', value: '"Courier New", Courier, monospace' },
]

/**
 * The style an outgoing message is wrapped in.
 *
 * INLINE, AND ON A WRAPPER RATHER THAN IN A <style> BLOCK, because Gmail strips <head> and every
 * stylesheet in it. An inline style on a containing div is the only thing every mail client
 * honours, and it is what every newsletter in the world does for the same reason.
 */
export const emailBodyStyle = (s: EmailFace): string =>
  `font-family:${s.emailFont};font-size:${s.emailSizePt}pt;line-height:1.5;color:#1f2937`

/**
 * THE SAME RULE, FOR A BOX ON THE SCREEN.
 *
 * Because the box somebody types the email in was not showing it. A collector wrote in the app's
 * own sans-serif and the recipient read the message in the firm's serif at the firm's size --
 * different face, different measure, so where a paragraph ended on the screen had nothing to do
 * with where it ended in the inbox. The letter editor has been the page it prints on since the
 * firm asked for that; this is the same argument one screen along.
 *
 * DERIVED FROM THE STRING rather than written a second time. The string is what actually wraps
 * the outgoing message, so parsing it is what guarantees the preview cannot drift from the send:
 * a rule added there appears here, and one that does not parse is visibly missing rather than
 * quietly different.
 */
export function emailBodyCss(s: EmailFace): Record<string, string> {
  const out: Record<string, string> = {}
  for (const rule of emailBodyStyle(s).split(';')) {
    const at = rule.indexOf(':')
    if (at === -1) continue
    out[rule.slice(0, at).trim().replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())]
      = rule.slice(at + 1).trim()
  }
  return out
}

/**
 * A TYPED MESSAGE, AS HTML A MAIL CLIENT WILL DRAW.
 *
 * The firm, looking at a final notice that had actually gone out: "you should remember the spaces
 * in the email. This is how it came out." Every line of a four-paragraph statutory notice was
 * jammed against the next one, because the composer turned every newline into a single <br> --
 * so a blank line between paragraphs, which is what anybody typing an email puts there, drew as
 * nothing at all.
 *
 * A BLANK LINE IS A PARAGRAPH, A SINGLE NEWLINE IS A LINE. That distinction is the whole fix, and
 * it is the one a person typing already has in their head: the reference block at the top and the
 * contact block at the bottom are each several lines of ONE thing, and the paragraphs between them
 * are separate things.
 *
 * <br><br> RATHER THAN <p>, deliberately. A <p>'s margin is a default every mail client picks for
 * itself, and Outlook's is not Gmail's; two <br>s are the one construction every client on earth
 * draws the same way. The same argument as the inline style above.
 *
 * AND IT ESCAPES. This did not, and a debtor called "Smit & Seun" put a raw ampersand into the
 * markup of a legal notice. Nothing typed into a message box can be allowed to become HTML.
 */
export function emailBodyHtml(text: string): string {
  const esc = (s: string) => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return text.trim()
    .split(/\n[ \t]*\n+/)
    .map((block) => esc(block).replace(/\n/g, '<br>'))
    .join('<br><br>')
}
