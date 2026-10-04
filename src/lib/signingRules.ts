/**
 * SIGNING A DOCUMENT ONLINE, AS A LINK ANYBODY HOLDING IT CAN OPEN.
 *
 * THE FIRM: "building the online signature for the AOD... make space for where there can be
 * signatures like at the bottom of the pages for initials and stuff. For that you can basically
 * build in an online signature platform. Forget about the OTP for now. Just anyone with a link can
 * open it, for testing."
 *
 * THE TOKEN IS THE AUTHORITY. There is no password, no account and no one-time pin: holding the
 * link IS the permission, which is what the firm asked for and what every e-signing service does
 * on its free tier. Two things follow and neither is optional.
 *
 *   1. IT HAS TO BE UNGUESSABLE. 32 bytes from the platform's CSPRNG, base64url. A sequential id,
 *      or anything built from the account number, would let somebody walk the firm's documents by
 *      editing a URL -- and these are acknowledgements of debt, which carry a person's ID number,
 *      their balance and shortly their signature.
 *   2. IT REACHES EXACTLY ONE ROW. The anon role has no rights on signing_requests; both calls
 *      below are `security definer` functions taking a token. There is no listing to be had.
 *
 * AND WHAT THEY SIGNED IS FROZEN AT SEND TIME. `body` is a copy of the document's blocks, not a
 * pointer at the template. An acknowledgement of debt is the instrument the firm would sue on, and
 * "we edited the template afterwards" is the whole of a defence.
 *
 * PURE, AND IN ITS OWN FILE FOR THAT REASON. signing.ts reaches the database and therefore imports
 * the Supabase client, which scripts/qa cannot resolve -- so the token, the link, the words and
 * what a state means live here where a check can hold them. The same split accountQueries and
 * disputeCategories already have, and for the same reason.
 */
import type { Block, PageSetup } from './letterDocument.ts'
import type { Blank } from './signingBlanks.ts'

/** Where a signing request can be. */
export type SigningState = 'sent' | 'signed' | 'declined' | 'cancelled'

export interface SigningRequest {
  title: string
  body: Block[]
  /**
   * THE SHEET IT WAS DRAWN ON, frozen beside the body.
   *
   * THE FIRM, looking at one on the signing page: "it looks crappy... it's not on a letterhead,
   * the letters are all over the place." The page had the blocks and no paper to put them on. The
   * signer is anonymous and cannot read the letterheads table, and the same rule that freezes the
   * wording applies to the letterhead -- "we changed it afterwards" is as much of an argument
   * about one as the other. `null` on anything sent before this existed: see A4_LETTERHEAD.
   */
  pageSetup: PageSetup | null
  /** What the SIGNER is asked to fill in. See signingBlanks.ts for what may ever be on this list. */
  blanks: Blank[]
  /** What they typed into those blanks. Empty until it is signed. */
  filled: Record<string, string>
  signerName: string | null
  state: SigningState
  signedAt: string | null
  signaturePng: string | null
  initialsPng: string | null
  signedName: string | null
}

/**
 * HOW MANY BYTES, AND WHY THAT MANY.
 *
 * 32 bytes is 256 bits, which is the same order as a session token and far past anything that can
 * be walked. The temptation is to make it short enough to read out over a telephone; the firm's
 * links go out by email, and a token somebody can dictate is a token somebody can guess.
 */
export const TOKEN_BYTES = 32

/**
 * base64url: the three characters that are unsafe in a URL, swapped, and the padding dropped.
 *
 * WRITTEN OUT RATHER THAN TRUSTED TO AN ENCODER, because a '+' in a token becomes a SPACE when the
 * link is pasted into something that form-decodes it, and the signer then meets "this link is not
 * valid" on a document they were asked to sign. The padding goes for the same reason: a trailing
 * '=' is what a mail client cuts when it decides where the link ends.
 */
export function urlSafe(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** A fresh token. The platform's CSPRNG, never Math.random -- see the header. */
export function newToken(random: Crypto = crypto): string {
  const bytes = new Uint8Array(TOKEN_BYTES)
  random.getRandomValues(bytes)
  return urlSafe(bytes)
}

/**
 * The address to send somebody.
 *
 * ABSOLUTE, because it is pasted into an email and a relative path is not a link. Built from the
 * window's own origin so the preview deployment produces preview links and production produces
 * production ones -- a constant here would have every test link pointing at the live site.
 */
export function signingLink(token: string, origin: string): string {
  return `${origin.replace(/\/+$/, '')}/sign/${token}`
}

/**
 * ONLY THE ACKNOWLEDGEMENT OF DEBT IS SIGNED FROM A DEBTOR'S FILE.
 *
 * THE FIRM, twice and in as many words: "the acknowledgement of debt that's sent to signature is
 * the only thing that needs to be signed from the debtor's pane. You don't have to sign any other
 * document." And again: "the only document, and I repeat myself, is the acknowledgement of debt
 * that can be signed within the debtor's pane. All of the other ones are not in."
 *
 * A LETTER IS NOT AN AGREEMENT. A section 129, a final notice and a listing notice are things the
 * firm SENDS; offering a debtor a signature pad under one invites them to sign a notice, which
 * means nothing and muddies what a signature on this account is for. The AoD is the only
 * instrument among them -- the one the firm would sue on.
 *
 * MATCHED ON THE NAME because that is what the firm edits and what they called it. The seed keys
 * are checked first and are the reliable half; the name is the half that still works when somebody
 * writes a third AoD for a particular client.
 */
export const SIGNABLE_SEED_KEYS = ['aod-individual', 'aod-company']

export function isSignable(template: { seedKey?: string | null; name: string }): boolean {
  if (template.seedKey && SIGNABLE_SEED_KEYS.includes(template.seedKey)) return true
  return /acknowledgement of debt/i.test(template.name)
}

/**
 * THE EMAIL THAT CARRIES THE LINK, AS A BUTTON RATHER THAN A BLUE LINE OF TEXT.
 *
 * THE FIRM: "if you send from an email the acknowledgement of debt to be signed, it should have
 * the link in the email somehow, so that the guy can click on it... and in the link, make it nice
 * and big, like just don't make it a link and highlight it blue -- make it like a picture, or like
 * a button that you can see, like sign the acknowledgement of debt."
 *
 * A TABLE AND INLINE STYLES, WHICH IS NOT A STYLE CHOICE. Outlook on Windows renders mail through
 * Word, which ignores padding on an anchor and most of a stylesheet -- a `<a style="padding">` is a
 * blue line of text there, which is the exact thing being replaced. A single-cell table with the
 * colour on the cell and the anchor filling it is the one construction every mail client draws
 * alike, and it has been for twenty years.
 *
 * AND THE ADDRESS IS UNDERNEATH IT IN PLAIN TEXT. A button is an image-shaped thing to a client
 * that blocks images and to a debtor reading on a feature phone; the link spelled out is what makes
 * it work anyway, and it is what somebody telephoning the firm can read out.
 */
export function signingButtonHtml(url: string, label = 'Sign the acknowledgement of debt'): string {
  const safe = url.replace(/"/g, '&quot;')
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" `
    + `style="margin:20px 0"><tr><td align="center" bgcolor="#0f2744" `
    + `style="border-radius:8px"><a href="${safe}" `
    + `style="display:inline-block;padding:14px 28px;font-family:Georgia,serif;font-size:16px;`
    + `font-weight:bold;color:#ffffff;text-decoration:none;border-radius:8px">${label}</a>`
    + `</td></tr></table>`
    + `<p style="margin:0 0 16px;font-size:12px;color:#667085">`
    + `Or copy this address into your browser:<br>${safe}</p>`
}

/**
 * WHAT THE EMAIL SAYS, WHICH IS NEARLY NOTHING.
 *
 * THE FIRM: "maybe make the script or the writing for the acknowledgement of debt very short.
 * That's quite a little bit long right now. So just reduce that."
 *
 * THE DOCUMENT IS THE DOCUMENT. Everything that matters -- the amount, the terms, the consequences
 * of signing and of not signing -- is in the acknowledgement itself, which they are about to read.
 * A covering email that explains the agreement is a second version of the agreement, and the two
 * can disagree.
 */
export function signingEmailBody(debtorName: string | null, caseNumber: string | null): string {
  const who = debtorName?.trim() ? `Dear ${debtorName.trim()},` : 'Good day,'
  const ref = caseNumber?.trim() ? ` Our reference is ${caseNumber.trim()}.` : ''
  return `${who}

Please read and sign the acknowledgement of debt below.${ref}

`
    + 'The agreement itself sets out what is owed and how it will be paid.'
}

/**
 * WHAT THE PAGE SAYS WHEN THERE IS NOTHING TO SIGN.
 *
 * Each of these is an ordinary thing for a signer to meet rather than a fault, and the sentence
 * says which one so nobody telephones the firm about a broken link. Kept here rather than in the
 * component so a check can read them without a browser.
 */
export const SIGNING_CLOSED: Record<Exclude<SigningState, 'sent'>, string> = {
  signed: 'This document has already been signed. Nothing further is needed from you.',
  declined: 'This document was declined. Please speak to Bredell Ferreira if that was not you.',
  cancelled: 'This request was withdrawn by Bredell Ferreira, so there is nothing to sign.',
}

/** Can this request still be signed? */
export function isOpen(state: SigningState): boolean {
  return state === 'sent'
}

