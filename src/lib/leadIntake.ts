/**
 * Mail that IS a lead, as opposed to mail from one.
 *
 * The firm: "leads usually come from form@bredellferreira.co.za ... or leads are sent to
 * info@bredellferreira.co.za, but we'll link info later. Let's just link form."
 *
 * That address is the website's contact form, and it changes two things about a message.
 *
 * FIRST, WHOSE ADDRESS IS ON IT. The From header is the firm's own form, not the person enquiring.
 * Creating a lead from the header would put form@bredellferreira.co.za on the lead -- and, worse,
 * saved as that lead's address it would match every LATER enquiry to the same lead, so one
 * afternoon's five enquiries would become five emails filed on one stranger. The real address is
 * in the body, which is the only place it exists.
 *
 * SECOND, WHAT THE MESSAGE IS FOR. Every other unmatched email is a question -- is this a debtor,
 * a client, nobody? An enquiry off the form has one answer and it is "a new lead", so the screen
 * leads with that instead of offering it third.
 *
 * Nothing here talks to the database or to React: it reads text and returns fields somebody is
 * about to see in a form they can correct. Every one of these is a guess about a layout the firm
 * does not control, and a wrong guess costs a correction, not a record.
 */

/**
 * The addresses the website posts enquiries from.
 *
 * A list, and lower-cased on comparison, because info@ is coming: the firm said so in the same
 * breath and asked for form@ first. Adding it here is then the whole change.
 */
export const LEAD_INTAKE_ADDRESSES = ['form@bredellferreira.co.za']

export function isLeadIntake(address: string | null | undefined): boolean {
  const a = (address ?? '').trim().toLowerCase()
  return a !== '' && LEAD_INTAKE_ADDRESSES.includes(a)
}

export interface IntakeFields {
  firstName: string
  lastName: string
  companyName: string
  phone: string
  email: string
  /** What they actually wrote, where the form sends it as a labelled field. */
  message: string
}

/*
 * THE LABELS, AND EVERY SPELLING OF THEM THAT HAS BEEN SEEN.
 *
 * A contact form is a page somebody in marketing edits, so the labels move: "Full Name" becomes
 * "Name" becomes "Your name". Matched loosely on purpose -- a label this misses costs one typed
 * field, and a label matched too eagerly puts the wrong value in a box somebody then trusts.
 */
/*
 * ANCHORED, EVERY ONE OF THEM. ^...$ is what keeps a sentence that happens to end in a colon --
 * "Please note the following:" -- from being read as a field, and it is the only thing that does:
 * a length or whitespace guard in front of these would never fire, because an anchored pattern has
 * already refused the sentence. Loosen an anchor here and prose becomes a lead's first name.
 */
const LABELS: { key: keyof IntakeFields | 'fullName'; patterns: RegExp }[] = [
  { key: 'fullName', patterns: /^(full[\s_-]*name|name|your[\s_-]*name|contact[\s_-]*name)$/i },
  { key: 'firstName', patterns: /^(first[\s_-]*name|firstname|given[\s_-]*name)$/i },
  { key: 'lastName', patterns: /^(last[\s_-]*name|lastname|surname|family[\s_-]*name)$/i },
  { key: 'companyName', patterns: /^(company|company[\s_-]*name|business|business[\s_-]*name|organisation|organization|firm)$/i },
  { key: 'phone', patterns: /^(phone|telephone|tel|mobile|cell|cellphone|contact[\s_-]*number|phone[\s_-]*number)$/i },
  { key: 'email', patterns: /^(e-?mail|email[\s_-]*address|your[\s_-]*e-?mail)$/i },
  { key: 'message', patterns: /^(message|enquiry|inquiry|comments?|details|query|how can we help)$/i },
]

/** Empty is not a value: a form that posts "Company:" with nothing after it has told us nothing. */
const clean = (v: string) => v.replace(/\s+/g, ' ').trim()

/**
 * Pull what a contact form put in the body.
 *
 * Handles the two shapes these emails come in -- "Label: value" on one line, and a label on its
 * own line with the value under it -- because which one arrives depends on whether the form sends
 * text or HTML that was later flattened, and the firm's site may change that without telling
 * anybody. Unlabelled prose is left alone: guessing a name out of a sentence is how a lead ends
 * up called "Good Day".
 */
export function parseLeadIntake(body: string | null | undefined): Partial<IntakeFields> {
  const out: Partial<IntakeFields> = {}
  const lines = (body ?? '').split(/\r?\n/)

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const colon = line.indexOf(':')
    if (colon === -1) continue
    const label = clean(line.slice(0, colon))
    if (label === '') continue

    const hit = LABELS.find((l) => l.patterns.test(label))
    if (!hit) continue

    let value = clean(line.slice(colon + 1))
    /*
     * The value on the NEXT line, where the form put the label alone. Only taken when that line
     * is not itself a label, or "Name:" followed by "Email: x@y" would make the name "Email: x@y".
     */
    if (value === '') {
      const next = clean(lines[i + 1] ?? '')
      const nextLabel = next.slice(0, next.indexOf(':'))
      const nextIsLabel = next.includes(':') && LABELS.some((l) => l.patterns.test(clean(nextLabel)))
      if (next !== '' && !nextIsLabel) value = next
    }
    if (value === '') continue

    if (hit.key === 'fullName') {
      /* Split only where nothing more specific was given -- an explicit Surname field wins. */
      const parts = value.split(' ')
      if (out.firstName === undefined) out.firstName = parts[0]
      if (out.lastName === undefined && parts.length > 1) out.lastName = parts.slice(1).join(' ')
      continue
    }
    /*
     * FIRST ONE WINS. These bodies carry the enquiry and then the firm's own footer under it, and
     * the footer has a phone number and an address in it -- taking the last match would put the
     * firm's switchboard on the lead.
     */
    if (out[hit.key] === undefined) out[hit.key] = value
  }

  /*
   * A LAST RESORT FOR THE ADDRESS ONLY. Without one the lead is unreachable and the whole point of
   * the enquiry is lost, so a bare address anywhere in the body is better than nothing -- but
   * never one at the firm's own domain, which is the form itself and the footer.
   */
  if (out.email === undefined) {
    const found = (body ?? '').match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) ?? []
    const outside = found.find((a) => !/@bredellferreira\.co\.za$/i.test(a))
    if (outside) out.email = outside
  }

  return out
}
