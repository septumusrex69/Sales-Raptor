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

## 8. The 24 photographs Stephan approved the look of, with their links

Start Neon Genie's library with these. Each is identifiably South African, credited, and has its checked line. (Also in
`docs/briefs/S16-portal-photo-links.md`; generated from `src/lib/portalPhotos.ts`.)

### Nature (10)

1. **An old bull elephant** — South Africa  
   Photo: https://unsplash.com/photos/W0tOuiKeyXU · by Ante Hamersmit (https://unsplash.com/@ante_kante) · 4608 × 2592 px  
   Line: *"I learned that courage was not the absence of fear, but the triumph over it."* — Nelson Mandela

2. **Llandudno at sunset** — Cape Town  
   Photo: https://unsplash.com/photos/eU6Da03AsUQ · by Byron Breytenbach (https://unsplash.com/@ohdiehard) · 5842 × 3895 px  
   Line: *"Where two oceans meet the mountains, the day ends in gold. Finish yours the same way."* (the firm's own line)

3. **The Three Rondavels at dusk** — Blyde River Canyon, Mpumalanga  
   Photo: https://unsplash.com/photos/bUOMCTiUymE · by Matthias Mullie (https://unsplash.com/@matthiasmullie) · 6932 × 2772 px  
   Line: *"After climbing a great hill, one only finds that there are many more hills to climb."* — Nelson Mandela

4. **A zebra and her foal** — Kruger National Park  
   Photo: https://unsplash.com/photos/YMJUpl8YWnE · by Simona Marinkova (https://unsplash.com/@zhenomad) · 6000 × 4000 px  
   Line: *"Strength is passed on. What you build today, someone carries tomorrow."* (the firm's own line)

5. **The canyon and its river** — Blyde River Canyon, Mpumalanga  
   Photo: https://unsplash.com/photos/bWE2CLXU0bM · by Asher Pardey (https://unsplash.com/@asherpardey) · 6401 × 4267 px  
   Line: *"The impediment to action advances action. What stands in the way becomes the way."* — Marcus Aurelius

6. **A tarn below Devil's Knuckles** — Southern Drakensberg, KwaZulu-Natal  
   Photo: https://unsplash.com/photos/qqIOlje2b9g · by Arthur Hickinbotham (https://unsplash.com/@arthurhick) · 5184 × 2912 px  
   Line: *"The Drakensberg has stood for 180 million years. Build things that last."* (the firm's own line)

7. **Table Mountain from the beach at sunset** — Cape Town  
   Photo: https://unsplash.com/photos/L6EP96_w1Fc · by Brent Ninaber (https://unsplash.com/@brentninaber) · 4800 × 2700 px  
   Line: *"Table Mountain is older than the Himalayas. Patience builds mountains."* (the firm's own line)

8. **Thaba Ntsu** — Southern Drakensberg, KwaZulu-Natal  
   Photo: https://unsplash.com/photos/9VTU2GoJPcg · by Arthur Hickinbotham (https://unsplash.com/@arthurhick) · 5184 × 2912 px  
   Line: *"Life is like riding a bicycle. To keep your balance, you must keep moving."* — Albert Einstein

9. **Oudekraal and the Twelve Apostles** — Cape Town  
   Photo: https://unsplash.com/photos/i1el7Rtl-UY · by Martijn Vonk (https://unsplash.com/@vonkm737) · 6000 × 4000 px  
   Line: *"Not all those who wander are lost."* — J.R.R. Tolkien, born in Bloemfontein

10. **Fynbos in flower on the mountain** — Table Mountain, Cape Town  
   Photo: https://unsplash.com/photos/JE56S222Rw0 · by Tobias Reich (https://unsplash.com/@electerious) · 6000 × 4000 px  
   Line: *"The Cape Floral Kingdom is the smallest of the world's six, and the richest. Size was never the point."* (the firm's own line)

### People (8)

1. **People of Mamelodi** — Pretoria  
   Photo: https://unsplash.com/photos/l_YNobbDYJk · by Mpumelelo Macu (https://unsplash.com/@mpumelelomacu) · 4175 × 2783 px  
   Line: *"Do what you can, with what you have, where you are."* — Theodore Roosevelt

2. **The Neighbourgoods Market** — Cape Town  
   Photo: https://unsplash.com/photos/FnrFx_UMebQ · by Sebastian Canaves (https://unsplash.com/@offthepath) · 6720 × 4480 px  
   Line: *"Every great business started at a table like this one: someone selling, someone buying, both coming back."* (the firm's own line)

3. **Soweto dreamers** — Soweto  
   Photo: https://unsplash.com/photos/3OOulcwrvr4 · by Naba Abolova (https://unsplash.com/@naba_abolova) · 6000 × 4000 px  
   Line: *"When something is important enough, you do it even if the odds are not in your favour."* — Elon Musk, born in Pretoria

4. **Sunset from Lion's Head** — Cape Town  
   Photo: https://unsplash.com/photos/47WZ2X0AtIg · by Nadine Hondebrink (https://unsplash.com/@nhondebrink) · 5472 × 3648 px  
   Line: *"It's the job that's never started as takes longest to finish."* — J.R.R. Tolkien

5. **A happy moment** — Johannesburg  
   Photo: https://unsplash.com/photos/n9UQCavpuE4 · by Nqobile Vundla (https://unsplash.com/@nqoe) · 5000 × 3334 px  
   Line: *"Good work, done honestly, is something to smile about."* (the firm's own line)

6. **Skating the city** — Johannesburg  
   Photo: https://unsplash.com/photos/2SDg8RmOfVg · by Keenan Constance (https://unsplash.com/@keenangrams) · 2738 × 1825 px  
   Line: *"Balance, speed and nerve. The city rewards all three."* (the firm's own line)

7. **Kasi style** — Soweto  
   Photo: https://unsplash.com/photos/hqvWruD-834 · by Naba Abolova (https://unsplash.com/@naba_abolova) · 6000 × 4000 px  
   Line: *"Use what is in front of you and make it work. That is the South African way."* (the firm's own line)

8. **A smile** — Gauteng  
   Photo: https://unsplash.com/photos/axTLYW8opeU · by Steward Masweneng (https://unsplash.com/@stewardesign) · 4928 × 3264 px  
   Line: *"We can achieve anything if we work together as one."* — Siya Kolisi, Springbok captain, 2019

### City (6)

1. **Joburg skyline at dawn** — Johannesburg  
   Photo: https://unsplash.com/photos/iAsUCcNUpGI · by Steffen Lemmerzahl (https://unsplash.com/@steffen_l) · 5368 × 3579 px  
   Line: *"Egoli, the city of gold, was built by people who got up before the sun."* (the firm's own line)

2. **Sea Point from Lion's Head at sunset** — Cape Town  
   Photo: https://unsplash.com/photos/fx0V31EtZls · by Waldo Piater (https://unsplash.com/@waldopiater) · 4608 × 3072 px  
   Line: *"Let us live and strive for freedom, in South Africa our land."* — Nkosi Sikelel' iAfrika

3. **Johannesburg at golden hour** — Johannesburg  
   Photo: https://unsplash.com/photos/_h-L45TSmGM · by Simon Hurry (https://unsplash.com/@bullterriere) · 5186 × 3140 px  
   Line: *"Johannesburg was a goldfield in 1886. Look at it now. Start somewhere."* (the firm's own line)

4. **Durban across the water** — Durban  
   Photo: https://unsplash.com/photos/rfQwBKfG0xE · by Weyland Swart (https://unsplash.com/@weylandswart) · 5184 × 3456 px  
   Line: *"Warm water, hard work and early mornings. Durban knows how to do a day."* (the firm's own line)

5. **Simmonds Street** — Johannesburg  
   Photo: https://unsplash.com/photos/C_cOkO1AO4w · by Ngcali Alexa Magopeni (https://unsplash.com/@alexa_thecreative) · 4128 × 2322 px  
   Line: *"Every tower on this street was a plan on paper first."* (the firm's own line)

6. **Durban from North Beach pier** — Durban  
   Photo: https://unsplash.com/photos/h5aF8jYW5XU · by Marlin Clark (https://unsplash.com/@marlinclark) · 5184 × 3500 px  
   Line: *"End the day better than you started it."* (the firm's own line)

