# Backlog

Agreed but not built, and the things that will bite if nobody remembers them. Sessions start
cold, so anything living only in a conversation is lost — if it is decided, it belongs here.

`CLAUDE.md` is how the system works. This is what is left.

---

## Next up

### 1. An overdue promise sorts as a Broken PTP — DERIVED, no nightly job

**Decided.** A promise due on the 31st with no money in by the 1st is a broken promise the next
morning, at the top of that day's list. One day, not two: speed is what recovers a defaulted
payment.

**No job, and that is the point.** Position is derived, never stored, and the diary already
derives "missed" as an open entry whose date has passed. An overdue promise with no payment *is*
a broken promise — nothing needs to write it down. Deriving it means:

- true at midnight with no cron to fail or forget
- money landing on day 2 corrects itself; no second job to undo the first
- **costs no Vercel function**, and `api/` is at 12 of 12

What it touches: the ordering in `diaryPriority.ts` so a `promise_due` entry past its date sorts
at `promise_broken`'s rung, and `clientPosition.ts` so the account reports as
`broken_arrangement`. Neither writes anything.

**Open question, not yet answered by the firm:** debit orders. A cash deposit reflects the same
day, but an unpaid debit order can take two days to report back. If the firm runs debit-order
arrangements, a +1 rule flags brokens that are not broken — the grace would then have to follow
the payment method rather than the calendar. Ask before building.

### 2. The collector's own dashboard — BUILT

At `/performance`. The firm's month (11th to the 10th) with a period picker, the money tiles, the
book-independent measures kept visibly apart from them, and the over-ceiling notice where a
collector will actually see it.

Left to do on it: a per-collector drill-down (clicking a row on Everyone), and thresholds for the
traffic lights that are the firm's rather than my guesses — they live in one constant,
`THRESHOLDS` in `collectorScore.ts`, for exactly that reason. Ask after a season of real figures.

### 3. A sales diary, on the main `diary_entries`

**Decided:** the sales side gets a diary running on the existing table, not a second one. Two
diaries means neither is trusted.

`tasks` already has the polymorphic shape (`lead_id`, `deal_id`, `contact_id`, `company_id`).
`diary_entries` has the better model — a ladder ordered by what the work *is*, and a move that
cannot erase the miss. What Tasks has and the diary lacks is a time of day.

Shape: `account_id` becomes nullable, the four sales FKs are added with a CHECK that exactly one
is set, `due_at time` joins `due_on`, the one-open index becomes per-subject, and
`diary_priority()` learns a sales ladder.

**Blocked on three answers from the firm:**

1. What is the sales ladder? The collections one is theirs and works because it is ordered by
   what recovers money. What does a rep look at first?
2. One open date per lead, like an account — or may a deal hold "call Tuesday" and "proposal due
   Friday" at once?
3. Does the Tasks screen survive for things that are not a next touch, or does it become the
   diary? If both exist the line between them has to be obvious or people file in the wrong one.

**This is mine, not the sales session's.** It touches `diary.ts`, `diaryPriority.ts` and `tasks`.

### 4. Client reporting, then the portal

Monthly frozen snapshots on the firm's own period — the 11th to the 10th; `salesMonth.ts`
already has the engine. Remittance Advice and State of Accounts generated on the 11th, released
on the 15th. Then a client login reading those snapshots rather than live data, so a report
cannot change under a client after they have read it.

### 5. Shuffling the book, and the workflow engine it belongs in

**The rule, in the firm's words.** A collector does not work an account for more than two month
ends. An account handed over on 16 September runs through the end of September and the end of
October; on **the fifth day after that second month end** — 5 November — it is shuffled to the
next clerk. What triggers it is *no payment* in that window, not a lack of activity.

**It cannot go to somebody who has already had it.** "Had it" means **allocated to them**. A clerk
who left a note, took a call or sent a letter on the account has not had it and is still eligible.
`account_desk_history` already records every allocation as an event row, so the exclusion list is
a query against it rather than a new column.

**Volume: about 3 000 accounts at a time.** This is the commonest bulk action in the firm, not an
exceptional one. `BULK_CEILING` is 5 000 and every id-filtered write is chunked for that reason.

**The firm's decision: do not build this as a one-off.** It belongs in a general **workflow /
automation** engine — rules for what an account must do and when. "Shuffle after two month ends
without payment" is one rule; "send this letter on that date" is another; the Section 129 clock
and the dispute chase are two more that are currently hand-rolled. Their words: *"that's where we
can build in something like that, a specific rule."*

**What has to be answered before anything is built:**

1. Where does a rule run? `api/` is at **12 of 12** on Hobby, so a nightly endpoint has no room —
   it wants either `pg_cron` in the database or a rule evaluated on read, the way the overdue
   promise in item 1 is derived rather than written.
2. What is a "month end" for an account handed over on the 31st, and does a public holiday or a
   weekend move the fifth day?
3. What happens when every eligible clerk has already had the account? Back to unallocated, or
   the rule stops and it is flagged for a team leader?
4. Does a shuffle reset the two-month clock, or does it run from the original handover?
5. Debit-order accounts again: a payment that reflects two days late could shuffle an account
   that did pay. Same grace question as item 1.


### 6. Likelihood of collection — the firm's own risk profile

**Asked for, deliberately not started.** The firm: *"We will also build our internal likelihood
of success based on this data. If we see, for example, a debtor has judgments, it will
significantly reduce the likelihood of collection. So this could be one of our parameters that we
use for risk profile, for example, even when we're reporting back to the clients."*

**No weights have been invented, and none should be until the firm calibrates them.** This number
goes onto a CLIENT REPORT. A score built from a plausible-sounding formula is a number the firm
would have to defend to a client without being able to say where it came from — and it would be
wrong in the direction that matters, because the only thing that can settle the weights is what
the firm has actually recovered on accounts that looked like this one. That calibration needs a
year of closed accounts, which the book has; the scoring does not need designing first.

What is already in the data, and worth naming now so the calibration has somewhere to start:

| Parameter | Where it lives today |
|---|---|
| Judgments: how many, how recent, who sued | `account_judgments` — built |
| A judgment for tax | `account_judgments.plaintiff` = SARS. Weighs more than a trade creditor |
| The debtor is under administration | position `under_administration`, `practitioner_kind` |
| Company status (e.g. Final Liquidation) | proposed on upload; moves the account to Under administration |
| A practitioner appointed | `practitioner_kind` — collection is restrained, not merely slow |
| Other companies a director still runs | `account_director_companies` — somewhere else to recover from |
| Contact Score and Risk Score | read off the profile and shown on upload; **not stored** |
| PTP success ratio and how many were taken | `debtor_accounts.ptp_success_ratio` — imported |
| Paid anything at all, and when | `payments_to_date`, `last_payment_at` |
| How close prescription is | `prescription_date` |
| Whether the debtor has ever been reached | the diary and the timeline |

Two things to settle with the firm before any of it is scored:

1. **Is the number shown to clients, or only used internally to sort work?** They said "even when
   we're reporting back to the clients", which reads as both — but a figure on a report and a
   figure that orders a work queue can be wrong in very different ways, and only one of them
   costs a client relationship.
2. **What counts as success?** Recovered in full, recovered anything, or recovered enough to
   cover the cost of working it. The third is the firm's real question and the hardest to
   backfill.

Until then the account screen shows the judgments as ROWS — who sued, for what, how long ago —
and no score. See `StandingPanel` and `accountStanding.ts`.

**A judgment against a director is kept apart from one against the company** —
`account_judgments.against_director_id`. A director's personal judgments are real and worth
having, but counting them as the company's would inflate the one signal this whole entry is
about. Whatever the scoring ends up being, it reads the null ones.

### 6a. Reading a trace — BUILT, with three things left

Upload a bureau PDF on an account and it asks whether the trace is for the company or for a
director, reads it in the browser (`pdfText.ts` → `traceProfile.ts`), shows what it found, and
files only what is ticked. Numbers are pre-ticked by how recently the bureau saw them and how many
other people they are linked to. See `TraceUploadModal`.

**The firm settled the open question: the upload PROPOSES.** A profile that reads "Final
Liquidation" now offers a tick — put the account on Liquidation/Sequestration — and once it is
taken, asks who to claim from. Proposed rather than applied, because it changes what the client is
told and the person filing is the one who can say whether the PDF is the right one.

One thing left, and it is maintenance rather than work:

- **The case-type and case-reason vocabularies are fixed lists** (`CASE_TYPES`, `CASE_REASONS` in
  `traceProfile.ts`). A consumer report prints judgments as a wrapped table with no marker between
  the columns, and those two lists are what make the third column — the plaintiff — safe to read.
  A row using wording not on the lists is kept in the bureau's own words and shown as quoted, not
  reported. **Add to the lists as new wording turns up; do not make the split a guess.**

### 6c. Working a trace — BUILT, with two things left

A filed trace is now a working surface: ring a number from inside it, say what happened (reached
them / rang, no answer / off or dead / not the debtor), undo a wrong answer, and promote the ones
that turn out to be real onto the account's principal contacts. A relative goes on as a next of
kin, labelled. See `TraceWorkspaceModal`, `traceStore.ts`.

The panel shows a summary: principal number, principal address, employer, property still held,
possible next of kin, and what they direct. `untried` counts what nobody has rung — the one number
that says whether the search the firm paid for has been used.

Not done:

1. **A confirmed number does not verify the contact it was promoted to.** `account_contacts` has a
   `verified_at` of its own and the two do not talk: marking a trace item "reached them" AFTER
   promoting it leaves the contact unverified. The link exists (`promoted_contact_id`) so this is
   a small write, but which way it should flow is a question for the firm — does confirming on the
   trace confirm the contact, or are they two separate confirmations of two separate things?
2. **Next of kin is a label, not a relationship.** Promoting a relative writes a contact of kind
   `other` with "Next of kin" in its label. That is honest and it is not structured: there is no
   way to list every next of kin across the book, or to record what the relationship actually is
   once somebody establishes it. If the firm starts working next of kin seriously it wants its own
   shape.

### 6b. Setting a position by hand — STILL NOT BUILT

`setSubStatus` exists but takes only the wording `administrationReading` produces, so a trace can
move an account and a person cannot. The firm asked for this directly — "you need to be able to
change the status on the account itself" — and it wants the firm's own list of positions in front
of whoever is choosing, plus a reason recorded on the timeline. The write path is one line; the
decision about which of the thirteen rungs a person may set by hand, and which are only ever
derived, is not.

### 7. Campaigns

Email campaigns for team leaders; SMS Administrator-only, because SMS costs real money per
segment and the Annexure B cap is 10 a month per account. The firm's view: "SMSs don't really
work that well" — email is the priority.

---

## Loose ends that will bite

- **24 accounts have a telephone number in the ID field.** All individuals, and every one of them
  carries that same number on its contact list as well, so nothing is lost by clearing it — the
  ID was simply never captured and Swordfish's export put the phone number in that column. The
  importer is not at fault and already says so in its notes ("imported as found — it is
  Swordfish's data"), but the consequence has teeth now: a number in that field is what the Trace
  button hands to a paid bureau search. The button refuses anything that is not a Luhn-valid ID
  or a registration number, so the danger is contained; the rows still want fixing before the
  production import, and the same question wants asking of the production export.
  `select count(*) from debtor_accounts where debtor_id_number ~ '^0[1-8][0-9]{8}$'`

- **`Main` is 103 commits behind** and has no supersede in `diary.ts`. Anything deployed from it
  runs pre-index code against a database that has the index — which is exactly the constraint
  violation the firm hit. Merge before relying on any deployed build.
- **Production has no `diary_entries` table at all.** The whole collections diary is staging-only.
- **`EMAIL_CREDENTIALS_KEY` must be rotated** — a production key was generated in chat in an
  earlier session. Three production mailboxes need reconnecting afterwards.
- **The Connect Mobile API token and the BuzzBox provisioning URL appeared in a screenshot** and
  should be reissued.
- **Allocation is gated in the UI only.** `debtor_accounts` RLS lets any signed-in user write any
  column, so the grade rules are advisory. A column-guard trigger like the one on `profiles`
  would fix it — worth doing before the production import, and worth tracing every write path
  first so the import does not break.
- **13 accounts claim a live "Promise To Pay" that Swordfish had already filed under Failed
  PTPs.** Only 3 accounts carry sub-status 'Payment Default' against 40 in the bucket. Decide
  whether those are corrected on the way in.
- **`api/` is at 12 of 12 serverless functions.** The 13th fails to deploy. The firm is staying
  on Hobby while building, so anything needing an endpoint has to be designed around it — see
  the e-signature work, which uses an anon RLS path instead.

---

## Next on the trace

- **Property belongs on the account's main page.** The firm's words, straight after approving the
  workspace: "Property is also something that should basically be added to the main page." A house
  they still own is the difference between an account worth attaching and one worth closing, and
  it currently only exists two clicks inside the trace. `heldProperty()` already returns exactly
  what is wanted, filtered to what they still own; it is the placement that has to be decided,
  beside the standing panel or under the debtor's details.
- **`rankContacts()` is no longer called by anything.** It ranked which of a bureau's numbers were
  worth offering, and it was the rule behind which findings arrived ticked at import. With the
  ticks gone it has no caller, though it is still exported and still checked. Its natural home is
  the workspace — marking the bureau's best guesses so a collector knows where to start on a
  profile carrying twenty-six numbers. Either give it that job or delete it; leaving a tested,
  uncalled rule in the library is how a codebase grows furniture.
- **Then the account view itself** — "we'll move on to the accounts viewing and how this would
  look." Not started, and not to be guessed at.

---

## Decided, so nobody reopens it

- **Mail sent to a debtor from Outlook is not charged.** It is pulled into the Sent tab so the
  mailbox is complete, and that is all. Raising item 1(a) on it was proposed and the firm turned
  it down in those words: "We will be only working from inside Raptor." Charging what the sync
  scrapes out of a Sent folder would put fees on a debtor's account that nobody in Raptor ever
  decided to raise, and there is no way to tell a demand from a personal note once it is there.
- **A reply to a debtor raises item 1(a) and nothing else.** Item 6, "correspondence received and
  attended to", is raised once when the message ARRIVES and is filed — receiving it and attending
  to it are one charge. A second item 6 on the reply would bill the debtor twice for one incoming
  email. Both halves together are the R13 + R25 the firm means by "correspondence and an email
  charge"; they are simply raised at the two different moments they happen.

---

## Not this session's

The sales pipeline, mandates, online signature, layouts and mail belong to the sales session on
`claude/raptor-mail`. Do not edit `src/pages/leads|deals|contacts|companies`, `src/lib/userMail.ts`,
`src/lib/email*.ts`, `src/pages/mail/` or `api/email/` from the collections side.
