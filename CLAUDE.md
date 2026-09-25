# Raptor

A CRM and collections system for **Bredell Ferreira**, a South African debt-collection firm.
Sales side (leads, deals, clients) and collections side (the book, the diary, mail, disputes) in
one app.

Read this before changing anything. Most of it is here because getting it wrong once cost real
time, and a few items are here because getting them wrong would cost the firm money or a client.

---

## The vocabulary is the firm's, not the database's

The single most common mistake is showing a person a column instead of an answer.
`status = 'Active: Unfrozen'` describes how a row got into the table. It says nothing about the
debtor. Four vocabularies exist and they are not interchangeable:

| Layer | Where | What it is |
|---|---|---|
| **Client position** | `src/lib/clientPosition.ts` | The 13 rungs a client is reported on: Paying, Arranged, Broken arrangement, Refusing to pay, Cannot pay, Negotiating, In progress, Tracing, Disputed, Legal, Under administration, Frozen, Closed. **Derived**, never stored. |
| **Account band** | `src/lib/collectorGrade.ts` | Generic / High value (R25 000) / Major (R50 000). Decides who may be given the account. Derived from balance, lifted by a hard position. |
| **Collector grade** | `src/lib/collectorGrade.ts` | Junior → Skilled → Senior → Elite. Set by a team leader, **never computed**. |
| **Diary kind** | `src/lib/diaryPriority.ts` | The work ladder: Broken PTP → New account → PTP due → Callback → Dispute chase → No contact → Trace → Review. Mirrored in SQL by `diary_priority()`. |

**Grade decides WHICH accounts, never HOW MANY.** Company standard is 500 on the book and 50 a
day for everybody; a junior and an elite carry the same volume. Per-person overrides live on
`profiles.book_ceiling` / `diary_capacity` / `diary_reserve`; null means the standard.

**A routine review is the LAST rung, below even a trace.** It is the only kind with no event
behind it.

**A HANDOVER IS ONE ACCOUNT.** The firm, asked directly: *"an endeavour file can have many
handovers, but each handover is an account. If I refer to accounts or I refer to handovers, I'm
referring to the same thing."* Raptor's `handovers` TABLE is the **batch** they arrived in — the
same word for a different thing, which is fine in the database and not on a screen. So a screen
about the batch says **batch**; a screen about one account may say handover. "Import Handover" on
the client page meant "record the numbers for a batch", was singular where the firm means one
account, and imported nothing at all.

---

## Rules that are law, not preference

- **In duplum** (NCA s103(5)) — once in default, interest + fees + costs may not exceed the
  capital outstanding. `in_duplum` and `in_duplum_ceiling` enforce the ceiling; nothing may grow
  non-capital past it.
- **Section 129 is NOT legal action.** It is the statutory demand *before* court. An account on
  Section 129 is `in_progress`, not `legal`. 279 accounts carry it.
- **Annexure B tariff** (`src/lib/annexureB.ts`) prices every chargeable action: email R25, SMS
  R3.50/segment capped at 10 a month, consultation R60, disputes R25, receiving email R13.
  Fees are raised on the action and only become billable once money is recovered.
- **Fees are charged on ACCOUNTS ONLY** — never on leads or deals. The sales side raises nothing.
- **Financial records are immutable** once remittance has run or a payment is processed.
- **IMPORTED HISTORY IS FROZEN AT WHAT WAS IMPORTED.** The firm's own instruction: "what we
  import, the data has to stay exactly like that, because we can't change the remittances that
  has already been passed." Swordfish's figures are what the client was invoiced on, so they are
  the record — not our arithmetic about what they should have been. Where the two differ, write
  Swordfish's and REPORT the difference; `swordfishImport.ts` rule 1 already says this and it is
  the reason it says it. Recalculating an imported fee or commission against a current schedule
  rewrites an invoice a client has already paid.
  **Corrections are the firm's decision, made case by case, never a migration that sweeps.** If a
  discrepancy needs fixing, ask — do not fix it.
- **New charges are priced on the schedule in force on the day of the action**, which from now on
  means 2026. `scheduleFor(date)` decides this and it takes the ACTION's date, never today's —
  a 2019 fee re-read today is still a 2019 fee.
- **Refusing to pay ≠ cannot pay.** One is a legal decision, the other is a pensioner. Never put
  them on one list.

---

## Architecture, and where it bites

**Two data paths, on purpose.** `AppStore` holds the sales side (a few hundred rows a person
edits). The collections book is hundreds of thousands of rows and is queried directly, paged,
with every filter applied in the database. A list that loads the book to count it stops working
the month it matters.

**Hand-written row mappers drop columns silently.** `AuthContext.mapProfileRow` and
`accountBook.toAccount` list every field by hand. A column present in the database, in the type
and in the `select('*')` but missing from the mapper reads as `undefined` for ever and nothing
fails. `diary_capacity` sat in that state for months. `firmSettings.ts` keeps FIVE such lists —
the select, the `Row`, the interface, the mapper and the update — so `check-firm-settings.mjs`
holds all of them against `schema.sql` **in both directions**; a column added to the table and
forgotten in one of them is a failure there rather than a blank trust account on a section 129.

**One clause builder.** `applyAccountFilters()` turns an `AccountQuery` into clauses and both the
list and every bulk action go through it. Written twice they drift, and the failure is not a
wrong list — it is changing accounts nobody saw.

**A letter is typed on the page, and the page is not what is stored.** `LetterPageEditor` is one
contenteditable A4 sheet with the firm's letterhead behind it — the firm asked for the page rather
than a stack of blocks, and there is deliberately no separate preview. `letterToHtml` draws the
model onto it and `documentHtmlToBlocks` reads it back against a closed list of shapes; the
browser's markup is never stored. Two rules follow and neither is optional: **the parse must be
total** — every top-level element contributes a block, so an element nobody recognises cannot take
the rest of the notice with it — and **the sheet is never `transform: scale()`d**, because a
browser hit-tests the caret in unscaled coordinates. A preview may be photographed down; a thing
you type in may not.

**The page breaks are live, and the push is a pixel margin.** `planPageBreaks`
(`src/lib/pageBreaks.ts`) is measured against the rendered sheet on every edit, and any block that
would cross a boundary is given a top margin **in pixels** so its whole box starts on the next
page. Three things there are load-bearing: **a margin, not padding** (padding moves the text and
leaves the box — a bordered table then prints its rule across the letterhead's footer); **pixels,
not millimetres**, because `mmOf` reads only `mm`, which is what keeps the page layout out of the
saved document; and **the collapsed gap added back**, or CSS collapses the push into the existing
margin and every break lands short. The letterhead is `repeat-y`, once per page.

**Anything inserted into the sheet goes in at the TOP LEVEL** —
`insertAtTopLevel`, never `execCommand('insertHTML')`. execCommand leaves the result where the
caret was, so pasting with the cursor in a list nested a whole notice inside the `<ul>`: drawn
correctly, parsed as nothing (`topLevelBlocks` reads depth zero), saved as the blocks it started
with, and gone on the next render. **A string search of the sheet's innerHTML cannot see this** —
assert on the sheet's `children`.

**A paste keeps its shape and still not its markup.** `clipboardToLetterHtml`
(`src/lib/letterPaste.ts`) converts what is on the clipboard **into** the same closed tag set —
rich text through a sanitiser, Markdown through a converter, and an ordinary sentence not at all
(it returns null and the caller inserts plain text). This replaced a plain-text paste, which was
the wrong trade for the way the firm works: a whole section 129 pasted in arrived as forty lines
of body text with "1 YOUR DEFAULT" in the middle of one. **The honesty was never in the plain
text, it was in the closed set** — so do not "fix" this back. Two things it must keep doing:
a `<span class="ltr-n">` copied out of the editor carries the **drawn** section number, which has
to be dropped while the numbering itself survives; and `<style>` contents are not text.

**A PDF can only print Windows-1252.** `letterPdf` draws in the 14 standard PDF faces, which every
reader already has, so the repertoire is fixed and `src/lib/winAnsi.ts` writes it out
(check-win-ansi holds it against pdf-lib character by character). Two kinds of character it cannot
draw, treated oppositely: **invisibles are fixed quietly** — a **tab** above all, because a Word
table copied as plain text separates its cells with tabs, and that is what stopped the firm
attaching a section 129 — while a character that is a **real word** is reported and the build
refuses, because substituting would change what the debtor is told. The **soft hyphen is encodable
and still dropped**: WinAnsi draws it as a real hyphen, mid-word. The **non-breaking space is
kept**, so Rand amounts do not break across lines — and `letterLayout` does not treat it as a
place a line may end, which is the half that actually does the keeping (`\s` includes U+00A0).

**One font is embedded, and only one: Charter**, because the firm asked for it off their own
section 129. `src/lib/charter.ts` carries the argument and `check-charter.mjs` holds it up. The
two reasons the standard-faces rule existed were the licence and the size, and neither survived
for this face: Bitstream's grant lets a public repository ship Charter (the notice in
`public/fonts/charter/LICENCE.txt` **must stay beside the files** — the permission is conditional
on it), and a **subsetted** embed puts a four-page notice at about 17 kB, not the megabyte a full
Unicode embed would cost. **The repertoire did not widen**: Charter is subsetted to Windows-1252,
so winAnsi still decides what a letter may contain. **An embedded face can be missing a character
the encoding has** — `FaceGaps`, and Charter has three: the **non-breaking space is drawn as a
space** (it has no glyph, and a missing glyph prints as a hollow box in the middle of every Rand
amount), the soft hyphen never reaches it, and the **euro is refused** because a currency symbol
is a word. A letter set in anything else is unchanged, and a Charter letter whose font files did
not load **falls back to Times rather than refusing** — a notice in the wrong serif went out; a
notice that would not attach did not.

**An email cannot carry a font, so Charter is asked for and Georgia is what draws.** Gmail,
Outlook and Apple Mail all ignore `@font-face`, so `CHARTER_EMAIL_STACK` names Charter first and
**Georgia second on purpose** — Georgia is Matthew Carter's too, the screen-drawn relative of
Charter, so the attached notice and the covering email are one hand rather than two. Never a
sans-serif in that stack. The picker **says so in the label**; a bare "Charter" there would
promise the firm something a debtor's inbox cannot honour. And the **compose box is now set in
the firm's own face** (`emailBodyCss`, parsed from the very rule that wraps the outgoing message,
so the two cannot drift) — it was the app's sans-serif, which meant where a paragraph ended on
screen had nothing to do with where it ended in the inbox. `emailStyle.ts` holds these apart from
`firmSettings.ts` precisely so a check can import them: firmSettings pulls in the Supabase client
and can only be read back as text. **An SMS has no font at all** — the thing that costs money
there is the non-breaking space, above.

**In an email a blank line is a PARAGRAPH and a single newline is a LINE.** The firm, looking at
a final notice that had gone out: "you should remember the spaces in the email. This is how it
came out." The composer turned every newline into one `<br>`, so four paragraphs of a statutory
notice drew as one block. `emailBodyHtml` (`emailStyle.ts`) splits on blank lines and joins with
`<br><br>` — **two breaks rather than `<p>`**, because a `<p>`'s margin is a default every mail
client picks for itself and two `<br>`s are the one construction all of them draw alike. It also
**escapes**, which it did not: a debtor called "Smit & Seun" put a raw ampersand into the markup
of a legal notice. The stored templates carry the blank lines, so the paragraphing is content the
firm can see and edit rather than a guess in a renderer; **three runs stay tight** — "Label:
value" lines, a numbered list and the colon line above it, and the signature.

**A table with no widths is sized to its CONTENT, not split evenly.** `autoColumnWidths`
(`src/lib/tableWidths.ts`) is CSS `table-layout: auto`, near enough — a column is never narrower
than its widest word, never wider than its longest cell on one line, and the slack is shared in
proportion. **The even split it replaced was invisible on screen and wrong on paper**: a bulleted
list pasted out of Word arrives as a table whose first cell is the bullet, a browser shrinks that
column to fit, and the PDF printed a bullet alone in the left half of the page. Whenever the
editor and the PDF disagree, suspect something the browser computes and the layout engine assumes.
(A `•` or `1.` followed by a tab is also now read as a **list** at paste time, which is the
honest half of the same fix.)

**The PDF is the only page-accurate view, so there is a preview of it.** `PreviewPdf` draws it
with **pdf.js onto a canvas, never an `<iframe>`** — Safari on iOS will not render a PDF in one
and the firm works on an iPad. It reads the live draft, not the saved row. The editor's own
pagination is measured in the browser's fonts and can differ from the PDF by a line near a
boundary; this is the one that prints.

**Three directions of money, three places, and mixing any two is found at month end.** A debtor
pays **in** to the firm's TRUST account; a client pays the firm **in** to its BUSINESS account,
for commission still outstanding — both on `firm_settings`. `companies.banking_details` is
neither: remittance goes **out** to the client whose book it is. They are separate columns under
separate headings, and — this is the part that is load-bearing — **offered to separate halves of
the merge vocabulary**. No `collections` field names the business account, and `templateProblems`
refuses a field outside the template's scope, so a section 129 asking for it does not save. The
protection is the closed list, not a warning. Bank and branch code are stored apart at the firm's
instruction; `{{firm_bank}}` still prints them joined, and `bankLine` is the only place that join
happens, because the same account written two ways across two notices reads as two accounts.

**A new account nobody worked is carried into the day, not filed into the backlog.** The firm:
"the remaining 10 should automatically carry over as priority on the next day's diary, not on the
backlog", and the team leader is told. `src/lib/newAccounts.ts` decides it and three things there
are load-bearing. **The date never moves** — re-diarising is what the old system did, and
`diary.ts` says what it cost ("nobody can say how much work was missed last year"); the entry
keeps the day it was always due, because that date is the only evidence of the miss and it is
what the leader's report counts. So the carry happens in the **view** (`DiaryPage` reshapes
`DayOfWork`; nothing writes). **Derived, never stored**, like `isMissed` — a stored flag needs a
nightly job, and a night it does not run is a night the diary lies. **Working days, not 24
hours**, or an account loaded at four on a Friday is late on Saturday morning with nobody in the
building. It applies to **new accounts only** — the two-list diary is deliberate, and this is the
narrow exception the firm asked for. The over-capacity number is **shown, not solved**: ten
carried onto fifty is sixty, and quietly pushing routine reviews out to make it read fifty would
remove the only signal that somebody is underwater.

**EVERYBODY LANDS ON THE COMPANY DASHBOARD, and exactly one screen wears the photograph.** The
firm: *"it's important for everybody in the company to understand that we are a collective. So
it's important to go into the company dashboard as the first thing that you see. And then you
should go to your own stuff."* `/` used to route by role — Administrator to the admin overview,
Communications to theirs, the pre-legal roles to the floor, everybody else to SALES — so a rep
and a collector had no screen in common and nobody could see what the rest of the firm was doing.
`DashboardRouter` now returns `CompanyDashboard` for everyone; what the role decides is where
**Go to my dashboard** goes, and that is `DEPARTMENT_DASHBOARD` in `departments.ts`, derived from
the role and never from the team (the Stefnova glitch, moved onto the button).
`canLeadCollections` (not `canReassign`, which excludes the pre-legal team leader) still decides
who sees the floor's carried accounts rather than only their own.

**THE HERO MOVED HOUSE AND DID NOT CHANGE.** `CollectionsHero` was built for the collections
screen and the firm moved it whole: *"I want the epicness of the collections dashboard, that
picture that we made. That should be the main. When you open the company, you should see
epicness"* — then *"all of the other dashboards can just have the other hero section. There
should only be one very special page."* So the photograph, the four figures over it and the
controls-plus-month-bar **inside** the dark panel belong to `CompanyDashboard`; every department
screen, the collections floor included, wears the ordinary `DashboardHero`. Redrawing the hero
rather than moving it is a change the firm has already sent back once.

**The same figures on two screens, ONE calculation.** The firm asked for the repetition — *"we
can repeat the same figures"* — which is only safe while it is one piece of arithmetic.
`useCollectionsMonth` owns the period, the as-at day, the team filter, the working-day pace and
the sum of everybody's targets; `MonthControls` and `MonthProgress` draw them. Written out on
both pages the failure is not a wrong screen, it is the company dashboard and the floor quietly
disagreeing about what the firm collected this month.

**A department dashboard is read DEPARTMENT → TEAM → ME, and each level says whose it is.** The
firm, of every department: *"their own statistics is important, their team statistics is
important, and their department statistics is important for them to see."* The collections floor
had all three figures on it and named none of them — the "How the work is going" card was the
FLOOR's promise-kept rate drawn in exactly the shape a collector reads as their own, and nobody
can tell those apart by looking harder. `Level` heads each block and `Measures` draws the four
fair figures for whichever it is about. Two rules there: **the team level is the signed-in
person's team, read off the whole floor rather than the filtered view** (a leader inspecting
another team must not find their own section quietly describing somebody else's people), and it
is **absent rather than empty** where somebody has no team — the call centre manager leads every
team and belongs to none, and a panel of dashes reads as a screen that failed. The floor's tables
come **last**: everything above them is already summed, and they are where somebody goes to find
one row.

**The floor has no menu item.** The firm, once the company dashboard landed: *"that tab can be
removed."* It is a department dashboard like the other three, reached from the company screen —
a menu item for one department and none for the rest was the sales dashboard's old privilege in a
new place. **Both routes stay**: `/performance` is what every collector's name on every table
links to, and `/dashboard/collections` is what the button opens.

**No commission and no Annexure B income on the company dashboard, ever.** The condition the firm
attached to one screen for everybody: *"we're not going to be disclosing commission and income
from the Annexure B fees. We'll do that on another place, which is not even for an
administrator."* Every figure on it is the client's money to recover or a count of work.
`check-company-dashboard` asserts the absence, comments stripped first.

**A workflow day is a BUSINESS day, and the unit is on the version.** The firm, of the section
129 sequence: "this is all working days, not normal days." A day number carried no unit and was
read as calendar days everywhere, so day 32 meant a month where the firm meant a month and a half
— and the twenty business days before a credit bureau listing was a third of its real length.
`workflow_versions.day_unit` decides it and `landsOn()` is the only place it is applied. **Business
is 1-based and inclusive** (day 1 is the day the workflow starts, as the firm writes their chart)
and **calendar is 0-based**, unchanged, or every workflow already drawn would silently move. It is
**not** a node's `deadlineUnit`, which is the period a step gives the *debtor*; one clock is the
firm's and the other the debtor's. **The section 129 goes on day 1 and the final notice on day 12,
not day 10** — day 1 + 10 business days is day 11, when the notice period *ends*, and the final
notice opens "the period given in our Section 129 notice has ended".

**`workflow_take_draft` copies a version column by column and has dropped one three times.**
`trigger_kind`, then the three node columns, then `day_unit` — each time giving back a draft that
looked right and meant something else. **Any column added to `workflow_versions` or
`workflow_nodes` must be added to that function in the same migration.**

**THREE numbers live on an account, and only one of them is ours.** `case_number` is **Raptor's**
— unique, never reused, handed out by a sequence, and **the one every notice quotes**.
`account_number` is the creditor's, off the client's handover sheet — except where the sheet
carried none and `suggestReference` generated one in the client's series, which is why it was
labelled "our reference" on the hero while being the client's on most rows. `client_reference` is
the client's own filing. The firm hit that ambiguity twice: *"I see the client ref, but I don't
see the Raptor reference"*, then *"if they use the client reference, it's more difficult to
find"* — and the book agrees, because **the client's reference is not unique: 5,013 of them are
used on more than one account, so 21% of the book cannot be identified by it.** `{{reference}}`
still means what it always meant (the reference the *debtor* knows); `{{case_number}}` is ours.
The SMSs quote ours only, and that swap was free **because the two are the same width** — a
longer case number is a price rise on every SMS, paid by the debtor, under item 1(c).

**Things that bite:**
- `protect_closed_diary_entries` **silently reverts** edits to `done`/`moved` entries. It does
  not raise.
- `protect_filed_mail_target` reverts link changes on `user_emails` for non-Administrators.
- **One open diary entry per account** — a partial unique index. PostgREST cannot infer a partial
  index for upserts, so a second open entry is refused loudly. That is deliberate.
- **Stored generated columns** (`is_settled`, `diary_entries.priority`, `commission_drift`) are
  computed on write. Changing the function does not recompute existing rows; an UPDATE does.
- `en-ZA` groups thousands with a **non-breaking space** and renders September as **"Sept"**.
  The non-breaking space **costs money in an SMS**: U+00A0 is not in the GSM alphabet, so one
  merged `{{balance}}` drops the whole message to UCS-2 and cuts every segment from 160 characters
  to 70 — a 94-character message going from R3.50 to R7.00, priced per segment under item 1(c).
  `SmsModal` strips it out of the values **the app merged in**, and only those: the box still
  *warns* about a curly apostrophe somebody typed rather than rewriting their words.

---

## Environments

| | Project | Rule |
|---|---|---|
| Staging | `kvkajxpremantdkhmjvb` | Work here. Data is disposable and the firm has said so. |
| Production | `qcvesjzoiznrvunjrqpv` | **Do not write to it casually.** It is behind staging and carries real client money. |

**This GitHub repo is public.** Real client data must never be committed — no CSV exports, no
screenshots of the book, no database dumps.

**API keys never go in a `VITE_*` variable** — Vite bundles those into client code. Never ask the
user to paste a secret into chat.

**Vercel Hobby caps serverless functions at 12 and `api/` is at exactly 12.** A new endpoint
needs an existing one removed, or a Pro plan. `api/` is also **not typechecked** by
`npm run build` — use a temporary `tsconfig` to check it.

---

## Verifying work

```
npm run qa            # everything: rule checks + a real browser
npm run qa -- --fast  # skip the browser
npm run build         # tsc -b && vite build
npm run lint
```

**THESE RUN IN DEVELOPMENT, NOT IN THE APP.** `npm run qa` is something a person or a build runs
before code ships. Nothing in `src/` or `api/` executes it, nothing watches live data with it, and
it will never notify anybody that a figure in production has gone wrong. What it catches is
somebody BREAKING THE MATHS before it reaches the firm. The protection for money already in the
database is a different thing entirely and lives in the database: the four ledgers have no update
or delete policy, so Postgres refuses — see `check-financial-immutability.mjs`, which exists to
make sure that stays true.

**Two kinds of check, answering different questions:**

- `scripts/qa/check-*.mjs` — pure functions and source read back. Fast, no browser, no network.
  Lib imports need explicit `.ts` extensions. `src/data/mockData` is NOT resolvable from here.
- `scripts/qa/e2e/*.mjs` — the real app in a real Chromium, every request answered from fixtures.
  No database, no credentials, no network; writes a placeholder `.env.local` if none exists.
  This layer exists because a panel once shipped, was provably in the deployed bundle, and was
  invisible — a placement bug no unit check could see.

**The convention that matters: after writing a check, break the thing it guards and confirm it
fails.** A check that passes on broken code is worse than none. Two traps seen here:

- `indexOf` returns `-1`, so an order-only assertion passes vacuously once the guard it orders is
  deleted. Assert presence *before* order.
- Indexing `unplaced[0]` when nothing is unplaced throws a `TypeError` two lines below the check
  that should have reported it. Read defensively.

---

## Working in parallel

Sessions cannot see each other and each starts cold. **One branch per session** — two sessions on
one branch means one force-pushes over the other.

`supabase/schema.sql` is append-only, so two sessions will conflict there on nearly every merge.
Both hunks land at the end; keep both. There is **one shared staging database** (Supabase
branching is a Pro feature), so a migration from one session is live for the other while its
local `schema.sql` does not have the column — and `check-select-columns.mjs` validates against
that file. Pull from the other branch when it complains.

Shared files to touch lightly: `schema.sql`, `types.ts`, `App.tsx`, `AppStore.tsx`, `Sidebar.tsx`,
`package.json`.

---

## Migrations

Apply to staging with the Supabase MCP tool, then **mirror the same SQL into
`supabase/schema.sql`** — it is the checked-in record and the QA scripts read it. Functions are
`security invoker` with `set search_path to 'public'` unless there is a stated reason otherwise.

Probe destructive SQL inside a transaction that rolls back (`raise exception` at the end) before
running it for real.

---

## Writing for this codebase

Comments explain **why**, especially where a reasonable person would do it differently — and
where a rule came from the firm, say so. The house style is dense explanatory comments on
non-obvious decisions, not narration of what the next line does. Match it.

User-facing words are the firm's: "Broken promises", not "Failed PTPs"; "No diary date", not
"adrift". A warning that fires when nothing is wrong is worse than no warning, because people
stop reading it.
