# S13 · Campaigns — the brief for Reino's session

**From Stephan (the firm's administrator), 26 Oct 2026.** Reino, give this whole file to your Claude Code
session as its first message, or tell it: *"Read `docs/briefs/S13-reino-campaigns.md`, then CLAUDE.md and
HANDOFF.md, and do what the brief says."*

---

## 0. Who you are working for, and where you may build

You are working for **Reino, the marketer**, not for the administrator. Stephan has given this session
permission to build in the **News & campaigns section only**. That is wider than the usual marketing area in
CLAUDE.md ("Working for the sales and marketing team"): for this assignment it includes the campaign server
code and the campaign checks, listed below. Everything else in CLAUDE.md still applies.

**You may change:**

| Area | Files |
|---|---|
| The campaign screens | `src/pages/news/NewsPage.tsx`, `src/pages/news/ImportListCard.tsx`, `src/pages/news/UndeliveredCard.tsx`, and new files under `src/pages/news/` or `src/components/news/` |
| The screens' calls to the server | `src/lib/marketingApi.ts` |
| The campaign rules (shared by screen and server) | `src/lib/marketing.ts` |
| The campaign server | `api/_lib/marketing.ts`, `api/_lib/email/marketing.ts` |
| The campaign checks | `scripts/qa/check-marketing.mjs`, `scripts/qa/check-marketing-prospects.mjs`, `scripts/qa/e2e/news-campaigns.mjs`, `scripts/qa/e2e/news-prospects.mjs`, and new `check-campaign-*.mjs` / `e2e/campaign-*.mjs` |
| The handoff | your own section at the top of `HANDOFF.md` |

**You may NOT change:** anything else. In particular not the unsubscribe or opt-in pages
(`UnsubscribePage.tsx`, `OptInPage.tsx` — that is POPIA consent), the client-wide unsubscribe
(`src/lib/clientNews.ts`, `NewsPreferenceCard.tsx`), debtors, collections, the diary, trust, business,
settings, `supabase/`, `.github/`, `vercel.json`, `package.json`. **Never write to any database** (staging or
production) and never touch Vercel or Supabase settings — you have no access, by design. If the work truly
needs something outside the list, stop and write it in the pull request for Stephan; do not work round it.

**How your work ships:** your own branch `claude/s13-reino-campaigns`, from `claude/sales-raptor-review-p1pzx2`,
and a **pull request into `claude/sales-raptor-review-p1pzx2`**. Files under `src/pages/news/` and
`marketingApi.ts` merge without approval. `src/lib/marketing.ts`, `api/` and `scripts/qa/` are owned by
Stephan (`.github/CODEOWNERS`), so the pull request waits for his click — that is expected, not a problem.
Never push to `claude/sales-raptor-review-p1pzx2` or `Main` directly.

---

## 1. What to build

### 1.1 "Send from" — who a campaign comes from (the firm's words, 26 Oct)

> "There should be an option to send bulk communication from reports@bredellferreira.co.za, or ... from each
> liaison individually. So ... the client is for Nicole, it goes out from Nicole, but if the client is assigned
> to nobody, it just goes out from" reports@. "Nicole@bredellferreira.co.za. The only one at BF News is news at
> BF News." And: "Forget about team@."

Each **News** campaign gets a **Send from** choice. The database column is ready on staging:
`marketing_campaigns.send_from text not null default 'news'`, one of:

| `send_from` | Screen label | From | Reply-To |
|---|---|---|---|
| `news` (default; every existing campaign) | **BF News** — news@bfnews.co.za | `MARKETING_FROM` (`Bredell Ferreira News <news@bfnews.co.za>`) | as today: `replyToFor` → reports@ for clients, info@ for leads |
| `liaison` | **Each client's liaison** | the liaison, by name and own address: `"Nicole Loder" <nicole@bredellferreira.co.za>` | the same address |
| `reports` | **Reports** — reports@bredellferreira.co.za | `"Bredell Ferreira" <reports@bredellferreira.co.za>` | reports@bredellferreira.co.za |

Rules:

1. **Who is a client's liaison**: the client's `account_owner_id`, **only if** that person is Active and may be a
   client liaison (`canBeClientLiaison` in `src/lib/permissions.ts` — Liaison or Liaison Manager). This is the
   same rule the welcome email and S11's assign-liaison use. A **contact** goes from its client's liaison; a
   **sub-account** and its contacts go from the **parent's** liaison (the parent is the client — see `topOf` in
   `resolveAudience`). The `companies.liaison` text column is Swordfish's name and is NOT the rule.
2. **No liaison → reports@.** A client waiting for a liaison (`liaison_needed`), whose owner has left or is not a
   liaison, goes from reports@bredellferreira.co.za.
3. **Leads always go from news@bfnews.co.za**, whatever the choice: a lead has no liaison, and the firm said
   only news lives on BF News. Introductions and prospect campaigns keep their own sender
   (`prospectSender`) and do not get the choice at all.
4. **Decide the sender when the list is drawn, record it per row**: `marketing_sends.sender` already exists —
   write the bare From address into it at queue time, so the drain sends each row from what the preview showed,
   and the results can be split by sender. Leave `marketing_claim_prospect`'s use of `sender` intact: it counts a PROSPECT sender's daily warm-up allowance by that column (`marketing_sender_today`). The liaison and reports@ addresses are on a different domain from the prospect domain, so they can never be counted against a marketer's allowance — keep it that way.
5. **The 22 Oct lock must change deliberately, not be deleted.** `newsSender` refuses any From on
   `bredellferreira.co.za` (`FIRM_MAIN_MAIL_DOMAIN`, `isFirmMainDomain`), and `check-marketing-prospects` holds
   that. The firm has now chosen otherwise **for these two senders only**. Keep the lock for `MARKETING_FROM`
   and for the prospect domain (cold mail must never reach the main domain); allow the main domain only through
   the `liaison` / `reports` path. Update the comments to say the firm decided it on 26 Oct, knowing the risk.
6. **The Resend key.** The current `RESEND_API_KEY` is restricted to bfnews.co.za, so Resend will refuse a send
   from bredellferreira.co.za. Stephan is adding a second key, **`RESEND_FIRM_API_KEY`**, allowed to send from
   bredellferreira.co.za. Use it for `liaison` / `reports` rows and the existing key for `news` rows. Until it is
   set, the screen must say so plainly ("Sending from the liaisons is not set up yet: RESEND_FIRM_API_KEY must
   be set in Vercel") and offer only BF News — the same way `kindNotReady` already works. **Do not ask anybody
   to paste a key into chat.**
7. **The preview says the split before Send**: e.g. *"From Nicole Loder 42 · Ryno 31 · reports@ 9 · news@ (leads)
   12"*. The number somebody approves is the number that goes (the preview and the send are one calculation —
   `resolveOnServer` — keep it that way).
8. **Everything else is unchanged and must stay true**: unsubscribes (per address AND client-wide) are read at
   the list and again at each chunk; every email carries the unsubscribe link and the one-click headers; a lead
   needs consent; fees are never charged (sales side). These are law (POPIA s69), not style.
9. **The timeline line** a send writes on the client: credit it to the liaison it went from in `liaison` mode.

### 1.2 Make the campaign section look and work better

The firm: *"make this nice and make it work, look better."* Use your judgement and show Stephan screenshots in
the pull request. Starting points:

- The campaign editor (`CampaignEditor` in `NewsPage.tsx`, ~780 lines) does a lot in one column. Consider a
  clear left-to-right flow: **Who** (audience + send from) → **Write** (subject, preheader, body, image) →
  **Check** (preview of the real email, the counts, Send me a test) → **Send** → **Results**.
- A preview that looks like the inbox: the From name, subject and preheader line as Gmail/Outlook would show
  them, on a phone width too (the firm works on an iPad).
- The results: delivered / opened / clicked / unsubscribed as a compact summary, per sender in `liaison` mode.
- The campaign list: status, when sent, to how many, open rate at a glance.
- Follow the house style in CLAUDE.md "Writing for this codebase": the firm's words on screen, no warnings
  that fire when nothing is wrong, comments that explain *why*.

### 1.3 Test everything

- `npm run qa -- --fast` **before you change anything**, so you know what was already red (on 26 Oct:
  all green). The three browser reds S11 recorded (account-templates, client-handovers, excess-credit) are
  not yours.
- Unit checks for the sender rule: liaison found / owner not a liaison / owner inactive / no owner /
  sub-account follows parent / contact follows client / lead always news@ / prospect kinds untouched / the
  main-domain lock still refuses `MARKETING_FROM` and the prospect domain.
- Browser checks (`scripts/qa/e2e/`, fixtures only, no network) for the Send-from choice, the split in the
  preview, and the "not set up yet" state.
- **The convention that matters**: after writing a check, break the thing it guards and see it fail, then put
  it back. Say in the pull request that you did.
- `npm run build`, `npm run lint`, and the full `npm run qa` before the pull request. `api/` is not
  typechecked by the build — check it with a temporary tsconfig (CLAUDE.md, "Verifying work").

---

## 2. What Stephan does (not your session)

1. **Resend → API keys → Create**: sending access, domain **bredellferreira.co.za** → add it in Vercel as
   **`RESEND_FIRM_API_KEY`** (Production and Preview) → redeploy.
2. **Decide open/click tracking on bredellferreira.co.za** (Resend → Domains → bredellferreira.co.za →
   Tracking). It is off. Off means mail from Nicole and reports@ is delivered and counted, but opens and
   clicks are not. The only other Resend mail on that domain is Raptor's invites and password resets; section
   129s and letters go from people's own mailboxes and are not affected.
3. Review and merge Reino's pull request (it waits for him on `src/lib/marketing.ts`, `api/` and the checks).
4. **Test on the preview** (https://sales-raptor-git-claude-sales-raptor-review-p1pzx2-team-raptor.vercel.app):
   a News campaign to **Stephan's Test Client** with your own address on a contact — once from BF News, once
   from each liaison, once from reports@ — and check From, Reply-To, the unsubscribe link, and the results.

## 3. Facts the session needs (verified 26 Oct)

- **bfnews.co.za is fully verified in Resend**, open and click tracking on (tracking CNAME `links` added 26 Oct).
- Vercel env (Production + Preview): `RESEND_API_KEY` (bfnews only), `MARKETING_FROM` =
  `Bredell Ferreira News <news@bfnews.co.za>`, `MARKETING_REPLY_TO_CLIENTS` = reports@bredellferreira.co.za,
  `MARKETING_REPLY_TO_LEADS` = info@bredellferreira.co.za, `RESEND_WEBHOOK_SECRET` (the webhook points at the
  preview). Not set: `RESEND_FIRM_API_KEY`, `MARKETING_PROSPECT_DOMAIN`.
- Staging has `marketing_campaigns.send_from` (migration `campaign_send_from`, 26 Oct) and
  `companies.news_stopped_at` (a client-wide unsubscribe, S12 — the campaign rule already honours it as
  "client unsubscribed").
- Where things are: the audience rule `resolveAudience` and senders `newsSender` / `prospectSender` /
  `replyToFor` in `src/lib/marketing.ts`; the server's list, queue and drain (`resolveOnServer`,
  `queueCampaign`, `drainMarketing`, `senderForCampaign`) in `api/_lib/marketing.ts`; the HTTP actions in
  `api/_lib/email/marketing.ts`; the screen in `src/pages/news/NewsPage.tsx`.

## 4. Done means

- A News campaign can be sent from BF News, from each client's liaison (reports@ for clients without one), or
  from reports@; the preview shows the split; each email's From and Reply-To are right.
- The section looks clearly better, with before/after screenshots in the pull request.
- All checks green except the three known reds; every new check was broken once and seen failing.
- `HANDOFF.md` has an **S13 · Campaigns** section at the top: what shipped, what is waiting on Stephan.
- A pull request into `claude/sales-raptor-review-p1pzx2`, listing anything that needed a file outside the list.
