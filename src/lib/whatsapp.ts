/**
 * OPENING WHATSAPP ON A NUMBER, FROM RAPTOR (S9, 19 Oct). The firm: "if I click on the WhatsApp
 * number and it asks me which number to WhatsApp, it already opens it ... I don't want to build in
 * WhatsApp because it's expensive."
 *
 * A `wa.me` link, which opens WhatsApp itself -- the app on the iPad, WhatsApp Desktop or Web on a
 * computer -- on the number, with the opening line typed in and editable. Sent from the person's own
 * WhatsApp, so nothing is paid per message. What it cannot do, and docs/whatsapp-integration.md says
 * why: Raptor never sees the conversation. The press is what Raptor records.
 *
 * PURE, so the number rules are checked without a browser.
 */

/**
 * A number as wa.me wants it: digits only, country code first, no leading 0 or +.
 *
 * WHY THIS EXISTS: the leads list sent "0821234567" as typed, and wa.me read it as a number in no
 * country at all. A South African number on file is almost always written the local way.
 *
 * Only MOBILES: WhatsApp lives on a cellphone number, and a landline handed to wa.me opens a chat
 * that can never be delivered. South African mobiles start 06, 07 or 08 (27 6/7/8 written
 * internationally); a number already in another country's international form (+44...) is kept.
 * Null where the number is not one WhatsApp can reach.
 */
export function whatsAppNumber(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  const intl = trimmed.startsWith('+') || trimmed.startsWith('00')
  let digits = trimmed.replace(/\D/g, '')
  if (trimmed.startsWith('00')) digits = digits.slice(2)
  if (!intl && digits.length === 10 && digits.startsWith('0')) digits = `27${digits.slice(1)}`
  if (digits.startsWith('27')) {
    /* 27 + nine digits, and a mobile prefix. */
    return digits.length === 11 && /^27[678]/.test(digits) ? digits : null
  }
  /* Another country's number, written internationally: trust its owner. */
  return intl && digits.length >= 8 && digits.length <= 15 ? digits : null
}

/** The link that opens WhatsApp on that number, with the message typed in where there is one. */
export function whatsAppLink(number: string, text?: string | null): string {
  const t = text?.trim()
  return `https://wa.me/${number}${t ? `?text=${encodeURIComponent(t)}` : ''}`
}

/**
 * THE OPENING LINE, which the person edits in WhatsApp before sending -- never sent by itself.
 * Names the firm and, on a debtor's account, OUR case number (the one every notice quotes; see
 * CLAUDE.md's three numbers), because a WhatsApp from a stranger's cellphone about "your account"
 * is what a scam looks like.
 */
export function whatsAppOpening(input: { firstName?: string | null; senderName?: string | null; caseNumber?: string | null }): string {
  const hello = input.firstName ? `Good day ${input.firstName}` : 'Good day'
  const who = input.senderName ? `this is ${input.senderName} from Bredell Ferreira` : 'this is Bredell Ferreira'
  return input.caseNumber
    ? `${hello}, ${who}, regarding your account ${input.caseNumber}.`
    : `${hello}, ${who}.`
}
