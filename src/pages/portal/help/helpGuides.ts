import { CLIENT_FLAGS, CLIENT_POSITION_ORDER, CLIENT_POSITIONS, clientFlag } from '../../../lib/clientPosition.ts'

/**
 * THE PORTAL'S HELP GUIDES (Ryno, 11 Nov · Raptor · Handover 19).
 *
 * Ryno: "a section where there is like help / advisory option ... some guides explaining some core functions that
 * the clients could be wondering about. Like with the reporting". So: short answers to the questions a client
 * actually phones their liaison with, written in the firm's words and the portal's own labels -- a guide that says
 * "press Paid to you" has to be pointing at a button that says Paid to you.
 *
 * CONTENT, NOT CODE, and kept apart from the screen for that reason: the next person to change a sentence here
 * should not have to read a component to do it. Two rules hold it honest (check-portal-help):
 *
 *  - THE POSITIONS GUIDE IS BUILT FROM clientPosition.ts, never retyped. The thirteen rungs and their meanings are
 *    what the client sees on every account line; a second copy here would be the one that went stale.
 *  - NO FIGURE OF THE FIRM'S TARIFF IS WRITTEN OUT. Rates and caps change on a schedule (annexureB.ts) and a help
 *    page quoting last year's R25 is a dispute waiting to happen. The guides say what a fee IS and where to see it;
 *    the remittance advice says what it WAS. The receipt fee's 10% plus VAT is the one exception, because the 50/50
 *    split cannot be explained without it -- and the check holds that sentence to annexureB's own rate.
 */

/** Where a guide can send the client next: one of the portal's own sections. */
export type HelpLink = 'dashboard' | 'reports' | 'tickets' | 'accounts' | 'handover'

export type HelpBlock =
  | { kind: 'p'; text: string }
  | { kind: 'steps'; items: string[] }
  | { kind: 'terms'; items: { term: string; meaning: string }[] }
  | { kind: 'tip'; text: string }
  /** The 50/50 explainer, drawn where the guide puts it. */
  | { kind: 'split' }

export interface HelpGuide {
  id: string
  topic: HelpTopic
  title: string
  /** One line on the card. */
  summary: string
  blocks: HelpBlock[]
  /** The portal section this guide is about, offered as a button at its foot. */
  open?: { section: HelpLink; label: string }
}

export const HELP_TOPICS = ['Getting started', 'Your accounts', 'Payments & reports', 'Working with us'] as const
export type HelpTopic = typeof HELP_TOPICS[number]

/* Built, not typed: one line per rung, in the order the dashboard draws them, with the flag beside it. */
const positionTerms = CLIENT_POSITION_ORDER.map((p) => ({
  term: `${CLIENT_FLAGS[clientFlag(p)].dot} ${CLIENT_POSITIONS[p].label}`,
  meaning: CLIENT_POSITIONS[p].meaning,
}))

export const HELP_GUIDES: HelpGuide[] = [
  /* ------------------------------------------------------------------ getting started */
  {
    id: 'around',
    topic: 'Getting started',
    title: 'Finding your way around the portal',
    summary: 'What each part of the menu is for.',
    blocks: [
      { kind: 'p', text: 'Everything you have handed over to us is in one place. The menu on the left (across the top on a phone) takes you to each part.' },
      {
        kind: 'terms', items: [
          { term: 'Dashboard', meaning: 'How your book is doing: what you handed over, what has been collected, and what needs you.' },
          { term: 'Reports', meaning: 'Your monthly progress report, and every remittance advice we have sent you.' },
          { term: 'Tickets', meaning: 'Questions between you and us, and whose turn it is on each one.' },
          { term: 'Accounts', meaning: 'One line for every debtor you have handed over, and where each one stands.' },
          { term: 'Hand over', meaning: 'Send us new accounts: a sheet, or one account at a time.' },
          { term: 'Help', meaning: 'These guides.' },
        ],
      },
      { kind: 'tip', text: 'The search bar at the top looks through your accounts by debtor name or reference number.' },
    ],
  },
  {
    id: 'signing-in',
    topic: 'Getting started',
    title: 'Signing in and your password',
    summary: 'First visit, forgotten passwords and staying signed in.',
    blocks: [
      {
        kind: 'steps', items: [
          'The first time, press "Email me a sign-in code" and type the email address we have on file for you.',
          'Type the code from the email, then choose a password. From then on you sign in with your email and that password.',
          'Forgot it? Press "Forgot your password?", and we email you a code to choose a new one.',
        ],
      },
      { kind: 'tip', text: '"Keep me signed in" is ticked for you. Untick it on a shared or public computer.' },
    ],
  },

  /* ------------------------------------------------------------------ your accounts */
  {
    id: 'positions',
    topic: 'Your accounts',
    title: 'Where it stands: what each position means',
    summary: 'The thirteen positions an account can be in, in plain words.',
    blocks: [
      { kind: 'p', text: 'Every account shows one position, worked out from what has actually happened on it: payments, arrangements, disputes, traces and legal steps. It changes on its own as the account moves.' },
      { kind: 'terms', items: positionTerms },
      { kind: 'tip', text: 'A red dot means we need something from you, such as an instruction to go legal. Those also show up under Tickets as "Waiting on you".' },
    ],
    open: { section: 'accounts', label: 'Open your accounts' },
  },
  {
    id: 'accounts-list',
    topic: 'Your accounts',
    title: 'Reading the Accounts list',
    summary: 'What each column means, and which reference to use.',
    blocks: [
      {
        kind: 'terms', items: [
          { term: 'Capital handed over', meaning: 'The amount owed when you handed the account to us: the original account balance.' },
          { term: 'Paid this month', meaning: 'What the debtor has paid towards the account so far this month.' },
          { term: 'Paid to date', meaning: 'Everything the debtor has paid since the account came to us.' },
          { term: 'Capital outstanding', meaning: 'What is still owed on the capital. Interest and collection fees are the debtor’s to pay on top of this and are not part of it.' },
          { term: 'Your reference', meaning: 'Your own account or filing number, from your handover sheet.' },
          { term: 'Our reference', meaning: 'Our case number for the account. It is unique, so it is the quickest way for us to find the account.' },
        ],
      },
      { kind: 'tip', text: 'Closed accounts are hidden until you tick "Include closed accounts".' },
    ],
    open: { section: 'accounts', label: 'Open your accounts' },
  },
  {
    id: 'hand-over',
    topic: 'Your accounts',
    title: 'Handing over new accounts',
    summary: 'Send us a sheet, or one account, and see when it is loaded.',
    blocks: [
      {
        kind: 'steps', items: [
          'Open Hand over. Download our sheet, or send your own, with any documents beside it.',
          'For a single debtor, fill in the short form instead.',
          'It shows as "Received — waiting for us" until we have checked it, then "Loaded", or "Declined" with the reason.',
        ],
      },
      { kind: 'tip', text: 'We look at every handover before it is loaded, so nothing is worked on until it shows as Loaded.' },
    ],
    open: { section: 'handover', label: 'Hand over accounts' },
  },

  /* ------------------------------------------------------------------ payments & reports */
  {
    id: 'split',
    topic: 'Payments & reports',
    title: 'How a payment is split: the 50/50 rule',
    summary: 'Where every rand of a debtor’s payment goes, step by step.',
    blocks: [
      { kind: 'p', text: 'When a debtor pays, the payment is split down the middle. Half goes to the fees side, and half goes to the capital, which is your money.' },
      {
        kind: 'steps', items: [
          'The fees half pays three things, in this order: interest, then the receipt fee on this payment (10% of the payment plus VAT), then the Annexure B collection fees.',
          'If those are paid and there is money left in the fees half, the rest rolls over to the capital half. The fees side never takes more than half.',
          'From the capital, we take our commission at your agreed rate, plus VAT on it. Commission is only ever on capital, never on interest or fees.',
          'The rest of the capital is paid over to you, and shows on your remittance advice.',
        ],
      },
      { kind: 'split' },
      { kind: 'tip', text: 'Interest and fees are paid by the debtor under the Debt Collectors Act regulations. They come on top of what the debtor owes you, so they never come out of your capital.' },
    ],
    open: { section: 'reports', label: 'See your remittance advice' },
  },
  {
    id: 'remittance',
    topic: 'Payments & reports',
    title: 'Reading your remittance advice',
    summary: 'The sections and columns on the advice we email you.',
    blocks: [
      { kind: 'p', text: 'A remittance advice comes with each payover. It lists what was collected in the period and what we paid you. Every advice we have sent is kept under Reports, exactly as it was sent.' },
      {
        kind: 'terms', items: [
          { term: 'Collections by us', meaning: 'Payments that came in to our trust account. Each line shows the capital received, our commission and the VAT on it, and what is still outstanding.' },
          { term: 'Paid directly to you', meaning: 'Payments a debtor made to you. You already have the money, so what we recovered on them is set off against your payover. See "When a debtor pays you directly".' },
          { term: 'Overpayments', meaning: 'Where a debtor paid more than the account owed, the extra is paid over to you in full, with no commission.' },
          { term: 'Handover amount', meaning: 'The original account balance when it was handed over.' },
          { term: '* Late', meaning: 'A payment from an earlier period that was approved after that period’s payover had gone. It is included in this one.' },
          { term: 'Revised (version 2)', meaning: 'We corrected and re-sent an advice. Both versions stay in your list.' },
        ],
      },
    ],
    open: { section: 'reports', label: 'Open Reports' },
  },
  {
    id: 'progress',
    topic: 'Payments & reports',
    title: 'Progress report or remittance advice?',
    summary: 'Two different reports, for two different questions.',
    blocks: [
      {
        kind: 'terms', items: [
          { term: 'Monthly progress report', meaning: 'Every account, where it stands and what has been paid, as at today. It is drawn up fresh each time you open it, so it is always current.' },
          { term: 'Remittance advice', meaning: 'The record of a payover: what we collected and what we paid you for a period. It never changes after it is sent.' },
        ],
      },
      { kind: 'tip', text: 'Both open as PDF or Excel. Choose the format, then Open or Download.' },
    ],
    open: { section: 'reports', label: 'Open Reports' },
  },
  {
    id: 'paid-to-you',
    topic: 'Payments & reports',
    title: 'When a debtor pays you directly',
    summary: 'How to tell us, and how it shows on your advice.',
    blocks: [
      {
        kind: 'steps', items: [
          'Find the account under Accounts and press "Paid to you".',
          'Type the amount, the date and your receipt or bank reference.',
          'It counts once we have approved it, and your liaison is told straight away.',
        ],
      },
      { kind: 'p', text: 'The payment is split exactly like any other. You keep the whole payment, so the fees and our commission on it are owed to us instead. They are shown as "Due to us" and set off against your next payover.' },
      { kind: 'tip', text: 'Please tell us every time. A payment we do not know about can mean the debtor is still being contacted for money already paid.' },
    ],
    open: { section: 'accounts', label: 'Open your accounts' },
  },
  {
    id: 'fees',
    topic: 'Payments & reports',
    title: 'Interest, Annexure B fees and commission',
    summary: 'Who pays what, and why your capital is protected.',
    blocks: [
      {
        kind: 'terms', items: [
          { term: 'Interest', meaning: 'Interest on the debt, at the rate that applies to it. The debtor pays it.' },
          { term: 'Receipt fee', meaning: 'A fee on each payment received, set by the regulations, with a monthly cap. The debtor pays it.' },
          { term: 'Annexure B fees', meaning: 'The fees the Debt Collectors Act allows for the work done on an account: letters, emails, SMSs, calls and disputes. The debtor pays them.' },
          { term: 'Commission', meaning: 'Our fee to you, at your agreed rate, plus VAT. It is taken only from capital we recover, never from interest or fees.' },
        ],
      },
      { kind: 'p', text: 'The law also caps what a debtor can be charged: once in default, interest and fees together may never be more than the capital outstanding.' },
    ],
  },

  /* ------------------------------------------------------------------ working with us */
  {
    id: 'tickets',
    topic: 'Working with us',
    title: 'Asking a question and following tickets',
    summary: 'Raise a ticket, reply, and see whose turn it is.',
    blocks: [
      {
        kind: 'steps', items: [
          'Press "Ask" beside an account, or "Raise a ticket" under Tickets.',
          'Choose what it is about: an update, new details for the debtor, stopping the account, or something else.',
          'Your ticket gets a number (T-123). The answer comes back in writing, under Tickets.',
        ],
      },
      {
        kind: 'terms', items: [
          { term: 'Waiting on you', meaning: 'We need an answer or an instruction from you. The bell at the top lights up gold.' },
          { term: 'With the firm', meaning: 'It is with us and your liaison is working on it.' },
          { term: 'Closed', meaning: 'Done. Closed tickets sit behind their own button.' },
        ],
      },
    ],
    open: { section: 'tickets', label: 'Open Tickets' },
  },
  {
    id: 'call-me',
    topic: 'Working with us',
    title: 'Asking us to call you',
    summary: 'Rather talk it through? Your liaison phones you.',
    blocks: [
      { kind: 'p', text: 'Press "Ask us to call you", give the number to call and when suits you. It goes onto your liaison’s list for today.' },
    ],
  },
  {
    id: 'stop',
    topic: 'Working with us',
    title: 'Updating a debtor or stopping an account',
    summary: 'New details, a withdrawal, or a debtor who paid you in full.',
    blocks: [
      {
        kind: 'steps', items: [
          'Press "Ask" on the account.',
          'Choose "New details for the debtor" for a new number, email or address, or "Stop or withdraw this account" to stop the work.',
          'Tell us why in a sentence. Your liaison confirms on the ticket.',
        ],
      },
      { kind: 'tip', text: 'If the debtor paid you in full, use "Paid to you" first, so the payment is recorded before the account is closed.' },
    ],
    open: { section: 'accounts', label: 'Open your accounts' },
  },
]

/** A guide's words as one string, for the search box. */
export function guideText(g: HelpGuide): string {
  const parts = [g.title, g.summary, g.topic]
  for (const b of g.blocks) {
    if (b.kind === 'p' || b.kind === 'tip') parts.push(b.text)
    else if (b.kind === 'steps') parts.push(...b.items)
    else if (b.kind === 'terms') for (const t of b.items) parts.push(t.term, t.meaning)
    else if (b.kind === 'split') parts.push('50/50 split payment allocation fees capital commission')
  }
  return parts.join(' ').toLowerCase()
}

/** Every word typed must appear somewhere in the guide. */
export function matchesGuide(g: HelpGuide, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const text = guideText(g)
  return words.every((w) => text.includes(w))
}
