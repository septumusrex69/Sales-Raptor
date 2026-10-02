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
import type { Block } from './letterDocument.ts'

/** Where a signing request can be. */
export type SigningState = 'sent' | 'signed' | 'declined' | 'cancelled'

export interface SigningRequest {
  title: string
  body: Block[]
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

