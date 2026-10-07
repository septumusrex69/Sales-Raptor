import type { User, UserRole } from '../types'

/**
 * WHAT A PERSON MAY DO, AS A THING YOU CAN GIVE SOMEBODY.
 *
 * THE FIRM, SHOWING ME SWORDFISH'S OWN SCREENS: "every user has their own unique set of
 * permissions. So you can choose, for example, for a user to have a management template, but you
 * can add them more functionality. Perhaps we should do something similar."
 *
 * WHAT RAPTOR HAD WAS THE ROLE AND NOTHING ELSE. Thirteen predicates, each a list of role names
 * written out by hand, and no way at all to give one person one extra thing. Nicole needing to
 * approve a payment meant either making her an Administrator -- which is the Finance section, the
 * user list and the firm's settings as well -- or inventing a tenth role for one person.
 *
 * ------------------------------------------------------------------------------------------
 * WHAT WE COPIED, AND WHAT WE DID NOT
 * ------------------------------------------------------------------------------------------
 *
 * Swordfish's screens are four grids and they are not the same kind of thing at all:
 *
 *   Access Permissions        ~150 entries, genuinely mixed        the real capability list
 *   Access Permissions: Data   11 entries, 5 ticked                the money boundary
 *   Report Permissions        ~290 entries, ~91% ticked            feature switches
 *   Import Permissions        ~125 entries, ~95% ticked            feature switches
 *
 * THE TWO SMALL ONES ARE THE IDEA. The Data panel is eleven lines and somebody has plainly
 * thought about each: Reverse Payments yes, Suspend Payments no, Import/Create Payments yes,
 * Import/Create Balance Adjustments no. That is a permission doing work.
 *
 * THE TWO BIG ONES ARE NOT PERMISSIONS AT ALL. Nine boxes in ten are ticked and the exceptions
 * are E4, Archi, WhatsApp, Debicheck, Pay@ -- features the firm does not use. That is a fact
 * about the FIRM, not about fifteen people, and copying it would give us three hundred rules
 * nobody curates. CLAUDE.md's own line about warnings applies exactly: a grid that is 91% ticked
 * is a screen people stop reading.
 *
 * ------------------------------------------------------------------------------------------
 * AND ONE THING ON THEIR SCREEN IS THE REASON THIS FILE HAS A SECOND TIER
 * ------------------------------------------------------------------------------------------
 *
 * "Apply In Duplum" is a checkbox in Swordfish. In duplum is NCA s103(5): once a debtor is in
 * default, interest and fees and costs may not exceed the capital outstanding. Whether it applies
 * is a fact about the DEBT. Making it a property of whoever is signed in means two people can
 * open one account and be told two different things about what is legally recoverable.
 *
 * So this file holds a CLOSED list, and `check-capabilities` holds it closed. The things that are
 * law or the firm's stated policy are not in it and cannot be added:
 *
 *   IN DUPLUM and the in_duplum_ceiling          NCA s103(5).
 *   ANNEXURE B prices                            the tariff, by date of the action.
 *   IMPORTED HISTORY                             "the data has to stay exactly like that".
 *   THE FOUR LEDGERS' IMMUTABILITY               no update or delete policy; Postgres refuses.
 *   COMMISSION ON THE COMPANY DASHBOARD          "not even for an administrator".
 *
 * ------------------------------------------------------------------------------------------
 * ONLY WHAT IS ENFORCED IS IN HERE
 * ------------------------------------------------------------------------------------------
 *
 * The firm agreed a longer list -- sending an email, an SMS, a letter, ordering a trace, recording
 * a consultation, unassigning, closing and reopening, running a remittance, importing a statement,
 * writing an account off, publishing a workflow, administering users and settings. None of those
 * has a boundary in the code TODAY: anybody who can reach an account can send an SMS on it.
 *
 * Each arrives here in the same commit as the gate that enforces it, and not before. A capability
 * drawn on the settings screen that nothing checks is a tick somebody relies on -- which is worse
 * than the missing rule it pretends to be, and is exactly how a 91%-ticked grid happens.
 */
export type Capability =
  /* ---- money: Swordfish's "Access Permissions: Data", which is the panel worth copying ---- */
  | 'finance.view'
  | 'business.view'
  | 'business.income'
  | 'payment.record'
  | 'payment.approve'
  | 'payment.reverse'
  | 'payment.move'
  /* ---- the book ---- */
  | 'book.hand_out'
  | 'book.reassign'
  | 'book.freeze'
  | 'floor.lead'
  | 'handover.discard'
  /* ---- clients and disputes ---- */
  | 'client.view'
  | 'dispute.write_to_client'
  | 'dispute.pool'
  | 'mail.refile'
  | 'settlement.approve'
  /* ---- the library ---- */
  | 'library.view'
  | 'library.edit'

export interface CapabilityMeta {
  /** What it is called on the settings screen. The firm's words, not the code's. */
  label: string
  /** The one line under it that says what it lets somebody do, and what it costs if it is wrong. */
  blurb: string
  /** Which block it is drawn in. */
  group: 'Money' | 'The book' | 'Clients and disputes' | 'The library'
  /**
   * TRUE WHERE THE DATABASE ENFORCES IT AS WELL, and it matters on the screen: these are the ones
   * where taking somebody's tick away actually stops them, rather than only hiding the button.
   */
  inDatabase?: boolean
}

/**
 * ORDERED HEAVIEST FIRST WITHIN EACH GROUP, which is also most-dangerous first. A list sorted
 * alphabetically puts "book.freeze" above "payment.approve" and invites somebody to skim.
 */
export const CAPABILITIES: Record<Capability, CapabilityMeta> = {
  /* ---------------------------------- money ---------------------------------- */
  /*
   * THE TRUST ACCOUNT. Still spelled `finance.view` on purpose: the name is written into RLS
   * policies, into grants and revokes on live profiles, and into has_capability. Renaming it to
   * read better on a settings screen would be a migration that can lock somebody out of client
   * money, for nothing. What it GATES is now called Trust; what it is CALLED stays.
   */
  'finance.view': {
    label: 'See the trust account',
    blurb: 'Payover runs, the split on every payment, and what the firm earns. The firm: '
      + '"The Finance section is Administrator only. Sales representatives never see the payment split."',
    group: 'Money',
    inDatabase: true,
  },
  /*
   * THE SECOND BOOK, AND THE REASON IT IS A SEPARATE TICK.
   *
   * THE FIRM, ON SEEING THE TWO AS ONE "FINANCE" SECTION: "the trust and the business should be
   * separated. It shouldn't be in the same tab in finance. It should be like outside... we have
   * one place where we manage the trust and we have another place outside where we manage the
   * business."
   *
   * They are separately governed and separately audited books, and the word Finance over both of
   * them said they were one pot with two drawers. The split is worth having on its own, but the
   * tick is the part that pays for it: a bookkeeper capturing supplier invoices has no business
   * moving client trust money, and the administrator who runs payovers does not need payroll.
   * One gate over both could only ever be the wider of the two.
   *
   * inDatabase NOW, AND IT WAS NOT AT FIRST. The tick was added without the flag because nothing
   * enforced it -- the rule at the top of this file is that only what is enforced goes in, and a
   * tick claiming an enforcement it does not have is worse than the missing rule it pretends to
   * be. `business_expenses` is the first table behind it, and its three policies all ask
   * has_capability('business.view'), so the flag arrives in the same migration as the table did.
   * That is the promise the earlier version of this comment made.
   *
   * ADMINISTRATOR ONLY FOR NOW, which is the allow-list direction: a role added later is refused
   * until somebody decides it belongs. finance.view stays exactly as it was and still gates the
   * trust side -- it is enforced in the database, and splitting an enforced capability is a
   * migration about who may see client money, not a navigation change.
   */
  'business.view': {
    label: "See the firm's own accounts",
    blurb: 'The business account: what the firm earned, what it spent, and which clients owe it. '
      + 'Separate from the trust account, which is money held for other people and is a different tick.',
    group: 'Money',
    inDatabase: true,
  },
  /*
   * WHAT THE FIRM EARNED, AND THE ONE TICK NO ROLE IS BORN WITH -- the Administrator's included.
   *
   * THE FIRM, OF EXACTLY THIS: "we're not going to be disclosing commission and income from the
   * Annexure B fees. We'll do that on another place, which is not even for an administrator."
   * So the Income screen is behind its own tick and it is granted person by person (7 Oct 2026).
   * Enforced by business_income itself, which answers nobody without it.
   *
   * IT LIVES IN NO_ROLE_CAPABILITIES BELOW, which is what keeps it out of the Administrator's
   * template while leaving it grantable -- all_capabilities() is that template plus this list.
   */
  'business.income': {
    label: 'See what the firm earned',
    blurb: 'Commission, interest, Annexure B fees and client charges, client by client. In no '
      + 'role by default, not even the Administrator’s — the firm: "not even for an administrator".',
    group: 'Money',
    inDatabase: true,
  },
  'payment.record': {
    label: 'Record a payment',
    blurb: 'Capture a receipt by hand. A trust receipt comes off the bank statement; what is typed '
      + 'in is a payment the CLIENT was told about, so it belongs with the people who talk to clients.',
    group: 'Money',
    inDatabase: true,
  },
  'payment.approve': {
    label: 'Approve a payment',
    blurb: 'Release a captured receipt so the engine splits it. Until this is pressed no fee is '
      + 'raised, nothing is allocated and no client is owed anything.',
    group: 'Money',
    inDatabase: true,
  },
  'payment.reverse': {
    label: 'Reverse a payment',
    blurb: 'Take an approved receipt back off an account. The reversal is permanent and the money '
      + 'returns as a fresh receipt in the day’s approval queue.',
    group: 'Money',
    inDatabase: true,
  },
  'payment.move': {
    label: 'Move a receipt to another debtor',
    blurb: 'Only while it is unapproved, and only the account — never the amount or the date, '
      + 'which are what the bank said.',
    group: 'Money',
    inDatabase: true,
  },
  /* ---------------------------------- the book ---------------------------------- */
  'book.hand_out': {
    label: 'Hand out accounts',
    blurb: 'Put an account on somebody’s desk. Grade decides WHICH accounts, never how many.',
    group: 'The book',
  },
  'book.reassign': {
    label: 'Reassign somebody else’s records',
    blurb: 'Move a lead, deal, task or contact to a different owner, whoever currently holds it.',
    group: 'The book',
  },
  'book.freeze': {
    label: 'Freeze and unfreeze an account',
    blurb: 'Stop or restart work on one. Usually something a CLIENT asked for, which is why the '
      + 'liaisons have it and a collector does not.',
    group: 'The book',
  },
  'handover.discard': {
    label: 'Undo a handover',
    blurb: 'Remove every account a batch opened, when a client sent the wrong file or sent the '
      + 'same one twice. Refused outright the moment a payment, a remittance, an arrangement or a '
      + 'filed document makes one of those accounts a record rather than a mistake.',
    group: 'The book',
    /* The browser's rule only. The database lets any signed-in person delete an account, which is
       its own hole and a wider one than this -- see handoverDiscard.ts. */
    inDatabase: false,
  },
  'floor.lead': {
    label: 'See the whole collections floor',
    blurb: 'The floor’s carried accounts and everybody’s figures rather than your own. '
      + 'What separates a team leader’s dashboard from a collector’s.',
    group: 'The book',
  },
  /* ---------------------------- clients and disputes ---------------------------- */
  'client.view': {
    label: 'Look at a client',
    blurb: 'The client behind the account — their commission rates, mandate and open deals. A '
      + 'collector works the debtor and sees everything needed to collect without this.',
    group: 'Clients and disputes',
  },
  'dispute.write_to_client': {
    label: 'Write to a client about a dispute',
    blurb: 'Put a query in front of the client, or forward the debtor’s own email to them. The '
      + 'client relationship belongs to whoever holds it.',
    group: 'Clients and disputes',
  },
  'dispute.pool': {
    label: 'See every dispute at once',
    blurb: 'The board as a whole rather than one person at a time. The firm ruled the pooled view '
      + 'out for a team leader: "I can’t see how it would benefit to look at a bird’s eye view."',
    group: 'Clients and disputes',
  },
  'mail.refile': {
    label: 'Re-file a message onto another record',
    blurb: 'Moving mail that is already filed raises a second item 6 fee on the account it lands '
      + 'on, which makes it a money action. Filing UNfiled mail stays open to everybody.',
    group: 'Clients and disputes',
    inDatabase: true,
  },
  /*
   * THE CLIENT'S YES TO A SETTLEMENT, WRITTEN DOWN.
   *
   * A settlement figure is the client's to give, never the collector's -- the firm's own call
   * script: "Never quote a settlement figure that is not approved on the account." Anybody may put
   * a debtor's offer UP; this is the tick that records the client accepted it, with how they said
   * so and until when, and it is what turns {{settlement_amount}} into something a collector may
   * say. The firm gave it to the client liaison role (7 Oct 2026): the liaison is who the client
   * tells. account_settlements has no write policy, so approve_settlement is the only door.
   */
  'settlement.approve': {
    label: "Record a client's approval of a settlement",
    blurb: 'Turn a debtor’s offer into a figure collectors may quote, with the client’s written '
      + 'approval and an expiry. Also how an expiry is extended. A figure approved here is money '
      + 'the client has agreed to write off.',
    group: 'Clients and disputes',
    inDatabase: true,
  },
  /* ---------------------------------- the library ---------------------------------- */
  'library.view': {
    label: 'Read the library',
    blurb: 'Every template, letter and script. The firm: "perhaps everyone can view everything in '
      + 'the library."',
    group: 'The library',
  },
  'library.edit': {
    label: 'Change what the library says',
    blurb: 'The wording is the firm’s legal position and the attorney signs it off. A sentence '
      + 'nobody approved goes out four hundred times rather than once.',
    group: 'The library',
    inDatabase: true,
  },
}

/** Every capability there is, in the order the screen draws them. */
export const CAPABILITY_ORDER = Object.keys(CAPABILITIES) as Capability[]

/**
 * THE TICKS NO ROLE IS BORN WITH, the Administrator's template included, and granted only person by
 * person. The database's all_capabilities() is the Administrator's template PLUS this list -- held
 * against it by check-capabilities -- because a tick outside all_capabilities is unknown to
 * has_capability and therefore ungrantable to anybody, silently.
 */
export const NO_ROLE_CAPABILITIES: Capability[] = ['business.income']

/**
 * WHAT EACH ROLE GETS BEFORE ANYBODY CHANGES ANYTHING -- Swordfish's "template", written out.
 *
 * TRANSCRIBED FROM THE THIRTEEN PREDICATES THIS REPLACES, deliberately without improving any of
 * them. Every reason is already recorded on the function it came from and is repeated in the
 * blurbs above; a refactor that quietly also re-decides who may approve a payment is a refactor
 * nobody can review. `check-capabilities` holds each role's set against the old lists.
 *
 * READ ONLY GETS THE LIBRARY AND NOTHING ELSE, which is what the name has always promised and what
 * `canViewLibrary` already gave it.
 */
export const ROLE_CAPABILITIES: Record<UserRole, Capability[]> = {
  /* Everything but what no role is born with. The only role for which "everything" is nearly true,
     and the reason a grant exists at all is so it stops being the only way to give somebody one
     extra thing. */
  Administrator: CAPABILITY_ORDER.filter((c) => !NO_ROLE_CAPABILITIES.includes(c)),
  'Sales Manager': ['book.hand_out', 'book.reassign', 'client.view', 'library.view'],
  'Sales Representative': ['client.view', 'library.view'],
  'Liaison Manager': [
    'payment.record', 'book.hand_out', 'book.reassign', 'book.freeze',
    'client.view', 'dispute.write_to_client', 'settlement.approve', 'library.view',
  ],
  Liaison: [
    'payment.record', 'book.freeze', 'client.view', 'dispute.write_to_client', 'settlement.approve',
    'library.view',
  ],
  'Call Centre Manager': [
    'payment.record', 'book.hand_out', 'floor.lead', 'client.view', 'library.view',
  ],
  'Pre-legal Team Leader': [
    'payment.record', 'book.hand_out', 'book.freeze', 'floor.lead', 'client.view', 'library.view',
  ],
  /* NO client.view, and that is the firm's rule rather than an omission: a pre-legal agent works
     debtors, not the firm's relationships. */
  'Pre-legal Agent': ['library.view'],
  'Read Only': ['library.view'],
}

/**
 * WHAT ONE PERSON MAY ACTUALLY DO: the role's set, plus what they were given, minus what was
 * taken away.
 *
 * REVOKE LOSES TO NOTHING AND WINS OVER EVERYTHING. Applied last on purpose -- a person who has
 * been given something and then had it taken away has had it taken away, and any other order
 * means the two fields can disagree and the answer depends on which was edited more recently.
 *
 * AN UNKNOWN NAME IN EITHER COLUMN IS IGNORED rather than throwing. These are text arrays in
 * Postgres and a capability removed from the code leaves rows behind; a stale name must not stop
 * somebody signing in, and `check-capabilities` is what keeps the columns tidy.
 */
export function capabilitiesOf(
  user: Pick<User, 'role' | 'grants' | 'revokes'> | null | undefined,
): Set<Capability> {
  if (!user) return new Set()
  const known = (list: string[] | undefined) =>
    (list ?? []).filter((c): c is Capability => c in CAPABILITIES)
  const out = new Set<Capability>(ROLE_CAPABILITIES[user.role] ?? [])
  for (const c of known(user.grants)) out.add(c)
  for (const c of known(user.revokes)) out.delete(c)
  return out
}

/**
 * MAY THIS PERSON DO THIS?
 *
 * THE ONE EXPRESSION IN THE BROWSER THAT ANSWERS IT. The predicates in permissions.ts all come
 * through here now, so a capability cannot be decided one way on the account screen and another
 * way on the list -- which is the fault canHandOutAccounts' own comment records from when it was
 * a bare array inside AccountsList.
 *
 * NULL IS NO. Nobody signed in may do anything; a page that renders before the profile arrives
 * must draw the refusing version rather than briefly offering a button.
 */
export function can(
  user: Pick<User, 'role' | 'grants' | 'revokes'> | null | undefined,
  capability: Capability,
): boolean {
  if (!user) return false
  return capabilitiesOf(user).has(capability)
}

/**
 * IS THIS A DEPARTURE FROM WHAT THE ROLE GIVES? What the settings screen draws a mark against.
 *
 * THE FIRM'S OWN SCREENS DO NOT SHOW THIS and it is the thing I would most want on them: a year
 * from now nobody can tell a deliberate exception from a box somebody clicked by accident. Here
 * the role's set is always visible behind the ticks, so every difference is legible as one.
 */
export function departsFromRole(
  user: Pick<User, 'role' | 'grants' | 'revokes'> | null | undefined,
  capability: Capability,
): boolean {
  if (!user) return false
  const byRole = (ROLE_CAPABILITIES[user.role] ?? []).includes(capability)
  return byRole !== can(user, capability)
}
