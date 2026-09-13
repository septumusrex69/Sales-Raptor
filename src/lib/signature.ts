/**
 * Contact details a debtor put in their own email.
 *
 * A debtor writing in very often hands over more than they realise — "my new number is
 * 083 441 9922", a signature block with a work landline, an employer's name. Every one of those
 * is worth more to a collector than the email itself, and today they are read once and lost.
 *
 * Pure and dependency-free so it can be tested directly: see scripts/qa/check-signature-scan.mjs.
 *
 * SUGGESTIONS, NEVER AUTOMATIC. Everything here is a guess offered to a person, because the cost
 * of being wrong is not symmetric. A missed number is a missed number. A WRONG number saved onto
 * an account becomes a contact the sync then matches future mail against — which files that mail
 * automatically and charges the debtor R13 under item 6 every time, quietly, for as long as
 * nobody notices. So nothing here writes anything; it returns candidates for a person to tick.
 */

/** A phone number found in a message, with enough context for somebody to judge it. */
export interface ContactCandidate {
  /** Matches account_contacts.kind, so a confirmed one can be written straight through. */
  kind: 'mobile' | 'phone'
  /** Normalised to how South Africans write it: 083 441 9922. */
  value: string
  /** The line it was found on, so the agent can see what it was being called. */
  context: string
}

/**
 * The part of a message its sender actually wrote.
 *
 * Everything from the first quote marker down belongs to somebody else — and that matters here
 * rather than being tidiness. A debtor's reply routinely carries the demand we sent, which
 * carries OUR switchboard number; a forwarded complaint carries the attorney's signature. Scan
 * the whole body and you file Steyn Attorneys' mobile as the debtor's.
 */
export function topBlock(body: string): string {
  const lines = body.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  for (const line of lines) {
    const t = line.trim()
    if (
      t.startsWith('>')
      // "On 13 Sep 2026 at 00:37, Someone wrote:" — and the Afrikaans and Outlook variants.
      || /^on\b.*\bwrote:$/i.test(t)
      || /^op\b.*\bgeskryf:$/i.test(t)
      || /^-{2,}\s*(original message|forwarded message)/i.test(t)
      || /^_{5,}$/.test(t)
      || /^(from|van|sent|gestuur|to|aan|subject|onderwerp):\s/i.test(t)
    ) break
    out.push(line)
  }
  return out.join('\n')
}

/*
 * A run that could be a South African number: an optional +27 or 0, then digits with the spaces,
 * dashes, dots and brackets people actually type.
 */
const RUN = /(?:\+?27|0)[\d\s\-().]{8,16}\d/g

/**
 * Words that mean the digits after them are not a phone number.
 *
 * The costly false positives on a debtor's email are all reference-shaped: account numbers,
 * client references, ID numbers, invoice numbers. They are the same length and shape as a phone
 * number and they appear in exactly the same messages.
 */
const NOT_A_NUMBER = /(acc(ount)?|ref(erence)?|rekening|verw(ysing)?|id|inv(oice)?|faktuur|order|policy|polis)\b[^\n]{0,12}$/i

/** How South Africans write a number back: 083 441 9922, 021 555 1234. */
function pretty(digits: string): string {
  return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`
}

export function findContactDetails(body: string): ContactCandidate[] {
  const text = topBlock(body)
  const found = new Map<string, ContactCandidate>()

  for (const match of text.matchAll(RUN)) {
    const raw = match[0]
    const at = match.index ?? 0

    /*
     * Reject a match that is only PART of a longer run of digits.
     *
     * A 13-digit SA identity number contains a perfectly good-looking 10-digit number inside it,
     * and an identity number is the single most likely long number in a debtor's email. Checking
     * the characters either side is what tells the two apart.
     */
    if (/\d/.test(text[at - 1] ?? '')) continue
    if (/\d/.test(text[at + raw.length] ?? '')) continue

    // Normalise: +27 83 … and 2783… both mean 083….
    let digits = raw.replace(/\D/g, '')
    if (digits.startsWith('27')) digits = `0${digits.slice(2)}`
    if (digits.length !== 10 || !digits.startsWith('0')) continue

    // 0[1-8]: 09 is not allocated, and 00 is an international prefix rather than an area code.
    const second = digits[1]
    if (second < '1' || second > '8') continue

    const before = text.slice(Math.max(0, at - 40), at)
    if (NOT_A_NUMBER.test(before)) continue

    /*
     * 06/07/08 are mobile, EXCEPT 086 and 087 — share-call and VoIP, which are business lines
     * and not somebody's cellphone. Calling one of those a mobile would have a collector sending
     * an SMS to a switchboard.
     */
    const prefix = digits.slice(0, 3)
    const mobile = /^0[678]/.test(digits) && prefix !== '086' && prefix !== '087'

    // The line it sat on, trimmed, so the agent sees "My nuwe nommer is ..." and can judge it.
    const lineStart = text.lastIndexOf('\n', at) + 1
    const lineEnd = text.indexOf('\n', at)
    const context = text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim()

    if (!found.has(digits)) {
      found.set(digits, {
        kind: mobile ? 'mobile' : 'phone',
        value: pretty(digits),
        context: context.length > 120 ? `${context.slice(0, 117)}…` : context,
      })
    }
  }

  // A handful at most. Ten "numbers" off one email is a parser that has found references, and a
  // list nobody reads is worse than no list.
  return [...found.values()].slice(0, 5)
}
