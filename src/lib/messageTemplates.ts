/**
 * What Raptor says to a debtor, kept apart from the machinery that says it.
 *
 * WHY A LIBRARY AT ALL. Everything the firm sends a debtor is currently written where it is sent:
 * the SMS compose box, the mail composer, queryLetters.ts. That is survivable while a collector
 * writes one message to one debtor. It stops being survivable the moment a campaign sends the
 * same words to four hundred people, because then the words are no longer a collector's phrasing
 * — they are the firm's position, in writing, four hundred times, and a sentence the attorney
 * would not have approved is four hundred problems rather than one. queryLetters.ts says so in
 * its own header: its letters "move into the letters/SMS/WhatsApp template system when that is
 * built". This is that system.
 *
 * WHAT IS DELIBERATELY NOT HERE. Nothing in this file sends anything, charges anything or reads a
 * clock. A template is content; a campaign is an instruction to use it. Keeping the two apart is
 * what lets the wording be reviewed by somebody who does not read code, and lets this whole file
 * be tested without a database.
 *
 * AND A STANDING RULE FROM THE FIRM, WRITTEN HERE BECAUSE THIS IS WHERE IT WILL BE FORGOTTEN:
 * fees are raised on ACCOUNTS ONLY, never on a lead or a deal. A template is just words and costs
 * nothing, but the campaign that uses it raises an Annexure B fee per send, and a campaign built
 * over the sales side would raise fees the firm cannot bill.
 */
import { smsCost } from './smsSegments.ts'
import type { DeskPosition } from './clientPosition.ts'

/**
 * WHICH SIDE OF THE BUSINESS A TEMPLATE IS FOR.
 *
 * Two, not four. The firm's own reasoning, in their words: "a client can make a deal or a lead
 * can make a deal" — so a deal is a STAGE of one relationship rather than a party of its own, and
 * a separate deals library would be a third copy of the same editor over the same fields.
 *
 * Clients are absent for a different reason: what the firm wants for clients is a bulk newsletter
 * rather than reusable wording, and a broadcast has exactly one audience and one send date. That
 * is a campaign, not a library entry.
 *
 * This is not a folder. It decides which merge fields exist, whether sending raises a fee, and
 * which workflow clock applies — see the column comment in schema.sql.
 */
export type TemplateScope = 'collections' | 'sales'

export const TEMPLATE_SCOPES: Record<TemplateScope, { label: string; hint: string }> = {
  collections: {
    label: 'Collections',
    hint: 'Written against a debtor account. Sending raises an Annexure B fee.',
  },
  sales: {
    label: 'Sales',
    hint: 'Written against a lead, a deal or a prospect. Nothing is charged.',
  },
}

export type TemplateKind = 'sms' | 'email' | 'call_script' | 'letter'

export const TEMPLATE_KINDS: Record<TemplateKind, { label: string; plural: string }> = {
  sms: { label: 'SMS', plural: 'SMS templates' },
  email: { label: 'Email', plural: 'Email templates' },
  call_script: { label: 'Call script', plural: 'Call scripts' },
  letter: { label: 'Letter', plural: 'Letters' },
}

/**
 * Which kinds each side actually has.
 *
 * A LETTER IS A COLLECTIONS THING. The letters here are statutory notices — a section 129 demand
 * goes by registered post because the Act says where and how it must be delivered. Nothing on the
 * sales side is posted. Offering an empty "Letters" section on the sales library for ever is the
 * furniture problem: a heading that never has anything under it teaches people to stop reading
 * the ones that do.
 */
/*
 * AND IN THIS ORDER, which is the firm's: "SMS templates, email templates, letters, and then call
 * scripts." The three things that leave the building come first and in the order they escalate —
 * a text, then an email, then something posted — and the script somebody reads aloud comes last,
 * because it is the one that never goes anywhere.
 */
export const KINDS_FOR_SCOPE: Record<TemplateScope, TemplateKind[]> = {
  collections: ['sms', 'email', 'letter', 'call_script'],
  sales: ['sms', 'email', 'call_script'],
}

export interface MessageTemplate {
  id: string
  /** Which library it is in, and therefore which fields it may use. See TemplateScope. */
  scope: TemplateScope
  kind: TemplateKind
  /** What the firm calls it on a list: "First demand", "Broken promise follow-up". */
  name: string
  /** Email only. Null on the other two, and a check constraint says so in the database. */
  subject: string | null
  body: string
  /**
   * The rung this is written for, or null for one that suits any account.
   *
   * NULLABLE ON PURPOSE. Fourteen positions times three kinds is forty-two pieces of wording, and
   * a library that does nothing until all forty-two exist is a library nobody ever finishes
   * filling. A null position is the general version, and resolveTemplate falls back to it.
   *
   * COLLECTIONS ONLY. The database refuses a position on a sales template: the 13 rungs describe
   * a debtor account, and the sales side does not have them.
   */
  position: DeskPosition | null
  /**
   * ISO 639-1. The book carries preferred_language per debtor and the firm works in more than
   * one, so a template says which language it is in rather than the reader guessing.
   */
  language: string
  active: boolean
  /**
   * The letter this email attaches, where it attaches one.
   *
   * The section 129 covering email is the reason this exists: its own words say "attached is a
   * notice issued in terms of section 129(1)(a)", and nothing connected the two rows. An email
   * whose text promises an attachment the system knows nothing about reads as finished and is
   * not — which is the shape of gap this library was built to show.
   *
   * Only an email may carry one and only a letter may be carried; a trigger says so, because a
   * check constraint cannot read the row being pointed at.
   */
  attachmentId: string | null
  /**
   * 'document' where the body is a letterDocument JSON rather than the words themselves.
   *
   * Letters only -- message_templates_format_kind says so. An SMS holding a JSON blob would be
   * charged by the segment for its own punctuation and nothing would have said so.
   */
  format: 'text' | 'document'
}

/* ---------------------------------------------------------------- merge fields */

/**
 * THE FIELDS A TEMPLATE MAY USE, and nothing else.
 *
 * A closed list rather than "whatever the account object happens to carry". Two reasons, and the
 * second is the real one:
 *
 *   - A typo has to be catchable. `{{ballance}}` in a free-for-all scheme renders as nothing and
 *     the firm finds out when a debtor rings to ask what "the amount of  is now due" means.
 *   - Every field here is a promise. The moment a template may reach into the account row, a
 *     column rename breaks correspondence that has already been signed off, and nobody renaming
 *     a column will think to check the letters.
 *
 * `sample` is what the preview shows and is chosen to be AWKWARD rather than tidy — a long
 * surname and a five-figure balance — because a template that only ever previews against "Mr Dube
 * / R1 000" looks fine and then costs three SMS segments on a real account.
 */
export interface MergeField {
  key: string
  label: string
  sample: string
}

/**
 * Shared by both sides — who is writing, from where, on what date.
 *
 * Pulled out so the two lists cannot drift on the three fields that mean the same thing
 * everywhere. An agent's name is an agent's name whether the account is a debtor's or a lead's.
 */
const EVERYWHERE: MergeField[] = [
  { key: 'agent_name', label: 'Who is dealing with it', sample: 'Stephan Bredell' },
  { key: 'agent_phone', label: 'The number to call back on', sample: '012 111 2222' },
  { key: 'firm_name', label: 'The firm', sample: 'Bredell Ferreira' },
  { key: 'today', label: "Today's date, written out", sample: '18 September 2026' },
  /*
   * THE OFFICE, WHICH IS NOT THE AGENT. {{agent_phone}} is whoever is dealing with the account
   * and changes when the account is handed out; "please telephone this office" needs a number
   * that does not. Both sides of the business write letters under the firm's name, so these sit
   * here rather than in either list.
   */
  { key: 'firm_phone', label: "The office's telephone number", sample: '012 111 2222' },
  { key: 'firm_email', label: "The office's email address", sample: 'info@bredellferreira.co.za' },
  /* Merged exactly as it was typed. Whether it carries a scheme is a question about the template
     -- a letterhead wants "www...", a signature may want "https://..." so a mail client links it
     -- and not a question this field can answer once for both. */
  { key: 'firm_website', label: "The firm's website", sample: 'www.bredellferreira.co.za' },
  { key: 'firm_address', label: 'The firm’s address, on its own lines', sample: '25 Kerk Street\nPolokwane, 0699' },
  /* NOT THE SAME ADDRESS, and on a statutory notice the difference is the point: a firm that
     works from a street it does not receive post at would have replies going nowhere. Offered
     separately rather than one "address" field somebody has to choose the meaning of. */
  { key: 'firm_postal_address', label: 'Where post to the firm is sent, on its own lines', sample: 'PO Box 1234\nPolokwane, 0700' },
  /* "Telephone this office" is only useful with the hours attached. */
  { key: 'firm_hours', label: 'When the office is open', sample: 'Monday to Friday, 08:00 – 16:30' },
]

/**
 * THE FIELDS EACH SIDE MAY USE, per scope, and nothing else.
 *
 * Split because the sides genuinely do not share a vocabulary: {{balance}} has no meaning on a
 * lead and {{service_interested}} has none on a debtor account. One combined list would offer
 * every writer half a list of fields that render as nothing on their side — and a field that
 * silently renders as nothing is the failure this whole closed-list idea exists to stop.
 */
export const MERGE_FIELDS: Record<TemplateScope, MergeField[]> = {
  collections: [
    { key: 'debtor_name', label: 'How the debtor is addressed', sample: 'Mr Van Der Westhuizen' },
    { key: 'debtor_first_name', label: 'First name', sample: 'Johannes' },
    { key: 'reference', label: 'The reference the debtor knows', sample: 'GPS3/10103' },
    { key: 'client_name', label: 'The client whose book it is', sample: 'Gauteng Property Services' },
    { key: 'balance', label: 'Balance outstanding', sample: 'R 48,250.00' },
    { key: 'capital', label: 'Capital outstanding', sample: 'R 31,900.00' },
    /*
     * THE FIELDS A LETTER NEEDS AND AN SMS NEVER DID.
     *
     * A section 129 notice has to identify the debtor, the agreement and the creditor well enough
     * to be a valid statutory demand -- an address to post it to, the account number the credit
     * provider knows it by, the date the ten business days run to. None of that fits in 160
     * characters, so none of it existed until letters did.
     *
     * NOTHING FILLS SOME OF THESE YET, and they are here rather than left out for exactly that
     * reason: the library already marks a template that asks for a field nothing can answer, so
     * putting them in the vocabulary turns "the notice is missing things" into a precise list on
     * the row. Leaving them out would let the letter look finished with the facts typed in by
     * hand, which is how one debtor's address ends up on another debtor's demand.
     */
    { key: 'debtor_address', label: 'Where the notice is posted, on its own lines', sample: '14 Protea Street\nWonderboom\nPretoria, 0182' },
    { key: 'debtor_id_masked', label: 'Identity number, masked', sample: '850312 XXXX 08 X' },
    { key: 'account_number', label: "The creditor's own account number", sample: '92322880' },
    { key: 'respond_by', label: 'The date the debtor must answer by, written out', sample: '5 October 2026' },
    { key: 'position_as_at', label: 'The date the balance was struck', sample: '18 September 2026' },
    /*
     * AND THE FIRM'S OWN DETAILS, which are not the agent's and not the client's. Raptor has no
     * table for them -- companies.banking_details is where REMITTANCE GOES, which is the opposite
     * direction from where a debtor pays -- so these resolve to nothing until it has one.
     */
    { key: 'firm_bank', label: 'Trust account, bank and branch code together', sample: 'Standard Bank · 051001' },
    /*
     * THE BRANCH CODE ON ITS OWN, at the firm's correction: "the branch code can be a different
     * thing than the bank". {{firm_bank}} above still merges the two joined, so a notice written
     * before the split keeps printing exactly what it printed -- but a page that lays the details
     * out in a block, which is how a debtor copies them into a banking app, can now ask for each
     * line separately instead of making somebody retype the half they wanted.
     */
    { key: 'firm_bank_branch', label: 'Trust account branch code, on its own', sample: '051001' },
    { key: 'firm_bank_name', label: 'Trust account bank, on its own', sample: 'Standard Bank' },
    /* The beneficiary name. An account number without it reaches the right number under the wrong
       name, and the receiving bank may send it back. */
    { key: 'firm_bank_holder', label: 'The name on the trust account', sample: 'Bredell Ferreira Trust' },
    { key: 'firm_bank_account', label: 'Trust account number', sample: '01 234 5678' },
    /*
     * WHAT KIND OF ACCOUNT IT IS, in the bank's own words, and it is doing work on a notice: a
     * legal practitioner trust account tells a debtor the money is not the firm's to spend.
     */
    { key: 'firm_bank_type', label: 'What kind of account it is', sample: 'Legal Practitioner Trust Account' },
    /*
     * THE ASK ITSELF, written once by the firm and merged wherever payment is discussed -- a
     * letter, an email, an SMS, a call script. THE FIRM: "we need to move them and motivate them
     * to pay into our trust account." Retyped into each template instead, the same account ends
     * up described four different ways, and the one a debtor happens to hold is the one that
     * counts.
     *
     * COLLECTIONS ONLY. It tells a DEBTOR where to pay; a sales template has no business with it.
     */
    { key: 'payment_instruction', label: 'The standing ask to pay into the trust account', sample: 'Payment must be made into our trust account, details below.' },
    { key: 'signatory_name', label: 'Who signs the letter', sample: 'J Bredell' },
    { key: 'signatory_title', label: 'Their title', sample: 'Director' },
    ...EVERYWHERE,
  ],
  sales: [
    { key: 'contact_name', label: 'How the person is addressed', sample: 'Mr Van Der Westhuizen' },
    { key: 'contact_first_name', label: 'First name', sample: 'Johannes' },
    { key: 'company_name', label: 'Their business', sample: 'Gauteng Property Services' },
    { key: 'service_interested', label: 'What they asked about', sample: 'Debt collecting' },
    { key: 'deal_name', label: 'The piece of business', sample: 'GPS collections mandate' },
    { key: 'deal_value', label: 'What it is worth', sample: 'R 120,000.00' },
    /*
     * WHERE A CLIENT PAYS THE FIRM, and why it is only on this side.
     *
     * The firm: "there's also an account that is still outstanding with our client." That is
     * commission the firm is owed, and it is paid into the firm's BUSINESS account -- a third
     * direction of money, separate from the trust account a debtor pays into and from
     * companies.banking_details, where remittance goes out.
     *
     * A DEBTOR NOTICE CANNOT NAME IT, because these keys are not in the collections list and
     * templateProblems refuses a field that is not in its scope. That is the whole protection:
     * getting a debtor to pay into the business account is trust money in the wrong place, and
     * nobody finds out until month end. A closed list per side is cheaper than a warning.
     */
    { key: 'firm_business_bank', label: 'The firm’s own account, bank and branch code together', sample: 'Standard Bank · 051001' },
    { key: 'firm_business_bank_branch', label: 'Branch code, on its own', sample: '051001' },
    { key: 'firm_business_bank_name', label: 'Bank, on its own', sample: 'Standard Bank' },
    { key: 'firm_business_bank_holder', label: 'The name on the account', sample: 'Bredell Ferreira' },
    { key: 'firm_business_bank_account', label: 'Account number', sample: '02 345 6789' },
    ...EVERYWHERE,
  ],
}

/**
 * THE FIELDS, IN GROUPS, because forty chips in one row is a list nobody reads.
 *
 * THE FIRM: "if we can categorize it ... because now it's like all over the place. Debtor
 * details, collector details, liaison details, firm details." The chips were in the order the
 * fields happened to be written in, which put the trust account between a debtor's ID number and
 * the date -- so somebody looking for the bank details read the whole row every time.
 *
 * ORDERED BY WHO THE FIELD IS ABOUT, and the groups are in the order a letter uses them: the
 * debtor it is to, the account it is about, whose book it is, who is working it, where to pay,
 * who we are, and the letter itself.
 *
 * A TABLE RATHER THAN A PROPERTY ON EACH FIELD. Both work; this one puts the whole grouping on
 * one screen, where a field in the wrong place is visible. A field missing from it is a failure
 * rather than a silent "everything else" bucket -- check-message-templates refuses one, because
 * a field that quietly stops being offered is a field nobody uses again.
 */
export const FIELD_GROUPS: { title: string; keys: string[] }[] = [
  { title: 'The debtor', keys: ['debtor_name', 'debtor_first_name', 'debtor_address', 'debtor_id_masked'] },
  { title: 'The person', keys: ['contact_name', 'contact_first_name'] },
  { title: 'The account', keys: ['reference', 'account_number', 'balance', 'capital', 'position_as_at', 'respond_by'] },
  { title: 'Their business', keys: ['company_name', 'service_interested'] },
  { title: 'The deal', keys: ['deal_name', 'deal_value'] },
  { title: 'The client', keys: ['client_name'] },
  /* Named for what it does rather than for a role: the same two fields are the collector on a
     debtor account and the consultant on a lead, and one group cannot be called both. */
  { title: 'Whoever is dealing with it', keys: ['agent_name', 'agent_phone'] },
  {
    title: 'Paying us',
    keys: ['payment_instruction', 'firm_bank', 'firm_bank_name', 'firm_bank_branch',
      'firm_bank_holder', 'firm_bank_account', 'firm_bank_type'],
  },
  {
    title: 'Paying us (the client side)',
    keys: ['firm_business_bank', 'firm_business_bank_name', 'firm_business_bank_branch',
      'firm_business_bank_holder', 'firm_business_bank_account'],
  },
  {
    title: 'The firm',
    keys: ['firm_name', 'firm_phone', 'firm_email', 'firm_website', 'firm_address',
      'firm_postal_address', 'firm_hours'],
  },
  /* Not the firm: these are facts about THIS piece of correspondence -- the day it carries and
     the person putting their name under it. */
  { title: 'This letter', keys: ['today', 'signatory_name', 'signatory_title'] },
]

/**
 * The scope's fields, in groups, with empty groups left out.
 *
 * Built from FIELD_GROUPS so the order on the screen is the order in that table and not the order
 * the fields were written in. A field the table does not mention would vanish from the screen
 * entirely, so it is returned here as its own group named for the mistake -- visible rather than
 * missing -- and refused by the checks.
 */
export function groupedFields(scope: TemplateScope): { title: string; fields: MergeField[] }[] {
  const fields = MERGE_FIELDS[scope] ?? []
  const placed = new Set<string>()
  const out: { title: string; fields: MergeField[] }[] = []
  for (const g of FIELD_GROUPS) {
    const inGroup = g.keys
      .map((k) => fields.find((f) => f.key === k))
      .filter((f): f is MergeField => f !== undefined)
    for (const f of inGroup) placed.add(f.key)
    if (inGroup.length) out.push({ title: g.title, fields: inGroup })
  }
  const rest = fields.filter((f) => !placed.has(f.key))
  if (rest.length) out.push({ title: 'Not yet grouped', fields: rest })
  return out
}

/** Every field either side may use. What a reader of a template needs, before it is filed. */
export const ALL_FIELD_KEYS = new Set(
  Object.values(MERGE_FIELDS).flatMap((list) => list.map((f) => f.key)),
)

/*
 * An unrecognised scope yields NO known fields, rather than throwing.
 *
 * The type stops it and so does the check constraint, but a template is a database row and a row
 * is data: a library page that throws on one bad row shows nothing at all, where one that reports
 * every field on that row as unanswerable shows the reader exactly which row to go and fix.
 */
const keysFor = (scope: TemplateScope) => new Set((MERGE_FIELDS[scope] ?? []).map((f) => f.key))

/**
 * `{{field}}`, with optional spaces inside the braces.
 *
 * BUILT FRESH ON EVERY USE rather than hoisted into a const, and the reason is narrower than it
 * looks. A /g RegExp carries `lastIndex` between calls, but neither caller here trips over it:
 * `String.replace` resets it, and `matchAll` works on a copy. So sharing one today would be
 * harmless — which is exactly why this is worth a note. The day somebody swaps the `matchAll`
 * below for an `.exec()` loop, a shared pattern starts the second template halfway through its
 * own string and drops the fields before that point, silently, on one template in a list.
 */
const fieldPattern = () => /\{\{\s*([a-z_]+)\s*\}\}/g

/** Every field the body (and subject) refers to, in the order a reader meets them, deduplicated. */
export function fieldsUsed(...parts: (string | null | undefined)[]): string[] {
  const seen: string[] = []
  for (const part of parts) {
    for (const m of (part ?? '').matchAll(fieldPattern())) {
      const key = m[1]
      if (key && !seen.includes(key)) seen.push(key)
    }
  }
  return seen
}

/** The ones that are not fields at all. A typo, every time. */
/**
 * Which kind of wording a workflow step's channel needs.
 *
 * THE REASON THIS EXISTS. workflow_nodes.template_id points at message_templates, and until the
 * two lived on one screen the builder had no way to set it: a communication step could be created
 * saying "send an email" with nothing to send, and the builder could COUNT those ("Notices to
 * write") without being able to fix one. The step drawer now offers the wording, and this is what
 * decides which wording it may offer.
 *
 * Null where the channel is not a thing the firm writes in advance. "By hand" is a delivery
 * method for something already written, so it takes a letter; a telephone call takes a script.
 *
 * WHATSAPP TAKES THE SMS WORDING and that is a judgement, not an equivalence: it is the only
 * short-text kind there is, and writing the same sentence twice is how the two drift apart. What
 * must NOT follow from it is the segment cost — Annexure B item 1(c) prices an SMS, and nothing
 * in the tariff prices a WhatsApp. A segment figure shown against a WhatsApp step would be a
 * wrong number on screen, which is worse than no number.
 */
export function kindForChannel(channel: string | null): TemplateKind | null {
  switch (channel) {
    case 'email': return 'email'
    case 'sms': case 'whatsapp': return 'sms'
    case 'post': case 'registered_post': case 'hand': return 'letter'
    case 'call': return 'call_script'
    default: return null
  }
}

/**
 * The ones this side cannot answer. A typo, or a field borrowed from the other library.
 *
 * SCOPED, because "unknown" only means anything relative to a side. `{{balance}}` is a real field
 * on a debtor account and nothing at all on a lead — and a sales template carrying it would
 * render "the amount of  is now due" to a prospect. The old version took no scope and therefore
 * could not tell those two cases apart.
 */
export function unknownFields(
  scope: TemplateScope, ...parts: (string | null | undefined)[]
): string[] {
  const known = keysFor(scope)
  return fieldsUsed(...parts).filter((k) => !known.has(k))
}

export interface Rendered {
  text: string
  /**
   * Fields the template asked for and this account could not answer.
   *
   * NOT AN ERROR HERE, because rendering a preview with gaps is useful and rendering a live
   * message with gaps is not. The caller decides, and for anything actually going to a debtor the
   * answer is always to refuse: "Dear , your account  is overdue" is worse than no message, and
   * at campaign scale it is worse four hundred times.
   */
  missing: string[]
}

/** Substitute what is known and report what is not. Never invents, never leaves "undefined". */
export function renderTemplate(
  template: string | null | undefined,
  values: Partial<Record<string, string | null>>,
): Rendered {
  const missing: string[] = []
  const text = (template ?? '').replace(fieldPattern(), (whole, key: string) => {
    const value = values[key]
    if (value === undefined || value === null || value.trim() === '') {
      if (!missing.includes(key)) missing.push(key)
      // The placeholder is left standing rather than blanked. A gap reads as finished prose and
      // gets sent; "{{debtor_name}}" in a preview is unmistakably unfinished.
      return whole
    }
    return value
  })
  return { text, missing }
}

/**
 * Every field filled with its sample, for previewing with no account in front of you.
 *
 * Both sides at once, deliberately. A preview's job is to show what the words look like filled
 * in; refusing to fill a field because it belongs to the other library would make a
 * mis-scoped template preview as if it were fine, which is the one thing a preview must not do.
 * templateProblems is what says the field does not belong here.
 */
export function sampleValues(): Record<string, string> {
  return Object.fromEntries(
    Object.values(MERGE_FIELDS).flatMap((list) => list.map((f) => [f.key, f.sample] as const)),
  )
}

/**
 * The sentence to show when a template asked for something this account could not answer.
 *
 * NULL WHEN THERE IS NOTHING WRONG, which is the whole contract. CLAUDE.md: a warning that fires
 * when nothing is wrong is worse than no warning, because people stop reading it — and this one
 * has to still be read on the day it matters.
 */
export function missingFieldsNote(missing: string[]): string | null {
  if (missing.length === 0) return null
  const names = missing.map((f) => `{{${f}}}`).join(', ')
  return missing.length === 1
    ? `${names} could not be filled from this account, and will send with the braces in it.`
    : `${names} could not be filled from this account, and will send with the braces in them.`
}

/* ---------------------------------------------------------------- what the account answers with */

/** Just enough of an account to write to its debtor. Passed in, so this file fetches nothing. */
export interface TemplateAccount {
  debtorKind: 'individual' | 'company'
  debtorTitle: string | null
  debtorFirstName: string | null
  debtorSurname: string | null
  accountNumber: string | null
  clientReference: string | null
  capitalOutstanding: number
  preferredLanguage: string | null
}

/**
 * How to address this debtor.
 *
 * A COMPANY IS NOT A "MR". The book holds a company's registered name in the surname field —
 * there is nowhere else for it to go — so a template that renders "Dear Mr Moloto Trading CC"
 * puts the firm's letterhead behind an obvious mistake. debtor_kind is the flag that tells the
 * two apart and it is exactly what it is for.
 *
 * Returns null rather than a guess where there is no name at all, so renderTemplate reports it
 * missing and the send is refused.
 */
export function addressAs(account: TemplateAccount): string | null {
  const surname = (account.debtorSurname ?? '').trim()
  const first = (account.debtorFirstName ?? '').trim()
  if (account.debtorKind === 'company') {
    const name = [first, surname].filter(Boolean).join(' ').trim()
    return name === '' ? null : name
  }
  const title = (account.debtorTitle ?? '').trim()
  if (surname === '') return first === '' ? null : first
  return title === '' ? surname : `${title} ${surname}`
}

/** "2026-09-18" -> "18 September 2026". A date in a letter is never written in ISO. */
export function longDate(date: string): string {
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December']
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d || m < 1 || m > 12) return date
  return `${d} ${months[m - 1]} ${y}`
}

/**
 * The values this account answers the merge fields with.
 *
 * Balance is passed in rather than computed: it is capital plus interest plus fees less payments,
 * subject to in duplum, and accountBalance.ts is the one place that arithmetic lives. A second
 * implementation here would eventually disagree with the statement the debtor is holding.
 */
export function mergeValuesFor(input: {
  account: TemplateAccount
  balance: number | null
  clientName: string | null
  agentName: string | null
  agentPhone: string | null
  today: string
  money: (amount: number) => string
  /**
   * WHAT A LETTER NEEDS AND A TEXT MESSAGE NEVER DID, all optional and all defaulting to null.
   *
   * NULL IS THE HONEST ANSWER while nothing fills them, and it is not the same as an empty
   * string: renderTemplate leaves an unresolved placeholder STANDING rather than printing a gap,
   * so a notice built before Raptor has the firm's trust account shows {{firm_bank}} on the page
   * instead of a blank line that reads as finished. One of those gets caught; the other gets
   * posted.
   */
  debtorAddress?: string | null
  debtorIdMasked?: string | null
  respondBy?: string | null
  positionAsAt?: string | null
  /**
   * The firm's own details, PASSED WHOLE RATHER THAN FIELD BY FIELD.
   *
   * The shape is FirmSettings' -- same key names, every one optional but `firmName` -- and the
   * type is written out here rather than imported, because firmSettings.ts reaches the database
   * and importing it would drag supabase into every QA check that imports this file.
   *
   * WHOLE, BECAUSE A MAPPER IN BETWEEN IS THE FAILURE CLAUDE.md WARNS ABOUT. The caller now
   * writes `firm` and nothing else; there is no list of fields to copy across and therefore no
   * list to forget a field from. That matters more here every time this grows: the firm's details
   * went from four fields to eighteen in one sitting.
   *
   * companies.banking_details is still deliberately not read: remittance goes OUT to a client,
   * which is the opposite direction from both accounts below.
   */
  firm: {
    firmName: string
    phone?: string | null
    email?: string | null
    website?: string | null
    physicalAddress?: string | null
    postalAddress?: string | null
    officeHours?: string | null
    trustBank?: string | null
    trustBranchCode?: string | null
    trustAccountName?: string | null
    trustAccountNumber?: string | null
    trustAccountType?: string | null
    paymentInstruction?: string | null
    businessBank?: string | null
    businessBranchCode?: string | null
    businessAccountName?: string | null
    businessAccountNumber?: string | null
    signatoryName?: string | null
    signatoryTitle?: string | null
  }
}): Record<string, string | null> {
  const a = input.account
  const some = (v: string | null | undefined): string | null => (v ?? '').trim() || null
  return {
    debtor_name: addressAs(a),
    debtor_first_name: (a.debtorFirstName ?? '').trim() || null,
    // The client's own reference is what appears on the debtor's paperwork; ours is the fallback.
    reference: (a.clientReference ?? '').trim() || (a.accountNumber ?? '').trim() || null,
    client_name: (input.clientName ?? '').trim() || null,
    balance: input.balance === null ? null : input.money(input.balance),
    capital: input.money(a.capitalOutstanding),
    agent_name: (input.agentName ?? '').trim() || null,
    agent_phone: (input.agentPhone ?? '').trim() || null,
    firm_name: input.firm.firmName,
    firm_phone: some(input.firm.phone),
    firm_email: some(input.firm.email),
    firm_website: some(input.firm.website),
    firm_address: some(input.firm.physicalAddress),
    firm_postal_address: some(input.firm.postalAddress),
    firm_hours: some(input.firm.officeHours),
    today: longDate(input.today),
    /* The creditor's own number, which is NOT the reference above: the client's reference is what
       appears on the debtor's paperwork, and a section 129 has to identify the agreement. */
    account_number: some(a.accountNumber),
    debtor_address: some(input.debtorAddress),
    debtor_id_masked: some(input.debtorIdMasked),
    respond_by: input.respondBy ? longDate(input.respondBy) : null,
    position_as_at: input.positionAsAt ? longDate(input.positionAsAt) : null,
    firm_bank: bankLine(input.firm.trustBank, input.firm.trustBranchCode),
    firm_bank_name: some(input.firm.trustBank),
    firm_bank_branch: some(input.firm.trustBranchCode),
    firm_bank_holder: some(input.firm.trustAccountName),
    firm_bank_account: some(input.firm.trustAccountNumber),
    firm_bank_type: some(input.firm.trustAccountType),
    payment_instruction: some(input.firm.paymentInstruction),
    /* The other direction a client's money comes from. Offered only to sales templates -- see
       MERGE_FIELDS -- but resolved here, because one function answers every scope. */
    firm_business_bank: bankLine(input.firm.businessBank, input.firm.businessBranchCode),
    firm_business_bank_name: some(input.firm.businessBank),
    firm_business_bank_branch: some(input.firm.businessBranchCode),
    firm_business_bank_holder: some(input.firm.businessAccountName),
    firm_business_bank_account: some(input.firm.businessAccountNumber),
    signatory_name: some(input.firm.signatoryName),
    signatory_title: some(input.firm.signatoryTitle),
  }
}

/**
 * Bank and branch code written the way they read on a page: "Standard Bank · 051001".
 *
 * THE JOIN LIVES HERE BECAUSE THE SPLIT HAPPENED IN THE DATABASE. The firm used to type both into
 * one box and {{firm_bank}} printed it; they then asked for them apart, because a branch code is
 * a separate thing copied into a separate box in a banking app. Templates already written still
 * say {{firm_bank}}, so something has to put them back together, and it has to do it the same way
 * every time -- a letter that reads "Standard Bank - 051001" on one notice and
 * "Standard Bank, 051001" on the next looks like two different accounts to a nervous debtor.
 *
 * HALF AN ANSWER IS STILL AN ANSWER. With only one of the two filled in, that one is returned
 * rather than null: a notice naming the bank and not the branch is worse than one naming both and
 * better than one naming neither, and the screen is already saying what is missing.
 *
 * The separator is U+00B7, which WinAnsi can draw -- see winAnsi.ts. A character the PDF cannot
 * print would refuse the build of every notice carrying this field.
 */
export function bankLine(
  bank: string | null | undefined, branchCode: string | null | undefined,
): string | null {
  const b = (bank ?? '').trim()
  const c = (branchCode ?? '').trim()
  if (b && c) return `${b} \u00b7 ${c}`
  return b || c || null
}

/* ---------------------------------------------------------------- is it fit to save */

export interface TemplateProblem {
  field: 'name' | 'subject' | 'body'
  message: string
}

/**
 * What is wrong with this template, in the order somebody reading the form would meet it.
 *
 * CHECKED WHEN IT IS SAVED, NOT WHEN IT IS SENT. A template with a typo in a field name saved on
 * a Tuesday is a campaign that goes out broken on a Thursday to everybody at once, and by then
 * the person who could have spotted it is not in the room. The cost of catching it here is one
 * person retyping a word.
 *
 * Nothing in here is a warning. A template either saves or it does not, because a form that saves
 * through a warning teaches people to ignore warnings — and the one warning that matters on this
 * screen is about money.
 */
export function templateProblems(input: {
  /**
   * 'document' where the body is a letterDocument JSON rather than prose.
   *
   * THE FIELD SCAN BELOW IS SKIPPED FOR ONE, and this was found by the letter refusing to save:
   * a document's JSON contains its running header, the running header legally contains {{page}}
   * and {{pages}}, and those are the PRINTER's fields rather than the account's. Scanning the
   * JSON as prose reported them as typos and disabled Save on a perfectly good notice.
   *
   * letterProblems in letterDocument.ts owns that check for a document, and it owns it properly
   * — header and body have different vocabularies. Two validators disagreeing about the same
   * document is worse than one of them not answering.
   */
  format?: 'text' | 'document'
  /** Which library it is being filed in, which is what decides whether a field is known. */
  scope: TemplateScope
  kind: TemplateKind
  name: string
  subject: string | null
  body: string
}): TemplateProblem[] {
  const problems: TemplateProblem[] = []
  if (!input.name.trim()) {
    problems.push({ field: 'name', message: 'Give it a name — this is what people pick it by.' })
  }
  if (!input.body.trim()) {
    problems.push({ field: 'body', message: 'There is nothing to send.' })
  }

  /*
   * A subject belongs to email and to nothing else. An SMS has no subject and a call script has
   * no subject, and carrying one anyway means a screen somewhere renders an empty line above the
   * words a collector is meant to read aloud.
   */
  const subject = (input.subject ?? '').trim()
  if (input.kind === 'email' && subject === '') {
    problems.push({ field: 'subject', message: 'An email needs a subject line.' })
  }
  if (input.kind !== 'email' && subject !== '') {
    problems.push({
      field: 'subject',
      message: `A ${TEMPLATE_KINDS[input.kind].label.toLowerCase()} has no subject line.`,
    })
  }

  const unknown = input.format === 'document'
    ? []
    : unknownFields(input.scope, input.body, input.kind === 'email' ? input.subject : null)
  if (unknown.length > 0) {
    problems.push({
      field: unknownFields(input.scope, input.body).length > 0 ? 'body' : 'subject',
      message: unknown.length === 1
        ? `There is no field called ${unknown[0]}. Check the list of fields beside the box.`
        : `These are not fields: ${unknown.join(', ')}. Check the list beside the box.`,
    })
  }
  return problems
}

/* ---------------------------------------------------------------- what an SMS will cost */

export interface SmsForecast {
  segments: number
  encoding: string
  /** Rand at the Annexure B rate, for one debtor. */
  cost: number
  /** What forced UCS-2, where something did. A curly apostrophe doubles the bill on its own. */
  offending: string[]
}

/**
 * What one SMS from this template will cost the debtor, rendered against the awkward samples.
 *
 * ANNEXURE B ITEM 1(c) IS PER SEGMENT, NOT PER MESSAGE — R3.50 each, and the network decides how
 * many there are. A template that fits in 160 characters against "Mr Dube" and spills to 161
 * against "Mr Van Der Westhuizen" costs the second debtor double, for the same words. Previewing
 * against the long sample is the only way that is visible before it is charged.
 *
 * The firm's cap is ten SMS a month per account; this says nothing about that, because the cap is
 * a fact about an account's history rather than about a template.
 */
export const SMS_RAND_PER_SEGMENT = 3.5

export function forecastSms(body: string, values: Record<string, string> = sampleValues()): SmsForecast {
  const { text } = renderTemplate(body, values)
  const cost = smsCost(text)
  return {
    segments: cost.segments,
    encoding: cost.encoding,
    cost: cost.segments * SMS_RAND_PER_SEGMENT,
    offending: cost.offending,
  }
}

/* ---------------------------------------------------------------- picking one */

/**
 * How a campaign decides which script a collector reads.
 *
 * THE RUNNER CHOOSES, which is the firm's own instruction: either one script for the whole
 * campaign, or let it follow the account. Both are right for different lists — a campaign chasing
 * one client's book is one conversation, while a power hour over a mixed list is a different call
 * on every account, and a broken arrangement is nothing like a first contact.
 */
export type ScriptMode =
  | { kind: 'fixed'; templateId: string }
  | { kind: 'by_position' }

export type ResolveReason =
  | 'fixed'
  | 'position'
  | 'position_other_language'
  | 'general'
  | 'general_other_language'
  | 'none'

export interface Resolved {
  template: MessageTemplate | null
  reason: ResolveReason
}

/**
 * Which template this account gets.
 *
 * FALLS BACK RATHER THAN REFUSES, in this order: this position in this language, this position in
 * English, the general one in this language, the general one in English. The alternative — every
 * position must have a script or the account is skipped — sounds safer and is not: it means a
 * power hour silently passes over the accounts nobody has written a script for yet, which are
 * precisely the unusual ones somebody should be ringing.
 *
 * ENGLISH IS THE FALLBACK, not a "default language" setting. The firm works in English and the
 * book's preferred_language is a courtesy where it is known. A collector handed a script in a
 * language the debtor did not ask for is a small awkwardness; a collector handed nothing is a
 * call that does not happen.
 *
 * The reason comes back with the template because the screen has to be able to say "there is no
 * Afrikaans version of this, you are reading the English one" — a fallback nobody is told about
 * is indistinguishable from a bug.
 */
export function resolveTemplate(input: {
  templates: MessageTemplate[]
  mode: ScriptMode
  position: DeskPosition | null
  language: string | null
}): Resolved {
  const live = input.templates.filter((t) => t.active)
  if (input.mode.kind === 'fixed') {
    const id = input.mode.templateId
    return { template: live.find((t) => t.id === id) ?? null, reason: live.some((t) => t.id === id) ? 'fixed' : 'none' }
  }

  const wanted = (input.language ?? 'en').trim().toLowerCase() || 'en'
  const at = (position: DeskPosition | null, language: string) =>
    live.find((t) => t.position === position && t.language.toLowerCase() === language) ?? null

  if (input.position !== null) {
    const exact = at(input.position, wanted)
    if (exact) return { template: exact, reason: 'position' }
    if (wanted !== 'en') {
      const english = at(input.position, 'en')
      if (english) return { template: english, reason: 'position_other_language' }
    }
  }
  const general = at(null, wanted)
  if (general) return { template: general, reason: 'general' }
  if (wanted !== 'en') {
    const englishGeneral = at(null, 'en')
    if (englishGeneral) return { template: englishGeneral, reason: 'general_other_language' }
  }
  return { template: null, reason: 'none' }
}

/**
 * What to tell the collector about the choice, or null where there is nothing worth saying.
 *
 * A FALLBACK NOBODY IS TOLD ABOUT IS INDISTINGUISHABLE FROM A BUG. A collector who asked for the
 * script for a broken arrangement and got the general one needs to know that is what happened —
 * otherwise the general script reads as the firm's considered answer to a broken promise, which
 * it is not.
 *
 * And nothing is said where nothing went wrong. A warning that fires when the right script was
 * found is a warning people stop reading, and then the one that matters goes unread too.
 */
export function resolveNote(resolved: Resolved, position: DeskPosition | null): string | null {
  const language = 'This debtor asked for another language. There is no version in it yet, so this is the English one.'
  switch (resolved.reason) {
    case 'none':
      return 'There is no script for this account yet.'
    case 'position_other_language':
      return language
    case 'general_other_language':
      return position === null ? language : `${language} It is also the general script, not one written for this position.`
    case 'general':
      return position === null ? null : 'There is no script for this position yet, so this is the general one.'
    default:
      return null
  }
}

/* ---------------------------------------------------------------- throwing one away */

/**
 * Where a template is already being used, as far as deleting it is concerned.
 *
 * Counted rather than listed, plus the names, because the question a person is answering is "is
 * this safe to throw away" and a list of twelve step ids does not help them answer it.
 */
export interface TemplateUsage {
  /** Workflow steps that send this template. */
  steps: number
  /**
   * How many of those sit in a version that is FROZEN — active or archived.
   *
   * Active is the one running against live accounts. Archived matters just as much and is easier
   * to overlook: accounts ran on it, and what they were sent is the firm's record of what it
   * said. Deleting the wording out from under either is rewriting history.
   */
  frozenSteps: number
  /** The workflows those steps belong to, named so somebody can go and look. */
  workflows: string[]
  /**
   * Emails that attach this letter, by name.
   *
   * The same silent shape as the workflow step: the foreign key is `on delete set null`, so
   * deleting a letter leaves the covering email intact, still saying "attached is a notice", with
   * nothing attached. A defective delivery that reads as a correct one.
   */
  attachedTo: string[]
}

/**
 * Where this template is already wired in, said in one line for the person reading it.
 *
 * NOT THE DELETE WARNING. That one exists to stop damage and only speaks when something would
 * break; this one answers "is anything sending these words right now?", which is the question
 * somebody has before they edit a sentence -- and the answer changes whether they edit it at all.
 *
 * Null where nothing uses it, because a line reading "used by nothing" on twenty rows out of
 * twenty-two is furniture, and furniture is what teaches people to stop reading the line that
 * matters.
 */
export function usageNote(usage: TemplateUsage): string | null {
  const parts: string[] = []
  if (usage.steps > 0) {
    const where = usage.workflows.length > 0 ? ` in ${usage.workflows.join(', ')}` : ''
    parts.push(usage.steps === 1
      ? `Sent by one step${where}.`
      : `Sent by ${usage.steps} steps${where}.`)
  }
  if (usage.attachedTo.length > 0) {
    parts.push(usage.attachedTo.length === 1
      ? `Posted with ${usage.attachedTo[0]}.`
      : `Posted with ${usage.attachedTo.join(', ')}.`)
  }
  /*
   * THE FROZEN COUNT IS THE PART THAT CHANGES BEHAVIOUR. Editing wording a published workflow
   * sends does not change what already went out -- but it does change what the NEXT account on
   * that workflow receives, without a new version and without anybody approving it.
   */
  if (usage.frozenSteps > 0) {
    parts.push(usage.frozenSteps === 1
      ? 'One of those is in a published workflow, so an edit here changes what the next account receives.'
      : `${usage.frozenSteps} of those are in published workflows, so an edit here changes what the next accounts receive.`)
  }
  return parts.length > 0 ? parts.join(' ') : null
}

/**
 * Why this template may NOT be deleted, or null where it may.
 *
 * THE DANGER IS SILENT, which is the whole reason this exists. workflow_nodes.template_id is
 * `on delete set null`, so deleting a template does not fail and does not warn: the step survives
 * saying "send an email" with nothing to send, and nobody finds out until the day it runs.
 *
 * Retiring is the answer offered instead, and it is a better one than it looks: the resolver only
 * reads active templates, so a retired template is out of circulation exactly as a deleted one
 * is — and the words are still there to read the day somebody asks what was sent.
 */
export function deleteRefusal(usage: TemplateUsage): string | null {
  if (usage.frozenSteps === 0) return null
  const where = usage.workflows.length > 0 ? ` (${usage.workflows.join(', ')})` : ''
  return usage.frozenSteps === 1
    ? `A published or archived workflow step sends this${where}. Retire it instead — the step `
      + 'would be left sending nothing, and accounts that already ran on it are the record of '
      + 'what the firm said.'
    : `${usage.frozenSteps} published or archived workflow steps send this${where}. Retire it `
      + 'instead — they would be left sending nothing, and accounts that already ran on them are '
      + 'the record of what the firm said.'
}

/**
 * What somebody should know before deleting one they ARE allowed to delete.
 *
 * Not a refusal. A draft workflow is being written and losing a template from it is an edit, not
 * damage — but it is an edit somebody should make on purpose rather than discover later.
 */
export function deleteWarning(usage: TemplateUsage, seedKey: string | null): string | null {
  const notes: string[] = []
  /*
   * AN EMAIL LEFT CLAIMING AN ATTACHMENT IT NO LONGER HAS. Warned rather than refused: replacing
   * a letter with a better one is ordinary work, and the fix is one field away. What must not
   * happen is that nobody is told.
   */
  if (usage.attachedTo.length > 0) {
    notes.push(usage.attachedTo.length === 1
      ? `${usage.attachedTo[0]} attaches this letter and would be left attaching nothing.`
      : `${usage.attachedTo.length} emails attach this letter `
        + `(${usage.attachedTo.join(', ')}) and would be left attaching nothing.`)
  }
  const draftSteps = usage.steps - usage.frozenSteps
  if (draftSteps > 0) {
    notes.push(draftSteps === 1
      ? 'A step in a draft workflow sends this, and would be left sending nothing.'
      : `${draftSteps} steps in draft workflows send this, and would be left sending nothing.`)
  }
  /*
   * A seeded row comes back. seed_key is what makes seeding idempotent, so the migration that
   * put this here will put it back the next time the schema is replayed — deleting it is not
   * permanent and somebody should know that before they are surprised by it.
   */
  if (seedKey) {
    notes.push(`This one was seeded as ${seedKey}, so replaying the schema would bring it back.`)
  }
  return notes.length > 0 ? notes.join(' ') : null
}
