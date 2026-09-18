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

export type TemplateKind = 'sms' | 'email' | 'call_script'

export const TEMPLATE_KINDS: Record<TemplateKind, { label: string; plural: string }> = {
  sms: { label: 'SMS', plural: 'SMS templates' },
  email: { label: 'Email', plural: 'Email templates' },
  call_script: { label: 'Call script', plural: 'Call scripts' },
}

export interface MessageTemplate {
  id: string
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
   */
  position: DeskPosition | null
  /**
   * ISO 639-1. The book carries preferred_language per debtor and the firm works in more than
   * one, so a template says which language it is in rather than the reader guessing.
   */
  language: string
  active: boolean
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

export const MERGE_FIELDS: MergeField[] = [
  { key: 'debtor_name', label: 'How the debtor is addressed', sample: 'Mr Van Der Westhuizen' },
  { key: 'debtor_first_name', label: 'First name', sample: 'Johannes' },
  { key: 'reference', label: 'The reference the debtor knows', sample: 'GPS3/10103' },
  { key: 'client_name', label: 'The client whose book it is', sample: 'Gauteng Property Services' },
  { key: 'balance', label: 'Balance outstanding', sample: 'R 48,250.00' },
  { key: 'capital', label: 'Capital outstanding', sample: 'R 31,900.00' },
  { key: 'agent_name', label: 'Who is dealing with it', sample: 'Stephan Bredell' },
  { key: 'agent_phone', label: 'The number to call back on', sample: '012 111 2222' },
  { key: 'firm_name', label: 'The firm', sample: 'Bredell Ferreira' },
  { key: 'today', label: "Today's date, written out", sample: '18 September 2026' },
]

const FIELD_KEYS = new Set(MERGE_FIELDS.map((f) => f.key))

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
export function unknownFields(...parts: (string | null | undefined)[]): string[] {
  return fieldsUsed(...parts).filter((k) => !FIELD_KEYS.has(k))
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

/** Every field filled with its sample, for previewing a template with no account in front of you. */
export function sampleValues(): Record<string, string> {
  return Object.fromEntries(MERGE_FIELDS.map((f) => [f.key, f.sample]))
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
  firmName: string
  today: string
  money: (amount: number) => string
}): Record<string, string | null> {
  const a = input.account
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
    firm_name: input.firmName,
    today: longDate(input.today),
  }
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

  const unknown = unknownFields(input.body, input.kind === 'email' ? input.subject : null)
  if (unknown.length > 0) {
    problems.push({
      field: unknownFields(input.body).length > 0 ? 'body' : 'subject',
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
