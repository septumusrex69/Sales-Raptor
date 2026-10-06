# Handoff — where Raptor stands

**Read this instead of the previous session's transcript.** CLAUDE.md is the law and does not
change often; this file is the moving part. It says what shipped, what the firm has not yet
decided, what is still open, and which tools lie to you in this repo.

Last updated: **6 October 2026**, second session on `claude/sales-raptor-review-p1pzx2`.

**Keep it current.** A session that changes something here and does not update this file has moved
the problem to the next session rather than solved it.

---

## 1. The state of play

| | |
|---|---|
| Branch | `claude/sales-raptor-review-p1pzx2` (one branch per session — two sessions on one branch means one force-pushes the other) |
| Staging | `kvkajxpremantdkhmjvb` — work here, data is disposable and the firm has said so |
| Production | `qcvesjzoiznrvunjrqpv` — **do not write to it casually**, it is behind staging and holds real client money |
| Repo | **PUBLIC.** No real client data in any commit: no exports, no screenshots of the book, no dumps |
| Verify | `npm run qa` (≈12 min, real browser), `npm run qa -- --fast` (≈3 min), `npm run build`, `npm run lint` |

At the last full run (end of the second session): **all green, 17 762 checks across 272 files.**

---

## 2. What shipped this session

Newest first. Each commit message carries the full reasoning; this is the index.

**Second session (6 October, later):**

| Commit | What it is |
|---|---|
| `eb7c973` | **A promise from Swordfish is history, not a new arrangement.** An "open" Swordfish promise already past its date (incl. Swordfish's own "Late") comes in **broken** — not defaulted, which would start the broken-promise workflow and write to the debtor — with a note, and its account filed under 'Failed PTPs' so the Broken promises list finds it; nobody's diary (the firm: "it might fill up the collector's diary"). On a live imported arrangement the promise workflow records its confirmation as **not sent** and sends only dates still ahead, today included. Staging: the 8 confirmation charges cancelled with a reason, the 4 overdue promises marked broken, their accounts filed. `check-imported-promises` (27). |
| `5779bac` | **Accounts list columns: drag to resize, double-click the edge to fit** (iPad double-tap too); widths per device; reset link. |
| `e6f7cf5` | **The import button is a button** — `btn-primary` was never defined; three screens drew it as plain text. |
| `aaca1ff` | **Prompt 8 — a Swordfish import is all or nothing.** `import_batch_id` on companies, handovers and debtor_accounts (everything else cascades from an account); on any failure the screen calls `discard_import_batch(id)` and says the run was taken back out. The RPC is Administrator-only and refuses once money on the batch has been split or put in trust. `e2e/swordfish-import` uploads real CSVs at both cut-offs and makes the interest insert fail. |
| `e98f814` | **Prompt 8 — URGENT: a receipt Swordfish already paid over is never split.** `allocate_payment` never asked `paid_over_in_swordfish` (its own comment named the reason; the code did not), so the insert trigger split every imported receipt. Now the FIRST gate, before the open-period interest. `reverse_payment` and `move_payment_to_cycle` refuse one. `swordfish_remitted_leaks()` counts anything that got through. Proved on staging by `scripts/qa/live/swordfish-cutoff-probe.sql`; `scripts/qa/live/check-swordfish-leaks.mjs` fails on any leak. |
| `d336a64` | **The trust overview in the firm's revised layout**, and **a narrowed Trust/Business menu keeps its icons** (`b108da2`). See §4.5. |
| `f001783` | **The client's email is not the debtor's correspondence.** `account_emails.correspondent` ('debtor' / 'client'), decided on INSERT by `account_email_correspondent` for all three writers: the account's own debtor contact wins; otherwise the client company's address (or a contact's at it or its parent), or a reply to a client row, is the client. The debtor's Emails tab reads only 'debtor'; a ticket reads both. The Messages menu sends a client's answer to its ticket (read on follow); a client email with **no** ticket gets an email activity on the client's own record from the sync, and is left out of the menu's account list so it is not announced twice. `protect_account_mail_fields` now locks the column too. **Fees untouched** — and since ruled on: client correspondence about an account is still charged to the debtor (CLAUDE.md, Annexure B rules). `check-client-correspondence` (37). Staging: three rows marked, all on tickets; the rule's dry run touched nothing else. |
| `e2d87c0` | **Node 22.22 decodes windows-1252 as Latin-1**, so 0x80–0x9F (curly quotes, dashes, €) became invisible control characters in every mail body `toText` read. Corrected from the WHATWG table. `check-mime-parts` had been red on a clean tree because of it. |
| `5e6c4d5` | **A calendar invitation opens the email**, wherever it is. `?message=` used to look only in the first page of All and give up quietly. A miss now fetches the row by id (`fetchMailItem`), moves to the tab holding it (`tabOf`, now the one statement of the rule `bumpUnread` used), waits for THAT tab's list, then opens it. e2e/mail covers both layouts and a message past the first page of Junk; the original page fails it. |

**First session:**

| Commit | What it is |
|---|---|
| `be1e03b` | **A payment has two dates.** `received_at` is what the debtor did; `allocated_on` is what we did, and it decides which payover run the money goes out on. Set once, at approval. `paid_over_in_swordfish` marks money the old system already remitted: out of the queue, never split, never claimed, and `approve_payment` refuses it. |
| `5156deb` | **Trust overview answers "does it balance?"** with a panel that can say no. See §4 for why the sketch's own reconciliation was not built. |
| `24debef` | **An imported account is not a new handover.** No handover email or SMS on an imported file, and none on an account outside the Active book. |
| `f8d9084` | Revokes from `public, anon` on four functions; the status-event trail has no write policy. |
| `8e853d0` | Moving an account between books (hold / release / withdraw / settle), and the Swordfish balance-gap panel. |
| `71e6aa2` | A company debtor keeps its registration number; the wipe says what it would delete. |
| `d2b2d56` | The clients list counts the actual book; Annexure B item 9 cap is dated as charged. |
| `9d4c520` | **Three books: Active, On hold, Closed** — a stored generated column, so it cannot drift. |
| `f3a6405` | **The PostgREST 1 000-row cap.** The most serious bug found. See §5. |
| `d0ba7a9`, `7447ae2` | The trust, bucketed by the payover cycle each part is waiting for. |

### Uncommitted at handoff

Nothing.

---

## 3. Open requests the firm has made and nobody has started

None. Both requests from the end of the first session were done in the second (§2):
the calendar invitation now opens the email, and client correspondence leaves the debtor's
Emails tab for the ticket or the client's record.

---

## 4. Decisions waiting on the firm

Do not guess these. Each one changes money.

1. **R502 or R509?** On 10 September the business confirmed R502 was captured wrongly on their side
   and the gazette says **R509**. Prompt 7 says make the app match the database, which is **R502**.
   The database and the app now both say R502, and the conflict is written into `check-fees.mjs`.
   **Ask before changing either.**

2. **When did Swordfish last pay its clients over?** The import now asks for this date and defaults
   to the firm's own worked example (import 6 Oct → settled through 10 Sep). But their example
   implies the cycle boundary, while Raptor's own lag setting says that cycle pays on 11 October,
   still in the future. Too early and clients are paid twice; too late and a month is never
   remitted. **This is the most consequential number in the migration.**

3. **`payover_lag_months` and `parked_credit_months`** are both placeholders (1 and 6). Same
   question as 2, from the other side.

4. **Commission / fees / VAT split of the firm's trust balance.** The firm's sketch asks for it. It
   is **not stored** — `trust_creditors_on_allocation` writes interest, costs, commission and VAT as
   one entry with one reason. Rebuilding it reaches allocation-backed rows only and silently misses
   charge recoveries and drawings, so the parts would not sum to the whole. The alternative is
   changing a financial ledger. **Ask.**
   **Asked for again** in the firm's revised design (6 Oct: "BF funds held: Commission + Fees +
   VAT = total" under the ownership table). Still not drawn, and the page's source says why at the
   spot it would go. This is now the one line of their design that is missing.

5. ~~The trust overview's "unexplained difference"~~ — **resolved 6 Oct.** The firm sent a revised
   design ("Raptor Trust Overview, Revised") and the page now follows it: three figures, who owns
   the money with an "Ownership reconciliation" beside it, collections by period as a table. The
   reconciliation's line is still nil by construction; it is summed on the screen from the parts,
   and what CAN be wrong (bank vs ledger, unplaced money, a client in debit, a late payover) is
   listed under it — "totals match" only when none is open. Two deliberate departures: an
   "All periods" totals row (the tie-out between the two halves) and a "Less: owed back by
   clients" owner row that appears only when one exists.

---

## 5. Known gaps and things still outstanding

- **Item 8 of prompt 7 could not be investigated.** APM20070, APM20097 and GPS4/10080 fail a
  payments reconciliation; the files are not in this repo. A reconciliation was built into the
  import instead, so the real migration cannot pass it silently.
- **Item 6 remainder:** "allow the wipe on production only before the first migration" is not done —
  it needs a fact about production that nothing in Raptor records.
- **Settlement store** (approved amount, expiry, saving) — task #69, not started.
- **The R22,77 settlement shortfall on RRC00002** is unexplained.
- **Business workspace** still has no Income and no Drawings-from-trust screens.
- **PROMPT 8 IS ON STAGING ONLY, AND PRODUCTION MUST HAVE IT BEFORE ANY REAL IMPORT.** The
  `allocate_payment` gate, the `reverse_payment` / `move_payment_to_cycle` refusals,
  `swordfish_remitted_leaks()`, `import_batch_id` and `discard_import_batch` — all at the end of
  `schema.sql` under "A RECEIPT SWORDFISH ALREADY PAID OVER" and "AN IMPORT IS ALL OR NOTHING".
  Without the gate, the real migration (12 078 interest rows) would split every remitted receipt
  into trust exactly as the test book did. After any import, run
  `scripts/qa/live/check-swordfish-leaks.mjs` against that database.
- **Staging was found already cleared** (book + finance; 7 users, 170 templates, settings and
  tariffs kept) when prompt 8 was picked up. **The test import has not been re-run** — the test
  book is the firm's export and is not in this public repo. Re-run it from the branch preview, then
  run the leak check (or `select * from swordfish_remitted_leaks()` on staging): all four counts
  must be nil.
- **There is no Stop button on the import**, though the code has an `abort` flag nothing sets.
- **`account_emails.correspondent` is on staging only.** Production needs the migration (end of
  `schema.sql`, "WHO IS ON THE OTHER END") and then a decision on its existing client rows: on
  staging they were marked by re-running the rule, and the user chose to leave production's to the
  firm, case by case. Until then production behaves exactly as before.
- **Client mail filed by hand from the mailbox** onto an account with no ticket is classified by the
  same trigger and leaves the debtor's tab — but only the SYNC writes the client-record activity, so
  that one is on nobody's screen except the person's own mailbox. Small; not yet handled.
- **The debtor's Activity timeline still carries a note for client correspondence** (the sync's and
  `recordSentEmail`'s `account_notes` rows). The firm's complaint was the Emails tab, which is the
  evidence; the timeline was left alone. Raise it if they mention it.
- **Imported accounts were given handover runs before the guard landed** — 20 on staging, 8 closed
  and 3 on hold. Not swept: a correction is the firm's decision, case by case.

---

## 6. Traps in this repo that cost real time

These are not in CLAUDE.md because they are about the tools, not the firm.

**PostgREST silently truncates at 1 000 rows.** A request over the cap SUCCEEDS — no error, no
flag, no count — and `.limit(2000)` does not raise it. This had ten of 28 test accounts showing the
wrong fees and four showing none. Always page through `fetchAllRows`; `check-row-cap.mjs` holds
every large-table read to it.

**`schema.sql` is append-only, so read the LAST definition.** `indexOf('create or replace function
public.<name>(')` lands on a superseded copy and asserts against code that is not live.
`check-allocation-start` was doing exactly this and had been for some time. Anchor on the full
phrase — a bare `lastIndexOf(name)` hits the function's own comment or grant and returns nothing,
which fails OPEN because every regex then tests an empty string.

**The MCP SQL tools have limits that fail in misleading ways.**
- `execute_sql` times out above roughly 4 kB, and on any query containing the literal words
  `drop` / `delete` / `truncate`. Workaround: `execute 'dr' || 'op ...'`.
- `apply_migration` **timed out on an 8 kB function and did not apply it** while appearing to fail
  ambiguously. Always verify against `pg_proc` afterwards.
- For a large function, rebuild it from its own live `prosrc` with `replace()` inside a `do` block:
  the payload stays small and the file and the database match by construction.
- Verify every mirror by md5: strip `/*…*/` and `--`, collapse whitespace, hash both sides.

**`apply_migration` hangs on the word `delete` too**, not only `execute_sql` — a function with a
`delete from` in its body timed out and applied nothing (prompt 8). Build the text with
`replace($f$ ... DEL_ETE ... $f$, 'DEL_ETE', 'del' || 'ete')` inside a `do` block and `execute` it;
the stored function is byte-identical to `schema.sql`.

**A comment can claim a guard the code does not have.** `allocate_payment` said "THREE REASONS NOT
TO TOUCH IT ... history that Swordfish settled" over a line that checked two. Checks that read
source must strip comments first, and so must a person reviewing it.

**`create or replace` is not always a replace.** A new defaulted parameter creates an OVERLOAD; a
widened `returns table` is refused outright. Both need a DROP — and **a dropped function comes back
with the default PUBLIC grant**, however carefully the old one was revoked. This is how three of
four book readers ended up reachable by `anon` while their sibling was locked.

**`revoke ... from anon` is not enough.** Postgres grants EXECUTE to PUBLIC on every new function
and anon inherits it. The house pattern is `from public, anon`; the evidence is a leading
`=X/postgres` in `pg_proc.proacl`.

**`innerText` is the RENDERED text.** A heading with `uppercase` comes back as `CLIENT`. Three
assertions in one session failed on perfectly correct screens because of this.

**Playwright's locators race React.** The URL changes before the row it decides is drawn, so
reading a locator on the next line can return an empty list and then count correctly a millisecond
later — a check that reports the wrong number and passes. Wait for the element.

**Node 22.22's `TextDecoder('windows-1252')` is Latin-1.** The C1 band 0x80–0x9F comes back as
control characters, not curly quotes and dashes. `toText` in `api/_lib/mime.ts` corrects it; any new
decode of mail bytes should go through `toText`, not a bare `TextDecoder`.

**The e2e stubs answer `account_emails` with `[]`**, so no browser test sees the Emails tab filter.
The filter is a PostgREST clause; its proof is on staging (a query for the account the firm saw) and
in `check-client-correspondence`, not in a stub that would only test itself.

**`en-ZA` groups thousands with U+00A0** and renders September as "Sept". Build the separator as
`String.fromCharCode(0xa0)`; never type it. In an SMS it costs real money — see CLAUDE.md.

**`new Date('2026-10-11')` is UTC midnight**, which is the wrong day in Johannesburg for two hours.
`new Date(Date.UTC(...))` is safe and `check-trust-cycles` now exempts that shape by name.

**Two QA harnesses compare with `Object.is`**, which is false for any two objects — so object
assertions fail on correct code. Compare as JSON strings. The e2e responder signature is
`(url, request)`, not `(request)`.

**A comment can break a check.** A note in `schema.sql` saying what must never be added contained
the words it was warning about, and the check counted the warning as the thing. Strip comments
first — the house already does this in `check-company-dashboard`.

**Break-test convention, and it is not optional.** After writing a check, break the thing it guards
and confirm it fails. Twice this session a "break test" was equivalent code and proved nothing;
once a sed silently failed to apply and the green result was meaningless. Verify the sabotage
actually landed before trusting the red.

---

## 7. How to pick up

1. Read CLAUDE.md, then this file.
2. `git log --oneline -12` — the commit messages carry the reasoning, not just the change.
3. `npm run qa -- --fast` before touching anything, so you know what was already red.
4. Work on staging; mirror every migration into `supabase/schema.sql`; verify by md5.
5. Update §2, §3 and §5 of this file before you finish.
