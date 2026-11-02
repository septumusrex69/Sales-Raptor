# Neon Genie — brief for Claude (Raptor · Handover 16)

> Written by S16 for **Ryno Buitendag** at Stephan's request, 2 Nov 2026. Paste everything below the line into Claude
> as the opening message of your session. It describes exactly how the client portal's South African photographs were
> chosen, written and approved, so that Neon Genie's ads and posts look and sound the same.

---

You are helping me (Ryno, marketing at **Bredell Ferreira**, a South African debt-collection firm) build **Neon Genie**:
the tool that will run Bredell Ferreira's marketing — Instagram, Facebook and the rest — by finding photographs, writing
the words that go with them, laying them out for each platform, and queuing posts **for a person to approve**. Stephan,
the firm's administrator, wants it to look and sound exactly like the photograph of the day we built for the client
portal in Raptor. Build it in that style.

**If you are working inside the Raptor repository**, read `CLAUDE.md` and `HANDOFF.md` first and follow them: say
"Raptor · Handover N" on everything, work on your own branch from `claude/sales-raptor-review-p1pzx2`, never touch money
(see "Working for the sales and marketing team" in CLAUDE.md), and staging only. The pieces to copy from are named below.

## 1. What already exists, and what to reuse

- `src/lib/portalPhotos.ts`: the library of 24 South African photographs, each with its Unsplash id, photographer,
  size, kind (Nature / People / City) and its **line**. This is the reference for tone, the mix and the attribution.
  **Start Neon Genie's library from it.**
- `src/pages/PortalLooksPage.tsx` (route `/portal-looks`) and the table `public.portal_day_looks`: a calendar where
  every day is drawn exactly as the client will see it. An Administrator frames the photograph, puts the words on its
  quiet side, sets the shade and approves it. **Neon Genie's approval screen should work the same way**, one card per
  post, drawn at the platform's real size.
- `/portal/photos`: the library page. Stephan liked all of it, specifically: **the animals, the nature, the
  skateboarder in Johannesburg, the people of Mamelodi and Soweto, the city skylines, and the art.**

## 2. The look

- **Bredell Ferreira's colours, not Raptor's.** Navy `#101F2C`, gold `#C69F54`, slate `#46607B`, pale blue `#D5E1EB`,
  near-white `#F4F4F4`. Headings in **Raleway** (bold), body in **Open Sans**. No green, red, orange or purple accents.
  (Raptor has its own Platinum look — black glass and silver — for the software's own screens. Keep it out of the
  firm's marketing.)
- **The words sit on the quiet part of the photograph**, over a navy shade that fades to clear. Every template needs:
  where the photo is framed (x/y), which side the words go (left / right / top / bottom), and how dark the shade is.
- The BF monogram and wordmark (`public/brand/icon-light.svg`, `public/brand/wordmark-light.svg`) on dark photos;
  the dark versions on light ones.
- **A thin gold rule and a quote in italic** is the house way of setting a line, with who said it in gold underneath.

## 3. The photographs: what to find

**South Africa, real and specific.** Every photograph must be identifiably South African. Check the photographer's
description, location and tags, not just the search term. Skip anything that could be anywhere.

**The mix Stephan set (31 Oct): about 40% nature, 35% people, 25% city.** Spread them so a week never runs to one
kind.

- **Nature:** the Drakensberg (Thaba Ntsu, Devil's Knuckles, Rhino Peak), the Blyde River Canyon and the Three
  Rondavels, Table Mountain, the Twelve Apostles, Llandudno, fynbos, Kruger (elephants, zebra, lion, leopard, buffalo,
  rhino), the Karoo, the Garden Route, the Wild Coast, the Cederberg, baobabs in Limpopo.
- **People:** South Africans at their best: working, building, market traders, sport (rugby, the Springboks), street
  style in Soweto and Johannesburg, skaters, musicians, families outdoors, smiles. Strong, proud, warm.
- **City:** Johannesburg and Sandton skylines (dawn and golden hour), Pretoria (jacarandas, the Union Buildings),
  Cape Town (the city bowl under Table Mountain, Sea Point, the V&A), Durban (the beachfront, North Beach pier),
  street scenes, architecture, street art.

**Quality:** landscape originals of **at least 4000 px wide** (Instagram and Facebook crop hard), sharp, well lit, and
golden hour where possible. Nothing grim: no poverty used as scenery, no protests, no crime, no politics.

**Sources, in this order:**
1. **The Unsplash API** (`api.unsplash.com`, an access key in a server-side environment variable, **never** a
   `VITE_*` variable, which would publish it). Follow their API guidelines, which are conditions of use: show
   photographs from their `urls`; **when one is used, call its `download_location` endpoint** (that registers the
   download, the same as Raptor's `mcp__Unsplash__download_asset`); credit "Photo: *name* on Unsplash" with both links
   carrying `utm_source=neon_genie&utm_medium=referral`.
2. **The Pexels API**, under the same rules (key server-side, credit the photographer).
3. **The firm's own photographs** (staff, events, the office), always preferred when good enough; ask Stephan for them.

Never scrape Google Images, Instagram or anybody's site: those photographs belong to somebody and are not licensed for
our ads. **For anything that becomes an ad, keep our own copy of the file** once it is approved (Stephan's rule from
the portal: "It's a safer way"), together with its photographer, source link, licence and download date.

## 4. The words

Every post carries a line, as every portal photograph does. Two kinds:

- **A quote from somebody worth quoting**: Nelson Mandela, Albert Einstein, Elon Musk (born in Pretoria), Marcus
  Aurelius, Theodore Roosevelt, J.R.R. Tolkien (born in Bloemfontein), Siya Kolisi, the national anthem. Stephan wants
  **"stuff of power. Things that build people, things that drive people, things that motivate people. And beautiful
  things. For South Africa, patriotic stuff, quotes from good people."** Nothing political, nothing activist. Keep it
  to drive, courage, work, building, beauty and pride in the country.
- **The firm's own line about the place in the picture**, written plainly and with the facts checked. Examples from
  the portal: *"Table Mountain is older than the Himalayas. Patience builds mountains."* *"Johannesburg was a goldfield
  in 1886. Look at it now. Start somewhere."* *"Egoli, the city of gold, was built by people who got up before the
  sun."*

**Only quotes on good authority.** The internet credits Mandela, Einstein and Churchill with a great deal they never
said, and a misquote on a firm's page is the kind of small carelessness people notice. For every quote, record where it
comes from (book, speech, interview, date). If you cannot source it, don't use it, or say "attributed" and get
Stephan's approval. The 24 lines in `portalPhotos.ts` have already been checked; reuse them.

Write in plain South African English, short and confident. No hashtags stuffed into the line itself (put them in the
caption), no emoji in the artwork.

## 5. Nothing goes out without a person approving it

This is the rule that matters most. Neon Genie **drafts**; a person **approves**; only then does anything post.

- An approval calendar like `/portal-looks`: each post is a card drawn at its real size for each place it will run:
  Instagram square 1080×1080, portrait 1080×1350 and story/reel 1080×1920, and Facebook 1200×630. Each card has the
  photo-framing, word-side and shade controls, the line, the caption, the hashtags and the scheduled time.
- **"Fill the month from the library"** drafts posts, all unapproved. **Approve** queues one. **Changing an approved
  post takes its approval away** until it is approved again. Store who approved it and when.
- Posting goes through **Meta's Graph API** (an Instagram Business or Creator account linked to the firm's Facebook
  Page; this needs a Meta developer app, its review and a long-lived Page token, all held server-side). Until that is
  set up, Neon Genie should produce the finished images and captions for posting by hand.

## 6. What it must never do

- **Never mention a debtor, an account, a client's name or any figure from Raptor.** Bredell Ferreira collects debts;
  the Debt Collectors Act, POPIA and the firm's reputation all forbid it. Marketing is about the firm and the country,
  never about who owes what.
- Never touch the money parts of Raptor (trust, fees, payments, commission), the database's money tables, or
  production. Neon Genie needs none of them.
- Never post without an approval, and never use a photograph without a recorded licence and credit.

## 7. How to start

1. Read `src/lib/portalPhotos.ts` (the library, the lines, and `lookFromRow` / `bandBackground` /
   `signinBackground`) and `src/pages/PortalLooksPage.tsx`. That is the whole idea in a few hundred lines.
2. Propose the data model (library, posts, approvals, platforms), show it to me, then build the library and one
   platform's approval calendar first (Instagram square), with tests.
3. Before anything posts, show Stephan a month of drafts on the approval screen.
