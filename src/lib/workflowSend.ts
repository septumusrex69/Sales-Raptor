/**
 * WHETHER A STEP THAT HAS COME DUE MAY ACTUALLY GO OUT, AND WHAT THE DEBTOR IS CHARGED IF IT DOES.
 *
 * `workflowRun.ts` decides WHEN each step falls. This decides whether the thing falling due can
 * honestly be sent, which is a different question and the one that carries the risk: a scheduler
 * that fires on the date and sends whatever it finds will, on the day the facts are not there
 * yet, post a debtor a notice reading "your default was reported on {{listing_date}} under
 * reference {{listing_reference}}".
 *
 * Pure: no database, no clock, no network, and no sending. It reads what the caller already has
 * and returns a decision. The transport raises the fee AFTER the provider accepts the message,
 * for the reason api/_lib/sms/send.ts gives — a fee for a message that never left is worse than a
 * message with no fee — so what is returned here is a QUOTE, not a charge.
 *
 * THE REFUSALS ARE HOLDS, NOT FAILURES. Every one of them is something a person can put right on
 * the account, and the step stays where it is until they do. Nothing here cancels anything; that
 * is `cancelRemaining`, and it happens for a different reason.
 */
import { scheduleFor, itemAmountFor, type AnnexureBItemId } from './annexureB.js'
import { canUseLetter, documentWithoutOptional, letterProblems, type LetterDocument } from './letterDocument.js'
import { renderTemplate, type TemplateKind } from './messageTemplates.js'
import { smsCost, smsSafeValues } from './smsSegments.js'
import type { WorkflowNode } from './workflowBuilder.ts'

/**
 * Why a due step is not going out today.
 *
 * NAMED BY WHAT IS MISSING rather than by where it was caught, because the note beside it is read
 * by whoever has to fix it. "unfilled" is a fact about the account; "no_wording" is a fact about
 * the library; they land on different desks.
 */
export type SendRefusal =
  /** The firm wrote this step for one kind of debtor and this account is the other. */
  | 'no_wording'
  /** It says something has already happened. A person confirms it has, then releases it. */
  | 'waits_for_person'
  /** The step it refers to did not go, so this one would be describing something that never was. */
  | 'out_of_order'
  /** Nowhere to send it: no address on an email step, no mobile number on an SMS one. */
  | 'no_address'
  /** A merge field nothing on the account can fill. */
  | 'unfilled'
  /** The notice it posts cannot be drawn or is not fit to send. */
  | 'attachment_unfit'

/** What the debtor is charged for this step, under the schedule in force on its own day. */
export interface StepCharge {
  item: AnnexureBItemId
  rand: number
  /** Segments, on an SMS. Null on an email, which is priced per message. */
  segments: number | null
  /** Which schedule priced it, so a screen can say so rather than implying today's. */
  citation: string
}

/** One of the two wordings a step carries, already read out of the library. */
export interface StepTemplate {
  id: string
  kind: TemplateKind
  subject: string | null
  body: string
  /**
   * Who the library says this wording is for, straight off `message_templates.audience`.
   *
   * NULL MEANS IT SERVES EITHER, and that is what makes a node's `templateCompanyId` allowed to
   * be null: one wording, both debtors. A wording STAMPED 'individual' serves one, and falling
   * back to it for a company is the mistake the whole audience column exists to prevent.
   */
  audience: 'individual' | 'company' | null
  /**
   * The notice this email posts, already read. Null where it posts nothing.
   *
   * CHECKED AT ITS OWN LEVEL, and that is the point of carrying the document rather than an id.
   * A covering email can merge perfectly while the four-page notice attached to it says
   * "{{listing_reference}}" in the middle of the paragraph telling a debtor how to query their
   * listing with a bureau. The email is what a person would glance at; the PDF is what is read.
   */
  attachment: { key: string; doc: LetterDocument } | null
}

export interface SendPlan {
  /** The wording chosen for this debtor, or null where the firm has not written one. */
  template: StepTemplate | null
  subject: string | null
  body: string
  attachmentKey: string | null
  can: boolean
  refusal: SendRefusal | null
  /** What the person who has to act on it reads. Never a state name. */
  note: string | null
  /** Every field nothing could fill, named — on the message AND on the notice it posts. */
  unfilled: string[]
  /** Quoted, not raised. Null where the step sends nothing chargeable. */
  charge: StepCharge | null
}

/**
 * Decide one due step.
 *
 * `dueOn` rather than today, twice over: it is what the charge is priced on — CLAUDE.md's rule
 * that `scheduleFor` takes the ACTION's date — and it is what makes this testable on the day that
 * matters rather than only on the day it is run.
 */
export function planSend(input: {
  node: WorkflowNode
  /** The wording for a person, and the wording for a company. Either may be absent. */
  individual: StepTemplate | null
  company: StepTemplate | null
  debtor: {
    kind: 'individual' | 'company'
    email: string | null
    mobile: string | null
  }
  /** Already merged by the caller, who is the one with the account in front of it. */
  values: Record<string, string>
  dueOn: string
  /**
   * Did the step this one follows actually go?
   *
   * The firm's rule, and the reason `afterMinutes` exists: the handover SMS says "we emailed
   * you". Undefined where the step follows nothing, and then nothing is checked — a guard that
   * fired when there was no dependency would hold every first step of every workflow.
   */
  afterStepSent?: boolean
  /**
   * A PERSON HAS LOOKED AT IT AND SAID SEND IT.
   *
   * Lifts the `waits_for_person` refusal and NOTHING ELSE. That distinction is the whole design:
   * a held step waits either on a person or on a fact, and a button cannot supply a fact. Pressed
   * on a listing notice whose reference is still missing, the step holds again with the same
   * reason -- which is the honest answer, and the reason the button is safe to offer on every
   * held step rather than only on the statutory ones.
   *
   * The firm's own instruction for these two steps is that sending them before they are true is
   * a misrepresentation and the kind of thing the Council for Debt Collectors acts on. So what a
   * release means is "I have checked": it does not mean the guards stop applying.
   */
  released?: boolean
}): SendPlan {
  const { node, debtor, dueOn } = input

  /*
   * THE WORDING FOR THIS DEBTOR, and the fallback is the delicate part.
   *
   * A node may legitimately carry one template for both -- `templateCompanyId` is null "where one
   * version serves both", which is most of the firm's non-statutory wording. But the collections
   * library exists twice all the way down, and the company half tells its reader the company may
   * be wound up and its directors held personally liable. Falling back from that to "Dear
   * {{debtor_name}}" and an identity number is the audience-crossing mistake.
   *
   * SO THE LIBRARY'S OWN STAMP DECIDES. A template with no audience serves either and is used for
   * both; one stamped 'individual' does not, and a company with nothing written for it holds so
   * somebody writes it. Never string-matched against the wording -- CLAUDE.md's rule, and
   * swapping "-individual" for "-company" in the key of a statutory demand is not a thing to do.
   */
  const fallback = input.individual?.audience == null ? input.individual : null
  const template = debtor.kind === 'company'
    ? (input.company ?? fallback)
    : input.individual

  /*
   * THE VALUES, MADE SAFE FOR THE CHANNEL BEFORE ANYTHING IS MEASURED. A non-breaking space out
   * of en-ZA's money formatting doubles the price of every SMS, so it has to be gone before the
   * segments are counted or the quote is wrong in the debtor's favour and the invoice is not.
   */
  const values = node.channel === 'sms' ? smsSafeValues(input.values) : input.values

  const merged = template ? renderTemplate(template.body, values) : null
  const mergedSubject = template?.subject ? renderTemplate(template.subject, values) : null
  const body = merged?.text ?? ''
  const subject = mergedSubject?.text ?? null

  /*
   * EVERY FIELD NOTHING COULD FILL, FROM BOTH LEVELS, de-duplicated. The listing notice asks for
   * three that live on the account and are null until the submission has actually gone, which is
   * the firm's own instruction: "it must only send once the submission has actually happened and
   * those three values exist on the account. If they are missing, hold the node and alert the
   * collector."
   *
   * GENERAL, NOT A RULE ABOUT LISTINGS. The guard is "a field nothing can fill", and the listing
   * step is caught by it because the listing notice is the template that asks for those fields. A
   * special case naming listing_date would have to be maintained beside the wording, and would
   * not catch the next notice the firm writes that quotes a fact the account does not have yet.
   */
  /*
   * MEASURED ON THE NOTICE THAT WILL ACTUALLY BE DRAWN. An optional line the account cannot
   * answer is taken out of the document before it is laid out, so reading the fields off the
   * document as written would report a gap in a paragraph the debtor never sees — and hold the
   * step for it. The same function both renderers run, so all three agree.
   */
  const attachmentText = template?.attachment
    ? documentText(documentWithoutOptional(template.attachment.doc, asStrings(values)))
    : ''
  const attachmentMerged = renderTemplate(attachmentText, values)
  const unfilled = [...new Set([
    ...(merged?.missing ?? []),
    ...(mergedSubject?.missing ?? []),
    ...attachmentMerged.missing,
  ])]

  const charge = quote(node, body, dueOn)
  const base = {
    template, subject, body,
    attachmentKey: template?.attachment?.key ?? null,
    unfilled, charge,
  }
  const hold = (refusal: SendRefusal, note: string): SendPlan =>
    ({ ...base, can: false, refusal, note })

  /*
   * IN THE ORDER SOMEBODY WOULD FIX THEM, and only the first is reported. A step with no wording
   * for a company also has no address to check and no fields to fill; listing all three would
   * read as three problems when there is one.
   */
  if (!template) {
    return hold('no_wording', debtor.kind === 'company'
      ? 'This account is a company and there is no company wording for this step. Write it in the '
        + 'library, or take this step out of the workflow.'
      : 'There is no wording for this step. Write it in the library before the workflow reaches it.')
  }

  /* NOT A FAULT. Its day came and what it waits for is a person — which is what it was set to do
     on the day the run started, so the note says the thing they have to do. A release is that
     person, having looked; every guard below it still applies to them. */
  if (node.needsRelease && !input.released) {
    return hold('waits_for_person', node.statutory
      ? 'A statutory demand. Check the address, the balance and that no dispute or arrangement is '
        + 'live, then send it.'
      : 'Waits for you: it says something has already happened, so it may not go until it has.')
  }

  if (input.afterStepSent === false) {
    return hold('out_of_order',
      'The message before this one did not go. This one refers to it, so it would be telling the '
      + 'debtor about something they never received.')
  }

  const to = node.channel === 'sms' ? debtor.mobile : debtor.email
  if (!to?.trim()) {
    return hold('no_address', node.channel === 'sms'
      ? 'No mobile number on this account.'
      : 'No email address on this account.')
  }

  if (unfilled.length > 0) {
    /* NAMED, because "a field is missing" sends somebody looking through four pages for it. */
    const where = attachmentMerged.missing.length > 0 && (merged?.missing.length ?? 0) === 0
      ? ' The notice it posts is what asks for '
      : ' It needs '
    return hold('unfilled',
      `Nothing on the account fills ${plural(unfilled)}.${where}${listOf(unfilled)}, and until `
      + 'it is there the notice would go out with the brackets still in it.')
  }

  /* THE NOTICE ITSELF, through the same gate the composer uses before it will attach one. */
  if (template.attachment) {
    const problems = letterProblems(template.attachment.doc, 'collections')
    if (!canUseLetter(problems)) {
      return hold('attachment_unfit',
        `The notice this posts cannot be sent: ${problems.map((p) => p.message).join(' ')}`)
    }
  }

  return { ...base, can: true, refusal: null, note: null }
}

/**
 * What this step costs the debtor, on its own day.
 *
 * ON ACCOUNTS ONLY — the firm's instruction, and it is not enforced here because it cannot be: a
 * workflow runs on an account and on nothing else. It is said out loud anyway, because the next
 * person to reach for this function will be looking at a campaign over a list of leads.
 *
 * PRICED BY `scheduleFor(dueOn)`, never by today's schedule. A step that fell due in February and
 * is sent in April is a February action; CLAUDE.md's rule is that the date of the ACTION decides,
 * and a run that sat held over a tariff substitution is exactly where that bites.
 */
function quote(node: WorkflowNode, body: string, dueOn: string): StepCharge | null {
  const schedule = scheduleFor(dueOn)
  if (node.channel === 'email') {
    /* Item 1(a): a necessary ordinary letter, registered letter, facsimile or e-mail. The notice
       it posts is not charged again — one email is one action, whatever is attached to it. */
    return {
      item: '1a', rand: itemAmountFor('1a', 1, 0, schedule), segments: null,
      citation: schedule.citation,
    }
  }
  if (node.channel === 'sms') {
    /* Item 1(c) is PER SEGMENT, and the network decides how many there are — so it is counted on
       the merged text, because braces never reach a handset and a long surname does. */
    const { segments } = smsCost(body)
    return {
      item: '1c', rand: itemAmountFor('1c', segments, 0, schedule), segments,
      citation: schedule.citation,
    }
  }
  /* A call, a document, a task: chargeable in their own right where they happen, but not by a
     scheduler sending something. Null rather than zero — "no charge" and "free" differ. */
  return null
}

/** The filled values only, which is all the removal has to ask about. */
function asStrings(values: Partial<Record<string, string | null>>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(values)) if (typeof v === 'string') out[k] = v
  return out
}

/** Every span of a notice, so its merge fields can be read the way the message's are. */
function documentText(doc: LetterDocument): string {
  const out: string[] = []
  const eat = (spans?: { text: string }[]) => { for (const s of spans ?? []) out.push(s.text) }
  for (const b of doc.blocks) {
    if (b.kind === 'table') { for (const row of b.rows) for (const c of row) eat(c.spans) }
    else if (b.kind === 'list') { for (const item of b.items) eat(item) }
    else eat((b as { spans?: { text: string }[] }).spans)
  }
  return out.join(' ')
}

const plural = (fields: string[]) => (fields.length === 1 ? 'a field this needs' : 'fields this needs')

/** "{{listing_date}} and {{listing_reference}}" — as they appear in the notice, so they can be found. */
function listOf(fields: string[]): string {
  const shown = fields.map((f) => `{{${f}}}`)
  if (shown.length === 1) return shown[0]
  return `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`
}
