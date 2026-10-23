# Handoff — where Raptor stands

> **This session: S10 · Clients and Credits** — branch `claude/s10-clients-and-credits`, from `claude/sales-raptor-review-p1pzx2` at `925b6fc` (S9's last commit).
> **Sessions so far:** S1 Row Cap · S2 Sliding Scale · S3 Settlements · S4 Trust Split (`claude/new-session-ecohkn`) ·
> S5 Staging Clock (`claude/staging-clock`) · S6 Payout Day (`claude/payout-day`) · S7 Clean Break (`claude/s07-clean-break`) ·
> S8 Cut-over (`claude/s08-cut-over`) · S9 Balance Sort (`claude/s09-balance-sort`) · S10 Clients and Credits (`claude/s10-clients-and-credits`).
> **Every new session names itself here first** (`S<n> · Theme`, branch `claude/s0<n>-theme`), so the firm can say "S5 broke that".

**Read this instead of the previous session's transcript.** CLAUDE.md is the law and does not
change often; this file is the moving part. It says what shipped, what the firm has not yet
decided, what is still open, and which tools lie to you in this repo.

Last updated: **23 October 2026** (People round two -- the firm's answers on pay -- at the top of Start here); before that **22 October 2026** (People and pay); before that **21 October 2026**, S10 · Clients and Credits (prompt 13), on `claude/s10-clients-and-credits`
(branched from `claude/sales-raptor-review-p1pzx2` at `925b6fc`). Its section is the first under §2.
Everything is committed and pushed, and **the same commit is pushed to
`claude/sales-raptor-review-p1pzx2`** (a fast-forward) because that is the preview the firm opens:
https://sales-raptor-git-claude-sales-raptor-review-p1pzx2-team-raptor.vercel.app

### Start here tomorrow

00000000000000. **S10, 22 Oct: THE OPT-IN NOW NEEDS A SECOND PRESS** (the firm agreed). The /opt-in page asks 'status' on
   opening and records the yes only on "Confirm — keep me informed", so a mail system's link scanner
   cannot leave a consent nobody gave. e2e/news-prospects holds it (opening records nothing).
000000000000000. **23 Oct: PEOPLE, ROUND TWO -- THE FIRM'S ANSWERS** (Stephan, 23 Oct; migration in §5). All
   in `src/lib/clerkCommission.ts` (pure) + check-clerk-commission (247) + e2e/people (23).
   - **Pay day the 25th.** Commission earned 11th-10th, paid on the 25th of the month the period ends
     (11 Sep-10 Oct -> 25 Oct); the basic for the salary month 26th-25th, the same day. On every
     statement and on the Month summary (`paydayOf`, `salaryMonth`).
   - **Pro-rata basic** (`basicFor`): basic x working days worked (both ends counted) / working days in
     the whole salary month 26th-25th, SA public holidays out (workingDays.ts). The firm's example holds
     (start Mon 23 Nov 2026, the 25th a Wednesday -> 3 of 23). Start after the 25th -> nothing this
     month. A leaver: optional **end date** on the pay profile, paid to it, nothing after. Statement
     says "Pro rata: 3 of 23 working days ...". **The divisor is the assumption to confirm (§4 00).**
   - **Start date asked when a user is added -- by EVERY Administrator** (the firm changed this mid-
     task: "A user start date can also be asked for any administrator"). It is not pay data, so it is
     `profiles.start_date` (any Administrator writes it; `protect_profile_privileged_fields` reverts it
     for anyone else; every change is written to the pay history), asked in Add User (not for a
     has-left record) and editable on Edit User. People reads it from there; the pay record's own
     start date was removed. AuthContext.mapProfileRow carries it.
   - **Reversals** read "Reversed: <date>, <case>, <amount> -- commission taken back. Paid 25 Oct 2026
     (October 2026). Reason: ..." (reason from `account_payments.reversal_reason`), negative, in the
     month of reversal. A PTC released and later reversed says the pay day it was released on.
   - **PTC release by the PAYOVER RUN, not the ledger** (`releaseOf`). Each PTC now carries the run it
     rode (`clerk_commission_lines.payover_run_id`: the latest allocation a run claimed). Released when
     that run is APPROVED (approved/sent/paid) with `net_payover >= 0` -- nothing outstanding after set-
     off -- on the first 25th on or after the approval (a run approved on the 11th pays that month's
     25th; on the 27th, next month's). A run below nil (the "Client owes us" carry) holds it; it is
     released at the first LATER run for that client with net >= 0, or when that shortfall was paid into
     the business account (`settled_direct_receipt_id`'s `received_on`). Not on a run / run not approved
     -> waiting. The waiting client says "The payover X (cycle to 10 Oct) left R600 outstanding; owing
     since payover Y". Read off `clerk_commission_runs` (the runs as recompute_payover_run left them,
     void left out; refuses without people.pay and without the trust or business tick -> everything
     held, said on the page). `clerk_commission_ledgers` is gone.
   - **Exceptions 0-3%** (the firm: "anything below 3%") in the database and the screen, with the
     sentence on Commission rules: "a different clerk commission for one client or one account, instead
     of the standard rule; never above 3%". The screen already said "exception"; nothing said override.
   - **Clean cut** (People -> **Carried over**): a firm-wide **commission start date**
     (`people_settings`, people.pay only, changes logged) -- payments before it earn nothing and their
     reversals take nothing back. **Carried-over PTC commission**: (clerk, client, amount, note, source)
     typed in or imported from .csv/.xlsx (Clerk = name or email, Client = name or code, Amount, optional
     Note; matched exactly else a person picks; preview before Add; the file is never stored).
     Append-only; a correction is a reversing entry with a reason. Each waits like a PTC and is released
     by the same run rule starting at the first run for that client whose cycle ends on or after the
     commission start date; drawn as "Carried over" in the PTC sections.
   - Rounding unchanged (confirmed).
00000000000000. **22 Oct: PEOPLE -- PROFILES, PAY AND THE CLERKS' COLLECTION COMMISSION** (the firm, Stephan:
   "start building ... salaries ... an employee profile and an HR type of function"). A new workspace
   **People** at `/people` (People list, a person's profile + pay statement, Month summary, Commission
   rules), a sidebar item for **`people.pay` only** -- a NEW tick in NO role, the Administrator's
   included ("not even all Administrators"), granted on staging to **Stephan and Camille** only
   (`profiles.grants`, read back). Enforced in the database: `employee_profiles`,
   `employee_profile_history`, `clerk_commission_overrides` all RLS on `has_capability('people.pay')`;
   `clerk_commission_lines` and `clerk_commission_ledgers` refuse without it. Probed with an
   Administrator who lacks the grant: 0 rows, insert refused.
   - **The rule** (`src/lib/clerkCommission.ts`, pure): a share of the MONEY COLLECTED; client at 25%
     or more -> 3%, below -> client rate / 10 (24% -> 2.4%). Exceptions per ACCOUNT beat per CLIENT
     beat the rule, up or down, append-only rows with a reason, an effective-from date and who/when
     written by the database; a payment uses the decision in force on its own day.
   - **The client's rate** is the one stamped on the receipt's allocation
     (`payment_allocations.commission_rate`, i.e. what the client was charged -- frozen for imported
     history), else `account_commission_rate` for a receipt not yet split ("not split yet" on screen).
   - **Who earns it**: whoever held the account on the payment day -- `account_desk_history` ALREADY
     EXISTED (the floor uses it), so no new table. Rows marked `backfill` are the reconstruction made
     when that table began (holder assumed since handover); the statement marks those lines "Holder
     reconstructed". Money nobody held earns nobody commission (shown on the Month summary).
   - **What counts as collected** is the floor's figure: `collector_performance` and `collector_daily`
     now ALSO leave out rejected and demo receipts (they counted them; neither is money in), and
     `clerk_commission_lines` reads the same predicate -- check-clerk-commission holds the three.
   - **PTCs**: commission calculated per PTC, HELD while the client owes the firm anything, read off
     the client's own `client_ledger` (reused, not re-summed); released in full in the first pay period
     at whose close the PTC is approved, not reversed, and the client's ledger balance is nought or in
     their favour. Fails closed: without the trust or business tick the ledger is not read and every
     PTC stays waiting.
   - **The statement** (period = the firm's collections month, 11th to 10th, as the floor): (a)
     Payments with rate and its source, reversals as negative lines in the month reversed; (b) PTCs
     paid out, by client; (c) PTCs waiting, by client, with what the client owes and since when.
     Payable = basic + (a) + (b); waiting is shown below the total and never in it. Sales,
     communications and other staff: basic only, "commission scheme not set up yet".
   - Nothing is stored but the profile, its history and the overrides; no ID numbers, bank details or
     real salaries anywhere in the repo. check-clerk-commission (143), e2e/people (15).
   - **Open for the firm (§4 item 00)**: clawback month, rounding, the release definition, history
     before the desk table, sales/communications schemes and KPIs.
0000000000000. **S10, 22 Oct: NEWS CAN SEND ONCE bfnews.co.za VERIFIES.** Added to Resend (eu-west-1) by this session
   at the user's request; DNS records given to the user (DKIM TXT resend._domainkey, MX + SPF TXT on
   `send`, CNAME `rsend`, plus a DMARC `_dmarc` p=none). Vercel now has `RESEND_API_KEY` (a SEND-ONLY
   key restricted to bfnews.co.za, "Raptor news (Vercel)") and `MARKETING_FROM` = "Bredell Ferreira
   News <news@bfnews.co.za>", Production + Preview. ALSO SET (later the same day): replies to news by
   recipient -- a lead's to `MARKETING_REPLY_TO_LEADS` = info@bredellferreira.co.za, a client's
   (company or contact) to `MARKETING_REPLY_TO_CLIENTS` = reports@bredellferreira.co.za (`replyToFor`;
   news only, a prospect email still answers to its marketer); the Resend WEBHOOK, seven events, to
   the STAGING preview URL's /api/email/resend-webhook, with `RESEND_WEBHOOK_SECRET` in Vercel --
   **repoint it at the production URL at go-live**. Bounces never reach an inbox (they return to
   Resend's send. subdomain); the News page's "Didn't arrive" card lists every undeliverable or
   spam-flagged address with the reason and the record to fix (check-news-replies). Not set yet: the
   prospect domain (`MARKETING_PROSPECT_DOMAIN`, bredell-ferreira).
   Open/click tracking was switched on through the API; check it shows on in Resend's domain page.
000000000000. **S10, 22 Oct: A MARKETER ON GITHUB (Reno).** `.github/CODEOWNERS` (on both branches): everything is
   @septumusrex69's except leads, deals, contacts, reps, the sales Dashboard and the News page, which
   have NO owner -- inside those, ConvertLeadModal (commission), SendMandateModal, the opt-in and
   unsubscribe pages (POPIA consent) and `.github/` stay owned. The firm chose "approval, and tell
   me", not a hard block. DONE BY THE USER 22 Oct: Reno invited with Write; rulesets "Staging" on
   `claude/sales-raptor-review-p1pzx2` (PR required, "Require review from Code Owners", 0
   approvals, bypass list = Repository admin + the Claude app, or sessions cannot push the
   preview); a second on `Main` with 1 approval. Keep Reno out of Supabase and Vercel.
   **A session that pushes the preview and is refused has hit the ruleset -- the Claude app is
   missing from its bypass list.**
00000000000. **S10, 22 Oct: SETTING SOMEBODY UP** (Camille and the others, testing). Three faults, one cause each:
   - **A collector could not be put in a team.** Every team on staging had been made as a SALES team
     -- the new-team kind defaulted to Sales -- and the database refuses a pre-legal agent in one
     ("Pre-legal Agent works in Call centre ..."). Now the kind has no default, is guessed from the
     name as it is typed (`guessTeamKind`: "Call Centre" -> Call centre), and must be chosen; "Add
     member" offers only people whose role fits and says why about the rest; the invite box says
     why no team is offered. Staging's "Call Centre" team was corrected to Call centre (no members).
   - **A new user did not show until a refresh.** The profile row exists the moment the invitation
     goes; the list is now re-read then (`refreshPeople` in AppStore).
   - **Mailbox and BuzzBox asked for at once** (the firm: "it should immediately ask you for the email
     address settings ... like what is the extension"): after "Invite sent", the box offers
     **Connect mailbox** (the admin-on-behalf form, host guessed as mail.<domain>) and the **BuzzBox
     extension**; Edit User carries the extension too. check-user-setup (16).
0000000000. **S10, 22 Oct: THE SET-OFF GAP IS CLOSED** (the firm: "you can proceed with one"). Staging has
   it (migration `s10_set_off_credited_as_covered`); production does not (§5).
   - **A charge set off is the firm's only as far as the client's trust money covered it.** The client
     side of an approved run is unchanged (client -charges, the "Client owes us" carry); the firm is
     credited cumulatively per client -- set-off owed, less what is still short (read as PTC first, then
     set-off), less what the client paid into the business account (never credited in trust), less what
     was already credited. The PTC share's own rule. Probed on staging, rolled back, to the cent:
     R1 000 owed, nothing collected -> firm R0 (was R1 000 drawable); next run collects R600 -> R600; the
     client pays R400 into business -> no trust credit, ledger R600 = bank (was R1 000 vs R600).
   - **A brought-forward CREDIT is unchanged** (client +credit, firm -credit, same wording); a fully
     covered run writes exactly the old pair.
   - **The PTC rule changed in one place**: business payments count against the PTC share only up to
     what of it was resolved. Before, a set-off shortfall paid into the business account wrote a false
     "PTC share recovered, taken back (a PTC was reversed)" -R400 on the next run (seen in the probe).
   - **Against the bank / the cash view**: `trust_position` counts the uncovered set-off as the firm's,
     waiting (derived, not drawable, like the PTC share); `trust_cash_by_cycle` reads a run's set-off off
     the client's entry so its cycles still total the bank. check-set-off-covered (40);
     check-ptc-share-recovered updated.
   - **For the firm to decide** (nothing historic touched): (1) clients already credited in full while
     below nil get a catch-up negative entry at their next approval -- if the firm already DREW that
     money, the firm's share in trust goes short and is shown so; (2) a shortfall from a payment
     reversed after payover is read after PTC and set-off, so a business payment that in fact paid such
     a reversal under-credits the firm (safe side) -- and a reversal paid into the business account
     leaves the trust short by it, an older question than this one.
0000000000. **S10, 22 Oct: NEWS & CAMPAIGNS GROWS UP -- PROSPECT LISTS, ONE INTRODUCTION, DELIVERY
   RESULTS, TWO SENDERS, WARM-UP** (the firm's five decisions, Stephan, 22 Oct). `/news`.
   - **Import a prospect list** (News & campaigns -> Import a prospect list): a .csv/.xlsx with an Email
     heading (name, company, phone if there; other columns kept as a note). The SERVER counts it first
     -- new / already a lead (earlier imports included) / already a client / bad email / in the file
     twice -- and Add writes a `marketing_lists` row (name, file name, who, when, counts; never the
     file) and one LEAD per new address, source **"Imported list"**, on the importer's desk.
     `src/lib/prospectImport.ts`, `api/_lib/marketingLists.ts`.
   - **Campaign kinds**: News (clients + consented leads, from `MARKETING_FROM`), **Introduction**
     (only leads never asked and never consented -- the ONLY first approach now; the old news
     "first approach" box is gone and its stored flag is not read), **Prospect marketing** (only leads
     who said yes). The introduction carries a **"Yes, keep me informed"** button -> `/opt-in/<signed
     send token>` (public page, no login, "Thank you -- you'll hear from us", with a "that wasn't me"
     undo that unsubscribes) -> consent on the lead + `marketing_preferences` how `'opt-in link'` +
     the send's `opted_in_at`. **A lead with no yes is refused at the queue AND at the send**
     (`sendBlockReason`), so an imported lead who did not press it is never sent marketing again.
   - **Delivery results** per campaign (counts + rates) and per recipient: sent, delivered, didn't
     arrive, opened, clicked, unsubscribed (put against the LAST campaign that reached the address),
     marked as spam, opted in. Opens are labelled approximate. Webhook records every event through
     `marketing_record_event`, idempotent on the svix-id; a click on the unsubscribe link is not a click.
   - **Three domains** (the firm went back and forth on 22 Oct and settled here): the main domain
     `bredellferreira.co.za` is for everyday mail and is **never** a bulk From -- news or prospect,
     nor any subdomain of it (`newsSender` / `prospectSender` refuse it; check-marketing-prospects).
     News goes from its own domain (`MARKETING_FROM`, name still being chosen); prospect mail from
     `<marketer's local part>@MARKETING_PROSPECT_DOMAIN`, display name the marketer, Reply-To their
     real address. Neither domain is in the code.
   - **Warm-up** for prospect mail, per sender: 30/day week 1, 60, 120, 250, then
     `MARKETING_WARMUP_CEILING` (500). Counted in the database under a lock (`marketing_claim_prospect`);
     the rest wait ("N waiting for tomorrow's allowance") and the five-minute sweep sends them.
     **News is not capped** -- the news domain should still be ramped up by hand (below).
   - **WHAT THE FIRM MUST SET UP (Resend + DNS + Vercel)** -- nothing sends until it is done:
     1. Resend account; API key with sending access -> Vercel `RESEND_API_KEY`.
     2. **News domain** (separate from bredellferreira.co.za): add in Resend, put its SPF + DKIM TXT and
        bounce MX records at its DNS host, wait for Verified, switch ON open + click tracking. Vercel
        `MARKETING_FROM` = e.g. `Bredell Ferreira <news@<news domain>>`. **Ramp it up by hand**: the
        first newsletters to a few hundred clients at a time over the first weeks, not all ~3 000
        clients + ~10 000 leads at once.
     3. **Prospect domain** (separate again): same in Resend (SPF, DKIM, MX, Verified, open + click
        tracking). Vercel `MARKETING_PROSPECT_DOMAIN` = just the domain. Each marketer needs an email
        on their profile. Optional `MARKETING_WARMUP_CEILING`.
     4. **The main domain is not added to Resend for bulk at all.** Its SPF/DKIM/MX stay as they are.
     5. Webhook in Resend -> `https://<site>/api/email/resend-webhook` for `email.sent`,
        `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`,
        `email.opened`, `email.clicked`; signing secret -> Vercel `RESEND_WEBHOOK_SECRET`. Redeploy.
   - check-marketing-prospects (145), check-marketing (128), e2e/news-prospects (38), e2e/news-campaigns (35).
     **e2e port note:** another session's Vite was sitting on 5402/5403 today and served ITS code to
     this suite (an old News page); run news-prospects on a free port (`RAPTOR_E2E_PORT=5463`) if a
     button "is not there".
0000000000. **S10, 22 Oct: CAMPAIGNS ROUND TWO -- the call follows the desk, RECOVERY and TRACE campaigns,
   results for everybody, AUTO-DIAL** (the firm's four instructions, then their amendment A-C). On staging;
   production has none of it (§5).
   - **Reallocated mid-campaign, the new collector works it.** A trigger on `debtor_accounts.assigned_to`
     (`campaign_call_follows_desk`) marks a WORK campaign's open call `moved` (who, when, "Account
     reallocated to <name>"), THEN inserts the same day/rank/campaign for the new holder, then points
     `moved_to` at it -- every path that moves an account, hand-out included. To nobody: the call is
     cancelled with a reason (counts as missed). A moved call is no longer counted as missed anywhere.
   - **Recovery call campaign** (Accounts -> Closed -> tick -> Campaign -> Call -> **Recovery**): the
     written-off book only, chosen **by write-off reason** -- Raptor's closed list by name with a count each,
     the Swordfish free text grouped as stored, "No reason recorded" (`recovery_reasons`, counted in the
     database). **Withdrawn, paid up and settled are NEVER in one** (the firm's amendment; ended_as, or
     Swordfish's status/reason -- `recovery_closure`); prescribed never. Calls shared among collectors the
     person picks, by the same planner (`planCalls` with a `pool`, `shareAmong`). **The account stays where
     it was.** On the account (diary run or not) the collector holding the call sees **"Debtor agreed to
     pay -- re-open and keep it"**, asked twice; `recovery_reopen` refuses anybody else, moves the desk to
     them BEFORE clearing the closure (so no Handover sequence starts), sets 'Active: Re-opened' where the
     status said written off/closed, records what it was on the call (`recovered_from`) and the timeline.
     Then the ordinary promise form (which a closed account no longer offers). Finishing a call that did
     not win the account back closes it with a note and books no date.
   - **Trace campaign** (same box -> **Trace**): live accounts, or written off by reason; shared among the
     people picked to trace; the preview prices one item 4(c) search per account. **The referral is the
     bulk part; the search is still manual** (XDS has no way to be handed a debtor -- a person runs it and
     records it on the account, charged by recordTrace as always).
   - **Campaign results** (sidebar, everybody; `/campaigns/results`): every campaign, its kind, who, dates;
     calls worked/waiting/missed and **PTPs made** (rand promised), accounts won back; SMS/email sent/
     skipped/failed; a trace campaign's **funnel** (sent to trace -> searched -> new details -> contact made
     -> PTP -> paid, `trace_campaign_funnel`). **No fees on it.** Security definer, aggregated.
   - **Auto-dial** in a diary run: a toggle on the bar of a campaign call (remembered per browser). With
     BuzzBox + an extension, landing on the next campaign account places the call through CallButton's own
     path (item 2 charged, outcome asked), once per visit, only in calling hours, "Dialling 082 555 1234..."
     with Stop. Without BuzzBox it says so and does nothing. No new serverless function.
   - check-campaign-recovery (111), check-call-campaigns (57), e2e/campaign-recovery (29).
   - **QUESTIONS FOR THE FIRM:** (1) the PTP-made definition (§4); (2) which write-off reasons a recovery
     should usually take -- **staging has no written-off accounts at all** (the STC book is ten live
     accounts), so nothing could be counted; "refusal to pay" and "recommended write-off" are NOT in
     Raptor's closed list and were not added; (3) whether a team leader may recover accounts on nobody's
     desk / a departed collector's desk (built: yes); (4) whether a call box outcome "promised" on a closed
     account should be refused too (only the promise panel refuses today).

000000000. **S10, 22 Oct: THE QUESTION AT THE DOOR OF AN ACCOUNT** (the firm's design, two messages).
   - **Your own account, worked** (a call, note, SMS, email, promise, trace -- not just reading it):
     leaving it for ANY screen is **stopped while its diary date is today, past or missing** -- only a
     day after today lets you go; Stay keeps you on it. A **future** date asks **Keep 14 Nov** (one
     tap) or **Move it**. A date booked during the visit is the answer and is not asked again. A
     **diary run** ("Done & next") is never asked twice. `leavingAsk` in leavingAccount.ts,
     `LeaveDiaryGate`, AccountDetail's `useBlocker`.
   - **Somebody else's account: never stopped** -- anybody may do anything on it. Diarising it asks
     **"Mine" or "<owner>'s"** diary (covering for somebody away), and **the owner is notified**
     ("Thabo worked your account ... and diarised it for 14 Nov, in your diary"), type `diary.covered`.
     The old "one person does not put work into another person's diary" rule is retired for this.
   - **THE APP IS NOW ON A DATA ROUTER** (`createBrowserRouter` with one splat route around App's
     unchanged `<Routes>`), because `useBlocker` needs one. AccountDetail is keyed on the account id
     (`AccountPage`), so "worked" no longer carries from one account to the next.
   - Closing the tab only gets the browser's own "leave site?" while a date is owed. check-leave-gate
     (21), e2e/leave-gate (9).
00000000. **S10, night of 21 Oct: CALL CAMPAIGNS built, and the sign-out that killed every device fixed.**
   - **Call campaigns** (Accounts -> tick -> Campaign -> **Call**): the firm's design, in their words --
     **Now** puts every call on today's diary **above everything, broken PTPs and prescription
     included**; **Spread** runs to a last day at a place the person chooses ("Just under broken PTPs"
     ... "Above routine follow-ups only"), shared evenly into each collector's **free room**
     (capacity minus what is booked -- the reserve is why there is room), and what does not fit is
     reported and left off, never crammed in. Calls go to whoever holds the account; nobody is
     reassigned. **No fee** for being on one; a consultation the call leads to is charged as usual.
     Unworked calls come off at the end (cron, `call_campaigns_expire`) and count as **missed**.
     Campaigns page: worked / waiting / missed, by collector. **Liaisons (and Liaison Managers, for
     their team's liaisons) now run campaigns -- SMS, email and call -- over their own clients**.
     Not decided by the firm, built as the obvious default: whether collectors see the campaign's
     figures (today: Administrators, the creator and their team, via the Campaigns page).
   - **A CAMPAIGN CALL IS A SECOND OPEN DIARY ENTRY, NOT THE ACCOUNT'S DIARY DATE.** kind
     `campaign`, `rank` on the entry, stored priority `coalesce(rank, diary_priority(kind))`. The
     one-open-per-account index now excludes it (one open campaign call per account has its own),
     `diary_date` ignores it, `diarise`/the hand-out never supersede it, it cannot be moved or booked
     by hand. Superseding the account's date instead would have dropped every PTP-due check-in a
     campaign touched. check-call-campaigns (57), e2e/call-campaigns (13).
   - **Login code "expired" (Stephan, 16:14):** the code was right. `signOut()` was GLOBAL (supabase-js's
     default), and four idle tabs on the old Mac timed out while the code was in the inbox -- four
     global sign-outs revoked the new iPad's session, and the check said "Invalid or expired session".
     Now `scope: 'local'` everywhere, and the code screen says "You were signed out" on a 401.
     check-sign-out-local.
0000000. **S10, evening of 21 Oct: cut-over money and campaigns** (§2 under S10, "Cut-over money and
   campaigns"). Built and merged: the clean break defaulting to 10 Dec and recorded per import run;
   Camille's balances brought forward (Trust settings -> Balances brought forward); debtor SMS/email
   campaigns (Accounts -> Campaign / Campaigns); News & campaigns for clients and leads via Resend.
   **WAITING ON THE FIRM:**
   - **The set-off gap (money model).** When a payover run is approved, `trust_creditors_on_run` moves
     the WHOLE set-off charge to the firm even when the run is below nil -- R1 000 owed, nothing
     collected, the firm shows R1 000 drawable from trust that is not there. Withdrawal fees already
     do this; brought-forward balances (R400k-R1m) make it large. Proposed fix: credit the firm only
     as far as the client's trust money covered it, the rest carried as owing (the PTC share's rule).
     Asked the user 21 Oct; **approved and built 22 Oct -- see the first item above.**
   - **Bring the balances forward ON cut-over day**, not during the parallel run: a balance dated 10
     Dec is taken by the first Raptor run after it.
   - **Resend setup** for News: account, domain + DNS records, `RESEND_API_KEY`, `MARKETING_FROM`
     (optional `MARKETING_REPLY_TO`, webhook + `RESEND_WEBHOOK_SECRET`) in Vercel.
   - **Debtor campaigns: the 10-SMS-a-month cap is OFF** (`ENFORCE_MONTHLY_LIMITS`, firm's instruction
     10 Sep), so every campaign SMS is charged. Contact hours are the firm's calling hours (weekdays
     08:00-17:00, Saturday 09:00-13:00). Promises and running workflows are NOT skipped. Call
     campaigns: proposed (own list + a "Campaign calls" section under the diary), not built until the
     firm has agreed it with the team leaders.
000000. **Staging has one client, at the user's request (21 Oct): "Stephan's Test Client" (STC)** --
   25% flat, mandate dated, 24% interest, ten debtors in one batch (STC0001-STC0010, RAP-125252 to
   RAP-125261, R171 256.50 capital), each with an @example.com email only, all UNASSIGNED so no
   workflow has started. Made with SQL, not through the import. Everything else was cleared.
00000. **S10, later on 21 Oct: the open list built** (the user: "you can proceed with building
   everything"), each in its own worktree and merged (§2 under S10, "The open list"):
   - **Login code by email for an Administrator on a new device** -- BEFORE THE PREVIEW IS OPENED
     ON A NEW iPAD, AT LEAST ONE ADMINISTRATOR MUST HAVE A MAILBOX CONNECTED, or nobody gets a code.
     It is an app gate, not a database guard: a password used directly against the API is not stopped.
   - **Held for Swordfish payovers** (set in Trust settings; debits taken off it from To sort /
     Payments out to allocate). No undo for a mis-tag yet; closing what is left is the firm's call.
   - **FNB bulk-payment file** to FNB's CSV guide -- **one test import in FNB still has to confirm**
     row 1 / the heading row, account type 1 for every payee, and whether hash totals are on.
   - **Client report: Email it** from the client page; **Administration keeps its own layout**.
0000. **S10 · Clients and Credits, 21 Oct: prompt 13, all fourteen items built on staging** (§2 under
   S10). Production has none of it (§5, S10 list). Four readings the firm should confirm, each
   built the way stated and easy to turn:
   - **THE SECTION 129 ALWAYS GOES OUT (the firm, 21 Oct, after item 9).** First call, debtor says "I'll
     pay by Friday", arrangement captured -- but no section 129 has gone yet. Chosen by the user: the
     promise form now offers "No Section 129 has gone to this debtor yet — send it first", ticked;
     the press starts the section 129 (day 1 sent as that person) and THEN records the promise. A
     promise never pauses a section 129 whose first notice has not gone (weekend/holiday start);
     the pause lands the moment the day-1 notices are out (`workflow_first_notice_pending`,
     `workflow_hold_after_first_notice`). A broken arrangement resumes it from where it stopped,
     as it always did. Check: check-promise-rules-s10.
   - **Item 9, when section 129 starts on a broken arrangement.** On BROKEN -- when the 48 hours the
     notice of default gives have run out -- not at the missed instalment itself, because the firm's
     own notice tells the debtor "no further step is taken" if they pay within 48 hours. The day-1
     section 129 still waits for a collector to release it, as it always has. The notice of default
     still goes at the missed instalment.
   - **Item 8, credit notes credit only what is still OWING on a fee.** What the debtor already paid
     towards it is in trust as the firm's; crediting that would leave the statement in credit with
     no money behind it -- that is a payment reversal. Receipt fees are not credited (they come off
     with their payment's reversal). Disputes were never perusals and are still charged item 3.
   - **Item 11, which perusal fees were removed.** Only Raptor's own (`source 'raptor'`, description
     "Perusal of documents"). Swordfish's imported item-3 history is frozen (CLAUDE.md) and stays.
   - **Item 3, commission has no Swordfish exemption** (the mandate does): a client with no rate
     and no scale takes no debtors and no handovers, wherever it came from.

000. **S9 · Balance Sort, 19 Oct. Accounts sort by "To settle"**, highest first, across the whole
   book (§2 under S9). The figure it sorts by is computeBalance's own, stored in `account_balances`
   -- NOT a SQL balance -- and kept current three ways: a version bumped by triggers on every ledger
   and balance input, the list catching up what moved before it sorts and writing back every row it
   draws, and a nightly job (`/api/workflow/balances`, 00:05 Johannesburg). Where some accounts are
   still placed by an older figure the list says how many above the rows.
   - **Staging has the migration; production has none of it** (§5, S9 list). Staging's table is
     EMPTY until something fills it: the first sort by balance catches up ~750 accounts, or an
     Administrator can POST `/api/workflow/balances` once the preview has it, or wait for the cron.
   - **Not proven against the live API from the session** (the sandbox cannot reach Supabase): the
     PostgREST order `account_balances(to_settle)` on a one-to-one embed. The e2e proves the request
     is made; press To settle on the preview to prove PostgREST takes it.
   - **FIXED, with the firm's go-ahead (19 Oct): a workflow notice quotes the account page's
     balance.** `api/_lib/workflow/step.ts` had its own ledger reader (`ledgersFor`, now deleted)
     and its own position: no `annexure_item` / `payment_id` (a receipt fee raised as a fee row
     counted twice -- R846 instead of R823 in the check's example), every cancelled fee dropped (the
     imported promise-to-pay exception lost), rejected receipts counted, no ended / prescription.
     It now reads `fetchLedgerRows` and builds the position with `balanceInputFor(balanceAccountFromRow
     (account))`, the page's own assembly; the repayment schedule rides on the same position, and
     "payment received" is the newest LIVE payment by date. The interest start is `handover_date`
     only, as on the page (it was `?? opening_as_at`; no account on staging or production lacks a
     handover date). On staging 21 accounts carry an item 9 row -- including the one account in a
     workflow -- 4 have rejected receipts, 5 are ended or prescribed. `check-notice-balance` (10,
     break-tested); check-handover-date and check-workflow-transport updated.
   - Tests: new `check-stored-balance` (47, break-tested four ways), `e2e/accounts` +6 (148,
     break-tested); seven older source checks updated for the move.

   - **Later on 19 Oct, the firm on the iPad preview** (all in §2 under S9):
     - **Open or Download on every file** (`src/lib/fileSave.ts`, `FileActions`): "it opens it in
       Raptor ... it asks you where to save it". Download on an iPad is the share sheet's Save to
       Files; Open is a new tab opened on the press. Mail attachments, account and client
       documents, generated PDFs, payover copies, trace reports, the letter preview, exports.
     - **Commission and mandate are one card**, lower on the page; its gaps go to **Attention
       required** at the top.
     - **The client page after the firm's mock**: tags in the band, five figures with marks,
       Collections performance (new `client_money_by_day`), Attention required, Upcoming payover
       (trust only), Recent activity. The firm said "take from it what you think could be
       helpful"; ask whether the rest of the mock is wanted (Documents / Accounts / Handovers tabs,
       icons on the tabs) before building it.
     - **The client ring** counts accounts in its centre; the recovery rate is a bar beside it.
       Twelve months of handovers fit the card; the scale climbs in equal steps.
     - **The Communications dashboard has the three arrangements** (`DashboardPanes`: one column,
       three columns, wide two-thirds + one-third; the record pages' switcher and memory). Figure
       rows stay across the page. Only Communications so far -- Sales, the collections floor and
       the company dashboard would take the same component if the firm wants them.
     - **WhatsApp by link** (`lib/whatsapp.ts`, `WhatsAppButton`): every record's action row opens
       WhatsApp on the cellphone (27… form) with an opening line; on the way back it asks how many
       messages went. On an account each is charged R25 under 1(a) as correspondence (decided 19 Oct). Sales side: noted, free.
       **A letter by WhatsApp** (`AccountWhatsApp`, `whatsappLetters.ts`): on an account, WhatsApp
       asks "a message, or a letter"; a letter is drawn as the email's PDF, then ONE tap ("Send on
       WhatsApp") downloads it (same tab, `downloadBlob(..., { sameTab: true })`), copies the
       letter's SHORT covering line and opens WhatsApp on the number with it typed in -- the firm sent
       a final notice with nothing attached under the old two-tap version. Works only because the
       PDF is drawn before the tap. NOT YET SEEN ON A REAL iPad: if Safari drops the download there,
       the Save button under it still works, and the fallback is the share sheet (no preset chat).
       CHARGING (the firm, 19 Oct, final): each WhatsApp message is CORRESPONDENCE, item 1(a) R25
       (action `whatsapp`), not 1(c) R3.50. A letter goes inside one of the counted messages, so it
       is named on that charge ("WhatsApp correspondence: Final notice") and not charged again. An
       acknowledgement of debt (`letter-aod-*`) ALSO raises 4(a), banded on the ledger balance as
       SigningPanel does -- every time, so an AOD issued for signing and then WhatsApped is charged
       4(a) twice and left for a person to reverse ("if somebody queries it, we'll just remove it"). The nine short lines are MY DRAFTS in code: the firm should read them; making
       them editable in the Library is the next step if they want to change them themselves.
       Later: the full WhatsApp API (docs/whatsapp-integration.md); screenshots of arrangements.
     - **Confirm and accept a payment arrangement**: the workflow's arrangement-confirmed email
       (`email-ptp-confirmed-*`) now carries a Confirm and accept button to a `signing_requests` row
       in mode `accept` (`arrangementDocument.ts`). The debtor types a name and ticks; `signing_accept`
       writes "Confirmed and accepted online by … on …" into the document, which files as a signed
       document; the signed-copy route raises item 4(b) R250 once (`fee_charged_at` claimed first)
       and emails the copy. Not an acknowledgement of debt (the firm's word). The firm also said:
       charge everything, no 4(a)/item 7 de-duplication; telephone acknowledgements dropped.
       THEN (19 Oct, later): **a tick, no typed name** ("They just tick the box and it's to the email
       address that was sent") -- `signing_accept` takes the name the request was made out to and
       writes "Confirmed and accepted online by X, from the link sent to Y, on …" from the new
       `signing_requests.sent_to`; and **the SMS confirmation carries the link ONLY where the debtor
       has no email** (`acceptLink` in step.ts, one helper for both channels; the SMS is re-priced on
       the text that leaves, link included). The link uses VERCEL_BRANCH_URL on previews.
   - **"Keep it, I will deal with it myself" read as Awaiting liaison (20 Oct).** Two causes: the email
     route set `stage = ownerId ? 'liaison' : 'agent'` (any owner = liaison), and the account-page
     route used stageForAssignee, which reads the owner as the liaison when the keeper IS the client's
     liaison (Stephan on Aapcom). Now a kept ticket is `agent` on both routes (`keep` travels to
     api/_lib/email/ticket.ts); an escalated one is worked out server-side by stageForAssignee from
     the owner's role and the client's liaison. Staging dispute 59b9971d moved back to `agent`.
     check-raise-not-escalate +4.
   - **A dispute raised from an email lost its PDF (20 Oct).** "Could not file ... violates check
     constraint account_documents_source_check": the ticket route files attachments with
     `source: 'email'` and the check allowed only manual / filename-match / generated. The dispute
     itself was raised. Widened on staging (end of schema.sql); **production has no such constraint
     yet -- include it in the production deploy.** New `check-document-sources` holds every
     `account_documents` insert's source against the constraint.
   - **THE TEST CLOCK ON EVERY STAGING ACCOUNT, FOR EVERYBODY (20 Oct). DO NOT REMOVE until the firm
     says so.** The firm: "my forward to the next workflow function for testing has been gone. Don't
     remove it until I give you ... the authority ... everybody, and even ... the debt collectors,
     need that function because we're all testing still." It vanished because staging's book was
     reloaded and none of its 918 accounts carried `is_test_account`. Now `isTestAccount(acct,
     { staging })` is true for every account where the database's `deployment.kind` is 'staging' --
     the panel (firmClockState().staging), the advance endpoint (reads `deployment`) and
     `workflow_test_advance` (same row) all agree. Production says 'production' and the row has no
     write policy, so going live turns it off with nothing to remember. The whole-database staging
     clock bar is still Administrator-only (staging_clock_guard): one person's jump moves everybody's
     day. check-test-clock (53), new e2e test-clock-staging (2), both break-tested.
   - **A SIGNED MANDATE MAKES A CLIENT (20 Oct).** The firm converted a lead ("Aapcom", staging),
     recorded the mandate signed, left both deals at New Deal -- and the client vanished from Clients,
     whose rule was "a Won deal or a code". `isClientCompany` (companyRollup.ts) adds "or its mandate
     is signed"; topLevelClients, the client page's `isClient` and Communications all use it.
     check-add-client +5.
   - **Sales dashboard: the three pane arrangements** (DashboardPanes, `raptor.dashboard.sales.layout`),
     Mandates and Deals narrow so they stay side by side in Three columns; Needs attention wide.
     e2e sales-comms-dashboards +6. **Then the company dashboard** (`raptor.dashboard.company.layout`,
     opens in Wide because Wide IS the firm's mock -- `DashboardPanes initial`, `useRecordLayout(key,
     fallback)`) and **the collections floor** (`raptor.dashboard.collections.layout`: each level's
     heading is a full-width pane so a level never borrows a column from the next; team summary wide
     beside its list). e2e company-dashboard +5, performance +4 (its team-list lookup now by
     data-pane), check-collector-profile updated. Administration (AdminOverview) is not converted.
   - **BUILT: the client report** (the firm: their Excel "Collection dashboard" was "just ... a
     reference ... you can fix all of that"). **Client report** in the client page's action row
     (clients only, like Upload a batch) opens Open / Download of a two-page A4 landscape PDF in the
     remittance advice's hand: (1) *Your book at a glance* -- accounts, capital, collected, recovery
     rate on navy; what became of the accounts (recovered / active / closed: count, share, capital,
     collected, TOTAL); where the active ones stand (position, count, share, capital, TOTAL); (2)
     *Month by month* -- collections bars + the rate line over a table of the same figures, and
     handovers bars over accounts and capital, last 12 sales months. Fixed from the reference: every
     share column adds to exactly 100.0% (`shares`, largest remainder), every chart sits on its own
     table, no blank page. No commission or fees (it goes to the client). `clientReport.ts` (pure),
     `clientReportPdf.ts`, `clientReportData.ts` (the client page's own four reads),
     `ClientReportButton`. `check-client-report` (24, break-tested), e2e client-handovers +3.
     Not done: sending it by email from Raptor (today it is downloaded and attached); a date range.
   **Open, in order (as at 21 Oct):**
   1. **Production has none of S8's or S9's migrations** -- the S8 and S9 lists in §5, plus the
      `account_documents_source_check` widening (production has no such constraint yet).
   2. Code by email for an Administrator on a new device (agreed, not started).
   3. "Held for Swordfish payovers".
   4. The FNB bulk-payment file: the firm sent FNB's CSV TEMPLATE ("BInSol - U ver 1.00"); still
      needed, from FNB's import GUIDE: line 3's 12-digit second number, line 2's date meaning and
      format, the account-type codes, and what switches NOTIFY on. Offered: build it on best
      reading and let a one-payment test import in FNB say what is wrong.
   5. **Waiting on the firm:** the "Handover docs" request on Palesa Radebe (Aapcom) still reads
      Awaiting liaison -- move it to `agent` only if they say they kept it; whether collectors
      should also get the staging date bar (Administrator-only today, because it moves everybody's
      day); the WhatsApp one-press download is not yet seen working on a real iPad.
   6. Administration (AdminOverview) is the one dashboard without the three pane arrangements.
   7. **The test clock stays on every staging account until the firm says they are live**
      (CLAUDE.md, Environments).

00. **S8 · Cut-over, end of 18 Oct.** The afternoon was the firm testing on the preview and asking,
   one screenshot at a time. All of it is built, checked and pushed (each item is in §2 under S8):
   - **The mandate, end to end.** On a lead or deal, Send / **Resend mandate** emails a PDF plus a
     sign-online link. Flat rate is the default, with the sliding scale as the option; company or
     individual comes from the lead (`leads.party`). Signing creates the client, files the signed
     PDF, writes Notes, and tells the closer.
   - **The welcome flow.** Assign a liaison, then the welcome email goes from her; she gets a
     pop-up, a bell notification and a task; checklist steps tick off as they happen.
   - **The signing page.** The letterhead's head and foot only, so the footer no longer prints
     over a clause. The signature pad takes every stroke. Initials moved off the letterhead footer.
   - **Sales dashboard.** Mandates, then Deals (side by side on iPad), then the track record, then
     mandate-to-first-handover per closer and lead sources. "Reps" are now **closers**.
   - **Company dashboard.** Work coming in shows a bar per month over a span. The tiles filter
     existing / new, with Bars / Both / Line.
   - **Client page.** Two rings: outcomes with the recovery rate, withdrawn left out; and the
     active accounts by position. Handovers month by month, with All time; it slides sideways and
     the axis stays put.
   - **Clients list.** A Recovery column.
   - **Accounts.** Sort in the database. Fees & interest are one column. "To settle" includes the
     receipt fee.
   - **Deals.** Tick several stages.
   - **Patterns.** Late against their own rhythm, and a typical month (Communications).
   - **The staging clock.** `TODAY` now follows it.

   **Tests at the end of S8:** full `npm run qa` **340 of 343 files green**. The three reds are the
   same three that predate S7: `e2e/account-templates` (the merged balance's format), `e2e/excess-credit`
   (a click timeout) and `e2e/performance` (date-dependent). Fast suite all green.

   **Open, in order:**
   1. **Code by email when an Administrator signs in from a new device.** Agreed, not started (the
      authenticator-app version was removed at the firm's request; do not put it back).
   2. **Sort Accounts by balance.** It needs a stored balance that agrees with computeBalance to the
      cent; the SQL one does not (RRC00005: R817,01 vs R760,00).
   3. **"Held for Swordfish payovers"** (§3a item 2; the design is under S8 in §2).
   4. The FNB bulk-payment template, which waits on FNB's file spec.
   5. **Production has NONE of S8's migrations** (see the S8 list in §5). Staging only.
0. **S7 · Clean Break is finished** (last commit `c0936c2`, 13 Oct). **The next session is S8**: name it
   here first (`S8 · Theme`, branch `claude/s08-theme`). Read §2's three S7 sections first: the trust
   was regrouped (overview, To sort, Clients owe us, Bank statement, Payments out), clients pay against
   their statement, bounces are handled, prompt 12 is complete, and the trust balances to nil on
   staging. Still open from S7, in §3: the bank's bulk-payment template (assumed FNB) and
   `business.income` for Stephan on production. Tests at the end of S7: fast suite all green (17 995
   checks); full suite 324 of 327, and the three reds (`performance`, `account-templates`,
   `excess-credit`) predate S7.
1. **Work on staging.** Production is NOT live and the user has said so: "We are not going live."
2. **Staging now runs on a clock (prompt 10, §2).** `raptor_now()` / `raptor_today()` are every
   business date. It is on the REAL date and nothing has been cleared -- the firm moves it from the
   banner (Administrator: +1 day / to the 11th / to the 10th / pick a date / Clear staging). Never
   write `now()` or `current_date` for a business date again, and never `new Date()` in `src/` for
   a date decision: `check-staging-clock` fails on both.
3. **The firm is about to run Raptor against Swordfish** (§3a, the 11 Oct - 10 Nov cycle). Anything
   that makes Raptor's runs differ from Swordfish's during that run is unwelcome -- which is why the
   "PTC on the next payover" rule stays **switched OFF** (§2, fourth session, top row; the user
   confirmed again on 10 Oct: "The third one we'll keep"). Do not switch it on until they say so.
4. **The firm's PTC share recovered by set-off is now credited to the firm** when the run that
   recovers it is approved, so it can be transferred (§2, top row). Runs approved BEFORE this keep
   their entries; a client's earlier recovered share is caught up at that client's next approval.
5. **The firm draws its share only once the client has been paid** (§2, top row; the firm, 10 Oct).
   `firm_trust_split()` is held / drawable / waiting; `draw_from_trust` limits on drawable; Payments
   to make, Drawings and the Business overview offer drawable and say what waits. Two readings in it
   are ours and are in §4 item 15 -- tell the firm if either is wrong.
6. **After pushing to this session's branch, also push to `claude/sales-raptor-review-p1pzx2`**
   (fast-forward only, `git push origin HEAD:claude/sales-raptor-review-p1pzx2`).
7. **Run the full suite first** (`npm run qa`). At the end of the fifth session: 307 of 308 green.
   The one red, `e2e/performance` ("Collected today" shows the period's figure), fails identically
   on `1848079`, the commit this session started from -- it is DATE-dependent and reproduces on the
   10th (the last day of the sales month), not caused by the clock. Look at `useCollectionsMonth`'s
   day range on a period's last day; it may be a real "Collected today" bug on every 10th.
8. **The production copy is HALF DONE and PAUSED** (§5, first item). Do not resume it unless asked.
   It now also needs everything in §5's "fifth session" list.

**Keep it current.** A session that changes something here and does not update this file has moved
the problem to the next session rather than solved it.

---


## 23 Oct (S10) — mail already read in the mailbox arrives read

The firm: a new user's mailbox synced and everything showed unread. `emailSync.ts` never fetched
the IMAP flags. It now asks for them and stores a message read when the mailbox already had it
`\Seen` (as well as sent mail). **Only the first sight counts** — the upsert ignores duplicates, so
mail imported before this stays as it was, and reading a message on a phone AFTER Raptor has it
does not flow back yet. That second half is a follow-up (re-read flags on each sync for recent
mail). `check-mail-seen.mjs` holds it; `check-mail-queue` updated for the new line.

## 1. The state of play

| | |
|---|---|
| Branch | `claude/staging-clock` from the fifth session (before it `claude/new-session-ecohkn`, `claude/sales-raptor-review-p1pzx2`; one branch per session — two sessions on one branch means one force-pushes the other) |
| Staging | `kvkajxpremantdkhmjvb` — work here, data is disposable and the firm has said so |
| Production | `qcvesjzoiznrvunjrqpv` — **do not write to it casually**. It is NOT "a little behind": see §5, first item |
| Live app | Vercel project `sales-raptor`, production deploys **`Main` at `acae2c8` (12 Sep)** against the production database. The firm works on this branch's preview, against staging |
| Repo | **PUBLIC.** No real client data in any commit: no exports, no screenshots of the book, no dumps |
| Verify | `npm run qa` (≈12 min, real browser), `npm run qa -- --fast` (≈3 min), `npm run build`, `npm run lint` |

Previews: the four staging settings (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `EMAIL_CREDENTIALS_KEY`) were scoped in Vercel to the p1pzx2 branch
alone; since 10 Oct they apply to every Preview branch. Production's are separate and untouched.

Fifth session, full `npm run qa`: **304 of 305 green** -- the one is `e2e/performance`, pre-existing
and date-dependent (see "Start here", item 6). Fast suite all green; `npm run build` and `npm run lint`
clean.

Last full `npm run qa` (fourth session, before the Trust overview split): 297 of 298 green, the one
(`e2e/performance`, grade parsing) fixed and re-run green on its own. Since then the fast suite is
**all green, 17 348 checks across 263 files**, and every browser test touched since was run on its
own and is green: `workspace-split` (124), `payover-sends` (42), `client-statement` (26),
`check-payments` (28), `payments-in` (40), `business-income`, `payments-out`.

---

## 2. What shipped this session

### S10 · Clients and Credits (21 Oct, prompt 13)

All on staging, each with a check under scripts/qa that was break-tested, and each database change
probed on staging inside a rolled-back transaction before it was written into schema.sql.

**Clients**
1. **Add client asks by service** (`AddClientModal`). Debt collection: commission (rate or scale), the
   mandate date, and the **signed contract** -- uploaded as the client's Mandate once the client row
   exists (`addCompany(..., { onSaved })`) -- or, with no file, a **required reason** kept on the client
   (`companies.contract_missing_reason`, shown on the mandate card). Other services skip all three.
2. **Converting a lead asks for the commission** where debt collection was signed (`ConvertLeadModal`).
5. **Liaison required**, chosen not defaulted, on Add client and on conversion. At conversion she is
   written on the client and then assigned through the welcome route (`welcomeOnConversion`), the same
   press as Assign and welcome: welcome email from her, call on her list.
3. **No mandate or no commission = no work.** `client_work_refusal` + `handovers_need_a_mandate` (now
   both halves) and a new `debtor_accounts_need_terms` trigger (Add debtor went round the batch
   trigger). Client page greys Upload a batch / Add debtor and says why with a link to the commission
   and mandate card (`#commission-mandate`); the import screen says the same. `workBlock` in
   mandateRule.ts. Check: check-mandate-rule.
4. **Back to the client** from Upload a batch (`BackToClient` in SettingsPage).
6. **Recent activity card removed**; Notes (newest first) stays. `ClientRecentActivity` deleted.

**Accounts**
7. **Search by cell and email**: `debtor_accounts.contact_search`, kept by a trigger on
   account_contacts (every number as digits in 0 and 27 forms), matched in `applyAccountFilters`.
   Check: check-contact-search.
8. **Credit notes, never a deleted fee.** `credit_fee(fee, amount, reason)`, Administrator only, from
   Transactions (`FeeCreditPanel`). A negative account_fees row with `credits_fee_id`, who and why;
   every summing reader nets it; `fee_split` and `account_money_position` read `account_fees_net`. Own
   statement line (`fee-credit`). Only the still-owing part of a fee; never a receipt fee. Check:
   check-fee-credit.
9. **A broken arrangement goes back to section 129**: `workflow_resume_on_promise_broken` now also
   STARTS the section 129 (`section_129_version`: active, by hand, statutory steps) on an account that
   never had one -- once ever, not over a live promise, open dispute or closed account. See "Start
   here" for why on broken. Check: check-promise-rules-s10.
10. **One live promise** (open or defaulted): trigger in words + partial unique index; the panel stops
   offering Take one.
11. **Perusal fee gone**: no code raises it (check-perusal now holds its absence); disputes keep item
   3 under their own `'dispute'` action code with the one a day they had; Raptor-raised perusal fees
   removed by the one-off SQL (none were on staging). The `'perusal'` code stays for imported history.
12. **Unmatch for everybody**, from the mailbox and from the account's Emails tab: trigger lets a
   cleared account link stand (re-pointing still needs mail.refile); `unmatch_email` clears the mailbox
   copy and stamps the account's copy unmatched (kept: its R13 is on the statement). Checks:
   check-unmatch-email, check-silent-triggers.

**Trust**
13. **Move to suspense from Needs an account**, with a required note: `suspend_bank_line`, the line
   stays unallocated, listed under In suspense, placed or split from there, or sent back.

**Staging**
14. **Clear staging fixed**: one truncate for the whole book, six tables removed row by row in key
   order. **check-clear-staging derives it from every foreign key** in schema.sql
   (`scripts/qa/schemaForeignKeys.mjs`, matched against staging's pg_constraint: all 207 pairs;
   `scripts/qa/live/foreign-keys.sql` re-prints them). Probed: the clear runs and keeps the 915 mails.

**The open list, built later on 21 Oct** (four worktrees, merged into this branch):
- **Login code by email** (`src/lib/loginCode.ts`, `src/components/auth/AdminDeviceCode.tsx` in
  RequireAuth, `api/_lib/email/loginCode.ts` on the email dispatcher as `login-code`, tables
  `trusted_devices`, `login_codes`, `login_code_waivers`; `trusted_device_seen`,
  `trusted_devices_remove`, `login_code_waive`). Administrators only; device id in localStorage,
  stored hashed; code HMAC'd under EMAIL_CREDENTIALS_KEY, 10 minutes, 5 tries, single use, resend
  throttled. Sent from the person's own connected mailbox, else another Administrator's (Raptor has
  no system mailbox -- Barry has none, so his comes from Camille's). Way out: another Administrator,
  Settings -> Users -> devices -> "Let in without a code (30 min)". NOT a database guard -- see the
  header in schema.sql. check-login-code (103), e2e/device-code (19).
- **Held for Swordfish payovers** (`swordfish_holding`, `set_swordfish_holding`,
  `allocate_swordfish_line`, `swordfish_holding_figures/position`; trust_position, accountedFromCash
  and currentHoldings take what is left; clear_staging empties it). Firm to decide: closing what is
  left, how a mis-tag is corrected (no undo -- tags are frozen), and the two refusals added (not above
  the opening balance, not below what is already paid out). check-swordfish-holding (70).
- **FNB bulk-payment file** (`bankFileCsv`, `fnbHashTotal`): FNB Payments CSV, 36 columns, row 2
  action date CCYY/MM/DD, row 3 the TRUST account (hash total blank unless the profile has hash totals
  on -- `hashTotal` option, sum-of-account-numbers reading), fields sanitised to letters/digits/
  `- / .`, leading zeros kept, account type 1 for everyone (no type is stored), notifications off.
  Row 1 and the heading row are a reconstruction: one test import confirms. check-bank-file (41).
- **Client report: Email it** (compose box, PDF attached, nothing charged, logged on the timeline);
  date range still not built. **Administration** saves its own pane arrangement
  (`raptor.dashboard.admin.layout`) instead of rearranging Sales/Communications. check-dashboard-panes.
- **Full `npm run qa` after the evening merges: 369 of 371 green** (earlier: 363 of 365) -- only the two old reds (account-templates,
  excess-credit). The merge first turned twenty browser files red: their catch-all `/rpc/` handler
  answered the new device check with `[]`; the harness now answers it first (5d01351).
- **e2e on a shared machine: set `RAPTOR_E2E_PORT`** to a private port when another session may be
  running browser tests; two runs died on 5199 with "connection refused".

**Cut-over money and campaigns (evening, 21 Oct)**, four more worktrees merged:
- **Clean break**: most existed (S8: `paid_over_in_swordfish`, Clean break default). Built: the default
  cut-over is `SWORDFISH_CUTOVER = '2026-12-10'` (trustCycles.ts; it was the last closed cycle, which
  would have given 10 Oct), the split in figures on screen, and `swordfish_import_runs` -- one row per
  import batch with the cut-over and the split, written before the wipe, frozen after, discard stamps
  it. Production needs it before the real import or the import stops at the start. check-clean-break.
- **Balances brought forward** (`/trust/brought-forward`, `src/lib/broughtForward.ts`,
  `bring_forward_client_balances`): Trust Debtors sheet, newest month column, exact name or code match
  else a person picks; owed = `client_charges` kind `brought_forward` off_payover; a CREDIT = the same
  kind with a NEGATIVE amount (only this kind may be negative), which recompute_payover_run already
  adds to the payout. One per client (unique index), dated the cut-over, source file + cell, never the
  name. client_ledger opens with it; business income leaves it out (billed in Swordfish). THE FILE IS
  NEVER IN THE REPO. check-brought-forward (102), e2e/brought-forward.
- **Debtor campaigns** (`campaigns`, `campaign_messages`, `campaign_claim`; `api/_lib/campaign/*` on the
  workflow dispatcher; `CampaignModal`, `/accounts/campaigns`): `campaign.run` for Administrator (any
  account), Call Centre Manager and Pre-legal Team Leader (own team's desks, or the floor without a
  team), enforced on the server per account. Skip rules in `campaignSkip`. SMS via Connect Mobile into
  sms_messages; email from the creator's own mailbox into account_emails; fee per message after the
  provider accepts, through the charge engine. Sent by the open page and by the 5-minute sync cron.
  check-campaigns (96), e2e/campaigns.
- **News & campaigns** (`/news`, `src/lib/marketing.ts`, `api/_lib/marketing.ts`, unsubscribe +
  resend-webhook actions on the email dispatcher, `marketing_*` tables, `leads.marketing_consent_at`,
  `leads.status_changed_at`): Resend batches, POPIA s69 rules (clients opt out; leads need consent or
  one "first approach" ever), one-click unsubscribe, preferences + history, timeline line per send.
  `marketing.send` for Administrator, Sales Manager, Liaison Manager. check-marketing (128),
  e2e/news-campaigns.
- **The merge**: both campaign builds redefined `role_capabilities` with only their own new
  capability; the LAST definition in schema.sql now carries both (it is staging's live one), and
  check-capabilities counts 20 predicates. clear_staging's last definition empties both builds' tables.

**Tests at the end of S10:** fast suite all green (18 688 checks, 304 files). Full `npm run qa`: 357 of
361 green. `e2e/upload-a-batch` was red because its client had no commission (the new rule, item 3);
the fixture now has one and it is green (145). `e2e/library` failed under load and passed alone. The
other two are the old reds, `e2e/account-templates` and `e2e/excess-credit`, both older than S7.

### S9 · Balance Sort (19 Oct)

**The firm (18 Oct): "sort ... highest number to lowest number, collected or outstanding balance."**
Capital and Paid already sorted; the balance did not, because the only SQL balance
(`engine_balances`) disagrees with the account page (RRC00005: R817,01 vs R760,00).

- **`account_balances`** (one row per account): `balance`, `to_settle` (computeBalance's
  `settlement`, the column's figure), `as_at`, `ledger_version`, `computed_version`. Written ONLY by
  computeBalance through `src/lib/storedBalance.ts` (`refreshBalances`, `record_account_balances`).
  Never drawn on a screen.
- **Stale is a version, not a flag.** Triggers on `account_payments`, `account_fees`,
  `account_interest_accruals` (insert/update/delete) and on `debtor_accounts` (update of exactly the
  seven columns balanceInputFor reads) call `bump_balance_version` (security definer; skips an
  account that no longer exists, or a cascade delete would be refused). A writer records the version
  it read BEFORE reading the ledgers, so a payment landing mid-way leaves the row stale. Current =
  `computed_version = ledger_version and as_at = raptor_today()`.
- **The list**: To settle is a sort (`?sort=balance.desc`, order `account_balances(to_settle)`).
  Before reading a balance-sorted page, `readyBalanceSort` catches up what changed (≤500) and a bit
  of anything else (≤250, 8 s), then `balance_sort_state()` says how many are left -- shown above the
  rows when not nil. Every row drawn whose stored key disagrees is written back.
- **The nightly job**: `/api/workflow/balances` (a route in the workflow function, no new file),
  cron `5 22 * * *` UTC = 00:05 SAST, CRON_SECRET or an Administrator, 240 s budget,
  `accounts_needing_balance` is the cursor.
- **One mapping**: `fetchLedgersForAccounts` now delegates to `storedBalance.fetchLedgerRows`, so
  the list's figures and the stored figures are read with the same columns. `balanceInput.ts` and
  `dateLabels.ts` import with `.js` now (an API route reaches them).
- Not done: a stored "collected" sort -- Paid already sorts by `payments_to_date`.

**Open or Download, everywhere (19 Oct).** The firm: "When I want to download an attachment, it
opens it in Raptor ... I should see an option to open it or download it ... it asks you where to
save it. The same should work for every single document and PDF." Cause: a detached `<a download>`
on a blob revoked on the next line, which Safari on an iPad draws over the page.
- `src/lib/fileSave.ts`: `saveFile` (iPad/iPhone -> `navigator.share({ files })`, i.e. Save to
  Files; AbortError = cancelled; NotAllowedError after a slow fetch -> `needs-tap`, and the chip
  offers "Save <name>" with the file in hand; elsewhere `downloadBlob`, in the page, revoked a minute
  later), `openPending` (the tab opened on the press, before any await), `blobFromUrl`.
- `src/components/ui/FileActions.tsx`: Open + Download, always shown (no hover on an iPad);
  `buttonsOnly` for rows that already name the file; `openUrl` for signed storage addresses.
- Used on: mail reader, account Emails tab, activity rows, client documents (MandateCard), account
  documents (both presses are a perusal: `openDocument(doc, by, { inline })`), summary/statement
  of account, payment simulation, payover statement + kept copies (RunDetail, client Payovers),
  trace report, letter preview, settlement acceptance. Exports (csv, xlsx, floor csv, trust bank
  file) save through `saveFile`. `documentUrl` / `traceReportUrl` take `{ inline }` for Open.
- `check-file-actions` (46, break-tested three ways) forbids any other `<a download>` or
  `window.open` for a file. The e2e for the letter preview and the simulation read real downloads.

**A signed mandate ADDS to the client sheet (19 Oct).** The firm: "if there's duplicate information,
it ignores it. But if there is new information, it accepts it" -- then "always add the information
from the mandate. Don't replace stuff. If the closer [has] put up some information and it's
important, they might need it." Before, `mandate_on_signed` wrote every filled mandate field OVER
the company and always inserted its two contacts. Now, field by field (reg/ID, VAT, tel, email,
address, the four bank fields, contact person): empty -> filled; the same detail written another
way (`mandate_same`: letters and digits only, lower-cased, a leading 27 read as 0) -> ignored;
different -> the one on file STAYS and the mandate's is ADDED beside it in the new
`companies.other_details` jsonb ([{label, value, source, at}], default `[]`), drawn as "Also on
file" under Client information with its source. An "Added from the signed mandate" Note lists them;
a second bank account adds "Remittance still goes to the one on file: confirm by telephone" (payovers
read only `bank_account_number`). THE NAME is the one exception the firm asked for: the client takes
the mandate's `mandate_client_name`, and the closer's name goes into other_details as "Entered by
Sales" (and into the Deal Won note). Contacts: matched on email, number or full name; a match gets
its blanks filled, a new person is added. Commission is NOT merged -- the signed mandate is the
agreement. Probed on staging in rolled-back transactions; check-mandate (50), e2e client-mandate
(22), both break-tested. Not done: other_details cannot be edited or promoted to the main field from
the screen yet (the closer edits the main field by hand).

**The client page (19 Oct, the firm's mock).** Band tags (Active, services); figures: Accounts ·
Capital handed over · Recovery rate (MiniRing, from `client_account_outcomes`) · Commission
(`ruleKind`) · Deals won (Class moved to Client information; Paid to date / Coefficient removed).
Overview opens with two independent columns: Collections performance (`ClientCollectionsCard`,
`client_money_by_day` + `clientCollections.ts`: sales months, the rate is the whole book to each
month's end, withdrawn out), Handovers month by month, The book at a glance | Attention required
(`ClientAttentionCard`), Upcoming payover (`ClientUpcomingPayover`, trust only), Recent activity.
Below, RecordLayout as before with Client information first and Commission and mandate (one card)
lower. `RecordFigure` takes an optional `icon` / `aside`. Checks: check-client-collections (15),
e2e/client-handovers (28, with `client-overview-ipad.png`), client-mandate updated.

### S8 · Cut-over (18 Oct)

Commits `7f81d32` onwards; each message carries the reasoning.

- **The import makes a clean break** (§3a item 1). `cleanBreak` (the import screen's default, "Clean
  break" / "Swordfish has paid up to"): every receipt on or before the cut-over is Swordfish's
  (`paid_over_in_swordfish`, so never split, never on a run); `cutoverDefault` = end of the last cycle
  to CLOSE. It estimates what Swordfish has not yet paid over AT THE CUT-OVER (into trust only, after
  `settledThroughDefault(cutover)`) and points at the holding. "Nothing to approve" is not a warning
  in a clean break. Parallel run: set the cut-over to 10 Oct by hand. `check-clean-break` (22).
- **Company dashboard in the firm's own layout** (their mock-up, 18 Oct), under the unchanged hero:
  Work coming in (a bar a day, Total / Existing clients / New clients, last month faint behind, "up
  from 2 last month by the same day", Accounts | Rand, a bar opens that day's handovers); The book (a
  ring that PARTITIONS the book -- being worked / not yet allocated / not being worked -- with clients
  and gone quiet as legend lines, each linking to the account list's own views; unallocated gold);
  Departments on the firm's four photographs (`public/brand/departments/*.webp`) with a headline each
  (call centre collected, sales new-client accounts, communications existing-client accounts,
  administration accounts loaded -- none of them income). `company_intake_by_day` (staging + schema).
- **New vs existing clients** (agreed 18 Oct): NEW for the first three months of handovers counted from
  the client's FIRST account (not the mandate), on the top-level client. `company_intake_by_day` returns
  `new_accounts`/`new_capital`. If the firm changes the window, it is the one `interval '3 months'`.
- **Signed, nothing handed over yet** on the Communications dashboard, scoped like every card there,
  longest waiting first, red past 30 days. `clients_awaiting_first_handover()`.
- **Library**: the opened template is pinned (sticky, scrolls inside itself); the list scrolls with the
  page; rows 14px. **New email**: the cursor starts in To.
- **Security audit of 5 Oct, code findings** (`SECURITY_AUDIT_REPORT.md`, the user's file, not in the
  repo): headers in `vercel.json` (CSP **Report-Only** -- enforced, it would be inherited by the mail
  reader's srcdoc frame; microphone NOT denied, dictation uses it); `isFetchableSignatureUrl` (SSRF);
  sync-all needs the bearer (CRON_SECRET is set on prod + preview since 27 Sep, so the audit's C-01 was
  stale); public buckets images-only (staging; **production needs the two `update storage.buckets`**
  at the end of schema.sql); `.env.example`. `check-security-audit` (31). Not done, owner's decisions:
  rate limiting, MFA, backups, DPAs, Information Officer, privacy notice, breach plan.
- **Two-step sign-in was built and REMOVED the same day** (`d907d30`, reverted). The user: "just remove
  the two-factor sign-in ... I don't want to scan anything." Do not put it back unasked.
- **Plans, checked 18 Oct:** Supabase org "Team Raptor" is on the **FREE plan** -- no backups at all;
  the user was told Pro is needed before real money. **Vercel is PRO** (the user; CLAUDE.md's "Hobby,
  12 functions" note is out of date). Spend Management is the user's to set in the dashboard. Supabase's
  and Vercel's DPAs form part of their terms; nothing to sign.

**STAGING CARRIES FAKE SALES AND COMMUNICATIONS DATA (18 Oct, the user asked, to see the dashboards).**
Every row is marked: companies `bf_reference = 'seed-s8'` (30 clients), leads `legacy_key like 'seed-s8%'`
(270), deals / activities `notes = 'seed-s8'`, debtor_accounts `legacy_reference = 'seed-s8'` (874,
`source = 'swordfish'`, unassigned, so no workflow starts), account_payments `reference = 'seed-s8'`
(791, `paid_over_in_swordfish`, so nothing was split into trust). Teams "Client Care" (Communications)
and "Closers" (Sales); ten users `seed.*@raptor.invalid` (5 liaisons incl. Bonita Mahlangu as Liaison
Manager, 5 sales incl. Dean Fourie as Sales Manager) -- auth users BANNED for 100 years, so nobody can
sign in as them. Nicole Loder moved onto Client Care. Remove it all before any real parallel run.

**"Held for Swordfish payovers" -- the design, not yet built** (read before building): a one-row table
`swordfish_holding` (amount, reason, set by, at) rather than firm_settings columns (five hand-kept
lists); set by `set_swordfish_holding(amount, reason)`, Administrator + finance.view, logged in
`finance_setting_changes`, dated by the trust OPENING date (the holding is part of the opening).
Debits after the opening allocated as "Swordfish payover" / "Swordfish-era drawing" through a new
`allocate_swordfish_line` (allocation_kind stays 'other' -- the kind check cannot be widened from the
MCP -- plus a new `bank_statement_lines.swordfish_kind`, no ledger entry: the money leaves the bucket,
not anybody's ledger). `trust_position`'s owed_out adds what is left; `accountedFromCash` and
`currentHoldings` take it so the overview and Not accounted for agree. Closing what is left after the
last Swordfish run (firm fees can be written off, client money cannot) is the FIRM's call -- ask.

Newest first. Each commit message carries the full reasoning; this is the index.

**The sales dashboard's order (927ae72), the firm's: "a mandate is a mandate and a deal is a deal."**
1. Mandates: `MandateOutcomeCard` (closing-rate ring, leads created, mandates signed, new-client
   handovers).
2. Deal outcomes: `WinRateCard` with `showLeadPipeline={false}`, **service deals only**. The cohort
   leaves out `dealKind === 'Handover'`, so one signature is never two wins.
3. The track record: stacked bars and line.
4. What to act on: signed with nothing handed over, Top performing **closers**, needs attention,
   tasks, targets.
5. The detail.

Also:
- "Reps" are now **closers** on screen. The scope picker groups Closers and **Liaisons**: liaisons sell
  services too ("drafting of contracts, executive listings") and were always counted through
  `isAssignableOwner`.
- In Both mode, the closing-rate % sits on the leads LINE, not the bar. The line runs along the bar
  tops and the label sat on it; the firm circled it. The e2e measures the gap.

**Then (18 Oct, afternoon):**
- **Mandates and Deal outcomes share a row** from `xl` up ("fit these guys in next to each other").
  Both are compact: a ring beside the figures.
- **"Signed, nothing handed over yet" left the sales page.** It is the liaisons' list and stays on
  the Communications dashboard.
- **In its place:**
  - `MandateToHandoverCard`: days from mandate to first handover, per closer.
  - `LeadSourcesCard`: leads and mandates per source. A mandate takes its LEAD's source when it
    came from one, the deal's otherwise.
  - Both cover the same months as the chart's 6/12 switch. The arithmetic is `leadSources` and
    `mandateToHandover(…, span)` in `clientBook.ts`, checked in `check-client-book`.

**`TODAY` (mockData) now follows the staging clock.**
- It was read at import, before `loadClock` asked the database, so about twenty screens ran on the
  machine's day. The firm saw it as the sales dashboard on November, all zeros, with staging on
  11 Sep.
- `syncToday` moves that one shared Date once the clock is read (`clockLoad.ts`), before
  AppLayout draws a page.
- The e2e asserts September on a staged clock.

Mandates and Deal outcomes now sit side by side from `lg` (iPad) up, with container queries
inside the cards.

**Work coming in draws months over a span of months** (`intakeMonthBars`, `spansMonths`):
- One SALES month per bar.
- No faint prior bar: the months are the comparison.
- A bar opens its whole month (`toDay`).
- The firm: "when it's ... 3 months or more ... compare the months to each other instead of the days".

**The welcome flow (S8, 18 Oct): mandate signed online → liaison → welcome.**
1. `mandate_on_signed` sets `companies.liaison_needed`.
2. The closer's bell links to the client, where `WelcomeCard` has **Assign and welcome**. The sales
   dashboard lists "Signed, waiting for a liaison".
3. `POST /api/email/welcome` (`api/_lib/email/welcome.ts`) does five things:
   - sets `account_owner_id`, clears `liaison_needed`, stamps `liaison_assigned_at`;
   - sends `welcomeEmail()` from the LIAISON's mailbox (falling back to the caller's), with the
     banner `/brand/email/welcome.jpg`, and stamps `welcome_sent_at`;
   - adds a "Welcome call" task for her on the next working day;
   - raises a `client.assigned` notification, which pops up via `NewClientPopup` / `newClientPopup`;
   - writes both into the client's notes.
4. The welcome steps are DERIVED (`welcome.ts`): the last one ticks on a Call or Courtesy Call
   logged on the client after the assignment.
5. Checks: `check-welcome`, `e2e/client-welcome`.
6. "Send mandate" reads **Resend mandate** once one has gone. Each send is a fresh link, and
   whichever link is signed does the same thing.
7. Abc cricket (the firm's test client on staging) was set `liaison_needed` so they can try it.

### S7 · Clean Break (12 Oct)

- **Payover runs: four tabs, one cycle each** (the firm, 12 Oct, on staging day 11 Aug: "in the
  closed to pay, two months were mixed. That's confusing"; "There's nothing in running. I don't know
  why"). With a one-month lag there are always THREE live cycles and the queue had two working tabs,
  so the cycle paid that morning and the one that closed the night before shared "Closed · to pay".
  Now **Collecting · Waiting · To pay · History**, decided by `queueTabOf` (payoverGroups.ts) from the
  date alone: Collecting = the open cycle (its band is drawn even with no runs); Waiting = closed,
  before `paysOnFor` and not released; To pay = on/after the payout day or released early, overdue
  in red; History = finished (`isFinal`, unchanged). Opens on To pay, else Waiting, else Collecting
  (`defaultQueueTab`). Old `?tab=running/closed/paid` still land (`parseQueueTab`). **History** shows one
  payout at a time (month picker, default the latest) with Collected / Paid out / Date paid (the
  Johannesburg day) / Reference; a search on client or run number looks across every payout. No
  regenerating -- the advice copies are as sent; the client's Payovers tab is unchanged. Band titles:
  Running -> Collecting, Closed -> Waiting. `check-payover-groups` 32 (break-tested twice),
  `e2e/payover-sends` 56 (break-tested), `check-payout-day` updated.
- **"Not accounted for" opens every item behind it** (the firm, 12 Oct: "If I click on that, it
  should show me everything ... now you're going to like 50 different places"). `/trust/unaccounted`
  (`TrustUnaccounted.tsx`, pure `trustUnaccounted.ts`), opened from the overview's headline figure
  and the reconciliation's. Built from readers that already exist: `payments_out_paid` (marked paid,
  not on a statement), `bank_lines_to_allocate` (receipts to place, debits to explain),
  `trust_awaiting_approval`; signed by their effect, they add up to the figure and anything left is a
  line of its own. **FOUND:** staging's whole R14 258.64 was three payovers (R11 333.17) and two
  refunds (R2 925.47) marked paid whose statement was not imported -- the overview called that "In the
  bank, not yet in the books", which is backwards; reworded. Overview and list read "accounted for"
  from one function (`accountedFromCash`). Actions LINK to where each job is done (run, Payments to
  make, Exceptions, Payments in); allocating a line inside the list itself is the next step if the
  firm wants it. `check-trust-unaccounted` 18 (break-tested twice), `e2e/trust-unaccounted` 9
  (break-tested); `check-firm-held`, `check-trust-cycles` follow the helper. Proved against staging:
  the five items sum to R14 258.64, remainder nil.
- **`e2e/workspace-split` is green again** (100/100): the scroll assertion now uses a short viewport
  rather than depending on how much the overview happens to hold.
- **Full `npm run qa` at the end of S7: 324 of 327 green.** The three red fail IDENTICALLY on
  `37d4b09`, the commit S7 started from, so they predate it: `e2e/performance` (date-dependent, see
  "Start here" item 7); `e2e/account-templates` (the balance merges as "R 180,128.02", with a comma
  where the test expects en-ZA's grouping -- look at which formatter the template preview uses);
  `e2e/excess-credit` (a click times out at 30 s). `e2e/overpayments` was S7's and is fixed: the rail
  says To sort now.

### S7 · Clean Break (13 Oct): the trust, regrouped around what the firm does with it

Commits `0f4cf73` onwards; each message carries the reasoning.

- **Payments in: interest and charges book themselves** (`0f4cf73`). The firm: "credit interest ...
  should be allocated as interest. But in the place option doesn't give me the option".
  `lineNature()` (bankLineAllocation.ts) reads a line as bank interest / bank charge / returned debit
  (RETURNED is tested before CHARGE). `bookObviousLines()` books interest and charges on import and
  from a button. The layout is folded so nothing scrolls sideways at a laptop's width.
- **A client pays against their STATEMENT, not one run** (`f2a5dcd`; the firm said yes on 13 Oct).
  `record_client_payment` takes any amount and applies it oldest first across shortfalls and invoices
  (`client_payment_applications`). Part payments are allowed and an overpayment is refused in the
  box. An **arrangement** (`client_payment_arrangements`, `clientArrangement.ts`) is a schedule,
  checked cumulatively against receipts on or after the day it was made.
  `record_client_business_receipt` now delegates to it, and what is still owed carries to the next
  run (`carry_what_is_still_owed`). `ClientOwesPanel` sits at the top of the client's Account tab; a
  run's "client paid us" reads owed · paid · still owed. **Run pills by tab**: Collecting is red,
  Checked · waiting is yellow, Ready to approve is blue (`runPill`). The "To pay" tab is now
  **Approve**.
- **Bounced payments** (`739b4ea`, prompt 12 A). A returned debit is offered the receipt it most
  likely reverses (`bounced_receipt_candidates`). `return_bounced_receipt` reverses the receipt
  (`returned_unpaid_on`) and closes both lines. The debit line gets `other` + `returned_payment_id`,
  NOT `payment_id`, because that column is unique. The account's capital goes back up, and the app
  says "Returned unpaid" rather than "Reversed". **Staging's SBB/2003 R1 000 is left for the user to
  press** (§3); until then it is the −R1 000 under Not accounted for.
- **Prompt 12 B and C** (`4c61fcc`, `5f54f9e`):
  - In `firm_trust_split`, drawable is never below nil and waiting is never above held. The −R88.10
    was bank charges paid out of a share that was still waiting.
  - A BF FEES debit auto-matches a single recorded business transfer.
  - Payover runs carry a banner when there is something to draw.
  - A closed account's receipt held whole as credit is no longer an allocation mismatch.
  - The R287.50 is −R1 000 (the bounce) plus R1 287.50 of Marula PTC fees, netted in the ledger but
    not in cash.
- **Payments out** (was "Payments to make", `5f54f9e`). One list: tick what goes into a downloadable
  bank file (`bankFile.ts`, generic CSV). A row with no banking details is **pending**, with the
  reason under the name and **Add banking details** (`set_payment_banking`). `?draw=1` opens the
  drawing box. **The bank's own template is not in yet** (§3).
- **The Trust overview shows only money in the account now.** The firm: "This viewpoint ... is only
  applicable for all money that is currently in the trust." `currentHoldings` (trustOverview.ts)
  lists clients only for cycles not yet paid over, then the firm as ONE net line saying what can be
  drawn now, then debtors. It regroups `accountedFromCash` and never recalculates it. **The ownership
  reconciliation card is gone** ("is that really necessary"). In its place is **Needs doing**
  (`todoItems`), a list of links: not accounted for (red if negative), overdue payovers, suspense,
  statement lines, overpayments, payments out, the firm's share to draw, and clients owe us.
  **Each payover, checked** moved to the Trust ledger.
- **To sort** (`/trust/exceptions`, `TrustToSort.tsx`). The firm could not find the suspense
  account. One page now holds Suspense, Statement lines to allocate, Overpayments (with parked
  credits) and Anything else holding a payover up.
- **Clients owe us** (`/trust/clients`, `clients_owing()`). The firm: "The moment you owe the trust,
  you owe the business ... we don't distinguish." One row per client (unpaid shortfalls plus
  invoices), linking to the client's statement. The old balances list is at `/trust/clients/all`.
- **Bank statement** (`/trust/statement`, `trust_bank_statement()`). Every imported line with what it
  was and the account or run it belongs to. It is read-only on purpose; changing a line stays on To
  sort. **Both functions are now mirrored in schema.sql.** `clients_owing` had been on staging but not
  in the file, and `trust_bank_statement` had been in neither.
- **Business → Income, month by month.** The firm asked for "line graphs ... profit made from
  interest ... fees ... commission, and then obviously total profit ... collected and what is our
  profit".
  - `business_income_months()` calls `business_income` once a month, so there is one calculation.
  - `collected` is **dated by approval**. Dated by receipt, staging's September read 177%; by
    approval it reads 39–49%, the firm's own "40 and 50%".
  - Four lines: Interest (including bank interest), Fees (including charges), Commission (excluding
    VAT), and Total earned (the ledger total less commission VAT). Then Collected and the share.
  - **Behind `business.income`** on the Income page, and never on the company dashboard.
  - It is **income before expenses**, and says so.
  - `check-income-trend` has 24 checks. Break-testing caught a vacuous one: `JSON.stringify(NaN)`
    is `"null"`.

### S7 · Clean Break (13 Oct, evening): prompt 12's last three, and All time

- **Prompt 12 C, the false "Payover overdue"**: Marula's settled runs below nil (PO-MPG-2606 carried
  into -2607, which Marula paid into the business account) stay `sent`. The cycle readers asked
  "paid?", so the overview said R1 253.13 was overdue and listed R356.25 + R748.12 as "to be paid
  over". `trust_by_cycle`'s runs-to-do and `trust_cash_by_cycle`'s kept-back now ask
  `firm_run_settled`, the same test `firm_trust_split` uses. On staging the overview's firm line now
  equals `firm_trust_split`'s held to the cent (R11 061.83; it was R1 104.37 short), and every
  cycle total is unchanged. `overdueCycles` also requires a run still to pay, or none built.
  Checks: `check-trust-balance`, `check-firm-drawable`.
- **Prompt 12 B2**: the firm's drawing is the last line on Payover runs → Approve (`drawingStep`,
  paymentsOut.ts). It shows "Can be drawn", then "Drawn · waiting for the statement", then
  "Drawn · on the statement". It is found by BF FEES-YYMM of the payout month, never by amount.
- **Prompt 12 B3, second half**: a BF FEES debit with no recorded drawing is suggested as a new
  drawing, and the button says "Record it as BF's drawing". A recorded one is still matched first.
- **All time on the dashboards** (the firm: "it calculates it against the progress for one month").
  The target was looked up by the period's key, so every period that wasn't a month fell back to one
  month's target (R121 650 of all time read as 101.4% of R120 000). `targetMonthsOf` (salesMonth.ts)
  now decides: a month uses its target; last 3, 6 or 12 months use each month's own target, summed;
  all time, year to date and custom dates have none. For those the bar says "No progress for this
  period", and the pace tiles say why. `check-period-target`.

### S7 · Clean Break (13 Oct, late)

- **Closed accounts read "New"** (the firm: "these are still new accounts, but it's in the closed
  thing"). Ending an account sets `ended_as` and `book = 'closed'` but leaves `status` alone ('Active'
  on all 24 on staging). The account page passed `closed: accountEnded(account)`; the list, the diary,
  the finish-box preview, the planner (`handOutData`) and the import's linked-account summary didn't.
  All of them do now; the diary and the import's existing-accounts read `ended_as` for it.
  `check-position-closed` walks `src/` and fails on any position call without `closed:`.
- **"Owed back to the trust R39 877.68" on Trust ledger → Against the bank was the firm's own
  drawings, counted twice.** `trust_position` grouped firm entries per account, so drawings and
  charges made a −R39 877.68 "firm" bucket beside a firm line already net of them. It now treats the
  firm as one party, as `trust_balances` (the tabs) always did. Owed back → R0; the difference didn't
  move.
- **The R1 287.50 difference was Marula's PTC fee on PO-MPG-2609** (ready, not approved): debited
  from Marula when the PTC is recorded, credited to the firm only at approval. **The firm chose to
  credit it straight away as waiting.** It's done by DERIVING it, not writing it (the ledger is
  immutable, and a written credit would be credited again at approval). `trust_position` adds
  `ptc_pending` per client (fees debited − recovered − paid to the business account, never below
  nil). `trust_cash_by_cycle` moves a PTC's fees on a run not yet settled from the client's line to
  the firm's. Neither touches `firm_trust_split`, so it's not drawable. Staging: difference nil;
  Marula's line R276.06 (its payover); firm R12 349.33; cycles total the bank's R24 750.00.
- **Profit graphs: the firm kept them in Business → Income and Stephan was given
  `business.income`** on staging (he had no grant, so he couldn't see them). **Production needs the
  same grant** when it goes live; it was set as Stephan through the admin path, never by
  bypassing the trigger.

### Sixth session (11 Oct) — the payout day, the spinners, and a withdrawal that read as Active

Asked for while running the three-cycle simulation (HANDOFF 7) on the iPad, clock at 10 Jul.

- **A payover goes out on its payout day.** The firm: *"I shouldn't be able to email all the
  payovers because [they] should only be going out on the next month ... when we do the payment"*,
  and not ready before *"unless you override it somehow"*. Approval is unchanged (any time after the
  cycle closes). The FIRST advice send, marking sent and marking paid now call
  `assert_payover_run_due` before writing; the override is `release_payover_run_early(run, reason)`
  (Administrator, ten characters, kept as `payover_runs.released_*`). Nothing is emailed by itself on
  the day: the day makes it due, a person sends it. The statement path (`allocate_bank_line`) is NOT
  gated -- money found on the statement has already left. `payments_to_make` lists a run before its
  day as `scheduled` ("Not yet due"); the queue shows "Pays 11 Jul" instead of a button and the bulk
  bar counts what is not yet due; the run page offers **Release early…** with a reason.
  `sendRemittanceAdvice` asks BEFORE building the PDF -- the database's refusal comes at the record
  step, after the email has gone. The four 2606 advices already sent on 10 Jul stay as they are.
- **The queue's cycle bands read the date.** With a one-month lag the cycle paid on the 11th is not
  the one that closed last night, so `groupRunsByCycle` called it Overdue on the morning it fell
  due. It now takes `today`: Due today / Closed / Overdue.
- **"It just keeps on loading."** The logs showed every press FINISHED (approve 4 runs: 2 s; email
  4 advices: ~55 s, about 13 s each; the 29-day clock jump: 25 s then a reload) -- what the firm saw
  was a bare spinner for most of a minute and, on a dropped connection, a spinner that never ended
  because the busy flag was cleared on the last line. Now: every bulk press goes through `bulk()`
  with a `finally` and says what it is doing ("Emailing 2 of 4 · Seabreeze…"); the clock route
  walks 20 s a call instead of 240 s so the banner moves, and a call that does not come back asks
  `raptor_clock` where the clock got to and carries on (`fetchWithin`, 90 s).
- **A withdrawn account read Active / New.** `withdraw_account` writes `ended_as` and leaves
  Swordfish's status alone (imported history is frozen), and the account page read only the status.
  The hero pill now says "Withdrawn by the client · date" and both positions get `closed: ended`.
- **A set-off charge with no receipts behind it had no run.** `refresh_payover_runs` only built runs
  for clients with allocations, so a withdrawal charge for a client whose debtors paid nothing that
  cycle never reached the queue. It now also builds for unclaimed `set_off` charges.
- `check-payout-day` (27, break-tested four ways); `check-payover-groups`, `check-payments-out` and
  `e2e/payover-sends` (44) updated for the gate.

**Later the same session:**
- **A run is APPROVED on its payout day** (the firm: "it goes into a ready state, but then you only
  approve it by the time that you pay it out"). `approve_payover_run` refuses before
  `payover_pays_on` without a reason; `approve_payover_run_early` (reason) also releases the
  payout. Queue: "Approve on 11 Aug", bulk approve takes due runs only, the Ready tile counts only
  what can be approved now. This replaced the "drop an approved run back to Ready" idea.
- **APPLIED 12 Oct (the user, SQL editor) and mirrored at the end of schema.sql; the pending file is
  gone. Proved rolled back: KLR's 10 Aug charge -> PO-KLR-2607, and back off PO-KLR-2608. `check-payout-day` (34)
  asserts it.** Originally: `supabase/pending/2026-10-11_build_payover_run_payout_window.sql`. The
  build_payover_run change that makes a withdrawal (set-off charge) come off the payout BEFORE
  which it was raised, and takes it back from a later open run. The Supabase MCP asks a person to
  confirm any SQL containing DELETE; the confirmation never reached the firm's iPad (three tries,
  "cancelled"). Until it is applied a charge raised after a cycle closes still rides the NEXT
  cycle's run. Apply on staging from the SQL editor (or retry the MCP with the user at a desktop),
  then append it to schema.sql and delete the pending file. `check-payout-day` does not assert it.
- **Prompt 11 -- find and reverse a payment.** History search (account number, RAP-, client
  reference, debtor, bank words, amount-as-amount); Account column = client's number over ours;
  Reverse on each History row, on the account's Transactions tab (`AccountPaymentsList`) and on
  each run line, all one `ReversePaymentModal` that reads the payment by id; the opened History
  payment unfolds under its row in a sticky panel held to the scroller's width; tooltips say why a
  payment cannot be reversed. Tiles: Unmatched reads `unallocated_receipts`; Ready counts approvable.
- **PTC <-> trust re-capture** (the firm: "from a PTC to an ACB or an ACB to a PTC"):
  `reverse_payment_switching_side` = reverse + the copy back in the queue on the other side; a
  receipt off the trust statement cannot become a PTC. A third option in the Reverse box.
- **Finalised** replaces the Paid tab on the queue: paid runs, and runs below nil whose advice has
  gone ("Carried to next run") -- MPG-2606 sat under Due today for ever.
- **Trust -> Overpayments** (To decide · To refund · Parked · Refunded), reusing the disposal box,
  `mark_refund_paid` and ParkedCredits.
- Checks: `check-payment-search` (25), `check-payout-day` (32); e2e `payment-reverse` (20),
  `overpayments` (7), `payover-sends` (46), `check-payments` (29).

**12 Oct, morning:**
- **Settlement proof built** (the firm said yes): `approve_settlement_with_proof` needs a pinned
  account email or an uploaded account document (no perusal fee), checked to be on the same
  account; the old `approve_settlement` only refuses. Panel shows/opens the proof; client Account tab
  lists accepted settlements. check-settlement (59), e2e/settlement (24).
- **Prompt 11, closed accounts:** `allocate_payment` posts NO split on an account with `ended_as`,
  a write-off reason or a closed/written-off status -- the whole receipt is `excess_credit`
  (engine `v2-closed-credit`, PTC -> `with_client`), so it lands on Overpayments to refund / move /
  release. `preview_allocation` matches, so the queue shows no fees. The queue badge says
  "Account withdrawn 10 Jul · R1 000.00 held as credit"; Reject reads "Reject · not theirs"; a credit
  line on Exceptions offers "Place on an account". Proved on staging (rolled back): SBB/2006's R1 000
  -> R0 fees, R1 000 credit, refund payment out 'BF RAP-124303', trust difference unchanged.
  NOT BUILT: rule 5, re-opening a file and re-splitting its held credit -- there is no re-open at all
  yet and it touches the withdrawal charge; asked the firm.
- The withdrawn pill says "Withdrawn · date" (the firm: "only have to say withdrawn").
- `build_payover_run` pending SQL: applied by the user on 12 Oct (see above).

**12 Oct, afternoon (prompt 11 v3, URGENT first):**
- **A reversed or rejected payment counted on the account (KLR/1006).** The statement, Collected and
  To settle today read the reversed R1 100 AND its rejected copy. The ledger fetches in
  `accountBook.ts` now drop `rejected_at` rows, `totals.paid` and `balanceInput` count live money
  only, and a reversed receipt is drawn struck through with its fate ("Reversed 10 Jul — Wrong ref
  → placed on MPG/3003", `reversalFates`). Every date on the account is the Johannesburg day
  (`firmDay`): 22:00Z on 2 Jul is 3 Jul. `check-live-money` (15) holds it.
- **The timeline says the account was closed** -- every `account_status_events` change (withdrawn,
  settled, paid up, written off, hold, re-open) with who, reason and the charge (`fetchStatusChanges`,
  kind `status`).
- **The closed-credit rule was narrowed.** As first built it tested `ended_as` alone, so when a
  reversal re-split the account's LATER payments, a payment KEPT through the withdrawal came back as
  a credit. It now applies only to money received on or after `ended_on` (Johannesburg day), or a
  payment marked `account_payments.hold_as_credit`. Written-off/closed-status accounts unchanged.
- **Withdrawing with payments on it asks: keep (default) or refund** (the firm: "by default, keep it
  on the account"). `EndAccountModal` lists the approved receipts with their run; Keep is
  `withdraw_account` unchanged; Refund (ticked receipts, payable-to name) shows the effect first --
  "R1 100.00 refunded to the debtor; the client owes back R847.50 on its next payover" -- and calls
  `withdraw_account_refunding`: validate all, withdraw, then per receipt reverse_payment -> copy
  `hold_as_credit` -> approve (whole credit) -> `dispose_excess_credit('refund')`. One transaction.
  A PTC and Swordfish history are not offered for refund. Proved rolled back on KLR/1004: kept
  payments stay split, a -R900 reversal line on PO-KLR-2607, one refund to make, trust difference
  unchanged. `check-payment-search` (40), `e2e/withdraw-payments` (13), both break-tested.

**12 Oct, midday -- ready to close on the WHOLE balance; interest on write-offs runs to prescription**
- **The firm corrected "paid up = capital nil"**: "almost always there will still be fees ... this
  will be regarding the total outstanding balance ... if after the division there is ... under 50
  rand, then the account should ask you if it can be closed ... as settled ... small balance". So
  `accounts_ready_to_close` now returns `residue` CANDIDATES (open, had capital, a live payment has
  gone through it, capital under R50 -- a balance under R50 cannot have more capital than that) and
  the browser works out the real balance with computeBalance (`readyToClose.balancesOf`), keeping
  nil -> `paid_up` and under R50 -> `small_balance` (`readyKindFor` in accountEnding.ts). A small
  balance closes as **settled** with reason "Small balance of R x waived", so the remainder becomes
  the settlement discount. `endingAdvice` now advises settled (not write-off) under R50, and the
  close box is handed the WHOLE balance, not `capitalOutstanding` (it was the capital). The firm
  said "ask ... or automatically close, I don't know" -- built as ASK; automatic is one line away
  if they want it.
- **Interest on a written-off account runs on to prescription** (the firm: "written off accounts
  ... written off by the firm should continue to run until prescription ... it can stop running on
  withdrawn accounts, ... paid up accounts"; they offered "or stop, and recalculate on re-open" --
  running on was taken, re-open does not exist). Both engines: `open_interest` (staging + schema)
  no longer returns on a written-off status; it stops at `prescription_date` (or not at all when
  flagged prescribed with no date) and at `ended_on` for withdrawn / paid up / settled. In the
  browser `accrueToFor` (balanceInput.ts) is the same list; `writtenOffAt` is no longer set from an
  account at all (computeBalance still honours it if a caller passes one). NOTE: staging has 24
  accounts, none with a prescription date -- the rule is only as good as `prescription_date`, which
  the Swordfish import sets.
- Checks: check-ready-to-close 27, check-balance +10, check-account-ending, check-list-balance,
  check-interest-posts-at-payment, check-firm-day updated; e2e/ready-to-close 11.

**12 Oct, late morning -- settled accounts, closing, and the settlement on the client's report**
(the firm, on HTH/4004: settled for R5 000, still open, "R7 980 to settle today", client told "In
progress" throughout):
- **A settled account ends at nil.** `BalanceInput.settledOn` (from `ended_as = 'settled'`,
  `ended_on`) stops the clock like a write-off and makes what was still owed that day the
  `waived` figure: a "Settlement discount -- the rest waived by the client" credit line on the
  statement, balance R0.00. Derived, never stored. An overpaid settled account waives nothing.
  The first tile reads "Settled · R0.00 · R x waived by the client"; the money panel shows the
  discount instead of "To settle today". Raptor's own write-off (`ended_as = 'written_off'`) now
  stops the clock on `ended_on` rather than the last action. check-balance (+9).
- **`accounts_ready_to_close(p_accounts uuid[] default null)`** (staging + schema.sql): open
  accounts whose approved settlement is paid in full (`settled`) or whose capital is nil
  (`paid_up`). Security invoker. On staging it finds HTH/4003 (paid up, never closed).
- **The approval queue offers the close.** A row that completes an approved settlement is badged
  "Completes the settlement" (counted as account_settlement counts); "Capital paid off" says it
  will offer a paid-up close. After approving, the queue asks the database which of those
  accounts are now finished and opens `CloseReadyBox` -- all ticked, "Not now" to skip. Settled
  closes via `close_as_settled`, paid up via `settle_account('paid_up')`. Never automatic.
- **Ready to close** (`/accounts/ready-to-close`, a gold line on the Accounts page when any exist):
  the net for ones somebody skipped. Not in Trust -- closing is a collections decision.
- **The settlement on the client's report, as Arranged** (the firm: "just say arranged ... keep
  it simple"; no new rung): offer -> Negotiating and the client's action ("We are waiting for your
  approval", with the figure); approved -> Arranged ("A settlement of R5 000 was arranged on ..., to
  be paid by ..."); lapsed -> Broken arrangement; paid -> Closed ("paid ... in full and the account
  is closed as settled"). Wired on the account page only -- the accounts list, diary and monthly
  report do not yet read the settlement (they fetch no offers). check-client-position (+15).
- **An account with a payment is not "New".** everWorked counts a live payment.
- check-ready-to-close (20), e2e/ready-to-close (10). Also fixed two e2e tests broken by prompt
  11 itself: payments-in (two Reverse buttons, the box now reads by id) and reject-payment
  ("Reject · not theirs").

**Fifth session (10 October, evening), on `claude/staging-clock`** (started from `1848079`):

| Commit | What it is |
|---|---|
| `0e39e8a` | **The firm draws its share of trust money only once the client has been paid** (the firm, 10 Oct: "Bredell Ferreira can only claim its part of the trust fund money once the client has been paid. So, work it out like that"). `firm_run_settled(run)`: paid, or approved/sent with net payover at or below nil. `firm_trust_split(company)` -> held (= owed_to_firm, unchanged), drawable, waiting: a firm entry on a receipt waits on its ALLOCATION's run, a charge set off or PTC share recovered on its OWN run; bank interest, a transfer in and a parked credit never wait; the waiting entries are netted and only a net below nil reaches drawable (a receipt reversed after its share was drawn -- simulation cycle 2: drawable -R349.35). Every rule only LOWERS the figure, so it cannot cause a shortfall. `draw_from_trust` limits on drawable ("The firm may draw nothing now. The rest of its R x in trust waits until the clients it came from have been paid."). A transfer found on the statement and NOT recorded first (`allocate_bank_line` business_transfer, no target) is still written, not refused -- the money has gone, as before. Screens: Payments to make (firm card shows drawable, "A further R x ... waits"), Drawings ("May be drawn now", of R x earned), Business overview (a line under Earned, still in trust). Simulation: before each cycle's runs are paid all of the firm's share waits and drawing it is refused; after, it is drawn through `draw_from_trust` and matched on the statement to that drawing; both scenarios still end at R0.00. `check-firm-drawable` (23), break-tested four ways; check-business-income and check-client-account now read the ceiling through the split. Nothing rewritten: entries already drawn stay drawn. |
| `d697f11` | **The firm's PTC share recovered by set-off is the firm's, and can be transferred** (the firm, 10 Oct: "the firm's share should stay in the trust. And it should be able to be transferred to the business account"). `trust_creditors_on_run`, on approval: ONE firm entry "PTC share recovered from payover PO-..." = the client's PTC debt on approved runs (reversed PTCs net out), less what this run still leaves short (read as PTC debt first), less what was already credited or paid into the business account (`client_business_receipts`). Negative only when a reversed PTC takes back a share already credited. It is then in `owed_to_firm`, so Payments to make / `draw_from_trust` can take it. `trust_cash_by_cycle` already read that money as the firm's (`firm_set_off`), so it leaves the new entry out of `firm_other` rather than counting it twice. Income shows it as kind 'other' (`firm_entry_kind` unchanged). Simulation: R2 176.18 credited on PO-SMB-2609, transferred with the BF fees, trust R0.00 after cycle 3; paid-direct scenario still R0.00. Going forward only, nothing swept: a client's share recovered on runs approved before this is caught up at its next approval. `check-ptc-share-recovered` (8), break-tested. |
| `bae366e` | **Remittance advice: OUTSTANDING stays, and a VAT sentence on every line** (the firm, 10 Oct: "keep the outstanding column and the VAT also needs to be there"). Under each collection on the PDF: "Commission 20% R 270.00 + VAT 15% R 40.50 = R 310.50 deducted" (a reversal: "... given back with this reversal", red); its own column in the .xlsx. `vatLine` in remittanceAdvice.ts reads VAT's rate off the row's own figures. **The mock-up's exact wording is not in the repo** -- this is a default offered to the firm; if they paste the sentence, change `vatLine` only. `check-remittance-advice` 75 -> 82. |
| `b95cb62` | **A client pays what it owes into the BUSINESS account, matched to its payover** (§3 item 1, the user: "you can proceed"). `record_client_business_receipt(run, amount, day, reference, note)` -- trust AND business ticks; an approved run below nil; the whole shortfall to the cent (part payments refused for now, §4 item 13); once; not in the future (the clock's). Writes `client_business_receipts` (append-only, trigger refuses update/delete), `payover_runs.settled_direct_receipt_id`, and ONE client trust entry "Paid to the business account against PO-..." that clears the minus a PTC left with no money behind it. Settled = not carried (`build_payover_run`, `close_payover_cycle`), not owed by age (`ptc_ageing`); carried into a run still being checked -> that run is rebuilt without it; into an approved one -> refused. `trust_cash_by_cycle` treats the entry like the PTC it pays off; `client_ledger` names it `paid_direct`. Run page "Record their payment"; runs list "Paid to us"; client ledger line. Simulation `run_direct`: trust R0.00 at the end of cycle 3. `check-client-business-receipt` (24). |
| `9b8552d` | **Payovers matched from the statement by the BF PO reference first** (§3 item 2). `match_payovers_by_reference()`: every unallocated debit whose reference or description names a run (`payover_number_in`, any case, `-2` suffix) is settled through `allocate_bank_line(...,'payover')` -- only at the run's exact amount, only an approved/sent/paid run not yet on the statement; anything else is reported, not matched. The statement import runs it straight after the lines land and says so; Exceptions has "Match N payovers by reference". `check-payover-reference-match` (16). |
| `c553117` | **The three-cycle simulation, and two faults it found.** `scripts/qa/live/staging-clock-sim.sql` (functions in a `qa_sim` schema on staging, revoked from every role): clears staging, walks three cycles on the clock, asserts prompt 10's Done-when list, and RAISES so it all rolls back. Green. FIXED: (1) a statement receipt matched by its reference could not go back to Needs an account -- `import_bank_lines` never wrote `account_payments.bank_line_id`, so `reverse_payment_to_unplaced` called it "recorded by hand"; the import writes it now and `reverse_payment` / `reverse_payment_to_unplaced` find the line either way (staging's existing rows are covered by the fallback; nothing was swept). (2) Money on a CLOSED account was flagged nowhere: the approval queue badges it "Account closed" (how and when) and `splitForBatch` holds it out of Approve all. NOT changed: §4 item 12. `e2e/staging-clock` (18). |
| `a7d3b11` | **The staging clock (prompt 10).** `raptor_now()` / `raptor_today()`: on production now() and Johannesburg's day, ALWAYS -- the clock row (`staging_clock`, one row) is read only where `deployment.kind = 'staging'`, and a trigger refuses the row anywhere else; proved on staging by flipping the deployment row inside a rolled-back transaction (`raptor_now() = now()`, the write refused). On staging: the clock's day at the real time of day. **62 functions** route business dates through it (generated from each function's live text, md5-verified against schema.sql; the rule: every non-comment line not stamping `updated_at`); left real ON PURPOSE: updated_at, `workflow_publish`, the `signing_*` expiries, the clock's own functions -- `check-staging-clock` holds that list. `payover_cycle_tiles` and `payover_buildable` now cut on `allocated_on` (they still used `created_at`, which the clock cannot move). Business-date column defaults follow the clock (14 columns; calls, emails, activities, imported_at, the settings log and advice sends stay real). `begin_staging_clock_jump` (forward only, logged in `finance_setting_changes`), `step_staging_clock` (exactly one day; on the 11th `close_payover_cycle` for the cycle just ended + `refresh_payover_runs`), `clear_staging(start, 'CLEAR STAGING')` (empties book and money, keeps people/templates/workflows/settings/mailboxes, clears the trust opening balance, restarts the clock). Server: `firmClock()` (api/_lib/workflow/clock.ts) is what run/start/release/advance ask; `POST /api/workflow/clock {to}` walks a jump a day at a time -- the clock, then that morning's sweep with `skipSends` (a due step is recorded `skipped`, a new step state: nothing sent, no fee; its SMS pair is not held); resumes if its four minutes run out. Browser: `lib/clock.ts` (`clockNow` / `clockToday` / `clockNowMs`), read ONCE per page load by AppLayout before any page draws; ~70 files moved off `new Date()` (the real-world ones stay: timers, ids, mail read/sync stamps, reminders, updated_at -- `check-staging-clock` holds the list and their count). Banner on every staging screen; Administrator controls; a jump reloads the page. A statement with a line dated after today is refused (database and browser). `check-business-books`' last-day fixture was red on any SAST machine -- fixed. `check-staging-clock` (75). |

**Fourth session (8 October), on `claude/new-session-ecohkn`** (started from `6c19fed`; the firm's preview of THIS branch is a new Vercel URL):

| Commit | What it is |
|---|---|
| (this) | **The PTC-on-the-next-payover rule is SWITCHED OFF for the Swordfish parallel run** (the firm, 10 Oct, an hour after asking for it: "move it back into the normal run because currently I want to test Raptor against Swordfish. Once we've imported correctly and everything's fine, we'll make that change"). Kept, not deleted: `ptc_on_next_payover()` answers **false**, and `payover_ptc_until(cycle end)` -- the last capture day a run takes a PTC from -- is then the cycle's own end, exactly as before `7093ab9`. `build_payover_run`, `refresh_payover_runs` and `collections_by_payover` all read the switch. **To switch it on:** replace `ptc_on_next_payover()` with `select true` (one migration, mirror it, flip the 'is OFF' assertion in `check-ptc-next-payover`). Probed rolled back: a 15-Oct PTC goes on its own Oct run again. No staging run needed rebuilding (the PTCs claimed under the rule fell on the same runs either way). The Trust overview's PTC wording no longer promises the next payover. `check-ptc-next-payover` (15) holds the switch off; break-tested. |
| `42e51a9` | **The Trust and Business menus stay put while the page scrolls, and fold narrower** (the firm, 10 Oct: "When I scroll down ... that thing disappears. It should stay"; "take a millimeter and a half out of that"). `WorkspaceRail` is `sticky top-0` inside `<main>` (which is what scrolls), as tall as the window under the top bar, so the door and widen button stay at its foot; the layouts' wrapper is `min-h-full`, not `h-full` -- with `h-full` the parent is one screen tall and a sticky child scrolls off with it. Folded width 48 -> 42px. `e2e/workspace-split` (124) scrolls the overview to the bottom and asserts the menu is still at the top; break-tested (-1285px without the fix). |
| `251525f` | **Mark paid from the payover runs list, one or many** (the firm, 10 Oct: "the mark as paid button should ... just immediately show you that pop-up ... Even ... in bulk by selecting all"). `MarkPaidModal.tsx` is shared by the run page and the list: one run asks for its reference and date; several share the date and each keeps its own reference (starting on BF PO-...). The bulk bar gains **Mark paid N** (approved or sent, not below nil). A run below nil reads **Client owes us** instead of offering Mark paid (the function refuses it anyway). Not offered where Trust settings confirm payments out from the statement only. `e2e/payover-sends` (42) covers single and bulk, break-tested. **Next, the firm's own words:** "ultimately, from the bank statement ... allocate a specific payment made to a client ... linking it from the reference number to the payover" -- `reconcile_bank_debit` and the overview's "Match to PO-..." already do this for an unmatched debit; the firm means to show how they want it. |
| `134508b` | **Payment history lives in Payments in, filed by client** (the firm, 10 Oct: "it should live inside the payment in ... under the client. So it's organized, it's filed. And here is just a bunch of list of stuff"). Payments in has two tabs, **To process** (unchanged, the default) and **History** (`?tab=history`): every processed payment in one folder a client (count, into trust, paid to them directly, latest date; the client paid most recently first), a month filter that narrows every folder, the formulas still run over every row and the reversal still on the opened receipt. The rail item is gone (9 targets); `/trust/check` and `/finance/check` redirect to the History tab. `e2e/check-payments` (28) asserts the redirect, the folders and the month filter; `check-workspace-split`, `e2e/workspace-split` updated. |
| `bc00b70` | **The Trust overview splits the bank from the PTCs** (the firm, 10 Oct: "Now you've incorporated PTCs in this, and I don't think that's the right thing to do. We should report on that separately"). Four read-only functions, nothing written to the books: `trust_cash_by_cycle` (the money IN the account by cycle and whose -- a PTC's entry left out; what a PAID payover kept back read as the firm's, because a PTC writes "client owes the trust" and no firm entry, so after set-off the firm's share sat in trust under nobody's name), `ptc_by_run` (owed / set off / short per payover), `ptc_ageing` (what each client still owes after set-off, dated from the payover that first invoiced it, walked back through carried shortfalls), `collections_by_payover` (into trust + paid direct per payover, counted from the payments and from the runs). Overview: "What is in the trust account" (last month's / this month's collections, overpayments, interest and charges -> total accounted for, which no longer goes negative), then **Paid straight to clients (PTCs)**, **What clients owe us, by age** (Not yet invoiced / 0-30 / 31-60 / 61-90 / 90+), **Each payover, checked**. Staging: bank money R16 567.38 = ledger -R10 088.87 + PTCs R26 656.25, to the cent; both payovers agree with their runs. New `check-trust-split` (32); `check-firm-held`, `check-trust-cycles`, `e2e/workspace-split` rewritten to the new rule. **Not built yet:** recording a client's payment of what they owe into the BUSINESS account against the negative run (the firm: "we would have to match it"). |
| `7093ab9` | **A PTC goes on the next payover** -- SWITCHED OFF since, see the row above (the firm, 10 Oct: captured 15 Oct -> invoiced 11 Nov, not 11 Dec). `build_payover_run` claims a PTC up to the day before the run's payover date; a later open run leaves it to an earlier one; an earlier run takes back one a later run took. Trust money unchanged. `client_ledger` names the claiming run. Probed rolled back; `check-ptc-next-payover` (11). |
| `4067795` | **Payover runs: four cards, underlined tabs, search and filter** (the firm's drawing, 10 Oct). The Needs review -> Paid legend and the cycle/cut-off strip went ("I don't know what that ... is"); Ready to approve is a tinted card whose Review runs filters to the ready runs. `payover-sends` asserts the legend gone, the cards, and the search. |
| `878500a` | **The client's ledger is one line a payover** (the firm, 10 Oct: "there's one payover ... a credit or a debit balance", then the invoice as its own line). `clientLedger.ts` `ledgerByPayover` folds payments into the run whose period covers them; payover paid, charges and invoices stand alone; money after the last run is one "not on a payover yet" line. Debit / Credit columns, balance in Dr / Cr, click a payover for the payments and accounts behind it. Account tab moved right of Payovers. Run rows are one height ("Open until" wears the button's box). New `check-client-ledger`. |
| `143978a` | **The remittance advice is drawn in the firm's own design** (the firm, 10 Oct, sending two mock-up PDFs and the coastline photograph: "make the remittance advices look like this"). A4 landscape: a cover with the photograph and the BF lockup (`public/brand/remittance-cover.jpg`, `bf-lockup.jpg`, fetched at draw time; a navy band and a text logo stand in if either fails to load, so an advice never refuses for a picture); "Your collection summary" with three boxes (the net box navy, its label `netLabel` so a run below nil still reads "Amount you owe us" with the figure unsigned), the payover calculation and the payment & invoice panel; then "Collections by us" as a navy-headed zebra table with a TOTAL row, paginated, and pages for payments made to the client directly and for overpayments (no commission). Decisions left to the firm: the OUTSTANDING column was kept from the old advice, the per-line VAT sentence of the mock-up was left out, reversal rows keep their own signs. `check-remittance-advice` 75/75 unchanged. |
| `eac10ea` | **Every long list in the app is thin, like Trust -> Payment history** (the firm, 10 Oct, the third time of asking: "wherever in this whole app there are a lot of things listed under each other ... it should look like the checking list"). One line a row at 12.5px, py-1.5, normal-case headings, nothing wrapping, second lines inline or in their own column, money tabular and no-wrap: the accounts book and every list on the account page (statement, ledger, timeline, emails, judgments, directors, documents, other accounts), the diary, disputes (list and compact kanban cards), leads, deals (table and compact cards), contacts, clients and every list on the client page, tasks, activities, the calendar's day list, reports (six tables), the mail inbox list, library templates and workflows, settings (users, teams, targets, pipelines, fields), the dashboards' tables. Full `npm run qa` green (298 files) after `e2e/performance` read the grade inline. |
| `—` | **An email too big to cache is read from the mailbox, as written** (the firm, 10 Oct: a ChatGPT-pasted reply in a long thread showed flat -- no bold, no paragraphs -- in Raptor and fine in Spark). The body cache kept the plain text when the HTML passed 200 000 characters, and every later open showed that. `HTML_LIMIT` is now 1 000 000, and markup over it now keeps no words either, so the reader goes to the mailbox. **Staging: cleared the cached body of 456 messages that had text and no HTML** (each is re-read from the mailbox once). Production needs the same one-off clear when this ships. `check-mail-body-cache` +2. |
| `—` | **A run below nil says the client owes us** (the firm, 10 Oct, of an advice reading "Net amount we are paying you -R 14 162.50"). Advice PDF and email: "Amount you owe us R 14 162.50 -- nothing is paid to you this period; it comes off your next payover, or pay us with reference BF PO-..." (`headline.clientOwes/netLabel`); run page "Client owes us" in red, no Mark paid; queue "owes us R x". `payments_to_make` leaves out runs at or below nil and `mark_payover_run_paid` refuses one below nil (it is carried into the next run whether marked or not; marking it would write a payment out that never happened). `check-remittance-advice` +8, `check-payments-out` updated. |
| `—` | **The rest of the money lists thin too** (the firm, 10 Oct: "make all of the rest of the stuff look like narrow little lines"). Every table on Back office, Trust settings, Business Expenses / Income / Drawings, the client's account panel, the Approval queue's and Needs an account's tables, and the Trust overview's Collections by period (one line a period) -- 12.5px, no wrapping, stacked second lines moved beside the first or into a tooltip; the overview's owner rows tightened. |
| `—` | **An expense is typed as the amount on the slip, VAT included** (the firm, 10 Oct: "the VAT should automatically charge fifteen percent ... if you want to remove it, you should be able to"). Record an expense: "Amount paid" + "Includes 15% VAT" (ticked by default, firm's rate); `splitExpense` works the VAT out to the cent and the parts always add back. Supplier stays optional, with a note that SARS wants the tax invoice for a VAT claim. `check-business-books` +4, `e2e/business-income` +3. |
| `—` | **Back goes where you came from** (the firm, 10 Oct: from Kagiso Mokoena's account to the client, "go back to Kagiso", not all clients). `src/lib/backLink.ts`: AppLayout notes each page (`notePage`), a record page names itself (`useRecordName`), `useBackLink(fallback)` offers the page it was opened from ("Back to Kagiso Mokoena") or its list when opened directly. On the account, client and payover run pages. `e2e/debtor-details` +3. |
| `—` | **An early approval says who** (the firm, 10 Oct). The run page reads "Approved before the cycle closed by <name> on <date>: <reason>" from `payover_runs.early_by` (embed `early:profiles!payover_runs_early_by_fkey(name)`). Also `docs/FINANCE-TESTING.md`: the brief for the session testing the money side. `e2e/payover-sends` 31. |
| `09da362` | **Reversals: where the money goes, the in-between state named, and a paid-over split taken back** (the firm, 10 Oct, of a reversed R800 back in the queue: "is that now unaccounted for? ... wrong reference ... already paid over"). (1) **FOUND AND FIXED:** reversing a payment already on an approved/sent/paid run marked its allocation reversed (and the next run carried a negative line) but wrote NOTHING on the trust ledger -- the client stayed square, and approving the copy again credited and paid the client twice. `reverse_payment_allocation` now writes the opposite of every entry of an invoiced allocation ("Payment reversed: ..."). Probed, rolled back: PO-KFH-2610 paid, R5 550 reversed -> client -2 416.29, firm -3 133.71; copy approved -> both back; next run nets reversal + new split to R0.00. (2) New `reverse_payment_to_unplaced(payment, reason)`: reverse, then reject the copy with its line released, so the statement line is back on Needs an account (statement receipts only); `protect_bank_statement_line` now also lets a REVERSED payment's line be cleared when no live payment holds it (it was refused -- probed: the line came back unplaced but could not be placed again). Reverse box asks "Where does the money go?" -- back to the approval queue, or back to Needs an account. (3) New `trust_awaiting_approval()`: placed trust statement lines whose payment is not approved/reversed/rejected; the Trust overview shows **Waiting for approval** under Not accounted for, out of the bank/ledger difference (`trustHeadline.awaiting/otherGap`). Revoke list restated. `check-reversal-returns` +9 (break-tested), `check-reject-payment`, `check-trust-opening` updated. |
| `38fa8ca` | **Payover runs in three tabs; Check is now Payment history** (the firm, 10 Oct, drawing it: "working, closed, paid ... history"; "the check for me should really take place before it's approved ... all of the payments that has already been processed should live somewhere ... history"). Queue tabs: Running (open cycle) / Closed · to pay (incl. overdue, red) / Paid; opens on Closed, or Running when nothing is closed. Trust rail "Check" -> **Payment history** (same page and address `/trust/check`, every processed payment, formulas still run, Reverse from the opened one). e2e payover-sends 30, workspace-split updated. |
| `2e67ec1` | **Long trust lists are thin lines, like Trust -> Check** (the firm, 10 Oct: "I like the way the check is done ... thin little lines ... make the lists look like the check"). One line a row, 12.5px, no wrapping, sideways scroll inside the card: the run's payments (RunDetail: Paid / Account / Debtor / Your ref / Note / figures), the payover queue (Client / Run / Payments / ...), Payments to make and Paid (bank details on one line), Trust ledger and its entries, Exceptions (`data-testid=exception-row`), the client's Payovers tab (a table; every advice copy on its run's line). e2e updated: excess-credit, payover-sends. |
| `112f368` | **Payover runs: a clear band per cycle** (the firm, 10 Oct: "is there a clear distinction ... closed and pending payment ... this month is running"). `groupRunsByCycle` (payoverGroups.ts) now returns Overdue / Closed / Running / Paid with a one-line `state` ("Nothing more goes in · check, approve and pay on 11 Oct", "Still collecting · closes at midnight on 10 Oct · paid out 11 Nov") and `paysOn` from `payover_lag_months`; working groups oldest first (the one paid soonest on top, as on the Trust overview), paid newest first. Each group is a coloured band (red / gold / grey / green). `check-payover-groups` 14, `e2e/payover-sends` 29. |
| `9a604ff` | **The trust account's interest and charges, reconciled on the Business overview** (the firm, 10 Oct: "the trust is not a place of expenses. There's interest, yes, but the interest is due to the company ... you can't pay expenses out of the trust"). New `trust_bank_costs(from, to)` (business.view): interest, bank charges, repayments from the business account, for the period and to date, and the firm's balance in trust. `business_month.made` now subtracts the period's bank charges (were in neither earned nor spent; staging Made was R115 too high). Business overview: "Trust account bank charges" under Spent, and a card "Trust account: interest and charges" -- interest (the firm's), charges (the firm's cost), interest less charges, and **"Bredell Ferreira owes the trust R x -- pay it back from the business account"** when the firm's share in trust goes below nothing (`trustBankCostsState`). The firm thinks the bank recovers charges from the BUSINESS account itself; if so they never reach the trust statement and the card shows none. `check-business-income` +10, `e2e/business-income` +6 (and its Drawings figure now waits for its value -- it raced). |
| `54539be` | **Back office: no client-by-client table** (the firm, 10 Oct: "overcomplicates things ... should be really addressed in the trust section"). The firm's figures as a whole; the client picker still scopes them to one client. `check-business-income` +2. |
| `54ddef1` | **The client record's Payovers tab is the last tab** (the firm, 10 Oct). `check-payover-sends` holds the order. |
| `555cd30` | **Payover runs: one line a client** (the firm, 10 Oct: "exceptionally bulky"). The client cell no longer repeats the period the group heading carries (kept on the Paid tab only), the Exceptions column is gone (the "Fix N exceptions" button says it), headings shortened (Collected / PTC set-off / To pay) and kept on one line, "Open until <date>" without the sentence (it is the tooltip). `e2e/payover-sends` green. |
| `c0c26f6` | **The trust account has an opening balance, and the Trust overview reads from the money** (the firm, 10 Oct: "the trust balance should be the main thing ... this is how much is in the trust. This has been accounted for. This has not been accounted for"; they had read "Bank balance" as the BUSINESS account). `firm_settings.trust_opening_balance` / `trust_opening_date` (both or neither); `trust_position` cash = opening + trust statement lines AFTER that day (none captured = every line, as before). Set only by `set_trust_opening_balance(amount, day, reason)` -- Administrator + finance.view, not in the future, reason >= 10 chars, logged in `finance_setting_changes`; `protect_trust_opening` reverts any other write (a stale Firm details save cannot put an old one back). Trust settings card "Trust account opening balance" (Capture / Change). Overview band: **In the trust account / Accounted for / Not accounted for**; ownership list = owners → Total accounted for → Not accounted for (unallocated receipts, bank/ledger gap, any unexplained residual) → In the trust account; the reconciliation reads bank − accounted = not accounted, and says "capture the opening balance" while none is set. **Unallocated receipts moved from accounted to NOT accounted.** `trustHeadline` (trustBalance.ts). Probed on staging, rolled back: R15 021.04 at 7 Oct → difference R0.00, the three refusals, the revert. Reconciliation panel is a white card with a coloured top rule and a state pill, not a pink/green wash (the firm: "a weird pink thing"). New `check-trust-opening` (37); `check-trust-cycles`, `check-firm-held`, `check-client-account`, `e2e/workspace-split` updated; full `npm run qa` green apart from those two before the fix, both re-run green. **Staging's opening balance is NOT set** -- capture it from Trust settings (for the test data: R15 021.04 at the end of 7 Oct). |
| `432ed0e` | **Files inside attached emails are listed too, and the cap is 60 not 10** (the firm, 9 Oct: Outlook showed 18 on "Email trails", Raptor 8 -- the other ten were inside the 8 attached emails). `attachmentTree` (api/_lib/attachmentTree.ts, mailparser only) walks two levels in; a nested file is listed as "<email> › <file>" (`NESTED_SEPARATOR`, held equal in src/lib/attachmentKind.ts), drawn as its own name with a turn-down arrow, and saved under its own name (`contentDisposition`, RFC 6266 filename* so a dash or accent cannot break the header). Sync and download share the walk. **A message synced before this repairs itself on its first download**: the fallback parse returns the fresh list and the route writes it back (user_emails, account_emails or activities). Ticket filing stores the leaf name. `check-mime-parts` +9 (incl. a real nested message), `e2e/mail` +1. |
| `0d0a924` | **Attachments say what they are** (the firm, 9 Oct: "attachment-1 … 8 ... doesn't show me if it's a PDF or an email"). `attachmentNamesOf` (api/_lib/mime.ts), used by the sync AND the download so they agree: a real filename is kept; an attached email (message/rfc822, no filename) is named by its own Subject as .eml (encoded words decoded, folded lines joined, duplicates get " (2)"); anything else unnamed is attachment-N plus its type's extension. Every chip (Mail, account Emails, activity row) carries a kind label (`attachmentKind`: PDF, Email, Word, Excel, Image, Invite…). **Messages synced before this keep their stored bare attachment-N** (no label rather than a guess); downloading still saves them with the right extension. `check-mime-parts` +11, `e2e/mail` +2. |
| `533b46b` | **Reversing an un-invoiced payment works** (was FOUND NOT FIXED). The FK `trust_creditor_entries.allocation_id` is gone (the column stays as a record); `reallocate_account` writes an equal and opposite trust entry ("Payment reversed: " / "Re-split: ") for every entry of the allocations it is about to remove, then removes and replays. Ledger stays append-only. Probed: R500 approved then reversed, trust back to R33 121.04, rolled back. **Known edge:** a parked overpayment the firm had TAKEN, on a payment that is re-split, returns to the debtor. Also: the Trust overview offers **"Book as a bank charge"** (not "Find its run") on a charge debit (`unexplainedDebitAction`), linking to Exceptions where `allocate_bank_line` already books it against the firm. `check-reversal-returns` +4, `check-finance-engine` updated, `check-bank-line-allocation` +4, `e2e/workspace-split` updated. |
| `15d2f2a` | **Approve before the cut-off, with a reason** (the firm: a large PTC where the client owes BF and the advice is needed now -- "there should be a good reason"). New `approve_payover_run_early(run, reason)` (reason >= 10 chars; `payover_runs.early_reason/early_by/early_at`), then the ordinary approval. `approve_payover_run` refuses an open cycle without that reason -- **the staging exemption is gone**, staging approves early the same way. **Money processed after an early approval rides the next cycle's run**: `build_payover_run` also claims an unclaimed allocation whose own cycle's run for that client is approved/sent/paid, and `refresh_payover_runs` looks for it (probed: PO-KFH-2611 claimed it, rolled back). Run page: "Approve early…" asks why and says where later payments go; the reason shows on the run. Also: **the one-cent "Commission is the rate" warning (RAP-124119) was the check, not the engine** -- 463.50 × 15% = 69.525, Postgres rounds to 69.53, the browser's float made it 69.52; `cents()` in allocationRules rounds half up (`3f05eab`). |
| `4f90f61` | **Payover runs build themselves, and are worked in bulk** (the firm: "I don't even have to say go and build a run ... it's basically automatically already built. And updated when necessary"; bulk approve / email advice). New `refresh_payover_runs()` builds or rebuilds, for the open cycle and the last, every client with unclaimed processed money and every run still open; never an approved/sent/paid/voided one. The queue calls it on opening; **Build a run is gone** (staging keeps "Build for another cycle"). Rows have tick boxes and a bulk bar (Approve N for ready runs whose cycle has closed, Email advice N for approved ones via `sendAdviceForRuns`, each stored and recorded like a single send; no client email = skipped and named). **`approve_payover_run` now refuses a run whose cycle has not ended, except on staging** -- a payment processed later in that cycle would otherwise never be paid over; the queue says "Open until <date>". One run → one advice now lives in `adviceFromRun` (run page and bulk send share it). Probed on staging: after a reset, refresh rebuilt Karoo Fleet's run (ready, R3 031.31, 5 lines), rolled back. `check-payover-build` +7, `check-remittance-advice` +1, `check-finance-is-administrator-only` (revoke list restated), `e2e/payover-sends` +8. |
| `a5970f1` / `7012163` | **Approval queue headings: incl. VAT once on the group** (Interest and fees, Final split), columns shortened. `e2e/payments-in` +2. |
| `8389fb5` | **Check happens before approval** (the firm: "the check should happen before the payment is done"). The queue always ran Check's formulas but only marked rows; Approve all posted them anyway. `splitForBatch` (`paymentsQueue.ts`): a row breaking a formula is held out of both batch buttons (labels and the confirm say how many), and is approved alone from its breakdown once "I have checked these figures" is ticked. Held, not refused. `check-payments-queue` +3, `e2e/payments-in` +5. |
| `4ab3370` | **Payover runs read in cycles** (the firm: "this month to process / previous month pending"). `groupRunsByCycle` (`payoverGroups.ts`) groups the queue relative to the open cycle: the cycle that ended the day before it opened is "This month to process", older and unpaid is "Earlier, still pending", one built inside the open cycle is "Built early"; Paid groups by cycle. Each heading has its period, client count and total. `check-payover-groups` (10), `e2e/payover-sends` +3. |
| `22b6902` | **Trust ledger: the firm is ONE row, and every balance opens to its entries** (the firm: "what is this? ... for which payover runs"). `trust_balances` grouped the firm per account (39 rows on staging); now one (R24 055.36, 42 entries). New `trust_entries(party, who)`: date, reason, account, payover run, statement date, running balance (window in SQL; latest 500 carry the earlier total). Each ledger row has a chevron. `check-firm-held` +4, `e2e/workspace-split` +7. |
| `89a069a` | **Client record → Payovers tab** (the firm: "which clients were paid what ... save in the client folder ... the PDFs"). Every run for the client, newest first, with its stage (`clientPayovers.ts`: a run marked paid by hand is "Paid, waiting for the statement", only a statement line makes it "on the statement"), the reference paid with, and under it every advice actually sent with its stored PDF and schedule. Paid out / still to pay totals. Trust-gated like Account. `check-payover-sends` +5, `e2e/payover-sends` +7. |
| `971bbe2` | **Every payover advice sent is kept as it went** (the firm: "whatever is paid and what has been sent to a client should always stick there ... you can revise one and then send it again"). New table `payover_run_sends` (select policy only; trigger `payover_run_sends_frozen` refuses update and removal even for the owner) and private bucket `payover-advice` (read and insert policies only, uploads with upsert off). `sendRemittanceAdvice` now: store PDF + xlsx → email → `record_payover_send` (whole advice as jsonb, next version) → mark sent only if approved. Sent and paid runs get **Send again** (a new version beside the old). The run page lists every copy ("Sent to the client"). **Staging's three PO-*-2610 runs were sent before this and have no copy** -- the screen says so. Probed on staging, rolled back. `check-payover-sends` (21), `e2e/payover-sends`. |
| `471cc50` | **The go-live switch: payments out from the bank statement only** -- see §5. `payouts_statement_only` in all five firm-settings lists; Trust settings card "How a payment out is settled" (logged); both mark-paid functions refuse while it is on (proved on staging, rolled back). `check-payments-out` +9, `e2e/payments-out` 26. |
| `558ecfa` | **Payments to make: To pay and Paid, completed from two places, confirmed by the statement** (the firm: "a queue for ... what should go out, and what has gone out", completed from Payments to make or the payover run). Every row has **Mark paid** (run: `mark_payover_run_paid`; refund: new `mark_refund_paid`), prefilled with its reference. The firm's own share is a card on To pay ("Bredell Ferreira (business account)", what may be drawn, reference `BF FEES-yymm`) with **Record a transfer** (`draw_from_trust`, both ticks). **Paid** (`payments_out_paid`) lists runs, refunds and transfers, each "Waiting for the statement" or "On the statement <date>". A run or refund marked paid by hand stays matchable to its debit (`reconcile_bank_debit` takes a paid run with no line yet; `allocate_bank_line` ties a paid refund's line without paying it twice; candidates say "(marked paid)") -- before this a run marked paid could never be matched. Probed on staging, rolled back. `check-payments-out` +19, `check-bank-import` updated, `e2e/payments-out` 23. |
| `ec858bc` | **Two trust-overview faults the firm's screenshots showed (8 Oct).** (1) **Trust ledger page: "invalid input syntax for type uuid: debtor".** `trust_creditors_on_run` wrote a released overpayment's debtor side as ONE entry with no account -- the debtor's credit stood on their account with a nameless minus beside it, and `trust_balances` could not cast the nameless one. Now per released allocation, with its account; `trust_balances` compares as text. Staging's one bad entry (PO-BPM-2610, RAP-124019, R490.42) corrected by an append-only pair netting to nil (by hand; NOT in schema.sql). (2) **"Unexplained difference R321.88"** was the overview subtracting a client in debit twice (`owedToClients` is already net); the Clients line now shows what is owed TO clients and the total reconciles to the ledger, nil on staging's figures. `check-firm-held` +8, `check-trust-cycles` updated; `e2e/workspace-split` now waits for a ledger row, not the heading the rail also carries (it raced). |
| `47a9fc6` | **Overpayments kept: their own line on the Trust overview** (the firm: "under the suspense account ... just to say overpayments kept"). `overpayments_kept()` = parked, not reversed, not taken by the firm (a credit given back counts again); the overview draws it under Unallocated receipts and takes it out of the Debtors line, so "Total accounted for" does not move. Staging: R490.42 kept of the debtors' R980.84 (the rest is Sizwe Dlamini's refund still due). `check-firm-held` +8, `e2e/workspace-split` +3. |
| `7083ef6` | **Payments to make, each with its reference.** Reference = `'BF ' + run number` (BF PO-LVM-2610) or `'BF ' + case number` for a refund (BF RAP-124059), in `payment_out_reference` (SQL) and `paymentReference` (TS), held together by `check-payments-out`. `payments_to_make()` lists approved/sent runs (due the 11th, lag after the cycle) and refunds not paid/cancelled; Trust → **Payments to make** (new rail item, 7 now) totals them and copies a reference. A payment leaves the list only when its statement debit is allocated to it. `bank_allocation_candidates` returns the reference (dropped/recreated), and a debit carrying a reference AND the exact amount is suggested even when two payments are the same amount. The run page and the client's advice say which reference it is paid on; Mark paid starts from it. Fixed on the way: the top bar on that page said "Payments in". |
| `c31af26` | **"Move to another account" moves the money.** It used to note the target and do nothing. Now: a negative debtor entry takes the credit off the first account, and an approved `account_payments` row (source `'moved'`, `moved_from_allocation_id`) on the second is split there by the engine. **No second receipt fee** (the firm's ruling, 8 Oct). Not counted twice: `collector_performance`, `collector_daily`, `payments_in_month`, `client_book_totals` leave `'moved'` out (`account_settlement` keeps it). `reverse_payment` refuses a payment whose overpayment moved. Probed: R769.35 moved, trust total unchanged, fee nil. `check-moved-overpayment` (17). |
| `97531c1` | **A released overpayment and a set-off charge each get a line** on the run page and the client's advice (PDF section "Overpayments paid over to you in full — no commission", .xlsx, workings). Both were already in `net_payover` and on no line, so the advice did not add up (Baobab: lines R9 209.11 vs R9 699.53 paid). `payover_run_payments` returns `excess_disposal` (dropped/recreated). `check-remittance-advice` +8. |
| `7f45fcb` | **An overpayment can be decided, and once decided it leaves Exceptions** (the firm, 8 Oct: "I don't know how to fix anything ... there's no option"). `finance_exceptions` only ever left out `with_client`, so a refund/move/release/park stayed listed with "Decide it" (staging: RAP-124059 had been refunded and was still there) while `payover_run_blockers` had already let the run go. Now `excess_disposal IS NULL`, the blocker's own rule. And "move it to another of their accounts" asked for "the account's id"; it now lists the debtor's other OPEN accounts by identity number (`fetchMoveTargets`), or says there are none. All three disposals proved on staging in a rolled-back probe. `check-payments-queue` 78, new `e2e/excess-credit` (10). |
| `cc308ea` | **An imported account goes to its Swordfish clerk; unknown clerks are flagged; money no desk held is the firm's** (the firm, 8 Oct). The import matches "Assigned To" to an ACTIVE user on the whole name (`clerkKey`: case and spaces ignored, never a first name alone) and sets `assigned_to` and the diary owner; unknown and inactive names are PROBLEMS counted per name ("3 accounts are with 2 Swordfish clerks who are not a Raptor user: ..."), people on actions who are not users a note, their history kept under their name. `record_account_desk_change` dates an imported account WITH a clerk from its handover date (SAST), so the month's receipts are theirs. `collector_performance` gains one no-user row of money no desk held; `splitUncredited` keeps it out of every person and `useCollectionsMonth` adds it to the FIRM's figures only (not a team's), and the hero says "Includes R x not on anybody's desk". `check-import-clerks` (36), `e2e/performance` (102). |
| `c904e61` | **"Current month", not "Current Sales Month"** (the firm: "it's not a sales month ... just current month"). Every option in `SalesMonthPicker` and `PeriodFilter`, the arrows' names, a span's label ("Last 3 months") and the Communications export. The period is unchanged (11th to 10th). The sales dashboard's own "Last Six Sales Months" card is about sales and stays. `check-company-dashboard` holds it. |
| `6e78ea3` | **Folded, the widen button stays at the bottom** (the firm: "the narrow option is at the bottom, but then it moves to the top. Keep it at the bottom"). It now sits under the door, where Narrow is on the open menu; the workspace's name stays on top as a plain label. `check-workspace-split` and `e2e/workspace-split` hold the position; the old layout fails both. |
| `0f3fd73` | **The firm's answers of 8 Oct, built.** (1) **The Swordfish cut-off default is a month earlier**: "import today [8 Oct] ... all payments recovered up until the 10th of August have been paid out. Money collected from 11 August until 10 September will be paid out on 11 October." A CLOSED cycle is not a PAID one; `settledThroughDefault(today, lagMonths = 1)` now answers 10 Aug for 8 Oct (it said 10 Sep, which would have marked a month as remitted and never paid it), and 10 Sep from the payover day (11th) on. (2) **Bank interest is the firm's interest income** ("the regulator said that we can take it"): `business_income` gains a `bank_interest` column (dropped and recreated -- return type widened -- then revoked again), Income shows "Bank interest on the trust account". (3) **"BF funds held: Commission + Fees + VAT"** is drawn on the trust overview, from the new **`firm_held_parts()`** (finance.view, HAVING so a refusal is no row): what the firm's share earned part by part, less bank charges and drawings as their own lines -- adds up to `owed_to_firm` by construction; staging 24 055.36 both ways. Display only, ledger unchanged. (4) **R502 stays**, recorded in `check-fees`. New `check-firm-held` (33); `check-payment-dates`, `check-business-income`, `check-bank-line-allocation`, `e2e/business-income`, `e2e/workspace-split` updated, each break-tested. |
| `efc059b` | **The folded Trust/Business menu is narrower** (the firm: "still quite big ... a little bit smaller"). Rail 56 → 48px, and the gap after it is now the rail's own margin — 12px folded, 24 open — so the page starts 60px from the rail's edge instead of 80. `e2e/workspace-split` holds both (rail ≤ 48, page ≤ 64 from it); the old layout fails it. |

**Third session (7 October):**

| Commit | What it is |
|---|---|
| (this) | **A debtor who overpays the CLIENT directly is the client's to sort out** (the firm, 7 Oct). The split is unchanged and the excess still recorded (the payment must add back), but `allocate_payment` now sets `excess_disposal = 'with_client'` on a PTC overpayment, so it no longer holds the client's payover run on needs_review, is no longer listed under Exceptions, can no longer be refunded/moved/released (released would have paid the client money it already had), and the screens say "overpaid to the client, theirs to sort out". Also closed: **`finance_exceptions` was readable by anon** (a view runs as its owner); revoked from anon and authenticated, its only reader is the Administrator-guarded `finance_exception_jobs`. Proved on staging in a rolled-back PTC of capital + R5 000. `check-payments-queue` 68 → 77. |
| `6ea667f` | **Payments in, laid out like the firm's own mock-up** (7 Oct, "This looks much better. Do something like this."): Record payment (gold) and Import bank statement (outline) on one line with the date; the four figures in ONE card — Waiting for approval, Processed into trust, Paid to clients · PTC, Needs an account (amber when not empty); the last statement folded into a line (`LatestStatement`, "Latest statement · 44 lines · 1 receipt needs an account"); an **Approval queue** heading with "N pending" above its card, empty or not, and a tick-mark empty state; suspense renamed **Needs an account** with a gold top rule and "N to resolve". `BankImportCard` gained a `compact` mode; the full card shares its preview and outcome. The batch summary uses the same hairline grid. |
| `51afe97` | **Payments in, redesigned — processing only.** Top: *Record a payment* beside *Choose a statement*; four tiles (pending processing, processed in trust, paid directly to client, unmatched/suspense — the two "processed" ones this month, summed by the new **`payments_in_month`** behind finance.view); the queue; **suspense below it**. **The list of every payment is gone** ("Payments in is only for processing current payments") — and **Reverse moved to Check** (opened receipt, `payment.reverse`), because that list was the only place in the app that could reverse a payment. The queue is a line a payment (≈48px, 100 a page), tick box and debtor **pinned with an opaque background** (`--color-card-solid`, defined on glass), money scrolling sideways in six groups; badges (credit, capital paid off — never "settled", PTC, came back, in duplum, needs rate, before handover, allocation mismatch, PTC figure mismatch); a **"Projected on approval"** batch summary with three reconciliations and a by-client breakdown; a **breakdown drawer** (the four-figure fee arithmetic moved here from the column headings, still `FeeSections`' definitions); **Approve all asks first** and names its scope. **The one correction: a PTC's "Due to BF" now shows interest + costs + commission + VAT on commission** — the ledger's figure; `allocate_payment` still writes `due_to_bf` without the VAT and is unchanged (display only, the firm's ruling). Found by the browser check: a partial approval's "2 approved, 1 could not be" was wiped by the reload it triggered — fixed. `paymentsQueue.ts` (pure); `check-payments-queue` (68, the firm's Nandi/Lowveld/PTC examples to the cent), `e2e/payments-in` (32, at iPad width). |
| `d936038` | **Ocean: a fifth skin**, off the firm's two photographs — the wing over open water is the band, the open sea under a broken sky is the company dashboard and sign-in photograph, the waves are the sidebar texture. Deep-water navy, sea-spray greys, and the pale champagne of the light on the water as the accent; sea green and coral for good and bad. Its own saying, at the firm's instruction: **"Depth changes / perspective."** The desert keeps "Our world doesn't end at the horizon." Token-only, like the desert; `check-themes` holds its registration and images. |
| `493a99b` | **Prompt 12 — every trust statement line is allocated, in and out.** `allocate_bank_line` (finance.view) says what a line was and writes the ledger entry behind it, tied by `bank_line_id`. Money out can be a payover (exact run match), a refund (settles `trust_payments_out`, which nothing could do before), a transfer to the business (links a recorded drawing or writes one), a **bank charge (a negative FIRM entry = the business owing the trust)**, or other (reason required, on `unidentified`). Money in can be bank interest (credited to the firm), from the business account, or other; a debtor's payment is still *placed*. Debits now arrive `unallocated`, not `excluded`. An allocation is frozen once made. **Trust → Exceptions** lists every line not yet allocated, with suggestions a person confirms. `firm_entry_kind` learns `bank_charge` / `transfer_in`, both kept out of earned and Income. `check-bank-line-allocation` (51), `e2e/bank-line-allocation` (12). |
| `5b96a13` | **Prompt 11 — the date of default is not the handover date.** `handover_date` / `opening_as_at` / `interest_from` = the day the batch is approved (SAST, `firmToday`); the sheet's date of default goes to the new **`debtor_accounts.default_date`**, a record nothing accrues from. Add debtor hands over today and asks for an optional date of default. The account page shows both; the runner's `{{handover_date}}` reads `handover_date`. Engines unchanged (both already start at `handover_date`). Swordfish untouched. `check-handover-date` (21). |
| `04f49b5` | **Prompt 10 — a Swordfish client needs no mandate date for a handover.** `needsMandate()` in the browser and, new, a database trigger on the batch row (`handovers_need_a_mandate` → `client_needs_mandate`): `import_batch_id` set ⇒ exempt; a Raptor client still needs the date. The Mandate card says "Brought across from Swordfish: no mandate needed for handovers". The three functions that read `mandate_signed_at` for COMMISSION are untouched. `check-mandate-rule` (21). |
| `a27f451` | **A client's email filed by hand reaches the client's record too.** `fileOnAccount` reads back the `correspondent` the database decided and, for the client, writes the same email activity the sync writes — both now build it through `clientMailActivity`. Fee unchanged and still raised first. `check-client-correspondence` 37 → 45. |
| `8c93007` | **Business → Income and Drawings, and each rand counted once.** Drawings: what the firm holds in trust (the most it may draw), the month's drawings, and the button — `draw_from_trust` now needs **finance.view AND business.view** (the firm's ruling). Income: a calendar month client by client — commission, VAT on commission, Annexure B fees and costs, interest, charges to clients, unclaimed credit, other — **exact**, because a receipt's ledger entry IS its allocation's four parts (`business_income`). Behind **`business.income`, which no role has, not even the Administrator** ("not even for an administrator"); `NO_ROLE_CAPABILITIES` keeps it out of every template and `all_capabilities()` keeps it grantable. **Fixed a double count:** `business_month` counted a charge set off against a payover in `earned` AND `invoiced`, and called a parked credit given back a drawing; `firm_entry_kind()` is now the one classifier. `check-business-income` (54), `e2e/business-income` (15). |
| `8fc692a` | **The settlement store (task #69).** `account_settlements`: proposed → approved (by the client, recorded with evidence and an expiry) → paid / declined / withdrawn; **lapsed is derived**, never stored. Anybody may put an offer up; **`settlement.approve`** (new: client liaisons + Administrator, the firm's ruling) records the client's yes; **a person** closes a paid one (`close_as_settled` → `settle_account('settled')`), refused on a part payment. `{{settlement_amount}}`, `{{settlement_expiry}}`, `{{settlement_saving}}` exist and answer **only** off an approved, unlapsed offer (`isQuotable`, in `accountMergeValues`, for the page and the runner alike); the settlement call script now pops. Settlement panel on the account, under the promise. `check-settlement` (58), `e2e/settlement` (23). |
| `02d554b` | **The Swordfish import has a Stop button.** Honoured between chunks; a stopped run is taken back out by `discard_import_batch` exactly like a failed one; not offered during the wipe. `e2e/swordfish-import` 31. |

**Second session (6 October, later):**

| Commit | What it is |
|---|---|
| `8c6743a` | **A sliding scale can be seen, set, and prices each account once.** The band rule is settled: ONE rate per account, from the band its capital handed over falls in, decided at handover, boundary rand in the lower band (mandates, model §3a, `rateForCapital`). The engine had been reading the client's bands marginally on cumulative capital; `account_commission_rate` (account's own → band on capital → flat) is now what `allocate_payment`, `preview_allocation`, `expected_from_promises` and `payments_awaiting_approval` charge. `companies.commission_tiers` holds the register's prefix/rate pairs (written by the import from now on) and `commission_bands_dated` the mandate date. **One dialog** (`CommissionModal`, saved by `saveCommission`) opened from Trust settings and the client page's Commission card (Edit, behind `finance.view`); a flat rate over a scale must be ticked to confirm. Trust settings shows "Sliding scale" with bands, or amber **"Scale, boundaries missing"** with the tiers. Account page and payment detail say the rate **and where it came from** ("21% — as billed in Swordfish (KIS tier)"). A handover — and a single account added by hand — is priced on each account's own capital and **refused** for a client on tiers with no boundaries (`handoverRateBlock`, checked in `approveDraft` before any write). The trigger `companies_commission_expected` moves `commission_rate_expected` (never `commission_rate`) when a client's rule changes, so "off their mandate rate" counts accounts off the CURRENT rule. `check-commission-rule` (42), `e2e/commission-scale` (25). |
| `089a604` | **A client's commission can be a sliding scale from Trust settings** (the firm: "Here I can't choose a sliding scale"). The tier editor was lifted out of Add client into `CommissionScaleEditor` and `src/lib/commissionTiers.ts`, so both screens share it. Superseded in part by `8c6743a`, which moved the dialog into `CommissionModal`. |
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

S8: **Held for Swordfish payovers** (§3a item 2, designed in §2 S8). The bank file waits on FNB's import
specification -- the user does not have it yet and will ask the bank.

The four that stood here at the start of the fifth session were answered by the user on 10 Oct:
1 (client pays into the business account) and 2 (match payovers by reference) are BUILT (§2); 4
(remittance advice) is BUILT with a default VAT wording (§2, `bae366e`); 3 stays as it is:

1. **Switch the PTC rule on after the Swordfish parallel run** -- only when the user says so ("The
   third one we'll keep").
2. **The VAT sentence's exact wording** -- confirm with the firm or paste the mock-up's sentence
   (`vatLine`).
3. **The bank's bulk-payment template** for Payments out (S7). The CSV is generic; asked the user
   which bank and format (assumed FNB). When it arrives, change `bankFileCsv` only -- `whatIsMissing`
   / `canPay` already decide what goes in.
4. **Press "Confirm, it came back unpaid" on staging's SBB/2003 R1 000** (Trust -> To sort) -- left
   for the user on purpose so they see the bounce flow end to end.
5. **Profit graphs, history.** They draw what the ledger holds; production has no receipts and
   staging four months. Whether imported Swordfish history should feed them is the firm's call
   (CLAUDE.md: imported history is frozen -- reading it is fine, recalculating it is not).

**Explained to the firm, no change asked for** (so a new session does not "fix" them):
- **The interest lines on an imported account** were confusing because of how Swordfish
  calculated and showed interest, not because Raptor got it wrong (the firm: "The problem is not
  you"). Imported figures stay as imported (CLAUDE.md).
- **Going back from a handed-out batch** to the "ready to import" state: the existing **Discard**
  on the handover import already does it while nothing on the batch has been worked; the firm
  understood it once explained.

---

## 3a. THE GO-LIVE PLAN FOR THE MONEY (agreed with the user, 10 Oct)

- **Clean break.** Everything up to the cut-over stays Swordfish's: receipts dated on or before it
  are Swordfish's to pay over (Camille keeps running those runs from Swordfish); Raptor splits only
  receipts from the day after. The book (accounts, balances, history) still imports, frozen as is.
- **Cut-over: end of 10 December 2026** (fallback: end of 10 January). Swordfish pays 11 Dec and
  11 Jan; Raptor's first payover is **11 Feb** -- two months of live running before money goes out
  on Raptor's figures.
- **Parallel run: the 11 Oct - 10 Nov cycle.** Camille works it in Swordfish; the same Swordfish
  export, trust statement and her Excel go into STAGING; Raptor's 11 Dec payover per client is
  compared with what she pays. Go / no-go about 1 Dec: every client agrees or the difference is
  explained, the Trust overview balances, brought-forward balances match her sheet, Camille has
  done the cycle herself. Then time with Camille in the week after 11 Dec.
- **To build before mid-November** (not started):
  1. import option "clean break: every receipt up to the cut-over is Swordfish's" (today's default
     brings Swordfish's received-not-paid-over receipts INTO the ledger -- the R15 943.54);
  2. a ring-fenced trust bucket "Held for Swordfish payovers", set once at cut-over (from the bank
     opening balance; Swordfish cannot report what it owes per client -- "Swordfish can do
     nothing"), its line on the Trust overview, and "Swordfish payover" / "Swordfish-era drawing"
     on Trust -> Exceptions to take its debits off it; what is left after the last Swordfish run is
     the one-off Swordfish difference (firm fees can be written off; client money cannot);
  3. **balances brought forward from Camille's Excel** (40-50 clients, R400k-R1m owed to the firm:
     withdrawal fees, PTCs, other) as `client_charges` dated the cut-over, set off against the
     next payover by default, and a per-client ledger on the client record opening with it. The
     user is getting the file (or its headings); NEVER commit it -- staging only;
  4. finish the production copy (§5).
- **Also raised, not yet specified:** reversals of payments (reversal of an un-invoiced payment
  works since `533b46b`; Reverse is on Payments in -> History, on the opened receipt), and something about opening a client from
  a payover run ("we'll get to that").

## 4. Decisions waiting on the firm

Do not guess these. Each one changes money.

00. **PEOPLE / THE CLERKS' COMMISSION (22 Oct; most answered 23 Oct -- see Start here).**
   **Still open after the 23 Oct answers:**
   (i) **THE PRO-RATA DIVISOR -- the one assumption to confirm.** Built as: basic x (working days from
   the start date to the 25th, both counted) / (working days in that whole salary month, 26th-25th),
   weekends and SA public holidays out. The firm's example (start Mon 23rd, 25th a Wednesday -> 3 days)
   fixes the numerator; the divisor could instead be calendar days, or a flat 21.67. Same for a leaver.
   (ii) **Pay day on a weekend**: shown as the 25th as written. Say if it moves to the Friday before.
   (iii) **Which runs count for carried-over commission**: the first run whose CYCLE ENDS on or after
   the commission start date (so a run for a cycle that ended before go-live never releases it).
   (iv) **A short run settled by a payment into the business account** releases the held PTC on the
   next 25th after that payment -- the payover treats it as settled; confirm.
   (v) **A run approved after the 25th** releases on the NEXT month's 25th (the release is read on the
   first pay day on or after the approval, so a month already paid never changes).
   (vi) Sales / communications schemes and the KPIs, as before.
   **Answered 23 Oct, kept here for the record:** reversal as a negative line in the month of reversal
   (confirmed and now labelled with the pay day it was paid), rounding (confirmed), the release (now by
   the payover run, not the ledger), exceptions capped at 3%.
   (a) **A reversed payment** is a NEGATIVE line in the pay period it is reversed in (clawback); the
   month the money came in is left as it was paid. Confirmed 23 Oct. (The floor's collected figure, by
   contrast, drops a reversed payment from every month, so for a past month the two differ by exactly
   the reversals -- said on the profile.) A receipt REJECTED after a month was paid simply disappears
   (rejection happens before approval, normally the same day); say if that ever needs a clawback too.
   (b) **Rounding**: each payment's commission to the cent, half away from zero; totals are the sum of
   the printed lines.
   (c) **The PTC release** (SUPERSEDED 23 Oct: now by the payover run): the first pay period (11th-10th), from the PTC's own onwards, at whose
   CLOSE the PTC is approved, not reversed, and the client's ledger (`client_ledger`, the client's
   running statement) is nought or in the client's favour. So money the trust holds for the client
   counts against what they owe -- a client the firm owes on balance releases at once. Whole, never
   part. Is "owes us nothing" the NET ledger, or must the PTC fee itself be settled (set off or paid)?
   (d) **Before the desk history existed** (backfill rows) the holder then is taken to have held the
   account since handover; such lines say "Holder reconstructed".
   (e) **The period**: the collections month, 11th to 10th, the same as the floor and the payover
   cycle, not the calendar month. Payroll on a calendar month would show two "October"s.
   (f) **Exception cap**: 0% to 3% since 23 Oct (was 10%).
   (g) **Still to come from the firm**: the sales and communications commission schemes and the
   KPIs ("I'll share that with you later"). Those people show basic only.
0. **WHAT COUNTS AS "A PTP MADE" FROM A CAMPAIGN (22 Oct, built as stated, easy to turn).** A promise on
   an account in the campaign, recorded by the collector whose diary the call was on, from the moment the
   call landed there until the end of the day they worked it (or until the campaign ended / it was handed
   to another collector). Counted once per promise. A promise somebody else took, or one a week later, is
   not the campaign's. And the trace funnel's stages: SEARCHED a bureau report or an item 4(c) search
   after the referral; NEW DETAILS a contact added or verified (or a finding verified) after it; CONTACT
   MADE a consultation (item 7) after the new details; PTP and PAID after that contact.
1. ~~R502 or R509?~~ — **decided 8 Oct: R502 stays.** "The actual fee was 509 as per the Gazette
   ... they undercharged 7 Rand for years. There's nothing that we can do about that now. So we will
   leave it like that." Do not move it. Recorded in `check-fees.mjs`.

2. ~~When did Swordfish last pay its clients over?~~ — **decided 8 Oct**: on import day, everything
   up to the 10th of the month BEFORE last is paid (import 8 Oct → 10 Aug); the cycle that closed last
   (11 Aug – 10 Sep) is still in trust and goes out on 11 Oct. Built as the import's default. On the
   11th itself the run counts as made -- the box is still editable for an import that morning.

3. **`payover_lag_months` is confirmed at 1** by the same answer (a cycle ending on the 10th pays on
   the 11th of the next month). **`parked_credit_months` (6) is still a placeholder**: it is how long a
   debtor's small unclaimed overpayment is parked before the firm may take it as its own (the firm:
   "who are we going to pay five rand to?"). The firm did not know the term; ask it in those words.

4. ~~Commission / fees / VAT split of the firm's trust balance~~ — **firm said do it (8 Oct); built**
   as earned-by-part less drawings (§2). If the firm wants each PART's balance after drawings (e.g.
   "VAT still held for SARS"), a drawing would have to say what it draws -- a ledger change; ask.
   Original note: The firm's sketch asks for it. It
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

6. **A bank statement for an account that is not the trust account.** On staging, 14 pending
   payments came from a statement for account 9999999999 rather than the trust account
   (62700201255), so the trust overview shows nothing for them — `trust_position` reads only the
   trust account's lines. Asked: refuse such a statement outright, or allow it after an
   Administrator confirms? Also proposed: an "Awaiting approval" row in the overview's ownership
   table for money banked but not yet approved. **Not answered; nothing built.**

8. ~~Bank interest on the trust account~~ — **confirmed 8 Oct**: the firm's income, the regulator
   allows it. Now its own line on Income (§2). Original note: **Bank interest on the trust account is credited to the FIRM** by prompt 12's allocation. That
   follows the firm's own words ("interest received ... allocated"), but who trust interest belongs
   to is a regulatory question (Debt Collectors Act / the firm's auditor). **Confirm it**; if it is
   not the firm's, the `bank_interest` branch of `allocate_bank_line` is the one line to change.
9. **Bank charges: the firm says they are a BUSINESS expense, not the trust's** (8 Oct), and is
   finding out from the bank whether they leave the trust account and the business pays them back.
   Wait for that before changing anything. Original note: **Bank charges are recorded as owed by the business to the trust** (the prompt's rule), and are
   left out of the business side's "earned". They do not yet appear as an EXPENSE on the business
   side unless somebody captures them under Expenses, so "made" is overstated by them until then.

10. ~~Where a PTC overpayment's credit sits~~ — **decided 7 Oct**: "we only process the amount
    that is due. The client should sort that out." Built: the engine marks it `with_client` (§2).
11. **The items 1–7 cap per payment.** The engine reports what the in duplum ceiling refuses
    (`*_cant`), and the queue badges and the drawer show it as "can't recover". It does NOT report
    per payment what the items 1–7 cap (R1 225 / capital) held back, so no badge says a payment was
    clipped by it and nothing claims one is "within limit". If the firm wants that badge, the engine
    has to return the figure — a change to `preview_allocation`, not to the screen.

12. ~~The firm's PTC share recovered by set-off had no ledger owner~~ -- **decided 10 Oct, built**
    (§2, top row). The firm: "when a PTC debt is taken off a later payment, the firm's share should
    stay in the trust. And it should be able to be transferred to the business account."
13. **Part payments of a shortfall into the business account** are refused for now: how a run's
    shortfall should read on the next advice when half was paid directly is the firm's call.
14. **No allocation kind for a debtor's payment that BOUNCES on the statement.** The simulation used
    "wrong reference" instead (reverse to Needs an account, place elsewhere), which works; a returned
    debit order has a debit line on the statement and nothing to allocate it to except "other",
    which would count it twice against the reversal's own entries. Ask how the bank shows one.
15. **Two readings in "only once the client has been paid" are ours** (10 Oct; built that way, say
    if wrong). (a) A run approved AT OR BELOW NIL counts as paid: there is nothing to pay the client,
    and the shortfall is their debt (carried, or paid into the business account) -- so the firm's
    share on it may be drawn. (b) "Paid" is the run MARKED paid (`paid_at`), not paid AND seen on the
    trust statement. If the firm wants (b) to wait for the statement, `firm_run_settled` is the one
    place to change.

**Decided on 7 October (third session), so nobody asks again:** a settlement's approval is recorded
by the client liaison role (+ Administrator); a paid settlement is closed by a PERSON, never by
itself; the Income screen is behind a tick no role has; a drawing needs both the trust and the
business ticks; **a PTC's Due to BF includes the VAT on commission**, as a display correction only —
no toggle, the allocation and the ledger unchanged. (The payover run was already right: it sets off
`commission_vat` across every line, PTC lines included, separately from its own `due_to_bf`.)

7. **Kestrel's rand boundaries.** Staging now carries Kestrel's four register tiers (KIS 21%, KIS2
   15%, KIS3 12%, KIS4 10%, typed from prompt 9 — the register file is not in this repo) and NO
   bands, so its client page and Trust settings say the boundaries are missing and a new handover
   for it is refused. That is correct until somebody types the boundaries from the signed mandate.
   Proved in a rolled-back transaction with test boundaries 100k / 250k / 1m: R10 000 → 21%,
   R600 000 → 12%, R100 000 → 21%, R100 000.01 → 15%, KIS0012 still 21% and not flagged. **The
   real boundaries are the firm's to enter**; the 10% flat rate the import left on Kestrel is
   cleared the moment they do.

---

## 5. Known gaps and things still outstanding

- **People round two (23 Oct, `people_payday_payover_release_and_carried`, the very end of schema.sql;
  staging only)**: `profiles.start_date` (copied from `employee_profiles.started_on`, which is then
  REMOVED -- one start date) + trigger `profile_start_date_history` (writes `start_date` changes into
  `employee_profile_history`); `employee_profiles.ended_on`; `employee_profile_stamp` (history fields now
  job_title, ended_on, pay_basis, basic_salary, notes); `protect_profile_privileged_fields` (+ `start_date`
  for non-Administrators -- the live definition read first, everything kept); constraint
  `clerk_commission_overrides_rate_upto_3` (0-3%; the old 0-10% check is left in place and decides
  nothing); `people_settings` (one row, `commission_start`) + `people_setting_changes` + trigger
  `people_settings_stamp`; `clerk_commission_carried` + trigger `clerk_commission_carried_stamp` + one-
  reversal index; `clerk_commission_lines` REMOVED AND RECREATED (return type: + `reversal_reason`,
  + `payover_run_id`); new `clerk_commission_runs(uuid[])`; `clerk_commission_ledgers` REMOVED (nothing
  reads it); `clear_staging` (the live definition + `clerk_commission_carried` in the truncate). The
  set-null foreign keys and the removals went in by `execute` in do-blocks (the MCP tool hangs on the
  words). Probed on staging, rolled back: carried entry + reversal (exact negative, clerk copied), a
  second reversal refused, a 3.5% exception refused and 3% accepted, the start-date change written to
  history, an Administrator without people.pay sees 0 settings rows and is refused the carried insert
  and the runs function. **No commission start date is set on staging** -- the firm sets it on
  People -> Carried over. Production has none of this.
- **People migration (22 Oct, `people_pay_and_clerk_commission`, the very end of schema.sql; staging
  only)**: `all_capabilities` (+ `people.pay`), `employee_profiles` + `employee_profile_history` +
  trigger `employee_profile_stamp`, `clerk_commission_overrides` + trigger
  `clerk_commission_override_stamp`, `collector_performance` and `collector_daily` (rejected and demo
  receipts no longer counted), `clerk_commission_lines`, `clerk_commission_ledgers`. **Applied through
  MCP with the seven foreign keys added in a do-block** (the word in "on ... cascade / set null" hangs
  the tool); schema.sql carries them inline. Then, as data and NOT in schema.sql, `people.pay` added
  to the grants of Stephan (48eb7492-...) and Camille (0f12f712-...) under Stephan's JWT claims; on
  production that grant has to be made the same way. No `clear_staging` change was needed: the new
  tables key into profiles (kept) and into companies / debtor_accounts with cascade (check-clear-staging).
- **S10's set-off migration (22 Oct, `s10_set_off_credited_as_covered`, the very end of schema.sql)**:
  `trust_creditors_on_run`, `trust_position`, `trust_cash_by_cycle`. Production needs it BEFORE any
  balance brought forward is taken by a run. On production's first approval after it, a client whose
  earlier runs were credited in full while below nil gets a negative "Charges recovered ... (less than
  was credited ...)" entry -- **run this on production first, read-only, and show the firm the list**:
  per client, `sum(-amount)` of client "Charges set off against payover %" less firm "Charges recovered
  from payover %", where that client's latest approved run is below nil.
- **S10's prospect / results / warm-up migration (22 Oct)** (staging has it; end of schema.sql, "S10 /
  PROSPECT LISTS, THE INTRODUCTION, DELIVERY RESULTS"): `marketing_lists` (+ RLS select only),
  `leads.marketing_list_id`, `marketing_campaigns.kind` + `sender_id`, the `marketing_preferences.how`
  check with `'opt-in link'`, eleven `marketing_sends` columns (sender, delivered/delayed/bounced/
  complained/first_opened/first_clicked/unsubscribed/opted_in timestamps, open/click counts),
  `marketing_send_events`, `marketing_record_event`, `marketing_sender_today`,
  `marketing_claim_prospect`, `marketing_campaign_results` (replaces `marketing_campaign_counts`,
  which is removed), and `clear_staging` with the events + lists. **Applied to staging through MCP with
  the four foreign keys added in a do-block** (the words in "on ... set null" hang the tool); schema.sql
  carries them inline. Another session redefining `clear_staging` after this must keep
  `marketing_send_events` in the truncate and the `marketing_lists` removal.
- **Opt-in by a link scanner.** The opt-in page records the yes when it OPENS (the firm's one-press
  design); the API never acts on a GET, but a scanner that runs JavaScript could press it. The page's
  "that wasn't me" undo unsubscribes the address. If the firm sees opt-ins it does not believe, the
  page can be changed to ask for one more press.
- **S10's campaigns-round-two migrations** (end of schema.sql, staging only): `campaigns.call_kind`
  ('work'|'recovery'|'trace'), `collector_ids`, `write_off_reasons` (+ `campaigns_call_kind_shape`;
  `include_withdrawn` added and then removed the same day); `diary_entries.recovered_at`,
  `recovered_from`, `closed_at` (+ trigger `stamp_diary_closed_at`); `campaign_call_follows_desk` +
  trigger; `recovery_closure`, `write_off_reason_key`, `recovery_reasons`, `recovery_reopen`;
  policy `campaigns_read_own_calls`; `campaign_counts` (moved not counted); `campaign_call_promises`,
  `campaign_results`, `campaign_results_by_collector`, `trace_campaign_funnel`.
- **Clocks on staging:** results compare `created_at` (now()) stamps; the firm-clock stamps
  (verified_at, outcome_at) are shifted by today's offset. Right while the staging clock has not been
  moved since the stamp was written; exact on production.
- **S10's call-campaign migrations** (end of schema.sql): campaigns call columns + checks, the
  `campaign` diary kind/source/rank/campaign_id, `priority` SET EXPRESSION (PG17), the two one-open
  indexes, `sync_account_diary_date`, `call_campaigns_expire`, the one-row `campaign_counts`, and
  `role_capabilities` with `campaign.run` for both liaison roles.
- ~~A campaign call stays with the collector it was placed with~~ -- **fixed 22 Oct**: it follows the
  account to its new desk (campaign_call_follows_desk).
- **S10's evening migrations too**: `swordfish_import_runs` + `discard_import_batch`; the brought-forward
  columns/kind/index, `bring_forward_client_balances`, `client_ledger`, `business_income`,
  `business_month`; campaigns tables + functions; marketing tables, lead columns + trigger, functions;
  the combined `role_capabilities`; the last `clear_staging`; the last revoke loop.
- **S10's open-list migrations too** (end of schema.sql, after the S10 list below): the login-code
  tables and three functions; the Swordfish holding table, column, functions, and the new
  `trust_position`, `protect_bank_statement_line`, `clear_staging`, and the revoke loop.
- **S10's migrations, for production when the firm says go** (staging has them; end of schema.sql, in
  this order): `clear_staging` (production refuses it anyway); `client_work_refusal`,
  `refuse_handover_without_mandate`, `refuse_account_without_terms` + `debtor_accounts_need_terms`
  (**check production's clients have commission and, outside Swordfish, a mandate date before this
  goes on -- every hand-added debtor for one without is refused**); `companies.contract_missing_reason`;
  `debtor_accounts.contact_search`, `account_contact_terms`, `refresh_account_contact_search` + trigger
  and the backfill update; the perusal-fee removal; `protect_filed_mail_target`,
  `account_emails.unmatched_*`, `unmatch_email`; `refuse_second_live_promise` + trigger + the
  `promises_to_pay_one_live` index (**check production has no account with two live promises first,
  or the index will not build**), `section_129_version`, `workflow_resume_on_promise_broken`;
  `bank_statement_lines.suspended_*`, `suspend_bank_line`, `release_bank_line_from_suspense`,
  `unallocated_receipts`, `suspended_bank_lines`; `account_fees.credits_fee_id / credit_reason /
  credited_by_name`, `account_fees_net`, `fee_split`, `account_money_position`, `credit_fee`,
  `refuse_credit_note_by_hand` + trigger; the finance revoke loop; `workflow_first_notice_pending`, `workflow_hold_account` (LAST
  definition), `workflow_hold_after_first_notice` + trigger.
- **`account_charge_basis` is not in schema.sql** (found in S10): the charge engine calls it and it
  exists only on the databases. Whether a credit note reopens room under an item's ceiling depends on
  its filters, which nobody can read from the repo. Mirror it from staging's `pg_proc`.
- **schema.sql still declares a key staging dropped**: `account_fees.payment_id -> account_payments`.
  Harmless (it only makes check-clear-staging stricter); find out which is right.

- **S9's migration, for production when the firm says go** (staging has it; end of schema.sql):
  `account_balances` + its three policies, `bump_balance_version`, `mark_balance_stale` and its
  three ledger triggers, `mark_account_balance_stale` and its `debtor_accounts` trigger,
  `record_account_balances`, `accounts_needing_balance`, `balance_sort_state`. On staging the
  trigger statements hung when applied together through apply_migration; one at a time with
  `set lock_timeout` they went straight in. Production also needs the cron (vercel.json) and one run
  of `/api/workflow/balances` to fill the table (~24 000 accounts; it says `more: true` if the
  budget runs out -- run it again).
- **S9's second migration**: `client_money_by_day(uuid)` (staging has it; end of schema.sql).
- **S9's third**: `signing_requests.mode / promise_id / fee_charged_at`, `signing_document` (adds
  mode), `signing_accept(text, text, text)` (staging has them; end of schema.sql).
- **S9's fifth**: `signing_requests.sent_to` and `signing_accept` (LAST definition: no typed name).
- **S9's fourth**: `companies.other_details`, `mandate_same(text, text)` and `mandate_on_signed` (LAST
  definition: adds, never overwrites; the signed name wins) (staging has them; end of schema.sql).
- **Deleting a debtor account on staging takes over a minute** (seen in S9 probes, without S9's
  triggers too). Not investigated.

- **S8's migrations, for production when the firm says go** (all on staging, all in schema.sql in
  this order):
  - `company_intake_by_day`, `clients_awaiting_first_handover`, `client_book_summary`;
  - the public signature and letterhead buckets limited to images;
  - `signing_requests.lead_id / deal_id / company_id / mandate`;
  - `mandate_on_signed` (LAST definition: notes, raptor_now, liaison_needed);
  - `companies.liaison_needed / liaison_assigned_at / welcome_sent_at`;
  - `leads.party`;
  - `client_intake_by_day`, `client_account_outcomes`, `client_handover_days`.

  The `welcome` email route needs the deployed site's host to build the banner URL; it uses the
  request's host.
- **Seed data on staging** (S8) is marked and listed under S8 in §2. Remove it before the firm
  trusts staging figures again.

- **FIFTH SESSION, STAGING ONLY** (all at the end of `schema.sql`, in order): the staging clock
  (`staging_clock`, its trigger, `raptor_today`, `raptor_now`, `raptor_clock`, `staging_clock_guard`,
  `begin_staging_clock_jump`, `step_staging_clock`, `clear_staging`), the 62 clocked functions and 14
  column defaults, the `skipped` step state, the bank_line_id fix (`reverse_payment_to_unplaced`,
  `reverse_payment`, `import_bank_lines`), `payover_number_in` + `match_payovers_by_reference`,
  `client_business_receipts` + `record_client_business_receipt` + `settled_direct_receipt_id` and the
  five readers (`build_payover_run`, `close_payover_cycle`, `ptc_ageing`, `client_ledger`,
  `trust_cash_by_cycle`). **On production the clock is inert by construction** -- but production
  needs a `deployment` row (§5 below says it has none yet); none = not staging = now(), which is the
  safe way round. Also staging only: the `qa_sim` schema (the simulation's fixture functions).
- **The staging clock and the browser.** Dates the browser DECIDES follow the clock; dates the browser
  merely DISPLAYS from rows are whatever the row says. Mail, calls, activities and reminders stay on the
  real clock on purpose (they happened in the real world). `collector_performance` and the dashboards
  count by `created_at`, a real stamp, so a simulated July shows up in the real month on the
  performance screens -- not in the money, which is all on `allocated_on` / clocked dates.
- **The morning cron on staging** asks the database for today, so with the clock standing at 11 July
  it sends nothing dated later. A JUMP never sends; staging's live SMS is safe from it.
- **PRODUCTION COPY: PAUSED HALF-WAY ON 8 OCT, AT THE USER'S WORD ("we are not going live").**
  Production (`qcvesjzoiznrvunjrqpv`) still serves the old `Main` (`acae2c8`) and is safe for it.
  Method: rebuild from staging's CURRENT catalog (not by replaying 302 migrations), idempotently,
  then diff the two catalogs. The user chose to copy the firm's SETUP too (library templates incl.
  48 edited in-app, workflows as published, firm settings) but not staging's test clients/accounts.
  - **Done** (`golive_01`–`golive_13`): both sequences; all 68 tables with every column (column
    fingerprints match staging on all 68, except `diary_entries.priority`, not yet added, and
    `account_payments.collection_commission`, put BACK because live `Main` selects it — drop it at
    go-live); three old prod differences aligned; functions `account_*` through `is_staging_database`
    (≈80 of 189); row-level security switched ON for every table (no policies yet, so the new tables
    refuse everyone — the live app does not use them).
  - **Not done, in this order:** the two views (`account_money_position`, `finance_exceptions`,
    both revoked from anon/authenticated); functions `m*`–`w*`; `diary_entries.priority`
    (generated from `diary_priority`); constraints; indexes; policies; triggers (incl.
    `on_auth_user_created`); grants and function revokes; storage buckets (`letterheads`,
    `client-documents`, and since 8 Oct `payover-advice`) and their policies, and letterhead image files; the pg_cron job
    `close-payover-cycle`; a `deployment` row of kind 'production'; the setup data; a full
    catalog diff (md5 of every function body, constraint, index, policy); then merge into `Main`.
  - **Two traps found:** the Supabase tool silently waits for a confirmation nobody can give on any
    statement containing delete/drop/truncate — even inside a function body — and times out after
    60s. Wrap such functions as `do $x$ begin execute replace($src$...d§elete...$src$, '§', ''); end $x$;`
    (the generator query used is in the transcript). And a pipe that lets production pull from
    staging over HTTP was refused by the safety check and removed — use the Supabase tools.
  - Once `Main` deploys, the daily workflow run and 5-minute mail sync act on production data, and
    `CRON_SECRET` was marked "rotate before real client traffic".
- **AT GO-LIVE, TURN ON "From the bank statement only" (Trust settings → How a payment out is
  settled).** The firm, 8 Oct: on staging keep both, "but when we go live ... just work from the
  statement". Built: `firm_settings.payouts_statement_only` (off on staging); on, Mark paid is gone
  from the run page and Payments to make and `mark_payover_run_paid` / `mark_refund_paid` refuse.
  Record a transfer stays (the instruction; the statement confirms it).
- **FIXED 8 Oct (see §2): reversing an approved payment used to fail on staging** unless it is already on an
  issued run. `reverse_payment` → `reverse_payment_allocation` → `reallocate_account` removes the
  account's un-invoiced allocations, and `trust_creditor_entries.allocation_id` still references
  them (FK, append-only ledger), so the whole reversal errors. That is the **Reverse** button on
  Trust → Check. Probed with a plain R500 payment, no move involved. Needs a ledger-design fix
  (reversing entries instead of removing the allocation), and the firm's eye on it before it ships.
- **THE TRUST BANK OPENING BALANCE IS BUILT (10 Oct, §2) BUT NOT CAPTURED.** At go-live, enter the
  bank's closing balance for the day before the first imported trust statement (Trust settings →
  Trust account opening balance). Staging's R15 021.04 gap was exactly the missing opening (the 10
  Swordfish receipts, R15 943.54, that arrived before the first statement, less the PTC R922.50).
  Production needs the migration at the end of `schema.sql` ("THE TRUST ACCOUNT HAS AN OPENING
  BALANCE") as part of the go-live copy.
- **Check now happens before approval** (built 8 Oct, §2). A payment breaking a formula is held out
  of Approve all / Approve selected and approved alone from its breakdown after a "checked" tick.
  **The hold is in the browser only**: the formulas live in `allocationRules.ts`, not SQL, so
  `approve_payments` itself does not refuse. Trust → Check stays: it is still where a posted
  payment is read and reversed. Whether to retire it is the firm's call once reversal moves.
- **Reversal fix, proposed to the user on 8 Oct, not built:** stop `reallocate_account` deleting
  allocations; mark them `reversed` (make `payment_allocations_one_per_payment` partial, `where
  status <> 'reversed'`), write negating `trust_creditor_entries` for each superseded allocation's
  entries, then replay. Cost: 34 functions and 2 views read `payment_allocations`, 15 already
  mention `reversed`; the other ~21 need auditing so a superseded row is never counted. Any
  replay (not only a reversal) hits the same FK today.
- **A test-data prompt** for another session (two Swordfish clients, all six import files, trust
  statements in and out) was written on 8 Oct; its formats are the importers' own column lists.
- **The dashboard's R0 (8 Oct) is answered** (§2): staging's company figures now include the R58 300
  no desk held. **The accounts already imported on staging were NOT re-assigned** -- they went in
  before the rule; re-run the import (or assign them) to see clerks credited. Of the 20 Swordfish
  clerk names only Vusi Maringa matches a staging user exactly ("Itumeleng" is not "Itumeleng
  Masalesa"); the rest need adding as users first.
- **Not built: assigning an account LATER when its clerk is added as a user afterwards.** Today a
  leader does it by hand; the name is on the account (`swordfish_assigned_to`) to do it from.
- **Fourth session, staging only** (all at the end of `schema.sql`): `business_income` (bank_interest),
  `firm_held_parts`, `record_account_desk_change`, `collector_performance` (no-user row, then 'moved'
  left out), the `finance_exceptions` view, `payover_run_payments` (excess_disposal),
  `account_payments.moved_from_allocation_id` + `allocate_payment`, `reverse_payment`,
  `dispose_excess_credit`, `collector_daily`, `payments_in_month`, `client_book_totals`,
  `payment_out_reference`, `payments_to_make`, `bank_allocation_candidates`, `overpayments_kept`.
- **Prompts 10–12 are on staging only:** `client_needs_mandate` + the `handovers_need_a_mandate`
  trigger; `debtor_accounts.default_date`; the five allocation columns on `bank_statement_lines`,
  `allocate_bank_line`, `bank_lines_to_allocate`, `bank_allocation_candidates`, and new versions of
  `import_bank_lines`, `protect_bank_statement_line`, `unreconciled_payouts`, `firm_entry_kind`,
  `business_month`, `business_income`.
- **Staging data as left by this session:** SMT, BPM and LVM carry `mandate_signed_at` = 1 Jan 2024
  (somebody set it; prompt 10 said null — left as found). Their 60 sheet accounts keep the
  `handover_date` of 7 Oct the user set; `default_date` was filled for all 60 from their draft rows.
  The test statement's two R57.50 `##BANK CHARGE` lines are **unallocated on purpose** — confirm
  them on Trust → Exceptions; the probe proved what they become. Its two unplaced receipts
  (`CAPITEC T NGUBANE` R300, `CAPITEC SMT199999` R450) are debtor payments to be PLACED.
- **The test statement is not on the trust account number** (`9999999999` vs `62700201255`), so
  `trust_position`'s bank balance does not see it — §4 item 6. Allocation works on it anyway.
- **Third session's earlier work is on staging only:** `account_settlements` and its five functions,
  `settlement_today`, the two new ticks in `role_capabilities` / `all_capabilities`,
  `firm_entry_kind`, `business_drawings`, `business_income`, and the new `business_month` and
  `draw_from_trust` — all at the end of `schema.sql`.
- **PROMPT 9 IS ON STAGING ONLY.** Production needs, from the end of `schema.sql`: "A CLIENT'S
  SLIDING SCALE PRICES EACH ACCOUNT ONCE" (`commission_band_rate`, `account_commission_rate`, the
  four engine functions), the `commission_tiers` / `commission_bands_dated` columns, and "THE
  MANDATE RATE AN ACCOUNT IS COMPARED AGAINST FOLLOWS THE CLIENT'S CURRENT RULE". The checked-in
  `preview_allocation` had drifted from staging; `schema.sql` now carries the live one, so read the
  LAST definition when porting.
- **Only Kestrel has `commission_tiers` on staging.** Other clients get theirs from the next
  Swordfish import (`swordfishImport.ts` writes them where a client's prefixes carry more than one
  rate). Until then a multi-tier client with no bands is not caught by the handover block.
- **Saving a client's commission re-splits at most 200 accounts from the browser** (as before);
  the rest are picked up account by account through the exception queue.

- **Item 8 of prompt 7 could not be investigated.** APM20070, APM20097 and GPS4/10080 fail a
  payments reconciliation; the files are not in this repo. A reconciliation was built into the
  import instead, so the real migration cannot pass it silently.
- **Item 6 remainder:** "allow the wipe on production only before the first migration" is not done —
  it needs a fact about production that nothing in Raptor records.
- **The settlement store has no letters yet.** The fields exist and answer off an approved offer,
  but there is no settlement OFFER letter or settlement CONFIRMATION letter in the library, and the
  SETL call disposition still only writes its note (it does not open the panel's propose box).
- **The R22,77 settlement shortfall on RRC00002** is unexplained, and is NOT what the settlement
  store is about: it is the full-balance "to settle today" quote's receipt fee being worked on the
  balance while the fee charged is 10% of the payment. Still the firm's question.
- **Income counts what the trust LEDGER credits the firm.** A PTC's earnings (paid straight to the
  client) are recorded as the client owing the trust, not as a firm entry, so they reach Income only
  when recovered. Worth confirming with the firm what they expect to see for those.
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
- **`account_emails.correspondent` is on staging only.** Production needs the migration (end of
  `schema.sql`, "WHO IS ON THE OTHER END") and then a decision on its existing client rows: on
  staging they were marked by re-running the rule, and the user chose to leave production's to the
  firm, case by case. Until then production behaves exactly as before.
- **The debtor's Activity timeline still carries a note for client correspondence** (the sync's and
  `recordSentEmail`'s `account_notes` rows). The firm's complaint was the Emails tab, which is the
  evidence; the timeline was left alone. Raise it if they mention it.
- **Imported accounts were given handover runs before the guard landed** — 20 on staging, 8 closed
  and 3 on hold. Not swept: a correction is the firm's decision, case by case.

---

## 6. Traps in this repo that cost real time

**S10: removing a team leaves its people pointing at nothing.** `profiles.team_id` is `on delete set
null`, but protect_profile_privileged_fields puts the old team_id back when nobody is signed in as an
Administrator -- so the set-null is undone and the profile points at a deleted team (FKs are not
re-checked after an action). Clear the people's team_id FIRST, with Administrator claims set, then
remove the team. Found removing staging's four teams at the user's request (21 Oct).

**S10: a probe that inserts an account now needs a client with terms.** `debtor_accounts_need_terms`
refuses a debtor for a client with no mandate date (outside Swordfish) or no commission. Insert the
company with `mandate_signed_at = now(), commission_rate = 0.2` (and `account_owner_id`, not null).

**S10: a check's comment-stripper eats `image/*`.** Several checks strip `/* ... */` before reading
source, so an attribute like `accept=".pdf,image/*"` swallows everything up to the next `*/`. List the
extensions instead.

**S10: a new finance function must join the revoke loop.** check-finance-is-administrator-only reads
the LAST `foreach fn in array array[...]` loop in schema.sql and wants every function a finance page
calls in it -- append a fresh copy of the loop with the new names, as S10 did.

**S10: run-all wants "N passed, 0 failed"** on a check's last line; "all N passed" counts as a failure.

These are not in CLAUDE.md because they are about the tools, not the firm.

**The Supabase MCP's `apply_migration` is cancelled whenever the SQL contains "drop" or "delete"**,
comments included, and the user is never shown an approval prompt (S7; it was cancelled three times).
Use `execute_sql`, keep those words out (`'dr'||'op'` inside `execute` where you must), and mirror
into schema.sql by hand. Probes go inside `begin ... raise exception` so they roll back. A capability
can be simulated in a probe with `set local session_replication_role = replica` around the grant,
because a trigger silently reverts `profiles.grants`.

**`JSON.stringify(NaN)` is `"null"`**, so a check comparing JSON passes a rate of 0/0 as "no rate".
Assert `=== null` for a value that must be null.

**A function applied to staging is not in schema.sql until somebody puts it there.** S7 found
`clients_owing` live on staging and missing from the file, and `trust_bank_statement` called by the
app and missing from both. Before committing, list what the session applied and grep the file.

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

**Run the checks and the commit as SEPARATE steps.** In this environment's shell, `set -e` and
`grep -q` on the QA summary did not stop a chained command: twice a commit was pushed with the fast
suite red (`5779bac`, `eb7c973`, each fixed in the next commit). Read "All green" with your own
eyes, then commit.

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

**`create or replace trigger` exists (Postgres 14+)** and avoids writing `drop trigger`, which the
MCP tools hang on. Prompt 9's `companies_commission_expected` was created that way.

**Chromium's `en-ZA` thousands separator is not Node's.** Node gives a (non-breaking) space; the
e2e browser has drawn a comma. A browser assertion on a Rand amount matches `[\s,]`, never a
literal space.

**`protect_profile_privileged_fields` silently reverts a grant made with nobody signed in.** In a
probe, set `request.jwt.claims` to an Administrator BEFORE updating `profiles.grants`/`revokes`; done
as plain `postgres` first, the update "succeeds", the trigger puts the old value back, and the
capability then reads false for no visible reason. The trigger is right — it is the probe order.

**Staging's book is empty** (0 accounts, 0 payments, 3 companies). A behaviour probe has to create
its own account inside the rolled-back transaction; a `debtor_accounts` row needs only `company_id`,
and `commission_rate` is a FRACTION (0.20), checked by `debtor_accounts_commission_rate_is_a_fraction`.
An approved receipt inserted there runs the real engine (allocation + ledger entries).

**This session started on a stale `Main`.** A fresh container may check out `Main` (12 Sep, the
live deployment), not this branch. Fetch `claude/sales-raptor-review-p1pzx2` before believing
anything is missing.

**Every preview branch now gets the staging settings (10 Oct).** `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `EMAIL_CREDENTIALS_KEY` were scoped in
Vercel to `claude/sales-raptor-review-p1pzx2` alone, so a new session's branch built a preview that
loaded and drew nothing (the Supabase client throws at import). They now apply to all Preview
branches. That old branch was also fast-forwarded to `claude/new-session-ecohkn` so the link the
firm already uses shows the current work.

**Break-test convention, and it is not optional.** After writing a check, break the thing it guards
and confirm it fails. Twice this session a "break test" was equivalent code and proved nothing;
once a sed silently failed to apply and the green result was meaningless. Verify the sabotage
actually landed before trusting the red.

---

**A function changed in the same `execute_sql` call as a probe that RAISES is rolled back with it.**
Apply the change in one call and probe in the next, or the "fix" you just tested is gone. (Fifth
session: `trust_cash_by_cycle` "worked" in the probe and was still the old one afterwards.)

**Line-number edit lists go stale the moment you insert a line.** A script that converted every
`new Date()` except a KEEP list by file:line, re-run after imports were added, converted exactly the
lines it was told to keep. Key exclusions on the line's TEXT, never its number.

**`git checkout <file>` in a break test throws away your own uncommitted work in that file.** Copy the
file aside and copy it back, as every other break test here does.

**A bare `import ... from './x'` breaks the QA checks** (they resolve `.ts`/`.js` only); vite does not
care, so the build is green and 20 checks fail with ERR_MODULE_NOT_FOUND. Lib files imported by checks
use `./x.ts`; files the API also imports use `./x.js`.

**The MCP tool may ask the user before running anything that LOOKS destructive** -- an `update
public.deployment` inside a probe was cancelled once. Keep probes to what they need.

## 7. How to pick up

1. Read CLAUDE.md, then this file.
2. `git log --oneline -12` — the commit messages carry the reasoning, not just the change.
3. `npm run qa -- --fast` before touching anything, so you know what was already red.
4. Work on staging; mirror every migration into `supabase/schema.sql`; verify by md5.
5. Update §2, §3 and §5 of this file before you finish.
